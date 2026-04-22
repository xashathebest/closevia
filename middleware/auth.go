package middleware

import (
	"log"
	"os"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/xashathebest/clovia/utils"
)

// AuthMiddleware checks if the request has a valid JWT token
func AuthMiddleware() fiber.Handler {
	return func(c *fiber.Ctx) error {
		token := ""
		authSource := ""

		authHeader := c.Get("Authorization")
		if strings.HasPrefix(authHeader, "Bearer ") {
			token = strings.TrimSpace(strings.TrimPrefix(authHeader, "Bearer "))
			authSource = "header"
		}
		if token == "" {
			for _, cookieName := range utils.AuthCookieNames() {
				token = strings.TrimSpace(c.Cookies(cookieName))
				if token != "" {
					authSource = "cookie"
					break
				}
			}
		}
		if token == "" {
			return c.Status(401).JSON(fiber.Map{
				"success": false,
				"error":   "Authentication required",
			})
		}

		if authHeader != "" && authSource == "" {
			return c.Status(401).JSON(fiber.Map{
				"success": false,
				"error":   "Invalid authorization format. Use 'Bearer <token>'",
			})
		}

		// Validate the token
		claims, err := utils.ValidateJWT(token)
		if err != nil {
			if authSource == "cookie" {
				utils.ClearAuthCookie(c)
			}
			return c.Status(401).JSON(fiber.Map{
				"success": false,
				"error":   "Invalid or expired token",
			})
		}

		// Extract user information from claims
		userID, ok := claims["user_id"].(float64)
		if !ok {
			log.Printf("❌ [AuthMiddleware] JWT claim extraction failed - user_id type: %T", claims["user_id"])
			if authSource == "cookie" {
				utils.ClearAuthCookie(c)
			}
			return c.Status(401).JSON(fiber.Map{
				"success": false,
				"error":   "Invalid token claims",
			})
		}

		email, ok := claims["email"].(string)
		if !ok {
			log.Printf("❌ [AuthMiddleware] JWT claim extraction failed - email type: %T", claims["email"])
			if authSource == "cookie" {
				utils.ClearAuthCookie(c)
			}
			return c.Status(401).JSON(fiber.Map{
				"success": false,
				"error":   "Invalid token claims",
			})
		}

		// Store user information in context for later use
		c.Locals("user_id", int(userID))
		c.Locals("user_email", email)
		c.Locals("auth_source", authSource)

		if authSource == "cookie" && !isSafeMethod(c.Method()) {
			origin := c.Get("Origin")
			if origin == "" {
				origin = originFromReferer(c.Get("Referer"))
			}
			allowed := parseAllowedOrigins(os.Getenv("CORS_ORIGINS"))
			if origin != "" && len(allowed) > 0 && !allowed[origin] {
				return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
					"success": false,
					"error":   "Request origin is not allowed",
				})
			}
		}

		if authSource == "cookie" {
			utils.SetAuthCookie(c, token)
		}

		return c.Next()
	}
}

// OptionalAuthMiddleware checks for JWT token but doesn't require it
func OptionalAuthMiddleware() fiber.Handler {
	return func(c *fiber.Ctx) error {
		token := ""
		authSource := ""

		authHeader := c.Get("Authorization")
		if strings.HasPrefix(authHeader, "Bearer ") {
			token = strings.TrimSpace(strings.TrimPrefix(authHeader, "Bearer "))
			authSource = "header"
		}
		if token == "" {
			for _, cookieName := range utils.AuthCookieNames() {
				token = strings.TrimSpace(c.Cookies(cookieName))
				if token != "" {
					authSource = "cookie"
					break
				}
			}
		}
		if token == "" {
			return c.Next()
		}

		// Try to validate the token
		claims, err := utils.ValidateJWT(token)
		if err != nil {
			return c.Next()
		}

		// Extract user information from claims
		userID, ok := claims["user_id"].(float64)
		if !ok {
			return c.Next()
		}

		email, ok := claims["email"].(string)
		if !ok {
			return c.Next()
		}

		// Store user information in context for later use
		c.Locals("user_id", int(userID))
		c.Locals("user_email", email)
		c.Locals("auth_source", authSource)

		return c.Next()
	}
}

// GetUserIDFromContext gets the user ID from the context
func GetUserIDFromContext(c *fiber.Ctx) (int, bool) {
	userID, ok := c.Locals("user_id").(int)
	return userID, ok
}

// GetUserEmailFromContext gets the user email from the context
func GetUserEmailFromContext(c *fiber.Ctx) (string, bool) {
	email, ok := c.Locals("user_email").(string)
	return email, ok
}
