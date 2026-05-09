package handlers

import (
	"database/sql"
	"fmt"
	"log"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/xashathebest/clovia/database"
)

// ReviewHandler handles review-related HTTP requests
type ReviewHandler struct {
	db *sql.DB
}

// NewReviewHandler creates a new review handler
func NewReviewHandler() *ReviewHandler {
	return &ReviewHandler{
		db: database.DB,
	}
}

// CreateReview handles creating a new review
func (h *ReviewHandler) CreateReview(c *fiber.Ctx) error {
	// Get authenticated user
	userIDInterface := c.Locals("user_id")
	if userIDInterface == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "Unauthorized",
		})
	}
	userID, ok := userIDInterface.(int)
	if !ok {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "Unauthorized",
		})
	}

	// Get reviewed user ID from URL
	reviewedUserID, err := c.ParamsInt("id")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid user ID",
		})
	}

	// Parse request body
	var req struct {
		Rating  int    `json:"rating"`
		Comment string `json:"comment"`
	}

	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}
	req.Comment = cleanUserText(req.Comment, 2000)

	// Validate rating
	if req.Rating < 1 || req.Rating > 5 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Rating must be between 1 and 5",
		})
	}

	// Validate comment
	if req.Comment == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Comment is required",
		})
	}

	// Check if user is trying to review themselves
	if userID == reviewedUserID {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "You cannot review yourself",
		})
	}

	// Create review in database
	query := `
		INSERT INTO reviews (reviewer_id, reviewed_user_id, rating, comment, created_at)
		VALUES (?, ?, ?, ?, ?)
	`

	result, err := h.db.Exec(query, userID, reviewedUserID, req.Rating, req.Comment, time.Now())
	if err != nil {
		log.Printf("❌ Failed to create review: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to create review",
		})
	}

	reviewID, _ := result.LastInsertId()

	return c.Status(fiber.StatusCreated).JSON(fiber.Map{
		"message": "Review created successfully",
		"data": fiber.Map{
			"id": reviewID,
		},
	})
}

// GetUserReviews retrieves all reviews for a specific user
func (h *ReviewHandler) GetUserReviews(c *fiber.Ctx) error {
	// Set cache headers - 10 minutes for user reviews
	c.Set("Cache-Control", "public, max-age=600")
	c.Set("ETag", fmt.Sprintf(`"%d"`, time.Now().Unix()/600)) // ETag changes every 10 min

	identifier := c.Params("id")
	if identifier == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "User ID or handle is required",
		})
	}

	userHandler := NewUserHandler()
	userID, err := userHandler.ResolveUserID(identifier)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "User not found",
		})
	}

	tradeReviews, err := getReceivedTradeReviews(h.db, userID)
	if err != nil {
		log.Printf("Failed to fetch received trade reviews for user %d: %v", userID, err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to fetch reviews",
		})
	}

	return c.JSON(fiber.Map{
		"data": tradeReviews,
	})
}

// GetUserRating calculates the average rating for a user
func (h *ReviewHandler) GetUserRating(c *fiber.Ctx) error {
	identifier := c.Params("id")
	if identifier == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "User ID or handle is required",
		})
	}

	userHandler := NewUserHandler()
	userID, err := userHandler.ResolveUserID(identifier)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "User not found",
		})
	}

	tradeStats, err := getReceivedTradeReviewStats(h.db, userID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to calculate rating",
		})
	}
	avgRating := 0.0
	if tradeStats.TotalReviews > 0 && tradeStats.AvgRating.Valid {
		avgRating = tradeStats.AvgRating.Float64
	}
	positiveFeedback := 0
	if tradeStats.TotalReviews > 0 && tradeStats.PositivePercent.Valid {
		positiveFeedback = int(tradeStats.PositivePercent.Float64)
	}

	return c.JSON(fiber.Map{
		"data": fiber.Map{
			"rating":            avgRating,
			"total_reviews":     tradeStats.TotalReviews,
			"positive_feedback": positiveFeedback,
		},
	})
}

// ReplyToReview allows users to reply to reviews
func (h *ReviewHandler) ReplyToReview(c *fiber.Ctx) error {
	// Get authenticated user
	userIDInterface := c.Locals("user_id")
	if userIDInterface == nil {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "Unauthorized",
		})
	}
	userID, ok := userIDInterface.(int)
	if !ok {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
			"error": "Unauthorized",
		})
	}

	// Get review ID from URL
	reviewID, err := c.ParamsInt("id")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid review ID",
		})
	}

	// Parse request body
	var req struct {
		Reply string `json:"reply"`
	}

	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid request body",
		})
	}

	// Validate reply
	if len(req.Reply) == 0 {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Reply is required",
		})
	}

	// Ensure reply columns exist (auto-migrate)
	h.db.Exec("ALTER TABLE reviews ADD COLUMN reply TEXT")
	h.db.Exec("ALTER TABLE reviews ADD COLUMN reply_date DATETIME")
	h.db.Exec("ALTER TABLE reviews ADD COLUMN replied_by_user_id INT")

	// Check if review exists and get the reviewed user ID
	var reviewedUserID int
	checkQuery := `SELECT reviewed_user_id FROM reviews WHERE id = ?`
	err = h.db.QueryRow(checkQuery, reviewID).Scan(&reviewedUserID)
	if err == sql.ErrNoRows {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "Review not found",
		})
	}
	if err != nil {
		log.Printf("❌ ReplyToReview: Failed to verify review %d: %v", reviewID, err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to verify review",
		})
	}

	// Check if user is authorized to reply (must be the reviewed user or an admin)
	// For now, allow any authenticated user to reply
	// You can add more specific authorization logic here

	// Update review with reply
	updateQuery := `
		UPDATE reviews 
		SET reply = ?, reply_date = ?, replied_by_user_id = ?
		WHERE id = ?
	`

	_, err = h.db.Exec(updateQuery, req.Reply, time.Now(), userID, reviewID)
	if err != nil {
		log.Printf("❌ ReplyToReview: Failed to update review %d: %v", reviewID, err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to post reply",
		})
	}

	return c.JSON(fiber.Map{
		"success": true,
		"message": "Reply posted successfully",
	})
}
