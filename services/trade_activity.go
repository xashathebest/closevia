package services

import (
	"database/sql"
	"log"
	"strconv"
	"strings"
)

const TradeArchiveReasonInactiveTimeout = "inactive_timeout"

func TouchTradeActivity(db *sql.DB, tradeID int) {
	if db == nil || tradeID <= 0 || !tableHasColumn(db, "trades", "last_activity_at") {
		return
	}
	if _, err := db.Exec(`
		UPDATE trades
		SET last_activity_at = NOW(), updated_at = NOW()
		WHERE id = ?
		  AND status NOT IN ('completed','auto_completed','cancelled','cancelled_due_to_conflict','declined','rejected','expired','broken','history','archived')
	`, tradeID); err != nil {
		log.Printf("[TradeActivity] touch trade %d: %v", tradeID, err)
	}
}

func TouchTradeLoopActivity(db *sql.DB, loopID int) {
	if db == nil || loopID <= 0 || !tableHasColumn(db, "trade_like_loops", "last_activity_at") {
		return
	}
	if _, err := db.Exec(`
		UPDATE trade_like_loops
		SET last_activity_at = NOW(), updated_at = NOW()
		WHERE id = ?
		  AND status NOT IN ('completed','did_not_push_through','history','rejected','cancelled','cancelled_due_to_conflict','broken','expired','archived')
	`, loopID); err != nil {
		log.Printf("[TradeActivity] touch trade loop %d: %v", loopID, err)
	}
}

func TouchMultiwayChainActivity(db *sql.DB, chainID string) {
	chainID = strings.TrimSpace(chainID)
	if db == nil || chainID == "" || !tableHasColumn(db, "multiway_trades", "last_activity_at") {
		return
	}
	if _, err := db.Exec(`
		UPDATE multiway_trades
		SET last_activity_at = NOW(),
		    ongoing_deadline = CASE WHEN ongoing_deadline IS NULL THEN NULL ELSE DATE_ADD(NOW(), INTERVAL 7 DAY) END,
		    updated_at = NOW()
		WHERE chain_id = ?
		  AND status NOT IN ('completed','cancelled','expired','broken','history','fully_declined','archived')
	`, chainID); err != nil {
		log.Printf("[TradeActivity] touch multiway chain %s: %v", chainID, err)
	}

	if tableHasColumn(db, "trades", "last_activity_at") {
		_, _ = db.Exec(`
			UPDATE trades
			SET last_activity_at = NOW(), updated_at = NOW()
			WHERE id = (SELECT original_trade_id FROM multiway_trades WHERE chain_id = ?)
			  AND status NOT IN ('completed','auto_completed','cancelled','cancelled_due_to_conflict','declined','rejected','expired','broken','history','archived')
		`, chainID)
	}
}

func TouchLoopOrChainActivity(db *sql.DB, loopID string) {
	clean := strings.TrimSpace(strings.Trim(loopID, "/"))
	if clean == "" {
		return
	}
	if strings.HasPrefix(clean, "like_loop") {
		raw := strings.TrimPrefix(clean, "like_loop")
		raw = strings.TrimPrefix(raw, "_")
		end := 0
		for end < len(raw) && raw[end] >= '0' && raw[end] <= '9' {
			end++
		}
		if end > 0 {
			if id, err := strconv.Atoi(raw[:end]); err == nil {
				TouchTradeLoopActivity(db, id)
			}
		}
		return
	}
	TouchMultiwayChainActivity(db, clean)
}
