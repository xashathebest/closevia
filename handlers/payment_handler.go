package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"math"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/xashathebest/clovia/middleware"
	"github.com/xashathebest/clovia/models"
	xendit "github.com/xendit/xendit-go/v3"
	"github.com/xendit/xendit-go/v3/invoice"
)

type PaymentHandler struct {
	db *sql.DB
}

const paymentProviderUnavailableMessage = "Online payments are temporarily unavailable. Please try again later."

func NewPaymentHandler(db *sql.DB) *PaymentHandler {
	return &PaymentHandler{db: db}
}

func getAppSettingFloat(db *sql.DB, key string, def float64) float64 {
	var v string
	if err := db.QueryRow("SELECT setting_value FROM app_settings WHERE setting_key = ?", key).Scan(&v); err != nil {
		return def
	}
	parsed, err := strconv.ParseFloat(strings.TrimSpace(v), 64)
	if err != nil || parsed <= 0 {
		return def
	}
	return parsed
}

func almostEqualMoney(a, b float64) bool {
	return math.Abs(a-b) < 0.009
}

type paymentPremiumPlan struct {
	PlanKey      string                 `json:"plan_key"`
	Name         string                 `json:"name"`
	Description  string                 `json:"description"`
	Tier         string                 `json:"tier"`
	BillingType  string                 `json:"billing_type"`
	DurationDays int                    `json:"duration_days"`
	Price        float64                `json:"price"`
	BadgeLabel   string                 `json:"badge_label"`
	AccessScope  string                 `json:"access_scope"`
	Capabilities map[string]interface{} `json:"capabilities"`
	IsActive     bool                   `json:"is_active"`
	PromoTitle   string                 `json:"promo_title,omitempty"`
	PromoPrice   *float64               `json:"promo_price,omitempty"`
}

func loadPaymentPremiumConfig(db *sql.DB) (bool, []paymentPremiumPlan, []fiber.Map, error) {
	enabled := true
	var enabledRaw string
	if err := db.QueryRow("SELECT setting_value FROM app_settings WHERE setting_key = 'premium_enabled'").Scan(&enabledRaw); err == nil {
		enabled = strings.EqualFold(strings.TrimSpace(enabledRaw), "true") || strings.TrimSpace(enabledRaw) == "1"
	}

	rows, err := db.Query(`
		SELECT
			p.plan_key, p.name, COALESCE(p.description, ''), p.tier, p.billing_type, p.duration_days, p.price,
			COALESCE(p.badge_label, ''), COALESCE(p.access_scope, 'basic'), COALESCE(CAST(p.capabilities AS CHAR), '{}'), p.is_active,
			COALESCE(pr.title, '') AS promo_title,
			pr.discounted_price,
			COALESCE(CAST(pr.capabilities AS CHAR), '') AS promo_capabilities,
			COALESCE(pr.overrides_capabilities, false) AS promo_overrides_capabilities
		FROM premium_plans p
		LEFT JOIN premium_promotions pr
		  ON pr.is_active = true
		 AND (pr.plan_key IS NULL OR pr.plan_key = '' OR pr.plan_key = p.plan_key)
		 AND (pr.start_at IS NULL OR pr.start_at <= NOW())
		 AND (pr.end_at IS NULL OR pr.end_at >= NOW())
		ORDER BY p.sort_order, p.price
	`)
	if err != nil {
		return enabled, nil, nil, err
	}
	defer rows.Close()
	plans := []paymentPremiumPlan{}
	for rows.Next() {
		var p paymentPremiumPlan
		var promoPrice sql.NullFloat64
		var capsRaw, promoCapsRaw string
		var promoOverrides bool
		if rows.Scan(&p.PlanKey, &p.Name, &p.Description, &p.Tier, &p.BillingType, &p.DurationDays, &p.Price, &p.BadgeLabel, &p.AccessScope, &capsRaw, &p.IsActive, &p.PromoTitle, &promoPrice, &promoCapsRaw, &promoOverrides) == nil {
			p.Capabilities = map[string]interface{}{}
			_ = json.Unmarshal([]byte(capsRaw), &p.Capabilities)
			if strings.TrimSpace(promoCapsRaw) != "" {
				promoCaps := map[string]interface{}{}
				if json.Unmarshal([]byte(promoCapsRaw), &promoCaps) == nil && len(promoCaps) > 0 {
					if promoOverrides {
						p.Capabilities = promoCaps
					} else {
						for key, value := range promoCaps {
							p.Capabilities[key] = value
						}
					}
				}
			}
			if promoPrice.Valid {
				v := promoPrice.Float64
				p.PromoPrice = &v
			}
			plans = append(plans, p)
		}
	}

	featureRows, err := db.Query(`SELECT feature_key, label, COALESCE(description, ''), enabled FROM premium_features ORDER BY sort_order, label`)
	if err != nil {
		return enabled, plans, nil, err
	}
	defer featureRows.Close()
	features := []fiber.Map{}
	for featureRows.Next() {
		var key, label, description string
		var featureEnabled bool
		if featureRows.Scan(&key, &label, &description, &featureEnabled) == nil {
			features = append(features, fiber.Map{"feature_key": key, "label": label, "description": description, "enabled": featureEnabled})
		}
	}
	return enabled, plans, features, nil
}

func getPremiumPlanDurationDays(db *sql.DB, tier string, billingType string) int {
	var days int
	if err := db.QueryRow("SELECT duration_days FROM premium_plans WHERE tier = ? AND billing_type = ? AND is_active = true ORDER BY sort_order LIMIT 1", tier, billingType).Scan(&days); err == nil && days > 0 {
		return days
	}
	if strings.ToLower(billingType) == "yearly" {
		return 365
	}
	return 30
}

func getCapInt(caps map[string]interface{}, key string, def int) int {
	if caps == nil {
		return def
	}
	switch v := caps[key].(type) {
	case float64:
		return int(v)
	case int:
		return v
	case string:
		if parsed, err := strconv.Atoi(strings.TrimSpace(v)); err == nil {
			return parsed
		}
	}
	return def
}

func getCapBool(caps map[string]interface{}, key string, def bool) bool {
	if caps == nil {
		return def
	}
	switch v := caps[key].(type) {
	case bool:
		return v
	case string:
		return strings.EqualFold(v, "true") || v == "1"
	case float64:
		return v != 0
	}
	return def
}

func defaultCapabilitiesForTier(tier string) map[string]interface{} {
	switch strings.ToLower(strings.TrimSpace(tier)) {
	case "pro":
		return map[string]interface{}{
			"listing_limit":                   999999,
			"active_trade_limit":              999999,
			"monthly_boost_limit":             10,
			"free_boost_enabled":              true,
			"featured_listing_enabled":        true,
			"priority_listing_visibility":     true,
			"premium_badge_enabled":           true,
			"premium_profile_styling_enabled": true,
			"advanced_trade_tools_enabled":    true,
			"analytics_enabled":               true,
			"premium_filters_enabled":         true,
			"priority_support_enabled":        true,
			"wider_visibility_enabled":        true,
			"discovery_priority":              3,
		}
	case "plus", "promo":
		return map[string]interface{}{
			"listing_limit":                   30,
			"active_trade_limit":              25,
			"monthly_boost_limit":             3,
			"free_boost_enabled":              true,
			"featured_listing_enabled":        true,
			"priority_listing_visibility":     true,
			"premium_badge_enabled":           true,
			"premium_profile_styling_enabled": true,
			"advanced_trade_tools_enabled":    true,
			"analytics_enabled":               true,
			"premium_filters_enabled":         true,
			"priority_support_enabled":        false,
			"wider_visibility_enabled":        true,
			"discovery_priority":              2,
		}
	default:
		return map[string]interface{}{
			"listing_limit":       10,
			"active_trade_limit":  5,
			"monthly_boost_limit": 0,
			"free_boost_enabled":  false,
			"discovery_priority":  1,
		}
	}
}

func applyDefaultCapabilities(plan *paymentPremiumPlan) {
	if plan.Capabilities == nil {
		plan.Capabilities = map[string]interface{}{}
	}
	for key, value := range defaultCapabilitiesForTier(plan.Tier) {
		if _, ok := plan.Capabilities[key]; !ok {
			plan.Capabilities[key] = value
		}
	}
}

func getUserPlanCapabilities(db *sql.DB, userID int) (paymentPremiumPlan, error) {
	var tier string
	var isPremium bool
	var expiresAt sql.NullTime
	if err := db.QueryRow("SELECT COALESCE(premium_tier, 'free'), COALESCE(is_premium, false), premium_expires_at FROM users WHERE id = ?", userID).Scan(&tier, &isPremium, &expiresAt); err != nil {
		return paymentPremiumPlan{}, err
	}
	tier = strings.ToLower(strings.TrimSpace(tier))
	if tier == "" {
		tier = "free"
	}
	hasActiveTier := tier != "free" && (!expiresAt.Valid || expiresAt.Time.After(time.Now()))
	if !isPremium && !hasActiveTier {
		tier = "free"
	}
	_, plans, _, err := loadPaymentPremiumConfig(db)
	if err != nil {
		return paymentPremiumPlan{}, err
	}
	var fallback *paymentPremiumPlan
	for i := range plans {
		if plans[i].Tier == tier && plans[i].IsActive {
			applyDefaultCapabilities(&plans[i])
			if plans[i].BillingType == "free" || plans[i].BillingType == "monthly" || plans[i].PlanKey == tier {
				return plans[i], nil
			}
			if fallback == nil {
				fallback = &plans[i]
			}
		}
	}
	if fallback != nil {
		applyDefaultCapabilities(fallback)
		return *fallback, nil
	}
	plan := paymentPremiumPlan{Tier: "free", Name: "Free", Capabilities: map[string]interface{}{}}
	applyDefaultCapabilities(&plan)
	return plan, nil
}

func parseRemittanceExternalID(externalID string) (paymentID int, riderID int, ok bool) {
	// Expected: remittance_<paymentID>_<riderID>_<unix>
	parts := strings.Split(externalID, "_")
	if len(parts) < 3 || parts[0] != "remittance" {
		return 0, 0, false
	}
	pID, err1 := strconv.Atoi(parts[1])
	rID, err2 := strconv.Atoi(parts[2])
	if err1 != nil || err2 != nil || pID <= 0 || rID <= 0 {
		return 0, 0, false
	}
	return pID, rID, true
}

func (h *PaymentHandler) handleRemittancePaid(externalID string, paidAmount float64) error {
	paymentID, riderID, ok := parseRemittanceExternalID(externalID)
	if !ok {
		return fmt.Errorf("invalid remittance external_id")
	}

	tx, err := h.db.Begin()
	if err != nil {
		return err
	}
	defer func() {
		if err != nil {
			_ = tx.Rollback()
		}
	}()

	// Ensure payment exists and belongs to rider
	var amountPaid float64
	var status string
	if scanErr := tx.QueryRow(
		"SELECT amount_paid, status FROM rider_remittance_payments WHERE id = ? AND rider_id = ?",
		paymentID, riderID,
	).Scan(&amountPaid, &status); scanErr != nil {
		err = scanErr
		return err
	}
	if paidAmount > 0 {
		amountPaid = paidAmount
	}

	// Mark payment verified (idempotent)
	if status != "verified" {
		if _, execErr := tx.Exec(
			"UPDATE rider_remittance_payments SET status = 'verified', verified_by = NULL, verified_at = NOW(), payment_method = 'xendit' WHERE id = ? AND rider_id = ?",
			paymentID, riderID,
		); execErr != nil {
			err = execErr
			return err
		}
	}

	threshold := getAppSettingFloat(h.db, "rider_remittance_lock_threshold", 50.0)

	// Reduce remittance owed by amount paid; unlock only if remaining is below threshold.
	if _, execErr := tx.Exec(`
		UPDATE rider_ledger
		SET remittance_owed = GREATEST(0, remittance_owed - ?),
			last_remittance_at = NOW(),
			is_locked_for_remittance = CASE
				WHEN GREATEST(0, remittance_owed - ?) >= ? THEN TRUE
				ELSE FALSE
			END
		WHERE rider_id = ?
	`, amountPaid, amountPaid, threshold, riderID); execErr != nil {
		err = execErr
		return err
	}

	if commitErr := tx.Commit(); commitErr != nil {
		err = commitErr
		return err
	}

	return nil
}

// CreateRemittanceInvoice generates a Xendit checkout URL for a Rider remittance payment.
// It supports two allowed amounts:
// - minimum unlock amount (threshold, or remaining owed if less)
// - full remittance owed
func (h *PaymentHandler) CreateRemittanceInvoice(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}

	var riderID int
	if err := h.db.QueryRow("SELECT id FROM riders WHERE user_id = ?", userID).Scan(&riderID); err != nil {
		return c.Status(404).JSON(models.APIResponse{Success: false, Error: "Rider not found"})
	}

	var remittanceOwed float64
	if err := h.db.QueryRow("SELECT COALESCE(remittance_owed, 0.00) FROM rider_ledger WHERE rider_id = ?", riderID).Scan(&remittanceOwed); err != nil {
		return c.Status(404).JSON(models.APIResponse{Success: false, Error: "Rider ledger not found"})
	}
	if remittanceOwed <= 0 {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "No remittance owed"})
	}

	threshold := getAppSettingFloat(h.db, "rider_remittance_lock_threshold", 50.0)
	minUnlock := remittanceOwed
	if threshold > 0 {
		minUnlock = math.Min(threshold, remittanceOwed)
	}
	fullAmount := remittanceOwed

	var payload struct {
		Amount float64 `json:"amount"`
	}
	_ = c.BodyParser(&payload)

	amountToPay := fullAmount
	if payload.Amount > 0 {
		amountToPay = payload.Amount
	}
	if !almostEqualMoney(amountToPay, fullAmount) && !almostEqualMoney(amountToPay, minUnlock) {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid remittance payment amount"})
	}

	// Get user details for invoice
	var name, email string
	_ = h.db.QueryRow("SELECT COALESCE(name, ''), COALESCE(email, '') FROM users WHERE id = ?", userID).Scan(&name, &email)

	apiKey := os.Getenv("XENDIT_SECRET_KEY")
	if apiKey == "" {
		log.Println("Payment provider unavailable: missing XENDIT_SECRET_KEY")
		return c.Status(503).JSON(models.APIResponse{Success: false, Error: paymentProviderUnavailableMessage})
	}
	xenditClient := xendit.NewClient(apiKey)

	// Create a pending remittance payment row first (so we can embed its ID into external_id)
	result, err := h.db.Exec(
		"INSERT INTO rider_remittance_payments (rider_id, amount_paid, payment_method, payment_proof_url, status) VALUES (?, ?, 'xendit', NULL, 'pending')",
		riderID, amountToPay,
	)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to initialize remittance payment"})
	}
	paymentID64, _ := result.LastInsertId()
	paymentID := int(paymentID64)
	externalID := fmt.Sprintf("remittance_%d_%d_%d", paymentID, riderID, time.Now().Unix())
	description := fmt.Sprintf("Clovia Rider Remittance (Rider #%d)", riderID)

	// Determine frontend URL dynamically (same strategy as trade invoices)
	frontendURL := c.Get("Origin")
	if frontendURL == "" {
		referer := c.Get("Referer")
		if referer != "" {
			frontendURL = referer
		}
	}
	if frontendURL != "" {
		parsedURL, err := url.Parse(frontendURL)
		if err == nil {
			frontendURL = parsedURL.Scheme + "://" + parsedURL.Host
		}
	}
	if frontendURL == "" {
		if envURL := os.Getenv("FRONTEND_URL"); envURL != "" {
			frontendURL = envURL
		} else if os.Getenv("APP_ENV") == "production" {
			frontendURL = "https://cloviaph.netlify.app"
		} else {
			frontendURL = "http://localhost:5173"
		}
	}

	successUrl := fmt.Sprintf("%s/remittance-ledger?payment=success&xendit_external_id=%s", frontendURL, url.QueryEscape(externalID))
	failureUrl := fmt.Sprintf("%s/remittance-ledger?payment=failed&xendit_external_id=%s", frontendURL, url.QueryEscape(externalID))

	currency := "PHP"
	req := xenditClient.InvoiceApi.CreateInvoice(context.Background()).CreateInvoiceRequest(invoice.CreateInvoiceRequest{
		ExternalId:  externalID,
		Amount:      float32(amountToPay),
		Description: &description,
		PayerEmail:  &email,
		Customer: &invoice.CustomerObject{
			GivenNames: *invoice.NewNullableString(&name),
			Email:      *invoice.NewNullableString(&email),
		},
		SuccessRedirectUrl: &successUrl,
		FailureRedirectUrl: &failureUrl,
		Currency:           &currency,
	})

	resp, _, execErr := req.Execute()
	if execErr != nil {
		log.Printf("Failed to generate remittance payment link: %v", execErr)
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: paymentProviderUnavailableMessage})
	}

	checkoutURL := strings.TrimSpace(resp.InvoiceUrl)
	if checkoutURL == "" {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to generate payment link (missing checkout URL)"})
	}

	// Store checkout URL for reference (reuse payment_proof_url column)
	_, _ = h.db.Exec("UPDATE rider_remittance_payments SET payment_proof_url = ? WHERE id = ? AND rider_id = ?", checkoutURL, paymentID, riderID)

	return c.JSON(models.APIResponse{Success: true, Data: fiber.Map{
		"checkout_url": checkoutURL,
		"external_id":  externalID,
		"payment_id":   paymentID,
		"amount":       amountToPay,
		"min_unlock":   minUnlock,
		"full_amount":  fullAmount,
	}})
}

// CreateTradeInvoice generates a Xendit checkout URL for a Trade
func (h *PaymentHandler) CreateTradeInvoice(c *fiber.Ctx) error {
	// Parse Trade ID
	tradeID := c.Params("id")
	if tradeID == "" {
		return c.Status(400).JSON(models.APIResponse{
			Success: false,
			Error:   "Trade ID is required",
		})
	}

	// Verify User
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}

	// Fetch Trade details and verify participation
	var trade models.Trade
	var buyerID, sellerID, targetProductID int
	var status string
	var offeredCashAmount sql.NullFloat64
	var deliveryType sql.NullString

	err := h.db.QueryRow(`
		SELECT id, buyer_id, seller_id, status, offered_cash_amount, COALESCE(delivery_type, ''), target_product_id 
		FROM trades 
		WHERE id = ?`, tradeID).Scan(
		&trade.ID, &buyerID, &sellerID, &status, &offeredCashAmount, &deliveryType, &targetProductID,
	)

	fmt.Printf("🔍 Payment Debug: TradeID=%s, UserID=%d, BuyerID=%d, SellerID=%d, DeliveryType=%s\n",
		tradeID, userID, buyerID, sellerID, deliveryType.String)

	if err != nil {
		fmt.Printf("❌ Payment Error (Fetch): %v\n", err)
		return c.Status(404).JSON(models.APIResponse{
			Success: false,
			Error:   "Trade not found",
		})
	}

	// Only Buyer can pay
	if userID != buyerID {
		fmt.Printf("🚫 Payment Forbidden: UserID %d is not BuyerID %d\n", userID, buyerID)
		return c.Status(403).JSON(models.APIResponse{
			Success: false,
			Error:   "Only the buyer can initiate payment",
		})
	}

	// Trade must be active or accepted
	if status != "accepted" && status != "active" && status != "pending" {
		fmt.Printf("🚫 Payment Rejected: Trade status is '%s' (expected 'accepted', 'active', or 'pending')\n", status)
		return c.Status(400).JSON(models.APIResponse{
			Success: false,
			Error:   fmt.Sprintf("Trade is not in a payable state (current status: %s)", status),
		})
	}

	// Calculate Amount
	var amount float64 = 0

	// 1. Negotiation cash supplement
	if offeredCashAmount.Valid {
		amount += offeredCashAmount.Float64
	}

	// 2. Product Price (if it's a direct purchase, i.e., 0 items offered by buyer)
	var itemCount int
	h.db.QueryRow("SELECT COUNT(*) FROM trade_items WHERE trade_id = ? AND offered_by = 'buyer'", tradeID).Scan(&itemCount)
	if itemCount == 0 {
		var productPrice float64
		h.db.QueryRow("SELECT COALESCE(price, 0) FROM products WHERE id = ?", targetProductID).Scan(&productPrice)
		amount += productPrice
		fmt.Printf("🛒 Purchase detected (0 items offered). Added product price: %.2f\n", productPrice)
	}

	// 3. Delivery Fee (Express is a Premium feature)
	deliveryFee := 0.0
	if deliveryType.Valid && deliveryType.String != "" {
		// Check premium status for express delivery
		var isPremium bool
		h.db.QueryRow("SELECT is_premium FROM users WHERE id = ?", userID).Scan(&isPremium)

		if deliveryType.String == "express" && !isPremium {
			return c.Status(403).JSON(models.APIResponse{
				Success: false,
				Error:   "Express Delivery is a Premium feature. Please upgrade to use it.",
			})
		}

		switch deliveryType.String {
		case "express":
			deliveryFee = 150.0
		case "standard":
			deliveryFee = 50.0
		}
	}
	amount += deliveryFee
	fmt.Printf("🚚 Delivery fee for '%s': %.2f. Total Amount: %.2f\n", deliveryType.String, deliveryFee, amount)

	if amount <= 0 {
		fmt.Printf("🚫 Payment Rejected: Calculated amount is %.2f\n", amount)
		return c.Status(400).JSON(models.APIResponse{
			Success: false,
			Error:   fmt.Sprintf("This trade does not require a cash payment (amount: %.2f)", amount),
		})
	}

	// Get User Details for Invoice
	var buyerName, buyerEmail string
	h.db.QueryRow("SELECT name, email FROM users WHERE id = ?", buyerID).Scan(&buyerName, &buyerEmail)

	// Initialize Xendit Client
	apiKey := os.Getenv("XENDIT_SECRET_KEY")
	if apiKey == "" {
		log.Println("Payment provider unavailable: missing XENDIT_SECRET_KEY")
		return c.Status(503).JSON(models.APIResponse{
			Success: false,
			Error:   paymentProviderUnavailableMessage,
		})
	}
	xenditClient := xendit.NewClient(apiKey)

	// Create Invoice Parameters
	externalID := fmt.Sprintf("trade_%d_%d", trade.ID, time.Now().Unix()) // Unique reference
	description := fmt.Sprintf("Clovia Trade Escrow #%d", trade.ID)

	// Create Xendit Invoice Request

	// Determine frontend URL dynamically
	// We check the 'Origin' and 'Referer' headers directly from the Fiber Context
	frontendURL := c.Get("Origin")
	if frontendURL == "" {
		referer := c.Get("Referer")
		if referer != "" {
			// Extract origin from referer (e.g., https://cloviaph.netlify.app/trades -> https://cloviaph.netlify.app)
			// A simple approach is just checking if it contains the known domain, or parsing it
			// But for simplicity, we can let Fiber's BaseURL be the fallback if we want backend relative,
			// However usually the frontend is separate. So we default to FRONTEND_URL or local.
			frontendURL = referer // This might be a full path, but Xendit might handle it, or we just strip path
		}
	}

	// Clean up the URL if it was extracted from Referer
	if frontendURL != "" {
		// Just take the scheme and host
		parsedURL, err := url.Parse(frontendURL)
		if err == nil {
			frontendURL = parsedURL.Scheme + "://" + parsedURL.Host
		}
	}

	// Final fallbacks
	if frontendURL == "" {
		if envURL := os.Getenv("FRONTEND_URL"); envURL != "" {
			frontendURL = envURL
		} else if os.Getenv("APP_ENV") == "production" {
			frontendURL = "https://cloviaph.netlify.app"
		} else {
			frontendURL = "http://localhost:5173"
		}
	}

	successUrl := fmt.Sprintf("%s/dashboard?trade_id=%d&xendit_external_id=%s", frontendURL, trade.ID, url.QueryEscape(externalID))
	failureUrl := fmt.Sprintf("%s/dashboard?trade_id=%d&payment=failed&xendit_external_id=%s", frontendURL, trade.ID, url.QueryEscape(externalID))

	currency := "PHP"
	req := xenditClient.InvoiceApi.CreateInvoice(context.Background()).CreateInvoiceRequest(invoice.CreateInvoiceRequest{
		ExternalId:  externalID,
		Amount:      float32(amount),
		Description: &description,
		PayerEmail:  &buyerEmail,
		Customer: &invoice.CustomerObject{
			GivenNames: *invoice.NewNullableString(&buyerName),
			Email:      *invoice.NewNullableString(&buyerEmail),
		},
		SuccessRedirectUrl: &successUrl,
		FailureRedirectUrl: &failureUrl,
		Currency:           &currency,
	})

	// Execute Request
	resp, _, execErr := req.Execute()
	if execErr != nil {
		log.Printf("Failed to generate trade payment link: %v", execErr)
		return c.Status(500).JSON(models.APIResponse{
			Success: false,
			Error:   paymentProviderUnavailableMessage,
		})
	}

	// Store latest invoice reference for fallback "sync" in local dev (where webhooks may not reach)
	if resp.Id != nil && strings.TrimSpace(*resp.Id) != "" {
		if _, err := h.db.Exec(
			"UPDATE trades SET xendit_invoice_id = ?, xendit_external_id = ?, payment_method = 'online' WHERE id = ?",
			*resp.Id, externalID, trade.ID,
		); err != nil {
			log.Printf("Warning: failed to store Xendit invoice reference for trade %d: %v", trade.ID, err)
		}
	}

	// Return checkout URL to frontend
	return c.JSON(fiber.Map{
		"success": true,
		"data": fiber.Map{
			"checkout_url": resp.InvoiceUrl,
			"invoice_id": func() string {
				if resp.Id == nil {
					return ""
				}
				return *resp.Id
			}(),
			"external_id": externalID,
		},
	})
}

// CreatePremiumInvoice generates a Xendit checkout URL for a Premium Upgrade
func (h *PaymentHandler) CreatePremiumInvoice(c *fiber.Ctx) error {
	productID := c.Params("id")
	userID := c.Locals("user_id").(int)

	// Verify ownership
	var sellerID int
	var title string
	err := h.db.QueryRow("SELECT seller_id, title FROM products WHERE id = ?", productID).Scan(&sellerID, &title)
	if err != nil {
		return c.Status(404).JSON(models.APIResponse{Success: false, Error: "Product not found"})
	}
	if sellerID != userID {
		return c.Status(403).JSON(models.APIResponse{Success: false, Error: "Unauthorized"})
	}

	amount := 99.0 // Fixed price for premium upgrade
	var buyerName, buyerEmail string
	h.db.QueryRow("SELECT name, email FROM users WHERE id = ?", userID).Scan(&buyerName, &buyerEmail)

	apiKey := os.Getenv("XENDIT_SECRET_KEY")
	if apiKey == "" {
		log.Println("Payment provider unavailable: missing XENDIT_SECRET_KEY")
		return c.Status(503).JSON(models.APIResponse{Success: false, Error: paymentProviderUnavailableMessage})
	}
	xenditClient := xendit.NewClient(apiKey)

	externalID := fmt.Sprintf("premium_%s_%d", productID, userID)
	description := fmt.Sprintf("Clovia Premium Upgrade: %s", title)

	// Determine frontend URL dynamically
	frontendURL := c.Get("Origin")
	if frontendURL == "" {
		referer := c.Get("Referer")
		if referer != "" {
			parsedURL, err := url.Parse(referer)
			if err == nil {
				frontendURL = parsedURL.Scheme + "://" + parsedURL.Host
			}
		}
	}

	// Final fallbacks
	if frontendURL == "" {
		if envURL := os.Getenv("FRONTEND_URL"); envURL != "" {
			frontendURL = envURL
		} else if os.Getenv("APP_ENV") == "production" {
			frontendURL = "https://cloviaph.netlify.app"
		} else {
			frontendURL = "http://localhost:5173"
		}
	}
	successUrl := fmt.Sprintf("%s/dashboard", frontendURL)

	currency := "PHP"
	req := xenditClient.InvoiceApi.CreateInvoice(context.Background()).CreateInvoiceRequest(invoice.CreateInvoiceRequest{
		ExternalId:         externalID,
		Amount:             float32(amount),
		Description:        &description,
		PayerEmail:         &buyerEmail,
		SuccessRedirectUrl: &successUrl,
		Currency:           &currency,
	})

	resp, _, execErr := req.Execute()
	if execErr != nil {
		log.Printf("Failed to generate premium payment link: %v", execErr)
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: paymentProviderUnavailableMessage})
	}

	return c.JSON(fiber.Map{
		"success": true,
		"data": fiber.Map{
			"checkout_url": resp.InvoiceUrl,
		},
	})
}

// CreateBoostInvoice generates a Xendit checkout URL for a Product Boost
func (h *PaymentHandler) CreateBoostInvoice(c *fiber.Ctx) error {
	productID := c.Params("id")
	userID := c.Locals("user_id").(int)

	// Verify ownership
	var sellerID int
	var title string
	err := h.db.QueryRow("SELECT seller_id, title FROM products WHERE id = ?", productID).Scan(&sellerID, &title)
	if err != nil {
		return c.Status(404).JSON(models.APIResponse{Success: false, Error: "Product not found"})
	}
	if sellerID != userID {
		return c.Status(403).JSON(models.APIResponse{Success: false, Error: "Unauthorized"})
	}

	amount := 29.0 // Small fee for instant boost
	var buyerName, buyerEmail string
	h.db.QueryRow("SELECT name, email FROM users WHERE id = ?", userID).Scan(&buyerName, &buyerEmail)

	apiKey := os.Getenv("XENDIT_SECRET_KEY")
	if apiKey == "" {
		log.Println("Payment provider unavailable: missing XENDIT_SECRET_KEY")
		return c.Status(503).JSON(models.APIResponse{Success: false, Error: paymentProviderUnavailableMessage})
	}
	xenditClient := xendit.NewClient(apiKey)

	externalID := fmt.Sprintf("boost_%s_%d", productID, userID)
	description := fmt.Sprintf("Clovia Product Boost: %s", title)

	// Determine frontend URL dynamically
	frontendURL := c.Get("Origin")
	if frontendURL == "" {
		referer := c.Get("Referer")
		if referer != "" {
			parsedURL, err := url.Parse(referer)
			if err == nil {
				frontendURL = parsedURL.Scheme + "://" + parsedURL.Host
			}
		}
	}

	// Final fallbacks
	if frontendURL == "" {
		if envURL := os.Getenv("FRONTEND_URL"); envURL != "" {
			frontendURL = envURL
		} else if os.Getenv("APP_ENV") == "production" {
			frontendURL = "https://cloviaph.netlify.app"
		} else {
			frontendURL = "http://localhost:5173"
		}
	}
	successUrl := fmt.Sprintf("%s/products/%s", frontendURL, productID)

	currency := "PHP"
	req := xenditClient.InvoiceApi.CreateInvoice(context.Background()).CreateInvoiceRequest(invoice.CreateInvoiceRequest{
		ExternalId:         externalID,
		Amount:             float32(amount),
		Description:        &description,
		PayerEmail:         &buyerEmail,
		SuccessRedirectUrl: &successUrl,
		Currency:           &currency,
	})

	resp, _, execErr := req.Execute()
	if execErr != nil {
		log.Printf("Failed to generate boost payment link: %v", execErr)
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: paymentProviderUnavailableMessage})
	}

	return c.JSON(fiber.Map{
		"success": true,
		"data": fiber.Map{
			"checkout_url": resp.InvoiceUrl,
		},
	})
}

// CreateUserPremiumInvoice generates a Xendit checkout URL for a site-wide User Premium Subscription
func (h *PaymentHandler) CreateUserPremiumInvoice(c *fiber.Ctx) error {
	userID := c.Locals("user_id").(int)

	var payload struct {
		Tier string `json:"tier"` // "plus" or "pro"
		Plan string `json:"plan"` // "monthly" or "yearly"
	}
	if err := c.BodyParser(&payload); err != nil {
		payload.Tier = "plus"
		payload.Plan = "monthly"
	}
	if payload.Tier == "" {
		payload.Tier = "plus"
	}
	if payload.Plan == "" {
		payload.Plan = "monthly"
	}

	var buyerName, buyerEmail string
	err := h.db.QueryRow("SELECT name, email FROM users WHERE id = ?", userID).Scan(&buyerName, &buyerEmail)
	if err != nil {
		return c.Status(404).JSON(models.APIResponse{Success: false, Error: "User not found"})
	}

	// Check current premium status — allow Plus→Pro upgrades
	var isPremium bool
	var currentTier string
	h.db.QueryRow("SELECT COALESCE(is_premium, FALSE), COALESCE(premium_tier, 'free') FROM users WHERE id = ?", userID).Scan(&isPremium, &currentTier)
	if isPremium && currentTier == "pro" {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "You already have Pro — the highest tier"})
	}
	if isPremium && currentTier == payload.Tier {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: fmt.Sprintf("You are already a %s member", payload.Tier)})
	}

	enabled, plans, _, err := loadPaymentPremiumConfig(h.db)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to load premium plans"})
	}
	if !enabled {
		return c.Status(403).JSON(models.APIResponse{Success: false, Error: "Premium subscriptions are temporarily unavailable"})
	}
	var selected *paymentPremiumPlan
	for i := range plans {
		if plans[i].Tier == payload.Tier && plans[i].BillingType == payload.Plan && plans[i].IsActive {
			selected = &plans[i]
			break
		}
	}
	if selected == nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Selected premium plan is unavailable"})
	}
	amount := selected.Price
	if selected.PromoPrice != nil && *selected.PromoPrice > 0 {
		amount = *selected.PromoPrice
	}
	description := fmt.Sprintf("Clovia %s Subscription", selected.Name)

	apiKey := os.Getenv("XENDIT_SECRET_KEY")
	if apiKey == "" {
		log.Println("Payment provider unavailable: missing XENDIT_SECRET_KEY")
		return c.Status(503).JSON(models.APIResponse{Success: false, Error: paymentProviderUnavailableMessage})
	}
	xenditClient := xendit.NewClient(apiKey)

	externalID := fmt.Sprintf("user_premium_%s_%s_%d", payload.Tier, payload.Plan, userID)

	// Determine frontend URL dynamically
	frontendURL := c.Get("Origin")
	if frontendURL == "" {
		referer := c.Get("Referer")
		if referer != "" {
			parsedURL, err := url.Parse(referer)
			if err == nil {
				frontendURL = parsedURL.Scheme + "://" + parsedURL.Host
			}
		}
	}

	// Final fallbacks
	if frontendURL == "" {
		if envURL := os.Getenv("FRONTEND_URL"); envURL != "" {
			frontendURL = envURL
		} else if os.Getenv("APP_ENV") == "production" {
			frontendURL = "https://cloviaph.netlify.app"
		} else {
			frontendURL = "http://localhost:5173"
		}
	}
	successUrl := fmt.Sprintf("%s/premium?payment=success&xendit_external_id=%s", frontendURL, url.QueryEscape(externalID))

	currency := "PHP"
	req := xenditClient.InvoiceApi.CreateInvoice(context.Background()).CreateInvoiceRequest(invoice.CreateInvoiceRequest{
		ExternalId:         externalID,
		Amount:             float32(amount),
		Description:        &description,
		PayerEmail:         &buyerEmail,
		SuccessRedirectUrl: &successUrl,
		Currency:           &currency,
	})

	resp, _, execErr := req.Execute()
	if execErr != nil {
		log.Printf("Failed to generate subscription payment link: %v", execErr)
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: paymentProviderUnavailableMessage})
	}

	return c.JSON(fiber.Map{
		"success": true,
		"data": fiber.Map{
			"checkout_url": resp.InvoiceUrl,
		},
	})
}

func toFloat64(v any) (float64, bool) {
	switch t := v.(type) {
	case float64:
		return t, true
	case float32:
		return float64(t), true
	case int:
		return float64(t), true
	case int64:
		return float64(t), true
	case json.Number:
		f, err := t.Float64()
		if err != nil {
			return 0, false
		}
		return f, true
	default:
		return 0, false
	}
}

func fetchXenditInvoiceByID(apiKey, invoiceID string) (status string, amount float64, externalID string, _ error) {
	req, err := http.NewRequest("GET", fmt.Sprintf("https://api.xendit.co/v2/invoices/%s", url.PathEscape(invoiceID)), nil)
	if err != nil {
		return "", 0, "", err
	}
	// Xendit uses Basic Auth: secret key as username, empty password
	req.SetBasicAuth(apiKey, "")

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", 0, "", err
	}
	defer resp.Body.Close()

	decoder := json.NewDecoder(resp.Body)
	decoder.UseNumber()
	var raw map[string]any
	if err := decoder.Decode(&raw); err != nil {
		return "", 0, "", err
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		// Try to extract a readable message
		if msg, ok := raw["message"].(string); ok && msg != "" {
			return "", 0, "", fmt.Errorf("xendit: %s", msg)
		}
		return "", 0, "", fmt.Errorf("xendit: unexpected status %d", resp.StatusCode)
	}

	if s, ok := raw["status"].(string); ok {
		status = strings.ToUpper(s)
	}
	if e, ok := raw["external_id"].(string); ok {
		externalID = e
	}
	if a, ok := toFloat64(raw["amount"]); ok {
		amount = a
	}

	return status, amount, externalID, nil
}

func fetchXenditInvoiceByExternalID(apiKey, externalID string) (status string, amount float64, resolvedExternalID string, _ error) {
	u := fmt.Sprintf("https://api.xendit.co/v2/invoices?external_id=%s", url.QueryEscape(externalID))
	req, err := http.NewRequest("GET", u, nil)
	if err != nil {
		return "", 0, "", err
	}
	req.SetBasicAuth(apiKey, "")

	client := &http.Client{Timeout: 15 * time.Second}
	resp, err := client.Do(req)
	if err != nil {
		return "", 0, "", err
	}
	defer resp.Body.Close()

	decoder := json.NewDecoder(resp.Body)
	decoder.UseNumber()
	var raw any
	if err := decoder.Decode(&raw); err != nil {
		return "", 0, "", err
	}

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return "", 0, "", fmt.Errorf("xendit: unexpected status %d", resp.StatusCode)
	}

	arr, ok := raw.([]any)
	if !ok || len(arr) == 0 {
		return "", 0, "", fmt.Errorf("xendit: invoice not found for external_id")
	}
	obj, ok := arr[0].(map[string]any)
	if !ok {
		return "", 0, "", fmt.Errorf("xendit: invalid invoice response")
	}

	if s, ok := obj["status"].(string); ok {
		status = strings.ToUpper(s)
	}
	if e, ok := obj["external_id"].(string); ok {
		resolvedExternalID = e
	}
	if a, ok := toFloat64(obj["amount"]); ok {
		amount = a
	}

	return status, amount, resolvedExternalID, nil
}

// SyncUserPremiumPayment is a fallback for environments where webhooks can't reach the backend (e.g., localhost).
func (h *PaymentHandler) SyncUserPremiumPayment(c *fiber.Ctx) error {
	userID := c.Locals("user_id").(int)
	var payload struct {
		ExternalID string `json:"external_id"`
	}
	if err := c.BodyParser(&payload); err != nil {
		payload.ExternalID = ""
	}
	if strings.TrimSpace(payload.ExternalID) == "" {
		payload.ExternalID = c.Query("external_id")
	}
	if strings.TrimSpace(payload.ExternalID) == "" {
		payload.ExternalID = c.Query("xendit_external_id")
	}
	if strings.TrimSpace(payload.ExternalID) == "" {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Missing external_id"})
	}

	apiKey := os.Getenv("XENDIT_SECRET_KEY")
	if apiKey == "" {
		log.Println("Payment provider unavailable: missing XENDIT_SECRET_KEY")
		return c.Status(503).JSON(models.APIResponse{Success: false, Error: paymentProviderUnavailableMessage})
	}
	status, amount, resolvedExternalID, err := fetchXenditInvoiceByExternalID(apiKey, payload.ExternalID)
	if err != nil {
		log.Printf("Failed to sync subscription payment: %v", err)
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to sync payment"})
	}
	if resolvedExternalID == "" {
		resolvedExternalID = payload.ExternalID
	}

	status = strings.ToUpper(status)
	if status != "PAID" && status != "COMPLETED" && status != "SUCCEEDED" {
		return c.JSON(models.APIResponse{Success: true, Data: fiber.Map{"paid": false, "status": status, "external_id": resolvedExternalID}})
	}

	if !strings.HasPrefix(resolvedExternalID, "user_premium_") {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid external_id"})
	}

	var extUserID int
	tier := "plus"
	plan := "monthly"
	parts := strings.Split(resolvedExternalID, "_")
	if len(parts) >= 5 {
		// user_premium_<tier>_<plan>_<userID>
		tier = parts[2]
		plan = parts[3]
		fmt.Sscanf(parts[len(parts)-1], "%d", &extUserID)
	} else if len(parts) >= 4 {
		// user_premium_<tier>_<userID>
		tier = parts[2]
		fmt.Sscanf(parts[len(parts)-1], "%d", &extUserID)
	} else {
		fmt.Sscanf(resolvedExternalID, "user_premium_%d", &extUserID)
	}

	if extUserID == 0 || extUserID != userID {
		return c.Status(403).JSON(models.APIResponse{Success: false, Error: "Unauthorized to sync this payment"})
	}

	var currentExpiry sql.NullTime
	_ = h.db.QueryRow("SELECT premium_expires_at FROM users WHERE id = ?", userID).Scan(&currentExpiry)
	start := time.Now()
	if currentExpiry.Valid && currentExpiry.Time.After(start) {
		start = currentExpiry.Time
	}
	newExpiry := start.AddDate(0, 0, getPremiumPlanDurationDays(h.db, tier, plan))

	_, err = h.db.Exec("UPDATE users SET is_premium = true, premium_tier = ?, verified = true, premium_expires_at = ? WHERE id = ?", tier, newExpiry, userID)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to update subscription"})
	}

	_, _ = h.db.Exec(`
		INSERT INTO earnings (user_id, amount, source_type, source_id, external_id)
		SELECT ?, ?, 'premium_upgrade', ?, ?
		WHERE NOT EXISTS (
			SELECT 1 FROM earnings WHERE source_type = 'premium_upgrade' AND external_id = ?
		)
	`, userID, amount, userID, resolvedExternalID, resolvedExternalID)

	return c.JSON(models.APIResponse{Success: true, Data: fiber.Map{
		"paid":        true,
		"status":      status,
		"external_id": resolvedExternalID,
		"tier":        tier,
		"end_date":    newExpiry.Format("2006-01-02 15:04:05"),
	}})
}

// SyncTradePayment is a fallback for environments where webhooks can't reach the backend (e.g., localhost).
// It checks the latest invoice status directly from Xendit and updates the trade if paid.
func (h *PaymentHandler) SyncTradePayment(c *fiber.Ctx) error {
	tradeID := c.Params("id")
	if tradeID == "" {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Trade ID is required"})
	}

	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}

	var id int
	var buyerID int
	var paymentConfirmed bool
	var invoiceID sql.NullString

	// Keep the trade query compatible with older DBs (no xendit_* columns required)
	if err := h.db.QueryRow(
		"SELECT id, buyer_id, COALESCE(payment_confirmed, FALSE), COALESCE(xendit_invoice_id, '') FROM trades WHERE id = ?",
		tradeID,
	).Scan(&id, &buyerID, &paymentConfirmed, &invoiceID); err != nil {
		// If xendit_invoice_id column doesn't exist yet, fall back to a minimal query
		if strings.Contains(strings.ToLower(err.Error()), "unknown column") {
			if err2 := h.db.QueryRow(
				"SELECT id, buyer_id, COALESCE(payment_confirmed, FALSE) FROM trades WHERE id = ?",
				tradeID,
			).Scan(&id, &buyerID, &paymentConfirmed); err2 != nil {
				return c.Status(404).JSON(models.APIResponse{Success: false, Error: "Trade not found"})
			}
			invoiceID = sql.NullString{String: "", Valid: false}
		} else {
			return c.Status(404).JSON(models.APIResponse{Success: false, Error: "Trade not found"})
		}
	}

	if userID != buyerID {
		return c.Status(403).JSON(models.APIResponse{Success: false, Error: "Only the buyer can sync payment status"})
	}

	if paymentConfirmed {
		return c.JSON(models.APIResponse{Success: true, Data: fiber.Map{"paid": true}})
	}

	apiKey := os.Getenv("XENDIT_SECRET_KEY")
	if apiKey == "" {
		log.Println("Payment provider unavailable: missing XENDIT_SECRET_KEY")
		return c.Status(503).JSON(models.APIResponse{Success: false, Error: paymentProviderUnavailableMessage})
	}

	// If we have neither invoice ID (stored) nor external ID (from redirect), we can't sync.
	// The dashboard redirect includes external_id, so this normally only happens if the user never went through checkout.
	// (We validate after parsing the body below.)

	// If the dashboard redirect provides external_id, we can sync without relying on DB columns.
	var payload struct {
		ExternalID string `json:"external_id"`
	}
	_ = c.BodyParser(&payload)
	if strings.TrimSpace(payload.ExternalID) == "" {
		payload.ExternalID = c.Query("external_id")
	}

	if strings.TrimSpace(payload.ExternalID) == "" && (!invoiceID.Valid || strings.TrimSpace(invoiceID.String) == "") {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Missing invoice reference. Please return from Xendit checkout to the dashboard, or click checkout again."})
	}

	var (
		status      string
		amount      float64
		xExternalID string
		err         error
	)
	if strings.TrimSpace(payload.ExternalID) != "" {
		status, amount, xExternalID, err = fetchXenditInvoiceByExternalID(apiKey, payload.ExternalID)
	} else {
		status, amount, xExternalID, err = fetchXenditInvoiceByID(apiKey, invoiceID.String)
	}
	if err != nil {
		log.Printf("Failed to sync trade payment: %v", err)
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to sync payment"})
	}
	if xExternalID == "" {
		xExternalID = payload.ExternalID
	}

	paid := status == "PAID" || status == "SETTLED" || status == "COMPLETED" || status == "SUCCEEDED"
	if !paid {
		return c.JSON(models.APIResponse{Success: true, Data: fiber.Map{"paid": false, "status": status}})
	}

	// Update trade as paid
	// Update trade as paid (xendit_external_id column is optional; ignore if missing)
	if _, err := h.db.Exec(
		"UPDATE trades SET payment_confirmed = TRUE, payment_method = 'online', net_amount = ? WHERE id = ?",
		amount, id,
	); err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to update trade payment status"})
	}
	_, _ = h.db.Exec("UPDATE trades SET xendit_external_id = ? WHERE id = ?", xExternalID, id)

	// Record earnings once (guard against duplicates)
	_, _ = h.db.Exec(`
		INSERT INTO earnings (user_id, amount, source_type, source_id, external_id)
		SELECT ?, ?, 'trade_escrow', ?, ?
		WHERE NOT EXISTS (
			SELECT 1 FROM earnings WHERE source_type = 'trade_escrow' AND external_id = ?
		)
	`, buyerID, amount, id, xExternalID, xExternalID)

	return c.JSON(models.APIResponse{Success: true, Data: fiber.Map{"paid": true, "status": status, "external_id": xExternalID}})
}

// SyncRemittancePayment is a fallback for environments where webhooks can't reach the backend (e.g., localhost).
// It checks invoice status directly from Xendit and, if paid, updates rider ledger and verifies the payment.
func (h *PaymentHandler) SyncRemittancePayment(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}
	// Ensure the caller is a rider
	var riderID int
	if err := h.db.QueryRow("SELECT id FROM riders WHERE user_id = ?", userID).Scan(&riderID); err != nil {
		return c.Status(404).JSON(models.APIResponse{Success: false, Error: "Rider not found"})
	}

	apiKey := os.Getenv("XENDIT_SECRET_KEY")
	if apiKey == "" {
		log.Println("Payment provider unavailable: missing XENDIT_SECRET_KEY")
		return c.Status(503).JSON(models.APIResponse{Success: false, Error: paymentProviderUnavailableMessage})
	}

	var payload struct {
		ExternalID string `json:"external_id"`
	}
	_ = c.BodyParser(&payload)
	if strings.TrimSpace(payload.ExternalID) == "" {
		payload.ExternalID = c.Query("external_id")
	}
	if strings.TrimSpace(payload.ExternalID) == "" {
		payload.ExternalID = c.Query("xendit_external_id")
	}
	if strings.TrimSpace(payload.ExternalID) == "" {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Missing external_id"})
	}
	// Basic ownership check: external_id encodes rider_id.
	_, extRiderID, ok := parseRemittanceExternalID(payload.ExternalID)
	if !ok || extRiderID != riderID {
		return c.Status(403).JSON(models.APIResponse{Success: false, Error: "Forbidden"})
	}

	status, amount, _, err := fetchXenditInvoiceByExternalID(apiKey, payload.ExternalID)
	if err != nil {
		log.Printf("Failed to sync remittance payment: %v", err)
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to sync payment"})
	}

	paid := status == "PAID" || status == "SETTLED" || status == "COMPLETED" || status == "SUCCEEDED"
	if !paid {
		return c.JSON(models.APIResponse{Success: true, Data: fiber.Map{"paid": false, "status": status}})
	}

	if err := h.handleRemittancePaid(payload.ExternalID, amount); err != nil {
		log.Printf("Failed to apply remittance payment: %v", err)
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to apply remittance payment"})
	}

	return c.JSON(models.APIResponse{Success: true, Data: fiber.Map{"paid": true, "status": status, "external_id": payload.ExternalID}})
}

// XenditWebhook handles asynchronous payment confirmations
func (h *PaymentHandler) XenditWebhook(c *fiber.Ctx) error {
	var payload map[string]interface{}
	if err := c.BodyParser(&payload); err != nil {
		log.Printf("❌ Webhook Error: Invalid payload: %v", err)
		return c.Status(400).SendString("Invalid payload")
	}

	var status, externalID string
	var amount float64

	// Try top-level structure (Invoices)
	if s, ok := payload["status"].(string); ok {
		status = s
	}
	if e, ok := payload["external_id"].(string); ok {
		externalID = e
	}
	if a, ok := payload["amount"].(float64); ok {
		amount = a
	}

	// Try nested structure (Recurring/Subscriptions)
	if data, ok := payload["data"].(map[string]interface{}); ok {
		if s, ok := data["status"].(string); ok {
			status = s
		}
		if e, ok := data["external_id"].(string); ok {
			externalID = e
		}
		if a, ok := data["amount"].(float64); ok {
			amount = a
		}
	}

	status = strings.ToUpper(status)
	log.Printf("🔔 Webhook Received: Status=%s, ExternalID=%s, Amount=%.2f", status, externalID, amount)

	// Xendit uses "PAID" for invoices, but other methods might use "COMPLETED" or "SUCCEEDED"
	if status != "PAID" && status != "COMPLETED" && status != "SUCCEEDED" {
		log.Printf("⏭️  Webhook: Ignoring non-success status: %s", status)
		return c.SendStatus(200)
	}

	if strings.HasPrefix(externalID, "trade_") {
		var tradeID int
		fmt.Sscanf(externalID, "trade_%d", &tradeID)

		if tradeID > 0 {
			// Get buyer ID for earnings record
			var buyerID int
			h.db.QueryRow("SELECT buyer_id FROM trades WHERE id = ?", tradeID).Scan(&buyerID)

			// Update trade
			_, err := h.db.Exec("UPDATE trades SET payment_confirmed = true, payment_method = 'online', net_amount = ?, xendit_external_id = ? WHERE id = ?", amount, externalID, tradeID)
			if err != nil {
				fmt.Printf("Webhook Error: Failed to update trade %d: %v\n", tradeID, err)
			}

			// Record Earnings (guard against duplicates)
			_, err = h.db.Exec(`
				INSERT INTO earnings (user_id, amount, source_type, source_id, external_id)
				SELECT ?, ?, 'trade_escrow', ?, ?
				WHERE NOT EXISTS (
					SELECT 1 FROM earnings WHERE source_type = 'trade_escrow' AND external_id = ?
				)
			`, buyerID, amount, tradeID, externalID, externalID)
			if err != nil {
				fmt.Printf("Earnings Error (Trade %d): %v\n", tradeID, err)
			}
		}
	} else if strings.HasPrefix(externalID, "premium_") {
		var productID, userID int
		fmt.Sscanf(externalID, "premium_%d_%d", &productID, &userID)

		if productID > 0 {
			// Update product to premium
			_, err := h.db.Exec("UPDATE products SET premium = true WHERE id = ?", productID)
			if err != nil {
				fmt.Printf("Webhook Error: Premium upgrade failed for product %d: %v\n", productID, err)
			}

			// Record Earnings
			_, err = h.db.Exec(`
				INSERT INTO earnings (user_id, amount, source_type, source_id, external_id)
				VALUES (?, ?, 'premium_upgrade', ?, ?)`,
				userID, amount, productID, externalID)
		}
	} else if strings.HasPrefix(externalID, "boost_") {
		var productID, userID int
		fmt.Sscanf(externalID, "boost_%d_%d", &productID, &userID)

		if productID > 0 {
			// Update product boosted_at
			_, err := h.db.Exec("UPDATE products SET boosted_at = NOW() WHERE id = ?", productID)
			if err != nil {
				fmt.Printf("Webhook Error: Boost failed for product %d: %v\n", productID, err)
			}

			// Record Earnings
			_, err = h.db.Exec(`
				INSERT INTO earnings (user_id, amount, source_type, source_id, external_id)
				VALUES (?, ?, 'product_boost', ?, ?)`,
				userID, amount, productID, externalID)
		}
	} else if strings.HasPrefix(externalID, "user_premium_") {
		var userID int
		var tier string
		plan := "monthly"
		if strings.Count(externalID, "_") >= 4 {
			// user_premium_<tier>_<plan>_<userID> e.g. user_premium_plus_monthly_123
			parts := strings.Split(externalID, "_")
			tier = parts[2]
			plan = parts[3]
			fmt.Sscanf(parts[len(parts)-1], "%d", &userID)
		} else if strings.Count(externalID, "_") >= 3 {
			// user_premium_<tier>_<userID> e.g. user_premium_plus_123
			parts := strings.Split(externalID, "_")
			tier = parts[2]
			fmt.Sscanf(parts[len(parts)-1], "%d", &userID)
		} else {
			// user_premium_<userID> (legacy support)
			fmt.Sscanf(externalID, "user_premium_%d", &userID)
			tier = "plus" // Default to plus for legacy
		}

		if userID > 0 {
			// Extend subscription end date (stacking) based on plan
			var currentExpiry sql.NullTime
			_ = h.db.QueryRow("SELECT premium_expires_at FROM users WHERE id = ?", userID).Scan(&currentExpiry)
			start := time.Now()
			if currentExpiry.Valid && currentExpiry.Time.After(start) {
				start = currentExpiry.Time
			}
			newExpiry := start.AddDate(0, 0, getPremiumPlanDurationDays(h.db, tier, plan))

			// Update user status
			log.Printf("💎 Webhook: Granting %s premium to user %d (Amount: %.2f)", tier, userID, amount)
			_, err := h.db.Exec("UPDATE users SET is_premium = true, premium_tier = ?, verified = true, premium_expires_at = ? WHERE id = ?", tier, newExpiry, userID)
			if err != nil {
				log.Printf("❌ Webhook Error: User premium update failed for user %d: %v\n", userID, err)
				fmt.Printf("Webhook Error: User premium update failed for user %d: %v\n", userID, err)
			} else {
				log.Printf("✅ Webhook SUCCESS: Updated user %d to premium tier %s\n", userID, tier)
			}

			// Record Earnings
			_, err = h.db.Exec(`
				INSERT INTO earnings (user_id, amount, source_type, source_id, external_id)
				VALUES (?, ?, 'premium_upgrade', ?, ?)`,
				userID, amount, userID, externalID)
			if err != nil {
				log.Printf("❌ Earnings Error (User %d): %v\n", userID, err)
				fmt.Printf("Earnings Error (User %d): %v\n", userID, err)
			}
		}
	} else if strings.HasPrefix(externalID, "remittance_") {
		if err := h.handleRemittancePaid(externalID, amount); err != nil {
			log.Printf("Webhook Error: remittance apply failed for external_id=%s: %v", externalID, err)
		}
	}

	return c.SendStatus(200)
}

// GetUserSubscription returns the current subscription end date for the authenticated user.
func (h *PaymentHandler) GetUserSubscription(c *fiber.Ctx) error {
	userID := c.Locals("user_id").(int)
	var endDate sql.NullTime
	var tier string
	var isPremium bool
	if err := h.db.QueryRow("SELECT COALESCE(premium_tier, 'free'), COALESCE(is_premium, FALSE), premium_expires_at FROM users WHERE id = ?", userID).Scan(&tier, &isPremium, &endDate); err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to load subscription"})
	}

	var endDateStr *string
	if endDate.Valid {
		formatted := endDate.Time.Format("2006-01-02 15:04:05")
		endDateStr = &formatted
	}

	return c.JSON(models.APIResponse{Success: true, Data: fiber.Map{
		"tier":       tier,
		"is_premium": isPremium,
		"end_date":   endDateStr,
	}})
}

func (h *PaymentHandler) GetPremiumConfig(c *fiber.Ctx) error {
	enabled, plans, features, err := loadPaymentPremiumConfig(h.db)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to load premium configuration"})
	}
	activePlans := make([]paymentPremiumPlan, 0, len(plans))
	for _, plan := range plans {
		if plan.IsActive {
			activePlans = append(activePlans, plan)
		}
	}
	return c.JSON(models.APIResponse{Success: true, Data: fiber.Map{
		"enabled":  enabled,
		"plans":    activePlans,
		"features": features,
	}})
}
