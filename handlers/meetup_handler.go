package handlers

import (
	"database/sql"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/xashathebest/clovia/database"
	"github.com/xashathebest/clovia/middleware"
	"github.com/xashathebest/clovia/services"
)

type MeetupHandler struct {
	db *sql.DB
}

func NewMeetupHandler(db *sql.DB) *MeetupHandler {
	return &MeetupHandler{db: db}
}

// ProposeMeetupTime handles a user proposing time and location
// POST /api/trades/:tradeID/meetup/propose
func (h *MeetupHandler) ProposeMeetupTime(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Unauthorized"})
	}

	tradeID, err := c.ParamsInt("tradeID")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid trade ID"})
	}

	var req struct {
		ProposedTime     string `json:"proposed_time"` // ISO 8601 format
		ProposedLocation string `json:"proposed_location"`
	}

	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
	}

	// Parse time
	proposedTime, err := time.Parse(time.RFC3339, req.ProposedTime)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid time format"})
	}

	// Verify user is part of trade
	var buyerID, sellerID int
	err = database.DB.QueryRow("SELECT buyer_id, seller_id FROM trades WHERE id = ?", tradeID).Scan(&buyerID, &sellerID)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Trade not found"})
	}

	if userID != buyerID && userID != sellerID {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Not involved in this trade"})
	}
	otherUserID := sellerID
	if userID == sellerID {
		otherUserID = buyerID
	}

	// Use meetup service
	meetupService := services.NewMeetupService(database.DB)
	status, _, err := meetupService.ProposeMeetupDetails(tradeID, userID, proposedTime, req.ProposedLocation)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}
	sendPushToUser(otherUserID, "Trade schedule proposed", "Your trading partner proposed meetup details.", tradeDeepLink(tradeID), "meetup_update")

	return c.JSON(fiber.Map{
		"success": true,
		"message": "Time and location proposed",
		"status":  status,
	})
}

// MarkHeadingOut marks user as on the way
// POST /api/trades/:tradeID/meetup/heading-out
func (h *MeetupHandler) MarkHeadingOut(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Unauthorized"})
	}

	tradeID, err := c.ParamsInt("tradeID")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid trade ID"})
	}

	// Verify user is part of trade
	var buyerID, sellerID int
	err = database.DB.QueryRow("SELECT buyer_id, seller_id FROM trades WHERE id = ?", tradeID).Scan(&buyerID, &sellerID)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Trade not found"})
	}

	if userID != buyerID && userID != sellerID {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Not involved in this trade"})
	}

	meetupService := services.NewMeetupService(database.DB)
	_, errMark := meetupService.MarkHeadingOut(tradeID, userID)
	if errMark != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": errMark.Error()})
	}

	status, _ := meetupService.GetMeetupStatus(tradeID)

	return c.JSON(fiber.Map{
		"success": true,
		"message": "Marked as heading out",
		"status":  status,
	})
}

// MarkArrived marks user as arrived at meetup location
// POST /api/trades/:tradeID/meetup/arrived
func (h *MeetupHandler) MarkArrived(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Unauthorized"})
	}

	tradeID, err := c.ParamsInt("tradeID")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid trade ID"})
	}

	// Verify user is part of trade
	var buyerID, sellerID int
	err = database.DB.QueryRow("SELECT buyer_id, seller_id FROM trades WHERE id = ?", tradeID).Scan(&buyerID, &sellerID)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Trade not found"})
	}

	if userID != buyerID && userID != sellerID {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Not involved in this trade"})
	}

	meetupService := services.NewMeetupService(database.DB)
	_, errArrived := meetupService.MarkArrived(tradeID, userID)
	if errArrived != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": errArrived.Error()})
	}

	status, _ := meetupService.GetMeetupStatus(tradeID)

	return c.JSON(fiber.Map{
		"success": true,
		"message": "Marked as arrived",
		"status":  status,
	})
}

// ConfirmCompletion confirms that the trade exchange was completed
// POST /api/trades/:tradeID/meetup/confirm-completion
func (h *MeetupHandler) ConfirmCompletion(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Unauthorized"})
	}

	tradeID, err := c.ParamsInt("tradeID")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid trade ID"})
	}

	// Verify user is part of trade
	var buyerID, sellerID int
	err = database.DB.QueryRow("SELECT buyer_id, seller_id FROM trades WHERE id = ?", tradeID).Scan(&buyerID, &sellerID)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Trade not found"})
	}

	if userID != buyerID && userID != sellerID {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Not involved in this trade"})
	}
	otherUserID := sellerID
	if userID == sellerID {
		otherUserID = buyerID
	}

	meetupService := services.NewMeetupService(database.DB)
	_, _, errComplete := meetupService.ConfirmCompletion(tradeID, userID)
	if errComplete != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": errComplete.Error()})
	}
	sendPushToUser(otherUserID, "Meetup completion confirmed", "Your trading partner confirmed the meetup completion step.", tradeDeepLink(tradeID), "trade_update")

	status, _ := meetupService.GetMeetupStatus(tradeID)

	return c.JSON(fiber.Map{
		"success": true,
		"message": "Trade marked as completed",
		"status":  status,
	})
}

// ReportNoShow reports that the other party didn't show up
// POST /api/trades/:tradeID/meetup/report-no-show
func (h *MeetupHandler) ReportNoShow(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Unauthorized"})
	}

	tradeID, err := c.ParamsInt("tradeID")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid trade ID"})
	}

	var req struct {
		Reason string `json:"reason"`
	}

	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
	}

	// Verify user is part of trade
	var buyerID, sellerID int
	err = database.DB.QueryRow("SELECT buyer_id, seller_id FROM trades WHERE id = ?", tradeID).Scan(&buyerID, &sellerID)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Trade not found"})
	}

	if userID != buyerID && userID != sellerID {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Not involved in this trade"})
	}

	meetupService := services.NewMeetupService(database.DB)
	_, errNoShow := meetupService.ReportNoShow(tradeID, userID, req.Reason)
	if errNoShow != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": errNoShow.Error()})
	}

	status, _ := meetupService.GetMeetupStatus(tradeID)

	return c.JSON(fiber.Map{
		"success": true,
		"message": "No-show reported",
		"status":  status,
	})
}

// GetMeetupStatus retrieves the current meetup status
// GET /api/trades/:tradeID/meetup/status
func (h *MeetupHandler) GetMeetupStatus(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Unauthorized"})
	}

	tradeID, err := c.ParamsInt("tradeID")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid trade ID"})
	}

	// Verify user is part of trade
	var buyerID, sellerID int
	err = database.DB.QueryRow("SELECT buyer_id, seller_id FROM trades WHERE id = ?", tradeID).Scan(&buyerID, &sellerID)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Trade not found"})
	}

	if userID != buyerID && userID != sellerID {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Not involved in this trade"})
	}

	meetupService := services.NewMeetupService(database.DB)
	status, err := meetupService.GetMeetupStatus(tradeID)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": err.Error()})
	}

	var messages []map[string]interface{}

	return c.JSON(fiber.Map{
		"success":  true,
		"status":   status,
		"messages": messages,
	})
}

// GetSystemMessages retrieves system messages for a trade
// GET /api/trades/:tradeID/meetup/messages
func (h *MeetupHandler) GetSystemMessages(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"error": "Unauthorized"})
	}

	tradeID, err := c.ParamsInt("tradeID")
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid trade ID"})
	}

	// Verify user is part of trade
	var buyerID, sellerID int
	err = database.DB.QueryRow("SELECT buyer_id, seller_id FROM trades WHERE id = ?", tradeID).Scan(&buyerID, &sellerID)
	if err != nil {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Trade not found"})
	}

	if userID != buyerID && userID != sellerID {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Not involved in this trade"})
	}

	var messages []map[string]interface{}

	return c.JSON(fiber.Map{
		"success":  true,
		"messages": messages,
	})
}
