package main

// hallo :3
import (
	"context"
	"database/sql"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/limiter"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/gofiber/fiber/v2/middleware/recover"
	"github.com/joho/godotenv"
	"github.com/xashathebest/clovia/database"
	"github.com/xashathebest/clovia/handlers"
	"github.com/xashathebest/clovia/middleware"
	"github.com/xashathebest/clovia/models"
	"github.com/xashathebest/clovia/services"
)

var startTime = time.Now()

func debugEndpointsEnabled() bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv("ENABLE_DEBUG_ENDPOINTS")))
	return v == "true" || v == "1" || v == "yes"
}

func envBool(key string, defaultVal bool) bool {
	v := strings.ToLower(strings.TrimSpace(os.Getenv(key)))
	if v == "" {
		return defaultVal
	}
	switch v {
	case "1", "true", "yes", "y", "on":
		return true
	case "0", "false", "no", "n", "off":
		return false
	default:
		return defaultVal
	}
}

func isImageUploadPath(path string) bool {
	ext := strings.ToLower(filepath.Ext(path))
	switch ext {
	case ".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".avif":
		return true
	default:
		return false
	}
}

func sendMissingUploadPlaceholder(c *fiber.Ctx) error {
	c.Set("Content-Type", "image/svg+xml")
	c.Set("Cache-Control", "public, max-age=300")
	return c.SendString(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 480"><rect width="640" height="480" fill="#f3f4f6"/><path d="M150 350h340L385 230l-70 82-45-52z" fill="#d1d5db"/><circle cx="235" cy="180" r="42" fill="#d1d5db"/><text x="320" y="410" text-anchor="middle" font-family="Arial,sans-serif" font-size="26" fill="#6b7280">Image unavailable</text></svg>`)
}

func main() {
	// Load developer env files if present.
	// NOTE: godotenv.Load does NOT override already-set environment variables.
	// This makes it safe even when PORT (or other vars) are set by the shell/host.
	loadedAny := false
	if err := godotenv.Load(".env.local"); err == nil {
		loadedAny = true
		log.Println("Loaded .env.local file")
	}
	if err := godotenv.Load(); err == nil {
		loadedAny = true
		log.Println("Loaded .env file")
	}
	if !loadedAny {
		log.Println("No .env files found, using system environment variables")
	}

	// Initialize database
	log.Println("[STARTUP] Connecting to database...")
	if err := database.InitDatabase(); err != nil {
		log.Fatal("Failed to initialize database:", err)
	}
	defer database.CloseDatabase()
	log.Println("[STARTUP] Database connected successfully")

	// Auto-migration (CreateTables) can be extremely slow on hosted DBs (ALTER TABLE on large tables).
	// Default behavior:
	// - local DB: run CreateTables
	// - hosted DB (DB_CA_CERT set): skip unless explicitly enabled
	runCreateTables := os.Getenv("DB_CA_CERT") == ""
	runCreateTables = envBool("RUN_CREATE_TABLES", runCreateTables)
	if runCreateTables {
		log.Println("[STARTUP] Running CreateTables...")
		if err := database.CreateTables(); err != nil {
			log.Fatal("Failed to create database tables:", err)
		}
		log.Println("[STARTUP] CreateTables completed")
	} else {
		log.Println("[STARTUP] Skipping database.CreateTables() (set RUN_CREATE_TABLES=true to enable)")
	}

	// Create Fiber app
	app := fiber.New(fiber.Config{
		BodyLimit:       50 * 1024 * 1024, // 50 MB — allows large image uploads from mobile
		ReadBufferSize:  8192,             // 8 KB read buffer (handles large multipart headers)
		WriteBufferSize: 8192,             // 8 KB write buffer
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			message := "Internal server error"
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
				if code < fiber.StatusInternalServerError {
					message = e.Message
				}
			}
			log.Printf("Fiber error handler: %v (path: %s)", err, c.Path())
			return c.Status(code).JSON(fiber.Map{
				"success": false,
				"error":   message,
			})
		},
	})

	// Middleware
	app.Use(recover.New())
	app.Use(middleware.SecurityHeaders())
	app.Use(logger.New())

	corsOrigins := os.Getenv("CORS_ORIGINS")
	if corsOrigins == "" {
		corsOrigins = strings.Join([]string{
			"http://localhost:5173",
			"http://localhost:5174",
			"http://localhost:3000",
			"https://cloviaph.netlify.app",
			"https://cloviaph.site",
			"https://closevia.onrender.com",
		}, ",")
		os.Setenv("CORS_ORIGINS", corsOrigins)
	}

	log.Printf("CORS Origins configured: %s", corsOrigins)

	app.Use(cors.New(cors.Config{
		AllowOrigins:     corsOrigins,
		AllowHeaders:     "Origin, Content-Type, Accept, Authorization, X-Requested-With",
		AllowMethods:     "GET, POST, PUT, DELETE, OPTIONS, PATCH",
		AllowCredentials: true,
		MaxAge:           3600,
		ExposeHeaders:    "Content-Length, Content-Type, Authorization",
	}))

	// Handle preflight requests without registering a wildcard OPTIONS route.
	// A wildcard OPTIONS route can cause non-existent endpoints to return 405 instead of 404.
	app.Use(func(c *fiber.Ctx) error {
		if c.Method() == fiber.MethodOptions {
			return c.SendStatus(fiber.StatusNoContent)
		}
		return c.Next()
	})

	app.Use(func(c *fiber.Ctx) error {
		path := c.Path()
		isDebugPath := path == "/test-db" ||
			path == "/test-trades-db" ||
			path == "/api/fix-profile-picture" ||
			strings.HasPrefix(path, "/api/diagnostic/")
		if isDebugPath && !debugEndpointsEnabled() {
			return c.SendStatus(fiber.StatusNotFound)
		}
		return c.Next()
	})

	// ⚡ OPTIMIZED: Add Cache-Control headers for static assets
	// This improves repeat visit performance and reduces bandwidth
	app.Use(func(c *fiber.Ctx) error {
		path := c.Path()

		// Set cache headers based on file type (extensionless paths are dynamic)
		if strings.Contains(path, "/uploads/products/") {
			// ✅ Product images: Cache for 30 days (versioned by upload timestamp)
			c.Set("Cache-Control", "public, max-age=2592000, immutable") // 30 days
		} else if strings.Contains(path, "/uploads/") {
			// ✅ User uploads: Cache for 7 days (profile pics, etc.)
			c.Set("Cache-Control", "public, max-age=604800, immutable") // 7 days
		} else if strings.HasSuffix(path, ".js") || strings.HasSuffix(path, ".css") {
			// ✅ Assets (should be versioned by build): Cache for 1 year
			c.Set("Cache-Control", "public, max-age=31536000, immutable") // 1 year
		}

		return c.Next()
	})

	// Serve static files (uploads directory)
	app.Use("/uploads/products", func(c *fiber.Ctx) error {
		if c.Method() != fiber.MethodGet && c.Method() != fiber.MethodHead {
			return c.Next()
		}
		path := c.Path()
		if !isImageUploadPath(path) {
			return c.Next()
		}
		filename := filepath.Base(path)
		if filename == "." || filename == string(filepath.Separator) || filename == "" {
			return c.Next()
		}
		localPath := filepath.Join("uploads", "products", filename)
		if info, err := os.Stat(localPath); err == nil && !info.IsDir() {
			return c.Next()
		}
		log.Printf("Missing product upload %s; serving placeholder", path)
		return sendMissingUploadPlaceholder(c)
	})
	app.Static("/uploads", "./uploads")
	app.Static("/uploads/products", "./uploads/products")

	// Serve React build files with cache headers
	app.Static("/", "./client/dist")

	log.Printf("Backend version: xendit-sync-all-405-fix")

	// Quick sanity-check endpoint to confirm you restarted the backend with latest routes.
	app.Get("/api/version", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{
			"success": true,
			"version": "xendit-sync-all-405-fix",
		})
	})

	// ⚠️ IMPORTANT: This was moved up before API routes
	// Previously was: SPA catch-all MUST be last

	// Health check with database connectivity verification (for k6 load tests & monitoring)
	app.Get("/api/health", func(c *fiber.Ctx) error {
		// Ping database with 3-second timeout
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()

		dbErr := database.DB.PingContext(ctx)
		uptime := time.Since(startTime)

		if dbErr != nil {
			// DB is down, return 503 Service Unavailable (k6 recognizes this as infrastructure failure)
			log.Printf("Health check DB ping failed: %v", dbErr)
			return c.Status(fiber.StatusServiceUnavailable).JSON(fiber.Map{
				"status":  "unhealthy",
				"uptime":  uptime.String(),
				"db":      "down",
				"version": "xendit-sync-all-405-fix",
			})
		}

		// All systems healthy
		return c.Status(fiber.StatusOK).JSON(fiber.Map{
			"status":  "ok",
			"uptime":  uptime.String(),
			"db":      "connected",
			"version": "xendit-sync-all-405-fix",
		})
	})

	// Simple health check endpoint (for basic liveness probes, no DB ping)
	app.Get("/health", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{
			"status": "ok",
		})
	})

	// Test database connection
	app.Get("/test-db", func(c *fiber.Ctx) error {
		var count int
		err := database.DB.QueryRow("SELECT COUNT(*) FROM products").Scan(&count)
		if err != nil {
			return c.JSON(fiber.Map{
				"success": false,
				"error":   err.Error(),
			})
		}
		return c.JSON(fiber.Map{
			"success":       true,
			"product_count": count,
		})
	})

	// Check trades table and delivery state columns
	app.Get("/test-trades-db", func(c *fiber.Ctx) error {
		// Check if trades table exists
		var tradeCount int
		err := database.DB.QueryRow("SELECT COUNT(*) FROM trades").Scan(&tradeCount)
		if err != nil {
			return c.JSON(fiber.Map{
				"success": false,
				"error":   "Trades table error: " + err.Error(),
			})
		}

		// Check delivery state columns
		columns := []string{
			"delivery_type", "payment_method", "payment_confirmed",
			"delivery_instructions",
			"proof_of_delivery", "buyer_confirmed_receipt", "seller_confirmed_delivery",
		}

		missingColumns := []string{}
		for _, col := range columns {
			var count int
			err := database.DB.QueryRow(`
				SELECT COUNT(*)
				FROM information_schema.COLUMNS
				WHERE TABLE_SCHEMA = DATABASE()
				AND TABLE_NAME = 'trades'
				AND COLUMN_NAME = ?
			`, col).Scan(&count)

			if err != nil || count == 0 {
				missingColumns = append(missingColumns, col)
			}
		}

		return c.JSON(fiber.Map{
			"success":         true,
			"trade_count":     tradeCount,
			"missing_columns": missingColumns,
			"schema_status":   "OK",
		})
	})
	app.Get("/api/fix-profile-picture", func(c *fiber.Ctx) error {
		if _, err := database.DB.Exec("ALTER TABLE users ADD COLUMN profile_picture VARCHAR(255) NULL"); err != nil {
			return c.Status(fiber.StatusInternalServerError).JSON(fiber.Map{
				"success": false,
				"error":   err.Error(),
			})
		}
		return c.JSON(fiber.Map{
			"success": true,
			"message": "profile_picture column ensured",
		})
	})

	// Diagnostic endpoint for debugging GetProfile issues
	app.Get("/api/diagnostic/profile/:userId", func(c *fiber.Ctx) error {
		userID := c.Params("userId")

		var user models.User
		var schoolEmailVerifiedAt sql.NullTime
		var lastLogin sql.NullTime
		var slugNull sql.NullString

		err := database.DB.QueryRow(`
			SELECT id, slug, name, email, role, verified,
			        COALESCE(is_organization, FALSE) AS is_organization, COALESCE(org_verified, FALSE) AS org_verified, COALESCE(org_name, '') AS org_name,
			        COALESCE(org_logo_url, '') AS org_logo_url,
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
			        school_email_verified_at,
			        COALESCE(verification_rejection_reason, '') AS verification_rejection_reason,
			        COALESCE(email_notifications_enabled, TRUE) AS email_notifications_enabled,
			        COALESCE(push_notifications_enabled, TRUE) AS push_notifications_enabled,
			        COALESCE(language_preference, 'en') AS language_preference,
			        created_at, updated_at, last_login
			 FROM users WHERE id = ?`,
			userID,
		).Scan(
			&user.ID, &slugNull, &user.Name, &user.Email, &user.Role, &user.Verified,
			&user.IsOrganization, &user.OrgVerified, &user.OrgName,
			&user.OrgLogoURL, &user.ProfilePicture, &user.Bio, &user.BackgroundImage,
			&user.BackgroundPosition, &user.Department, &user.Badges, &user.IsPremium,
			&user.VerificationStatus, &user.SchoolName, &user.SchoolEmail, &schoolEmailVerifiedAt, &user.VerificationRejectionReason,
			&user.EmailNotificationsEnabled, &user.PushNotificationsEnabled,
			&user.LanguagePreference,
			&user.CreatedAt, &user.UpdatedAt, &lastLogin,
		)

		if err != nil {
			return c.Status(500).JSON(fiber.Map{
				"success":    false,
				"error":      err.Error(),
				"userId":     userID,
				"diagnostic": "Failed to fetch user profile - this is the error you would get",
			})
		}

		return c.JSON(fiber.Map{
			"success":    true,
			"user":       user,
			"diagnostic": "Profile query succeeded",
		})
	})

	// API routes
	api := app.Group("/api")

	// Initialize handlers
	userHandler := handlers.NewUserHandler()
	verificationHandler := handlers.NewVerificationHandler()
	productHandler := handlers.NewProductHandler()
	orderHandler := handlers.NewOrderHandler()
	chatHandler := handlers.NewChatHandler()
	tradeHandler := handlers.NewTradeHandler()
	notificationHandler := handlers.NewNotificationHandler()
	adminHandler := handlers.NewAdminHandler()
	escalationHandler := handlers.NewEscalationHandler()
	commentHandler := handlers.NewCommentHandler()
	wishlistHandler := handlers.NewWishlistHandler()
	aiFeaturesHandler := handlers.NewAIFeaturesHandler()
	deliveryHandler := handlers.NewDeliveryHandler()
	go deliveryHandler.BackfillMissingDeliveries() // Create delivery records for existing active delivery trades (async to avoid blocking startup)
	reviewHandler := handlers.NewReviewHandler()
	reportHandler := handlers.NewReportHandler()
	uploadHandler := handlers.NewUploadHandler()
	campaignHandler := handlers.NewCampaignHandler()
	advertisementHandler := handlers.NewAdvertisementHandler()
	paymentHandler := handlers.NewPaymentHandler(database.DB)
	activityHandler := handlers.NewActivityHandler()
	peerTagHandler := handlers.NewPeerTagHandler()
	organizationHandler := handlers.NewOrganizationHandler()
	meetupHandler := handlers.NewMeetupHandler(database.DB)

	// Hybrid matcher background refresh (MVP cron-like task).
	go func() {
		tradeHandler.RebuildAllLoopCaches()
		ticker := time.NewTicker(5 * time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			tradeHandler.RebuildAllLoopCaches()
		}
	}()

	// Public Activity route
	api.Get("/activities", activityHandler.GetRecentActivity)

	authLimiter := limiter.New(limiter.Config{
		Max:        30,
		Expiration: time.Minute,
	})
	accountLimiter := limiter.New(limiter.Config{
		Max:        12,
		Expiration: time.Minute,
	})
	adminSensitiveLimiter := limiter.New(limiter.Config{
		Max:        20,
		Expiration: time.Minute,
	})
	aiLimiter := limiter.New(limiter.Config{
		Max:        30,
		Expiration: time.Minute,
	})
	paymentLimiter := limiter.New(limiter.Config{
		Max:        60,
		Expiration: time.Minute,
	})

	// Auth routes (no authentication required)
	auth := api.Group("/auth")
	auth.Post("/register", authLimiter, userHandler.Register)
	auth.Post("/login", authLimiter, userHandler.Login)
	auth.Post("/google", authLimiter, userHandler.GoogleLogin)
	auth.Post("/logout", userHandler.Logout)
	auth.Post("/refresh-session", authLimiter, middleware.AuthMiddleware(), userHandler.RefreshSession)
	auth.Post("/verify-email", authLimiter, userHandler.VerifyEmail)
	auth.Post("/resend-verification", authLimiter, userHandler.ResendVerification)
	auth.Post("/forgot-password", authLimiter, userHandler.ForgotPassword)
	auth.Post("/reset-password", authLimiter, userHandler.ResetPassword)

	// User routes (authentication required)
	users := api.Group("/users")
	users.Get("/profile", middleware.AuthMiddleware(), userHandler.GetProfile)
	users.Put("/profile", accountLimiter, middleware.AuthMiddleware(), userHandler.UpdateProfile)
	users.Post("/change-password", accountLimiter, middleware.AuthMiddleware(), userHandler.ChangePassword)
	users.Put("/location", middleware.AuthMiddleware(), userHandler.UpdateLocation)
	users.Post("/profile-picture", middleware.AuthMiddleware(), userHandler.UploadProfilePicture)
	// School ID verification (optional)
	users.Post("/verification/start", middleware.AuthMiddleware(), verificationHandler.StartVerification)
	users.Post("/verification/verify-school-email", middleware.AuthMiddleware(), verificationHandler.VerifySchoolEmail)
	users.Post("/verification/resend-school-email-code", middleware.AuthMiddleware(), verificationHandler.ResendSchoolEmailCode)
	users.Post("/verification/upload-id", middleware.AuthMiddleware(), verificationHandler.UploadSchoolID)
	users.Get("/verification/status", middleware.AuthMiddleware(), verificationHandler.GetVerificationStatus)
	users.Post("/verification/phone/start", accountLimiter, middleware.AuthMiddleware(), verificationHandler.StartPhoneVerification)
	users.Post("/verification/phone/verify", accountLimiter, middleware.AuthMiddleware(), verificationHandler.VerifyPhoneCode)
	users.Post("/verification/phone/resend", accountLimiter, middleware.AuthMiddleware(), verificationHandler.ResendPhoneCode)
	users.Get("/verification/phone/status", middleware.AuthMiddleware(), verificationHandler.GetPhoneVerificationStatus)

	// Saved products routes (must be BEFORE dynamic ":id" route)
	users.Post("/saved-products", middleware.AuthMiddleware(), userHandler.SaveProduct)
	users.Delete("/saved-products/:id", middleware.AuthMiddleware(), userHandler.UnsaveProduct)
	users.Get("/saved-products/:id", middleware.AuthMiddleware(), userHandler.CheckSavedProduct)
	users.Get("/saved-products", middleware.AuthMiddleware(), userHandler.GetSavedProducts)
	users.Post("/organization", middleware.AuthMiddleware(), userHandler.CreateOrganization)
	users.Get("/organizations/:handle", userHandler.GetOrganizationByHandle)
	users.Get("/search", userHandler.SearchUsersPublic)
	users.Get("/:id/org-posts", organizationHandler.GetProfilePosts)

	// Review routes (must be BEFORE dynamic ":id" route)
	users.Post("/:id/reviews", middleware.AuthMiddleware(), reviewHandler.CreateReview)
	users.Get("/:id/reviews", reviewHandler.GetUserReviews) // Public - get all reviews for a user
	users.Get("/:id/rating", reviewHandler.GetUserRating)   // Public - get user's average rating

	// Review reply routes
	api.Post("/reviews/:id/reply", middleware.AuthMiddleware(), reviewHandler.ReplyToReview)
	users.Get("/:id/reviews/rating", reviewHandler.GetUserRating) // Public - get rating stats for a user
	users.Get("/:id/stats", userHandler.GetSellerStats)           // Full seller stats endpoint
	users.Get("/:id/trades", tradeHandler.GetUserTradeHistory)    // Public - get completed trades for a user
	users.Get("/:id/conduct", userHandler.GetUserConduct)         // Public - get conduct grades for a user

	// Trade grading routes
	api.Post("/trades/:id/grade", middleware.AuthMiddleware(), userHandler.SubmitTradeGrade)

	// Dynamic and list routes placed after static subpaths
	users.Get("/:id", userHandler.GetUserByID) // Public route
	users.Get("/", middleware.AuthMiddleware(), middleware.AdminMiddleware(), userHandler.GetUsers)

	// Product routes
	products := api.Group("/products")
	products.Get("/", middleware.OptionalAuthMiddleware(), productHandler.GetProducts) // Public route with optional viewer context
	products.Get("", middleware.OptionalAuthMiddleware(), productHandler.GetProducts)  // Support no trailing slash
	products.Get("/user/:id", productHandler.GetUserProducts)                          // Public route
	products.Get("/user/:id/listings", productHandler.GetUserProducts)                 // alias for listings
	products.Get("/search-suggestions", productHandler.SearchSuggestions)              // Smart search autocomplete
	products.Get("/smart-search", aiLimiter, productHandler.SmartSearch)               // AI-powered search
	// Specific routes must come before generic :id route
	products.Post("/generate-details", aiLimiter, productHandler.GenerateProductDetailsWithAI)
	products.Post("/check-image-quality", aiLimiter, productHandler.CheckImageQuality)                // Fast image quality check
	products.Post("/report", middleware.AuthMiddleware(), productHandler.ReportListing)               // Report a listing
	products.Get("/boost-candidates", middleware.AuthMiddleware(), productHandler.GetBoostCandidates) // Listings eligible for boost
	products.Get("/:id/wishlist/status", middleware.AuthMiddleware(), productHandler.GetUserWishlistStatus)
	products.Get("/:id/comments", commentHandler.GetComments)
	products.Post("/:id/comments", middleware.AuthMiddleware(), commentHandler.CreateComment)
	// Voting endpoint (must be before generic :id route)
	products.Post("/:id/vote", middleware.AuthMiddleware(), productHandler.VoteProduct)
	products.Post("/:id/view", productHandler.IncrementViewCount)                              // Track view count (public)
	products.Post("/boost/:id", middleware.AuthMiddleware(), productHandler.BoostProduct)      // Boost a listing
	products.Post("/:id/relist", middleware.AuthMiddleware(), productHandler.DuplicateProduct) // Relist (Plus/Pro)
	products.Put("/:id/reorder-images", middleware.AuthMiddleware(), productHandler.ReorderImages)
	products.Get("/:id/suggested-trades", middleware.AuthMiddleware(), productHandler.GetSuggestedTrades)
	products.Get("/:id/multiway-status", tradeHandler.GetProductMultiwayStatus) // Public — listing badge
	products.Get("/:id", productHandler.GetProduct)                             // Public route (must be last)
	products.Post("/", middleware.AuthMiddleware(), productHandler.CreateProduct)
	products.Put("/:id", middleware.AuthMiddleware(), productHandler.UpdateProduct)
	products.Delete("/:id", middleware.AuthMiddleware(), productHandler.DeleteProduct)

	// Organization community routes
	organizations := api.Group("/organizations")
	organizations.Get("", organizationHandler.ListOrganizations)
	organizations.Get("/quota", middleware.AuthMiddleware(), organizationHandler.GetQuota)
	organizations.Get("/my-approved", middleware.AuthMiddleware(), organizationHandler.GetUserApprovedOrganizations)
	organizations.Post("", middleware.AuthMiddleware(), organizationHandler.CreateOrganization)

	// IMPORTANT: Specific routes MUST come before :slug generic route
	// Otherwise, :slug will match everything and these routes will never execute
	organizations.Post("/:slug/join-request", middleware.AuthMiddleware(), organizationHandler.RequestJoin)
	organizations.Get("/:slug/join-requests", middleware.AuthMiddleware(), organizationHandler.ListJoinRequests)
	organizations.Get("/:slug/members", middleware.AuthMiddleware(), organizationHandler.ListMembers)
	organizations.Post("/:slug/join-requests/:userId", middleware.AuthMiddleware(), organizationHandler.DecideJoinRequest)
	organizations.Post("/:slug/members/:userId/remove", middleware.AuthMiddleware(), organizationHandler.RemoveMember)
	organizations.Get("/:slug/feed", middleware.AuthMiddleware(), organizationHandler.GetFeed)
	organizations.Post("/:slug/posts", middleware.AuthMiddleware(), organizationHandler.CreatePost)
	organizations.Post("/:slug/trade-posts", middleware.AuthMiddleware(), organizationHandler.PostProductForTrade)
	organizations.Get("/:slug/trade-feed", middleware.AuthMiddleware(), organizationHandler.GetTradeFeed)
	organizations.Get("/:slug/debug-trade-feed", organizationHandler.DebugGetTradeFeed) // Debug endpoint - no auth
	organizations.Post("/:slug/transfer-ownership", middleware.AuthMiddleware(), organizationHandler.TransferOwnership)
	organizations.Delete("/:slug", middleware.AuthMiddleware(), organizationHandler.DeleteOrganization)

	// Generic :slug route LAST
	organizations.Get("/:slug", middleware.OptionalAuthMiddleware(), organizationHandler.GetOrganization)

	// Order routes (authentication required)
	orders := api.Group("/orders")
	orders.Post("/", middleware.AuthMiddleware(), orderHandler.CreateOrder)
	orders.Get("/", middleware.AuthMiddleware(), orderHandler.GetOrders)
	orders.Get("/:id", middleware.AuthMiddleware(), orderHandler.GetOrder)
	orders.Put("/:id/status", middleware.AuthMiddleware(), orderHandler.UpdateOrderStatus)

	// Chat routes (REST + SSE)
	chat := api.Group("/chat")
	chat.Get("/conversations", middleware.AuthMiddleware(), chatHandler.GetConversations)
	chat.Get("/conversations/:id/messages", middleware.AuthMiddleware(), chatHandler.GetMessages)
	chat.Post("/conversations", middleware.AuthMiddleware(), chatHandler.EnsureConversation)
	chat.Post("/messages", middleware.AuthMiddleware(), chatHandler.SendMessage)
	chat.Post("/typing", middleware.AuthMiddleware(), chatHandler.Typing)
	chat.Get("/stream", middleware.AuthMiddleware(), chatHandler.Stream)

	// Trade routes (order matters: specific paths before :id)
	trades := api.Group("/trades")
	trades.Post("/", middleware.AuthMiddleware(), tradeHandler.CreateTrade)
	trades.Post("", middleware.AuthMiddleware(), tradeHandler.CreateTrade) // Support no trailing slash
	trades.Get("/", middleware.AuthMiddleware(), tradeHandler.GetTrades)
	trades.Get("", middleware.AuthMiddleware(), tradeHandler.GetTrades) // Support no trailing slash
	trades.Post("/likes", middleware.AuthMiddleware(), tradeHandler.AddTradeLike)
	trades.Delete("/likes", middleware.AuthMiddleware(), tradeHandler.RemoveTradeLike)
	// Loops endpoint must come before any :id routes to avoid shadowing
	trades.Get("/loops", middleware.AuthMiddleware(), tradeHandler.GetTradeLoops)
	trades.Get("/loops/debug/match", middleware.AuthMiddleware(), middleware.AdminMiddleware(), tradeHandler.DebugMultiwayMatch)
	trades.Get("/loops/notifications", middleware.AuthMiddleware(), tradeHandler.GetTradeLoopNotifications)
	trades.Post("/loops/notifications/clear", middleware.AuthMiddleware(), tradeHandler.ClearLoopNotifications)
	trades.Post("/loops/notifications/:id/read", middleware.AuthMiddleware(), tradeHandler.MarkLoopNotificationRead)
	trades.Get("/loops/quota", middleware.AuthMiddleware(), tradeHandler.GetLoopQuota)
	trades.Post("/loops/reprocess", middleware.AuthMiddleware(), tradeHandler.ReprocessTradeLoops)
	trades.Get("/loops/:id", middleware.AuthMiddleware(), tradeHandler.GetTradeLoop)
	trades.Post("/loops/:id/accept", middleware.AuthMiddleware(), tradeHandler.AcceptTradeLoop)
	trades.Post("/loops/:id/decline", middleware.AuthMiddleware(), tradeHandler.DeclineTradeLoop)
	trades.Post("/loops/:id/execute", middleware.AuthMiddleware(), tradeHandler.ExecuteTradeLoop)
	trades.Post("/loops/:id/review-trade", middleware.AuthMiddleware(), tradeHandler.GetOrCreateLoopReviewTrade)
	trades.Post("/loops/:id/cancel", middleware.AuthMiddleware(), tradeHandler.CancelTradeLoop)
	trades.Post("/loops/:id/reinvite", middleware.AuthMiddleware(), tradeHandler.ReinviteTradeLoop)
	trades.Get("/loops/:id/messages", middleware.AuthMiddleware(), tradeHandler.GetTradeLoopMessages)
	trades.Post("/loops/:id/messages", middleware.AuthMiddleware(), tradeHandler.SendTradeLoopMessage)
	trades.Get("/loops/:id/meetup", middleware.AuthMiddleware(), tradeHandler.GetTradeLoopMeetup)
	trades.Put("/loops/:id/meetup", middleware.AuthMiddleware(), tradeHandler.UpdateTradeLoopMeetup)

	// Multi-way chain specific routes
	trades.Get("/multiway/opportunities", middleware.AuthMiddleware(), tradeHandler.GetMultiwayOpportunities)
	trades.Get("/multiway/discoverable", middleware.AuthMiddleware(), tradeHandler.GetDiscoverableMultiwayLoops)
	trades.Get("/multiway/suggestions", middleware.AuthMiddleware(), tradeHandler.GetProactiveMultiwaySuggestions)
	trades.Post("/multiway/:id/hop-in", middleware.AuthMiddleware(), tradeHandler.HopIntoMultiwayChain)
	trades.Post("/multiway/:id/accept", middleware.AuthMiddleware(), tradeHandler.AcceptMultiwayChain)
	trades.Post("/multiway/:id/decline", middleware.AuthMiddleware(), tradeHandler.DeclineMultiwayChain)

	// Phase 2: Per-leg chain management
	trades.Get("/multiway/:id/legs", middleware.AuthMiddleware(), tradeHandler.GetChainLegs)
	trades.Put("/multiway/legs/:legId/handoff", middleware.AuthMiddleware(), tradeHandler.UpdateLegHandoff)
	trades.Post("/multiway/legs/:legId/complete", middleware.AuthMiddleware(), tradeHandler.CompleteLeg)

	// Phase 3: Resilience — collapse, re-match, strikes, conflict
	trades.Post("/multiway/:id/backout", middleware.AuthMiddleware(), tradeHandler.BackOutChain)
	trades.Post("/multiway/conflict/resolve", middleware.AuthMiddleware(), tradeHandler.ResolveMultiwayConflict)

	// Product-level conflict check (must be before generic /:id)
	products.Get("/:id/multiway-conflict", middleware.AuthMiddleware(), tradeHandler.CheckMultiwayConflict)

	// Phase 4: Per-leg disputes & upstream collapse
	trades.Post("/multiway/legs/:legId/dispute", middleware.AuthMiddleware(), tradeHandler.FileLegDispute)

	// Place search (Google Places / Nominatim) for meetup location autocomplete
	app.Get("/api/places/search", middleware.OptionalAuthMiddleware(), func(c *fiber.Ctx) error {
		q := strings.TrimSpace(c.Query("q"))
		if len(q) < 2 {
			return c.JSON(fiber.Map{"results": []services.PlaceSuggestion{}})
		}
		var biasLat, biasLng *float64
		if s := c.Query("lat"); s != "" {
			if v, err := strconv.ParseFloat(s, 64); err == nil {
				biasLat = &v
			}
		}
		if s := c.Query("lng"); s != "" {
			if v, err := strconv.ParseFloat(s, 64); err == nil {
				biasLng = &v
			}
		}
		results, err := services.SearchPlaces(q, biasLat, biasLng)
		if err != nil {
			log.Printf("Place search failed: %v", err)
			return c.Status(500).JSON(fiber.Map{"error": "Place search is temporarily unavailable"})
		}
		return c.JSON(fiber.Map{"results": results})
	})

	// Counts endpoint must come before any :id routes to avoid shadowing
	trades.Get("/count", middleware.OptionalAuthMiddleware(), tradeHandler.CountTrades)
	trades.Put("/:id", middleware.AuthMiddleware(), tradeHandler.UpdateTrade)
	trades.Get("/:id", middleware.AuthMiddleware(), tradeHandler.GetTrade)
	trades.Get("/:id/messages", middleware.AuthMiddleware(), tradeHandler.GetTradeMessages)
	trades.Post("/:id/messages", middleware.AuthMiddleware(), tradeHandler.SendTradeMessage)
	trades.Get("/:id/history", middleware.AuthMiddleware(), tradeHandler.GetTradeHistory)
	trades.Put("/:id/complete", middleware.AuthMiddleware(), tradeHandler.CompleteTrade)
	trades.Get("/:id/completion-status", middleware.AuthMiddleware(), tradeHandler.GetTradeCompletionStatus)
	trades.Get("/:id/deliveries", middleware.AuthMiddleware(), deliveryHandler.GetTradeDeliveries)
	trades.Get("/:id/delivery", middleware.AuthMiddleware(), deliveryHandler.GetTradeDelivery)

	// Review routes (initial + follow-up reviews with auto-completion)
	trades.Post("/:id/reviews", middleware.AuthMiddleware(), tradeHandler.SubmitTradeReview)
	trades.Get("/:id/reviews", middleware.AuthMiddleware(), tradeHandler.GetTradeReviewHistory)
	trades.Get("/:id/review-summary", middleware.AuthMiddleware(), tradeHandler.GetReviewSummary)

	// Meetup routes (stage-aware meeting coordination)
	trades.Post("/:id/meetup/propose", middleware.AuthMiddleware(), meetupHandler.ProposeMeetupTime)
	trades.Post("/:id/meetup/heading-out", middleware.AuthMiddleware(), meetupHandler.MarkHeadingOut)
	trades.Post("/:id/meetup/arrived", middleware.AuthMiddleware(), meetupHandler.MarkArrived)
	trades.Post("/:id/meetup/confirm-completion", middleware.AuthMiddleware(), meetupHandler.ConfirmCompletion)
	trades.Post("/:id/meetup/report-no-show", middleware.AuthMiddleware(), meetupHandler.ReportNoShow)
	trades.Get("/:id/meetup/status", middleware.AuthMiddleware(), meetupHandler.GetMeetupStatus)
	trades.Get("/:id/meetup/messages", middleware.AuthMiddleware(), meetupHandler.GetSystemMessages)

	// Peer tag routes (post-trade feedback tags)
	// Specific routes must come before generic :id routes
	trades.Post("/:id/peer-tags", middleware.AuthMiddleware(), peerTagHandler.CreatePeerTag)
	trades.Get("/:id/peer-tags/participants", middleware.AuthMiddleware(), peerTagHandler.GetTradeParticipantsTags)
	trades.Get("/:id/peer-tags", middleware.AuthMiddleware(), peerTagHandler.GetTagsGivenInTrade)

	// User peer tags routes
	users.Get("/:id/peer-tags", peerTagHandler.GetUserPeerTags) // Public - get peer tags for a user

	// Dispute/Reporting routes
	disputeHandler := handlers.NewDisputeHandler()
	disputes := api.Group("/disputes")
	disputes.Post("/", middleware.AuthMiddleware(), disputeHandler.FileDispute)                    // File a dispute
	disputes.Get("/:id", middleware.AuthMiddleware(), disputeHandler.GetDispute)                   // Get dispute details
	disputes.Post("/:id/respond", middleware.AuthMiddleware(), disputeHandler.RespondToDispute)    // Respondent response
	disputes.Post("/:id/messages", middleware.AuthMiddleware(), disputeHandler.SendDisputeMessage) // Send message in negotiation
	disputes.Get("/:id/messages", middleware.AuthMiddleware(), disputeHandler.GetDisputeMessages)  // Get all messages
	disputes.Post("/:id/agree", middleware.AuthMiddleware(), disputeHandler.AgreeOnResolution)     // Mutual agreement with rating
	disputes.Post("/escalate/expired", disputeHandler.CheckAndEscalateDisputesHandler)             // Auto-escalate expired disputes (cron job)

	payments := api.Group("/payments")
	payments.Post("/trade/:id", paymentLimiter, middleware.AuthMiddleware(), paymentHandler.CreateTradeInvoice)
	// Accept any method for sync to avoid 405 issues in dev/proxies.
	payments.All("/trade/:id/sync", middleware.AuthMiddleware(), paymentHandler.SyncTradePayment)
	payments.Post("/remittance-invoice", paymentLimiter, middleware.AuthMiddleware(), paymentHandler.CreateRemittanceInvoice)
	payments.All("/remittance/sync", middleware.AuthMiddleware(), paymentHandler.SyncRemittancePayment)
	payments.Post("/premium/:id", paymentLimiter, middleware.AuthMiddleware(), paymentHandler.CreatePremiumInvoice)
	payments.Post("/subscription", paymentLimiter, middleware.AuthMiddleware(), paymentHandler.CreateUserPremiumInvoice)
	payments.Get("/subscription", middleware.AuthMiddleware(), paymentHandler.GetUserSubscription)
	payments.Get("/premium-config", middleware.AuthMiddleware(), paymentHandler.GetPremiumConfig)
	payments.All("/subscription/sync", middleware.AuthMiddleware(), paymentHandler.SyncUserPremiumPayment)
	payments.Post("/boost/:id", paymentLimiter, middleware.AuthMiddleware(), paymentHandler.CreateBoostInvoice)
	payments.Post("/webhook/xendit", paymentHandler.XenditWebhook) // Public webhook endpoint

	// Notifications routes
	notifs := api.Group("/notifications")
	notifs.Get("/", middleware.AuthMiddleware(), notificationHandler.GetNotifications)
	notifs.Put("/:id/read", middleware.AuthMiddleware(), notificationHandler.MarkAsRead)
	notifs.Put("/read-all", middleware.AuthMiddleware(), notificationHandler.MarkAllAsRead)

	// Dashboard counts (unread notifications, pending offers)
	api.Get("/dashboard/counts", middleware.AuthMiddleware(), notificationHandler.GetDashboardCounts)

	// Admin routes
	admin := api.Group("/admin")
	admin.Get("/stats", middleware.AuthMiddleware(), middleware.AdminMiddleware(), adminHandler.GetAdminStats)
	admin.Get("/daily-stats", middleware.AuthMiddleware(), middleware.AdminMiddleware(), adminHandler.GetDailyStats)
	admin.Get("/stats-by-date", middleware.AuthMiddleware(), middleware.AdminMiddleware(), adminHandler.GetStatsByDate)
	admin.Get("/revenue", middleware.AuthMiddleware(), middleware.AdminMiddleware(), adminHandler.GetAdminRevenue)
	admin.Get("/marketplace-settings", middleware.AuthMiddleware(), middleware.AdminMiddleware(), adminHandler.GetMarketplaceSettings)
	admin.Put("/marketplace-settings", middleware.AuthMiddleware(), middleware.AdminMiddleware(), adminHandler.UpdateMarketplaceSettings)
	// Admin user management
	admin.Get("/users", middleware.AuthMiddleware(), middleware.AdminMiddleware(), userHandler.GetUsers)
	admin.Put("/users/:id/suspend", middleware.AuthMiddleware(), middleware.AdminMiddleware(), userHandler.SuspendUser)
	admin.Put("/users/:id/unsuspend", middleware.AuthMiddleware(), middleware.AdminMiddleware(), userHandler.UnsuspendUser)
	admin.Put("/users/:id/ban", middleware.AuthMiddleware(), middleware.AdminMiddleware(), userHandler.BanUser)
	admin.Put("/users/:id/unban", middleware.AuthMiddleware(), middleware.AdminMiddleware(), userHandler.UnbanUser)
	admin.Delete("/users/:id", middleware.AuthMiddleware(), middleware.AdminMiddleware(), userHandler.DeleteUser)
	// Admin: school ID verification review
	admin.Get("/verifications", middleware.AuthMiddleware(), middleware.AdminMiddleware(), verificationHandler.AdminListVerifications)
	admin.Get("/verifications/:id/image", middleware.AuthMiddleware(), middleware.AdminMiddleware(), verificationHandler.AdminGetIDImage)
	admin.Post("/verifications/:id/approve", middleware.AuthMiddleware(), middleware.AdminMiddleware(), verificationHandler.AdminApproveVerification)
	admin.Post("/verifications/:id/reject", middleware.AuthMiddleware(), middleware.AdminMiddleware(), verificationHandler.AdminRejectVerification)
	admin.Get("/phone-verifications", middleware.AuthMiddleware(), middleware.AdminMiddleware(), verificationHandler.AdminListPhoneVerifications)
	admin.Post("/users/:id/verify-phone", middleware.AuthMiddleware(), middleware.AdminMiddleware(), verificationHandler.AdminVerifyPhone)
	admin.Post("/users/:id/unverify-phone", middleware.AuthMiddleware(), middleware.AdminMiddleware(), verificationHandler.AdminUnverifyPhone)
	// Admin product management
	admin.Get("/products", middleware.AuthMiddleware(), middleware.AdminMiddleware(), productHandler.GetAdminProducts)
	admin.Delete("/products/:id", middleware.AuthMiddleware(), middleware.AdminMiddleware(), productHandler.DeleteProductAdmin)
	// Admin trade management
	admin.Get("/trades", middleware.AuthMiddleware(), middleware.AdminMiddleware(), adminHandler.GetAdminTrades)
	// Admin category aggregates
	admin.Get("/categories", middleware.AuthMiddleware(), middleware.AdminMiddleware(), adminHandler.GetAdminCategories)
	admin.Get("/data-explorer", middleware.AuthMiddleware(), middleware.AdminMiddleware(), adminHandler.GetDataExplorer)
	admin.Get("/data-explorer/export", adminSensitiveLimiter, middleware.AuthMiddleware(), middleware.AdminMiddleware(), adminHandler.ExportDataExplorer)
	admin.Get("/premium", middleware.AuthMiddleware(), middleware.AdminMiddleware(), adminHandler.GetPremiumManagement)
	admin.Put("/premium", adminSensitiveLimiter, middleware.AuthMiddleware(), middleware.AdminMiddleware(), adminHandler.UpdatePremiumManagement)
	admin.Post("/premium/users/:id", adminSensitiveLimiter, middleware.AuthMiddleware(), middleware.AdminMiddleware(), adminHandler.UpdatePremiumUser)
	// Admin reports management
	admin.Get("/reports", middleware.AuthMiddleware(), middleware.AdminMiddleware(), reportHandler.GetReports)
	admin.Get("/reports/:id", middleware.AuthMiddleware(), middleware.AdminMiddleware(), reportHandler.GetReportByID)
	admin.Put("/reports/:id/status", middleware.AuthMiddleware(), middleware.AdminMiddleware(), reportHandler.UpdateReport)
	// Admin campaigns management
	admin.Get("/campaigns", middleware.AuthMiddleware(), middleware.AdminMiddleware(), campaignHandler.GetAdminCampaigns)
	admin.Post("/campaigns", middleware.AuthMiddleware(), middleware.AdminMiddleware(), campaignHandler.CreateCampaign)
	admin.Put("/campaigns/:id", middleware.AuthMiddleware(), middleware.AdminMiddleware(), campaignHandler.UpdateCampaign)
	admin.Delete("/campaigns/:id", middleware.AuthMiddleware(), middleware.AdminMiddleware(), campaignHandler.DeleteCampaign)
	// Admin advertisement management
	admin.Get("/advertisements", middleware.AuthMiddleware(), middleware.AdminMiddleware(), advertisementHandler.GetAllAdvertisements)
	admin.Post("/advertisements", middleware.AuthMiddleware(), middleware.AdminMiddleware(), advertisementHandler.CreateAdvertisement)
	admin.Put("/advertisements/:id", middleware.AuthMiddleware(), middleware.AdminMiddleware(), advertisementHandler.UpdateAdvertisement)
	admin.Delete("/advertisements/:id", middleware.AuthMiddleware(), middleware.AdminMiddleware(), advertisementHandler.DeleteAdvertisement)
	// Admin multiway chain dashboard & strikes (Phase 3)
	admin.Get("/multiway-chains", middleware.AuthMiddleware(), middleware.AdminMiddleware(), tradeHandler.AdminGetChains)
	admin.Get("/users/:userId/strikes", middleware.AuthMiddleware(), middleware.AdminMiddleware(), tradeHandler.GetUserStrikes)
	admin.Post("/users/:userId/strikes", middleware.AuthMiddleware(), middleware.AdminMiddleware(), tradeHandler.AdminIssueStrike)
	// Admin leg disputes (Phase 4)
	admin.Get("/multiway-disputes", middleware.AuthMiddleware(), middleware.AdminMiddleware(), tradeHandler.AdminGetLegDisputes)
	admin.Put("/multiway-disputes/:disputeId/resolve", middleware.AuthMiddleware(), middleware.AdminMiddleware(), tradeHandler.AdminResolveLegDispute)
	// Admin escalation management (Phase 5)
	admin.Get("/escalations/stats", middleware.AuthMiddleware(), middleware.AdminMiddleware(), escalationHandler.GetEscalationStats)
	admin.Get("/escalations", middleware.AuthMiddleware(), middleware.AdminMiddleware(), escalationHandler.GetEscalationQueue)
	admin.Get("/escalations/:id", middleware.AuthMiddleware(), middleware.AdminMiddleware(), escalationHandler.GetEscalationDetail)
	admin.Post("/escalations/:id/assign", middleware.AuthMiddleware(), middleware.AdminMiddleware(), escalationHandler.AssignEscalation)
	admin.Post("/escalations/:id/resolve", middleware.AuthMiddleware(), middleware.AdminMiddleware(), escalationHandler.ResolveEscalation)
	// Admin rider verification
	admin.Get("/rider-applications", middleware.AuthMiddleware(), middleware.AdminMiddleware(), deliveryHandler.AdminListRiderApplications)
	admin.Get("/rider-applications/:id", middleware.AuthMiddleware(), middleware.AdminMiddleware(), deliveryHandler.AdminGetRiderApplication)
	admin.Post("/rider-applications/:id/approve", middleware.AuthMiddleware(), middleware.AdminMiddleware(), deliveryHandler.AdminApproveRider)
	admin.Post("/rider-applications/:id/reject", middleware.AuthMiddleware(), middleware.AdminMiddleware(), deliveryHandler.AdminRejectRider)
	admin.Post("/rider-applications/:id/review", middleware.AuthMiddleware(), middleware.AdminMiddleware(), deliveryHandler.AdminMarkUnderReview)
	admin.Post("/backfill-ledgers", middleware.AuthMiddleware(), middleware.AdminMiddleware(), deliveryHandler.BackfillLedgers)
	// Task 19/20: Rider free slots + remittance lock flow
	admin.Get("/rider-config", middleware.AuthMiddleware(), middleware.AdminMiddleware(), deliveryHandler.AdminGetRiderConfig)
	admin.Put("/rider-config", middleware.AuthMiddleware(), middleware.AdminMiddleware(), deliveryHandler.AdminUpdateRiderConfig)
	admin.Get("/remittance-payments", middleware.AuthMiddleware(), middleware.AdminMiddleware(), deliveryHandler.AdminListRemittancePayments)
	admin.Post("/remittance-payments/:paymentId/verify", middleware.AuthMiddleware(), middleware.AdminMiddleware(), deliveryHandler.AdminVerifyRemittancePayment)

	// Wishlist routes
	wishlist := api.Group("/wishlist")
	wishlist.Get("/", middleware.AuthMiddleware(), wishlistHandler.GetWishlist)
	wishlist.Post("/", middleware.AuthMiddleware(), wishlistHandler.AddToWishlist)
	wishlist.Delete("/:productId", middleware.AuthMiddleware(), wishlistHandler.RemoveFromWishlist)

	// Delivery routes (order matters: specific paths before :id)
	deliveries := api.Group("/deliveries")
	deliveries.Post("/", middleware.AuthMiddleware(), deliveryHandler.CreateDelivery)
	deliveries.Get("/", middleware.AuthMiddleware(), deliveryHandler.GetDeliveries)
	// Rider-specific routes must come before /:id to avoid shadowing
	deliveries.Get("/available", middleware.AuthMiddleware(), deliveryHandler.GetAvailableDeliveries)
	deliveries.Get("/my-jobs", middleware.AuthMiddleware(), deliveryHandler.GetRiderDeliveries)
	if debugEndpointsEnabled() {
		log.Println("Debug endpoints enabled: /api/deliveries/my-jobs-debug")
		deliveries.Get("/my-jobs-debug", middleware.AuthMiddleware(), deliveryHandler.DebugRiderJobs)
	}
	deliveries.Post("/register-rider", middleware.AuthMiddleware(), deliveryHandler.RegisterAsRider)
	deliveries.Get("/rider-status", middleware.AuthMiddleware(), deliveryHandler.CheckRiderStatus)
	deliveries.Post("/apply-rider", middleware.AuthMiddleware(), deliveryHandler.ApplyAsRider)
	deliveries.Get("/rider-application", middleware.AuthMiddleware(), deliveryHandler.GetRiderApplication)
	deliveries.Get("/rider-state", middleware.AuthMiddleware(), deliveryHandler.GetRiderState)
	deliveries.Post("/rider-first-login-complete", middleware.AuthMiddleware(), deliveryHandler.MarkRiderFirstLoginComplete)
	deliveries.Get("/rider-ledger", middleware.AuthMiddleware(), deliveryHandler.GetRiderLedger)
	deliveries.Post("/remittance-payment", middleware.AuthMiddleware(), deliveryHandler.SubmitRemittancePayment)
	deliveries.Get("/:id", middleware.AuthMiddleware(), deliveryHandler.GetDelivery)
	deliveries.Put("/:id/status", middleware.AuthMiddleware(), deliveryHandler.UpdateDeliveryStatus)
	deliveries.Post("/:id/assign", middleware.AuthMiddleware(), deliveryHandler.AssignRider)
	deliveries.Post("/:id/claim", middleware.AuthMiddleware(), deliveryHandler.ClaimDelivery)
	deliveries.Get("/:id/stops", middleware.AuthMiddleware(), deliveryHandler.GetDeliveryStops)
	deliveries.Post("/stops/:stopId/update", middleware.AuthMiddleware(), deliveryHandler.UpdateStopStatus)

	// Batch delivery routes (must come after basic delivery routes to avoid shadowing)
	batches := api.Group("/batches")
	batches.Post("/claim", middleware.AuthMiddleware(), deliveryHandler.ClaimBatch)
	batches.Get("/nearby-addons", middleware.AuthMiddleware(), deliveryHandler.GetNearbyAddOns)
	batches.Get("/rider-slots", middleware.AuthMiddleware(), deliveryHandler.GetRiderSlots)
	batches.Post("/remit-cash", middleware.AuthMiddleware(), deliveryHandler.RemitCash)
	batches.Post("/:id/start", middleware.AuthMiddleware(), deliveryHandler.StartBatch)
	batches.Post("/:id/complete", middleware.AuthMiddleware(), deliveryHandler.CompleteBatch)

	// Generic image upload route (used by TradeCompletionModal, etc.)
	api.Post("/upload", middleware.AuthMiddleware(), uploadHandler.UploadImage)

	// Reports route (user-facing: submit a report)
	api.Post("/reports", middleware.AuthMiddleware(), reportHandler.CreateReport)
	api.Get("/users/:id/reports", middleware.AuthMiddleware(), middleware.AdminMiddleware(), reportHandler.GetUserReports)

	// AI Features routes
	ai := api.Group("/ai")
	ai.Get("/proximity", middleware.AuthMiddleware(), aiFeaturesHandler.GetProximity)
	ai.Get("/response-metrics", middleware.AuthMiddleware(), aiFeaturesHandler.GetResponseMetrics)
	ai.Get("/profile-analysis", middleware.AuthMiddleware(), aiFeaturesHandler.GetProfileAnalysis)
	ai.Get("/profile-analysis/all", middleware.AuthMiddleware(), aiFeaturesHandler.AnalyzeAllProfiles)
	ai.Get("/counterfeit/:id", aiFeaturesHandler.GetCounterfeitReport)

	// Product analysis route (uses Gemini + Groq fallback)
	ai.Post("/analyze-product", aiLimiter, middleware.AuthMiddleware(), uploadHandler.AnalyzeProductImages)

	// Campaigns route (public-facing for fetching active campaigns)
	campaigns := api.Group("/campaigns")
	campaigns.Get("/active", middleware.OptionalAuthMiddleware(), campaignHandler.GetActiveCampaigns)

	// Advertisements routes
	advs := api.Group("/advertisements")
	advs.Get("/active", middleware.OptionalAuthMiddleware(), advertisementHandler.GetActiveAdvertisements)
	advs.Post("/:id/view", middleware.OptionalAuthMiddleware(), advertisementHandler.RecordView)
	advs.Post("/:id/click", middleware.OptionalAuthMiddleware(), advertisementHandler.RecordClick)

	// Get port from environment or use default
	port := os.Getenv("PORT")
	if port == "" {
		port = "4000"
	}

	// Start server
	// Start background trade timeout scheduler
	services.StartTradeTimeoutScheduler(database.DB)

	// Start background escalation SLA scheduler
	services.StartEscalationSLAScheduler(database.DB)

	// Start background meetup reminder scheduler (24-hour pre-meetup reminders)
	reminderService := services.NewMeetupReminderService(database.DB)
	go func() {
		log.Println("Starting pre-meetup reminder scheduler...")
		reminderService.SchedulePreMeetupReminders()
	}()

	// Start background dispute auto-escalation job (check every 30 minutes for expired disputes)
	disputeService := services.NewDisputeService(database.DB)
	disputeService.StartAutoEscalationJob(30 * time.Minute)

	// ⚡ SPA SERVE ROUTES - MUST BE LAST (after all API routes)
	// Serve root path with index.html
	app.Get("/", func(c *fiber.Ctx) error {
		return c.SendFile("./client/dist/index.html")
	})

	// Serve index.html for all unmatched routes (SPA catch-all)
	// This allows React Router to handle all routing on the client side
	// This MUST come after all API routes so they are not intercepted
	app.Use(func(c *fiber.Ctx) error {
		// Only serve index.html for non-API routes
		if !strings.HasPrefix(c.Path(), "/api") && !strings.HasPrefix(c.Path(), "/uploads") {
			return c.SendFile("./client/dist/index.html")
		}
		return c.Next()
	})

	log.Printf("Starting Clovia server on port %s", port)
	log.Fatal(app.Listen(":" + port))
}
