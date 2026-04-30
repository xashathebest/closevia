package services

import (
	"database/sql"
	"fmt"
	"log"
	"strings"
)

type TrustStrikeInput struct {
	UserID    int
	Type      string
	Severity  string
	TradeType string
	TradeID   *int
	TradeRef  string
	Points    int
	Reason    string
}

func PointsForTrustStrike(strikeType, severity string) int {
	switch strings.ToLower(strings.TrimSpace(strikeType)) {
	case "no_show":
		return 10
	case "late_arrival":
		switch strings.ToLower(strings.TrimSpace(severity)) {
		case "minor":
			return 1
		case "small":
			return 2
		case "moderate":
			return 4
		case "major":
			return 6
		}
	case "cancelled_trade":
		switch strings.ToLower(strings.TrimSpace(severity)) {
		case "minor":
			return 2
		case "small":
			return 4
		case "moderate":
			return 6
		case "major":
			return 8
		}
	}
	return 0
}

func RecordTrustStrike(db *sql.DB, input TrustStrikeInput) error {
	if db == nil {
		return fmt.Errorf("database is not available")
	}
	if input.UserID <= 0 {
		return fmt.Errorf("invalid user id")
	}
	input.Type = strings.TrimSpace(input.Type)
	input.Severity = strings.TrimSpace(input.Severity)
	input.TradeType = strings.TrimSpace(input.TradeType)
	input.TradeRef = strings.TrimSpace(input.TradeRef)
	input.Reason = strings.TrimSpace(input.Reason)
	if input.Type == "" {
		return fmt.Errorf("strike type is required")
	}
	if input.Severity == "" {
		return fmt.Errorf("strike severity is required")
	}
	if input.Points <= 0 {
		input.Points = PointsForTrustStrike(input.Type, input.Severity)
	}
	if input.Reason == "" {
		input.Reason = fmt.Sprintf("%s penalty", strings.ReplaceAll(input.Type, "_", " "))
	}
	var tradeID interface{}
	if input.TradeID != nil {
		tradeID = *input.TradeID
	}

	// INSERT IGNORE makes this idempotent: if a unique constraint fires for the same
	// (user_id, strike_type, trade_id), the duplicate is silently discarded.
	_, err := db.Exec(`
		INSERT IGNORE INTO user_strikes
			(user_id, admin_id, dispute_id, reason, strike_type, severity, trade_type, trade_id, trade_ref, points, created_at)
		VALUES (?, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
	`, input.UserID, input.Reason, input.Type, input.Severity, input.TradeType, tradeID, input.TradeRef, input.Points)
	if err != nil {
		log.Printf("RecordTrustStrike: failed to record %s/%s for user %d (%s): %v", input.Type, input.Severity, input.UserID, input.TradeRef, err)
		return err
	}
	return nil
}
