package handlers

import (
	"bufio"
	"encoding/json"
	"fmt"
	"strconv"
	"sync"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/xashathebest/clovia/database"
	"github.com/xashathebest/clovia/middleware"
	"github.com/xashathebest/clovia/models"
	"github.com/xashathebest/clovia/utils"
	"github.com/xashathebest/clovia/services"
)

type ChatHandler struct{}

func NewChatHandler() *ChatHandler { return &ChatHandler{} }

// SSE subscribers map: userID -> list of channels
var userStreams = struct {
	sync.RWMutex
	m map[int][]chan []byte
}{m: make(map[int][]chan []byte)}

type sseEvent struct {
	Type string      `json:"type"`
	Data interface{} `json:"data"`
}

// Stream provides an SSE stream for the authenticated user
func (h *ChatHandler) Stream(c *fiber.Ctx) error {
	// Try to get user ID from context first
	userID, ok := middleware.GetUserIDFromContext(c)

	// If not in context, try to get from token query parameter
	if !ok {
		token := c.Query("token")
		if token == "" {
			// Debug: no token provided
			fmt.Println("Chat Stream: missing token in query")
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{
				"success": false,
				"error":   "Missing authentication token",
			})
		}


		// Validate the JWT token directly to avoid calling middleware handler inline
		claims, err := utils.ValidateJWT(token)
		// Set the token in the Authorization header
		c.Request().Header.Set("Authorization", "Bearer "+token)

		// Validate the token
		// err := middleware.AuthMiddleware()(c)

		if err != nil {
			fmt.Printf("Chat Stream: token validation failed (len=%d) err=%v\n", len(token), err)
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"success": false, "error": "Invalid or expired token"})
		}

		// Extract claims and set them into context so downstream code can use them
		uidFloat, okUID := claims["user_id"].(float64)
		emailStr, okEmail := claims["email"].(string)
		if !okUID || !okEmail {
			fmt.Println("Chat Stream: token validated but claims missing user_id/email")
			return c.Status(fiber.StatusUnauthorized).JSON(fiber.Map{"success": false, "error": "Invalid token claims"})
		}
		uid := int(uidFloat)
		c.Locals("user_id", uid)
		c.Locals("user_email", emailStr)
		userID = uid
		ok = true
		fmt.Printf("Chat Stream: authenticated user %d via token in query\n", userID)
	}
	c.Set("Content-Type", "text/event-stream")
	c.Set("Cache-Control", "no-cache")
	c.Set("Connection", "keep-alive")

	msgCh := make(chan []byte, 32)
	// register
	userStreams.Lock()
	userStreams.m[userID] = append(userStreams.m[userID], msgCh)
	userStreams.Unlock()

	// cleanup on finish
	defer func() {
		userStreams.Lock()
		subs := userStreams.m[userID]
		for i, ch := range subs {
			if ch == msgCh {
				userStreams.m[userID] = append(subs[:i], subs[i+1:]...)
				break
			}
		}
		userStreams.Unlock()
		close(msgCh)
	}()

	c.Context().SetBodyStreamWriter(func(w *bufio.Writer) {
		for {
			if b, ok := <-msgCh; ok {
				w.WriteString("data: ")
				w.Write(b)
				w.WriteString("\n\n")
				w.Flush()
			} else {
				break
			}
		}
	})
	return nil
}

// helper to publish an event to a user
func publishToUser(userID int, evt sseEvent) {
	userStreams.RLock()
	subs := userStreams.m[userID]
	userStreams.RUnlock()
	if len(subs) == 0 {
		return
	}
	payload, _ := json.Marshal(evt)
	for _, ch := range subs {
		select {
		case ch <- payload:
		default:
		}
	}
}

// Helper to publish notification event
func publishNotification(userID int, message string) {
	publishToUser(userID, sseEvent{Type: "notification", Data: fiber.Map{"message": message}})
}

// EnsureConversation creates or returns an existing conversation
func (h *ChatHandler) EnsureConversation(c *fiber.Ctx) error {
	var p struct{ ProductID, BuyerID, SellerID int }
	if err := c.BodyParser(&p); err != nil {
		return fiber.ErrBadRequest
	}
	id, err := ensureConversation(p.ProductID, p.BuyerID, p.SellerID)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to start conversation"})
	}
	return c.JSON(models.APIResponse{Success: true, Data: fiber.Map{"conversation_id": id}})
}

// SendMessage saves message and notifies participants
func (h *ChatHandler) SendMessage(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return fiber.ErrUnauthorized
	}
	var p struct {
		ConversationID int
		Content        string
	}
	if err := c.BodyParser(&p); err != nil {
		return fiber.ErrBadRequest
	}
	if p.ConversationID == 0 || p.Content == "" {
		return fiber.ErrBadRequest
	}
	msgID, createdAt, err := saveMessage(p.ConversationID, userID, p.Content)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to send message"})
	}
	participants := getConversationParticipants(p.ConversationID)
	evt := sseEvent{Type: "message", Data: fiber.Map{
		"id":              msgID,
		"conversation_id": p.ConversationID,
		"sender_id":       userID,
		"content":         p.Content,
		"created_at":      createdAt,
	}}
	for _, pid := range participants {
		publishToUser(pid, evt)
	}
	return c.JSON(models.APIResponse{Success: true})
}

// Typing event notify
func (h *ChatHandler) Typing(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return fiber.ErrUnauthorized
	}
	var p struct{ ConversationID int }
	if err := c.BodyParser(&p); err != nil {
		return fiber.ErrBadRequest
	}
	participants := getConversationParticipants(p.ConversationID)
	evt := sseEvent{Type: "typing", Data: fiber.Map{"conversation_id": p.ConversationID, "user_id": userID}}
	for _, pid := range participants {
		if pid == userID {
			continue
		}
		publishToUser(pid, evt)
	}
	return c.JSON(models.APIResponse{Success: true})
}

func ensureConversation(productID, buyerID, sellerID int) (int, error) {
	var id int
	err := database.DB.QueryRow("SELECT id FROM conversations WHERE product_id = ? AND buyer_id = ? AND seller_id = ?", productID, buyerID, sellerID).Scan(&id)
	if err == nil {
		return id, nil
	}
	res, err := database.DB.Exec("INSERT INTO conversations (product_id, buyer_id, seller_id) VALUES (?, ?, ?)", productID, buyerID, sellerID)
	if err != nil {
		return 0, err
	}
	lastID, _ := res.LastInsertId()
	return int(lastID), nil
}

func saveMessage(conversationID, senderID int, content string) (int, time.Time, error) {
	res, err := database.DB.Exec("INSERT INTO messages (conversation_id, sender_id, content) VALUES (?, ?, ?)", conversationID, senderID, content)
	if err != nil {
		return 0, time.Now(), err
	}
	id64, _ := res.LastInsertId()
	var createdAt time.Time
	_ = database.DB.QueryRow("SELECT created_at FROM messages WHERE id = ?", id64).Scan(&createdAt)

	// Update response metrics in background (non-blocking)
	go updateUserResponseMetrics(senderID)

	return int(id64), createdAt, nil
}

// updateUserResponseMetrics updates response metrics for a user
func updateUserResponseMetrics(userID int) {
	metrics, err := services.CalculateResponseMetrics(database.DB, userID)
	if err != nil {
		return
	}

	// Update user's response metrics in database
	_, _ = database.DB.Exec(`
		UPDATE users 
		SET response_score = ?, 
		    average_response_time_hours = ?, 
		    response_rate = ?, 
		    response_rating = ?,
		    last_response_at = ?
		WHERE id = ?
	`, metrics.ResponseScore, metrics.AverageResponseTimeHours, metrics.ResponseRate,
		metrics.Rating, metrics.LastResponseAt, userID)
}

func getConversationParticipants(conversationID int) []int {
	var buyerID, sellerID int
	if err := database.DB.QueryRow("SELECT buyer_id, seller_id FROM conversations WHERE id = ?", conversationID).Scan(&buyerID, &sellerID); err != nil {
		return []int{}
	}
	return []int{buyerID, sellerID}
}

// Existing endpoints for listing conversations/messages
func (h *ChatHandler) GetConversations(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return fiber.ErrUnauthorized
	}
	rows, err := database.DB.Query("SELECT id, product_id, buyer_id, seller_id, created_at, updated_at FROM conversations WHERE buyer_id = ? OR seller_id = ? ORDER BY updated_at DESC", userID, userID)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to get conversations"})
	}
	defer rows.Close()
	var list []models.ChatConversation
	for rows.Next() {
		var conv models.ChatConversation
		if err := rows.Scan(&conv.ID, &conv.ProductID, &conv.BuyerID, &conv.SellerID, &conv.CreatedAt, &conv.UpdatedAt); err == nil {
			list = append(list, conv)
		}
	}
	return c.JSON(models.APIResponse{Success: true, Data: list})
}

func (h *ChatHandler) GetMessages(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return fiber.ErrUnauthorized
	}
	convID, _ := strconv.Atoi(c.Params("id"))
	var buyerID, sellerID int
	if err := database.DB.QueryRow("SELECT buyer_id, seller_id FROM conversations WHERE id = ?", convID).Scan(&buyerID, &sellerID); err != nil {
		return fiber.ErrNotFound
	}
	if userID != buyerID && userID != sellerID {
		return fiber.ErrForbidden
	}
	rows, err := database.DB.Query("SELECT id, conversation_id, sender_id, content, created_at, read_at FROM messages WHERE conversation_id = ? ORDER BY created_at ASC", convID)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to get messages"})
	}
	defer rows.Close()
	var list []models.ChatMessage
	for rows.Next() {
		var m models.ChatMessage
		var readAtNullable *time.Time
		if err := rows.Scan(&m.ID, &m.ConversationID, &m.SenderID, &m.Content, &m.CreatedAt, &readAtNullable); err == nil {
			m.ReadAt = readAtNullable
			list = append(list, m)
		}
	}
	return c.JSON(models.APIResponse{Success: true, Data: list})
}
