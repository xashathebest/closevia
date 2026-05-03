package handlers

import (
	"database/sql"
	"time"

	"github.com/gofiber/fiber/v2"
)

type receivedTradeReviewStats struct {
	AvgRating       sql.NullFloat64
	TotalReviews    int
	PositivePercent sql.NullFloat64
}

const receivedTradeReviewsSubquery = `
	SELECT
		CONCAT('trade_review:', tr.id) AS review_key,
		tr.id AS review_id,
		tr.trade_id,
		tr.reviewer_id,
		u.name AS reviewer_name,
		u.profile_picture AS reviewer_avatar,
		tr.rating,
		COALESCE(tr.feedback, '') AS feedback,
		tr.created_at,
		COALESCE(p.title, 'Trade item') AS product_title
	FROM trade_reviews tr
	JOIN trades t ON t.id = tr.trade_id
	JOIN users u ON u.id = tr.reviewer_id
	LEFT JOIN products p ON p.id = t.target_product_id
	WHERE COALESCE(tr.is_followup, 0) = 0
	  AND COALESCE(tr.is_auto_generated, 0) = 0
	  AND tr.rating BETWEEN 1 AND 5
	  AND t.status IN ('completed', 'auto_completed')
	  AND (
		(tr.reviewer_id = t.buyer_id AND t.seller_id = ?)
		OR
		(tr.reviewer_id = t.seller_id AND t.buyer_id = ?)
	  )

	UNION ALL

	SELECT
		CONCAT('trade_buyer:', t.id) AS review_key,
		0 AS review_id,
		t.id AS trade_id,
		t.buyer_id AS reviewer_id,
		u.name AS reviewer_name,
		u.profile_picture AS reviewer_avatar,
		t.buyer_rating AS rating,
		COALESCE(t.buyer_feedback, '') AS feedback,
		COALESCE(t.buyer_review_created_at, t.updated_at, t.created_at) AS created_at,
		COALESCE(p.title, 'Trade item') AS product_title
	FROM trades t
	JOIN users u ON u.id = t.buyer_id
	LEFT JOIN products p ON p.id = t.target_product_id
	WHERE t.seller_id = ?
	  AND t.status IN ('completed', 'auto_completed')
	  AND t.buyer_rating BETWEEN 1 AND 5
	  AND NOT EXISTS (
		SELECT 1
		FROM trade_reviews tr
		WHERE tr.trade_id = t.id
		  AND tr.reviewer_id = t.buyer_id
		  AND COALESCE(tr.is_followup, 0) = 0
	  )

	UNION ALL

	SELECT
		CONCAT('trade_seller:', t.id) AS review_key,
		0 AS review_id,
		t.id AS trade_id,
		t.seller_id AS reviewer_id,
		u.name AS reviewer_name,
		u.profile_picture AS reviewer_avatar,
		t.seller_rating AS rating,
		COALESCE(t.seller_feedback, '') AS feedback,
		COALESCE(t.seller_review_created_at, t.updated_at, t.created_at) AS created_at,
		COALESCE(p.title, 'Trade item') AS product_title
	FROM trades t
	JOIN users u ON u.id = t.seller_id
	LEFT JOIN products p ON p.id = t.target_product_id
	WHERE t.buyer_id = ?
	  AND t.status IN ('completed', 'auto_completed')
	  AND t.seller_rating BETWEEN 1 AND 5
	  AND NOT EXISTS (
		SELECT 1
		FROM trade_reviews tr
		WHERE tr.trade_id = t.id
		  AND tr.reviewer_id = t.seller_id
		  AND COALESCE(tr.is_followup, 0) = 0
	  )
`

func getReceivedTradeReviewStats(db *sql.DB, userID int) (receivedTradeReviewStats, error) {
	var stats receivedTradeReviewStats
	var totalReviews sql.NullInt64
	err := db.QueryRow(`
		SELECT
			AVG(rating) AS avg_rating,
			COUNT(*) AS total_reviews,
			SUM(CASE WHEN rating >= 4 THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*), 0) AS positive_feedback
		FROM (`+receivedTradeReviewsSubquery+`) received_reviews
	`, userID, userID, userID, userID).Scan(&stats.AvgRating, &totalReviews, &stats.PositivePercent)
	if err != nil {
		return stats, err
	}
	if totalReviews.Valid {
		stats.TotalReviews = int(totalReviews.Int64)
	}
	return stats, nil
}

func getReceivedTradeReviews(db *sql.DB, userID int) ([]fiber.Map, error) {
	rows, err := db.Query(`
		SELECT review_key, review_id, trade_id, reviewer_id, reviewer_name, reviewer_avatar,
		       rating, feedback, created_at, product_title
		FROM (`+receivedTradeReviewsSubquery+`) received_reviews
		ORDER BY created_at DESC
	`, userID, userID, userID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	reviews := []fiber.Map{}
	for rows.Next() {
		var reviewKey string
		var reviewID, tradeID, reviewerID, rating int
		var reviewerName, feedback, productTitle string
		var reviewerAvatar sql.NullString
		var createdAt time.Time
		if err := rows.Scan(
			&reviewKey,
			&reviewID,
			&tradeID,
			&reviewerID,
			&reviewerName,
			&reviewerAvatar,
			&rating,
			&feedback,
			&createdAt,
			&productTitle,
		); err != nil {
			continue
		}

		avatar := ""
		if reviewerAvatar.Valid {
			avatar = reviewerAvatar.String
		}
		idValue := interface{}(reviewID)
		if reviewID == 0 {
			idValue = reviewKey
		}

		reviews = append(reviews, fiber.Map{
			"id":              idValue,
			"source":          "trade_reviews",
			"trade_id":        tradeID,
			"transaction_id":  tradeID,
			"reviewer_id":     reviewerID,
			"reviewer":        reviewerName,
			"avatar":          avatar,
			"rating":          rating,
			"comment":         feedback,
			"feedback":        feedback,
			"date":            createdAt.Format("2006-01-02"),
			"created_at":      createdAt,
			"product_title":   productTitle,
			"is_trade_review": true,
		})
	}
	return reviews, rows.Err()
}
