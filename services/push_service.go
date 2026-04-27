package services

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"strings"

	webpush "github.com/SherClockHolmes/webpush-go"
)

type PushSubscription struct {
	Endpoint string
	P256dh   string
	Auth     string
}

type PushPayload struct {
	Title string `json:"title"`
	Body  string `json:"body"`
	URL   string `json:"url"`
}

type PushService struct {
	db *sql.DB
}

func NewPushService(db *sql.DB) *PushService {
	return &PushService{db: db}
}

func PushEndpointHash(endpoint string) string {
	sum := sha256.Sum256([]byte(endpoint))
	return hex.EncodeToString(sum[:])
}

func (s *PushService) SaveSubscription(userID int, sub PushSubscription) error {
	if userID <= 0 || strings.TrimSpace(sub.Endpoint) == "" || strings.TrimSpace(sub.P256dh) == "" || strings.TrimSpace(sub.Auth) == "" {
		return fmt.Errorf("invalid push subscription")
	}

	_, err := s.db.Exec(`
		INSERT INTO push_subscriptions (user_id, endpoint, endpoint_hash, p256dh, auth)
		VALUES (?, ?, ?, ?, ?)
		ON DUPLICATE KEY UPDATE
			user_id = VALUES(user_id),
			endpoint = VALUES(endpoint),
			p256dh = VALUES(p256dh),
			auth = VALUES(auth),
			updated_at = CURRENT_TIMESTAMP
	`, userID, sub.Endpoint, PushEndpointHash(sub.Endpoint), sub.P256dh, sub.Auth)
	return err
}

func (s *PushService) DeleteSubscription(userID int, endpoint string) error {
	if userID <= 0 {
		return nil
	}
	endpoint = strings.TrimSpace(endpoint)
	if endpoint == "" {
		_, err := s.db.Exec("DELETE FROM push_subscriptions WHERE user_id = ?", userID)
		return err
	}
	_, err := s.db.Exec("DELETE FROM push_subscriptions WHERE user_id = ? AND endpoint_hash = ?", userID, PushEndpointHash(endpoint))
	return err
}

func (s *PushService) SendToUser(userID int, title, body, url, notificationType string) {
	if userID <= 0 || !PushConfigured() {
		return
	}
	if !s.pushAllowedForUser(userID, notificationType) {
		return
	}

	rows, err := s.db.Query("SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ?", userID)
	if err != nil {
		log.Printf("push subscriptions query failed for user %d: %v", userID, err)
		return
	}
	defer rows.Close()

	for rows.Next() {
		var sub PushSubscription
		if err := rows.Scan(&sub.Endpoint, &sub.P256dh, &sub.Auth); err != nil {
			continue
		}
		resp, err := sendPushNotificationResponse(sub, title, body, url)
		if err != nil {
			log.Printf("push notification failed for user %d: %v", userID, err)
			continue
		}
		if resp == nil {
			continue
		}
		io.Copy(io.Discard, resp.Body)
		resp.Body.Close()
		if resp.StatusCode == http.StatusGone || resp.StatusCode == http.StatusNotFound {
			_ = s.DeleteSubscription(userID, sub.Endpoint)
		}
		if resp.StatusCode >= 400 && resp.StatusCode != http.StatusGone && resp.StatusCode != http.StatusNotFound {
			log.Printf("push notification returned HTTP %d for user %d", resp.StatusCode, userID)
		}
	}
}

func SendPushNotification(sub PushSubscription, title, body, url string) error {
	resp, err := sendPushNotificationResponse(sub, title, body, url)
	if resp != nil {
		io.Copy(io.Discard, resp.Body)
		resp.Body.Close()
	}
	return err
}

func sendPushNotificationResponse(sub PushSubscription, title, body, url string) (*http.Response, error) {
	if !PushConfigured() {
		return nil, nil
	}
	payload, err := json.Marshal(PushPayload{
		Title: fallbackString(title, "CloviaPH"),
		Body:  fallbackString(body, "You have a new CloviaPH update."),
		URL:   fallbackString(url, "/notifications"),
	})
	if err != nil {
		return nil, err
	}

	return webpush.SendNotification(payload, &webpush.Subscription{
		Endpoint: sub.Endpoint,
		Keys: webpush.Keys{
			P256dh: sub.P256dh,
			Auth:   sub.Auth,
		},
	}, &webpush.Options{
		Subscriber:      fallbackString(os.Getenv("VAPID_SUBJECT"), "mailto:support@cloviaph.site"),
		VAPIDPublicKey:  os.Getenv("VAPID_PUBLIC_KEY"),
		VAPIDPrivateKey: os.Getenv("VAPID_PRIVATE_KEY"),
		TTL:             30,
	})
}

func PushConfigured() bool {
	return strings.TrimSpace(os.Getenv("VAPID_PUBLIC_KEY")) != "" && strings.TrimSpace(os.Getenv("VAPID_PRIVATE_KEY")) != ""
}

func fallbackString(value, fallback string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	return value
}

func (s *PushService) pushAllowedForUser(userID int, notificationType string) bool {
	var enabled bool
	var rawPrefs sql.NullString
	if err := s.db.QueryRow("SELECT COALESCE(push_notifications_enabled, TRUE), notification_preferences FROM users WHERE id = ?", userID).Scan(&enabled, &rawPrefs); err != nil {
		return false
	}
	if !enabled {
		return false
	}

	key := preferenceKeyForNotificationType(notificationType)
	if key == "" || !rawPrefs.Valid || strings.TrimSpace(rawPrefs.String) == "" {
		return true
	}
	var prefs map[string]bool
	if err := json.Unmarshal([]byte(rawPrefs.String), &prefs); err != nil {
		return true
	}
	allowed, exists := prefs[key]
	return !exists || allowed
}

func preferenceKeyForNotificationType(notificationType string) string {
	switch strings.TrimSpace(notificationType) {
	case "trade_offer":
		return "offers_received"
	case "offer_accepted":
		return "offers_accepted"
	case "offer_rejected":
		return "offers_rejected"
	case "trade_update":
		return "trade_updates"
	case "chat_message":
		return "chat_messages"
	case "meetup_update":
		return "meetup_updates"
	case "review_reminder":
		return "review_reminders"
	case "trade_loop":
		return "multiway_trades"
	default:
		return ""
	}
}
