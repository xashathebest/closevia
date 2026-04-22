package handlers

import (
	"database/sql"
	"strconv"

	"github.com/gofiber/fiber/v2"
	"github.com/xashathebest/clovia/database"
	"github.com/xashathebest/clovia/middleware"
	"github.com/xashathebest/clovia/models"
	"github.com/xashathebest/clovia/services"
)

type AIFeaturesHandler struct {
	db *sql.DB
}

func NewAIFeaturesHandler() *AIFeaturesHandler {
	return &AIFeaturesHandler{
		db: database.DB,
	}
}

// GetProximity calculates and returns the distance between two users or a user and a product
func (h *AIFeaturesHandler) GetProximity(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "Unauthorized"})
	}

	// Get query parameters
	targetType := c.Query("type") // "user" or "product"
	targetIDStr := c.Query("target_id")

	if targetType == "" || targetIDStr == "" {
		return c.Status(400).JSON(models.APIResponse{
			Success: false,
			Error:   "Missing required parameters: type and target_id",
		})
	}

	targetID, err := strconv.Atoi(targetIDStr)
	if err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid target_id"})
	}

	// Get current user's coordinates. Prefer the home address set in Settings
	// (home_latitude / home_longitude) — this is the "locked" base for distance
	// calculations. Fall back to the general latitude/longitude only if the user
	// has not configured a home address.
	var userLat, userLon sql.NullFloat64
	var userHomeLat, userHomeLon sql.NullFloat64
	err = h.db.QueryRow("SELECT latitude, longitude, home_latitude, home_longitude FROM users WHERE id = ?", userID).Scan(&userLat, &userLon, &userHomeLat, &userHomeLon)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to get user location"})
	}

	if userHomeLat.Valid && userHomeLon.Valid {
		userLat = userHomeLat
		userLon = userHomeLon
	}

	if !userLat.Valid || !userLon.Valid {
		return c.JSON(models.APIResponse{
			Success: true,
			Data:    nil,
			Message: "User location not set",
		})
	}

	var distance *services.DistanceResult

	switch targetType {
	case "user":
		// Calculate distance to another user. Prefer their Settings home address
		// when set, fall back to their general latitude/longitude.
		var targetLat, targetLon sql.NullFloat64
		var targetHomeLat, targetHomeLon sql.NullFloat64
		err = h.db.QueryRow("SELECT latitude, longitude, home_latitude, home_longitude FROM users WHERE id = ?", targetID).Scan(&targetLat, &targetLon, &targetHomeLat, &targetHomeLon)
		if err != nil {
			return c.Status(404).JSON(models.APIResponse{Success: false, Error: "Target user not found"})
		}

		if targetHomeLat.Valid && targetHomeLon.Valid {
			targetLat = targetHomeLat
			targetLon = targetHomeLon
		}

		if !targetLat.Valid || !targetLon.Valid {
			return c.JSON(models.APIResponse{
				Success: true,
				Data:    nil,
				Message: "Target user location not set",
			})
		}

		distance, err = services.CalculateDistanceBetweenUsers(
			&userLat.Float64, &userLon.Float64,
			&targetLat.Float64, &targetLon.Float64,
		)
	case "product":
		// ==================== LOCKED: PRODUCT DISTANCE = SELLER DISTANCE ====================
		// CRITICAL: Always use the seller's location (from users table), NEVER the product's stored location
		//
		// WHY THIS IS LOCKED IN:
		// - Products are physical items at the seller's location, not separate locations
		// - Distance badge on product card shows "X away" = distance to seller
		// - Distance shown on product detail page shows "X away" = distance to seller
		// - Must be consistent: ProductCard distance = ProductDetail seller distance
		// - User's home location determines proximity calculation for all their products
		//
		// IF YOU CHANGE THIS: Proximities will diverge again (product vs seller showing different distances)
		// =====================================================================================
		var sellerID int
		var locationType sql.NullString
		var pickupLat, pickupLon sql.NullFloat64
		err = h.db.QueryRow("SELECT seller_id, location_type, pickup_latitude, pickup_longitude FROM products WHERE id = ?", targetID).Scan(&sellerID, &locationType, &pickupLat, &pickupLon)
		if err != nil {
			return c.JSON(models.APIResponse{Success: true, Data: nil, Message: "Product not found"})
		}

		// Get the seller's location (not product-specific coordinates). Prefer
		// the seller's Settings home address when set — same "lock" behavior as
		// the current user above. Falls back to general lat/lon otherwise.
		var productLat, productLon sql.NullFloat64
		var sellerHomeLat, sellerHomeLon sql.NullFloat64
		err = h.db.QueryRow("SELECT latitude, longitude, home_latitude, home_longitude FROM users WHERE id = ?", sellerID).Scan(&productLat, &productLon, &sellerHomeLat, &sellerHomeLon)
		if err != nil {
			return c.JSON(models.APIResponse{Success: true, Data: nil, Message: "Seller not found"})
		}

		if sellerHomeLat.Valid && sellerHomeLon.Valid {
			productLat = sellerHomeLat
			productLon = sellerHomeLon
		}

		if !productLat.Valid || !productLon.Valid {
			if locationType.Valid && locationType.String == "pickup_location" && pickupLat.Valid && pickupLon.Valid {
				productLat = pickupLat
				productLon = pickupLon
			} else {
				return c.JSON(models.APIResponse{
					Success: true,
					Data:    nil,
					Message: "Product location not set",
				})
			}
		}

		distance, err = services.CalculateDistanceToProduct(
			&userLat.Float64, &userLon.Float64,
			&productLat.Float64, &productLon.Float64,
		)
	default:
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid type. Must be 'user' or 'product'"})
	}

	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to calculate distance"})
	}

	return c.JSON(models.APIResponse{
		Success: true,
		Data:    distance,
	})
}

// GetResponseMetrics returns chat response metrics for a user
func (h *AIFeaturesHandler) GetResponseMetrics(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "Unauthorized"})
	}

	// Check if requesting own metrics or another user's
	targetUserIDStr := c.Query("user_id")
	targetUserID := userID

	if targetUserIDStr != "" {
		parsedID, err := strconv.Atoi(targetUserIDStr)
		if err == nil {
			targetUserID = parsedID
		}
		// Note: In production, you might want to restrict viewing other users' metrics
	}

	metrics, err := services.CalculateResponseMetrics(h.db, targetUserID)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to calculate response metrics"})
	}

	return c.JSON(models.APIResponse{
		Success: true,
		Data:    metrics,
	})
}

// GetProfileAnalysis returns profile analysis for a user
func (h *AIFeaturesHandler) GetProfileAnalysis(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "Unauthorized"})
	}

	// Check if requesting own analysis or another user's
	targetUserIDStr := c.Query("user_id")
	targetUserID := userID

	if targetUserIDStr != "" {
		parsedID, err := strconv.Atoi(targetUserIDStr)
		if err == nil {
			targetUserID = parsedID
		}
	}

	analysis, err := services.AnalyzeProfile(h.db, targetUserID)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to analyze profile"})
	}

	return c.JSON(models.APIResponse{
		Success: true,
		Data:    analysis,
	})
}

// AnalyzeAllProfiles analyzes all user profiles (admin only)
func (h *AIFeaturesHandler) AnalyzeAllProfiles(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "Unauthorized"})
	}

	// Check if user is admin
	var role string
	err := h.db.QueryRow("SELECT role FROM users WHERE id = ?", userID).Scan(&role)
	if err != nil || role != "admin" {
		return c.Status(403).JSON(models.APIResponse{Success: false, Error: "Admin access required"})
	}

	summary, err := services.AnalyzeAllProfiles(h.db)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to analyze profiles"})
	}

	return c.JSON(models.APIResponse{
		Success: true,
		Data:    summary,
	})
}

// GetCounterfeitReport returns counterfeit detection report for a product
func (h *AIFeaturesHandler) GetCounterfeitReport(c *fiber.Ctx) error {
	productIDStr := c.Params("id")
	productID, err := strconv.Atoi(productIDStr)
	if err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid product ID"})
	}

	// Get product details
	var title, description string
	var price sql.NullFloat64
	err = h.db.QueryRow("SELECT title, description, price FROM products WHERE id = ?", productID).Scan(&title, &description, &price)
	if err != nil {
		return c.Status(404).JSON(models.APIResponse{Success: false, Error: "Product not found"})
	}

	productPrice := 0.0
	if price.Valid {
		productPrice = price.Float64
	}

	report := services.DetectCounterfeit(title, description, productPrice)

	return c.JSON(models.APIResponse{
		Success: true,
		Data:    report,
	})
}
