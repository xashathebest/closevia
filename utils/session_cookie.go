package utils

import (
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
)

const AuthCookieName = "__Host-clovia_session"
const DevAuthCookieName = "clovia_session"

func isProduction() bool {
	env := strings.ToLower(strings.TrimSpace(os.Getenv("APP_ENV")))
	if env == "" {
		env = strings.ToLower(strings.TrimSpace(os.Getenv("GO_ENV")))
	}
	if env == "" {
		env = strings.ToLower(strings.TrimSpace(os.Getenv("ENV")))
	}
	return env == "production" || env == "prod" || os.Getenv("RENDER") != ""
}

func AuthCookieSameSite() string {
	value := strings.ToLower(strings.TrimSpace(os.Getenv("AUTH_COOKIE_SAMESITE")))
	switch value {
	case "strict":
		return "Strict"
	case "lax":
		return "Lax"
	case "none":
		return "None"
	default:
		if isProduction() {
			// The hosted frontend and API can be on different sites, so production
			// cookie auth must allow credentialed cross-site XHR.
			return "None"
		}
		return "Lax"
	}
}

func AuthCookieSecure() bool {
	if value := strings.ToLower(strings.TrimSpace(os.Getenv("AUTH_COOKIE_SECURE"))); value != "" {
		return value == "1" || value == "true" || value == "yes"
	}
	return isProduction()
}

func PrimaryAuthCookieName() string {
	if AuthCookieSecure() {
		return AuthCookieName
	}
	return DevAuthCookieName
}

func AuthCookieNames() []string {
	if PrimaryAuthCookieName() == AuthCookieName {
		return []string{AuthCookieName, DevAuthCookieName}
	}
	return []string{DevAuthCookieName, AuthCookieName}
}

func SessionIdleTimeout() time.Duration {
	if minutes := strings.TrimSpace(os.Getenv("SESSION_IDLE_TIMEOUT_MINUTES")); minutes != "" {
		if parsed, err := strconv.Atoi(minutes); err == nil && parsed > 0 && parsed <= 24*60 {
			return time.Duration(parsed) * time.Minute
		}
	}
	return 30 * time.Minute
}

func SetAuthCookie(c *fiber.Ctx, token string) {
	maxAge := SessionIdleTimeout()
	if tokenTTL := TokenTTL(); tokenTTL < maxAge {
		maxAge = tokenTTL
	}
	sameSite := AuthCookieSameSite()
	secure := AuthCookieSecure() || sameSite == "None"
	c.Cookie(&fiber.Cookie{
		Name:     PrimaryAuthCookieName(),
		Value:    token,
		Path:     "/",
		HTTPOnly: true,
		Secure:   secure,
		SameSite: sameSite,
		Expires:  time.Now().Add(maxAge),
		MaxAge:   int(maxAge.Seconds()),
	})
}

func ClearAuthCookie(c *fiber.Ctx) {
	sameSite := AuthCookieSameSite()
	secure := AuthCookieSecure() || sameSite == "None"
	for _, name := range AuthCookieNames() {
		c.Cookie(&fiber.Cookie{
			Name:     name,
			Value:    "",
			Path:     "/",
			HTTPOnly: true,
			Secure:   secure,
			SameSite: sameSite,
			Expires:  time.Unix(0, 0),
			MaxAge:   -1,
		})
	}
}
