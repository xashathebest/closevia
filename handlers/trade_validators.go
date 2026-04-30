package handlers

import (
	"database/sql"
	"fmt"
)

// validateTradeParticipant verifies the caller is a buyer or seller of the trade.
// Returns the buyer and seller IDs for callers that need them.
func validateTradeParticipant(db *sql.DB, tradeID, userID int) (buyerID, sellerID int, err error) {
	err = db.QueryRow(
		"SELECT buyer_id, seller_id FROM trades WHERE id = ?", tradeID,
	).Scan(&buyerID, &sellerID)
	if err == sql.ErrNoRows {
		return 0, 0, fmt.Errorf("trade not found")
	}
	if err != nil {
		return 0, 0, fmt.Errorf("failed to load trade: %w", err)
	}
	if userID != buyerID && userID != sellerID {
		return 0, 0, fmt.Errorf("not authorized for this trade")
	}
	return buyerID, sellerID, nil
}

// validateBuyoutDeliveryEligibility checks that the trade is a buyout-only (cash)
// delivery order. Rejects barter trades (buyer offered items) and non-delivery options.
func validateBuyoutDeliveryEligibility(db *sql.DB, tradeID int) error {
	var tradeOption string
	var offeredCash float64
	err := db.QueryRow(
		"SELECT COALESCE(trade_option,'meetup'), COALESCE(offered_cash_amount,0) FROM trades WHERE id = ?",
		tradeID,
	).Scan(&tradeOption, &offeredCash)
	if err == sql.ErrNoRows {
		return fmt.Errorf("trade not found")
	}
	if err != nil {
		return fmt.Errorf("failed to load trade: %w", err)
	}
	if tradeOption != "delivery" {
		return fmt.Errorf("trade option is not delivery")
	}
	if offeredCash <= 0 {
		return fmt.Errorf("trade has no cash offer (not a buyout)")
	}
	// Reject if buyer has offered physical items (barter component).
	var buyerItemCount int
	_ = db.QueryRow(
		"SELECT COUNT(*) FROM trade_items WHERE trade_id = ? AND offered_by = 'buyer'",
		tradeID,
	).Scan(&buyerItemCount)
	if buyerItemCount > 0 {
		return fmt.Errorf("trade has barter items attached (not a pure buyout)")
	}
	return nil
}

// validateArrivalConfirmed checks that the caller has confirmed GPS arrival for the
// trade (buyer_met or seller_met flag, depending on the caller's role).
func validateArrivalConfirmed(db *sql.DB, tradeID, userID int) error {
	var buyerID, sellerID int
	var buyerMet, sellerMet bool
	err := db.QueryRow(
		"SELECT buyer_id, seller_id, COALESCE(buyer_met,FALSE), COALESCE(seller_met,FALSE) FROM trades WHERE id = ?",
		tradeID,
	).Scan(&buyerID, &sellerID, &buyerMet, &sellerMet)
	if err == sql.ErrNoRows {
		return fmt.Errorf("trade not found")
	}
	if err != nil {
		return fmt.Errorf("failed to load trade: %w", err)
	}
	if userID == buyerID && !buyerMet {
		return fmt.Errorf("GPS arrival not confirmed for this trade")
	}
	if userID == sellerID && !sellerMet {
		return fmt.Errorf("GPS arrival not confirmed for this trade")
	}
	return nil
}

// getAllMultiwayParticipants returns the non-zero user IDs (user1–user3) for a chain.
func getAllMultiwayParticipants(db *sql.DB, chainID string) ([]int, error) {
	var u1, u2, u3 int
	err := db.QueryRow(
		"SELECT COALESCE(user1_id,0), COALESCE(user2_id,0), COALESCE(user3_id,0) FROM multiway_trades WHERE chain_id = ?",
		chainID,
	).Scan(&u1, &u2, &u3)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("chain not found")
	}
	if err != nil {
		return nil, fmt.Errorf("failed to load chain: %w", err)
	}
	out := make([]int, 0, 3)
	for _, id := range []int{u1, u2, u3} {
		if id > 0 {
			out = append(out, id)
		}
	}
	return out, nil
}
