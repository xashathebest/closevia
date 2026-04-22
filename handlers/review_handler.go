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

	// Try to query with reply fields first, fall back to basic query if columns don't exist
	query := `
		SELECT 
			r.id,
			r.reviewer_id,
			u.name as reviewer_name,
			u.profile_picture as reviewer_avatar,
			r.rating,
			r.comment,
			r.created_at
		FROM reviews r
		JOIN users u ON r.reviewer_id = u.id
		WHERE r.reviewed_user_id = ?
		ORDER BY r.created_at DESC
	`

	// Check if reply columns exist
	hasReplyColumns := false
	var columnCheck string
	checkErr := h.db.QueryRow("SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'reviews' AND COLUMN_NAME = 'reply' AND TABLE_SCHEMA = DATABASE()").Scan(&columnCheck)
	if checkErr == nil {
		log.Printf("✅ Reply columns exist, using extended query")
		hasReplyColumns = true
		query = `
			SELECT 
				r.id,
				r.reviewer_id,
				u.name as reviewer_name,
				u.profile_picture as reviewer_avatar,
				r.rating,
				r.comment,
				r.created_at,
				r.reply,
				r.reply_date,
				ru.name as reply_author_name
			FROM reviews r
			JOIN users u ON r.reviewer_id = u.id
			LEFT JOIN users ru ON r.replied_by_user_id = ru.id
			WHERE r.reviewed_user_id = ?
			ORDER BY r.created_at DESC
		`
	}

	rows, err := h.db.Query(query, userID)
	if err != nil {
		log.Printf("❌ Failed to fetch reviews for user %d: %v", userID, err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to fetch reviews",
		})
	}
	defer rows.Close()

	var reviews []fiber.Map
	for rows.Next() {
		var review struct {
			ID              int
			ReviewerID      int
			ReviewerName    string
			ReviewerAvatar  sql.NullString
			Rating          int
			Comment         string
			CreatedAt       time.Time
			Reply           sql.NullString
			ReplyDate       sql.NullTime
			ReplyAuthorName sql.NullString
		}

		var err error
		if hasReplyColumns {
			err = rows.Scan(
				&review.ID,
				&review.ReviewerID,
				&review.ReviewerName,
				&review.ReviewerAvatar,
				&review.Rating,
				&review.Comment,
				&review.CreatedAt,
				&review.Reply,
				&review.ReplyDate,
				&review.ReplyAuthorName,
			)
		} else {
			err = rows.Scan(
				&review.ID,
				&review.ReviewerID,
				&review.ReviewerName,
				&review.ReviewerAvatar,
				&review.Rating,
				&review.Comment,
				&review.CreatedAt,
			)
		}

		if err != nil {
			continue
		}

		avatar := ""
		if review.ReviewerAvatar.Valid {
			avatar = review.ReviewerAvatar.String
		}

		reviewMap := fiber.Map{
			"id":       review.ID,
			"reviewer": review.ReviewerName,
			"avatar":   avatar,
			"rating":   review.Rating,
			"comment":  review.Comment,
			"date":     review.CreatedAt.Format("2006-01-02"),
		}

		// Add reply if exists and columns are available
		if hasReplyColumns && review.Reply.Valid {
			reviewMap["reply"] = review.Reply.String
			if review.ReplyDate.Valid {
				reviewMap["reply_date"] = review.ReplyDate.Time.Format("2006-01-02")
			}
			if review.ReplyAuthorName.Valid {
				reviewMap["reply_author"] = review.ReplyAuthorName.String
			}
		}

		reviews = append(reviews, reviewMap)
	}

	if reviews == nil {
		reviews = []fiber.Map{}
	}

	return c.JSON(fiber.Map{
		"data": reviews,
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

	query := `
		SELECT 
			COALESCE(AVG(rating), 0) as avg_rating,
			COUNT(*) as total_reviews,
			COALESCE(SUM(CASE WHEN rating >= 4 THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*), 0), 0) as positive_feedback
		FROM reviews
		WHERE reviewed_user_id = ?
	`

	var stats struct {
		AvgRating        float64
		TotalReviews     int
		PositiveFeedback float64
	}

	err = h.db.QueryRow(query, userID).Scan(
		&stats.AvgRating,
		&stats.TotalReviews,
		&stats.PositiveFeedback,
	)

	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to calculate rating",
		})
	}

	return c.JSON(fiber.Map{
		"data": fiber.Map{
			"rating":            stats.AvgRating,
			"total_reviews":     stats.TotalReviews,
			"positive_feedback": int(stats.PositiveFeedback),
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
