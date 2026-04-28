package services

import (
	"context"
	"database/sql"
	"log"
	"time"
)

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
		{"expire_unanswered_meetup_proposals", expireUnansweredMeetupProposals},
		{"cancel_expired_unpaid_buyouts", cancelExpiredUnpaidBuyouts},
		{"cancel_losing_offers_after_acceptance", cancelLosingOffersAfterAcceptance},
	}
	for _, job := range jobs {
		runTradeStatusJob(db, job.name, job.fn)
	}

	log.Println("[TradeStatus] Trade-status pass complete")
}

func runTradeStatusJob(db *sql.DB, name string, fn func(*sql.DB)) {
	defer func() {
		if r := recover(); r != nil {
			log.Printf("[TradeStatus] %s panic: %v", name, r)
		}
	}()
	fn(db)
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
