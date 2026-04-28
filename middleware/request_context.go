package middleware

import (
	"context"
	"log/slog"
	"strconv"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
)

const (
	requestIDLocalKey = "request_id"
	requestCtxKey     = "request_context"
	requestCancelKey  = "request_cancel"
)

// RequestID adds a stable request ID to every request and response. If an
// upstream proxy already sent X-Request-ID we preserve it.
func RequestID() fiber.Handler {
	return func(c *fiber.Ctx) error {
		id := c.Get("X-Request-ID")
		if id == "" {
			id = uuid.NewString()
		}
		c.Locals(requestIDLocalKey, id)
		c.Set("X-Request-ID", id)
		return c.Next()
	}
}

// RequestContext stores a cancellable context on Fiber locals. Handlers can use
// RequestContextFromFiber(c) for slow DB queries, uploads, and external calls.
func RequestContext(defaultTimeout time.Duration) fiber.Handler {
	if defaultTimeout <= 0 {
		defaultTimeout = 60 * time.Second
	}
	return func(c *fiber.Ctx) error {
		timeout := defaultTimeout
		if header := c.Get("X-Request-Timeout-Seconds"); header != "" {
			if seconds, err := strconv.Atoi(header); err == nil && seconds > 0 && seconds <= 120 {
				timeout = time.Duration(seconds) * time.Second
			}
		}

		ctx, cancel := context.WithTimeout(context.Background(), timeout)
		ctx = context.WithValue(ctx, requestIDLocalKey, RequestIDFromFiber(c))
		if userID, ok := GetUserIDFromContext(c); ok {
			ctx = context.WithValue(ctx, "user_id", userID)
		}

		c.Locals(requestCtxKey, ctx)
		c.Locals(requestCancelKey, cancel)
		defer cancel()

		return c.Next()
	}
}

// StructuredRequestLogger writes compact slog request logs with request/user IDs.
func StructuredRequestLogger(logger *slog.Logger) fiber.Handler {
	if logger == nil {
		logger = slog.Default()
	}
	return func(c *fiber.Ctx) error {
		start := time.Now()
		err := c.Next()
		attrs := []any{
			"service", "http",
			"request_id", RequestIDFromFiber(c),
			"method", c.Method(),
			"path", c.Path(),
			"status", c.Response().StatusCode(),
			"duration_ms", time.Since(start).Milliseconds(),
			"ip", c.IP(),
		}
		if userID, ok := GetUserIDFromContext(c); ok {
			attrs = append(attrs, "user_id", userID)
		}
		if err != nil {
			attrs = append(attrs, "error", err.Error())
			logger.Error("request failed", attrs...)
			return err
		}
		logger.Info("request completed", attrs...)
		return nil
	}
}

func RequestContextFromFiber(c *fiber.Ctx) context.Context {
	if ctx, ok := c.Locals(requestCtxKey).(context.Context); ok && ctx != nil {
		return ctx
	}
	return context.Background()
}

func RequestIDFromFiber(c *fiber.Ctx) string {
	if id, ok := c.Locals(requestIDLocalKey).(string); ok && id != "" {
		return id
	}
	return c.Get("X-Request-ID")
}
