package handlers

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"regexp"
	"strconv"
	"strings"
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

// NewProductHandler creates a new product handler
func NewProductHandler() *ProductHandler {
	return &ProductHandler{
		db: database.DB,
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

// CreateProduct creates a new product
func (h *ProductHandler) CreateProduct(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{
			Success: false,
			Error:   "User not authenticated",
		})
	}

	// Parse fields
	title := c.FormValue("title")
	description := c.FormValue("description")
	priceStr := c.FormValue("price")
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
		savePath := fmt.Sprintf("uploads/%d_%s", time.Now().UnixNano(), file.Filename)
		if err := c.SaveFile(file, savePath); err != nil {
			continue // skip failed uploads
		}
		imagePaths = append(imagePaths, "/"+savePath)
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

	// Appraise product based on title and description
	appraisal := services.AppraiseProduct(title, description)
	category := appraisal.Category
	if categoryOverride != "" {
		category = categoryOverride
	}

	// If user did not specify a condition, use the appraised one
	finalCondition := condition
	if finalCondition == "" {
		finalCondition = appraisal.Condition
	}

	// Geocode location
	var lat, lon *float64
	if location != "" {
		coords, err := services.GetCoordinates(location)
		if err == nil {
			lat = &coords.Latitude
			lon = &coords.Longitude
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

	// Ensure slug is unique by checking and appending number if needed
	baseSlug := slug
	counter := 1
	for {
		var exists int
		err := h.db.QueryRow("SELECT COUNT(*) FROM products WHERE slug = ?", slug).Scan(&exists)
		if err != nil || exists == 0 {
			break
		}
		// If slug exists, append counter
		slug = fmt.Sprintf("%s-%d", baseSlug, counter)
		counter++
	}

	// Insert new product with slug. Build SQL dynamically so it's tolerant
	// to missing latitude/longitude columns (some DBs may not have applied migrations).
	cols := []string{"slug", "title", "description", "price", "image_urls", "seller_id", "premium", "allow_buying", "barter_only", "location", "status", "`condition`", "suggested_value", "category"}
	placeholders := []string{"?", "?", "?", "?", "?", "?", "?", "?", "?", "?", "?", "?", "?", "?"}
	args := []interface{}{slug, title, finalDescription, insertPrice, string(imageURLsJSONBytes), userID, premium, allowBuying, barterOnly, location, "available", finalCondition, suggestedValue, category}

	// Only include latitude/longitude if geocoding produced values
	if lat != nil && lon != nil {
		// insert latitude and longitude after 'location' (which is index 9)
		insertIdx := 10 // index in cols/placeholders/args where 'status' currently resides
		cols = append(cols[:insertIdx], append([]string{"latitude"}, cols[insertIdx:]...)...)
		placeholders = append(placeholders[:insertIdx], append([]string{"?"}, placeholders[insertIdx:]...)...)
		args = append(args[:insertIdx], append([]interface{}{*lat}, args[insertIdx:]...)...)

		insertIdx2 := insertIdx + 1
		cols = append(cols[:insertIdx2], append([]string{"longitude"}, cols[insertIdx2:]...)...)
		placeholders = append(placeholders[:insertIdx2], append([]string{"?"}, placeholders[insertIdx2:]...)...)
		args = append(args[:insertIdx2], append([]interface{}{*lon}, args[insertIdx2:]...)...)
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
	err = h.db.QueryRow(
		"SELECT id, slug, title, description, price, image_urls, seller_id, premium, status, allow_buying, barter_only, location, `condition`, suggested_value, category, created_at, updated_at FROM products WHERE id = ?",
		productID,
	).Scan(&createdProduct.ID, &slugNull, &createdProduct.Title, &createdProduct.Description, &createdProduct.Price,
		&createdProduct.ImageURLs, &createdProduct.SellerID, &createdProduct.Premium, &createdProduct.Status,
		&createdProduct.AllowBuying, &createdProduct.BarterOnly, &createdProduct.Location,
		&createdProduct.Condition, &createdProduct.SuggestedValue, &createdProduct.Category, &createdProduct.CreatedAt, &createdProduct.UpdatedAt)

	if slugNull.Valid {
		createdProduct.Slug = slugNull.String
	}

	if err != nil {
		return c.Status(500).JSON(models.APIResponse{
			Success: false,
			Error:   "Failed to retrieve created product",
		})
	}

	return c.Status(201).JSON(models.APIResponse{
		Success: true,
		Message: "Product created successfully",
		Data:    createdProduct,
	})
}

// GetProducts gets all products with search and filtering
func (h *ProductHandler) GetProducts(c *fiber.Ctx) error {
	// Parse query parameters
	keyword := c.Query("keyword", "")
	minPriceStr := c.Query("min_price", "")
	maxPriceStr := c.Query("max_price", "")
	premiumStr := c.Query("premium", "")
	status := c.Query("status", "")
	sellerIDStr := c.Query("seller_id", "")
	barterOnlyStr := c.Query("barter_only", "")
	allowBuyingStr := c.Query("allow_buying", "")
	location := c.Query("location", "")
	page, _ := strconv.Atoi(c.Query("page", "1"))
	limit, _ := strconv.Atoi(c.Query("limit", "20"))
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
		whereClause += " AND ("
		whereClause += "p.title LIKE ? OR p.description LIKE ?"
		whereClause += " OR p.location LIKE ? OR p.category LIKE ? OR p.`condition` LIKE ?"
		whereClause += " OR u.name LIKE ? OR u.org_name LIKE ? OR u.department LIKE ?"
		whereClause += ")"
		like := "%" + keyword + "%"
		args = append(args, like, like, like, like, like, like, like, like)
		searchPattern := "%" + keyword + "%"
		whereClause += " AND (p.title LIKE ? OR p.description LIKE ? OR p.category LIKE ? OR p.condition LIKE ? OR u.name LIKE ?)"
		args = append(args, searchPattern, searchPattern, searchPattern, searchPattern, searchPattern)
	}

	if minPriceStr != "" {
		if minPrice, err := strconv.ParseFloat(minPriceStr, 64); err == nil {
			whereClause += " AND p.price >= ?"
			args = append(args, minPrice)
		}
	}

	if maxPriceStr != "" {
		if maxPrice, err := strconv.ParseFloat(maxPriceStr, 64); err == nil {
			whereClause += " AND p.price <= ?"
			args = append(args, maxPrice)
		}
	}

	if premiumStr != "" {
		if premium, err := strconv.ParseBool(premiumStr); err == nil {
			whereClause += " AND p.premium = ?"
			args = append(args, premium)
		}
	}

	// Only apply the default 'available' status filter if no specific seller is requested.
	// This allows a user to see all of their own products (sold, traded, etc.).
	if sellerIDStr != "" {
		if sellerID, err := strconv.Atoi(sellerIDStr); err == nil {
			whereClause += " AND p.seller_id = ?"
			args = append(args, sellerID)
		}
	} else {
		// For the general public feed, default to 'available' if no status is specified.
		if status != "" {
			whereClause += " AND p.status = ?"
			args = append(args, status)
		} else {
			whereClause += " AND p.status = 'available'"
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

	if location != "" {
		whereClause += " AND p.location LIKE ?"
		args = append(args, "%"+location+"%")
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
			Error:   "Failed to get product count: " + err.Error(),
		})
	}

	// Use the full query with proper WHERE clause handling
	// Check if optional columns exist (slug, latitude, longitude). If migrations haven't been applied,
	// avoid selecting missing columns to prevent SQL errors.
	hasCol := func(col string) bool {
		var cnt int
		q := `SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'products' AND column_name = ?`
		if err := h.db.QueryRow(q, col).Scan(&cnt); err != nil {
			return false
		}
		return cnt > 0
	}

	slugOK := hasCol("slug")
	latOK := hasCol("latitude")
	lngOK := hasCol("longitude")

	// Build select column list dynamically to match available schema
	selectCols := []string{"p.id"}
	if slugOK {
		selectCols = append(selectCols, "p.slug")
	}
	selectCols = append(selectCols, []string{"p.title", "p.description", "p.price", "p.seller_id", "p.premium", "p.status", "p.allow_buying", "p.barter_only", "p.location"}...)
	if latOK {
		selectCols = append(selectCols, "p.latitude")
	}
	if lngOK {
		selectCols = append(selectCols, "p.longitude")
	}
	selectCols = append(selectCols, []string{"p.created_at", "p.updated_at", "COALESCE(u.name, 'Unknown') as seller_name", "p.image_urls"}...)

	cols := strings.Join(selectCols, ", ")

	var query string
	if keyword == "" {
		query = fmt.Sprintf(`SELECT %s FROM products p LEFT JOIN users u ON p.seller_id = u.id %s ORDER BY p.created_at DESC LIMIT ? OFFSET ?`, cols, whereClause)
	} else {
		query = fmt.Sprintf(`SELECT %s FROM products p LEFT JOIN users u ON p.seller_id = u.id %s ORDER BY p.premium DESC, p.created_at DESC LIMIT ? OFFSET ?`, cols, whereClause)
	}
	args = append(args, limit, offset)

	// Test a simple query first
	var testCount int
	err = h.db.QueryRow("SELECT COUNT(*) FROM products").Scan(&testCount)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{
			Success: false,
			Error:   "Database connection test failed: " + err.Error(),
		})
	}
	rows, err := h.db.Query(query, args...)
	if err != nil {
		// Enhanced debugging: print query and args
		fmt.Printf("❌ Products query failed!\n")
		fmt.Printf("Query: %s\n", query)
		fmt.Printf("Args: %v\n", args)
		fmt.Printf("Error: %v\n", err)
		return c.Status(500).JSON(models.APIResponse{
			Success: false,
			Error:   "Failed to get products: " + err.Error(),
		})
	}
	defer rows.Close()

	// Check for errors after query execution
	if err = rows.Err(); err != nil {
		return c.Status(500).JSON(models.APIResponse{
			Success: false,
			Error:   "Error after query execution: " + err.Error(),
		})
	}

	var products []models.Product
	rowCount := 0
	for rows.Next() {
		rowCount++
		// Scan all fields with proper NULL handling. We built selectCols dynamically above,
		// so create matching scan targets.
		var id int
		var title string
		var description string
		var price sql.NullFloat64
		var sellerID int
		var premium int64
		var status string
		var allowBuying int64
		var barterOnly int64
		var location sql.NullString
		var createdAt sql.NullTime
		var updatedAt sql.NullTime
		var sellerName string
		var imageURLsJSON sql.NullString

		// Optional holders
		var slugNull sql.NullString
		var latitudeNull sql.NullFloat64
		var longitudeNull sql.NullFloat64

		scanTargets := []interface{}{&id}
		if slugOK {
			scanTargets = append(scanTargets, &slugNull)
		}
		scanTargets = append(scanTargets, &title, &description, &price, &sellerID, &premium, &status, &allowBuying, &barterOnly, &location)
		if latOK {
			scanTargets = append(scanTargets, &latitudeNull)
		}
		if lngOK {
			scanTargets = append(scanTargets, &longitudeNull)
		}
		scanTargets = append(scanTargets, &createdAt, &updatedAt, &sellerName, &imageURLsJSON)

		if err := rows.Scan(scanTargets...); err != nil {
			// Log the error but continue processing other rows
			fmt.Printf("warning: failed to scan product row: %v\n", err)
			continue
		}

		// Create a complete product struct
		product := models.Product{
			ID:          id,
			Title:       title,
			Description: description,
			SellerID:    sellerID,
			Status:      status,
			SellerName:  sellerName,
			ImageURLs:   models.StringArray{},
		}

		// Handle slug
		if slugNull.Valid {
			product.Slug = slugNull.String
		}

		// Set boolean flags
		product.Premium = premium != 0
		product.AllowBuying = allowBuying != 0
		product.BarterOnly = barterOnly != 0

		// Handle price
		if price.Valid {
			p := price.Float64
			product.Price = &p
		}

		// Handle location
		if location.Valid {
			product.Location = location.String
		}

		// Handle latitude and longitude
		if latitudeNull.Valid {
			lat := latitudeNull.Float64
			product.Latitude = &lat
		}
		if longitudeNull.Valid {
			lng := longitudeNull.Float64
			product.Longitude = &lng
		}

		// Handle timestamps
		if createdAt.Valid {
			product.CreatedAt = createdAt.Time
		} else {
			product.CreatedAt = time.Now()
		}
		if updatedAt.Valid {
			product.UpdatedAt = updatedAt.Time
		} else {
			product.UpdatedAt = time.Now()
		}

		// Parse image URLs JSON if present
		if imageURLsJSON.Valid && imageURLsJSON.String != "" {
			var urls []string
			if err := json.Unmarshal([]byte(imageURLsJSON.String), &urls); err == nil {
				product.ImageURLs = models.StringArray(urls)
			}
		}

		products = append(products, product)
	}

	totalPages := (total + limit - 1) / limit

	// Ensure products is never nil (always a slice)
	if products == nil {
		products = []models.Product{}
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

	// Insert into wishlists, ignoring if it already exists
	_, err = h.db.Exec("INSERT IGNORE INTO wishlists (user_id, product_id) VALUES (?, ?)", userID, productID)
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

// GetWishlistCount gets the wishlist count for a product
func (h *ProductHandler) GetWishlistCount(c *fiber.Ctx) error {
	productID, err := strconv.Atoi(c.Params("id"))
	if err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid product ID"})
	}

	var count int
	err = h.db.QueryRow("SELECT COUNT(*) FROM wishlists WHERE product_id = ?", productID).Scan(&count)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to get wishlist count"})
	}

	return c.JSON(models.APIResponse{Success: true, Data: fiber.Map{"count": count}})
}

// GetUserWishlistStatus checks if a user has wishlisted a product
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
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to get wishlist status"})
	}

	return c.JSON(models.APIResponse{Success: true, Data: fiber.Map{"is_wishlisted": exists > 0}})
}

// GetProduct gets a product by ID or slug with visibility checks
func (h *ProductHandler) GetProduct(c *fiber.Ctx) error {
	identifier := c.Params("id") // Can be ID or slug

	// Get current user ID (may be 0 if not authenticated)
	userID, _ := middleware.GetUserIDFromContext(c)

	var product models.Product
	var priceNull sql.NullFloat64
	var imageURLsJSONStr sql.NullString
	var sellerName sql.NullString
	var wishlistCount int
	var descriptionNull sql.NullString
	var locationNull sql.NullString
	var titleNull sql.NullString
	var slugNull sql.NullString
	var premiumInt int64
	var allowBuyingInt int64
	var barterOnlyInt int64
	var createdAtNull sql.NullTime
	var updatedAtNull sql.NullTime
	var statusNull sql.NullString

	// Try to parse as integer ID first, otherwise treat as slug
	var query string
	var queryArg interface{}
	productID, err := strconv.Atoi(identifier)
	if err == nil {
		// It's a numeric ID
		query = `SELECT p.id, p.slug, p.title, p.description, p.price, p.image_urls, p.seller_id,
			   p.premium, p.status, p.allow_buying, p.barter_only, p.location,
			   p.created_at, p.updated_at, u.name as seller_name,
			   (SELECT COUNT(*) FROM wishlists WHERE product_id = p.id) as wishlist_count
		FROM products p
		LEFT JOIN users u ON p.seller_id = u.id
		WHERE p.id = ?`
		queryArg = productID
	} else {
		// It's a slug
		query = `SELECT p.id, p.slug, p.title, p.description, p.price, p.image_urls, p.seller_id,
			   p.premium, p.status, p.allow_buying, p.barter_only, p.location,
			   p.created_at, p.updated_at, u.name as seller_name,
			   (SELECT COUNT(*) FROM wishlists WHERE product_id = p.id) as wishlist_count
		FROM products p
		LEFT JOIN users u ON p.seller_id = u.id
		WHERE p.slug = ?`
		queryArg = identifier
	}

	err = h.db.QueryRow(query, queryArg).Scan(&product.ID, &slugNull, &titleNull, &descriptionNull, &priceNull,
		&imageURLsJSONStr, &product.SellerID, &premiumInt, &statusNull,
		&allowBuyingInt, &barterOnlyInt, &locationNull,
		&createdAtNull, &updatedAtNull, &sellerName, &wishlistCount)

	if err != nil {
		if err == sql.ErrNoRows {
			return c.Status(404).JSON(models.APIResponse{
				Success: false,
				Error:   "Product not found",
			})
		}
		// Log the actual error for debugging with more details
		fmt.Printf("❌ Error scanning product %v: %v\n", identifier, err)
		fmt.Printf("   Error type: %T\n", err)
		// Return error but don't expose internal details in production
		return c.Status(500).JSON(models.APIResponse{
			Success: false,
			Error:   "Failed to retrieve product",
		})
	}

	// Handle nullable string fields
	if titleNull.Valid {
		product.Title = titleNull.String
	} else {
		product.Title = ""
	}

	if slugNull.Valid {
		product.Slug = slugNull.String
	}

	if descriptionNull.Valid {
		product.Description = descriptionNull.String
	} else {
		product.Description = ""
	}

	if locationNull.Valid {
		product.Location = locationNull.String
	} else {
		product.Location = ""
	}

	// Convert boolean integers to bool
	product.Premium = premiumInt != 0
	product.AllowBuying = allowBuyingInt != 0
	product.BarterOnly = barterOnlyInt != 0

	// Handle status
	if statusNull.Valid {
		product.Status = statusNull.String
	} else {
		product.Status = "available" // Default value from schema
	}

	// SECURITY: Enforce visibility rules
	// If product is traded or locked, only the owner can view it
	if (product.Status == "traded" || product.Status == "locked") && product.SellerID != userID {
		return c.Status(403).JSON(models.APIResponse{
			Success: false,
			Error:   "This item is no longer available",
		})
	}

	// Handle timestamps
	if createdAtNull.Valid {
		product.CreatedAt = createdAtNull.Time
	} else {
		product.CreatedAt = time.Now()
	}
	if updatedAtNull.Valid {
		product.UpdatedAt = updatedAtNull.Time
	} else {
		product.UpdatedAt = time.Now()
	}

	// Set seller name if present
	if sellerName.Valid {
		product.SellerName = sellerName.String
	} else {
		product.SellerName = ""
	}

	// Parse image URLs from JSON using defensive logic in models.StringArray
	if imageURLsJSONStr.Valid && imageURLsJSONStr.String != "" {
		var sa models.StringArray
		if err := sa.UnmarshalJSON([]byte(imageURLsJSONStr.String)); err == nil {
			// Filter out any excessively long entries (likely data URLs) and keep only valid-looking URLs
			var cleaned []string
			for _, u := range sa {
				if u == "" {
					continue
				}
				// Skip obvious data URLs that might have been accidentally stored
				uLen := len(u)
				if uLen > 2000 {
					continue
				}
				if uLen > 100 && uLen >= 5 && u[:5] == "data:" {
					continue
				}
				if uLen >= 7 && u[:7] == "data:/" {
					continue
				}
				cleaned = append(cleaned, u)
			}
			product.ImageURLs = models.StringArray(cleaned)
		} else {
			// If unmarshalling fails, avoid returning an error to the client; set to empty
			product.ImageURLs = models.StringArray{}
		}
	} else {
		product.ImageURLs = models.StringArray{}
	}

	// Populate wishlist count
	product.WishlistCount = wishlistCount
	// bidding_type doesn't exist in the database schema, so set to empty
	product.BiddingType = ""

	if priceNull.Valid {
		p := priceNull.Float64
		product.Price = &p
	} else {
		product.Price = nil
	}

	// Compute vote counts for this product
	var underCount int
	var overCount int
	_ = h.db.QueryRow("SELECT COALESCE(SUM(CASE WHEN vote = 'under' THEN 1 ELSE 0 END),0), COALESCE(SUM(CASE WHEN vote = 'over' THEN 1 ELSE 0 END),0) FROM product_votes WHERE product_id = ?", product.ID).Scan(&underCount, &overCount)

	// Find current user's vote, if authenticated
	var userVote string
	if userID != 0 {
		if err := h.db.QueryRow("SELECT vote FROM product_votes WHERE product_id = ? AND user_id = ?", product.ID, userID).Scan(&userVote); err != nil {
			userVote = ""
		}
	}

	return c.JSON(models.APIResponse{
		Success: true,
		Data: fiber.Map{
			"product":   product,
			"votes":     fiber.Map{"under": underCount, "over": overCount},
			"user_vote": userVote,
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
			Error:   "Failed to retrieve product details",
		})
	}

	if p.SellerID != userID {
		return c.Status(403).JSON(models.APIResponse{
			Success: false,
			Error:   "You can only update your own products",
		})
	}

	var updateData models.ProductUpdate
	if err := c.BodyParser(&updateData); err != nil {
		return c.Status(400).JSON(models.APIResponse{
			Success: false,
			Error:   "Invalid request body",
		})
	}

	// Prevent editing of products that are already sold or traded
	if p.Status == "sold" || p.Status == "traded" {
		return c.Status(403).JSON(models.APIResponse{
			Success: false,
			Error:   "Cannot edit a product that has been sold or traded",
		})
	}

	// Build update query dynamically
	query := "UPDATE products SET updated_at = CURRENT_TIMESTAMP"
	var args []interface{}

	if updateData.Title != nil {
		query += ", title = ?"
		args = append(args, *updateData.Title)
	}
	if updateData.Description != nil {
		query += ", description = ?"
		args = append(args, *updateData.Description)
	}
	if updateData.Price != nil {
		query += ", price = ?"
		args = append(args, *updateData.Price)
	}
	if updateData.ImageURLs != nil {
		// Ensure we don't accidentally persist client-side data URLs or extremely large strings
		var safeList []string
		for _, u := range *updateData.ImageURLs {
			if u == "" {
				continue
			}
			if len(u) > 2000 {
				// skip very large entries (likely data URLs)
				continue
			}
			if len(u) > 10 && (u[:5] == "data:" || u[:7] == "data:/") {
				// skip inline data URLs
				continue
			}
			safeList = append(safeList, u)
		}
		// Marshal safeList to JSON string to store
		imgJSON, _ := json.Marshal(safeList)
		query += ", image_urls = ?"
		args = append(args, string(imgJSON))
	}
	if updateData.Premium != nil {
		query += ", premium = ?"
		args = append(args, *updateData.Premium)
	}
	if updateData.Status != nil {
		query += ", status = ?"
		args = append(args, *updateData.Status)
	}
	if updateData.AllowBuying != nil {
		query += ", allow_buying = ?"
		args = append(args, *updateData.AllowBuying)
	}
	if updateData.BarterOnly != nil {
		query += ", barter_only = ?"
		args = append(args, *updateData.BarterOnly)
	}
	if updateData.Location != nil {
		query += ", location = ?"
		args = append(args, *updateData.Location)
	}
	if updateData.Condition != nil {
		query += ", `condition` = ?"
		args = append(args, *updateData.Condition)
	}
	// bidding_type column doesn't exist in database, so skip it

	// Recalculate suggested value if price or condition changed
	if updateData.Price != nil || updateData.Condition != nil {
		newPrice := p.Price
		if updateData.Price != nil {
			newPrice = updateData.Price
		}

		newCondition := p.Condition
		if updateData.Condition != nil {
			newCondition = *updateData.Condition
		}

		var priceValue float64
		if newPrice != nil {
			priceValue = *newPrice
		}

		newSuggestedValue := calculateSuggestedValue(priceValue, newCondition)
		query += ", suggested_value = ?"
		args = append(args, newSuggestedValue)
	}

	// Do not proceed if no fields were updated
	if len(args) == 0 {
		return c.JSON(models.APIResponse{
			Success: true,
			Message: "No fields to update",
		})
	}

	query += " WHERE id = ?"
	args = append(args, productID)

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

	// Check if user owns the product
	var sellerID int
	err = h.db.QueryRow("SELECT seller_id FROM products WHERE id = ?", productID).Scan(&sellerID)
	if err != nil {
		return c.Status(404).JSON(models.APIResponse{
			Success: false,
			Error:   "Product not found",
		})
	}

	if sellerID != userID {
		return c.Status(403).JSON(models.APIResponse{
			Success: false,
			Error:   "You can only delete your own products",
		})
	}

	// Check if product has orders
	var orderCount int
	err = h.db.QueryRow("SELECT COUNT(*) FROM orders WHERE product_id = ?", productID).Scan(&orderCount)
	if err == nil && orderCount > 0 {
		return c.Status(400).JSON(models.APIResponse{
			Success: false,
			Error:   "Cannot delete product with existing orders",
		})
	}

	// Delete the product
	_, err = h.db.Exec("DELETE FROM products WHERE id = ?", productID)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{
			Success: false,
			Error:   "Failed to delete product",
		})
	}

	return c.JSON(models.APIResponse{
		Success: true,
		Message: "Product deleted successfully",
	})
}

// GetUserProducts gets products by a specific user
func (h *ProductHandler) GetUserProducts(c *fiber.Ctx) error {
	userID, err := strconv.Atoi(c.Params("id"))
	if err != nil {
		return c.Status(400).JSON(models.APIResponse{
			Success: false,
			Error:   "Invalid user ID",
		})
	}

	page, _ := strconv.Atoi(c.Query("page", "1"))
	limit, _ := strconv.Atoi(c.Query("limit", "10"))
	offset := (page - 1) * limit

	// Get total count
	var total int
	err = h.db.QueryRow("SELECT COUNT(*) FROM products WHERE seller_id = ?", userID).Scan(&total)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{
			Success: false,
			Error:   "Failed to get product count",
		})
	}

	// Get products (use image_urls)
	active := c.Query("active", "") == "true"
	where := "WHERE p.seller_id = ?"
	if active {
		where += " AND p.status = 'available'"
	}
	rows, err := h.db.Query(`
		SELECT p.id, p.slug, p.title, p.description, p.price, p.image_urls, p.seller_id, 
		       p.premium, p.status, p.allow_buying, p.barter_only, p.created_at, p.updated_at, u.name as seller_name
		FROM products p
		JOIN users u ON p.seller_id = u.id
		`+where+`
		ORDER BY p.created_at DESC
		LIMIT ? OFFSET ?
	`, userID, limit, offset)

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
		var imageURLsJSONStr string
		err := rows.Scan(&product.ID, &slugNull, &product.Title, &product.Description, &priceNull,
			&imageURLsJSONStr, &product.SellerID, &product.Premium, &product.Status,
			&product.AllowBuying, &product.BarterOnly, &product.CreatedAt, &product.UpdatedAt, &product.SellerName)
		if slugNull.Valid {
			product.Slug = slugNull.String
		}
		if err != nil {
			continue
		}
		if priceNull.Valid {
			p := priceNull.Float64
			product.Price = &p
		} else {
			product.Price = nil
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
