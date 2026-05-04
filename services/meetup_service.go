package services

import (
	"database/sql"
	"fmt"
	"log"
	"strings"
	"time"

	"github.com/xashathebest/clovia/models"
)

// MeetupService handles meetup stage transitions and confirmations
type MeetupService struct {
	db *sql.DB
}

// NewMeetupService creates a new meetup service
func NewMeetupService(db *sql.DB) *MeetupService {
	return &MeetupService{db: db}
}

// GetMeetupStatus retrieves the meetup status for a trade
func (s *MeetupService) GetMeetupStatus(tradeID int) (*models.MeetupStatus, error) {
	status := &models.MeetupStatus{}
	err := s.db.QueryRow(`
		SELECT id, trade_id, stage, buyer_proposed_time, buyer_proposed_location,
		       seller_proposed_time, seller_proposed_location, agreed_time, agreed_location,
		       reminder_sent, reminder_sent_at, buyer_heading_out, seller_heading_out,
		       buyer_arrived, seller_arrived, buyer_arrived_at, seller_arrived_at,
		       completed_at, no_show_reported_by, no_show_reported_at, no_show_reason,
		       created_at, updated_at
		FROM meetup_status WHERE trade_id = ?
	`, tradeID).Scan(
		&status.ID, &status.TradeID, &status.Stage,
		&status.BuyerProposedTime, &status.BuyerProposedLocation,
		&status.SellerProposedTime, &status.SellerProposedLocation,
		&status.AgreedTime, &status.AgreedLocation,
		&status.ReminderSent, &status.ReminderSentAt,
		&status.BuyerHeadingOut, &status.SellerHeadingOut,
		&status.BuyerArrived, &status.SellerArrived,
		&status.BuyerArrivedAt, &status.SellerArrivedAt,
		&status.CompletedAt, &status.NoShowReportedBy, &status.NoShowReportedAt,
		&status.NoShowReason, &status.CreatedAt, &status.UpdatedAt,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			// Create new meetup status
			return s.createMeetupStatus(tradeID)
		}
		return nil, err
	}
	return status, nil
}

func meetupStorageLocation() *time.Location {
	location, err := time.LoadLocation("Asia/Manila")
	if err != nil {
		location = time.Local
	}
	return location
}

func parseStoredMeetupTime(raw string) (time.Time, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return time.Time{}, false
	}
	location := meetupStorageLocation()
	for _, layout := range []string{time.RFC3339, "2006-01-02T15:04:05", "2006-01-02T15:04", "2006-01-02 15:04:05", "2006-01-02 15:04"} {
		var t time.Time
		var parseErr error
		if layout == time.RFC3339 {
			t, parseErr = time.Parse(layout, raw)
		} else {
			t, parseErr = time.ParseInLocation(layout, raw, location)
		}
		if parseErr == nil {
			return t, true
		}
	}
	return time.Time{}, false
}

// createMeetupStatus creates a new meetup status record
func (s *MeetupService) createMeetupStatus(tradeID int) (*models.MeetupStatus, error) {
	var buyerTimeRaw, buyerLocation, sellerTimeRaw, sellerLocation string
	_ = s.db.QueryRow(`
		SELECT COALESCE(buyer_meetup_time, ''), COALESCE(buyer_meetup_location, ''),
		       COALESCE(seller_meetup_time, ''), COALESCE(seller_meetup_location, '')
		FROM trades WHERE id = ?
	`, tradeID).Scan(&buyerTimeRaw, &buyerLocation, &sellerTimeRaw, &sellerLocation)

	var buyerTime, sellerTime interface{}
	if t, ok := parseStoredMeetupTime(buyerTimeRaw); ok {
		buyerTime = t
	}
	if t, ok := parseStoredMeetupTime(sellerTimeRaw); ok {
		sellerTime = t
	}

	_, err := s.db.Exec(`
		INSERT INTO meetup_status (
			trade_id, stage,
			buyer_proposed_time, buyer_proposed_location,
			seller_proposed_time, seller_proposed_location,
			created_at, updated_at
		)
		VALUES (?, 'negotiating', ?, NULLIF(?, ''), ?, NULLIF(?, ''), NOW(), NOW())
	`, tradeID, buyerTime, buyerLocation, sellerTime, sellerLocation)
	if err != nil {
		return nil, err
	}

	return s.GetMeetupStatus(tradeID)
}

// ProposeMeetupDetails allows a user to propose time and location
func (s *MeetupService) ProposeMeetupDetails(tradeID, userID int, proposedTime time.Time, proposedLocation string) (*models.MeetupStatus, *models.SystemMessage, error) {
	// Get trade info
	var buyerID, sellerID int
	err := s.db.QueryRow("SELECT buyer_id, seller_id FROM trades WHERE id = ?", tradeID).Scan(&buyerID, &sellerID)
	if err != nil {
		return nil, nil, err
	}

	// Determine user role (buyer or seller)
	if userID != buyerID && userID != sellerID {
		return nil, nil, fmt.Errorf("user not part of this trade")
	}

	isBuyer := userID == buyerID
	if _, err := s.GetMeetupStatus(tradeID); err != nil {
		return nil, nil, err
	}
	storedTime := proposedTime.In(meetupStorageLocation()).Format("2006-01-02 15:04")

	// Update proposal in meetup_status
	if isBuyer {
		_, err = s.db.Exec(`
			UPDATE meetup_status 
			SET buyer_proposed_time = ?, buyer_proposed_location = ?, updated_at = NOW()
			WHERE trade_id = ?
		`, proposedTime, proposedLocation, tradeID)
		if err == nil {
			_, _ = s.db.Exec(`
				UPDATE trades
				SET buyer_meetup_time = ?, buyer_meetup_location = ?, buyer_meetup_confirmed = TRUE,
				    seller_meetup_confirmed = FALSE,
				    meetup_time = ?, meetup_location = COALESCE(NULLIF(?, ''), meetup_location),
				    updated_at = CURRENT_TIMESTAMP
				WHERE id = ?
			`, storedTime, proposedLocation, storedTime, proposedLocation, tradeID)
		}
	} else {
		_, err = s.db.Exec(`
			UPDATE meetup_status 
			SET seller_proposed_time = ?, seller_proposed_location = ?, updated_at = NOW()
			WHERE trade_id = ?
		`, proposedTime, proposedLocation, tradeID)
		if err == nil {
			_, _ = s.db.Exec(`
				UPDATE trades
				SET seller_meetup_time = ?, seller_meetup_location = ?, seller_meetup_confirmed = TRUE,
				    buyer_meetup_confirmed = FALSE,
				    meetup_time = ?, meetup_location = COALESCE(NULLIF(?, ''), meetup_location),
				    updated_at = CURRENT_TIMESTAMP
				WHERE id = ?
			`, storedTime, proposedLocation, storedTime, proposedLocation, tradeID)
		}
	}

	if err != nil {
		return nil, nil, err
	}

	// Check if both have proposed
	status, err := s.GetMeetupStatus(tradeID)
	if err != nil {
		return nil, nil, err
	}

	var systemMsg *models.SystemMessage
	if status.BuyerProposedTime != nil && status.SellerProposedTime != nil {
		// Both have proposed, check if they match
		if status.BuyerProposedTime.Equal(*status.SellerProposedTime) && status.BuyerProposedLocation == status.SellerProposedLocation {
			// Auto-confirm match
			systemMsg, err = s.confirmMeetupSchedule(tradeID)
			if err != nil {
				log.Printf("Error confirming meetup schedule: %v", err)
			}
		} else {
			// Generate mismatch message
			systemMsg = &models.SystemMessage{
				MessageType: "proposal_mismatch",
				Title:       "📍 Meetup Details Proposed",
				Description: "Both users have proposed meetup details. Review and agree on a time and location.",
				Actions: []models.Action{
					{
						Label:      "💬 Counter Propose",
						ActionType: "propose_time",
						Data: map[string]interface{}{
							"trade_id": tradeID,
						},
					},
				},
			}
			// Save system message
			s.saveSystemMessage(tradeID, systemMsg)
		}
	} else {
		// Only one user has proposed
		userRole := "Trader"
		systemMsg = &models.SystemMessage{
			MessageType: "proposal_received",
			Title:       "📍 " + userRole + " Proposed Meetup Time",
			Description: fmt.Sprintf("%s proposed: %s at %s. Waiting for other user to counter-propose or confirm.", userRole, proposedTime.Format("2006-01-02 15:04"), proposedLocation),
			Actions: []models.Action{
				{
					Label:      "✅ Agree & Confirm",
					ActionType: "confirm_match",
					Data: map[string]interface{}{
						"trade_id": tradeID,
						"time":     proposedTime,
						"location": proposedLocation,
					},
				},
				{
					Label:      "💬 Counter Propose",
					ActionType: "propose_time",
					Data: map[string]interface{}{
						"trade_id": tradeID,
					},
				},
			},
		}
		s.saveSystemMessage(tradeID, systemMsg)
	}

	return status, systemMsg, nil
}

// confirmMeetupSchedule transitions meetup to scheduled stage
func (s *MeetupService) confirmMeetupSchedule(tradeID int) (*models.SystemMessage, error) {
	// Get current proposals
	status, err := s.GetMeetupStatus(tradeID)
	if err != nil {
		return nil, err
	}

	// Update to scheduled stage
	_, err = s.db.Exec(`
		UPDATE meetup_status 
		SET stage = 'scheduled', agreed_time = ?, agreed_location = ?, updated_at = NOW()
		WHERE trade_id = ?
	`, status.BuyerProposedTime, status.BuyerProposedLocation, tradeID)

	if err != nil {
		return nil, err
	}
	agreedTime := ""
	if status.BuyerProposedTime != nil {
		agreedTime = status.BuyerProposedTime.In(meetupStorageLocation()).Format("2006-01-02 15:04")
	}
	_, _ = s.db.Exec(`
		UPDATE trades
		SET meetup_time = ?, meetup_location = ?, buyer_meetup_confirmed = TRUE,
		    seller_meetup_confirmed = TRUE, updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, agreedTime, status.BuyerProposedLocation, tradeID)

	var tradeStatus string
	_ = s.db.QueryRow("SELECT COALESCE(status, '') FROM trades WHERE id = ?", tradeID).Scan(&tradeStatus)
	switch tradeStatus {
	case "pending", "pending_multiway", "countered":
		// Schedule agreement can happen while an offer is still being negotiated.
		// The offer itself stays pending until the normal accept action succeeds.
	default:
		s.db.Exec("UPDATE trades SET status = 'active' WHERE id = ?", tradeID)
	}

	systemMsg := &models.SystemMessage{
		MessageType: "scheduled_confirmation",
		Title:       "✅ Meetup Scheduled!",
		Description: fmt.Sprintf("You've both agreed to meet on %s at %s. See you soon!", status.BuyerProposedTime.Format("Monday, Jan 2 at 3:04 PM"), status.BuyerProposedLocation),
		Actions: []models.Action{
			{
				Label:      "📍 View Location",
				ActionType: "view_location",
				Data: map[string]interface{}{
					"location": status.BuyerProposedLocation,
				},
			},
			{
				Label:      "🔔 Set Reminder",
				ActionType: "set_reminder",
				Data: map[string]interface{}{
					"trade_id": tradeID,
				},
			},
		},
	}

	s.saveSystemMessage(tradeID, systemMsg)

	return systemMsg, nil
}

// MarkHeadingOut updates user status to heading out
func (s *MeetupService) MarkHeadingOut(tradeID, userID int) (*models.SystemMessage, error) {
	// Get trade info
	var buyerID, sellerID int
	err := s.db.QueryRow("SELECT buyer_id, seller_id FROM trades WHERE id = ?", tradeID).Scan(&buyerID, &sellerID)
	if err != nil {
		return nil, err
	}

	isBuyer := userID == buyerID

	if isBuyer {
		_, err = s.db.Exec("UPDATE meetup_status SET buyer_heading_out = TRUE, updated_at = NOW() WHERE trade_id = ?", tradeID)
	} else {
		_, err = s.db.Exec("UPDATE meetup_status SET seller_heading_out = TRUE, updated_at = NOW() WHERE trade_id = ?", tradeID)
	}

	if err != nil {
		return nil, err
	}

	status, _ := s.GetMeetupStatus(tradeID)
	userRole := "Trader"

	var systemMsg *models.SystemMessage
	if status.BuyerHeadingOut && status.SellerHeadingOut {
		// Both are heading out
		systemMsg = &models.SystemMessage{
			MessageType: "both_heading_out",
			Title:       "🚗 Both Users on the Way",
			Description: "Both of you are heading to the meetup location. See you soon!",
			Actions: []models.Action{
				{
					Label:      "📍 View Location",
					ActionType: "view_location",
					Data: map[string]interface{}{
						"location": status.AgreedLocation,
					},
				},
			},
		}
	} else {
		systemMsg = &models.SystemMessage{
			MessageType: "heading_out",
			Title:       "🚗 " + userRole + " is on the Way",
			Description: userRole + " is heading to the meetup location.",
			Actions: []models.Action{
				{
					Label:      "🚗 I'm on the Way Too",
					ActionType: "heading_out",
					Data: map[string]interface{}{
						"trade_id": tradeID,
					},
				},
			},
		}
	}

	s.saveSystemMessage(tradeID, systemMsg)
	return systemMsg, nil
}

// MarkArrived updates user status to arrived
func (s *MeetupService) MarkArrived(tradeID, userID int) (*models.SystemMessage, error) {
	// Get trade info
	var buyerID, sellerID int
	err := s.db.QueryRow("SELECT buyer_id, seller_id FROM trades WHERE id = ?", tradeID).Scan(&buyerID, &sellerID)
	if err != nil {
		return nil, err
	}

	isBuyer := userID == buyerID
	now := time.Now()

	if isBuyer {
		_, err = s.db.Exec("UPDATE meetup_status SET buyer_arrived = TRUE, buyer_arrived_at = ?, updated_at = NOW() WHERE trade_id = ?", now, tradeID)
	} else {
		_, err = s.db.Exec("UPDATE meetup_status SET seller_arrived = TRUE, seller_arrived_at = ?, updated_at = NOW() WHERE trade_id = ?", now, tradeID)
	}

	if err != nil {
		return nil, err
	}

	// Transition to 'arrived' stage if both have arrived
	status, _ := s.GetMeetupStatus(tradeID)
	userRole := "Trader"

	var systemMsg *models.SystemMessage
	if status.BuyerArrived && status.SellerArrived {
		// Both arrived, transition to arrived stage
		_, err = s.db.Exec("UPDATE meetup_status SET stage = 'arrived', updated_at = NOW() WHERE trade_id = ?", tradeID)
		systemMsg = &models.SystemMessage{
			MessageType: "both_arrived",
			Title:       "✨ Let's Exchange!",
			Description: "Both of you are here! Time to exchange items and confirm the transaction.",
			Actions: []models.Action{
				{
					Label:      "✅ Items Exchanged - Complete Trade",
					ActionType: "confirm_completion",
					Data: map[string]interface{}{
						"trade_id": tradeID,
					},
				},
				{
					Label:      "❌ Report Issue",
					ActionType: "report_issue",
					Data: map[string]interface{}{
						"trade_id": tradeID,
					},
				},
			},
		}
	} else {
		systemMsg = &models.SystemMessage{
			MessageType: "user_arrived",
			Title:       "✅ " + userRole + " Has Arrived",
			Description: userRole + " has arrived at the meetup location. Waiting for the other user.",
			Actions: []models.Action{
				{
					Label:      "✅ I've Arrived Too",
					ActionType: "arrived",
					Data: map[string]interface{}{
						"trade_id": tradeID,
					},
				},
			},
		}
	}

	s.saveSystemMessage(tradeID, systemMsg)
	return systemMsg, nil
}

// ConfirmCompletion marks the trade as completed after both users confirm
func (s *MeetupService) ConfirmCompletion(tradeID, userID int) (bool, *models.SystemMessage, error) {
	// Get trade info
	var buyerID, sellerID int
	err := s.db.QueryRow("SELECT buyer_id, seller_id FROM trades WHERE id = ?", tradeID).Scan(&buyerID, &sellerID)
	if err != nil {
		return false, nil, err
	}

	isBuyer := userID == buyerID

	// Mark user as confirmed completed
	if isBuyer {
		_, err = s.db.Exec("UPDATE trades SET buyer_completed = TRUE WHERE id = ?", tradeID)
	} else {
		_, err = s.db.Exec("UPDATE trades SET seller_completed = TRUE WHERE id = ?", tradeID)
	}

	if err != nil {
		return false, nil, err
	}

	// Check if both have confirmed
	var buyerDone, sellerDone bool
	err = s.db.QueryRow("SELECT buyer_completed, seller_completed FROM trades WHERE id = ?", tradeID).Scan(&buyerDone, &sellerDone)
	if err != nil {
		return false, nil, err
	}

	var systemMsg *models.SystemMessage
	if buyerDone && sellerDone {
		// Both confirmed, mark as completed
		now := time.Now()
		_, err = s.db.Exec(`
			UPDATE meetup_status 
			SET stage = 'completed', completed_at = ?, updated_at = NOW()
			WHERE trade_id = ?
		`, now, tradeID)

		_, err = s.db.Exec("UPDATE trades SET status = 'completed', completed_at = ? WHERE id = ?", now, tradeID)

		systemMsg = &models.SystemMessage{
			MessageType: "trade_completed",
			Title:       "🎉 Trade Complete!",
			Description: "Exchange confirmed! You can now rate each other and see ratings reflected on your profiles.",
			Actions: []models.Action{
				{
					Label:      "⭐ Rate User",
					ActionType: "rate_user",
					Data: map[string]interface{}{
						"trade_id": tradeID,
					},
				},
			},
		}
		s.saveSystemMessage(tradeID, systemMsg)
		return true, systemMsg, nil
	}

	userRole := "Trader"

	systemMsg = &models.SystemMessage{
		MessageType: "completion_confirmed_partial",
		Title:       "✅ " + userRole + " Confirmed Completion",
		Description: userRole + " has confirmed the exchange was completed. Waiting for the other user.",
		Actions: []models.Action{
			{
				Label:      "✅ I've Completed the Exchange",
				ActionType: "confirm_completion",
				Data: map[string]interface{}{
					"trade_id": tradeID,
				},
			},
			{
				Label:      "❌ Report Issue",
				ActionType: "report_issue",
				Data: map[string]interface{}{
					"trade_id": tradeID,
				},
			},
		},
	}

	s.saveSystemMessage(tradeID, systemMsg)
	return false, systemMsg, nil
}

// ReportNoShow reports a user for not showing up
func (s *MeetupService) ReportNoShow(tradeID, reporterID int, reason string) (*models.SystemMessage, error) {
	// Update meetup_status
	_, err := s.db.Exec(`
		UPDATE meetup_status 
		SET stage = 'no_show', no_show_reported_by = ?, no_show_reported_at = NOW(), no_show_reason = ?, updated_at = NOW()
		WHERE trade_id = ?
	`, reporterID, reason, tradeID)

	if err != nil {
		return nil, err
	}

	// Update trade status
	_, err = s.db.Exec("UPDATE trades SET status = 'cancelled' WHERE id = ?", tradeID)

	systemMsg := &models.SystemMessage{
		MessageType: "no_show_reported",
		Title:       "⚠️ No-Show Reported",
		Description: fmt.Sprintf("A user has reported that the other party did not appear. Reason: %s", reason),
		Actions: []models.Action{
			{
				Label:      "📞 Contact Support",
				ActionType: "contact_support",
				Data: map[string]interface{}{
					"trade_id": tradeID,
				},
			},
		},
	}

	s.saveSystemMessage(tradeID, systemMsg)
	return systemMsg, nil
}

// SendPreMeetupReminder sends a reminder before scheduled meetup time
func (s *MeetupService) SendPreMeetupReminder(tradeID int) (*models.SystemMessage, error) {
	status, err := s.GetMeetupStatus(tradeID)
	if err != nil {
		return nil, err
	}

	if status.Stage != "scheduled" {
		return nil, fmt.Errorf("reminder can only be sent for scheduled meetups")
	}

	// Update reminder_sent
	_, err = s.db.Exec("UPDATE meetup_status SET reminder_sent = TRUE, reminder_sent_at = NOW() WHERE trade_id = ?", tradeID)
	if err != nil {
		return nil, err
	}

	systemMsg := &models.SystemMessage{
		MessageType: "pre_meetup_reminder",
		Title:       "🔔 Meetup Reminder",
		Description: fmt.Sprintf("Your meetup is scheduled for %s at %s. Please confirm you're ready to head out.", status.AgreedTime.Format("Monday, Jan 2 at 3:04 PM"), status.AgreedLocation),
		Actions: []models.Action{
			{
				Label:      "🚗 I'm on the Way",
				ActionType: "heading_out",
				Data: map[string]interface{}{
					"trade_id": tradeID,
				},
			},
			{
				Label:      "⏰ Reschedule",
				ActionType: "propose_time",
				Data: map[string]interface{}{
					"trade_id": tradeID,
				},
			},
		},
	}

	s.saveSystemMessage(tradeID, systemMsg)
	return systemMsg, nil
}

// saveSystemMessage saves a system message to the database
func (s *MeetupService) saveSystemMessage(tradeID int, msg *models.SystemMessage) error {
	_, err := s.db.Exec(`
		INSERT INTO meetup_system_messages (trade_id, message_type, title, description, actions, created_at)
		VALUES (?, ?, ?, ?, JSON_ARRAY(), NOW())
	`, tradeID, msg.MessageType, msg.Title, msg.Description)

	return err
}
