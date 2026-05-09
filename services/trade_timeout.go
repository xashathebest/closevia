package services

import (
	"database/sql"
	"fmt"
	"log"
	"strings"
	"time"
)

func recordNoShowPenalty(db *sql.DB, userID int, tradeType, tradeRef, roleLabel string, tradeID *int) {
	if userID <= 0 {
		return
	}
	if _, err := db.Exec("UPDATE users SET strikes = COALESCE(strikes, 0) + 1 WHERE id = ?", userID); err != nil {
		log.Printf("recordNoShowPenalty: failed to increment strikes for user %d (%s): %v", userID, tradeRef, err)
		return
	}
	reason := fmt.Sprintf("No-show for %s", tradeRef)
	if roleLabel != "" {
		reason = fmt.Sprintf("%s (%s)", reason, roleLabel)
	}
	if err := RecordTrustStrike(db, TrustStrikeInput{
		UserID:    userID,
		Type:      "no_show",
		Severity:  "major",
		TradeType: tradeType,
		TradeID:   tradeID,
		TradeRef:  tradeRef,
		Reason:    reason,
		Points:    PointsForTrustStrike("no_show", "major"),
	}); err != nil {
		log.Printf("recordNoShowPenalty: failed to record no-show strike for user %d (%s): %v", userID, tradeRef, err)
		return
	}
	_, _ = db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'account', ?, FALSE)", userID, "Major trust score penalty: you were marked as a no-show for an expired trade.")
	log.Printf("Applied no-show trust penalty to user %d for %s", userID, tradeRef)
}

func tableHasColumn(db *sql.DB, tableName, columnName string) bool {
	var count int
	err := db.QueryRow(`
		SELECT COUNT(*)
		FROM information_schema.COLUMNS
		WHERE TABLE_SCHEMA = DATABASE()
		  AND TABLE_NAME = ?
		  AND COLUMN_NAME = ?
	`, tableName, columnName).Scan(&count)
	return err == nil && count > 0
}

func uniquePositiveInts(values ...int) []int {
	seen := map[int]bool{}
	out := make([]int, 0, len(values))
	for _, value := range values {
		if value <= 0 || seen[value] {
			continue
		}
		seen[value] = true
		out = append(out, value)
	}
	return out
}

// StartTradeTimeoutScheduler runs periodic checks to progress trades through two-stage timeout
func StartTradeTimeoutScheduler(db *sql.DB) {
	go func() {
		ticker := time.NewTicker(5 * time.Minute)
		defer ticker.Stop()
		for {
			if err := runTradeTimeoutPass(db); err != nil {
				log.Printf("trade timeout pass error: %v", err)
			}
			<-ticker.C
		}
	}()
}

func runTradeTimeoutPass(db *sql.DB) error {
	// If the DB doesn't have the expected timeout columns (migrations not applied),
	// skip the pass to avoid SQL errors. Check for existence of first_completion_at.
	var cnt int
	if err := db.QueryRow("SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'trades' AND column_name = 'first_completion_at'").Scan(&cnt); err != nil {
		// If we can't query information_schema, return the error so it can be retried later
		return err
	}
	if cnt == 0 {
		// migrations not applied; nothing to do for trade timeouts
		return nil
	}
	// Stage 1: Move to awaiting_confirmation after 24h from first_completion_at
	if _, err := db.Exec(`
        UPDATE trades
        SET status = 'awaiting_confirmation', awaiting_confirmation_since = NOW(), updated_at = NOW()
        WHERE status = 'active'
          AND first_completion_at IS NOT NULL
          AND awaiting_confirmation_since IS NULL
          AND ((buyer_completed = TRUE AND seller_completed = FALSE) OR (buyer_completed = FALSE AND seller_completed = TRUE))
          AND TIMESTAMPDIFF(HOUR, first_completion_at, NOW()) >= 24
    `); err != nil {
		return err
	}

	// Send reminders for newly moved trades
	// Simple approach: notify all trades that meet the condition right now
	rows, err := db.Query(`
        SELECT id, buyer_id, seller_id FROM trades
        WHERE status = 'awaiting_confirmation' 
          AND awaiting_confirmation_since IS NOT NULL
          AND TIMESTAMPDIFF(MINUTE, awaiting_confirmation_since, NOW()) < 10
    `)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var id, buyerID, sellerID int
			if err := rows.Scan(&id, &buyerID, &sellerID); err == nil {
				_, _ = db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", buyerID, "Reminder: Please confirm the trade within 24 hours.")
				_, _ = db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", sellerID, "Reminder: Please confirm the trade within 24 hours.")
			}
		}
	}

	// Stage 2: Auto-complete after 48h from first_completion_at
	rows2, err := db.Query(`
        SELECT id FROM trades
        WHERE (status = 'awaiting_confirmation' OR status = 'active')
          AND first_completion_at IS NOT NULL
          AND auto_completed_at IS NULL
          AND ((buyer_completed = TRUE AND seller_completed = FALSE) OR (buyer_completed = FALSE AND seller_completed = TRUE))
          AND TIMESTAMPDIFF(HOUR, first_completion_at, NOW()) >= 48
    `)
	if err != nil {
		return err
	}
	defer rows2.Close()
	for rows2.Next() {
		var tradeID int
		if err := rows2.Scan(&tradeID); err == nil {
			if err := autoCompleteTrade(db, tradeID); err != nil {
				log.Printf("auto-complete trade %d failed: %v", tradeID, err)
			}
		}
	}

	// Stage 3: Expire inactive trades after 3 days with no progress
	// Ping DB to recover stale connections before querying
	if err := db.Ping(); err != nil {
		return err
	}
	var expireIDs []int
	expiredRows, err := db.Query(`
		SELECT id FROM trades
		WHERE status IN ('pending', 'accepted', 'accepted_by_one', 'countered', 'active')
		  AND TIMESTAMPDIFF(DAY, updated_at, NOW()) >= 3
	`)
	if err != nil {
		return err
	}
	for expiredRows.Next() {
		var tradeID int
		if err := expiredRows.Scan(&tradeID); err == nil {
			expireIDs = append(expireIDs, tradeID)
		}
	}
	expiredRows.Close()
	for _, tradeID := range expireIDs {
		if err := autoExpireTrade(db, tradeID); err != nil {
			log.Printf("auto-expire trade %d failed: %v", tradeID, err)
		}
	}

	// Stage 4: Auto-dissolve expired multi-way chains (3-day acceptance window)
	if err := dissolveExpiredMultiwayChains(db); err != nil {
		log.Printf("dissolve expired multiway chains error: %v", err)
	}

	// Stage 5: Expire 12-hour re-match holds (Phase 3)
	if err := expireRematchHolds(db); err != nil {
		log.Printf("expire rematch holds error: %v", err)
	}

	// Stage 6: Expire active multiway chains past 7-day ongoing deadline
	if err := expireOngoingMultiwayChains(db); err != nil {
		log.Printf("expire ongoing multiway chains error: %v", err)
	}

	// Stage 7: Expire trade like loops that have been pending for > 3 days
	if err := expireStaleLikeLoops(db); err != nil {
		log.Printf("expire stale like loops error: %v", err)
	}

	// Stage 8: Notify users about stuck loops (not all participants have confirmed/canceled)
	if err := notifyStuckLoopsAndChains(db); err != nil {
		log.Printf("notify stuck loops error: %v", err)
	}

	return nil
}

func autoCompleteTrade(db *sql.DB, tradeID int) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// Lock trade and fetch participants and target
	var targetProductID, buyerID, sellerID int
	var status string
	err = tx.QueryRow(`
        SELECT target_product_id, buyer_id, seller_id, status
        FROM trades WHERE id = ? FOR UPDATE
    `, tradeID).Scan(&targetProductID, &buyerID, &sellerID, &status)
	if err != nil {
		return err
	}

	// Mark all products as traded
	// target product
	if _, err := tx.Exec("UPDATE products SET status='traded', updated_at=NOW() WHERE id = ?", targetProductID); err != nil {
		return err
	}
	// offered products
	rows, err := tx.Query("SELECT product_id FROM trade_items WHERE trade_id = ?", tradeID)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var pid int
		if err := rows.Scan(&pid); err != nil {
			return err
		}
		if _, err := tx.Exec("UPDATE products SET status='traded', updated_at=NOW() WHERE id = ?", pid); err != nil {
			return err
		}
	}

	// Update trade status
	if _, err := tx.Exec("UPDATE trades SET status='auto_completed', completed_at=NOW(), auto_completed_at=NOW(), updated_at=NOW() WHERE id = ?", tradeID); err != nil {
		return err
	}

	if err := tx.Commit(); err != nil {
		return err
	}

	// Notify both users with dispute info
	_, _ = db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", buyerID, "Trade auto-completed after 48 hours. If there is an issue, open a dispute.")
	_, _ = db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", sellerID, "Trade auto-completed after 48 hours. If there is an issue, open a dispute.")
	return nil
}

func autoExpireTrade(db *sql.DB, tradeID int) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()

	// Lock trade and fetch participants and current status
	var targetProductID, buyerID, sellerID int
	var currentStatus string
	err = tx.QueryRow(`
		SELECT target_product_id, buyer_id, seller_id, status
		FROM trades WHERE id = ? FOR UPDATE
	`, tradeID).Scan(&targetProductID, &buyerID, &sellerID, &currentStatus)
	if err != nil {
		return err
	}

	// Double-check status hasn't changed since the SELECT outside the tx
	switch currentStatus {
	case "pending", "accepted", "accepted_by_one", "countered", "active":
		// valid for expiry
	default:
		return nil // Already moved to a terminal status; skip
	}

	// Unlock target product (only if currently locked)
	if _, err := tx.Exec("UPDATE products SET status='available', updated_at=NOW() WHERE id = ? AND status='locked'", targetProductID); err != nil {
		return err
	}

	// Unlock offered products
	offeredRows, err := tx.Query("SELECT product_id FROM trade_items WHERE trade_id = ?", tradeID)
	if err != nil {
		return err
	}
	var offeredPids []int
	for offeredRows.Next() {
		var pid int
		if err := offeredRows.Scan(&pid); err != nil {
			offeredRows.Close()
			return err
		}
		offeredPids = append(offeredPids, pid)
	}
	offeredRows.Close()
	for _, pid := range offeredPids {
		if _, err := tx.Exec("UPDATE products SET status='available', updated_at=NOW() WHERE id = ? AND status='locked'", pid); err != nil {
			return err
		}
	}

	// Update trade status to expired
	if _, err := tx.Exec("UPDATE trades SET status='expired', updated_at=NOW() WHERE id = ?", tradeID); err != nil {
		return err
	}

	if err := tx.Commit(); err != nil {
		return err
	}

	// Notify both users (outside transaction)
	_, _ = db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)",
		buyerID, "A trade has expired due to 3 days of inactivity.")
	_, _ = db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)",
		sellerID, "A trade has expired due to 3 days of inactivity.")

	// Record trade event (system action, no actor)
	_, _ = db.Exec("INSERT INTO trade_events (trade_id, from_status, to_status, note) VALUES (?, ?, 'expired', 'Auto-expired after 3 days of inactivity')",
		tradeID, currentStatus)

	log.Printf("Trade %d auto-expired (was %s, inactive 3+ days)", tradeID, currentStatus)
	return nil
}

// dissolveExpiredMultiwayChains finds multi-way chains past their 3-day acceptance
// window and auto-dissolves them. The original trade is restored to 'pending' so
// the algorithm can re-search, and all parties are notified.
func dissolveExpiredMultiwayChains(db *sql.DB) error {
	// Check whether the multiway_trades table exists at all.
	var tblCount int
	if err := db.QueryRow(`
		SELECT COUNT(*) FROM information_schema.TABLES
		WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'multiway_trades'
	`).Scan(&tblCount); err != nil || tblCount == 0 {
		return nil // table does not exist yet; nothing to do
	}

	// Find expired chains that are still in a pending state.
	rows, err := db.Query(`
		SELECT id, chain_id, original_trade_id, user1_id, user2_id, user3_id, status
		FROM multiway_trades
		WHERE expires_at IS NOT NULL
		  AND expires_at <= NOW()
		  AND status IN ('pending_user3', 'pending_initiator_upgrade', 'searching')
	`)
	if err != nil {
		return err
	}
	defer rows.Close()

	type expiredChain struct {
		id, tradeID, u1, u2, u3 int
		chainID, status         string
	}
	var chains []expiredChain
	for rows.Next() {
		var c expiredChain
		var u3 sql.NullInt64
		if err := rows.Scan(&c.id, &c.chainID, &c.tradeID, &c.u1, &c.u2, &u3, &c.status); err != nil {
			continue
		}
		if u3.Valid {
			c.u3 = int(u3.Int64)
		}
		chains = append(chains, c)
	}

	for _, c := range chains {
		// Cancel the chain
		_, _ = db.Exec(`
			UPDATE multiway_trades
			SET status = 'expired', cancelled_at = NOW(), updated_at = NOW()
			WHERE id = ?
		`, c.id)

		// Restore the original trade back to pending so the matcher can re-try
		_, _ = db.Exec(`
			UPDATE trades
			SET status = 'pending', updated_at = NOW()
			WHERE id = ? AND status IN ('pending_multiway', 'multiway_active')
		`, c.tradeID)

		// Notify all parties
		msg := "A multi-way Trade Connect has expired because not all parties accepted within 3 days. Your items are available again."
		for _, uid := range []int{c.u1, c.u2, c.u3} {
			if uid <= 0 {
				continue
			}
			_, _ = db.Exec(
				"INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)",
				uid, msg,
			)
		}

		log.Printf("Auto-dissolved expired multiway chain %s (id=%d, was %s)", c.chainID, c.id, c.status)
	}

	return nil
}

// expireRematchHolds dissolves 12-hour re-match holds that expired without
// finding a replacement participant. Restores original trade to 'pending'.
func expireRematchHolds(db *sql.DB) error {
	// Check if table exists.
	var tblCount int
	if err := db.QueryRow(`
		SELECT COUNT(*) FROM information_schema.TABLES
		WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'multiway_rematch_holds'
	`).Scan(&tblCount); err != nil || tblCount == 0 {
		return nil
	}

	rows, err := db.Query(`
		SELECT id, chain_id, original_chain_id
		FROM multiway_rematch_holds
		WHERE status = 'searching' AND hold_expires_at <= NOW()
	`)
	if err != nil {
		return err
	}
	defer rows.Close()

	type expiredHold struct {
		id              int
		chainID         string
		originalChainID string
	}
	var holds []expiredHold
	for rows.Next() {
		var h expiredHold
		if err := rows.Scan(&h.id, &h.chainID, &h.originalChainID); err != nil {
			continue
		}
		holds = append(holds, h)
	}

	for _, hold := range holds {
		// Mark the hold as expired.
		_, _ = db.Exec("UPDATE multiway_rematch_holds SET status = 'expired' WHERE id = ?", hold.id)

		// Restore the original trade to pending.
		_, _ = db.Exec(`
			UPDATE trades SET status = 'pending', updated_at = NOW()
			WHERE id = (SELECT original_trade_id FROM multiway_trades WHERE chain_id = ?)
			  AND status IN ('pending_multiway', 'multiway_active')
		`, hold.originalChainID)

		// Notify all parties from the original chain.
		var u1, u2, u3 int
		if err := db.QueryRow("SELECT user1_id, user2_id, COALESCE(user3_id, 0) FROM multiway_trades WHERE chain_id = ?", hold.originalChainID).Scan(&u1, &u2, &u3); err == nil {
			msg := "The 12-hour search for a replacement participant has ended without finding a match. The chain has been dissolved and your items are available again."
			for _, uid := range []int{u1, u2, u3} {
				if uid > 0 {
					_, _ = db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", uid, msg)
				}
			}
		}

		log.Printf("Re-match hold expired for chain %s (original: %s)", hold.chainID, hold.originalChainID)
	}

	return nil
}

// expireOngoingMultiwayChains finds active chains past their 7-day ongoing
// deadline and auto-cancels them, restoring the original trade to 'pending'.
func expireOngoingMultiwayChains(db *sql.DB) error {
	// Check whether the column exists (migration may not have run yet).
	var colCount int
	if err := db.QueryRow(`
		SELECT COUNT(*) FROM information_schema.COLUMNS
		WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'multiway_trades' AND COLUMN_NAME = 'ongoing_deadline'
	`).Scan(&colCount); err != nil || colCount == 0 {
		return nil
	}

	selectColumns := []string{"id", "chain_id", "original_trade_id", "user1_id", "user2_id", "COALESCE(user3_id, 0)"}
	hasUser4 := tableHasColumn(db, "multiway_trades", "user4_id")
	hasUser5 := tableHasColumn(db, "multiway_trades", "user5_id")
	if hasUser4 {
		selectColumns = append(selectColumns, "COALESCE(user4_id, 0)")
	}
	if hasUser5 {
		selectColumns = append(selectColumns, "COALESCE(user5_id, 0)")
	}

	rows, err := db.Query(fmt.Sprintf(`
		SELECT %s
		FROM multiway_trades
		WHERE ongoing_deadline IS NOT NULL
		  AND ongoing_deadline <= NOW()
		  AND status IN ('user3_accepted', 'active')
	`, strings.Join(selectColumns, ", ")))
	if err != nil {
		return err
	}
	defer rows.Close()

	type expired struct {
		id, tradeID int
		userIDs     []int
		chainID     string
	}
	var chains []expired
	for rows.Next() {
		var c expired
		var u1, u2, u3, u4, u5 int
		scanTargets := []interface{}{&c.id, &c.chainID, &c.tradeID, &u1, &u2, &u3}
		if hasUser4 {
			scanTargets = append(scanTargets, &u4)
		}
		if hasUser5 {
			scanTargets = append(scanTargets, &u5)
		}
		if err := rows.Scan(scanTargets...); err != nil {
			continue
		}
		c.userIDs = uniquePositiveInts(u1, u2, u3, u4, u5)
		chains = append(chains, c)
	}

	for _, c := range chains {
		// Expire the chain without treating it as a user cancellation/no-show.
		_, _ = db.Exec("UPDATE multiway_trades SET status = 'expired', cancelled_at = NOW(), updated_at = NOW() WHERE id = ?", c.id)

		// Expire any pending legs
		_, _ = db.Exec("UPDATE multiway_trade_legs SET status = 'expired', updated_at = NOW() WHERE chain_id = ? AND status IN ('pending','in_progress')", c.chainID)

		// Move the original trade out of active/ongoing views.
		_, _ = db.Exec("UPDATE trades SET status = 'expired', updated_at = NOW() WHERE id = ? AND status IN ('pending_multiway','multiway_active')", c.tradeID)

		// Notify all parties
		msg := "A multi-way trade expired because the scheduled time passed. You can report a no-show separately if needed."
		for _, uid := range c.userIDs {
			if uid > 0 {
				_, _ = db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", uid, msg)
			}
		}

		log.Printf("Ongoing multiway chain %s (id=%d) expired after 7-day deadline", c.chainID, c.id)
	}

	return nil
}

// expireStaleLikeLoops finds Trade Connect like-loops that nobody has canceled
// but 3 days have passed since creation. It marks them as cancelled.
func expireStaleLikeLoops(db *sql.DB) error {
	// Check if trade_like_loops table exists
	var tblCount int
	if err := db.QueryRow(`
		SELECT COUNT(*) FROM information_schema.TABLES
		WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'trade_like_loops'
	`).Scan(&tblCount); err != nil || tblCount == 0 {
		return nil
	}

	rows, err := db.Query(`
		SELECT id
		FROM trade_like_loops
		WHERE status = 'pending'
		AND TIMESTAMPDIFF(HOUR, created_at, NOW()) >= 72
	`)
	if err != nil {
		return err
	}
	defer rows.Close()

	var expiredIDs []int
	for rows.Next() {
		var id int
		if err := rows.Scan(&id); err == nil {
			expiredIDs = append(expiredIDs, id)
		}
	}

	for _, id := range expiredIDs {
		// Update loop status
		_, _ = db.Exec("UPDATE trade_like_loops SET status = 'expired', updated_at = NOW() WHERE id = ?", id)

		// Update participants
		_, _ = db.Exec("UPDATE trade_like_loop_participants SET status = 'expired' WHERE loop_id = ?", id)

		// Notify participants
		pRows, _ := db.Query("SELECT user_id FROM trade_like_loop_participants WHERE loop_id = ?", id)
		defer pRows.Close()
		msg := "A like-loop opportunity has expired because it was not confirmed by all parties within 3 days."
		for pRows.Next() {
			var uid int
			if pRows.Scan(&uid) == nil && uid > 0 {
				_, _ = db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", uid, msg)
			}
		}

		log.Printf("Auto-expired 3-day stale like-loop (id=%d)", id)
	}

	return nil
}

// notifyStuckLoopsAndChains sends a gentle reminder to users in loops that are
// pending for >24 hours because some participants haven't acted yet.
func notifyStuckLoopsAndChains(db *sql.DB) error {
	msgAction := "Your multiway loop matching is paused! Please respond (confirm or cancel) so the loop can proceed."
	msgWaiting := "Your multiway loop is stuck waiting for other users. If they don't respond soon, the loop will be canceled."

	// 1. Process like-loops waiting for > 24 hours
	loopRows, _ := db.Query(`
		SELECT id FROM trade_like_loops
		WHERE status = 'pending'
		AND TIMESTAMPDIFF(HOUR, created_at, NOW()) = 24
	`)
	if loopRows != nil {
		defer loopRows.Close()
		for loopRows.Next() {
			var loopID int
			if loopRows.Scan(&loopID) == nil {
				// We found a stuck like-loop. Let's see who is pending and who is confirmed
				pRows, _ := db.Query("SELECT user_id, status FROM trade_like_loop_participants WHERE loop_id = ?", loopID)
				for pRows.Next() {
					var u int
					var s string
					if pRows.Scan(&u, &s) == nil && u > 0 {
						if s == "pending" {
							_, _ = db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", u, msgAction)
						} else {
							_, _ = db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", u, msgWaiting)
						}
					}
				}
				pRows.Close()
			}
		}
	}

	// 2. Process multiway chains waiting for > 24 hours
	// Note: multiway expires in 72 hours, so 24 hours is a good time to send a reminder.
	chainRows, _ := db.Query(`
		SELECT id, chain_id, user1_id, user2_id, user3_id, status 
		FROM multiway_trades
		WHERE status IN ('pending_user3', 'pending_initiator_upgrade')
		AND TIMESTAMPDIFF(HOUR, created_at, NOW()) = 24
	`)
	if chainRows != nil {
		defer chainRows.Close()
		for chainRows.Next() {
			var id, u1, u2, u3 int
			var chainID, status string
			if chainRows.Scan(&id, &chainID, &u1, &u2, &u3, &status) == nil {
				if status == "pending_user3" && u3 > 0 {
					_, _ = db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", u3, msgAction)
					_, _ = db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", u1, msgWaiting)
					_, _ = db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", u2, msgWaiting)
				}
			}
		}
	}

	return nil
}
