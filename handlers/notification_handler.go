package handlers

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"regexp"
	"strings"
	"sync"

	"github.com/gofiber/fiber/v2"
	"github.com/xashathebest/clovia/database"
	"github.com/xashathebest/clovia/middleware"
	"github.com/xashathebest/clovia/models"
)

type NotificationHandler struct{ db *sql.DB }

func NewNotificationHandler() *NotificationHandler { return &NotificationHandler{db: database.DB} }

var ensureNotificationColumnsOnce sync.Once
var quotedNotificationTitleRE = regexp.MustCompile(`"([^"]+)"`)

func (h *NotificationHandler) ensureNotificationColumns() {
	ensureNotificationColumnsOnce.Do(func() {
		database.EnsureNotificationColumns(h.db)
	})
}

// GetNotifications lists notifications for the authenticated user
func (h *NotificationHandler) GetNotifications(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return fiber.ErrUnauthorized
	}
	h.ensureNotificationColumns()

	category := c.Query("type", "")
	where := "WHERE user_id = ?"
	args := []interface{}{userID}
	if category != "" {
		where += " AND type = ?"
		args = append(args, category)
	}
	rows, err := h.db.Query("SELECT id, user_id, type, message, is_read, created_at, target_type, target_id, target_url, metadata FROM notifications "+where+" ORDER BY created_at DESC", args...)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to fetch notifications"})
	}
	defer rows.Close()
	var list []map[string]interface{}
	for rows.Next() {
		var id, uid int
		var typ, msg string
		var read bool
		var createdAt string
		var targetType, targetURL, metadata sql.NullString
		var targetID sql.NullInt64
		if err := rows.Scan(&id, &uid, &typ, &msg, &read, &createdAt, &targetType, &targetID, &targetURL, &metadata); err == nil {
			data := h.buildNotificationData(typ, msg, targetType, targetID, targetURL, metadata)
			list = append(list, map[string]interface{}{
				"id":         id,
				"user_id":    uid,
				"type":       typ,
				"message":    msg,
				"read":       read,
				"created_at": createdAt,
				"data":       data,
			})
		} else {
			log.Printf("Failed to scan notification row: %v", err)
		}
	}
	return c.JSON(models.APIResponse{Success: true, Data: list})
}

func (h *NotificationHandler) buildNotificationData(typ, msg string, targetType sql.NullString, targetID sql.NullInt64, targetURL sql.NullString, metadata sql.NullString) map[string]interface{} {
	data := map[string]interface{}{}
	if metadata.Valid && strings.TrimSpace(metadata.String) != "" {
		var parsed map[string]interface{}
		if err := json.Unmarshal([]byte(metadata.String), &parsed); err == nil {
			for key, value := range parsed {
				data[key] = value
			}
		}
	}

	if targetType.Valid && strings.TrimSpace(targetType.String) != "" {
		data["target_type"] = targetType.String
	}
	if targetID.Valid && targetID.Int64 > 0 {
		data["target_id"] = int(targetID.Int64)
		if _, ok := data["product_id"]; !ok && targetType.Valid && targetType.String == "product" {
			data["product_id"] = int(targetID.Int64)
		}
	}
	if targetURL.Valid && strings.TrimSpace(targetURL.String) != "" {
		data["target_url"] = targetURL.String
	}

	if _, hasURL := data["target_url"]; !hasURL {
		for key, value := range h.inferNotificationTarget(typ, msg) {
			if _, exists := data[key]; !exists {
				data[key] = value
			}
		}
	}

	return data
}

func (h *NotificationHandler) inferNotificationTarget(typ, msg string) map[string]interface{} {
	if typ != "similar_item" && typ != "popular_item" {
		return nil
	}

	matches := quotedNotificationTitleRE.FindStringSubmatch(msg)
	if len(matches) < 2 {
		return nil
	}
	title := strings.TrimSpace(matches[1])
	if title == "" {
		return nil
	}

	var productID int
	var slug, productTitle string
	err := h.db.QueryRow(`
		SELECT id, COALESCE(slug, ''), title
		FROM products
		WHERE title = ?
		  AND COALESCE(status, 'available') != 'deleted'
		ORDER BY created_at DESC
		LIMIT 1
	`, title).Scan(&productID, &slug, &productTitle)
	if err != nil {
		return nil
	}

	targetURL := fmt.Sprintf("/products/%d", productID)
	if strings.TrimSpace(slug) != "" {
		targetURL = "/products/" + slug
	}

	return map[string]interface{}{
		"target_type":   "product",
		"target_id":     productID,
		"target_url":    targetURL,
		"product_id":    productID,
		"product_slug":  slug,
		"product_title": productTitle,
	}
}

// MarkAsRead marks a single notification as read
func (h *NotificationHandler) MarkAsRead(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return fiber.ErrUnauthorized
	}
	id := c.Params("id")
	res, err := h.db.Exec("UPDATE notifications SET is_read = TRUE WHERE id = ? AND user_id = ?", id, userID)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to update notification"})
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return fiber.ErrNotFound
	}
	return c.JSON(models.APIResponse{Success: true})
}

// MarkAllAsRead marks all notifications as read for the user
func (h *NotificationHandler) MarkAllAsRead(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return fiber.ErrUnauthorized
	}
	if _, err := h.db.Exec("UPDATE notifications SET is_read = TRUE WHERE user_id = ?", userID); err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to update notifications"})
	}
	return c.JSON(models.APIResponse{Success: true})
}

// GetDashboardCounts returns unread notification count and pending offer count
func (h *NotificationHandler) GetDashboardCounts(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return fiber.ErrUnauthorized
	}

	var unread int
	if err := h.db.QueryRow("SELECT COUNT(*) FROM notifications WHERE user_id = ? AND is_read = FALSE", userID).Scan(&unread); err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to fetch notification counts"})
	}

	// Pending offers are incoming trades awaiting this seller's action.
	var pendingOffers int
	if err := h.db.QueryRow(`
		SELECT COUNT(*)
		FROM trades
		WHERE seller_id = ?
		  AND (
			status IN ('pending', 'pending_multiway')
			OR (status = 'accepted_by_one' AND COALESCE(seller_accepted, FALSE) = FALSE)
		  )
	`, userID).Scan(&pendingOffers); err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to fetch pending offers count"})
	}

	return c.JSON(models.APIResponse{
		Success: true,
		Data: fiber.Map{
			"unread_notifications": unread,
			"pending_offers":       pendingOffers,
		},
	})
}
