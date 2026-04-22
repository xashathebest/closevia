package handlers

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"mime/multipart"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/xashathebest/clovia/database"
	"github.com/xashathebest/clovia/middleware"
	"github.com/xashathebest/clovia/models"
	"github.com/xashathebest/clovia/services"
)

// ProductHandler handles product-related HTTP requests
type ProductHandler struct {
	db *sql.DB
}

var ensureProductEstimateVisibilityColumnOnce sync.Once

// NewProductHandler creates a new product handler
func NewProductHandler() *ProductHandler {
	return &ProductHandler{
		db: database.DB,
	}
}

func (h *ProductHandler) ensureProductEstimateVisibilityColumn() {
	ensureProductEstimateVisibilityColumnOnce.Do(func() {
		var exists int
		err := h.db.QueryRow(`
			SELECT COUNT(*)
			FROM information_schema.COLUMNS
			WHERE TABLE_SCHEMA = DATABASE()
			AND TABLE_NAME = 'products'
			AND COLUMN_NAME = 'show_estimated_value'
		`).Scan(&exists)
		if err != nil {
			log.Printf("Warning: failed to check products.show_estimated_value column: %v", err)
			return
		}
		if exists > 0 {
			return
		}
		if _, err := h.db.Exec("ALTER TABLE products ADD COLUMN show_estimated_value BOOLEAN NOT NULL DEFAULT TRUE"); err != nil {
			log.Printf("Warning: failed to add products.show_estimated_value column: %v", err)
			return
		}
		log.Println("Added missing products.show_estimated_value column")
	})
}

func (h *ProductHandler) showOwnProductsOnHome() bool {
	var raw string
	if err := h.db.QueryRow("SELECT setting_value FROM app_settings WHERE setting_key = 'show_own_products_on_home'").Scan(&raw); err != nil {
		return true
	}
	enabled, err := strconv.ParseBool(strings.TrimSpace(raw))
	return err != nil || enabled
}

func hideEstimatedValueIfNeeded(product *models.Product) {
	if !product.ShowEstimatedValue {
		product.EstimatedValueMin = nil
		product.EstimatedValueMax = nil
	}
}

// Condition multipliers for calculating suggested value
var conditionMultipliers = map[string]float64{
	"New":      1.0,
	"Like-New": 0.8,
	"Used":     0.6,
	"Fair":     0.4,
}

// calculateSuggestedValue calculates the value in points based on price and condition.
func calculateSuggestedValue(price float64, condition string) int {
	multiplier, ok := conditionMultipliers[condition]
	if !ok {
		multiplier = 0.5 // Default multiplier for unknown conditions
	}
	// Assuming 1 PHP = 1 point for simplicity, then apply multiplier
	return int(price * multiplier)
}

// generateSlug creates a URL-friendly slug from title and appends a short UUID
func generateSlug(title string) string {
	// Convert to lowercase
	slug := strings.ToLower(title)

	// Remove special characters, keep only alphanumeric, spaces, and hyphens
	reg := regexp.MustCompile(`[^a-z0-9\s-]`)
	slug = reg.ReplaceAllString(slug, "")

	// Replace spaces with hyphens
	slug = strings.ReplaceAll(slug, " ", "-")

	// Remove multiple consecutive hyphens
	reg = regexp.MustCompile(`-+`)
	slug = reg.ReplaceAllString(slug, "-")

	// Trim hyphens from start and end
	slug = strings.Trim(slug, "-")

	// Limit length to 50 characters
	if len(slug) > 50 {
		slug = slug[:50]
		slug = strings.TrimRight(slug, "-")
	}

	// Generate short UUID (first 8 characters)
	shortUUID := uuid.New().String()[:8]

	// Combine slug with UUID: "eco-bag-3f8a9d2a"
	return fmt.Sprintf("%s-%s", slug, shortUUID)
}

// parseWantedCategories handles JSON arrays, quoted JSON strings, and CSV fallbacks.
func parseWantedCategories(raw string) models.StringArray {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return models.StringArray{}
	}

	var parsed []string
	if err := json.Unmarshal([]byte(raw), &parsed); err == nil {
		return models.StringArray(parsed)
	}

	parts := strings.Split(raw, ",")
	fallback := make([]string, 0, len(parts))
	for _, part := range parts {
		clean := strings.TrimSpace(strings.Trim(part, `"`))
		if clean != "" {
			fallback = append(fallback, clean)
		}
	}
	return models.StringArray(fallback)
}

// CreateProduct creates a new product
func (h *ProductHandler) CreateProduct(c *fiber.Ctx) error {
	h.ensureProductEstimateVisibilityColumn()

	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		log.Printf("❌ [CreateProduct] ERROR: Failed to extract userID from context")
		return c.Status(401).JSON(models.APIResponse{
			Success: false,
			Error:   "User not authenticated",
		})
	}

	// DEBUG LOG: Track which user is creating the product
	log.Printf("✅ [CreateProduct] User ID %d attempting to create product", userID)

	// Parse fields
	title := cleanUserText(c.FormValue("title"), 160)
	description := cleanUserText(c.FormValue("description"), 5000)
	priceStr := c.FormValue("price")
	// Fetch user tier, strikes and enforce data-driven listing limits
	var tier string
	var strikes int
	var role string
	h.db.QueryRow("SELECT COALESCE(premium_tier, 'free'), strikes, role FROM users WHERE id = ?", userID).Scan(&tier, &strikes, &role)

	// Strike Ladder Enforcement: 2 strikes = Restricted (cannot post new offers/listings)
	// Admin bypass: Admins are never restricted by strikes
	if strikes >= 2 && role != "admin" {
		return c.Status(403).JSON(models.APIResponse{
			Success: false,
			Error:   "Account Restricted: You cannot post new listings because you have 2 or more strikes. You can still finish your ongoing trades.",
		})
	} else if strikes >= 2 && role == "admin" {
		log.Printf("⚠️  [CreateProduct] Admin user %d has %d strikes but is allowed to post due to bypass", userID, strikes)
	}

	var activeCount int
	h.db.QueryRow("SELECT COUNT(*) FROM products WHERE seller_id = ? AND status = 'available'", userID).Scan(&activeCount)

	plan, _ := getUserPlanCapabilities(h.db, userID)
	limit := getCapInt(plan.Capabilities, "listing_limit", 10)

	if activeCount >= limit {
		return c.Status(403).JSON(models.APIResponse{
			Success: false,
			Error:   fmt.Sprintf("Your current plan (%s) allows up to %d active listings. Please upgrade to post more.", plan.Name, limit),
		})
	}

	var price *float64
	if priceStr != "" {
		p, err := strconv.ParseFloat(priceStr, 64)
		if err == nil {
			price = &p
		}
	}
	premium := c.FormValue("premium") == "true"
	allowBuying := c.FormValue("allow_buying") == "true"
	barterOnly := c.FormValue("barter_only") == "true"
	location := c.FormValue("location")
	condition := c.FormValue("condition")

	// Parse organization IDs for tagging (comma-separated or JSON array)
	organizationIDsStr := c.FormValue("organization_ids")
	var organizationIDs []int
	if organizationIDsStr != "" {
		log.Printf("📦 [CreateProduct] Parsing organization_ids: %s", organizationIDsStr)
		// Try JSON array first: [1,2,3]
		var jsonIDs []int
		if err := json.Unmarshal([]byte(organizationIDsStr), &jsonIDs); err == nil {
			organizationIDs = jsonIDs
			log.Printf("✅ [CreateProduct] Parsed as JSON: %v", jsonIDs)
		} else {
			// Try comma-separated: 1,2,3
			parts := strings.Split(organizationIDsStr, ",")
			for _, part := range parts {
				if id, err := strconv.Atoi(strings.TrimSpace(part)); err == nil && id > 0 {
					organizationIDs = append(organizationIDs, id)
				}
			}
			log.Printf("✅ [CreateProduct] Parsed as CSV: %v", organizationIDs)
		}
	} else {
		log.Printf("ℹ️  [CreateProduct] No organization_ids provided")
	}

	// AI Generated fields
	itemType := c.FormValue("item_type")
	brand := c.FormValue("brand")
	authenticityRisks := c.FormValue("authenticity_risks")
	tags := c.FormValue("tags") // Assuming this is sent as a JSON array string

	estimatedValueMinStr := c.FormValue("estimated_value_min")
	var estimatedValueMin *float64
	if estimatedValueMinStr != "" {
		if val, err := strconv.ParseFloat(estimatedValueMinStr, 64); err == nil {
			estimatedValueMin = &val
		}
	}

	estimatedValueMaxStr := c.FormValue("estimated_value_max")
	var estimatedValueMax *float64
	if estimatedValueMaxStr != "" {
		if val, err := strconv.ParseFloat(estimatedValueMaxStr, 64); err == nil {
			estimatedValueMax = &val
		}
	}
	showEstimatedValue := true
	if raw := c.FormValue("show_estimated_value"); raw != "" {
		if parsed, err := strconv.ParseBool(strings.TrimSpace(raw)); err == nil {
			showEstimatedValue = parsed
		}
	}

	wants := c.FormValue("wants")
	wantedCategories := c.FormValue("wanted_categories")

	desiredPriceStr := c.FormValue("desired_price")
	var desiredPrice *float64
	if desiredPriceStr != "" {
		if val, err := strconv.ParseFloat(desiredPriceStr, 64); err == nil {
			desiredPrice = &val
		}
	}
	desiredProduct := c.FormValue("desired_product")

	// Optional category override from client
	categoryOverride := c.FormValue("category")

	// Handle multiple file uploads
	form, err := c.MultipartForm()
	if err != nil {
		return c.Status(400).JSON(models.APIResponse{
			Success: false,
			Error:   "Failed to parse uploaded files",
		})
	}
	files := form.File["images"]
	// Enforce maximum of 8 images per item
	if len(files) > 8 {
		return c.Status(400).JSON(models.APIResponse{
			Success: false,
			Error:   "You can upload up to 8 images per product",
		})
	}
	var imagePaths []string
	for _, file := range files {
		if url, err := services.UploadFileToCloudinary(file, "products"); err == nil && url != "" {
			imagePaths = append(imagePaths, url)
			continue
		} else if err != nil && err != services.ErrCloudinaryDisabled {
			fmt.Printf("Cloudinary upload failed: %v\n", err)
		}

		localURL, err := saveFileLocally(c, file, "products")
		if err != nil {
			fmt.Printf("Local file save failed: %v\n", err)
			continue
		}
		imagePaths = append(imagePaths, localURL)
	}

	// Handle optional video upload (single file)
	var videoURL string
	videoFiles := form.File["video"]
	if len(videoFiles) > 0 {
		videoFile := videoFiles[0]
		// Limit video to 50MB
		if videoFile.Size > 50*1024*1024 {
			return c.Status(400).JSON(models.APIResponse{
				Success: false,
				Error:   "Video file must be under 50MB",
			})
		}
		if url, err := services.UploadFileToCloudinary(videoFile, "product-videos"); err == nil && url != "" {
			videoURL = url
		} else if err != nil {
			fmt.Printf("Video upload failed: %v\n", err)
		}
	}

	// Convert imagePaths to JSON
	imageURLsJSONBytes, err := json.Marshal(imagePaths)
	if err != nil {
		imageURLsJSONBytes = []byte("[]")
	}

	// Ensure DB non-null price: default to 0.0 if not provided
	var insertPrice float64 = 0.0
	if price != nil {
		insertPrice = *price
	}

	// Check for duplicate listings (same title, description, price, user, within 24h)
	var duplicateCount int
	duplicateCheckQuery := `SELECT COUNT(*) FROM products 
							WHERE seller_id = ? AND title = ? AND description = ? AND price = ? AND created_at > DATE_SUB(NOW(), INTERVAL 1 DAY)`
	err = h.db.QueryRow(duplicateCheckQuery, userID, title, description, insertPrice).Scan(&duplicateCount)
	if err == nil && duplicateCount > 0 {
		return c.Status(409).JSON(models.APIResponse{
			Success: false,
			Error:   "Duplicate listing detected. You have recently posted this exact item.",
		})
	}

	// Additional check: same cover image used within 24h by this seller (bypass prevention)
	if len(imagePaths) > 0 {
		firstImage := imagePaths[0]
		var imgDupCount int
		imgDupErr := h.db.QueryRow(
			`SELECT COUNT(*) FROM products
			 WHERE seller_id = ? AND image_urls LIKE ?
			 AND created_at > DATE_SUB(NOW(), INTERVAL 1 DAY)
			 AND status <> 'deleted'`,
			userID, "%"+firstImage+"%",
		).Scan(&imgDupCount)
		if imgDupErr == nil && imgDupCount > 0 {
			return c.Status(409).JSON(models.APIResponse{
				Success: false,
				Error:   "Duplicate listing detected. You have recently posted an item using the same image.",
			})
		}
	}

	// Use AI-enhanced appraisal for intelligent category detection
	appraisal := services.AppraiseProductWithAI(title, description)
	category := appraisal.Category
	if categoryOverride != "" {
		category = categoryOverride
	}

	// If user did not specify a condition, use the appraised one
	finalCondition := condition
	if finalCondition == "" {
		finalCondition = appraisal.Condition
	}

	// Get product location coordinates
	// Priority 1: Use lat/lng submitted directly from the map picker in the form (most accurate)
	// Priority 2: Use user's saved home address (home_latitude/home_longitude)
	// Priority 3: Geocode the location text string
	var lat, lon *float64

	latStr := c.FormValue("latitude")
	lonStr := c.FormValue("longitude")
	if latStr != "" && lonStr != "" {
		if parsedLat, err := strconv.ParseFloat(latStr, 64); err == nil {
			if parsedLon, err := strconv.ParseFloat(lonStr, 64); err == nil {
				lat = &parsedLat
				lon = &parsedLon
				log.Printf("📍 [CreateProduct] Using map-picked coords: %.6f, %.6f", parsedLat, parsedLon)
			}
		}
	}

	if lat == nil || lon == nil {
		// Try user's saved home address coordinates
		var homeLatNull, homeLonNull sql.NullFloat64
		h.db.QueryRow("SELECT home_latitude, home_longitude FROM users WHERE id = ?", userID).Scan(&homeLatNull, &homeLonNull)
		if homeLatNull.Valid && homeLonNull.Valid {
			lat = &homeLatNull.Float64
			lon = &homeLonNull.Float64
			log.Printf("🏠 [CreateProduct] Using home address coords: %.6f, %.6f", homeLatNull.Float64, homeLonNull.Float64)
		}
	}

	if lat == nil || lon == nil {
		if location != "" {
			coords, err := services.GetCoordinates(location)
			if err == nil {
				lat = &coords.Latitude
				lon = &coords.Longitude
				log.Printf("🌍 [CreateProduct] Using geocoded coords for '%s': %.6f, %.6f", location, coords.Latitude, coords.Longitude)
			}
		}
	}

	// Calculate suggested value
	suggestedValue := calculateSuggestedValue(insertPrice, finalCondition)

	// Detect counterfeit
	report := services.DetectCounterfeit(title, description, insertPrice)
	finalDescription := description
	if report.IsSuspicious {
		finalDescription = "[SUSPICIOUS] " + report.Reason + ". " + finalDescription
	}

	// Generate unique slug
	slug := generateSlug(title)

	// OPTIMIZED: Single batch query for slug uniqueness instead of loop
	// Try base slug and up to 3 variants in a single query
	var existingSlugs int
	baseSlug := slug
	err = h.db.QueryRow(`
		SELECT COUNT(*) FROM products 
		WHERE slug IN (?, ?, ?, ?)`,
		slug,
		fmt.Sprintf("%s-1", baseSlug),
		fmt.Sprintf("%s-2", baseSlug),
		fmt.Sprintf("%s-3", baseSlug),
	).Scan(&existingSlugs)

	// If none exist, use base slug; otherwise append counter efficiently
	if err == nil && existingSlugs > 0 {
		// Quick second check to find next available
		for i := 1; i <= 10; i++ {
			testSlug := fmt.Sprintf("%s-%d", baseSlug, i)
			var found int
			h.db.QueryRow("SELECT COUNT(*) FROM products WHERE slug = ?", testSlug).Scan(&found)
			if found == 0 {
				slug = testSlug
				break
			}
		}
	}

	// ==================== QUICK HEURISTIC FRAUD CHECKS ====================
	// Check for obvious fraud patterns BEFORE creating the product
	log.Printf("🔍 [FRAUD-HEURISTIC] Checking for obvious fraud patterns...")
	var evMin float64 = 0.0
	if estimatedValueMin != nil {
		evMin = *estimatedValueMin
	}
	isFraud, reason := services.FraudHeuristicCheck(title, description, wants, insertPrice, evMin, wantedCategories)
	if isFraud {
		log.Printf("🚫 [FRAUD-HEURISTIC] BLOCKED - %s", reason)
		return c.Status(400).JSON(models.APIResponse{
			Success: false,
			Error:   "Your product listing failed our initial verification: " + reason + ". Please ensure your listing contains legitimate product information.",
		})
	}
	log.Printf("✅ [FRAUD-HEURISTIC] Passed basic checks, will now create product...")

	// Insert new product with slug. Build SQL dynamically so it's tolerant
	// to missing latitude/longitude columns (some DBs may not have applied migrations).
	cols := []string{"slug", "title", "description", "price", "image_urls", "seller_id", "premium", "allow_buying", "barter_only", "location", "status", "`condition`", "suggested_value", "category", "wants", "wanted_categories", "item_type", "brand", "authenticity_risks", "tags", "estimated_value_min", "estimated_value_max", "show_estimated_value", "desired_price", "desired_product"}
	placeholders := []string{"?", "?", "?", "?", "?", "?", "?", "?", "?", "?", "?", "?", "?", "?", "?", "?", "?", "?", "?", "?", "?", "?", "?", "?", "?"}
	args := []interface{}{slug, title, finalDescription, insertPrice, string(imageURLsJSONBytes), userID, premium, allowBuying, barterOnly, location, "available", finalCondition, suggestedValue, category, wants, wantedCategories, itemType, brand, authenticityRisks, tags, estimatedValueMin, estimatedValueMax, showEstimatedValue, desiredPrice, desiredProduct}

	// Include video_url if a video was uploaded
	if videoURL != "" {
		cols = append(cols, "video_url")
		placeholders = append(placeholders, "?")
		args = append(args, videoURL)
	}

	// Only include latitude/longitude if coordinates are available
	if lat != nil && lon != nil {
		cols = append(cols, "latitude", "longitude")
		placeholders = append(placeholders, "?", "?")
		args = append(args, *lat, *lon)
		log.Printf("📥 [CreateProduct] Final coordinates to be saved: lat=%f, lon=%f", *lat, *lon)
	} else {
		log.Printf("⚠️ [CreateProduct] Final result: NO COORDINATES to be saved")
	}

	sqlStr := fmt.Sprintf("INSERT INTO products (%s) VALUES (%s)", strings.Join(cols, ", "), strings.Join(placeholders, ", "))
	result, err := h.db.Exec(sqlStr, args...)
	if err != nil {
		fmt.Printf("CreateProduct - insert error: %+v\n", err)
		return c.Status(500).JSON(models.APIResponse{
			Success: false,
			Error:   fmt.Sprintf("Failed to create product: %v", err),
		})
	}

	productID, _ := result.LastInsertId()

	// DEBUG LOG: Confirm product was created with correct seller_id
	log.Printf("✅ [CreateProduct] Product #%d successfully created for seller_id=%d | Title: %s",
		productID, userID, title)

	// Store counterfeit detection results
	if report.IsSuspicious {
		flagsJSON, _ := json.Marshal(report.Flags)
		_, _ = h.db.Exec(
			"UPDATE products SET counterfeit_confidence = ?, counterfeit_flags = ?, last_counterfeit_check_at = CURRENT_TIMESTAMP WHERE id = ?",
			report.Confidence, string(flagsJSON), productID,
		)
	} else {
		_, _ = h.db.Exec(
			"UPDATE products SET counterfeit_confidence = 0, last_counterfeit_check_at = CURRENT_TIMESTAMP WHERE id = ?",
			productID,
		)
	}

	// Get the created product
	var createdProduct models.Product
	var slugNull sql.NullString
	var createdVideoURL sql.NullString
	var wantsNull sql.NullString
	var wantedCategoriesRaw sql.NullString
	err = h.db.QueryRow(
		"SELECT id, slug, title, description, price, image_urls, video_url, seller_id, premium, status, allow_buying, barter_only, location, `condition`, suggested_value, category, estimated_value_min, estimated_value_max, COALESCE(show_estimated_value, TRUE), `value`, wants, wanted_categories, created_at, updated_at FROM products WHERE id = ?",
		productID,
	).Scan(&createdProduct.ID, &slugNull, &createdProduct.Title, &createdProduct.Description, &createdProduct.Price,
		&createdProduct.ImageURLs, &createdVideoURL, &createdProduct.SellerID, &createdProduct.Premium, &createdProduct.Status,
		&createdProduct.AllowBuying, &createdProduct.BarterOnly, &createdProduct.Location,
		&createdProduct.Condition, &createdProduct.SuggestedValue, &createdProduct.Category,
		&createdProduct.EstimatedValueMin, &createdProduct.EstimatedValueMax, &createdProduct.ShowEstimatedValue, &createdProduct.Value,
		&wantsNull, &wantedCategoriesRaw,
		&createdProduct.CreatedAt, &createdProduct.UpdatedAt)

	if wantsNull.Valid {
		createdProduct.Wants = wantsNull.String
	}
	if wantedCategoriesRaw.Valid {
		createdProduct.WantedCategories = parseWantedCategories(wantedCategoriesRaw.String)
	}

	if slugNull.Valid {
		createdProduct.Slug = slugNull.String
	}
	hideEstimatedValueIfNeeded(&createdProduct)
	if createdVideoURL.Valid {
		createdProduct.VideoURL = createdVideoURL.String
	}

	if err != nil {
		return c.Status(500).JSON(models.APIResponse{
			Success: false,
			Error:   "Failed to retrieve created product",
		})
	}

	// ==================== FRAUD DETECTION (ASYNC - Non-blocking) ====================
	// Run fraud detection in background to speed up response time
	// HIGH risk fraud is still detected before product creation, so this is a secondary check
	go func() {
		log.Printf("🔍 [FRAUD] Running fraud detection for product %d", productID)
		fraudService := services.NewFraudDetectionService()

		// Get seller statistics
		sellerStats, err := services.GetSellerStats(h.db, userID)
		if err != nil {
			log.Printf("⚠️  [FRAUD] Failed to get seller stats: %v", err)
			sellerStats = &services.SellerStats{
				TotalTrades:     0,
				TradesLast7Days: 0,
				AvgItemValue:    0,
				AccountAgeDays:  0,
			}
		}

		// Extract fraud detection features
		fraudInput := services.ExtractFraudDetectionFeatures(
			h.db,
			&createdProduct,
			sellerStats,
			category,
			false,
		)

		// Run fraud detection
		fraudResult, _ := fraudService.DetectFraud(fraudInput)

		// Log for monitoring and model retraining
		_ = services.LogFraudPrediction(int(productID), userID, fraudResult)

		// Check fraud result
		if fraudResult.Success {
			// Update product with fraud assessment (non-blocking, in background)
			_, _ = h.db.Exec(
				"UPDATE products SET fraud_risk_level = ?, fraud_probability = ?, last_fraud_check_at = CURRENT_TIMESTAMP WHERE id = ?",
				fraudResult.RiskLevel,
				fraudResult.FraudProbability,
				productID,
			)

			switch fraudResult.RiskLevel {
			case "high":
				// Even if high risk in async check, log and flag for admin review
				log.Printf("🚫 [FRAUD] HIGH FRAUD RISK DETECTED (%.2f%%) - Flagging for admin", fraudResult.FraudProbability*100)
			case "medium":
				log.Printf("⚠️  [FRAUD] Medium fraud risk detected (%.2f%%) - Product monitored", fraudResult.FraudProbability*100)
			case "low":
				log.Printf("✅ [FRAUD] Low fraud risk (%.2f%%) - Product approved", fraudResult.FraudProbability*100)
			}
		} else {
			log.Printf("⚠️  [FRAUD] Fraud detection service error: %s", fraudResult.Error)
		}

		// Also trigger notifications in the same background operation
		services.TriggerSmartNotifications(h.db, int(productID), userID, title, category)
	}()
	// ========================================================================

	// ==================== TAG ORGANIZATIONS ====================
	// If user provided organization IDs, validate membership/ownership and tag product
	if len(organizationIDs) > 0 {
		log.Printf("📦 [ORG-TAG] User %d is tagging product %d with %d organizations", userID, productID, len(organizationIDs))

		for _, orgID := range organizationIDs {
			// Check if user is the creator OR an approved member of this organization
			var creatorID int
			var memberStatus sql.NullString
			err := h.db.QueryRow(`
				SELECT o.creator_user_id, COALESCE(m.status, '') as member_status
				FROM organizations o
				LEFT JOIN organization_memberships m ON o.id = m.organization_id AND m.user_id = ?
				WHERE o.id = ?
			`, userID, orgID).Scan(&creatorID, &memberStatus)
			if err == sql.ErrNoRows {
				log.Printf("⚠️  [ORG-TAG] Organization %d does not exist, skipping tag", orgID)
				continue
			}
			if err != nil {
				log.Printf("❌ [ORG-TAG] Database error checking organization %d: %v", orgID, err)
				continue
			}

			isCreator := creatorID == userID
			isApprovedMember := memberStatus.Valid && memberStatus.String == "approved"
			if !isCreator && !isApprovedMember {
				log.Printf("⚠️  [ORG-TAG] User %d is neither creator nor approved member of org %d, skipping tag", userID, orgID)
				continue
			}

			log.Printf("✅ [ORG-TAG] Tagging product %d with org %d (creator=%v, approved_member=%v)", productID, orgID, isCreator, isApprovedMember)

			// Insert into product_organization_tags
			_, err = h.db.Exec(`
				INSERT IGNORE INTO product_organization_tags (product_id, organization_id)
				VALUES (?, ?)
			`, productID, orgID)

			if err != nil {
				log.Printf("❌ [ORG-TAG] Failed to tag product %d with org %d: %v", productID, orgID, err)
			} else {
				log.Printf("✅ [ORG-TAG] Product %d tagged with org %d", productID, orgID)
			}
		}
	}
	// ========================================================================

	return c.Status(201).JSON(models.APIResponse{
		Success: true,
		Message: "Product created successfully",
		Data:    createdProduct,
	})
}

// GetProducts gets all products with search and filtering
func (h *ProductHandler) GetProducts(c *fiber.Ctx) error {
	h.ensureProductEstimateVisibilityColumn()

	fmt.Println("🔍 [DEBUG] GetProducts called")

	// Parse query parameters
	keyword := c.Query("keyword", "")
	condition := c.Query("condition", "")
	verifiedSellerOnlyStr := c.Query("verified_seller_only", "")
	hasActiveOffersStr := c.Query("has_active_offers", "")
	sortBy := c.Query("sort_by", "most_relevant")
	premiumStr := c.Query("premium", "")
	sellerIDStr := c.Query("seller_id", "")
	barterOnlyStr := c.Query("barter_only", "")
	allowBuyingStr := c.Query("allow_buying", "")
	page, _ := strconv.Atoi(c.Query("page", "1"))
	limit, _ := strconv.Atoi(c.Query("limit", "20"))

	fmt.Printf("🔍 [DEBUG] Query params - keyword: %s, sortBy: %s, page: %d, limit: %d\n", keyword, sortBy, page, limit)

	// Support optional offset-based pagination (limit & offset)
	if limit <= 0 {
		limit = 20
	}
	offsetParam := c.Query("offset", "")
	var offset int
	if offsetParam != "" {
		if o, err := strconv.Atoi(offsetParam); err == nil && o >= 0 {
			offset = o
			if limit > 0 {
				page = (offset / limit) + 1
			} else {
				page = 1
			}
		} else {
			offset = (page - 1) * limit
		}
	} else {
		offset = (page - 1) * limit
	}

	// Build WHERE clause
	whereClause := "WHERE 1=1"
	var args []interface{}

	if keyword != "" {
		// Broaden keyword search across product attributes and seller/org details
		whereClause += " AND (p.title LIKE ? OR p.description LIKE ? OR p.category LIKE ? OR p.`condition` LIKE ? OR u.name LIKE ? OR p.brand LIKE ? OR p.item_type LIKE ? OR p.tags LIKE ?)"
		searchPattern := "%" + keyword + "%"
		args = append(args, searchPattern, searchPattern, searchPattern, searchPattern, searchPattern, searchPattern, searchPattern, searchPattern)
	}

	if condition != "" {
		whereClause += " AND p.`condition` = ?"
		args = append(args, condition)
	}

	if premiumStr != "" {
		if premium, err := strconv.ParseBool(premiumStr); err == nil {
			whereClause += " AND p.premium = ?"
			args = append(args, premium)
		}
	}

	// For the general public feed, default to 'available' status
	if sellerIDStr != "" {
		// If filtering by seller, show all non-deleted products.
		if sellerID, err := strconv.Atoi(sellerIDStr); err == nil {
			whereClause += " AND p.seller_id = ? AND p.status <> 'deleted'"
			args = append(args, sellerID)
		}
	} else {
		// For the general public feed, default to 'available' status
		whereClause += " AND p.status = 'available'"
		if viewerID, ok := middleware.GetUserIDFromContext(c); ok && !h.showOwnProductsOnHome() {
			whereClause += " AND p.seller_id != ?"
			args = append(args, viewerID)
		}
	}

	if barterOnlyStr != "" {
		if barterOnly, err := strconv.ParseBool(barterOnlyStr); err == nil {
			whereClause += " AND p.barter_only = ?"
			args = append(args, barterOnly)
		}
	}

	if allowBuyingStr != "" {
		if allowBuying, err := strconv.ParseBool(allowBuyingStr); err == nil {
			whereClause += " AND p.allow_buying = ?"
			args = append(args, allowBuying)
		}
	}

	if verifiedSellerOnlyStr != "" {
		if verifiedOnly, err := strconv.ParseBool(verifiedSellerOnlyStr); err == nil && verifiedOnly {
			// Filter for only verified sellers - assuming verified field exists in users table
			whereClause += " AND u.verified = true"
		}
	}

	if hasActiveOffersStr != "" {
		if hasOffers, err := strconv.ParseBool(hasActiveOffersStr); err == nil {
			if hasOffers {
				// Products with active offers/trades
				whereClause += " AND (SELECT COUNT(*) FROM trades WHERE target_product_id = p.id AND status NOT IN ('declined', 'cancelled', 'cancelled_due_to_conflict', 'completed', 'auto_completed', 'expired', 'broken', 'history')) > 0"
			} else {
				// Products without active offers
				whereClause += " AND (SELECT COUNT(*) FROM trades WHERE target_product_id = p.id AND status NOT IN ('declined', 'cancelled', 'cancelled_due_to_conflict', 'completed', 'auto_completed', 'expired', 'broken', 'history')) = 0"
			}
		}
	}

	// Dedicated category filter: exact match on category OR keyword match in title/description
	categoryFilter := c.Query("category", "")
	if categoryFilter != "" {
		whereClause += " AND (p.category = ? OR p.title LIKE ? OR p.description LIKE ?)"
		catLike := "%" + categoryFilter + "%"
		args = append(args, categoryFilter, catLike, catLike)
	}

	// Get total count
	// NOTE: join users table here because WHERE can reference u.* fields
	countQuery := "SELECT COUNT(*) FROM products p LEFT JOIN users u ON p.seller_id = u.id " + whereClause
	var total int
	err := h.db.QueryRow(countQuery, args...).Scan(&total)

	if err != nil {
		// Enhanced debugging: print query and args
		fmt.Println("❌ Count query failed!")
		fmt.Println("Query:", countQuery)
		fmt.Println("Args:", args)
		fmt.Println("Error:", err.Error())
		return c.Status(500).JSON(models.APIResponse{
			Success: false,
			Error:   "Failed to get product count",
		})
	}

	// Parse optional viewer coordinates early so we can use them in ORDER BY
	viewerLatStr := c.Query("viewer_lat", "")
	viewerLonStr := c.Query("viewer_lng", "")
	var viewerLat, viewerLon *float64
	if viewerLatStr != "" && viewerLonStr != "" {
		if lat, err2 := strconv.ParseFloat(viewerLatStr, 64); err2 == nil {
			if lon, err2 := strconv.ParseFloat(viewerLonStr, 64); err2 == nil {
				viewerLat = &lat
				viewerLon = &lon
				log.Printf("📥 [GetProducts] Received Viewer Coords: lat=%f, lng=%f", lat, lon)
			}
		}
	} else {
		log.Printf("⚠️ [GetProducts] No Viewer Coords received (viewer_lat='%s', viewer_lng='%s')", viewerLatStr, viewerLonStr)
	}

	// Haversine distance expression (result in km). Returns NULL when target has no coords.
	// Uses the seller's home location (same source as the displayed ProximityBadge) so
	// sort order matches the distance shown on each card. Falls back to seller's general
	// lat/lon, then to the product's own coords if neither is set.
	// Formula: 6371 * acos( cos(r(vlat))*cos(r(tlat))*cos(r(tlng)-r(vlng)) + sin(r(vlat))*sin(r(tlat)) )
	var haversineExpr string
	if viewerLat != nil && viewerLon != nil {
		targetLat := "COALESCE(u.home_latitude, u.latitude, p.latitude)"
		targetLon := "COALESCE(u.home_longitude, u.longitude, p.longitude)"
		haversineExpr = fmt.Sprintf(
			`(6371 * ACOS(COS(RADIANS(%f)) * COS(RADIANS(%s)) * COS(RADIANS(%s) - RADIANS(%f)) + SIN(RADIANS(%f)) * SIN(RADIANS(%s))))`,
			*viewerLat, targetLat, targetLon, *viewerLon, *viewerLat, targetLat,
		)
	} else {
		haversineExpr = "NULL"
	}

	// Use the full query with proper WHERE clause handling
	query := `
		SELECT p.id, COALESCE(p.slug, '') as slug, p.title, COALESCE(p.description, '') as description, p.price, COALESCE(p.image_urls, '[]') as image_urls, p.seller_id,
		       p.premium, p.status, p.allow_buying, p.barter_only, COALESCE(p.location, '') as location, COALESCE(p.` + "`condition`" + `, '') as ` + "`condition`" + `,
		       p.suggested_value, COALESCE(p.category, 'General') as category, p.estimated_value_min, p.estimated_value_max, COALESCE(p.show_estimated_value, TRUE), p.` + "`value`" + `, p.wants, p.wanted_categories, p.location_type, p.pickup_latitude, p.pickup_longitude, p.pickup_address, p.latitude, p.longitude, p.created_at, p.updated_at, p.boosted_at,
		       COALESCE(u.name, 'User') as seller_name, COALESCE(u.profile_picture, '') as seller_profile_picture,
		       u.latitude as seller_latitude, u.longitude as seller_longitude,
		   (SELECT COUNT(*) FROM wishlists w WHERE w.product_id = p.id) as want_count,
		   (SELECT COUNT(*) FROM trades t WHERE t.target_product_id = p.id AND t.status = 'pending') as offer_count,
		   ` + haversineExpr + ` AS distance_km
	FROM products p
	LEFT JOIN users u ON p.seller_id = u.id
	` + whereClause

	// Apply sorting based on sort_by parameter
	tierSort := "(CASE WHEN u.premium_tier = 'pro' THEN 3 WHEN u.premium_tier = 'plus' THEN 2 ELSE 1 END)"
	// Check if boost is still active (less than 3 hours old) - this should be prioritized HIGH
	isActiveBoosted := "(CASE WHEN p.boosted_at IS NOT NULL AND p.boosted_at > DATE_SUB(NOW(), INTERVAL 3 HOUR) THEN 1 ELSE 0 END)"
	boostTimestamp := "(CASE WHEN p.boosted_at IS NOT NULL AND p.boosted_at > DATE_SUB(NOW(), INTERVAL 3 HOUR) THEN p.boosted_at ELSE p.created_at END)"

	switch sortBy {
	case "nearest":
		// Active-boosted stays on top; everything else sorted purely by distance (closest first).
		query += fmt.Sprintf(` ORDER BY %s DESC, ISNULL(distance_km) ASC, distance_km ASC`, isActiveBoosted)
	case "newest":
		query += fmt.Sprintf(` ORDER BY p.premium DESC, %s DESC, %s DESC, %s DESC`, isActiveBoosted, tierSort, boostTimestamp)
	case "most_offers":
		query += fmt.Sprintf(` ORDER BY p.premium DESC, %s DESC, %s DESC, (SELECT COUNT(*) FROM trades t WHERE t.target_product_id = p.id AND t.status NOT IN ('declined', 'cancelled', 'completed')) DESC, %s DESC`, isActiveBoosted, tierSort, boostTimestamp)
	case "trending":
		query += fmt.Sprintf(` ORDER BY p.premium DESC, %s DESC, %s DESC, (SELECT COUNT(*) FROM wishlists w WHERE w.product_id = p.id) DESC, %s DESC`, isActiveBoosted, tierSort, boostTimestamp)
	default: // most_relevant — when viewer coords available, sort by distance by default
		if viewerLat != nil {
			// Active-boosted stays on top; below that, distance wins regardless of premium flag/tier.
			query += fmt.Sprintf(` ORDER BY %s DESC, ISNULL(distance_km) ASC, distance_km ASC, %s DESC`, isActiveBoosted, boostTimestamp)
		} else {
			query += fmt.Sprintf(` ORDER BY p.premium DESC, %s DESC, %s DESC, %s DESC`, isActiveBoosted, tierSort, boostTimestamp)
		}
	}

	query += ` LIMIT ? OFFSET ?`
	args = append(args, limit, offset)

	fmt.Println("🔍 [DEBUG] About to execute main products query")
	rows, err := h.db.Query(query, args...)
	if err != nil {
		fmt.Println("❌ [DEBUG] Products query FAILED!")
		fmt.Println("Query:", query)
		fmt.Println("Args:", args)
		fmt.Println("Error:", err.Error())
		return c.Status(500).JSON(models.APIResponse{
			Success: false,
			Error:   "Failed to get products",
		})
	}
	fmt.Println("✅ [DEBUG] Main products query succeeded, iterating rows")
	defer rows.Close()

	var products []models.Product
	for rows.Next() {
		var product models.Product
		var slugNull sql.NullString
		var conditionNull sql.NullString
		var priceNull sql.NullFloat64
		var sellerProfile sql.NullString
		var imageURLsJSONStr string
		var latNull, lonNull, sLatNull, sLonNull sql.NullFloat64
		var boostedAtNull sql.NullTime
		var locationTypeNull sql.NullString
		var pickupLatNull, pickupLonNull sql.NullFloat64
		var pickupAddressNull sql.NullString
		var wantsNull sql.NullString
		var wantedCategoriesRaw sql.NullString
		var distKmNull sql.NullFloat64
		err := rows.Scan(&product.ID, &slugNull, &product.Title, &product.Description, &priceNull,
			&imageURLsJSONStr, &product.SellerID, &product.Premium, &product.Status,
			&product.AllowBuying, &product.BarterOnly, &product.Location,
			&conditionNull, &product.SuggestedValue, &product.Category,
			&product.EstimatedValueMin, &product.EstimatedValueMax, &product.ShowEstimatedValue, &product.Value,
			&wantsNull, &wantedCategoriesRaw,
			&locationTypeNull, &pickupLatNull, &pickupLonNull, &pickupAddressNull,
			&latNull, &lonNull, &product.CreatedAt, &product.UpdatedAt, &boostedAtNull,
			&product.SellerName, &sellerProfile, &sLatNull, &sLonNull, &product.WantCount, &product.OfferCount,
			&distKmNull)

		if wantsNull.Valid {
			product.Wants = wantsNull.String
		}
		if wantedCategoriesRaw.Valid {
			product.WantedCategories = parseWantedCategories(wantedCategoriesRaw.String)
		}
		if locationTypeNull.Valid {
			product.LocationType = locationTypeNull.String
		}
		if pickupLatNull.Valid {
			product.PickupLatitude = &pickupLatNull.Float64
		}
		if pickupLonNull.Valid {
			product.PickupLongitude = &pickupLonNull.Float64
		}
		if pickupAddressNull.Valid {
			product.PickupAddress = pickupAddressNull.String
		}
		if slugNull.Valid {
			product.Slug = slugNull.String
		}
		if err != nil {
			fmt.Printf("GetProducts row scan error: %v\n", err)
			continue
		}
		if boostedAtNull.Valid {
			product.BoostedAt = &boostedAtNull.Time
		}
		if conditionNull.Valid {
			product.Condition = conditionNull.String
		} else {
			product.Condition = ""
		}
		if priceNull.Valid {
			p := priceNull.Float64
			product.Price = &p
		} else {
			product.Price = nil
		}
		if sellerProfile.Valid {
			product.SellerProfilePicture = sellerProfile.String
		}

		if latNull.Valid {
			l := latNull.Float64
			product.Latitude = &l
		}
		if lonNull.Valid {
			l := lonNull.Float64
			product.Longitude = &l
		}
		_ = sLatNull
		_ = sLonNull

		// Parse image URLs from JSON
		if imageURLsJSONStr != "" {
			var imageURLs []string
			if err := json.Unmarshal([]byte(imageURLsJSONStr), &imageURLs); err == nil {
				product.ImageURLs = models.StringArray(imageURLs)
			}
		}

		// Use the SQL-computed Haversine distance (most accurate — all math in MySQL)
		if distKmNull.Valid {
			distKm := distKmNull.Float64
			var pLat, pLon float64
			if product.Latitude != nil {
				pLat = *product.Latitude
			}
			if product.Longitude != nil {
				pLon = *product.Longitude
			}
			log.Printf("📏 [GetProducts] Product ID %d (%s) - Lat=%.6f, Lng=%.6f - Raw SQL dist: %.6f km",
				product.ID, product.Title, pLat, pLon, distKm)
			if distKm < 1 {
				product.Distance = fmt.Sprintf("%dM AWAY", int(distKm*1000))
			} else if distKm < 10 {
				product.Distance = fmt.Sprintf("%.1fKM AWAY", distKm)
			} else {
				product.Distance = fmt.Sprintf("%dKM AWAY", int(distKm))
			}
		} else {
			log.Printf("📏 [GetProducts] Product ID %d (%s) - NO DISTANCE COMPUTED (NULL coordinates)", product.ID, product.Title)
		}

		hideEstimatedValueIfNeeded(&product)
		products = append(products, product)
	}

	// Collect product IDs for batch organization tagging query
	productIDs := make([]int, len(products))
	for i, p := range products {
		productIDs[i] = p.ID

		// Background geocoding temporarily disabled due to connection pool issues
		// if p.Location != "" && p.Latitude == nil && p.Longitude == nil {
		// 	go func(productID int, loc string) {
		// 		coords, err := services.GetCoordinates(loc)
		// 		if err != nil {
		// 			return
		// 		}
		// 		_, _ = h.db.Exec(
		// 			"UPDATE products SET latitude = ?, longitude = ? WHERE id = ?",
		// 			coords.Latitude, coords.Longitude, productID,
		// 		)
		// 		fmt.Printf("📍 Geocoded product %d (%s) -> %.6f, %.6f\n", productID, loc, coords.Latitude, coords.Longitude)
		// 	}(p.ID, p.Location)
		// }
	}

	// Batch fetch organization tags for all products - TEMPORARILY DISABLED
	if false && len(productIDs) > 0 {
		// Build placeholder string for IN clause: ?,?,?,...
		placeholders := make([]string, len(productIDs))
		orgArgs := make([]interface{}, len(productIDs))
		for i, id := range productIDs {
			placeholders[i] = "?"
			orgArgs[i] = id
		}
		inClause := strings.Join(placeholders, ",")

		orgRows, err := h.db.Query(fmt.Sprintf(`
			SELECT pot.product_id, o.id, o.name, o.slug, COALESCE(o.logo_url, ''), COALESCE(o.description, '')
			FROM product_organization_tags pot
			JOIN organizations o ON pot.organization_id = o.id
			WHERE pot.product_id IN (%s) AND o.is_deleted = FALSE
			ORDER BY pot.product_id, o.name ASC
		`, inClause), orgArgs...)

		if err == nil && orgRows != nil {
			// Map organization tags by product ID
			orgTagsByProduct := make(map[int][]models.Organization)
			for orgRows.Next() {
				var productID int
				var org models.Organization
				if err := orgRows.Scan(&productID, &org.ID, &org.Name, &org.Slug, &org.LogoURL, &org.Description); err == nil {
					orgTagsByProduct[productID] = append(orgTagsByProduct[productID], org)
				}
			}
			orgRows.Close() // Explicitly close immediately

			// Assign organization tags to products
			for i := range products {
				if tags, ok := orgTagsByProduct[products[i].ID]; ok {
					products[i].OrganizationTags = tags
				}
			}
		}
	}

	// Compute distances for all products
	for i := range products {
		p := &products[i]
		if viewerLat != nil && viewerLon != nil && p.Latitude != nil && p.Longitude != nil {
			result := services.CalculateDistance(*viewerLat, *viewerLon, *p.Latitude, *p.Longitude)
			var distStr string
			if result.DistanceKm < 1 {
				distStr = fmt.Sprintf("%d M", int(result.DistanceM))
			} else if result.DistanceKm < 10 {
				distStr = fmt.Sprintf("%.1f KM", result.DistanceKm)
			} else {
				distStr = fmt.Sprintf("%d KM", int(result.DistanceKm))
			}
			p.Distance = distStr
		}
	}

	totalPages := (total + limit - 1) / limit

	// Ensure products is never nil (always a slice)
	if products == nil {
		products = []models.Product{}
	}

	fmt.Printf("✅ [DEBUG] GetProducts completed successfully. Returning %d products\n", len(products))

	return c.JSON(models.APIResponse{
		Success: true,
		Data: models.PaginatedResponse{
			Data:       products,
			Total:      total,
			Page:       page,
			Limit:      limit,
			TotalPages: totalPages,
		},
	})
}

func saveFileLocally(c *fiber.Ctx, file *multipart.FileHeader, folder string) (string, error) {
	fsPath, publicPath := services.GenerateLocalMediaPaths(folder, file.Filename)
	if err := os.MkdirAll(filepath.Dir(fsPath), 0o755); err != nil {
		return "", err
	}
	if err := c.SaveFile(file, fsPath); err != nil {
		return "", err
	}
	return publicPath, nil
}

// DuplicateProduct allows Plus/Pro users to relist an item in one tap
func (h *ProductHandler) DuplicateProduct(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}

	productID := c.Params("id")

	// Check user tier
	var tier string
	h.db.QueryRow("SELECT COALESCE(premium_tier, 'free') FROM users WHERE id = ?", userID).Scan(&tier)
	if tier == "free" {
		return c.Status(403).JSON(models.APIResponse{Success: false, Error: "Relisting in one tap is only available for Plus and Pro members."})
	}

	// Fetch original product (must own it)
	var title, desc, category, condition, wants, imageURLsJSON string
	var price *float64
	err := h.db.QueryRow("SELECT title, description, price, category, `condition`, wants, image_urls FROM products WHERE id = ? AND seller_id = ?", productID, userID).Scan(
		&title, &desc, &price, &category, &condition, &wants, &imageURLsJSON)

	if err != nil {
		return c.Status(404).JSON(models.APIResponse{Success: false, Error: "Product not found or access denied."})
	}

	// Check listing limit for Plus/Pro
	var count int
	h.db.QueryRow("SELECT COUNT(*) FROM products WHERE seller_id = ? AND status = 'available'", userID).Scan(&count)
	if tier == "plus" && count >= 30 {
		return c.Status(403).JSON(models.APIResponse{Success: false, Error: "Listing limit reached (30). Upgrade to Pro for unlimited listing."})
	}

	// Generate unique slug
	slug := generateSlug(title)
	baseSlug := slug
	counter := 1
	for {
		var exists int
		err := h.db.QueryRow("SELECT COUNT(*) FROM products WHERE slug = ?", slug).Scan(&exists)
		if err != nil || exists == 0 {
			break
		}
		slug = fmt.Sprintf("%s-%d", baseSlug, counter)
		counter++
	}

	// Create new product
	res, err := h.db.Exec(`
		INSERT INTO products (slug, title, description, price, category, `+"`condition`"+`, wants, image_urls, seller_id, status)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'available')`,
		slug, title, desc, price, category, condition, wants, imageURLsJSON, userID)

	if err != nil {
		log.Printf("DuplicateProduct error: %v", err)
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to relist product."})
	}

	newID, _ := res.LastInsertId()

	return c.JSON(models.APIResponse{
		Success: true,
		Message: "Product relisted successfully!",
		Data:    fiber.Map{"id": newID, "slug": slug},
	})
}

// WishlistProduct adds a product to a user's wishlist
func (h *ProductHandler) WishlistProduct(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}

	productID, err := strconv.Atoi(c.Params("id"))
	if err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid product ID"})
	}

	// Check if the product exists
	var exists int
	err = h.db.QueryRow("SELECT COUNT(*) FROM products WHERE id = ?", productID).Scan(&exists)
	if err != nil || exists == 0 {
		return c.Status(404).JSON(models.APIResponse{Success: false, Error: "Product not found"})
	}

	// Check if already in wishlist
	var wishlistID sql.NullInt64
	err = h.db.QueryRow("SELECT id FROM wishlists WHERE user_id = ? AND product_id = ?", userID, productID).Scan(&wishlistID)
	if err == nil && wishlistID.Valid {
		return c.Status(409).JSON(models.APIResponse{Success: false, Error: "Product already in wishlist"})
	}

	// Add to wishlist
	_, err = h.db.Exec("INSERT INTO wishlists (user_id, product_id, created_at) VALUES (?, ?, CURRENT_TIMESTAMP)", userID, productID)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to add to wishlist"})
	}

	return c.JSON(models.APIResponse{Success: true, Message: "Product added to wishlist"})
}

// UnwishlistProduct removes a product from a user's wishlist
func (h *ProductHandler) UnwishlistProduct(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}

	productID, err := strconv.Atoi(c.Params("id"))
	if err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid product ID"})
	}

	_, err = h.db.Exec("DELETE FROM wishlists WHERE user_id = ? AND product_id = ?", userID, productID)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to remove from wishlist"})
	}

	return c.JSON(models.APIResponse{Success: true, Message: "Product removed from wishlist"})
}

// GetUserWishlistStatus checks if a product is in the user's wishlist
func (h *ProductHandler) GetUserWishlistStatus(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}

	productID, err := strconv.Atoi(c.Params("id"))
	if err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid product ID"})
	}

	var exists int
	err = h.db.QueryRow("SELECT COUNT(*) FROM wishlists WHERE user_id = ? AND product_id = ?", userID, productID).Scan(&exists)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to check wishlist status"})
	}

	return c.JSON(models.APIResponse{Success: true, Data: fiber.Map{"in_wishlist": exists > 0}})
}

// BoostProduct updates the boosted_at timestamp of a product
func (h *ProductHandler) BoostProduct(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}

	productID, err := strconv.Atoi(c.Params("id"))
	if err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid product ID"})
	}

	// Verify ownership and check last boost time
	var sellerID int
	var boostedAt sql.NullTime
	err = h.db.QueryRow("SELECT seller_id, boosted_at FROM products WHERE id = ?", productID).Scan(&sellerID, &boostedAt)
	if err == sql.ErrNoRows {
		return c.Status(404).JSON(models.APIResponse{Success: false, Error: "Product not found"})
	} else if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Database error checking product"})
	}

	if sellerID != userID {
		return c.Status(403).JSON(models.APIResponse{Success: false, Error: "You can only boost your own products"})
	}

	plan, err := getUserPlanCapabilities(h.db, userID)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to fetch user plan capabilities"})
	}
	monthlyBoostLimit := getCapInt(plan.Capabilities, "monthly_boost_limit", 0)
	if monthlyBoostLimit <= 0 {
		return c.Status(403).JSON(models.APIResponse{
			Success: false,
			Error:   "Boosting is not included in your current plan.",
		})
	}
	usageMonth := time.Now().Format("2006-01")
	var boostUsage int
	_ = h.db.QueryRow("SELECT COALESCE(usage_count, 0) FROM premium_feature_usage WHERE user_id = ? AND feature_key = 'boosted_listings' AND usage_month = ?", userID, usageMonth).Scan(&boostUsage)
	if boostUsage >= monthlyBoostLimit {
		return c.Status(403).JSON(models.APIResponse{Success: false, Error: fmt.Sprintf("Your current plan includes %d boost(s) per month.", monthlyBoostLimit)})
	}

	if boostedAt.Valid {
		age := time.Since(boostedAt.Time)
		if age < 24*time.Hour {
			remainingCooldown := 24*time.Hour - age
			activeRemaining := 3*time.Hour - age
			isActive := activeRemaining > 0
			if !isActive {
				activeRemaining = 0
			}
			message := "This product is in boost cooldown."
			if isActive {
				message = "This product is already boosted and visible higher in the feed."
			}
			return c.JSON(models.APIResponse{
				Success: true,
				Message: message,
				Data: fiber.Map{
					"already_boosted":    true,
					"boosted_at":         boostedAt.Time,
					"active":             isActive,
					"active_remaining":   activeRemaining.String(),
					"cooldown_remaining": remainingCooldown.String(),
				},
			})
		}
	}

	// Determine if this should be a "Premium pin" boost based on tier limits
	limit := monthlyBoostLimit

	canPin := false
	if getCapBool(plan.Capabilities, "featured_listing_enabled", false) && limit > 0 {
		var currentPremiumCount int
		h.db.QueryRow("SELECT COUNT(*) FROM products WHERE seller_id = ? AND premium = true AND status = 'available'", userID).Scan(&currentPremiumCount)
		if currentPremiumCount < limit {
			canPin = true
		}
	}

	// Calculate boost expiration time (3 hours from now)
	boostedAtTime := time.Now()
	expiresAt := boostedAtTime.Add(3 * time.Hour)

	query := "UPDATE products SET boosted_at = NOW()"
	if canPin {
		query += ", premium = true"
	}
	query += " WHERE id = ?"

	_, err = h.db.Exec(query, productID)
	if err != nil {
		log.Printf("Error boosting product %d: %v", productID, err)
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to boost product"})
	}
	_, _ = h.db.Exec(`
		INSERT INTO premium_feature_usage (user_id, feature_key, usage_month, usage_count)
		VALUES (?, 'boosted_listings', ?, 1)
		ON DUPLICATE KEY UPDATE usage_count = usage_count + 1
	`, userID, usageMonth)

	// Prepare response with boost details
	responseData := map[string]interface{}{
		"boost_duration": "3 hours",
		"boosted_at":     boostedAtTime,
		"expires_at":     expiresAt,
	}

	message := "Product boosted successfully! 🚀 It will appear at the top of the feed for the next 3 hours."
	if canPin {
		message = "Product boosted and permanently pinned to top! ⭐ Your Premium Plus/Pro benefit includes always-visible listings."
	}

	return c.JSON(models.APIResponse{
		Success: true,
		Message: message,
		Data:    responseData,
	})
}

// GetBoostCandidates returns the authenticated user's listings that qualify for a boost:
// available, no pending offers, no wishlist saves, 3+ days old, not boosted in last 3 days.
func (h *ProductHandler) GetBoostCandidates(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}

	rows, err := h.db.Query(`
		SELECT p.id, p.title, p.image_urls, p.created_at, p.boosted_at
		FROM products p
		WHERE p.seller_id = ?
		  AND p.status = 'available'
		  AND p.created_at < DATE_SUB(NOW(), INTERVAL 3 DAY)
		  AND (p.boosted_at IS NULL OR p.boosted_at < DATE_SUB(NOW(), INTERVAL 3 DAY))
		  AND (SELECT COUNT(*) FROM trades t WHERE t.target_product_id = p.id AND t.status NOT IN ('declined','cancelled','completed')) = 0
		  AND (SELECT COUNT(*) FROM wishlists w WHERE w.product_id = p.id) = 0
		ORDER BY p.created_at ASC
		LIMIT 20
	`, userID)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to fetch boost candidates"})
	}
	defer rows.Close()

	type BoostCandidate struct {
		ID        int     `json:"id"`
		Title     string  `json:"title"`
		ImageURL  string  `json:"image_url"`
		CreatedAt string  `json:"created_at"`
		BoostedAt *string `json:"boosted_at"`
	}

	var candidates []BoostCandidate
	for rows.Next() {
		var b BoostCandidate
		var imageURLsJSON string
		var boostedAt sql.NullString
		if err := rows.Scan(&b.ID, &b.Title, &imageURLsJSON, &b.CreatedAt, &boostedAt); err != nil {
			continue
		}
		if boostedAt.Valid {
			b.BoostedAt = &boostedAt.String
		}
		var urls []string
		if json.Unmarshal([]byte(imageURLsJSON), &urls) == nil && len(urls) > 0 {
			b.ImageURL = urls[0]
		}
		candidates = append(candidates, b)
	}
	if candidates == nil {
		candidates = []BoostCandidate{}
	}
	return c.JSON(models.APIResponse{Success: true, Data: candidates})
}

func (h *ProductHandler) GetSuggestedTrades(c *fiber.Ctx) error {
	productID, err := strconv.Atoi(c.Params("id"))
	if err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid product ID"})
	}

	// 1. Get the target product details (including trade preferences)
	var pCategory, pWants string
	var wantedCategoriesRaw sql.NullString
	var pPrice float64
	var pSellerID int

	err = h.db.QueryRow(
		"SELECT COALESCE(category, ''), IFNULL(wants, ''), CAST(wanted_categories AS CHAR), IFNULL(price, 0), seller_id FROM products WHERE id = ?",
		productID,
	).Scan(&pCategory, &pWants, &wantedCategoriesRaw, &pPrice, &pSellerID)
	if err == sql.ErrNoRows {
		return c.Status(404).JSON(models.APIResponse{Success: false, Error: "Product not found"})
	} else if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Database error"})
	}

	wantedCategoriesStr := ""
	if wantedCategoriesRaw.Valid {
		wantedCategoriesStr = wantedCategoriesRaw.String
	}

	desiredCategories := []string{}
	wantedCategoriesStr = strings.TrimSpace(wantedCategoriesStr)
	if wantedCategoriesStr != "" && strings.ToLower(wantedCategoriesStr) != "null" {
		for _, v := range parseWantedCategories(wantedCategoriesStr) {
			clean := strings.ToLower(strings.TrimSpace(v))
			if clean == "others" {
				clean = "other"
			}
			if clean != "" {
				desiredCategories = append(desiredCategories, clean)
			}
		}
	}

	// If preferences weren't provided, fall back to the listing's category.
	if len(desiredCategories) == 0 {
		fallback := strings.ToLower(strings.TrimSpace(pCategory))
		if fallback != "" {
			if fallback == "others" {
				fallback = "other"
			}
			desiredCategories = []string{fallback}
		}
	}

	// Backwards-compat for legacy "Others" category values in DB.
	hasOther := false
	for _, cat := range desiredCategories {
		if cat == "other" {
			hasOther = true
			break
		}
	}
	if hasOther {
		desiredCategories = append(desiredCategories, "others")
	}

	priceMin := pPrice * 0.8
	priceMax := pPrice * 1.2

	// When the user provided desired categories ("What I'm looking for"), only show matches in those categories.
	query := `
		SELECT p.id, p.slug, p.title, p.description, p.price, p.image_urls, p.seller_id, 
		       p.premium, p.status, p.allow_buying, p.barter_only, p.location, p.` + "`condition`" + `, 
		       p.suggested_value, p.category, p.location_type, p.pickup_latitude, p.pickup_longitude, p.pickup_address, p.latitude, p.longitude, p.created_at, p.updated_at, p.boosted_at,
		       u.name as seller_name, u.profile_picture as seller_profile_picture,
		       u.latitude as seller_latitude, u.longitude as seller_longitude,
		   (SELECT COUNT(*) FROM wishlists w WHERE w.product_id = p.id) as want_count,
		   (SELECT COUNT(*) FROM trades t WHERE t.target_product_id = p.id AND t.status = 'pending') as offer_count
	FROM products p
	JOIN users u ON p.seller_id = u.id
	WHERE p.status = 'available' AND p.seller_id != ?
	`

	args := []interface{}{pSellerID}

	if len(desiredCategories) > 0 {
		placeholders := make([]string, len(desiredCategories))
		for i, cat := range desiredCategories {
			placeholders[i] = "?"
			args = append(args, cat)
		}
		normCategory := "LOWER(TRIM(COALESCE(p.category, '')))"
		if hasOther {
			query += fmt.Sprintf(" AND (%s IN (%s) OR %s LIKE 'other%%')\n", normCategory, strings.Join(placeholders, ","), normCategory)
		} else {
			query += fmt.Sprintf(" AND %s IN (%s)\n", normCategory, strings.Join(placeholders, ","))
		}
	}

	scoreParts := []string{
		"(CASE WHEN p.category = ? THEN 10 ELSE 0 END)",
		"(CASE WHEN p.price BETWEEN ? AND ? THEN 10 ELSE 0 END)",
	}
	args = append(args, pCategory, priceMin, priceMax)

	wantsClean := strings.ToLower(strings.TrimSpace(pWants))
	if wantsClean != "" && wantsClean != "any" {
		pattern := "%" + wantsClean + "%"
		scoreParts = append(scoreParts, "(CASE WHEN LOWER(p.title) LIKE ? OR LOWER(p.description) LIKE ? THEN 5 ELSE 0 END)")
		args = append(args, pattern, pattern)
	}

	query += fmt.Sprintf("ORDER BY (%s) DESC, p.created_at DESC\nLIMIT 10\n", strings.Join(scoreParts, " + "))

	rows, err := h.db.Query(query, args...)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Error fetching suggestions"})
	}
	defer rows.Close()

	var products []models.Product
	for rows.Next() {
		var product models.Product
		var slugNull sql.NullString
		var conditionNull sql.NullString
		var priceNull sql.NullFloat64
		var sellerProfile sql.NullString
		var imageURLsJSONStr string
		var latNull, lonNull, sLatNull, sLonNull sql.NullFloat64
		var boostedAtNull sql.NullTime
		var locationTypeNull sql.NullString
		var pickupLatNull, pickupLonNull sql.NullFloat64
		var pickupAddressNull sql.NullString
		err := rows.Scan(&product.ID, &slugNull, &product.Title, &product.Description, &priceNull,
			&imageURLsJSONStr, &product.SellerID, &product.Premium, &product.Status,
			&product.AllowBuying, &product.BarterOnly, &product.Location,
			&conditionNull, &product.SuggestedValue, &product.Category,
			&locationTypeNull, &pickupLatNull, &pickupLonNull, &pickupAddressNull,
			&latNull, &lonNull, &product.CreatedAt, &product.UpdatedAt, &boostedAtNull,
			&product.SellerName, &sellerProfile, &sLatNull, &sLonNull, &product.WantCount, &product.OfferCount)

		if err != nil {
			fmt.Printf("GetSuggestedTrades scan error: %v\n", err)
			continue
		}

		if slugNull.Valid {
			product.Slug = slugNull.String
		}
		if boostedAtNull.Valid {
			product.BoostedAt = &boostedAtNull.Time
		}
		if conditionNull.Valid {
			product.Condition = conditionNull.String
		}
		if priceNull.Valid {
			p := priceNull.Float64
			product.Price = &p
		}
		if locationTypeNull.Valid {
			product.LocationType = locationTypeNull.String
		}
		if pickupLatNull.Valid {
			product.PickupLatitude = &pickupLatNull.Float64
		}
		if pickupLonNull.Valid {
			product.PickupLongitude = &pickupLonNull.Float64
		}
		if pickupAddressNull.Valid {
			product.PickupAddress = pickupAddressNull.String
		}
		if sellerProfile.Valid {
			product.SellerProfilePicture = sellerProfile.String
		}
		if latNull.Valid {
			product.Latitude = &latNull.Float64
		}
		if lonNull.Valid {
			product.Longitude = &lonNull.Float64
		}

		if imageURLsJSONStr != "" {
			var imageURLs []string
			if err := json.Unmarshal([]byte(imageURLsJSONStr), &imageURLs); err == nil {
				product.ImageURLs = models.StringArray(imageURLs)
			}
		}
		products = append(products, product)
	}

	if products == nil {
		products = []models.Product{}
	}

	return c.JSON(models.APIResponse{
		Success: true,
		Data:    products,
	})
}

// GetProduct gets a single product by ID or slug
func (h *ProductHandler) GetProduct(c *fiber.Ctx) error {
	h.ensureProductEstimateVisibilityColumn()

	idOrSlug := c.Params("id")

	// Try to parse as integer first (ID)
	var product models.Product
	var slugNull sql.NullString
	var priceNull sql.NullFloat64
	var imageURLsJSON sql.NullString
	var videoURLNull sql.NullString
	var sellerNameNull sql.NullString
	var sellerProfilePictureNull sql.NullString
	var priceReasoningNull sql.NullString
	var locationTypeNull sql.NullString
	var pickupLatNull sql.NullFloat64
	var pickupLonNull sql.NullFloat64
	var pickupAddressNull sql.NullString
	var err error

	var wantsNull sql.NullString
	var wantedCategoriesRaw sql.NullString
	productID, parseErr := strconv.Atoi(idOrSlug)
	if parseErr == nil {
		// It's a numeric ID
		err = h.db.QueryRow(`
			SELECT p.id, p.slug, p.title, p.description, p.price, p.image_urls, p.video_url, p.seller_id, 
			       p.premium, p.status, p.allow_buying, p.barter_only, p.location, p.`+"condition"+`, 
			       p.suggested_value, p.category, p.estimated_value_min, p.estimated_value_max, COALESCE(p.show_estimated_value, TRUE), p.`+"`value`"+`, p.wants, p.wanted_categories,
			       p.location_type, p.pickup_latitude, p.pickup_longitude, p.pickup_address,
			       p.price_reasoning, p.created_at, p.updated_at,
			       u.name as seller_name, u.profile_picture as seller_profile_picture,
			       (SELECT COUNT(*) FROM wishlists w WHERE w.product_id = p.id) as want_count
			FROM products p
			LEFT JOIN users u ON p.seller_id = u.id
			WHERE p.id = ?
		`, productID).Scan(&product.ID, &slugNull, &product.Title, &product.Description, &priceNull,
			&imageURLsJSON, &videoURLNull, &product.SellerID, &product.Premium, &product.Status,
			&product.AllowBuying, &product.BarterOnly, &product.Location,
			&product.Condition, &product.SuggestedValue, &product.Category,
			&product.EstimatedValueMin, &product.EstimatedValueMax, &product.ShowEstimatedValue, &product.Value,
			&wantsNull, &wantedCategoriesRaw, &locationTypeNull, &pickupLatNull, &pickupLonNull, &pickupAddressNull, &priceReasoningNull,
			&product.CreatedAt, &product.UpdatedAt,
			&sellerNameNull, &sellerProfilePictureNull, &product.WantCount)
	} else {
		err = h.db.QueryRow(`
			SELECT p.id, p.slug, p.title, p.description, p.price, p.image_urls, p.video_url, p.seller_id, 
			       p.premium, p.status, p.allow_buying, p.barter_only, p.location, p.`+"condition"+`, 
			       p.suggested_value, p.category, p.estimated_value_min, p.estimated_value_max, COALESCE(p.show_estimated_value, TRUE), p.`+"`value`"+`, p.wants, p.wanted_categories,
			       p.location_type, p.pickup_latitude, p.pickup_longitude, p.pickup_address,
			       p.price_reasoning, p.created_at, p.updated_at,
			       u.name as seller_name, u.profile_picture as seller_profile_picture,
			       (SELECT COUNT(*) FROM wishlists w WHERE w.product_id = p.id) as want_count
			FROM products p
			LEFT JOIN users u ON p.seller_id = u.id
			WHERE p.slug = ?
		`, idOrSlug).Scan(&product.ID, &slugNull, &product.Title, &product.Description, &priceNull,
			&imageURLsJSON, &videoURLNull, &product.SellerID, &product.Premium, &product.Status,
			&product.AllowBuying, &product.BarterOnly, &product.Location,
			&product.Condition, &product.SuggestedValue, &product.Category,
			&product.EstimatedValueMin, &product.EstimatedValueMax, &product.ShowEstimatedValue, &product.Value,
			&wantsNull, &wantedCategoriesRaw, &locationTypeNull, &pickupLatNull, &pickupLonNull, &pickupAddressNull, &priceReasoningNull,
			&product.CreatedAt, &product.UpdatedAt,
			&sellerNameNull, &sellerProfilePictureNull, &product.WantCount)
	}

	if err == nil {
		hideEstimatedValueIfNeeded(&product)

		// Log product view
		viewerID, _ := middleware.GetUserIDFromContext(c)
		if viewerID != product.SellerID { // Don't log self-views
			h.db.Exec("INSERT INTO product_views (product_id, viewer_user_id) VALUES (?, ?)", product.ID, viewerID)
		}

		// Enforce premium tier for price reasoning
		var requesterTier string
		if viewerID > 0 {
			h.db.QueryRow("SELECT COALESCE(premium_tier, 'free') FROM users WHERE id = ?", viewerID).Scan(&requesterTier)
		} else {
			requesterTier = "free"
		}

		if requesterTier == "free" {
			product.PriceReasoning = ""
		}

		// Pro users get detailed analytics if they are the owner
		if requesterTier == "pro" && viewerID == product.SellerID {
			var views, saves int
			h.db.QueryRow("SELECT COUNT(*) FROM product_views WHERE product_id = ?", product.ID).Scan(&views)
			h.db.QueryRow("SELECT COUNT(*) FROM saved_products WHERE product_id = ? AND deleted_at IS NULL", product.ID).Scan(&saves)

			product.Analytics = &models.ProductAnalytics{
				Views: views,
				Saves: saves,
				Rank:  "Top 10%", // Mock rank for now
			}
		}
	}

	if wantsNull.Valid {
		product.Wants = wantsNull.String
	}
	if wantedCategoriesRaw.Valid {
		product.WantedCategories = parseWantedCategories(wantedCategoriesRaw.String)
	}
	if priceReasoningNull.Valid {
		product.PriceReasoning = priceReasoningNull.String
	}
	if locationTypeNull.Valid {
		product.LocationType = locationTypeNull.String
	}
	if pickupLatNull.Valid {
		product.PickupLatitude = &pickupLatNull.Float64
	}
	if pickupLonNull.Valid {
		product.PickupLongitude = &pickupLonNull.Float64
	}
	if pickupAddressNull.Valid {
		product.PickupAddress = pickupAddressNull.String
	}

	if err != nil {
		if err == sql.ErrNoRows {
			return c.Status(404).JSON(models.APIResponse{
				Success: false,
				Error:   "Product not found",
			})
		}
		log.Printf("GetProduct failed for '%s': %v", idOrSlug, err)
		return c.Status(500).JSON(models.APIResponse{
			Success: false,
			Error:   "Failed to get product",
		})
	}

	if slugNull.Valid {
		product.Slug = slugNull.String
	}
	if priceNull.Valid {
		p := priceNull.Float64
		product.Price = &p
	}
	if videoURLNull.Valid {
		product.VideoURL = videoURLNull.String
	}
	if sellerNameNull.Valid {
		product.SellerName = sellerNameNull.String
	}
	if sellerProfilePictureNull.Valid {
		product.SellerProfilePicture = sellerProfilePictureNull.String
	}

	// Parse image URLs JSON if present
	if imageURLsJSON.Valid && imageURLsJSON.String != "" {
		var urls []string
		if err := json.Unmarshal([]byte(imageURLsJSON.String), &urls); err == nil {
			product.ImageURLs = models.StringArray(urls)
		}
	}

	// Get vote counts
	var underCount, overCount int
	_ = h.db.QueryRow("SELECT COALESCE(SUM(CASE WHEN vote = 'under' THEN 1 ELSE 0 END),0), COALESCE(SUM(CASE WHEN vote = 'over' THEN 1 ELSE 0 END),0) FROM product_votes WHERE product_id = ?", product.ID).Scan(&underCount, &overCount)

	// Get user's vote if authenticated
	var userVote sql.NullString
	userID, ok := middleware.GetUserIDFromContext(c)
	if ok {
		_ = h.db.QueryRow("SELECT vote FROM product_votes WHERE product_id = ? AND user_id = ?", product.ID, userID).Scan(&userVote)
	}

	return c.JSON(models.APIResponse{
		Success: true,
		Data: fiber.Map{
			"product":   product,
			"votes":     fiber.Map{"under": underCount, "over": overCount},
			"user_vote": userVote.String,
		},
	})
}

// VoteProduct lets an authenticated user mark a product as under- or overpriced
func (h *ProductHandler) VoteProduct(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}

	productID, err := strconv.Atoi(c.Params("id"))
	if err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid product ID"})
	}

	var body struct {
		Vote string `json:"vote"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid request body"})
	}
	v := strings.ToLower(body.Vote)
	if v != "under" && v != "over" {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "vote must be 'under' or 'over'"})
	}

	// Ensure product exists and has a price (only allow voting for items with price)
	var price sql.NullFloat64
	err = h.db.QueryRow("SELECT price FROM products WHERE id = ?", productID).Scan(&price)
	if err != nil {
		if err == sql.ErrNoRows {
			return c.Status(404).JSON(models.APIResponse{Success: false, Error: "Product not found"})
		}
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to check product"})
	}
	if !price.Valid {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Voting allowed only for items with a price"})
	}

	// Insert or update vote (unique constraint on product_id,user_id)
	_, err = h.db.Exec("INSERT INTO product_votes (product_id, user_id, vote, created_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP) ON DUPLICATE KEY UPDATE vote = VALUES(vote), created_at = VALUES(created_at)", productID, userID, v)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to record vote"})
	}

	// Return updated counts
	var underCount int
	var overCount int
	_ = h.db.QueryRow("SELECT COALESCE(SUM(CASE WHEN vote = 'under' THEN 1 ELSE 0 END),0), COALESCE(SUM(CASE WHEN vote = 'over' THEN 1 ELSE 0 END),0) FROM product_votes WHERE product_id = ?", productID).Scan(&underCount, &overCount)

	return c.JSON(models.APIResponse{Success: true, Data: fiber.Map{"votes": fiber.Map{"under": underCount, "over": overCount}, "user_vote": v}})
}

// UpdateProduct updates a product (only by seller)
func (h *ProductHandler) UpdateProduct(c *fiber.Ctx) error {
	h.ensureProductEstimateVisibilityColumn()

	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{
			Success: false,
			Error:   "User not authenticated",
		})
	}

	productID, err := strconv.Atoi(c.Params("id"))
	if err != nil {
		return c.Status(400).JSON(models.APIResponse{
			Success: false,
			Error:   "Invalid product ID",
		})
	}

	// Check if user owns the product and get its current state
	var p models.Product
	err = h.db.QueryRow("SELECT seller_id, status, price, `condition` FROM products WHERE id = ?", productID).Scan(&p.SellerID, &p.Status, &p.Price, &p.Condition)
	if err != nil {
		if err == sql.ErrNoRows {
			return c.Status(404).JSON(models.APIResponse{
				Success: false,
				Error:   "Product not found",
			})
		}
		return c.Status(500).JSON(models.APIResponse{
			Success: false,
			Error:   "Failed to get product",
		})
	}

	if p.SellerID != userID {
		return c.Status(403).JSON(models.APIResponse{
			Success: false,
			Error:   "You can only update your own products",
		})
	}

	// Parse update fields
	var updateFields []string
	var args []interface{}

	title := cleanUserText(c.FormValue("title"), 160)
	if title != "" {
		updateFields = append(updateFields, "title = ?")
		args = append(args, title)
	}

	description := cleanUserText(c.FormValue("description"), 5000)
	if description != "" {
		updateFields = append(updateFields, "description = ?")
		args = append(args, description)
	}

	priceStr := c.FormValue("price")
	if priceStr != "" {
		if price, err := strconv.ParseFloat(priceStr, 64); err == nil {
			updateFields = append(updateFields, "price = ?")
			args = append(args, price)
		}
	}

	premiumStr := c.FormValue("premium")
	if premiumStr != "" {
		premium := premiumStr == "true"
		updateFields = append(updateFields, "premium = ?")
		args = append(args, premium)
	}

	allowBuyingStr := c.FormValue("allow_buying")
	if allowBuyingStr != "" {
		allowBuying := allowBuyingStr == "true"
		updateFields = append(updateFields, "allow_buying = ?")
		args = append(args, allowBuying)
	}

	barterOnlyStr := c.FormValue("barter_only")
	if barterOnlyStr != "" {
		barterOnly := barterOnlyStr == "true"
		updateFields = append(updateFields, "barter_only = ?")
		args = append(args, barterOnly)
	}

	status := c.FormValue("status")
	if status != "" {
		updateFields = append(updateFields, "status = ?")
		args = append(args, status)
	}

	location := c.FormValue("location")
	if location != "" {
		updateFields = append(updateFields, "location = ?")
		args = append(args, location)

		// Re-geocode when location changes so product distance reflects the
		// new location instead of the seller's previous coords. If the client
		// passed explicit lat/lng (from a picker), those take precedence below.
		if coords, err := services.GetCoordinates(location); err == nil {
			updateFields = append(updateFields, "latitude = ?", "longitude = ?")
			args = append(args, coords.Latitude, coords.Longitude)
		} else {
			// Clear stale coords so GetProducts will re-geocode in the background
			updateFields = append(updateFields, "latitude = ?", "longitude = ?")
			args = append(args, nil, nil)
		}
	}

	// Explicit lat/lng override (e.g., from a map picker) — applied after the
	// location-based geocode so the picker always wins.
	if latStr := c.FormValue("latitude"); latStr != "" {
		if lat, err := strconv.ParseFloat(latStr, 64); err == nil {
			updateFields = append(updateFields, "latitude = ?")
			args = append(args, lat)
		}
	}
	if lngStr := c.FormValue("longitude"); lngStr != "" {
		if lng, err := strconv.ParseFloat(lngStr, 64); err == nil {
			updateFields = append(updateFields, "longitude = ?")
			args = append(args, lng)
		}
	}

	condition := c.FormValue("condition")
	if condition != "" {
		updateFields = append(updateFields, "`condition` = ?")
		args = append(args, condition)
	}

	category := c.FormValue("category")
	if category != "" {
		updateFields = append(updateFields, "category = ?")
		args = append(args, category)
	}

	valueStr := c.FormValue("value")
	if valueStr != "" {
		if val, err := strconv.ParseFloat(valueStr, 64); err == nil {
			updateFields = append(updateFields, "`value` = ?")
			args = append(args, val)
		}
	}

	if raw := c.FormValue("show_estimated_value"); raw != "" {
		if val, err := strconv.ParseBool(strings.TrimSpace(raw)); err == nil {
			updateFields = append(updateFields, "show_estimated_value = ?")
			args = append(args, val)
		}
	}

	desiredPriceStr := c.FormValue("desired_price")
	if desiredPriceStr != "" {
		if val, err := strconv.ParseFloat(desiredPriceStr, 64); err == nil {
			updateFields = append(updateFields, "desired_price = ?")
			args = append(args, val)
		}
	}

	desiredProductVal := c.FormValue("desired_product")
	if desiredProductVal != "" {
		updateFields = append(updateFields, "desired_product = ?")
		args = append(args, desiredProductVal)
	}

	wants := c.FormValue("wants")
	if wants != "" {
		updateFields = append(updateFields, "wants = ?")
		args = append(args, wants)
	}

	wantedCategories := c.FormValue("wanted_categories")
	if wantedCategories != "" {
		updateFields = append(updateFields, "wanted_categories = ?")
		args = append(args, wantedCategories)
	}

	// Handle image updates
	form, err := c.MultipartForm()
	if err == nil {
		files := form.File["images"]
		if len(files) > 0 {
			var imagePaths []string
			for _, file := range files {
				if url, err := services.UploadFileToCloudinary(file, "products"); err == nil && url != "" {
					imagePaths = append(imagePaths, url)
					continue
				} else if err != nil && err != services.ErrCloudinaryDisabled {
					fmt.Printf("Cloudinary upload failed: %v\n", err)
				}

				localURL, err := saveFileLocally(c, file, "products")
				if err != nil {
					fmt.Printf("Local file save failed: %v\n", err)
					continue
				}
				imagePaths = append(imagePaths, localURL)
			}
			if len(imagePaths) > 0 {
				imageURLsJSONBytes, _ := json.Marshal(imagePaths)
				updateFields = append(updateFields, "image_urls = ?")
				args = append(args, string(imageURLsJSONBytes))
			}
		}
	}

	if len(updateFields) == 0 {
		return c.Status(400).JSON(models.APIResponse{
			Success: false,
			Error:   "No fields to update",
		})
	}

	updateFields = append(updateFields, "updated_at = CURRENT_TIMESTAMP")
	args = append(args, productID)

	query := fmt.Sprintf("UPDATE products SET %s WHERE id = ?", strings.Join(updateFields, ", "))
	_, err = h.db.Exec(query, args...)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{
			Success: false,
			Error:   "Failed to update product",
		})
	}

	return c.JSON(models.APIResponse{
		Success: true,
		Message: "Product updated successfully",
	})
}

// GetAdminProducts returns a paginated list of products for admin usage.
// Unlike the public feed, this can include all statuses.
func (h *ProductHandler) GetAdminProducts(c *fiber.Ctx) error {
	page, _ := strconv.Atoi(c.Query("page", "1"))
	limit, _ := strconv.Atoi(c.Query("limit", "20"))
	if limit <= 0 {
		limit = 20
	}
	offset := (page - 1) * limit

	// Optional status filter for admin (e.g., ?status=available)
	status := c.Query("status", "")
	startStr := c.Query("start", "")
	endStr := c.Query("end", "")
	var startDate *time.Time
	var endDate *time.Time
	if startStr != "" {
		t, err := time.ParseInLocation("2006-01-02", startStr, time.Local)
		if err != nil {
			return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid start date"})
		}
		startDate = &t
	}
	if endStr != "" {
		t, err := time.ParseInLocation("2006-01-02", endStr, time.Local)
		if err != nil {
			return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid end date"})
		}
		endDate = &t
	}

	whereClause := "WHERE 1=1"
	var args []interface{}

	if status != "" {
		whereClause += " AND p.status = ?"
		args = append(args, status)
	}
	if startDate != nil {
		whereClause += " AND p.created_at >= ?"
		args = append(args, *startDate)
	}
	if endDate != nil {
		whereClause += " AND p.created_at < ?"
		args = append(args, *endDate)
	}

	// Total count
	countQuery := "SELECT COUNT(*) FROM products p " + whereClause
	var total int
	if err := h.db.QueryRow(countQuery, args...).Scan(&total); err != nil {
		return c.Status(500).JSON(models.APIResponse{
			Success: false,
			Error:   "Failed to get product count",
		})
	}

	query := `
		SELECT p.id, p.slug, p.title, p.description, p.price, p.image_urls, p.seller_id, 
		       p.premium, p.status, p.allow_buying, p.barter_only, p.created_at, p.updated_at, u.name as seller_name, u.profile_picture as seller_profile_picture
		FROM products p
		JOIN users u ON p.seller_id = u.id
		` + whereClause + `
		ORDER BY p.created_at DESC
		LIMIT ? OFFSET ?
	`

	args = append(args, limit, offset)
	rows, err := h.db.Query(query, args...)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{
			Success: false,
			Error:   "Failed to get products",
		})
	}
	defer rows.Close()

	var products []models.Product
	for rows.Next() {
		var product models.Product
		var slugNull sql.NullString
		var priceNull sql.NullFloat64
		var sellerProfile sql.NullString
		var imageURLsJSONStr string
		if err := rows.Scan(
			&product.ID, &slugNull, &product.Title, &product.Description, &priceNull,
			&imageURLsJSONStr, &product.SellerID, &product.Premium, &product.Status,
			&product.AllowBuying, &product.BarterOnly, &product.CreatedAt, &product.UpdatedAt, &product.SellerName, &sellerProfile,
		); err != nil {
			continue
		}
		if slugNull.Valid {
			product.Slug = slugNull.String
		}
		if priceNull.Valid {
			p := priceNull.Float64
			product.Price = &p
		}
		if sellerProfile.Valid {
			product.SellerProfilePicture = sellerProfile.String
		}
		if imageURLsJSONStr != "" {
			var imageURLs []string
			if err := json.Unmarshal([]byte(imageURLsJSONStr), &imageURLs); err == nil {
				product.ImageURLs = models.StringArray(imageURLs)
			}
		}
		products = append(products, product)
	}

	totalPages := (total + limit - 1) / limit

	return c.JSON(models.APIResponse{
		Success: true,
		Data: models.PaginatedResponse{
			Data:       products,
			Total:      total,
			Page:       page,
			Limit:      limit,
			TotalPages: totalPages,
		},
	})
}

// DeleteProduct deletes a product (only by seller)
func (h *ProductHandler) DeleteProduct(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{
			Success: false,
			Error:   "User not authenticated",
		})
	}

	productID, err := strconv.Atoi(c.Params("id"))
	if err != nil {
		return c.Status(400).JSON(models.APIResponse{
			Success: false,
			Error:   "Invalid product ID",
		})
	}

	// OPTIMIZED: Run permission, status, and related checks in parallel
	type deleteCheckResults struct {
		sellerID      int
		productStatus string
		tradeCount    int
		orderCount    int
		checkErr      error
	}

	results := &deleteCheckResults{}
	var wg sync.WaitGroup

	// 1. Check ownership and product status
	wg.Add(1)
	go func() {
		defer wg.Done()
		results.checkErr = h.db.QueryRow("SELECT seller_id, status FROM products WHERE id = ?", productID).Scan(&results.sellerID, &results.productStatus)
	}()

	// 2. Check for active trades (in parallel)
	wg.Add(1)
	go func() {
		defer wg.Done()
		_ = h.db.QueryRow(`
			SELECT COUNT(*) FROM trades 
			WHERE (target_product_id = ? OR id IN (
				SELECT DISTINCT trade_id FROM trade_items WHERE product_id = ?
			))
			AND status NOT IN ('declined', 'cancelled', 'cancelled_due_to_conflict', 'completed', 'auto_completed', 'expired', 'broken', 'history')
		`, productID, productID).Scan(&results.tradeCount)
	}()

	// 3. Check for orders (in parallel)
	wg.Add(1)
	go func() {
		defer wg.Done()
		_ = h.db.QueryRow("SELECT COUNT(*) FROM orders WHERE product_id = ?", productID).Scan(&results.orderCount)
	}()

	wg.Wait()

	// Check ownership
	if results.checkErr != nil {
		if results.checkErr == sql.ErrNoRows {
			return c.Status(404).JSON(models.APIResponse{
				Success: false,
				Error:   "Product not found",
			})
		}
		return c.Status(500).JSON(models.APIResponse{
			Success: false,
			Error:   "Failed to get product",
		})
	}

	if results.sellerID != userID {
		return c.Status(403).JSON(models.APIResponse{
			Success: false,
			Error:   "You can only delete your own products",
		})
	}

	// Locked products cannot be deleted
	if results.productStatus == "locked" {
		return c.Status(400).JSON(models.APIResponse{
			Success: false,
			Error:   "Cannot delete a locked product. Please unlock it first.",
		})
	}

	// Check active trades
	if results.tradeCount > 0 {
		return c.Status(400).JSON(models.APIResponse{
			Success: false,
			Error:   "Cannot delete product with active trades or offers. Please complete or cancel all trades involving this item first.",
		})
	}

	// Check orders
	if results.orderCount > 0 {
		return c.Status(400).JSON(models.APIResponse{
			Success: false,
			Error:   "Cannot delete product with existing orders",
		})
	}

	// Double-check by removing wishlist entries and saved products (in background)
	go func() {
		_, _ = h.db.Exec("DELETE FROM wishlists WHERE product_id = ?", productID)
		_, _ = h.db.Exec("DELETE FROM saved_products WHERE product_id = ?", productID)
	}()

	_, err = h.db.Exec("UPDATE products SET status = 'deleted', updated_at = CURRENT_TIMESTAMP WHERE id = ?", productID)
	if err != nil {
		log.Printf("Error soft-deleting product %d: %v", productID, err)
		return c.Status(500).JSON(models.APIResponse{
			Success: false,
			Error:   "Failed to remove product from listings",
		})
	}

	return c.JSON(models.APIResponse{
		Success: true,
		Message: "Product removed from listings successfully",
	})
}

// DeleteProductAdmin permanently deletes a product (admin only).
// This bypasses seller ownership checks but still respects FK constraints (orders, trades, etc.).
func (h *ProductHandler) DeleteProductAdmin(c *fiber.Ctx) error {
	_, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{
			Success: false,
			Error:   "User not authenticated",
		})
	}

	productID, err := strconv.Atoi(c.Params("id"))
	if err != nil || productID <= 0 {
		return c.Status(400).JSON(models.APIResponse{
			Success: false,
			Error:   "Invalid product ID",
		})
	}

	// Ensure product exists
	var exists int
	if err := h.db.QueryRow("SELECT COUNT(*) FROM products WHERE id = ?", productID).Scan(&exists); err != nil {
		return c.Status(500).JSON(models.APIResponse{
			Success: false,
			Error:   "Failed to check product existence",
		})
	}
	if exists == 0 {
		return c.Status(404).JSON(models.APIResponse{
			Success: false,
			Error:   "Product not found",
		})
	}

	result, err := h.db.Exec("DELETE FROM products WHERE id = ?", productID)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{
			Success: false,
			Error:   "Failed to delete product",
		})
	}

	if rows, _ := result.RowsAffected(); rows == 0 {
		return c.Status(404).JSON(models.APIResponse{
			Success: false,
			Error:   "Product not found",
		})
	}

	return c.JSON(models.APIResponse{
		Success: true,
		Message: "Product deleted successfully",
	})
}

// GetUserProducts gets all products for a specific user
func (h *ProductHandler) GetUserProducts(c *fiber.Ctx) error {
	fmt.Println("🔍 [DEBUG] GetUserProducts called")

	userID, err := strconv.Atoi(c.Params("id"))
	if err != nil {
		fmt.Printf("❌ [DEBUG] Failed to parse user ID: %v\n", err)
		return c.Status(400).JSON(models.APIResponse{
			Success: false,
			Error:   "Invalid user ID",
		})
	}

	fmt.Printf("🔍 [DEBUG] Fetching products for user ID: %d\n", userID)

	page, _ := strconv.Atoi(c.Query("page", "1"))
	limit, _ := strconv.Atoi(c.Query("limit", "20"))
	if limit <= 0 {
		limit = 20
	}
	offset := (page - 1) * limit

	// Build WHERE clause
	where := "WHERE p.seller_id = ? AND p.status <> 'deleted'"
	args := []interface{}{userID}

	// Filter by status if active is set
	active := c.Query("active", "") == "true"
	if active {
		where += " AND p.status = 'available'"
	}

	// Filter by category if provided
	category := c.Query("category", "")
	if category != "" {
		where += " AND p.category = ?"
		args = append(args, category)
	}

	// Get total count with filters
	countQuery := "SELECT COUNT(*) FROM products p " + where
	var total int
	err = h.db.QueryRow(countQuery, args...).Scan(&total)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{
			Success: false,
			Error:   "Failed to get product count",
		})
	}

	// Get products (use image_urls) with category field
	queryArgs := append(args, limit, offset)
	rows, err := h.db.Query(`
		SELECT p.id, p.slug, p.title, p.description, p.price, p.image_urls, p.seller_id, 
		       p.premium, p.status, p.allow_buying, p.barter_only, p.category, p.created_at, p.updated_at, p.boosted_at,
		       u.name as seller_name, u.profile_picture as seller_profile_picture,
		       (SELECT COUNT(*) FROM trades t WHERE t.target_product_id = p.id AND t.status = 'pending') as offer_count
		FROM products p
		JOIN users u ON p.seller_id = u.id
		`+where+`
		ORDER BY COALESCE(p.boosted_at, p.created_at) DESC
		LIMIT ? OFFSET ?
	`, queryArgs...)

	if err != nil {
		fmt.Printf("❌ [DEBUG] GetUserProducts query failed: %v\n", err)
		return c.Status(500).JSON(models.APIResponse{
			Success: false,
			Error:   "Failed to get products",
		})
	}
	fmt.Println("✅ [DEBUG] GetUserProducts query succeeded, iterating rows")
	defer rows.Close()

	var products []models.Product
	for rows.Next() {
		var product models.Product
		var slugNull sql.NullString
		var priceNull sql.NullFloat64
		var sellerProfile sql.NullString
		var imageURLsJSONStr string
		var boostedAtNull sql.NullTime
		err := rows.Scan(&product.ID, &slugNull, &product.Title, &product.Description, &priceNull,
			&imageURLsJSONStr, &product.SellerID, &product.Premium, &product.Status,
			&product.AllowBuying, &product.BarterOnly, &product.Category, &product.CreatedAt, &product.UpdatedAt, &boostedAtNull,
			&product.SellerName, &sellerProfile, &product.OfferCount)
		if slugNull.Valid {
			product.Slug = slugNull.String
		}
		if err != nil {
			continue
		}
		if boostedAtNull.Valid {
			product.BoostedAt = &boostedAtNull.Time
		}
		if priceNull.Valid {
			p := priceNull.Float64
			product.Price = &p
		} else {
			product.Price = nil
		}
		if sellerProfile.Valid {
			product.SellerProfilePicture = sellerProfile.String
		}

		// Parse image URLs from JSON
		if imageURLsJSONStr != "" {
			var imageURLs []string
			if err := json.Unmarshal([]byte(imageURLsJSONStr), &imageURLs); err == nil {
				product.ImageURLs = models.StringArray(imageURLs)
			}
		}

		products = append(products, product)
	}

	totalPages := (total + limit - 1) / limit

	fmt.Printf("✅ [DEBUG] GetUserProducts completed successfully. Returning %d products for user %d\n", len(products), userID)
	return c.JSON(models.APIResponse{
		Success: true,
		Data: models.PaginatedResponse{
			Data:       products,
			Total:      total,
			Page:       page,
			Limit:      limit,
			TotalPages: totalPages,
		},
	})
}

// GenerateProductDetailsWithAI analyzes product images using Groq AI and returns structured product details
func (h *ProductHandler) GenerateProductDetailsWithAI(c *fiber.Ctx) error {
	form, err := c.MultipartForm()
	if err != nil {
		return c.Status(400).JSON(models.APIResponse{
			Success: false,
			Error:   "Failed to parse uploaded files",
		})
	}

	files := form.File["images"]
	if len(files) < 1 {
		return c.Status(400).JSON(models.APIResponse{
			Success: false,
			Error:   "At least 1 image is required for AI analysis",
		})
	}

	// Validate each image: max 5MB per file
	const maxImageSize = 5 * 1024 * 1024 // 5MB
	for _, f := range files {
		log.Printf("AI upload: file=%s size=%d bytes", f.Filename, f.Size)
		if f.Size > maxImageSize {
			return c.Status(400).JSON(models.APIResponse{
				Success: false,
				Error:   fmt.Sprintf("Image '%s' exceeds 5MB limit (%d bytes). Please compress or resize it.", f.Filename, f.Size),
			})
		}
	}

	// Use fallback service: Gemini (primary) → Groq (backup)
	aiResult, err := services.AnalyzeProductWithFallback(files)
	if aiResult != nil && (aiResult.Provider == "gemini" || aiResult.Provider == "groq") {
		log.Printf("✅ [AI] Analysis complete: Provider=%s, Retried=%v, TimeMs=%d", aiResult.Provider, aiResult.Retried, aiResult.TimeMs)
	}

	// Check if analysis failed
	if err != nil || aiResult == nil || !aiResult.Success {
		// Convert technical errors to user-friendly messages
		userFriendlyMsg := "We couldn't analyze your image. Please check that:\n- Image is clear and well-lit\n- Image shows the actual product\n- File is a valid image (JPG, PNG)\n- File size is under 25MB"

		if aiResult != nil && aiResult.Error != "" {
			errMsg := aiResult.Error
			// Improve specific error messages
			if strings.Contains(errMsg, "INVALID_ARGUMENT") || strings.Contains(errMsg, "safety") {
				userFriendlyMsg = "The image appears to contain prohibited items or content. Please ensure your image shows a legitimate product."
			} else if strings.Contains(errMsg, "timeout") || strings.Contains(errMsg, "deadline") {
				userFriendlyMsg = "Image processing took too long. Please try again or use a smaller image."
			} else if strings.Contains(errMsg, "not found") || strings.Contains(errMsg, "API_KEY") {
				userFriendlyMsg = "We're experiencing technical difficulties with our image analysis service. Please try again later."
			} else if strings.Contains(errMsg, "RESOURCE_EXHAUSTED") {
				userFriendlyMsg = "Our image analysis service is busy. Please try again in a few moments."
			}
			log.Printf("GenerateProductDetailsWithAI error: %s", errMsg)
		} else if err != nil {
			log.Printf("GenerateProductDetailsWithAI error: %s", err.Error())
		}
		// Return 422 (Unprocessable Entity) — the server worked fine, the AI couldn't process the input
		return c.Status(422).JSON(models.APIResponse{
			Success: false,
			Error:   userFriendlyMsg,
		})
	}

	// Convert AIAnalysisResult to GeminiResponse for backward compatibility
	result := aiResult.Data
	if result == nil {
		result = &services.GeminiResponse{}
	}

	// Run server-side image quality analysis and merge into result
	qualityResults, qErr := services.AnalyzeMultipleImageQuality(files)
	if qErr != nil {
		log.Printf("Image quality analysis failed (non-blocking): %v", qErr)
	} else {
		isBlurryOrDark, qualityWarning, qualityIssues := services.FormatQualityWarnings(qualityResults)
		// Merge: only override if AI didn't already flag quality issues
		if !result.IsBlurryOrDark && isBlurryOrDark {
			result.IsBlurryOrDark = true
			result.QualityWarning = qualityWarning
		}
		// Attach detailed quality data
		result.ImageQualityIssues = qualityIssues
		if len(qualityResults) > 0 {
			result.ImageQualityScore = qualityResults[0].OverallScore
		}
	}

	return c.JSON(models.APIResponse{
		Success: true,
		Data:    result,
	})
}

// CheckImageQuality performs a fast server-side image quality check without AI analysis.
// This is useful for giving instant feedback before the full AI analysis runs.
func (h *ProductHandler) CheckImageQuality(c *fiber.Ctx) error {
	form, err := c.MultipartForm()
	if err != nil {
		return c.Status(400).JSON(models.APIResponse{
			Success: false,
			Error:   "Failed to parse uploaded files",
		})
	}

	files := form.File["images"]
	if len(files) < 1 {
		return c.Status(400).JSON(models.APIResponse{
			Success: false,
			Error:   "At least 1 image is required",
		})
	}

	results, err := services.AnalyzeMultipleImageQuality(files)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{
			Success: false,
			Error:   "Failed to analyze image quality",
		})
	}

	// Compute aggregate result
	totalScore := 0
	allPass := true
	var allIssues []services.ImageQualityIssue
	for _, r := range results {
		totalScore += r.OverallScore
		if !r.PassesCheck {
			allPass = false
		}
		allIssues = append(allIssues, r.Issues...)
	}
	avgScore := 0
	if len(results) > 0 {
		avgScore = totalScore / len(results)
	}

	return c.JSON(models.APIResponse{
		Success: true,
		Data: map[string]interface{}{
			"overall_score": avgScore,
			"quality_label": services.GetQualityLabel(avgScore),
			"passes_check":  allPass,
			"issues":        allIssues,
			"per_image":     results,
		},
	})
}

// ReportListing handles reporting a product listing for moderation
func (h *ProductHandler) ReportListing(c *fiber.Ctx) error {
	log.Println("[ReportListing] Handler called")
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		log.Println("[ReportListing] User not authenticated")
		return c.Status(401).JSON(models.APIResponse{
			Success: false,
			Error:   "User not authenticated",
		})
	}

	// Parse request body
	var req models.ListingReportCreate
	if err := c.BodyParser(&req); err != nil {
		log.Printf("[ReportListing] Body parse error: %v", err)
		return c.Status(400).JSON(models.APIResponse{
			Success: false,
			Error:   "Invalid request body",
		})
	}
	log.Printf("[ReportListing] Parsed: product_id=%d reason=%s details=%s", req.ProductID, req.Reason, req.Details)

	// Validate reason
	validReasons := map[string]bool{
		"wrong_category":      true,
		"prohibited_item":     true,
		"fake_or_scam":        true,
		"inappropriate_photo": true,
		"other":               true,
	}
	if !validReasons[req.Reason] {
		return c.Status(400).JSON(models.APIResponse{
			Success: false,
			Error:   "Invalid report reason",
		})
	}

	// Verify product exists and get seller ID
	var productID, sellerID int
	err := h.db.QueryRow(`SELECT id, seller_id FROM products WHERE id = ?`, req.ProductID).Scan(&productID, &sellerID)
	if err == sql.ErrNoRows {
		return c.Status(404).JSON(models.APIResponse{
			Success: false,
			Error:   "Product not found",
		})
	} else if err != nil {
		log.Printf("Error checking product: %v", err)
		return c.Status(500).JSON(models.APIResponse{
			Success: false,
			Error:   "Database error",
		})
	}

	// Insert report into reports table
	details := req.Details
	if details == "" {
		details = "No additional details provided"
	}
	_, err = h.db.Exec(`
		INSERT INTO reports (reporter_id, reported_user_id, product_id, reason, description, status, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, 'pending', NOW(), NOW())
	`, userID, sellerID, req.ProductID, req.Reason, details)

	if err != nil {
		log.Printf("Error creating listing report: %v | userID=%d sellerID=%d productID=%d reason=%s", err, userID, sellerID, req.ProductID, req.Reason)
		return c.Status(500).JSON(models.APIResponse{
			Success: false,
			Error:   "Failed to submit report",
		})
	}

	// Notify all admin users about the report
	var reporterName string
	h.db.QueryRow("SELECT name FROM users WHERE id = ?", userID).Scan(&reporterName)
	var reportedName string
	h.db.QueryRow("SELECT name FROM users WHERE id = ?", sellerID).Scan(&reportedName)

	adminRows, adminErr := h.db.Query("SELECT id FROM users WHERE role = 'admin'")
	if adminErr == nil {
		defer adminRows.Close()
		notifMsg := fmt.Sprintf("%s reported %s for: %s", reporterName, reportedName, req.Reason)
		for adminRows.Next() {
			var adminID int
			if adminRows.Scan(&adminID) == nil {
				h.db.Exec(
					"INSERT INTO notifications (user_id, type, message, is_read, created_at) VALUES (?, 'report', ?, FALSE, NOW())",
					adminID, notifMsg,
				)
			}
		}
	}

	return c.JSON(models.APIResponse{
		Success: true,
		Message: "Report submitted successfully",
	})
}

// ReorderImages allows a product owner to reorder their product images (e.g. set a new cover image)
func (h *ProductHandler) ReorderImages(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{
			Success: false,
			Error:   "User not authenticated",
		})
	}

	productID, err := strconv.Atoi(c.Params("id"))
	if err != nil {
		return c.Status(400).JSON(models.APIResponse{
			Success: false,
			Error:   "Invalid product ID",
		})
	}

	// Verify ownership
	var sellerID int
	var currentImageURLsJSON string
	err = h.db.QueryRow("SELECT seller_id, image_urls FROM products WHERE id = ?", productID).Scan(&sellerID, &currentImageURLsJSON)
	if err != nil {
		if err == sql.ErrNoRows {
			return c.Status(404).JSON(models.APIResponse{Success: false, Error: "Product not found"})
		}
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to get product"})
	}

	if sellerID != userID {
		return c.Status(403).JSON(models.APIResponse{
			Success: false,
			Error:   "You can only reorder images of your own products",
		})
	}

	// Parse request body
	var body struct {
		ImageURLs []string `json:"image_urls"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid request body"})
	}

	if len(body.ImageURLs) == 0 {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "image_urls cannot be empty"})
	}

	// Parse current image URLs to validate the reorder contains the same set
	var currentURLs []string
	if err := json.Unmarshal([]byte(currentImageURLsJSON), &currentURLs); err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to parse current image URLs"})
	}

	if len(body.ImageURLs) != len(currentURLs) {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Reordered list must contain the same images"})
	}

	// Verify same set of URLs
	currentSet := make(map[string]bool)
	for _, u := range currentURLs {
		currentSet[u] = true
	}
	for _, u := range body.ImageURLs {
		if !currentSet[u] {
			return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Reordered list must contain the same images"})
		}
	}

	// Update
	imageURLsJSON, _ := json.Marshal(body.ImageURLs)
	_, err = h.db.Exec("UPDATE products SET image_urls = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", string(imageURLsJSON), productID)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to update image order"})
	}

	return c.JSON(models.APIResponse{
		Success: true,
		Message: "Image order updated",
	})
}

// SearchSuggestions returns fast DB-based suggestions for autocomplete
func (h *ProductHandler) SearchSuggestions(c *fiber.Ctx) error {
	q := strings.TrimSpace(c.Query("q", ""))
	if q == "" || len(q) < 2 {
		return c.JSON(models.APIResponse{
			Success: true,
			Data: map[string]interface{}{
				"products":   []string{},
				"categories": []string{},
				"tags":       []string{},
				"brands":     []string{},
			},
		})
	}

	pattern := "%" + q + "%"

	// Matching product titles (top 5)
	var productTitles []string
	rows, err := h.db.Query(
		"SELECT DISTINCT title FROM products WHERE status = 'available' AND title LIKE ? ORDER BY premium DESC, created_at DESC LIMIT 5",
		pattern,
	)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var title string
			if rows.Scan(&title) == nil {
				productTitles = append(productTitles, title)
			}
		}
	}

	// Matching categories (top 3)
	var categories []string
	catRows, err := h.db.Query(
		"SELECT DISTINCT category FROM products WHERE status = 'available' AND category LIKE ? AND category != '' LIMIT 3",
		pattern,
	)
	if err == nil {
		defer catRows.Close()
		for catRows.Next() {
			var cat string
			if catRows.Scan(&cat) == nil {
				categories = append(categories, cat)
			}
		}
	}

	// Matching tags (search inside JSON array, top 5)
	var tags []string
	tagRows, err := h.db.Query(
		"SELECT DISTINCT tags FROM products WHERE status = 'available' AND tags IS NOT NULL AND tags LIKE ? LIMIT 10",
		pattern,
	)
	if err == nil {
		defer tagRows.Close()
		seen := make(map[string]bool)
		for tagRows.Next() {
			var tagsJSON string
			if tagRows.Scan(&tagsJSON) == nil {
				var tagList []string
				if json.Unmarshal([]byte(tagsJSON), &tagList) == nil {
					for _, t := range tagList {
						tLower := strings.ToLower(t)
						qLower := strings.ToLower(q)
						if strings.Contains(tLower, qLower) && !seen[tLower] {
							tags = append(tags, t)
							seen[tLower] = true
							if len(tags) >= 5 {
								break
							}
						}
					}
				}
			}
			if len(tags) >= 5 {
				break
			}
		}
	}

	// Matching brands (top 3)
	var brands []string
	brandRows, err := h.db.Query(
		"SELECT DISTINCT brand FROM products WHERE status = 'available' AND brand IS NOT NULL AND brand != '' AND brand LIKE ? LIMIT 3",
		pattern,
	)
	if err == nil {
		defer brandRows.Close()
		for brandRows.Next() {
			var brand string
			if brandRows.Scan(&brand) == nil {
				brands = append(brands, brand)
			}
		}
	}

	// Ensure non-nil slices
	if productTitles == nil {
		productTitles = []string{}
	}
	if categories == nil {
		categories = []string{}
	}
	if tags == nil {
		tags = []string{}
	}
	if brands == nil {
		brands = []string{}
	}

	return c.JSON(models.APIResponse{
		Success: true,
		Data: map[string]interface{}{
			"products":   productTitles,
			"categories": categories,
			"tags":       tags,
			"brands":     brands,
		},
	})
}

// SmartSearch uses AI to parse natural language queries and return relevant products
func (h *ProductHandler) SmartSearch(c *fiber.Ctx) error {
	h.ensureProductEstimateVisibilityColumn()

	q := strings.TrimSpace(c.Query("q", ""))
	if q == "" {
		return c.JSON(models.APIResponse{
			Success: true,
			Data: models.PaginatedResponse{
				Data:       []models.Product{},
				Total:      0,
				Page:       1,
				Limit:      20,
				TotalPages: 0,
			},
		})
	}

	page, _ := strconv.Atoi(c.Query("page", "1"))
	limit, _ := strconv.Atoi(c.Query("limit", "20"))
	if limit <= 0 {
		limit = 20
	}
	offset := (page - 1) * limit

	viewerLatStr := c.Query("lat", "")
	viewerLngStr := c.Query("lng", "")
	hasLocation := viewerLatStr != "" && viewerLngStr != ""

	// Parse query with AI
	parsed, err := services.ParseSearchQuery(q, hasLocation)
	if err != nil {
		log.Printf("[SmartSearch] AI parse error: %v — falling back to keyword search", err)
		parsed = &services.SmartSearchResult{Keywords: strings.Fields(q)}
	}

	// Build WHERE clause
	whereClause := "WHERE p.status = 'available'"
	var args []interface{}

	// Build keyword conditions from all parsed keywords
	if len(parsed.Keywords) > 0 {
		var keywordClauses []string
		for _, kw := range parsed.Keywords {
			pattern := "%" + kw + "%"
			keywordClauses = append(keywordClauses, "(p.title LIKE ? OR p.description LIKE ? OR p.brand LIKE ? OR p.item_type LIKE ? OR p.tags LIKE ? OR p.category LIKE ?)")
			args = append(args, pattern, pattern, pattern, pattern, pattern, pattern)
		}
		whereClause += " AND (" + strings.Join(keywordClauses, " OR ") + ")"
	}

	// Apply category filter if AI detected one
	if parsed.Category != "" {
		whereClause += " AND (p.category = ? OR p.category LIKE ?)"
		args = append(args, parsed.Category, "%"+parsed.Category+"%")
	}

	// Apply price filters if AI detected price intent
	if parsed.MinPrice != nil {
		whereClause += " AND p.price >= ?"
		args = append(args, *parsed.MinPrice)
	}
	if parsed.MaxPrice != nil {
		whereClause += " AND p.price <= ?"
		args = append(args, *parsed.MaxPrice)
	}

	// Apply condition filter
	if parsed.Condition != "" {
		whereClause += " AND p.`condition` = ?"
		args = append(args, parsed.Condition)
	}

	// Count total
	countQuery := "SELECT COUNT(*) FROM products p LEFT JOIN users u ON p.seller_id = u.id " + whereClause
	var total int
	if err := h.db.QueryRow(countQuery, args...).Scan(&total); err != nil {
		total = 0
	}

	// Main query
	query := `
		SELECT p.id, p.slug, p.title, p.description, p.price, p.image_urls, p.seller_id,
		       p.premium, p.status, p.allow_buying, p.barter_only, p.location, p.` + "`condition`" + `,
		       p.suggested_value, p.category, p.estimated_value_min, p.estimated_value_max, COALESCE(p.show_estimated_value, TRUE), p.` + "`value`" + `, p.wants, p.wanted_categories, p.location_type, p.pickup_latitude, p.pickup_longitude, p.pickup_address, p.latitude, p.longitude, p.created_at, p.updated_at, p.boosted_at,
		       u.name as seller_name, u.profile_picture as seller_profile_picture,
		       u.latitude as seller_latitude, u.longitude as seller_longitude,
		   (SELECT COUNT(*) FROM wishlists w WHERE w.product_id = p.id) as want_count,
		   (SELECT COUNT(*) FROM trades t WHERE t.target_product_id = p.id AND t.status = 'pending') as offer_count
	FROM products p
	LEFT JOIN users u ON p.seller_id = u.id
	` + whereClause

	// Sorting: prioritize pins, then user tier, then recency
	query += ` ORDER BY p.premium DESC, (CASE WHEN u.premium_tier = 'pro' THEN 3 WHEN u.premium_tier = 'plus' THEN 2 ELSE 1 END) DESC, COALESCE(p.boosted_at, p.created_at) DESC`

	query += ` LIMIT ? OFFSET ?`
	args = append(args, limit, offset)

	rows, err := h.db.Query(query, args...)
	if err != nil {
		log.Printf("[SmartSearch] Query error: %v", err)
		return c.Status(500).JSON(models.APIResponse{
			Success: false,
			Error:   "Smart search failed",
		})
	}
	defer rows.Close()

	// Parse viewer coordinates
	var viewerLat, viewerLon *float64
	if hasLocation {
		if lat, err := strconv.ParseFloat(viewerLatStr, 64); err == nil {
			if lon, err := strconv.ParseFloat(viewerLngStr, 64); err == nil {
				viewerLat = &lat
				viewerLon = &lon
			}
		}
	}

	var products []models.Product
	for rows.Next() {
		var product models.Product
		var slugNull sql.NullString
		var conditionNull sql.NullString
		var priceNull sql.NullFloat64
		var sellerProfile sql.NullString
		var imageURLsJSONStr string
		var latNull, lonNull, sLatNull, sLonNull sql.NullFloat64
		var boostedAtNull sql.NullTime
		var offerCount int
		var locationTypeNull sql.NullString
		var pickupLatNull, pickupLonNull sql.NullFloat64
		var pickupAddressNull sql.NullString
		var wantsNull sql.NullString
		var wantedCategoriesRaw sql.NullString
		err := rows.Scan(&product.ID, &slugNull, &product.Title, &product.Description, &priceNull,
			&imageURLsJSONStr, &product.SellerID, &product.Premium, &product.Status,
			&product.AllowBuying, &product.BarterOnly, &product.Location,
			&conditionNull, &product.SuggestedValue, &product.Category,
			&product.EstimatedValueMin, &product.EstimatedValueMax, &product.ShowEstimatedValue, &product.Value,
			&wantsNull, &wantedCategoriesRaw,
			&locationTypeNull, &pickupLatNull, &pickupLonNull, &pickupAddressNull,
			&latNull, &lonNull, &product.CreatedAt, &product.UpdatedAt, &boostedAtNull,
			&product.SellerName, &sellerProfile, &sLatNull, &sLonNull, &product.WantCount, &product.OfferCount)
		if err != nil {
			log.Printf("[SmartSearch] Row scan error: %v", err)
			continue
		}
		if wantsNull.Valid {
			product.Wants = wantsNull.String
		}
		if wantedCategoriesRaw.Valid {
			product.WantedCategories = parseWantedCategories(wantedCategoriesRaw.String)
		}
		if locationTypeNull.Valid {
			product.LocationType = locationTypeNull.String
		}
		if pickupLatNull.Valid {
			product.PickupLatitude = &pickupLatNull.Float64
		}
		if pickupLonNull.Valid {
			product.PickupLongitude = &pickupLonNull.Float64
		}
		if pickupAddressNull.Valid {
			product.PickupAddress = pickupAddressNull.String
		}
		if slugNull.Valid {
			product.Slug = slugNull.String
		}
		if boostedAtNull.Valid {
			product.BoostedAt = &boostedAtNull.Time
		}
		if conditionNull.Valid {
			product.Condition = conditionNull.String
		}
		if priceNull.Valid {
			p := priceNull.Float64
			product.Price = &p
		}
		if sellerProfile.Valid {
			product.SellerProfilePicture = sellerProfile.String
		}

		// Coordinates
		var finalLat, finalLon *float64
		if latNull.Valid {
			l := latNull.Float64
			product.Latitude = &l
			finalLat = &l
		} else if sLatNull.Valid {
			l := sLatNull.Float64
			product.Latitude = &l
			finalLat = &l
		}
		if lonNull.Valid {
			l := lonNull.Float64
			product.Longitude = &l
			finalLon = &l
		} else if sLonNull.Valid {
			l := sLonNull.Float64
			product.Longitude = &l
			finalLon = &l
		}

		// Parse image URLs
		if imageURLsJSONStr != "" {
			var imageURLs []string
			if err := json.Unmarshal([]byte(imageURLsJSONStr), &imageURLs); err == nil {
				product.ImageURLs = models.StringArray(imageURLs)
			}
		}

		// Compute distance
		if viewerLat != nil && viewerLon != nil && finalLat != nil && finalLon != nil {
			result := services.CalculateDistance(*viewerLat, *viewerLon, *finalLat, *finalLon)
			if result.DistanceKm < 1 {
				product.Distance = fmt.Sprintf("%d M", int(result.DistanceM))
			} else if result.DistanceKm < 10 {
				product.Distance = fmt.Sprintf("%.1f KM", result.DistanceKm)
			} else {
				product.Distance = fmt.Sprintf("%d KM", int(result.DistanceKm))
			}
		}

		product.OfferCount = offerCount
		hideEstimatedValueIfNeeded(&product)
		products = append(products, product)
	}

	// Sort by distance if requested and viewer has location
	if parsed.SortByDistance && viewerLat != nil && viewerLon != nil {
		// Simple sort: products with coordinates first, sorted by distance
		type productWithDist struct {
			product  models.Product
			distance float64
		}
		var withDist []productWithDist
		for _, p := range products {
			dist := 999999.0
			if p.Latitude != nil && p.Longitude != nil {
				result := services.CalculateDistance(*viewerLat, *viewerLon, *p.Latitude, *p.Longitude)
				dist = result.DistanceKm
			}
			withDist = append(withDist, productWithDist{product: p, distance: dist})
		}
		// Sort by distance (nearest first), premium products first within same distance range
		for i := 0; i < len(withDist); i++ {
			for j := i + 1; j < len(withDist); j++ {
				if withDist[j].distance < withDist[i].distance {
					withDist[i], withDist[j] = withDist[j], withDist[i]
				}
			}
		}
		products = make([]models.Product, len(withDist))
		for i, wd := range withDist {
			products[i] = wd.product
		}
	}

	if products == nil {
		products = []models.Product{}
	}

	totalPages := 0
	if limit > 0 {
		totalPages = (total + limit - 1) / limit
	}

	return c.JSON(models.APIResponse{
		Success: true,
		Data: models.PaginatedResponse{
			Data:       products,
			Total:      total,
			Page:       page,
			Limit:      limit,
			TotalPages: totalPages,
		},
	})
}

// IncrementViewCount increments the view count for a product when clicked
// This endpoint is called from the frontend when a user clicks on a product card
// to view its details. It securely tracks views and prevents self-views.
func (h *ProductHandler) IncrementViewCount(c *fiber.Ctx) error {
	productID := c.Params("id")
	if productID == "" {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Product ID is required",
		})
	}

	id, err := strconv.Atoi(productID)
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(fiber.Map{
			"error": "Invalid product ID",
		})
	}

	// Get viewer's user ID if authenticated
	viewerID, _ := middleware.GetUserIDFromContext(c)

	// Get product details to check if product exists and get seller ID
	var sellerID int
	err = h.db.QueryRow("SELECT seller_id FROM products WHERE id = ?", id).Scan(&sellerID)
	if err == sql.ErrNoRows {
		return c.Status(fiber.StatusNotFound).JSON(fiber.Map{
			"error": "Product not found",
		})
	}
	if err != nil {
		log.Printf("Error fetching product: %v", err)
		return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
			"error": "Failed to fetch product",
		})
	}

	// Don't increment view count for the product owner (self-views)
	if viewerID > 0 && viewerID == sellerID {
		var viewCount int
		h.db.QueryRow("SELECT COUNT(*) FROM product_views WHERE product_id = ?", id).Scan(&viewCount)
		return c.JSON(fiber.Map{
			"success":    true,
			"view_count": viewCount,
		})
	}

	// Record the view in product_views table
	_, err = h.db.Exec(
		"INSERT INTO product_views (product_id, viewer_user_id) VALUES (?, ?)",
		id, viewerID,
	)
	if err != nil {
		log.Printf("Error recording product view: %v", err)
	}

	// Get updated view count from product_views table
	var newViewCount int
	err = h.db.QueryRow("SELECT COUNT(*) FROM product_views WHERE product_id = ?", id).Scan(&newViewCount)
	if err != nil {
		log.Printf("Error getting view count: %v", err)
		newViewCount = 0
	}

	return c.JSON(fiber.Map{
		"success":    true,
		"view_count": newViewCount,
	})
}
