package middleware

import (
	"github.com/gofiber/fiber/v2"
	"github.com/xashathebest/clovia/database"
)

// AdminMiddleware ensures the user is an admin
func AdminMiddleware() fiber.Handler {
	return func(c *fiber.Ctx) error {
		userID, ok := GetUserIDFromContext(c)
		if !ok {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "unauthorized"})
		}

		// Check if user is admin
		var role string
		err := database.DB.QueryRow("SELECT role FROM users WHERE id = ?", userID).Scan(&role)
		if err != nil {
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "unauthorized"})
		}

		if role != "admin" {
			return c.Status(fiber.StatusForbidden).JSON(fiber.Map{
				"success": false,
				"error":   "Access denied. Admin privileges required",
			})
		}

		return c.Next()
	}
}
