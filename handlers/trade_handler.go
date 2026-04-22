package handlers

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"math"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/go-sql-driver/mysql"
	"github.com/gofiber/fiber/v2"
	"github.com/xashathebest/clovia/database"
	"github.com/xashathebest/clovia/middleware"
	"github.com/xashathebest/clovia/models"
	"github.com/xashathebest/clovia/services"
)

type TradeHandler struct {
	db *sql.DB
}

// Keep legacy trade-match and multiway helpers compiled and available while the
// current request flow relies on explicit product likes and persisted loop rows.
var (
	_ = (*TradeHandler).findProductBasedMultiwayLoops
)

func isMySQLTableMissing(err error) bool {
	var mysqlErr *mysql.MySQLError
	return errors.As(err, &mysqlErr) && mysqlErr.Number == 1146
}

func (h *TradeHandler) ensureTradeLoopMeetupSelectionsTable() error {
	_, err := h.db.Exec(`CREATE TABLE IF NOT EXISTS trade_loop_meetup_selections (
			id INT AUTO_INCREMENT PRIMARY KEY,
			loop_id VARCHAR(255) NOT NULL,
			user_id INT NOT NULL,
			meetup_location VARCHAR(500) NULL,
			meetup_date VARCHAR(20) NULL,
			meetup_time VARCHAR(20) NULL,
			meetup_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
			met_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			UNIQUE KEY uniq_loop_meetup_user (loop_id, user_id),
			INDEX idx_loop_meetup_loop (loop_id),
			INDEX idx_loop_meetup_user (user_id),
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
		)`)
	return err
}

type likeEdge struct {
	FromUser         int
	ToUser           int
	OfferedProductID int
	WantedProductID  int
	FromUserName     string
	ToUserName       string
	OfferedTitle     string
	WantedTitle      string
	OfferedImage     string
	WantedImage      string
}

type likeParticipant struct {
	UserID           int
	UserName         string
	UserSlug         string
	OfferedProductID int
	OfferedTitle     string
	OfferedSlug      string
	OfferedImage     string
	WantedProductID  int
	WantedTitle      string
	WantedSlug       string
	Position         int
	Status           string
}

func buildLikeLoopKey(participants []likeParticipant) string {
	userIDs := make([]int, 0, len(participants))
	offeredIDs := make([]int, 0, len(participants))
	wantedIDs := make([]int, 0, len(participants))
	for _, p := range participants {
		userIDs = append(userIDs, p.UserID)
		offeredIDs = append(offeredIDs, p.OfferedProductID)
		wantedIDs = append(wantedIDs, p.WantedProductID)
	}
	sort.Ints(userIDs)
	sort.Ints(offeredIDs)
	sort.Ints(wantedIDs)
	return fmt.Sprintf("u:%v|o:%v|w:%v", userIDs, offeredIDs, wantedIDs)
}

func loopIDFromLikeLoopID(loopID int) string {
	return fmt.Sprintf("like_loop_%d", loopID)
}

func parseLikeLoopID(loopID string) (int, bool) {
	clean := strings.TrimSpace(strings.Trim(loopID, "/"))
	if !strings.HasPrefix(clean, "like_loop") {
		return 0, false
	}
	raw := strings.TrimPrefix(clean, "like_loop")
	raw = strings.TrimPrefix(raw, "_")
	end := 0
	for end < len(raw) && raw[end] >= '0' && raw[end] <= '9' {
		end++
	}
	if end == 0 {
		return 0, false
	}
	val, err := strconv.Atoi(raw[:end])
	if err != nil || val <= 0 {
		return 0, false
	}
	return val, true
}

// extractFirstImage returns the first element from a JSON/text array string of image URLs.
// Falls back to empty string on parse errors.
func extractFirstImage(raw string) string {
	if strings.TrimSpace(raw) == "" {
		return ""
	}
	// Try JSON array first
	var arr []string
	if err := json.Unmarshal([]byte(raw), &arr); err == nil && len(arr) > 0 && strings.TrimSpace(arr[0]) != "" {
		return arr[0]
	}
	// Fallback: comma-separated
	parts := strings.Split(raw, ",")
	if len(parts) > 0 {
		return strings.TrimSpace(parts[0])
	}
	return ""
}

func summarizeTradeItemChanges(items []string) string {
	if len(items) == 0 {
		return ""
	}
	if len(items) == 1 {
		return items[0]
	}
	if len(items) == 2 {
		return items[0] + " and " + items[1]
	}
	return fmt.Sprintf("%s, %s, and %d more", items[0], items[1], len(items)-2)
}

func NewTradeHandler() *TradeHandler {
	h := &TradeHandler{db: database.DB}
	h.ensureTradeRuntimeColumns()
	return h
}

// ensureTradeRuntimeColumns keeps critical trade-listing columns available even
// on local databases that were created before the latest runtime migrations.
func (h *TradeHandler) ensureTradeRuntimeColumns() {
	columns := []struct {
		name       string
		definition string
	}{
		{"countered_by", "INT NULL"},
		{"buyer_accepted", "BOOLEAN DEFAULT FALSE"},
		{"seller_accepted", "BOOLEAN DEFAULT FALSE"},
		{"parent_trade_id", "INT NULL"},
	}

	for _, col := range columns {
		var exists int
		err := h.db.QueryRow(`
			SELECT COUNT(*)
			FROM information_schema.COLUMNS
			WHERE TABLE_SCHEMA = DATABASE()
			  AND TABLE_NAME = 'trades'
			  AND COLUMN_NAME = ?
		`, col.name).Scan(&exists)
		if err != nil || exists > 0 {
			continue
		}
		if _, err := h.db.Exec(fmt.Sprintf("ALTER TABLE trades ADD COLUMN %s %s", col.name, col.definition)); err != nil {
			log.Printf("Warning: failed to add trade runtime column %s: %v", col.name, err)
		}
	}
}

// applyCancellationPenalty updates strikes and auto-suspends a user after
// repeated cancellations. A cancellation made while the trade was already
// ongoing (accepted/active/awaiting_confirmation) counts as a "strike";
// three strikes auto-suspends the account until an admin reviews it.
// Trust-score impact is computed live by GetUserStats from the trades table,
// so no separate score column is needed.
func (h *TradeHandler) applyCancellationPenalty(userID int, wasActive bool) {
	if !wasActive {
		return
	}

	// Admin bypass: Admins do not receive strikes for cancellations
	var role string
	_ = h.db.QueryRow("SELECT role FROM users WHERE id = ?", userID).Scan(&role)
	if role == "admin" {
		log.Printf("Ã¢â€žÂ¹Ã¯Â¸Â  [TradeHandler] Admin user %d cancelled an active trade, but strike was bypassed", userID)
		return
	}

	// Increment strike counter
	if _, err := h.db.Exec("UPDATE users SET strikes = COALESCE(strikes, 0) + 1 WHERE id = ?", userID); err != nil {
		log.Printf("applyCancellationPenalty: failed to increment strikes for user %d: %v", userID, err)
		return
	}

	// Count recent active-cancels in the trailing 30 days to decide on suspension.
	// Lifetime strikes alone are noisy for long-tenured users.
	var recentActiveCancels int
	_ = h.db.QueryRow(`
		SELECT COUNT(*)
		FROM trades
		WHERE cancelled_by = ?
		  AND cancelled_while_active = TRUE
		  AND cancelled_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 30 DAY)
	`, userID).Scan(&recentActiveCancels)

	if recentActiveCancels >= 3 {
		if _, err := h.db.Exec("UPDATE users SET is_suspended = TRUE WHERE id = ?", userID); err != nil {
			log.Printf("applyCancellationPenalty: failed to suspend user %d: %v", userID, err)
			return
		}
		_, _ = h.db.Exec(
			"INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'account', ?, FALSE)",
			userID,
			"Your account has been auto-suspended after 3 ongoing-trade cancellations in 30 days. An admin will review your account.",
		)
		log.Printf("applyCancellationPenalty: auto-suspended user %d (%d active-cancels in 30d)", userID, recentActiveCancels)
	} else {
		_, _ = h.db.Exec(
			"INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'account', ?, FALSE)",
			userID,
			fmt.Sprintf("Heads up: your trust score has been reduced for cancelling an ongoing trade (%d/3 strikes in the last 30 days).", recentActiveCancels),
		)
	}
}

func (h *TradeHandler) AddTradeLike(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}

	var payload struct {
		LikedProductID   int `json:"liked_product_id"`
		OfferedProductID int `json:"offered_product_id"`
	}
	if err := c.BodyParser(&payload); err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid request body"})
	}
	if payload.LikedProductID <= 0 || payload.OfferedProductID <= 0 {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Missing product IDs"})
	}

	// Validate offered product ownership and availability.
	var offeredOwnerID int
	var offeredStatus string
	if err := h.db.QueryRow("SELECT seller_id, status FROM products WHERE id = ?", payload.OfferedProductID).
		Scan(&offeredOwnerID, &offeredStatus); err != nil {
		return c.Status(404).JSON(models.APIResponse{Success: false, Error: "Offered product not found"})
	}
	if offeredOwnerID != userID {
		return c.Status(403).JSON(models.APIResponse{Success: false, Error: "You can only offer your own product"})
	}
	if offeredStatus != "available" {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Offered product is not available"})
	}

	// Validate liked product.
	var likedOwnerID int
	var likedStatus, likedTitle string
	if err := h.db.QueryRow("SELECT seller_id, status, title FROM products WHERE id = ?", payload.LikedProductID).
		Scan(&likedOwnerID, &likedStatus, &likedTitle); err != nil {
		return c.Status(404).JSON(models.APIResponse{Success: false, Error: "Liked product not found"})
	}
	if likedOwnerID == userID {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "You cannot like your own product"})
	}
	if likedStatus != "available" {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Liked product is not available"})
	}

	// Idempotency: if the like already exists for this offer, return success.
	var existingLikeID int
	if err := h.db.QueryRow(`
		SELECT id FROM trade_likes
		WHERE liker_id = ? AND liked_product_id = ? AND offered_product_id = ?
	`, userID, payload.LikedProductID, payload.OfferedProductID).Scan(&existingLikeID); err == nil {
		return c.JSON(models.APIResponse{Success: true, Data: fiber.Map{
			"already_liked": true,
		}})
	}

	insertLike := func() (sql.Result, error) {
		return h.db.Exec(`
			INSERT IGNORE INTO trade_likes (liker_id, liked_product_id, offered_product_id)
			VALUES (?, ?, ?)
		`, userID, payload.LikedProductID, payload.OfferedProductID)
	}

	res, err := insertLike()
	if err != nil {
		var mysqlErr *mysql.MySQLError
		if errors.As(err, &mysqlErr) && mysqlErr.Number == 1146 {
			if createErr := database.CreateTables(); createErr == nil {
				res, err = insertLike()
			}
		}
	}
	if err != nil {
		log.Printf("AddTradeLike: insert failed: %v", err)
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to like item"})
	}
	if rows, _ := res.RowsAffected(); rows == 0 {
		return c.JSON(models.APIResponse{Success: true, Data: fiber.Map{
			"already_liked": true,
		}})
	}

	// Notify owner of liked product.
	likerName := "Someone"
	_ = h.db.QueryRow("SELECT name FROM users WHERE id = ?", userID).Scan(&likerName)
	msg := fmt.Sprintf("%s is interested in your %s", likerName, likedTitle)
	_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_loop', ?, FALSE)", likedOwnerID, msg)
	publishNotification(likedOwnerID, msg)

	createdLoops := h.evaluateLikeLoops(userID)

	return c.JSON(models.APIResponse{Success: true, Data: fiber.Map{
		"created_loops": createdLoops,
	}})
}

func (h *TradeHandler) RemoveTradeLike(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}

	var payload struct {
		LikedProductID   int `json:"liked_product_id"`
		OfferedProductID int `json:"offered_product_id"`
	}
	if err := c.BodyParser(&payload); err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid request body"})
	}
	if payload.LikedProductID <= 0 || payload.OfferedProductID <= 0 {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Missing product IDs"})
	}

	var offeredOwnerID int
	if err := h.db.QueryRow("SELECT seller_id FROM products WHERE id = ?", payload.OfferedProductID).Scan(&offeredOwnerID); err != nil {
		return c.Status(404).JSON(models.APIResponse{Success: false, Error: "Offered product not found"})
	}
	if offeredOwnerID != userID {
		return c.Status(403).JSON(models.APIResponse{Success: false, Error: "You can only undo invites for your own product"})
	}

	var activeLoopCount int
	if err := h.db.QueryRow(`
		SELECT COUNT(*)
		FROM trade_like_loop_participants p
		JOIN trade_like_loops l ON l.id = p.loop_id
		WHERE p.user_id = ?
		  AND p.offered_product_id = ?
		  AND p.wanted_product_id = ?
		  AND l.status IN ('confirmed', 'ongoing', 'completed')
	`, userID, payload.OfferedProductID, payload.LikedProductID).Scan(&activeLoopCount); err == nil && activeLoopCount > 0 {
		return c.Status(409).JSON(models.APIResponse{
			Success: false,
			Error:   "This invite is already part of an active trade loop and can no longer be undone here",
		})
	}

	res, err := h.db.Exec(`
		DELETE FROM trade_likes
		WHERE liker_id = ? AND liked_product_id = ? AND offered_product_id = ?
	`, userID, payload.LikedProductID, payload.OfferedProductID)
	if err != nil {
		log.Printf("RemoveTradeLike: delete failed: %v", err)
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to undo invite"})
	}

	if rows, _ := res.RowsAffected(); rows == 0 {
		return c.JSON(models.APIResponse{Success: true, Data: fiber.Map{
			"already_removed": true,
			"cancelled_loops": 0,
		}})
	}

	cancelledLoops := h.cancelPendingLikeLoopsForInvite(userID, payload.OfferedProductID, payload.LikedProductID)

	return c.JSON(models.APIResponse{Success: true, Data: fiber.Map{
		"cancelled_loops": cancelledLoops,
	}})
}

func (h *TradeHandler) cancelPendingLikeLoopsForInvite(userID, offeredProductID, likedProductID int) int {
	rows, err := h.db.Query(`
		SELECT DISTINCT l.id
		FROM trade_like_loops l
		JOIN trade_like_loop_participants p ON p.loop_id = l.id
		WHERE p.user_id = ?
		  AND p.offered_product_id = ?
		  AND p.wanted_product_id = ?
		  AND l.status IN ('pending', 'partially_accepted', 'accepted')
	`, userID, offeredProductID, likedProductID)
	if err != nil {
		log.Printf("cancelPendingLikeLoopsForInvite: select failed: %v", err)
		return 0
	}
	defer rows.Close()

	loopIDs := []int{}
	for rows.Next() {
		var loopID int
		if err := rows.Scan(&loopID); err == nil && loopID > 0 {
			loopIDs = append(loopIDs, loopID)
		}
	}
	loopIDs = uniquePositiveInts(loopIDs)
	if len(loopIDs) == 0 {
		return 0
	}

	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(loopIDs)), ",")
	args := make([]interface{}, 0, len(loopIDs))
	for _, loopID := range loopIDs {
		args = append(args, loopID)
	}

	if _, err := h.db.Exec(fmt.Sprintf(`
		UPDATE trade_like_loops
		SET status = 'broken', updated_at = CURRENT_TIMESTAMP
		WHERE id IN (%s)
		  AND status IN ('pending', 'partially_accepted', 'accepted')
	`, placeholders), args...); err != nil {
		log.Printf("cancelPendingLikeLoopsForInvite: loop update failed: %v", err)
		return 0
	}

	if _, err := h.db.Exec(fmt.Sprintf(`
		UPDATE trade_like_loop_participants
		SET status = 'broken'
		WHERE loop_id IN (%s)
	`, placeholders), args...); err != nil {
		log.Printf("cancelPendingLikeLoopsForInvite: participant update failed: %v", err)
	}

	participantRows, err := h.db.Query(fmt.Sprintf(`
		SELECT DISTINCT user_id
		FROM trade_like_loop_participants
		WHERE loop_id IN (%s)
	`, placeholders), args...)
	if err == nil {
		defer participantRows.Close()
		affectedUserIDs := []int{}
		for participantRows.Next() {
			var participantUserID int
			if err := participantRows.Scan(&participantUserID); err == nil && participantUserID > 0 {
				affectedUserIDs = append(affectedUserIDs, participantUserID)
			}
		}
		affectedUserIDs = uniquePositiveInts(affectedUserIDs)
		if len(affectedUserIDs) > 0 {
			undoerName := "A user"
			_ = h.db.QueryRow("SELECT name FROM users WHERE id = ?", userID).Scan(&undoerName)

			cachePlaceholders := strings.TrimSuffix(strings.Repeat("?,", len(affectedUserIDs)), ",")
			cacheArgs := make([]interface{}, 0, len(affectedUserIDs))
			for _, affectedUserID := range affectedUserIDs {
				cacheArgs = append(cacheArgs, affectedUserID)
			}
			_, _ = h.db.Exec(fmt.Sprintf("DELETE FROM trade_loop_cache WHERE user_id IN (%s)", cachePlaceholders), cacheArgs...)

			for _, affectedUserID := range affectedUserIDs {
				if affectedUserID == userID {
					continue
				}
				msg := fmt.Sprintf("%s undid their invite, so the trade match was cancelled.", undoerName)
				_, _ = h.db.Exec(
					"INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_loop', ?, FALSE)",
					affectedUserID, msg,
				)
				publishNotification(affectedUserID, msg)
			}
		}
	}

	return len(loopIDs)
}

func (h *TradeHandler) evaluateLikeLoops(userID int) []string {
	loopsCreated := []string{}

	edges, err := h.loadLikeEdges()
	if err != nil {
		log.Printf("evaluateLikeLoops: load edges failed: %v", err)
		return loopsCreated
	}
	byUser := map[int][]likeEdge{}
	for _, edge := range edges {
		byUser[edge.FromUser] = append(byUser[edge.FromUser], edge)
	}

	// Detect mutual likes for 2-person loops.
	loopsCreated = append(loopsCreated, h.createMutualLikeLoops(byUser, userID)...)

	// Detect 3-5 cycles from the current user.
	// We do this second and only if products aren't already taken by 2-way matches
	loopsCreated = append(loopsCreated, h.createLikeCycles(byUser, userID, 5)...)

	return loopsCreated
}

func (h *TradeHandler) reprocessEligibleLoopsForUser(userID int) []string {
	h.promotePendingInitiatorUpgradeLoops(userID)
	h.normalizeConfirmedLoopsForUser(userID)
	created := h.evaluateLikeLoops(userID)
	if len(created) > 0 {
		_, _ = h.db.Exec("DELETE FROM trade_loop_cache WHERE user_id = ?", userID)
	}
	return created
}

func (h *TradeHandler) promotePendingInitiatorUpgradeLoops(userID int) {
	_, _ = h.db.Exec(`
		UPDATE multiway_trades
		SET status = 'pending_user3', updated_at = NOW()
		WHERE status = 'pending_initiator_upgrade'
		  AND expires_at > NOW()
		  AND (initiator_user_id = ? OR user1_id = ? OR user2_id = ? OR user3_id = ?)
	`, userID, userID, userID, userID)
}

func (h *TradeHandler) normalizeConfirmedLoopsForUser(userID int) {
	_, _ = h.db.Exec(`
		UPDATE trade_like_loops l
		JOIN trade_like_loop_participants p ON p.loop_id = l.id
		SET l.status = 'ongoing',
		    l.confirmed_at = COALESCE(l.confirmed_at, CURRENT_TIMESTAMP),
		    l.updated_at = CURRENT_TIMESTAMP
		WHERE p.user_id = ?
		  AND l.status = 'confirmed'
	`, userID)

	_, _ = h.db.Exec(`
		UPDATE multiway_trades
		SET status = 'active',
		    ongoing_deadline = COALESCE(ongoing_deadline, DATE_ADD(NOW(), INTERVAL 7 DAY)),
		    updated_at = NOW()
		WHERE status = 'confirmed'
		  AND (user1_id = ? OR user2_id = ? OR user3_id = ?)
	`, userID, userID, userID)
}

func (h *TradeHandler) loadLikeEdges() ([]likeEdge, error) {
	rows, err := h.db.Query(`
		SELECT l.liker_id, p.seller_id, l.offered_product_id, l.liked_product_id,
		       u1.name, u2.name,
		       op.title, op.image_url, p.title, p.image_url
		FROM trade_likes l
		JOIN products p ON p.id = l.liked_product_id
		JOIN products op ON op.id = l.offered_product_id
		JOIN users u1 ON u1.id = l.liker_id
		JOIN users u2 ON u2.id = p.seller_id
		WHERE p.status = 'available'
		  AND op.status = 'available'
		  AND op.seller_id = l.liker_id
		  AND p.seller_id != l.liker_id
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var edges []likeEdge
	for rows.Next() {
		var edge likeEdge
		var offeredImage, wantedImage sql.NullString
		if err := rows.Scan(&edge.FromUser, &edge.ToUser, &edge.OfferedProductID, &edge.WantedProductID,
			&edge.FromUserName, &edge.ToUserName, &edge.OfferedTitle, &offeredImage, &edge.WantedTitle, &wantedImage); err != nil {
			continue
		}
		if offeredImage.Valid {
			edge.OfferedImage = offeredImage.String
		}
		if wantedImage.Valid {
			edge.WantedImage = wantedImage.String
		}
		edges = append(edges, edge)
	}

	return edges, nil
}

func (h *TradeHandler) createMutualLikeLoops(byUser map[int][]likeEdge, userID int) []string {
	created := []string{}
	for _, edge := range byUser[userID] {
		for _, back := range byUser[edge.ToUser] {
			if back.ToUser != userID {
				continue
			}
			if back.OfferedProductID != edge.WantedProductID || back.WantedProductID != edge.OfferedProductID {
				continue
			}

			participants := []likeParticipant{
				{UserID: edge.FromUser, UserName: edge.FromUserName, OfferedProductID: edge.OfferedProductID, OfferedTitle: edge.OfferedTitle, OfferedImage: edge.OfferedImage, WantedProductID: edge.WantedProductID, WantedTitle: edge.WantedTitle, Position: 0, Status: "pending"},
				{UserID: edge.ToUser, UserName: edge.ToUserName, OfferedProductID: back.OfferedProductID, OfferedTitle: back.OfferedTitle, OfferedImage: back.OfferedImage, WantedProductID: back.WantedProductID, WantedTitle: back.WantedTitle, Position: 1, Status: "pending"},
			}

			loopID, createdLoop := h.createLikeLoop(participants)
			if createdLoop {
				created = append(created, loopIDFromLikeLoopID(loopID))
				h.notifyLikeLoopParticipants(participants, "A mutual like created a pending trade. Confirm to proceed.")
			}
		}
	}
	return created
}

func (h *TradeHandler) createLikeCycles(byUser map[int][]likeEdge, userID int, maxLen int) []string {
	created := []string{}
	visitedUsers := map[int]bool{userID: true}
	usedOffers := map[int]bool{}
	usedWants := map[int]bool{}
	var path []likeEdge

	var dfs func(current int)
	dfs = func(current int) {
		if len(path) >= maxLen {
			return
		}
		for _, edge := range byUser[current] {
			if usedOffers[edge.OfferedProductID] || usedWants[edge.WantedProductID] {
				continue
			}
			if edge.ToUser == userID {
				if len(path) >= 1 {
					cycle := append(append([]likeEdge{}, path...), edge)
					if len(cycle) >= 3 && len(cycle) <= 5 {
						participants := make([]likeParticipant, 0, len(cycle))
						for idx, c := range cycle {
							participants = append(participants, likeParticipant{
								UserID:           c.FromUser,
								UserName:         c.FromUserName,
								OfferedProductID: c.OfferedProductID,
								OfferedTitle:     c.OfferedTitle,
								OfferedImage:     c.OfferedImage,
								WantedProductID:  c.WantedProductID,
								WantedTitle:      c.WantedTitle,
								Position:         idx,
								Status:           "pending",
							})
						}

						loopID, createdLoop := h.createLikeLoop(participants)
						if createdLoop {
							created = append(created, loopIDFromLikeLoopID(loopID))
							h.notifyLikeLoopParticipants(participants, "A trade loop was found. Confirm to proceed.")
						}
					}
				}
				continue
			}
			if visitedUsers[edge.ToUser] {
				continue
			}
			visitedUsers[edge.ToUser] = true
			usedOffers[edge.OfferedProductID] = true
			usedWants[edge.WantedProductID] = true
			path = append(path, edge)
			dfs(edge.ToUser)
			path = path[:len(path)-1]
			delete(visitedUsers, edge.ToUser)
			delete(usedOffers, edge.OfferedProductID)
			delete(usedWants, edge.WantedProductID)
		}
	}

	for _, edge := range byUser[userID] {
		visitedUsers[edge.ToUser] = true
		usedOffers[edge.OfferedProductID] = true
		usedWants[edge.WantedProductID] = true
		path = append(path, edge)
		dfs(edge.ToUser)
		path = path[:len(path)-1]
		delete(visitedUsers, edge.ToUser)
		delete(usedOffers, edge.OfferedProductID)
		delete(usedWants, edge.WantedProductID)
	}

	return created
}

func (h *TradeHandler) createLikeLoop(participants []likeParticipant) (int, bool) {
	if len(participants) < 2 || len(participants) > 5 {
		return 0, false
	}

	productIDs := make([]int, 0, len(participants)*2)
	offeredProductIDs := map[int]bool{}
	wantedProductIDs := map[int]bool{}
	seenUserIDs := map[int]bool{}
	for _, p := range participants {
		if p.UserID <= 0 || seenUserIDs[p.UserID] || p.OfferedProductID <= 0 || p.WantedProductID <= 0 {
			return 0, false
		}
		seenUserIDs[p.UserID] = true
		if offeredProductIDs[p.OfferedProductID] || wantedProductIDs[p.WantedProductID] {
			return 0, false
		}
		offeredProductIDs[p.OfferedProductID] = true
		wantedProductIDs[p.WantedProductID] = true
		productIDs = append(productIDs, p.OfferedProductID)
	}
	if len(offeredProductIDs) != len(participants) || len(wantedProductIDs) != len(participants) {
		return 0, false
	}
	for wantedID := range wantedProductIDs {
		if !offeredProductIDs[wantedID] {
			return 0, false
		}
	}
	if h.productsHaveActiveCommitment(productIDs, "") {
		return 0, false
	}

	// PRE-CHECK: If this is a multi-way loop (len > 2), check if any participants
	// are already assigned to a direct 1-to-1 match (len == 2).
	// This prevents discovery of larger loops from disrupting active direct matches.
	if len(participants) > 2 {
		placeholders := make([]string, len(productIDs))
		args := make([]interface{}, 0, len(participants)*4)
		for i, pid := range productIDs {
			placeholders[i] = "?"
			args = append(args, pid)
		}
		// Second set of args for the second IN clause
		for _, pid := range productIDs {
			args = append(args, pid)
		}

		checkQuery := fmt.Sprintf(`
			SELECT COUNT(*) 
			FROM trade_like_loop_participants p
			JOIN trade_like_loops l ON l.id = p.loop_id
			WHERE l.status = 'pending'
			  AND (p.offered_product_id IN (%s) OR p.wanted_product_id IN (%s))
			  AND (SELECT COUNT(*) FROM trade_like_loop_participants WHERE loop_id = l.id) <= 2
		`, strings.Join(placeholders, ","), strings.Join(placeholders, ","))

		var existingSmallLoops int
		_ = h.db.QueryRow(checkQuery, args...).Scan(&existingSmallLoops)
		if existingSmallLoops > 0 {
			return 0, false
		}
	}

	loopKey := buildLikeLoopKey(participants)

	tx, err := h.db.Begin()
	if err != nil {
		return 0, false
	}
	defer tx.Rollback()

	var existingID int
	var existingStatus string
	err = tx.QueryRow("SELECT id, status FROM trade_like_loops WHERE loop_key = ? FOR UPDATE", loopKey).Scan(&existingID, &existingStatus)
	if err == nil {
		switch existingStatus {
		case "rejected", "cancelled", "cancelled_due_to_conflict", "broken", "expired":
			if _, err := tx.Exec(`
				UPDATE trade_like_loops
				SET status = 'pending',
				    confirmed_at = NULL,
				    updated_at = CURRENT_TIMESTAMP
				WHERE id = ?
			`, existingID); err != nil {
				return 0, false
			}
			if _, err := tx.Exec("DELETE FROM trade_like_loop_participants WHERE loop_id = ?", existingID); err != nil {
				return 0, false
			}
			for _, p := range participants {
				if _, err := tx.Exec(`
					INSERT INTO trade_like_loop_participants
					(loop_id, user_id, offered_product_id, wanted_product_id, position_in_loop, status, confirmed_at, is_reviewed, reviewed_at)
					VALUES (?, ?, ?, ?, ?, 'pending', NULL, FALSE, NULL)
				`, existingID, p.UserID, p.OfferedProductID, p.WantedProductID, p.Position); err != nil {
					return 0, false
				}
			}
			if err := tx.Commit(); err != nil {
				return 0, false
			}
			return existingID, true
		default:
			return existingID, false
		}
	}
	if err != sql.ErrNoRows {
		return 0, false
	}

	res, err := tx.Exec("INSERT INTO trade_like_loops (loop_key, status) VALUES (?, 'pending')", loopKey)
	if err != nil {
		return 0, false
	}
	loopID64, _ := res.LastInsertId()
	loopID := int(loopID64)

	for _, p := range participants {
		if _, err := tx.Exec(`
			INSERT INTO trade_like_loop_participants
			(loop_id, user_id, offered_product_id, wanted_product_id, position_in_loop, status)
			VALUES (?, ?, ?, ?, ?, 'pending')
		`, loopID, p.UserID, p.OfferedProductID, p.WantedProductID, p.Position); err != nil {
			return 0, false
		}
	}

	if err := tx.Commit(); err != nil {
		return 0, false
	}

	return loopID, true
}

func (h *TradeHandler) notifyLikeLoopParticipants(participants []likeParticipant, message string) {
	for _, p := range participants {
		_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_loop', ?, FALSE)", p.UserID, message)
		publishNotification(p.UserID, message, "trade_loop")
	}
}

func uniquePositiveInts(values []int) []int {
	seen := map[int]bool{}
	out := []int{}
	for _, v := range values {
		if v <= 0 || seen[v] {
			continue
		}
		seen[v] = true
		out = append(out, v)
	}
	return out
}

func normalizeOfferProductIDs(values []int) ([]int, error) {
	normalized := uniquePositiveInts(values)
	if len(normalized) != len(values) {
		return nil, fmt.Errorf("Offered items must be valid and cannot contain duplicates")
	}
	return normalized, nil
}

func validateOptionalWholePesoAmount(amount *float64) error {
	if amount == nil {
		return nil
	}
	if *amount <= 0 {
		return fmt.Errorf("Offer money must be greater than 0")
	}
	if math.Trunc(*amount) != *amount {
		return fmt.Errorf("Offer money must be a clean whole PHP amount")
	}
	return nil
}

func (h *TradeHandler) ensureOfferedProductsAvailableForUserTx(tx *sql.Tx, userID int, productIDs []int, excludeTradeID int) error {
	productIDs = uniquePositiveInts(productIDs)
	if len(productIDs) == 0 {
		return nil
	}

	for _, productID := range productIDs {
		var ownerID int
		var status string
		if err := tx.QueryRow("SELECT seller_id, status FROM products WHERE id = ? FOR UPDATE", productID).Scan(&ownerID, &status); err != nil {
			if err == sql.ErrNoRows {
				return fmt.Errorf("One of your offered products was not found")
			}
			return fmt.Errorf("Failed to validate offered products")
		}
		if ownerID != userID {
			return fmt.Errorf("You can only offer your own products")
		}
		if status != "available" {
			return fmt.Errorf("One of your offered products is no longer available")
		}
	}

	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(productIDs)), ",")
	args := make([]interface{}, 0, 1+len(productIDs)*2)
	args = append(args, excludeTradeID)
	for _, pid := range productIDs {
		args = append(args, pid)
	}
	for _, pid := range productIDs {
		args = append(args, pid)
	}

	var conflictingTradeID int
	err := tx.QueryRow(fmt.Sprintf(`
		SELECT t.id
		FROM trades t
		LEFT JOIN trade_items ti ON ti.trade_id = t.id
		WHERE t.id <> ?
		  AND t.status IN ('pending', 'pending_multiway', 'countered', 'accepted', 'accepted_by_one', 'active', 'ongoing', 'awaiting_confirmation', 'multiway_active')
		  AND (t.target_product_id IN (%s) OR ti.product_id IN (%s))
		LIMIT 1
	`, placeholders, placeholders), args...).Scan(&conflictingTradeID)
	if err == nil {
		return fmt.Errorf("One of your selected items is already tied to an active or pending offer")
	}
	if err != sql.ErrNoRows {
		return fmt.Errorf("Failed to check offered item conflicts")
	}

	return nil
}

func (h *TradeHandler) productsHaveActiveCommitment(productIDs []int, excludeLoopKey string) bool {
	valid := uniquePositiveInts(productIDs)
	if len(valid) == 0 {
		return false
	}
	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(valid)), ",")
	args := make([]interface{}, 0, len(valid)*5+1)
	for _, pid := range valid {
		args = append(args, pid)
	}
	var lockedCount int
	_ = h.db.QueryRow(fmt.Sprintf("SELECT COUNT(*) FROM products WHERE id IN (%s) AND status NOT IN ('available')", placeholders), args...).Scan(&lockedCount)
	if lockedCount > 0 {
		return true
	}

	args = args[:0]
	for _, pid := range valid {
		args = append(args, pid)
	}
	for _, pid := range valid {
		args = append(args, pid)
	}
	var activeTrades int
	_ = h.db.QueryRow(fmt.Sprintf(`
		SELECT COUNT(DISTINCT t.id)
		FROM trades t
		LEFT JOIN trade_items ti ON ti.trade_id = t.id
		WHERE t.status IN ('accepted','active','ongoing','awaiting_confirmation','multiway_active','completed','auto_completed')
		  AND (t.target_product_id IN (%s) OR ti.product_id IN (%s))
	`, placeholders, placeholders), args...).Scan(&activeTrades)
	if activeTrades > 0 {
		return true
	}

	args = args[:0]
	if excludeLoopKey != "" {
		args = append(args, excludeLoopKey)
	}
	for _, pid := range valid {
		args = append(args, pid)
	}
	for _, pid := range valid {
		args = append(args, pid)
	}
	loopWhere := "l.status IN ('accepted','confirmed','ongoing','completed')"
	if excludeLoopKey != "" {
		loopWhere += " AND l.loop_key <> ?"
	}
	var activeLoops int
	_ = h.db.QueryRow(fmt.Sprintf(`
		SELECT COUNT(DISTINCT l.id)
		FROM trade_like_loops l
		JOIN trade_like_loop_participants p ON p.loop_id = l.id
		WHERE `+loopWhere+`
		  AND (p.offered_product_id IN (%s) OR p.wanted_product_id IN (%s))
	`, placeholders, placeholders), args...).Scan(&activeLoops)
	if activeLoops > 0 {
		return true
	}

	args = args[:0]
	for i := 0; i < 5; i++ {
		for _, pid := range valid {
			args = append(args, pid)
		}
	}
	var activeChains int
	_ = h.db.QueryRow(fmt.Sprintf(`
		SELECT COUNT(DISTINCT mw.id)
		FROM multiway_trades mw
		LEFT JOIN trades t ON t.id = mw.original_trade_id
		LEFT JOIN trade_items ti ON ti.trade_id = t.id
		WHERE mw.status IN ('user3_accepted','active','completed','history')
		  AND (
		    mw.user1_product_id IN (%s) OR mw.user2_product_id IN (%s) OR mw.user3_product_id IN (%s)
		    OR t.target_product_id IN (%s) OR ti.product_id IN (%s)
		  )
	`, placeholders, placeholders, placeholders, placeholders, placeholders), args...).Scan(&activeChains)
	return activeChains > 0
}
func (h *TradeHandler) CreateTrade(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}
	h.ensureTradeRuntimeColumns()

	var payload models.TradeCreate
	if err := c.BodyParser(&payload); err != nil {
		log.Printf("BodyParser error: %v", err)
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid request body"})
	}

	log.Printf("Received trade payload: %+v", payload)
	if err := validateOptionalWholePesoAmount(payload.OfferedCashAmount); err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: err.Error()})
	}
	normalizedOfferIDs, err := normalizeOfferProductIDs(payload.OfferedProductIDs)
	if err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: err.Error()})
	}
	payload.OfferedProductIDs = normalizedOfferIDs
	if payload.TargetProductID <= 0 {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid target product ID"})
	}
	hasItems := len(payload.OfferedProductIDs) > 0
	hasCash := payload.OfferedCashAmount != nil && *payload.OfferedCashAmount > 0
	if !hasItems && !hasCash {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "You must offer at least one item or a cash amount"})
	}

	// Determine if this is a peer-to-peer trade or a buyout
	// Trades (peer-to-peer): buyer offers items (hasItems=true)
	// Buyouts: buyer only offers cash (hasItems=false, hasCash=true)
	isPeerToPeerTrade := hasItems

	// Validate trade option based on offer type
	if isPeerToPeerTrade && payload.TradeOption != "meetup" {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Peer-to-peer trades must use the 'meetup' option. Delivery is only available for buyout offers."})
	}

	// Validate delivery address is provided when trade option is delivery (only for buyouts)
	if payload.TradeOption == "delivery" && strings.TrimSpace(payload.DeliveryAddress) == "" {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Delivery address is required when choosing delivery option"})
	}

	// Check if target product is still available and get selection limit
	var targetStatus string
	var maxItems int
	err = h.db.QueryRow("SELECT status FROM products WHERE id = ?", payload.TargetProductID).Scan(&targetStatus)
	if err != nil {
		if err == sql.ErrNoRows {
			return c.Status(404).JSON(models.APIResponse{Success: false, Error: "Target product not found"})
		}
		log.Printf("Error fetching target product %d: %v", payload.TargetProductID, err)
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to validate target product"})
	}
	// Optionally read selection limit (column may not exist in DB yet)
	var colExists int
	_ = h.db.QueryRow("SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'products' AND COLUMN_NAME = 'max_items_per_offer'").Scan(&colExists)
	if colExists > 0 {
		_ = h.db.QueryRow("SELECT COALESCE(max_items_per_offer, 0) FROM products WHERE id = ?", payload.TargetProductID).Scan(&maxItems)
	}
	if targetStatus != "available" {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "This product is no longer available for trading"})
	}

	// Validate selection limit
	if maxItems > 0 && len(payload.OfferedProductIDs) > maxItems {
		return c.Status(400).JSON(models.APIResponse{
			Success: false,
			Error:   fmt.Sprintf("This product only allows up to %d items per trade offer", maxItems),
		})
	}

	// Check if offered products are still available
	for _, productID := range payload.OfferedProductIDs {
		var offeredStatus string
		err := h.db.QueryRow("SELECT status FROM products WHERE id = ?", productID).Scan(&offeredStatus)
		if err != nil {
			if err == sql.ErrNoRows {
				return c.Status(404).JSON(models.APIResponse{Success: false, Error: "One of your offered products not found"})
			}
			log.Printf("Error fetching offered product %d: %v", productID, err)
			return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to validate offered products"})
		}
		if offeredStatus != "available" {
			return c.Status(400).JSON(models.APIResponse{Success: false, Error: "One of your offered products is no longer available"})
		}
	}

	// Check if user already has an active trade request for this product (any non-terminal status)
	var existingTradeID int
	err = h.db.QueryRow(`
		SELECT id FROM trades
		WHERE buyer_id = ? AND target_product_id = ?
		  AND status IN ('pending', 'pending_multiway', 'countered', 'accepted', 'accepted_by_one', 'active', 'ongoing', 'awaiting_confirmation', 'multiway_active')
		LIMIT 1
	`, userID, payload.TargetProductID).Scan(&existingTradeID)

	// If no error (meaning a row was found), user already has an active trade request
	if err == nil {
		return c.Status(409).JSON(models.APIResponse{Success: false, Error: "You already have an active offer or trade for this product"})
	}
	// Any error other than sql.ErrNoRows is a real error
	if err != sql.ErrNoRows {
		log.Printf("Error checking existing trades: %v", err)
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to check existing trades"})
	}

	// Enforce plan-configured active trade limits.
	var strikes int
	var role string
	_ = h.db.QueryRow("SELECT strikes, role FROM users WHERE id = ?", userID).Scan(&strikes, &role)

	// Strike Ladder Enforcement: 2 strikes = Restricted (cannot post/send new offers)
	// Admin bypass: Admins are never restricted by strikes
	if strikes >= 2 && role != "admin" {
		return c.Status(403).JSON(models.APIResponse{
			Success: false,
			Error:   "Account Restricted: You cannot send new trade offers because you have 2 or more strikes. You can still finish your ongoing trades.",
		})
	} else if strikes >= 2 && role == "admin" {
		log.Printf("Ã¢Å¡Â Ã¯Â¸Â  [CreateTrade] Admin user %d has %d strikes but is allowed to send trade due to bypass", userID, strikes)
	}

	plan, _ := getUserPlanCapabilities(h.db, userID)
	activeTradeLimit := getCapInt(plan.Capabilities, "active_trade_limit", 5)
	if activeTradeLimit > 0 && activeTradeLimit < 999999 {
		var pendingCount int
		_ = h.db.QueryRow("SELECT COUNT(*) FROM trades WHERE buyer_id = ? AND status IN ('pending', 'pending_multiway', 'countered', 'accepted', 'accepted_by_one', 'active', 'ongoing', 'awaiting_confirmation', 'multiway_active')", userID).Scan(&pendingCount)
		if pendingCount >= activeTradeLimit {
			return c.Status(403).JSON(models.APIResponse{Success: false, Error: fmt.Sprintf("Your current plan (%s) allows up to %d active trade offer(s).", plan.Name, activeTradeLimit)})
		}
	}

	// Use a transaction to ensure trade and items are created together
	tx, err := h.db.Begin()
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to start transaction"})
	}

	// Lookup target product to get seller_id inside the transaction
	var sellerID int
	var lockedTargetStatus string
	if err := tx.QueryRow("SELECT seller_id, status FROM products WHERE id = ? FOR UPDATE", payload.TargetProductID).Scan(&sellerID, &lockedTargetStatus); err != nil {
		_ = tx.Rollback()
		if err == sql.ErrNoRows {
			return c.Status(404).JSON(models.APIResponse{Success: false, Error: "Target product not found"})
		}
		log.Printf("Error fetching target product seller_id %d: %v", payload.TargetProductID, err)
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to validate target product"})
	}
	if sellerID == userID {
		_ = tx.Rollback()
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Cannot propose a trade on your own product"})
	}
	if lockedTargetStatus != "available" {
		_ = tx.Rollback()
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "This product is no longer available for trading"})
	}
	if err := h.ensureOfferedProductsAvailableForUserTx(tx, userID, payload.OfferedProductIDs, 0); err != nil {
		_ = tx.Rollback()
		return c.Status(409).JSON(models.APIResponse{Success: false, Error: err.Error()})
	}

	// Insert trade with all fields in a single robust call
	log.Printf("Executing single-step trade insert for trade from %d to %d (seller)", userID, sellerID)
	res, err := tx.Exec(`
		INSERT INTO trades 
		(buyer_id, seller_id, target_product_id, status, buyer_accepted, trade_option, meeting_type, delivery_address, delivery_type, delivery_instructions, message, offered_cash_amount, payment_method) 
		VALUES (?, ?, ?, 'pending', TRUE, ?, ?, ?, ?, ?, ?, ?, ?)`,
		userID, sellerID, payload.TargetProductID, payload.TradeOption, payload.MeetingType, payload.DeliveryAddress, payload.DeliveryType, payload.DeliveryInstructions, payload.Message, payload.OfferedCashAmount, payload.PaymentMethod)

	if err != nil {
		log.Printf("Trade creation failed: %v", err)
		_ = tx.Rollback()
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to create trade. Please ensure you filled all required fields."})
	}

	log.Printf("Trade fully created and updated successfully")
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

	autoConfirmed := false
	reverseTradeID := 0
	reverseMeetingMismatchTradeID := 0
	reverseMeetingMismatchType := ""
	if isPeerToPeerTrade && payload.TradeOption == "meetup" {
		meetingType := strings.TrimSpace(payload.MeetingType)
		if meetingType == "" {
			meetingType = "meetup"
		}
		reverseTradeID, autoConfirmed, err = h.findExactReciprocalTradeTx(tx, tradeID, userID, sellerID, payload.TargetProductID, payload.OfferedProductIDs, payload.OfferedCashAmount, meetingType)
		if err != nil {
			_ = tx.Rollback()
			return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to verify reciprocal trade match"})
		}
		if autoConfirmed {
			combinedProductIDs := uniquePositiveInts([]int{payload.TargetProductID, payload.OfferedProductIDs[0]})
			if err := h.ensureProductsTradeableTx(tx, combinedProductIDs); err != nil {
				_ = tx.Rollback()
				return c.Status(409).JSON(models.APIResponse{Success: false, Error: err.Error()})
			}

			if _, err := tx.Exec(`
				UPDATE trades
				SET status = 'active',
				    buyer_accepted = TRUE,
				    seller_accepted = TRUE,
				    updated_at = CURRENT_TIMESTAMP
				WHERE id IN (?, ?)
			`, tradeID, reverseTradeID); err != nil {
				_ = tx.Rollback()
				return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to auto-confirm reciprocal trade"})
			}

			if err := h.setProductStatusForTrade(tx, tradeID, "in_trade"); err != nil {
				_ = tx.Rollback()
				return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to lock products for reciprocal trade"})
			}

			if _, err := tx.Exec(`
				UPDATE trades t
				LEFT JOIN trade_items ti ON ti.trade_id = t.id
				SET t.status='cancelled_due_to_conflict',
				    t.cancellation_reason='Product committed to another trade',
				    t.cancelled_by=?,
				    t.cancelled_at=NOW(),
				    t.buyer_accepted=FALSE,
				    t.seller_accepted=FALSE,
				    t.updated_at=CURRENT_TIMESTAMP
				WHERE t.id NOT IN (?, ?)
				  AND t.status IN ('pending','countered','pending_multiway','accepted','accepted_by_one')
				  AND (t.target_product_id IN (?, ?) OR ti.product_id IN (?, ?))
			`, userID, tradeID, reverseTradeID, combinedProductIDs[0], combinedProductIDs[1], combinedProductIDs[0], combinedProductIDs[1]); err != nil {
				_ = tx.Rollback()
				return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to clear conflicting trades"})
			}
		}
		if !autoConfirmed {
			reverseMeetingMismatchTradeID, reverseMeetingMismatchType, _, err = h.findReciprocalTradeWithDifferentMeetingTypeTx(tx, tradeID, userID, sellerID, payload.TargetProductID, payload.OfferedProductIDs, payload.OfferedCashAmount, meetingType)
			if err != nil {
				_ = tx.Rollback()
				return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to verify reciprocal trade method mismatch"})
			}
		}
	}

	// Insert additional target products as seller-side trade items (multi-target bundle)
	for _, pid := range payload.AdditionalTargetProductIDs {
		if pid == payload.TargetProductID {
			continue // skip duplicate of primary target
		}
		var addStatus string
		var addSellerID int
		if err := tx.QueryRow("SELECT status, seller_id FROM products WHERE id = ?", pid).Scan(&addStatus, &addSellerID); err != nil {
			_ = tx.Rollback()
			return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Additional target product not found"})
		}
		if addSellerID != sellerID {
			_ = tx.Rollback()
			return c.Status(400).JSON(models.APIResponse{Success: false, Error: "All target products must belong to the same seller"})
		}
		if addStatus != "available" {
			_ = tx.Rollback()
			return c.Status(400).JSON(models.APIResponse{Success: false, Error: "One of the additional target products is no longer available"})
		}
		if _, err := tx.Exec("INSERT INTO trade_items (trade_id, product_id, offered_by) VALUES (?, ?, 'seller')", tradeID, pid); err != nil {
			_ = tx.Rollback()
			return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to attach additional target items"})
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
	if autoConfirmed {
		autoMsgBuyer := "Your trade was automatically confirmed because both sides sent matching offers for " + productTitle
		autoMsgSeller := buyerName + " sent the exact reverse offer for " + productTitle + ", so the trade was automatically confirmed."
		_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", userID, autoMsgBuyer)
		_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", sellerID, autoMsgSeller)
		publishNotification(userID, autoMsgBuyer, "trade_update")
		publishNotification(sellerID, autoMsgSeller, "trade_update")
		publishToUser(userID, sseEvent{Type: "trade_updated", Data: fiber.Map{"trade_id": tradeID, "status": "active", "auto_confirmed": true}})
		publishToUser(sellerID, sseEvent{Type: "trade_updated", Data: fiber.Map{"trade_id": reverseTradeID, "status": "active", "auto_confirmed": true}})
		_, _ = h.db.Exec("INSERT INTO trade_events (trade_id, actor_id, from_status, to_status, note) VALUES (?, ?, 'pending', 'active', ?)", tradeID, userID, "Auto-confirmed by exact reciprocal offer")
		if reverseTradeID > 0 {
			_, _ = h.db.Exec("INSERT INTO trade_events (trade_id, actor_id, from_status, to_status, note) VALUES (?, ?, 'pending', 'active', ?)", reverseTradeID, userID, "Auto-confirmed by exact reciprocal offer")
		}
	} else if reverseMeetingMismatchTradeID > 0 {
		currentMeetingType := strings.TrimSpace(payload.MeetingType)
		if currentMeetingType == "" {
			currentMeetingType = "meetup"
		}
		formatMeetingType := func(v string) string {
			switch strings.ToLower(strings.TrimSpace(v)) {
			case "pickup":
				return "Pickup"
			default:
				return "Meetup"
			}
		}
		mismatchMsgToBuyer := fmt.Sprintf("A reverse offer for %s was found, but it stayed pending because the trade methods do not match: your %s vs their %s.", productTitle, formatMeetingType(currentMeetingType), formatMeetingType(reverseMeetingMismatchType))
		mismatchMsgToSeller := fmt.Sprintf("%s sent a reverse offer for %s, but it stayed pending because the trade methods do not match: your %s vs their %s.", buyerName, productTitle, formatMeetingType(reverseMeetingMismatchType), formatMeetingType(currentMeetingType))
		_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", userID, mismatchMsgToBuyer)
		_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", sellerID, mismatchMsgToSeller)
		publishNotification(userID, mismatchMsgToBuyer, "trade_update")
		publishNotification(sellerID, mismatchMsgToSeller, "trade_update")
	} else {
		_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_offer', ?, FALSE)", sellerID, notifMsg)
		publishNotification(sellerID, notifMsg, "trade_offer")
	}

	// Ensure chat conversation exists and add a system message
	convID, _ := ensureConversation(payload.TargetProductID, userID, sellerID)
	if autoConfirmed {
		_, _, _ = saveMessage(convID, userID, "Matching reverse offers detected. This trade was automatically confirmed for "+productTitle+".")
	} else if reverseMeetingMismatchTradeID > 0 {
		_, _, _ = saveMessage(convID, userID, "A reverse offer was detected for "+productTitle+", but it stayed pending because the selected trade methods do not match.")
	} else {
		_, _, _ = saveMessage(convID, userID, "Trade offer started for "+productTitle+".")
	}

	// Return created trade (items will appear when listing/fetching details)
	status := "pending"
	if autoConfirmed {
		status = "active"
	}
	trade := models.Trade{ID: tradeID, BuyerID: userID, SellerID: sellerID, TargetProductID: payload.TargetProductID, Status: status, Message: payload.Message, OfferedCash: payload.OfferedCashAmount, CreatedAt: time.Now(), UpdatedAt: time.Now()}

	// Realtime notify seller via SSE
	publishToUser(sellerID, sseEvent{Type: "trade_created", Data: fiber.Map{
		"trade_id":            tradeID,
		"buyer_id":            userID,
		"target_product_id":   payload.TargetProductID,
		"message":             payload.Message,
		"offered_cash_amount": payload.OfferedCashAmount,
		"status":              status,
		"auto_confirmed":      autoConfirmed,
	}})

	return c.Status(201).JSON(models.APIResponse{Success: true, Message: "Trade created", Data: trade})
}

// CheckForTradeLoops builds the trade graph and notifies users if loops are found.
func (h *TradeHandler) CheckForTradeLoops() {
	log.Println("Checking for trade loops...")
	tradeGraph, err := services.NewTradeGraph(h.db)
	if err != nil {
		log.Printf("Error creating trade graph: %v", err)
		return
	}

	loops := tradeGraph.FindTradeLoops()
	if len(loops) > 0 {
		log.Printf("Found %d trade loops.", len(loops))
		for _, loop := range loops {
			// Notify all users in the loop
			for _, edge := range loop {
				notifMsg := "Loop Trade Found! A potential multi-way trade is available."
				_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_loop', ?, FALSE)", edge.FromUser, notifMsg)
				publishNotification(edge.FromUser, notifMsg)
			}
		}
	} else {
		log.Println("No trade loops found.")
	}
}

func (h *TradeHandler) recordTradeRejectionSignal(tradeID, rejectorUserID, rejectedUserID int, reason string) {
	var targetProductID int
	if err := h.db.QueryRow("SELECT target_product_id FROM trades WHERE id = ?", tradeID).Scan(&targetProductID); err != nil {
		log.Printf("recordTradeRejectionSignal: failed to get target product for trade %d: %v", tradeID, err)
		return
	}

	var category sql.NullString
	_ = h.db.QueryRow("SELECT category FROM products WHERE id = ?", targetProductID).Scan(&category)

	_, err := h.db.Exec(`
		INSERT INTO trade_rejection_signals
		(trade_id, rejector_user_id, rejected_user_id, target_product_id, target_category, reason)
		VALUES (?, ?, ?, ?, ?, ?)
	`, tradeID, rejectorUserID, rejectedUserID, targetProductID, category.String, reason)
	if err != nil {
		log.Printf("recordTradeRejectionSignal: failed to insert signal: %v", err)
	}
}

func (h *TradeHandler) getCachedLoopsForUser(userID int) ([]map[string]interface{}, error) {
	rows, err := h.db.Query(`
		SELECT payload_json
		FROM trade_loop_cache
		WHERE user_id = ? AND expires_at > NOW()
		ORDER BY score DESC, updated_at DESC
	`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var loops []map[string]interface{}
	for rows.Next() {
		var payload string
		if err := rows.Scan(&payload); err != nil {
			continue
		}
		var loop map[string]interface{}
		if err := json.Unmarshal([]byte(payload), &loop); err == nil {
			// Filter out loops with products that are no longer available
			if h.isLoopStillValid(loop) {
				loops = append(loops, loop)
			}
		}
	}

	return loops, nil
}

// isLoopStillValid checks that every product in a loop is still available (not traded/removed)
func (h *TradeHandler) isLoopStillValid(loop map[string]interface{}) bool {
	participants, ok := loop["participants"].([]map[string]interface{})
	if !ok {
		return true // can't verify, assume valid
	}
	for _, p := range participants {
		var productID int
		if pid, ok := p["product_id"].(float64); ok {
			productID = int(pid)
		} else if pid, ok := p["product_id"].(int); ok {
			productID = pid
		}
		if productID == 0 {
			continue
		}
		var status string
		err := h.db.QueryRow("SELECT status FROM products WHERE id = ?", productID).Scan(&status)
		if err != nil || status != "available" {
			return false
		}
	}
	return true
}

func (h *TradeHandler) saveLoopCacheForUser(userID int, loops []map[string]interface{}) error {
	if _, err := h.db.Exec("DELETE FROM trade_loop_cache WHERE user_id = ?", userID); err != nil {
		return err
	}

	for idx, loop := range loops {
		// Skip loops with products that are no longer available
		if !h.isLoopStillValid(loop) {
			continue
		}
		loopID := fmt.Sprintf("cached_%d_%d", userID, idx)
		if v, ok := loop["id"]; ok {
			loopID = fmt.Sprintf("%v", v)
		}

		loopType := "graph"
		if v, ok := loop["loop_type"]; ok {
			loopType = fmt.Sprintf("%v", v)
		}

		loopLength := 0
		if v, ok := loop["loop_length"].(int); ok {
			loopLength = v
		}

		score := 50
		if v, ok := loop["score"].(int); ok {
			score = v
		}

		payloadBytes, err := json.Marshal(loop)
		if err != nil {
			continue
		}

		// 10-minute TTL. The cache is explicitly invalidated by every
		// DELETE FROM trade_loop_cache call in this file (on product add,
		// trade create/accept/decline, multiway upgrade, etc.), so a short
		// TTL doesn't buy freshness Ã¢â‚¬â€ it just forces needless rebuilds of
		// the O(NÃ‚Â³) product-match loop finder.
		_, _ = h.db.Exec(`
			INSERT INTO trade_loop_cache
			(user_id, loop_id, loop_type, loop_length, score, payload_json, expires_at)
			VALUES (?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE))
		`, userID, loopID, loopType, loopLength, score, string(payloadBytes))
	}

	return nil
}

// fetchUserNamesByIDs batches user-name lookups for a set of IDs.
// Used to avoid N+1 queries when assembling loop participants.
func (h *TradeHandler) fetchUserNamesByIDs(ids []int) map[int]string {
	result := map[int]string{}
	if len(ids) == 0 {
		return result
	}
	placeholders := make([]string, len(ids))
	args := make([]interface{}, len(ids))
	for i, id := range ids {
		placeholders[i] = "?"
		args[i] = id
	}
	q := fmt.Sprintf("SELECT id, name FROM users WHERE id IN (%s)", strings.Join(placeholders, ","))
	rows, err := h.db.Query(q, args...)
	if err != nil {
		return result
	}
	defer rows.Close()
	for rows.Next() {
		var id int
		var name string
		if err := rows.Scan(&id, &name); err == nil {
			result[id] = name
		}
	}
	return result
}

// tradeTargetInfo holds the target product ID and title for a given trade ID.
// buildLoopSuggestionsForUser intentionally returns no inferred loops.
// Multiway/Trade Match rows are created only from explicit product likes.
func (h *TradeHandler) buildLoopSuggestionsForUser(_ int) ([]map[string]interface{}, error) {
	// Suggestions from pending trades or product preferences are intentionally
	// not surfaced as Multiway loops. The Multiway tab is backed by persisted
	// trade_like_loops created from explicit product-to-product likes.
	return []map[string]interface{}{}, nil
}
func (h *TradeHandler) buildUserLoopSuggestions(userID int) ([]map[string]interface{}, error) {
	return h.buildLoopSuggestionsForUser(userID)
}

func (h *TradeHandler) rebuildTradeLoopCacheForUsers(userIDs []int) {
	seen := map[int]bool{}
	for _, userID := range userIDs {
		if userID <= 0 || seen[userID] {
			continue
		}
		seen[userID] = true

		loops, err := h.buildUserLoopSuggestions(userID)
		if err != nil {
			log.Printf("rebuildTradeLoopCacheForUsers: failed for user %d: %v", userID, err)
			continue
		}
		loops = selectBestLoopsPerProduct(h.db, userID, loops)
		if err := h.saveLoopCacheForUser(userID, loops); err != nil {
			log.Printf("rebuildTradeLoopCacheForUsers: failed to save cache for user %d: %v", userID, err)
		}
	}
}

func (h *TradeHandler) notifyAlternativeLoopsIfAny(userID int, productTitle string) {
	loops, err := h.getCachedLoopsForUser(userID)
	if err != nil || len(loops) == 0 {
		return
	}

	msg := "We found alternative trade loops for your item"
	if strings.TrimSpace(productTitle) != "" {
		msg = fmt.Sprintf("We found alternative trade loops for your item: %s", productTitle)
	}

	_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_loop', ?, FALSE)", userID, msg)
	publishNotification(userID, msg)
}

func mapKeysToSlice(m map[int]bool) []int {
	out := make([]int, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}

// RebuildAllLoopCaches refreshes hybrid loop suggestions for all active users
// who have at least one available product with desires set.
// Intended to be called by a background ticker/cron.
func (h *TradeHandler) RebuildAllLoopCaches() {
	rows, err := h.db.Query(`
		SELECT DISTINCT p.seller_id
		FROM products p
		WHERE p.status = 'available'
		  AND p.created_at >= DATE_SUB(NOW(), INTERVAL 3 MONTH)
		  AND (p.wants != '' OR p.wanted_categories != '' OR p.desired_product != '')
	`)
	if err != nil {
		log.Printf("RebuildAllLoopCaches: failed to load active users: %v", err)
		return
	}
	defer rows.Close()

	userIDs := []int{}
	for rows.Next() {
		var id int
		if err := rows.Scan(&id); err == nil {
			userIDs = append(userIDs, id)
		}
	}

	if len(userIDs) == 0 {
		return
	}

	log.Printf("RebuildAllLoopCaches: refreshing cache for %d active users", len(userIDs))
	h.rebuildTradeLoopCacheForUsers(userIDs)
}

// GetTrades lists trades for the current user (as buyer or seller)
func (h *TradeHandler) GetTrades(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}
	h.ensureTradeRuntimeColumns()

	status := c.Query("status", "")
	direction := c.Query("direction", "")
	limit := 1000 // Default unlimited (high cap)
	if limitStr := c.Query("limit"); limitStr != "" {
		if limitVal, err := strconv.Atoi(limitStr); err == nil && limitVal > 0 {
			limit = limitVal
		}
	}
	where := "WHERE (t.buyer_id = ? OR t.seller_id = ?)"
	args := []interface{}{userID, userID}
	switch direction {
	case "incoming":
		// User needs to act:
		// 1. Pending/Pending Multiway where user is the seller
		// 2. Countered where user was NOT the one who countered
		// 3. Ongoing trades where the user is the seller, so the UI can render them in the Ongoing tab
		where = "WHERE (((t.status IN ('pending', 'pending_multiway') AND t.seller_id = ?) OR (t.status = 'accepted_by_one' AND ((t.seller_id = ? AND COALESCE(t.seller_accepted, FALSE) = FALSE) OR (t.buyer_id = ? AND COALESCE(t.buyer_accepted, FALSE) = FALSE)))) OR (t.status = 'countered' AND t.countered_by IS NOT NULL AND t.countered_by <> ? AND (t.buyer_id = ? OR t.seller_id = ?)) OR (t.status IN ('accepted', 'active', 'ongoing', 'awaiting_confirmation', 'multiway_active') AND t.seller_id = ?))"
		args = []interface{}{userID, userID, userID, userID, userID, userID, userID}
	case "outgoing":
		// User is waiting for others:
		// 1. Pending/Pending Multiway where user is the buyer
		// 2. Countered where user WAS the one who countered
		// 3. Ongoing trades where the user is the buyer, so the UI can render them in the Ongoing tab
		where = "WHERE (((t.status IN ('pending', 'pending_multiway') AND t.buyer_id = ?) OR (t.status = 'accepted_by_one' AND ((t.buyer_id = ? AND COALESCE(t.buyer_accepted, FALSE) = TRUE) OR (t.seller_id = ? AND COALESCE(t.seller_accepted, FALSE) = TRUE)))) OR (t.status = 'countered' AND t.countered_by IS NOT NULL AND t.countered_by = ?) OR (t.status IN ('accepted', 'active', 'ongoing', 'awaiting_confirmation', 'multiway_active') AND t.buyer_id = ?))"
		args = []interface{}{userID, userID, userID, userID, userID}
	}
	if status != "" {
		if status == "pending" {
			where += " AND (t.status = 'pending' OR t.status = 'pending_multiway' OR t.status = 'accepted_by_one')"
		} else {
			where += " AND t.status = ?"
			args = append(args, status)
		}
	}

	// Build query dynamically to handle missing columns
	query := `
        SELECT
		  t.id, t.buyer_id, t.seller_id, t.target_product_id, t.status, COALESCE(t.message, '') as message, t.offered_cash_amount, t.created_at, t.updated_at,
          t.buyer_completed, t.seller_completed, COALESCE(t.buyer_accepted, FALSE) as buyer_accepted, COALESCE(t.seller_accepted, FALSE) as seller_accepted, t.completed_at`

	// Check if trade_option column exists
	testRow := h.db.QueryRow("SELECT trade_option FROM trades LIMIT 1")
	var testTradeOption sql.NullString
	if err := testRow.Scan(&testTradeOption); err == nil {
		// Column exists, include it in query
		query += `, COALESCE(t.trade_option, '') as trade_option, COALESCE(t.meeting_type, '') as meeting_type, COALESCE(t.delivery_address, '') as delivery_address`
	} else {
		// Column doesn't exist, use empty defaults
		query += `, '' as trade_option, '' as meeting_type, '' as delivery_address`
	}

	// Check if delivery state columns exist
	deliveryStateQuery := `
		SELECT
			COALESCE(t.delivery_type, '') as delivery_type,
			COALESCE(t.payment_method, '') as payment_method,
			COALESCE(t.payment_confirmed, FALSE) as payment_confirmed,
			COALESCE(t.delivery_instructions, '') as delivery_instructions,
			t.proof_of_delivery,
			COALESCE(t.buyer_confirmed_receipt, FALSE) as buyer_confirmed_receipt,
			COALESCE(t.seller_confirmed_delivery, FALSE) as seller_confirmed_delivery
		FROM trades t LIMIT 1`
	testDeliveryRow := h.db.QueryRow(deliveryStateQuery)
	var testDeliveryType, testPaymentMethod, testDeliveryInstructions string
	var testPaymentConfirmed, testBuyerConfirmed, testSellerConfirmed bool
	var testProofOfDelivery sql.NullString
	if err := testDeliveryRow.Scan(&testDeliveryType, &testPaymentMethod, &testPaymentConfirmed, &testDeliveryInstructions, &testProofOfDelivery, &testBuyerConfirmed, &testSellerConfirmed); err == nil {
		// Delivery state columns exist, include them in query
		query += `,
			COALESCE(t.delivery_type, '') as delivery_type,
			COALESCE(t.payment_method, '') as payment_method,
			COALESCE(t.payment_confirmed, FALSE) as payment_confirmed,
			COALESCE(t.delivery_instructions, '') as delivery_instructions,
			t.proof_of_delivery,
			COALESCE(t.buyer_confirmed_receipt, FALSE) as buyer_confirmed_receipt,
			COALESCE(t.seller_confirmed_delivery, FALSE) as seller_confirmed_delivery`
	} else {
		// Delivery state columns don't exist, use empty defaults
		log.Printf("Delivery state columns not found in trades table, using defaults")
		query += `,
			'' as delivery_type,
			'' as payment_method,
			FALSE as payment_confirmed,
			'' as delivery_instructions,
			NULL as proof_of_delivery,
			FALSE as buyer_confirmed_receipt,
			FALSE as seller_confirmed_delivery`
	}

	query += `,
          COALESCE(t.meetup_location, '') as meetup_location, COALESCE(t.buyer_meetup_confirmed, FALSE) as buyer_meetup_confirmed, COALESCE(t.seller_meetup_confirmed, FALSE) as seller_meetup_confirmed,
          COALESCE(t.buyer_meetup_location, '') as buyer_meetup_location, COALESCE(t.buyer_meetup_time, '') as buyer_meetup_time,
          COALESCE(t.seller_meetup_location, '') as seller_meetup_location, COALESCE(t.seller_meetup_time, '') as seller_meetup_time,
		  COALESCE(t.buyer_met, FALSE) as buyer_met, COALESCE(t.seller_met, FALSE) as seller_met,
		  COALESCE(t.countered_by, 0) as countered_by,
		  t.parent_trade_id,
          ub.name AS buyer_name, us.name AS seller_name, COALESCE(p.title, 'Deleted product') AS product_title,
          p.image_url AS product_image_url, p.image_urls AS product_image_urls,
          COALESCE(NULLIF(p.pickup_address, ''), NULLIF(us.home_address, ''), '') AS target_product_pickup_address
        FROM trades t
        JOIN users ub ON ub.id = t.buyer_id
        JOIN users us ON us.id = t.seller_id
        LEFT JOIN products p ON p.id = t.target_product_id
        ` + where + `
        ORDER BY t.created_at DESC`

	rows, err := h.db.Query(query, args...)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to fetch trades"})
	}
	defer rows.Close()

	tradePtrs := []*models.Trade{}
	tradeMap := make(map[int]*models.Trade)

	for rows.Next() {
		var tr models.Trade
		var deliveryType, paymentMethod, deliveryInstructions string
		var paymentConfirmed, buyerConfirmedReceipt, sellerConfirmedDelivery bool
		var proofOfDelivery sql.NullString
		var pimg, pimgs sql.NullString
		var targetPickupAddr sql.NullString
		var offeredCashNull sql.NullFloat64

		if err := rows.Scan(&tr.ID, &tr.BuyerID, &tr.SellerID, &tr.TargetProductID, &tr.Status, &tr.Message, &offeredCashNull, &tr.CreatedAt, &tr.UpdatedAt, &tr.BuyerCompleted, &tr.SellerCompleted, &tr.BuyerAccepted, &tr.SellerAccepted, &tr.CompletedAt, &tr.TradeOption, &tr.MeetingType, &tr.DeliveryAddress, &deliveryType, &paymentMethod, &paymentConfirmed, &deliveryInstructions, &proofOfDelivery, &buyerConfirmedReceipt, &sellerConfirmedDelivery, &tr.MeetupLocation, &tr.BuyerMeetupConfirmed, &tr.SellerMeetupConfirmed, &tr.BuyerMeetupLocation, &tr.BuyerMeetupTime, &tr.SellerMeetupLocation, &tr.SellerMeetupTime, &tr.BuyerMet, &tr.SellerMet, &tr.CounteredBy, &tr.ParentTradeID, &tr.BuyerName, &tr.SellerName, &tr.ProductTitle, &pimg, &pimgs, &targetPickupAddr); err == nil {
			if targetPickupAddr.Valid {
				tr.TargetProductPickupAddress = targetPickupAddr.String
			}
			// Set offered cash if valid
			if offeredCashNull.Valid {
				val := offeredCashNull.Float64
				tr.OfferedCash = &val
			}

			// Set delivery state fields
			tr.DeliveryType = deliveryType
			tr.PaymentMethod = paymentMethod
			tr.PaymentConfirmed = paymentConfirmed
			tr.DeliveryInstructions = deliveryInstructions
			if proofOfDelivery.Valid {
				tr.ProofOfDelivery = proofOfDelivery.String
			}
			tr.BuyerConfirmedReceipt = buyerConfirmedReceipt
			tr.SellerConfirmedDelivery = sellerConfirmedDelivery

			// Prefer image_url; fall back to first of image_urls JSON array
			if pimg.Valid && pimg.String != "" {
				tr.ProductImageURL = pimg.String
			} else if pimgs.Valid && pimgs.String != "" {
				if first := extractFirstImage(pimgs.String); first != "" {
					tr.ProductImageURL = first
				}
			}

			tr.Items = []models.TradeItem{}
			trCopy := tr
			tradePtrs = append(tradePtrs, &trCopy)
			tradeMap[tr.ID] = &trCopy
		} else {
			log.Printf("trade row scan error: %v", err)
		}
	}

	// Batch-load trade items to avoid N+1 queries when many trades exist
	if len(tradePtrs) > 0 {
		placeholders := strings.Repeat("?,", len(tradePtrs))
		placeholders = strings.TrimSuffix(placeholders, ",")
		args := make([]interface{}, len(tradePtrs))
		for i, tr := range tradePtrs {
			args[i] = tr.ID
		}

		itemQuery := fmt.Sprintf(`
            SELECT ti.id, ti.trade_id, ti.product_id, ti.offered_by, ti.created_at,
                   p.title, p.status, p.image_url, p.image_urls, COALESCE(p.pickup_address, '')
            FROM trade_items ti
            LEFT JOIN products p ON p.id = ti.product_id
            WHERE ti.trade_id IN (%s)
            ORDER BY ti.trade_id, ti.id
        `, placeholders)

		itemRows, err := h.db.Query(itemQuery, args...)
		if err != nil {
			log.Printf("batch trade items query error: %v", err)
		} else {
			defer itemRows.Close()
			for itemRows.Next() {
				var it models.TradeItem
				var offeredBy sql.NullString
				var title, pstatus, pimg sql.NullString
				var pimgs sql.NullString
				var pickupAddr sql.NullString

				if err := itemRows.Scan(&it.ID, &it.TradeID, &it.ProductID, &offeredBy, &it.CreatedAt, &title, &pstatus, &pimg, &pimgs, &pickupAddr); err != nil {
					log.Printf("batch trade item scan error: %v", err)
					continue
				}
				if pickupAddr.Valid {
					it.ProductPickupAddress = pickupAddr.String
				}

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
				// Prefer image_url; fall back to first of image_urls JSON array
				if pimg.Valid && pimg.String != "" {
					it.ProductImageURL = pimg.String
				} else if pimgs.Valid && pimgs.String != "" {
					if first := extractFirstImage(pimgs.String); first != "" {
						it.ProductImageURL = first
					}
				}

				if tr := tradeMap[it.TradeID]; tr != nil {
					tr.Items = append(tr.Items, it)
				}
			}
		}
	}

	// Also include multiway-active trades where user is User3 (not buyer/seller on original trade).
	// This ensures all 3 participants see the trade in "Ongoing Trades" after everyone accepts.
	if status == "multiway_active" || status == "" {
		mwRows, mwErr := h.db.Query(`
			SELECT t.id FROM trades t
			JOIN multiway_trades m ON m.original_trade_id = t.id
			WHERE m.user3_id = ? AND m.status = 'active' AND t.status = 'multiway_active'
		`, userID)
		if mwErr == nil {
			defer mwRows.Close()
			for mwRows.Next() {
				var mwTradeID int
				if mwRows.Scan(&mwTradeID) != nil {
					continue
				}
				if tradeMap[mwTradeID] != nil {
					continue // already included
				}
				// Fetch the full trade row for User3
				var tr models.Trade
				var pimg, pimgs sql.NullString
				var offeredCashNull sql.NullFloat64
				scanErr := h.db.QueryRow(`
					SELECT t.id, t.buyer_id, t.seller_id, t.target_product_id, t.status, COALESCE(t.message,''), t.offered_cash_amount, t.created_at, t.updated_at,
					       t.buyer_completed, t.seller_completed, t.completed_at,
					       COALESCE(t.meetup_location,'') as meetup_location, COALESCE(t.buyer_meetup_confirmed,FALSE), COALESCE(t.seller_meetup_confirmed,FALSE),
					       ub.name AS buyer_name, us.name AS seller_name, COALESCE(p.title, 'Deleted product') AS product_title, p.image_url, p.image_urls
					FROM trades t
					JOIN users ub ON ub.id = t.buyer_id
					JOIN users us ON us.id = t.seller_id
					LEFT JOIN products p ON p.id = t.target_product_id
					WHERE t.id = ?
				`, mwTradeID).Scan(&tr.ID, &tr.BuyerID, &tr.SellerID, &tr.TargetProductID, &tr.Status, &tr.Message, &offeredCashNull, &tr.CreatedAt, &tr.UpdatedAt,
					&tr.BuyerCompleted, &tr.SellerCompleted, &tr.CompletedAt,
					&tr.MeetupLocation, &tr.BuyerMeetupConfirmed, &tr.SellerMeetupConfirmed,
					&tr.BuyerName, &tr.SellerName, &tr.ProductTitle, &pimg, &pimgs)
				if scanErr != nil {
					continue
				}
				if offeredCashNull.Valid {
					val := offeredCashNull.Float64
					tr.OfferedCash = &val
				}
				if pimg.Valid && pimg.String != "" {
					tr.ProductImageURL = pimg.String
				} else if pimgs.Valid && pimgs.String != "" {
					if first := extractFirstImage(pimgs.String); first != "" {
						tr.ProductImageURL = first
					}
				}
				tr.Items = []models.TradeItem{}
				tradePtrs = append(tradePtrs, &tr)
				tradeMap[tr.ID] = &tr
			}
		}
	}

	// Convert back to value slice for response, respecting limit
	trades := make([]models.Trade, 0, len(tradePtrs))
	for i, tr := range tradePtrs {
		if i >= limit {
			break
		}
		trades = append(trades, *tr)
	}

	return c.JSON(models.APIResponse{Success: true, Data: trades})
}

// UpdateTrade allows seller or buyer to accept, decline, or counter
func (h *TradeHandler) UpdateTrade(c *fiber.Ctx) error {
	log.Printf("=== TRADE UPDATE ENDPOINT CALLED ===")
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		log.Printf("User not authenticated in UpdateTrade")
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}
	tradeID, err := strconv.Atoi(c.Params("id"))
	if err != nil {
		log.Printf("Invalid trade ID in UpdateTrade: %s", c.Params("id"))
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid trade id"})
	}
	log.Printf("UpdateTrade called: User %d, Trade %d", userID, tradeID)

	// Fetch trade details including current status
	var buyerID, sellerID, targetProductID int
	var currentStatus string
	err = h.db.QueryRow("SELECT buyer_id, seller_id, target_product_id, status FROM trades WHERE id = ?", tradeID).Scan(&buyerID, &sellerID, &targetProductID, &currentStatus)
	if err != nil {
		return c.Status(404).JSON(models.APIResponse{Success: false, Error: "Trade not found"})
	}
	if userID != buyerID && userID != sellerID {
		return c.Status(403).JSON(models.APIResponse{Success: false, Error: "Not authorized for this trade"})
	}

	var payload models.TradeAction
	if err := c.BodyParser(&payload); err != nil {
		log.Printf("Failed to parse request body: %v", err)
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid request body"})
	}
	log.Printf("Trade action received: %s for trade %d", payload.Action, tradeID)

	switch payload.Action {
	case "accept":
		if currentStatus != "pending" && currentStatus != "pending_multiway" && currentStatus != "countered" && currentStatus != "accepted_by_one" {
			return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Trade is no longer pending (" + currentStatus + ")"})
		}

		// Prevent accepting your own counter-offer
		if currentStatus == "countered" {
			var counteredBy int
			err := h.db.QueryRow("SELECT countered_by FROM trades WHERE id = ?", tradeID).Scan(&counteredBy)
			if err == nil && counteredBy == userID {
				return c.Status(400).JSON(models.APIResponse{Success: false, Error: "You cannot accept your own counter-offer. Waiting for the other party."})
			}
		}
		tx, err := h.db.Begin()
		if err != nil {
			return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to start transaction"})
		}

		var tradeOptionState, lockedStatus string
		var buyerAcceptedState, sellerAcceptedState bool
		var counteredByState sql.NullInt64
		err = tx.QueryRow(`
			SELECT COALESCE(trade_option, 'meetup'), COALESCE(buyer_accepted, FALSE), COALESCE(seller_accepted, FALSE), status, countered_by
			FROM trades
			WHERE id = ?
			FOR UPDATE
		`, tradeID).Scan(&tradeOptionState, &buyerAcceptedState, &sellerAcceptedState, &lockedStatus, &counteredByState)
		if err == nil {
			if lockedStatus != "pending" && lockedStatus != "pending_multiway" && lockedStatus != "countered" && lockedStatus != "accepted_by_one" {
				_ = tx.Rollback()
				return c.Status(409).JSON(models.APIResponse{Success: false, Error: "Trade is no longer available for acceptance"})
			}

			if (lockedStatus == "pending" || lockedStatus == "pending_multiway") && userID == sellerID && !buyerAcceptedState && !sellerAcceptedState {
				// Sending an offer is the buyer's acceptance; keep older rows consistent when the seller accepts.
				buyerAcceptedState = true
			}
			if lockedStatus == "countered" && counteredByState.Valid {
				if int(counteredByState.Int64) == buyerID {
					buyerAcceptedState = true
				}
				if int(counteredByState.Int64) == sellerID {
					sellerAcceptedState = true
				}
			}

			alreadyAccepted := false
			if userID == buyerID {
				alreadyAccepted = buyerAcceptedState
				buyerAcceptedState = true
			} else {
				alreadyAccepted = sellerAcceptedState
				sellerAcceptedState = true
			}
			if alreadyAccepted {
				_ = tx.Rollback()
				return c.Status(400).JSON(models.APIResponse{Success: false, Error: "You have already accepted this trade"})
			}

			finalized := buyerAcceptedState && sellerAcceptedState
			newTradeStatus := "accepted_by_one"
			confirmedPIDsFinal := []int{}
			otherTradeIDsFinal := []int{}

			if finalized {
				confirmedPIDsFinal, err = h.getTradeProductIDsTx(tx, tradeID)
				if err != nil {
					_ = tx.Rollback()
					return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to load trade products"})
				}
				if err := h.ensureProductsTradeableTx(tx, confirmedPIDsFinal); err != nil {
					_ = tx.Rollback()
					return c.Status(409).JSON(models.APIResponse{Success: false, Error: err.Error()})
				}
				newTradeStatus = "active"
			}

			if _, err = tx.Exec(`
				UPDATE trades
				SET status=?, buyer_accepted=?, seller_accepted=?, updated_at=CURRENT_TIMESTAMP
				WHERE id = ?
			`, newTradeStatus, buyerAcceptedState, sellerAcceptedState, tradeID); err != nil {
				_ = tx.Rollback()
				return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to accept trade"})
			}

			if finalized {
				if err := h.setProductStatusForTrade(tx, tradeID, "in_trade"); err != nil {
					_ = tx.Rollback()
					return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to lock products for trade"})
				}
				otherTradeIDsFinal, err = h.cancelConflictingTradesTx(tx, tradeID, confirmedPIDsFinal, userID)
				if err != nil {
					_ = tx.Rollback()
					return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to cancel conflicting trades"})
				}
				if err := h.cancelConflictingLifecycleTx(tx, tradeID, 0, "", confirmedPIDsFinal, userID); err != nil {
					_ = tx.Rollback()
					return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to cancel conflicting trade loops"})
				}
			}

			if err := tx.Commit(); err != nil {
				_ = tx.Rollback()
				return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to commit trade acceptance"})
			}

			var pid int
			_ = h.db.QueryRow("SELECT target_product_id FROM trades WHERE id = ?", tradeID).Scan(&pid)
			var productTitle string
			_ = h.db.QueryRow("SELECT title FROM products WHERE id = ?", pid).Scan(&productTitle)

			for _, otherID := range otherTradeIDsFinal {
				var otherBuyerID int
				_ = h.db.QueryRow("SELECT buyer_id FROM trades WHERE id = ?", otherID).Scan(&otherBuyerID)
				msgToDeclinedBuyer := fmt.Sprintf("Your offer for %s was cancelled because one of its products is now committed to another trade.", productTitle)
				_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", otherBuyerID, msgToDeclinedBuyer)
				publishToUser(otherBuyerID, sseEvent{Type: "trade_updated", Data: fiber.Map{"trade_id": otherID, "status": "cancelled_due_to_conflict"}})
			}

			convID, _ := ensureConversation(pid, buyerID, sellerID)
			if finalized {
				_, _, _ = saveMessage(convID, userID, "Trade accepted by both parties for "+productTitle+".")
				_, _ = h.db.Exec("INSERT INTO trade_events (trade_id, actor_id, from_status, to_status, note) VALUES (?, ?, ?, 'active', ?)", tradeID, userID, currentStatus, payload.Message)
				publishToUser(buyerID, sseEvent{Type: "trade_updated", Data: fiber.Map{"trade_id": tradeID, "status": "active"}})
				publishToUser(sellerID, sseEvent{Type: "trade_updated", Data: fiber.Map{"trade_id": tradeID, "status": "active"}})
				_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", buyerID, "Your trade is now ongoing: "+productTitle)
				_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", sellerID, "Your trade is now ongoing: "+productTitle)
			} else {
				_, _, _ = saveMessage(convID, userID, "Trade accepted. Waiting for the other participant to accept "+productTitle+".")
				_, _ = h.db.Exec("INSERT INTO trade_events (trade_id, actor_id, from_status, to_status, note) VALUES (?, ?, ?, 'accepted_by_one', ?)", tradeID, userID, currentStatus, payload.Message)
				publishToUser(buyerID, sseEvent{Type: "trade_updated", Data: fiber.Map{"trade_id": tradeID, "status": "accepted_by_one"}})
				publishToUser(sellerID, sseEvent{Type: "trade_updated", Data: fiber.Map{"trade_id": tradeID, "status": "accepted_by_one"}})
				otherUserID := buyerID
				if userID == buyerID {
					otherUserID = sellerID
				}
				_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", otherUserID, "The other participant accepted this trade. Please accept to move it to ongoing: "+productTitle)
				_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", userID, "Your acceptance was recorded. Waiting for the other participant: "+productTitle)
			}

			if finalized && tradeOptionState == "delivery" {
				go h.createDeliveryForTrade(tradeID, buyerID, sellerID)
			}
			if finalized {
				go h.cancelOtherLoopsForProducts(confirmedPIDsFinal, "")
			}

			return c.JSON(models.APIResponse{Success: true, Message: "Trade acceptance updated successfully"})
		}

		// Get trade option to determine next status
		var tradeOption string
		err = tx.QueryRow("SELECT COALESCE(trade_option, 'meetup') FROM trades WHERE id = ?", tradeID).Scan(&tradeOption)
		if err != nil {
			_ = tx.Rollback()
			return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to get trade option"})
		}

		// For delivery trades, go directly to active status
		// For meetup trades, stay pending until meetup is confirmed
		var newStatus string
		if tradeOption == "delivery" {
			newStatus = "active"
		} else {
			newStatus = "accepted"
		}

		// Collect ALL products involved in this trade (target + all offered items)
		confirmedPIDs := []int{targetProductID}
		tiRows, _ := tx.Query("SELECT product_id FROM trade_items WHERE trade_id = ?", tradeID)
		for tiRows.Next() {
			var pid int
			if tiRows.Scan(&pid) == nil && pid > 0 {
				confirmedPIDs = append(confirmedPIDs, pid)
			}
		}
		tiRows.Close()

		// Find and decline all other pending/countered offers involving ANY of these products
		pPlaceholders := make([]string, len(confirmedPIDs))
		pArgs := make([]interface{}, len(confirmedPIDs))
		for i, pid := range confirmedPIDs {
			pPlaceholders[i] = "?"
			pArgs[i] = pid
		}
		pList := strings.Join(pPlaceholders, ",")

		rows, err := tx.Query(fmt.Sprintf(`
			SELECT DISTINCT t.id FROM trades t
			LEFT JOIN trade_items ti ON t.id = ti.trade_id
			WHERE t.id != ? AND t.status IN ('pending', 'countered', 'pending_multiway')
			AND (t.target_product_id IN (%s) OR ti.product_id IN (%s))
		`, pList, pList), append(append([]interface{}{tradeID}, pArgs...), pArgs...)...)

		if err != nil {
			_ = tx.Rollback()
			return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to check conflicting pending offers"})
		}
		defer rows.Close()

		var otherTradeIDs []int
		for rows.Next() {
			var otherID int
			if err := rows.Scan(&otherID); err == nil {
				otherTradeIDs = append(otherTradeIDs, otherID)
			}
		}
		rows.Close()

		for _, otherID := range otherTradeIDs {
			// Decline the other trade
			_, _ = tx.Exec("UPDATE trades SET status='declined', updated_at=CURRENT_TIMESTAMP WHERE id = ?", otherID)
			// Unlock products from the declined trade (only those not in the current trade)
			// Note: setProductStatusForTrade(tx, tradeID, "locked") below will handle locking the current products.
			// Any products in 'otherID' that are NOT in 'tradeID' should be made available.
			_, _ = tx.Exec(`
				UPDATE products SET status='available' 
				WHERE id IN (
					SELECT product_id FROM trade_items WHERE trade_id = ?
					UNION
					SELECT target_product_id FROM trades WHERE id = ?
				)
				AND id NOT IN (%s)
			`, otherID, otherID, pList)
		}

		// Update trade status
		_, err = tx.Exec("UPDATE trades SET status=?, updated_at=CURRENT_TIMESTAMP WHERE id = ?", newStatus, tradeID)
		if err != nil {
			_ = tx.Rollback()
			return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to accept trade"})
		}

		// Soft-lock all products in the trade
		if err := h.setProductStatusForTrade(tx, tradeID, "locked"); err != nil {
			_ = tx.Rollback()
			return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to lock products for trade"})
		}

		// TODO: Auto-cancel other pending trades that involve the same products
		// if err := h.cancelConflictingTrades(tx, tradeID); err != nil {
		//	log.Printf("Warning: failed to cancel conflicting trades for trade %d: %v", tradeID, err)
		//	// Non-fatal Ã¢â‚¬â€ continue with commit
		// }

		if err := tx.Commit(); err != nil {
			_ = tx.Rollback()
			return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to commit trade acceptance"})
		}

		// Post-transaction notifications and events
		var pid int
		_ = h.db.QueryRow("SELECT target_product_id FROM trades WHERE id = ?", tradeID).Scan(&pid)
		var productTitle string
		_ = h.db.QueryRow("SELECT title FROM products WHERE id = ?", pid).Scan(&productTitle)

		// FIX BUG 2: Notify buyers whose offers were auto-declined
		for _, otherID := range otherTradeIDs {
			var otherBuyerID int
			_ = h.db.QueryRow("SELECT buyer_id FROM trades WHERE id = ?", otherID).Scan(&otherBuyerID)
			msgToDeclinedBuyer := fmt.Sprintf("Your offer for %s has been automatically declined because another offer was accepted for this item.", productTitle)
			_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", otherBuyerID, msgToDeclinedBuyer)
			publishToUser(otherBuyerID, sseEvent{Type: "trade_updated", Data: fiber.Map{"trade_id": otherID, "status": "declined"}})
		}

		convID, _ := ensureConversation(pid, buyerID, sellerID)
		_, _, _ = saveMessage(convID, userID, "Trade accepted for "+productTitle+".")
		_, _ = h.db.Exec("INSERT INTO trade_events (trade_id, actor_id, from_status, to_status, note) VALUES (?, ?, ?, 'accepted', ?)", tradeID, userID, currentStatus, payload.Message)
		publishToUser(buyerID, sseEvent{Type: "trade_updated", Data: fiber.Map{"trade_id": tradeID, "status": "accepted"}})
		publishToUser(sellerID, sseEvent{Type: "trade_updated", Data: fiber.Map{"trade_id": tradeID, "status": "accepted"}})
		_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", buyerID, "Your trade offer was accepted: "+productTitle)
		_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", sellerID, "You accepted a trade offer: "+productTitle)

		// Auto-create delivery record for delivery trades
		if tradeOption == "delivery" {
			go h.createDeliveryForTrade(tradeID, buyerID, sellerID)
		}

		// Clean up other multi-way chains/loops involving these products in background
		go h.cancelOtherLoopsForProducts(confirmedPIDs, "")
	case "decline":
		tx, err := h.db.Begin()
		if err != nil {
			return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to start transaction"})
		}

		rejectedUserID := buyerID
		if userID == buyerID {
			rejectedUserID = sellerID
		}

		// Unlock products
		if err := h.setProductStatusForTrade(tx, tradeID, "available"); err != nil {
			_ = tx.Rollback()
			return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to unlock products"})
		}

		// Update trade status
		_, err = tx.Exec("UPDATE trades SET status='declined', updated_at=CURRENT_TIMESTAMP WHERE id = ?", tradeID)
		if err != nil {
			_ = tx.Rollback()
			return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to decline trade"})
		}

		// Check if this trade had a pending multi-way chain before we cancel it,
		// so we can notify the OTHER chain participants afterwards.
		var hadPendingChain bool
		_ = tx.QueryRow("SELECT EXISTS(SELECT 1 FROM multiway_trades WHERE original_trade_id = ? AND status = 'pending_user3')", tradeID).Scan(&hadPendingChain)

		// Also cancel any pending multi-way invitations for this trade
		_, _ = tx.Exec("UPDATE multiway_trades SET status = 'cancelled', updated_at = NOW(), cancelled_at = NOW(), cancelled_by = ? WHERE original_trade_id = ? AND status = 'pending_user3'", userID, tradeID)

		if err := tx.Commit(); err != nil {
			_ = tx.Rollback()
			return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to commit trade decline"})
		}

		if hadPendingChain {
			h.notifyMultiwayLoopBroken(tradeID, "", userID)
		}

		var pid int
		_ = h.db.QueryRow("SELECT target_product_id FROM trades WHERE id = ?", tradeID).Scan(&pid)
		var productTitle string
		_ = h.db.QueryRow("SELECT title FROM products WHERE id = ?", pid).Scan(&productTitle)
		publishToUser(buyerID, sseEvent{Type: "trade_updated", Data: fiber.Map{"trade_id": tradeID, "status": "declined"}})
		publishToUser(sellerID, sseEvent{Type: "trade_updated", Data: fiber.Map{"trade_id": tradeID, "status": "declined"}})
		_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", buyerID, "Your trade offer was declined: "+productTitle)
		_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", sellerID, "You declined a trade offer: "+productTitle)
		_, _ = h.db.Exec("INSERT INTO trade_events (trade_id, actor_id, from_status, to_status, note) VALUES (?, ?, ?, 'declined', ?)", tradeID, userID, currentStatus, payload.Message)

		// Record rejection signal so hybrid matching can avoid poor fits and suggest better loops.
		go h.recordTradeRejectionSignal(tradeID, userID, rejectedUserID, payload.Message)
		go h.rebuildTradeLoopCacheForUsers([]int{buyerID, sellerID})
		go h.notifyAlternativeLoopsIfAny(rejectedUserID, productTitle)
	case "edit_offer":
		if userID != buyerID {
			return c.Status(403).JSON(models.APIResponse{Success: false, Error: "Only the original sender can edit this offer"})
		}
		if currentStatus != "pending" {
			return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Only pending offers can be edited"})
		}

		if err := validateOptionalWholePesoAmount(payload.OfferedCashAmount); err != nil {
			return c.Status(400).JSON(models.APIResponse{Success: false, Error: err.Error()})
		}
		normalizedOfferIDs, err := normalizeOfferProductIDs(payload.OfferedProductIDs)
		if err != nil {
			return c.Status(400).JSON(models.APIResponse{Success: false, Error: err.Error()})
		}
		payload.OfferedProductIDs = normalizedOfferIDs

		hasItems := len(payload.OfferedProductIDs) > 0
		hasCash := payload.OfferedCashAmount != nil && *payload.OfferedCashAmount > 0
		if !hasItems && !hasCash {
			return c.Status(400).JSON(models.APIResponse{Success: false, Error: "You must offer at least one item or a cash amount"})
		}

		if payload.TradeOption != "" && payload.TradeOption != "meetup" {
			return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Peer-to-peer trades must use the 'meetup' option"})
		}
		if payload.MeetingType != "" && payload.MeetingType != "meetup" && payload.MeetingType != "pickup" {
			return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid meeting type"})
		}

		var targetStatus string
		var maxItems int
		if err := h.db.QueryRow("SELECT status, COALESCE(max_items_per_offer, 0) FROM products WHERE id = ?", targetProductID).Scan(&targetStatus, &maxItems); err != nil {
			if err == sql.ErrNoRows {
				return c.Status(404).JSON(models.APIResponse{Success: false, Error: "Target product not found"})
			}
			return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to validate target product"})
		}
		if targetStatus != "available" {
			return c.Status(400).JSON(models.APIResponse{Success: false, Error: "This product is no longer available for trading"})
		}
		if maxItems > 0 && len(payload.OfferedProductIDs) > maxItems {
			return c.Status(400).JSON(models.APIResponse{
				Success: false,
				Error:   fmt.Sprintf("This trade only allows up to %d items per offer", maxItems),
			})
		}

		tx, err := h.db.Begin()
		if err != nil {
			return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to start transaction"})
		}

		var lockedStatus string
		if err := tx.QueryRow("SELECT status FROM trades WHERE id = ? FOR UPDATE", tradeID).Scan(&lockedStatus); err != nil {
			_ = tx.Rollback()
			return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to lock trade"})
		}
		if lockedStatus != "pending" {
			_ = tx.Rollback()
			return c.Status(409).JSON(models.APIResponse{Success: false, Error: "This offer can no longer be edited"})
		}
		if err := h.ensureOfferedProductsAvailableForUserTx(tx, userID, payload.OfferedProductIDs, tradeID); err != nil {
			_ = tx.Rollback()
			return c.Status(409).JSON(models.APIResponse{Success: false, Error: err.Error()})
		}

		oldOfferTitlesByID := map[int]string{}
		oldOfferRows, err := tx.Query(`
			SELECT ti.product_id, COALESCE(p.title, CONCAT('Product #', ti.product_id))
			FROM trade_items ti
			LEFT JOIN products p ON p.id = ti.product_id
			WHERE ti.trade_id = ? AND ti.offered_by = 'buyer'
		`, tradeID)
		if err != nil {
			_ = tx.Rollback()
			return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to load current offer items"})
		}
		for oldOfferRows.Next() {
			var oldProductID int
			var oldTitle string
			if scanErr := oldOfferRows.Scan(&oldProductID, &oldTitle); scanErr == nil && oldProductID > 0 {
				oldOfferTitlesByID[oldProductID] = oldTitle
			}
		}
		oldOfferRows.Close()

		newOfferTitlesByID := map[int]string{}
		for _, pid := range payload.OfferedProductIDs {
			var ownerID int
			var productStatus, productTitle string
			if err := tx.QueryRow("SELECT seller_id, status, title FROM products WHERE id = ?", pid).Scan(&ownerID, &productStatus, &productTitle); err != nil {
				_ = tx.Rollback()
				return c.Status(400).JSON(models.APIResponse{Success: false, Error: "One of your offered products was not found"})
			}
			if ownerID != userID {
				_ = tx.Rollback()
				return c.Status(400).JSON(models.APIResponse{Success: false, Error: "You can only offer your own products"})
			}
			if productStatus != "available" {
				_ = tx.Rollback()
				return c.Status(400).JSON(models.APIResponse{Success: false, Error: "One of your offered products is no longer available"})
			}
			newOfferTitlesByID[pid] = productTitle
		}

		if _, err := tx.Exec("DELETE FROM trade_items WHERE trade_id = ?", tradeID); err != nil {
			_ = tx.Rollback()
			return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to replace offered items"})
		}
		for _, pid := range payload.OfferedProductIDs {
			if _, err := tx.Exec("INSERT INTO trade_items (trade_id, product_id, offered_by) VALUES (?, ?, 'buyer')", tradeID, pid); err != nil {
				_ = tx.Rollback()
				return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to save updated offered items"})
			}
		}

		updateMessage := strings.TrimSpace(payload.Message)
		tradeOption := "meetup"
		if strings.TrimSpace(payload.TradeOption) != "" {
			tradeOption = payload.TradeOption
		}
		meetingType := "meetup"
		if strings.TrimSpace(payload.MeetingType) != "" {
			meetingType = payload.MeetingType
		}
		paymentMethod := strings.TrimSpace(payload.PaymentMethod)
		if paymentMethod == "" {
			var existingPaymentMethod sql.NullString
			_ = tx.QueryRow("SELECT payment_method FROM trades WHERE id = ?", tradeID).Scan(&existingPaymentMethod)
			if existingPaymentMethod.Valid {
				paymentMethod = existingPaymentMethod.String
			}
		}

		if _, err := tx.Exec(`
			UPDATE trades
			SET message = ?, offered_cash_amount = ?, trade_option = ?, meeting_type = ?, delivery_address = ?, payment_method = ?, updated_at = CURRENT_TIMESTAMP
			WHERE id = ?
		`, updateMessage, payload.OfferedCashAmount, tradeOption, meetingType, strings.TrimSpace(payload.DeliveryAddress), paymentMethod, tradeID); err != nil {
			_ = tx.Rollback()
			return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to update trade offer"})
		}

		if err := tx.Commit(); err != nil {
			_ = tx.Rollback()
			return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to save trade changes"})
		}

		var productTitle string
		var buyerName string
		_ = h.db.QueryRow("SELECT title FROM products WHERE id = ?", targetProductID).Scan(&productTitle)
		_ = h.db.QueryRow("SELECT name FROM users WHERE id = ?", buyerID).Scan(&buyerName)
		if strings.TrimSpace(buyerName) == "" {
			buyerName = "Someone"
		}

		addedTitles := []string{}
		removedTitles := []string{}
		for pid, title := range newOfferTitlesByID {
			if _, existed := oldOfferTitlesByID[pid]; !existed {
				addedTitles = append(addedTitles, title)
			}
		}
		for pid, title := range oldOfferTitlesByID {
			if _, kept := newOfferTitlesByID[pid]; !kept {
				removedTitles = append(removedTitles, title)
			}
		}
		sort.Strings(addedTitles)
		sort.Strings(removedTitles)

		sellerEditMessage := fmt.Sprintf("%s updated their offer for %s.", buyerName, productTitle)
		switch {
		case len(addedTitles) > 0 && len(removedTitles) > 0:
			sellerEditMessage = fmt.Sprintf("%s changed the offered items for %s: added %s and removed %s.", buyerName, productTitle, summarizeTradeItemChanges(addedTitles), summarizeTradeItemChanges(removedTitles))
		case len(addedTitles) > 0:
			sellerEditMessage = fmt.Sprintf("%s added %s to the offer for %s.", buyerName, summarizeTradeItemChanges(addedTitles), productTitle)
		case len(removedTitles) > 0:
			sellerEditMessage = fmt.Sprintf("%s removed %s from the offer for %s.", buyerName, summarizeTradeItemChanges(removedTitles), productTitle)
		}

		publishToUser(buyerID, sseEvent{Type: "trade_updated", Data: fiber.Map{"trade_id": tradeID, "status": "pending", "edited": true}})
		publishToUser(sellerID, sseEvent{Type: "trade_updated", Data: fiber.Map{"trade_id": tradeID, "status": "pending", "edited": true}})
		_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", sellerID, sellerEditMessage)
		_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", buyerID, "Your offer changes were saved: "+productTitle)
		_, _ = h.db.Exec("INSERT INTO trade_events (trade_id, actor_id, from_status, to_status, note) VALUES (?, ?, ?, ?, ?)", tradeID, userID, currentStatus, currentStatus, "Offer edited")
	case "counter":
		if err := validateOptionalWholePesoAmount(payload.CounterOfferedCashAmount); err != nil {
			return c.Status(400).JSON(models.APIResponse{Success: false, Error: err.Error()})
		}
		normalizedCounterOfferIDs, err := normalizeOfferProductIDs(payload.CounterOfferedProductIDs)
		if err != nil {
			return c.Status(400).JSON(models.APIResponse{Success: false, Error: err.Error()})
		}
		payload.CounterOfferedProductIDs = normalizedCounterOfferIDs

		tx, err := h.db.Begin()
		if err != nil {
			return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to start transaction"})
		}

		// Unlock products from the previous state of the trade before applying the counter
		if err := h.setProductStatusForTrade(tx, tradeID, "available"); err != nil {
			_ = tx.Rollback()
			return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to unlock products for counter-offer"})
		}

		// Determine who is countering
		offeredBy := "buyer"
		if userID == sellerID {
			offeredBy = "seller"
		}

		// Check target product item limit
		var targetProductID int
		if err := h.db.QueryRow("SELECT target_product_id FROM trades WHERE id = ?", tradeID).Scan(&targetProductID); err != nil {
			_ = tx.Rollback()
			return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to load trade details"})
		}
		var maxItems int
		if err := h.db.QueryRow("SELECT max_items_per_offer FROM products WHERE id = ?", targetProductID).Scan(&maxItems); err != nil {
			_ = tx.Rollback()
			return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to load product limits"})
		}
		if maxItems > 0 && len(payload.CounterOfferedProductIDs) > maxItems {
			_ = tx.Rollback()
			return c.Status(400).JSON(models.APIResponse{
				Success: false,
				Error:   fmt.Sprintf("This trade only allows up to %d items per offer", maxItems),
			})
		}

		// Replace items in the trade
		if _, err := tx.Exec("DELETE FROM trade_items WHERE trade_id = ?", tradeID); err != nil {
			_ = tx.Rollback()
			return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to update trade items"})
		}
		// Counter-offered items come from the buyer's (original offerer's) inventory Ã¢â‚¬â€
		// the seller counters by proposing a different item (or cash) from what the buyer has.
		for _, pid := range payload.CounterOfferedProductIDs {
			var ownerID int
			if err := tx.QueryRow("SELECT seller_id FROM products WHERE id = ?", pid).Scan(&ownerID); err != nil || ownerID != buyerID {
				_ = tx.Rollback()
				return c.Status(400).JSON(models.APIResponse{Success: false, Error: fmt.Sprintf("Product %d is not available for this counter offer.", pid)})
			}
			if _, err := tx.Exec("INSERT INTO trade_items (trade_id, product_id, offered_by) VALUES (?, ?, ?)", tradeID, pid, offeredBy); err != nil {
				_ = tx.Rollback()
				return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to add counter offer items"})
			}
		}

		// Update trade status, message, and cash amount. Record WHO countered so the
		// OTHER party sees this trade in their "received offers" direction.
		if _, err := tx.Exec("UPDATE trades SET status='countered', message=?, offered_cash_amount=?, countered_by=?, buyer_accepted=FALSE, seller_accepted=FALSE, updated_at=CURRENT_TIMESTAMP WHERE id = ?", payload.Message, payload.CounterOfferedCashAmount, userID, tradeID); err != nil {
			_ = tx.Rollback()
			return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to update trade for counter offer"})
		}

		if err := tx.Commit(); err != nil {
			return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to commit counter offer"})
		}

		// Notifications and events after successful transaction
		publishToUser(buyerID, sseEvent{Type: "trade_updated", Data: fiber.Map{"trade_id": tradeID, "status": "countered"}})
		publishToUser(sellerID, sseEvent{Type: "trade_updated", Data: fiber.Map{"trade_id": tradeID, "status": "countered"}})
		var targetPid int
		_ = h.db.QueryRow("SELECT target_product_id FROM trades WHERE id = ?", tradeID).Scan(&targetPid)
		var productTitle string
		_ = h.db.QueryRow("SELECT title FROM products WHERE id = ?", targetPid).Scan(&productTitle)
		recipientID := buyerID
		if userID == buyerID {
			recipientID = sellerID
		}
		_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", recipientID, "Your trade offer was countered: "+productTitle)
		_, _ = h.db.Exec("INSERT INTO trade_events (trade_id, actor_id, from_status, to_status, note) VALUES (?, ?, ?, 'countered', ?)", tradeID, userID, currentStatus, payload.Message)

	case "complete":
		log.Printf("=== TRADE COMPLETION REQUEST ===")
		if currentStatus != "active" {
			log.Printf("Attempted to complete non-active trade %d (status: %s)", tradeID, currentStatus)
			return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Only active trades can be marked as complete"})
		}
		log.Printf("User %d attempting to complete trade %d", userID, tradeID)

		// Enforce photo evidence rule for meetup and delivery
		var proofURL sql.NullString
		var isCamera bool
		var tradeOption string
		proofCheckCol := "buyer_proof_url"
		camCheckCol := "buyer_photo_is_camera"
		if userID == sellerID {
			proofCheckCol = "seller_proof_url"
			camCheckCol = "seller_photo_is_camera"
		}
		err = h.db.QueryRow("SELECT "+proofCheckCol+", "+camCheckCol+", COALESCE(trade_option, 'meetup') FROM trades WHERE id = ?", tradeID).Scan(&proofURL, &isCamera, &tradeOption)
		if err == nil && (tradeOption == "meetup" || tradeOption == "delivery") {
			if !proofURL.Valid || proofURL.String == "" {
				return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Photo evidence is mandatory for " + tradeOption + " trades. Please provide a handoff photo."})
			}
			if !isCamera {
				return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Photo evidence must be taken using the in-app camera (no gallery upload)."})
			}
		}

		column := "buyer_completed"
		if userID == sellerID {
			column = "seller_completed"
		}
		log.Printf("Setting %s=TRUE for trade %d", column, tradeID)
		_, err = h.db.Exec("UPDATE trades SET "+column+"=TRUE, updated_at=CURRENT_TIMESTAMP WHERE id = ?", tradeID)
		if err == nil {
			log.Printf("Updated %s=TRUE for trade %d", column, tradeID)
			var bc, sc bool
			_ = h.db.QueryRow("SELECT buyer_completed, seller_completed FROM trades WHERE id = ?", tradeID).Scan(&bc, &sc)
			log.Printf("Trade %d completion status: buyer_completed=%t, seller_completed=%t", tradeID, bc, sc)
			if bc && sc {
				log.Printf("Both parties completed trade %d, starting completion process", tradeID)
				err = h.completeTradeTransaction(tradeID)
				if err != nil {
					log.Printf("Failed to complete product trade: %v", err)
					return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to complete trade"})
				}
				log.Printf("Trade %d completion process finished successfully", tradeID)
				publishToUser(buyerID, sseEvent{Type: "trade_updated", Data: fiber.Map{"trade_id": tradeID, "status": "completed"}})
				publishToUser(sellerID, sseEvent{Type: "trade_updated", Data: fiber.Map{"trade_id": tradeID, "status": "completed"}})
				_, _ = h.db.Exec("INSERT INTO trade_events (trade_id, actor_id, from_status, to_status, note) VALUES (?, ?, 'active', 'completed', ?)", tradeID, userID, payload.Message)
				_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", buyerID, "Trade completed")
				_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", sellerID, "Trade completed")
			} else {
				// First completion: set first_completion_at if not set
				_, _ = h.db.Exec("UPDATE trades SET first_completion_at = COALESCE(first_completion_at, CURRENT_TIMESTAMP) WHERE id = ?", tradeID)
				publishToUser(buyerID, sseEvent{Type: "trade_updated", Data: fiber.Map{"trade_id": tradeID, "status": "awaiting_other_party"}})
				publishToUser(sellerID, sseEvent{Type: "trade_updated", Data: fiber.Map{"trade_id": tradeID, "status": "awaiting_other_party"}})
				_, _ = h.db.Exec("INSERT INTO trade_events (trade_id, actor_id, from_status, to_status, note) VALUES (?, ?, 'active', 'awaiting_other_party', ?)", tradeID, userID, payload.Message)
				// Soft reminders
				_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", buyerID, "One party marked the trade completed. Please confirm within 24 hours.")
				_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", sellerID, "One party marked the trade completed. Please confirm within 24 hours.")
			}
		}
	case "cancel":
		// A trade cancelled after it was already "ongoing" (accepted/active/etc.)
		// carries a larger trust-score penalty than one cancelled while still pending.
		wasActive := currentStatus == "accepted" || currentStatus == "active" ||
			currentStatus == "awaiting_confirmation" || currentStatus == "awaiting_other_party"

		reason := payload.CancellationReason
		if reason == "" {
			reason = payload.Message
		}

		log.Printf("[Cancel Trade] Trade %d: User %d, wasActive=%v, reason=%s", tradeID, userID, wasActive, reason)

		tx, err := h.db.Begin()
		if err != nil {
			log.Printf("[Cancel Trade] Failed to start transaction: %v", err)
			return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to start transaction"})
		}

		// Unlock products
		if err := h.setProductStatusForTrade(tx, tradeID, "available"); err != nil {
			_ = tx.Rollback()
			log.Printf("[Cancel Trade] Failed to unlock products: %v", err)
			return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to unlock products"})
		}

		// Update trade status with cancellation metadata
		// Try with all columns first, fall back to status-only if columns don't exist
		_, err = tx.Exec(`
			UPDATE trades
			SET status='cancelled',
			    cancellation_reason = ?,
			    cancelled_by = ?,
			    cancelled_at = CURRENT_TIMESTAMP,
			    cancelled_while_active = ?,
			    updated_at = CURRENT_TIMESTAMP
			WHERE id = ?`,
			reason, userID, wasActive, tradeID)

		if err != nil {
			log.Printf("[Cancel Trade] Full update failed (checking if columns exist): %v", err)

			// Fallback: Try simple status update if columns don't exist yet
			if strings.Contains(err.Error(), "Unknown column") {
				log.Printf("[Cancel Trade] Cancellation columns missing, using fallback update")
				_, err = tx.Exec(`
					UPDATE trades
					SET status='cancelled', updated_at = CURRENT_TIMESTAMP
					WHERE id = ?`, tradeID)
			}

			if err != nil {
				_ = tx.Rollback()
				log.Printf("[Cancel Trade] Fallback update also failed: %v", err)
				return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to cancel trade: " + err.Error()})
			}
		}

		// Check if this trade had a pending multi-way chain before we cancel it,
		// so we can notify the OTHER chain participants afterwards.
		var hadPendingChain bool
		_ = tx.QueryRow("SELECT EXISTS(SELECT 1 FROM multiway_trades WHERE original_trade_id = ? AND status = 'pending_user3')", tradeID).Scan(&hadPendingChain)

		// Also cancel any pending multi-way invitations for this trade
		_, _ = tx.Exec("UPDATE multiway_trades SET status = 'cancelled', updated_at = NOW(), cancelled_at = NOW(), cancelled_by = ? WHERE original_trade_id = ? AND status = 'pending_user3'", userID, tradeID)

		if err := tx.Commit(); err != nil {
			_ = tx.Rollback()
			log.Printf("[Cancel Trade] Failed to commit transaction: %v", err)
			return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to commit trade cancellation"})
		}

		if hadPendingChain {
			h.notifyMultiwayLoopBroken(tradeID, "", userID)
		}

		log.Printf("[Cancel Trade] Success - Trade %d cancelled by user %d", tradeID, userID)

		// Apply automated penalty: score minus + suspend after repeated cancels
		go h.applyCancellationPenalty(userID, wasActive)

		publishToUser(buyerID, sseEvent{Type: "trade_updated", Data: fiber.Map{"trade_id": tradeID, "status": "cancelled"}})
		publishToUser(sellerID, sseEvent{Type: "trade_updated", Data: fiber.Map{"trade_id": tradeID, "status": "cancelled"}})
		eventNote := reason
		if wasActive {
			eventNote = "[cancelled-during-active] " + reason
		}
		_, _ = h.db.Exec("INSERT INTO trade_events (trade_id, actor_id, from_status, to_status, note) VALUES (?, ?, ?, 'cancelled', ?)", tradeID, userID, currentStatus, eventNote)
	case "confirm_meetup":
		log.Printf("=== TRADE MEETUP CONFIRMATION REQUEST ===")
		log.Printf("User %d attempting to confirm meetup for trade %d", userID, tradeID)

		// Check if this is actually a meetup trade
		var tradeOption string
		err = h.db.QueryRow("SELECT COALESCE(trade_option, 'meetup') FROM trades WHERE id = ?", tradeID).Scan(&tradeOption)
		if err != nil {
			return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to get trade option"})
		}

		if tradeOption != "meetup" {
			return c.Status(400).JSON(models.APIResponse{Success: false, Error: "This action is only available for meetup trades"})
		}

		// Validate meetup location and time are provided
		if payload.MeetupLocation == "" {
			return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Meetup location is required"})
		}
		if payload.MeetupTime == "" {
			return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Meetup time is required"})
		}

		meetupTimeValue := payload.MeetupTime
		if payload.MeetupDate != "" {
			meetupTimeValue = payload.MeetupDate + " " + payload.MeetupTime
		}

		// Store each party's meetup selection separately
		var updateQuery string
		switch userID {
		case buyerID:
			updateQuery = "UPDATE trades SET buyer_meetup_location=?, buyer_meetup_time=?, buyer_meetup_confirmed=TRUE, updated_at=CURRENT_TIMESTAMP WHERE id = ?"
		case sellerID:
			updateQuery = "UPDATE trades SET seller_meetup_location=?, seller_meetup_time=?, seller_meetup_confirmed=TRUE, updated_at=CURRENT_TIMESTAMP WHERE id = ?"
		default:
			return c.Status(403).JSON(models.APIResponse{Success: false, Error: "Not authorized for this trade"})
		}

		// Update the trade with this party's meetup selection
		_, err = h.db.Exec(updateQuery, payload.MeetupLocation, meetupTimeValue, tradeID)
		if err != nil {
			log.Printf("Failed to update meetup confirmation for trade %d: %v", tradeID, err)
			return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to confirm meetup"})
		}

		// Create notification for the other party
		var otherUserID int
		var confirmerName string
		if userID == buyerID {
			otherUserID = sellerID
			confirmerName = "buyer"
		} else {
			otherUserID = buyerID
			confirmerName = "seller"
		}

		notifMsg := fmt.Sprintf("The %s has selected meetup: %s at %s", confirmerName, payload.MeetupLocation, meetupTimeValue)
		_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", otherUserID, notifMsg)

		// Check if both parties have confirmed and if their selections MATCH
		var buyerConfirmed, sellerConfirmed bool
		var buyerLocation, buyerTime, sellerLocation, sellerTime sql.NullString
		err = h.db.QueryRow(`
			SELECT COALESCE(buyer_meetup_confirmed, FALSE), COALESCE(seller_meetup_confirmed, FALSE),
			       buyer_meetup_location, buyer_meetup_time,
			       seller_meetup_location, seller_meetup_time
			FROM trades WHERE id = ?`, tradeID).Scan(
			&buyerConfirmed, &sellerConfirmed,
			&buyerLocation, &buyerTime,
			&sellerLocation, &sellerTime)

		if err == nil && buyerConfirmed && sellerConfirmed {
			// Both parties confirmed - check if selections match (tolerant to whitespace/case)
			bLoc := strings.ToLower(strings.TrimSpace(buyerLocation.String))
			sLoc := strings.ToLower(strings.TrimSpace(sellerLocation.String))
			bTime := strings.ToLower(strings.TrimSpace(buyerTime.String))
			sTime := strings.ToLower(strings.TrimSpace(sellerTime.String))

			if bLoc == sLoc && bTime == sTime {
				// Selections match! Update trade status to active and set the final meetup details
				_, activateErr := h.db.Exec(`
					UPDATE trades
					SET status='active', meetup_location=?, meetup_time=?, updated_at=CURRENT_TIMESTAMP
					WHERE id = ?`, buyerLocation.String, buyerTime.String, tradeID)
				if activateErr == nil {
					log.Printf("Both parties agreed on meetup for trade %d (location: %s, time: %s), status updated to active",
						tradeID, buyerLocation.String, buyerTime.String)
					publishToUser(buyerID, sseEvent{Type: "trade_updated", Data: fiber.Map{"trade_id": tradeID, "status": "active", "meetup_agreed": true}})
					publishToUser(sellerID, sseEvent{Type: "trade_updated", Data: fiber.Map{"trade_id": tradeID, "status": "active", "meetup_agreed": true}})

					// Send agreement notifications
					_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)",
						buyerID, fmt.Sprintf("Meetup agreed! %s at %s. Trade is now active.", buyerLocation.String, buyerTime.String))
					_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)",
						sellerID, fmt.Sprintf("Meetup agreed! %s at %s. Trade is now active.", buyerLocation.String, buyerTime.String))
				} else {
					// Important: do not fail the whole request here.
					// The user's selection has already been stored above; activation may race with the other party's request.
					log.Printf("Warning: failed to auto-activate trade %d after meetup agreement: %v", tradeID, activateErr)
				}
			} else {
				// Selections don't match - notify both parties
				log.Printf("Meetup selections don't match for trade %d. Buyer: %s at %s, Seller: %s at %s",
					tradeID, buyerLocation.String, buyerTime.String, sellerLocation.String, sellerTime.String)
				publishToUser(buyerID, sseEvent{Type: "trade_updated", Data: fiber.Map{"trade_id": tradeID, "meetup_mismatch": true}})
				publishToUser(sellerID, sseEvent{Type: "trade_updated", Data: fiber.Map{"trade_id": tradeID, "meetup_mismatch": true}})

				// Send mismatch notifications
				mismatchMsg := fmt.Sprintf("Meetup selections don't match! You selected %s at %s, but the other party selected %s at %s. Please coordinate.",
					payload.MeetupLocation, meetupTimeValue,
					func() string {
						if userID == buyerID {
							return sellerLocation.String
						}
						return buyerLocation.String
					}(),
					func() string {
						if userID == buyerID {
							return sellerTime.String
						}
						return buyerTime.String
					}())
				_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", userID, mismatchMsg)
			}
		} else {
			// Only one party confirmed, notify both about the confirmation
			publishToUser(buyerID, sseEvent{Type: "trade_updated", Data: fiber.Map{"trade_id": tradeID, "meetup_selection_submitted": true}})
			publishToUser(sellerID, sseEvent{Type: "trade_updated", Data: fiber.Map{"trade_id": tradeID, "meetup_selection_submitted": true}})
		}

		_, _ = h.db.Exec("INSERT INTO trade_events (trade_id, actor_id, from_status, to_status, note) VALUES (?, ?, ?, 'meetup_selection', ?)",
			tradeID, userID, currentStatus, "Meetup selection: "+payload.MeetupLocation+" at "+meetupTimeValue)

	case "reset_meetup_selection":
		log.Printf("User %d resetting meetup selection for trade %d", userID, tradeID)

		// Allow user to reset their own meetup confirmation so they can change their selection
		var updateQuery string
		switch userID {
		case buyerID:
			updateQuery = "UPDATE trades SET buyer_meetup_location=NULL, buyer_meetup_time=NULL, buyer_meetup_confirmed=FALSE, updated_at=CURRENT_TIMESTAMP WHERE id = ?"
		case sellerID:
			updateQuery = "UPDATE trades SET seller_meetup_location=NULL, seller_meetup_time=NULL, seller_meetup_confirmed=FALSE, updated_at=CURRENT_TIMESTAMP WHERE id = ?"
		default:
			return c.Status(403).JSON(models.APIResponse{Success: false, Error: "Not authorized for this trade"})
		}

		_, err = h.db.Exec(updateQuery, tradeID)
		if err != nil {
			log.Printf("Failed to reset meetup selection for trade %d: %v", tradeID, err)
			return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to reset meetup selection"})
		}

		// Notify the other party that the selection was reset
		var otherUserID int
		if userID == buyerID {
			otherUserID = sellerID
		} else {
			otherUserID = buyerID
		}
		notifMsg := "The other party has changed their meetup selection. Please wait for them to submit a new choice."
		_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", otherUserID, notifMsg)

		// Publish event to notify both parties
		publishToUser(buyerID, sseEvent{Type: "trade_updated", Data: fiber.Map{"trade_id": tradeID}})
		publishToUser(sellerID, sseEvent{Type: "trade_updated", Data: fiber.Map{"trade_id": tradeID}})

	case "confirm_meetup_done":
		// Each party confirms they met and completed the handoff (pre-condition for leaving reviews)
		// Be tolerant to client/backend status desync: allow this action as long as meetup was agreed.
		if currentStatus == "cancelled" || currentStatus == "declined" || currentStatus == "completed" || currentStatus == "auto_completed" {
			return c.Status(400).JSON(models.APIResponse{Success: false, Error: "This trade can no longer confirm meetup completion"})
		}

		var tradeOption, meetupLocation, meetupTime string
		var buyerConfirmed, sellerConfirmed bool
		var buyerLocation, buyerTime, sellerLocation, sellerTime sql.NullString
		err = h.db.QueryRow(`
			SELECT COALESCE(trade_option, 'meetup'),
			       COALESCE(meetup_location, ''), COALESCE(meetup_time, ''),
			       COALESCE(buyer_meetup_confirmed, FALSE), COALESCE(seller_meetup_confirmed, FALSE),
			       buyer_meetup_location, buyer_meetup_time,
			       seller_meetup_location, seller_meetup_time
			FROM trades WHERE id = ?`, tradeID).Scan(
			&tradeOption,
			&meetupLocation, &meetupTime,
			&buyerConfirmed, &sellerConfirmed,
			&buyerLocation, &buyerTime,
			&sellerLocation, &sellerTime,
		)
		if err != nil {
			return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to load trade details"})
		}
		if tradeOption != "meetup" {
			return c.Status(400).JSON(models.APIResponse{Success: false, Error: "This action is only available for meetup trades"})
		}

		// Ensure meetup was actually agreed (both confirmed + matching selections)
		if !buyerConfirmed || !sellerConfirmed {
			return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Meetup must be agreed before confirming you met"})
		}

		bLoc := strings.ToLower(strings.TrimSpace(buyerLocation.String))
		sLoc := strings.ToLower(strings.TrimSpace(sellerLocation.String))
		bTime := strings.ToLower(strings.TrimSpace(buyerTime.String))
		sTime := strings.ToLower(strings.TrimSpace(sellerTime.String))
		if bLoc == "" || bTime == "" || sLoc == "" || sTime == "" || bLoc != sLoc || bTime != sTime {
			return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Meetup selections must match before confirming you met"})
		}

		// Ensure final meetup fields exist; if not, backfill them from the agreed selections.
		if strings.TrimSpace(meetupLocation) == "" || strings.TrimSpace(meetupTime) == "" {
			meetupLocation = buyerLocation.String
			meetupTime = buyerTime.String
			_, _ = h.db.Exec("UPDATE trades SET meetup_location=?, meetup_time=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", meetupLocation, meetupTime, tradeID)
		}

		// Auto-promote to active if needed so review/completion flows don't get blocked.
		if currentStatus != "active" {
			_, _ = h.db.Exec("UPDATE trades SET status='active', updated_at=CURRENT_TIMESTAMP WHERE id=? AND status NOT IN ('cancelled','declined','completed','auto_completed')", tradeID)
			publishToUser(buyerID, sseEvent{Type: "trade_updated", Data: fiber.Map{"trade_id": tradeID, "status": "active", "meetup_agreed": true}})
			publishToUser(sellerID, sseEvent{Type: "trade_updated", Data: fiber.Map{"trade_id": tradeID, "status": "active", "meetup_agreed": true}})
		}

		column := "buyer_met"
		if userID == sellerID {
			column = "seller_met"
		}
		if _, err := h.db.Exec("UPDATE trades SET "+column+"=TRUE, updated_at=CURRENT_TIMESTAMP WHERE id = ?", tradeID); err != nil {
			log.Printf("Failed to confirm meetup done for trade %d: %v", tradeID, err)
			return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to confirm meetup completion"})
		}

		// Notify the other party
		otherUserID := buyerID
		confirmerName := "seller"
		if userID == buyerID {
			otherUserID = sellerID
			confirmerName = "buyer"
		}
		_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", otherUserID, fmt.Sprintf("The %s confirmed they met you for the meetup trade.", confirmerName))
		_, _ = h.db.Exec("INSERT INTO trade_events (trade_id, actor_id, from_status, to_status, note) VALUES (?, ?, ?, 'meetup_done', ?)", tradeID, userID, currentStatus, "Confirmed met")

		// If both confirmed, let both clients know reviews can proceed
		var bm, sm bool
		_ = h.db.QueryRow("SELECT COALESCE(buyer_met, FALSE), COALESCE(seller_met, FALSE) FROM trades WHERE id = ?", tradeID).Scan(&bm, &sm)
		if bm && sm {
			publishToUser(buyerID, sseEvent{Type: "trade_updated", Data: fiber.Map{"trade_id": tradeID, "met_confirmed": true}})
			publishToUser(sellerID, sseEvent{Type: "trade_updated", Data: fiber.Map{"trade_id": tradeID, "met_confirmed": true}})
			_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", buyerID, "Both parties confirmed they met. You can now leave a review.")
			_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", sellerID, "Both parties confirmed they met. You can now leave a review.")
		}

		return c.JSON(models.APIResponse{Success: true, Data: fiber.Map{"buyer_met": bm, "seller_met": sm}})
	case "update_delivery_state":
		// Handle delivery state updates (payment confirmation, proof of delivery, confirmations)
		log.Printf("=== DELIVERY STATE UPDATE REQUEST ===")
		log.Printf("User %d attempting to update delivery state for trade %d", userID, tradeID)

		// Delivery state columns are ensured at database init (database.go)
		log.Printf("Processing delivery state update for trade %d", tradeID)

		// Prepare update query and arguments
		updateFields := []string{}
		updateArgs := []interface{}{}

		// Check which fields to update based on payload
		type DeliveryStatePayload struct {
			Action                  string  `json:"action"`
			DeliveryType            string  `json:"delivery_type,omitempty"`
			PaymentMethod           string  `json:"payment_method,omitempty"`
			PaymentConfirmed        *bool   `json:"payment_confirmed,omitempty"`
			DeliveryInstructions    *string `json:"delivery_instructions,omitempty"`
			ProofOfDelivery         string  `json:"proof_of_delivery,omitempty"`
			BuyerConfirmedReceipt   *bool   `json:"buyer_confirmed_receipt,omitempty"`
			SellerConfirmedDelivery *bool   `json:"seller_confirmed_delivery,omitempty"`
		}

		var deliveryPayload DeliveryStatePayload
		if err := c.BodyParser(&deliveryPayload); err != nil {
			log.Printf("Failed to parse delivery state payload: %v", err)
			return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid delivery state payload"})
		}

		// Check if payload was parsed successfully
		if deliveryPayload.Action == "" {
			log.Printf("Delivery state payload missing action field")
			return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Missing action in delivery state payload"})
		}

		// Process delivery state fields
		if deliveryPayload.DeliveryType != "" {
			updateFields = append(updateFields, "delivery_type = ?")
			updateArgs = append(updateArgs, deliveryPayload.DeliveryType)
		}
		if deliveryPayload.PaymentMethod != "" {
			updateFields = append(updateFields, "payment_method = ?")
			updateArgs = append(updateArgs, deliveryPayload.PaymentMethod)
		}
		if deliveryPayload.PaymentConfirmed != nil {
			updateFields = append(updateFields, "payment_confirmed = ?")
			updateArgs = append(updateArgs, *deliveryPayload.PaymentConfirmed)
		}
		if deliveryPayload.DeliveryInstructions != nil {
			updateFields = append(updateFields, "delivery_instructions = ?")
			updateArgs = append(updateArgs, *deliveryPayload.DeliveryInstructions)
		}
		if deliveryPayload.ProofOfDelivery != "" {
			updateFields = append(updateFields, "proof_of_delivery = ?")
			updateArgs = append(updateArgs, deliveryPayload.ProofOfDelivery)
		}
		if deliveryPayload.BuyerConfirmedReceipt != nil {
			updateFields = append(updateFields, "buyer_confirmed_receipt = ?")
			updateArgs = append(updateArgs, *deliveryPayload.BuyerConfirmedReceipt)
		}
		if deliveryPayload.SellerConfirmedDelivery != nil {
			updateFields = append(updateFields, "seller_confirmed_delivery = ?")
			updateArgs = append(updateArgs, *deliveryPayload.SellerConfirmedDelivery)
		}

		if len(updateFields) == 0 {
			return c.Status(400).JSON(models.APIResponse{Success: false, Error: "No fields to update"})
		}

		// Add timestamp update
		updateFields = append(updateFields, "updated_at = CURRENT_TIMESTAMP")

		// Build update query
		updateQuery := "UPDATE trades SET "
		for i, field := range updateFields {
			if i > 0 {
				updateQuery += ", "
			}
			updateQuery += field
		}
		updateQuery += " WHERE id = ?"

		// Append trade ID to args
		updateArgs = append(updateArgs, tradeID)

		log.Printf("Executing delivery state update: %s with args: %v", updateQuery, updateArgs)
		result, err := h.db.Exec(updateQuery, updateArgs...)
		if err != nil {
			log.Printf("Failed to update delivery state for trade %d: %v", tradeID, err)
			// Try to provide more specific error information
			if strings.Contains(err.Error(), "Unknown column") {
				log.Printf("Database schema issue: delivery state columns may be missing")
				return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Database schema error: delivery state columns missing"})
			}
			return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to update delivery state"})
		}

		// Log how many rows were affected
		rowsAffected, _ := result.RowsAffected()
		log.Printf("Delivery state update successful, affected %d rows", rowsAffected)

		// If delivery type was updated on the trade, propagate it to any pending/unclaimed delivery jobs
		// created for this trade. Rider pages read from `deliveries.delivery_type`.
		if deliveryPayload.DeliveryType != "" {
			newType := strings.ToLower(strings.TrimSpace(deliveryPayload.DeliveryType))
			if newType != "standard" && newType != "express" {
				return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid delivery_type. Must be 'standard' or 'express'"})
			}

			newCost := 30.0
			if newType == "express" {
				newCost = 60.0
			}

			res2, err2 := h.db.Exec(
				"UPDATE deliveries SET delivery_type = ?, total_cost = ?, updated_at = CURRENT_TIMESTAMP WHERE trade_id = ? AND status = 'pending' AND rider_id IS NULL",
				newType,
				newCost,
				tradeID,
			)
			if err2 != nil {
				log.Printf("Warning: failed to propagate delivery_type to deliveries for trade %d: %v", tradeID, err2)
			} else {
				updatedDeliveries, _ := res2.RowsAffected()
				log.Printf("Propagated delivery_type=%s to %d pending/unclaimed deliveries for trade %d", newType, updatedDeliveries, tradeID)
			}
		}

		// Notify other party of the update
		var otherUserID int
		if userID == buyerID {
			otherUserID = sellerID
		} else {
			otherUserID = buyerID
		}

		notifMsg := "Trade delivery status has been updated"
		_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", otherUserID, notifMsg)
		publishToUser(otherUserID, sseEvent{Type: "trade_delivery_state_updated", Data: fiber.Map{"trade_id": tradeID}})

		log.Printf("Delivery state updated successfully for trade %d", tradeID)
	case "request_option_change":
		requestedOption := payload.RequestedOption
		if requestedOption != "meetup" && requestedOption != "delivery" {
			return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid option. Must be 'meetup' or 'delivery'"})
		}
		_, err = h.db.Exec("UPDATE trades SET option_change_requested=?, updated_at=CURRENT_TIMESTAMP WHERE id=?", requestedOption, tradeID)
		if err != nil {
			return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to request option change"})
		}
		// Notify the other party
		var notifyID int
		if userID == buyerID {
			notifyID = sellerID
		} else {
			notifyID = buyerID
		}
		_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", notifyID, fmt.Sprintf("Trade option change requested to %s", requestedOption))
		publishToUser(notifyID, sseEvent{Type: "trade_updated", Data: fiber.Map{"trade_id": tradeID}})

	case "approve_option_change":
		// Get the requested option
		var requestedOption sql.NullString
		h.db.QueryRow("SELECT option_change_requested FROM trades WHERE id=?", tradeID).Scan(&requestedOption)
		if !requestedOption.Valid || requestedOption.String == "" {
			return c.Status(400).JSON(models.APIResponse{Success: false, Error: "No pending option change"})
		}
		_, err = h.db.Exec("UPDATE trades SET trade_option=?, option_change_requested=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=?", requestedOption.String, tradeID)
		if err != nil {
			return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to approve option change"})
		}
		// Notify requester
		var notifyID2 int
		if userID == buyerID {
			notifyID2 = sellerID
		} else {
			notifyID2 = buyerID
		}
		_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", notifyID2, "Trade option change approved")
		publishToUser(notifyID2, sseEvent{Type: "trade_updated", Data: fiber.Map{"trade_id": tradeID}})

	case "reject_option_change":
		_, err = h.db.Exec("UPDATE trades SET option_change_requested=NULL, updated_at=CURRENT_TIMESTAMP WHERE id=?", tradeID)
		if err != nil {
			return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to reject option change"})
		}
		var notifyID3 int
		if userID == buyerID {
			notifyID3 = sellerID
		} else {
			notifyID3 = buyerID
		}
		_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", notifyID3, "Trade option change rejected")
		publishToUser(notifyID3, sseEvent{Type: "trade_updated", Data: fiber.Map{"trade_id": tradeID}})

	case "convert_to_multiway":
		return c.Status(400).JSON(models.APIResponse{
			Success: false,
			Error:   "Multiway trades are created only from explicit product likes. Use Find Match, then like items from the selected product's suggestions.",
		})

	default:
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid action"})
	}

	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to update trade"})
	}

	return c.JSON(models.APIResponse{Success: true, Message: "Trade updated"})
}

// completeTradeTransaction safely completes a trade and marks all products as traded
func (h *TradeHandler) completeTradeTransaction(tradeID int) error {
	log.Printf("Starting trade completion for trade ID: %d", tradeID)

	tx, err := h.db.Begin()
	if err != nil {
		log.Printf("Failed to start transaction for trade %d: %v", tradeID, err)
		return fmt.Errorf("failed to start transaction: %w", err)
	}
	defer tx.Rollback()

	// Lock the trade row to prevent concurrent completions
	var currentStatus string
	var targetProductID int
	var buyerID, sellerID int
	var buyerCompleted, sellerCompleted bool

	err = tx.QueryRow(`
		SELECT status, target_product_id, buyer_completed, seller_completed, buyer_id, seller_id
		FROM trades 
		WHERE id = ? 
		FOR UPDATE`, tradeID).Scan(&currentStatus, &targetProductID, &buyerCompleted, &sellerCompleted, &buyerID, &sellerID)

	if err != nil {
		log.Printf("Trade %d not found: %v", tradeID, err)
		return fmt.Errorf("trade not found: %w", err)
	}

	log.Printf("Trade %d status: %s, buyer_completed: %t, seller_completed: %t", tradeID, currentStatus, buyerCompleted, sellerCompleted)

	// If already completed, nothing to do
	if currentStatus == "completed" {
		log.Printf("Trade %d is already completed, skipping", tradeID)
		return nil
	}

	// Verify both parties have completed
	if !buyerCompleted || !sellerCompleted {
		log.Printf("Trade %d: Both parties must complete - buyer: %t, seller: %t", tradeID, buyerCompleted, sellerCompleted)
		return fmt.Errorf("both parties must complete the trade before finalizing")
	}

	// Get all offered products in this trade
	rows, err := tx.Query(`
		SELECT product_id 
		FROM trade_items 
		WHERE trade_id = ?`, tradeID)

	if err != nil {
		log.Printf("Failed to get trade items for trade %d: %v", tradeID, err)
		return fmt.Errorf("failed to get trade items: %w", err)
	}
	defer rows.Close()

	var offeredProductIDs []int
	for rows.Next() {
		var productID int
		if err := rows.Scan(&productID); err != nil {
			log.Printf("Failed to scan product ID for trade %d: %v", tradeID, err)
			return fmt.Errorf("failed to scan product ID: %w", err)
		}
		offeredProductIDs = append(offeredProductIDs, productID)
	}

	log.Printf("Trade %d: Target product: %d, Offered products: %v", tradeID, targetProductID, offeredProductIDs)

	// Mark target product as traded with locking
	err = h.markProductUnavailable(tx, targetProductID)
	if err != nil {
		log.Printf("Failed to mark target product %d as traded: %v", targetProductID, err)
		return fmt.Errorf("failed to mark target product as traded: %w", err)
	}

	// Mark all offered products as traded
	for _, productID := range offeredProductIDs {
		err = h.markProductUnavailable(tx, productID)
		if err != nil {
			log.Printf("Failed to mark offered product %d as traded: %v", productID, err)
			return fmt.Errorf("failed to mark offered product %d as traded: %w", productID, err)
		}
	}

	// Update trade status to completed
	result, err := tx.Exec(`
		UPDATE trades 
		SET status = 'completed', completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP 
		WHERE id = ?`, tradeID)

	if err != nil {
		log.Printf("Failed to update trade %d status: %v", tradeID, err)
		return fmt.Errorf("failed to update trade status: %w", err)
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		log.Printf("Failed to check trade update result for trade %d: %v", tradeID, err)
		return fmt.Errorf("failed to check trade update result: %w", err)
	}

	if rowsAffected == 0 {
		log.Printf("Trade %d was already completed by another process", tradeID)
		return fmt.Errorf("trade was already completed by another process")
	}

	// For MUTUAL TRADES: also complete the paired trade record
	// Find the reverse/paired trade where roles are swapped
	var pairedTradeID int
	err = tx.QueryRow(`
		SELECT id FROM trades
		WHERE buyer_id = ? AND seller_id = ? 
		AND status IN ('pending', 'accepted', 'active', 'awaiting_confirmation')
		LIMIT 1
	`, sellerID, buyerID).Scan(&pairedTradeID)

	if err == nil && pairedTradeID > 0 && pairedTradeID != tradeID {
		// Found a paired mutual trade - complete it too
		log.Printf("[MUTUAL TRADE COMPLETE] Completing paired trade %d alongside trade %d", pairedTradeID, tradeID)
		_, err = tx.Exec(`
			UPDATE trades 
			SET status = 'completed', completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP 
			WHERE id = ?`, pairedTradeID)
		if err != nil {
			log.Printf("Warning: Failed to complete paired trade %d: %v", pairedTradeID, err)
			// Continue anyway - main trade is completed
		}
	}

	log.Printf("Successfully completed trade %d and marked products as traded", tradeID)
	return tx.Commit()
}

// markProductUnavailable marks a product as traded with row locking
func (h *TradeHandler) markProductUnavailable(tx *sql.Tx, productID int) error {
	log.Printf("Attempting to mark product %d as traded", productID)

	// Lock and verify product
	var currentStatus string

	err := tx.QueryRow(`
		SELECT status 
		FROM products 
		WHERE id = ? 
		FOR UPDATE`, productID).Scan(&currentStatus)

	if err != nil {
		log.Printf("Product %d not found: %v", productID, err)
		return fmt.Errorf("product %d not found: %w", productID, err)
	}

	log.Printf("Product %d current status: %s", productID, currentStatus)

	// Allow both 'available' and 'locked' status.
	// Products are locked when a trade is accepted/active.
	if currentStatus != "available" && currentStatus != "locked" {
		log.Printf("Warning: Product %d is already in an un-tradable state (status: %s), skipping", productID, currentStatus)
		return nil // Don't fail the entire trade if one product is already finalized/unavailable
	}

	// Update product status to traded
	result, err := tx.Exec(`
		UPDATE products 
		SET status = 'traded', updated_at = CURRENT_TIMESTAMP 
		WHERE id = ? AND (status = 'available' OR status = 'locked')`,
		productID)

	if err != nil {
		log.Printf("Failed to update product %d status: %v", productID, err)
		return fmt.Errorf("failed to update product %d status: %w", productID, err)
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		log.Printf("Failed to check update result for product %d: %v", productID, err)
		return fmt.Errorf("failed to check update result for product %d: %w", productID, err)
	}

	if rowsAffected == 0 {
		log.Printf("Product %d was not updated - may have been modified by another transaction", productID)
		return fmt.Errorf("product %d was modified by another transaction", productID)
	}

	log.Printf("Successfully marked product %d as traded", productID)
	return nil
}

// createDeliveryForTrade auto-creates a delivery record linked to a trade when a delivery trade is accepted.
// Runs as a goroutine so it does not block the trade acceptance response.
func (h *TradeHandler) createDeliveryForTrade(tradeID, buyerID, sellerID int) {
	log.Printf("Creating delivery record for trade %d", tradeID)

	// Get trade delivery info
	var deliveryAddress sql.NullString
	var deliveryType sql.NullString
	err := h.db.QueryRow(
		"SELECT delivery_address, delivery_type FROM trades WHERE id = ?", tradeID,
	).Scan(&deliveryAddress, &deliveryType)
	if err != nil {
		log.Printf("Failed to get trade delivery info for trade %d: %v", tradeID, err)
		return
	}

	// Get buyer-offered items
	rows, err := h.db.Query("SELECT product_id FROM trade_items WHERE trade_id = ? AND offered_by = 'buyer'", tradeID)
	if err != nil {
		log.Printf("Failed to get trade items for trade %d: %v", tradeID, err)
		return
	}
	defer rows.Close()

	var buyerOfferedProductIDs []int
	for rows.Next() {
		var pid int
		if err := rows.Scan(&pid); err != nil {
			continue
		}
		buyerOfferedProductIDs = append(buyerOfferedProductIDs, pid)
	}

	// Also include the target product
	var targetProductID int
	_ = h.db.QueryRow("SELECT target_product_id FROM trades WHERE id = ?", tradeID).Scan(&targetProductID)
	if targetProductID <= 0 {
		log.Printf("Trade %d has no target product id; skipping delivery creation", tradeID)
		return
	}

	// Get seller location for pickup
	var sellerLat, sellerLon sql.NullFloat64
	var sellerAddr sql.NullString
	_ = h.db.QueryRow("SELECT latitude, longitude, COALESCE(bio, '') FROM users WHERE id = ?", sellerID).Scan(&sellerLat, &sellerLon, &sellerAddr)

	// Get buyer location (for delivery)
	var buyerLat, buyerLon sql.NullFloat64
	var buyerAddr sql.NullString
	_ = h.db.QueryRow("SELECT latitude, longitude, COALESCE(bio, '') FROM users WHERE id = ?", buyerID).Scan(&buyerLat, &buyerLon, &buyerAddr)
	_ = buyerAddr

	// Determine delivery type
	delType := "standard"
	if deliveryType.Valid && deliveryType.String != "" {
		delType = deliveryType.String
	}

	// Calculate cost
	var totalCost float64
	if delType == "express" {
		totalCost = 60.0
	} else {
		totalCost = 30.0
	}

	// Determine pickup address
	pickupAddr := "Seller location"
	if sellerAddr.Valid && sellerAddr.String != "" {
		pickupAddr = sellerAddr.String
	}

	// Determine delivery address
	delAddr := "Buyer location"
	if deliveryAddress.Valid && deliveryAddress.String != "" {
		delAddr = deliveryAddress.String
	}

	// Delivery is buyout-only. If there are buyer-offered items, do not create a delivery.
	if len(buyerOfferedProductIDs) > 0 {
		log.Printf("Trade %d is not a buyout; skipping delivery creation", tradeID)
		return
	}

	// Buyout flow: single delivery for the target product (seller -> buyer).
	createDelivery := func(ownerUserID int, pickupLat, pickupLon sql.NullFloat64, pickupAddress string, dropLat, dropLon sql.NullFloat64, dropAddress string, itemIDs []int) (int, error) {
		result, err := h.db.Exec(`
			INSERT INTO deliveries (
				user_id, trade_id, delivery_type, status,
				pickup_latitude, pickup_longitude, pickup_address,
				delivery_latitude, delivery_longitude, delivery_address,
				item_count, total_cost, is_fragile
			) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, FALSE)`,
			ownerUserID, tradeID, delType,
			pickupLat, pickupLon, pickupAddress,
			dropLat, dropLon, dropAddress,
			len(itemIDs), totalCost,
		)
		if err != nil {
			return 0, err
		}
		deliveryID64, _ := result.LastInsertId()
		deliveryID := int(deliveryID64)

		for _, pid := range itemIDs {
			var productName string
			_ = h.db.QueryRow("SELECT title FROM products WHERE id = ?", pid).Scan(&productName)
			_, itemErr := h.db.Exec(
				"INSERT INTO delivery_items (delivery_id, product_id, product_name, is_fragile) VALUES (?, ?, ?, FALSE)",
				deliveryID, pid, productName,
			)
			if itemErr != nil {
				log.Printf("Warning: failed to insert delivery item for product %d: %v", pid, itemErr)
			}
		}

		return deliveryID, nil
	}

	leg1ID, err := createDelivery(
		sellerID,
		sellerLat, sellerLon, pickupAddr,
		buyerLat, buyerLon, delAddr,
		[]int{targetProductID},
	)
	if err != nil {
		log.Printf("Failed to create leg1 delivery for trade %d: %v", tradeID, err)
		return
	}
	log.Printf("Created leg1 delivery %d for trade %d (seller -> buyer)", leg1ID, tradeID)

	createdIDs := []int{leg1ID}

	// Notify both parties
	msgBuyer := "Your buyout offer was accepted. A rider will collect payment and deliver your item."
	msgSeller := "You accepted a buyout offer. A rider will collect payment and deliver your item."
	_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'delivery_update', ?, FALSE)", buyerID, msgBuyer)
	_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'delivery_update', ?, FALSE)", sellerID, msgSeller)

	// Send SSE events (best-effort)
	for _, id := range createdIDs {
		publishToUser(buyerID, sseEvent{Type: "delivery_created", Data: fiber.Map{"trade_id": tradeID, "delivery_id": id}})
		publishToUser(sellerID, sseEvent{Type: "delivery_created", Data: fiber.Map{"trade_id": tradeID, "delivery_id": id}})
	}

	log.Printf("Trade %d delivery creation complete (created %d leg(s))", tradeID, len(createdIDs))
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
	// Build query dynamically for single trade
	query := `
        SELECT
		  t.id, t.buyer_id, t.seller_id, t.target_product_id, t.status, COALESCE(t.message, '') as message, t.offered_cash_amount, t.created_at, t.updated_at,
          t.buyer_completed, t.seller_completed, COALESCE(t.buyer_accepted, FALSE) as buyer_accepted, COALESCE(t.seller_accepted, FALSE) as seller_accepted, t.completed_at`

	// Check if trade_option column exists
	testRow := h.db.QueryRow("SELECT trade_option FROM trades LIMIT 1")
	var testTradeOption sql.NullString
	if err := testRow.Scan(&testTradeOption); err == nil {
		// Column exists, include it in query
		query += `, COALESCE(t.trade_option, '') as trade_option, COALESCE(t.meeting_type, '') as meeting_type, COALESCE(t.delivery_address, '') as delivery_address`
	} else {
		// Column doesn't exist, use empty defaults
		query += `, '' as trade_option, '' as meeting_type, '' as delivery_address`
	}

	// Check if delivery state columns exist (delivery progress + instructions)
	deliveryStateQuery := `
		SELECT
			COALESCE(t.delivery_type, '') as delivery_type,
			COALESCE(t.payment_method, '') as payment_method,
			COALESCE(t.payment_confirmed, FALSE) as payment_confirmed,
			COALESCE(t.delivery_instructions, '') as delivery_instructions,
			t.proof_of_delivery,
			COALESCE(t.buyer_confirmed_receipt, FALSE) as buyer_confirmed_receipt,
			COALESCE(t.seller_confirmed_delivery, FALSE) as seller_confirmed_delivery
		FROM trades t LIMIT 1`
	testDeliveryRow := h.db.QueryRow(deliveryStateQuery)
	var testDeliveryType, testPaymentMethod, testDeliveryInstructions string
	var testPaymentConfirmed, testBuyerConfirmed, testSellerConfirmed bool
	var testProofOfDelivery sql.NullString
	if err := testDeliveryRow.Scan(&testDeliveryType, &testPaymentMethod, &testPaymentConfirmed, &testDeliveryInstructions, &testProofOfDelivery, &testBuyerConfirmed, &testSellerConfirmed); err == nil {
		query += `,
			COALESCE(t.delivery_type, '') as delivery_type,
			COALESCE(t.payment_method, '') as payment_method,
			COALESCE(t.payment_confirmed, FALSE) as payment_confirmed,
			COALESCE(t.delivery_instructions, '') as delivery_instructions,
			t.proof_of_delivery,
			COALESCE(t.buyer_confirmed_receipt, FALSE) as buyer_confirmed_receipt,
			COALESCE(t.seller_confirmed_delivery, FALSE) as seller_confirmed_delivery`
	} else {
		query += `,
			'' as delivery_type,
			'' as payment_method,
			FALSE as payment_confirmed,
			'' as delivery_instructions,
			NULL as proof_of_delivery,
			FALSE as buyer_confirmed_receipt,
			FALSE as seller_confirmed_delivery`
	}

	query += `,
          COALESCE(t.meetup_location, '') as meetup_location,
          COALESCE(t.meetup_time, '') as meetup_time,
          t.buyer_meetup_confirmed, t.seller_meetup_confirmed,
          COALESCE(t.buyer_meetup_location, '') as buyer_meetup_location,
          COALESCE(t.buyer_meetup_time, '') as buyer_meetup_time,
          COALESCE(t.seller_meetup_location, '') as seller_meetup_location,
          COALESCE(t.seller_meetup_time, '') as seller_meetup_time,
					COALESCE(t.buyer_met, FALSE) as buyer_met,
					COALESCE(t.seller_met, FALSE) as seller_met,
					COALESCE(t.countered_by, 0) as countered_by,
					t.parent_trade_id,
          ub.name AS buyer_name, us.name AS seller_name, COALESCE(p.title, 'Deleted product') AS product_title,
          COALESCE(NULLIF(p.pickup_address, ''), NULLIF(us.home_address, ''), '') AS target_product_pickup_address
        FROM trades t
        JOIN users ub ON ub.id = t.buyer_id
        JOIN users us ON us.id = t.seller_id
        LEFT JOIN products p ON p.id = t.target_product_id
        WHERE t.id = ?`

	var deliveryType, paymentMethod, deliveryInstructions string
	var paymentConfirmed, buyerConfirmedReceipt, sellerConfirmedDelivery bool
	var proofOfDelivery sql.NullString
	var offeredCashNull sql.NullFloat64
	var targetPickupAddr sql.NullString
	err = h.db.QueryRow(query, tradeID).Scan(&tr.ID, &tr.BuyerID, &tr.SellerID, &tr.TargetProductID, &tr.Status, &tr.Message, &offeredCashNull, &tr.CreatedAt, &tr.UpdatedAt, &tr.BuyerCompleted, &tr.SellerCompleted, &tr.BuyerAccepted, &tr.SellerAccepted, &tr.CompletedAt, &tr.TradeOption, &tr.MeetingType, &tr.DeliveryAddress, &deliveryType, &paymentMethod, &paymentConfirmed, &deliveryInstructions, &proofOfDelivery, &buyerConfirmedReceipt, &sellerConfirmedDelivery, &tr.MeetupLocation, &tr.MeetupTime, &tr.BuyerMeetupConfirmed, &tr.SellerMeetupConfirmed, &tr.BuyerMeetupLocation, &tr.BuyerMeetupTime, &tr.SellerMeetupLocation, &tr.SellerMeetupTime, &tr.BuyerMet, &tr.SellerMet, &tr.CounteredBy, &tr.ParentTradeID, &tr.BuyerName, &tr.SellerName, &tr.ProductTitle, &targetPickupAddr)
	if targetPickupAddr.Valid {
		tr.TargetProductPickupAddress = targetPickupAddr.String
	}
	if offeredCashNull.Valid {
		val := offeredCashNull.Float64
		tr.OfferedCash = &val
	}
	tr.DeliveryType = deliveryType
	tr.PaymentMethod = paymentMethod
	tr.PaymentConfirmed = paymentConfirmed
	tr.DeliveryInstructions = deliveryInstructions
	if proofOfDelivery.Valid {
		tr.ProofOfDelivery = proofOfDelivery.String
	}
	tr.BuyerConfirmedReceipt = buyerConfirmedReceipt
	tr.SellerConfirmedDelivery = sellerConfirmedDelivery
	if err != nil {
		return c.Status(404).JSON(models.APIResponse{Success: false, Error: "Trade not found"})
	}
	if userID != tr.BuyerID && userID != tr.SellerID {
		return c.Status(403).JSON(models.APIResponse{Success: false, Error: "Not authorized for this trade"})
	}
	itemRows, qerr := h.db.Query(`
                SELECT ti.id, ti.trade_id, ti.product_id, ti.offered_by, ti.created_at,
                       p.title, p.status, p.image_url, p.image_urls, COALESCE(p.pickup_address, '')
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
			var pimgs sql.NullString
			var pickupAddr sql.NullString
			if err := itemRows.Scan(&it.ID, &it.TradeID, &it.ProductID, &offeredBy, &it.CreatedAt, &title, &pstatus, &pimg, &pimgs, &pickupAddr); err == nil {
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
				if pickupAddr.Valid {
					it.ProductPickupAddress = pickupAddr.String
				}
				// Prefer image_url; fall back to first of image_urls JSON/text array
				if pimg.Valid && pimg.String != "" {
					it.ProductImageURL = pimg.String
				} else if pimgs.Valid && pimgs.String != "" {
					var first string
					first = extractFirstImage(pimgs.String)
					if first != "" {
						it.ProductImageURL = first
					}
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
					var title, pstatus, pimg, pimgs sql.NullString
					_ = h.db.QueryRow("SELECT title, status, image_url, image_urls FROM products WHERE id = ?", it.ProductID).Scan(&title, &pstatus, &pimg, &pimgs)
					if title.Valid {
						it.ProductTitle = title.String
					}
					if pstatus.Valid {
						it.ProductStatus = pstatus.String
					}
					if pimg.Valid && pimg.String != "" {
						it.ProductImageURL = pimg.String
					} else if pimgs.Valid && pimgs.String != "" {
						if first := extractFirstImage(pimgs.String); first != "" {
							it.ProductImageURL = first
						}
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

// GetUserTradeHistory returns completed trades for a specific user (public endpoint)
func (h *TradeHandler) GetUserTradeHistory(c *fiber.Ctx) error {
	identifier := c.Params("id")
	if identifier == "" {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "User ID or handle is required"})
	}

	userHandler := NewUserHandler()
	targetUserID, err := userHandler.ResolveUserID(identifier)
	if err != nil {
		return c.Status(404).JSON(models.APIResponse{Success: false, Error: "User not found"})
	}

	// Check if proof URL columns exist (older DBs may not have them yet)
	proofColsExist := false
	{
		var cnt int
		_ = h.db.QueryRow(`SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'trades' AND COLUMN_NAME IN ('buyer_proof_url', 'seller_proof_url')`).Scan(&cnt)
		proofColsExist = cnt >= 2
	}

	query := `
		SELECT
			t.id, t.buyer_id, t.seller_id, t.target_product_id, t.status,
			COALESCE(t.message, '') as message,
			t.created_at, t.completed_at,
			ub.name AS buyer_name, us.name AS seller_name,
			COALESCE(p.title, 'Deleted product') AS product_title,
			p.image_url AS product_image_url,
			p.image_urls AS product_image_urls,
			t.buyer_rating, t.seller_rating,
			COALESCE(t.buyer_feedback, '') as buyer_feedback,
			COALESCE(t.seller_feedback, '') as seller_feedback`

	if proofColsExist {
		query += `,
			COALESCE(t.buyer_proof_url, '') as buyer_proof_url,
			COALESCE(t.seller_proof_url, '') as seller_proof_url`
	} else {
		query += `,
			'' as buyer_proof_url,
			'' as seller_proof_url`
	}

	query += `
		FROM trades t
		JOIN users ub ON ub.id = t.buyer_id
		JOIN users us ON us.id = t.seller_id
		LEFT JOIN products p ON p.id = t.target_product_id
		WHERE (t.buyer_id = ? OR t.seller_id = ?) AND t.status = 'completed'
		ORDER BY COALESCE(t.completed_at, t.updated_at) DESC
		LIMIT 50
	`

	rows, err := h.db.Query(query, targetUserID, targetUserID)
	if err != nil {
		log.Printf("Ã¢ÂÅ’ GetUserTradeHistory: query error for user %d: %v", targetUserID, err)
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to fetch trade history"})
	}
	defer rows.Close()

	type PublicTrade struct {
		ID             int         `json:"id"`
		BuyerID        int         `json:"buyer_id"`
		SellerID       int         `json:"seller_id"`
		ProductID      int         `json:"target_product_id"`
		Status         string      `json:"status"`
		Message        string      `json:"message,omitempty"`
		CreatedAt      time.Time   `json:"created_at"`
		CompletedAt    *time.Time  `json:"completed_at,omitempty"`
		BuyerName      string      `json:"buyer_name"`
		SellerName     string      `json:"seller_name"`
		ProductTitle   string      `json:"product_title"`
		ProductImage   string      `json:"product_image_url,omitempty"`
		BuyerRating    *int        `json:"buyer_rating,omitempty"`
		SellerRating   *int        `json:"seller_rating,omitempty"`
		BuyerFeedback  string      `json:"buyer_feedback,omitempty"`
		SellerFeedback string      `json:"seller_feedback,omitempty"`
		BuyerProofURL  string      `json:"buyer_proof_url,omitempty"`
		SellerProofURL string      `json:"seller_proof_url,omitempty"`
		Items          []fiber.Map `json:"items"`
	}

	var trades []PublicTrade
	tradeIDs := []int{}

	for rows.Next() {
		var t PublicTrade
		var pimg, pimgs sql.NullString
		var completedAt sql.NullTime
		var buyerProofURL, sellerProofURL sql.NullString

		if err := rows.Scan(
			&t.ID, &t.BuyerID, &t.SellerID, &t.ProductID, &t.Status, &t.Message,
			&t.CreatedAt, &completedAt,
			&t.BuyerName, &t.SellerName, &t.ProductTitle,
			&pimg, &pimgs,
			&t.BuyerRating, &t.SellerRating,
			&t.BuyerFeedback, &t.SellerFeedback,
			&buyerProofURL, &sellerProofURL,
		); err != nil {
			log.Printf("Ã¢Å¡Â Ã¯Â¸Â GetUserTradeHistory: scan error: %v", err)
			continue
		}

		if buyerProofURL.Valid {
			t.BuyerProofURL = buyerProofURL.String
		}
		if sellerProofURL.Valid {
			t.SellerProofURL = sellerProofURL.String
		}

		if completedAt.Valid {
			t.CompletedAt = &completedAt.Time
		}

		// Resolve product image
		if pimg.Valid && pimg.String != "" {
			t.ProductImage = pimg.String
		} else if pimgs.Valid && pimgs.String != "" {
			t.ProductImage = extractFirstImage(pimgs.String)
		}

		t.Items = []fiber.Map{}
		trades = append(trades, t)
		tradeIDs = append(tradeIDs, t.ID)
	}

	// Batch-fetch trade items
	if len(tradeIDs) > 0 {
		placeholders := make([]string, len(tradeIDs))
		itemArgs := make([]interface{}, len(tradeIDs))
		for i, tid := range tradeIDs {
			placeholders[i] = "?"
			itemArgs[i] = tid
		}
		itemQuery := `
			SELECT ti.trade_id, ti.product_id, p.title, p.image_url, p.image_urls
			FROM trade_items ti
			JOIN products p ON p.id = ti.product_id
			WHERE ti.trade_id IN (` + strings.Join(placeholders, ",") + `)
			ORDER BY ti.trade_id, ti.id
		`
		itemRows, err := h.db.Query(itemQuery, itemArgs...)
		if err == nil {
			defer itemRows.Close()
			// Build map of trade_id -> items
			tradeItemsMap := make(map[int][]fiber.Map)
			for itemRows.Next() {
				var tradeID, productID int
				var title string
				var iimg, iimgs sql.NullString
				if err := itemRows.Scan(&tradeID, &productID, &title, &iimg, &iimgs); err == nil {
					imgURL := ""
					if iimg.Valid && iimg.String != "" {
						imgURL = iimg.String
					} else if iimgs.Valid && iimgs.String != "" {
						imgURL = extractFirstImage(iimgs.String)
					}
					tradeItemsMap[tradeID] = append(tradeItemsMap[tradeID], fiber.Map{
						"product_id":        productID,
						"product_title":     title,
						"product_image_url": imgURL,
					})
				}
			}
			for i := range trades {
				if items, ok := tradeItemsMap[trades[i].ID]; ok {
					trades[i].Items = items
				}
			}
		}
	}

	if trades == nil {
		trades = []PublicTrade{}
	}

	return c.JSON(models.APIResponse{Success: true, Data: trades})
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
	if err := c.BodyParser(&payload); err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid content"})
	}
	payload.Content = cleanUserText(payload.Content, 2000)
	if payload.Content == "" {
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

// GetTradeLoopMessages returns messages for a trade loop
func (h *TradeHandler) GetTradeLoopMessages(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}
	loopIDStr := c.Params("id")
	loopID, valid := parseLikeLoopID(loopIDStr)
	if !valid {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid loop id"})
	}
	// Check if user is a participant in this loop
	var participantCount int
	err := h.db.QueryRow("SELECT COUNT(*) FROM trade_like_loop_participants WHERE loop_id = ? AND user_id = ?", loopID, userID).Scan(&participantCount)
	if err != nil || participantCount == 0 {
		return c.Status(403).JSON(models.APIResponse{Success: false, Error: "Not authorized for this loop"})
	}
	rows, err := h.db.Query("SELECT id, loop_id, sender_id, content, created_at FROM trade_loop_messages WHERE loop_id = ? ORDER BY created_at ASC", loopID)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to fetch messages"})
	}
	defer rows.Close()
	type msg struct {
		ID        int       `json:"id"`
		LoopID    int       `json:"loop_id"`
		SenderID  int       `json:"sender_id"`
		Content   string    `json:"content"`
		CreatedAt time.Time `json:"created_at"`
	}
	list := []msg{}
	for rows.Next() {
		var m msg
		if err := rows.Scan(&m.ID, &m.LoopID, &m.SenderID, &m.Content, &m.CreatedAt); err == nil {
			list = append(list, m)
		}
	}
	return c.JSON(models.APIResponse{Success: true, Data: list})
}

// SendTradeLoopMessage posts a new message for a trade loop and notifies all participants
func (h *TradeHandler) SendTradeLoopMessage(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}
	loopIDStr := c.Params("id")
	loopID, valid := parseLikeLoopID(loopIDStr)
	if !valid {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid loop id"})
	}
	var payload struct {
		Content string `json:"content"`
	}
	if err := c.BodyParser(&payload); err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid content"})
	}
	payload.Content = cleanUserText(payload.Content, 2000)
	if payload.Content == "" {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid content"})
	}
	// Check if user is a participant in this loop
	var participantCount int
	err := h.db.QueryRow("SELECT COUNT(*) FROM trade_like_loop_participants WHERE loop_id = ? AND user_id = ?", loopID, userID).Scan(&participantCount)
	if err != nil || participantCount == 0 {
		return c.Status(403).JSON(models.APIResponse{Success: false, Error: "Not authorized for this loop"})
	}
	// insert message
	res, err := h.db.Exec("INSERT INTO trade_loop_messages (loop_id, sender_id, content) VALUES (?, ?, ?)", loopID, userID, payload.Content)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to save message"})
	}
	id64, _ := res.LastInsertId()
	var createdAt time.Time
	_ = h.db.QueryRow("SELECT created_at FROM trade_loop_messages WHERE id = ?", id64).Scan(&createdAt)
	// Get all participants in the loop to notify them
	participantRows, err := h.db.Query("SELECT DISTINCT user_id FROM trade_like_loop_participants WHERE loop_id = ?", loopID)
	if err == nil {
		defer participantRows.Close()
		evt := sseEvent{Type: "trade_loop_message", Data: fiber.Map{
			"id":         int(id64),
			"loop_id":    loopID,
			"sender_id":  userID,
			"content":    payload.Content,
			"created_at": createdAt,
		}}
		for participantRows.Next() {
			var participantID int
			if err := participantRows.Scan(&participantID); err == nil {
				publishToUser(participantID, evt)
			}
		}
	}
	return c.Status(201).JSON(models.APIResponse{Success: true})
}

// getTradeLoopParticipantUserIDs returns the set of user IDs participating in a loop.
// Supports like loops, multiway chains, product loops, and graph loops.
func (h *TradeHandler) getTradeLoopParticipantUserIDs(loopID string) ([]int, error) {
	// Like loop
	if likeLoopID, ok := parseLikeLoopID(loopID); ok {
		rows, err := h.db.Query("SELECT DISTINCT user_id FROM trade_like_loop_participants WHERE loop_id = ?", likeLoopID)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		ids := []int{}
		for rows.Next() {
			var uid int
			if scanErr := rows.Scan(&uid); scanErr == nil {
				ids = append(ids, uid)
			}
		}
		if len(ids) == 0 {
			return nil, sql.ErrNoRows
		}
		return ids, nil
	}

	// Multiway chain
	if strings.HasPrefix(loopID, "chain_") {
		var u1ID, u2ID, u3ID int
		err := h.db.QueryRow("SELECT user1_id, user2_id, COALESCE(user3_id, 0) FROM multiway_trades WHERE chain_id = ?", loopID).
			Scan(&u1ID, &u2ID, &u3ID)
		if err != nil {
			// Backward compatibility: chain_123 numeric IDs
			chainID, convErr := strconv.Atoi(strings.Replace(loopID, "chain_", "", 1))
			if convErr == nil {
				err = h.db.QueryRow("SELECT user1_id, user2_id, COALESCE(user3_id, 0) FROM multiway_trades WHERE id = ?", chainID).
					Scan(&u1ID, &u2ID, &u3ID)
			}
		}
		if err != nil {
			return nil, err
		}
		ids := []int{}
		for _, uid := range []int{u1ID, u2ID, u3ID} {
			if uid > 0 {
				ids = append(ids, uid)
			}
		}
		return ids, nil
	}

	// Product loop: product_loop_{prodA}_{prodB}_..._{prodN}, N=3..5
	if strings.HasPrefix(loopID, "product_loop_") {
		return nil, fmt.Errorf("product preference loops are disabled")
	}

	// Graph loop: loop_{tradeId1}_{tradeId2}_...
	if strings.HasPrefix(loopID, "loop_") {
		parts := strings.Split(loopID, "_")
		if len(parts) < 3 {
			return nil, fmt.Errorf("invalid loop id")
		}
		unique := map[int]bool{}
		for i := 1; i < len(parts); i++ {
			tradeID, err := strconv.Atoi(parts[i])
			if err != nil || tradeID <= 0 {
				return nil, fmt.Errorf("invalid trade id")
			}
			var buyerID, sellerID int
			if err := h.db.QueryRow("SELECT buyer_id, seller_id FROM trades WHERE id = ?", tradeID).Scan(&buyerID, &sellerID); err != nil {
				return nil, err
			}
			if buyerID > 0 {
				unique[buyerID] = true
			}
			if sellerID > 0 {
				unique[sellerID] = true
			}
		}
		ids := []int{}
		for uid := range unique {
			ids = append(ids, uid)
		}
		if len(ids) == 0 {
			return nil, sql.ErrNoRows
		}
		return ids, nil
	}

	return nil, fmt.Errorf("unsupported loop id")
}

func containsInt(list []int, v int) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

// GetTradeLoopMeetup returns the meetup selection and "met" confirmation status for each participant.
func (h *TradeHandler) GetTradeLoopMeetup(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}
	loopID := c.Params("id")

	participantIDs, err := h.getTradeLoopParticipantUserIDs(loopID)
	if err != nil {
		if err == sql.ErrNoRows {
			return c.Status(404).JSON(models.APIResponse{Success: false, Error: "Trade loop not found"})
		}
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid loop id"})
	}
	if !containsInt(participantIDs, userID) {
		return c.Status(403).JSON(models.APIResponse{Success: false, Error: "You are not a participant in this trade loop"})
	}

	// Fetch existing selections.
	placeholders := make([]string, len(participantIDs))
	args := make([]interface{}, 0, len(participantIDs)+1)
	args = append(args, loopID)
	for i, uid := range participantIDs {
		placeholders[i] = "?"
		args = append(args, uid)
	}
	q := fmt.Sprintf(`
		SELECT user_id,
		       COALESCE(meetup_location, '') as meetup_location,
		       COALESCE(meetup_date, '') as meetup_date,
		       COALESCE(meetup_time, '') as meetup_time,
		       COALESCE(meetup_confirmed, FALSE) as meetup_confirmed,
		       COALESCE(met_confirmed, FALSE) as met_confirmed
		FROM trade_loop_meetup_selections
		WHERE loop_id = ? AND user_id IN (%s)
	`, strings.Join(placeholders, ","))

	rows, err := h.db.Query(q, args...)
	if err != nil {
		if isMySQLTableMissing(err) {
			if ensureErr := h.ensureTradeLoopMeetupSelectionsTable(); ensureErr == nil {
				rows, err = h.db.Query(q, args...)
			}
		}
		if err != nil {
			log.Printf("GetTradeLoopMeetup: query failed (loop_id=%s): %v", loopID, err)
			return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to fetch meetup status"})
		}
	}
	defer rows.Close()

	type selection struct {
		UserID          int    `json:"user_id"`
		MeetupLocation  string `json:"meetup_location"`
		MeetupDate      string `json:"meetup_date"`
		MeetupTime      string `json:"meetup_time"`
		MeetupConfirmed bool   `json:"meetup_confirmed"`
		MetConfirmed    bool   `json:"met_confirmed"`
	}

	byUser := map[int]selection{}
	for rows.Next() {
		var s selection
		if scanErr := rows.Scan(&s.UserID, &s.MeetupLocation, &s.MeetupDate, &s.MeetupTime, &s.MeetupConfirmed, &s.MetConfirmed); scanErr == nil {
			byUser[s.UserID] = s
		} else {
			log.Printf("GetTradeLoopMeetup: scan failed (loop_id=%s): %v", loopID, scanErr)
		}
	}

	// Fill missing participants as "not confirmed".
	out := []selection{}
	for _, uid := range participantIDs {
		s, ok := byUser[uid]
		if !ok {
			out = append(out, selection{UserID: uid, MeetupLocation: "", MeetupDate: "", MeetupTime: "", MeetupConfirmed: false, MetConfirmed: false})
			continue
		}
		out = append(out, s)
	}

	return c.JSON(models.APIResponse{Success: true, Data: fiber.Map{
		"loop_id":      loopID,
		"participants": out,
	}})
}

// UpdateTradeLoopMeetup supports ViewTradeModal-like actions for loops.
// Actions: confirm_meetup, reset_meetup_selection, confirm_meetup_done.
func (h *TradeHandler) UpdateTradeLoopMeetup(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}
	loopID := c.Params("id")

	participantIDs, err := h.getTradeLoopParticipantUserIDs(loopID)
	if err != nil {
		if err == sql.ErrNoRows {
			return c.Status(404).JSON(models.APIResponse{Success: false, Error: "Trade loop not found"})
		}
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid loop id"})
	}
	if !containsInt(participantIDs, userID) {
		return c.Status(403).JSON(models.APIResponse{Success: false, Error: "You are not a participant in this trade loop"})
	}

	var payload struct {
		Action         string `json:"action"`
		MeetupLocation string `json:"meetup_location"`
		MeetupDate     string `json:"meetup_date"`
		MeetupTime     string `json:"meetup_time"`
	}
	if err := c.BodyParser(&payload); err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid payload"})
	}

	switch payload.Action {
	case "confirm_meetup":
		if strings.TrimSpace(payload.MeetupLocation) == "" || strings.TrimSpace(payload.MeetupDate) == "" || strings.TrimSpace(payload.MeetupTime) == "" {
			return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Missing meetup selection"})
		}
		execMeetupConfirm := func() error {
			_, err := h.db.Exec(`
			INSERT INTO trade_loop_meetup_selections (loop_id, user_id, meetup_location, meetup_date, meetup_time, meetup_confirmed, met_confirmed)
			VALUES (?, ?, ?, ?, ?, TRUE, FALSE)
			ON DUPLICATE KEY UPDATE
				meetup_location = VALUES(meetup_location),
				meetup_date = VALUES(meetup_date),
				meetup_time = VALUES(meetup_time),
				meetup_confirmed = TRUE,
				met_confirmed = FALSE,
				updated_at = CURRENT_TIMESTAMP
			`, loopID, userID, payload.MeetupLocation, payload.MeetupDate, payload.MeetupTime)
			return err
		}
		err := execMeetupConfirm()
		if err != nil {
			if isMySQLTableMissing(err) {
				if ensureErr := h.ensureTradeLoopMeetupSelectionsTable(); ensureErr == nil {
					err = execMeetupConfirm()
				}
			}
		}
		if err != nil {
			return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to save meetup selection"})
		}
	case "reset_meetup_selection":
		execMeetupReset := func() error {
			_, err := h.db.Exec(`
			INSERT INTO trade_loop_meetup_selections (loop_id, user_id, meetup_location, meetup_date, meetup_time, meetup_confirmed, met_confirmed)
			VALUES (?, ?, NULL, NULL, NULL, FALSE, FALSE)
			ON DUPLICATE KEY UPDATE
				meetup_location = NULL,
				meetup_date = NULL,
				meetup_time = NULL,
				meetup_confirmed = FALSE,
				met_confirmed = FALSE,
				updated_at = CURRENT_TIMESTAMP
			`, loopID, userID)
			return err
		}
		err := execMeetupReset()
		if err != nil {
			if isMySQLTableMissing(err) {
				if ensureErr := h.ensureTradeLoopMeetupSelectionsTable(); ensureErr == nil {
					err = execMeetupReset()
				}
			}
		}
		if err != nil {
			return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to reset meetup selection"})
		}
	case "confirm_meetup_done":
		execMeetupDone := func() (sql.Result, error) {
			return h.db.Exec(`
			UPDATE trade_loop_meetup_selections
			SET met_confirmed = TRUE, updated_at = CURRENT_TIMESTAMP
			WHERE loop_id = ? AND user_id = ? AND meetup_confirmed = TRUE
			`, loopID, userID)
		}
		res, err := execMeetupDone()
		if err != nil {
			if isMySQLTableMissing(err) {
				if ensureErr := h.ensureTradeLoopMeetupSelectionsTable(); ensureErr == nil {
					res, err = execMeetupDone()
				}
			}
		}
		if err != nil {
			return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to confirm meetup completion"})
		}
		ra, _ := res.RowsAffected()
		if ra == 0 {
			return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Meetup is not confirmed yet"})
		}

		// Finalize the loop once every participant has confirmed the meet-up is done.
		// Only here do we mark the offered products as 'traded' and flip the loop to 'completed'.
		if loopNumericID, parseOK := parseLikeLoopID(loopID); parseOK {
			var totalParticipants, metCount int
			_ = h.db.QueryRow("SELECT COUNT(*) FROM trade_like_loop_participants WHERE loop_id = ?", loopNumericID).Scan(&totalParticipants)
			_ = h.db.QueryRow("SELECT COUNT(*) FROM trade_loop_meetup_selections WHERE loop_id = ? AND met_confirmed = TRUE", loopID).Scan(&metCount)
			if totalParticipants > 0 && metCount == totalParticipants {
				prodRows, _ := h.db.Query("SELECT offered_product_id FROM trade_like_loop_participants WHERE loop_id = ?", loopNumericID)
				for prodRows.Next() {
					var pid int
					if err := prodRows.Scan(&pid); err == nil {
						_, _ = h.db.Exec("UPDATE products SET status = 'traded' WHERE id = ?", pid)
					}
				}
				prodRows.Close()
				_, _ = h.db.Exec("UPDATE trade_like_loops SET status = 'completed' WHERE id = ?", loopNumericID)
				_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) SELECT user_id, 'trade_loop', 'Trade loop completed! All items are now marked as traded.', FALSE FROM trade_like_loop_participants WHERE loop_id = ?", loopNumericID)
			}
		}
	default:
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid action"})
	}

	for _, participantID := range participantIDs {
		publishToUser(participantID, sseEvent{
			Type: "trade_updated",
			Data: fiber.Map{
				"notification_type": "trade_loop",
				"loop_id":           loopID,
				"action":            payload.Action,
				"status":            "meetup_updated",
			},
		})
	}

	// Return refreshed status for convenience.
	return h.GetTradeLoopMeetup(c)
}

// CountTrades returns count of trades for current user by direction and status
func (h *TradeHandler) CountTrades(c *fiber.Ctx) error {
	h.ensureTradeRuntimeColumns()

	userID, ok := middleware.GetUserIDFromContext(c)
	// If user is not authenticated, return a zero count instead of 401 so UI components
	// that poll this endpoint can render without failing.
	if !ok {
		return c.JSON(models.APIResponse{Success: true, Data: fiber.Map{"count": 0}})
	}

	direction := c.Query("direction", "incoming")
	status := c.Query("status", "")

	// Validate direction to avoid unexpected SQL construction
	if direction != "incoming" && direction != "outgoing" {
		// Treat unknown direction as incoming (safe default) and log for debugging
		fmt.Printf("CountTrades: invalid direction='%s' from user=%d, defaulting to 'incoming'\n", direction, userID)
		direction = "incoming"
	}

	// Validate status against a known whitelist. An empty status means no filter.
	allowedStatuses := map[string]bool{
		"pending": true, "pending_multiway": true, "accepted": true, "accepted_by_one": true, "active": true,
		"completed": true, "declined": true, "cancelled": true, "countered": true,
		"expired": true, "auto_completed": true, "cancelled_due_to_conflict": true,
	}
	if status != "" && !allowedStatuses[status] {
		fmt.Printf("CountTrades: unknown status='%s' from user=%d - ignoring status filter\n", status, userID)
		status = ""
	}

	// Mirror the direction filter used in ListTrades: a countered trade awaits
	// the non-countering party, so it belongs in their "incoming" count.
	where := "WHERE (t.seller_id = ? OR (t.status = 'countered' AND t.countered_by IS NOT NULL AND t.countered_by <> ? AND (t.buyer_id = ? OR t.seller_id = ?)))"
	args := []interface{}{userID, userID, userID, userID}
	if direction == "outgoing" {
		where = "WHERE t.buyer_id = ? AND NOT (t.status = 'countered' AND t.countered_by IS NOT NULL AND t.countered_by <> ?)"
		args = []interface{}{userID, userID}
	}
	if status != "" {
		if status == "pending" {
			where += " AND (t.status = 'pending' OR t.status = 'pending_multiway' OR t.status = 'accepted_by_one')"
		} else {
			where += " AND t.status = ?"
			args = append(args, status)
		}
	}

	var count int
	// Use a prepared-like query with args to avoid injection and driver issues
	query := "SELECT COUNT(*) FROM trades t " + where

	// Retry logic for transient connection errors
	maxRetries := 2
	var lastErr error
	for attempt := 0; attempt <= maxRetries; attempt++ {
		if attempt > 0 {
			time.Sleep(time.Duration(attempt*100) * time.Millisecond) // Exponential backoff
		}
		if err := h.db.QueryRow(query, args...).Scan(&count); err == nil {
			return c.JSON(models.APIResponse{Success: true, Data: fiber.Map{"count": count}})
		} else {
			lastErr = err
		}
	}

	// Log and return zero as a safe fallback to avoid 400 responses for UI polling
	fmt.Printf("CountTrades: db query error for user=%d query='%s' args=%v: %v (after %d retries) - returning count=0\n", userID, query, args, lastErr, maxRetries)
	return c.JSON(models.APIResponse{Success: true, Data: fiber.Map{"count": 0}})
}

// CompleteTrade handles trade completion with rating, feedback, and proof
func (h *TradeHandler) CompleteTrade(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}

	tradeID, err := strconv.Atoi(c.Params("id"))
	if err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid trade id"})
	}

	var payload struct {
		Rating          int    `json:"rating"`
		Feedback        string `json:"feedback"`
		ProofURL        string `json:"transaction_proof_url,omitempty"`
		IsCameraPhoto   bool   `json:"is_camera_photo"`
		InstantComplete bool   `json:"instant_complete"`
		LoopID          string `json:"loop_id,omitempty"`
	}
	if err := c.BodyParser(&payload); err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid request body"})
	}

	// Fetch trade details
	var buyerID, sellerID int
	var tradeOption string
	err = h.db.QueryRow("SELECT buyer_id, seller_id, COALESCE(trade_option, 'meetup') FROM trades WHERE id = ?", tradeID).Scan(&buyerID, &sellerID, &tradeOption)
	if err != nil {
		return c.Status(404).JSON(models.APIResponse{Success: false, Error: "Trade not found"})
	}
	if userID != buyerID && userID != sellerID {
		return c.Status(403).JSON(models.APIResponse{Success: false, Error: "Not authorized for this trade"})
	}

	// === INSTANT COMPLETE MODE ===
	// Skips rating/feedback/proof, marks both users as completed, finalizes trade immediately
	if payload.InstantComplete {
		log.Printf("[INSTANT COMPLETE] User %d completing trade %d instantly for both parties", userID, tradeID)

		tx, err := h.db.Begin()
		if err != nil {
			return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Transaction failed"})
		}
		defer tx.Rollback()

		// 1. Mark both parties as completed in the primary record
		_, err = tx.Exec(
			"UPDATE trades SET buyer_completed=TRUE, seller_completed=TRUE, updated_at=CURRENT_TIMESTAMP WHERE id = ?",
			tradeID)
		if err != nil {
			return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to update trade completion"})
		}

		// 2. Identify and update paired mutual trade (if it exists as a separate record)
		var pairedTradeID int
		_ = tx.QueryRow(`
			SELECT id FROM trades
			WHERE (buyer_id = ? AND seller_id = ?) 
			AND id != ?
			AND status IN ('pending', 'accepted', 'active', 'awaiting_confirmation')
			LIMIT 1
		`, sellerID, buyerID, tradeID).Scan(&pairedTradeID)

		if pairedTradeID > 0 {
			log.Printf("[INSTANT COMPLETE] Also updating paired mutual trade %d", pairedTradeID)
			_, _ = tx.Exec(
				"UPDATE trades SET buyer_completed=TRUE, seller_completed=TRUE, status='completed', completed_at=CURRENT_TIMESTAMP, updated_at=CURRENT_TIMESTAMP WHERE id = ?",
				pairedTradeID)
		}

		// 3. Mark the multi-way chain as completed if applicable
		_, _ = tx.Exec(`
			UPDATE multiway_trades 
			SET status = 'completed', updated_at = NOW() 
			WHERE (original_trade_id = ? OR user3_trade_id = ?) 
			AND status IN ('active', 'multiway_active', 'user3_accepted', 'pending_user3')
		`, tradeID, tradeID)

		if err := tx.Commit(); err != nil {
			return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to commit completion"})
		}

		// 4. Finalize the trade (mark products as traded, set status to completed)
		// This function handles product status and notifications internally
		// We call it after the flags are set so it passes the 'both completed' check
		err = h.completeTradeTransaction(tradeID)
		if err != nil {
			log.Printf("[INSTANT COMPLETE] Failed to complete trade transaction %d: %v", tradeID, err)
			return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to finalize trade"})
		}

		// If this trade belongs to a 2-way like-loop, close the loop too so the
		// card moves out of ongoing trades and into history for both users.
		if payload.LoopID != "" {
			if loopNumericID, parseOK := parseLikeLoopID(payload.LoopID); parseOK {
				// Mark all offered products in the loop as traded
				if prodRows, perr := h.db.Query("SELECT offered_product_id FROM trade_like_loop_participants WHERE loop_id = ?", loopNumericID); perr == nil {
					for prodRows.Next() {
						var pid int
						if scanErr := prodRows.Scan(&pid); scanErr == nil {
							_, _ = h.db.Exec("UPDATE products SET status = 'traded' WHERE id = ?", pid)
						}
					}
					prodRows.Close()
				}
				_, _ = h.db.Exec("UPDATE trade_like_loops SET status = 'completed' WHERE id = ?", loopNumericID)
				_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) SELECT user_id, 'trade_loop', 'Trade loop completed! All items are now marked as traded.', FALSE FROM trade_like_loop_participants WHERE loop_id = ?", loopNumericID)

				// Publish SSE so both users' UIs refresh and drop the card
				participantRows, _ := h.db.Query("SELECT user_id FROM trade_like_loop_participants WHERE loop_id = ?", loopNumericID)
				if participantRows != nil {
					for participantRows.Next() {
						var puid int
						if scanErr := participantRows.Scan(&puid); scanErr == nil {
							publishToUser(puid, sseEvent{Type: "trade_loop_completed", Data: fiber.Map{"loop_id": payload.LoopID}})
						}
					}
					participantRows.Close()
				}
			}
		}

		// Notify both parties
		publishToUser(buyerID, sseEvent{Type: "trade_completed", Data: fiber.Map{"trade_id": tradeID}})
		publishToUser(sellerID, sseEvent{Type: "trade_completed", Data: fiber.Map{"trade_id": tradeID}})

		// Add notifications
		_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", buyerID, "Trade completed successfully!")
		_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", sellerID, "Trade completed successfully!")

		return c.JSON(models.APIResponse{Success: true, Message: "Trade completed successfully"})
	}

	// === STANDARD REVIEW-BASED COMPLETION ===

	// Validate rating
	if payload.Rating < 1 || payload.Rating > 5 {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Rating must be between 1 and 5"})
	}

	// Enforce photo evidence rule for meetup and delivery
	if tradeOption == "meetup" || tradeOption == "delivery" {
		if payload.ProofURL == "" {
			return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Photo evidence is mandatory for " + tradeOption + " trades"})
		}
		if !payload.IsCameraPhoto {
			return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Photo evidence must be taken using the in-app camera (no gallery upload allowed)"})
		}
	}

	// Determine which columns to update based on user role
	var ratingColumn, feedbackColumn, proofColumn, cameraFlagColumn, completedColumn string
	if userID == buyerID {
		ratingColumn = "buyer_rating"
		feedbackColumn = "buyer_feedback"
		proofColumn = "buyer_proof_url"
		cameraFlagColumn = "buyer_photo_is_camera"
		completedColumn = "buyer_completed"
	} else {
		ratingColumn = "seller_rating"
		feedbackColumn = "seller_feedback"
		proofColumn = "seller_proof_url"
		cameraFlagColumn = "seller_photo_is_camera"
		completedColumn = "seller_completed"
	}

	// Update the trade with rating, feedback, proof, camera flag, and completion status
	if payload.ProofURL != "" {
		_, err = h.db.Exec(
			"UPDATE trades SET "+ratingColumn+"=?, "+feedbackColumn+"=?, "+proofColumn+"=?, "+cameraFlagColumn+"=?, "+completedColumn+"=TRUE, updated_at=CURRENT_TIMESTAMP WHERE id = ?",
			payload.Rating, payload.Feedback, payload.ProofURL, payload.IsCameraPhoto, tradeID)
	} else {
		// This path is only reachable for non-meetup/delivery trades if we allow them without photo
		_, err = h.db.Exec(
			"UPDATE trades SET "+ratingColumn+"=?, "+feedbackColumn+"=?, "+completedColumn+"=TRUE, updated_at=CURRENT_TIMESTAMP WHERE id = ?",
			payload.Rating, payload.Feedback, tradeID)
	}
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to update trade completion"})
	}

	// Check if both parties have completed (with ratings and feedback)
	var buyerCompleted, sellerCompleted bool
	var buyerRating, sellerRating sql.NullInt64
	err = h.db.QueryRow("SELECT buyer_completed, seller_completed, buyer_rating, seller_rating FROM trades WHERE id = ?", tradeID).Scan(&buyerCompleted, &sellerCompleted, &buyerRating, &sellerRating)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to check completion status"})
	}

	// Both parties must complete AND provide ratings before finalizing
	if buyerCompleted && sellerCompleted && buyerRating.Valid && sellerRating.Valid {
		err = h.completeTradeTransaction(tradeID)
		if err != nil {
			log.Printf("Failed to complete trade transaction: %v", err)
			return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to finalize trade"})
		}

		// Notify both parties
		publishToUser(buyerID, sseEvent{Type: "trade_completed", Data: fiber.Map{"trade_id": tradeID}})
		publishToUser(sellerID, sseEvent{Type: "trade_completed", Data: fiber.Map{"trade_id": tradeID}})

		// Add notifications
		_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", buyerID, "Trade completed successfully!")
		_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", sellerID, "Trade completed successfully!")
	}

	return c.JSON(models.APIResponse{Success: true, Message: "Trade completion submitted successfully"})
}

// GetTradeCompletionStatus returns the completion status of a trade
func (h *TradeHandler) GetTradeCompletionStatus(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}

	tradeID, err := strconv.Atoi(c.Params("id"))
	if err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid trade id"})
	}

	// Fetch trade completion details
	var buyerID, sellerID int
	var buyerCompleted, sellerCompleted bool
	var buyerRating, sellerRating sql.NullInt64
	var buyerFeedback, sellerFeedback sql.NullString
	var buyerProofURL, sellerProofURL sql.NullString

	err = h.db.QueryRow(`
		SELECT buyer_id, seller_id, buyer_completed, seller_completed,
		       buyer_rating, seller_rating, buyer_feedback, seller_feedback,
		       buyer_proof_url, seller_proof_url
		FROM trades WHERE id = ?`, tradeID).Scan(
		&buyerID, &sellerID, &buyerCompleted, &sellerCompleted,
		&buyerRating, &sellerRating, &buyerFeedback, &sellerFeedback,
		&buyerProofURL, &sellerProofURL)

	if err != nil {
		return c.Status(404).JSON(models.APIResponse{Success: false, Error: "Trade not found"})
	}

	// Verify authorization
	if userID != buyerID && userID != sellerID {
		return c.Status(403).JSON(models.APIResponse{Success: false, Error: "Not authorized for this trade"})
	}

	// Prepare response data
	status := fiber.Map{
		"buyer_completed":  buyerCompleted,
		"seller_completed": sellerCompleted,
	}

	if buyerRating.Valid {
		status["buyer_rating"] = int(buyerRating.Int64)
	}
	if sellerRating.Valid {
		status["seller_rating"] = int(sellerRating.Int64)
	}
	if buyerFeedback.Valid {
		status["buyer_feedback"] = buyerFeedback.String
	}
	if sellerFeedback.Valid {
		status["seller_feedback"] = sellerFeedback.String
	}
	if buyerProofURL.Valid {
		status["buyer_proof_url"] = buyerProofURL.String
	}
	if sellerProofURL.Valid {
		status["seller_proof_url"] = sellerProofURL.String
	}

	return c.JSON(models.APIResponse{Success: true, Data: status})
}

// setProductStatusForTrade updates the status of all products involved in a trade.
func (h *TradeHandler) setProductStatusForTrade(tx *sql.Tx, tradeID int, status string) error {
	if status == "in_trade" {
		status = "locked"
	}

	// Get target product ID
	var targetProductID int
	err := tx.QueryRow("SELECT target_product_id FROM trades WHERE id = ?", tradeID).Scan(&targetProductID)
	if err != nil {
		return fmt.Errorf("failed to get target product for trade %d: %w", tradeID, err)
	}

	// Get all offered product IDs
	rows, err := tx.Query("SELECT product_id FROM trade_items WHERE trade_id = ?", tradeID)
	if err != nil {
		return fmt.Errorf("failed to get offered items for trade %d: %w", tradeID, err)
	}
	defer rows.Close()

	var productIDs []int
	productIDs = append(productIDs, targetProductID)
	for rows.Next() {
		var pid int
		if err := rows.Scan(&pid); err != nil {
			return fmt.Errorf("failed to scan offered item for trade %d: %w", tradeID, err)
		}
		productIDs = append(productIDs, pid)
	}

	// Update status for all products
	seen := map[int]bool{}
	for _, pid := range productIDs {
		if seen[pid] {
			continue
		}
		seen[pid] = true
		_, err := tx.Exec("UPDATE products SET status = ? WHERE id = ?", status, pid)
		if err != nil {
			return fmt.Errorf("failed to update status for product %d: %w", pid, err)
		}
	}

	return nil
}

func (h *TradeHandler) getTradeProductIDsTx(tx *sql.Tx, tradeID int) ([]int, error) {
	var targetProductID int
	if err := tx.QueryRow("SELECT target_product_id FROM trades WHERE id = ?", tradeID).Scan(&targetProductID); err != nil {
		return nil, err
	}

	productIDs := []int{targetProductID}
	rows, err := tx.Query("SELECT product_id FROM trade_items WHERE trade_id = ?", tradeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	seen := map[int]bool{targetProductID: true}
	for rows.Next() {
		var pid int
		if err := rows.Scan(&pid); err != nil {
			return nil, err
		}
		if pid > 0 && !seen[pid] {
			seen[pid] = true
			productIDs = append(productIDs, pid)
		}
	}

	return productIDs, nil
}

func (h *TradeHandler) ensureProductsTradeableTx(tx *sql.Tx, productIDs []int) error {
	for _, pid := range productIDs {
		if pid <= 0 {
			continue
		}
		var status string
		if err := tx.QueryRow("SELECT status FROM products WHERE id = ? FOR UPDATE", pid).Scan(&status); err != nil {
			return fmt.Errorf("failed to verify product %d", pid)
		}
		if status != "available" {
			return fmt.Errorf("one or more products are no longer available for trade")
		}
	}
	return nil
}

func (h *TradeHandler) findExactReciprocalTradeTx(tx *sql.Tx, tradeID, buyerID, sellerID, targetProductID int, offeredProductIDs []int, offeredCash *float64, meetingType string) (int, bool, error) {
	if len(offeredProductIDs) != 1 {
		return 0, false, nil
	}
	if strings.TrimSpace(meetingType) == "" {
		meetingType = "meetup"
	}

	myCash := 0.0
	if offeredCash != nil {
		myCash = *offeredCash
	}

	var candidateTradeID int
	err := tx.QueryRow(`
		SELECT t.id
		FROM trades t
		JOIN trade_items ti ON ti.trade_id = t.id
		WHERE t.id <> ?
		  AND t.buyer_id = ?
		  AND t.seller_id = ?
		  AND t.target_product_id = ?
		  AND t.status = 'pending'
		  AND COALESCE(t.offered_cash_amount, 0) = ?
		  AND COALESCE(t.meeting_type, 'meetup') = ?
		  AND ti.offered_by = 'buyer'
		  AND ti.product_id = ?
		GROUP BY t.id
		HAVING COUNT(ti.id) = 1
		LIMIT 1
		FOR UPDATE
	`, tradeID, sellerID, buyerID, offeredProductIDs[0], myCash, meetingType, targetProductID).Scan(&candidateTradeID)
	if err == sql.ErrNoRows {
		return 0, false, nil
	}
	if err != nil {
		return 0, false, err
	}
	return candidateTradeID, true, nil
}

func (h *TradeHandler) findReciprocalTradeWithDifferentMeetingTypeTx(tx *sql.Tx, tradeID, buyerID, sellerID, targetProductID int, offeredProductIDs []int, offeredCash *float64, meetingType string) (int, string, bool, error) {
	if len(offeredProductIDs) != 1 {
		return 0, "", false, nil
	}
	if strings.TrimSpace(meetingType) == "" {
		meetingType = "meetup"
	}

	myCash := 0.0
	if offeredCash != nil {
		myCash = *offeredCash
	}

	var candidateTradeID int
	var candidateMeetingType string
	err := tx.QueryRow(`
		SELECT t.id, COALESCE(t.meeting_type, 'meetup')
		FROM trades t
		JOIN trade_items ti ON ti.trade_id = t.id
		WHERE t.id <> ?
		  AND t.buyer_id = ?
		  AND t.seller_id = ?
		  AND t.target_product_id = ?
		  AND t.status = 'pending'
		  AND COALESCE(t.offered_cash_amount, 0) = ?
		  AND COALESCE(t.meeting_type, 'meetup') <> ?
		  AND ti.offered_by = 'buyer'
		  AND ti.product_id = ?
		GROUP BY t.id, COALESCE(t.meeting_type, 'meetup')
		HAVING COUNT(ti.id) = 1
		LIMIT 1
		FOR UPDATE
	`, tradeID, sellerID, buyerID, offeredProductIDs[0], myCash, meetingType, targetProductID).Scan(&candidateTradeID, &candidateMeetingType)
	if err == sql.ErrNoRows {
		return 0, "", false, nil
	}
	if err != nil {
		return 0, "", false, err
	}
	return candidateTradeID, candidateMeetingType, true, nil
}

func (h *TradeHandler) cancelConflictingTradesTx(tx *sql.Tx, winningTradeID int, productIDs []int, actorID int) ([]int, error) {
	if len(productIDs) == 0 {
		return nil, nil
	}

	placeholders := make([]string, len(productIDs))
	args := make([]interface{}, 0, 1+len(productIDs)*2)
	args = append(args, winningTradeID)
	for i, pid := range productIDs {
		placeholders[i] = "?"
		args = append(args, pid)
	}
	for _, pid := range productIDs {
		args = append(args, pid)
	}
	pidList := strings.Join(placeholders, ",")

	rows, err := tx.Query(fmt.Sprintf(`
		SELECT DISTINCT t.id
		FROM trades t
		LEFT JOIN trade_items ti ON t.id = ti.trade_id
		WHERE t.id != ?
		  AND t.status IN ('pending', 'countered', 'pending_multiway', 'accepted', 'accepted_by_one')
		  AND (t.target_product_id IN (%s) OR ti.product_id IN (%s))
	`, pidList, pidList), args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var otherTradeIDs []int
	for rows.Next() {
		var otherID int
		if err := rows.Scan(&otherID); err == nil {
			otherTradeIDs = append(otherTradeIDs, otherID)
		}
	}

	for _, otherID := range otherTradeIDs {
		if _, err := tx.Exec(`
			UPDATE trades
			SET status='cancelled_due_to_conflict',
			    cancellation_reason='Product committed to another trade',
			    cancelled_by=?,
			    cancelled_at=NOW(),
			    buyer_accepted=FALSE,
			    seller_accepted=FALSE,
			    updated_at=CURRENT_TIMESTAMP
			WHERE id = ?
		`, actorID, otherID); err != nil {
			return nil, err
		}
	}

	return otherTradeIDs, nil
}

func (h *TradeHandler) cancelConflictingLifecycleTx(tx *sql.Tx, winningTradeID int, winningLoopID int, winningChainID string, productIDs []int, actorID int) error {
	productIDs = uniquePositiveInts(productIDs)
	if len(productIDs) == 0 {
		return nil
	}
	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(productIDs)), ",")

	tradeArgs := make([]interface{}, 0, 1+len(productIDs)*2)
	tradeArgs = append(tradeArgs, winningTradeID)
	for _, pid := range productIDs {
		tradeArgs = append(tradeArgs, pid)
	}
	for _, pid := range productIDs {
		tradeArgs = append(tradeArgs, pid)
	}
	if _, err := tx.Exec(fmt.Sprintf(`
		UPDATE trades t
		LEFT JOIN trade_items ti ON ti.trade_id = t.id
		SET t.status='cancelled_due_to_conflict',
		    t.cancellation_reason='Product committed to another trade',
		    t.cancelled_by=?,
		    t.cancelled_at=NOW(),
		    t.buyer_accepted=FALSE,
		    t.seller_accepted=FALSE,
		    t.updated_at=CURRENT_TIMESTAMP
		WHERE t.id <> ?
		  AND t.status IN ('pending','countered','pending_multiway','accepted','accepted_by_one')
		  AND (t.target_product_id IN (%s) OR ti.product_id IN (%s))
	`, placeholders, placeholders), append([]interface{}{actorID}, tradeArgs...)...); err != nil {
		return err
	}

	loopArgs := make([]interface{}, 0, 1+len(productIDs)*2)
	loopArgs = append(loopArgs, winningLoopID)
	for _, pid := range productIDs {
		loopArgs = append(loopArgs, pid)
	}
	for _, pid := range productIDs {
		loopArgs = append(loopArgs, pid)
	}
	if _, err := tx.Exec(fmt.Sprintf(`
		UPDATE trade_like_loops l
		JOIN trade_like_loop_participants p ON p.loop_id = l.id
		SET l.status='cancelled_due_to_conflict',
		    l.updated_at=CURRENT_TIMESTAMP
		WHERE l.id <> ?
		  AND l.status IN ('pending','partially_accepted','accepted','confirmed')
		  AND (p.offered_product_id IN (%s) OR p.wanted_product_id IN (%s))
	`, placeholders, placeholders), loopArgs...); err != nil {
		return err
	}
	if _, err := tx.Exec(fmt.Sprintf(`
		UPDATE trade_like_loop_participants p
		JOIN trade_like_loops l ON l.id = p.loop_id
		SET p.status='cancelled_due_to_conflict'
		WHERE l.id <> ?
		  AND l.status='cancelled_due_to_conflict'
		  AND (p.offered_product_id IN (%s) OR p.wanted_product_id IN (%s))
	`, placeholders, placeholders), loopArgs...); err != nil {
		return err
	}
	if _, err := tx.Exec(fmt.Sprintf(`
		INSERT INTO notifications (user_id, type, message, is_read)
		SELECT DISTINCT p.user_id, 'trade_loop',
		       'A trade match or multiway loop was cancelled because one of its products was committed to another trade.',
		       FALSE
		FROM trade_like_loop_participants p
		JOIN trade_like_loops l ON l.id = p.loop_id
		WHERE l.id <> ?
		  AND l.status='cancelled_due_to_conflict'
		  AND (p.offered_product_id IN (%s) OR p.wanted_product_id IN (%s))
	`, placeholders, placeholders), loopArgs...); err != nil {
		return err
	}

	chainArgs := make([]interface{}, 0, 1+len(productIDs)*5)
	chainArgs = append(chainArgs, winningChainID)
	for i := 0; i < 5; i++ {
		for _, pid := range productIDs {
			chainArgs = append(chainArgs, pid)
		}
	}
	if _, err := tx.Exec(fmt.Sprintf(`
		UPDATE multiway_trades mw
		LEFT JOIN trades t ON t.id = mw.original_trade_id
		LEFT JOIN trade_items ti ON ti.trade_id = t.id
		SET mw.status='cancelled',
		    mw.cancelled_at=NOW(),
		    mw.updated_at=NOW()
		WHERE mw.chain_id <> ?
		  AND mw.status IN ('searching','pending_user3','pending_initiator_upgrade','waiting_acceptance','user3_accepted')
		  AND (
		    mw.user1_product_id IN (%s) OR mw.user2_product_id IN (%s) OR mw.user3_product_id IN (%s)
		    OR t.target_product_id IN (%s) OR ti.product_id IN (%s)
		  )
	`, placeholders, placeholders, placeholders, placeholders, placeholders), chainArgs...); err != nil {
		return err
	}

	return nil
}

func (h *TradeHandler) notifyLikeLoopUsers(loopID int, message string, eventType string) {
	h.notifyLikeLoopUsersExcept(loopID, 0, message, eventType)
}

func (h *TradeHandler) notifyLikeLoopUsersExcept(loopID int, exceptUserID int, message string, eventType string) {
	rows, err := h.db.Query("SELECT DISTINCT user_id FROM trade_like_loop_participants WHERE loop_id = ?", loopID)
	if err != nil {
		return
	}
	defer rows.Close()
	for rows.Next() {
		var uid int
		if rows.Scan(&uid) != nil || uid == 0 || uid == exceptUserID {
			continue
		}
		_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_loop', ?, FALSE)", uid, message)
		publishNotification(uid, message, "trade_loop")
		publishToUser(uid, sseEvent{Type: eventType, Data: fiber.Map{"loop_id": loopIDFromLikeLoopID(loopID), "message": message}})
	}
}

// getLoopScore extracts the score from a loop map, checking multiple possible keys
func getLoopScore(loop map[string]interface{}) int {
	if v, ok := loop["match_score"].(float64); ok {
		return int(v)
	}
	if v, ok := loop["match_score"].(int); ok {
		return v
	}
	if v, ok := loop["score"].(float64); ok {
		return int(v)
	}
	if v, ok := loop["score"].(int); ok {
		return v
	}
	return 0
}

// selectBestLoopsPerProduct filters loops to keep only the best loop per product
// Priority: Highest score > Fewest participants > Most recently created
func selectBestLoopsPerProduct(db *sql.DB, _ int, loops []map[string]interface{}) []map[string]interface{} {
	// Map: product_id -> best loop
	bestByProduct := make(map[int]map[string]interface{})

	for _, loop := range loops {
		// Get participants array
		participants, ok := loop["participants"].([]map[string]interface{})
		if !ok || len(participants) == 0 {
			continue
		}

		// Get loop creation time for tiebreaker
		createdAt := time.Now()
		if chainID, ok := loop["chain_id"].(string); ok {
			var createdStr string
			_ = db.QueryRow("SELECT created_at FROM multiway_trades WHERE chain_id = ?", chainID).Scan(&createdStr)
			if parsedTime, err := time.Parse("2006-01-02 15:04:05", createdStr); err == nil {
				createdAt = parsedTime
			}
		}

		// Get loop length (participant count)
		loopLength := len(participants)
		loopScore := getLoopScore(loop)

		// isBetterThan returns true if current loop beats existing loop
		isBetterThan := func(existing map[string]interface{}) bool {
			existingScore := getLoopScore(existing)
			// Primary: higher score wins
			if loopScore > existingScore {
				return true
			}
			if loopScore < existingScore {
				return false
			}
			// Secondary: fewer participants wins
			existingLen, _ := existing["loop_length"].(int)
			if loopLength < existingLen {
				return true
			}
			if loopLength > existingLen {
				return false
			}
			// Tertiary: newer wins
			if existingCreated, ok := existing["created_at"].(time.Time); ok && createdAt.After(existingCreated) {
				return true
			}
			return false
		}

		storeLoop := func(targetProductID int) {
			if targetProductID <= 0 {
				return
			}
			if existing, exists := bestByProduct[targetProductID]; exists {
				if isBetterThan(existing) {
					loop["created_at"] = createdAt
					loop["loop_length"] = loopLength
					bestByProduct[targetProductID] = loop
				}
			} else {
				loop["created_at"] = createdAt
				loop["loop_length"] = loopLength
				bestByProduct[targetProductID] = loop
			}
		}

		// Get target products involved in this loop to map to products
		if loopType, ok := loop["loop_type"].(string); ok && loopType == "detected_loop" {
			if edges, ok := loop["edges"].([]map[string]interface{}); ok {
				for _, edge := range edges {
					// Prefer the target_product_id our builder now populates on
					// each edge â€” avoids an N+1 per-edge query on hot path.
					var targetProductID int
					switch v := edge["target_product_id"].(type) {
					case int:
						targetProductID = v
					case float64:
						targetProductID = int(v)
					}
					if targetProductID == 0 {
						// Fallback for legacy callers that didn't populate it.
						if tradeID, ok := edge["trade_id"].(int); ok {
							_ = db.QueryRow("SELECT target_product_id FROM trades WHERE id = ?", tradeID).Scan(&targetProductID)
						} else if tradeIDF, ok := edge["trade_id"].(float64); ok {
							_ = db.QueryRow("SELECT target_product_id FROM trades WHERE id = ?", int(tradeIDF)).Scan(&targetProductID)
						}
					}
					storeLoop(targetProductID)
				}
			}
		} else if loopType, ok := loop["loop_type"].(string); ok && loopType == "invited_chain" {
			if chainID, ok := loop["chain_id"].(string); ok {
				var targetProductID int
				_ = db.QueryRow(`
					SELECT t.target_product_id FROM multiway_trades m
					JOIN trades t ON m.original_trade_id = t.id
					WHERE m.chain_id = ?
				`, chainID).Scan(&targetProductID)
				storeLoop(targetProductID)
			}
		} else if loopType, ok := loop["loop_type"].(string); ok && loopType == "product_match" {
			// Product-based loops have product_id in each participant
			for _, p := range participants {
				if pid, ok := p["product_id"].(int); ok && pid > 0 {
					storeLoop(pid)
					break // store once per loop is enough
				}
			}
		}
	}

	// First dedupe pass: by loop_id. The same loop can appear as the best
	// match for multiple target products (a 3-way cycle has 3 target products,
	// so it gets stored under 3 keys in bestByProduct).
	seenLoopIDs := make(map[string]bool)
	deduped := make([]map[string]interface{}, 0, len(bestByProduct))
	for _, loop := range bestByProduct {
		loopID, _ := loop["loop_id"].(string)
		if loopID == "" {
			deduped = append(deduped, loop)
			continue
		}
		if seenLoopIDs[loopID] {
			continue
		}
		seenLoopIDs[loopID] = true
		deduped = append(deduped, loop)
	}

	// Second dedupe pass: by the set of participating users. If the same
	// three users appear in multiple cycles with different product
	// permutations (e.g. user has 7 products that all form a valid cycle
	// with the same two counterparties), we only want to show ONE best
	// card for that user set â€” not seven near-identical cards. Keep the
	// highest-scored loop per user set; tiebreak by loop_length then
	// created_at (same priority as the product-level pass above).
	bestByUserSet := make(map[string]map[string]interface{})
	for _, loop := range deduped {
		participants, ok := loop["participants"].([]map[string]interface{})
		if !ok || len(participants) == 0 {
			// No participant info ? keep as-is under a unique key so it
			// still reaches the frontend.
			key := fmt.Sprintf("__nokey_%p", loop)
			bestByUserSet[key] = loop
			continue
		}
		userIDs := make([]int, 0, len(participants))
		for _, p := range participants {
			switch v := p["id"].(type) {
			case int:
				userIDs = append(userIDs, v)
			case float64:
				userIDs = append(userIDs, int(v))
			}
		}
		sort.Ints(userIDs)
		parts := make([]string, len(userIDs))
		for i, id := range userIDs {
			parts[i] = strconv.Itoa(id)
		}
		key := strings.Join(parts, "_")

		existing, exists := bestByUserSet[key]
		if !exists {
			bestByUserSet[key] = loop
			continue
		}
		// Pick the better one (same criteria as product-level pass).
		newScore := getLoopScore(loop)
		oldScore := getLoopScore(existing)
		if newScore > oldScore {
			bestByUserSet[key] = loop
			continue
		}
		if newScore < oldScore {
			continue
		}
		newLen, _ := loop["loop_length"].(int)
		oldLen, _ := existing["loop_length"].(int)
		if newLen < oldLen && newLen > 0 {
			bestByUserSet[key] = loop
			continue
		}
		if newLen > oldLen {
			continue
		}
		newCreated, _ := loop["created_at"].(time.Time)
		oldCreated, _ := existing["created_at"].(time.Time)
		if newCreated.After(oldCreated) {
			bestByUserSet[key] = loop
		}
	}

	afterUserSet := make([]map[string]interface{}, 0, len(bestByUserSet))
	for _, loop := range bestByUserSet {
		afterUserSet = append(afterUserSet, loop)
	}

	// Third dedupe pass (product_match only): by the visible product set.
	// Cards display all loop products. If the same product combination appears
	// through different user combinations, the user sees identical-looking cards.
	// Keep only the highest-scored loop per sorted product-ID set.
	bestByProductSet := make(map[string]map[string]interface{})
	for _, loop := range afterUserSet {
		loopType, _ := loop["loop_type"].(string)
		if loopType != "product_match" {
			key := fmt.Sprintf("__nonpm_%p", loop)
			bestByProductSet[key] = loop
			continue
		}
		participants, ok := loop["participants"].([]map[string]interface{})
		if !ok || len(participants) < 3 {
			key := fmt.Sprintf("__nopart_%p", loop)
			bestByProductSet[key] = loop
			continue
		}
		pids := make([]int, 0, len(participants))
		for _, participant := range participants {
			pids = append(pids, extractIntFromMap(participant, "product_id"))
		}
		sort.Ints(pids)
		pidParts := make([]string, len(pids))
		for i, pid := range pids {
			pidParts[i] = strconv.Itoa(pid)
		}
		key := "pm_" + strings.Join(pidParts, "_")

		existing, exists := bestByProductSet[key]
		if !exists {
			bestByProductSet[key] = loop
			continue
		}
		if getLoopScore(loop) > getLoopScore(existing) {
			bestByProductSet[key] = loop
		}
	}

	result := make([]map[string]interface{}, 0, len(bestByProductSet))
	for _, loop := range bestByProductSet {
		result = append(result, loop)
	}
	return result
}

// extractIntFromMap safely extracts an int from a map value that may be int or float64.
func extractIntFromMap(m map[string]interface{}, key string) int {
	if v, ok := m[key].(int); ok {
		return v
	}
	if v, ok := m[key].(float64); ok {
		return int(v)
	}
	return 0
}

// productMatchScore returns a 0-100 score indicating how well a product matches desires.
// 90-100: direct product-name match, 70-89: category match, 50-69: token/keyword match, 40-59: semantic-only match.
func productMatchScore(productTitle, productCategory, desires string) int {
	if desires == "" {
		return 0
	}
	ptLower := strings.ToLower(strings.TrimSpace(productTitle))
	pcLower := strings.ToLower(strings.TrimSpace(productCategory))
	dLower := strings.ToLower(strings.TrimSpace(desires))

	bestScore := 0

	// Direct substring: title in desires or desires in title ? 90-100
	if ptLower != "" && (strings.Contains(dLower, ptLower) || strings.Contains(ptLower, dLower)) {
		bestScore = 95
		return bestScore
	}

	// Category substring in desires ? 75
	if pcLower != "" && strings.Contains(dLower, pcLower) {
		if bestScore < 75 {
			bestScore = 75
		}
	}

	// Tokenized checks â€” use word-boundary matching so "phone" doesn't
	// accidentally match "headphone". A token matches a word only if it
	// equals the full word, not merely a substring of a longer word.
	desireTokens := strings.FieldsFunc(dLower, func(r rune) bool {
		return r == ',' || r == '"' || r == '[' || r == ']' || r == ' '
	})
	titleTokens := strings.Fields(ptLower)

	for _, dt := range desireTokens {
		dt = strings.TrimSpace(dt)
		if len(dt) < 3 {
			continue
		}
		// Whole-word match: desire token equals a title word exactly ? 60
		for _, tw := range titleTokens {
			if tw == dt {
				if bestScore < 60 {
					bestScore = 60
				}
				break
			}
		}
		if bestScore >= 60 {
			continue
		}
		// Full title contains the desire as a standalone phrase ? 58
		// (multi-word desires like "gaming laptop")
		if len(strings.Fields(dt)) > 1 && strings.Contains(ptLower, dt) {
			if bestScore < 58 {
				bestScore = 58
			}
			continue
		}
		// Semantic match against title ? 45
		if services.SemanticMatcher(dt, ptLower) {
			if bestScore < 45 {
				bestScore = 45
			}
			continue
		}
		// Word-boundary cross-match: title word equals desire token ? 55
		for _, tk := range titleTokens {
			if len(tk) < 3 {
				continue
			}
			if tk == dt {
				if bestScore < 55 {
					bestScore = 55
				}
				break
			}
		}
	}

	// Category against desire tokens ? 70 (word-boundary aware)
	if pcLower != "" {
		catTokens := strings.Fields(pcLower)
		for _, dt := range desireTokens {
			dt = strings.TrimSpace(dt)
			if len(dt) < 3 {
				continue
			}
			// Exact word match between category tokens and desire token
			matched := false
			for _, ct := range catTokens {
				if ct == dt {
					matched = true
					break
				}
			}
			if !matched {
				// Fall back to full-string containment for multi-word categories
				matched = strings.Contains(pcLower, dt) || strings.Contains(dt, pcLower)
			}
			if matched {
				if bestScore < 70 {
					bestScore = 70
				}
				break
			}
			if services.SemanticMatcher(dt, pcLower) {
				if bestScore < 45 {
					bestScore = 45
				}
			}
		}
	}

	return bestScore
}

// findProductBasedMultiwayLoops detects 3-way trading opportunities based purely on
// product desires (wanted_categories, desired_product, wants) without requiring existing trades.
// It finds cycles where: UserA wants what UserB has, UserB wants what UserC has, UserC wants what UserA has.
// buildCandidateSet returns indices into the otherProducts slice whose category
// or title words overlap with the given desires string. If no candidates are
// found via the index, it falls back to a full scan (all indices).
func (h *TradeHandler) buildCandidateSet(desires string, byCat map[string][]int, total int) []int {
	dLower := strings.ToLower(strings.TrimSpace(desires))
	tokens := strings.FieldsFunc(dLower, func(r rune) bool {
		return r == ',' || r == '"' || r == '[' || r == ']' || r == ' '
	})

	idxSet := map[int]bool{}
	for _, tok := range tokens {
		tok = strings.TrimSpace(tok)
		if len(tok) < 3 {
			continue
		}
		if indices, ok := byCat[tok]; ok {
			for _, idx := range indices {
				idxSet[idx] = true
			}
		}
	}

	if len(idxSet) == 0 {
		// No index hits â€” fall back to full scan
		all := make([]int, total)
		for i := range all {
			all[i] = i
		}
		return all
	}

	out := make([]int, 0, len(idxSet))
	for idx := range idxSet {
		out = append(out, idx)
	}
	return out
}

var _ = (*TradeHandler).findProductBasedMultiwayLoops

func (h *TradeHandler) findProductBasedMultiwayLoops(userID int) []map[string]interface{} {
	type productInfo struct {
		ID               int
		SellerID         int
		SellerName       string
		Title            string
		Category         string
		Wants            string
		WantedCategories string
		DesiredProduct   string
		ImageURL         string
		Price            float64
		SellerVerified   bool
	}

	// 1. Get current user's available products
	myRows, err := h.db.Query(`
		SELECT p.id, p.seller_id, u.name, p.title, COALESCE(p.category, ''),
		       COALESCE(p.wants, ''), COALESCE(p.wanted_categories, ''), COALESCE(p.desired_product, ''), COALESCE(p.image_url, ''),
		       COALESCE(p.price, 0), COALESCE(u.verified, FALSE)
		FROM products p
		JOIN users u ON u.id = p.seller_id
		WHERE p.seller_id = ? AND p.status = 'available'
		  AND p.created_at >= DATE_SUB(NOW(), INTERVAL 3 MONTH)
	`, userID)
	if err != nil {
		log.Printf("[ProductBasedMultiway] Failed to get user products: %v", err)
		return nil
	}
	defer myRows.Close()

	var myProducts []productInfo
	for myRows.Next() {
		var p productInfo
		if err := myRows.Scan(&p.ID, &p.SellerID, &p.SellerName, &p.Title, &p.Category, &p.Wants, &p.WantedCategories, &p.DesiredProduct, &p.ImageURL, &p.Price, &p.SellerVerified); err != nil {
			continue
		}
		if p.Wants == "" && p.WantedCategories == "" && p.DesiredProduct == "" {
			continue // Skip products with no desires set
		}
		myProducts = append(myProducts, p)
	}

	log.Printf("[ProductBasedMultiway] user=%d has %d products with desires", userID, len(myProducts))
	for _, p := range myProducts {
		log.Printf("[ProductBasedMultiway]   product=%d title=%q wants=%q wantedCats=%q desiredProd=%q", p.ID, p.Title, p.Wants, p.WantedCategories, p.DesiredProduct)
	}
	if len(myProducts) == 0 {
		return nil
	}

	// 2. Get all other users' available products (limited scope)
	otherRows, err := h.db.Query(`
		SELECT p.id, p.seller_id, u.name, p.title, COALESCE(p.category, ''),
		       COALESCE(p.wants, ''), COALESCE(p.wanted_categories, ''), COALESCE(p.desired_product, ''), COALESCE(p.image_url, ''),
		       COALESCE(p.price, 0), COALESCE(u.verified, FALSE)
		FROM products p
		JOIN users u ON u.id = p.seller_id
		WHERE p.seller_id != ? AND p.status = 'available'
		  AND u.role != 'admin'
		  AND p.created_at >= DATE_SUB(NOW(), INTERVAL 3 MONTH)
		ORDER BY p.created_at DESC
		LIMIT 200
	`, userID)
	if err != nil {
		log.Printf("[ProductBasedMultiway] Failed to get other products: %v", err)
		return nil
	}
	defer otherRows.Close()

	var otherProducts []productInfo
	for otherRows.Next() {
		var p productInfo
		if err := otherRows.Scan(&p.ID, &p.SellerID, &p.SellerName, &p.Title, &p.Category, &p.Wants, &p.WantedCategories, &p.DesiredProduct, &p.ImageURL, &p.Price, &p.SellerVerified); err != nil {
			continue
		}
		otherProducts = append(otherProducts, p)
	}

	if len(otherProducts) < 2 {
		return nil
	}

	// Pre-index other products by category and by individual desire tokens
	// so inner loops can skip irrelevant products instead of scanning all 200.
	byCat := map[string][]int{}    // category ? indices into otherProducts
	byDesire := map[string][]int{} // desire token ? indices (products wanting that token)
	for i, p := range otherProducts {
		cat := strings.ToLower(strings.TrimSpace(p.Category))
		if cat != "" {
			byCat[cat] = append(byCat[cat], i)
		}
		// Also index by individual title words for quick lookup
		for _, tw := range strings.Fields(strings.ToLower(p.Title)) {
			if len(tw) >= 3 {
				byCat[tw] = append(byCat[tw], i)
			}
		}
	}
	_ = byDesire // reserved for future desire-based indexing

	// 3. Find 3-way cycles: myProduct ? userB_product ? userC_product ? myProduct
	var loops []map[string]interface{}
	seen := map[string]bool{}
	const maxProductLoopLength = 5

	productDesires := func(p productInfo) string {
		return p.Wants + " " + p.WantedCategories + " " + p.DesiredProduct
	}

	buildProductCycle := func(cycle []productInfo, edgeScores []int) {
		if len(cycle) < 3 || len(cycle) > maxProductLoopLength {
			return
		}

		userIDs := make([]int, 0, len(cycle))
		productIDs := make([]int, 0, len(cycle))
		loopIDParts := []string{"product", "loop"}
		for _, p := range cycle {
			userIDs = append(userIDs, p.SellerID)
			productIDs = append(productIDs, p.ID)
			loopIDParts = append(loopIDParts, strconv.Itoa(p.ID))
		}

		sortedUsers := append([]int{}, userIDs...)
		sortedProducts := append([]int{}, productIDs...)
		sort.Ints(sortedUsers)
		sort.Ints(sortedProducts)
		keyParts := make([]string, 0, len(sortedUsers)+len(sortedProducts))
		for _, id := range sortedUsers {
			keyParts = append(keyParts, strconv.Itoa(id))
		}
		for _, id := range sortedProducts {
			keyParts = append(keyParts, strconv.Itoa(id))
		}
		key := strings.Join(keyParts, "_")
		if seen[key] {
			return
		}
		seen[key] = true

		totalScore := 0
		for _, score := range edgeScores {
			totalScore += score
		}
		avgScore := totalScore / len(edgeScores)

		allPriced := true
		minP, maxP := cycle[0].Price, cycle[0].Price
		for _, p := range cycle {
			if p.Price <= 0 {
				allPriced = false
				break
			}
			if p.Price < minP {
				minP = p.Price
			}
			if p.Price > maxP {
				maxP = p.Price
			}
		}
		if allPriced && maxP > 0 {
			ratio := minP / maxP
			if ratio >= 0.8 {
				avgScore += 5
			} else if ratio >= 0.5 {
				avgScore += 2
			}
		}
		for _, p := range cycle {
			if p.SellerVerified {
				avgScore++
			}
		}
		if avgScore > 100 {
			avgScore = 100
		}

		participants := make([]map[string]interface{}, 0, len(cycle))
		for _, p := range cycle {
			participants = append(participants, map[string]interface{}{
				"id": p.SellerID, "user_name": p.SellerName, "product_title": p.Title,
				"product_id": p.ID, "category": p.Category, "wanted_categories": p.WantedCategories,
				"desired_product": p.DesiredProduct, "product_image_url": p.ImageURL, "status": "pending",
			})
		}

		loopID := strings.Join(loopIDParts, "_")
		log.Printf("[ProductBasedMultiway] Found %d-way cycle (score %d%%): products=%v", len(cycle), avgScore, productIDs)
		loops = append(loops, map[string]interface{}{
			"id":                loopID,
			"loop_id":           loopID,
			"loop_type":         "product_match",
			"initiator_view":    true,
			"can_join":          true,
			"can_decline":       true,
			"can_create":        true,
			"loop_length":       len(cycle),
			"status":            "pending",
			"initiator_user_id": userID,
			"score":             avgScore,
			"match_score":       avgScore,
			"expires_at":        time.Now().Add(48 * time.Hour).Format("2006-01-02 15:04:05"),
			"participants":      participants,
		})
	}

	for _, myProd := range myProducts {
		// Build desire haystack for my product
		myDesires := myProd.Wants + " " + myProd.WantedCategories + " " + myProd.DesiredProduct

		// Build candidate set for prodB: products whose category or title words
		// overlap with my desires. Fall back to full scan if no candidates found.
		candidateB := h.buildCandidateSet(myDesires, byCat, len(otherProducts))

		for _, bi := range candidateB {
			prodB := otherProducts[bi]
			// Does my product's desires match what UserB has? (scored)
			scoreAB := productMatchScore(prodB.Title, prodB.Category, myDesires)
			if scoreAB == 0 {
				continue
			}

			// UserB must also have desires set
			if prodB.Wants == "" && prodB.WantedCategories == "" && prodB.DesiredProduct == "" {
				continue
			}
			bDesires := prodB.Wants + " " + prodB.WantedCategories + " " + prodB.DesiredProduct

			// Build candidate set for prodC based on UserB's desires
			candidateC := h.buildCandidateSet(bDesires, byCat, len(otherProducts))

			for _, ci := range candidateC {
				prodC := otherProducts[ci]
				if prodC.SellerID == prodB.SellerID || prodC.SellerID == userID {
					continue // Must be 3 distinct users
				}

				// Does UserB's desires match what UserC has? (scored)
				scoreBC := productMatchScore(prodC.Title, prodC.Category, bDesires)
				if scoreBC == 0 {
					continue
				}

				// Does UserC's desires match what I (UserA) have? (scored)
				cDesires := prodC.Wants + " " + prodC.WantedCategories + " " + prodC.DesiredProduct
				scoreCA := productMatchScore(myProd.Title, myProd.Category, cDesires)
				if scoreCA == 0 {
					continue
				}

				// Average the 3 edge scores for the loop's overall match quality
				avgScore := (scoreAB + scoreBC + scoreCA) / 3

				// Price similarity bonus: if all 3 products have prices, boost
				// score when values are within Â±50% of each other (fair trades).
				if myProd.Price > 0 && prodB.Price > 0 && prodC.Price > 0 {
					prices := []float64{myProd.Price, prodB.Price, prodC.Price}
					minP, maxP := prices[0], prices[0]
					for _, pr := range prices[1:] {
						if pr < minP {
							minP = pr
						}
						if pr > maxP {
							maxP = pr
						}
					}
					ratio := minP / maxP // 0..1, higher = closer in value
					if ratio >= 0.8 {
						avgScore += 5 // very close values
					} else if ratio >= 0.5 {
						avgScore += 2 // reasonably close
					}
					// ratio < 0.5: no bonus (large price gap)
				}

				// Reputation bonus: verified users are more trustworthy
				verifiedCount := 0
				if myProd.SellerVerified {
					verifiedCount++
				}
				if prodB.SellerVerified {
					verifiedCount++
				}
				if prodC.SellerVerified {
					verifiedCount++
				}
				avgScore += verifiedCount // +1 per verified user (max +3)

				// Clamp to 100
				if avgScore > 100 {
					avgScore = 100
				}

				// Found a 3-way cycle!
				// Deduplicate by sorted user IDs + product IDs
				ids := []int{userID, prodB.SellerID, prodC.SellerID}
				sort.Ints(ids)
				pids := []int{myProd.ID, prodB.ID, prodC.ID}
				sort.Ints(pids)
				key := fmt.Sprintf("%d_%d_%d_%d_%d_%d", ids[0], ids[1], ids[2], pids[0], pids[1], pids[2])
				if seen[key] {
					continue
				}
				seen[key] = true

				log.Printf("[ProductBasedMultiway] ? Found 3-way cycle (score %d%%): %s(%s) ? %s(%s) ? %s(%s) ? back",
					avgScore, myProd.SellerName, myProd.Title, prodB.SellerName, prodB.Title, prodC.SellerName, prodC.Title)

				loopID := fmt.Sprintf("product_loop_%d_%d_%d", myProd.ID, prodB.ID, prodC.ID)

				loops = append(loops, map[string]interface{}{
					"id":                loopID,
					"loop_id":           loopID,
					"loop_type":         "product_match",
					"initiator_view":    true,
					"can_join":          true,
					"can_decline":       true,
					"can_create":        true,
					"loop_length":       3,
					"status":            "pending",
					"initiator_user_id": userID,
					"score":             avgScore,
					"match_score":       avgScore,
					"expires_at":        time.Now().Add(48 * time.Hour).Format("2006-01-02 15:04:05"),
					"participants": []map[string]interface{}{
						{"id": userID, "user_name": myProd.SellerName, "product_title": myProd.Title, "product_id": myProd.ID, "category": myProd.Category, "wanted_categories": myProd.WantedCategories, "desired_product": myProd.DesiredProduct, "product_image_url": myProd.ImageURL, "status": "pending"},
						{"id": prodB.SellerID, "user_name": prodB.SellerName, "product_title": prodB.Title, "product_id": prodB.ID, "category": prodB.Category, "wanted_categories": prodB.WantedCategories, "desired_product": prodB.DesiredProduct, "product_image_url": prodB.ImageURL, "status": "pending"},
						{"id": prodC.SellerID, "user_name": prodC.SellerName, "product_title": prodC.Title, "product_id": prodC.ID, "category": prodC.Category, "wanted_categories": prodC.WantedCategories, "desired_product": prodC.DesiredProduct, "product_image_url": prodC.ImageURL, "status": "pending"},
					},
				})
			}
		}
	}

	for _, myProd := range myProducts {
		path := []productInfo{myProd}
		edgeScores := []int{}
		visitedUsers := map[int]bool{myProd.SellerID: true}
		visitedProducts := map[int]bool{myProd.ID: true}

		var dfs func(current productInfo)
		dfs = func(current productInfo) {
			if len(path) >= maxProductLoopLength {
				return
			}

			currentDesires := productDesires(current)
			if strings.TrimSpace(currentDesires) == "" {
				return
			}

			candidates := h.buildCandidateSet(currentDesires, byCat, len(otherProducts))
			for _, nextIdx := range candidates {
				next := otherProducts[nextIdx]
				if visitedUsers[next.SellerID] || visitedProducts[next.ID] {
					continue
				}

				score := productMatchScore(next.Title, next.Category, currentDesires)
				if score == 0 {
					continue
				}

				nextDesires := productDesires(next)
				if strings.TrimSpace(nextDesires) == "" {
					continue
				}

				closeScore := productMatchScore(myProd.Title, myProd.Category, nextDesires)
				if closeScore > 0 && len(path)+1 >= 3 {
					cycle := append(append([]productInfo{}, path...), next)
					scores := append(append([]int{}, edgeScores...), score, closeScore)
					buildProductCycle(cycle, scores)
				}

				if len(path)+1 >= maxProductLoopLength {
					continue
				}

				visitedUsers[next.SellerID] = true
				visitedProducts[next.ID] = true
				path = append(path, next)
				edgeScores = append(edgeScores, score)
				dfs(next)
				edgeScores = edgeScores[:len(edgeScores)-1]
				path = path[:len(path)-1]
				delete(visitedProducts, next.ID)
				delete(visitedUsers, next.SellerID)
			}
		}
		dfs(myProd)
	}

	return loops
}

// GetTradeLoops returns all possible multi-way trading loops the authenticated user is involved in
func (h *TradeHandler) GetTradeLoops(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}

	statusFilter := c.Query("status", "")
	if statusFilter == "" {
		h.cleanupAutomaticMultiwayArtifacts(userID)
		h.reprocessEligibleLoopsForUser(userID)
	}

	var query string
	var args []interface{}
	switch statusFilter {
	case "completed":
		query = `
			SELECT l.id, l.status, l.updated_at
			FROM trade_like_loops l
			JOIN trade_like_loop_participants p ON p.loop_id = l.id
			WHERE p.user_id = ? AND l.status IN ('completed', 'history')
			ORDER BY l.updated_at DESC
		`
		args = []interface{}{userID}
	case "cancelled":
		query = `
			SELECT l.id, l.status, l.updated_at
			FROM trade_like_loops l
			JOIN trade_like_loop_participants p ON p.loop_id = l.id
			WHERE p.user_id = ? AND l.status IN ('rejected', 'cancelled', 'cancelled_due_to_conflict', 'broken', 'expired')
			ORDER BY l.updated_at DESC
		`
		args = []interface{}{userID}
	default:
		query = `
			SELECT l.id, l.status, l.updated_at
			FROM trade_like_loops l
			JOIN trade_like_loop_participants p ON p.loop_id = l.id
			WHERE p.user_id = ? AND l.status IN (
				'pending', 'partially_accepted', 'accepted', 'confirmed', 'ongoing',
				'completed', 'history', 'rejected', 'cancelled', 'cancelled_due_to_conflict',
				'broken', 'expired'
			)
			ORDER BY l.updated_at DESC
		`
		args = []interface{}{userID}
	}

	rows, err := h.db.Query(query, args...)
	if err != nil {
		if strings.Contains(err.Error(), "doesn't exist") || strings.Contains(err.Error(), "Error 1146") {
			log.Printf("GetTradeLoops: missing like-loop tables: %v", err)
			return c.JSON(models.APIResponse{Success: true, Data: []map[string]interface{}{}})
		}
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to fetch trade loops"})
	}
	defer rows.Close()

	loops := h.getMultiwayChainSummariesForUser(userID, statusFilter)
	for rows.Next() {
		var loopID int
		var status string
		var updatedAt time.Time
		if err := rows.Scan(&loopID, &status, &updatedAt); err != nil {
			continue
		}

		participants, edges, canJoin, canDecline := h.getLikeLoopParticipants(loopID, userID)
		if len(participants) == 0 {
			continue
		}

		loops = append(loops, map[string]interface{}{
			"id":                loopID,
			"loop_id":           loopIDFromLikeLoopID(loopID),
			"loop_type":         "like_loop",
			"status":            status,
			"accepted_count":    countAcceptedLoopParticipants(participants),
			"participant_count": len(participants),
			"loop_length":       len(participants),
			"can_join":          canJoin,
			"can_decline":       canDecline,
			"participants":      participants,
			"edges":             edges,
			"updated_at":        updatedAt,
			"completed_at":      updatedAt,
		})
	}

	if loops == nil {
		loops = []map[string]interface{}{}
	}

	return c.JSON(models.APIResponse{Success: true, Data: loops})
}

func (h *TradeHandler) ReprocessTradeLoops(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}

	created := h.reprocessEligibleLoopsForUser(userID)
	h.cleanupAutomaticMultiwayArtifacts(userID)

	return c.JSON(models.APIResponse{Success: true, Data: fiber.Map{
		"created_loops": created,
		"loop_count":    len(created),
	}})
}

func (h *TradeHandler) cleanupAutomaticMultiwayArtifacts(userID int) {
	if userID <= 0 {
		return
	}
	_, _ = h.db.Exec(`
		DELETE FROM trade_loop_cache
		WHERE user_id = ?
		  AND (
		    loop_type IN ('product_match', 'auto_multiway')
		    OR loop_id LIKE 'product_loop_%'
		    OR payload_json LIKE '%"loop_type":"product_match"%'
		    OR payload_json LIKE '%"loop_type":"auto_multiway"%'
		  )
	`, userID)

	_, _ = h.db.Exec(`
		UPDATE multiway_trades
		SET status = 'cancelled',
		    cancelled_at = COALESCE(cancelled_at, NOW()),
		    updated_at = NOW()
		WHERE status IN ('searching', 'pending_user3', 'pending_initiator_upgrade', 'waiting_acceptance', 'user3_accepted', 'accepted')
		  AND (user1_id = ? OR user2_id = ? OR user3_id = ? OR initiator_user_id = ?)
	`, userID, userID, userID, userID)
}

func (h *TradeHandler) getMultiwayChainSummariesForUser(userID int, statusFilter string) []map[string]interface{} {
	statuses := []string{"pending_user3", "user3_accepted", "accepted", "confirmed", "active", "multiway_active", "ongoing"}
	switch statusFilter {
	case "completed":
		statuses = []string{"completed", "history"}
	case "cancelled":
		statuses = []string{"cancelled", "cancelled_due_to_conflict", "broken", "expired", "user3_declined"}
	}

	placeholders := make([]string, len(statuses))
	args := []interface{}{userID, userID, userID}
	for i, status := range statuses {
		placeholders[i] = "?"
		args = append(args, status)
	}

	query := fmt.Sprintf(`
		SELECT DISTINCT chain_id, original_trade_id, user1_id, user2_id,
		       COALESCE(user3_id, 0), COALESCE(user3_product_id, 0),
		       status, updated_at, id
		FROM multiway_trades
		WHERE (user1_id = ? OR user2_id = ? OR user3_id = ?)
		  AND status IN (%s)
		  AND COALESCE(is_proactive_match, FALSE) = FALSE
		  AND original_trade_id IS NOT NULL
		  AND chain_id NOT LIKE 'proactive_%%'
		ORDER BY updated_at DESC
	`, strings.Join(placeholders, ","))

	rows, err := h.db.Query(query, args...)
	if err != nil {
		return []map[string]interface{}{}
	}
	defer rows.Close()

	loops := []map[string]interface{}{}
	for rows.Next() {
		var chainID, status string
		var originalTradeID, user1ID, user2ID, user3ID, user3ProductID, rowID int
		var updatedAt time.Time
		if err := rows.Scan(&chainID, &originalTradeID, &user1ID, &user2ID, &user3ID, &user3ProductID, &status, &updatedAt, &rowID); err != nil {
			continue
		}
		if user3ID == 0 {
			continue
		}

		var targetProductID, offeredProductID int
		_ = h.db.QueryRow("SELECT target_product_id FROM trades WHERE id = ?", originalTradeID).Scan(&targetProductID)
		_ = h.db.QueryRow("SELECT product_id FROM trade_items WHERE trade_id = ? ORDER BY id ASC LIMIT 1", originalTradeID).Scan(&offeredProductID)

		userNames := h.fetchUserNamesByIDs([]int{user1ID, user2ID, user3ID})
		productInfo := func(productID int) (string, string) {
			var title, imageURL string
			_ = h.db.QueryRow("SELECT COALESCE(title, ''), COALESCE(image_url, '') FROM products WHERE id = ?", productID).Scan(&title, &imageURL)
			return title, imageURL
		}
		user1Title, user1Image := productInfo(offeredProductID)
		user2Title, user2Image := productInfo(targetProductID)
		user3Title, user3Image := productInfo(user3ProductID)

		acceptedCount := 0
		switch status {
		case "confirmed", "active", "multiway_active", "ongoing", "completed", "history":
			acceptedCount = 3
		case "user3_accepted", "accepted":
			acceptedCount = 1
		}

		participants := []map[string]interface{}{
			{
				"id": user1ID, "user_id": user1ID, "user_name": userNames[user1ID],
				"product_id": offeredProductID, "product_title": user1Title, "product_image_url": user1Image,
				"position_in_loop": 0, "trade_id": originalTradeID, "status": status, "trade_status": status,
			},
			{
				"id": user2ID, "user_id": user2ID, "user_name": userNames[user2ID],
				"product_id": targetProductID, "product_title": user2Title, "product_image_url": user2Image,
				"position_in_loop": 1, "trade_id": originalTradeID, "status": status, "trade_status": status,
			},
			{
				"id": user3ID, "user_id": user3ID, "user_name": userNames[user3ID],
				"product_id": user3ProductID, "product_title": user3Title, "product_image_url": user3Image,
				"position_in_loop": 2, "trade_id": originalTradeID, "status": status, "trade_status": status,
			},
		}

		loops = append(loops, map[string]interface{}{
			"id":                rowID,
			"loop_id":           chainID,
			"chain_id":          chainID,
			"loop_type":         "multiway_chain",
			"is_chain":          true,
			"status":            status,
			"accepted_count":    acceptedCount,
			"participant_count": 3,
			"loop_length":       3,
			"can_join":          false,
			"can_decline":       status == "pending_user3" || status == "user3_accepted" || status == "accepted",
			"participants":      participants,
			"edges": []map[string]interface{}{
				{"from_user": user1ID, "to_user": user2ID, "from_user_name": userNames[user1ID], "to_user_name": userNames[user2ID], "product_title": user2Title, "status": status},
				{"from_user": user2ID, "to_user": user3ID, "from_user_name": userNames[user2ID], "to_user_name": userNames[user3ID], "product_title": user3Title, "status": status},
				{"from_user": user3ID, "to_user": user1ID, "from_user_name": userNames[user3ID], "to_user_name": userNames[user1ID], "product_title": user1Title, "status": status},
			},
			"updated_at":   updatedAt,
			"completed_at": updatedAt,
		})
	}

	return loops
}

func (h *TradeHandler) getLikeLoopParticipants(loopID int, userID int) ([]map[string]interface{}, []map[string]interface{}, bool, bool) {
	rows, err := h.db.Query(`
		SELECT p.user_id, u.name, COALESCE(u.slug, ''), p.offered_product_id, p.wanted_product_id,
		       p.position_in_loop, p.status,
		       COALESCE(op.title, ''), COALESCE(op.slug, ''), COALESCE(op.image_url, ''), COALESCE(op.image_urls, ''),
		       COALESCE(wp.title, ''), COALESCE(wp.slug, ''), p.is_reviewed
		FROM trade_like_loop_participants p
		JOIN users u ON u.id = p.user_id
		JOIN products op ON op.id = p.offered_product_id
		JOIN products wp ON wp.id = p.wanted_product_id
		WHERE p.loop_id = ?
		ORDER BY p.position_in_loop ASC
	`, loopID)
	if err != nil {
		return nil, nil, false, false
	}
	defer rows.Close()

	participants := []map[string]interface{}{}
	canJoin := false
	canDecline := false
	for rows.Next() {
		var uid, offeredID, wantedID, position int
		var isReviewed bool
		var userName, userSlug, offeredTitle, offeredSlug, offeredImage, offeredImages, wantedTitle, wantedSlug, status string
		if err := rows.Scan(&uid, &userName, &userSlug, &offeredID, &wantedID, &position, &status, &offeredTitle, &offeredSlug, &offeredImage, &offeredImages, &wantedTitle, &wantedSlug, &isReviewed); err != nil {
			continue
		}
		participants = append(participants, map[string]interface{}{
			"id":                 uid,
			"user_id":            uid,
			"user_name":          userName,
			"user_slug":          userSlug,
			"product_id":         offeredID,
			"product_title":      offeredTitle,
			"product_slug":       offeredSlug,
			"product_image_url":  offeredImage,
			"product_image_urls": offeredImages,
			"wanted_product_id":  wantedID,
			"wanted_title":       wantedTitle,
			"wanted_slug":        wantedSlug,
			"position_in_loop":   position,
			"status":             status,
			"trade_status":       status,
			"is_reviewed":        isReviewed,
		})
		if uid == userID && status == "pending" {
			canJoin = true
			canDecline = true
		}
	}

	edges := []map[string]interface{}{}
	if len(participants) > 1 {
		for i, p := range participants {
			next := participants[(i+1)%len(participants)]
			edges = append(edges, map[string]interface{}{
				"from_user":      p["user_id"],
				"from_user_name": p["user_name"],
				"to_user":        next["user_id"],
				"to_user_name":   next["user_name"],
				"product_title":  next["product_title"],
				"status":         p["status"],
			})
		}
	}

	return participants, edges, canJoin, canDecline
}

func countAcceptedLoopParticipants(participants []map[string]interface{}) int {
	count := 0
	for _, participant := range participants {
		status, _ := participant["status"].(string)
		tradeStatus, _ := participant["trade_status"].(string)
		if status == "confirmed" || status == "accepted" || tradeStatus == "confirmed" || tradeStatus == "accepted" {
			count++
		}
	}
	return count
}

func (h *TradeHandler) GetTradeLoop(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}

	loopID := c.Params("id") // Format: loop_tradeid1_tradeid2_tradeid3
	log.Printf("[GetTradeLoop] userID=%d raw loopID=%q", userID, loopID)

	if likeLoopID, ok := parseLikeLoopID(loopID); ok {
		participants, edges, canJoin, canDecline := h.getLikeLoopParticipants(likeLoopID, userID)
		if len(participants) == 0 {
			return c.Status(404).JSON(models.APIResponse{Success: false, Error: "Trade loop not found"})
		}

		var status string
		_ = h.db.QueryRow("SELECT status FROM trade_like_loops WHERE id = ?", likeLoopID).Scan(&status)
		if status == "" {
			status = "pending"
		}

		return c.JSON(models.APIResponse{Success: true, Data: fiber.Map{
			"loop_id":           loopID,
			"loop_type":         "like_loop",
			"participants":      participants,
			"edges":             edges,
			"status":            status,
			"accepted_count":    countAcceptedLoopParticipants(participants),
			"participant_count": len(participants),
			"can_join":          canJoin,
			"can_decline":       canDecline,
		}})
	}

	// Handle new multiway chain format (chain_ID)
	if strings.HasPrefix(loopID, "chain_") {
		var mID, tID, u3ID, u3PID int
		var status string
		err := h.db.QueryRow("SELECT id, original_trade_id, user3_id, user3_product_id, status FROM multiway_trades WHERE chain_id = ?", loopID).Scan(&mID, &tID, &u3ID, &u3PID, &status)
		if err != nil {
			// Backward compatibility for legacy chain_123 numeric IDs
			chainID, convErr := strconv.Atoi(strings.Replace(loopID, "chain_", "", 1))
			if convErr == nil {
				err = h.db.QueryRow("SELECT id, original_trade_id, user3_id, user3_product_id, status FROM multiway_trades WHERE id = ?", chainID).Scan(&mID, &tID, &u3ID, &u3PID, &status)
			}
		}
		if err != nil {
			return c.Status(404).JSON(models.APIResponse{Success: false, Error: "Multi-way chain not found"})
		}

		// Fetch original trade (U1 -> U2)
		var u1ID, u2ID, u2PID int
		err = h.db.QueryRow("SELECT buyer_id, seller_id, target_product_id FROM trades WHERE id = ?", tID).Scan(&u1ID, &u2ID, &u2PID)
		if err != nil {
			return c.Status(404).JSON(models.APIResponse{Success: false, Error: "Original trade not found"})
		}

		// Fetch U3's wanted product (which is U1's offered product)
		var u3WantedPID int
		err = h.db.QueryRow("SELECT product_id FROM trade_items WHERE trade_id = ? LIMIT 1", tID).Scan(&u3WantedPID)

		// Fetch names and titles
		var u1Name, u2Name, u3Name, u1Title, u2Title, u3Title string
		var u1Slug, u2Slug, u3Slug, u1ProductSlug, u2ProductSlug, u3ProductSlug sql.NullString
		h.db.QueryRow("SELECT name, slug FROM users WHERE id = ?", u1ID).Scan(&u1Name, &u1Slug)
		h.db.QueryRow("SELECT name, slug FROM users WHERE id = ?", u2ID).Scan(&u2Name, &u2Slug)
		h.db.QueryRow("SELECT name, slug FROM users WHERE id = ?", u3ID).Scan(&u3Name, &u3Slug)

		h.db.QueryRow("SELECT title, slug FROM products WHERE id = ?", u3WantedPID).Scan(&u1Title, &u1ProductSlug) // U1's product
		h.db.QueryRow("SELECT title, slug FROM products WHERE id = ?", u2PID).Scan(&u2Title, &u2ProductSlug)       // U2's product
		h.db.QueryRow("SELECT title, slug FROM products WHERE id = ?", u3PID).Scan(&u3Title, &u3ProductSlug)       // U3's product

		// Check if user is participant
		if userID != u1ID && userID != u2ID && userID != u3ID {
			return c.Status(403).JSON(models.APIResponse{Success: false, Error: "You are not a participant in this multi-way trade"})
		}

		participantsDetails := []map[string]interface{}{
			{
				"user_id": u1ID, "user_name": u1Name, "user_slug": u1Slug.String,
				"product_id": u3WantedPID, "product_title": u1Title, "product_slug": u1ProductSlug.String,
				"position_in_loop": 0, "trade_id": tID, "trade_status": "accepted",
			},
			{
				"user_id": u2ID, "user_name": u2Name, "user_slug": u2Slug.String,
				"product_id": u2PID, "product_title": u2Title, "product_slug": u2ProductSlug.String,
				"position_in_loop": 1, "trade_id": tID, "trade_status": "accepted",
			},
			{
				"user_id": u3ID, "user_name": u3Name, "user_slug": u3Slug.String,
				"product_id": u3PID, "product_title": u3Title, "product_slug": u3ProductSlug.String,
				"position_in_loop": 2, "trade_id": tID, "trade_status": "accepted",
			},
		}

		edges := []map[string]interface{}{
			{"from_user": u1ID, "to_user": u2ID, "from_user_name": u1Name, "to_user_name": u2Name, "product_title": u2Title, "status": status},
			{"from_user": u2ID, "to_user": u3ID, "from_user_name": u2Name, "to_user_name": u3Name, "product_title": u3Title, "status": status},
			{"from_user": u3ID, "to_user": u1ID, "from_user_name": u3Name, "to_user_name": u1Name, "product_title": u1Title, "status": status},
		}

		return c.JSON(models.APIResponse{
			Success: true,
			Data: fiber.Map{
				"loop_id":      loopID,
				"is_chain":     true,
				"participants": participantsDetails,
				"edges":        edges,
				"status":       status,
			},
		})
	}

	// Product-based loop: product_loop_{prodA}_{prodB}_..._{prodN}, N=3..5
	if strings.HasPrefix(loopID, "product_loop_") {
		return c.Status(404).JSON(models.APIResponse{Success: false, Error: "Product preference loops are no longer valid. Like products from Find Match to create Trade Match or Multiway loops."})
	}

	// Backward-compatible support for cached auto suggestions: auto_{tradeID}_{user3ID}
	// This allows clients to view loop details before the chain row is materialized.
	if strings.HasPrefix(loopID, "auto_") {
		return c.Status(404).JSON(models.APIResponse{Success: false, Error: "Automatic multiway suggestions are no longer valid. Like products from Find Match to create Trade Match or Multiway loops."})
	}

	// Verify loop exists and user is part of it. For simplicity in this implementation,
	// we will reconstruct the loop from the trade IDs in the string.
	parts := strings.Split(loopID, "_")
	if len(parts) < 3 || parts[0] != "loop" {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid loop ID"})
	}

	var edges []map[string]interface{}
	var participantsDetails []map[string]interface{}
	involvesUser := false
	allTradesActive := true

	// Use loop agreements to represent participant confirmation status.
	agreementStatusByUser := map[int]string{}
	rowsAgreements, err := h.db.Query(`
		SELECT user_id, status
		FROM trade_loop_agreements
		WHERE loop_id = ?
	`, loopID)
	if err == nil {
		defer rowsAgreements.Close()
		var uid int
		var st string
		for rowsAgreements.Next() {
			if scanErr := rowsAgreements.Scan(&uid, &st); scanErr == nil {
				agreementStatusByUser[uid] = st
			}
		}
	}

	for i := 1; i < len(parts); i++ {
		tradeIDStr := parts[i]
		tradeID, err := strconv.Atoi(tradeIDStr)
		if err != nil {
			return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid trade ID in loop"})
		}

		var buyerID, sellerID, targetProductID int
		var tradeStatus string
		err = h.db.QueryRow("SELECT buyer_id, seller_id, target_product_id, status FROM trades WHERE id = ?", tradeID).Scan(&buyerID, &sellerID, &targetProductID, &tradeStatus)
		if err != nil {
			return c.Status(404).JSON(models.APIResponse{Success: false, Error: "Trade not found"})
		}

		var fromUserName, toUserName, productTitle string
		var fromUserSlug, toUserSlug, productSlug sql.NullString
		h.db.QueryRow("SELECT name, slug FROM users WHERE id = ?", buyerID).Scan(&fromUserName, &fromUserSlug)
		h.db.QueryRow("SELECT name, slug FROM users WHERE id = ?", sellerID).Scan(&toUserName, &toUserSlug)
		h.db.QueryRow("SELECT title, slug FROM products WHERE id = ?", targetProductID).Scan(&productTitle, &productSlug)

		if buyerID == userID || sellerID == userID {
			involvesUser = true
		}

		participantsDetails = append(participantsDetails, map[string]interface{}{
			"user_id":       buyerID,
			"user_name":     fromUserName,
			"user_slug":     fromUserSlug.String,
			"product_id":    targetProductID,
			"product_title": productTitle,
			"product_slug":  productSlug.String,
			"trade_id":      tradeID,
			"trade_status": func() string {
				if s, ok := agreementStatusByUser[buyerID]; ok {
					return s
				}
				return "pending"
			}(),
			"position_in_loop": i - 1,
		})

		edges = append(edges, map[string]interface{}{
			"from_user":      buyerID,
			"from_user_name": fromUserName,
			"to_user":        sellerID,
			"to_user_name":   toUserName,
			"trade_id":       tradeID,
			"product_title":  productTitle,
			"status":         tradeStatus,
		})

		if tradeStatus != "active" {
			allTradesActive = false
		}
	}

	if !involvesUser {
		return c.Status(403).JSON(models.APIResponse{Success: false, Error: "You are not a participant in this trade loop"})
	}

	// Because of Type Mismatches in TypeScript frontend, we cast it correctly
	return c.JSON(models.APIResponse{
		Success: true,
		Data: fiber.Map{
			"loop_id":      loopID,
			"edges":        edges,
			"participants": participantsDetails,
			"status": func() string {
				if allTradesActive {
					return "completed"
				}
				return "active"
			}(),
		},
	})
}

// AcceptTradeLoop
func (h *TradeHandler) AcceptTradeLoop(c *fiber.Ctx) error {
	loopID := c.Params("id")
	log.Printf("[AcceptTradeLoop] raw loopID=%q", loopID)

	loopNumericID, ok := parseLikeLoopID(loopID)
	if !ok {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid loop ID"})
	}

	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}

	return h.acceptTradeLoopTransactional(c, loopID, loopNumericID, userID)
}

func (h *TradeHandler) acceptTradeLoopTransactional(c *fiber.Ctx, loopID string, loopNumericID int, userID int) error {
	tx, err := h.db.Begin()
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to start transaction"})
	}
	defer tx.Rollback()

	var loopStatus, loopKey string
	if err := tx.QueryRow("SELECT status, loop_key FROM trade_like_loops WHERE id = ? FOR UPDATE", loopNumericID).Scan(&loopStatus, &loopKey); err != nil {
		return c.Status(404).JSON(models.APIResponse{Success: false, Error: "Trade loop not found"})
	}
	if loopStatus != "pending" && loopStatus != "partially_accepted" && loopStatus != "accepted" && loopStatus != "accepted_by_one" {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Trade loop is not awaiting acceptance"})
	}

	type participantState struct {
		userID           int
		offeredProductID int
		wantedProductID  int
		status           string
	}
	rows, err := tx.Query(`
		SELECT user_id, offered_product_id, wanted_product_id, status
		FROM trade_like_loop_participants
		WHERE loop_id = ?
		ORDER BY position_in_loop ASC
		FOR UPDATE
	`, loopNumericID)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to load loop participants"})
	}

	participants := []participantState{}
	isParticipant := false
	for rows.Next() {
		var p participantState
		if err := rows.Scan(&p.userID, &p.offeredProductID, &p.wantedProductID, &p.status); err != nil {
			rows.Close()
			return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to inspect loop participants"})
		}
		if p.userID == userID {
			isParticipant = true
			if p.status == "confirmed" || p.status == "accepted" {
				rows.Close()
				return c.Status(400).JSON(models.APIResponse{Success: false, Error: "You have already accepted this trade"})
			}
		}
		if p.status == "declined" || p.status == "rejected" || p.status == "cancelled" || p.status == "expired" {
			rows.Close()
			_, _ = tx.Exec("UPDATE trade_like_loops SET status='broken', updated_at=CURRENT_TIMESTAMP WHERE id=?", loopNumericID)
			if err := tx.Commit(); err != nil {
				return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to mark loop broken"})
			}
			go h.notifyLikeLoopUsers(loopNumericID, "A trade loop can no longer proceed because a participant backed out.", "trade_loop_broken")
			return c.Status(409).JSON(models.APIResponse{Success: false, Error: "This trade loop is broken and can no longer proceed"})
		}
		participants = append(participants, p)
	}
	rows.Close()

	if !isParticipant {
		return c.Status(403).JSON(models.APIResponse{Success: false, Error: "You are not a participant in this trade loop"})
	}
	if len(participants) < 2 || len(participants) > 5 {
		_, _ = tx.Exec("UPDATE trade_like_loops SET status='broken', updated_at=CURRENT_TIMESTAMP WHERE id=?", loopNumericID)
		if err := tx.Commit(); err != nil {
			return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to mark invalid loop"})
		}
		return c.Status(409).JSON(models.APIResponse{Success: false, Error: "Invalid trade loop"})
	}

	productIDs := []int{}
	for _, p := range participants {
		productIDs = append(productIDs, p.offeredProductID, p.wantedProductID)
	}
	productIDs = uniquePositiveInts(productIDs)
	if len(productIDs) != len(participants) {
		_, _ = tx.Exec("UPDATE trade_like_loops SET status='broken', updated_at=CURRENT_TIMESTAMP WHERE id=?", loopNumericID)
		if err := tx.Commit(); err != nil {
			return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to mark invalid loop"})
		}
		return c.Status(409).JSON(models.APIResponse{Success: false, Error: "Invalid trade loop product mapping"})
	}

	for _, pid := range productIDs {
		var status string
		if err := tx.QueryRow("SELECT status FROM products WHERE id = ? FOR UPDATE", pid).Scan(&status); err != nil {
			return c.Status(409).JSON(models.APIResponse{Success: false, Error: "One of the products is no longer available"})
		}
		if status != "available" {
			_, _ = tx.Exec("UPDATE trade_like_loops SET status='broken', updated_at=CURRENT_TIMESTAMP WHERE id=?", loopNumericID)
			if err := tx.Commit(); err != nil {
				return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to mark loop broken"})
			}
			go h.notifyLikeLoopUsers(loopNumericID, "A trade loop can no longer proceed because one product is unavailable.", "trade_loop_broken")
			return c.Status(409).JSON(models.APIResponse{Success: false, Error: "One of the products is no longer available"})
		}
	}

	if _, err := tx.Exec(`
		UPDATE trade_like_loop_participants
		SET status = 'confirmed', confirmed_at = CURRENT_TIMESTAMP
		WHERE loop_id = ? AND user_id = ?
	`, loopNumericID, userID); err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to accept trade loop"})
	}

	allAccepted := true
	for _, p := range participants {
		if p.userID == userID {
			continue
		}
		if p.status != "confirmed" && p.status != "accepted" {
			allAccepted = false
			break
		}
	}

	if !allAccepted {
		if _, err := tx.Exec("UPDATE trade_like_loops SET status='partially_accepted', updated_at=CURRENT_TIMESTAMP WHERE id=?", loopNumericID); err != nil {
			return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to update loop status"})
		}
		if err := tx.Commit(); err != nil {
			return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to save acceptance"})
		}
		userIDs := []int{}
		for _, p := range participants {
			userIDs = append(userIDs, p.userID)
			publishToUser(p.userID, sseEvent{Type: "trade_updated", Data: fiber.Map{
				"notification_type": "trade_loop",
				"loop_id":           loopID,
				"status":            "partially_accepted",
			}})
		}
		go h.rebuildTradeLoopCacheForUsers(userIDs)
		go h.notifyLikeLoopUsersExcept(loopNumericID, userID, "A participant accepted the trade. Waiting for everyone else to accept.", "trade_loop")
		return c.JSON(models.APIResponse{
			Success: true,
			Message: "Acceptance saved. Waiting for others.",
			Data: fiber.Map{
				"loop_id": loopID,
				"status":  "partially_accepted",
			},
		})
	}

	if h.productsHaveActiveCommitment(productIDs, loopKey) {
		_, _ = tx.Exec("UPDATE trade_like_loops SET status='broken', updated_at=CURRENT_TIMESTAMP WHERE id=?", loopNumericID)
		if err := tx.Commit(); err != nil {
			return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to mark loop broken"})
		}
		go h.notifyLikeLoopUsers(loopNumericID, "A trade loop can no longer proceed because one product was committed elsewhere.", "trade_loop_broken")
		return c.Status(409).JSON(models.APIResponse{Success: false, Error: "One of the products is already committed elsewhere"})
	}

	for _, pid := range productIDs {
		res, err := tx.Exec("UPDATE products SET status='locked', updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='available'", pid)
		if err != nil {
			return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to lock products"})
		}
		if affected, _ := res.RowsAffected(); affected != 1 {
			return c.Status(409).JSON(models.APIResponse{Success: false, Error: "One of the products was committed elsewhere"})
		}
	}
	if _, err := tx.Exec("UPDATE trade_like_loops SET status='ongoing', confirmed_at=COALESCE(confirmed_at, CURRENT_TIMESTAMP), updated_at=CURRENT_TIMESTAMP WHERE id=?", loopNumericID); err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to move trade to ongoing"})
	}
	if err := h.cancelConflictingLifecycleTx(tx, 0, loopNumericID, "", productIDs, userID); err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to cancel conflicting trades"})
	}
	if err := tx.Commit(); err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to confirm trade loop"})
	}

	userIDs := []int{}
	for _, p := range participants {
		userIDs = append(userIDs, p.userID)
		publishToUser(p.userID, sseEvent{Type: "trade_updated", Data: fiber.Map{
			"notification_type": "trade_loop",
			"loop_id":           loopID,
			"status":            "ongoing",
		}})
	}
	go h.rebuildTradeLoopCacheForUsers(userIDs)
	go h.notifyLikeLoopUsers(loopNumericID, "Trade confirmed and moved to Ongoing Trades. Complete settlement, then leave a review.", "trade_loop_ongoing")
	return c.JSON(models.APIResponse{
		Success: true,
		Message: "Trade confirmed and moved to ongoing",
		Data: fiber.Map{
			"loop_id": loopID,
			"status":  "ongoing",
		},
	})
}

// DeclineTradeLoop
func (h *TradeHandler) DeclineTradeLoop(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}

	loopID := c.Params("id")
	loopNumericID, ok := parseLikeLoopID(loopID)
	if !ok {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid loop ID"})
	}

	res, err := h.db.Exec(`
		UPDATE trade_like_loop_participants
		SET status = 'rejected'
		WHERE loop_id = ? AND user_id = ?
	`, loopNumericID, userID)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to decline trade loop"})
	}
	ra, _ := res.RowsAffected()
	if ra == 0 {
		return c.Status(403).JSON(models.APIResponse{Success: false, Error: "You are not a participant in this trade loop"})
	}

	_, _ = h.db.Exec("UPDATE trade_like_loops SET status = 'broken', updated_at = CURRENT_TIMESTAMP WHERE id = ?", loopNumericID)

	var declinerName string
	_ = h.db.QueryRow("SELECT name FROM users WHERE id = ?", userID).Scan(&declinerName)
	if declinerName == "" {
		declinerName = fmt.Sprintf("User #%d", userID)
	}
	msg := fmt.Sprintf("%s declined the trade match.", declinerName)
	_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) SELECT user_id, 'trade_loop', ?, FALSE FROM trade_like_loop_participants WHERE loop_id = ? AND user_id <> ?", msg, loopNumericID, userID)

	otherUserIDs := []int{}
	otherRows, err := h.db.Query("SELECT DISTINCT user_id FROM trade_like_loop_participants WHERE loop_id = ? AND user_id <> ?", loopNumericID, userID)
	if err == nil {
		for otherRows.Next() {
			var otherUID int
			if scanErr := otherRows.Scan(&otherUID); scanErr == nil {
				otherUserIDs = append(otherUserIDs, otherUID)
				publishNotification(otherUID, msg, "trade_loop")
				publishToUser(otherUID, sseEvent{Type: "trade_loop_broken", Data: fiber.Map{"loop_id": loopID, "reason": "rejected", "declined_by": userID}})
			}
		}
		otherRows.Close()
	}

	// Mirror the multiway decline hooks: rebuild loop suggestions and surface
	// alternatives so the jilted party isn't left with a dead card.
	allParticipants := append([]int{userID}, otherUserIDs...)
	go h.rebuildTradeLoopCacheForUsers(allParticipants)
	for _, otherUID := range otherUserIDs {
		go h.notifyAlternativeLoopsIfAny(otherUID, "")
	}

	return c.JSON(models.APIResponse{Success: true, Message: "Trade loop declined"})
}

// GetLoopQuota returns the current free-tier monthly loop hop usage.
// Free users have unlimited hops for their first 30 days; after that, 5 per month.
func (h *TradeHandler) GetLoopQuota(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}

	var isPremium bool
	var createdAt time.Time
	if err := h.db.QueryRow("SELECT is_premium, created_at FROM users WHERE id = ?", userID).Scan(&isPremium, &createdAt); err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to verify subscription tier"})
	}

	period := time.Now().Format("2006-01")
	if isPremium {
		return c.JSON(models.APIResponse{
			Success: true,
			Data: fiber.Map{
				"unlimited": true,
				"period":    period,
				"used":      0,
				"limit":     0,
			},
		})
	}

	// Check if user is within 30 days of signup (unlimited trial period)
	daysSinceSignup := int(time.Since(createdAt).Hours() / 24)
	if daysSinceSignup <= 30 {
		return c.JSON(models.APIResponse{
			Success: true,
			Data: fiber.Map{
				"unlimited": true,
				"trial":     true,
				"period":    period,
				"used":      0,
				"limit":     0,
			},
		})
	}

	limit := 5
	used := 0
	err := h.db.QueryRow("SELECT used FROM loop_quota_usage WHERE user_id = ? AND period = ?", userID, period).Scan(&used)
	if err != nil && err != sql.ErrNoRows {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to fetch loop quota"})
	}

	return c.JSON(models.APIResponse{
		Success: true,
		Data: fiber.Map{
			"unlimited": false,
			"period":    period,
			"used":      used,
			"limit":     limit,
		},
	})
}

// CancelTradeLoop stops a detected loop from executing further.
func (h *TradeHandler) CancelTradeLoop(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}

	loopID := c.Params("id") // format: chain_tradeID_buyerID_sellerID_user3ID

	// Get multiway_trades record and participants
	var user2ID, user3ID sql.NullInt64
	var canceller string
	if err := h.db.QueryRow(`
		SELECT user2_id, COALESCE(user3_id, 0)
		FROM multiway_trades
		WHERE chain_id = ?
	`, loopID).Scan(&user2ID, &user3ID); err != nil {
		return c.Status(404).JSON(models.APIResponse{Success: false, Error: "Loop not found"})
	}

	// Get canceller name for notification
	_ = h.db.QueryRow("SELECT name FROM users WHERE id = ?", userID).Scan(&canceller)
	if canceller == "" {
		canceller = "The loop initiator"
	}

	// Update multiway_trades with cancellation info
	_, err := h.db.Exec(`
		UPDATE multiway_trades
		SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP, cancelled_by = ?
		WHERE chain_id = ?
	`, userID, loopID)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to cancel loop"})
	}

	// Notify participants
	cancelMsg := fmt.Sprintf("%s cancelled the loop", canceller)
	participantIDs := []int{}
	if user2ID.Valid {
		participantIDs = append(participantIDs, int(user2ID.Int64))
		h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_loop', ?, FALSE)", user2ID.Int64, cancelMsg)
		publishNotification(int(user2ID.Int64), cancelMsg)
	}
	if user3ID.Valid && user3ID.Int64 > 0 {
		participantIDs = append(participantIDs, int(user3ID.Int64))
		h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_loop', ?, FALSE)", user3ID.Int64, cancelMsg)
		publishNotification(int(user3ID.Int64), cancelMsg)
	}

	// Add to cancellations table for tracking
	_, _ = h.db.Exec(`
		INSERT INTO trade_loop_cancellations (loop_id, cancelled_by)
		VALUES (?, ?)
		ON DUPLICATE KEY UPDATE cancelled_by = VALUES(cancelled_by)
	`, loopID, userID)

	// Rebuild cache for all participants
	go h.rebuildTradeLoopCacheForUsers(participantIDs)

	return c.JSON(models.APIResponse{Success: true, Message: "Loop cancelled and participants notified"})
}

// ReinviteTradeLoop re-enables a cancelled detected loop by clearing agreements and the cancellation record.
func (h *TradeHandler) ReinviteTradeLoop(c *fiber.Ctx) error {
	_, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}

	loopID := c.Params("id")

	_, err := h.db.Exec("DELETE FROM trade_loop_cancellations WHERE loop_id = ?", loopID)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to reinvite loop"})
	}
	_, err = h.db.Exec("DELETE FROM trade_loop_agreements WHERE loop_id = ?", loopID)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to reset loop agreements"})
	}

	// Best-effort cache rebuild for participants.
	parts := strings.Split(loopID, "_")
	if len(parts) >= 3 && parts[0] == "loop" {
		participantIDs := map[int]bool{}
		for i := 1; i < len(parts); i++ {
			tid, _ := strconv.Atoi(parts[i])
			var bID, sID int
			if err := h.db.QueryRow("SELECT buyer_id, seller_id FROM trades WHERE id = ?", tid).Scan(&bID, &sID); err == nil {
				participantIDs[bID] = true
				participantIDs[sID] = true
			}
		}
		go h.rebuildTradeLoopCacheForUsers(mapKeysToSlice(participantIDs))
	}

	return c.JSON(models.APIResponse{Success: true, Message: "Loop reinvited"})
}

// CleanupExpiredPendingInitiatorUpgrades removes pending_initiator_upgrade records that have expired (7 days old)
// and notifies initiators to upgrade or their matches will be lost.
func (h *TradeHandler) CleanupExpiredPendingInitiatorUpgrades() {
	rows, err := h.db.Query(`
		SELECT id, chain_id, initiator_user_id
		FROM multiway_trades
		WHERE status = 'pending_initiator_upgrade'
		AND expires_at IS NOT NULL
		AND expires_at <= NOW()
	`)
	if err != nil {
		log.Printf("CleanupExpiredPendingInitiatorUpgrades: query failed: %v", err)
		return
	}
	defer rows.Close()

	for rows.Next() {
		var loopID string
		var initiatorID int
		var recordID int
		if err := rows.Scan(&recordID, &loopID, &initiatorID); err != nil {
			continue
		}

		// Update status to expired
		_, err := h.db.Exec(`
			UPDATE multiway_trades
			SET status = 'cancelled'
			WHERE id = ?
		`, recordID)
		if err != nil {
			continue
		}

		// Notify initiator
		msg := "Your loop match expired. Upgrade to Pro to get matched again with similar traders."
		_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_loop', ?, FALSE)", initiatorID, msg)
		publishNotification(initiatorID, msg)
		log.Printf("CleanupExpiredPendingInitiatorUpgrades: expired and notified loop %s (initiator %d)", loopID, initiatorID)
	}
}

// ExecuteTradeLoop handles multiway trade completion by submitting a review and checking if all participants are done.
func (h *TradeHandler) ExecuteTradeLoop(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}

	loopID := c.Params("id")
	loopNumericID, ok := parseLikeLoopID(loopID)
	if !ok {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid loop ID"})
	}

	// Parse review payload
	var payload models.TradeReviewCreate
	if err := c.BodyParser(&payload); err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid request body"})
	}

	// Validate rating
	if payload.Rating < 1 || payload.Rating > 5 {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Rating must be between 1 and 5"})
	}

	// Enforce proof URL (mandatory for meetup completion)
	if payload.ProofURL == "" {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Photo evidence is mandatory for multiway trade completion"})
	}

	// Verify loop existence and status
	var status string
	if err := h.db.QueryRow("SELECT status FROM trade_like_loops WHERE id = ?", loopNumericID).Scan(&status); err != nil {
		return c.Status(404).JSON(models.APIResponse{Success: false, Error: "Trade loop not found"})
	}
	if status != "confirmed" && status != "ongoing" && status != "completed" {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Trade loop is not in a completable state"})
	}

	// Verify user is a participant
	var participantID int
	if err := h.db.QueryRow("SELECT id FROM trade_like_loop_participants WHERE loop_id = ? AND user_id = ?", loopNumericID, userID).Scan(&participantID); err != nil {
		return c.Status(403).JSON(models.APIResponse{Success: false, Error: "You are not a participant in this trade loop"})
	}

	// Update participant with review info
	_, err := h.db.Exec(`
		UPDATE trade_like_loop_participants 
		SET rating = ?, feedback = ?, proof_url = ?, is_reviewed = TRUE, reviewed_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, payload.Rating, payload.Feedback, payload.ProofURL, participantID)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to submit review"})
	}

	// Notify other participants
	var userName string
	_ = h.db.QueryRow("SELECT name FROM users WHERE id = ?", userID).Scan(&userName)
	if userName == "" {
		userName = "A participant"
	}
	notificationMsg := fmt.Sprintf("%s has submitted a review and completed their part of the multiway trade!", userName)

	rows, err := h.db.Query("SELECT user_id FROM trade_like_loop_participants WHERE loop_id = ? AND user_id != ?", loopNumericID, userID)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var pID int
			if scanErr := rows.Scan(&pID); scanErr == nil {
				h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_loop', ?, FALSE)", pID, notificationMsg)
				publishNotification(pID, notificationMsg)
				// Send SSE event for real-time UI updates
				publishToUser(pID, sseEvent{
					Type: "trade_review_submitted",
					Data: fiber.Map{
						"loop_id":     loopID,
						"reviewer_id": userID,
						"message":     notificationMsg,
					},
				})
			}
		}
	}

	// Check if all participants have reviewed
	var totalParticipants, reviewedParticipants int
	_ = h.db.QueryRow("SELECT COUNT(*) FROM trade_like_loop_participants WHERE loop_id = ?", loopNumericID).Scan(&totalParticipants)
	_ = h.db.QueryRow("SELECT COUNT(*) FROM trade_like_loop_participants WHERE loop_id = ? AND is_reviewed = TRUE", loopNumericID).Scan(&reviewedParticipants)

	if totalParticipants > 0 && totalParticipants == reviewedParticipants {
		// Mark loop as completed
		_, _ = h.db.Exec("UPDATE trade_like_loops SET status = 'completed', updated_at = CURRENT_TIMESTAMP WHERE id = ?", loopNumericID)
		_, _ = h.db.Exec(`
			UPDATE products p
			JOIN (
				SELECT offered_product_id AS product_id FROM trade_like_loop_participants WHERE loop_id = ?
				UNION
				SELECT wanted_product_id AS product_id FROM trade_like_loop_participants WHERE loop_id = ?
			) used_products ON used_products.product_id = p.id
			SET p.status = 'traded', p.updated_at = CURRENT_TIMESTAMP
			WHERE p.status IN ('available', 'locked')
		`, loopNumericID, loopNumericID)

		completionMsg := "The multiway trade is now fully completed! All participants have submitted their reviews."
		allRows, _ := h.db.Query("SELECT user_id FROM trade_like_loop_participants WHERE loop_id = ?", loopNumericID)
		if allRows != nil {
			defer allRows.Close()
			for allRows.Next() {
				var pID int
				if scanErr := allRows.Scan(&pID); scanErr == nil {
					h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_loop', ?, FALSE)", pID, completionMsg)
					publishNotification(pID, completionMsg, "trade_loop")
					publishToUser(pID, sseEvent{
						Type: "trade_completed",
						Data: fiber.Map{
							"loop_id": loopID,
							"message": completionMsg,
						},
					})
				}
			}
		}
	}

	return c.JSON(models.APIResponse{
		Success: true,
		Message: "Review submitted successfully",
		Data: fiber.Map{
			"is_fully_completed": totalParticipants == reviewedParticipants,
		},
	})
}

// GetOrCreateLoopReviewTrade resolves a trade for a confirmed 2-way like loop.
// If no trade exists yet, it creates one so users can leave reviews.
func (h *TradeHandler) GetOrCreateLoopReviewTrade(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}

	loopID := c.Params("id")
	loopNumericID, ok := parseLikeLoopID(loopID)
	if !ok {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid loop ID"})
	}

	var loopStatus string
	if err := h.db.QueryRow("SELECT status FROM trade_like_loops WHERE id = ?", loopNumericID).Scan(&loopStatus); err != nil {
		return c.Status(404).JSON(models.APIResponse{Success: false, Error: "Trade loop not found"})
	}
	if loopStatus != "confirmed" && loopStatus != "ongoing" && loopStatus != "completed" {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Trade loop is not confirmed yet"})
	}

	rows, err := h.db.Query(`
		SELECT user_id, offered_product_id, wanted_product_id, position_in_loop
		FROM trade_like_loop_participants
		WHERE loop_id = ?
		ORDER BY position_in_loop ASC
	`, loopNumericID)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to load loop participants"})
	}
	defer rows.Close()

	type loopParticipant struct {
		userID         int
		offeredProduct int
		wantedProduct  int
		position       int
	}
	participants := []loopParticipant{}
	for rows.Next() {
		var p loopParticipant
		if scanErr := rows.Scan(&p.userID, &p.offeredProduct, &p.wantedProduct, &p.position); scanErr == nil {
			participants = append(participants, p)
		}
	}

	if len(participants) != 2 {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Review trade is only available for 2-way loops"})
	}

	isParticipant := participants[0].userID == userID || participants[1].userID == userID
	if !isParticipant {
		return c.Status(403).JSON(models.APIResponse{Success: false, Error: "You are not a participant in this trade loop"})
	}

	buyer := participants[0]
	seller := participants[1]
	targetProductID := buyer.wantedProduct
	offeredProductID := buyer.offeredProduct

	if targetProductID == 0 || offeredProductID == 0 {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Loop products are incomplete"})
	}

	var existingTradeID int
	if err := h.db.QueryRow(`
		SELECT id FROM trades
		WHERE buyer_id = ? AND seller_id = ? AND target_product_id = ?
		ORDER BY id DESC
		LIMIT 1
	`, buyer.userID, seller.userID, targetProductID).Scan(&existingTradeID); err == nil && existingTradeID > 0 {
		return c.JSON(models.APIResponse{Success: true, Data: fiber.Map{"trade_id": existingTradeID}})
	}

	tx, err := h.db.Begin()
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to start transaction"})
	}
	defer tx.Rollback()

	res, err := tx.Exec(`
		INSERT INTO trades (buyer_id, seller_id, target_product_id, status, message, offered_cash_amount)
		VALUES (?, ?, ?, 'active', ?, NULL)
	`, buyer.userID, seller.userID, targetProductID, "Trade loop review")
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to create review trade"})
	}

	tradeID, err := res.LastInsertId()
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to finalize review trade"})
	}

	if _, err := tx.Exec("INSERT INTO trade_items (trade_id, product_id, offered_by) VALUES (?, ?, 'buyer')", tradeID, offeredProductID); err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to attach trade items"})
	}

	if err := tx.Commit(); err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to save review trade"})
	}

	return c.JSON(models.APIResponse{Success: true, Data: fiber.Map{"trade_id": tradeID}})
}

// GetTradeLoopNotifications returns notifications specifically related to trade loops
func (h *TradeHandler) GetTradeLoopNotifications(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}

	rows, err := h.db.Query(`
		SELECT id, message, created_at, is_read 
		FROM notifications 
		WHERE user_id = ? AND type = 'trade_loop' AND is_read = FALSE
		ORDER BY created_at DESC
	`, userID)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to fetch notifications"})
	}
	defer rows.Close()

	var notifs []map[string]interface{}
	for rows.Next() {
		var id int
		var message, createdAt string
		var read bool
		if err := rows.Scan(&id, &message, &createdAt, &read); err == nil {
			notifs = append(notifs, map[string]interface{}{
				"id":                strconv.Itoa(id),
				"type":              "trade_loop",
				"message":           message,
				"participant_count": 0,     // We can compute this if worth it, but 0 is safe
				"loop_id":           "all", // Directs user to the loops list
				"created_at":        createdAt,
				"read":              read,
			})
		}
	}

	if notifs == nil {
		notifs = []map[string]interface{}{}
	}

	return c.JSON(models.APIResponse{Success: true, Data: notifs})
}

// MarkLoopNotificationRead marks a trade loop notification as read
func (h *TradeHandler) MarkLoopNotificationRead(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}

	notifID := c.Params("id")
	_, err := h.db.Exec("UPDATE notifications SET is_read = TRUE WHERE id = ? AND user_id = ?", notifID, userID)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to update notification"})
	}

	return c.JSON(models.APIResponse{Success: true})
}

// ClearLoopNotifications marks all loop notifications as read/cleared
func (h *TradeHandler) ClearLoopNotifications(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}

	_, err := h.db.Exec("UPDATE notifications SET is_read = TRUE WHERE user_id = ? AND type = 'trade_loop'", userID)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to clear notifications"})
	}

	return c.JSON(models.APIResponse{Success: true})
}

// DebugMultiwayMatch explains why a trade did or did not qualify for a multi-way suggestion.
// Admin-only route used by the dashboard debug panel.
func (h *TradeHandler) DebugMultiwayMatch(c *fiber.Ctx) error {
	tradeID, err := strconv.Atoi(c.Query("trade_id", "0"))
	if err != nil || tradeID <= 0 {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "trade_id is required and must be a positive integer"})
	}

	compareTradeID := 0
	compareRaw := strings.TrimSpace(c.Query("compare_trade_id", ""))
	if compareRaw != "" {
		compareTradeID, err = strconv.Atoi(compareRaw)
		if err != nil || compareTradeID <= 0 {
			return c.Status(400).JSON(models.APIResponse{Success: false, Error: "compare_trade_id must be a positive integer when provided"})
		}
	}

	overrideInitiatorUserID := 0
	initiatorRaw := strings.TrimSpace(c.Query("initiator_user_id", ""))
	if initiatorRaw != "" {
		overrideInitiatorUserID, err = strconv.Atoi(initiatorRaw)
		if err != nil || overrideInitiatorUserID <= 0 {
			return c.Status(400).JSON(models.APIResponse{Success: false, Error: "initiator_user_id must be a positive integer when provided"})
		}
	}

	analyze := func(id int) (fiber.Map, error) {
		var buyerID, sellerID int
		var status string
		err := h.db.QueryRow("SELECT buyer_id, seller_id, status FROM trades WHERE id = ?", id).Scan(&buyerID, &sellerID, &status)
		if err != nil {
			if err == sql.ErrNoRows {
				return nil, fmt.Errorf("trade %d not found", id)
			}
			return nil, fmt.Errorf("failed to load trade %d", id)
		}

		initiatorUserID := sellerID
		if overrideInitiatorUserID > 0 {
			initiatorUserID = overrideInitiatorUserID
		}

		matches, debugInfo, err := services.FindMultiwayMatchDetailed(h.db, buyerID, sellerID, id, []int{})
		if err != nil {
			return nil, fmt.Errorf("matcher failed for trade %d", id)
		}

		recommendedLoopStatus := "no_match"
		if len(matches) > 0 {
			recommendedLoopStatus = "pending_user3"
		}

		result := fiber.Map{
			"trade_id":                id,
			"trade_status":            status,
			"buyer_id":                buyerID,
			"seller_id":               sellerID,
			"initiator_user_id":       initiatorUserID,
			"recommended_loop_status": recommendedLoopStatus,
			"match_count":             len(matches),
			"top_match":               nil,
			"debug":                   debugInfo,
		}

		if len(matches) > 0 {
			result["top_match"] = matches[0]
		}

		return result, nil
	}

	primary, err := analyze(tradeID)
	if err != nil {
		return c.Status(404).JSON(models.APIResponse{Success: false, Error: err.Error()})
	}

	data := fiber.Map{"primary": primary}
	if compareTradeID > 0 {
		comparison, cmpErr := analyze(compareTradeID)
		if cmpErr != nil {
			data["comparison_error"] = cmpErr.Error()
		} else {
			data["comparison"] = comparison
		}
	}

	return c.JSON(models.APIResponse{Success: true, Data: data})
}

// GetMultiwayOpportunities returns multi-way chains where the user is User 3
func (h *TradeHandler) GetMultiwayOpportunities(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}

	rows, err := h.db.Query(`
		SELECT mw.chain_id, mw.original_trade_id, mw.user1_id, mw.user2_id, mw.status,
		       u1.name as user1_name, u2.name as user2_name,
		       t.target_product_id as user2_wanted_product_id,
		       p2.title as user2_wanted_title
		FROM multiway_trades mw
		JOIN users u1 ON u1.id = mw.user1_id
		JOIN users u2 ON u2.id = mw.user2_id
		JOIN trades t ON t.id = mw.original_trade_id
		JOIN products p2 ON p2.id = t.target_product_id
		WHERE mw.user3_id = ? AND mw.status = 'pending_user3'
	`, userID)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to fetch opportunities"})
	}
	defer rows.Close()

	var opportunities []fiber.Map
	for rows.Next() {
		var o fiber.Map = make(fiber.Map)
		var chainID, status, u1Name, u2Name, pTitle string
		var tID, u1ID, u2ID, pID int
		if err := rows.Scan(&chainID, &tID, &u1ID, &u2ID, &status, &u1Name, &u2Name, &pID, &pTitle); err == nil {
			o["chain_id"] = chainID
			o["original_trade_id"] = tID
			o["user1_id"] = u1ID
			o["user1_name"] = u1Name
			o["user2_id"] = u2ID
			o["user2_name"] = u2Name
			o["user2_wanted_product_id"] = pID
			o["user2_wanted_title"] = pTitle
			o["status"] = status
			opportunities = append(opportunities, o)
		}
	}

	return c.JSON(models.APIResponse{Success: true, Data: opportunities})
}

// GetDiscoverableMultiwayLoops returns pending_user3 chains that match the current user's products.
// Any user can discover open loops they can volunteer to join.
func (h *TradeHandler) GetDiscoverableMultiwayLoops(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}

	// Get all pending_user3 chains where the current user is not already a participant
	// Also exclude original_trade_ids where the user already has a hop-in record (parallel chain)
	rows, err := h.db.Query(`
		SELECT m.chain_id, m.original_trade_id, m.user1_id, m.user2_id,
		       u1.name AS user1_name, u2.name AS user2_name,
		       p_target.title AS user2_wants_title,
		       p_offer.title AS user1_offer_title,
		       DATE_FORMAT(DATE_ADD(m.created_at, INTERVAL 48 HOUR), '%Y-%m-%d %H:%i:%s') AS expires_at
		FROM multiway_trades m
		JOIN trades t ON t.id = m.original_trade_id
		JOIN users u1 ON u1.id = m.user1_id
		JOIN users u2 ON u2.id = m.user2_id
		JOIN products p_target ON p_target.id = t.target_product_id
		JOIN trade_items ti ON ti.trade_id = t.id AND ti.offered_by = 'buyer'
		JOIN products p_offer ON p_offer.id = ti.product_id
		WHERE m.status = 'pending_user3'
		  AND t.status IN ('pending', 'pending_multiway', 'accepted')
		  AND p_target.status = 'available'
		  AND p_offer.status = 'available'
		  AND u1.role != 'admin'
		  AND u2.role != 'admin'
		  AND m.user1_id != ?
		  AND m.user2_id != ?
		  AND (m.user3_id IS NULL OR m.user3_id != ?)
		  AND m.original_trade_id NOT IN (
		      SELECT original_trade_id FROM multiway_trades
		      WHERE user3_id = ? AND status IN ('pending_user3', 'accepted', 'completed')
		  )
	`, userID, userID, userID, userID)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to load discoverable loops"})
	}
	defer rows.Close()

	type openChain struct {
		chainID        string
		origTradeID    int
		u1ID, u2ID     int
		u1Name, u2Name string
		u2WantsTitle   string
		u1OfferTitle   string
		expiresAt      string
	}
	var chains []openChain
	for rows.Next() {
		var oc openChain
		if err := rows.Scan(&oc.chainID, &oc.origTradeID, &oc.u1ID, &oc.u2ID,
			&oc.u1Name, &oc.u2Name, &oc.u2WantsTitle, &oc.u1OfferTitle, &oc.expiresAt); err == nil {
			chains = append(chains, oc)
		}
	}

	var results []fiber.Map
	for _, chain := range chains {
		matches, _, err := services.FindMultiwayMatchDetailed(h.db, chain.u1ID, chain.u2ID, chain.origTradeID, []int{})
		if err != nil {
			continue
		}
		for _, m := range matches {
			if m.User3ID == userID {
				results = append(results, fiber.Map{
					"chain_id":          chain.chainID,
					"original_trade_id": chain.origTradeID,
					"loop_type":         "discoverable",
					"is_chain":          true,
					"user1_name":        chain.u1Name,
					"user2_name":        chain.u2Name,
					"you_give_title":    m.User3ProductTitle,
					"you_give_id":       m.User3ProductID,
					"you_get_title":     m.User1ProductTitle,
					"chain_label":       chain.u1Name + " Ã¢â€ â€™ " + chain.u2Name + " Ã¢â€ â€™ You",
					"match_score":       m.MatchScore,
					"expires_at":        chain.expiresAt,
					"can_join":          true,
					"participants": []fiber.Map{
						{"user_name": chain.u1Name, "product_title": chain.u1OfferTitle, "status": "pending"},
						{"user_name": chain.u2Name, "product_title": chain.u2WantsTitle, "status": "pending"},
						{"user_name": "You", "product_title": m.User3ProductTitle, "status": "pending"},
					},
				})
				break
			}
		}
	}

	if results == nil {
		results = []fiber.Map{}
	}
	return c.JSON(models.APIResponse{Success: true, Data: results})
}

// HopIntoMultiwayChain allows a user whose product matches a pending_user3 chain to volunteer to join.
// Creates a parallel chain record so user1/user2 can choose to accept the volunteer as their user3.
func (h *TradeHandler) HopIntoMultiwayChain(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}

	chainID := c.Params("id")

	var payload struct {
		ProductID int `json:"product_id"`
	}
	if err := c.BodyParser(&payload); err != nil || payload.ProductID == 0 {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "product_id is required"})
	}

	// Get chain details
	var u1ID, u2ID, origTradeID, existingU3ID int
	var mStatus string
	err := h.db.QueryRow(`
		SELECT user1_id, user2_id, original_trade_id, user3_id, status
		FROM multiway_trades WHERE chain_id = ?
	`, chainID).Scan(&u1ID, &u2ID, &origTradeID, &existingU3ID, &mStatus)
	if err != nil {
		return c.Status(404).JSON(models.APIResponse{Success: false, Error: "Chain not found"})
	}
	if mStatus != "pending_user3" {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "This chain is no longer open to join"})
	}
	if u1ID == userID || u2ID == userID || existingU3ID == userID {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "You are already part of this chain"})
	}

	// Verify the product belongs to this user and is available
	var productTitle string
	var productOwnerID int
	err = h.db.QueryRow(`
		SELECT seller_id, title FROM products WHERE id = ? AND status = 'available'
	`, payload.ProductID).Scan(&productOwnerID, &productTitle)
	if err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Product not found or not available"})
	}
	if productOwnerID != userID {
		return c.Status(403).JSON(models.APIResponse{Success: false, Error: "Product does not belong to you"})
	}

	// Validate match score >= 30 using the same matching algorithm
	matches, _, err := services.FindMultiwayMatchDetailed(h.db, u1ID, u2ID, origTradeID, []int{})
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to validate match"})
	}
	validMatch := false
	for _, m := range matches {
		if m.User3ID == userID && m.User3ProductID == payload.ProductID {
			validMatch = true
			break
		}
	}
	if !validMatch {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Your product does not meet the requirements for this trade loop"})
	}

	// Prevent duplicate hop-in requests for the same original trade
	var existingHopIn int
	_ = h.db.QueryRow(`
		SELECT COUNT(*) FROM multiway_trades
		WHERE original_trade_id = ? AND user3_id = ? AND status = 'pending_user3'
	`, origTradeID, userID).Scan(&existingHopIn)
	if existingHopIn > 0 {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "You already have a pending request to join this trade loop"})
	}

	// Create a new chain record for this volunteer (parallel to the existing chain)
	// user3_trade_id mirrors user3_product_id to match the pattern AcceptMultiwayChain reads
	newChainID := fmt.Sprintf("chain_%d_%d_%d_%d", origTradeID, u1ID, u2ID, userID)
	expiresAt := time.Now().Add(48 * time.Hour)
	_, err = h.db.Exec(`
		INSERT INTO multiway_trades
		  (chain_id, original_trade_id, initiator_user_id, user1_id, user2_id, user3_id, user3_trade_id, user3_product_id, status, expires_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending_user3', ?)
		ON DUPLICATE KEY UPDATE status='pending_user3', user3_product_id=?, user3_trade_id=?, updated_at=NOW()
	`, newChainID, origTradeID, u2ID, u1ID, u2ID, userID, payload.ProductID, payload.ProductID, expiresAt,
		payload.ProductID, payload.ProductID)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to register hop-in"})
	}

	// Lock user's product to prevent it from being traded elsewhere while pending
	_, _ = h.db.Exec("UPDATE products SET status='locked' WHERE id=? AND status='available'", payload.ProductID)

	// Get user's name for notifications
	var userName string
	_ = h.db.QueryRow("SELECT name FROM users WHERE id = ?", userID).Scan(&userName)

	// Notify user1 and user2 that someone volunteered to join
	msg := fmt.Sprintf("%s wants to join your multiway trade loop with: %s", userName, productTitle)
	_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_loop', ?, FALSE)", u1ID, msg)
	_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_loop', ?, FALSE)", u2ID, msg)
	publishNotification(u1ID, msg)
	publishNotification(u2ID, msg)
	go h.rebuildTradeLoopCacheForUsers([]int{u1ID, u2ID, userID})

	return c.JSON(models.APIResponse{
		Success: true,
		Message: "You've requested to join this trade loop! The participants will be notified.",
	})
}

// AcceptMultiwayChain is when User 3 accepts the opportunity
func (h *TradeHandler) AcceptMultiwayChain(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}
	chainID := c.Params("id")

	// Start transaction to keep acceptance and product locking consistent.
	tx, err := h.db.Begin()
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to start transaction"})
	}
	defer tx.Rollback()

	// Verify user is User 3 for this chain (lock the row).
	var user1ID, user2ID, originalTradeID int
	var user3ProductID sql.NullInt64
	err = tx.QueryRow(`
		SELECT user1_id, user2_id, original_trade_id, user3_trade_id
		FROM multiway_trades
		WHERE chain_id = ? AND user3_id = ? AND status = 'pending_user3'
		FOR UPDATE
	`, chainID, userID).Scan(&user1ID, &user2ID, &originalTradeID, &user3ProductID)
	if err != nil {
		return c.Status(404).JSON(models.APIResponse{Success: false, Error: "Opportunity not found or already processed"})
	}

	// Verify original trade is in a state that can proceed with multiway.
	// pending/accepted = auto-detected loop (never manually converted)
	// pending_multiway = manually converted by user
	var originalTradeStatus string
	err = tx.QueryRow("SELECT status FROM trades WHERE id = ?", originalTradeID).Scan(&originalTradeStatus)
	validForMultiway := originalTradeStatus == "pending_multiway" || originalTradeStatus == "pending" || originalTradeStatus == "accepted"
	if err != nil || !validForMultiway {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "The original trade is no longer available for multi-way loop."})
	}

	// Fetch product IDs from the original trade for leg creation.
	var u1ProductID, u2ProductID int
	_ = tx.QueryRow(`
		SELECT ti.product_id, t.target_product_id
		FROM trades t
		JOIN trade_items ti ON ti.trade_id = t.id
		WHERE t.id = ?
		LIMIT 1
	`, originalTradeID).Scan(&u1ProductID, &u2ProductID)

	// Verify all involved products are still available (prevents double-booking
	// if a product was traded in a 2-way deal during the pending window).
	u3PID := 0
	if user3ProductID.Valid {
		u3PID = int(user3ProductID.Int64)
	}
	for _, pid := range []int{u1ProductID, u2ProductID, u3PID} {
		if pid <= 0 {
			continue
		}
		var prodStatus string
		if err := tx.QueryRow("SELECT status FROM products WHERE id = ? FOR UPDATE", pid).Scan(&prodStatus); err != nil {
			return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to verify product availability"})
		}
		if prodStatus != "available" {
			return c.Status(409).JSON(models.APIResponse{
				Success: false,
				Error:   "One or more items in this chain are no longer available. The chain cannot proceed.",
			})
		}
	}

	// All 3 participants have now agreed (User1+User2 via the original trade, User3 here).
	// Transition to 'active' so it appears in ongoing trades for everyone.
	_, err = tx.Exec("UPDATE multiway_trades SET status = 'active', ongoing_deadline = DATE_ADD(NOW(), INTERVAL 7 DAY) WHERE chain_id = ?", chainID)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to accept multi-way chain"})
	}

	// Update original trade status to multiway_active
	_, _ = tx.Exec("UPDATE trades SET status = 'multiway_active' WHERE id = (SELECT original_trade_id FROM multiway_trades WHERE chain_id = ?)", chainID)

	for _, pid := range []int{u1ProductID, u2ProductID, u3PID} {
		if pid > 0 {
			_, _ = tx.Exec("UPDATE products SET status='locked' WHERE id=? AND status IN ('available','locked')", pid)
		}
	}
	if err = h.cancelConflictingLifecycleTx(tx, originalTradeID, 0, chainID, []int{u1ProductID, u2ProductID, u3PID}, userID); err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to resolve conflicting trades"})
	}

	// Create per-leg records for the 3 handoffs (Phase 2: per-leg tracking).
	// Leg 0: User1 Ã¢â€ â€™ User2 (User1 gives their product to User2)
	// Leg 1: User2 Ã¢â€ â€™ User3 (User2 gives their product to User3)
	// Leg 2: User3 Ã¢â€ â€™ User1 (User3 gives their product to User1)
	legs := []struct {
		idx     int
		from    int
		to      int
		product int
	}{
		{0, user1ID, user2ID, u1ProductID},
		{1, user2ID, userID, u2ProductID},
		{2, userID, user1ID, u3PID},
	}
	for _, leg := range legs {
		if leg.product > 0 {
			_, _ = tx.Exec(`
				INSERT INTO multiway_trade_legs (chain_id, leg_index, from_user_id, to_user_id, product_id, status)
				VALUES (?, ?, ?, ?, ?, 'pending')
				ON DUPLICATE KEY UPDATE updated_at = NOW()
			`, chainID, leg.idx, leg.from, leg.to, leg.product)
		}
	}

	// Commit DB changes before side effects (notifications/cache rebuild).
	if err := tx.Commit(); err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to commit transaction"})
	}

	// Cancel any other parallel pending chains for the same original trade (e.g. hop-in volunteers)
	// and unlock their products so they don't remain stuck as locked.
	otherRows, qErr := h.db.Query(`
		SELECT chain_id, user3_product_id FROM multiway_trades
		WHERE original_trade_id = ? AND chain_id != ? AND status = 'pending_user3'
	`, originalTradeID, chainID)
	if qErr == nil {
		defer otherRows.Close()
		for otherRows.Next() {
			var otherChainID string
			var otherPID sql.NullInt64
			if scanErr := otherRows.Scan(&otherChainID, &otherPID); scanErr == nil {
				_, _ = h.db.Exec("UPDATE multiway_trades SET status='cancelled' WHERE chain_id=?", otherChainID)
				if otherPID.Valid && otherPID.Int64 > 0 {
					_, _ = h.db.Exec("UPDATE products SET status='available' WHERE id=? AND status='locked'", otherPID.Int64)
				}
			}
		}
	}

	// Notify User 1 and User 2
	msg := "Good news! A third participant has accepted the multiway trade. Proceed to dashboard to finalize."
	_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", user1ID, msg)
	_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", user2ID, msg)
	publishNotification(user1ID, msg)
	publishNotification(user2ID, msg)
	go h.rebuildTradeLoopCacheForUsers([]int{user1ID, user2ID, userID})
	// Cancel all other pending loops/chains involving the same products.
	go h.cancelOtherLoopsForProducts([]int{u1ProductID, u2ProductID, u3PID}, chainID)

	return c.JSON(models.APIResponse{Success: true, Message: "You have accepted the multi-way trade opportunity!"})
}

// cancelOtherLoopsForProducts cancels all other pending multiway chains and like-loops
// that involve any of the given product IDs. Called when a loop is confirmed/completed
// to prevent the same product from being committed to multiple loops.
func (h *TradeHandler) cancelOtherLoopsForProducts(productIDs []int, excludeChainID string) {
	validPIDs := []int{}
	for _, pid := range productIDs {
		if pid > 0 {
			validPIDs = append(validPIDs, pid)
		}
	}
	if len(validPIDs) == 0 {
		return
	}

	placeholders := make([]string, len(validPIDs))
	args := make([]interface{}, len(validPIDs))
	for i, pid := range validPIDs {
		placeholders[i] = "?"
		args[i] = pid
	}
	pidList := strings.Join(placeholders, ",")

	// 1. Cancel pending multiway_trades involving these products (except the one that just completed).
	cancelQuery := fmt.Sprintf(`
		UPDATE multiway_trades
		SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW()
		WHERE status IN ('pending_user3', 'pending_initiator_upgrade', 'searching', 'waiting_acceptance', 'user3_accepted')
		AND chain_id != ?
		AND (
			user3_product_id IN (%s)
			OR user1_product_id IN (%s)
			OR user2_product_id IN (%s)
			OR original_trade_id IN (
				SELECT t.id FROM trades t
				JOIN trade_items ti ON ti.trade_id = t.id
				WHERE ti.product_id IN (%s)
				UNION
				SELECT t2.id FROM trades t2
				WHERE t2.target_product_id IN (%s)
			)
		)
	`, pidList, pidList, pidList, pidList, pidList)

	cancelArgs := []interface{}{excludeChainID}
	for i := 0; i < 5; i++ {
		cancelArgs = append(cancelArgs, args...)
	}
	result, err := h.db.Exec(cancelQuery, cancelArgs...)
	if err != nil {
		log.Printf("[cancelOtherLoopsForProducts] multiway_trades cancel error: %v", err)
	} else {
		affected, _ := result.RowsAffected()
		if affected > 0 {
			log.Printf("[cancelOtherLoopsForProducts] Cancelled %d pending multiway chains for products %v", affected, validPIDs)
		}
	}

	// 2. Cancel pending trade_like_loops that involve these products.
	likeLoopQuery := fmt.Sprintf(`
		UPDATE trade_like_loops l
		JOIN trade_like_loop_participants p ON p.loop_id = l.id
		SET l.status = 'cancelled_due_to_conflict', l.updated_at = CURRENT_TIMESTAMP
		WHERE l.status IN ('pending','partially_accepted','accepted','confirmed')
		AND (p.offered_product_id IN (%s) OR p.wanted_product_id IN (%s))
	`, pidList, pidList)
	result2, err2 := h.db.Exec(likeLoopQuery, append(args, args...)...)
	if err2 != nil {
		log.Printf("[cancelOtherLoopsForProducts] like_loops cancel error: %v", err2)
	} else {
		affected2, _ := result2.RowsAffected()
		if affected2 > 0 {
			log.Printf("[cancelOtherLoopsForProducts] Cancelled %d pending like-loops for products %v", affected2, validPIDs)
		}
	}

	// 3. Cancel pending regular trades involving these products.
	tradeNotifyQuery := fmt.Sprintf(`
		SELECT DISTINCT t.id, t.buyer_id, t.seller_id, COALESCE(p.title, 'Deleted product')
		FROM trades t
		LEFT JOIN trade_items ti ON t.id = ti.trade_id
		LEFT JOIN products p ON p.id = t.target_product_id
		WHERE t.status IN ('pending', 'countered', 'pending_multiway')
		AND (t.target_product_id IN (%s) OR ti.product_id IN (%s))
	`, pidList, pidList)

	tradeNotifyArgs := append(args, args...)
	rows, err := h.db.Query(tradeNotifyQuery, tradeNotifyArgs...)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var tid, bid, sid int
			var title string
			if rows.Scan(&tid, &bid, &sid, &title) == nil {
				_, _ = h.db.Exec("UPDATE trades SET status = 'cancelled_due_to_conflict', cancellation_reason = 'Product committed elsewhere', cancelled_at = NOW(), updated_at = CURRENT_TIMESTAMP WHERE id = ?", tid)
				// Unlock products if they are available
				_, _ = h.db.Exec("UPDATE products SET status = 'available' WHERE id IN (SELECT product_id FROM trade_items WHERE trade_id = ?) AND status = 'locked'", tid)

				// Notify
				msg := fmt.Sprintf("Trade offer involving product '%s' was automatically cancelled because it has been committed elsewhere.", title)
				_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", bid, msg)
				_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", sid, msg)
				publishToUser(bid, sseEvent{Type: "trade_updated", Data: fiber.Map{"trade_id": tid, "status": "cancelled_due_to_conflict"}})
				publishToUser(sid, sseEvent{Type: "trade_updated", Data: fiber.Map{"trade_id": tid, "status": "cancelled_due_to_conflict"}})
			}
		}
	}
}

// notifyMultiwayLoopBroken sends a "loop broken" notification to every other
// participant in the pending multiway chain (pre-acceptance). Safe to call
// after the chain row has already been marked cancelled Ã¢â‚¬â€ the participant IDs
// are still present. Pass the specific chainID when known; otherwise pass ""
// and the most recent chain for the trade will be used.
func (h *TradeHandler) notifyMultiwayLoopBroken(tradeID int, chainID string, cancellerID int) {
	var u1, u2, u3 int
	if chainID != "" {
		_ = h.db.QueryRow(
			"SELECT user1_id, user2_id, COALESCE(user3_id, 0) FROM multiway_trades WHERE chain_id = ? LIMIT 1",
			chainID,
		).Scan(&u1, &u2, &u3)
	} else {
		_ = h.db.QueryRow(
			"SELECT user1_id, user2_id, COALESCE(user3_id, 0) FROM multiway_trades WHERE original_trade_id = ? ORDER BY id DESC LIMIT 1",
			tradeID,
		).Scan(&u1, &u2, &u3)
	}
	if u1 == 0 && u2 == 0 && u3 == 0 {
		return
	}
	var cancellerName string
	_ = h.db.QueryRow("SELECT name FROM users WHERE id = ?", cancellerID).Scan(&cancellerName)
	if cancellerName == "" {
		cancellerName = fmt.Sprintf("User #%d", cancellerID)
	}
	msg := fmt.Sprintf("Loop broken Ã¢â‚¬â€ %s canceled the multi-way trade.", cancellerName)
	seen := map[int]bool{cancellerID: true, 0: true}
	for _, uid := range []int{u1, u2, u3} {
		if seen[uid] {
			continue
		}
		seen[uid] = true
		_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_loop', ?, FALSE)", uid, msg)
		publishNotification(uid, msg)
		publishToUser(uid, sseEvent{Type: "multiway_broken", Data: fiber.Map{"trade_id": tradeID, "chain_id": chainID, "cancelled_by": cancellerID, "message": msg}})
	}
}

// DeclineMultiwayChain allows any participant (User 1, 2, or 3) to decline
func (h *TradeHandler) DeclineMultiwayChain(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}
	chainID := c.Params("id")

	var payload struct {
		Action string `json:"action"` // "decline" or "search_again"
	}
	_ = c.BodyParser(&payload)

	// Verify the caller is a participant in this chain
	var chainStatus string
	err := h.db.QueryRow(`
		SELECT status FROM multiway_trades
		WHERE chain_id = ? AND (user1_id = ? OR user2_id = ? OR user3_id = ?)
	`, chainID, userID, userID, userID).Scan(&chainStatus)
	if err != nil {
		return c.Status(404).JSON(models.APIResponse{Success: false, Error: "Chain not found or you are not a participant"})
	}

	// Fetch user3's product before marking declined so we can unlock it
	var decliningU3PID int
	_ = h.db.QueryRow("SELECT user3_product_id FROM multiway_trades WHERE chain_id = ?", chainID).Scan(&decliningU3PID)

	// Update chain status Ã¢â‚¬â€ any participant can decline
	_, err = h.db.Exec(`
		UPDATE multiway_trades SET status = 'user3_declined', cancelled_by = ?
		WHERE chain_id = ? AND (user1_id = ? OR user2_id = ? OR user3_id = ?)
	`, userID, chainID, userID, userID, userID)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to decline"})
	}

	// Unlock user3's product now that the chain is declined
	if decliningU3PID > 0 {
		_, _ = h.db.Exec("UPDATE products SET status='available' WHERE id=? AND status='locked'", decliningU3PID)
	}

	// Notify the OTHER participants that the loop was broken.
	// Only fire for "decline" Ã¢â‚¬â€ search_again preserves the loop by finding a new User3.
	if payload.Action != "search_again" {
		var brokenTradeID int
		_ = h.db.QueryRow("SELECT original_trade_id FROM multiway_trades WHERE chain_id = ? LIMIT 1", chainID).Scan(&brokenTradeID)
		h.notifyMultiwayLoopBroken(brokenTradeID, chainID, userID)
	}

	if payload.Action == "search_again" {
		// Get chain details to search for NEW User 3
		var u1ID, u2ID, tradeID int
		err = h.db.QueryRow("SELECT user1_id, user2_id, original_trade_id FROM multiway_trades WHERE chain_id = ?", chainID).Scan(&u1ID, &u2ID, &tradeID)
		if err == nil {
			// Find EXCLUDED users (already declined)
			rows, _ := h.db.Query("SELECT user3_id FROM multiway_trades WHERE original_trade_id = ? AND status = 'user3_declined'", tradeID)
			excluded := []int{}
			for rows.Next() {
				var id int
				if err := rows.Scan(&id); err == nil {
					excluded = append(excluded, id)
				}
			}
			rows.Close()

			// Search for next candidate
			matches, _ := services.FindMultiwayMatch(h.db, u1ID, u2ID, tradeID, excluded)
			if len(matches) > 0 {
				match := matches[0]
				newChainID := fmt.Sprintf("chain_%d_%d_%d_%d", tradeID, u1ID, u2ID, match.User3ID)
				_, _ = h.db.Exec(`
					INSERT INTO multiway_trades (chain_id, original_trade_id, initiator_user_id, user1_id, user2_id, user3_id, user3_product_id, status)
					VALUES (?, ?, ?, ?, ?, ?, ?, 'pending_user3')
				`, newChainID, tradeID, u2ID, u1ID, u2ID, match.User3ID, match.User3ProductID)

				// Lock the new user3's product to prevent double-booking
				_, _ = h.db.Exec("UPDATE products SET status='locked' WHERE id=? AND status='available'", match.User3ProductID)

				// Notify the NEW User 3
				notifMsg := fmt.Sprintf("Someone wants your %s and has something you like! Check your multi-way opportunities.", match.User3ProductTitle)
				_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_loop', ?, FALSE)", match.User3ID, notifMsg)
				publishNotification(match.User3ID, notifMsg)
			} else {
				// No more participants found Ã¢â‚¬â€ revert the original trade to 'pending'
				// so the 2-way deal can still proceed. A multiway failure should NOT
				// kill the base trade.
				_, _ = h.db.Exec("UPDATE trades SET status = 'pending', updated_at = NOW() WHERE id = ? AND status = 'pending_multiway'", tradeID)
				msg := "Multi-way matching could not find a third participant. Your original trade offer is still active."
				_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", u1ID, msg)
				publishNotification(u1ID, msg)

				// User 2 sees multiway search exhausted
				msg2 := "Multi-way matching failed. No more available partners found. Your original trade is still active."
				_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", u2ID, msg2)
				publishNotification(u2ID, msg2)
			}
			go h.rebuildTradeLoopCacheForUsers([]int{u1ID, u2ID, userID})
		}
	}
	go h.rebuildTradeLoopCacheForUsers([]int{userID})

	return c.JSON(models.APIResponse{Success: true, Message: "Opportunity declined"})
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// Phase 2: Per-leg status tracking, chain health, privacy-scoped views
// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

// GetChainLegs returns the legs of a multiway chain along with a health indicator.
// Privacy-scoped: users only see legs where they are sender or receiver + the overall
// health indicator ("2 of 3 legs complete").
func (h *TradeHandler) GetChainLegs(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}
	chainID := c.Params("id")

	// Verify this user is a participant of the chain.
	var participantCount int
	h.db.QueryRow(`
		SELECT COUNT(*) FROM multiway_trades
		WHERE chain_id = ? AND (user1_id = ? OR user2_id = ? OR user3_id = ?)
	`, chainID, userID, userID, userID).Scan(&participantCount)
	if participantCount == 0 {
		return c.Status(403).JSON(models.APIResponse{Success: false, Error: "Not a participant of this chain"})
	}

	// Get overall health: total legs and completed legs.
	var totalLegs, completedLegs int
	h.db.QueryRow("SELECT COUNT(*), SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) FROM multiway_trade_legs WHERE chain_id = ?", chainID).Scan(&totalLegs, &completedLegs)

	// Fetch only legs the user is involved in (privacy scope).
	rows, err := h.db.Query(`
		SELECT l.id, l.leg_index, l.from_user_id, l.to_user_id, l.product_id,
		       l.handoff_method, COALESCE(l.handoff_location, '') as handoff_location,
		       COALESCE(l.handoff_time, '') as handoff_time,
		       COALESCE(l.handoff_photo_url, '') as handoff_photo_url,
		       l.status,
		       COALESCE(fu.name, '') as from_user_name,
		       COALESCE(tu.name, '') as to_user_name,
		       COALESCE(p.title, '') as product_title
		FROM multiway_trade_legs l
		JOIN users fu ON fu.id = l.from_user_id
		JOIN users tu ON tu.id = l.to_user_id
		JOIN products p ON p.id = l.product_id
		WHERE l.chain_id = ? AND (l.from_user_id = ? OR l.to_user_id = ?)
		ORDER BY l.leg_index ASC
	`, chainID, userID, userID)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to fetch legs"})
	}
	defer rows.Close()

	var legs []fiber.Map
	for rows.Next() {
		var legID, legIndex, fromUID, toUID, productID int
		var handoffMethod, handoffLocation, handoffTime, handoffPhotoURL, status string
		var fromName, toName, productTitle string
		if err := rows.Scan(&legID, &legIndex, &fromUID, &toUID, &productID,
			&handoffMethod, &handoffLocation, &handoffTime, &handoffPhotoURL,
			&status, &fromName, &toName, &productTitle); err != nil {
			continue
		}
		legs = append(legs, fiber.Map{
			"id":                legID,
			"leg_index":         legIndex,
			"from_user_id":      fromUID,
			"from_user_name":    fromName,
			"to_user_id":        toUID,
			"to_user_name":      toName,
			"product_id":        productID,
			"product_title":     productTitle,
			"handoff_method":    handoffMethod,
			"handoff_location":  handoffLocation,
			"handoff_time":      handoffTime,
			"handoff_photo_url": handoffPhotoURL,
			"status":            status,
		})
	}

	return c.JSON(models.APIResponse{
		Success: true,
		Data: fiber.Map{
			"chain_id":       chainID,
			"legs":           legs,
			"total_legs":     totalLegs,
			"completed_legs": completedLegs,
			"health":         fmt.Sprintf("%d of %d legs complete", completedLegs, totalLegs),
			"all_complete":   completedLegs == totalLegs && totalLegs > 0,
		},
	})
}

// UpdateLegHandoff lets either party in a leg choose the handoff method (meetup or delivery).
func (h *TradeHandler) UpdateLegHandoff(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}
	legID := c.Params("legId")

	var payload struct {
		Method   string `json:"method"`   // "meetup" or "delivery"
		Location string `json:"location"` // optional meetup location
		Time     string `json:"time"`     // optional meetup time
	}
	if err := c.BodyParser(&payload); err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid request body"})
	}
	if payload.Method != "meetup" && payload.Method != "delivery" {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Method must be 'meetup' or 'delivery'"})
	}

	// Verify the user is part of this leg.
	// 1. Verify user is in this leg and get chain_id
	var chainID string
	err := h.db.QueryRow(`
		SELECT chain_id FROM multiway_trade_legs 
		WHERE id = ? AND (from_user_id = ? OR to_user_id = ?) AND status IN ('pending', 'in_progress')
	`, legID, userID, userID).Scan(&chainID)

	if err != nil {
		return c.Status(404).JSON(models.APIResponse{Success: false, Error: "Leg not found or not your leg"})
	}

	// 2. Update ALL legs for this chain
	_, err = h.db.Exec(`
		UPDATE multiway_trade_legs
		SET handoff_method = ?, handoff_location = ?, handoff_time = ?, status = 'in_progress', updated_at = NOW()
		WHERE chain_id = ? AND status IN ('pending', 'in_progress')
	`, payload.Method, payload.Location, payload.Time, chainID)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to update handoffs"})
	}

	// 3. Notify all other parties in the chain
	rows, err := h.db.Query(`
		SELECT DISTINCT from_user_id
		FROM multiway_trade_legs
		WHERE chain_id = ? AND from_user_id != ?
		UNION 
		SELECT DISTINCT to_user_id
		FROM multiway_trade_legs
		WHERE chain_id = ? AND to_user_id != ?
	`, chainID, userID, chainID, userID)
	if err == nil {
		defer rows.Close()
		msg := fmt.Sprintf("A shared %s has been coordinated for your multi-way chain. Check your trade details.", payload.Method)
		for rows.Next() {
			var otherUserID int
			if err := rows.Scan(&otherUserID); err == nil && otherUserID > 0 {
				_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", otherUserID, msg)
				publishNotification(otherUserID, msg)
			}
		}
	}

	return c.JSON(models.APIResponse{Success: true, Message: "Handoff method updated"})
}

// CompleteLeg marks a specific leg as completed, with optional handoff photo.
// When all legs of a chain are complete, the entire chain is marked as completed.
func (h *TradeHandler) CompleteLeg(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}
	legID := c.Params("legId")

	var payload struct {
		HandoffPhotoURL string `json:"handoff_photo_url"`
	}
	_ = c.BodyParser(&payload)

	// Complete the leg (only the receiver confirms completion).
	res, err := h.db.Exec(`
		UPDATE multiway_trade_legs
		SET status = 'completed', completed_at = NOW(), handoff_photo_url = COALESCE(?, handoff_photo_url), updated_at = NOW()
		WHERE id = ? AND to_user_id = ? AND status IN ('pending', 'in_progress')
	`, payload.HandoffPhotoURL, legID, userID)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to complete leg"})
	}
	ra, _ := res.RowsAffected()
	if ra == 0 {
		return c.Status(404).JSON(models.APIResponse{Success: false, Error: "Leg not found, not your leg to confirm, or already completed"})
	}

	// Check if ALL legs of this chain are now complete Ã¢â€ â€™ auto-complete the chain.
	var chainID string
	h.db.QueryRow("SELECT chain_id FROM multiway_trade_legs WHERE id = ?", legID).Scan(&chainID)

	var totalLegs, completedLegs int
	h.db.QueryRow("SELECT COUNT(*), SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) FROM multiway_trade_legs WHERE chain_id = ?", chainID).Scan(&totalLegs, &completedLegs)

	// Notify the sender that the leg is complete.
	var senderID int
	h.db.QueryRow("SELECT from_user_id FROM multiway_trade_legs WHERE id = ?", legID).Scan(&senderID)
	if senderID > 0 {
		msg := fmt.Sprintf("Your handoff has been confirmed! (%d of %d legs complete)", completedLegs, totalLegs)
		_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", senderID, msg)
		publishNotification(senderID, msg)
	}

	if completedLegs == totalLegs && totalLegs > 0 {
		// All legs done Ã¢â€ â€™ mark chain as completed.
		_, _ = h.db.Exec("UPDATE multiway_trades SET status = 'completed', updated_at = NOW() WHERE chain_id = ?", chainID)

		// Mark original trade as completed too.
		_, _ = h.db.Exec(`
			UPDATE trades SET status = 'completed', completed_at = NOW(), updated_at = NOW()
			WHERE id = (SELECT original_trade_id FROM multiway_trades WHERE chain_id = ?)
		`, chainID)

		// Mark all involved products as traded.
		_, _ = h.db.Exec(`
			UPDATE products SET status = 'traded', updated_at = NOW()
			WHERE id IN (SELECT product_id FROM multiway_trade_legs WHERE chain_id = ?)
		`, chainID)

		// Notify all participants.
		var u1ID, u2ID, u3ID int
		h.db.QueryRow("SELECT user1_id, user2_id, COALESCE(user3_id, 0) FROM multiway_trades WHERE chain_id = ?", chainID).Scan(&u1ID, &u2ID, &u3ID)
		completionMsg := "Ã°Å¸Å½â€° All legs of your multi-way trade are complete! Great trading!"
		for _, uid := range []int{u1ID, u2ID, u3ID} {
			if uid > 0 {
				_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", uid, completionMsg)
				publishNotification(uid, completionMsg)
			}
		}

		log.Printf("Multi-way chain %s fully completed (all %d legs done)", chainID, totalLegs)
	}

	return c.JSON(models.APIResponse{
		Success: true,
		Message: fmt.Sprintf("Leg completed! %d of %d legs done.", completedLegs, totalLegs),
		Data: fiber.Map{
			"completed_legs": completedLegs,
			"total_legs":     totalLegs,
			"all_complete":   completedLegs == totalLegs,
		},
	})
}

// GetProductMultiwayStatus checks if a product is currently involved in an active multiway chain.
// Used by frontend to show a "Pending multi-way match" badge on listings.
func (h *TradeHandler) GetProductMultiwayStatus(c *fiber.Ctx) error {
	productID := c.Params("id")

	var chainID string
	var status string
	err := h.db.QueryRow(`
		SELECT mw.chain_id, mw.status
		FROM multiway_trades mw
		LEFT JOIN multiway_trade_legs l ON l.chain_id = mw.chain_id AND l.product_id = ?
		LEFT JOIN trades t ON t.id = mw.original_trade_id
		LEFT JOIN trade_items ti ON ti.trade_id = t.id AND ti.product_id = ?
		WHERE (l.product_id IS NOT NULL OR t.target_product_id = ? OR ti.product_id IS NOT NULL)
		  AND mw.status IN ('pending_user3', 'user3_accepted', 'active', 'searching')
		LIMIT 1
	`, productID, productID, productID).Scan(&chainID, &status)

	if err != nil {
		return c.JSON(models.APIResponse{
			Success: true,
			Data: fiber.Map{
				"in_multiway_chain": false,
			},
		})
	}

	return c.JSON(models.APIResponse{
		Success: true,
		Data: fiber.Map{
			"in_multiway_chain": true,
			"chain_id":          chainID,
			"chain_status":      status,
		},
	})
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// Phase 3: Chain collapse, re-match, strike system, conflict resolution, admin
// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

// BackOutChain handles a participant backing out of an already-accepted chain.
// This triggers: (1) chain collapse, (2) strike for the backer-out, (3) single-leg
// re-match attempt with a 12-hour hold for the remaining parties.
func (h *TradeHandler) BackOutChain(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}
	chainID := c.Params("id")

	// Check if user is restricted by a previous strike-3.
	var restrictedUntil sql.NullTime
	h.db.QueryRow(`
		SELECT restricted_until FROM user_strikes
		WHERE user_id = ? AND restricted_until IS NOT NULL AND restricted_until > NOW()
		ORDER BY created_at DESC LIMIT 1
	`, userID).Scan(&restrictedUntil)
	if restrictedUntil.Valid {
		return c.Status(403).JSON(models.APIResponse{
			Success: false,
			Error:   fmt.Sprintf("You are restricted from multi-way trades until %s due to repeated back-outs.", restrictedUntil.Time.Format("Jan 2, 2006")),
		})
	}

	// Verify the user is a participant and the chain is in an accepted/active state.
	var u1ID, u2ID, u3ID, originalTradeID int
	var chainStatus string
	err := h.db.QueryRow(`
		SELECT user1_id, user2_id, COALESCE(user3_id, 0), original_trade_id, status
		FROM multiway_trades
		WHERE chain_id = ? AND (user1_id = ? OR user2_id = ? OR user3_id = ?)
	`, chainID, userID, userID, userID).Scan(&u1ID, &u2ID, &u3ID, &originalTradeID, &chainStatus)
	if err != nil {
		return c.Status(404).JSON(models.APIResponse{Success: false, Error: "Chain not found or you are not a participant"})
	}
	if chainStatus != "user3_accepted" && chainStatus != "active" {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Can only back out of accepted/active chains"})
	}

	// 1. Collapse the chain Ã¢â‚¬â€ cancel all legs.
	_, _ = h.db.Exec("UPDATE multiway_trade_legs SET status = 'cancelled', updated_at = NOW() WHERE chain_id = ? AND status NOT IN ('completed', 'cancelled')", chainID)
	_, _ = h.db.Exec("UPDATE multiway_trades SET status = 'cancelled', cancelled_at = NOW(), cancelled_by = ?, updated_at = NOW() WHERE chain_id = ?", userID, chainID)

	// 2. Issue a strike to the backing-out user.
	strikeMsg := h.issueStrike(userID, chainID, "Backed out of an accepted multi-way chain")

	// 3. Notify the other participants about the collapse.
	var backerName string
	h.db.QueryRow("SELECT name FROM users WHERE id = ?", userID).Scan(&backerName)
	if backerName == "" {
		backerName = "A participant"
	}

	collapseMsg := fmt.Sprintf("%s backed out of the multi-way chain. The chain has been dissolved. We're attempting to find a replacement.", backerName)
	for _, uid := range []int{u1ID, u2ID, u3ID} {
		if uid > 0 && uid != userID {
			_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", uid, collapseMsg)
			publishNotification(uid, collapseMsg)
		}
	}

	// 4. Attempt single-leg re-match: find a replacement for the backed-out user.
	// Determine which user positions remain and which needs replacement.
	remainingUsers := []int{}
	for _, uid := range []int{u1ID, u2ID, u3ID} {
		if uid > 0 && uid != userID {
			remainingUsers = append(remainingUsers, uid)
		}
	}

	// Create a 12-hour re-match hold.
	backedOutLegIndex := 0
	switch userID {
	case u1ID:
		backedOutLegIndex = 0
	case u2ID:
		backedOutLegIndex = 1
	case u3ID:
		backedOutLegIndex = 2
	}

	holdExpires := time.Now().Add(12 * time.Hour)
	_, _ = h.db.Exec(`
		INSERT INTO multiway_rematch_holds (chain_id, original_chain_id, backed_out_user_id, backed_out_leg_index, hold_expires_at, status)
		VALUES (?, ?, ?, ?, ?, 'searching')
	`, chainID, chainID, userID, backedOutLegIndex, holdExpires)

	// Attempt immediate re-match using the existing matcher.
	excluded := []int{userID}
	// Collect all previously declined user3s for this trade.
	prevRows, _ := h.db.Query("SELECT user3_id FROM multiway_trades WHERE original_trade_id = ? AND status = 'user3_declined'", originalTradeID)
	if prevRows != nil {
		for prevRows.Next() {
			var prevID int
			if prevRows.Scan(&prevID) == nil {
				excluded = append(excluded, prevID)
			}
		}
		prevRows.Close()
	}

	// Determine the two users who are still in the trade (not the one who backed out).
	// Use them as the basis for the re-match so we don't pass the backed-out user as an initiator.
	var rematch1, rematch2 int
	if len(remainingUsers) >= 2 {
		rematch1, rematch2 = remainingUsers[0], remainingUsers[1]
	} else {
		// Fallback: shouldn't happen in a 3-way chain, but avoid a zero-ID INSERT.
		rematch1, rematch2 = u1ID, u2ID
	}

	rematchResult := "no_match"
	matches, _ := services.FindMultiwayMatch(h.db, rematch1, rematch2, originalTradeID, excluded)
	if len(matches) > 0 {
		match := matches[0]
		newChainID := fmt.Sprintf("chain_%d_%d_%d_%d", originalTradeID, rematch1, rematch2, match.User3ID)
		expiresAt := time.Now().Add(18 * time.Hour)
		_, insertErr := h.db.Exec(`
			INSERT INTO multiway_trades (chain_id, original_trade_id, initiator_user_id, user1_id, user2_id, user3_id, user3_product_id, status, expires_at)
			VALUES (?, ?, ?, ?, ?, ?, ?, 'pending_user3', ?)
		`, newChainID, originalTradeID, rematch1, rematch1, rematch2, match.User3ID, match.User3ProductID, expiresAt)
		if insertErr == nil {
			rematchResult = "found"
			// Update the hold record.
			_, _ = h.db.Exec("UPDATE multiway_rematch_holds SET status = 'found', replacement_user_id = ?, replacement_chain_id = ? WHERE chain_id = ? AND status = 'searching'",
				match.User3ID, newChainID, chainID)

			// Notify the new candidate.
			notifMsg := fmt.Sprintf("Someone wants your %s and has something you like! Check your multi-way opportunities.", match.User3ProductTitle)
			_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_loop', ?, FALSE)", match.User3ID, notifMsg)
			publishNotification(match.User3ID, notifMsg)

			// Notify remaining parties that a replacement was found.
			holdMsg := "A replacement participant has been found for the collapsed chain. Please wait for their response."
			for _, uid := range remainingUsers {
				_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", uid, holdMsg)
				publishNotification(uid, holdMsg)
			}
		}
	}

	if rematchResult == "no_match" {
		// No replacement found immediately Ã¢â‚¬â€ trade stays pending for 12hrs.
		// The background scheduler will dissolve it if no match is found.
		_, _ = h.db.Exec("UPDATE trades SET status = 'pending', updated_at = NOW() WHERE id = ? AND status IN ('multiway_active', 'pending_multiway')", originalTradeID)
		holdMsg := "We're searching for a replacement participant. You'll be notified within 12 hours."
		for _, uid := range remainingUsers {
			_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", uid, holdMsg)
			publishNotification(uid, holdMsg)
		}
	}

	go h.rebuildTradeLoopCacheForUsers([]int{u1ID, u2ID, u3ID})

	return c.JSON(models.APIResponse{
		Success: true,
		Message: "You have backed out of the chain.",
		Data: fiber.Map{
			"strike_message":  strikeMsg,
			"rematch_status":  rematchResult,
			"hold_expires":    holdExpires.Format("2006-01-02 15:04:05"),
			"remaining_users": remainingUsers,
		},
	})
}

// issueStrike adds a progressive strike to a user's record and returns the warning message.
func (h *TradeHandler) issueStrike(userID int, chainID, reason string) string {
	// Count existing strikes for this user.
	var currentStrikes int
	h.db.QueryRow("SELECT COUNT(*) FROM user_strikes WHERE user_id = ? AND created_at > NOW() - INTERVAL 6 MONTH", userID).Scan(&currentStrikes)

	newStrikeNumber := currentStrikes + 1
	var severity, message string
	var restrictedUntil *time.Time

	switch {
	case newStrikeNumber >= 3:
		severity = "restriction"
		until := time.Now().AddDate(0, 0, 30) // 30-day restriction
		restrictedUntil = &until
		message = fmt.Sprintf("Strike %d: You have been restricted from multi-way trades for 30 days due to repeated back-outs.", newStrikeNumber)
	case newStrikeNumber == 2:
		severity = "final_warning"
		message = "Strike 2 Ã¢â‚¬â€ Final Warning: Backing out of accepted chains again will result in a 30-day restriction from multi-way trading."
	default:
		severity = "friendly_warning"
		message = "Strike 1 Ã¢â‚¬â€ Friendly Warning: Backing out of accepted multi-way chains affects other participants. Please be sure before accepting."
	}

	_, _ = h.db.Exec(`
		INSERT INTO user_strikes (user_id, chain_id, strike_number, reason, severity, restricted_until)
		VALUES (?, ?, ?, ?, ?, ?)
	`, userID, chainID, newStrikeNumber, reason, severity, restrictedUntil)

	// Notify the user.
	_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", userID, message)
	publishNotification(userID, message)

	log.Printf("Issued strike %d (%s) to user %d for chain %s: %s", newStrikeNumber, severity, userID, chainID, reason)
	return message
}

// CheckMultiwayConflict checks if a product has conflicting pending offers
// (both a regular 2-way trade AND a pending multiway chain).
// The owner sees this and decides which to accept first.
func (h *TradeHandler) CheckMultiwayConflict(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}
	productID := c.Params("id")

	// Check for pending 2-way trades on this product.
	var twoWayCount int
	var twoWayTradeID sql.NullInt64
	h.db.QueryRow(`
		SELECT COUNT(*), MIN(id) FROM trades
		WHERE target_product_id = ? AND seller_id = ? AND status IN ('pending', 'accepted')
	`, productID, userID).Scan(&twoWayCount, &twoWayTradeID)

	// Check for pending multiway chains involving this product.
	var multiwayCount int
	var multiwayChainID sql.NullString
	var multiwayStatus sql.NullString
	h.db.QueryRow(`
		SELECT COUNT(*), MIN(mw.chain_id), MIN(mw.status)
		FROM multiway_trades mw
		LEFT JOIN multiway_trade_legs l ON l.chain_id = mw.chain_id AND l.product_id = ?
		LEFT JOIN trades t ON t.id = mw.original_trade_id
		LEFT JOIN trade_items ti ON ti.trade_id = t.id AND ti.product_id = ?
		WHERE (l.product_id IS NOT NULL OR t.target_product_id = ? OR ti.product_id IS NOT NULL)
		  AND mw.status IN ('pending_user3', 'user3_accepted', 'active', 'searching')
	`, productID, productID, productID).Scan(&multiwayCount, &multiwayChainID, &multiwayStatus)

	hasConflict := twoWayCount > 0 && multiwayCount > 0

	return c.JSON(models.APIResponse{
		Success: true,
		Data: fiber.Map{
			"has_conflict":      hasConflict,
			"two_way_count":     twoWayCount,
			"two_way_trade_id":  twoWayTradeID,
			"multiway_count":    multiwayCount,
			"multiway_chain_id": multiwayChainID,
			"multiway_status":   multiwayStatus,
			"recommendation":    "Accept the offer you prefer first. If you accept the 2-way trade, the multi-way chain will dissolve automatically.",
		},
	})
}

// ResolveMultiwayConflict lets the product owner choose between the 2-way offer
// and the multiway chain. If they choose 2-way, the multiway chain dissolves.
func (h *TradeHandler) ResolveMultiwayConflict(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}

	var payload struct {
		KeepType string `json:"keep_type"` // "two_way" or "multiway"
		ChainID  string `json:"chain_id"`
		TradeID  int    `json:"trade_id"`
	}
	if err := c.BodyParser(&payload); err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid request body"})
	}

	if payload.KeepType == "two_way" && payload.ChainID != "" {
		// Dissolve the multiway chain.
		_, _ = h.db.Exec("UPDATE multiway_trades SET status = 'cancelled', cancelled_at = NOW(), cancelled_by = ?, updated_at = NOW() WHERE chain_id = ?", userID, payload.ChainID)
		_, _ = h.db.Exec("UPDATE multiway_trade_legs SET status = 'cancelled', updated_at = NOW() WHERE chain_id = ?", payload.ChainID)

		// Notify multiway participants.
		rows, _ := h.db.Query(`
			SELECT user1_id, user2_id, COALESCE(user3_id, 0) FROM multiway_trades WHERE chain_id = ?
		`, payload.ChainID)
		if rows != nil {
			for rows.Next() {
				var u1, u2, u3 int
				if rows.Scan(&u1, &u2, &u3) == nil {
					msg := "A multi-way chain you were part of has been dissolved because the item owner accepted a different trade offer."
					for _, uid := range []int{u1, u2, u3} {
						if uid > 0 && uid != userID {
							_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", uid, msg)
							publishNotification(uid, msg)
						}
					}
				}
			}
			rows.Close()
		}

		return c.JSON(models.APIResponse{Success: true, Message: "Multi-way chain dissolved. 2-way trade preserved."})
	} else if payload.KeepType == "multiway" && payload.TradeID > 0 {
		// Decline the 2-way trade.
		_, _ = h.db.Exec("UPDATE trades SET status = 'declined', updated_at = NOW() WHERE id = ? AND (seller_id = ? OR buyer_id = ?)", payload.TradeID, userID, userID)

		// Notify the 2-way trade partner.
		var partnerID int
		h.db.QueryRow("SELECT CASE WHEN buyer_id = ? THEN seller_id ELSE buyer_id END FROM trades WHERE id = ?", userID, payload.TradeID).Scan(&partnerID)
		if partnerID > 0 {
			msg := "Your trade offer was declined because the item is part of a multi-way chain."
			_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", partnerID, msg)
			publishNotification(partnerID, msg)
		}

		return c.JSON(models.APIResponse{Success: true, Message: "2-way trade declined. Multi-way chain preserved."})
	}

	return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid keep_type Ã¢â‚¬â€ must be 'two_way' or 'multiway'"})
}

// AdminGetChains returns all multiway chains with status, participants, health, and re-match holds.
func (h *TradeHandler) AdminGetChains(c *fiber.Ctx) error {
	page, _ := strconv.Atoi(c.Query("page", "1"))
	limit, _ := strconv.Atoi(c.Query("limit", "20"))
	statusFilter := c.Query("status", "")
	offset := (page - 1) * limit

	// Count total chains.
	var total int
	countQuery := "SELECT COUNT(*) FROM multiway_trades"
	if statusFilter != "" {
		countQuery += " WHERE status = '" + statusFilter + "'"
	}
	h.db.QueryRow(countQuery).Scan(&total)

	// Fetch chains.
	query := `
		SELECT mw.id, mw.chain_id, mw.original_trade_id, mw.initiator_user_id,
		       mw.user1_id, mw.user2_id, COALESCE(mw.user3_id, 0), mw.status,
		       COALESCE(mw.expires_at, '1970-01-01') as expires_at,
		       COALESCE(mw.cancelled_at, '1970-01-01') as cancelled_at,
		       COALESCE(mw.cancelled_by, 0),
		       mw.created_at, mw.updated_at,
		       COALESCE(u1.name, '') as user1_name,
		       COALESCE(u2.name, '') as user2_name,
		       COALESCE(u3.name, '') as user3_name,
		       COALESCE(ui.name, '') as initiator_name
		FROM multiway_trades mw
		JOIN users u1 ON u1.id = mw.user1_id
		JOIN users u2 ON u2.id = mw.user2_id
		LEFT JOIN users u3 ON u3.id = mw.user3_id
		JOIN users ui ON ui.id = mw.initiator_user_id
	`
	if statusFilter != "" {
		query += " WHERE mw.status = ?"
	}
	query += " ORDER BY mw.created_at DESC LIMIT ? OFFSET ?"

	var rows *sql.Rows
	var err error
	if statusFilter != "" {
		rows, err = h.db.Query(query, statusFilter, limit, offset)
	} else {
		rows, err = h.db.Query(query, limit, offset)
	}
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to fetch chains"})
	}
	defer rows.Close()

	var chains []fiber.Map
	for rows.Next() {
		var id, tradeID, initiatorID, u1ID, u2ID, u3ID, cancelledBy int
		var cID, status, u1Name, u2Name, u3Name, initiatorName string
		var expiresAt, cancelledAt, createdAt, updatedAt time.Time
		if err := rows.Scan(&id, &cID, &tradeID, &initiatorID,
			&u1ID, &u2ID, &u3ID, &status,
			&expiresAt, &cancelledAt, &cancelledBy,
			&createdAt, &updatedAt,
			&u1Name, &u2Name, &u3Name, &initiatorName); err != nil {
			continue
		}

		// Get leg health for this chain.
		var totalLegs, completedLegs int
		h.db.QueryRow("SELECT COUNT(*), COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) FROM multiway_trade_legs WHERE chain_id = ?", cID).Scan(&totalLegs, &completedLegs)

		// Check for active re-match holds.
		var activeHolds int
		h.db.QueryRow("SELECT COUNT(*) FROM multiway_rematch_holds WHERE chain_id = ? AND status = 'searching'", cID).Scan(&activeHolds)

		// Get strike count for participants.
		var totalStrikes int
		h.db.QueryRow("SELECT COUNT(*) FROM user_strikes WHERE chain_id = ?", cID).Scan(&totalStrikes)

		chain := fiber.Map{
			"id":                id,
			"chain_id":          cID,
			"original_trade_id": tradeID,
			"status":            status,
			"initiator_user_id": initiatorID,
			"initiator_name":    initiatorName,
			"participants": []fiber.Map{
				{"id": u1ID, "name": u1Name, "role": "user1"},
				{"id": u2ID, "name": u2Name, "role": "user2"},
			},
			"created_at":     createdAt.Format("2006-01-02 15:04:05"),
			"updated_at":     updatedAt.Format("2006-01-02 15:04:05"),
			"total_legs":     totalLegs,
			"completed_legs": completedLegs,
			"health":         fmt.Sprintf("%d of %d", completedLegs, totalLegs),
			"active_holds":   activeHolds,
			"strikes_issued": totalStrikes,
		}
		if u3ID > 0 {
			chain["participants"] = append(chain["participants"].([]fiber.Map), fiber.Map{"id": u3ID, "name": u3Name, "role": "user3"})
		}
		if !expiresAt.IsZero() && expiresAt.Year() > 1970 {
			chain["expires_at"] = expiresAt.Format("2006-01-02 15:04:05")
		}
		if !cancelledAt.IsZero() && cancelledAt.Year() > 1970 {
			chain["cancelled_at"] = cancelledAt.Format("2006-01-02 15:04:05")
			chain["cancelled_by"] = cancelledBy
		}
		chains = append(chains, chain)
	}

	return c.JSON(models.APIResponse{
		Success: true,
		Data: fiber.Map{
			"chains":      chains,
			"total":       total,
			"page":        page,
			"limit":       limit,
			"total_pages": (total + limit - 1) / limit,
		},
	})
}

// GetUserStrikes returns the strike history for a user (admin or self).
func (h *TradeHandler) GetUserStrikes(c *fiber.Ctx) error {
	targetUserID, _ := strconv.Atoi(c.Params("userId"))
	if targetUserID == 0 {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid user ID"})
	}

	rows, err := h.db.Query(`
		SELECT id, chain_id, strike_number, reason, severity,
		       COALESCE(restricted_until, '1970-01-01') as restricted_until, created_at
		FROM user_strikes WHERE user_id = ?
		ORDER BY created_at DESC
	`, targetUserID)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to fetch strikes"})
	}
	defer rows.Close()

	var strikes []fiber.Map
	for rows.Next() {
		var id, strikeNum int
		var chainID, reason, severity string
		var restrictedUntil, createdAt time.Time
		if err := rows.Scan(&id, &chainID, &strikeNum, &reason, &severity, &restrictedUntil, &createdAt); err != nil {
			continue
		}
		s := fiber.Map{
			"id":            id,
			"chain_id":      chainID,
			"strike_number": strikeNum,
			"reason":        reason,
			"severity":      severity,
			"created_at":    createdAt.Format("2006-01-02 15:04:05"),
		}
		if restrictedUntil.Year() > 1970 {
			s["restricted_until"] = restrictedUntil.Format("2006-01-02 15:04:05")
		}
		strikes = append(strikes, s)
	}

	// Check if currently restricted.
	var isRestricted bool
	h.db.QueryRow("SELECT EXISTS(SELECT 1 FROM user_strikes WHERE user_id = ? AND restricted_until IS NOT NULL AND restricted_until > NOW())", targetUserID).Scan(&isRestricted)

	return c.JSON(models.APIResponse{
		Success: true,
		Data: fiber.Map{
			"user_id":       targetUserID,
			"total_strikes": len(strikes),
			"is_restricted": isRestricted,
			"strikes":       strikes,
		},
	})
}

// AdminIssueStrike manually adds a strike to a user
func (h *TradeHandler) AdminIssueStrike(c *fiber.Ctx) error {
	targetUserID, _ := strconv.Atoi(c.Params("userId"))
	if targetUserID == 0 {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid user ID"})
	}

	var payload struct {
		Reason  string `json:"reason"`
		ChainID string `json:"chain_id"`
	}
	if err := c.BodyParser(&payload); err != nil || payload.Reason == "" {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Reason is required"})
	}

	h.issueStrike(targetUserID, payload.ChainID, payload.Reason)

	return c.JSON(models.APIResponse{
		Success: true,
		Message: "Strike issued successfully",
	})
}

// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
// Phase 4: Per-leg dispute isolation, upstream collapse, admin dispute view
// Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

// FileLegDispute allows a participant to file a dispute on a specific leg.
// Only the affected leg is frozen to 'disputed' status Ã¢â‚¬â€ the rest of the chain continues.
func (h *TradeHandler) FileLegDispute(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}
	legID, err := strconv.Atoi(c.Params("legId"))
	if err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid leg ID"})
	}

	var payload struct {
		Reason       string   `json:"reason"`
		Description  string   `json:"description"`
		EvidenceURLs []string `json:"evidence_urls"`
	}
	if err := c.BodyParser(&payload); err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid request body"})
	}
	if payload.Reason == "" {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Reason is required"})
	}

	// Verify the user is part of this leg.
	var chainID string
	var fromUID, toUID int
	var legStatus string
	err = h.db.QueryRow(`
		SELECT chain_id, from_user_id, to_user_id, status
		FROM multiway_trade_legs WHERE id = ?
	`, legID).Scan(&chainID, &fromUID, &toUID, &legStatus)
	if err != nil {
		return c.Status(404).JSON(models.APIResponse{Success: false, Error: "Leg not found"})
	}
	if userID != fromUID && userID != toUID {
		return c.Status(403).JSON(models.APIResponse{Success: false, Error: "You are not a participant of this leg"})
	}
	if legStatus == "cancelled" || legStatus == "disputed" {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "This leg is already " + legStatus})
	}

	// Check for existing open dispute on this leg.
	var existingDispute int
	h.db.QueryRow("SELECT COUNT(*) FROM multiway_leg_disputes WHERE leg_id = ? AND status IN ('open', 'under_review')", legID).Scan(&existingDispute)
	if existingDispute > 0 {
		return c.Status(409).JSON(models.APIResponse{Success: false, Error: "A dispute is already open on this leg"})
	}

	// Determine who the dispute is against.
	againstUserID := toUID
	if userID == toUID {
		againstUserID = fromUID
	}

	// Marshal evidence URLs to JSON.
	var evidenceJSON []byte
	if len(payload.EvidenceURLs) > 0 {
		evidenceJSON, _ = json.Marshal(payload.EvidenceURLs)
	}

	// Create the dispute record.
	result, err := h.db.Exec(`
		INSERT INTO multiway_leg_disputes (chain_id, leg_id, filed_by, against_user_id, reason, description, evidence_urls, status)
		VALUES (?, ?, ?, ?, ?, ?, ?, 'open')
	`, chainID, legID, userID, againstUserID, payload.Reason, payload.Description, evidenceJSON)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to file dispute"})
	}
	disputeID, _ := result.LastInsertId()

	// Freeze ONLY the affected leg Ã¢â‚¬â€ set status to 'disputed'.
	_, _ = h.db.Exec("UPDATE multiway_trade_legs SET status = 'disputed', updated_at = NOW() WHERE id = ?", legID)

	// Notify the other party.
	var filerName string
	h.db.QueryRow("SELECT name FROM users WHERE id = ?", userID).Scan(&filerName)
	if filerName == "" {
		filerName = "Your trade partner"
	}
	msg := fmt.Sprintf("%s has filed a dispute on your handoff. The leg is frozen until an admin reviews it.", filerName)
	_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", againstUserID, msg)
	publishNotification(againstUserID, msg)

	// Notify admins.
	adminRows, _ := h.db.Query("SELECT id FROM users WHERE role = 'admin'")
	if adminRows != nil {
		adminMsg := fmt.Sprintf("New multi-way leg dispute filed (chain: %s, leg: %d) by user %d against user %d: %s", chainID, legID, userID, againstUserID, payload.Reason)
		for adminRows.Next() {
			var adminID int
			if adminRows.Scan(&adminID) == nil {
				_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'report', ?, FALSE)", adminID, adminMsg)
			}
		}
		adminRows.Close()
	}

	return c.Status(201).JSON(models.APIResponse{
		Success: true,
		Message: "Dispute filed. Only this leg has been frozen Ã¢â‚¬â€ other legs in the chain continue normally.",
		Data: fiber.Map{
			"dispute_id": disputeID,
			"leg_id":     legID,
			"chain_id":   chainID,
		},
	})
}

// AdminResolveLegDispute allows an admin to resolve a per-leg dispute.
// Actions: no_action (unfreeze), cancel_leg (trigger upstream collapse), cancel_chain (full collapse).
func (h *TradeHandler) AdminResolveLegDispute(c *fiber.Ctx) error {
	adminID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}
	disputeID, err := strconv.Atoi(c.Params("disputeId"))
	if err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid dispute ID"})
	}

	var payload struct {
		Resolution string `json:"resolution"` // "no_action", "cancel_leg", "cancel_chain"
		Status     string `json:"status"`     // "resolved_in_favor", "resolved_against", "cancelled_leg"
		AdminNotes string `json:"admin_notes"`
	}
	if err := c.BodyParser(&payload); err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid request body"})
	}

	// Fetch the dispute.
	var chainID string
	var legID, filedBy, againstUID int
	err = h.db.QueryRow(`
		SELECT chain_id, leg_id, filed_by, against_user_id
		FROM multiway_leg_disputes WHERE id = ? AND status IN ('open', 'under_review')
	`, disputeID).Scan(&chainID, &legID, &filedBy, &againstUID)
	if err != nil {
		return c.Status(404).JSON(models.APIResponse{Success: false, Error: "Dispute not found or already resolved"})
	}

	// Update dispute resolution.
	resolvedStatus := payload.Status
	if resolvedStatus == "" {
		resolvedStatus = "resolved_in_favor"
	}
	_, _ = h.db.Exec(`
		UPDATE multiway_leg_disputes
		SET status = ?, resolution_action = ?, admin_reviewer_id = ?, admin_notes = ?, resolved_at = NOW(), updated_at = NOW()
		WHERE id = ?
	`, resolvedStatus, payload.Resolution, adminID, payload.AdminNotes, disputeID)

	upstreamTriggered := false

	switch payload.Resolution {
	case "no_action":
		// Unfreeze the leg Ã¢â‚¬â€ restore to in_progress.
		_, _ = h.db.Exec("UPDATE multiway_trade_legs SET status = 'in_progress', updated_at = NOW() WHERE id = ?", legID)
		// Notify both parties.
		msg := "The dispute on your trade leg has been resolved Ã¢â‚¬â€ no action taken. The leg is unfrozen and you can proceed."
		for _, uid := range []int{filedBy, againstUID} {
			_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", uid, msg)
			publishNotification(uid, msg)
		}

	case "cancel_leg":
		// Cancel ONLY this leg and trigger upstream collapse for dependent legs.
		_, _ = h.db.Exec("UPDATE multiway_trade_legs SET status = 'cancelled', updated_at = NOW() WHERE id = ?", legID)
		upstreamTriggered = h.upstreamCollapse(chainID, legID)
		_, _ = h.db.Exec("UPDATE multiway_leg_disputes SET upstream_collapse_triggered = ? WHERE id = ?", upstreamTriggered, disputeID)

		// Notify the leg participants.
		msg := "The dispute on your trade leg has been resolved. This leg has been cancelled."
		for _, uid := range []int{filedBy, againstUID} {
			_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", uid, msg)
			publishNotification(uid, msg)
		}

		// Issue a strike to the party the dispute was resolved against.
		if resolvedStatus == "resolved_in_favor" {
			h.issueStrike(againstUID, chainID, "Dispute resolved against you Ã¢â‚¬â€ leg cancelled")
		}

	case "cancel_chain":
		// Full chain collapse.
		_, _ = h.db.Exec("UPDATE multiway_trade_legs SET status = 'cancelled', updated_at = NOW() WHERE chain_id = ? AND status NOT IN ('completed', 'cancelled')", chainID)
		_, _ = h.db.Exec("UPDATE multiway_trades SET status = 'cancelled', cancelled_at = NOW(), cancelled_by = ?, updated_at = NOW() WHERE chain_id = ?", adminID, chainID)
		upstreamTriggered = true
		_, _ = h.db.Exec("UPDATE multiway_leg_disputes SET upstream_collapse_triggered = TRUE WHERE id = ?", disputeID)

		// Restore the original trade.
		_, _ = h.db.Exec(`
			UPDATE trades SET status = 'pending', updated_at = NOW()
			WHERE id = (SELECT original_trade_id FROM multiway_trades WHERE chain_id = ?)
			  AND status IN ('multiway_active', 'pending_multiway')
		`, chainID)

		// Restore all products.
		_, _ = h.db.Exec(`
			UPDATE products SET status = 'available', updated_at = NOW()
			WHERE id IN (SELECT product_id FROM multiway_trade_legs WHERE chain_id = ?)
			  AND status = 'locked'
		`, chainID)

		// Notify all chain participants.
		var u1, u2, u3 int
		h.db.QueryRow("SELECT user1_id, user2_id, COALESCE(user3_id, 0) FROM multiway_trades WHERE chain_id = ?", chainID).Scan(&u1, &u2, &u3)
		msg := "The entire multi-way chain has been cancelled by an admin due to a dispute. Your items are available again."
		for _, uid := range []int{u1, u2, u3} {
			if uid > 0 {
				_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", uid, msg)
				publishNotification(uid, msg)
			}
		}

		if resolvedStatus == "resolved_in_favor" {
			h.issueStrike(againstUID, chainID, "Dispute resolved against you Ã¢â‚¬â€ entire chain cancelled by admin")
		}

	default:
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Resolution must be 'no_action', 'cancel_leg', or 'cancel_chain'"})
	}

	return c.JSON(models.APIResponse{
		Success: true,
		Message: fmt.Sprintf("Dispute resolved with action: %s", payload.Resolution),
		Data: fiber.Map{
			"dispute_id":        disputeID,
			"resolution":        payload.Resolution,
			"upstream_collapse": upstreamTriggered,
		},
	})
}

// upstreamCollapse cascades a leg cancellation to downstream legs that depend on it.
// In a 3-party chain (U1Ã¢â€ â€™U2Ã¢â€ â€™U3Ã¢â€ â€™U1), if leg 1 (U2Ã¢â€ â€™U3) is cancelled:
//   - Leg 2 (U3Ã¢â€ â€™U1) becomes impossible because U3 never received their item
//   - Leg 0 (U1Ã¢â€ â€™U2) may already be completed Ã¢â‚¬â€ that stays
//
// Returns true if any downstream legs were collapsed.
func (h *TradeHandler) upstreamCollapse(chainID string, cancelledLegID int) bool {
	// Get the cancelled leg's index.
	var cancelledIndex int
	h.db.QueryRow("SELECT leg_index FROM multiway_trade_legs WHERE id = ?", cancelledLegID).Scan(&cancelledIndex)

	// Get all legs for this chain.
	rows, err := h.db.Query(`
		SELECT id, leg_index, from_user_id, to_user_id, status
		FROM multiway_trade_legs WHERE chain_id = ? ORDER BY leg_index
	`, chainID)
	if err != nil {
		return false
	}
	defer rows.Close()

	type legInfo struct {
		id, index, from, to int
		status              string
	}
	var legs []legInfo
	for rows.Next() {
		var l legInfo
		if rows.Scan(&l.id, &l.index, &l.from, &l.to, &l.status) == nil {
			legs = append(legs, l)
		}
	}

	collapsed := false
	// Cancel downstream legs that haven't completed yet.
	// "Downstream" = legs after the cancelled one in the chain order (wrapping around).
	totalLegs := len(legs)
	for i := 1; i < totalLegs; i++ {
		downstreamIdx := (cancelledIndex + i) % totalLegs
		for _, leg := range legs {
			if leg.index == downstreamIdx && leg.status != "completed" && leg.status != "cancelled" {
				_, _ = h.db.Exec("UPDATE multiway_trade_legs SET status = 'cancelled', updated_at = NOW() WHERE id = ?", leg.id)

				// Restore the product to available.
				_, _ = h.db.Exec(`
					UPDATE products SET status = 'available', updated_at = NOW()
					WHERE id = (SELECT product_id FROM multiway_trade_legs WHERE id = ?) AND status = 'locked'
				`, leg.id)

				// Notify both parties of this leg.
				msg := "A leg in your multi-way chain has been cancelled due to a dispute on an earlier leg. Your item is available again."
				for _, uid := range []int{leg.from, leg.to} {
					_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'trade_update', ?, FALSE)", uid, msg)
					publishNotification(uid, msg)
				}
				collapsed = true
			}
		}
	}

	// If all legs are now cancelled or completed, update the chain status.
	var pendingLegs int
	h.db.QueryRow("SELECT COUNT(*) FROM multiway_trade_legs WHERE chain_id = ? AND status NOT IN ('completed', 'cancelled')", chainID).Scan(&pendingLegs)
	if pendingLegs == 0 {
		var completedLegs int
		h.db.QueryRow("SELECT COUNT(*) FROM multiway_trade_legs WHERE chain_id = ? AND status = 'completed'", chainID).Scan(&completedLegs)
		if completedLegs > 0 && completedLegs < totalLegs {
			// Partial completion Ã¢â‚¬â€ mark chain as cancelled (incomplete).
			_, _ = h.db.Exec("UPDATE multiway_trades SET status = 'cancelled', cancelled_at = NOW(), updated_at = NOW() WHERE chain_id = ?", chainID)
		}
	}

	if collapsed {
		log.Printf("Upstream collapse triggered for chain %s from leg %d: downstream legs cancelled", chainID, cancelledLegID)
	}
	return collapsed
}

// AdminGetLegDisputes returns all leg disputes with chain context for the admin dashboard.
func (h *TradeHandler) AdminGetLegDisputes(c *fiber.Ctx) error {
	page, _ := strconv.Atoi(c.Query("page", "1"))
	limit, _ := strconv.Atoi(c.Query("limit", "20"))
	statusFilter := c.Query("status", "")
	offset := (page - 1) * limit

	// Count.
	var total int
	if statusFilter != "" {
		h.db.QueryRow("SELECT COUNT(*) FROM multiway_leg_disputes WHERE status = ?", statusFilter).Scan(&total)
	} else {
		h.db.QueryRow("SELECT COUNT(*) FROM multiway_leg_disputes").Scan(&total)
	}

	// Fetch disputes with context.
	query := `
		SELECT d.id, d.chain_id, d.leg_id, d.filed_by, d.against_user_id,
		       d.reason, COALESCE(d.description, '') as description,
		       d.status, d.resolution_action, d.upstream_collapse_triggered,
		       COALESCE(d.admin_notes, '') as admin_notes,
		       d.created_at, COALESCE(d.resolved_at, '1970-01-01') as resolved_at,
		       COALESCE(filer.name, '') as filer_name,
		       COALESCE(against.name, '') as against_name,
		       COALESCE(l.leg_index, 0) as leg_index,
		       COALESCE(p.title, '') as product_title,
		       COALESCE(l.status, '') as leg_status,
		       COALESCE(mw.status, '') as chain_status,
		       d.evidence_urls
		FROM multiway_leg_disputes d
		JOIN users filer ON filer.id = d.filed_by
		JOIN users against ON against.id = d.against_user_id
		LEFT JOIN multiway_trade_legs l ON l.id = d.leg_id
		LEFT JOIN products p ON p.id = l.product_id
		LEFT JOIN multiway_trades mw ON mw.chain_id = d.chain_id
	`
	var args []interface{}
	if statusFilter != "" {
		query += " WHERE d.status = ?"
		args = append(args, statusFilter)
	}
	query += " ORDER BY d.created_at DESC LIMIT ? OFFSET ?"
	args = append(args, limit, offset)

	rows, err := h.db.Query(query, args...)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to fetch disputes"})
	}
	defer rows.Close()

	var disputes []fiber.Map
	for rows.Next() {
		var id, legID, filedBy, againstUID, legIndex int
		var chainID, reason, description, status, filerName, againstName string
		var productTitle, legStatus, chainStatus string
		var resolutionAction sql.NullString
		var adminNotes string
		var upstreamCollapse bool
		var createdAt, resolvedAt time.Time
		var evidenceJSON sql.RawBytes

		if err := rows.Scan(&id, &chainID, &legID, &filedBy, &againstUID,
			&reason, &description, &status, &resolutionAction, &upstreamCollapse,
			&adminNotes, &createdAt, &resolvedAt,
			&filerName, &againstName, &legIndex, &productTitle, &legStatus, &chainStatus, &evidenceJSON); err != nil {
			continue
		}

		// Count affected users from upstream collapse.
		var affectedUsers int
		if upstreamCollapse {
			h.db.QueryRow("SELECT COUNT(DISTINCT from_user_id) + COUNT(DISTINCT to_user_id) FROM multiway_trade_legs WHERE chain_id = ? AND status = 'cancelled'", chainID).Scan(&affectedUsers)
		}

		d := fiber.Map{
			"id":                          id,
			"chain_id":                    chainID,
			"leg_id":                      legID,
			"leg_index":                   legIndex,
			"filed_by":                    filedBy,
			"filer_name":                  filerName,
			"against_user_id":             againstUID,
			"against_name":                againstName,
			"reason":                      reason,
			"description":                 description,
			"status":                      status,
			"admin_notes":                 adminNotes,
			"upstream_collapse_triggered": upstreamCollapse,
			"affected_users":              affectedUsers,
			"product_title":               productTitle,
			"leg_status":                  legStatus,
			"chain_status":                chainStatus,
			"created_at":                  createdAt.Format("2006-01-02 15:04:05"),
			"evidence_urls":               nil,
		}
		if len(evidenceJSON) > 0 {
			var evUrls []string
			if err := json.Unmarshal(evidenceJSON, &evUrls); err == nil {
				d["evidence_urls"] = evUrls
			}
		}
		if resolutionAction.Valid {
			d["resolution_action"] = resolutionAction.String
		}
		if resolvedAt.Year() > 1970 {
			d["resolved_at"] = resolvedAt.Format("2006-01-02 15:04:05")
		}
		disputes = append(disputes, d)
	}

	return c.JSON(models.APIResponse{
		Success: true,
		Data: fiber.Map{
			"disputes":    disputes,
			"total":       total,
			"page":        page,
			"limit":       limit,
			"total_pages": (total + limit - 1) / limit,
		},
	})
}
