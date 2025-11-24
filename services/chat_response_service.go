package services

import (
	"database/sql"
	"math"
	"time"
)

// ResponseMetrics represents chat response metrics for a user
type ResponseMetrics struct {
	AverageResponseTimeHours float64  `json:"average_response_time_hours"`
	AverageResponseTimeMins  float64  `json:"average_response_time_mins"`
	ResponseRate             float64  `json:"response_rate"` // 0.0 to 1.0
	TotalMessages            int      `json:"total_messages"`
	TotalResponses           int      `json:"total_responses"`
	ResponseScore            float64  `json:"response_score"` // 0.0 to 1.0, higher is better
	LastResponseAt           *time.Time `json:"last_response_at,omitempty"`
	Rating                   string   `json:"rating"` // "excellent", "good", "average", "poor"
}

// CalculateResponseMetrics calculates response metrics for a user based on their chat history
func CalculateResponseMetrics(db *sql.DB, userID int) (ResponseMetrics, error) {
	metrics := ResponseMetrics{
		ResponseRate:   0.0,
		ResponseScore:  0.0,
		TotalMessages: 0,
		TotalResponses: 0,
	}

	// Get all conversations where user is a participant
	rows, err := db.Query(`
		SELECT id, buyer_id, seller_id 
		FROM conversations 
		WHERE buyer_id = ? OR seller_id = ?
	`, userID, userID)
	if err != nil {
		return metrics, err
	}
	defer rows.Close()

	var conversationIDs []int
	var partnerIDs []int // IDs of conversation partners

	for rows.Next() {
		var convID, buyerID, sellerID int
		if err := rows.Scan(&convID, &buyerID, &sellerID); err != nil {
			continue
		}
		conversationIDs = append(conversationIDs, convID)
		if buyerID == userID {
			partnerIDs = append(partnerIDs, sellerID)
		} else {
			partnerIDs = append(partnerIDs, buyerID)
		}
	}

	if len(conversationIDs) == 0 {
		return metrics, nil
	}

	// Get all messages in these conversations, ordered by conversation and time
	messageRows, err := db.Query(`
		SELECT conversation_id, sender_id, created_at
		FROM messages
		WHERE conversation_id IN (
			SELECT id FROM conversations WHERE buyer_id = ? OR seller_id = ?
		)
		ORDER BY conversation_id, created_at ASC
	`, userID, userID)
	if err != nil {
		return metrics, err
	}
	defer messageRows.Close()

	type Message struct {
		ConversationID int
		SenderID        int
		CreatedAt       time.Time
	}

	var messages []Message
	for messageRows.Next() {
		var m Message
		if err := messageRows.Scan(&m.ConversationID, &m.SenderID, &m.CreatedAt); err != nil {
			continue
		}
		messages = append(messages, m)
		metrics.TotalMessages++
	}

	// Calculate response times
	var responseTimes []float64 // in hours
	var lastPartnerMessageTime *time.Time
	var lastUserResponseTime *time.Time

	for i, msg := range messages {
		if msg.SenderID != userID {
			// Partner sent a message
			lastPartnerMessageTime = &msg.CreatedAt
		} else {
			// User sent a message
			if lastPartnerMessageTime != nil {
				// This is a response to partner's message
				responseTime := msg.CreatedAt.Sub(*lastPartnerMessageTime).Hours()
				if responseTime > 0 && responseTime < 168 { // Only count responses within 7 days
					responseTimes = append(responseTimes, responseTime)
					metrics.TotalResponses++
				}
				lastPartnerMessageTime = nil
			}
			lastUserResponseTime = &msg.CreatedAt
		}

		// Check if this is the last message in conversation
		if i == len(messages)-1 || (i < len(messages)-1 && messages[i+1].ConversationID != msg.ConversationID) {
			// Reset for next conversation
			lastPartnerMessageTime = nil
		}
	}

	// Calculate average response time
	if len(responseTimes) > 0 {
		var sum float64
		for _, rt := range responseTimes {
			sum += rt
		}
		metrics.AverageResponseTimeHours = sum / float64(len(responseTimes))
		metrics.AverageResponseTimeMins = metrics.AverageResponseTimeHours * 60
	}

	// Calculate response rate
	// Count messages from partners that should have been responded to
	partnerMessageCount := 0
	for _, msg := range messages {
		if msg.SenderID != userID {
			partnerMessageCount++
		}
	}

	if partnerMessageCount > 0 {
		metrics.ResponseRate = float64(metrics.TotalResponses) / float64(partnerMessageCount)
	}

	// Calculate response score (0.0 to 1.0)
	// Based on response rate and average response time
	rateScore := metrics.ResponseRate * 0.6 // 60% weight on response rate

	// Time score: faster responses = higher score
	// Excellent: < 1 hour, Good: < 6 hours, Average: < 24 hours, Poor: > 24 hours
	timeScore := 0.0
	if metrics.AverageResponseTimeHours > 0 {
		if metrics.AverageResponseTimeHours < 1 {
			timeScore = 1.0
		} else if metrics.AverageResponseTimeHours < 6 {
			timeScore = 0.8
		} else if metrics.AverageResponseTimeHours < 24 {
			timeScore = 0.6
		} else if metrics.AverageResponseTimeHours < 48 {
			timeScore = 0.4
		} else {
			timeScore = 0.2
		}
	} else if metrics.TotalMessages > 0 {
		// No responses yet, but has messages
		timeScore = 0.1
	} else {
		// No messages at all
		timeScore = 0.5 // Neutral score
	}

	metrics.ResponseScore = rateScore + (timeScore * 0.4) // 40% weight on response time
	metrics.ResponseScore = math.Min(metrics.ResponseScore, 1.0)

	// Determine rating
	if metrics.ResponseScore >= 0.8 {
		metrics.Rating = "excellent"
	} else if metrics.ResponseScore >= 0.6 {
		metrics.Rating = "good"
	} else if metrics.ResponseScore >= 0.4 {
		metrics.Rating = "average"
	} else {
		metrics.Rating = "poor"
	}

	metrics.LastResponseAt = lastUserResponseTime

	return metrics, nil
}



