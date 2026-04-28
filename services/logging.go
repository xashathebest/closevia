package services

import (
	"context"
	"log/slog"
	"os"
	"strings"
)

var appLogger = slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))

func InitLogger() *slog.Logger {
	level := slog.LevelInfo
	switch strings.ToLower(strings.TrimSpace(os.Getenv("LOG_LEVEL"))) {
	case "debug":
		level = slog.LevelDebug
	case "warn":
		level = slog.LevelWarn
	case "error":
		level = slog.LevelError
	}

	format := strings.ToLower(strings.TrimSpace(os.Getenv("LOG_FORMAT")))
	opts := &slog.HandlerOptions{Level: level}
	if format == "text" {
		appLogger = slog.New(slog.NewTextHandler(os.Stdout, opts))
	} else {
		appLogger = slog.New(slog.NewJSONHandler(os.Stdout, opts))
	}
	slog.SetDefault(appLogger)
	return appLogger
}

func Logger() *slog.Logger {
	if appLogger == nil {
		return slog.Default()
	}
	return appLogger
}

func LogAttrs(ctx context.Context, service string, attrs ...any) []any {
	base := []any{"service", service}
	if ctx != nil {
		if requestID, ok := ctx.Value("request_id").(string); ok && requestID != "" {
			base = append(base, "request_id", requestID)
		}
		if userID, ok := ctx.Value("user_id").(int); ok && userID > 0 {
			base = append(base, "user_id", userID)
		}
	}
	return append(base, attrs...)
}
