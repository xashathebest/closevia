package handlers

import (
	"database/sql"
	"fmt"
	"log"
	"strconv"

	"github.com/xashathebest/clovia/middleware"
	"github.com/xashathebest/clovia/models"

	"github.com/gofiber/fiber/v2"
)

// SubmitTradeReview handles initial review submission or follow-up review
// POST /api/trades/{id}/reviews
func (h *TradeHandler) SubmitTradeReview(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}

	tradeID, err := strconv.Atoi(c.Params("id"))
	if err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid trade id"})
	}

	var payload models.TradeReviewCreate
	if err := c.BodyParser(&payload); err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid request body"})
	}

	// Validate rating
	if payload.Rating < 1 || payload.Rating > 5 {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Rating must be between 1 and 5"})
	}

	// Fetch trade details
	var buyerID, sellerID int
	var tradeOption string
	var buyerCompleted, sellerCompleted bool
	var buyerRating, sellerRating sql.NullInt64

	err = h.db.QueryRow(`
		SELECT buyer_id, seller_id, COALESCE(trade_option, 'meetup'), 
		       buyer_completed, seller_completed, buyer_rating, seller_rating
		FROM trades WHERE id = ?`,
		tradeID,
	).Scan(&buyerID, &sellerID, &tradeOption, &buyerCompleted, &sellerCompleted, &buyerRating, &sellerRating)
	if err != nil {
		return c.Status(404).JSON(models.APIResponse{Success: false, Error: "Trade not found"})
	}

	// Verify user is a participant
	if userID != buyerID && userID != sellerID {
		return c.Status(403).JSON(models.APIResponse{Success: false, Error: "Not authorized for this trade"})
	}

	// Enforce photo evidence rule for meetup and delivery trades (for initial reviews)
	if !payload.IsFollowup && (tradeOption == "meetup" || tradeOption == "delivery") {
		if payload.ProofURL == "" {
			return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Photo evidence is mandatory for " + tradeOption + " trades"})
		}
		if !payload.IsCameraPhoto {
			return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Photo evidence must be taken using the in-app camera"})
		}
	}

	// Check if initial review already exists
	var initialReviewID int
	var initialRating int
	err = h.db.QueryRow(`
		SELECT id, rating FROM trade_reviews 
		WHERE trade_id = ? AND reviewer_id = ? AND is_followup = FALSE`,
		tradeID, userID,
	).Scan(&initialReviewID, &initialRating)

	hasInitialReview := err == nil
	if err != nil && err != sql.ErrNoRows {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Database error checking initial review"})
	}

	// If not followup but initial exists, prevent overwrite
	if !payload.IsFollowup && hasInitialReview {
		return c.Status(409).JSON(models.APIResponse{Success: false, Error: "Initial review already submitted. Use follow-up to update."})
	}

	// If followup but no initial, prevent (must submit initial first)
	if payload.IsFollowup && !hasInitialReview {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Submit initial review before submitting follow-up"})
	}

	// Calculate rating delta for followups
	ratingDelta := 0
	if payload.IsFollowup && hasInitialReview {
		ratingDelta = payload.Rating - initialRating
	}

	// Insert review into trade_reviews table
	result, err := h.db.Exec(`
		INSERT INTO trade_reviews 
		(trade_id, reviewer_id, rating, feedback, proof_url, is_camera_photo, is_followup, is_auto_generated, rating_delta)
		VALUES (?, ?, ?, ?, ?, ?, ?, FALSE, ?)`,
		tradeID, userID, payload.Rating, payload.Feedback, payload.ProofURL,
		payload.IsCameraPhoto, payload.IsFollowup, ratingDelta,
	)
	if err != nil {
		log.Printf("Error inserting review: %v", err)
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to submit review"})
	}

	reviewID, _ := result.LastInsertId()

	// For MUTUAL TRADES: also insert review record for the paired trade
	// This ensures the review appears regardless of which trade record is viewed
	var pairedTradeID int
	err = h.db.QueryRow(`
		SELECT id FROM trades
		WHERE buyer_id = ? AND seller_id = ? 
		AND status IN ('pending', 'accepted', 'active', 'awaiting_confirmation')
		LIMIT 1
	`, sellerID, buyerID).Scan(&pairedTradeID)

	if err == nil && pairedTradeID > 0 && pairedTradeID != tradeID {
		// Found a paired mutual trade - insert the same review for that trade too
		log.Printf("[MUTUAL REVIEW SYNC] Inserting review copy for paired trade %d (main: %d, reviewer: %d)", pairedTradeID, tradeID, userID)
		_, _ = h.db.Exec(`
			INSERT INTO trade_reviews 
			(trade_id, reviewer_id, rating, feedback, proof_url, is_camera_photo, is_followup, is_auto_generated, rating_delta)
			VALUES (?, ?, ?, ?, ?, ?, ?, FALSE, ?)`,
			pairedTradeID, userID, payload.Rating, payload.Feedback, payload.ProofURL,
			payload.IsCameraPhoto, payload.IsFollowup, ratingDelta,
		)
	}

	// Update trades table with latest review data
	var ratingCol, feedbackCol, proofCol, cameraCol, lockedCol, timestampCol string
	if userID == buyerID {
		ratingCol = "buyer_rating"
		feedbackCol = "buyer_feedback"
		proofCol = "buyer_proof_url"
		cameraCol = "buyer_photo_is_camera"
		lockedCol = "buyer_initial_review_locked"
		timestampCol = "buyer_review_created_at"
	} else {
		ratingCol = "seller_rating"
		feedbackCol = "seller_feedback"
		proofCol = "seller_proof_url"
		cameraCol = "seller_photo_is_camera"
		lockedCol = "seller_initial_review_locked"
		timestampCol = "seller_review_created_at"
	}

	// Lock initial review
	updateQuery := fmt.Sprintf(`
		UPDATE trades 
		SET %s=?, %s=?, %s=?, %s=?, %s=TRUE, %s=NOW(), updated_at=CURRENT_TIMESTAMP
		WHERE id = ?`,
		ratingCol, feedbackCol, proofCol, cameraCol, lockedCol, timestampCol,
	)

	_, err = h.db.Exec(updateQuery, payload.Rating, payload.Feedback, payload.ProofURL, payload.IsCameraPhoto, tradeID)
	if err != nil {
		log.Printf("Error updating trade: %v", err)
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to finalize review submission"})
	}

	// For MUTUAL TRADES: also update the paired trade record with the same review data
	if pairedTradeID > 0 && pairedTradeID != tradeID {
		// On the paired trade, the user's role is reversed
		// If they were buyer on tradeID, they're seller on pairedTradeID (roles reversed)
		pairedRatingCol := ratingCol
		pairedFeedbackCol := feedbackCol
		pairedProofCol := proofCol
		pairedCameraCol := cameraCol
		pairedLockedCol := lockedCol
		pairedTimestampCol := timestampCol

		if userID == buyerID {
			// User was buyer on main trade, so they're seller on paired trade
			pairedRatingCol = "seller_rating"
			pairedFeedbackCol = "seller_feedback"
			pairedProofCol = "seller_proof_url"
			pairedCameraCol = "seller_photo_is_camera"
			pairedLockedCol = "seller_initial_review_locked"
			pairedTimestampCol = "seller_review_created_at"
		} else {
			// User was seller on main trade, so they're buyer on paired trade
			pairedRatingCol = "buyer_rating"
			pairedFeedbackCol = "buyer_feedback"
			pairedProofCol = "buyer_proof_url"
			pairedCameraCol = "buyer_photo_is_camera"
			pairedLockedCol = "buyer_initial_review_locked"
			pairedTimestampCol = "buyer_review_created_at"
		}

		pairedUpdateQuery := fmt.Sprintf(`
			UPDATE trades 
			SET %s=?, %s=?, %s=?, %s=?, %s=TRUE, %s=NOW(), updated_at=CURRENT_TIMESTAMP
			WHERE id = ?`,
			pairedRatingCol, pairedFeedbackCol, pairedProofCol, pairedCameraCol, pairedLockedCol, pairedTimestampCol,
		)

		_, _ = h.db.Exec(pairedUpdateQuery, payload.Rating, payload.Feedback, payload.ProofURL, payload.IsCameraPhoto, pairedTradeID)
	}

	// Mark current user as having completed their review (initial only, not followups)
	if !payload.IsFollowup {
		completedCol := "buyer_completed"
		if userID == sellerID {
			completedCol = "seller_completed"
		}
		_, _ = h.db.Exec(fmt.Sprintf("UPDATE trades SET %s=TRUE, updated_at=CURRENT_TIMESTAMP WHERE id = ?", completedCol), tradeID)

		// For MUTUAL TRADES: also update the paired trade record
		// Find the reverse/paired trade where roles are swapped
		var pairedTradeID int
		err = h.db.QueryRow(`
			SELECT id FROM trades
			WHERE buyer_id = ? AND seller_id = ? 
			AND status IN ('pending', 'accepted', 'active', 'awaiting_confirmation')
			LIMIT 1
		`, sellerID, buyerID).Scan(&pairedTradeID)

		if err == nil && pairedTradeID > 0 && pairedTradeID != tradeID {
			// Found a paired mutual trade - update its corresponding completion flag
			log.Printf("[MUTUAL TRADE SYNC] Found paired trade %d for mutual pair (%d↔%d). Syncing review flags.", pairedTradeID, buyerID, sellerID)

			// On the paired trade, the roles are reversed:
			// - Original: userID is buyer/seller on tradeID
			// - Paired: userID is seller/buyer on pairedTradeID (roles reversed)
			pairedCompletedCol := "seller_completed" // If userID was buyer on tradeID, they're seller on pairedTradeID
			if userID == sellerID {
				pairedCompletedCol = "buyer_completed" // If userID was seller on tradeID, they're buyer on pairedTradeID
			}
			_, _ = h.db.Exec(fmt.Sprintf("UPDATE trades SET %s=TRUE, updated_at=CURRENT_TIMESTAMP WHERE id = ?", pairedCompletedCol), pairedTradeID)
		}
	}

	// Check if both parties have submitted initial reviews
	var buyerReviewCount, sellerReviewCount int
	h.db.QueryRow(`
		SELECT 
			COALESCE((SELECT COUNT(*) FROM trade_reviews WHERE trade_id = ? AND reviewer_id = ? AND is_followup = FALSE), 0),
			COALESCE((SELECT COUNT(*) FROM trade_reviews WHERE trade_id = ? AND reviewer_id = ? AND is_followup = FALSE), 0)`,
		tradeID, buyerID, tradeID, sellerID,
	).Scan(&buyerReviewCount, &sellerReviewCount)

	// Setup the other user ID
	otherUserID := sellerID
	if userID == sellerID {
		otherUserID = buyerID
	}

	// Notify the other user about the review
	if !payload.IsFollowup {
		msg := "Your trading partner has submitted their review. Please submit yours to finalize the trade!"
		insertTradeNotification(h.db, otherUserID, "trade_update", msg, tradeID)
		publishToUser(otherUserID, sseEvent{Type: "trade_review_submitted", Data: fiber.Map{"trade_id": tradeID}})
		sendPushToUser(otherUserID, "Review reminder", msg, tradeDeepLink(tradeID), "review_reminder")
	} else {
		msg := "Your trading partner has updated their review."
		insertTradeNotification(h.db, otherUserID, "trade_update", msg, tradeID)
		publishToUser(otherUserID, sseEvent{Type: "trade_review_updated", Data: fiber.Map{"trade_id": tradeID}})
		sendPushToUser(otherUserID, "Review updated", msg, tradeDeepLink(tradeID), "trade_update")
	}

	// Auto-complete when both parties have submitted initial reviews.
	autoCompleted := false
	if buyerReviewCount > 0 && sellerReviewCount > 0 && !payload.IsFollowup {
		// 8a: Guard — don't finalize an already-terminal trade.
		var currentStatus string
		_ = h.db.QueryRow("SELECT status FROM trades WHERE id=?", tradeID).Scan(&currentStatus)
		if currentStatus == "cancelled" || currentStatus == "completed" || currentStatus == "auto_completed" || currentStatus == "did_not_push_through" || currentStatus == "under_review" {
			goto skipAutoComplete
		}

		// 8b: For meetup/pickup trades the caller must have confirmed GPS arrival first.
		if tradeOption == "meetup" || tradeOption == "pickup" {
			if err := validateArrivalConfirmed(h.db, tradeID, userID); err != nil {
				log.Printf("[SubmitTradeReview] Skipping auto-complete for trade %d: arrival not confirmed for user %d (%v)", tradeID, userID, err)
				goto skipAutoComplete
			}
		}

		// 8c: Propagate finalization failures — do not silently swallow them.
		if err = h.completeTradeTransaction(tradeID); err != nil {
			log.Printf("Error auto-completing trade %d: %v", tradeID, err)
			return c.Status(500).JSON(models.APIResponse{
				Success: false,
				Error:   "Review submitted but trade finalization failed: " + err.Error(),
			})
		}
		autoCompleted = true
		publishToUser(buyerID, sseEvent{Type: "trade_completed", Data: fiber.Map{"trade_id": tradeID}})
		publishToUser(sellerID, sseEvent{Type: "trade_completed", Data: fiber.Map{"trade_id": tradeID}})
	}

skipAutoComplete:
	return c.JSON(models.APIResponse{
		Success: true,
		Message: "Review submitted successfully",
		Data: fiber.Map{
			"review_id":      reviewID,
			"trade_id":       tradeID,
			"is_followup":    payload.IsFollowup,
			"auto_completed": autoCompleted, // 8d: only true when finalization succeeded
		},
	})
}

// GetTradeReviewHistory returns all reviews (initial + followups) for a trade
// GET /api/trades/{id}/reviews
func (h *TradeHandler) GetTradeReviewHistory(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}

	tradeID, err := strconv.Atoi(c.Params("id"))
	if err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid trade id"})
	}

	// Verify user is a participant
	var buyerID, sellerID int
	err = h.db.QueryRow("SELECT buyer_id, seller_id FROM trades WHERE id = ?", tradeID).Scan(&buyerID, &sellerID)
	if err != nil {
		return c.Status(404).JSON(models.APIResponse{Success: false, Error: "Trade not found"})
	}

	if userID != buyerID && userID != sellerID {
		return c.Status(403).JSON(models.APIResponse{Success: false, Error: "Not authorized for this trade"})
	}

	// Get all reviews for this trade
	rows, err := h.db.Query(`
		SELECT tr.id, tr.trade_id, tr.reviewer_id, tr.rating, tr.feedback, tr.proof_url,
		       tr.is_camera_photo, tr.is_followup, tr.is_auto_generated, tr.rating_delta,
		       tr.created_at, tr.updated_at, u.name, u.profile_picture
		FROM trade_reviews tr
		LEFT JOIN users u ON u.id = tr.reviewer_id
		WHERE tr.trade_id = ?
		ORDER BY tr.created_at ASC`,
		tradeID,
	)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to fetch reviews"})
	}
	defer rows.Close()

	var reviews []models.TradeReview
	for rows.Next() {
		var tr models.TradeReview
		err := rows.Scan(&tr.ID, &tr.TradeID, &tr.ReviewerID, &tr.Rating, &tr.Feedback, &tr.ProofURL,
			&tr.IsCameraPhoto, &tr.IsFollowup, &tr.IsAutoGenerated, &tr.RatingDelta,
			&tr.CreatedAt, &tr.UpdatedAt, &tr.ReviewerName, &tr.ReviewerAvatar)
		if err != nil {
			log.Printf("Error scanning review: %v", err)
			continue
		}
		reviews = append(reviews, tr)
	}

	return c.JSON(models.APIResponse{
		Success: true,
		Data:    reviews,
	})
}

// GetReviewSummary returns initial + latest review summary for both traders
// GET /api/trades/{id}/review-summary
func (h *TradeHandler) GetReviewSummary(c *fiber.Ctx) error {
	tradeID, err := strconv.Atoi(c.Params("id"))
	if err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid trade id"})
	}

	// Get trade participants
	var buyerID, sellerID int
	err = h.db.QueryRow("SELECT buyer_id, seller_id FROM trades WHERE id = ?", tradeID).Scan(&buyerID, &sellerID)
	if err != nil {
		return c.Status(404).JSON(models.APIResponse{Success: false, Error: "Trade not found"})
	}

	// Get reviews for both buyer and seller
	buyerSummary := getReviewSummaryForReviewer(h.db, tradeID, buyerID)
	sellerSummary := getReviewSummaryForReviewer(h.db, tradeID, sellerID)

	return c.JSON(models.APIResponse{
		Success: true,
		Data: fiber.Map{
			"buyer_review":  buyerSummary,
			"seller_review": sellerSummary,
		},
	})
}

// Helper function to get review summary for a specific reviewer
func getReviewSummaryForReviewer(db *sql.DB, tradeID int, reviewerID int) *models.ReviewSummary {
	summary := &models.ReviewSummary{
		RatingTrend:  "stable",
		RatingChange: 0,
	}

	// Get initial review
	var initialReview models.TradeReview
	err := db.QueryRow(`
		SELECT id, trade_id, reviewer_id, rating, feedback, proof_url,
		       is_camera_photo, is_followup, is_auto_generated, rating_delta,
		       created_at, updated_at
		FROM trade_reviews 
		WHERE trade_id = ? AND reviewer_id = ? AND is_followup = FALSE
		ORDER BY created_at ASC LIMIT 1`,
		tradeID, reviewerID,
	).Scan(&initialReview.ID, &initialReview.TradeID, &initialReview.ReviewerID,
		&initialReview.Rating, &initialReview.Feedback, &initialReview.ProofURL,
		&initialReview.IsCameraPhoto, &initialReview.IsFollowup, &initialReview.IsAutoGenerated,
		&initialReview.RatingDelta, &initialReview.CreatedAt, &initialReview.UpdatedAt)

	if err != nil && err != sql.ErrNoRows {
		log.Printf("Error fetching initial review: %v", err)
		return summary
	}

	if err == nil {
		summary.InitialReview = &initialReview
		summary.LatestReview = &initialReview

		// Check for followups
		var followupCount int
		var latestFollowup models.TradeReview
		err = db.QueryRow(`
			SELECT COUNT(*) FROM trade_reviews 
			WHERE trade_id = ? AND reviewer_id = ? AND is_followup = TRUE`,
			tradeID, reviewerID,
		).Scan(&followupCount)

		if followupCount > 0 {
			summary.FollowupCount = followupCount
			summary.HasFollowup = true

			// Get latest followup
			err = db.QueryRow(`
				SELECT id, trade_id, reviewer_id, rating, feedback, proof_url,
				       is_camera_photo, is_followup, is_auto_generated, rating_delta,
				       created_at, updated_at
				FROM trade_reviews 
				WHERE trade_id = ? AND reviewer_id = ? AND is_followup = TRUE
				ORDER BY created_at DESC LIMIT 1`,
				tradeID, reviewerID,
			).Scan(&latestFollowup.ID, &latestFollowup.TradeID, &latestFollowup.ReviewerID,
				&latestFollowup.Rating, &latestFollowup.Feedback, &latestFollowup.ProofURL,
				&latestFollowup.IsCameraPhoto, &latestFollowup.IsFollowup, &latestFollowup.IsAutoGenerated,
				&latestFollowup.RatingDelta, &latestFollowup.CreatedAt, &latestFollowup.UpdatedAt)

			if err == nil {
				summary.LatestReview = &latestFollowup
				summary.RatingChange = latestFollowup.RatingDelta

				if latestFollowup.RatingDelta > 0 {
					summary.RatingTrend = "up"
				} else if latestFollowup.RatingDelta < 0 {
					summary.RatingTrend = "down"
				}
			}
		}

		// Check if auto-generated
		if initialReview.IsAutoGenerated {
			summary.RatingTrend = "auto"
		}
	}

	return summary
}

// AutoCompleteTradesJob runs periodically to auto-complete trades 3+ days old without reviews
// Call this from a cron job or background scheduler
func (h *TradeHandler) AutoCompleteTradesJob() error {
	log.Println("[AutoCompleteTradesJob] Starting auto-completion check...")

	// Find trades that are 3+ days old and don't have both reviews
	rows, err := h.db.Query(`
		SELECT id, buyer_id, seller_id, 
		       CASE WHEN buyer_rating IS NOT NULL THEN 1 ELSE 0 END as has_buyer_review,
		       CASE WHEN seller_rating IS NOT NULL THEN 1 ELSE 0 END as has_seller_review
		FROM trades
		WHERE status IN ('active', 'awaiting_confirmation', 'completed')
		  AND DATE(NOW()) >= DATE_ADD(DATE(created_at), INTERVAL 3 DAY)
		  AND (buyer_rating IS NULL OR seller_rating IS NULL)
		LIMIT 100  -- Process in batches
	`)
	if err != nil {
		log.Printf("Error querying trades for auto-completion: %v", err)
		return err
	}
	defer rows.Close()

	autoCompletedCount := 0

	for rows.Next() {
		var tradeID, buyerID, sellerID int
		var hasBuyerReview, hasSellerReview int

		err := rows.Scan(&tradeID, &buyerID, &sellerID, &hasBuyerReview, &hasSellerReview)
		if err != nil {
			log.Printf("Error scanning trade: %v", err)
			continue
		}

		// Create auto-generated 5-star reviews for missing party
		if hasBuyerReview == 0 {
			err = h.createAutoGeneratedReview(tradeID, buyerID)
			if err != nil {
				log.Printf("Error auto-completing buyer review for trade %d: %v", tradeID, err)
			}
		}

		if hasSellerReview == 0 {
			err = h.createAutoGeneratedReview(tradeID, sellerID)
			if err != nil {
				log.Printf("Error auto-completing seller review for trade %d: %v", tradeID, err)
			}
		}

		// Check if both now have reviews
		var buyerCompleted, sellerCompleted bool
		var buyerRating, sellerRating sql.NullInt64
		h.db.QueryRow(`
			SELECT buyer_rating IS NOT NULL, seller_rating IS NOT NULL,
			       buyer_rating, seller_rating
			FROM trades WHERE id = ?`, tradeID).Scan(&buyerCompleted, &sellerCompleted, &buyerRating, &sellerRating)

		if buyerRating.Valid && sellerRating.Valid {
			// Both now have reviews - complete the trade
			err = h.completeTradeTransaction(tradeID)
			if err == nil {
				log.Printf("Auto-completed trade %d", tradeID)
				autoCompletedCount++

				// Mark auto-completion time
				h.db.Exec("UPDATE trades SET auto_completed_at = NOW() WHERE id = ?", tradeID)

				// Notify both parties
				publishToUser(buyerID, sseEvent{Type: "trade_auto_completed", Data: fiber.Map{"trade_id": tradeID}})
				publishToUser(sellerID, sseEvent{Type: "trade_auto_completed", Data: fiber.Map{"trade_id": tradeID}})
			}
		}
	}

	log.Printf("[AutoCompleteTradesJob] Completed. %d trades auto-completed", autoCompletedCount)
	return nil
}

// createAutoGeneratedReview creates a 5-star default review for a user
func (h *TradeHandler) createAutoGeneratedReview(tradeID int, reviewerID int) error {
	// Check if review already exists
	var existingID int
	err := h.db.QueryRow(`
		SELECT id FROM trade_reviews 
		WHERE trade_id = ? AND reviewer_id = ? AND is_followup = FALSE`,
		tradeID, reviewerID,
	).Scan(&existingID)

	if err == nil {
		// Review already exists
		return nil
	}

	if err != sql.ErrNoRows {
		return err
	}

	// Create auto-generated 5-star review
	_, err = h.db.Exec(`
		INSERT INTO trade_reviews 
		(trade_id, reviewer_id, rating, feedback, is_followup, is_auto_generated)
		VALUES (?, ?, 5, 'Auto-completed after 3 days of inactivity', FALSE, TRUE)`,
		tradeID, reviewerID,
	)

	if err != nil {
		return err
	}

	// Update trades table with auto-generated review
	var ratingCol, feedbackCol, lockedCol, timestampCol string
	var buyerID, sellerID int
	h.db.QueryRow("SELECT buyer_id, seller_id FROM trades WHERE id = ?", tradeID).Scan(&buyerID, &sellerID)

	if reviewerID == buyerID {
		ratingCol = "buyer_rating"
		feedbackCol = "buyer_feedback"
		lockedCol = "buyer_initial_review_locked"
		timestampCol = "buyer_review_created_at"
	} else {
		ratingCol = "seller_rating"
		feedbackCol = "seller_feedback"
		lockedCol = "seller_initial_review_locked"
		timestampCol = "seller_review_created_at"
	}

	updateQuery := fmt.Sprintf(`
		UPDATE trades
		SET %s=5, %s='Auto-completed after 3 days of inactivity', %s=TRUE, %s=NOW()
		WHERE id = ?`, ratingCol, feedbackCol, lockedCol, timestampCol)

	_, err = h.db.Exec(updateQuery, tradeID)
	return err
}
