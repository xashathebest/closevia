package handlers

import (
	"database/sql"
	"fmt"
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

	buyerID, sellerID, err := validateTradeParticipant(database.DB, tradeID, userID)
	if err != nil {
		if err.Error() == "trade not found" {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Trade not found"})
		}
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

	if _, _, err := validateTradeParticipant(database.DB, tradeID, userID); err != nil {
		if err.Error() == "trade not found" {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Trade not found"})
		}
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

// MarkArrived marks user as arrived at meetup location.
// Enforces the same GPS, 1-hour window, and schedule-agreement checks as confirm_meetup_done.
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

	var req struct {
		UserLat          *float64 `json:"user_lat"`
		UserLng          *float64 `json:"user_lng"`
		LocationAccuracy *float64 `json:"location_accuracy_m"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Invalid request body"})
	}

	buyerID, sellerID, err := validateTradeParticipant(database.DB, tradeID, userID)
	if err != nil {
		if err.Error() == "trade not found" {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Trade not found"})
		}
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Not involved in this trade"})
	}
	_ = buyerID
	_ = sellerID

	// Load trade schedule and agreed coordinates.
	var buyerConfirmed, sellerConfirmed bool
	var meetupTimeStr string
	var meetupLat, meetupLng sql.NullFloat64
	var agreedDeadline sql.NullTime
	err = database.DB.QueryRow(`
		SELECT COALESCE(buyer_meetup_confirmed, FALSE),
		       COALESCE(seller_meetup_confirmed, FALSE),
		       COALESCE(meetup_time, ''),
		       meetup_lat, meetup_lng,
		       agreed_arrival_deadline
		FROM trades WHERE id = ?`, tradeID).Scan(
		&buyerConfirmed, &sellerConfirmed,
		&meetupTimeStr,
		&meetupLat, &meetupLng,
		&agreedDeadline,
	)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to load trade details"})
	}

	// Both parties must have confirmed the meetup schedule.
	if !buyerConfirmed || !sellerConfirmed {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Both parties must confirm the meetup schedule before marking arrival"})
	}

	// Resolve arrival deadline.
	if !agreedDeadline.Valid {
		deadline, ok := parseTradeArrivalDeadline(meetupTimeStr)
		if !ok {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "No valid meetup schedule found. Please re-confirm your meetup time."})
		}
		agreedDeadline = sql.NullTime{Time: deadline, Valid: true}
	}

	// 1-hour arrival window check.
	now := time.Now()
	if err := validateArrivalConfirmationWindow(now, agreedDeadline.Time); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}
	if err := validateScheduledTradeNotExpired(now, agreedDeadline.Time); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": err.Error()})
	}

	// GPS radius check.
	if !meetupLat.Valid || !meetupLng.Valid {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Meetup coordinates are not set. Please re-confirm your meetup location."})
	}
	if err := validateArrivalLocation(req.UserLat, req.UserLng, req.LocationAccuracy, meetupLat.Float64, meetupLng.Float64, meetupConfirmRadiusMeters, "meetup point"); err != nil {
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": err.Error()})
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

// ConfirmCompletion confirms that the trade exchange was completed.
// Requires prior GPS arrival confirmation (buyer_met / seller_met).
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

	buyerID, sellerID, err := validateTradeParticipant(database.DB, tradeID, userID)
	if err != nil {
		if err.Error() == "trade not found" {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Trade not found"})
		}
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Not involved in this trade"})
	}
	otherUserID := sellerID
	if userID == sellerID {
		otherUserID = buyerID
	}

	// Require GPS arrival confirmation before allowing completion.
	if err := validateArrivalConfirmed(database.DB, tradeID, userID); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "GPS arrival must be confirmed before completing the meetup"})
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

// ReportNoShow reports that the other party didn't show up.
// Validates schedule timing, identifies the absent party, and records a structured trust strike.
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

	buyerID, sellerID, err := validateTradeParticipant(database.DB, tradeID, userID)
	if err != nil {
		if err.Error() == "trade not found" {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Trade not found"})
		}
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Not involved in this trade"})
	}

	// Identify the absent party (the other participant).
	absentPartyID := sellerID
	if userID == sellerID {
		absentPartyID = buyerID
	}

	// Load trade timing and arrival state.
	var meetupTimeStr string
	var agreedDeadline sql.NullTime
	var absentMet bool
	var absentMetCol string
	if userID == buyerID {
		absentMetCol = "COALESCE(seller_met, FALSE)"
	} else {
		absentMetCol = "COALESCE(buyer_met, FALSE)"
	}
	queryStr := fmt.Sprintf(
		"SELECT COALESCE(meetup_time,''), agreed_arrival_deadline, %s FROM trades WHERE id = ?",
		absentMetCol,
	)
	err = database.DB.QueryRow(queryStr, tradeID).Scan(&meetupTimeStr, &agreedDeadline, &absentMet)
	if err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": "Failed to load trade details"})
	}

	// Resolve the agreed deadline.
	if !agreedDeadline.Valid {
		deadline, ok := parseTradeArrivalDeadline(meetupTimeStr)
		if !ok {
			return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "No agreed meetup schedule found. Cannot report no-show."})
		}
		agreedDeadline = sql.NullTime{Time: deadline, Valid: true}
	}

	// Cannot report before the scheduled time.
	now := time.Now()
	if now.Before(agreedDeadline.Time) {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "Cannot report no-show before the scheduled meetup time"})
	}

	// If the absent party already confirmed arrival, they did show up.
	if absentMet {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{"error": "The other party has already confirmed their arrival"})
	}

	meetupService := services.NewMeetupService(database.DB)
	_, errNoShow := meetupService.ReportNoShow(tradeID, userID, req.Reason)
	if errNoShow != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{"error": errNoShow.Error()})
	}

	// Record a structured trust strike against the absent party.
	_ = services.RecordTrustStrike(database.DB, services.TrustStrikeInput{
		UserID:    absentPartyID,
		Type:      "no_show",
		Severity:  "major",
		TradeType: "normal",
		TradeID:   &tradeID,
		Reason:    fmt.Sprintf("No-show for trade #%d", tradeID),
	})

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

	if _, _, err := validateTradeParticipant(database.DB, tradeID, userID); err != nil {
		if err.Error() == "trade not found" {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Trade not found"})
		}
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

	if _, _, err := validateTradeParticipant(database.DB, tradeID, userID); err != nil {
		if err.Error() == "trade not found" {
			return c.Status(fiber.StatusNotFound).JSON(fiber.Map{"error": "Trade not found"})
		}
		return c.Status(fiber.StatusForbidden).JSON(fiber.Map{"error": "Not involved in this trade"})
	}

	var messages []map[string]interface{}

	return c.JSON(fiber.Map{
		"success":  true,
		"messages": messages,
	})
}
