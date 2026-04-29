package handlers

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"

	"github.com/xashathebest/clovia/database"
	"github.com/xashathebest/clovia/services"
)

func tradeDeepLink(tradeID int) string {
	if tradeID <= 0 {
		return "/dashboard?tab=ongoing"
	}
	return fmt.Sprintf("/dashboard?tab=ongoing&trade_id=%d", tradeID)
}

func offerDeepLink(tradeID int) string {
	if tradeID <= 0 {
		return "/offers"
	}
	return fmt.Sprintf("/offers?trade_id=%d", tradeID)
}

func notificationDeepLink(notificationType string, tradeID int) string {
	switch strings.TrimSpace(notificationType) {
	case "trade_offer", "offer_received":
		return offerDeepLink(tradeID)
	default:
		return tradeDeepLink(tradeID)
	}
}

func insertTradeNotification(db *sql.DB, userID int, notificationType, message string, tradeID int) {
	if db == nil || userID <= 0 {
		return
	}
	if notificationType == "" {
		notificationType = "trade_update"
	}
	metadata, _ := json.Marshal(map[string]interface{}{"trade_id": tradeID})
	if tradeID > 0 {
		if _, err := db.Exec(
			"INSERT INTO notifications (user_id, type, message, is_read, target_type, target_id, target_url, metadata) VALUES (?, ?, ?, FALSE, 'trade', ?, ?, ?)",
			userID,
			notificationType,
			message,
			tradeID,
			notificationDeepLink(notificationType, tradeID),
			string(metadata),
		); err == nil {
			return
		}
	}
	_, _ = db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, ?, ?, FALSE)", userID, notificationType, message)
}

func sendPushToUser(userID int, title, body, url, notificationType string) {
	if userID <= 0 {
		return
	}
	title = strings.TrimSpace(title)
	body = strings.TrimSpace(body)
	if title == "" {
		title = "CloviaPH"
	}
	if body == "" {
		body = title
	}
	go services.NewPushService(database.DB).SendToUser(userID, title, body, url, notificationType)
}
