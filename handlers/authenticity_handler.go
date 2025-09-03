package handlers

import (
	"net/http"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/xashathebest/clovia/database"
)

type UploadProofRequest struct {
	ProductID    int    `json:"product_id"`
	Type         string `json:"type"`      // receipt | serial_number | certificate
	ProofURL     string `json:"proof_url"` // for receipt/certificate
	SerialNumber string `json:"serial_number"`
	Certificate  string `json:"certificate_text"`
}

type ReviewProofRequest struct {
	ProofID int    `json:"proof_id"`
	Action  string `json:"action"` // approve | reject
}

func NewAuthenticityHandler() *AuthenticityHandler { return &AuthenticityHandler{} }

type AuthenticityHandler struct{}

// Upload proof: status=pending
func (h *AuthenticityHandler) Upload(c *fiber.Ctx) error {
	var req UploadProofRequest
	if err := c.BodyParser(&req); err != nil || req.ProductID <= 0 || req.Type == "" {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "invalid_request"})
	}

	userID := c.Locals("user_id")
	if userID == nil {
		return c.Status(http.StatusUnauthorized).JSON(fiber.Map{"error": "unauthorized"})
	}

	_, err := database.DB.Exec(`INSERT INTO authenticity_proofs (product_id, user_id, type, status, proof_url, serial_number, certificate_text)
		VALUES (?, ?, ?, 'pending', ?, ?, ?)`, req.ProductID, userID, req.Type, req.ProofURL, req.SerialNumber, req.Certificate)
	if err != nil {
		return c.Status(http.StatusInternalServerError).JSON(fiber.Map{"error": "db_error"})
	}
	return c.JSON(fiber.Map{"success": true})
}

// Review proof: admin approves/rejects; on approve, mark product.authenticity_verified=1 if any approved
func (h *AuthenticityHandler) Review(c *fiber.Ctx) error {
	var req ReviewProofRequest
	if err := c.BodyParser(&req); err != nil || req.ProofID <= 0 || (req.Action != "approve" && req.Action != "reject") {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "invalid_request"})
	}

	reviewerID := c.Locals("user_id")
	if reviewerID == nil {
		return c.Status(http.StatusUnauthorized).JSON(fiber.Map{"error": "unauthorized"})
	}

	status := "rejected"
	if req.Action == "approve" {
		status = "approved"
	}
	_, err := database.DB.Exec(`UPDATE authenticity_proofs SET status = ?, reviewer_id = ?, reviewed_at = ? WHERE id = ?`, status, reviewerID, time.Now(), req.ProofID)
	if err != nil {
		return c.Status(http.StatusInternalServerError).JSON(fiber.Map{"error": "db_error"})
	}

	if status == "approved" {
		// Mark product as authenticity verified if any approved proof exists
		_, err = database.DB.Exec(`UPDATE products p SET p.authenticity_verified = 1 WHERE p.id = (
			SELECT ap.product_id FROM authenticity_proofs ap WHERE ap.id = ?
		)`, req.ProofID)
		if err != nil {
			return c.Status(http.StatusInternalServerError).JSON(fiber.Map{"error": "db_error"})
		}
	}

	return c.JSON(fiber.Map{"success": true, "status": status})
}
