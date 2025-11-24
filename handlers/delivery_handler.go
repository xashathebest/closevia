package handlers

import (
	"database/sql"
	"fmt"
	"log"
	"math"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/xashathebest/clovia/database"
	"github.com/xashathebest/clovia/middleware"
	"github.com/xashathebest/clovia/models"
)

type DeliveryHandler struct {
	db *sql.DB
}

func NewDeliveryHandler() *DeliveryHandler {
	return &DeliveryHandler{db: database.DB}
}

// CalculateDistance calculates distance between two GPS coordinates using Haversine formula
func calculateDistance(lat1, lon1, lat2, lon2 float64) float64 {
	const R = 6371 // Earth radius in kilometers
	dLat := (lat2 - lat1) * math.Pi / 180
	dLon := (lon2 - lon1) * math.Pi / 180
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1*math.Pi/180)*math.Cos(lat2*math.Pi/180)*
			math.Sin(dLon/2)*math.Sin(dLon/2)
	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
	return R * c
}

// CalculateETA calculates estimated time of arrival based on distance and delivery type
func calculateETA(distanceKm float64, deliveryType string) time.Time {
	var hours float64
	if deliveryType == "express" {
		// Express: ~1 hour base + distance-based time (assuming 30km/h average)
		hours = 1.0 + (distanceKm / 30.0)
	} else {
		// Standard: 2-4 hours base + distance-based time (assuming 25km/h average for batching)
		hours = 2.0 + (distanceKm / 25.0)
		if hours > 4.0 {
			hours = 4.0 // Cap at 4 hours for standard
		}
	}
	return time.Now().Add(time.Duration(hours * float64(time.Hour)))
}

// CalculateCost calculates delivery cost based on type
func calculateCost(deliveryType string) float64 {
	if deliveryType == "express" {
		return 60.0 // ₱60 for express
	}
	return 30.0 // ₱30 for standard
}

// CheckFragileItems checks if any products in the delivery are fragile
func (h *DeliveryHandler) checkFragileItems(productIDs []int) (bool, error) {
	// Check product descriptions/categories for fragile keywords
	placeholders := ""
	args := []interface{}{}
	for i, id := range productIDs {
		if i > 0 {
			placeholders += ","
		}
		placeholders += "?"
		args = append(args, id)
	}

	query := fmt.Sprintf(`
		SELECT COUNT(*) FROM products 
		WHERE id IN (%s) 
		AND (
			LOWER(description) LIKE '%%fragile%%' OR
			LOWER(description) LIKE '%%breakable%%' OR
			LOWER(description) LIKE '%%glass%%' OR
			LOWER(category) LIKE '%%electronics%%' OR
			LOWER(category) LIKE '%%fragile%%'
		)
	`, placeholders)

	var count int
	err := h.db.QueryRow(query, args...).Scan(&count)
	if err != nil {
		return false, err
	}
	return count > 0, nil
}

// FindNearestRider finds the nearest available rider to pickup location
func (h *DeliveryHandler) findNearestRider(pickupLat, pickupLon *float64, _ string) (*models.Rider, error) {
	if pickupLat == nil || pickupLon == nil {
		// If no GPS, return first available rider
		var rider models.Rider
		err := h.db.QueryRow(`
			SELECT id, user_id, name, vehicle_type, vehicle_plate, phone, rating, is_active, latitude, longitude, created_at, updated_at
			FROM riders
			WHERE is_active = TRUE
			ORDER BY rating DESC, created_at ASC
			LIMIT 1
		`).Scan(&rider.ID, &rider.UserID, &rider.Name, &rider.VehicleType, &rider.VehiclePlate, &rider.Phone, &rider.Rating, &rider.IsActive, &rider.Latitude, &rider.Longitude, &rider.CreatedAt, &rider.UpdatedAt)
		if err != nil {
			return nil, err
		}
		return &rider, nil
	}

	// Find nearest rider using GPS
	rows, err := h.db.Query(`
		SELECT id, user_id, name, vehicle_type, vehicle_plate, phone, rating, is_active, latitude, longitude, created_at, updated_at
		FROM riders
		WHERE is_active = TRUE AND latitude IS NOT NULL AND longitude IS NOT NULL
		ORDER BY rating DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var nearestRider *models.Rider
	minDistance := math.MaxFloat64

	for rows.Next() {
		var rider models.Rider
		err := rows.Scan(&rider.ID, &rider.UserID, &rider.Name, &rider.VehicleType, &rider.VehiclePlate, &rider.Phone, &rider.Rating, &rider.IsActive, &rider.Latitude, &rider.Longitude, &rider.CreatedAt, &rider.UpdatedAt)
		if err != nil {
			continue
		}

		if rider.Latitude != nil && rider.Longitude != nil {
			distance := calculateDistance(*pickupLat, *pickupLon, *rider.Latitude, *rider.Longitude)
			if distance < minDistance {
				minDistance = distance
				nearestRider = &rider
			}
		}
	}

	if nearestRider == nil {
		// Fallback to any availa	le rider
		var rider models.Rider
		err := h.db.QueryRow(`
			SELECT id, user_id, name, vehicle_type, vehicle_plate, phone, rating, is_active, latitude, longitude, created_at, updated_at
			FROM riders
			WHERE is_active = TRUE
			ORDER BY rating DESC, created_at ASC
			LIMIT 1
		`).Scan(&rider.ID, &rider.UserID, &rider.Name, &rider.VehicleType, &rider.VehiclePlate, &rider.Phone, &rider.Rating, &rider.IsActive, &rider.Latitude, &rider.Longitude, &rider.CreatedAt, &rider.UpdatedAt)
		if err != nil {
			return nil, err
		}
		return &rider, nil
	}

	return nearestRider, nil
}

// FindAvailableBatch finds an available batch for standard delivery (up to 5 items)
func (h *DeliveryHandler) findAvailableBatch(_, _ *float64, _ int) (int, error) {
	// Find a pending standard delivery with space for more items
	// For simplicity, we'll create a new batch for each delivery
	// In a production system, you'd implement smart batching logic here
	return 0, nil // Return 0 to indicate new batch
}

// CreateDelivery creates a new delivery request
func (h *DeliveryHandler) CreateDelivery(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}

	var req models.DeliveryRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid request body"})
	}

	// Validate delivery type
	if req.DeliveryType != "standard" && req.DeliveryType != "express" {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid delivery type. Must be 'standard' or 'express'"})
	}

	// Validate item count
	itemCount := len(req.ProductIDs)
	if itemCount == 0 {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "At least one product is required"})
	}

	// Validate batch limits
	if req.DeliveryType == "express" && itemCount > 1 {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Express delivery allows only 1 item per delivery"})
	}
	if req.DeliveryType == "standard" && itemCount > 5 {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Standard delivery allows maximum 5 items per batch"})
	}

	// Validate GPS or manual address
	if req.PickupLatitude == nil || req.PickupLongitude == nil {
		if req.PickupAddress == "" {
			return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Either GPS coordinates or pickup address is required"})
		}
	}
	if req.DeliveryLatitude == nil || req.DeliveryLongitude == nil {
		if req.DeliveryAddress == "" {
			return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Either GPS coordinates or delivery address is required"})
		}
	}

	// Check if products exist and belong to user (or are part of a trade)
	tx, err := h.db.Begin()
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to start transaction"})
	}
	defer tx.Rollback()

	// Verify products exist
	for _, productID := range req.ProductIDs {
		var exists bool
		err := tx.QueryRow("SELECT COUNT(*) > 0 FROM products WHERE id = ?", productID).Scan(&exists)
		if err != nil || !exists {
			return c.Status(404).JSON(models.APIResponse{Success: false, Error: fmt.Sprintf("Product %d not found", productID)})
		}
	}

	// Check for fragile items
	isFragile, err := h.checkFragileItems(req.ProductIDs)
	if err != nil {
		log.Printf("Warning: failed to check fragile items: %v", err)
	}

	// Calculate distance and ETA
	var distanceKm float64
	var estimatedETA *time.Time
	if req.PickupLatitude != nil && req.PickupLongitude != nil && req.DeliveryLatitude != nil && req.DeliveryLongitude != nil {
		distanceKm = calculateDistance(*req.PickupLatitude, *req.PickupLongitude, *req.DeliveryLatitude, *req.DeliveryLongitude)
		eta := calculateETA(distanceKm, req.DeliveryType)
		estimatedETA = &eta
	} else {
		// Use default ETA if no GPS
		eta := calculateETA(10.0, req.DeliveryType) // Assume 10km default
		estimatedETA = &eta
	}

	// Calculate cost
	totalCost := calculateCost(req.DeliveryType)

	// Find nearest rider (will be assigned when claimed)
	var riderID *int
	if req.DeliveryType == "express" {
		// For express, auto-assign nearest rider
		rider, err := h.findNearestRider(req.PickupLatitude, req.PickupLongitude, req.DeliveryType)
		if err == nil && rider != nil {
			riderID = &rider.ID
		}
	}

	// Insert delivery
	result, err := tx.Exec(`
		INSERT INTO deliveries (
			user_id, trade_id, delivery_type, status, rider_id,
			pickup_latitude, pickup_longitude, pickup_address,
			delivery_latitude, delivery_longitude, delivery_address,
			special_instructions, total_cost, estimated_eta, item_count, is_fragile
		) VALUES (?, ?, ?, 'pending', ?,
			?, ?, ?,
			?, ?, ?,
			?, ?, ?, ?, ?
		)
	`, userID, req.TradeID, req.DeliveryType, riderID,
		req.PickupLatitude, req.PickupLongitude, req.PickupAddress,
		req.DeliveryLatitude, req.DeliveryLongitude, req.DeliveryAddress,
		req.SpecialInstructions, totalCost, estimatedETA, itemCount, isFragile)

	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to create delivery"})
	}

	deliveryID64, _ := result.LastInsertId()
	deliveryID := int(deliveryID64)

	// Insert delivery items
	for _, productID := range req.ProductIDs {
		var productName string
		err = tx.QueryRow("SELECT title FROM products WHERE id = ?", productID).Scan(&productName)
		if err != nil {
			return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to get product name"})
		}

		_, err = tx.Exec(`
			INSERT INTO delivery_items (delivery_id, product_id, product_name, is_fragile)
			VALUES (?, ?, ?, ?)
		`, deliveryID, productID, productName, isFragile)
		if err != nil {
			return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to create delivery items"})
		}
	}

	// If express and rider assigned, update status to claimed
	if req.DeliveryType == "express" && riderID != nil {
		now := time.Now()
		_, err = tx.Exec(`
			UPDATE deliveries 
			SET status = 'claimed', claimed_at = ?
			WHERE id = ?
		`, now, deliveryID)
		if err != nil {
			log.Printf("Warning: failed to update delivery status: %v", err)
		}
	}

	if err := tx.Commit(); err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to commit transaction"})
	}

	// Fetch created delivery with full details
	delivery, err := h.getDeliveryByID(deliveryID, userID)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to retrieve created delivery"})
	}

	return c.Status(201).JSON(models.APIResponse{
		Success: true,
		Message: "Delivery request created successfully",
		Data:    delivery,
	})
}

// GetDeliveries gets deliveries for the current user
func (h *DeliveryHandler) GetDeliveries(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}

	status := c.Query("status", "")
	query := `
		SELECT d.id, d.user_id, d.trade_id, d.delivery_type, d.status, d.rider_id,
			d.pickup_latitude, d.pickup_longitude, d.pickup_address,
			d.delivery_latitude, d.delivery_longitude, d.delivery_address,
			d.special_instructions, d.total_cost, d.estimated_eta, d.item_count, d.is_fragile,
			d.claimed_at, d.picked_up_at, d.in_transit_at, d.delivered_at,
			d.created_at, d.updated_at,
			u.name AS user_name
		FROM deliveries d
		JOIN users u ON d.user_id = u.id
		WHERE d.user_id = ?
	`
	args := []interface{}{userID}

	if status != "" {
		query += " AND d.status = ?"
		args = append(args, status)
	}

	query += " ORDER BY d.created_at DESC"

	rows, err := h.db.Query(query, args...)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to fetch deliveries"})
	}
	defer rows.Close()

	deliveries := []models.Delivery{}
	for rows.Next() {
		var d models.Delivery
		err := rows.Scan(
			&d.ID, &d.UserID, &d.TradeID, &d.DeliveryType, &d.Status, &d.RiderID,
			&d.PickupLatitude, &d.PickupLongitude, &d.PickupAddress,
			&d.DeliveryLatitude, &d.DeliveryLongitude, &d.DeliveryAddress,
			&d.SpecialInstructions, &d.TotalCost, &d.EstimatedETA, &d.ItemCount, &d.IsFragile,
			&d.ClaimedAt, &d.PickedUpAt, &d.InTransitAt, &d.DeliveredAt,
			&d.CreatedAt, &d.UpdatedAt,
			&d.UserName,
		)
		if err != nil {
			continue
		}

		// Load rider info if assigned
		if d.RiderID != nil {
			h.loadRiderInfo(&d)
		}

		// Load delivery items
		h.loadDeliveryItems(&d)

		deliveries = append(deliveries, d)
	}

	return c.JSON(models.APIResponse{
		Success: true,
		Data:    deliveries,
	})
}

// GetDelivery gets a specific delivery by ID with full tracking info
func (h *DeliveryHandler) GetDelivery(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}

	deliveryID, err := strconv.Atoi(c.Params("id"))
	if err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid delivery ID"})
	}

	delivery, err := h.getDeliveryByID(deliveryID, userID)
	if err != nil {
		if err == sql.ErrNoRows {
			return c.Status(404).JSON(models.APIResponse{Success: false, Error: "Delivery not found"})
		}
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to fetch delivery"})
	}

	return c.JSON(models.APIResponse{
		Success: true,
		Data:    delivery,
	})
}

// UpdateDeliveryStatus updates delivery status (for riders)
func (h *DeliveryHandler) UpdateDeliveryStatus(c *fiber.Ctx) error {
	riderID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}

	deliveryID, err := strconv.Atoi(c.Params("id"))
	if err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid delivery ID"})
	}

	var update models.DeliveryUpdate
	if err := c.BodyParser(&update); err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid request body"})
	}

	// Verify rider is assigned to this delivery
	var assignedRiderID *int
	err = h.db.QueryRow("SELECT rider_id FROM deliveries WHERE id = ?", deliveryID).Scan(&assignedRiderID)
	if err != nil {
		return c.Status(404).JSON(models.APIResponse{Success: false, Error: "Delivery not found"})
	}

	if assignedRiderID == nil || *assignedRiderID != riderID {
		return c.Status(403).JSON(models.APIResponse{Success: false, Error: "You are not assigned to this delivery"})
	}

	// Update status and timestamps
	now := time.Now()
	updates := []string{}
	args := []interface{}{}

	if update.Status != nil {
		updates = append(updates, "status = ?")
		args = append(args, *update.Status)

		// Set appropriate timestamp based on status
		switch *update.Status {
		case "claimed":
			updates = append(updates, "claimed_at = ?")
			args = append(args, now)
		case "picked_up":
			updates = append(updates, "picked_up_at = ?")
			args = append(args, now)
		case "in_transit":
			updates = append(updates, "in_transit_at = ?")
			args = append(args, now)
		case "delivered":
			updates = append(updates, "delivered_at = ?")
			args = append(args, now)
		}
	}

	if update.Latitude != nil && update.Longitude != nil {
		// Update rider location
		_, err = h.db.Exec(`
			UPDATE riders SET latitude = ?, longitude = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
		`, *update.Latitude, *update.Longitude, riderID)
		if err != nil {
			log.Printf("Warning: failed to update rider location: %v", err)
		}
	}

	if update.EstimatedETA != nil {
		updates = append(updates, "estimated_eta = ?")
		args = append(args, *update.EstimatedETA)
	}

	if len(updates) == 0 {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "No updates provided"})
	}
	updates = append(updates, "updated_at = CURRENT_TIMESTAMP")
	args = append(args, deliveryID)

	query := "UPDATE deliveries SET " + strings.Join(updates, ", ") + " WHERE id = ?"

	_, err = h.db.Exec(query, args...)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to update delivery"})
	}

	// Return updated delivery
	delivery, err := h.getDeliveryByID(deliveryID, 0) // 0 to skip user check
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to retrieve updated delivery"})
	}

	return c.JSON(models.APIResponse{
		Success: true,
		Message: "Delivery status updated successfully",
		Data:    delivery,
	})
}

// AssignRider assigns a rider to a delivery (for standard deliveries or manual assignment)
func (h *DeliveryHandler) AssignRider(c *fiber.Ctx) error {
	deliveryID, err := strconv.Atoi(c.Params("id"))
	if err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid delivery ID"})
	}

	var payload struct {
		RiderID int `json:"rider_id" validate:"required"`
	}
	if err := c.BodyParser(&payload); err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid request body"})
	}

	// Verify delivery exists and is pending
	var status string
	var pickupLat, pickupLon *float64
	err = h.db.QueryRow(`
		SELECT status, pickup_latitude, pickup_longitude 
		FROM deliveries 
		WHERE id = ?
	`, deliveryID).Scan(&status, &pickupLat, &pickupLon)
	if err != nil {
		return c.Status(404).JSON(models.APIResponse{Success: false, Error: "Delivery not found"})
	}

	if status != "pending" {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Delivery is not pending"})
	}

	// Verify rider exists and is active
	var riderActive bool
	err = h.db.QueryRow("SELECT is_active FROM riders WHERE id = ?", payload.RiderID).Scan(&riderActive)
	if err != nil {
		return c.Status(404).JSON(models.APIResponse{Success: false, Error: "Rider not found"})
	}
	if !riderActive {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Rider is not active"})
	}

	// Assign rider
	now := time.Now()
	_, err = h.db.Exec(`
		UPDATE deliveries 
		SET rider_id = ?, status = 'claimed', claimed_at = ?, updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, payload.RiderID, now, deliveryID)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to assign rider"})
	}

	delivery, err := h.getDeliveryByID(deliveryID, 0)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to retrieve delivery"})
	}

	return c.JSON(models.APIResponse{
		Success: true,
		Message: "Rider assigned successfully",
		Data:    delivery,
	})
}

// GetAvailableDeliveries gets pending deliveries available for riders to claim
func (h *DeliveryHandler) GetAvailableDeliveries(c *fiber.Ctx) error {
	riderID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}

	// Verify user is a rider
	var isRider bool
	err := h.db.QueryRow("SELECT COUNT(*) > 0 FROM riders WHERE user_id = ? AND is_active = TRUE", riderID).Scan(&isRider)
	if err != nil || !isRider {
		return c.Status(403).JSON(models.APIResponse{Success: false, Error: "User is not an active rider"})
	}

	// Get pending deliveries (not yet claimed)
	rows, err := h.db.Query(`
		SELECT d.id, d.user_id, d.trade_id, d.delivery_type, d.status, d.rider_id,
			d.pickup_latitude, d.pickup_longitude, d.pickup_address,
			d.delivery_latitude, d.delivery_longitude, d.delivery_address,
			d.special_instructions, d.total_cost, d.estimated_eta, d.item_count, d.is_fragile,
			d.claimed_at, d.picked_up_at, d.in_transit_at, d.delivered_at,
			d.created_at, d.updated_at,
			u.name AS user_name
		FROM deliveries d
		JOIN users u ON d.user_id = u.id
		WHERE d.status = 'pending'
		ORDER BY d.created_at DESC
	`)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to fetch available deliveries"})
	}
	defer rows.Close()

	deliveries := []models.Delivery{}
	for rows.Next() {
		var d models.Delivery
		err := rows.Scan(
			&d.ID, &d.UserID, &d.TradeID, &d.DeliveryType, &d.Status, &d.RiderID,
			&d.PickupLatitude, &d.PickupLongitude, &d.PickupAddress,
			&d.DeliveryLatitude, &d.DeliveryLongitude, &d.DeliveryAddress,
			&d.SpecialInstructions, &d.TotalCost, &d.EstimatedETA, &d.ItemCount, &d.IsFragile,
			&d.ClaimedAt, &d.PickedUpAt, &d.InTransitAt, &d.DeliveredAt,
			&d.CreatedAt, &d.UpdatedAt,
			&d.UserName,
		)
		if err != nil {
			continue
		}

		// Calculate distance if we have GPS coordinates
		if d.PickupLatitude != nil && d.PickupLongitude != nil && d.DeliveryLatitude != nil && d.DeliveryLongitude != nil {
			// Distance calculation would go here if needed
		}

		deliveries = append(deliveries, d)
	}

	return c.JSON(models.APIResponse{
		Success: true,
		Data:    deliveries,
	})
}

// GetRiderDeliveries gets deliveries claimed by the current rider
func (h *DeliveryHandler) GetRiderDeliveries(c *fiber.Ctx) error {
	riderID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}

	// Get rider ID from user ID
	var actualRiderID int
	err := h.db.QueryRow("SELECT id FROM riders WHERE user_id = ?", riderID).Scan(&actualRiderID)
	if err != nil {
		return c.Status(403).JSON(models.APIResponse{Success: false, Error: "User is not a rider"})
	}

	status := c.Query("status", "")
	query := `
		SELECT d.id, d.user_id, d.trade_id, d.delivery_type, d.status, d.rider_id,
			d.pickup_latitude, d.pickup_longitude, d.pickup_address,
			d.delivery_latitude, d.delivery_longitude, d.delivery_address,
			d.special_instructions, d.total_cost, d.estimated_eta, d.item_count, d.is_fragile,
			d.claimed_at, d.picked_up_at, d.in_transit_at, d.delivered_at,
			d.created_at, d.updated_at,
			u.name AS user_name
		FROM deliveries d
		JOIN users u ON d.user_id = u.id
		WHERE d.rider_id = ?
	`
	args := []interface{}{actualRiderID}

	if status != "" {
		query += " AND d.status = ?"
		args = append(args, status)
	}

	query += " ORDER BY d.created_at DESC"

	rows, err := h.db.Query(query, args...)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to fetch rider deliveries"})
	}
	defer rows.Close()

	deliveries := []models.Delivery{}
	for rows.Next() {
		var d models.Delivery
		err := rows.Scan(
			&d.ID, &d.UserID, &d.TradeID, &d.DeliveryType, &d.Status, &d.RiderID,
			&d.PickupLatitude, &d.PickupLongitude, &d.PickupAddress,
			&d.DeliveryLatitude, &d.DeliveryLongitude, &d.DeliveryAddress,
			&d.SpecialInstructions, &d.TotalCost, &d.EstimatedETA, &d.ItemCount, &d.IsFragile,
			&d.ClaimedAt, &d.PickedUpAt, &d.InTransitAt, &d.DeliveredAt,
			&d.CreatedAt, &d.UpdatedAt,
			&d.UserName,
		)
		if err != nil {
			continue
		}

		h.loadRiderInfo(&d)
		h.loadDeliveryItems(&d)

		deliveries = append(deliveries, d)
	}

	return c.JSON(models.APIResponse{
		Success: true,
		Data:    deliveries,
	})
}

// ClaimDelivery allows a rider to claim a pending delivery
func (h *DeliveryHandler) ClaimDelivery(c *fiber.Ctx) error {
	riderID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}

	deliveryID, err := strconv.Atoi(c.Params("id"))
	if err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid delivery ID"})
	}

	// Get rider ID from user ID
	var actualRiderID int
	err = h.db.QueryRow("SELECT id FROM riders WHERE user_id = ? AND is_active = TRUE", riderID).Scan(&actualRiderID)
	if err != nil {
		return c.Status(403).JSON(models.APIResponse{Success: false, Error: "User is not an active rider"})
	}

	// Verify delivery exists and is pending
	var status string
	var deliveryType string
	var itemCount int
	err = h.db.QueryRow(`
		SELECT status, delivery_type, item_count
		FROM deliveries 
		WHERE id = ?
	`, deliveryID).Scan(&status, &deliveryType, &itemCount)
	if err != nil {
		return c.Status(404).JSON(models.APIResponse{Success: false, Error: "Delivery not found"})
	}

	if status != "pending" {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Delivery is not pending"})
	}

	// For standard deliveries, check if rider already has an active batch
	if deliveryType == "standard" {
		var activeCount int
		err = h.db.QueryRow(`
			SELECT COUNT(*) FROM deliveries 
			WHERE rider_id = ? AND status IN ('claimed', 'picked_up', 'in_transit')
			AND delivery_type = 'standard'
		`, actualRiderID).Scan(&activeCount)
		if err != nil {
			return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to check active deliveries"})
		}

		// Check total items in active batches (max 5 for standard)
		var totalItems int
		err = h.db.QueryRow(`
			SELECT COALESCE(SUM(item_count), 0) FROM deliveries 
			WHERE rider_id = ? AND status IN ('claimed', 'picked_up', 'in_transit')
			AND delivery_type = 'standard'
		`, actualRiderID).Scan(&totalItems)
		if err != nil {
			return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to check total items"})
		}

		if totalItems+itemCount > 5 {
			return c.Status(400).JSON(models.APIResponse{
				Success: false,
				Error:   fmt.Sprintf("Cannot add delivery: would exceed 5 item limit (current: %d, adding: %d)", totalItems, itemCount),
			})
		}
	}

	// Claim delivery
	now := time.Now()
	_, err = h.db.Exec(`
		UPDATE deliveries 
		SET rider_id = ?, status = 'claimed', claimed_at = ?, updated_at = CURRENT_TIMESTAMP
		WHERE id = ?
	`, actualRiderID, now, deliveryID)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to claim delivery"})
	}

	delivery, err := h.getDeliveryByID(deliveryID, 0)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to retrieve delivery"})
	}

	return c.JSON(models.APIResponse{
		Success: true,
		Message: "Delivery claimed successfully",
		Data:    delivery,
	})
}

// GetRiderEarnings gets earnings and statistics for a rider
func (h *DeliveryHandler) GetRiderEarnings(c *fiber.Ctx) error {
	riderID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}

	// Get rider ID from user ID
	var actualRiderID int
	err := h.db.QueryRow("SELECT id FROM riders WHERE user_id = ?", riderID).Scan(&actualRiderID)
	if err != nil {
		return c.Status(403).JSON(models.APIResponse{Success: false, Error: "User is not a rider"})
	}

	// Get today's date range
	today := time.Now().Format("2006-01-02")
	startOfDay := today + " 00:00:00"
	endOfDay := today + " 23:59:59"

	// Get today's earnings
	var todayEarnings float64
	var todayCompleted int
	err = h.db.QueryRow(`
		SELECT 
			COALESCE(SUM(total_cost), 0) as earnings,
			COUNT(*) as completed
		FROM deliveries 
		WHERE rider_id = ? 
		AND status = 'delivered'
		AND delivered_at >= ? AND delivered_at <= ?
	`, actualRiderID, startOfDay, endOfDay).Scan(&todayEarnings, &todayCompleted)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to fetch today's earnings"})
	}

	// Get total earnings
	var totalEarnings float64
	var totalCompleted int
	err = h.db.QueryRow(`
		SELECT 
			COALESCE(SUM(total_cost), 0) as earnings,
			COUNT(*) as completed
		FROM deliveries 
		WHERE rider_id = ? 
		AND status = 'delivered'
	`, actualRiderID).Scan(&totalEarnings, &totalCompleted)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to fetch total earnings"})
	}

	// Get recent deliveries for remittance ledger
	rows, err := h.db.Query(`
		SELECT 
			d.id, d.delivery_type, d.total_cost, d.delivered_at,
			u.name AS customer_name
		FROM deliveries d
		JOIN users u ON d.user_id = u.id
		WHERE d.rider_id = ? AND d.status = 'delivered'
		ORDER BY d.delivered_at DESC
		LIMIT 50
	`, actualRiderID)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to fetch earnings data"})
	}
	defer rows.Close()

	type EarningsEntry struct {
		DeliveryID   int       `json:"delivery_id"`
		DeliveryType string    `json:"delivery_type"`
		Amount       float64   `json:"amount"`
		DeliveredAt  time.Time `json:"delivered_at"`
		CustomerName string    `json:"customer_name"`
	}

	ledger := []EarningsEntry{}
	for rows.Next() {
		var entry EarningsEntry
		err := rows.Scan(&entry.DeliveryID, &entry.DeliveryType, &entry.Amount, &entry.DeliveredAt, &entry.CustomerName)
		if err != nil {
			continue
		}
		ledger = append(ledger, entry)
	}

	result := map[string]interface{}{
		"today_earnings":    todayEarnings,
		"today_completed":   todayCompleted,
		"total_earnings":    totalEarnings,
		"total_completed":   totalCompleted,
		"remittance_ledger": ledger,
	}

	return c.JSON(models.APIResponse{
		Success: true,
		Data:    result,
	})
}

// Helper function to get delivery by ID
func (h *DeliveryHandler) getDeliveryByID(deliveryID, userID int) (*models.Delivery, error) {
	var d models.Delivery
	query := `
		SELECT d.id, d.user_id, d.trade_id, d.delivery_type, d.status, d.rider_id,
			d.pickup_latitude, d.pickup_longitude, d.pickup_address,
			d.delivery_latitude, d.delivery_longitude, d.delivery_address,
			d.special_instructions, d.total_cost, d.estimated_eta, d.item_count, d.is_fragile,
			d.claimed_at, d.picked_up_at, d.in_transit_at, d.delivered_at,
			d.created_at, d.updated_at,
			u.name AS user_name
		FROM deliveries d
		JOIN users u ON d.user_id = u.id
		WHERE d.id = ?
	`
	args := []interface{}{deliveryID}

	if userID > 0 {
		query += " AND d.user_id = ?"
		args = append(args, userID)
	}

	err := h.db.QueryRow(query, args...).Scan(
		&d.ID, &d.UserID, &d.TradeID, &d.DeliveryType, &d.Status, &d.RiderID,
		&d.PickupLatitude, &d.PickupLongitude, &d.PickupAddress,
		&d.DeliveryLatitude, &d.DeliveryLongitude, &d.DeliveryAddress,
		&d.SpecialInstructions, &d.TotalCost, &d.EstimatedETA, &d.ItemCount, &d.IsFragile,
		&d.ClaimedAt, &d.PickedUpAt, &d.InTransitAt, &d.DeliveredAt,
		&d.CreatedAt, &d.UpdatedAt,
		&d.UserName,
	)
	if err != nil {
		return nil, err
	}

	// Load rider info if assigned
	if d.RiderID != nil {
		h.loadRiderInfo(&d)
	}

	// Load delivery items
	h.loadDeliveryItems(&d)

	return &d, nil
}

// Helper function to load rider info
func (h *DeliveryHandler) loadRiderInfo(d *models.Delivery) {
	if d.RiderID == nil {
		return
	}

	err := h.db.QueryRow(`
		SELECT name, vehicle_type, rating, latitude, longitude
		FROM riders
		WHERE id = ?
	`, *d.RiderID).Scan(&d.RiderName, &d.RiderVehicle, &d.RiderRating, &d.RiderLatitude, &d.RiderLongitude)
	if err != nil {
		log.Printf("Warning: failed to load rider info: %v", err)
	}
}

// Helper function to load delivery items
func (h *DeliveryHandler) loadDeliveryItems(d *models.Delivery) {
	rows, err := h.db.Query(`
		SELECT id, delivery_id, product_id, product_name, is_fragile, created_at
		FROM delivery_items
		WHERE delivery_id = ?
	`, d.ID)
	if err != nil {
		log.Printf("Warning: failed to load delivery items: %v", err)
		return
	}
	defer rows.Close()

	_ = []models.DeliveryItem{} // Reserved for future use when Delivery model has Items field
	for rows.Next() {
		var item models.DeliveryItem
		err := rows.Scan(&item.ID, &item.DeliveryID, &item.ProductID, &item.ProductName, &item.IsFragile, &item.CreatedAt)
		if err != nil {
			continue
		}
		// Note: Delivery model doesn't have Items field yet, but we scan the data for future use
		_ = item
	}
}
