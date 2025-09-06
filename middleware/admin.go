package middleware

import (
	"github.com/gofiber/fiber/v2"
	"github.com/xashathebest/clovia/database"
	"github.com/xashathebest/clovia/models"
)

// AdminMiddleware ensures the user is an admin
func AdminMiddleware() fiber.Handler {
	return func(c *fiber.Ctx) error {
		userID, ok := GetUserIDFromContext(c)
		if !ok {
			return c.Status(401).JSON(models.APIResponse{
				Success: false,
				Error:   "User not authenticated",
			})
		}

		// Check if user is admin
		var role string
		err := database.DB.QueryRow("SELECT role FROM users WHERE id = ?", userID).Scan(&role)
		if err != nil {
			return c.Status(401).JSON(models.APIResponse{
				Success: false,
				Error:   "User not found",
			})
		}

		if role != "admin" {
			return c.Status(403).JSON(models.APIResponse{
				Success: false,
				Error:   "Access denied. Admin privileges required",
			})
		}

		return c.Next()
	}
}
