package handlers

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"math"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/xashathebest/clovia/database"
	"github.com/xashathebest/clovia/middleware"
	"github.com/xashathebest/clovia/models"
)


func haversine(lat1, lon1, lat2, lon2 float64) float64 {
	const R = 6371.0 // Earth radius in km
	dLat := (lat2 - lat1) * math.Pi / 180.0
	dLon := (lon2 - lon1) * math.Pi / 180.0
	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1*math.Pi/180.0)*math.Cos(lat2*math.Pi/180.0)*
			math.Sin(dLon/2)*math.Sin(dLon/2)
	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))
	return R * c
}

// BackfillLedgers is an HTTP handler that triggers backfilling missing deliveries

func (h *DeliveryHandler) BackfillLedgers(c *fiber.Ctx) error {
	h.BackfillMissingDeliveries()
	return c.JSON(models.APIResponse{Success: true, Message: "Backfill completed (see logs for details)"})
}

type DeliveryHandler struct {
	db *sql.DB
}

const (
	defaultRemittanceTaxPerCollection = 2.0
	defaultRemittanceLockThreshold    = 50.0
)

func (h *DeliveryHandler) getRiderFreeSlotsDefault() int {
	var v string
	if err := h.db.QueryRow("SELECT setting_value FROM app_settings WHERE setting_key = 'rider_free_slots_default'").Scan(&v); err != nil {
		return 3
	}
	parsed, err := strconv.Atoi(strings.TrimSpace(v))
	if err != nil || parsed <= 0 {
		return 3
	}
	return parsed
}

func (h *DeliveryHandler) getRiderRemittanceTaxPerCollection() float64 {
	var v string
	if err := h.db.QueryRow("SELECT setting_value FROM app_settings WHERE setting_key = 'rider_remittance_tax_per_collection'").Scan(&v); err != nil {
		return defaultRemittanceTaxPerCollection
	}
	parsed, err := strconv.ParseFloat(strings.TrimSpace(v), 64)
	if err != nil || parsed <= 0 {
		return defaultRemittanceTaxPerCollection
	}
	return parsed
}

func (h *DeliveryHandler) getRiderRemittanceLockThreshold() float64 {
	var v string
	if err := h.db.QueryRow("SELECT setting_value FROM app_settings WHERE setting_key = 'rider_remittance_lock_threshold'").Scan(&v); err != nil {
		return defaultRemittanceLockThreshold
	}
	parsed, err := strconv.ParseFloat(strings.TrimSpace(v), 64)
	if err != nil || parsed <= 0 {
		return defaultRemittanceLockThreshold
	}
	return parsed
}

func (h *DeliveryHandler) isRiderLockedForRemittance(riderID int) (bool, float64) {
	var isLocked bool
	var remittanceOwed float64
	var freeSlotsRemaining int
	// If there is no ledger row yet, rider isn't locked.
	if err := h.db.QueryRow(
		"SELECT COALESCE(is_locked_for_remittance, FALSE), COALESCE(remittance_owed, 0.00), COALESCE(free_slots_remaining, 0) FROM rider_ledger WHERE rider_id = ?",
		riderID,
	).Scan(&isLocked, &remittanceOwed, &freeSlotsRemaining); err != nil {
		return false, 0
	}
	// Lock is enforced once the rider reaches the remittance threshold.
	if remittanceOwed >= h.getRiderRemittanceLockThreshold() {
		return true, remittanceOwed
	}
	// Keep the flag as an informational field, but don't block below threshold.
	_ = isLocked
	_ = freeSlotsRemaining
	return false, remittanceOwed
}

func NewDeliveryHandler() *DeliveryHandler {
	return &DeliveryHandler{db: database.DB}
}

// BackfillMissingDeliveries creates delivery records for active delivery trades that don't have one.
// Called at server startup to handle trades accepted before auto-creation was deployed.
func (h *DeliveryHandler) BackfillMissingDeliveries() {
	rows, err := h.db.Query(`
		SELECT t.id, t.buyer_id, t.seller_id
		FROM trades t
		WHERE COALESCE(t.trade_option, 'meetup') = 'delivery'
		  AND t.status IN ('active', 'accepted', 'awaiting_confirmation')
		  AND NOT EXISTS (SELECT 1 FROM deliveries d WHERE d.trade_id = t.id)
	`)
	if err != nil {
		log.Printf("BackfillMissingDeliveries: query failed: %v", err)
		return
	}
	defer rows.Close()

	count := 0
	for rows.Next() {
		var tradeID, buyerID, sellerID int
		if err := rows.Scan(&tradeID, &buyerID, &sellerID); err != nil {
			log.Printf("BackfillMissingDeliveries: scan error: %v", err)
			continue
		}
		newID, err := h.autoCreateDeliveryForTrade(tradeID, buyerID, sellerID)
		if err != nil {
			log.Printf("BackfillMissingDeliveries: failed for trade %d: %v", tradeID, err)
			continue
		}
		log.Printf("BackfillMissingDeliveries: created delivery %d for trade %d", newID, tradeID)
		count++
	}
	if count > 0 {
		log.Printf("BackfillMissingDeliveries: created %d missing delivery records", count)
	}
}

// RegisterAsRider allows a user to register themselves as a rider
func (h *DeliveryHandler) RegisterAsRider(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}

	var payload struct {
		VehicleType  string `json:"vehicle_type"`
		VehiclePlate string `json:"vehicle_plate"`
		Phone        string `json:"phone"`
	}
	if err := c.BodyParser(&payload); err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid request body"})
	}

	// Defaults
	if payload.VehicleType == "" {
		payload.VehicleType = "motorcycle"
	}
	if payload.Phone == "" {
		payload.Phone = "N/A"
	}

	// Check if already registered
	var existingID int
	err := h.db.QueryRow("SELECT id FROM riders WHERE user_id = ?", userID).Scan(&existingID)
	if err == nil {
		// Already registered — reactivate if inactive
		_, _ = h.db.Exec("UPDATE riders SET is_active = TRUE, status = 'approved', updated_at = CURRENT_TIMESTAMP WHERE id = ?", existingID)
		return c.JSON(models.APIResponse{Success: true, Data: fiber.Map{"rider_id": existingID, "message": "Rider account reactivated"}})
	}

	// Get user name
	var userName string
	_ = h.db.QueryRow("SELECT name FROM users WHERE id = ?", userID).Scan(&userName)
	if userName == "" {
		userName = fmt.Sprintf("Rider_%d", userID)
	}

	result, err := h.db.Exec(`
		INSERT INTO riders (user_id, name, vehicle_type, vehicle_plate, phone, is_active, status)
		VALUES (?, ?, ?, ?, ?, TRUE, 'approved')`,
		userID, userName, payload.VehicleType, payload.VehiclePlate, payload.Phone,
	)
	if err != nil {
		log.Printf("Failed to register rider for user %d: %v", userID, err)
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to register as rider"})
	}

	riderID, _ := result.LastInsertId()
	log.Printf("User %d registered as rider %d", userID, riderID)

	return c.JSON(models.APIResponse{Success: true, Data: fiber.Map{"rider_id": riderID, "message": "Registered as rider successfully"}})
}

// CheckRiderStatus checks if the current user is a registered rider
func (h *DeliveryHandler) CheckRiderStatus(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}

	var riderID int
	var isActive bool
	var name, vehicleType, phone, status string
	var vehiclePlate, rejectionReason sql.NullString
	var rating float64
	var createdAt string
	var reviewedAt sql.NullString
	err := h.db.QueryRow(
		`SELECT id, is_active, name, vehicle_type, COALESCE(vehicle_plate, ''), phone, rating, created_at,
		 COALESCE(status, 'pending'), COALESCE(rejection_reason, ''), COALESCE(reviewed_at, '')
		 FROM riders WHERE user_id = ?`,
		userID,
	).Scan(&riderID, &isActive, &name, &vehicleType, &vehiclePlate, &phone, &rating, &createdAt,
		&status, &rejectionReason, &reviewedAt)
	if err != nil {
		return c.JSON(models.APIResponse{Success: true, Data: fiber.Map{"is_rider": false}})
	}

	// Count completed deliveries
	var completedCount int
	_ = h.db.QueryRow("SELECT COUNT(*) FROM deliveries WHERE rider_id = ? AND status = 'delivered'", riderID).Scan(&completedCount)

	return c.JSON(models.APIResponse{Success: true, Data: fiber.Map{
		"is_rider":             true,
		"rider_id":             riderID,
		"is_active":            isActive,
		"name":                 name,
		"vehicle_type":         vehicleType,
		"vehicle_plate":        vehiclePlate.String,
		"phone":                phone,
		"rating":               rating,
		"created_at":           createdAt,
		"completed_deliveries": completedCount,
		"status":               status,
		"rejection_reason":     rejectionReason.String,
		"reviewed_at":          reviewedAt.String,
	}})
}

// ApplyAsRider handles the full rider application flow with document uploads
func (h *DeliveryHandler) ApplyAsRider(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}

	// Ensure DB operations cannot hang long enough to trip the frontend timeouts.
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	if err := h.db.PingContext(ctx); err != nil {
		log.Printf("ApplyAsRider: DB unavailable for user %d: %v", userID, err)
		return c.Status(503).JSON(models.APIResponse{Success: false, Error: "Database unavailable. Please try again."})
	}

	var payload struct {
		FullName             string `json:"full_name"`
		ContactNumber        string `json:"contact_number"`
		VehicleType          string `json:"vehicle_type"`
		VehiclePlate         string `json:"vehicle_plate"`
		VehicleColor         string `json:"vehicle_color"`
		LicenseImageURL      string `json:"license_image_url"`
		SelfieImageURL       string `json:"selfie_image_url"`
		OrcrImageURL         string `json:"orcr_image_url"`
		MotorOwnerImageURL   string `json:"motor_owner_image_url"`
	}
	if err := c.BodyParser(&payload); err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid request body"})
	}

	if payload.FullName == "" || payload.ContactNumber == "" || payload.VehicleType == "" || payload.LicenseImageURL == "" || payload.OrcrImageURL == "" || payload.MotorOwnerImageURL == "" {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Full name, contact number, vehicle type, driver's license, OR/CR, and vehicle owner photo are required"})
	}

	// Validate contact number: must be exactly 11 digits
	contactDigits := ""
	for _, r := range payload.ContactNumber {
		if r >= '0' && r <= '9' {
			contactDigits += string(r)
		}
	}
	if len(contactDigits) != 11 {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Contact number must be exactly 11 digits"})
	}
	payload.ContactNumber = contactDigits

	validVehicles := map[string]bool{"motorcycle": true, "bicycle": true, "car": true}
	if !validVehicles[payload.VehicleType] {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Vehicle type must be motorcycle, bicycle, or car"})
	}

	// Check if user already has a rider record
	var existingID int
	var existingStatus string
	err := h.db.QueryRowContext(ctx, "SELECT id, COALESCE(status, 'pending') FROM riders WHERE user_id = ?", userID).Scan(&existingID, &existingStatus)
	if err == nil {
		switch existingStatus {
		case "pending", "under_review":
			return c.Status(400).JSON(models.APIResponse{Success: false, Error: "You already have a pending application"})
		case "approved":
			return c.Status(400).JSON(models.APIResponse{Success: false, Error: "You are already an approved rider"})
		case "rejected":
			// Allow resubmission
			_, err = h.db.ExecContext(ctx, `UPDATE riders SET full_name=?, contact_number=?, vehicle_type=?, vehicle_plate=?, vehicle_color=?,
				license_image_url=?, selfie_image_url=?, orcr_image_url=?, motor_owner_image_url=?, status='pending', rejection_reason=NULL,
				reviewed_at=NULL, reviewed_by=NULL, name=?, updated_at=CURRENT_TIMESTAMP
				WHERE id=?`,
				payload.FullName, payload.ContactNumber, payload.VehicleType, payload.VehiclePlate, payload.VehicleColor,
				payload.LicenseImageURL, payload.SelfieImageURL, payload.OrcrImageURL, payload.MotorOwnerImageURL, payload.FullName, existingID)
			if err != nil {
				log.Printf("Failed to resubmit rider application for user %d: %v", userID, err)
				return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to resubmit application"})
			}
			// Notify admins
			h.notifyAdmins(fmt.Sprintf("Rider application resubmitted by %s", payload.FullName), "rider_application")
			return c.JSON(models.APIResponse{Success: true, Data: fiber.Map{"rider_id": existingID, "message": "Application resubmitted successfully"}})
		}
	}

	// Get user name as fallback
	name := payload.FullName

	result, err := h.db.ExecContext(ctx, `INSERT INTO riders (user_id, name, vehicle_type, vehicle_plate, vehicle_color, phone, is_active, status,
		full_name, contact_number, license_image_url, selfie_image_url, orcr_image_url, motor_owner_image_url)
		VALUES (?, ?, ?, ?, ?, ?, FALSE, 'pending', ?, ?, ?, ?, ?, ?)`,
		userID, name, payload.VehicleType, payload.VehiclePlate, payload.VehicleColor, payload.ContactNumber,
		payload.FullName, payload.ContactNumber, payload.LicenseImageURL, payload.SelfieImageURL, payload.OrcrImageURL, payload.MotorOwnerImageURL)
	if err != nil {
		log.Printf("Failed to create rider application for user %d: %v", userID, err)
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to submit application"})
	}

	riderID, _ := result.LastInsertId()
	log.Printf("User %d submitted rider application %d", userID, riderID)

	// Notify admins
	h.notifyAdmins(fmt.Sprintf("New rider application from %s", payload.FullName), "rider_application")

	return c.JSON(models.APIResponse{Success: true, Data: fiber.Map{"rider_id": riderID, "message": "Application submitted successfully"}})
}

// GetRiderApplication returns the current user's rider application details
func (h *DeliveryHandler) GetRiderApplication(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}

	var riderID int
	var name, vehicleType, phone, status string
	var vehiclePlate, fullName, contactNumber, licenseImageURL, selfieImageURL, rejectionReason, reviewedAt sql.NullString
	var rating float64
	var isActive bool
	var createdAt string

	err := h.db.QueryRow(`SELECT id, name, vehicle_type, COALESCE(vehicle_plate,''), phone, rating, is_active,
		COALESCE(status,'pending'), COALESCE(full_name,''), COALESCE(contact_number,''),
		COALESCE(license_image_url,''), COALESCE(selfie_image_url,''),
		COALESCE(rejection_reason,''), COALESCE(reviewed_at,''), created_at
		FROM riders WHERE user_id = ?`, userID).Scan(
		&riderID, &name, &vehicleType, &vehiclePlate, &phone, &rating, &isActive,
		&status, &fullName, &contactNumber, &licenseImageURL, &selfieImageURL,
		&rejectionReason, &reviewedAt, &createdAt)

	if err != nil {
		return c.JSON(models.APIResponse{Success: true, Data: fiber.Map{"has_applied": false}})
	}

	return c.JSON(models.APIResponse{Success: true, Data: fiber.Map{
		"has_applied":       true,
		"rider_id":          riderID,
		"name":              name,
		"vehicle_type":      vehicleType,
		"vehicle_plate":     vehiclePlate.String,
		"phone":             phone,
		"rating":            rating,
		"is_active":         isActive,
		"status":            status,
		"full_name":         fullName.String,
		"contact_number":    contactNumber.String,
		"license_image_url": licenseImageURL.String,
		"selfie_image_url":  selfieImageURL.String,
		"rejection_reason":  rejectionReason.String,
		"reviewed_at":       reviewedAt.String,
		"created_at":        createdAt,
	}})
}

// ─────────────────────────────────────────────────────────────────────────────
// RIDER STATE ENGINE
// ─────────────────────────────────────────────────────────────────────────────
// States: NOT_APPLIED, PENDING_APPROVAL, REJECTED, READY, WORKING, LOCKED
// This is the single source of truth for what a rider can see and do.

// GetRiderState returns the current rider's state and relevant data.
// Every screen in the rider app should call this first before rendering.
func (h *DeliveryHandler) GetRiderState(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}

	// Check if user has a rider record
	var riderID int
	var status, fullName, rejectionReason string
	var isActive, firstLoginCompleted bool
	var freeDeliverySlots int
	var completedDeliveries int
	var rating float64

	err := h.db.QueryRow(`
		SELECT id, COALESCE(status,'pending'), COALESCE(full_name,''),
		       COALESCE(rejection_reason,''), is_active,
		       COALESCE(first_login_completed, FALSE),
			       COALESCE(free_delivery_slots, 3),
		       COALESCE((SELECT COUNT(*) FROM deliveries WHERE rider_id = riders.id AND status = 'delivered'), 0),
		       rating
		FROM riders WHERE user_id = ?`, userID).Scan(
		&riderID, &status, &fullName, &rejectionReason, &isActive,
		&firstLoginCompleted, &freeDeliverySlots, &completedDeliveries, &rating)

	if err != nil {
		// No rider record - user hasn't applied
		return c.JSON(models.APIResponse{Success: true, Data: fiber.Map{
			"state":       "NOT_APPLIED",
			"can_apply":   true,
			"message":     "You haven't applied as a rider yet.",
			"permissions": fiber.Map{"can_view_jobs": false, "can_claim_jobs": false, "can_view_earnings": false},
		}})
	}

	// Determine state based on database values
	var state string
	var message string
	var canViewJobs, canClaimJobs, canViewEarnings bool
	var remittanceDue float64
	var lockedForRemittance bool

	// Sync rider slots view from ledger (single source of truth)
	// so the rider sees the correct remaining free slots.
	h.ensureRiderLedger(riderID)
	_ = h.db.QueryRow("SELECT free_slots_remaining FROM rider_ledger WHERE rider_id = ?", riderID).Scan(&freeDeliverySlots)
	lockedForRemittance, remittanceDue = h.isRiderLockedForRemittance(riderID)

	switch status {
	case "pending", "under_review":
		state = "PENDING_APPROVAL"
		message = "We are reviewing your documents. This usually takes 24-48 hours."
		canViewJobs = false
		canClaimJobs = false
		canViewEarnings = false

	case "rejected":
		state = "REJECTED"
		message = fmt.Sprintf("Your application was not approved. Reason: %s", rejectionReason)
		canViewJobs = false
		canClaimJobs = false
		canViewEarnings = false

	case "approved":
		if lockedForRemittance {
			state = "LOCKED"
			message = fmt.Sprintf("You have ₱%.2f remittance due. Pay now to unlock your next job.", remittanceDue)
			canViewJobs = false
			canClaimJobs = false
			canViewEarnings = true
		} else if !isActive {
			// Account is suspended (non-remittance)
			state = "LOCKED"
			message = "Your rider account has been suspended. Please contact support."
			canViewJobs = false
			canClaimJobs = false
			canViewEarnings = true // Can still view past earnings
		} else {
			// Check if rider has active deliveries
			var activeDeliveryCount int
			h.db.QueryRow("SELECT COUNT(*) FROM deliveries WHERE rider_id = ? AND status IN ('claimed', 'picked_up', 'in_transit')", riderID).Scan(&activeDeliveryCount)

			if activeDeliveryCount > 0 {
				state = "WORKING"
				message = fmt.Sprintf("You have %d active delivery(s) in progress.", activeDeliveryCount)
			} else {
				state = "READY"
				message = "You're ready to claim deliveries!"
			}
			canViewJobs = true
			canClaimJobs = true
			canViewEarnings = true
		}

	default:
		state = "PENDING_APPROVAL"
		message = "We are reviewing your application."
		canViewJobs = false
		canClaimJobs = false
		canViewEarnings = false
	}

	// Check if this is first login after approval (for welcome screen)
	showWelcome := false
	if state == "READY" && !firstLoginCompleted {
		showWelcome = true
	}

	return c.JSON(models.APIResponse{Success: true, Data: fiber.Map{
		"state":                    state,
		"rider_id":                 riderID,
		"full_name":                fullName,
		"message":                  message,
		"rejection_reason":         rejectionReason,
		"show_welcome":             showWelcome,
		"free_delivery_slots":      freeDeliverySlots,
		"remittance_due":           remittanceDue,
		"is_locked_for_remittance": lockedForRemittance,
		"completed_deliveries":     completedDeliveries,
		"rating":                   rating,
		"first_login_completed":    firstLoginCompleted,
		"permissions": fiber.Map{
			"can_view_jobs":     canViewJobs,
			"can_claim_jobs":    canClaimJobs,
			"can_view_earnings": canViewEarnings,
		},
	}})
}

// MarkRiderFirstLoginComplete marks the rider's first login as completed
func (h *DeliveryHandler) MarkRiderFirstLoginComplete(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}

	_, err := h.db.Exec("UPDATE riders SET first_login_completed = TRUE, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?", userID)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to update first login status"})
	}

	return c.JSON(models.APIResponse{Success: true, Data: fiber.Map{"message": "First login marked complete"}})
}

// AdminListRiderApplications lists rider applications with optional status filter and search
func (h *DeliveryHandler) AdminListRiderApplications(c *fiber.Ctx) error {
	statusFilter := c.Query("status", "")
	search := c.Query("search", "")

	query := `SELECT r.id, r.user_id, r.name, r.vehicle_type, COALESCE(r.vehicle_plate,''),
		r.phone, r.rating, r.is_active, COALESCE(r.status,'pending'),
		COALESCE(r.full_name,''), COALESCE(r.contact_number,''),
		COALESCE(r.license_image_url,''), COALESCE(r.selfie_image_url,''),
		COALESCE(r.orcr_image_url,''), COALESCE(r.motor_owner_image_url,''),
		COALESCE(r.vehicle_color,''),
		COALESCE(r.rejection_reason,''), COALESCE(r.reviewed_at,''),
		r.created_at, u.email, COALESCE(u.profile_picture,'')
		FROM riders r JOIN users u ON r.user_id = u.id WHERE 1=1`

	args := []interface{}{}

	if statusFilter != "" {
		query += " AND r.status = ?"
		args = append(args, statusFilter)
	}
	if search != "" {
		query += " AND (r.full_name LIKE ? OR r.name LIKE ? OR u.email LIKE ?)"
		searchTerm := "%" + search + "%"
		args = append(args, searchTerm, searchTerm, searchTerm)
	}

	query += " ORDER BY r.created_at DESC LIMIT 100"

	rows, err := h.db.Query(query, args...)
	if err != nil {
		log.Printf("Failed to list rider applications: %v", err)
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to list rider applications"})
	}
	defer rows.Close()

	var applications []fiber.Map
	for rows.Next() {
		var id, userID int
		var name, vehicleType, phone, status, createdAt, email string
		var vehiclePlate, fullName, contactNumber, licenseImageURL, selfieImageURL, orcrImageURL, motorOwnerImageURL, vehicleColor, rejectionReason, reviewedAt, profilePicture sql.NullString
		var rating float64
		var isActive bool

		if err := rows.Scan(&id, &userID, &name, &vehicleType, &vehiclePlate, &phone, &rating, &isActive,
			&status, &fullName, &contactNumber, &licenseImageURL, &selfieImageURL,
			&orcrImageURL, &motorOwnerImageURL, &vehicleColor,
			&rejectionReason, &reviewedAt, &createdAt, &email, &profilePicture); err != nil {
			continue
		}

		applications = append(applications, fiber.Map{
			"id":                    id,
			"user_id":               userID,
			"name":                  name,
			"vehicle_type":          vehicleType,
			"vehicle_plate":         vehiclePlate.String,
			"vehicle_color":         vehicleColor.String,
			"phone":                 phone,
			"rating":                rating,
			"is_active":             isActive,
			"status":                status,
			"full_name":             fullName.String,
			"contact_number":        contactNumber.String,
			"license_image_url":     licenseImageURL.String,
			"selfie_image_url":      selfieImageURL.String,
			"orcr_image_url":        orcrImageURL.String,
			"motor_owner_image_url": motorOwnerImageURL.String,
			"rejection_reason":      rejectionReason.String,
			"reviewed_at":           reviewedAt.String,
			"created_at":            createdAt,
			"email":                 email,
			"profile_picture":       profilePicture.String,
		})
	}

	if applications == nil {
		applications = []fiber.Map{}
	}

	return c.JSON(models.APIResponse{Success: true, Data: applications})
}

// AdminGetRiderApplication returns a single rider application by ID
func (h *DeliveryHandler) AdminGetRiderApplication(c *fiber.Ctx) error {
	riderID, err := strconv.Atoi(c.Params("id"))
	if err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid rider ID"})
	}

	var id, userID int
	var name, vehicleType, phone, status, createdAt, email string
	var vehiclePlate, fullName, contactNumber, licenseImageURL, selfieImageURL, orcrImageURL, motorOwnerImageURL, vehicleColor, rejectionReason, reviewedAt, profilePicture sql.NullString
	var rating float64
	var isActive bool

	err = h.db.QueryRow(`SELECT r.id, r.user_id, r.name, r.vehicle_type, COALESCE(r.vehicle_plate,''),
		r.phone, r.rating, r.is_active, COALESCE(r.status,'pending'),
		COALESCE(r.full_name,''), COALESCE(r.contact_number,''),
		COALESCE(r.license_image_url,''), COALESCE(r.selfie_image_url,''),
		COALESCE(r.orcr_image_url,''), COALESCE(r.motor_owner_image_url,''),
		COALESCE(r.vehicle_color,''),
		COALESCE(r.rejection_reason,''), COALESCE(r.reviewed_at,''),
		r.created_at, u.email, COALESCE(u.profile_picture,'')
		FROM riders r JOIN users u ON r.user_id = u.id WHERE r.id = ?`, riderID).Scan(
		&id, &userID, &name, &vehicleType, &vehiclePlate, &phone, &rating, &isActive,
		&status, &fullName, &contactNumber, &licenseImageURL, &selfieImageURL,
		&orcrImageURL, &motorOwnerImageURL, &vehicleColor,
		&rejectionReason, &reviewedAt, &createdAt, &email, &profilePicture)

	if err != nil {
		return c.Status(404).JSON(models.APIResponse{Success: false, Error: "Rider application not found"})
	}

	return c.JSON(models.APIResponse{Success: true, Data: fiber.Map{
		"id":                    id,
		"user_id":               userID,
		"name":                  name,
		"vehicle_type":          vehicleType,
		"vehicle_plate":         vehiclePlate.String,
		"vehicle_color":         vehicleColor.String,
		"phone":                 phone,
		"rating":                rating,
		"is_active":             isActive,
		"status":                status,
		"full_name":             fullName.String,
		"contact_number":        contactNumber.String,
		"license_image_url":     licenseImageURL.String,
		"selfie_image_url":      selfieImageURL.String,
		"orcr_image_url":        orcrImageURL.String,
		"motor_owner_image_url": motorOwnerImageURL.String,
		"rejection_reason":      rejectionReason.String,
		"reviewed_at":           reviewedAt.String,
		"created_at":            createdAt,
		"email":                 email,
		"profile_picture":       profilePicture.String,
	}})
}

// AdminApproveRider approves a rider application
func (h *DeliveryHandler) AdminApproveRider(c *fiber.Ctx) error {
	riderID, err := strconv.Atoi(c.Params("id"))
	if err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid rider ID"})
	}
	adminID, _ := middleware.GetUserIDFromContext(c)

	res, err := h.db.Exec(`UPDATE riders SET status='approved', is_active=TRUE, reviewed_at=CURRENT_TIMESTAMP,
		reviewed_by=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('pending','under_review')`,
		adminID, riderID)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to approve rider"})
	}

	affected, _ := res.RowsAffected()
	if affected == 0 {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Rider not found or already processed"})
	}

	// Notify the applicant
	var applicantUserID int
	h.db.QueryRow("SELECT user_id FROM riders WHERE id = ?", riderID).Scan(&applicantUserID)
	if applicantUserID > 0 {
		h.db.Exec("INSERT INTO notifications (user_id, type, message) VALUES (?, 'rider_application', 'Your rider application has been approved! You can now claim deliveries.')",
			applicantUserID)
	}

	log.Printf("Admin %d approved rider application %d", adminID, riderID)
	return c.JSON(models.APIResponse{Success: true, Data: fiber.Map{"message": "Rider application approved"}})
}

// AdminRejectRider rejects a rider application with a reason
func (h *DeliveryHandler) AdminRejectRider(c *fiber.Ctx) error {
	riderID, err := strconv.Atoi(c.Params("id"))
	if err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid rider ID"})
	}
	adminID, _ := middleware.GetUserIDFromContext(c)

	var payload struct {
		Reason string `json:"reason"`
	}
	if err := c.BodyParser(&payload); err != nil || payload.Reason == "" {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Rejection reason is required"})
	}

	res, err := h.db.Exec(`UPDATE riders SET status='rejected', rejection_reason=?, reviewed_at=CURRENT_TIMESTAMP,
		reviewed_by=?, is_active=FALSE, updated_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('pending','under_review')`,
		payload.Reason, adminID, riderID)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to reject rider"})
	}

	affected, _ := res.RowsAffected()
	if affected == 0 {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Rider not found or already processed"})
	}

	// Notify the applicant
	var applicantUserID int
	h.db.QueryRow("SELECT user_id FROM riders WHERE id = ?", riderID).Scan(&applicantUserID)
	if applicantUserID > 0 {
		msg := fmt.Sprintf("Your rider application was not approved. Reason: %s", payload.Reason)
		h.db.Exec("INSERT INTO notifications (user_id, type, message) VALUES (?, 'rider_application', ?)",
			applicantUserID, msg)
	}

	log.Printf("Admin %d rejected rider application %d: %s", adminID, riderID, payload.Reason)
	return c.JSON(models.APIResponse{Success: true, Data: fiber.Map{"message": "Rider application rejected"}})
}

// AdminMarkUnderReview marks a rider application as under review
func (h *DeliveryHandler) AdminMarkUnderReview(c *fiber.Ctx) error {
	riderID, err := strconv.Atoi(c.Params("id"))
	if err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid rider ID"})
	}
	adminID, _ := middleware.GetUserIDFromContext(c)

	res, err := h.db.Exec(`UPDATE riders SET status='under_review', reviewed_at=CURRENT_TIMESTAMP,
		reviewed_by=?, updated_at=CURRENT_TIMESTAMP WHERE id=? AND status='pending'`,
		adminID, riderID)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to update rider status"})
	}

	affected, _ := res.RowsAffected()
	if affected == 0 {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Rider not found or not in pending status"})
	}

	// Notify the applicant
	var applicantUserID int
	h.db.QueryRow("SELECT user_id FROM riders WHERE id = ?", riderID).Scan(&applicantUserID)
	if applicantUserID > 0 {
		h.db.Exec("INSERT INTO notifications (user_id, type, message) VALUES (?, 'rider_application', 'Your rider application is now under review.')",
			applicantUserID)
	}

	log.Printf("Admin %d marked rider application %d as under review", adminID, riderID)
	return c.JSON(models.APIResponse{Success: true, Data: fiber.Map{"message": "Rider application marked as under review"}})
}

// notifyAdmins sends a notification to all admin users
func (h *DeliveryHandler) notifyAdmins(message string, notifType string) {
	rows, err := h.db.Query("SELECT id FROM users WHERE role = 'admin'")
	if err != nil {
		return
	}
	defer rows.Close()
	for rows.Next() {
		var adminID int
		if rows.Scan(&adminID) == nil {
			h.db.Exec("INSERT INTO notifications (user_id, type, message) VALUES (?, ?, ?)", adminID, notifType, message)
		}
	}
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

// CalculateCost calculates delivery cost based on type and user tier
func calculateCost(deliveryType string, tier string) float64 {
	baseCost := 30.0
	if deliveryType == "express" {
		baseCost = 60.0
	}

	discount := 1.0
	switch tier {
	case "plus":
		discount = 0.9 // 10% off
	case "pro":
		discount = 0.8 // 20% off
	}

	return baseCost * discount
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
func (h *DeliveryHandler) findNearestRider(pickupLat, pickupLon *float64) (*models.Rider, error) {
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
		// Fallback to any available rider
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

	// Fetch user tier
	var tier string
	h.db.QueryRow("SELECT COALESCE(premium_tier, 'free') FROM users WHERE id = ?", userID).Scan(&tier)

	// Validate delivery type and access
	if req.DeliveryType != "standard" && req.DeliveryType != "express" {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid delivery type. Must be 'standard' or 'express'"})
	}

	if req.DeliveryType == "express" && tier == "free" {
		return c.Status(403).JSON(models.APIResponse{Success: false, Error: "Express delivery is only available for Plus and Pro members."})
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

	// When this delivery is tied to a trade, enforce buyout-only eligibility.
	if req.TradeID != nil && *req.TradeID > 0 {
		if err := validateBuyoutDeliveryEligibility(h.db, *req.TradeID); err != nil {
			return c.Status(422).JSON(models.APIResponse{
				Success: false,
				Error:   "Delivery is only available for buyout orders. " + err.Error(),
			})
		}
		if _, _, err := validateTradeParticipant(h.db, *req.TradeID, userID); err != nil {
			return c.Status(403).JSON(models.APIResponse{Success: false, Error: "Not authorized for this trade"})
		}
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
	totalCost := calculateCost(req.DeliveryType, tier)

	// Find nearest rider (will be assigned when claimed)
	var riderID *int
	if req.DeliveryType == "express" {
		// For express, auto-assign nearest rider
		rider, err := h.findNearestRider(req.PickupLatitude, req.PickupLongitude)
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
		tx.QueryRow("SELECT title FROM products WHERE id = ?", productID).Scan(&productName)

		_, err := tx.Exec(`
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
			COALESCE(d.special_instructions, ''), d.total_cost, d.estimated_eta, d.item_count, d.is_fragile,
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
// PHASE 3 - Task 15: Server-side step lock enforcement
func (h *DeliveryHandler) UpdateDeliveryStatus(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
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

	// Look up rider record for this user
	var riderID int
	err = h.db.QueryRow("SELECT id FROM riders WHERE user_id = ? AND is_active = TRUE", userID).Scan(&riderID)
	if err != nil {
		return c.Status(403).JSON(models.APIResponse{Success: false, Error: "You are not registered as an active rider"})
	}

	// Verify rider is assigned to this delivery and get current state
	var assignedRiderID *int
	var currentStatus, deliveryType string
	var qrVerified, photoUploaded bool
	err = h.db.QueryRow(`
		SELECT rider_id, status, delivery_type,
		       COALESCE(qr_verified, FALSE), COALESCE(photo_uploaded, FALSE)
		FROM deliveries WHERE id = ?`, deliveryID).Scan(
		&assignedRiderID, &currentStatus, &deliveryType, &qrVerified, &photoUploaded)
	if err != nil {
		return c.Status(404).JSON(models.APIResponse{Success: false, Error: "Delivery not found"})
	}

	if assignedRiderID == nil || *assignedRiderID != riderID {
		return c.Status(403).JSON(models.APIResponse{Success: false, Error: "You are not assigned to this delivery"})
	}

	// ─────────────────────────────────────────────────────────────────────────
	// TASK 15: STEP LOCK ENFORCEMENT (Server-side)
	// A rider cannot skip any step. Each step only becomes active after the
	// previous step is confirmed by the backend. Do not trust the app.
	// ─────────────────────────────────────────────────────────────────────────
	if update.Status != nil {
		requestedStatus := *update.Status

		// Define valid status progression
		validTransitions := map[string]string{
			"claimed":    "picked_up",
			"picked_up":  "in_transit",
			"in_transit": "delivered",
		}

		expectedNext, exists := validTransitions[currentStatus]
		if !exists && requestedStatus != "cancelled" {
			return c.Status(400).JSON(models.APIResponse{
				Success: false,
				Error:   fmt.Sprintf("Cannot update status from '%s'", currentStatus),
			})
		}

		if requestedStatus != expectedNext && requestedStatus != "cancelled" {
			return c.Status(400).JSON(models.APIResponse{
				Success: false,
				Error: fmt.Sprintf("Step lock violation: must progress from '%s' to '%s', not '%s'",
					currentStatus, expectedNext, requestedStatus),
			})
		}

		// ─────────────────────────────────────────────────────────────────────
		// TASK 16: PHOTO PROOF ENFORCEMENT
		// Every delivery step requires a photo before completion
		// ─────────────────────────────────────────────────────────────────────
		if requestedStatus == "delivered" {
			// Check if photo was provided in this request or already uploaded
			if update.PhotoURL == nil || *update.PhotoURL == "" {
				if !photoUploaded {
					return c.Status(400).JSON(models.APIResponse{
						Success: false,
						Error:   "Photo proof is required to complete delivery. Please upload a delivery photo.",
					})
				}
			}
		}

		// For pickup step, QR verification is recommended but not strictly required
		// For delivery step, either QR or notes should be provided (enforced above via photo)
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

	// Handle QR verification
	if update.QRCode != nil && *update.QRCode != "" {
		updates = append(updates, "qr_verified = TRUE")
		updates = append(updates, "qr_code = ?")
		args = append(args, *update.QRCode)
	}

	// Handle photo upload
	if update.PhotoURL != nil && *update.PhotoURL != "" {
		updates = append(updates, "photo_uploaded = TRUE")
		updates = append(updates, "delivery_photo_url = ?")
		args = append(args, *update.PhotoURL)
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

	query := "UPDATE deliveries SET " + updates[0]
	for i := 1; i < len(updates); i++ {
		query += ", " + updates[i]
	}
	query += " WHERE id = ?"

	_, err = h.db.Exec(query, args...)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to update delivery"})
	}

	// Keep rider remittance ledger aligned with the rider's actual job flow.
	// If delivery stops exist, fee collection is handled via stop updates.
	if update.Status != nil {
		var stopCount int
		_ = h.db.QueryRow("SELECT COUNT(*) FROM delivery_stops WHERE delivery_id = ?", deliveryID).Scan(&stopCount)
		if stopCount == 0 {
			switch *update.Status {
			case "picked_up", "delivered":
				// Ensure ledger exists
				h.ensureRiderLedger(riderID)

				// Ensure delivery_stops exist (older deliveries may not have them)
				if err := h.ensureDeliveryStops(deliveryID); err != nil {
					log.Printf("Warning: failed to ensure delivery stops for delivery %d: %v", deliveryID, err)
					break
				}

				// Compute the 50/50 fee split (pickup + drop)
				var totalCost float64
				if err := h.db.QueryRow("SELECT total_cost FROM deliveries WHERE id = ?", deliveryID).Scan(&totalCost); err != nil {
					log.Printf("Warning: failed to load total_cost for delivery %d: %v", deliveryID, err)
					break
				}
				feeAmount := totalCost * 0.5

				stopNumber := 1
				collectionType := "pickup_fee"
				if *update.Status == "delivered" {
					stopNumber = 2
					collectionType = "delivery_fee"
				}

				h.logCashCollectionAndUpdateLedger(riderID, deliveryID, stopNumber, collectionType, feeAmount)
			}
		}
	}

	// If delivery is marked as "delivered", sync status back to the linked trade
	if update.Status != nil && *update.Status == "delivered" {
		var tradeID sql.NullInt64
		_ = h.db.QueryRow("SELECT trade_id FROM deliveries WHERE id = ?", deliveryID).Scan(&tradeID)
		if tradeID.Valid {
			// Only sync once ALL delivery legs for this trade are delivered.
			var remaining int
			_ = h.db.QueryRow(
				"SELECT COUNT(*) FROM deliveries WHERE trade_id = ? AND status <> 'delivered'",
				tradeID.Int64,
			).Scan(&remaining)
			if remaining > 0 {
				log.Printf("Trade %d still has %d undelivered leg(s); skipping trade completion sync", tradeID.Int64, remaining)
			} else {
				log.Printf("All delivery legs delivered; syncing completion to trade %d", tradeID.Int64)

				// Rider confirms their side of the delivery — seller's agent confirming dispatch.
				// Buyer receipt and payment confirmations remain separate authenticated actions.
				_, syncErr := h.db.Exec(`
					UPDATE trades
					SET seller_confirmed_delivery = TRUE,
						updated_at = CURRENT_TIMESTAMP
					WHERE id = ?`, tradeID.Int64)
				if syncErr != nil {
					log.Printf("Warning: failed to sync delivery status to trade %d: %v", tradeID.Int64, syncErr)
				}

				// Notify trade parties
				var buyerID, sellerID int
				_ = h.db.QueryRow("SELECT buyer_id, seller_id FROM trades WHERE id = ?", tradeID.Int64).Scan(&buyerID, &sellerID)

				_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'delivery_update', ?, FALSE)",
					buyerID, "Your delivery has arrived! Please confirm receipt in the app.")
				_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'delivery_update', ?, FALSE)",
					sellerID, "The rider has confirmed delivery. Waiting for buyer to confirm receipt.")

				log.Printf("Trade %d updated: delivery confirmed by rider", tradeID.Int64)
			}
		}
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

// ensureDeliveryStops creates a default 2-stop route if stops are missing.
// This keeps legacy deliveries compatible with collection/remittance tracking.
func (h *DeliveryHandler) ensureDeliveryStops(deliveryID int) error {
	var count int
	h.db.QueryRow("SELECT COUNT(*) FROM delivery_stops WHERE delivery_id = ?", deliveryID).Scan(&count)
	if count > 0 {
		return nil
	}

	var deliveryUserID int
	var tradeID sql.NullInt64
	var pickupAddr, deliveryAddr string
	var pickupLat, pickupLng, deliveryLat, deliveryLng sql.NullFloat64
	var totalCost float64
	if err := h.db.QueryRow(`
		SELECT user_id, trade_id, pickup_address, delivery_address,
		       pickup_latitude, pickup_longitude, delivery_latitude, delivery_longitude, total_cost
		FROM deliveries WHERE id = ?`, deliveryID).Scan(
		&deliveryUserID, &tradeID, &pickupAddr, &deliveryAddr,
		&pickupLat, &pickupLng, &deliveryLat, &deliveryLng, &totalCost,
	); err != nil {
		return err
	}

	// Sender (delivery creator)
	senderName := "Sender"
	senderPhone := ""
	_ = h.db.QueryRow("SELECT name, COALESCE(phone, '') FROM users WHERE id = ?", deliveryUserID).Scan(&senderName, &senderPhone)

	// Receiver (other trade party when trade-based)
	receiverName := "Receiver"
	receiverPhone := ""
	var buyerID, sellerID int
	var offeredCash float64
	var buyerItemCount int
	isBuyoutDelivery := false
	if tradeID.Valid {
		var receiverID int
		_ = h.db.QueryRow("SELECT buyer_id, seller_id, COALESCE(offered_cash_amount, 0) FROM trades WHERE id = ?", tradeID.Int64).Scan(&buyerID, &sellerID, &offeredCash)
		_ = h.db.QueryRow("SELECT COUNT(*) FROM trade_items WHERE trade_id = ? AND offered_by = 'buyer'", tradeID.Int64).Scan(&buyerItemCount)
		isBuyoutDelivery = offeredCash > 0 && buyerItemCount == 0
		_ = h.db.QueryRow("SELECT IF(buyer_id = ?, seller_id, buyer_id) FROM trades WHERE id = ?", deliveryUserID, tradeID.Int64).Scan(&receiverID)
		_ = h.db.QueryRow("SELECT name, COALESCE(phone, '') FROM users WHERE id = ?", receiverID).Scan(&receiverName, &receiverPhone)
	}

	// Fee split
	senderFee := totalCost * 0.5
	receiverFee := totalCost * 0.5

	if isBuyoutDelivery {
		buyerName := receiverName
		buyerPhone := receiverPhone
		sellerName := senderName
		sellerPhone := senderPhone
		if deliveryUserID == buyerID {
			buyerName = senderName
			buyerPhone = senderPhone
			sellerName = receiverName
			sellerPhone = receiverPhone
		}

		buyerPaymentAmount := offeredCash + totalCost
		returnFee := totalCost

		_, err := h.db.Exec(`
			INSERT INTO delivery_stops (delivery_id, stop_number, stop_type, contact_name, contact_phone,
			                             address, latitude, longitude, fee_amount, status)
			VALUES (?, 1, 'buyer_payment', ?, ?, ?, ?, ?, ?, 'pending')`,
			deliveryID, buyerName, buyerPhone, deliveryAddr, deliveryLat, deliveryLng, buyerPaymentAmount,
		)
		if err != nil {
			return err
		}

		_, err = h.db.Exec(`
			INSERT INTO delivery_stops (delivery_id, stop_number, stop_type, contact_name, contact_phone,
			                             address, latitude, longitude, fee_amount, status)
			VALUES (?, 2, 'pickup', ?, ?, ?, ?, ?, ?, 'pending')`,
			deliveryID, sellerName, sellerPhone, pickupAddr, pickupLat, pickupLng, returnFee,
		)
		if err != nil {
			return err
		}

		_, err = h.db.Exec(`
			INSERT INTO delivery_stops (delivery_id, stop_number, stop_type, contact_name, contact_phone,
			                             address, latitude, longitude, fee_amount, status)
			VALUES (?, 3, 'delivery', ?, ?, ?, ?, ?, ?, 'pending')`,
			deliveryID, buyerName, buyerPhone, deliveryAddr, deliveryLat, deliveryLng, 0.0,
		)
		return err
	}

	_, err := h.db.Exec(`
		INSERT INTO delivery_stops (delivery_id, stop_number, stop_type, contact_name, contact_phone,
		                             address, latitude, longitude, fee_amount, status)
		VALUES (?, 1, 'pickup', ?, ?, ?, ?, ?, ?, 'pending')`,
		deliveryID, senderName, senderPhone, pickupAddr, pickupLat, pickupLng, senderFee,
	)
	if err != nil {
		return err
	}

	_, err = h.db.Exec(`
		INSERT INTO delivery_stops (delivery_id, stop_number, stop_type, contact_name, contact_phone,
		                             address, latitude, longitude, fee_amount, status)
		VALUES (?, 2, 'delivery', ?, ?, ?, ?, ?, ?, 'pending')`,
		deliveryID, receiverName, receiverPhone, deliveryAddr, deliveryLat, deliveryLng, receiverFee,
	)
	return err
}

// logCashCollectionAndUpdateLedger logs a pickup/delivery fee collection once and updates the rider ledger.
func (h *DeliveryHandler) logCashCollectionAndUpdateLedger(riderID, deliveryID, stopNumber int, collectionType string, fallbackAmount float64) {
	var stopID int
	var feeAmount float64
	if err := h.db.QueryRow(
		"SELECT id, fee_amount FROM delivery_stops WHERE delivery_id = ? AND stop_number = ?",
		deliveryID, stopNumber,
	).Scan(&stopID, &feeAmount); err != nil {
		log.Printf("Warning: failed to load stop for delivery %d stop %d: %v", deliveryID, stopNumber, err)
		return
	}

	if feeAmount <= 0 {
		feeAmount = fallbackAmount
	}

	var exists int
	_ = h.db.QueryRow(
		"SELECT COUNT(*) FROM rider_cash_collections WHERE delivery_id = ? AND stop_id = ? AND collection_type = ?",
		deliveryID, stopID, collectionType,
	).Scan(&exists)
	if exists > 0 {
		return
	}

	if _, err := h.db.Exec(`
		INSERT INTO rider_cash_collections (rider_id, delivery_id, stop_id, collection_type, amount)
		VALUES (?, ?, ?, ?, ?)
	`, riderID, deliveryID, stopID, collectionType, feeAmount); err != nil {
		log.Printf("Failed to log cash collection for rider %d delivery %d: %v", riderID, deliveryID, err)
		return
	}

	h.updateRiderLedger(riderID, feeAmount)
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

// Helper function to get delivery by ID
func (h *DeliveryHandler) getDeliveryByID(deliveryID, userID int) (*models.Delivery, error) {
	var d models.Delivery
	query := `
		SELECT d.id, d.user_id, d.trade_id, d.delivery_type, d.status, d.rider_id,
			d.pickup_latitude, d.pickup_longitude, d.pickup_address,
			d.delivery_latitude, d.delivery_longitude, d.delivery_address,
			COALESCE(d.special_instructions, ''), d.total_cost, d.estimated_eta, d.item_count, d.is_fragile,
			d.claimed_at, d.picked_up_at, d.in_transit_at, d.delivered_at,
			d.created_at, d.updated_at,
			u.name AS user_name
		FROM deliveries d
		JOIN users u ON d.user_id = u.id
		WHERE d.id = ?
	`
	args := []interface{}{deliveryID}

	if userID > 0 {
		query += " AND (d.user_id = ? OR d.rider_id IN (SELECT id FROM riders WHERE user_id = ?))"
		args = append(args, userID, userID)
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

	// Load delivery stops (CRITICAL for buyout tracking)
	h.loadDeliveryStops(&d)

	return &d, nil
}

// Helper function to load rider info
func (h *DeliveryHandler) loadRiderInfo(d *models.Delivery) {
	if d.RiderID == nil {
		return
	}

	err := h.db.QueryRow(`
		SELECT name, vehicle_type, rating, latitude, longitude, COALESCE(phone, '')
		FROM riders
		WHERE id = ?
	`, *d.RiderID).Scan(&d.RiderName, &d.RiderVehicle, &d.RiderRating, &d.RiderLatitude, &d.RiderLongitude, &d.RiderPhone)
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

	var items []models.DeliveryItem

	for rows.Next() {
		var item models.DeliveryItem
		err := rows.Scan(&item.ID, &item.DeliveryID, &item.ProductID, &item.ProductName, &item.IsFragile, &item.CreatedAt)
		if err != nil {
			continue
		}
		items = append(items, item)
	}
	if len(items) > 0 {
		d.Items = items
	}
}

// Helper function to load delivery stops
func (h *DeliveryHandler) loadDeliveryStops(d *models.Delivery) {
	rows, err := h.db.Query(`
		SELECT id, delivery_id, stop_number, stop_type, contact_name, contact_phone,
		       address, latitude, longitude, COALESCE(item_qr_code, ''), fee_amount, status,
		       arrived_at, qr_scanned_at, fee_collected_at, completed_at, photo_url,
		       created_at, updated_at
		FROM delivery_stops
		WHERE delivery_id = ?
		ORDER BY stop_number ASC
	`, d.ID)
	if err != nil {
		log.Printf("Warning: failed to load delivery stops: %v", err)
		return
	}
	defer rows.Close()

	var stops []models.DeliveryStop

	for rows.Next() {
		var s models.DeliveryStop
		err := rows.Scan(
			&s.ID, &s.DeliveryID, &s.StopNumber, &s.StopType, &s.ContactName, &s.ContactPhone,
			&s.Address, &s.Latitude, &s.Longitude, &s.ItemQRCode, &s.FeeAmount, &s.Status,
			&s.ArrivedAt, &s.QRScannedAt, &s.FeeCollectedAt, &s.CompletedAt, &s.PhotoURL,
			&s.CreatedAt, &s.UpdatedAt,
		)
		if err != nil {
			log.Printf("Error scanning delivery stop: %v", err)
			continue
		}
		stops = append(stops, s)
	}

	d.Stops = stops
}

// GetAvailableDeliveries returns all pending, unclaimed deliveries for riders to browse
// PHASE 3 - Task 14: Express job blocking - riders with active express jobs see no new deliveries
func (h *DeliveryHandler) GetAvailableDeliveries(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)

	// TASK 20: Remittance lock - rider cannot browse/claim while locked
	if ok {
		var riderID int
		err := h.db.QueryRow("SELECT id FROM riders WHERE user_id = ? AND is_active = TRUE", userID).Scan(&riderID)
		if err == nil {
			h.ensureRiderLedger(riderID)
			locked, due := h.isRiderLockedForRemittance(riderID)
			if locked {
				return c.JSON(models.APIResponse{
					Success: true,
					Data:    []models.Delivery{},
					Message: fmt.Sprintf("You have ₱%.2f remittance due. Pay now to unlock your next job.", due),
				})
			}
		}
	}

	// Check if rider has an active express delivery (Task 14)
	// If so, they must not receive new job notifications
	if ok {
		var riderID int
		err := h.db.QueryRow("SELECT id FROM riders WHERE user_id = ? AND is_active = TRUE", userID).Scan(&riderID)
		if err == nil {
			var activeExpressCount int
			h.db.QueryRow(`
				SELECT COUNT(*) FROM deliveries
				WHERE rider_id = ?
				  AND delivery_type = 'express'
				  AND status IN ('claimed', 'picked_up', 'in_transit')
			`, riderID).Scan(&activeExpressCount)

			if activeExpressCount > 0 {
				// Rider is locked on an express job - return empty list with message
				return c.JSON(models.APIResponse{
					Success: true,
					Data:    []models.Delivery{},
					Message: "You have an active express delivery. Complete it before accepting new jobs.",
				})
			}
		}
	}

	rows, err := h.db.Query(`
		SELECT d.id, d.user_id, d.trade_id, d.delivery_type, d.status, d.rider_id,
			d.pickup_latitude, d.pickup_longitude, d.pickup_address,
			d.delivery_latitude, d.delivery_longitude, d.delivery_address,
			COALESCE(d.special_instructions, ''), d.total_cost, d.estimated_eta, d.item_count, d.is_fragile,
			d.claimed_at, d.picked_up_at, d.in_transit_at, d.delivered_at,
			d.created_at, d.updated_at,
			u.name AS user_name,
			COALESCE(u2.name, '') AS receiver_name,
			COALESCE(d.batch_id, '') AS batch_id,
			d.batch_window_expires_at
		FROM deliveries d
		JOIN users u ON d.user_id = u.id
		LEFT JOIN trades t ON d.trade_id = t.id
		LEFT JOIN users u2 ON u2.id = (CASE WHEN t.buyer_id = d.user_id THEN t.seller_id ELSE t.buyer_id END)
		WHERE d.status = 'pending' AND d.rider_id IS NULL
		  AND (d.trade_id IS NULL OR t.id IS NULL OR d.user_id = t.seller_id)
		ORDER BY d.created_at DESC
	`)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to fetch available deliveries"})
	}
	defer rows.Close()

	deliveries := []models.Delivery{}
	now := time.Now()

	for rows.Next() {
		var d models.Delivery
		var batchID string
		var batchWindowExpiresAt sql.NullTime
		err := rows.Scan(
			&d.ID, &d.UserID, &d.TradeID, &d.DeliveryType, &d.Status, &d.RiderID,
			&d.PickupLatitude, &d.PickupLongitude, &d.PickupAddress,
			&d.DeliveryLatitude, &d.DeliveryLongitude, &d.DeliveryAddress,
			&d.SpecialInstructions, &d.TotalCost, &d.EstimatedETA, &d.ItemCount, &d.IsFragile,
			&d.ClaimedAt, &d.PickedUpAt, &d.InTransitAt, &d.DeliveredAt,
			&d.CreatedAt, &d.UpdatedAt,
			&d.UserName,
			&d.ReceiverName,
			&batchID,
			&batchWindowExpiresAt,
		)
		if err != nil {
			log.Printf("Error scanning available delivery: %v", err)
			continue
		}

		// Set batch ID if exists
		if batchID != "" {
			d.BatchID = &batchID
		}

		// Calculate distance and estimated time
		if d.PickupLatitude != nil && d.PickupLongitude != nil && d.DeliveryLatitude != nil && d.DeliveryLongitude != nil {
			d.DistanceKm = haversineDistance(*d.PickupLatitude, *d.PickupLongitude, *d.DeliveryLatitude, *d.DeliveryLongitude)
			// Assume average speed of 20 km/h in city traffic
			d.EstimatedMinutes = int(d.DistanceKm / 20.0 * 60)
			if d.EstimatedMinutes < 10 {
				d.EstimatedMinutes = 10 // Minimum 10 minutes
			}
		}

		// Calculate fee breakdown (rider gets 85% of total cost)
		d.RiderCut = d.TotalCost * 0.85
		d.SenderFee = d.TotalCost
		d.ReceiverFee = 0

		// Batch window logic (Task 10) - only for standard deliveries
		if d.DeliveryType == "standard" {
			// Check if batch window is set
			if batchWindowExpiresAt.Valid {
				d.BatchWindowExpiresAt = &batchWindowExpiresAt.Time
				// Calculate countdown in seconds
				remaining := batchWindowExpiresAt.Time.Sub(now).Seconds()
				if remaining > 0 {
					d.IsBatching = true
					d.BatchCountdown = int(remaining)
				}
			} else {
				// Set batch window for new standard orders (20 minutes from creation)
				batchExpiry := d.CreatedAt.Add(20 * time.Minute)
				remaining := batchExpiry.Sub(now).Seconds()
				if remaining > 0 {
					d.IsBatching = true
					d.BatchWindowExpiresAt = &batchExpiry
					d.BatchCountdown = int(remaining)
				}
			}

			// Count nearby orders for batch size (within 2km of pickup)
			if d.IsBatching && d.PickupLatitude != nil && d.PickupLongitude != nil {
				var batchSize int
				h.db.QueryRow(`
					SELECT COUNT(*) FROM deliveries
					WHERE status = 'pending' AND rider_id IS NULL
					AND delivery_type = 'standard'
					AND id != ?
					AND pickup_latitude IS NOT NULL
					AND (
						6371 * acos(
							cos(radians(?)) * cos(radians(pickup_latitude)) *
							cos(radians(pickup_longitude) - radians(?)) +
							sin(radians(?)) * sin(radians(pickup_latitude))
						)
					) < 2
				`, d.ID, *d.PickupLatitude, *d.PickupLongitude, *d.PickupLatitude).Scan(&batchSize)
				d.BatchSize = batchSize + 1 // Include this delivery
			}
		}

		h.loadDeliveryItems(&d)
		deliveries = append(deliveries, d)
	}

	return c.JSON(models.APIResponse{Success: true, Data: deliveries})
}

// haversineDistance calculates the distance between two lat/long points in km
func haversineDistance(lat1, lon1, lat2, lon2 float64) float64 {
	const R = 6371 // Earth radius in km
	dLat := (lat2 - lat1) * (3.14159265359 / 180)
	dLon := (lon2 - lon1) * (3.14159265359 / 180)
	a := (dLat/2)*(dLat/2)*0.5 + ((dLon/2)*(dLon/2)*0.5)*
		(1-(lat1*(3.14159265359/180))*(lat1*(3.14159265359/180))*0.5)*
		(1-(lat2*(3.14159265359/180))*(lat2*(3.14159265359/180))*0.5)
	// Simplified haversine
	lat1Rad := lat1 * (3.14159265359 / 180)
	lat2Rad := lat2 * (3.14159265359 / 180)
	dLatRad := dLat
	dLonRad := dLon
	a = (1-math.Cos(dLatRad))/2 + math.Cos(lat1Rad)*math.Cos(lat2Rad)*(1-math.Cos(dLonRad))/2
	c := 2 * math.Asin(math.Sqrt(a))
	return R * c
}

// GetRiderDeliveries returns the authenticated rider's claimed/active deliveries
func (h *DeliveryHandler) GetRiderDeliveries(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}

	// Find rider ID for this user
	var riderID int
	err := h.db.QueryRow("SELECT id FROM riders WHERE user_id = ?", userID).Scan(&riderID)
	if err != nil {
		return c.Status(403).JSON(models.APIResponse{Success: false, Error: "You are not registered as a rider"})
	}

	statusFilter := c.Query("status", "")

	query := `
		SELECT d.id, d.user_id, d.trade_id, d.delivery_type, d.status, d.rider_id,
			d.pickup_latitude, d.pickup_longitude, d.pickup_address,
			d.delivery_latitude, d.delivery_longitude, d.delivery_address,
			COALESCE(d.special_instructions, ''), d.total_cost, d.estimated_eta, d.item_count, d.is_fragile,
			d.claimed_at, d.picked_up_at, d.in_transit_at, d.delivered_at,
			d.created_at, d.updated_at,
			u.name AS user_name,
			COALESCE(u2.name, '') AS receiver_name
		FROM deliveries d
		JOIN users u ON d.user_id = u.id
		LEFT JOIN trades t ON d.trade_id = t.id
		LEFT JOIN users u2 ON u2.id = (CASE WHEN t.buyer_id = d.user_id THEN t.seller_id ELSE t.buyer_id END)
		WHERE d.rider_id = ?`

	args := []interface{}{riderID}

	// Support friendly status aliases used by the frontend.
	// Real delivery statuses: pending, claimed, picked_up, in_transit, delivered
	if statusFilter != "" {
		switch statusFilter {
		case "active":
			// Accept both current and any legacy status values.
			query += " AND d.status IN ('claimed','picked_up','in_transit','active')"
		case "completed":
			query += " AND d.status IN ('delivered','completed')"
		default:
			query += " AND d.status = ?"
			args = append(args, statusFilter)
		}
	}

	query += " ORDER BY d.updated_at DESC"

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
			&d.ReceiverName,
		)
		if err != nil {
			log.Printf("Error scanning rider delivery: %v", err)
			continue
		}
		h.loadRiderInfo(&d)
		h.loadDeliveryItems(&d)
		deliveries = append(deliveries, d)
	}

	return c.JSON(models.APIResponse{Success: true, Data: deliveries})
}

func debugEndpointsEnabled() bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv("ENABLE_DEBUG_ENDPOINTS")))
	return v == "true" || v == "1" || v == "yes"
}

// DebugRiderJobs returns diagnostic info about the authenticated rider's deliveries.
// Useful when the UI says "accepted" but Active/Completed tabs are empty.
func (h *DeliveryHandler) DebugRiderJobs(c *fiber.Ctx) error {
	if !debugEndpointsEnabled() {
		return fiber.ErrNotFound
	}

	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}

	ctx, cancel := context.WithTimeout(context.Background(), 4*time.Second)
	defer cancel()

	var dbName sql.NullString
	_ = h.db.QueryRowContext(ctx, "SELECT DATABASE()").Scan(&dbName)

	var riderID int
	if err := h.db.QueryRowContext(ctx, "SELECT id FROM riders WHERE user_id = ?", userID).Scan(&riderID); err != nil {
		return c.Status(403).JSON(models.APIResponse{Success: false, Error: "You are not registered as a rider"})
	}

	type StatusCount struct {
		Status string `json:"status"`
		Count  int    `json:"count"`
	}
	statusCounts := make([]StatusCount, 0)
	rows, err := h.db.QueryContext(ctx, "SELECT status, COUNT(*) FROM deliveries WHERE rider_id = ? GROUP BY status", riderID)
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var sc StatusCount
			if err := rows.Scan(&sc.Status, &sc.Count); err == nil {
				statusCounts = append(statusCounts, sc)
			}
		}
	}

	type DebugDelivery struct {
		ID           int           `json:"id"`
		Status       string        `json:"status"`
		DeliveryType string        `json:"delivery_type"`
		TradeID      sql.NullInt64 `json:"trade_id"`
		UpdatedAt    time.Time     `json:"updated_at"`
	}
	latest := make([]DebugDelivery, 0, 20)
	lrows, lerr := h.db.QueryContext(ctx, "SELECT id, status, delivery_type, trade_id, updated_at FROM deliveries WHERE rider_id = ? ORDER BY updated_at DESC LIMIT 20", riderID)
	if lerr == nil {
		defer lrows.Close()
		for lrows.Next() {
			var d DebugDelivery
			if err := lrows.Scan(&d.ID, &d.Status, &d.DeliveryType, &d.TradeID, &d.UpdatedAt); err == nil {
				latest = append(latest, d)
			}
		}
	}

	return c.JSON(models.APIResponse{Success: true, Data: fiber.Map{
		"db":            dbName.String,
		"user_id":       userID,
		"rider_id":      riderID,
		"status_counts": statusCounts,
		"latest":        latest,
	}})
}

// ClaimDelivery allows a rider to self-claim an available delivery
func (h *DeliveryHandler) ClaimDelivery(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}

	deliveryID, err := strconv.Atoi(c.Params("id"))
	if err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid delivery ID"})
	}

	// Look up rider record for this user
	var riderID int
	err = h.db.QueryRow("SELECT id FROM riders WHERE user_id = ? AND is_active = TRUE", userID).Scan(&riderID)
	if err != nil {
		return c.Status(403).JSON(models.APIResponse{Success: false, Error: "You are not registered as an active rider"})
	}

	// TASK 20: Remittance lock - rider cannot claim jobs while locked
	h.ensureRiderLedger(riderID)
	locked, due := h.isRiderLockedForRemittance(riderID)
	if locked {
		return c.Status(403).JSON(models.APIResponse{Success: false, Error: fmt.Sprintf("You have ₱%.2f remittance due. Pay now to unlock your next job.", due)})
	}

	// Atomically claim the delivery -- only succeeds if still pending and unclaimed
	now := time.Now()
	result, err := h.db.Exec(`
		UPDATE deliveries
		SET rider_id = ?, status = 'claimed', claimed_at = ?, updated_at = CURRENT_TIMESTAMP
		WHERE id = ? AND status = 'pending' AND rider_id IS NULL`,
		riderID, now, deliveryID)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to claim delivery"})
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Delivery is no longer available for claiming"})
	}

	log.Printf("Rider %d (user %d) claimed delivery %d", riderID, userID, deliveryID)

	// ─────────────────────────────────────────────────────────────────────────────
	// TASK 11 & 14: Create delivery stops for job execution
	// ─────────────────────────────────────────────────────────────────────────────
	// Get delivery details
	var deliveryUserID int
	var tradeID sql.NullInt64
	var deliveryType, pickupAddr, deliveryAddr string
	var pickupLat, pickupLng, deliveryLat, deliveryLng sql.NullFloat64
	var totalCost float64
	err = h.db.QueryRow(`
		SELECT user_id, trade_id, delivery_type, pickup_address, delivery_address,
		       pickup_latitude, pickup_longitude, delivery_latitude, delivery_longitude, total_cost
		FROM deliveries WHERE id = ?`, deliveryID).Scan(
		&deliveryUserID, &tradeID, &deliveryType, &pickupAddr, &deliveryAddr,
		&pickupLat, &pickupLng, &deliveryLat, &deliveryLng, &totalCost)

	if err != nil {
		log.Printf("Failed to get delivery details: %v", err)
	}

	// Delivery is buyout-only.

	// Get sender details (delivery creator)
	var senderName, senderPhone string
	h.db.QueryRow("SELECT name, COALESCE(phone, '') FROM users WHERE id = ?", deliveryUserID).Scan(&senderName, &senderPhone)

	// Get receiver details (if trade-based delivery, get the other party)
	receiverName := "Receiver"
	receiverPhone := ""
	if tradeID.Valid {
		var receiverID int
		h.db.QueryRow("SELECT IF(buyer_id = ?, seller_id, buyer_id) FROM trades WHERE id = ?", deliveryUserID, tradeID.Int64).Scan(&receiverID)
		h.db.QueryRow("SELECT name, COALESCE(phone, '') FROM users WHERE id = ?", receiverID).Scan(&receiverName, &receiverPhone)
	}

	// Determine if this is a buyout delivery (cash-only, no buyer items)
	isBuyoutDelivery := false
	var buyerID, sellerID int
	var offeredCash float64
	if tradeID.Valid {
		_ = h.db.QueryRow("SELECT buyer_id, seller_id, COALESCE(offered_cash_amount, 0) FROM trades WHERE id = ?", tradeID.Int64).Scan(&buyerID, &sellerID, &offeredCash)
		var buyerItemCount int
		_ = h.db.QueryRow("SELECT COUNT(*) FROM trade_items WHERE trade_id = ? AND offered_by = 'buyer'", tradeID.Int64).Scan(&buyerItemCount)
		isBuyoutDelivery = offeredCash > 0 && buyerItemCount == 0
	}

	// TASK 17: Fee split - sender pays 50%, receiver pays 50%
	senderFee := totalCost * 0.5
	receiverFee := totalCost * 0.5

	// Create stops based on delivery type and buyout flow
	if isBuyoutDelivery {
		// Cleanup any existing stops for this delivery before creating the buyout workflow
		_, _ = h.db.Exec("DELETE FROM delivery_stops WHERE delivery_id = ?", deliveryID)

		buyerName := receiverName
		buyerPhone := receiverPhone
		sellerName := senderName
		sellerPhone := senderPhone
		if deliveryUserID == buyerID {
			buyerName = senderName
			buyerPhone = senderPhone
			sellerName = receiverName
			sellerPhone = receiverPhone
		}

		// Split fee: 50% from buyer, 50% from seller
		leg1Fee := totalCost * 0.5
		leg2Fee := totalCost * 0.5

		buyerPaymentAmount := offeredCash + leg1Fee
		returnFee := leg2Fee

		// Stop 1: Buyer payment + delivery fee collection
		_, err = h.db.Exec(`
			INSERT INTO delivery_stops (delivery_id, stop_number, stop_type, contact_name, contact_phone,
			                             address, latitude, longitude, fee_amount, status)
			VALUES (?, 1, 'buyer_payment', ?, ?, ?, ?, ?, ?, 'pending')`,
			deliveryID, buyerName, buyerPhone, deliveryAddr, deliveryLat, deliveryLng, buyerPaymentAmount)
		if err != nil {
			log.Printf("Failed to create buyer payment stop: %v", err)
		}

		// Stop 2: Seller pickup (after payment)
		_, err = h.db.Exec(`
			INSERT INTO delivery_stops (delivery_id, stop_number, stop_type, contact_name, contact_phone,
			                             address, latitude, longitude, fee_amount, status)
			VALUES (?, 2, 'pickup', ?, ?, ?, ?, ?, ?, 'pending')`,
			deliveryID, sellerName, sellerPhone, pickupAddr, pickupLat, pickupLng, returnFee)
		if err != nil {
			log.Printf("Failed to create seller pickup stop: %v", err)
		}

		// Stop 3: Deliver item to buyer
		_, err = h.db.Exec(`
			INSERT INTO delivery_stops (delivery_id, stop_number, stop_type, contact_name, contact_phone,
			                             address, latitude, longitude, fee_amount, status)
			VALUES (?, 3, 'delivery', ?, ?, ?, ?, ?, ?, 'pending')`,
			deliveryID, buyerName, buyerPhone, deliveryAddr, deliveryLat, deliveryLng, 0.0)
		if err != nil {
			log.Printf("Failed to create buyer delivery stop: %v", err)
		}
	} else if deliveryType == "express" {
		// Express: 2 stops only (pickup -> delivery)
		_, err = h.db.Exec(`
			INSERT INTO delivery_stops (delivery_id, stop_number, stop_type, contact_name, contact_phone,
			                             address, latitude, longitude, fee_amount, status)
			VALUES (?, 1, 'pickup', ?, ?, ?, ?, ?, ?, 'pending')`,
			deliveryID, senderName, senderPhone, pickupAddr, pickupLat, pickupLng, senderFee)
		if err != nil {
			log.Printf("Failed to create express pickup stop: %v", err)
		}

		_, err = h.db.Exec(`
			INSERT INTO delivery_stops (delivery_id, stop_number, stop_type, contact_name, contact_phone,
			                             address, latitude, longitude, fee_amount, status)
			VALUES (?, 2, 'delivery', ?, ?, ?, ?, ?, ?, 'pending')`,
			deliveryID, receiverName, receiverPhone, deliveryAddr, deliveryLat, deliveryLng, receiverFee)
		if err != nil {
			log.Printf("Failed to create express delivery stop: %v", err)
		}
	} else {
		// Standard: Create pickup and delivery stops
		_, err = h.db.Exec(`
			INSERT INTO delivery_stops (delivery_id, stop_number, stop_type, contact_name, contact_phone,
			                             address, latitude, longitude, fee_amount, status)
			VALUES (?, 1, 'pickup', ?, ?, ?, ?, ?, ?, 'pending')`,
			deliveryID, senderName, senderPhone, pickupAddr, pickupLat, pickupLng, senderFee)
		if err != nil {
			log.Printf("Failed to create standard pickup stop: %v", err)
		}

		_, err = h.db.Exec(`
			INSERT INTO delivery_stops (delivery_id, stop_number, stop_type, contact_name, contact_phone,
			                             address, latitude, longitude, fee_amount, status)
			VALUES (?, 2, 'delivery', ?, ?, ?, ?, ?, ?, 'pending')`,
			deliveryID, receiverName, receiverPhone, deliveryAddr, deliveryLat, deliveryLng, receiverFee)
		if err != nil {
			log.Printf("Failed to create standard delivery stop: %v", err)
		}
	}

	// TASK 19: Initialize rider ledger if doesn't exist
	h.ensureRiderLedger(riderID)

	// Notify the delivery owner
	_ = h.db.QueryRow("SELECT user_id, trade_id FROM deliveries WHERE id = ?", deliveryID).Scan(&deliveryUserID, &tradeID)

	_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'delivery_update', ?, FALSE)",
		deliveryUserID, "A rider has claimed your delivery and will pick it up soon!")

	// If linked to a trade, also notify the buyer
	if tradeID.Valid {
		var buyerID int
		_ = h.db.QueryRow("SELECT buyer_id FROM trades WHERE id = ?", tradeID.Int64).Scan(&buyerID)
		if buyerID != deliveryUserID {
			_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'delivery_update', ?, FALSE)",
				buyerID, "A rider has been assigned to your trade delivery!")
		}
	}

	// Return updated delivery
	delivery, err := h.getDeliveryByID(deliveryID, 0)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to retrieve updated delivery"})
	}

	return c.JSON(models.APIResponse{
		Success: true,
		Message: "Delivery claimed successfully",
		Data:    delivery,
	})
}

// GetTradeDelivery returns the delivery record linked to a specific trade
func (h *DeliveryHandler) GetTradeDelivery(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}

	tradeID, err := strconv.Atoi(c.Params("id"))
	if err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid trade ID"})
	}

	// Verify user is part of this trade
	var buyerID, sellerID int
	err = h.db.QueryRow("SELECT buyer_id, seller_id FROM trades WHERE id = ?", tradeID).Scan(&buyerID, &sellerID)
	if err != nil {
		return c.Status(404).JSON(models.APIResponse{Success: false, Error: "Trade not found"})
	}
	if userID != buyerID && userID != sellerID {
		return c.Status(403).JSON(models.APIResponse{Success: false, Error: "Not authorized for this trade"})
	}

	// Find the next delivery leg for this trade (prefer undelivered), otherwise return latest.
	var deliveryID int
	err = h.db.QueryRow(
		"SELECT id FROM deliveries WHERE trade_id = ? AND status <> 'delivered' ORDER BY created_at ASC LIMIT 1",
		tradeID,
	).Scan(&deliveryID)
	if err == sql.ErrNoRows {
		err = h.db.QueryRow(
			"SELECT id FROM deliveries WHERE trade_id = ? ORDER BY created_at DESC LIMIT 1",
			tradeID,
		).Scan(&deliveryID)
	}
	if err != nil {
		// No delivery found — auto-create one if this is an active delivery trade
		var tradeOption string
		var tradeStatus string
		_ = h.db.QueryRow("SELECT COALESCE(trade_option, 'meetup'), status FROM trades WHERE id = ?", tradeID).Scan(&tradeOption, &tradeStatus)

		if tradeOption == "delivery" && (tradeStatus == "active" || tradeStatus == "accepted" || tradeStatus == "awaiting_confirmation") {
			log.Printf("Auto-creating missing delivery record(s) for trade %d", tradeID)
			newID, createErr := h.autoCreateDeliveryForTrade(tradeID, buyerID, sellerID)
			if createErr != nil {
				log.Printf("Failed to auto-create delivery for trade %d: %v", tradeID, createErr)
				return c.JSON(models.APIResponse{Success: true, Data: nil})
			}
			deliveryID = newID
		} else {
			return c.JSON(models.APIResponse{Success: true, Data: nil})
		}
	}

	delivery, err := h.getDeliveryByID(deliveryID, 0)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to retrieve delivery"})
	}

	return c.JSON(models.APIResponse{Success: true, Data: delivery})
}

// GetTradeDeliveries returns all delivery legs linked to a specific trade (ordered by created_at ASC).
func (h *DeliveryHandler) GetTradeDeliveries(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}

	tradeID, err := strconv.Atoi(c.Params("id"))
	if err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid trade ID"})
	}

	// Verify user is part of this trade
	var buyerID, sellerID int
	err = h.db.QueryRow("SELECT buyer_id, seller_id FROM trades WHERE id = ?", tradeID).Scan(&buyerID, &sellerID)
	if err != nil {
		return c.Status(404).JSON(models.APIResponse{Success: false, Error: "Trade not found"})
	}
	if userID != buyerID && userID != sellerID {
		return c.Status(403).JSON(models.APIResponse{Success: false, Error: "Not authorized for this trade"})
	}

	loadDeliveryIDs := func() ([]int, error) {
		rows, err := h.db.Query("SELECT id FROM deliveries WHERE trade_id = ? ORDER BY created_at ASC", tradeID)
		if err != nil {
			return nil, err
		}
		defer rows.Close()
		ids := []int{}
		for rows.Next() {
			var id int
			if err := rows.Scan(&id); err != nil {
				continue
			}
			ids = append(ids, id)
		}
		return ids, nil
	}

	ids, err := loadDeliveryIDs()
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to fetch deliveries"})
	}

	if len(ids) == 0 {
		// No delivery found — auto-create if this is an active delivery trade
		var tradeOption string
		var tradeStatus string
		_ = h.db.QueryRow("SELECT COALESCE(trade_option, 'meetup'), status FROM trades WHERE id = ?", tradeID).Scan(&tradeOption, &tradeStatus)
		if tradeOption == "delivery" && (tradeStatus == "active" || tradeStatus == "accepted" || tradeStatus == "awaiting_confirmation") {
			log.Printf("Auto-creating missing delivery record(s) for trade %d", tradeID)
			_, createErr := h.autoCreateDeliveryForTrade(tradeID, buyerID, sellerID)
			if createErr == nil {
				ids, _ = loadDeliveryIDs()
			}
		}
	}

	if len(ids) == 0 {
		return c.JSON(models.APIResponse{Success: true, Data: []models.Delivery{}})
	}

	deliveries := make([]models.Delivery, 0, len(ids))
	for _, id := range ids {
		d, err := h.getDeliveryByID(id, 0)
		if err != nil {
			continue
		}
		deliveries = append(deliveries, *d)
	}

	return c.JSON(models.APIResponse{Success: true, Data: deliveries})
}

// autoCreateDeliveryForTrade creates a missing delivery record for an active delivery trade.
// This handles trades that were accepted before the auto-creation code was deployed.
func (h *DeliveryHandler) autoCreateDeliveryForTrade(tradeID, buyerID, sellerID int) (int, error) {
	// Get trade delivery info
	var deliveryAddress sql.NullString
	var deliveryType sql.NullString
	err := h.db.QueryRow(
		"SELECT delivery_address, delivery_type FROM trades WHERE id = ?", tradeID,
	).Scan(&deliveryAddress, &deliveryType)
	if err != nil {
		return 0, fmt.Errorf("failed to get trade info: %w", err)
	}

	// Get buyer-offered trade items
	rows, err := h.db.Query("SELECT product_id FROM trade_items WHERE trade_id = ? AND offered_by = 'buyer'", tradeID)
	if err != nil {
		return 0, fmt.Errorf("failed to get trade items: %w", err)
	}
	defer rows.Close()

	var buyerOfferedProductIDs []int
	for rows.Next() {
		var pid int
		if err := rows.Scan(&pid); err != nil {
			continue
		}
		buyerOfferedProductIDs = append(buyerOfferedProductIDs, pid)
	}
	if len(buyerOfferedProductIDs) > 0 {
		return 0, fmt.Errorf("trade %d is not a buyout; skipping delivery creation", tradeID)
	}

	// Also include the target product
	var targetProductID int
	_ = h.db.QueryRow("SELECT target_product_id FROM trades WHERE id = ?", tradeID).Scan(&targetProductID)
	if targetProductID <= 0 {
		return 0, fmt.Errorf("trade %d missing target_product_id", tradeID)
	}

	// Get seller location for pickup
	var sellerLat, sellerLon sql.NullFloat64
	var sellerAddr sql.NullString
	_ = h.db.QueryRow("SELECT latitude, longitude, COALESCE(bio, '') FROM users WHERE id = ?", sellerID).Scan(&sellerLat, &sellerLon, &sellerAddr)

	// Get buyer location (for delivery)
	var buyerLat, buyerLon sql.NullFloat64
	var buyerAddr sql.NullString
	_ = h.db.QueryRow("SELECT latitude, longitude, COALESCE(bio, '') FROM users WHERE id = ?", buyerID).Scan(&buyerLat, &buyerLon, &buyerAddr)
	_ = buyerAddr

	// Determine delivery type
	delType := "standard"
	if deliveryType.Valid && deliveryType.String != "" {
		delType = deliveryType.String
	}

	// Calculate cost with distance-based pricing
	var totalCost float64
	baseFee := 30.0
	if delType == "express" {
		baseFee = 60.0
	}

	dist := 0.0
	if sellerLat.Valid && sellerLon.Valid && buyerLat.Valid && buyerLon.Valid {
		dist = haversine(sellerLat.Float64, sellerLon.Float64, buyerLat.Float64, buyerLon.Float64)
	}

	// ₱10 per km as approved by user
	totalCost = baseFee + (dist * 10.0)
	// Round to 2 decimal places
	totalCost = math.Round(totalCost*100) / 100

	// Determine pickup address
	pickupAddr := "Seller location"
	if sellerAddr.Valid && sellerAddr.String != "" {
		pickupAddr = sellerAddr.String
	}

	// Determine delivery address
	delAddr := "Buyer location"
	if deliveryAddress.Valid && deliveryAddress.String != "" {
		delAddr = deliveryAddress.String
	}

	createDelivery := func(ownerUserID int, pickupLat, pickupLon sql.NullFloat64, pickupAddress string, dropLat, dropLon sql.NullFloat64, dropAddress string, itemIDs []int) (int, error) {
		result, err := h.db.Exec(`
			INSERT INTO deliveries (
				user_id, trade_id, delivery_type, status,
				pickup_latitude, pickup_longitude, pickup_address,
				delivery_latitude, delivery_longitude, delivery_address,
				item_count, total_cost, is_fragile
			) VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?, ?, FALSE)`,
			ownerUserID, tradeID, delType,
			pickupLat, pickupLon, pickupAddress,
			dropLat, dropLon, dropAddress,
			len(itemIDs), totalCost,
		)
		if err != nil {
			return 0, err
		}
		deliveryID64, _ := result.LastInsertId()
		deliveryID := int(deliveryID64)
		for _, pid := range itemIDs {
			var productName string
			_ = h.db.QueryRow("SELECT title FROM products WHERE id = ?", pid).Scan(&productName)
			_, _ = h.db.Exec(
				"INSERT INTO delivery_items (delivery_id, product_id, product_name, is_fragile) VALUES (?, ?, ?, FALSE)",
				deliveryID, pid, productName,
			)
		}
		return deliveryID, nil
	}

	leg1ID, err := createDelivery(
		sellerID,
		sellerLat, sellerLon, pickupAddr,
		buyerLat, buyerLon, delAddr,
		[]int{targetProductID},
	)
	if err != nil {
		return 0, fmt.Errorf("failed to insert delivery: %w", err)
	}
	log.Printf("Auto-created delivery %d for trade %d (seller -> buyer)", leg1ID, tradeID)

	// Notify both parties (best-effort)
	msgBuyer := "Your buyout offer was accepted. A rider will collect payment and deliver your item."
	msgSeller := "You accepted a buyout offer. A rider will collect payment and deliver your item."
	_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'delivery_update', ?, FALSE)", buyerID, msgBuyer)
	_, _ = h.db.Exec("INSERT INTO notifications (user_id, type, message, is_read) VALUES (?, 'delivery_update', ?, FALSE)", sellerID, msgSeller)

	return leg1ID, nil
}

// ═════════════════════════════════════════════════════════════════════════════
// JOB EXECUTION - PHASE 3 & 4
// ═════════════════════════════════════════════════════════════════════════════

// ensureRiderLedger creates a rider ledger entry if it doesn't exist
func (h *DeliveryHandler) ensureRiderLedger(riderID int) {
	var exists int
	h.db.QueryRow("SELECT COUNT(*) FROM rider_ledger WHERE rider_id = ?", riderID).Scan(&exists)
	if exists == 0 {
		defaultSlots := 0
		_, err := h.db.Exec(`
			INSERT INTO rider_ledger (rider_id, total_cash_collected, remittance_owed, take_home, free_slots_remaining)
			VALUES (?, 0, 0, 0, ?)
		`, riderID, defaultSlots)
		if err != nil {
			log.Printf("Failed to create rider ledger for rider %d: %v", riderID, err)
		}
	}
}

// GetDeliveryStops returns all stops for a delivery
func (h *DeliveryHandler) GetDeliveryStops(c *fiber.Ctx) error {
	deliveryID, err := strconv.Atoi(c.Params("id"))
	if err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid delivery ID"})
	}

	rows, err := h.db.Query(`
		SELECT id, delivery_id, stop_number, stop_type, contact_name, contact_phone,
		       address, latitude, longitude, COALESCE(item_qr_code, ''), fee_amount, status,
		       arrived_at, qr_scanned_at, fee_collected_at, completed_at, COALESCE(photo_url, ''),
		       created_at, updated_at
		FROM delivery_stops
		WHERE delivery_id = ?
		ORDER BY stop_number ASC`, deliveryID)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to fetch stops"})
	}
	defer rows.Close()

	stops := []models.DeliveryStop{}
	for rows.Next() {
		var s models.DeliveryStop
		err := rows.Scan(
			&s.ID, &s.DeliveryID, &s.StopNumber, &s.StopType, &s.ContactName, &s.ContactPhone,
			&s.Address, &s.Latitude, &s.Longitude, &s.ItemQRCode, &s.FeeAmount, &s.Status,
			&s.ArrivedAt, &s.QRScannedAt, &s.FeeCollectedAt, &s.CompletedAt, &s.PhotoURL,
			&s.CreatedAt, &s.UpdatedAt,
		)
		if err != nil {
			log.Printf("Error scanning stop: %v", err)
			continue
		}
		stops = append(stops, s)
	}

	return c.JSON(models.APIResponse{Success: true, Data: stops})
}

// UpdateStopStatus updates a delivery stop's status with step enforcement
// TASK 15: Step lock enforcement - server-side validation
func (h *DeliveryHandler) UpdateStopStatus(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}

	stopID, err := strconv.Atoi(c.Params("stopId"))
	if err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid stop ID"})
	}

	var payload struct {
		Action   string `json:"action"` // arrived, scan_qr, collect_fee, complete
		QRCode   string `json:"qr_code,omitempty"`
		PhotoURL string `json:"photo_url,omitempty"`
	}
	if err := c.BodyParser(&payload); err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid request"})
	}

	// Verify the rider owns this delivery
	var riderID, deliveryID, stopNumber int
	var currentStatus, stopType string
	err = h.db.QueryRow(`
		SELECT ds.id, ds.delivery_id, ds.stop_number, ds.status, ds.stop_type, d.rider_id
		FROM delivery_stops ds
		JOIN deliveries d ON ds.delivery_id = d.id
		WHERE ds.id = ?`, stopID).Scan(&stopID, &deliveryID, &stopNumber, &currentStatus, &stopType, &riderID)
	if err != nil {
		return c.Status(404).JSON(models.APIResponse{Success: false, Error: "Stop not found"})
	}

	// Verify rider
	var riderUserID int
	h.db.QueryRow("SELECT user_id FROM riders WHERE id = ?", riderID).Scan(&riderUserID)
	if riderUserID != userID {
		return c.Status(403).JSON(models.APIResponse{Success: false, Error: "Not authorized for this delivery"})
	}

	// TASK 15: Enforce step order - must complete previous stop first
	if stopNumber > 1 {
		var prevStopStatus string
		err := h.db.QueryRow("SELECT status FROM delivery_stops WHERE delivery_id = ? AND stop_number = ?",
			deliveryID, stopNumber-1).Scan(&prevStopStatus)
		
		// Only enforce if the previous stop actually exists
		if err == nil && prevStopStatus != "completed" {
			log.Printf("Order Enforcement: Delivery %d Stop %d blocked. Prev Stop %d is '%s'", 
				deliveryID, stopNumber, stopNumber-1, prevStopStatus)
			
			return c.Status(400).JSON(models.APIResponse{
				Success: false,
				Error:   "You must complete the previous stop first",
			})
		}
	}

	now := time.Now()
	var newStatus string
	var updateQuery string

	switch payload.Action {
	case "arrived":
		if currentStatus != "pending" {
			return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid state transition"})
		}
		newStatus = "arrived"
		updateQuery = "UPDATE delivery_stops SET status = 'arrived', arrived_at = ? WHERE id = ?"
		_, err = h.db.Exec(updateQuery, now, stopID)

	case "scan_qr":
		if currentStatus != "arrived" {
			return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Must arrive at stop first"})
		}
		newStatus = "qr_scanned"
		updateQuery = "UPDATE delivery_stops SET status = 'qr_scanned', qr_scanned_at = ?, item_qr_code = ? WHERE id = ?"
		_, err = h.db.Exec(updateQuery, now, payload.QRCode, stopID)

	case "collect_fee":
		if currentStatus != "qr_scanned" && currentStatus != "arrived" {
			return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Must arrive at stop first"})
		}
		newStatus = "fee_collected"
		updateQuery = "UPDATE delivery_stops SET status = 'fee_collected', fee_collected_at = ? WHERE id = ?"
		_, err = h.db.Exec(updateQuery, now, stopID)

		// TASK 17 & 18: Log cash collection and update ledger
		var feeAmount float64
		h.db.QueryRow("SELECT fee_amount FROM delivery_stops WHERE id = ?", stopID).Scan(&feeAmount)

		if feeAmount > 0 {
			collectionType := "pickup_fee"
			if stopType == "delivery" || stopType == "buyer_payment" {
				collectionType = "delivery_fee"
			}

			// Log collection
			_, err = h.db.Exec(`
				INSERT INTO rider_cash_collections (rider_id, delivery_id, stop_id, collection_type, amount)
				VALUES (?, ?, ?, ?, ?)
			`, riderID, deliveryID, stopID, collectionType, feeAmount)

			// Update rider ledger (delivery fee only)
			h.updateRiderLedger(riderID, feeAmount)
		}

	case "complete":
		if currentStatus != "fee_collected" {
			return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Must collect fee first"})
		}
		// TASK 16: Photo proof is required for delivery stops
		if stopType == "delivery" && payload.PhotoURL == "" {
			return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Photo proof is required for delivery"})
		}
		newStatus = "completed"
		updateQuery = "UPDATE delivery_stops SET status = 'completed', completed_at = ?, photo_url = ? WHERE id = ?"
		_, err = h.db.Exec(updateQuery, now, payload.PhotoURL, stopID)

		// Check if all stops are complete - if so, mark delivery as delivered
		var pendingStops int
		h.db.QueryRow("SELECT COUNT(*) FROM delivery_stops WHERE delivery_id = ? AND status != 'completed'", deliveryID).Scan(&pendingStops)
		if pendingStops == 0 {
			h.db.Exec("UPDATE deliveries SET status = 'delivered', delivered_at = ? WHERE id = ?", now, deliveryID)
		}

	default:
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid action"})
	}

	if err != nil {
		log.Printf("Failed to update stop %d: %v", stopID, err)
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to update stop"})
	}

	return c.JSON(models.APIResponse{
		Success: true,
		Message: fmt.Sprintf("Stop %s successfully", newStatus),
		Data:    fiber.Map{"status": newStatus},
	})
}

// TASK 18: Update rider ledger after cash collection
func (h *DeliveryHandler) updateRiderLedger(riderID int, amount float64) {
	// Get current ledger state
	var freeSlotsRemaining int
	var totalCash, remittanceOwed, takeHome float64
	h.db.QueryRow(`
		SELECT total_cash_collected, remittance_owed, take_home, free_slots_remaining
		FROM rider_ledger WHERE rider_id = ?`, riderID).Scan(&totalCash, &remittanceOwed, &takeHome, &freeSlotsRemaining)

	// Update totals
	totalCash += amount

	// Platform takes a fixed tax per fee collection (pickup/delivery)
	platformCut := h.getRiderRemittanceTaxPerCollection()
	if amount < platformCut {
		platformCut = amount
	}
	riderEarnings := amount - platformCut
	remittanceOwed += platformCut
	takeHome += riderEarnings

	_, err := h.db.Exec(`
		UPDATE rider_ledger
		SET total_cash_collected = ?, remittance_owed = ?, take_home = ?, updated_at = CURRENT_TIMESTAMP
		WHERE rider_id = ?
	`, totalCash, remittanceOwed, takeHome, riderID)

	if err != nil {
		log.Printf("Failed to update rider ledger for rider %d: %v", riderID, err)
	}

	// Lock/unlock rider based on remittance threshold
	if remittanceOwed >= h.getRiderRemittanceLockThreshold() {
		_, _ = h.db.Exec("UPDATE rider_ledger SET is_locked_for_remittance = TRUE WHERE rider_id = ?", riderID)
	} else {
		_, _ = h.db.Exec("UPDATE rider_ledger SET is_locked_for_remittance = FALSE WHERE rider_id = ?", riderID)
	}
}

// GetRiderLedger returns the rider's cash ledger (TASK 18)
func (h *DeliveryHandler) GetRiderLedger(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}

	var riderID int
	err := h.db.QueryRow("SELECT id FROM riders WHERE user_id = ?", userID).Scan(&riderID)
	if err != nil {
		return c.Status(404).JSON(models.APIResponse{Success: false, Error: "Rider not found"})
	}

	var ledger models.RiderLedger
	err = h.db.QueryRow(`
		SELECT id, rider_id, total_cash_collected, remittance_owed, take_home,
		       free_slots_remaining, total_free_slots_used, last_remittance_at,
		       is_locked_for_remittance, created_at, updated_at
		FROM rider_ledger WHERE rider_id = ?`, riderID).Scan(
		&ledger.ID, &ledger.RiderID, &ledger.TotalCashCollected, &ledger.RemittanceOwed,
		&ledger.TakeHome, &ledger.FreeSlotsRemaining, &ledger.TotalFreeSlotsUsed,
		&ledger.LastRemittanceAt, &ledger.IsLockedForRemittance,
		&ledger.CreatedAt, &ledger.UpdatedAt,
	)

	if err != nil {
		// Initialize if doesn't exist
		h.ensureRiderLedger(riderID)
		threshold := h.getRiderRemittanceLockThreshold()
		return c.JSON(models.APIResponse{Success: true, Data: models.RiderLedger{
			RiderID:                riderID,
			TotalCashCollected:     0,
			RemittanceOwed:         0,
			TakeHome:               0,
			TotalRemittancePaid:    0,
			RemittanceThreshold:    threshold,
			RemittancePaidProgress: 0,
			FreeSlotsRemaining:     0,
		}})
	}

	// Add remittance payment progress indicator (sum of verified payments)
	var totalPaid float64
	_ = h.db.QueryRow(
		"SELECT COALESCE(SUM(amount_paid), 0.00) FROM rider_remittance_payments WHERE rider_id = ? AND status = 'verified'",
		riderID,
	).Scan(&totalPaid)

	threshold := h.getRiderRemittanceLockThreshold()
	paidProgress := 0.0
	if threshold > 0 {
		paidProgress = math.Mod(totalPaid, threshold)
		// If totalPaid is an exact multiple of threshold, show full completion (50/50) instead of 0/50.
		if paidProgress < 0.009 && totalPaid > 0 {
			paidProgress = threshold
		}
		// Normalize edge cases close to threshold
		if math.Abs(paidProgress-threshold) < 0.009 {
			paidProgress = threshold
		}
	}

	ledger.TotalRemittancePaid = totalPaid
	ledger.RemittanceThreshold = threshold
	ledger.RemittancePaidProgress = paidProgress

	return c.JSON(models.APIResponse{Success: true, Data: ledger})
}

// SubmitRemittancePayment submits a remittance payment (TASK 20)
func (h *DeliveryHandler) SubmitRemittancePayment(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}

	var riderID int
	err := h.db.QueryRow("SELECT id FROM riders WHERE user_id = ?", userID).Scan(&riderID)
	if err != nil {
		return c.Status(404).JSON(models.APIResponse{Success: false, Error: "Rider not found"})
	}

	var payload struct {
		AmountPaid      float64 `json:"amount_paid"`
		PaymentMethod   string  `json:"payment_method"`
		PaymentProofURL string  `json:"payment_proof_url"`
	}
	if err := c.BodyParser(&payload); err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid request"})
	}

	if payload.AmountPaid <= 0 {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid payment amount"})
	}

	result, err := h.db.Exec(`
		INSERT INTO rider_remittance_payments (rider_id, amount_paid, payment_method, payment_proof_url, status)
		VALUES (?, ?, ?, ?, 'pending')
	`, riderID, payload.AmountPaid, payload.PaymentMethod, payload.PaymentProofURL)

	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to submit payment"})
	}

	paymentID, _ := result.LastInsertId()

	return c.JSON(models.APIResponse{
		Success: true,
		Message: "Remittance payment submitted. Awaiting admin verification.",
		Data:    fiber.Map{"payment_id": paymentID},
	})
}

// AdminVerifyRemittancePayment verifies a remittance payment and unlocks rider (TASK 20)
func (h *DeliveryHandler) AdminVerifyRemittancePayment(c *fiber.Ctx) error {
	paymentID, err := strconv.Atoi(c.Params("paymentId"))
	if err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid payment ID"})
	}

	userID, _ := middleware.GetUserIDFromContext(c)

	var payload struct {
		Approve         bool   `json:"approve"`
		RejectionReason string `json:"rejection_reason,omitempty"`
	}
	if err := c.BodyParser(&payload); err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid request"})
	}

	now := time.Now()
	var riderID int
	var amountPaid float64
	h.db.QueryRow("SELECT rider_id, amount_paid FROM rider_remittance_payments WHERE id = ?", paymentID).Scan(&riderID, &amountPaid)

	if payload.Approve {
		// Approve payment
		_, err = h.db.Exec(`
			UPDATE rider_remittance_payments
			SET status = 'verified', verified_by = ?, verified_at = ?
			WHERE id = ?
		`, userID, now, paymentID)

		defaultSlots := 0
		// Reset remittance to 0 (admin-confirmed), unlock, and refill slots.
		_, err = h.db.Exec(`
			UPDATE rider_ledger
			SET remittance_owed = 0,
			    last_remittance_at = ?,
			    is_locked_for_remittance = FALSE,
			    free_slots_remaining = ?
			WHERE rider_id = ?
		`, now, defaultSlots, riderID)

		return c.JSON(models.APIResponse{Success: true, Message: "Payment verified and rider unlocked"})
	} else {
		// Reject payment
		_, err = h.db.Exec(`
			UPDATE rider_remittance_payments
			SET status = 'rejected', rejection_reason = ?, verified_by = ?, verified_at = ?
			WHERE id = ?
		`, payload.RejectionReason, userID, now, paymentID)

		return c.JSON(models.APIResponse{Success: true, Message: "Payment rejected"})
	}
}

// AdminGetRiderConfig returns rider system settings (Task 19)
func (h *DeliveryHandler) AdminGetRiderConfig(c *fiber.Ctx) error {
	defaultSlots := h.getRiderFreeSlotsDefault()
	taxPerCollection := h.getRiderRemittanceTaxPerCollection()
	lockThreshold := h.getRiderRemittanceLockThreshold()
	return c.JSON(models.APIResponse{Success: true, Data: fiber.Map{
		"rider_free_slots_default":            defaultSlots,
		"rider_remittance_tax_per_collection": taxPerCollection,
		"rider_remittance_lock_threshold":     lockThreshold,
	}})
}

// AdminUpdateRiderConfig updates rider system settings (Task 19)
func (h *DeliveryHandler) AdminUpdateRiderConfig(c *fiber.Ctx) error {
	var payload struct {
		RiderFreeSlotsDefault           int     `json:"rider_free_slots_default"`
		RiderRemittanceTaxPerCollection float64 `json:"rider_remittance_tax_per_collection"`
		RiderRemittanceLockThreshold    float64 `json:"rider_remittance_lock_threshold"`
	}
	if err := c.BodyParser(&payload); err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid request"})
	}
	if payload.RiderFreeSlotsDefault <= 0 || payload.RiderFreeSlotsDefault > 100 {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid free slots default"})
	}
	if payload.RiderRemittanceTaxPerCollection <= 0 || payload.RiderRemittanceTaxPerCollection > 100 {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid remittance tax per collection"})
	}
	if payload.RiderRemittanceLockThreshold <= 0 || payload.RiderRemittanceLockThreshold > 1000 {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid remittance lock threshold"})
	}
	_, err := h.db.Exec(`
		INSERT INTO app_settings (setting_key, setting_value) VALUES 
			('rider_free_slots_default', ?),
			('rider_remittance_tax_per_collection', ?),
			('rider_remittance_lock_threshold', ?)
		ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)
	`, strconv.Itoa(payload.RiderFreeSlotsDefault), fmt.Sprintf("%.2f", payload.RiderRemittanceTaxPerCollection), fmt.Sprintf("%.2f", payload.RiderRemittanceLockThreshold))
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to update settings"})
	}
	return c.JSON(models.APIResponse{Success: true, Message: "Updated rider configuration"})
}

type AdminRemittancePaymentRow struct {
	ID              int        `json:"id"`
	RiderID         int        `json:"rider_id"`
	RiderUserID     int        `json:"rider_user_id"`
	RiderName       string     `json:"rider_name"`
	RiderEmail      string     `json:"rider_email"`
	AmountPaid      float64    `json:"amount_paid"`
	PaymentMethod   string     `json:"payment_method"`
	ProofURL        string     `json:"payment_proof_url"`
	Status          string     `json:"status"`
	CreatedAt       time.Time  `json:"created_at"`
	VerifiedBy      *int       `json:"verified_by"`
	VerifiedAt      *time.Time `json:"verified_at"`
	RejectionReason string     `json:"rejection_reason"`
}

// AdminListRemittancePayments lists remittance payment submissions for review (Task 20)
func (h *DeliveryHandler) AdminListRemittancePayments(c *fiber.Ctx) error {
	status := strings.TrimSpace(c.Query("status", "pending"))
	if status == "" {
		status = "pending"
	}
	rows, err := h.db.Query(`
		SELECT p.id, p.rider_id, r.user_id, COALESCE(r.name,''), COALESCE(u.email,''),
		       p.amount_paid, COALESCE(p.payment_method,''), COALESCE(p.payment_proof_url,''),
		       p.status, p.created_at, p.verified_by, p.verified_at, COALESCE(p.rejection_reason,'')
		FROM rider_remittance_payments p
		JOIN riders r ON p.rider_id = r.id
		JOIN users u ON r.user_id = u.id
		WHERE p.status = ?
		ORDER BY p.created_at DESC
	`, status)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to fetch payments"})
	}
	defer rows.Close()

	items := make([]AdminRemittancePaymentRow, 0)
	for rows.Next() {
		var it AdminRemittancePaymentRow
		var verifiedBy sql.NullInt64
		var verifiedAt sql.NullTime
		if err := rows.Scan(
			&it.ID, &it.RiderID, &it.RiderUserID, &it.RiderName, &it.RiderEmail,
			&it.AmountPaid, &it.PaymentMethod, &it.ProofURL,
			&it.Status, &it.CreatedAt, &verifiedBy, &verifiedAt, &it.RejectionReason,
		); err != nil {
			continue
		}
		if verifiedBy.Valid {
			v := int(verifiedBy.Int64)
			it.VerifiedBy = &v
		}
		if verifiedAt.Valid {
			t := verifiedAt.Time
			it.VerifiedAt = &t
		}
		items = append(items, it)
	}

	return c.JSON(models.APIResponse{Success: true, Data: items})
}
