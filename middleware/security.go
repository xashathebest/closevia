package middleware

import (
	"net/url"
	"os"
	"strings"

	"github.com/gofiber/fiber/v2"
)

func SecurityHeaders() fiber.Handler {
	return func(c *fiber.Ctx) error {
		c.Set("X-Content-Type-Options", "nosniff")
		c.Set("X-Frame-Options", "DENY")
		c.Set("Content-Security-Policy", "frame-ancestors 'none'; object-src 'none'; base-uri 'self'")
		c.Set("Referrer-Policy", "strict-origin-when-cross-origin")
		c.Set("Permissions-Policy", "camera=(), microphone=(), geolocation=(self), payment=(self)")
		c.Set("Cross-Origin-Opener-Policy", "same-origin-allow-popups")

		if isHTTPSRequest(c) {
			c.Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
		}

		if strings.HasPrefix(c.Path(), "/api/") {
			c.Set("Cache-Control", "no-store")
		}

		return c.Next()
	}
}

func CookieCSRFMitigation(allowedOrigins string) fiber.Handler {
	allowed := parseAllowedOrigins(allowedOrigins)
	return func(c *fiber.Ctx) error {
		if c.Locals("auth_source") != "cookie" || isSafeMethod(c.Method()) {
			return c.Next()
		}

		origin := c.Get("Origin")
		if origin == "" {
			origin = originFromReferer(c.Get("Referer"))
		}

		if origin != "" && !allowed[origin] {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
				"success": false,
				"error":   "Request origin is not allowed",
			})
		}

		return c.Next()
	}
}

func isSafeMethod(method string) bool {
	switch method {
	case fiber.MethodGet, fiber.MethodHead, fiber.MethodOptions:
		return true
	default:
		return false
	}
}

func parseAllowedOrigins(raw string) map[string]bool {
	allowed := map[string]bool{}
	for _, item := range strings.Split(raw, ",") {
		origin := strings.TrimSpace(item)
		if origin != "" && origin != "*" {
			allowed[origin] = true
		}
	}
	return allowed
}

func originFromReferer(ref string) string {
	if ref == "" {
		return ""
	}
	u, err := url.Parse(ref)
	if err != nil || u.Scheme == "" || u.Host == "" {
		return ""
	}
	return u.Scheme + "://" + u.Host
}

func isHTTPSRequest(c *fiber.Ctx) bool {
	if strings.EqualFold(c.Protocol(), "https") {
		return true
	}
	if strings.EqualFold(c.Get("X-Forwarded-Proto"), "https") {
		return true
	}
	return strings.EqualFold(os.Getenv("FORCE_HTTPS"), "true")
}
