package handlers

import (
	"strconv"

	"github.com/gofiber/fiber/v2"
	"github.com/xashathebest/clovia/database"
	"github.com/xashathebest/clovia/middleware"
	"github.com/xashathebest/clovia/models"
)

type CommentHandler struct{}

func NewCommentHandler() *CommentHandler {
	return &CommentHandler{}
}

// CreateComment adds a new comment to a product
func (h *CommentHandler) CreateComment(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return fiber.ErrUnauthorized
	}

	productID, err := strconv.Atoi(c.Params("id"))
	if err != nil {
		return fiber.ErrBadRequest
	}

	var payload struct {
		Content string `json:"content" validate:"required"`
	}

	if err := c.BodyParser(&payload); err != nil {
		return fiber.ErrBadRequest
	}
	payload.Content = cleanUserText(payload.Content, 1000)
	if payload.Content == "" {
		return fiber.ErrBadRequest
	}

	query := `INSERT INTO comments (product_id, user_id, content) VALUES (?, ?, ?)`
	res, err := database.DB.Exec(query, productID, userID, payload.Content)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(models.APIResponse{
			Success: false,
			Error:   "Failed to create comment",
		})
	}

	commentID, _ := res.LastInsertId()

	var comment models.Comment
	err = database.DB.QueryRow(`
		SELECT c.id, c.product_id, c.user_id, c.content, c.created_at, c.updated_at, u.name 
		FROM comments c
		JOIN users u ON c.user_id = u.id
		WHERE c.id = ?`, commentID).Scan(
		&comment.ID, &comment.ProductID, &comment.UserID, &comment.Content,
		&comment.CreatedAt, &comment.UpdatedAt, &comment.CommenterName,
	)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(models.APIResponse{
			Success: false,
			Error:   "Failed to retrieve created comment",
		})
	}

	return c.Status(fiber.StatusCreated).JSON(models.APIResponse{
		Success: true,
		Data:    comment,
	})
}

// GetComments retrieves all comments for a product
func (h *CommentHandler) GetComments(c *fiber.Ctx) error {
	productID, err := strconv.Atoi(c.Params("id"))
	if err != nil {
		return fiber.ErrBadRequest
	}

	query := `
		SELECT c.id, c.product_id, c.user_id, c.content, c.created_at, c.updated_at, u.name 
		FROM comments c
		JOIN users u ON c.user_id = u.id
		WHERE c.product_id = ? 
		ORDER BY c.created_at DESC`
	rows, err := database.DB.Query(query, productID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(models.APIResponse{
			Success: false,
			Error:   "Failed to retrieve comments",
		})
	}
	defer rows.Close()

	var comments []models.Comment
	for rows.Next() {
		var comment models.Comment
		err := rows.Scan(
			&comment.ID, &comment.ProductID, &comment.UserID, &comment.Content,
			&comment.CreatedAt, &comment.UpdatedAt, &comment.CommenterName,
		)
		if err != nil {
			continue
		}
		comments = append(comments, comment)
	}

	return c.JSON(models.APIResponse{
		Success: true,
		Data:    comments,
	})
}
