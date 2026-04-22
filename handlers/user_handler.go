package handlers

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/json"
	"fmt"
	"math/big"
	"os"
	"path/filepath"
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
	"github.com/xashathebest/clovia/utils"
)

// UserHandler handles user-related HTTP requests
type UserHandler struct {
	db *sql.DB
}

// NewUserHandler creates a new user handler
func NewUserHandler() *UserHandler {
	h := &UserHandler{
		db: database.DB,
	}
	// Auto-migrate home address columns
	// Using plain ALTER TABLE (no IF NOT EXISTS) for MySQL 5.7 compatibility.
	// Duplicate-column errors on subsequent startups are harmlessly discarded.
	_, _ = h.db.Exec("ALTER TABLE users ADD COLUMN home_latitude DOUBLE NULL")
	_, _ = h.db.Exec("ALTER TABLE users ADD COLUMN home_longitude DOUBLE NULL")
	_, _ = h.db.Exec("ALTER TABLE users ADD COLUMN home_address VARCHAR(500) NULL")
	_, _ = h.db.Exec("ALTER TABLE users ADD COLUMN notification_preferences JSON NULL")
	return h
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

// computeActivityStatus returns activity status based on last_login time
func computeActivityStatus(lastLogin *time.Time) string {
	if lastLogin == nil {
		return "inactive"
	}
	since := time.Since(*lastLogin)
	if since < 24*time.Hour {
		return "active_today"
	}
	if since < 7*24*time.Hour {
		return "active_this_week"
	}
	return "inactive"
}

func derefString(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func normalizeOrgHandle(handle string) string {
	h := strings.TrimSpace(strings.ToLower(handle))
	h = strings.TrimPrefix(h, "@")
	return h
}

func isWmsuEmail(email string) bool {
	clean := strings.TrimSpace(strings.ToLower(email))
	return strings.HasSuffix(clean, "@wmsu.edu.ph")
}

func (h *UserHandler) ensureWmsuPlus(user *models.User) {
	if user == nil || user.ID == 0 {
		return
	}
	if !isWmsuEmail(user.Email) {
		return
	}
	if user.IsPremium && user.PremiumTier != "" && user.PremiumTier != "free" {
		return
	}
	_, _ = h.db.Exec("UPDATE users SET is_premium = TRUE, premium_tier = 'plus' WHERE id = ?", user.ID)
	user.IsPremium = true
	user.PremiumTier = "plus"
}

func (h *UserHandler) applyPremiumExpiry(user *models.User) {
	if user == nil || user.ID == 0 {
		return
	}
	if user.PremiumExpiresAt == nil {
		// If there's no expiry but tier is paid, ensure is_premium is consistent.
		if user.PremiumTier != "" && user.PremiumTier != "free" && !user.IsPremium {
			_, _ = h.db.Exec("UPDATE users SET is_premium = TRUE WHERE id = ?", user.ID)
			user.IsPremium = true
		}
		return
	}

	if time.Now().Before(*user.PremiumExpiresAt) {
		if user.PremiumTier != "" && user.PremiumTier != "free" && !user.IsPremium {
			_, _ = h.db.Exec("UPDATE users SET is_premium = TRUE WHERE id = ?", user.ID)
			user.IsPremium = true
		}
		return
	}

	if isWmsuEmail(user.Email) {
		_, _ = h.db.Exec("UPDATE users SET is_premium = TRUE, premium_tier = 'plus', premium_expires_at = NULL WHERE id = ?", user.ID)
		user.IsPremium = true
		user.PremiumTier = "plus"
		user.PremiumExpiresAt = nil
		return
	}

	_, _ = h.db.Exec("UPDATE users SET is_premium = FALSE, premium_tier = 'free', premium_expires_at = NULL WHERE id = ?", user.ID)
	user.IsPremium = false
	user.PremiumTier = "free"
	user.PremiumExpiresAt = nil
}

// generateUserSlug creates a URL-friendly slug from name and appends a short UUID
func generateUserSlug(name string) string {
	slug := strings.ToLower(name)

	// Remove special characters, keep only alphanumeric, spaces, and hyphens
	slug = strings.Map(func(r rune) rune {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == ' ' || r == '-' {
			return r
		}
		return -1
	}, slug)

	// Replace spaces with hyphens
	slug = strings.ReplaceAll(slug, " ", "-")

	// Remove multiple consecutive hyphens
	for strings.Contains(slug, "--") {
		slug = strings.ReplaceAll(slug, "--", "-")
	}

	slug = strings.Trim(slug, "-")

	if len(slug) > 30 {
		slug = slug[:30]
		slug = strings.TrimRight(slug, "-")
	}

	shortUUID := uuid.New().String()[:8]
	return fmt.Sprintf("%s-%s", slug, shortUUID)
}

// ResolveUserID resolves an identifier (either numeric ID or slug) to a numeric user ID
func (h *UserHandler) ResolveUserID(identifier string) (int, error) {
	// First, try parsing as an integer
	if id, err := strconv.Atoi(identifier); err == nil {
		// Verify the user exists with this ID
		var exists int
		err := h.db.QueryRow("SELECT id FROM users WHERE id = ?", id).Scan(&exists)
		if err == nil {
			return exists, nil
		}
		// If the ID isn't found, we can optionally fall back to checking if a slug is purely digits
		// But usually it just means "not found"
		if err != sql.ErrNoRows {
			return 0, err
		}
	}

	// If it's not a valid integer or ID not found, treat it as a slug
	var id int
	err := h.db.QueryRow("SELECT id FROM users WHERE slug = ?", identifier).Scan(&id)
	if err != nil {
		return 0, err
	}
	return id, nil
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
	var existingUser struct {
		ID       int
		Verified bool
	}
	// Use context with timeout to prevent hanging queries (requires index on email)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	err := h.db.QueryRowContext(ctx, "SELECT id, verified FROM users WHERE email = ?", user.Email).Scan(&existingUser.ID, &existingUser.Verified)
	cancel()
	if err == nil {
		if !existingUser.Verified {
			// User exists but not verified: resend OTP and return requires_verification
			otpCode, otpHash, otpExpiry, otpErr := generateOTP()
			if otpErr == nil {
				h.db.Exec(
					"UPDATE users SET email_otp_hash = ?, email_otp_expires = ? WHERE id = ?",
					otpHash, otpExpiry, existingUser.ID,
				)
				go func() {
					_ = h.db.QueryRow("SELECT name FROM users WHERE id = ?", existingUser.ID).Scan(&user.Name)
					err := services.SendOTPEmail(user.Email, user.Name, otpCode)
					if err != nil {
						fmt.Printf("❌ Failed to send OTP email: %v\n", err)
					}
				}()
			}
			return c.Status(200).JSON(models.APIResponse{
				Success: true,
				Message: "Account already exists but is not verified. Verification code resent.",
				Data: fiber.Map{
					"requires_verification": true,
					"email":                 user.Email,
				},
			})
		}
		// User exists and is verified
		return c.Status(409).JSON(models.APIResponse{
			Success: false,
			Error:   "User with this email already exists",
		})
	}

	// Department validation removed

	// Strict password validation
	if len(user.Password) < 8 {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Password must be at least 8 characters long"})
	}
	if matched, _ := regexp.MatchString(`[A-Z]`, user.Password); !matched {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Password must contain at least one uppercase letter"})
	}
	if matched, _ := regexp.MatchString(`[a-z]`, user.Password); !matched {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Password must contain at least one lowercase letter"})
	}
	if matched, _ := regexp.MatchString(`[0-9]`, user.Password); !matched {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Password must contain at least one number"})
	}
	if matched, _ := regexp.MatchString(`[!@#$%^&*(),.?":{}|<>]`, user.Password); !matched {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Password must contain at least one special character"})
	}

	// Hash password
	hashedPassword, err := utils.HashPassword(user.Password)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{
			Success: false,
			Error:   "Failed to process password",
		})
	}

	// Generate slug for the new user
	slug := generateUserSlug(user.Name)

	// Ensure unique slug (with context timeout)
	baseSlug := slug
	counter := 1
	for {
		ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
		var exists int
		err := h.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM users WHERE slug = ?", slug).Scan(&exists)
		cancel()
		if err != nil || exists == 0 {
			break
		}
		slug = fmt.Sprintf("%s-%d", baseSlug, counter)
		counter++
	}

	// Insert new user
	cleanPhone := strings.TrimSpace(user.Phone)
	if cleanPhone != "" {
		// Only allow PH numbers: must be 11 digits, start with '09' or '9', and store as +63XXXXXXXXXX
		phoneRegex := regexp.MustCompile(`^(09|9)\d{9}$`)
		if !phoneRegex.MatchString(cleanPhone) {
			return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Phone number must be 11 digits and start with 09 (PH mobile only)"})
		}
		// Normalize to +63XXXXXXXXXX
		if strings.HasPrefix(cleanPhone, "0") {
			cleanPhone = "+63" + cleanPhone[1:]
		} else if strings.HasPrefix(cleanPhone, "9") {
			cleanPhone = "+63" + cleanPhone
		}
	}

	result, err := h.db.Exec(
		"INSERT INTO users (slug, name, email, phone, password_hash, role, is_organization, org_verified, org_name, org_logo_url, department, bio, badges, profile_picture, language_preference, premium_tier) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, JSON_ARRAY(), ?, ?, ?)",
		slug,
		user.Name,
		user.Email,
		nullableString(&cleanPhone),
		hashedPassword,
		user.Role,
		user.IsOrganization,
		false,
		user.OrgName,
		user.OrgLogoURL,
		nullableString(user.Department),
		user.Bio,
		"",
		"en",
		"free",
	)
	if err != nil {
		// Log the actual error for debugging
		fmt.Printf("❌ Error creating user: %v\n", err)
		return c.Status(500).JSON(models.APIResponse{
			Success: false,
			Error:   "Failed to create user",
		})
	}

	userID, _ := result.LastInsertId()

	// Generate and send OTP for email verification
	otpCode, otpHash, otpExpiry, otpErr := generateOTP()
	requiresVerification := true
	if otpErr == nil {
		h.db.Exec(
			"UPDATE users SET email_otp_hash = ?, email_otp_expires = ? WHERE id = ?",
			otpHash, otpExpiry, userID,
		)
		go func() {
			err := services.SendOTPEmail(user.Email, user.Name, otpCode)
			if err != nil {
				fmt.Printf("❌ Failed to send OTP email: %v\n", err)
			}
		}()
	} else {
		fmt.Printf("⚠️ OTP generation failed: %v\n", otpErr)
		// Fallback: If OTP generation fails, mark as verified for safety
		h.db.Exec("UPDATE users SET verified = TRUE WHERE id = ?", userID)
		requiresVerification = false
	}

	return c.Status(201).JSON(models.APIResponse{
		Success: true,
		Message: "User registered successfully. Please verify your email.",
		Data: fiber.Map{
			"user": models.User{
				ID:                 int(userID),
				Slug:               slug,
				Name:               user.Name,
				Email:              user.Email,
				Phone:              cleanPhone,
				PhoneVerified:      false,
				Verified:           !requiresVerification,
				IsOrganization:     user.IsOrganization,
				OrgVerified:        false,
				OrgName:            user.OrgName,
				OrgLogoURL:         user.OrgLogoURL,
				Department:         derefString(user.Department),
				Bio:                user.Bio,
				ProfilePicture:     "",
				LanguagePreference: "en",
				IsPremium:          false,
				PremiumTier:        "free",
			},
			"requires_verification": requiresVerification,
		},
	})
}

// generateOTP creates a 6-digit code, returns (plainCode, bcryptHash, expiry, error)
func generateOTP() (string, string, time.Time, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
	if err != nil {
		return "", "", time.Time{}, err
	}
	code := fmt.Sprintf("%06d", n.Int64())
	hash, err := utils.HashPassword(code)
	if err != nil {
		return "", "", time.Time{}, err
	}
	expiry := time.Now().Add(10 * time.Minute)
	return code, hash, expiry, nil
}

// VerifyEmail verifies the OTP code sent to the user's email.
// POST /api/auth/verify-email  { email, code }
func (h *UserHandler) VerifyEmail(c *fiber.Ctx) error {
	var req struct {
		Email string `json:"email"`
		Code  string `json:"code"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid request body"})
	}
	if req.Email == "" || req.Code == "" {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Email and code are required"})
	}

	var userID int
	var storedHash string
	var expires time.Time
	var verified bool

	err := h.db.QueryRow(
		"SELECT id, COALESCE(email_otp_hash,''), COALESCE(email_otp_expires, NOW()), verified FROM users WHERE email = ?",
		req.Email,
	).Scan(&userID, &storedHash, &expires, &verified)

	if err != nil {
		return c.Status(404).JSON(models.APIResponse{Success: false, Error: "User not found"})
	}
	if verified {
		return c.JSON(models.APIResponse{Success: true, Message: "Email is already verified"})
	}
	if storedHash == "" {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "No verification code found. Please request a new one."})
	}
	if time.Now().After(expires) {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Verification code has expired. Please request a new one."})
	}
	if !utils.CheckPasswordHash(req.Code, storedHash) {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid verification code"})
	}

	// Mark verified and clear OTP
	// Auto-grant premium for WMSU students (@wmsu.edu.ph email) after verification
	isWmsuStudent := strings.HasSuffix(strings.ToLower(req.Email), "@wmsu.edu.ph")

	query := "UPDATE users SET verified = true, email_otp_hash = NULL, email_otp_expires = NULL"
	if isWmsuStudent {
		query += ", is_premium = true, premium_tier = 'plus'"
	}
	query += " WHERE id = ?"

	_, err = h.db.Exec(query, userID)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to verify email"})
	}

	// Generate JWT token now that they are verified
	token, err := utils.GenerateJWT(userID, req.Email)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to generate token"})
	}
	utils.SetAuthCookie(c, token)

	return c.JSON(models.APIResponse{
		Success: true,
		Message: "Email verified successfully",
		Data:    fiber.Map{"token": token},
	})
}

// ResendVerification resends the OTP to the user's email.
// POST /api/auth/resend-verification  { email }
func (h *UserHandler) ResendVerification(c *fiber.Ctx) error {
	var req struct {
		Email string `json:"email"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid request body"})
	}
	if req.Email == "" {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Email is required"})
	}

	var userID int
	var userName string
	var verified bool
	var currentExpires sql.NullTime

	err := h.db.QueryRow(
		"SELECT id, name, verified, email_otp_expires FROM users WHERE email = ?",
		req.Email,
	).Scan(&userID, &userName, &verified, &currentExpires)

	if err != nil {
		return c.Status(404).JSON(models.APIResponse{Success: false, Error: "User not found"})
	}
	if verified {
		return c.JSON(models.APIResponse{Success: true, Message: "Email is already verified"})
	}

	// Cooldown: block resend if previous OTP was sent less than 60 seconds ago
	if currentExpires.Valid {
		secondsUntilExpiry := time.Until(currentExpires.Time).Seconds()
		// OTP was set for 10 min; if > 9 min remain it was sent <60s ago
		if secondsUntilExpiry > float64(9*60) {
			return c.Status(429).JSON(models.APIResponse{
				Success: false,
				Error:   "Please wait 60 seconds before requesting a new code",
			})
		}
	}

	// Generate new OTP
	otpCode, otpHash, otpExpiry, otpErr := generateOTP()
	if otpErr != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to generate verification code"})
	}

	_, err = h.db.Exec(
		"UPDATE users SET email_otp_hash = ?, email_otp_expires = ? WHERE id = ?",
		otpHash, otpExpiry, userID,
	)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to update verification code"})
	}

	go services.SendOTPEmail(req.Email, userName, otpCode)

	return c.JSON(models.APIResponse{Success: true, Message: "Verification code resent"})
}

// ForgotPassword sends a password reset OTP to the user's email.
// POST /api/auth/forgot-password  { email }
func (h *UserHandler) ForgotPassword(c *fiber.Ctx) error {
	var req struct {
		Email string `json:"email"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid request body"})
	}

	if req.Email == "" {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Email is required"})
	}

	// Look up user — always return success to prevent email enumeration
	var userID int
	var userName string
	var currentExpires sql.NullTime
	err := h.db.QueryRow(
		"SELECT id, name, password_reset_otp_expires FROM users WHERE email = ?",
		req.Email,
	).Scan(&userID, &userName, &currentExpires)
	if err != nil {
		// User not found — return success anyway (security: no email enumeration)
		return c.JSON(models.APIResponse{Success: true, Message: "If an account with that email exists, a reset code has been sent."})
	}

	// Cooldown: block resend if previous OTP was sent less than 60 seconds ago
	if currentExpires.Valid {
		secondsUntilExpiry := time.Until(currentExpires.Time).Seconds()
		// OTP is set for 15 min; if > 14 min remain it was sent <60s ago
		if secondsUntilExpiry > float64(14*60) {
			return c.Status(429).JSON(models.APIResponse{
				Success: false,
				Error:   "Please wait 60 seconds before requesting a new code",
			})
		}
	}

	// Generate 6-digit OTP with 15-minute expiry
	otpCode, otpHash, _, otpErr := generateOTP()
	if otpErr != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to generate reset code"})
	}
	otpExpiry := time.Now().Add(15 * time.Minute)

	_, err = h.db.Exec(
		"UPDATE users SET password_reset_otp_hash = ?, password_reset_otp_expires = ? WHERE id = ?",
		otpHash, otpExpiry, userID,
	)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to save reset code"})
	}

	go func() {
		if err := services.SendPasswordResetEmail(req.Email, userName, otpCode); err != nil {
			fmt.Printf("❌ Failed to send password reset email to %s: %v\n", req.Email, err)
		}
	}()

	return c.JSON(models.APIResponse{Success: true, Message: "If an account with that email exists, a reset code has been sent."})
}

// ResetPassword verified OTP and updates the user's password.
// POST /api/auth/reset-password  { email, code, new_password }
func (h *UserHandler) ResetPassword(c *fiber.Ctx) error {
	var req struct {
		Email       string `json:"email"`
		Code        string `json:"code"`
		NewPassword string `json:"new_password"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid request body"})
	}

	if req.Email == "" || req.Code == "" || req.NewPassword == "" {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Email, code, and new password are required"})
	}
	if len(req.NewPassword) < 6 {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Password must be at least 6 characters"})
	}

	// Look up user and OTP
	var userID int
	var otpHash sql.NullString
	var otpExpires sql.NullTime
	err := h.db.QueryRow(
		"SELECT id, password_reset_otp_hash, password_reset_otp_expires FROM users WHERE email = ?",
		req.Email,
	).Scan(&userID, &otpHash, &otpExpires)
	if err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid email or code"})
	}

	// Verify OTP exists and hasn't expired
	if !otpHash.Valid || !otpExpires.Valid {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "No reset code found. Please request a new one."})
	}
	if time.Now().After(otpExpires.Time) {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Reset code has expired. Please request a new one."})
	}

	// Verify OTP matches
	if !utils.CheckPasswordHash(req.Code, otpHash.String) {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid reset code"})
	}

	// Hash new password and update
	newHash, err := utils.HashPassword(req.NewPassword)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to process new password"})
	}

	_, err = h.db.Exec(
		"UPDATE users SET password_hash = ?, password_reset_otp_hash = NULL, password_reset_otp_expires = NULL WHERE id = ?",
		newHash, userID,
	)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to update password"})
	}

	return c.JSON(models.APIResponse{Success: true, Message: "Password reset successful. You can now log in with your new password."})
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

	// Find user by email - optimized single query with graceful nullable handling
	var user models.User
	var premiumExpiresAt sql.NullTime

	// Use context with timeout to prevent hanging queries (requires index on email)
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	err := h.db.QueryRowContext(ctx, `
		SELECT id, COALESCE(slug, ''), name, email, password_hash, role, verified, 
		       COALESCE(is_premium, FALSE), COALESCE(premium_tier, 'free'), premium_expires_at,
		       COALESCE(strikes, 0), COALESCE(is_suspended, FALSE)
		FROM users WHERE email = ?`,
		login.Email,
	).Scan(&user.ID, &user.Slug, &user.Name, &user.Email, &user.PasswordHash, &user.Role, &user.Verified,
		&user.IsPremium, &user.PremiumTier, &premiumExpiresAt, &user.Strikes, &user.IsSuspended)
	cancel()

	if err != nil {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "Invalid credentials"})
	}

	// Check if user is verified - for testing, allow unverified users to login
	// In production, uncomment the check below
	// if !user.Verified {
	// 	return c.Status(401).JSON(models.APIResponse{
	// 		Success: false,
	// 		Error:   "Please verify your email address before logging in.",
	// 	})
	// }

	// Check for strikes suspension ladder
	if user.IsSuspended || user.Strikes >= 3 {
		return c.Status(403).JSON(models.APIResponse{
			Success: false,
			Error:   "Your account has been auto-suspended pending admin review due to multiple strikes or policy violations.",
		})
	}

	// Check password
	if !utils.CheckPasswordHash(login.Password, user.PasswordHash) {
		return c.Status(401).JSON(models.APIResponse{
			Success: false,
			Error:   "Invalid credentials",
		})
	}

	if premiumExpiresAt.Valid {
		user.PremiumExpiresAt = &premiumExpiresAt.Time
	}

	// Update last_login timestamp ASYNCHRONOUSLY (non-blocking)
	go func() {
		_, _ = h.db.Exec("UPDATE users SET last_login = NOW() WHERE id = ?", user.ID)
	}()

	h.applyPremiumExpiry(&user)
	h.ensureWmsuPlus(&user)

	now := time.Now()
	user.LastLogin = &now
	user.ActivityStatus = "active_today"

	// Generate JWT token
	token, err := utils.GenerateJWT(user.ID, user.Email)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{
			Success: false,
			Error:   "Failed to generate token",
		})
	}
	utils.SetAuthCookie(c, token)

	return c.JSON(models.APIResponse{
		Success: true,
		Message: "Login successful",
		Data: fiber.Map{
			"user":  user,
			"token": token,
		},
	})
}

func (h *UserHandler) Logout(c *fiber.Ctx) error {
	utils.ClearAuthCookie(c)
	return c.JSON(models.APIResponse{
		Success: true,
		Message: "Logged out",
	})
}

func (h *UserHandler) RefreshSession(c *fiber.Ctx) error {
	token := ""
	authHeader := c.Get("Authorization")
	if strings.HasPrefix(authHeader, "Bearer ") {
		token = strings.TrimSpace(strings.TrimPrefix(authHeader, "Bearer "))
	}
	if token == "" {
		token = strings.TrimSpace(c.Cookies(utils.AuthCookieName))
	}
	if token == "" {
		return c.Status(fiber.StatusUnauthorized).JSON(models.APIResponse{
			Success: false,
			Error:   "Authentication required",
		})
	}
	if _, err := utils.ValidateJWT(token); err != nil {
		utils.ClearAuthCookie(c)
		return c.Status(fiber.StatusUnauthorized).JSON(models.APIResponse{
			Success: false,
			Error:   "Invalid or expired token",
		})
	}
	utils.SetAuthCookie(c, token)
	return c.JSON(models.APIResponse{
		Success: true,
		Message: "Session refreshed",
		Data: fiber.Map{
			"idle_timeout_seconds": int(utils.SessionIdleTimeout().Seconds()),
		},
	})
}

// GoogleLogin handles Google OAuth authentication
func (h *UserHandler) GoogleLogin(c *fiber.Ctx) error {
	var req struct {
		IDToken     string `json:"idToken"`
		UID         string `json:"uid"`
		Email       string `json:"email"`
		DisplayName string `json:"displayName"`
		PhotoURL    string `json:"photoURL"`
	}

	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(models.APIResponse{
			Success: false,
			Error:   "Invalid request body",
		})
	}

	if req.Email == "" {
		return c.Status(400).JSON(models.APIResponse{
			Success: false,
			Error:   "Email is required",
		})
	}

	// Check if user exists
	var user models.User
	var premiumExpiresAt sql.NullTime
	err := h.db.QueryRow(
		"SELECT id, slug, name, email, role, verified, profile_picture, language_preference, COALESCE(is_premium, FALSE), COALESCE(premium_tier, 'free'), premium_expires_at, strikes, is_suspended FROM users WHERE email = ?",
		req.Email,
	).Scan(&user.ID, &user.Slug, &user.Name, &user.Email, &user.Role, &user.Verified, &user.ProfilePicture, &user.LanguagePreference, &user.IsPremium, &user.PremiumTier, &premiumExpiresAt, &user.Strikes, &user.IsSuspended)

	if err == sql.ErrNoRows {
		// Generate slug for the new user
		slug := generateUserSlug(req.DisplayName)

		// Ensure slug is unique
		baseSlug := slug
		counter := 1
		for {
			var exists int
			err := h.db.QueryRow("SELECT COUNT(*) FROM users WHERE slug = ?", slug).Scan(&exists)
			if err != nil || exists == 0 {
				break
			}
			slug = fmt.Sprintf("%s-%d", baseSlug, counter)
			counter++
		}

		premium_tier := "free"
		is_premium := false
		if strings.HasSuffix(strings.ToLower(req.Email), "@wmsu.edu.ph") {
			premium_tier = "plus"
			is_premium = true
		}

		// Create new user from Google info
		result, err := h.db.Exec(
			"INSERT INTO users (slug, name, email, role, verified, profile_picture, is_organization, org_verified, badges, language_preference, premium_tier, is_premium) VALUES (?, ?, ?, ?, ?, ?, ?, ?, JSON_ARRAY(), ?, ?, ?)",
			slug,
			req.DisplayName,
			req.Email,
			"user",
			true, // Mark as verified since they authenticated with Google
			req.PhotoURL,
			false,
			false,
			"en",
			premium_tier,
			is_premium,
		)
		if err != nil {
			fmt.Printf("❌ Error creating Google user: %v\n", err)
			return c.Status(500).JSON(models.APIResponse{
				Success: false,
				Error:   "Failed to create user",
			})
		}

		userID, _ := result.LastInsertId()
		user.ID = int(userID)
		user.Slug = slug
		user.Name = req.DisplayName
		user.Email = req.Email
		user.Verified = true
		user.ProfilePicture = req.PhotoURL
		user.Role = "user"
		user.LanguagePreference = "en"
		user.PremiumTier = premium_tier
		user.IsPremium = is_premium
	} else if err != nil {
		return c.Status(500).JSON(models.APIResponse{
			Success: false,
			Error:   "Database error",
		})
	}

	if premiumExpiresAt.Valid {
		user.PremiumExpiresAt = &premiumExpiresAt.Time
	}

	h.applyPremiumExpiry(&user)
	h.ensureWmsuPlus(&user)

	// Check if user is suspended or has 3+ strikes
	if user.IsSuspended || user.Strikes >= 3 {
		return c.Status(403).JSON(models.APIResponse{
			Success: false,
			Error:   "Your account has been auto-suspended pending admin review due to multiple strikes or policy violations.",
		})
	}

	// Update last_login timestamp
	h.db.Exec("UPDATE users SET last_login = NOW() WHERE id = ?", user.ID)
	now := time.Now()
	user.LastLogin = &now
	user.ActivityStatus = "active_today"

	// Generate JWT token
	token, err := utils.GenerateJWT(user.ID, user.Email)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{
			Success: false,
			Error:   "Failed to generate token",
		})
	}
	utils.SetAuthCookie(c, token)

	return c.JSON(models.APIResponse{
		Success: true,
		Message: "Google login successful",
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
	var schoolEmailVerifiedAt sql.NullTime
	var passwordChangedAt sql.NullTime
	var displayNameChangedAt sql.NullTime
	var nameChangedAt sql.NullTime
	var phoneChangedAt sql.NullTime
	var emailChangedAt sql.NullTime
	var lastLogin sql.NullTime
	var premiumExpiresAt sql.NullTime

	var slugNull sql.NullString
	err := h.db.QueryRow(
		`SELECT id, slug, name, email, role, verified,
		        COALESCE(phone, '') AS phone,
		        COALESCE(phone_verified, FALSE) AS phone_verified,
		        COALESCE(is_organization, FALSE) AS is_organization, COALESCE(org_verified, FALSE) AS org_verified, COALESCE(org_name, '') AS org_name,
		        COALESCE(org_handle, '') AS org_handle,
		        COALESCE(org_logo_url, '') AS org_logo_url,
		        COALESCE(org_cover_url, '') AS org_cover_url,
		        COALESCE(org_category, '') AS org_category,
		        COALESCE(org_website, '') AS org_website,
		        COALESCE(org_location, '') AS org_location,
		        COALESCE(org_contact_email, '') AS org_contact_email,
		        COALESCE(profile_picture, '') AS profile_picture,
		        COALESCE(bio, '') AS bio,
		        COALESCE(background_image, '') AS background_image,
		        COALESCE(background_position, '') AS background_position,
		        COALESCE(department, '') AS department,
		        COALESCE(badges, '[]') AS badges,
		        COALESCE(is_premium, FALSE) AS is_premium,
		        COALESCE(verification_status, 'not_verified') AS verification_status,
		        COALESCE(school_name, '') AS school_name,
		        COALESCE(school_email, '') AS school_email,
		        COALESCE(academic_program, '') AS academic_program,
		        COALESCE(year_level, '') AS year_level,
		        school_email_verified_at,
		        COALESCE(verification_rejection_reason, '') AS verification_rejection_reason,
		        COALESCE(email_notifications_enabled, TRUE) AS email_notifications_enabled,
		        COALESCE(push_notifications_enabled, TRUE) AS push_notifications_enabled,
		        COALESCE(notification_preferences, '{}') AS notification_preferences,
		        COALESCE(language_preference, 'en') AS language_preference,
		        COALESCE(premium_tier, 'free') AS premium_tier,
		        premium_expires_at,
		        COALESCE(strikes, 0) AS strikes,
		        COALESCE(is_suspended, FALSE) AS is_suspended,
		        created_at, updated_at, password_changed_at, display_name_changed_at, name_changed_at, phone_changed_at, email_changed_at, last_login,
		        home_latitude, home_longitude, COALESCE(home_address, '') AS home_address
		 FROM users WHERE id = ?`,
		userID,
	).Scan(
		&user.ID, &slugNull, &user.Name, &user.Email, &user.Role, &user.Verified,
		&user.Phone, &user.PhoneVerified,
		&user.IsOrganization, &user.OrgVerified, &user.OrgName,
		&user.OrgHandle, &user.OrgLogoURL, &user.OrgCoverURL, &user.OrgCategory,
		&user.OrgWebsite, &user.OrgLocation, &user.OrgContactEmail,
		&user.ProfilePicture, &user.Bio, &user.BackgroundImage,
		&user.BackgroundPosition, &user.Department, &user.Badges, &user.IsPremium,
		&user.VerificationStatus, &user.SchoolName, &user.SchoolEmail, &user.AcademicProgram, &user.YearLevel, &schoolEmailVerifiedAt, &user.VerificationRejectionReason,
		&user.EmailNotificationsEnabled, &user.PushNotificationsEnabled,
		&user.NotificationPreferences,
		&user.LanguagePreference, &user.PremiumTier, &premiumExpiresAt, &user.Strikes, &user.IsSuspended,
		&user.CreatedAt, &user.UpdatedAt, &passwordChangedAt, &displayNameChangedAt, &nameChangedAt, &phoneChangedAt, &emailChangedAt, &lastLogin,
		&user.HomeLatitude, &user.HomeLongitude, &user.HomeAddress,
	)

	if schoolEmailVerifiedAt.Valid {
		user.SchoolEmailVerifiedAt = &schoolEmailVerifiedAt.Time
	}
	if passwordChangedAt.Valid {
		user.PasswordChangedAt = &passwordChangedAt.Time
	}
	if displayNameChangedAt.Valid {
		user.DisplayNameChangedAt = &displayNameChangedAt.Time
	}
	if nameChangedAt.Valid {
		user.NameChangedAt = &nameChangedAt.Time
	}
	if phoneChangedAt.Valid {
		user.PhoneChangedAt = &phoneChangedAt.Time
	}
	if emailChangedAt.Valid {
		user.EmailChangedAt = &emailChangedAt.Time
	}
	if lastLogin.Valid {
		user.LastLogin = &lastLogin.Time
	}
	if premiumExpiresAt.Valid {
		user.PremiumExpiresAt = &premiumExpiresAt.Time
	}
	user.ActivityStatus = computeActivityStatus(user.LastLogin)
	if slugNull.Valid {
		user.Slug = slugNull.String
	}
	// Normalize legacy rows: if is_premium=true but tier is empty/free, treat as plus.
	if user.IsPremium && (user.PremiumTier == "" || user.PremiumTier == "free") {
		user.PremiumTier = "plus"
		_, _ = h.db.Exec("UPDATE users SET premium_tier = 'plus' WHERE id = ? AND is_premium = true AND (premium_tier IS NULL OR premium_tier = '' OR premium_tier = 'free')", userID)
	}

	h.applyPremiumExpiry(&user)
	h.ensureWmsuPlus(&user)

	if err != nil {
		fmt.Printf("❌ ERROR in GetProfile (ID: %v): %v\n", userID, err)
		// Return a proper error response so frontend can handle it correctly
		// Check if it's a "no rows" error (user doesn't exist)
		if err == sql.ErrNoRows {
			return c.Status(404).JSON(models.APIResponse{
				Success: false,
				Error:   "User not found",
			})
		}
		return c.Status(500).JSON(models.APIResponse{
			Success: false,
			Error:   "Failed to fetch user profile",
		})
	}

	// Profile Insights
	var profileViews int
	// Use a short timeout for profile_views queries to prevent hanging
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
	defer cancel()

	err = h.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM profile_views WHERE target_user_id = ?", user.ID).Scan(&profileViews)
	if err != nil {
		// If profile_views query fails (table missing or timeout), just set to 0
		fmt.Printf("⚠️ Profile views query failed: %v\n", err)
		profileViews = 0
	}

	var viewHistory []fiber.Map
	// Plus and Pro users can see who viewed their profile
	if user.PremiumTier != "free" {
		ctx2, cancel2 := context.WithTimeout(context.Background(), 2*time.Second)
		defer cancel2()

		rows, qErr := h.db.QueryContext(ctx2, `
			SELECT DISTINCT u.id, u.name, COALESCE(u.profile_picture, '') as profile_picture, MAX(pv.viewed_at) as last_viewed
			FROM profile_views pv
			JOIN users u ON pv.viewer_user_id = u.id
			WHERE pv.target_user_id = ?
			GROUP BY u.id, u.name, u.profile_picture
			ORDER BY last_viewed DESC
			LIMIT 10`, user.ID)
		if qErr == nil && rows != nil {
			defer rows.Close()
			for rows.Next() {
				var vID int
				var vName, vAvatar string
				var lv time.Time
				rows.Scan(&vID, &vName, &vAvatar, &lv)
				viewHistory = append(viewHistory, fiber.Map{
					"id":        vID,
					"name":      vName,
					"avatar":    vAvatar,
					"viewed_at": lv,
				})
			}
		} else if qErr != nil {
			fmt.Printf("⚠️ View history query failed: %v\n", qErr)
		}
	}

	return c.JSON(models.APIResponse{
		Success: true,
		Data: fiber.Map{
			"user":          user,
			"profile_views": profileViews,
			"view_history":  viewHistory,
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
		Name                      *string  `json:"name"`
		Email                     *string  `json:"email"`
		Phone                     *string  `json:"phone"`
		ProfilePicture            *string  `json:"profile_picture"`
		Bio                       *string  `json:"bio"`
		AcademicProgram           *string  `json:"academic_program"`
		YearLevel                 *string  `json:"year_level"`
		BackgroundImage           *string  `json:"background_image"`
		BackgroundPosition        *string  `json:"background_position"`
		LanguagePreference        *string  `json:"language_preference"`
		EmailNotificationsEnabled *bool    `json:"email_notifications_enabled"`
		PushNotificationsEnabled  *bool    `json:"push_notifications_enabled"`
		NotificationPreferences   *string  `json:"notification_preferences"`
		HomeLatitude              *float64 `json:"home_latitude"`
		HomeLongitude             *float64 `json:"home_longitude"`
		HomeAddress               *string  `json:"home_address"`
	}

	if err := c.BodyParser(&updateData); err != nil {
		return c.Status(400).JSON(models.APIResponse{
			Success: false,
			Error:   "Invalid request body",
		})
	}

	// Handle email change logic: if email is updated, mark user as unverified and send new OTP
	var newEmail string
	var currentEmail string
	var emailChanged bool

	if updateData.Email != nil {
		newEmail = strings.TrimSpace(strings.ToLower(*updateData.Email))
		emailRegex := regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)
		if !emailRegex.MatchString(newEmail) {
			return c.Status(400).JSON(models.APIResponse{
				Success: false,
				Error:   "Please enter a valid email address.",
			})
		}
		// Get current email to compare
		err := h.db.QueryRow("SELECT email FROM users WHERE id = ?", userID).Scan(&currentEmail)
		if err == nil && newEmail != "" && newEmail != currentEmail {
			emailChanged = true
			var emailChangedAt sql.NullTime
			if err := h.db.QueryRow("SELECT email_changed_at FROM users WHERE id = ?", userID).Scan(&emailChangedAt); err == nil && emailChangedAt.Valid {
				canChangeAt := emailChangedAt.Time.AddDate(0, 3, 0)
				if time.Now().Before(canChangeAt) {
					return c.Status(429).JSON(models.APIResponse{
						Success: false,
						Error:   "Email can only be changed once every 3 months for account security.",
						Data: fiber.Map{
							"field":           "email",
							"last_changed_at": emailChangedAt.Time,
							"can_change_at":   canChangeAt,
						},
					})
				}
			}

			// Check if new email is already taken by another user
			var exists int
			h.db.QueryRow("SELECT COUNT(*) FROM users WHERE email = ? AND id != ?", newEmail, userID).Scan(&exists)
			if exists > 0 {
				return c.Status(400).JSON(models.APIResponse{
					Success: false,
					Error:   "This email is already registered to another account",
				})
			}
		}
	}

	var normalizedPhone string
	var phoneChanged bool
	if updateData.Phone != nil {
		normalizedPhone = strings.TrimSpace(*updateData.Phone)
		phoneRegex := regexp.MustCompile(`^09\d{9}$`)
		if !phoneRegex.MatchString(normalizedPhone) {
			return c.Status(400).JSON(models.APIResponse{
				Success: false,
				Error:   "Use a valid Philippine mobile number in 11-digit format, like 09XXXXXXXXX.",
			})
		}

		var currentPhone sql.NullString
		err := h.db.QueryRow("SELECT phone FROM users WHERE id = ?", userID).Scan(&currentPhone)
		if err == nil {
			phoneChanged = normalizedPhone != strings.TrimSpace(currentPhone.String)
		}
	}

	// Check 3-month cooldown for display name change
	if updateData.Name != nil {
		newName := strings.TrimSpace(*updateData.Name)
		if newName != "" {
			var currentName string
			var displayNameChangedAt sql.NullTime
			var nameChangedAt sql.NullTime
			err := h.db.QueryRow("SELECT name, display_name_changed_at, name_changed_at FROM users WHERE id = ?", userID).Scan(&currentName, &displayNameChangedAt, &nameChangedAt)
			if err == nil && newName != currentName {
				lastChangedAt := displayNameChangedAt
				if !lastChangedAt.Valid {
					lastChangedAt = nameChangedAt
				}
				if lastChangedAt.Valid {
					canChangeAt := lastChangedAt.Time.AddDate(0, 3, 0)
					if time.Now().Before(canChangeAt) {
						return c.Status(429).JSON(models.APIResponse{
							Success: false,
							Error:   "You can only change your display name once every 3 months.",
							Data: fiber.Map{
								"field":           "display_name",
								"last_changed_at": lastChangedAt.Time,
								"can_change_at":   canChangeAt,
							},
						})
					}
				}
			}
		}
	}

	// Check 3-month cooldown for phone change
	if updateData.Phone != nil && phoneChanged {
		var phoneChangedAt sql.NullTime
		err := h.db.QueryRow("SELECT phone_changed_at FROM users WHERE id = ?", userID).Scan(&phoneChangedAt)
		if err == nil && phoneChangedAt.Valid {
			canChangeAt := phoneChangedAt.Time.AddDate(0, 3, 0)
			if time.Now().Before(canChangeAt) {
				return c.Status(429).JSON(models.APIResponse{
					Success: false,
					Error:   "You recently changed your phone number. Please wait before updating it again.",
					Data: fiber.Map{
						"field":           "phone",
						"last_changed_at": phoneChangedAt.Time,
						"can_change_at":   canChangeAt,
					},
				})
			}
		}
	}

	// Build update query dynamically
	query := "UPDATE users SET updated_at = CURRENT_TIMESTAMP"
	var args []interface{}

	if updateData.Name != nil {
		query += ", name = ?"
		args = append(args, strings.TrimSpace(*updateData.Name))
		// Get current name to check if it's changing
		var currentName string
		h.db.QueryRow("SELECT name FROM users WHERE id = ?", userID).Scan(&currentName)
		if strings.TrimSpace(*updateData.Name) != currentName {
			query += ", display_name_changed_at = CURRENT_TIMESTAMP"
			query += ", name_changed_at = CURRENT_TIMESTAMP"
		}
	}
	if updateData.Email != nil {
		query += ", email = ?"
		args = append(args, newEmail)
		if emailChanged {
			query += ", verified = false"
			query += ", email_changed_at = CURRENT_TIMESTAMP"
			var currentEmail string
			_ = h.db.QueryRow("SELECT email FROM users WHERE id = ?", userID).Scan(&currentEmail)
			if isWmsuEmail(currentEmail) && !isWmsuEmail(newEmail) {
				// Drop WMSU perk when leaving the domain, but keep paid tiers (e.g., pro).
				query += ", is_premium = CASE WHEN premium_tier = 'plus' THEN false ELSE is_premium END"
				query += ", premium_tier = CASE WHEN premium_tier = 'plus' THEN 'free' ELSE premium_tier END"
			}
		}
	}

	if updateData.Phone != nil {
		query += ", phone = ?"
		args = append(args, normalizedPhone)
		if phoneChanged {
			query += ", phone_verified = false"
			query += ", phone_changed_at = CURRENT_TIMESTAMP"
		}
	}

	// ... (rest of field updates)
	if updateData.ProfilePicture != nil {
		query += ", profile_picture = ?"
		args = append(args, *updateData.ProfilePicture)
	}

	if updateData.Bio != nil {
		query += ", bio = ?"
		args = append(args, strings.TrimSpace(*updateData.Bio))
	}

	if updateData.AcademicProgram != nil {
		query += ", academic_program = ?"
		args = append(args, strings.TrimSpace(*updateData.AcademicProgram))
	}

	if updateData.YearLevel != nil {
		query += ", year_level = ?"
		args = append(args, strings.TrimSpace(*updateData.YearLevel))
	}

	if updateData.BackgroundImage != nil {
		query += ", background_image = ?"
		args = append(args, *updateData.BackgroundImage)
	}

	if updateData.BackgroundPosition != nil {
		query += ", background_position = ?"
		args = append(args, *updateData.BackgroundPosition)
	}

	if updateData.LanguagePreference != nil {
		query += ", language_preference = ?"
		args = append(args, *updateData.LanguagePreference)
	}

	if updateData.EmailNotificationsEnabled != nil {
		query += ", email_notifications_enabled = ?"
		args = append(args, *updateData.EmailNotificationsEnabled)
	}

	if updateData.PushNotificationsEnabled != nil {
		query += ", push_notifications_enabled = ?"
		args = append(args, *updateData.PushNotificationsEnabled)
	}

	if updateData.NotificationPreferences != nil {
		preferences := strings.TrimSpace(*updateData.NotificationPreferences)
		if preferences == "" {
			preferences = "{}"
		}
		var decoded map[string]bool
		if err := json.Unmarshal([]byte(preferences), &decoded); err != nil {
			return c.Status(400).JSON(models.APIResponse{
				Success: false,
				Error:   "Invalid notification preferences",
			})
		}
		query += ", notification_preferences = ?"
		args = append(args, preferences)
	}

	if updateData.HomeLatitude != nil {
		query += ", home_latitude = ?"
		args = append(args, *updateData.HomeLatitude)
	}

	if updateData.HomeLongitude != nil {
		query += ", home_longitude = ?"
		args = append(args, *updateData.HomeLongitude)
	}

	if updateData.HomeAddress != nil {
		query += ", home_address = ?"
		args = append(args, *updateData.HomeAddress)
	}

	query += " WHERE id = ?"
	args = append(args, userID)

	_, err := h.db.Exec(query, args...)
	if err != nil {
		// Handle missing columns: try to add any known columns then retry once
		if strings.Contains(err.Error(), "Unknown column") || strings.Contains(err.Error(), "1054") {
			h.db.Exec("ALTER TABLE users ADD COLUMN IF NOT EXISTS phone VARCHAR(20) NULL")
			h.db.Exec("ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_verified BOOLEAN DEFAULT FALSE")
			h.db.Exec("ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name_changed_at TIMESTAMP NULL")
			h.db.Exec("ALTER TABLE users ADD COLUMN IF NOT EXISTS email_changed_at TIMESTAMP NULL")
			h.db.Exec("ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_changed_at TIMESTAMP NULL")
			h.db.Exec("ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_picture VARCHAR(255) NULL")
			h.db.Exec("ALTER TABLE users ADD COLUMN IF NOT EXISTS background_image VARCHAR(255) NULL")
			h.db.Exec("ALTER TABLE users ADD COLUMN IF NOT EXISTS background_position VARCHAR(50) NULL")
			h.db.Exec("ALTER TABLE users ADD COLUMN IF NOT EXISTS bio TEXT NULL")
			h.db.Exec("ALTER TABLE users ADD COLUMN IF NOT EXISTS academic_program VARCHAR(255) NULL")
			h.db.Exec("ALTER TABLE users ADD COLUMN IF NOT EXISTS year_level VARCHAR(80) NULL")
			h.db.Exec("ALTER TABLE users ADD COLUMN IF NOT EXISTS language_preference VARCHAR(10) NULL DEFAULT 'en'")
			h.db.Exec("ALTER TABLE users ADD COLUMN IF NOT EXISTS email_notifications_enabled BOOLEAN DEFAULT TRUE")
			h.db.Exec("ALTER TABLE users ADD COLUMN IF NOT EXISTS push_notifications_enabled BOOLEAN DEFAULT TRUE")
			h.db.Exec("ALTER TABLE users ADD COLUMN IF NOT EXISTS notification_preferences JSON NULL")
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

	// If email changed, trigger verification email
	if emailChanged {
		// Generate OTP
		otpCode, otpHash, otpExpiry, otpErr := generateOTP()
		if otpErr == nil {
			// Save OTP to DB
			h.db.Exec("UPDATE users SET email_otp_hash = ?, email_otp_expires = ? WHERE id = ?", otpHash, otpExpiry, userID)

			// Send Email
			var userName string
			_ = h.db.QueryRow("SELECT name FROM users WHERE id = ?", userID).Scan(&userName)

			go func() {
				err := services.SendOTPEmail(newEmail, userName, otpCode)
				if err != nil {
					fmt.Printf("Error sending verification email for profile update: %v\n", err)
				}
			}()
		}

		return c.JSON(models.APIResponse{
			Success: true,
			Message: "Profile updated. Please verify your new email address. A verification code has been sent.",
			Data:    fiber.Map{"requires_verification": true},
		})
	}

	return c.JSON(models.APIResponse{
		Success: true,
		Message: "Profile updated successfully",
	})
}

// UploadProfilePicture handles uploading a single profile image and returns its URL
func (h *UserHandler) UploadProfilePicture(c *fiber.Ctx) error {
	// Extra safety net: catch any panic in this handler to avoid connection resets
	defer func() {
		if r := recover(); r != nil {
			fmt.Printf("🔴 [UploadProfilePicture] PANIC recovered: %v\n", r)
		}
	}()

	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}

	fmt.Printf("🖼️  [UploadProfilePicture] Starting upload for user ID: %d\n", userID)

	file, err := c.FormFile("image")
	if err != nil {
		// Debug info: log content-type and underlying error to help diagnose upload issues
		contentType := c.Get("Content-Type")
		fmt.Printf("UploadProfilePicture: missing form file 'image' - Content-Type: %s, err: %v\n", contentType, err)
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "No file uploaded: " + err.Error()})
	}

	fmt.Printf("🖼️  [UploadProfilePicture] File received: %s (size: %d bytes)\n", file.Filename, file.Size)

	var finalURL string
	if url, err := services.UploadFileToCloudinary(file, "profile-pictures"); err == nil && url != "" {
		finalURL = url
		fmt.Printf("🖼️  [UploadProfilePicture] Cloudinary upload successful: %s\n", finalURL)
	} else {
		if err != nil && err != services.ErrCloudinaryDisabled {
			fmt.Printf("Cloudinary profile upload failed: %v\n", err)
		}

		fmt.Printf("🖼️  [UploadProfilePicture] Falling back to local storage\n")
		fsPath, publicPath := services.GenerateLocalMediaPaths("profile-pictures", file.Filename)
		if err := os.MkdirAll(filepath.Dir(fsPath), 0o755); err != nil {
			return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to prepare upload directory"})
		}
		if err := c.SaveFile(file, fsPath); err != nil {
			return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to save file"})
		}

		finalURL = publicPath
		fmt.Printf("🖼️  [UploadProfilePicture] Local storage URL: %s\n", finalURL)
	}

	// Ensure profile_picture column exists
	var exists int
	err = h.db.QueryRow("SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_NAME = 'users' AND COLUMN_NAME = 'profile_picture'").Scan(&exists)
	if err == nil && exists == 0 {
		h.db.Exec("ALTER TABLE users ADD COLUMN profile_picture VARCHAR(255) NULL")
	}

	// Save URL to user's profile
	fmt.Printf("🖼️  [UploadProfilePicture] Saving URL to database for user %d: %s\n", userID, finalURL)
	_, err = h.db.Exec("UPDATE users SET profile_picture = ? WHERE id = ?", finalURL, userID)
	if err != nil {
		fmt.Printf("🖼️  [UploadProfilePicture] Database update FAILED: %v\n", err)
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to update user profile picture"})
	}

	fmt.Printf("🖼️  [UploadProfilePicture] Successfully updated user %d with profile picture: %s\n", userID, finalURL)
	return c.JSON(models.APIResponse{Success: true, Data: finalURL, Message: "Uploaded"})
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
	_, err = h.db.Exec("UPDATE users SET password_hash = ?, password_changed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?", hashed, userID)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to update password"})
	}

	return c.JSON(models.APIResponse{Success: true, Message: "Password changed successfully"})
}

// CreateOrganization creates or updates the authenticated user's organization profile.
func (h *UserHandler) CreateOrganization(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}

	var req struct {
		OrgName         string `json:"org_name"`
		OrgHandle       string `json:"org_handle"`
		OrgLogoURL      string `json:"org_logo_url"`
		OrgCoverURL     string `json:"org_cover_url"`
		Bio             string `json:"bio"`
		OrgCategory     string `json:"org_category"`
		OrgWebsite      string `json:"org_website"`
		OrgLocation     string `json:"org_location"`
		OrgContactEmail string `json:"org_contact_email"`
	}

	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid request body"})
	}

	req.OrgName = strings.TrimSpace(req.OrgName)
	req.OrgCategory = strings.TrimSpace(req.OrgCategory)
	req.OrgHandle = normalizeOrgHandle(req.OrgHandle)
	req.OrgWebsite = strings.TrimSpace(req.OrgWebsite)
	req.OrgLocation = strings.TrimSpace(req.OrgLocation)
	req.OrgContactEmail = strings.TrimSpace(strings.ToLower(req.OrgContactEmail))

	if req.OrgName == "" {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Organization name is required"})
	}
	if req.OrgCategory == "" {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Organization category is required"})
	}
	if req.OrgHandle == "" {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Organization handle is required"})
	}
	handleRegex := regexp.MustCompile(`^[a-z0-9](?:[a-z0-9-]{1,48}[a-z0-9])?$`)
	if !handleRegex.MatchString(req.OrgHandle) {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Handle must use lowercase letters, numbers, and hyphens only"})
	}
	if req.OrgContactEmail != "" {
		emailRegex := regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)
		if !emailRegex.MatchString(req.OrgContactEmail) {
			return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Contact email is invalid"})
		}
	}

	var existing int
	err := h.db.QueryRow(
		"SELECT COUNT(*) FROM users WHERE org_handle = ? AND id != ?",
		req.OrgHandle, userID,
	).Scan(&existing)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to validate organization handle"})
	}
	if existing > 0 {
		return c.Status(409).JSON(models.APIResponse{Success: false, Error: "Organization handle is already taken"})
	}

	query := `
		UPDATE users
		SET is_organization = TRUE,
		    org_name = ?,
		    org_handle = ?,
		    org_logo_url = ?,
		    org_cover_url = ?,
		    bio = ?,
		    org_category = ?,
		    org_website = ?,
		    org_location = ?,
		    org_contact_email = ?,
		    updated_at = CURRENT_TIMESTAMP`
	args := []interface{}{req.OrgName, req.OrgHandle, req.OrgLogoURL, req.OrgCoverURL, req.Bio, req.OrgCategory, req.OrgWebsite, req.OrgLocation, req.OrgContactEmail}

	if strings.TrimSpace(req.OrgCoverURL) != "" {
		query += ", background_image = ?"
		args = append(args, req.OrgCoverURL)
	}

	query += " WHERE id = ?"
	args = append(args, userID)

	if _, err := h.db.Exec(query, args...); err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to create organization"})
	}

	return c.JSON(models.APIResponse{
		Success: true,
		Message: "Organization profile saved successfully",
		Data: fiber.Map{
			"org_name":   req.OrgName,
			"org_handle": req.OrgHandle,
		},
	})
}

// GetOrganizationByHandle returns a public organization profile by handle.
func (h *UserHandler) GetOrganizationByHandle(c *fiber.Ctx) error {
	handle := normalizeOrgHandle(c.Params("handle"))
	if handle == "" {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Organization handle is required"})
	}

	var org models.User
	var slugNull sql.NullString
	err := h.db.QueryRow(`
		SELECT id,
		       COALESCE(slug, '') as slug,
		       COALESCE(name, '') as name,
		       COALESCE(org_name, '') as org_name,
		       COALESCE(org_handle, '') as org_handle,
		       COALESCE(org_logo_url, '') as org_logo_url,
		       COALESCE(org_cover_url, '') as org_cover_url,
		       COALESCE(bio, '') as bio,
		       COALESCE(org_category, '') as org_category,
		       COALESCE(org_website, '') as org_website,
		       COALESCE(org_location, '') as org_location,
		       COALESCE(org_contact_email, '') as org_contact_email,
		       COALESCE(verified, FALSE) as verified,
		       COALESCE(org_verified, FALSE) as org_verified,
		       created_at,
		       updated_at
		FROM users
		WHERE is_organization = TRUE AND (org_handle = ? OR slug = ?)
		LIMIT 1
	`, handle, handle).Scan(
		&org.ID,
		&slugNull,
		&org.Name,
		&org.OrgName,
		&org.OrgHandle,
		&org.OrgLogoURL,
		&org.OrgCoverURL,
		&org.Bio,
		&org.OrgCategory,
		&org.OrgWebsite,
		&org.OrgLocation,
		&org.OrgContactEmail,
		&org.Verified,
		&org.OrgVerified,
		&org.CreatedAt,
		&org.UpdatedAt,
	)
	if err != nil {
		if err == sql.ErrNoRows {
			return c.Status(404).JSON(models.APIResponse{Success: false, Error: "Organization not found"})
		}
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to fetch organization"})
	}
	if slugNull.Valid {
		org.Slug = slugNull.String
	}

	return c.JSON(models.APIResponse{Success: true, Data: org})
}

// GetUserByID gets a user by ID or slug (public info only)
func (h *UserHandler) GetUserByID(c *fiber.Ctx) error {
	// Set cache headers - 5 minutes for public user profiles
	c.Set("Cache-Control", "public, max-age=300")
	c.Set("ETag", fmt.Sprintf(`"%d"`, time.Now().Unix()/300)) // ETag changes every 5 min

	identifier := c.Params("id")
	if identifier == "" {
		return c.Status(400).JSON(models.APIResponse{
			Success: false,
			Error:   "User ID or handle is required",
		})
	}

	userID, err := h.ResolveUserID(identifier)
	if err != nil {
		return c.Status(404).JSON(models.APIResponse{
			Success: false,
			Error:   "User not found",
		})
	}

	var user models.User
	var slugNull, profilePicture, backgroundImage, backgroundPosition, department, bio sql.NullString
	var verificationStatus, schoolName sql.NullString
	var lastLogin sql.NullTime
	err = h.db.QueryRow(
		`SELECT id, slug, name, email, role, verified, COALESCE(is_organization, FALSE) AS is_organization, COALESCE(org_verified, FALSE) AS org_verified, COALESCE(org_name, '') as org_name, COALESCE(org_handle, '') as org_handle, COALESCE(org_logo_url, '') as org_logo_url,
		        COALESCE(org_cover_url, '') as org_cover_url, COALESCE(org_category, '') as org_category, COALESCE(org_website, '') as org_website, COALESCE(org_location, '') as org_location, COALESCE(org_contact_email, '') as org_contact_email,
		        COALESCE(profile_picture, '') as profile_picture, COALESCE(background_image, '') as background_image, COALESCE(background_position, '') as background_position, COALESCE(department, '') as department, COALESCE(bio, '') as bio, COALESCE(badges, '[]') as badges,
		        COALESCE(is_premium, FALSE) as is_premium, COALESCE(premium_tier, 'free') as premium_tier,
		        COALESCE(verification_status, 'not_verified') as verification_status, COALESCE(school_name, '') as school_name,
		        COALESCE(created_at, NOW()) as created_at, COALESCE(updated_at, NOW()) as updated_at, COALESCE(last_login, NULL) as last_login
		   FROM users WHERE id = ?`,
		userID,
	).Scan(
		&user.ID, &slugNull, &user.Name, &user.Email, &user.Role, &user.Verified,
		&user.IsOrganization, &user.OrgVerified, &user.OrgName, &user.OrgHandle, &user.OrgLogoURL,
		&user.OrgCoverURL, &user.OrgCategory, &user.OrgWebsite, &user.OrgLocation, &user.OrgContactEmail,
		&profilePicture, &backgroundImage, &backgroundPosition, &department, &bio, &user.Badges,
		&user.IsPremium, &user.PremiumTier, &verificationStatus, &schoolName,
		&user.CreatedAt, &user.UpdatedAt, &lastLogin,
	)

	if err != nil {
		if err == sql.ErrNoRows {
			return c.Status(404).JSON(models.APIResponse{
				Success: false,
				Error:   "User not found",
			})
		}
		return c.Status(500).JSON(models.APIResponse{
			Success: false,
			Error:   "Failed to load user",
		})
	}

	if slugNull.Valid {
		user.Slug = slugNull.String
	}
	// Log profile view (with timeout to prevent hanging)
	viewerID, _ := middleware.GetUserIDFromContext(c)
	if viewerID > 0 && viewerID != userID { // Don't log self-views or anonymous views without ID
		ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
		h.db.ExecContext(ctx, "INSERT INTO profile_views (target_user_id, viewer_user_id) VALUES (?, ?)", userID, viewerID)
		cancel()
	} else if viewerID == 0 {
		// Optional: log anonymous views with NULL viewer_user_id
		ctx, cancel := context.WithTimeout(context.Background(), 1*time.Second)
		h.db.ExecContext(ctx, "INSERT INTO profile_views (target_user_id, viewer_user_id) VALUES (?, NULL)", userID)
		cancel()
	}

	// Convert sql.NullString to regular strings AFTER error check
	if profilePicture.Valid {
		user.ProfilePicture = profilePicture.String
	}
	if backgroundImage.Valid {
		user.BackgroundImage = backgroundImage.String
	}
	if backgroundPosition.Valid {
		user.BackgroundPosition = backgroundPosition.String
	}
	if department.Valid {
		user.Department = department.String
	}
	if bio.Valid {
		user.Bio = bio.String
	}
	if verificationStatus.Valid && verificationStatus.String != "" {
		user.VerificationStatus = verificationStatus.String
	}
	if schoolName.Valid {
		user.SchoolName = schoolName.String
	}
	if user.IsPremium && (user.PremiumTier == "" || user.PremiumTier == "free") {
		user.PremiumTier = "plus"
	}
	if lastLogin.Valid {
		user.LastLogin = &lastLogin.Time
	}
	user.ActivityStatus = computeActivityStatus(user.LastLogin)
	h.applyPremiumExpiry(&user)
	h.ensureWmsuPlus(&user)

	publicUser := fiber.Map{
		"id":                  user.ID,
		"slug":                user.Slug,
		"name":                user.Name,
		"verified":            user.Verified,
		"is_organization":     user.IsOrganization,
		"org_verified":        user.OrgVerified,
		"org_name":            user.OrgName,
		"org_handle":          user.OrgHandle,
		"org_logo_url":        user.OrgLogoURL,
		"org_cover_url":       user.OrgCoverURL,
		"org_category":        user.OrgCategory,
		"org_website":         user.OrgWebsite,
		"org_location":        user.OrgLocation,
		"profile_picture":     user.ProfilePicture,
		"background_image":    user.BackgroundImage,
		"background_position": user.BackgroundPosition,
		"department":          user.Department,
		"bio":                 user.Bio,
		"badges":              user.Badges,
		"verification_status": user.VerificationStatus,
		"school_name":         user.SchoolName,
		"created_at":          user.CreatedAt,
		"updated_at":          user.UpdatedAt,
		"activity_status":     user.ActivityStatus,
		"is_premium":          user.IsPremium,
		"premium_tier":        user.PremiumTier,
	}

	return c.JSON(models.APIResponse{
		Success: true,
		Data:    publicUser,
	})
}

// GetUsers gets all users (admin only, paginated)
func (h *UserHandler) GetUsers(c *fiber.Ctx) error {
	page, _ := strconv.Atoi(c.Query("page", "1"))
	limit, _ := strconv.Atoi(c.Query("limit", "10"))
	offset := (page - 1) * limit

	search := c.Query("search", "")
	role := c.Query("role", "")
	verified := c.Query("verified", "")

	baseQuery := " FROM users WHERE 1=1"
	var args []interface{}

	if search != "" {
		baseQuery += " AND (name LIKE ? OR email LIKE ?)"
		likeSearch := "%" + search + "%"
		args = append(args, likeSearch, likeSearch)
	}

	if role != "" {
		baseQuery += " AND role = ?"
		args = append(args, role)
	}

	if verified != "" {
		switch verified {
		case "true":
			baseQuery += " AND verified = true"
		case "false":
			baseQuery += " AND verified = false"
		}
	}

	// Get total count
	var total int
	err := h.db.QueryRow("SELECT COUNT(*)"+baseQuery, args...).Scan(&total)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{
			Success: false,
			Error:   "Failed to get user count",
		})
	}

	// Get users
	query := "SELECT id, name, email, role, verified, profile_picture, created_at" + baseQuery + " ORDER BY created_at DESC LIMIT ? OFFSET ?"
	args = append(args, limit, offset)

	rows, err := h.db.Query(query, args...)
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
		var profilePicture sql.NullString
		err := rows.Scan(&user.ID, &user.Name, &user.Email, &user.Role, &user.Verified, &profilePicture, &user.CreatedAt)

		if profilePicture.Valid {
			user.ProfilePicture = profilePicture.String
		}

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

// SearchUsersPublic returns public user matches for search/autocomplete.
func (h *UserHandler) SearchUsersPublic(c *fiber.Ctx) error {
	q := strings.TrimSpace(c.Query("q", ""))
	if q == "" {
		return c.JSON(models.APIResponse{Success: true, Data: []fiber.Map{}})
	}

	limit, _ := strconv.Atoi(c.Query("limit", "8"))
	if limit <= 0 {
		limit = 8
	}
	if limit > 20 {
		limit = 20
	}

	pattern := "%" + q + "%"
	rows, err := h.db.Query(`
		SELECT id,
		       COALESCE(slug, ''),
		       COALESCE(name, ''),
		       COALESCE(profile_picture, ''),
		       COALESCE(verified, FALSE),
		       COALESCE(is_organization, FALSE),
		       COALESCE(org_name, ''),
		       COALESCE(org_handle, '')
		FROM users
		WHERE role <> 'suspended'
		  AND (name LIKE ? OR slug LIKE ? OR org_name LIKE ? OR org_handle LIKE ? OR email LIKE ?)
		ORDER BY
		  CASE
		    WHEN name LIKE ? THEN 0
		    WHEN org_name LIKE ? THEN 1
		    WHEN org_handle LIKE ? THEN 2
		    WHEN slug LIKE ? THEN 3
		    ELSE 4
		  END,
		  verified DESC,
		  created_at DESC
		LIMIT ?
	`, pattern, pattern, pattern, pattern, pattern, pattern, pattern, pattern, pattern, limit)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to search users"})
	}
	defer rows.Close()

	users := make([]fiber.Map, 0, limit)
	for rows.Next() {
		var (
			id             int
			slug           string
			name           string
			profilePicture string
			verified       bool
			isOrganization bool
			orgName        string
			orgHandle      string
		)

		if err := rows.Scan(&id, &slug, &name, &profilePicture, &verified, &isOrganization, &orgName, &orgHandle); err != nil {
			continue
		}

		users = append(users, fiber.Map{
			"id":              id,
			"slug":            slug,
			"name":            name,
			"profile_picture": profilePicture,
			"verified":        verified,
			"is_organization": isOrganization,
			"org_name":        orgName,
			"org_handle":      orgHandle,
		})
	}

	return c.JSON(models.APIResponse{Success: true, Data: users})
}

// DeleteUser permanently deletes a user (admin only).
// This uses ON DELETE CASCADE/SET NULL constraints to clean up related records.
func (h *UserHandler) DeleteUser(c *fiber.Ctx) error {
	adminID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{
			Success: false,
			Error:   "User not authenticated",
		})
	}

	userID, err := strconv.Atoi(c.Params("id"))
	if err != nil || userID <= 0 {
		return c.Status(400).JSON(models.APIResponse{
			Success: false,
			Error:   "Invalid user ID",
		})
	}

	// Prevent admins from deleting their own account from the admin panel
	if userID == adminID {
		return c.Status(400).JSON(models.APIResponse{
			Success: false,
			Error:   "You cannot delete your own admin account from the admin panel",
		})
	}

	// Ensure user exists
	var exists int
	if err := h.db.QueryRow("SELECT COUNT(*) FROM users WHERE id = ?", userID).Scan(&exists); err != nil {
		return c.Status(500).JSON(models.APIResponse{
			Success: false,
			Error:   "Failed to check user existence",
		})
	}
	if exists == 0 {
		return c.Status(404).JSON(models.APIResponse{
			Success: false,
			Error:   "User not found",
		})
	}

	// Explicitly clean up user's products, trades, and multiway data before deleting
	// in case ON DELETE CASCADE constraints are not set on all tables.
	h.db.Exec("DELETE FROM trade_items WHERE product_id IN (SELECT id FROM products WHERE seller_id = ?)", userID)
	h.db.Exec("DELETE FROM multiway_trades WHERE user1_id = ? OR user2_id = ? OR user3_id = ? OR initiator_user_id = ?", userID, userID, userID, userID)
	h.db.Exec("DELETE FROM trade_loop_agreements WHERE user_id = ?", userID)
	h.db.Exec("DELETE FROM trades WHERE buyer_id = ? OR seller_id = ?", userID, userID)
	h.db.Exec("DELETE FROM products WHERE seller_id = ?", userID)
	h.db.Exec("DELETE FROM notifications WHERE user_id = ?", userID)

	result, err := h.db.Exec("DELETE FROM users WHERE id = ?", userID)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{
			Success: false,
			Error:   "Failed to delete user",
		})
	}

	if rows, _ := result.RowsAffected(); rows == 0 {
		return c.Status(404).JSON(models.APIResponse{
			Success: false,
			Error:   "User not found",
		})
	}

	return c.JSON(models.APIResponse{
		Success: true,
		Message: "User deleted successfully",
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
	result, err := h.db.Exec("UPDATE saved_products SET deleted_at = NOW() WHERE user_id = ? AND product_id = ? AND deleted_at IS NULL", userID, productID)
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
	query := "SELECT EXISTS(SELECT 1 FROM saved_products WHERE user_id = ? AND product_id = ? AND deleted_at IS NULL)"
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
	err := h.db.QueryRow("SELECT COUNT(*) FROM saved_products WHERE user_id = ? AND deleted_at IS NULL", userID).Scan(&total)
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
		WHERE sp.user_id = ? AND sp.deleted_at IS NULL
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

// GetSellerStats retrieves statistics for a seller profile
func (h *UserHandler) GetSellerStats(c *fiber.Ctx) error {
	// Set cache headers - 15 minutes for seller stats (can be reused across requests)
	c.Set("Cache-Control", "public, max-age=900")
	c.Set("ETag", fmt.Sprintf(`"%d"`, time.Now().Unix()/900)) // ETag changes every 15 min

	identifier := c.Params("id")
	if identifier == "" {
		return c.Status(400).JSON(models.APIResponse{
			Success: false,
			Error:   "User ID or handle is required",
		})
	}

	userID, err := h.ResolveUserID(identifier)
	if err != nil {
		return c.Status(404).JSON(models.APIResponse{
			Success: false,
			Error:   "User not found",
		})
	}

	// Check if user exists
	var userCreatedAt time.Time
	err = h.db.QueryRow("SELECT created_at FROM users WHERE id = ?", userID).Scan(&userCreatedAt)
	if err != nil {
		return c.Status(404).JSON(models.APIResponse{
			Success: false,
			Error:   "User not found",
		})
	}

	stats := models.SellerStats{
		UserID:          userID,
		MemberSinceYear: userCreatedAt.Year(),
	}

	// Calculate total trades (all completed trades involving this user)
	err = h.db.QueryRow(`
		SELECT COUNT(*) FROM trades 
		WHERE (seller_id = ? OR buyer_id = ?) AND status IN ('completed', 'auto_completed')
	`, userID, userID).Scan(&stats.TotalTrades)
	if err != nil {
		stats.TotalTrades = 0
	}

	// Calculate completed trades (synonymous with TotalTrades in this context, but explicitly checks completion criteria)
	err = h.db.QueryRow(`
		SELECT COUNT(*) FROM trades 
		WHERE (seller_id = ? OR buyer_id = ?) AND status IN ('completed', 'auto_completed')
	`, userID, userID).Scan(&stats.CompletedTrades)
	if err != nil {
		stats.CompletedTrades = 0
	}

	// Calculate cancelled trades
	err = h.db.QueryRow(`
		SELECT COUNT(*) FROM trades 
		WHERE (seller_id = ? OR buyer_id = ?) AND status = 'cancelled'
	`, userID, userID).Scan(&stats.CancelledTrades)
	if err != nil {
		stats.CancelledTrades = 0
	}

	// Calculate pending trades
	err = h.db.QueryRow(`
		SELECT COUNT(*) FROM trades 
		WHERE (seller_id = ? OR buyer_id = ?) AND status IN ('pending', 'accepted', 'active', 'awaiting_confirmation')
	`, userID, userID).Scan(&stats.PendingTrades)
	if err != nil {
		stats.PendingTrades = 0
	}

	// Calculate average rating and positive feedback percentage from reviews table
	var avgRating sql.NullFloat64
	var totalReviews sql.NullInt64
	var positivePercent sql.NullFloat64

	err = h.db.QueryRow(`
		SELECT 
			COALESCE(AVG(rating), 0) AS avg_rating,
			COUNT(*) AS total_reviews,
			COALESCE(SUM(CASE WHEN rating >= 4 THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*), 0), 0) AS positive_feedback
		FROM reviews
		WHERE reviewed_user_id = ?
	`, userID).Scan(&avgRating, &totalReviews, &positivePercent)

	if err == nil && avgRating.Valid {
		stats.AvgRating = avgRating.Float64
		stats.TotalFeedback = int(totalReviews.Int64)
		if positivePercent.Valid {
			stats.PositivePercent = positivePercent.Float64
		}
	}

	// Determine response metric based on average rating
	if stats.AvgRating >= 4.5 {
		stats.ResponseMetric = "excellent"
	} else if stats.AvgRating >= 3.5 {
		stats.ResponseMetric = "good"
	} else if stats.AvgRating >= 2.5 {
		stats.ResponseMetric = "average"
	} else {
		stats.ResponseMetric = "poor"
	}

	// Calculate average response time (estimated as minutes from trade creation to first completion activity)
	var avgResponseTimeMinutes sql.NullFloat64
	err = h.db.QueryRow(`
		SELECT AVG(TIMESTAMPDIFF(MINUTE, created_at, CASE 
			WHEN seller_completed THEN COALESCE(updated_at, NOW())
			ELSE NOW()
		END)) as avg_response_minutes
		FROM trades
		WHERE seller_id = ? AND created_at > DATE_SUB(NOW(), INTERVAL 90 DAY)
		LIMIT 100
	`, userID).Scan(&avgResponseTimeMinutes)

	if err == nil && avgResponseTimeMinutes.Valid {
		minutes := int(avgResponseTimeMinutes.Float64)
		if minutes < 60 {
			stats.AvgResponseTime = fmt.Sprintf("%dm", minutes)
		} else if minutes < 1440 {
			hours := minutes / 60
			stats.AvgResponseTime = fmt.Sprintf("%dh", hours)
		} else {
			days := minutes / 1440
			stats.AvgResponseTime = fmt.Sprintf("%dd", days)
		}
	} else {
		stats.AvgResponseTime = "N/A"
	}

	// --- Trust Score Computation (0-100) with detailed breakdown ---
	var trustFactors []models.TrustFactor

	// 1. Verified account: 15 points (Verified = 15, Not verified = 0)
	var verificationStatus string
	var isVerifiedBool bool
	_ = h.db.QueryRow("SELECT COALESCE(verification_status, 'not_verified'), verified FROM users WHERE id = ?", userID).Scan(&verificationStatus, &isVerifiedBool)
	verifiedPoints := 0
	verifiedStatus := "fail"
	if verificationStatus == "verified" || isVerifiedBool {
		verifiedPoints = 15
		verifiedStatus = "pass"
	} else if verificationStatus == "pending" {
		verifiedStatus = "warn"
	}
	trustFactors = append(trustFactors, models.TrustFactor{Label: "Verified account", Status: verifiedStatus, Points: verifiedPoints, Max: 15})

	// 2. Completed trades: 15 points (new users start at 0 — must earn this)
	tradePoints := 0
	tradeStatus := "warn"
	if stats.CompletedTrades >= 6 {
		tradePoints = 15
		tradeStatus = "pass"
	} else if stats.CompletedTrades >= 3 {
		tradePoints = 12
		tradeStatus = "pass"
	} else if stats.CompletedTrades >= 1 {
		tradePoints = 8
		tradeStatus = "warn"
	}
	trustFactors = append(trustFactors, models.TrustFactor{Label: "Completed trades", Status: tradeStatus, Points: tradePoints, Max: 15})

	// 3. Positive ratings: 25 points (new users start at 0 — points earned
	// only after receiving actual feedback)
	ratingPoints := 0
	ratingStatus := "warn"
	if stats.TotalFeedback > 0 {
		positivePercentVal := stats.PositivePercent
		if positivePercentVal == 100 {
			ratingPoints = 25
			ratingStatus = "pass"
		} else if positivePercentVal >= 80 {
			ratingPoints = 18 + int((positivePercentVal-80)/19.0*6.0)
			ratingStatus = "pass"
		} else if positivePercentVal >= 60 {
			ratingPoints = 10 + int((positivePercentVal-60)/19.0*7.0)
			ratingStatus = "warn"
		} else {
			ratingPoints = int(positivePercentVal / 59.0 * 9.0)
			ratingStatus = "fail"
		}
	}
	trustFactors = append(trustFactors, models.TrustFactor{Label: "Positive ratings", Status: ratingStatus, Points: ratingPoints, Max: 25})

	// 4. No reports: 20 points
	var reportCount int
	err = h.db.QueryRow("SELECT COUNT(*) FROM reports WHERE reported_user_id = ? AND status IN ('reviewed', 'resolved')", userID).Scan(&reportCount)
	if err != nil {
		reportCount = 0
	}
	reportPoints := 20
	reportStatus := "pass"
	if reportCount > 0 {
		reportPoints -= reportCount * 8
		if reportPoints < 0 {
			reportPoints = 0
		}
		if reportPoints < 10 {
			reportStatus = "fail"
		} else {
			reportStatus = "warn"
		}
	}
	trustFactors = append(trustFactors, models.TrustFactor{Label: "Clean record", Status: reportStatus, Points: reportPoints, Max: 20})

	// 5. Response time: 15 points (new users start at 0 — earned by actually
	// responding to messages/offers)
	responsePoints := 0
	responseStatus := "warn"
	if avgResponseTimeMinutes.Valid {
		minutes := int(avgResponseTimeMinutes.Float64)
		if minutes <= 360 { // Fast (within hours)
			responsePoints = 15
			responseStatus = "pass"
		} else if minutes <= 1440 { // Moderate (within a day)
			responsePoints = 12
			responseStatus = "pass"
		} else if minutes <= 4320 { // Slow (few days)
			responsePoints = 9
			responseStatus = "warn"
		} else { // Very slow
			responsePoints = 5
			responseStatus = "fail"
		}
	}
	trustFactors = append(trustFactors, models.TrustFactor{Label: "Response speed", Status: responseStatus, Points: responsePoints, Max: 15})

	// 6. Trade Success Rate: 10 points
	var totalAttempted int
	_ = h.db.QueryRow("SELECT COUNT(*) FROM trades WHERE (seller_id = ? OR buyer_id = ?) AND status IN ('completed', 'auto_completed', 'cancelled')", userID, userID).Scan(&totalAttempted)

	successPoints := 0 // New users start at 0 — earned only after trade attempts
	successStatus := "warn"
	if totalAttempted > 0 {
		successStatus = "pass"
		var successCount int
		_ = h.db.QueryRow("SELECT COUNT(*) FROM trades WHERE (seller_id = ? OR buyer_id = ?) AND status IN ('completed', 'auto_completed')", userID, userID).Scan(&successCount)
		successRate := (float64(successCount) / float64(totalAttempted)) * 100
		if successRate >= 90 {
			successPoints = 10
		} else if successRate >= 70 {
			successPoints = 8
			successStatus = "warn"
		} else if successRate >= 50 {
			successPoints = 5
			successStatus = "warn"
		} else {
			successPoints = 2
			successStatus = "fail"
		}
	}
	trustFactors = append(trustFactors, models.TrustFactor{Label: "Trade success", Status: successStatus, Points: successPoints, Max: 10})

	// Cancellation penalty: deduct points for recent cancellations. A cancel
	// made while the trade was ongoing (accepted/active) is weighted heavier
	// than one made while still pending.
	var recentActiveCancels, recentPendingCancels int
	_ = h.db.QueryRow(`
		SELECT COUNT(*) FROM trades
		WHERE cancelled_by = ? AND cancelled_while_active = TRUE
		  AND cancelled_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 30 DAY)
	`, userID).Scan(&recentActiveCancels)
	_ = h.db.QueryRow(`
		SELECT COUNT(*) FROM trades
		WHERE cancelled_by = ? AND (cancelled_while_active = FALSE OR cancelled_while_active IS NULL)
		  AND cancelled_at >= DATE_SUB(CURRENT_TIMESTAMP, INTERVAL 30 DAY)
	`, userID).Scan(&recentPendingCancels)
	cancelPenalty := recentActiveCancels*5 + recentPendingCancels*2
	if cancelPenalty > 30 {
		cancelPenalty = 30
	}

	// Sum all factors
	totalScore := verifiedPoints + tradePoints + ratingPoints + reportPoints + responsePoints + successPoints - cancelPenalty
	if totalScore > 100 {
		totalScore = 100
	}
	if totalScore < 0 {
		totalScore = 0
	}
	stats.TrustScore = totalScore
	stats.TrustFactors = trustFactors

	// Determine trust level based on new requirements
	if stats.TrustScore >= 80 {
		stats.TrustLevel = "trusted"
	} else if stats.TrustScore >= 60 {
		stats.TrustLevel = "new" // Maps to "Trusted" conceptually in UI
	} else {
		stats.TrustLevel = "risky"
	}

	stats.ReportCount = reportCount
	stats.HasReports = reportCount > 0

	// Check for active unresolved disputes in multi-way trades
	var activeDisputeCount int
	err = h.db.QueryRow(`
		SELECT COUNT(*) FROM multiway_leg_disputes 
		WHERE against_user_id = ? AND status IN ('open', 'under_review')
	`, userID).Scan(&activeDisputeCount)
	if err == nil {
		stats.HasActiveDispute = activeDisputeCount > 0
	}

	// --- Conduct Summary from trade grades ---
	conductSummary := h.computeConductSummary(userID)
	if conductSummary != nil {
		stats.ConductSummary = conductSummary
	}

	return c.JSON(models.APIResponse{
		Success: true,
		Data:    stats,
	})
}

// SuspendUser updates a user's role to 'suspended' (admin only)
func (h *UserHandler) SuspendUser(c *fiber.Ctx) error {
	userID := c.Params("id")

	// Ensure we don't suspend the main admin accidentally, although we trust the admin UI
	if userID == "1" {
		return c.Status(400).JSON(models.APIResponse{
			Success: false,
			Error:   "Cannot suspend the primary admin account",
		})
	}

	result, err := h.db.Exec("UPDATE users SET role = 'suspended', updated_at = NOW() WHERE id = ?", userID)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{
			Success: false,
			Error:   "Failed to suspend user: " + err.Error(),
		})
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		return c.Status(404).JSON(models.APIResponse{
			Success: false,
			Error:   "User not found",
		})
	}

	return c.JSON(models.APIResponse{
		Success: true,
		Message: "User has been suspended successfully",
	})
}

// UnsuspendUser restores a suspended user's role to 'user' (admin only)
func (h *UserHandler) UnsuspendUser(c *fiber.Ctx) error {
	userID := c.Params("id")

	result, err := h.db.Exec("UPDATE users SET role = 'user', updated_at = NOW() WHERE id = ?", userID)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{
			Success: false,
			Error:   "Failed to unsuspend user: " + err.Error(),
		})
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		return c.Status(404).JSON(models.APIResponse{
			Success: false,
			Error:   "User not found",
		})
	}

	return c.JSON(models.APIResponse{
		Success: true,
		Message: "User has been unsuspended successfully",
	})
}

// BanUser sets a user's role to 'banned' (admin only)
func (h *UserHandler) BanUser(c *fiber.Ctx) error {
	userID := c.Params("id")

	// Ensure we don't ban the main admin accidentally
	if userID == "1" {
		return c.Status(400).JSON(models.APIResponse{
			Success: false,
			Error:   "Cannot ban the primary admin account",
		})
	}

	result, err := h.db.Exec("UPDATE users SET role = 'banned', updated_at = NOW() WHERE id = ?", userID)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{
			Success: false,
			Error:   "Failed to ban user: " + err.Error(),
		})
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		return c.Status(404).JSON(models.APIResponse{
			Success: false,
			Error:   "User not found",
		})
	}

	return c.JSON(models.APIResponse{
		Success: true,
		Message: "User has been banned successfully",
	})
}

// UnbanUser restores a banned user's role to 'user' (admin only)
func (h *UserHandler) UnbanUser(c *fiber.Ctx) error {
	userID := c.Params("id")

	result, err := h.db.Exec("UPDATE users SET role = 'user', updated_at = NOW() WHERE id = ?", userID)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{
			Success: false,
			Error:   "Failed to unban user: " + err.Error(),
		})
	}

	rowsAffected, _ := result.RowsAffected()
	if rowsAffected == 0 {
		return c.Status(404).JSON(models.APIResponse{
			Success: false,
			Error:   "User not found",
		})
	}

	return c.JSON(models.APIResponse{
		Success: true,
		Message: "User has been unbanned successfully",
	})
}

// computeConductSummary builds a UserConductSummary for a given user from trade_grades
func (h *UserHandler) computeConductSummary(userID int) *models.UserConductSummary {
	rows, err := h.db.Query(`
		SELECT communication, item_accuracy, punctuality, overall
		FROM trade_grades WHERE graded_user_id = ?
	`, userID)
	if err != nil {
		return nil
	}
	defer rows.Close()

	var commSum, accSum, punctSum, overallSum float64
	var count int
	for rows.Next() {
		var comm, acc, punct, ov int
		if err := rows.Scan(&comm, &acc, &punct, &ov); err != nil {
			continue
		}
		commSum += float64(comm)
		accSum += float64(acc)
		punctSum += float64(punct)
		overallSum += float64(ov)
		count++
	}
	if count == 0 {
		return nil
	}

	commAvg := commSum / float64(count)
	accAvg := accSum / float64(count)
	punctAvg := punctSum / float64(count)
	overallAvg := overallSum / float64(count)

	// Cancellation rate: cancelled trades / total trades
	var totalTrades, cancelledTrades int
	_ = h.db.QueryRow(`SELECT COUNT(*) FROM trades WHERE buyer_id = ? OR seller_id = ?`, userID, userID).Scan(&totalTrades)
	_ = h.db.QueryRow(`SELECT COUNT(*) FROM trades WHERE (buyer_id = ? OR seller_id = ?) AND status = 'cancelled'`, userID, userID).Scan(&cancelledTrades)
	cancellationRate := 0.0
	if totalTrades > 0 {
		cancellationRate = float64(cancelledTrades) / float64(totalTrades)
	}

	// Dispute rate: reports filed against user / total trades
	var disputeCount int
	_ = h.db.QueryRow(`SELECT COUNT(*) FROM reports WHERE reported_user_id = ?`, userID).Scan(&disputeCount)
	disputeRate := 0.0
	if totalTrades > 0 {
		disputeRate = float64(disputeCount) / float64(totalTrades)
	}

	letterGrade := computeLetterGrade(overallAvg, cancellationRate, disputeRate)

	return &models.UserConductSummary{
		UserID:      userID,
		LetterGrade: letterGrade,
		OverallAvg:  overallAvg,
		TotalGrades: count,
		Categories: []models.ConductGrade{
			{Category: "Communication", Avg: commAvg, Count: count},
			{Category: "Item Accuracy", Avg: accAvg, Count: count},
			{Category: "Punctuality", Avg: punctAvg, Count: count},
			{Category: "Overall", Avg: overallAvg, Count: count},
		},
		CancellationRate: cancellationRate,
		DisputeRate:      disputeRate,
	}
}

// computeLetterGrade derives a letter grade from the overall average and behaviour rates
func computeLetterGrade(overallAvg, cancellationRate, disputeRate float64) string {
	// Penalty: lower effective score for high cancellation/dispute
	effective := overallAvg - (cancellationRate * 1.0) - (disputeRate * 1.5)
	if effective < 0 {
		effective = 0
	}
	switch {
	case effective >= 4.8:
		return "A+"
	case effective >= 4.5:
		return "A"
	case effective >= 4.0:
		return "B+"
	case effective >= 3.5:
		return "B"
	case effective >= 2.5:
		return "C"
	case effective >= 1.5:
		return "D"
	default:
		return "F"
	}
}

// SubmitTradeGrade allows a trade participant to grade their counterpart
func (h *UserHandler) SubmitTradeGrade(c *fiber.Ctx) error {
	graderID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{
			Success: false,
			Error:   "User not authenticated",
		})
	}

	tradeID, err := strconv.Atoi(c.Params("id"))
	if err != nil {
		return c.Status(400).JSON(models.APIResponse{
			Success: false,
			Error:   "Invalid trade ID",
		})
	}

	// Verify trade exists and is completed
	var buyerID, sellerID int
	var status string
	err = h.db.QueryRow("SELECT buyer_id, seller_id, status FROM trades WHERE id = ?", tradeID).Scan(&buyerID, &sellerID, &status)
	if err != nil {
		return c.Status(404).JSON(models.APIResponse{
			Success: false,
			Error:   "Trade not found",
		})
	}
	if status != "completed" && status != "auto_completed" {
		return c.Status(400).JSON(models.APIResponse{
			Success: false,
			Error:   "Can only grade completed trades",
		})
	}

	// Determine who is being graded
	var gradedUserID int
	switch graderID {
	case buyerID:
		gradedUserID = sellerID
	case sellerID:
		gradedUserID = buyerID
	default:
		return c.Status(403).JSON(models.APIResponse{
			Success: false,
			Error:   "You are not a participant in this trade",
		})
	}

	// Parse body
	var req models.TradeGradeCreate
	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(models.APIResponse{
			Success: false,
			Error:   "Invalid request body",
		})
	}

	// Validate ranges
	for _, v := range []int{req.Communication, req.ItemAccuracy, req.Punctuality, req.Overall} {
		if v < 1 || v > 5 {
			return c.Status(400).JSON(models.APIResponse{
				Success: false,
				Error:   "All grade categories must be between 1 and 5",
			})
		}
	}

	// Check for duplicate grade
	var existing int
	err = h.db.QueryRow("SELECT COUNT(*) FROM trade_grades WHERE trade_id = ? AND grader_id = ?", tradeID, graderID).Scan(&existing)
	if err == nil && existing > 0 {
		return c.Status(409).JSON(models.APIResponse{
			Success: false,
			Error:   "You have already graded this trade",
		})
	}

	_, err = h.db.Exec(`
		INSERT INTO trade_grades (trade_id, grader_id, graded_user_id, communication, item_accuracy, punctuality, overall, comment)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	`, tradeID, graderID, gradedUserID, req.Communication, req.ItemAccuracy, req.Punctuality, req.Overall, req.Comment)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{
			Success: false,
			Error:   "Failed to save trade grade",
		})
	}

	return c.JSON(models.APIResponse{
		Success: true,
		Message: "Trade grade submitted successfully",
	})
}

// GetUserConduct returns the aggregated conduct summary for a user
func (h *UserHandler) GetUserConduct(c *fiber.Ctx) error {
	userID, err := strconv.Atoi(c.Params("id"))
	if err != nil {
		return c.Status(400).JSON(models.APIResponse{
			Success: false,
			Error:   "Invalid user ID",
		})
	}

	summary := h.computeConductSummary(userID)
	if summary == nil {
		return c.JSON(models.APIResponse{
			Success: true,
			Data: models.UserConductSummary{
				UserID:      userID,
				LetterGrade: "N/A",
				TotalGrades: 0,
				Categories:  []models.ConductGrade{},
			},
		})
	}

	return c.JSON(models.APIResponse{
		Success: true,
		Data:    summary,
	})
}

// UpdateLocation persists the authenticated user's current coordinates.
// Accepts either raw {latitude, longitude} from the browser geolocation API
// or a {location} string that we reverse-geocode via Nominatim (manual entry).
func (h *UserHandler) UpdateLocation(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{Success: false, Error: "User not authenticated"})
	}

	var body struct {
		Latitude  *float64 `json:"latitude"`
		Longitude *float64 `json:"longitude"`
		Location  *string  `json:"location"`
	}
	if err := c.BodyParser(&body); err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid request body"})
	}

	lat, lng := body.Latitude, body.Longitude
	if (lat == nil || lng == nil) && body.Location != nil && strings.TrimSpace(*body.Location) != "" {
		coords, err := services.GetCoordinates(strings.TrimSpace(*body.Location))
		if err != nil {
			return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Could not resolve location: " + err.Error()})
		}
		lat = &coords.Latitude
		lng = &coords.Longitude
	}

	if lat == nil || lng == nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "latitude/longitude or location string required"})
	}
	if *lat < -90 || *lat > 90 || *lng < -180 || *lng > 180 {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Coordinates out of range"})
	}

	if _, err := h.db.Exec("UPDATE users SET latitude = ?, longitude = ? WHERE id = ?", *lat, *lng, userID); err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to update location"})
	}

	return c.JSON(models.APIResponse{
		Success: true,
		Data: fiber.Map{
			"latitude":  *lat,
			"longitude": *lng,
		},
	})
}
