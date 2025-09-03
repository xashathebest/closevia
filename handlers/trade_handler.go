package handlers

import (
	"database/sql"
	"log"
	"strconv"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/xashathebest/clovia/database"
	"github.com/xashathebest/clovia/middleware"
	"github.com/xashathebest/clovia/models"
)

type TradeHandler struct {
	db *sql.DB
}

func NewTradeHandler() *TradeHandler {
	return &TradeHandler{db: database.DB}
}

// CreateTrade creates a new trade proposal
func (h *TradeHandler) CreateTrade(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}

	var payload models.TradeCreate
	if err := c.BodyParser(&payload); err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid request body"})
	}
	if payload.TargetProductID <= 0 || len(payload.OfferedProductIDs) == 0 {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "target_product_id and offered_product_ids are required"})
	}

	// Use a transaction to ensure trade and items are created together
	tx, err := h.db.Begin()
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to start transaction"})
	}

	// Lookup target product to get seller_id inside the transaction
	var sellerID int
	if err := tx.QueryRow("SELECT seller_id FROM products WHERE id = ?", payload.TargetProductID).Scan(&sellerID); err != nil {
		_ = tx.Rollback()
		return c.Status(404).JSON(models.APIResponse{Success: false, Error: "Target product not found"})
	}
	if sellerID == userID {
		_ = tx.Rollback()
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Cannot propose a trade on your own product"})
	}

	// Insert trade
	res, err := tx.Exec(`INSERT INTO trades (buyer_id, seller_id, target_product_id, status, message, offered_cash_amount) VALUES (?, ?, ?, 'pending', ?, ?)`, userID, sellerID, payload.TargetProductID, payload.Message, payload.OfferedCashAmount)
	if err != nil {
		_ = tx.Rollback()
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to create trade"})
	}
	tradeID64, _ := res.LastInsertId()
	tradeID := int(tradeID64)

	// Validate and insert offered items (buyer side)
	for _, pid := range payload.OfferedProductIDs {
		var ownerID int
		if err := tx.QueryRow("SELECT seller_id FROM products WHERE id = ?", pid).Scan(&ownerID); err != nil {
			_ = tx.Rollback()
			return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Offered product not found"})
		}
		if ownerID != userID {
			_ = tx.Rollback()
			return c.Status(400).JSON(models.APIResponse{Success: false, Error: "You can only offer your own products"})
		}
		if _, err := tx.Exec("INSERT INTO trade_items (trade_id, product_id, offered_by) VALUES (?, ?, 'buyer')", tradeID, pid); err != nil {
			_ = tx.Rollback()
			return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to attach offered items"})
		}
	}

	if err := tx.Commit(); err != nil {
		_ = tx.Rollback()
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to save trade"})
	}

	// Create notification for seller
	var buyerName string
	_ = h.db.QueryRow("SELECT name FROM users WHERE id = ?", userID).Scan(&buyerName)
	// Find product name for context
	var productTitle string
	_ = h.db.QueryRow("SELECT title FROM products WHERE id = ?", payload.TargetProductID).Scan(&productTitle)
	notifMsg := "You received a trade offer from " + buyerName + " for " + productTitle
	_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_offer', ?, FALSE)", sellerID, notifMsg)
	publishNotification(sellerID, notifMsg)

	// Ensure chat conversation exists and add a system message
	convID, _ := ensureConversation(payload.TargetProductID, userID, sellerID)
	_, _, _ = saveMessage(convID, userID, "Trade offer started for "+productTitle+".")

	// Return created trade (items will appear when listing/fetching details)
	trade := models.Trade{ID: tradeID, BuyerID: userID, SellerID: sellerID, TargetProductID: payload.TargetProductID, Status: "pending", Message: payload.Message, OfferedCash: payload.OfferedCashAmount, CreatedAt: time.Now(), UpdatedAt: time.Now()}

	// Realtime notify seller via SSE
	publishToUser(sellerID, sseEvent{Type: "trade_created", Data: fiber.Map{
		"trade_id":            tradeID,
		"buyer_id":            userID,
		"target_product_id":   payload.TargetProductID,
		"message":             payload.Message,
		"offered_cash_amount": payload.OfferedCashAmount,
	}})

	return c.Status(201).JSON(models.APIResponse{Success: true, Message: "Trade created", Data: trade})
}

// GetTrades lists trades for the current user (as buyer or seller)
func (h *TradeHandler) GetTrades(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}

	status := c.Query("status", "")
	direction := c.Query("direction", "")
	where := "WHERE (t.buyer_id = ? OR t.seller_id = ?)"
	args := []interface{}{userID, userID}
	if direction == "incoming" {
		where = "WHERE t.seller_id = ?"
		args = []interface{}{userID}
	} else if direction == "outgoing" {
		where = "WHERE t.buyer_id = ?"
		args = []interface{}{userID}
	}
	if status != "" {
		where += " AND t.status = ?"
		args = append(args, status)
	}

	rows, err := h.db.Query(`
        SELECT 
          t.id, t.buyer_id, t.seller_id, t.target_product_id, t.status, t.message, t.offered_cash_amount, t.created_at, t.updated_at,
          t.buyer_completed, t.seller_completed, t.completed_at,
          ub.name AS buyer_name, us.name AS seller_name, p.title AS product_title
        FROM trades t
        JOIN users ub ON ub.id = t.buyer_id
        JOIN users us ON us.id = t.seller_id
        JOIN products p ON p.id = t.target_product_id
        `+where+`
        ORDER BY t.created_at DESC
    `, args...)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to fetch trades"})
	}
	defer rows.Close()

	trades := []models.Trade{}
	for rows.Next() {
		var tr models.Trade
		if err := rows.Scan(&tr.ID, &tr.BuyerID, &tr.SellerID, &tr.TargetProductID, &tr.Status, &tr.Message, &tr.OfferedCash, &tr.CreatedAt, &tr.UpdatedAt, &tr.BuyerCompleted, &tr.SellerCompleted, &tr.CompletedAt, &tr.BuyerName, &tr.SellerName, &tr.ProductTitle); err == nil {
			// Load items
			itemRows, qerr := h.db.Query(`
                SELECT ti.id, ti.trade_id, ti.product_id, ti.offered_by, ti.created_at,
                       p.title, p.status, p.image_url
                FROM trade_items ti
                LEFT JOIN products p ON p.id = ti.product_id
                WHERE ti.trade_id = ?
            `, tr.ID)
			items := []models.TradeItem{}
			if qerr != nil {
				log.Printf("trade %d: joined items query error: %v", tr.ID, qerr)
			} else if itemRows != nil {
				for itemRows.Next() {
					var it models.TradeItem
					var offeredBy sql.NullString
					var title, pstatus, pimg sql.NullString
					if err := itemRows.Scan(&it.ID, &it.TradeID, &it.ProductID, &offeredBy, &it.CreatedAt, &title, &pstatus, &pimg); err == nil {
						if offeredBy.Valid {
							it.OfferedBy = offeredBy.String
						} else {
							it.OfferedBy = ""
						}
						if title.Valid {
							it.ProductTitle = title.String
						}
						if pstatus.Valid {
							it.ProductStatus = pstatus.String
						}
						if pimg.Valid {
							it.ProductImageURL = pimg.String
						}
						items = append(items, it)
					} else {
						log.Printf("trade %d: item row scan error: %v", tr.ID, err)
					}
				}
				itemRows.Close()
			}

			// Fallback: if no items found via join, fetch basic trade_items and enrich individually
			if len(items) == 0 {
				rows2, err2 := h.db.Query("SELECT id, trade_id, product_id, offered_by, created_at FROM trade_items WHERE trade_id = ?", tr.ID)
				if err2 != nil {
					log.Printf("trade %d: fallback items query error: %v", tr.ID, err2)
				} else {
					for rows2.Next() {
						var it models.TradeItem
						var offeredBy sql.NullString
						if err := rows2.Scan(&it.ID, &it.TradeID, &it.ProductID, &offeredBy, &it.CreatedAt); err == nil {
							if offeredBy.Valid {
								it.OfferedBy = offeredBy.String
							}
							// try to enrich product info
							var title, pstatus, pimg sql.NullString
							_ = h.db.QueryRow("SELECT title, status, image_url FROM products WHERE id = ?", it.ProductID).Scan(&title, &pstatus, &pimg)
							if title.Valid {
								it.ProductTitle = title.String
							}
							if pstatus.Valid {
								it.ProductStatus = pstatus.String
							}
							if pimg.Valid {
								it.ProductImageURL = pimg.String
							}
							items = append(items, it)
						} else {
							log.Printf("trade %d: fallback item scan error: %v", tr.ID, err)
						}
					}
					rows2.Close()
				}
			}

			tr.Items = items
			trades = append(trades, tr)
		} else {
			log.Printf("trade row scan error: %v", err)
		}
	}

	return c.JSON(models.APIResponse{Success: true, Data: trades})
}

// UpdateTrade allows seller or buyer to accept, decline, or counter
func (h *TradeHandler) UpdateTrade(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}
	tradeID, err := strconv.Atoi(c.Params("id"))
	if err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid trade id"})
	}

	// Fetch trade
	var buyerID, sellerID int
	err = h.db.QueryRow("SELECT buyer_id, seller_id FROM trades WHERE id = ?", tradeID).Scan(&buyerID, &sellerID)
	if err != nil {
		return c.Status(404).JSON(models.APIResponse{Success: false, Error: "Trade not found"})
	}
	if userID != buyerID && userID != sellerID {
		return c.Status(403).JSON(models.APIResponse{Success: false, Error: "Not authorized for this trade"})
	}

	var payload models.TradeAction
	if err := c.BodyParser(&payload); err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid request body"})
	}

	switch payload.Action {
	case "accept":
		_, err = h.db.Exec("UPDATE trades SET status='accepted', updated_at=CURRENT_TIMESTAMP WHERE id = ?", tradeID)
		if err == nil {
			// Ensure chat exists and add system message
			var pid int
			_ = h.db.QueryRow("SELECT target_product_id FROM trades WHERE id = ?", tradeID).Scan(&pid)
			var productTitle string
			_ = h.db.QueryRow("SELECT title FROM products WHERE id = ?", pid).Scan(&productTitle)
			convID, _ := ensureConversation(pid, buyerID, sellerID)
			_, _, _ = saveMessage(convID, userID, "Trade accepted for "+productTitle+".")
			// Mark as active post-accept
			_, _ = h.db.Exec("UPDATE trades SET status='active' WHERE id = ?", tradeID)
			// History
			_, _ = h.db.Exec("INSERT INTO trade_events (trade_id, actor_id, from_status, to_status, note) VALUES (?, ?, 'pending', 'accepted', ?)", tradeID, userID, payload.Message)
			publishToUser(buyerID, sseEvent{Type: "trade_updated", Data: fiber.Map{"trade_id": tradeID, "status": "accepted"}})
			publishToUser(sellerID, sseEvent{Type: "trade_updated", Data: fiber.Map{"trade_id": tradeID, "status": "accepted"}})
			// Notifications
			_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", buyerID, "Your trade offer was accepted: "+productTitle)
			_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", sellerID, "You accepted a trade offer: "+productTitle)
		}
	case "decline":
		_, err = h.db.Exec("UPDATE trades SET status='declined', updated_at=CURRENT_TIMESTAMP WHERE id = ?", tradeID)
		if err == nil {
			var pid int
			_ = h.db.QueryRow("SELECT target_product_id FROM trades WHERE id = ?", tradeID).Scan(&pid)
			var productTitle string
			_ = h.db.QueryRow("SELECT title FROM products WHERE id = ?", pid).Scan(&productTitle)
			publishToUser(buyerID, sseEvent{Type: "trade_updated", Data: fiber.Map{"trade_id": tradeID, "status": "declined"}})
			publishToUser(sellerID, sseEvent{Type: "trade_updated", Data: fiber.Map{"trade_id": tradeID, "status": "declined"}})
			_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", buyerID, "Your trade offer was declined: "+productTitle)
			_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", sellerID, "You declined a trade offer: "+productTitle)
			_, _ = h.db.Exec("INSERT INTO trade_events (trade_id, actor_id, from_status, to_status, note) VALUES (?, ?, NULL, 'declined', ?)", tradeID, userID, payload.Message)
		}
	case "counter":
		// Counter: set status countered and replace items with counter-offer from the countering party
		// Note: We keep offered items as belonging to the original sender (buyer)
		_, err = h.db.Exec("UPDATE trades SET status='countered', message=?, updated_at=CURRENT_TIMESTAMP WHERE id = ?", payload.Message, tradeID)
		if err == nil {
			// If specific counter items supplied, replace buyer's items with provided set (still marked offered_by='buyer')
			if len(payload.CounterOfferedProductIDs) > 0 {
				_, _ = h.db.Exec("DELETE FROM trade_items WHERE trade_id = ?", tradeID)
				for _, pid := range payload.CounterOfferedProductIDs {
					_, _ = h.db.Exec("INSERT INTO trade_items (trade_id, product_id, offered_by) VALUES (?, ?, 'buyer')", tradeID, pid)
				}
			}
			// If counter cash amount provided, set it
			if payload.CounterOfferedCashAmount != nil {
				_, _ = h.db.Exec("UPDATE trades SET offered_cash_amount=? WHERE id = ?", payload.CounterOfferedCashAmount, tradeID)
			}
			publishToUser(buyerID, sseEvent{Type: "trade_updated", Data: fiber.Map{"trade_id": tradeID, "status": "countered"}})
			publishToUser(sellerID, sseEvent{Type: "trade_updated", Data: fiber.Map{"trade_id": tradeID, "status": "countered"}})
			// Notify buyer about counter
			var targetPid int
			_ = h.db.QueryRow("SELECT target_product_id FROM trades WHERE id = ?", tradeID).Scan(&targetPid)
			var productTitle string
			_ = h.db.QueryRow("SELECT title FROM products WHERE id = ?", targetPid).Scan(&productTitle)
			_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", buyerID, "Your trade offer was countered: "+productTitle)
			_, _ = h.db.Exec("INSERT INTO trade_events (trade_id, actor_id, from_status, to_status, note) VALUES (?, ?, NULL, 'countered', ?)", tradeID, userID, payload.Message)
		}
	case "complete":
		// Mark party completion; finalize when both complete
		column := "buyer_completed"
		if userID == sellerID {
			column = "seller_completed"
		}
		_, err = h.db.Exec("UPDATE trades SET "+column+"=TRUE, updated_at=CURRENT_TIMESTAMP WHERE id = ?", tradeID)
		if err == nil {
			// Check both flags
			var bc, sc bool
			_ = h.db.QueryRow("SELECT buyer_completed, seller_completed FROM trades WHERE id = ?", tradeID).Scan(&bc, &sc)
			if bc && sc {
				// Both parties confirmed - mark as completed
				_, _ = h.db.Exec("UPDATE trades SET status='completed', completed_at=CURRENT_TIMESTAMP WHERE id = ?", tradeID)

				// Mark all involved products as traded
				// Get all product IDs involved in this trade
				var productIDs []int
				rows, err := h.db.Query("SELECT product_id FROM trade_items WHERE trade_id = ?", tradeID)
				if err == nil {
					defer rows.Close()
					for rows.Next() {
						var productID int
						if err := rows.Scan(&productID); err == nil {
							productIDs = append(productIDs, productID)
						}
					}
				}
				// Also include the target product
				var targetProductID int
				if err := h.db.QueryRow("SELECT target_product_id FROM trades WHERE id = ?", tradeID).Scan(&targetProductID); err == nil {
					productIDs = append(productIDs, targetProductID)
				}

				// Update all involved products to traded status
				for _, productID := range productIDs {
					_, _ = h.db.Exec("UPDATE products SET status='traded', updated_at=CURRENT_TIMESTAMP WHERE id = ?", productID)
				}

				publishToUser(buyerID, sseEvent{Type: "trade_updated", Data: fiber.Map{"trade_id": tradeID, "status": "completed"}})
				publishToUser(sellerID, sseEvent{Type: "trade_updated", Data: fiber.Map{"trade_id": tradeID, "status": "completed"}})
				_, _ = h.db.Exec("INSERT INTO trade_events (trade_id, actor_id, from_status, to_status, note) VALUES (?, ?, 'pending_confirmation', 'completed', ?)", tradeID, userID, payload.Message)
				_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", buyerID, "Trade completed")
				_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", sellerID, "Trade completed")
			} else {
				// Only one party confirmed - mark as pending confirmation
				_, _ = h.db.Exec("UPDATE trades SET status='pending_confirmation' WHERE id = ?", tradeID)

				// Notify both parties about the confirmation status
				publishToUser(buyerID, sseEvent{Type: "trade_updated", Data: fiber.Map{"trade_id": tradeID, "status": "pending_confirmation"}})
				publishToUser(sellerID, sseEvent{Type: "trade_updated", Data: fiber.Map{"trade_id": tradeID, "status": "pending_confirmation"}})

				// Add trade event
				_, _ = h.db.Exec("INSERT INTO trade_events (trade_id, actor_id, from_status, to_status, note) VALUES (?, ?, 'active', 'pending_confirmation', ?)", tradeID, userID, payload.Message)

				// Notify the other party that they need to confirm
				var otherPartyID int
				if userID == buyerID {
					otherPartyID = sellerID
				} else {
					otherPartyID = buyerID
				}
				_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", otherPartyID, "Trade confirmation needed - other party has confirmed")
			}
		}
	case "cancel":
		// Allow cancel when active but not completed
		_, err = h.db.Exec("UPDATE trades SET status='cancelled', updated_at=CURRENT_TIMESTAMP WHERE id = ?", tradeID)
		if err == nil {
			publishToUser(buyerID, sseEvent{Type: "trade_updated", Data: fiber.Map{"trade_id": tradeID, "status": "cancelled"}})
			publishToUser(sellerID, sseEvent{Type: "trade_updated", Data: fiber.Map{"trade_id": tradeID, "status": "cancelled"}})
			_, _ = h.db.Exec("INSERT INTO trade_events (trade_id, actor_id, from_status, to_status, note) VALUES (?, ?, NULL, 'cancelled', ?)", tradeID, userID, payload.Message)
		}
	default:
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid action"})
	}

	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to update trade"})
	}

	return c.JSON(models.APIResponse{Success: true, Message: "Trade updated"})
}

// GetTradeMessages returns messages for a trade
func (h *TradeHandler) GetTradeMessages(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}
	tradeID, err := strconv.Atoi(c.Params("id"))
	if err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid trade id"})
	}
	// authorize
	var buyerID, sellerID int
	err = h.db.QueryRow("SELECT buyer_id, seller_id FROM trades WHERE id = ?", tradeID).Scan(&buyerID, &sellerID)
	if err != nil {
		return c.Status(404).JSON(models.APIResponse{Success: false, Error: "Trade not found"})
	}
	if userID != buyerID && userID != sellerID {
		return c.Status(403).JSON(models.APIResponse{Success: false, Error: "Not authorized for this trade"})
	}
	rows, err := h.db.Query("SELECT id, trade_id, sender_id, content, created_at FROM trade_messages WHERE trade_id = ? ORDER BY created_at ASC", tradeID)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to fetch messages"})
	}
	defer rows.Close()
	type msg struct {
		ID        int       `json:"id"`
		TradeID   int       `json:"trade_id"`
		SenderID  int       `json:"sender_id"`
		Content   string    `json:"content"`
		CreatedAt time.Time `json:"created_at"`
	}
	list := []msg{}
	for rows.Next() {
		var m msg
		if err := rows.Scan(&m.ID, &m.TradeID, &m.SenderID, &m.Content, &m.CreatedAt); err == nil {
			list = append(list, m)
		}
	}
	return c.JSON(models.APIResponse{Success: true, Data: list})
}

// GetTrade returns a single trade with detailed items
func (h *TradeHandler) GetTrade(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}
	tradeID, err := strconv.Atoi(c.Params("id"))
	if err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid trade id"})
	}
	var tr models.Trade
	err = h.db.QueryRow(`
        SELECT 
          t.id, t.buyer_id, t.seller_id, t.target_product_id, t.status, t.message, t.offered_cash_amount, t.created_at, t.updated_at,
          t.buyer_completed, t.seller_completed, t.completed_at,
          ub.name AS buyer_name, us.name AS seller_name, p.title AS product_title
        FROM trades t
        JOIN users ub ON ub.id = t.buyer_id
        JOIN users us ON us.id = t.seller_id
        JOIN products p ON p.id = t.target_product_id
        WHERE t.id = ?
    `, tradeID).Scan(&tr.ID, &tr.BuyerID, &tr.SellerID, &tr.TargetProductID, &tr.Status, &tr.Message, &tr.OfferedCash, &tr.CreatedAt, &tr.UpdatedAt, &tr.BuyerCompleted, &tr.SellerCompleted, &tr.CompletedAt, &tr.BuyerName, &tr.SellerName, &tr.ProductTitle)
	if err != nil {
		return c.Status(404).JSON(models.APIResponse{Success: false, Error: "Trade not found"})
	}
	if userID != tr.BuyerID && userID != tr.SellerID {
		return c.Status(403).JSON(models.APIResponse{Success: false, Error: "Not authorized for this trade"})
	}
	itemRows, qerr := h.db.Query(`
        SELECT ti.id, ti.trade_id, ti.product_id, ti.offered_by, ti.created_at,
               p.title, p.status, p.image_url
        FROM trade_items ti
        LEFT JOIN products p ON p.id = ti.product_id
        WHERE ti.trade_id = ?
    `, tr.ID)
	items := []models.TradeItem{}
	if qerr != nil {
		log.Printf("trade %d: joined items query error: %v", tr.ID, qerr)
	} else if itemRows != nil {
		for itemRows.Next() {
			var it models.TradeItem
			var offeredBy sql.NullString
			var title, pstatus, pimg sql.NullString
			if err := itemRows.Scan(&it.ID, &it.TradeID, &it.ProductID, &offeredBy, &it.CreatedAt, &title, &pstatus, &pimg); err == nil {
				if offeredBy.Valid {
					it.OfferedBy = offeredBy.String
				} else {
					it.OfferedBy = ""
				}
				if title.Valid {
					it.ProductTitle = title.String
				}
				if pstatus.Valid {
					it.ProductStatus = pstatus.String
				}
				if pimg.Valid {
					it.ProductImageURL = pimg.String
				}
				items = append(items, it)
			} else {
				log.Printf("trade %d: item row scan error: %v", tr.ID, err)
			}
		}
		itemRows.Close()
	}

	// Fallback like above
	if len(items) == 0 {
		rows2, err2 := h.db.Query("SELECT id, trade_id, product_id, offered_by, created_at FROM trade_items WHERE trade_id = ?", tr.ID)
		if err2 != nil {
			log.Printf("trade %d: fallback items query error: %v", tr.ID, err2)
		} else {
			for rows2.Next() {
				var it models.TradeItem
				var offeredBy sql.NullString
				if err := rows2.Scan(&it.ID, &it.TradeID, &it.ProductID, &offeredBy, &it.CreatedAt); err == nil {
					if offeredBy.Valid {
						it.OfferedBy = offeredBy.String
					}
					var title, pstatus, pimg sql.NullString
					_ = h.db.QueryRow("SELECT title, status, image_url FROM products WHERE id = ?", it.ProductID).Scan(&title, &pstatus, &pimg)
					if title.Valid {
						it.ProductTitle = title.String
					}
					if pstatus.Valid {
						it.ProductStatus = pstatus.String
					}
					if pimg.Valid {
						it.ProductImageURL = pimg.String
					}
					items = append(items, it)
				} else {
					log.Printf("trade %d: fallback item scan error: %v", tr.ID, err)
				}
			}
			rows2.Close()
		}
	}

	tr.Items = items
	return c.JSON(models.APIResponse{Success: true, Data: tr})
}

// GetTradeHistory returns the history of events for a trade
func (h *TradeHandler) GetTradeHistory(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}
	tradeID, err := strconv.Atoi(c.Params("id"))
	if err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid trade id"})
	}
	var buyerID, sellerID int
	if err := h.db.QueryRow("SELECT buyer_id, seller_id FROM trades WHERE id = ?", tradeID).Scan(&buyerID, &sellerID); err != nil {
		return c.Status(404).JSON(models.APIResponse{Success: false, Error: "Trade not found"})
	}
	if userID != buyerID && userID != sellerID {
		return c.Status(403).JSON(models.APIResponse{Success: false, Error: "Not authorized for this trade"})
	}
	rows, err := h.db.Query("SELECT id, trade_id, actor_id, from_status, to_status, note, created_at FROM trade_events WHERE trade_id = ? ORDER BY created_at ASC", tradeID)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to fetch history"})
	}
	defer rows.Close()
	type ev struct {
		ID         int       `json:"id"`
		TradeID    int       `json:"trade_id"`
		ActorID    *int      `json:"actor_id,omitempty"`
		FromStatus *string   `json:"from_status,omitempty"`
		ToStatus   *string   `json:"to_status,omitempty"`
		Note       *string   `json:"note,omitempty"`
		CreatedAt  time.Time `json:"created_at"`
	}
	list := []ev{}
	for rows.Next() {
		var e ev
		var actorID sql.NullInt64
		var fromSt, toSt, note sql.NullString
		if err := rows.Scan(&e.ID, &e.TradeID, &actorID, &fromSt, &toSt, &note, &e.CreatedAt); err == nil {
			if actorID.Valid {
				v := int(actorID.Int64)
				e.ActorID = &v
			}
			if fromSt.Valid {
				v := fromSt.String
				e.FromStatus = &v
			}
			if toSt.Valid {
				v := toSt.String
				e.ToStatus = &v
			}
			if note.Valid {
				v := note.String
				e.Note = &v
			}
			list = append(list, e)
		}
	}
	return c.JSON(models.APIResponse{Success: true, Data: list})
}

// SendTradeMessage posts a new message for a trade and notifies participants
func (h *TradeHandler) SendTradeMessage(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}
	tradeID, err := strconv.Atoi(c.Params("id"))
	if err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid trade id"})
	}
	var payload struct {
		Content string `json:"content"`
	}
	if err := c.BodyParser(&payload); err != nil || payload.Content == "" {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid content"})
	}
	// authorize
	var buyerID, sellerID int
	err = h.db.QueryRow("SELECT buyer_id, seller_id FROM trades WHERE id = ?", tradeID).Scan(&buyerID, &sellerID)
	if err != nil {
		return c.Status(404).JSON(models.APIResponse{Success: false, Error: "Trade not found"})
	}
	if userID != buyerID && userID != sellerID {
		return c.Status(403).JSON(models.APIResponse{Success: false, Error: "Not authorized for this trade"})
	}
	// insert message
	res, err := h.db.Exec("INSERT INTO trade_messages (trade_id, sender_id, content) VALUES (?, ?, ?)", tradeID, userID, payload.Content)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to save message"})
	}
	id64, _ := res.LastInsertId()
	var createdAt time.Time
	_ = h.db.QueryRow("SELECT created_at FROM trade_messages WHERE id = ?", id64).Scan(&createdAt)
	// notify both
	evt := sseEvent{Type: "trade_message", Data: fiber.Map{
		"id":         int(id64),
		"trade_id":   tradeID,
		"sender_id":  userID,
		"content":    payload.Content,
		"created_at": createdAt,
	}}
	publishToUser(buyerID, evt)
	publishToUser(sellerID, evt)
	return c.Status(201).JSON(models.APIResponse{Success: true})
}

// CountTrades returns count of trades for current user by direction and status
func (h *TradeHandler) CountTrades(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}
	direction := c.Query("direction", "incoming")
	status := c.Query("status", "pending")
	where := "WHERE t.seller_id = ?"
	args := []interface{}{userID}
	if direction == "outgoing" {
		where = "WHERE t.buyer_id = ?"
	}
	if status != "" {
		where += " AND t.status = ?"
		args = append(args, status)
	}
	var count int
	_ = h.db.QueryRow("SELECT COUNT(*) FROM trades t "+where, args...).Scan(&count)
	return c.JSON(models.APIResponse{Success: true, Data: fiber.Map{"count": count}})
}
