package services

import (
	"context"
	"database/sql"
	"log"
	"time"
)

// StartCleanupScheduler runs safe background cleanup jobs every hour.
// Each job is idempotent: re-running it never deletes active/valid records.
func StartCleanupScheduler(db *sql.DB) {
	StartCleanupSchedulerContext(context.Background(), db)
}

func StartCleanupSchedulerContext(ctx context.Context, db *sql.DB) {
	if db == nil {
		log.Println("[Cleanup] Scheduler not started: nil database")
		return
	}
	go func() {
		// First pass 2 minutes after startup so the heavy boot work settles first.
		select {
		case <-ctx.Done():
			return
		case <-time.After(2 * time.Minute):
		}
		runCleanupPass(db)

		ticker := time.NewTicker(1 * time.Hour)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				runCleanupPass(db)
			}
		}
	}()
}

func runCleanupPass(db *sql.DB) {
	log.Println("[Cleanup] Starting hourly cleanup pass")

	jobs := []struct {
		name string
		fn   func(*sql.DB)
	}{
		{"password_reset_tokens", cleanExpiredPasswordResetTokens},
		{"phone_verifications", cleanExpiredOTPCodes},
		{"old_notifications", cleanOldReadNotifications},
		{"push_subscriptions", cleanStalePushSubscriptions},
		{"orphaned_trade_items", cleanOrphanedTradeItems},
		{"orphaned_product_images", cleanOrphanedProductImages},
	}
	for _, job := range jobs {
		runCleanupJob(db, job.name, job.fn)
	}

	log.Println("[Cleanup] Hourly cleanup pass complete")
}

func runCleanupJob(db *sql.DB, name string, fn func(*sql.DB)) {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("[Cleanup] %s panic: %v", name, r)
		}
	}()
	fn(db)
}

// cleanExpiredPasswordResetTokens removes password-reset tokens older than 1 hour.
// Tokens are single-use and short-lived; keeping them provides no value.
func cleanExpiredPasswordResetTokens(db *sql.DB) {
	var tbl int
	if err := db.QueryRow(
		"SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='password_reset_tokens'",
	).Scan(&tbl); err != nil || tbl == 0 {
		return
	}

	res, err := db.Exec(
		"DELETE FROM password_reset_tokens WHERE expires_at IS NOT NULL AND expires_at < NOW()",
	)
	if err != nil {
		log.Printf("[Cleanup] password_reset_tokens: %v", err)
		return
	}
	if n, _ := res.RowsAffected(); n > 0 {
		log.Printf("[Cleanup] Deleted %d expired password-reset token(s)", n)
	}
}

// cleanExpiredOTPCodes removes phone-verification OTP rows older than 15 minutes.
func cleanExpiredOTPCodes(db *sql.DB) {
	var tbl int
	if err := db.QueryRow(
		"SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='phone_verifications'",
	).Scan(&tbl); err != nil || tbl == 0 {
		return
	}

	res, err := db.Exec(
		"DELETE FROM phone_verifications WHERE expires_at IS NOT NULL AND expires_at < NOW()",
	)
	if err != nil {
		log.Printf("[Cleanup] phone_verifications: %v", err)
		return
	}
	if n, _ := res.RowsAffected(); n > 0 {
		log.Printf("[Cleanup] Deleted %d expired OTP code(s)", n)
	}
}

// cleanOldReadNotifications deletes notifications that have already been read
// and are older than 30 days, keeping the table lean.
func cleanOldReadNotifications(db *sql.DB) {
	var col int
	if err := db.QueryRow(
		"SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='notifications' AND COLUMN_NAME='is_read'",
	).Scan(&col); err != nil || col == 0 {
		return
	}

	res, err := db.Exec(`
		DELETE FROM notifications
		WHERE is_read = TRUE
		  AND created_at < DATE_SUB(NOW(), INTERVAL 30 DAY)
	`)
	if err != nil {
		log.Printf("[Cleanup] old notifications: %v", err)
		return
	}
	if n, _ := res.RowsAffected(); n > 0 {
		log.Printf("[Cleanup] Deleted %d old read notification(s)", n)
	}
}

// cleanStalePushSubscriptions removes push-subscription rows that haven't been
// updated in 90 days. Active browsers re-subscribe automatically via the PWA;
// a 90-day gap means the subscription is no longer in use.
func cleanStalePushSubscriptions(db *sql.DB) {
	var tbl int
	if err := db.QueryRow(
		"SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='push_subscriptions'",
	).Scan(&tbl); err != nil || tbl == 0 {
		return
	}

	res, err := db.Exec(
		"DELETE FROM push_subscriptions WHERE updated_at < DATE_SUB(NOW(), INTERVAL 90 DAY)",
	)
	if err != nil {
		log.Printf("[Cleanup] push_subscriptions: %v", err)
		return
	}
	if n, _ := res.RowsAffected(); n > 0 {
		log.Printf("[Cleanup] Deleted %d stale push subscription(s)", n)
	}
}

// cleanOrphanedTradeItems removes trade_items rows whose parent trade no longer
// exists. These can accumulate if trades are hard-deleted by admin.
func cleanOrphanedTradeItems(db *sql.DB) {
	var tbl int
	if err := db.QueryRow(
		"SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='trade_items'",
	).Scan(&tbl); err != nil || tbl == 0 {
		return
	}

	res, err := db.Exec(`
		DELETE ti FROM trade_items ti
		LEFT JOIN trades t ON t.id = ti.trade_id
		WHERE t.id IS NULL
	`)
	if err != nil {
		log.Printf("[Cleanup] orphaned trade_items: %v", err)
		return
	}
	if n, _ := res.RowsAffected(); n > 0 {
		log.Printf("[Cleanup] Deleted %d orphaned trade_item(s)", n)
	}
}

// cleanOrphanedProductImages removes product_images rows that point to a
// product_id that no longer exists. This happens when product creation fails
// after images were already saved.
func cleanOrphanedProductImages(db *sql.DB) {
	var tbl int
	if err := db.QueryRow(
		"SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='product_images'",
	).Scan(&tbl); err != nil || tbl == 0 {
		return
	}

	res, err := db.Exec(`
		DELETE pi FROM product_images pi
		LEFT JOIN products p ON p.id = pi.product_id
		WHERE p.id IS NULL
	`)
	if err != nil {
		log.Printf("[Cleanup] orphaned product_images: %v", err)
		return
	}
	if n, _ := res.RowsAffected(); n > 0 {
		log.Printf("[Cleanup] Deleted %d orphaned product_image(s)", n)
	}
}
