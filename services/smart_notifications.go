package services

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"time"

	"github.com/xashathebest/clovia/database"
)

// SmartNotificationTrigger runs after a product is successfully created.
// It checks if any of the users who have products listed have wishlisted the
// new product's category, and fires a notification: "A new item similar to
// what you want was just posted!"
// It also checks if the newly-created product's seller has any existing
// listings that have accumulated 10+ wishlist saves since yesterday, and
// fires a popularity notification to that seller.
type SmartNotificationService struct {
	db *sql.DB
}

func NewSmartNotificationService(db *sql.DB) *SmartNotificationService {
	return &SmartNotificationService{db: db}
}

// NotifyNewSimilarItem notifies users who have products in a category that
// wants the new item's category — i.e., they may be interested in trading.
func (s *SmartNotificationService) NotifyNewSimilarItem(productID int, sellerID int, productTitle, category string) {
	if category == "" {
		return
	}
	database.EnsureNotificationColumns(s.db)

	// Find users who have wishlisted products (or whose wanted_categories contain the new category),
	// excluding the seller themselves.
	rows, err := s.db.Query(`
		SELECT DISTINCT u.id, u.name
		FROM users u
		JOIN products p ON p.seller_id = u.id
		WHERE u.id != ?
		  AND p.status = 'available'
		  AND p.wanted_categories LIKE ?
		LIMIT 50
	`, sellerID, "%"+category+"%")
	if err != nil {
		log.Printf("[SmartNotif] query error finding similar-item recipients: %v", err)
		return
	}
	defer rows.Close()

	msg := fmt.Sprintf("💡 \"%s\" matches what you want! A new item just posted in this category.", productTitle)
	for rows.Next() {
		var uid int
		var name string
		if err := rows.Scan(&uid, &name); err != nil {
			continue
		}
		// Avoid duplicate notifications within 24h for this same product.
		var existingCount int
		s.db.QueryRow(`
			SELECT COUNT(*) FROM notifications
			WHERE user_id = ? AND type = 'similar_item' AND target_id = ? AND created_at > ?
		`, uid, productID, time.Now().Add(-24*time.Hour)).Scan(&existingCount)

		if existingCount == 0 {
			targetURL := fmt.Sprintf("/products/%d", productID)
			metadata, _ := json.Marshal(map[string]interface{}{
				"product_id":    productID,
				"product_title": productTitle,
				"category":      category,
			})
			_, err := s.db.Exec(
				`INSERT INTO notifications (user_id, type, message, is_read, target_type, target_id, target_url, metadata, created_at)
				 VALUES (?, 'similar_item', ?, FALSE, 'product', ?, ?, ?, NOW())`,
				uid, msg, productID, targetURL, string(metadata),
			)
			if err != nil {
				log.Printf("[SmartNotif] failed to insert similar_item notification for user %d: %v", uid, err)
				_, _ = s.db.Exec(
					`INSERT INTO notifications (user_id, type, message, is_read, created_at)
					 VALUES (?, 'similar_item', ?, FALSE, NOW())`,
					uid, msg,
				)
			}
		}
	}
}

// NotifyPopularListings checks the product owner's listings for sudden spikes in saves
// (wishlists increases of 5+ in the last 24h) and sends them a notification.
func (s *SmartNotificationService) NotifyPopularListings(sellerID int) {
	database.EnsureNotificationColumns(s.db)

	rows, err := s.db.Query(`
		SELECT p.id, p.title, COUNT(w.id) as save_count
		FROM products p
		JOIN wishlists w ON w.product_id = p.id
		WHERE p.seller_id = ?
		  AND p.status = 'available'
		  AND w.created_at > DATE_SUB(NOW(), INTERVAL 1 DAY)
		GROUP BY p.id, p.title
		HAVING save_count >= 3
		LIMIT 5
	`, sellerID)
	if err != nil {
		return
	}
	defer rows.Close()

	for rows.Next() {
		var pid int
		var title string
		var count int
		if err := rows.Scan(&pid, &title, &count); err != nil {
			continue
		}
		msg := fmt.Sprintf("Your item \"%s\" is popular today (+%d saves)! 🔥", title, count)
		// Avoid spam: don't re-notify within 24h for the same product
		var existing int
		s.db.QueryRow(
			`SELECT COUNT(*) FROM notifications WHERE user_id = ? AND type = 'popular_item' AND target_id = ? AND created_at > ?`,
			sellerID, pid, time.Now().Add(-24*time.Hour),
		).Scan(&existing)

		if existing == 0 {
			targetURL := fmt.Sprintf("/products/%d", pid)
			metadata, _ := json.Marshal(map[string]interface{}{
				"product_id":    pid,
				"product_title": title,
				"save_count":    count,
			})
			if _, err := s.db.Exec(
				`INSERT INTO notifications (user_id, type, message, is_read, target_type, target_id, target_url, metadata, created_at)
				 VALUES (?, 'popular_item', ?, FALSE, 'product', ?, ?, ?, NOW())`,
				sellerID, msg, pid, targetURL, string(metadata),
			); err != nil {
				_, _ = s.db.Exec(
					`INSERT INTO notifications (user_id, type, message, is_read, created_at)
					 VALUES (?, 'popular_item', ?, FALSE, NOW())`,
					sellerID, msg,
				)
			}
		}
	}
}

// TriggerSmartNotifications is the entry point called after a product is created.
// Runs in a goroutine to not block the response.
func TriggerSmartNotifications(db *sql.DB, productID int, sellerID int, productTitle, category string) {
	svc := NewSmartNotificationService(db)
	go func() {
		svc.NotifyNewSimilarItem(productID, sellerID, productTitle, category)
		svc.NotifyPopularListings(sellerID)
	}()
}
