package handlers

import (
	"strings"

	"github.com/xashathebest/clovia/database"
	"github.com/xashathebest/clovia/services"
)

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
