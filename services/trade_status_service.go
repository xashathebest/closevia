package services

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"strings"
	"time"
)

const scheduledTradeExpiryGraceHours = 2
const inactiveTradeArchiveDays = 7

// StartTradeStatusScheduler runs every 10 minutes and handles trade-state
// transitions that are not covered by the existing trade_timeout.go pass:
//   - Expire meetup proposals not answered within 48 h
//   - Cancel trades whose Xendit invoice expired unpaid
//   - Cancel pending offers for a product once another offer is accepted
func StartTradeStatusScheduler(db *sql.DB) {
	StartTradeStatusSchedulerContext(context.Background(), db)
}

func StartTradeStatusSchedulerContext(ctx context.Context, db *sql.DB) {
	if db == nil {
		log.Println("[TradeStatus] Scheduler not started: nil database")
		return
	}
	go func() {
		select {
		case <-ctx.Done():
			return
		case <-time.After(3 * time.Minute): // stagger from other schedulers
		}
		runTradeStatusPass(db)

		ticker := time.NewTicker(10 * time.Minute)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				runTradeStatusPass(db)
			}
		}
	}()
}

func runTradeStatusPass(db *sql.DB) {
	log.Println("[TradeStatus] Starting trade-status pass")

	jobs := []struct {
		name string
		fn   func(*sql.DB)
	}{
		{"archive_inactive_trades", archiveInactiveTrades},
		{"archive_inactive_trade_loops", archiveInactiveTradeLoops},
		{"archive_inactive_multiway_chains", archiveInactiveMultiwayChains},
		{"expire_unanswered_meetup_proposals", expireUnansweredMeetupProposals},
		{"expire_scheduled_trades_after_grace", expireScheduledTradesAfterGrace},
		{"expire_scheduled_trade_loops_after_grace", expireScheduledTradeLoopsAfterGrace},
		{"cancel_expired_unpaid_buyouts", cancelExpiredUnpaidBuyouts},
		{"cancel_losing_offers_after_acceptance", cancelLosingOffersAfterAcceptance},
	}
	for _, job := range jobs {
		runTradeStatusJob(db, job.name, job.fn)
	}

	log.Println("[TradeStatus] Trade-status pass complete")
}

func archiveInactiveTrades(db *sql.DB) {
	if !tableHasColumn(db, "trades", "last_activity_at") ||
		!tableHasColumn(db, "trades", "archived_at") ||
		!tableHasColumn(db, "trades", "archived_reason") {
		return
	}

	rows, err := db.Query(`
		SELECT id, buyer_id, seller_id
		FROM trades
		WHERE status IN ('accepted','active','ongoing','awaiting_confirmation','multiway_active')
		  AND COALESCE(last_activity_at, updated_at, created_at) <= DATE_SUB(NOW(), INTERVAL ? DAY)
		ORDER BY COALESCE(last_activity_at, updated_at, created_at) ASC
		LIMIT 500
	`, inactiveTradeArchiveDays)
	if err != nil {
		log.Printf("[TradeStatus] inactive trade archive query: %v", err)
		return
	}
	defer rows.Close()

	type candidate struct{ id, buyerID, sellerID int }
	var candidates []candidate
	for rows.Next() {
		var c candidate
		if rows.Scan(&c.id, &c.buyerID, &c.sellerID) == nil {
			candidates = append(candidates, c)
		}
	}

	for _, c := range candidates {
		res, err := db.Exec(`
			UPDATE trades
			SET status = 'archived',
			    archived_reason = ?,
			    archived_at = NOW(),
			    updated_at = NOW()
			WHERE id = ?
			  AND status IN ('accepted','active','ongoing','awaiting_confirmation','multiway_active')
			  AND COALESCE(last_activity_at, updated_at, created_at) <= DATE_SUB(NOW(), INTERVAL ? DAY)
		`, TradeArchiveReasonInactiveTimeout, c.id, inactiveTradeArchiveDays)
		if err != nil {
			log.Printf("[TradeStatus] archive inactive trade %d: %v", c.id, err)
			continue
		}
		if n, _ := res.RowsAffected(); n == 0 {
			continue
		}

		unlockTradeProducts(db, c.id)
		_, _ = db.Exec("INSERT INTO trade_events (trade_id, from_status, to_status, note) VALUES (?, 'ongoing', 'archived', ?)", c.id, "Archived due to inactivity")
		msg := "A trade was archived due to 7 days of inactivity. You can find it in your archive."
		for _, uid := range uniquePositiveInts(c.buyerID, c.sellerID) {
			_, _ = db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", uid, msg)
			PublishUserEvent(uid, "trade_archived", map[string]interface{}{
				"trade_id": c.id,
				"status":   "archived",
				"reason":   TradeArchiveReasonInactiveTimeout,
			})
		}
		log.Printf("[TradeStatus] Archived inactive trade %d", c.id)
	}
}

func archiveInactiveTradeLoops(db *sql.DB) {
	if !tableHasColumn(db, "trade_like_loops", "last_activity_at") ||
		!tableHasColumn(db, "trade_like_loops", "archived_at") ||
		!tableHasColumn(db, "trade_like_loops", "archived_reason") {
		return
	}

	rows, err := db.Query(`
		SELECT id
		FROM trade_like_loops
		WHERE status IN ('accepted','confirmed','ongoing')
		  AND COALESCE(last_activity_at, updated_at, created_at) <= DATE_SUB(NOW(), INTERVAL ? DAY)
		ORDER BY COALESCE(last_activity_at, updated_at, created_at) ASC
		LIMIT 500
	`, inactiveTradeArchiveDays)
	if err != nil {
		log.Printf("[TradeStatus] inactive trade-loop archive query: %v", err)
		return
	}
	defer rows.Close()

	var loopIDs []int
	for rows.Next() {
		var id int
		if rows.Scan(&id) == nil {
			loopIDs = append(loopIDs, id)
		}
	}

	for _, loopID := range loopIDs {
		res, err := db.Exec(`
			UPDATE trade_like_loops
			SET status = 'archived',
			    archived_reason = ?,
			    archived_at = NOW(),
			    updated_at = NOW()
			WHERE id = ?
			  AND status IN ('accepted','confirmed','ongoing')
			  AND COALESCE(last_activity_at, updated_at, created_at) <= DATE_SUB(NOW(), INTERVAL ? DAY)
		`, TradeArchiveReasonInactiveTimeout, loopID, inactiveTradeArchiveDays)
		if err != nil {
			log.Printf("[TradeStatus] archive inactive trade-loop %d: %v", loopID, err)
			continue
		}
		if n, _ := res.RowsAffected(); n == 0 {
			continue
		}
		_, _ = db.Exec("UPDATE trade_like_loop_participants SET status = 'cancelled' WHERE loop_id = ? AND status NOT IN ('completed','cancelled','declined','rejected')", loopID)
		unlockTradeLoopProducts(db, loopID)
		notifyTradeLoopArchived(db, loopID)
		log.Printf("[TradeStatus] Archived inactive trade loop %d", loopID)
	}
}

func archiveInactiveMultiwayChains(db *sql.DB) {
	if !tableHasColumn(db, "multiway_trades", "last_activity_at") ||
		!tableHasColumn(db, "multiway_trades", "archived_at") ||
		!tableHasColumn(db, "multiway_trades", "archived_reason") {
		return
	}

	rows, err := db.Query(`
		SELECT id, chain_id, COALESCE(original_trade_id, 0)
		FROM multiway_trades
		WHERE status IN ('user3_accepted','active')
		  AND COALESCE(last_activity_at, updated_at, created_at) <= DATE_SUB(NOW(), INTERVAL ? DAY)
		ORDER BY COALESCE(last_activity_at, updated_at, created_at) ASC
		LIMIT 500
	`, inactiveTradeArchiveDays)
	if err != nil {
		log.Printf("[TradeStatus] inactive multiway archive query: %v", err)
		return
	}
	defer rows.Close()

	type candidate struct {
		id, tradeID int
		chainID     string
	}
	var candidates []candidate
	for rows.Next() {
		var c candidate
		if rows.Scan(&c.id, &c.chainID, &c.tradeID) == nil {
			candidates = append(candidates, c)
		}
	}

	for _, c := range candidates {
		res, err := db.Exec(`
			UPDATE multiway_trades
			SET status = 'archived',
			    archived_reason = ?,
			    archived_at = NOW(),
			    updated_at = NOW()
			WHERE id = ?
			  AND status IN ('user3_accepted','active')
			  AND COALESCE(last_activity_at, updated_at, created_at) <= DATE_SUB(NOW(), INTERVAL ? DAY)
		`, TradeArchiveReasonInactiveTimeout, c.id, inactiveTradeArchiveDays)
		if err != nil {
			log.Printf("[TradeStatus] archive inactive multiway %s: %v", c.chainID, err)
			continue
		}
		if n, _ := res.RowsAffected(); n == 0 {
			continue
		}
		_, _ = db.Exec("UPDATE multiway_trade_legs SET status = 'cancelled', updated_at = NOW() WHERE chain_id = ? AND status NOT IN ('completed','cancelled')", c.chainID)
		if c.tradeID > 0 {
			_, _ = db.Exec(`
				UPDATE trades
				SET status = 'archived',
				    archived_reason = ?,
				    archived_at = COALESCE(archived_at, NOW()),
				    updated_at = NOW()
				WHERE id = ?
				  AND status IN ('pending_multiway','multiway_active','accepted','active','ongoing','awaiting_confirmation')
			`, TradeArchiveReasonInactiveTimeout, c.tradeID)
			unlockTradeProducts(db, c.tradeID)
		}
		unlockMultiwayChainProducts(db, c.chainID)
		notifyMultiwayChainArchived(db, c.chainID)
		log.Printf("[TradeStatus] Archived inactive multiway chain %s", c.chainID)
	}
}

func unlockTradeProducts(db *sql.DB, tradeID int) {
	_, _ = db.Exec("UPDATE products SET status='available', updated_at=NOW() WHERE id = (SELECT target_product_id FROM trades WHERE id = ?) AND status='locked'", tradeID)
	_, _ = db.Exec(`
		UPDATE products
		SET status='available', updated_at=NOW()
		WHERE id IN (SELECT product_id FROM trade_items WHERE trade_id = ?)
		  AND status='locked'
	`, tradeID)
}

func unlockTradeLoopProducts(db *sql.DB, loopID int) {
	_, _ = db.Exec(`
		UPDATE products
		SET status='available', updated_at=NOW()
		WHERE id IN (
			SELECT offered_product_id FROM trade_like_loop_participants WHERE loop_id = ?
			UNION
			SELECT wanted_product_id FROM trade_like_loop_participants WHERE loop_id = ?
		) AND status='locked'
	`, loopID, loopID)
}

func unlockMultiwayChainProducts(db *sql.DB, chainID string) {
	_, _ = db.Exec(`
		UPDATE products
		SET status='available', updated_at=NOW()
		WHERE id IN (SELECT product_id FROM multiway_trade_legs WHERE chain_id = ?)
		  AND status='locked'
	`, chainID)
}

func notifyTradeLoopArchived(db *sql.DB, loopID int) {
	rows, err := db.Query("SELECT DISTINCT user_id FROM trade_like_loop_participants WHERE loop_id = ?", loopID)
	if err != nil {
		return
	}
	defer rows.Close()
	msg := "A multiway trade was archived due to 7 days of inactivity. You can find it in your archive."
	for rows.Next() {
		var uid int
		if rows.Scan(&uid) == nil && uid > 0 {
			_, _ = db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", uid, msg)
			PublishUserEvent(uid, "trade_loop_archived", map[string]interface{}{
				"loop_id": loopID,
				"status":  "archived",
				"reason":  TradeArchiveReasonInactiveTimeout,
			})
		}
	}
}

func notifyMultiwayChainArchived(db *sql.DB, chainID string) {
	selectColumns := []string{"user1_id", "user2_id", "COALESCE(user3_id, 0)"}
	hasUser4 := tableHasColumn(db, "multiway_trades", "user4_id")
	hasUser5 := tableHasColumn(db, "multiway_trades", "user5_id")
	if hasUser4 {
		selectColumns = append(selectColumns, "COALESCE(user4_id, 0)")
	}
	if hasUser5 {
		selectColumns = append(selectColumns, "COALESCE(user5_id, 0)")
	}

	var u1, u2, u3, u4, u5 int
	scanTargets := []interface{}{&u1, &u2, &u3}
	if hasUser4 {
		scanTargets = append(scanTargets, &u4)
	}
	if hasUser5 {
		scanTargets = append(scanTargets, &u5)
	}
	if err := db.QueryRow(fmt.Sprintf("SELECT %s FROM multiway_trades WHERE chain_id = ?", strings.Join(selectColumns, ", ")), chainID).Scan(scanTargets...); err != nil {
		return
	}

	msg := "A multiway trade was archived due to 7 days of inactivity. You can find it in your archive."
	for _, uid := range uniquePositiveInts(u1, u2, u3, u4, u5) {
		_, _ = db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", uid, msg)
		PublishUserEvent(uid, "multiway_archived", map[string]interface{}{
			"chain_id": chainID,
			"status":   "archived",
			"reason":   TradeArchiveReasonInactiveTimeout,
		})
	}
}

func runTradeStatusJob(db *sql.DB, name string, fn func(*sql.DB)) {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("[TradeStatus] %s panic: %v", name, r)
		}
	}()
	fn(db)
}

func scheduledTradeTimestampExpr(db *sql.DB) string {
	var cases []string
	if tableHasColumn(db, "trades", "agreed_arrival_deadline") {
		cases = append(cases, "WHEN agreed_arrival_deadline IS NOT NULL THEN agreed_arrival_deadline")
	}
	if tableHasColumn(db, "trades", "meetup_time") {
		cases = append(cases, "WHEN meetup_time REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}[ T][0-9]{2}:[0-9]{2}' THEN STR_TO_DATE(REPLACE(LEFT(meetup_time, 16), 'T', ' '), '%Y-%m-%d %H:%i')")
	}
	if tableHasColumn(db, "trades", "meetup_date") && tableHasColumn(db, "trades", "meetup_time") {
		cases = append(cases, "WHEN meetup_date REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}' AND meetup_time REGEXP '^[0-9]{2}:[0-9]{2}' THEN STR_TO_DATE(CONCAT(LEFT(meetup_date, 10), ' ', LEFT(meetup_time, 5)), '%Y-%m-%d %H:%i')")
	}
	if tableHasColumn(db, "trades", "delivery_estimated_time") {
		cases = append(cases, "WHEN delivery_estimated_time REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}[ T][0-9]{2}:[0-9]{2}' THEN STR_TO_DATE(REPLACE(LEFT(delivery_estimated_time, 16), 'T', ' '), '%Y-%m-%d %H:%i')")
	}
	if tableHasColumn(db, "deliveries", "estimated_eta") && tableHasColumn(db, "deliveries", "trade_id") {
		cases = append(cases, "WHEN EXISTS (SELECT 1 FROM deliveries d WHERE d.trade_id = trades.id AND d.estimated_eta IS NOT NULL AND d.status NOT IN ('delivered','cancelled')) THEN (SELECT MIN(d.estimated_eta) FROM deliveries d WHERE d.trade_id = trades.id AND d.estimated_eta IS NOT NULL AND d.status NOT IN ('delivered','cancelled'))")
	}
	if len(cases) == 0 {
		return ""
	}
	return "CASE " + strings.Join(cases, " ") + " ELSE NULL END"
}

func expireScheduledTradesAfterGrace(db *sql.DB) {
	if !tableHasColumn(db, "trades", "status") ||
		!tableHasColumn(db, "trades", "completed_at") ||
		!tableHasColumn(db, "trades", "auto_completed_at") ||
		!tableHasColumn(db, "trades", "first_completion_at") {
		return
	}
	scheduledExpr := scheduledTradeTimestampExpr(db)
	if scheduledExpr == "" {
		return
	}

	query := fmt.Sprintf(`
		SELECT id
		FROM (
			SELECT id, completed_at, auto_completed_at, first_completion_at, %s AS scheduled_at
			FROM trades
			WHERE status IN ('accepted','active','ongoing','multiway_active')
		) scheduled_trades
		WHERE scheduled_at IS NOT NULL
		  AND completed_at IS NULL
		  AND auto_completed_at IS NULL
		  AND first_completion_at IS NULL
		  AND DATE_ADD(scheduled_at, INTERVAL ? HOUR) <= NOW()
	`, scheduledExpr)

	rows, err := db.Query(query, scheduledTradeExpiryGraceHours)
	if err != nil {
		log.Printf("[TradeStatus] scheduled trade expiry query: %v", err)
		return
	}
	defer rows.Close()

	var tradeIDs []int
	for rows.Next() {
		var id int
		if rows.Scan(&id) == nil {
			tradeIDs = append(tradeIDs, id)
		}
	}
	if err := rows.Err(); err != nil {
		log.Printf("[TradeStatus] scheduled trade expiry rows: %v", err)
	}

	for _, tradeID := range tradeIDs {
		if err := expireScheduledTrade(db, tradeID); err != nil {
			log.Printf("[TradeStatus] expire scheduled trade %d: %v", tradeID, err)
		}
	}
}

func expireScheduledTrade(db *sql.DB, tradeID int) error {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	var targetProductID, buyerID, sellerID int
	var status string
	var completedAt, autoCompletedAt, firstCompletionAt sql.NullTime
	if err := tx.QueryRowContext(ctx, `
		SELECT target_product_id, buyer_id, seller_id, status, completed_at, auto_completed_at, first_completion_at
		FROM trades
		WHERE id = ?
		FOR UPDATE
	`, tradeID).Scan(&targetProductID, &buyerID, &sellerID, &status, &completedAt, &autoCompletedAt, &firstCompletionAt); err != nil {
		return err
	}

	switch status {
	case "accepted", "active", "ongoing", "multiway_active":
	default:
		return nil
	}
	if completedAt.Valid || autoCompletedAt.Valid || firstCompletionAt.Valid {
		return nil
	}

	if _, err := tx.ExecContext(ctx, "UPDATE products SET status='available', updated_at=NOW() WHERE id=? AND status='locked'", targetProductID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE products SET status='available', updated_at=NOW()
		WHERE id IN (SELECT product_id FROM trade_items WHERE trade_id=?)
		  AND status='locked'
	`, tradeID); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE trades SET status='expired', updated_at=NOW() WHERE id=?", tradeID); err != nil {
		return err
	}
	_, _ = tx.ExecContext(ctx, "INSERT INTO trade_events (trade_id, from_status, to_status, note) VALUES (?, ?, 'expired', ?)",
		tradeID, status, "Trade expired because the scheduled time passed")

	if err := tx.Commit(); err != nil {
		return err
	}

	msg := "Trade expired because the scheduled time passed. You can report a no-show separately if needed."
	for _, uid := range uniquePositiveInts(buyerID, sellerID) {
		_, _ = db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", uid, msg)
		PublishUserEvent(uid, "trade_expired", map[string]interface{}{
			"trade_id": tradeID,
			"status":   "expired",
			"reason":   "scheduled_time_passed",
		})
	}
	log.Printf("[TradeStatus] Scheduled trade %d expired after %dh grace", tradeID, scheduledTradeExpiryGraceHours)
	return nil
}

func expireScheduledTradeLoopsAfterGrace(db *sql.DB) {
	var tblCount int
	if err := db.QueryRow(`
		SELECT COUNT(*)
		FROM information_schema.TABLES
		WHERE TABLE_SCHEMA = DATABASE()
		  AND TABLE_NAME IN ('trade_like_loops','trade_like_loop_participants','trade_loop_meetup_selections')
	`).Scan(&tblCount); err != nil || tblCount < 3 {
		return
	}

	rows, err := db.Query(`
		SELECT DISTINCT l.id
		FROM trade_like_loops l
		JOIN trade_loop_meetup_selections s ON s.loop_id = CONCAT('like_loop_', l.id)
		WHERE l.status IN ('accepted','confirmed','ongoing','active','multiway_active','user3_accepted')
		  AND s.meetup_confirmed = TRUE
		  AND s.met_confirmed = FALSE
		  AND s.meetup_date REGEXP '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
		  AND s.meetup_time REGEXP '^[0-9]{2}:[0-9]{2}'
		  AND DATE_ADD(STR_TO_DATE(CONCAT(LEFT(s.meetup_date, 10), ' ', LEFT(s.meetup_time, 5)), '%Y-%m-%d %H:%i'), INTERVAL ? HOUR) <= NOW()
	`, scheduledTradeExpiryGraceHours)
	if err != nil {
		log.Printf("[TradeStatus] scheduled trade-loop expiry query: %v", err)
		return
	}
	defer rows.Close()

	var loopIDs []int
	for rows.Next() {
		var id int
		if rows.Scan(&id) == nil {
			loopIDs = append(loopIDs, id)
		}
	}
	for _, loopID := range loopIDs {
		res, err := db.Exec("UPDATE trade_like_loops SET status='expired', updated_at=NOW() WHERE id=? AND status IN ('accepted','confirmed','ongoing','active','multiway_active','user3_accepted')", loopID)
		if err != nil {
			log.Printf("[TradeStatus] expire scheduled trade-loop %d: %v", loopID, err)
			continue
		}
		if n, _ := res.RowsAffected(); n == 0 {
			continue
		}
		_, _ = db.Exec("UPDATE trade_like_loop_participants SET status='expired' WHERE loop_id=?", loopID)

		participantRows, err := db.Query("SELECT user_id FROM trade_like_loop_participants WHERE loop_id=?", loopID)
		if err != nil {
			continue
		}
		msg := "Trade expired because the scheduled time passed. You can report a no-show separately if needed."
		for participantRows.Next() {
			var uid int
			if participantRows.Scan(&uid) == nil && uid > 0 {
				_, _ = db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", uid, msg)
				PublishUserEvent(uid, "trade_loop_expired", map[string]interface{}{
					"loop_id": loopID,
					"status":  "expired",
					"reason":  "scheduled_time_passed",
				})
			}
		}
		participantRows.Close()
		log.Printf("[TradeStatus] Scheduled trade-loop %d expired after %dh grace", loopID, scheduledTradeExpiryGraceHours)
	}
}

// expireUnansweredMeetupProposals marks meetup proposals as 'expired' when
// the other party hasn't confirmed within 48 hours. This uses the
// meetup_proposals table if it exists; if the column layout differs we skip
// gracefully so existing logic is never broken.
func expireUnansweredMeetupProposals(db *sql.DB) {
	var tbl int
	if err := db.QueryRow(
		"SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='meetup_proposals'",
	).Scan(&tbl); err != nil || tbl == 0 {
		return
	}

	rows, err := db.Query(`
		SELECT id, trade_id, proposed_by_id
		FROM meetup_proposals
		WHERE status = 'pending'
		  AND TIMESTAMPDIFF(HOUR, created_at, NOW()) >= 48
	`)
	if err != nil {
		log.Printf("[TradeStatus] meetup_proposals query: %v", err)
		return
	}
	defer rows.Close()

	type proposal struct{ id, tradeID, proposedBy int }
	var expired []proposal
	for rows.Next() {
		var p proposal
		if err := rows.Scan(&p.id, &p.tradeID, &p.proposedBy); err == nil {
			expired = append(expired, p)
		}
	}
	if err := rows.Err(); err != nil {
		log.Printf("[TradeStatus] meetup_proposals rows: %v", err)
	}

	for _, p := range expired {
		res, err := db.Exec(
			"UPDATE meetup_proposals SET status='expired', updated_at=NOW() WHERE id=? AND status='pending'",
			p.id,
		)
		if err != nil {
			log.Printf("[TradeStatus] expire meetup_proposal %d: %v", p.id, err)
			continue
		}
		if n, _ := res.RowsAffected(); n == 0 {
			continue
		}

		// Notify both trade participants.
		var buyerID, sellerID int
		if err := db.QueryRow(
			"SELECT buyer_id, seller_id FROM trades WHERE id=?", p.tradeID,
		).Scan(&buyerID, &sellerID); err == nil {
			msg := "A meetup proposal has expired because it wasn't confirmed within 48 hours. Please propose a new time."
			for _, uid := range []int{buyerID, sellerID} {
				_, _ = db.Exec(
					"INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)",
					uid, msg,
				)
				PublishUserEvent(uid, "meetup_proposal_expired", map[string]interface{}{
					"trade_id":    p.tradeID,
					"proposal_id": p.id,
				})
			}
		}

		log.Printf("[TradeStatus] Expired unanswered meetup proposal %d (trade %d)", p.id, p.tradeID)
	}
}

// cancelExpiredUnpaidBuyouts cancels trade records whose payment invoice has
// exceeded its expiry time without being paid. We read the invoice_expires_at
// column if it exists; otherwise we fall back to a 24-hour window on invoice_url
// trades that are still in 'pending_payment' status.
func cancelExpiredUnpaidBuyouts(db *sql.DB) {
	// Check whether the payment_status column exists on trades.
	var col int
	if err := db.QueryRow(`
		SELECT COUNT(*) FROM information_schema.COLUMNS
		WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='trades' AND COLUMN_NAME='payment_status'
	`).Scan(&col); err != nil || col == 0 {
		return // payment columns not migrated yet
	}

	// Prefer invoice_expires_at if it exists.
	var hasExpiry int
	_ = db.QueryRow(`
		SELECT COUNT(*) FROM information_schema.COLUMNS
		WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='trades' AND COLUMN_NAME='invoice_expires_at'
	`).Scan(&hasExpiry)

	var rows *sql.Rows
	var err error
	if hasExpiry > 0 {
		rows, err = db.Query(`
			SELECT id, buyer_id, seller_id
			FROM trades
			WHERE payment_status = 'pending'
			  AND invoice_expires_at IS NOT NULL
			  AND invoice_expires_at < NOW()
			  AND status NOT IN ('completed','auto_completed','cancelled','expired','declined')
		`)
	} else {
		// Fallback: pending payment invoices sitting for > 24 h
		rows, err = db.Query(`
			SELECT id, buyer_id, seller_id
			FROM trades
			WHERE payment_status = 'pending'
			  AND TIMESTAMPDIFF(HOUR, updated_at, NOW()) >= 24
			  AND status NOT IN ('completed','auto_completed','cancelled','expired','declined')
		`)
	}
	if err != nil {
		log.Printf("[TradeStatus] unpaid buyout query: %v", err)
		return
	}
	defer rows.Close()

	type expired struct{ id, buyerID, sellerID int }
	var expiredList []expired
	for rows.Next() {
		var e expired
		if err := rows.Scan(&e.id, &e.buyerID, &e.sellerID); err == nil {
			expiredList = append(expiredList, e)
		}
	}
	if err := rows.Err(); err != nil {
		log.Printf("[TradeStatus] unpaid buyout rows: %v", err)
	}

	for _, e := range expiredList {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		tx, err := db.BeginTx(ctx, nil)
		if err != nil {
			cancel()
			continue
		}

		// Recheck status inside transaction to avoid races.
		var status string
		if err := tx.QueryRowContext(ctx,
			"SELECT status FROM trades WHERE id=? FOR UPDATE", e.id,
		).Scan(&status); err != nil {
			tx.Rollback()
			cancel()
			continue
		}
		switch status {
		case "completed", "auto_completed", "cancelled", "expired", "declined":
			tx.Rollback()
			cancel()
			continue
		}

		if _, err := tx.ExecContext(ctx,
			"UPDATE trades SET status='cancelled', payment_status='expired', updated_at=NOW() WHERE id=?",
			e.id,
		); err != nil {
			tx.Rollback()
			cancel()
			log.Printf("[TradeStatus] cancel unpaid buyout %d: %v", e.id, err)
			continue
		}

		// Unlock any locked products.
		tx.ExecContext(ctx, `
			UPDATE products SET status='available', updated_at=NOW()
			WHERE id IN (
				SELECT target_product_id FROM trades WHERE id=?
				UNION
				SELECT product_id FROM trade_items WHERE trade_id=?
			) AND status='locked'
		`, e.id, e.id)

		if err := tx.Commit(); err != nil {
			cancel()
			log.Printf("[TradeStatus] commit cancel unpaid buyout %d: %v", e.id, err)
			continue
		}
		cancel()

		msg := "Your buyout payment was not received in time. The trade has been cancelled. You can try again."
		for _, uid := range []int{e.buyerID, e.sellerID} {
			_, _ = db.Exec(
				"INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)",
				uid, msg,
			)
			PublishUserEvent(uid, "buyout_expired", map[string]interface{}{"trade_id": e.id})
		}

		log.Printf("[TradeStatus] Cancelled unpaid buyout trade %d", e.id)
	}
}

// cancelLosingOffersAfterAcceptance finds products that now have one 'active'
// or 'ongoing' trade and cancels all other 'pending'/'countered' offers for
// the same target product. This ensures sellers are not holding multiple open
// offers once they accept one.
func cancelLosingOffersAfterAcceptance(db *sql.DB) {
	// Find products that have an accepted/active trade AND at least one other pending trade.
	rows, err := db.Query(`
		SELECT DISTINCT winner.target_product_id
		FROM trades winner
		JOIN trades loser ON loser.target_product_id = winner.target_product_id
		  AND loser.id <> winner.id
		  AND loser.status IN ('pending','countered','accepted_by_one')
		WHERE winner.status IN ('active','ongoing','accepted','accepted_by_both','awaiting_confirmation','completed','auto_completed')
	`)
	if err != nil {
		log.Printf("[TradeStatus] losing-offer query: %v", err)
		return
	}
	defer rows.Close()

	var productIDs []int
	for rows.Next() {
		var pid int
		if rows.Scan(&pid) == nil {
			productIDs = append(productIDs, pid)
		}
	}
	if err := rows.Err(); err != nil {
		log.Printf("[TradeStatus] losing-offer rows: %v", err)
	}

	for _, productID := range productIDs {
		// Identify the winning trade ID for this product.
		var winnerID int
		err := db.QueryRow(`
			SELECT id FROM trades
			WHERE target_product_id = ?
			  AND status IN ('active','ongoing','accepted','accepted_by_both','awaiting_confirmation','completed','auto_completed')
			ORDER BY updated_at DESC LIMIT 1
		`, productID).Scan(&winnerID)
		if err != nil {
			continue
		}

		// Fetch all losing trades for this product.
		loserRows, err := db.Query(`
			SELECT id, buyer_id FROM trades
			WHERE target_product_id = ?
			  AND id <> ?
			  AND status IN ('pending','countered','accepted_by_one')
		`, productID, winnerID)
		if err != nil {
			continue
		}

		type loser struct{ id, buyerID int }
		var losers []loser
		for loserRows.Next() {
			var l loser
			if loserRows.Scan(&l.id, &l.buyerID) == nil {
				losers = append(losers, l)
			}
		}
		if err := loserRows.Err(); err != nil {
			log.Printf("[TradeStatus] loser rows for product %d: %v", productID, err)
		}
		loserRows.Close()

		for _, l := range losers {
			res, err := db.Exec(
				"UPDATE trades SET status='cancelled', updated_at=NOW() WHERE id=? AND status IN ('pending','countered','accepted_by_one')",
				l.id,
			)
			if err != nil {
				log.Printf("[TradeStatus] cancel losing offer %d: %v", l.id, err)
				continue
			}
			if n, _ := res.RowsAffected(); n == 0 {
				continue
			}

			_, _ = db.Exec(
				"INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)",
				l.buyerID,
				"Your trade offer was automatically cancelled because the seller accepted another offer for this item.",
			)
			PublishUserEvent(l.buyerID, "offer_cancelled", map[string]interface{}{
				"trade_id":   l.id,
				"product_id": productID,
			})

			log.Printf("[TradeStatus] Cancelled losing offer trade %d (product %d, winner %d)", l.id, productID, winnerID)
		}
	}
}
