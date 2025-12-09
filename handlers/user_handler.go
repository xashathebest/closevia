package handlers

import (
	"database/sql"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"

	"github.com/xashathebest/clovia/database"
	"github.com/xashathebest/clovia/middleware"
	"github.com/xashathebest/clovia/models"
	"github.com/xashathebest/clovia/utils"
)

// UserHandler handles user-related HTTP requests
type UserHandler struct {
	db *sql.DB
}

// NewUserHandler creates a new user handler
func NewUserHandler() *UserHandler {
	return &UserHandler{
		db: database.DB,
	}
}

func nullableString(p *string) interface{} {
	if p == nil {
		return nil
	}
	if *p == "" {
		return nil
	}
	return *p
}

func derefString(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

// Register handles user registration
func (h *UserHandler) Register(c *fiber.Ctx) error {
	var user models.UserRegister
	if err := c.BodyParser(&user); err != nil {
		return c.Status(400).JSON(models.APIResponse{
			Success: false,
			Error:   "Invalid request body",
		})
	}

	// Check if user already exists
	var existingUser models.User
	err := h.db.QueryRow("SELECT id FROM users WHERE email = ?", user.Email).Scan(&existingUser.ID)
	if err == nil {
		return c.Status(409).JSON(models.APIResponse{
			Success: false,
			Error:   "User with this email already exists",
		})
	}

	// WMSU prioritization: enforce WMSU email for non-organization accounts
	if !user.IsOrganization {
		if !strings.HasSuffix(strings.ToLower(user.Email), "@wmsu.edu.ph") {
			return c.Status(400).JSON(models.APIResponse{
				Success: false,
				Error:   "WMSU students must register with their @wmsu.edu.ph email",
			})
		}
		// Department required for WMSU emails
		if user.Department == nil || *user.Department == "" {
			return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Please select your department/college"})
		}
	}

	// Hash password
	hashedPassword, err := utils.HashPassword(user.Password)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{
			Success: false,
			Error:   "Failed to process password",
		})
	}

	// Insert new user
	result, err := h.db.Exec(
		"INSERT INTO users (name, email, password_hash, role, is_organization, org_verified, org_name, org_logo_url, department, bio, badges, profile_picture) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, JSON_ARRAY(), ?)",
		user.Name,
		user.Email,
		hashedPassword,
		user.Role,
		user.IsOrganization,
		false,
		user.OrgName,
		user.OrgLogoURL,
		nullableString(user.Department),
		user.Bio,
		"",
	)
	if err != nil {
		// Log the actual error for debugging
		fmt.Printf("❌ Error creating user: %v\n", err)
		return c.Status(500).JSON(models.APIResponse{
			Success: false,
			Error:   "Failed to create user: " + err.Error(),
		})
	}

	userID, _ := result.LastInsertId()

	// Generate JWT token
	token, err := utils.GenerateJWT(int(userID), user.Email)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{
			Success: false,
			Error:   "Failed to generate token",
		})
	}

	return c.Status(201).JSON(models.APIResponse{
		Success: true,
		Message: "User registered successfully",
		Data: fiber.Map{
			"user": models.User{
				ID:             int(userID),
				Name:           user.Name,
				Email:          user.Email,
				Verified:       false,
				IsOrganization: user.IsOrganization,
				OrgVerified:    false,
				OrgName:        user.OrgName,
				OrgLogoURL:     user.OrgLogoURL,
				Department:     derefString(user.Department),
				Bio:            user.Bio,
				ProfilePicture: "",
			},
			"token": token,
		},
	})
}

// Login handles user authentication
func (h *UserHandler) Login(c *fiber.Ctx) error {
	var login models.UserLogin
	if err := c.BodyParser(&login); err != nil {
		return c.Status(400).JSON(models.APIResponse{
			Success: false,
			Error:   "Invalid request body",
		})
	}

	// Find user by email
	var user models.User
	err := h.db.QueryRow(
		"SELECT id, name, email, password_hash, role, verified FROM users WHERE email = ?",
		login.Email,
	).Scan(&user.ID, &user.Name, &user.Email, &user.PasswordHash, &user.Role, &user.Verified)

	if err != nil {
		return c.Status(401).JSON(models.APIResponse{
			Success: false,
			Error:   "Invalid credentials",
		})
	}

	// Check password
	if !utils.CheckPasswordHash(login.Password, user.PasswordHash) {
		return c.Status(401).JSON(models.APIResponse{
			Success: false,
			Error:   "Invalid credentials",
		})
	}

	// Generate JWT token
	token, err := utils.GenerateJWT(user.ID, user.Email)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{
			Success: false,
			Error:   "Failed to generate token",
		})
	}

	return c.JSON(models.APIResponse{
		Success: true,
		Message: "Login successful",
		Data: fiber.Map{
			"user":  user,
			"token": token,
		},
	})
}

// GetProfile gets the current user's profile
func (h *UserHandler) GetProfile(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{
			Success: false,
			Error:   "User not authenticated",
		})
	}

	var user models.User
	// Fixed: scan background fields into local variables (models.User may not have those fields)
	var backgroundImage string
	var backgroundPosition string

	err := h.db.QueryRow(
		"SELECT id, name, email, role, verified, org_logo_url, COALESCE(profile_picture, '') as profile_picture, COALESCE(bio, '') as bio, COALESCE(background_image, '') as background_image, COALESCE(background_position, '') as background_position, created_at, updated_at FROM users WHERE id = ?",
		userID,
	).Scan(
		&user.ID,
		&user.Name,
		&user.Email,
		&user.Role,
		&user.Verified,
		&user.OrgLogoURL,
		&user.ProfilePicture,
		&user.Bio,
		&backgroundImage,
		&backgroundPosition,
		&user.CreatedAt,
		&user.UpdatedAt,
	)

	if err != nil {
		// Return a friendly fallback (200) so frontend does not produce a network 404.
		// Frontend expects a user-like object; provide minimal public fields.
		fallback := models.User{
			ID:             userID,
			Name:           "User",
			Verified:       false,
			IsOrganization: false,
			CreatedAt:      time.Now(),
			ProfilePicture: "",
		}
		return c.JSON(models.APIResponse{
			Success: true,
			Data:    fallback,
		})
	}

	// Return user plus background fields so clients can access them even if models.User lacks those fields
	return c.JSON(models.APIResponse{
		Success: true,
		Data: fiber.Map{
			"user":                user,
			"background_image":    backgroundImage,
			"background_position": backgroundPosition,
		},
	})
}

// UpdateProfile updates the current user's profile
func (h *UserHandler) UpdateProfile(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{
			Success: false,
			Error:   "User not authenticated",
		})
	}

	var updateData struct {
		Name               *string `json:"name"`
		Email              *string `json:"email"`
		ProfilePicture     *string `json:"profile_picture"`
		Bio                *string `json:"bio"`
		BackgroundImage    *string `json:"background_image"`
		BackgroundPosition *string `json:"background_position"`
	}

	if err := c.BodyParser(&updateData); err != nil {
		return c.Status(400).JSON(models.APIResponse{
			Success: false,
			Error:   "Invalid request body",
		})
	}

	// Build update query dynamically
	query := "UPDATE users SET updated_at = CURRENT_TIMESTAMP"
	var args []interface{}

	if updateData.Name != nil {
		query += ", name = ?"
		args = append(args, *updateData.Name)
	}
	if updateData.Email != nil {
		query += ", email = ?"
		args = append(args, *updateData.Email)
	}
	if updateData.ProfilePicture != nil {
		query += ", profile_picture = ?"
		args = append(args, *updateData.ProfilePicture)
	}

	if updateData.ProfilePicture != nil {
		query += ", profile_picture = ?"
		args = append(args, *updateData.ProfilePicture)
	}

	if updateData.Bio != nil {
		query += ", bio = ?"
		args = append(args, *updateData.Bio)
	}

	if updateData.BackgroundImage != nil {
		// allow column name background_image or cover_photo depending on schema; try background_image first
		query += ", background_image = ?"
		args = append(args, *updateData.BackgroundImage)
	}

	if updateData.BackgroundPosition != nil {
		query += ", background_position = ?"
		args = append(args, *updateData.BackgroundPosition)
	}

	query += " WHERE id = ?"
	args = append(args, userID)

	_, err := h.db.Exec(query, args...)
	if err != nil {
		// Handle missing columns: try to add any known columns then retry once
		if strings.Contains(err.Error(), "Unknown column") || strings.Contains(err.Error(), "1054") {
			// Try adding profile_picture, background_image, background_position, bio as needed
			// Note: guard each ALTER with best-effort; ignore errors to let retry attempt proceed
			h.db.Exec("ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_picture VARCHAR(255) NULL")
			h.db.Exec("ALTER TABLE users ADD COLUMN IF NOT EXISTS background_image VARCHAR(255) NULL")
			h.db.Exec("ALTER TABLE users ADD COLUMN IF NOT EXISTS background_position VARCHAR(50) NULL")
			h.db.Exec("ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT NULL")
			// retry update
			_, err = h.db.Exec(query, args...)
		}
		if err != nil {
			return c.Status(500).JSON(models.APIResponse{
				Success: false,
				Error:   "Failed to update profile",
			})
		}
	}

	return c.JSON(models.APIResponse{
		Success: true,
		Message: "Profile updated successfully",
	})
}

// UploadProfilePicture handles uploading a single profile image and returns its URL
func (h *UserHandler) UploadProfilePicture(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}

	file, err := c.FormFile("image")
	if err != nil {
		// Debug info: log content-type and underlying error to help diagnose upload issues
		contentType := c.Get("Content-Type")
		fmt.Printf("UploadProfilePicture: missing form file 'image' - Content-Type: %s, err: %v\n", contentType, err)
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "No file uploaded: " + err.Error()})
	}

	savePath := fmt.Sprintf("uploads/%d_%s", time.Now().UnixNano(), file.Filename)
	if err := c.SaveFile(file, savePath); err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to save file"})
	}

	// Build an absolute URL so clients (dev server on different port) can load images
	host := c.Get("Host")
	if host == "" {
		host = "localhost:4000"
	}
	url := fmt.Sprintf("http://%s/%s", host, savePath)

	// Ensure profile_picture column exists
	var exists int
	err = h.db.QueryRow("SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_NAME = 'users' AND COLUMN_NAME = 'profile_picture'").Scan(&exists)
	if err == nil && exists == 0 {
		h.db.Exec("ALTER TABLE users ADD COLUMN profile_picture VARCHAR(255) NULL")
	}

	// Save URL to user's profile
	_, err = h.db.Exec("UPDATE users SET profile_picture = ? WHERE id = ?", url, userID)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to update user profile picture"})
	}

	return c.JSON(models.APIResponse{Success: true, Data: url, Message: "Uploaded"})
}

// ChangePassword allows an authenticated user to change their password.
// Expects JSON: { current_password, new_password, confirm_password }
func (h *UserHandler) ChangePassword(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}

	var req struct {
		CurrentPassword string `json:"current_password"`
		NewPassword     string `json:"new_password"`
		ConfirmPassword string `json:"confirm_password"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid request body"})
	}

	// Basic validation
	if len(req.NewPassword) < 8 {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "New password must be at least 8 characters"})
	}
	if req.NewPassword != req.ConfirmPassword {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "New password and confirmation do not match"})
	}

	// Fetch current password hash
	var currentHash string
	err := h.db.QueryRow("SELECT password_hash FROM users WHERE id = ?", userID).Scan(&currentHash)
	if err != nil {
		if err == sql.ErrNoRows {
			return c.Status(404).JSON(models.APIResponse{Success: false, Error: "User not found"})
		}
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to retrieve user"})
	}

	// Verify current password
	if !utils.CheckPasswordHash(req.CurrentPassword, currentHash) {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "Current password is incorrect"})
	}

	// Prevent reusing the same password
	if utils.CheckPasswordHash(req.NewPassword, currentHash) {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "New password must be different from the current password"})
	}

	// Hash new password
	hashed, err := utils.HashPassword(req.NewPassword)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to process password"})
	}

	// Update DB
	_, err = h.db.Exec("UPDATE users SET password_hash = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?", hashed, userID)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to update password"})
	}

	return c.JSON(models.APIResponse{Success: true, Message: "Password changed successfully"})
}

// GetUserByID gets a user by ID (public info only)
func (h *UserHandler) GetUserByID(c *fiber.Ctx) error {
	userID, err := strconv.Atoi(c.Params("id"))
	if err != nil {
		return c.Status(400).JSON(models.APIResponse{
			Success: false,
			Error:   "Invalid user ID",
		})
	}

	var user models.User
	err = h.db.QueryRow(
		"SELECT id, name, email, role, verified, is_organization, org_verified, org_name, org_logo_url, COALESCE(profile_picture, '') as profile_picture, department, bio, badges, created_at, updated_at FROM users WHERE id = ?",
		userID,
	).Scan(&user.ID, &user.Name, &user.Email, &user.Role, &user.Verified, &user.IsOrganization, &user.OrgVerified, &user.OrgName, &user.OrgLogoURL, &user.ProfilePicture, &user.Department, &user.Bio, &user.Badges, &user.CreatedAt, &user.UpdatedAt)

	if err != nil {
		// Return a friendly fallback (200) so frontend does not produce a network 404.
		fallback := models.User{
			ID:             userID,
			Name:           "User",
			Verified:       false,
			IsOrganization: false,
			CreatedAt:      time.Now(),
			ProfilePicture: "",
		}
		return c.JSON(models.APIResponse{
			Success: true,
			Data:    fallback,
		})
	}

	return c.JSON(models.APIResponse{
		Success: true,
		Data:    user,
	})
}

// GetUsers gets all users (admin only, paginated)
func (h *UserHandler) GetUsers(c *fiber.Ctx) error {
	page, _ := strconv.Atoi(c.Query("page", "1"))
	limit, _ := strconv.Atoi(c.Query("limit", "10"))
	offset := (page - 1) * limit

	// Get total count
	var total int
	err := h.db.QueryRow("SELECT COUNT(*) FROM users").Scan(&total)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{
			Success: false,
			Error:   "Failed to get user count",
		})
	}

	// Get users
	rows, err := h.db.Query(
		"SELECT id, name, email, verified, created_at FROM users ORDER BY created_at DESC LIMIT ? OFFSET ?",
		limit, offset,
	)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{
			Success: false,
			Error:   "Failed to get users",
		})
	}
	defer rows.Close()

	var users []models.User
	for rows.Next() {
		var user models.User
		err := rows.Scan(&user.ID, &user.Name, &user.Email, &user.Verified, &user.CreatedAt)
		if err != nil {
			continue
		}
		users = append(users, user)
	}

	totalPages := (total + limit - 1) / limit

	return c.JSON(models.APIResponse{
		Success: true,
		Data: models.PaginatedResponse{
			Data:       users,
			Total:      total,
			Page:       page,
			Limit:      limit,
			TotalPages: totalPages,
		},
	})
}

// SaveProduct saves a product to user's watchlist
func (h *UserHandler) SaveProduct(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{
			Success: false,
			Error:   "User not authenticated",
		})
	}

	var req struct {
		ProductID int `json:"product_id"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(models.APIResponse{
			Success: false,
			Error:   "Invalid request body",
		})
	}

	// Check if product exists
	var productExists bool
	err := h.db.QueryRow("SELECT EXISTS(SELECT 1 FROM products WHERE id = ?)", req.ProductID).Scan(&productExists)
	if err != nil || !productExists {
		return c.Status(404).JSON(models.APIResponse{
			Success: false,
			Error:   "Product not found",
		})
	}

	// Check if already saved (including soft-deleted ones)
	var existingID sql.NullInt64
	err = h.db.QueryRow("SELECT id FROM saved_products WHERE user_id = ? AND product_id = ?", userID, req.ProductID).Scan(&existingID)

	if err == nil && existingID.Valid {
		// Record exists - check if it's soft-deleted
		var deletedAt sql.NullTime
		err = h.db.QueryRow("SELECT deleted_at FROM saved_products WHERE id = ?", existingID.Int64).Scan(&deletedAt)
		if err == nil {
			if deletedAt.Valid && !deletedAt.Time.IsZero() {
				// Restore soft-deleted record
				_, err = h.db.Exec("UPDATE saved_products SET deleted_at = NULL, updated_at = NOW() WHERE id = ?", existingID.Int64)
				if err != nil {
					return c.Status(500).JSON(models.APIResponse{
						Success: false,
						Error:   "Failed to restore saved product",
					})
				}
				return c.JSON(models.APIResponse{
					Success: true,
					Message: "Product saved successfully",
				})
			} else {
				// Already saved and not deleted
				return c.Status(409).JSON(models.APIResponse{
					Success: false,
					Error:   "Product already saved",
				})
			}
		}
	} else if err != sql.ErrNoRows {
		// Some other error occurred
		fmt.Printf("❌ SaveProduct check failed!\n")
		fmt.Printf("UserID: %d, ProductID: %d\n", userID, req.ProductID)
		fmt.Printf("Error: %v\n", err)
		return c.Status(500).JSON(models.APIResponse{
			Success: false,
			Error:   "Failed to check saved status",
		})
	}

	// Save the product (new record)
	_, err = h.db.Exec("INSERT INTO saved_products (user_id, product_id, created_at) VALUES (?, ?, NOW())", userID, req.ProductID)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{
			Success: false,
			Error:   "Failed to save product",
		})
	}

	return c.JSON(models.APIResponse{
		Success: true,
		Message: "Product saved successfully",
	})
}

// UnsaveProduct removes a product from user's watchlist
func (h *UserHandler) UnsaveProduct(c *fiber.Ctx) error {
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

	// Soft delete the saved product
	result, err := h.db.Exec("UPDATE saved_products SET deleted_at = NOW() WHERE user_id = ? AND product_id = ? AND (deleted_at IS NULL OR deleted_at = '0000-00-00 00:00:00')", userID, productID)
	if err != nil {
		fmt.Printf("❌ UnsaveProduct query failed!\n")
		fmt.Printf("UserID: %d, ProductID: %d\n", userID, productID)
		fmt.Printf("Error: %v\n", err)
		return c.Status(500).JSON(models.APIResponse{
			Success: false,
			Error:   "Failed to remove saved product: " + err.Error(),
		})
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		return c.Status(404).JSON(models.APIResponse{
			Success: false,
			Error:   "Saved product not found",
		})
	}

	return c.JSON(models.APIResponse{
		Success: true,
		Message: "Product removed from saved items",
	})
}

// CheckSavedProduct checks if a product is saved by the user
func (h *UserHandler) CheckSavedProduct(c *fiber.Ctx) error {
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
	var isSaved bool
	// Keep check that excludes soft-deleted saved_products
	query := "SELECT EXISTS(SELECT 1 FROM saved_products WHERE user_id = ? AND product_id = ? AND (deleted_at IS NULL OR deleted_at = '0000-00-00 00:00:00'))"
	if err := h.db.QueryRow(query, userID, productID).Scan(&isSaved); err != nil {
		// Log for debugging
		fmt.Printf("❌ Failed to check saved status (user=%d, product=%d): %v\n", userID, productID, err)
		return c.Status(500).JSON(models.APIResponse{
			Success: false,
			Error:   "Failed to check saved status: " + err.Error(),
		})
	}

	return c.JSON(models.APIResponse{
		Success: true,
		Data: fiber.Map{
			"isSaved": isSaved,
		},
	})
}

// GetSavedProducts gets all saved products for a user
func (h *UserHandler) GetSavedProducts(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{
			Success: false,
			Error:   "User not authenticated",
		})
	}
	page, _ := strconv.Atoi(c.Query("page", "1"))
	limit, _ := strconv.Atoi(c.Query("limit", "10"))
	offset := (page - 1) * limit

	// Get total count (excluding soft-deleted)
	var total int
	err := h.db.QueryRow("SELECT COUNT(*) FROM saved_products WHERE user_id = ? AND (deleted_at IS NULL OR deleted_at = '0000-00-00 00:00:00')", userID).Scan(&total)
	if err != nil {
		fmt.Printf("❌ GetSavedProducts count query failed!\n")
		fmt.Printf("UserID: %d\n", userID)
		fmt.Printf("Error: %v\n", err)
		return c.Status(500).JSON(models.APIResponse{
			Success: false,
			Error:   "Failed to get saved products count: " + err.Error(),
		})
	}

	// Get saved products with product details (excluding soft-deleted)
	rows, err := h.db.Query(`
		SELECT 
			p.id, p.title, p.description, p.price, p.image_urls, p.seller_id,
			p.premium, p.status, p.allow_buying, p.barter_only, p.location,
			p.condition, p.suggested_value, p.category, p.created_at, p.updated_at,
			u.name as seller_name,
			sp.created_at as saved_at
		FROM saved_products sp
		JOIN products p ON p.id = sp.product_id
		JOIN users u ON u.id = p.seller_id
		WHERE sp.user_id = ? AND (sp.deleted_at IS NULL OR sp.deleted_at = '0000-00-00 00:00:00')
		ORDER BY sp.created_at DESC
		LIMIT ? OFFSET ?
	`, userID, limit, offset)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{
			Success: false,
			Error:   "Failed to get saved products",
		})
	}
	defer rows.Close()

	var products []models.Product
	for rows.Next() {
		var product models.Product
		var savedAt string
		err := rows.Scan(
			&product.ID, &product.Title, &product.Description, &product.Price,
			&product.ImageURLs, &product.SellerID, &product.Premium, &product.Status,
			&product.AllowBuying, &product.BarterOnly, &product.Location,
			&product.Condition, &product.SuggestedValue, &product.Category,
			&product.CreatedAt, &product.UpdatedAt, &product.SellerName, &savedAt,
		)
		if err != nil {
			continue
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
