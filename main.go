package main

import (
	"log"
	"os"

	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/gofiber/fiber/v2/middleware/recover"
	"github.com/joho/godotenv"
	"github.com/supabase/supabase-go"
	"github.com/xashathebest/clovia/database"
	"github.com/xashathebest/clovia/handlers"
	"github.com/xashathebest/clovia/middleware"
)

func main() {
	// Load environment variables
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found, using default values")
	}

	// Read Supabase configuration from environment
	supabaseKey := os.Getenv("SUPABASE_KEY")
	supabaseURL := os.Getenv("SUPABASE_URL")
	if supabaseURL == "" {
		supabaseURL = "https://zvljxbnnziygamuzzccv.supabase.co"
	}
	if supabaseKey == "" {
		log.Println("Warning: SUPABASE_KEY is not set in environment")
	}
	// Create Supabase client (you can pass this client to your database/handlers later)
	client := supabase.CreateClient(supabaseURL, supabaseKey)
	log.Println("Supabase client initialized")
	_ = client // keep for now to avoid unused variable; integrate into database/handlers next

	// Initialize database
	if err := database.InitDatabase(); err != nil {
		log.Fatal("Failed to initialize database:", err)
	}
	defer database.CloseDatabase()

	// Create database tables
	if err := database.CreateTables(); err != nil {
		log.Fatal("Failed to create database tables:", err)
	}

	// Create Fiber app
	app := fiber.New(fiber.Config{
		ErrorHandler: func(c *fiber.Ctx, err error) error {
			code := fiber.StatusInternalServerError
			if e, ok := err.(*fiber.Error); ok {
				code = e.Code
			}
			return c.Status(code).JSON(fiber.Map{
				"success": false,
				"error":   err.Error(),
			})
		},
	})

	// Middleware
	app.Use(recover.New())
	app.Use(logger.New())
	app.Use(cors.New(cors.Config{
		AllowOrigins: "http://localhost:5173,http://localhost:5174,http://localhost:3000",
		AllowHeaders: "Origin, Content-Type, Accept, Authorization",
		AllowMethods: "GET, POST, PUT, DELETE, OPTIONS",
	}))

	// Serve static files (uploads directory)
	app.Static("/uploads", "./uploads")

	// Health check
	app.Get("/health", func(c *fiber.Ctx) error {
		return c.JSON(fiber.Map{
			"success": true,
			"message": "Clovia API is running",
			"version": "1.0.0",
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

	// API routes
	api := app.Group("/api")

	// Initialize handlers
	userHandler := handlers.NewUserHandler()
	productHandler := handlers.NewProductHandler()
	orderHandler := handlers.NewOrderHandler()
	chatHandler := handlers.NewChatHandler()
	tradeHandler := handlers.NewTradeHandler()
	notificationHandler := handlers.NewNotificationHandler()
	adminHandler := handlers.NewAdminHandler()
	valuationHandler := handlers.NewValuationHandler()
	tradeLoopHandler := handlers.NewTradeLoopHandler()
	authHandler := handlers.NewAuthenticityHandler()

	// Auth routes (no authentication required)
	auth := api.Group("/auth")
	auth.Post("/register", userHandler.Register)
	auth.Post("/login", userHandler.Login)

	// User routes (authentication required)
	users := api.Group("/users")
	users.Get("/profile", middleware.AuthMiddleware(), userHandler.GetProfile)
	users.Put("/profile", middleware.AuthMiddleware(), userHandler.UpdateProfile)
	users.Get("/:id", userHandler.GetUserByID) // Public route
	users.Get("/", userHandler.GetUsers)       // Admin route (no auth for demo)

	// Product routes
	products := api.Group("/products")
	products.Get("/", productHandler.GetProducts)                      // Public route
	products.Get("", productHandler.GetProducts)                       // Support no trailing slash
	products.Get("/:id", productHandler.GetProduct)                    // Public route
	products.Get("/user/:id", productHandler.GetUserProducts)          // Public route
	products.Get("/user/:id/listings", productHandler.GetUserProducts) // alias for listings
	products.Post("/", middleware.AuthMiddleware(), productHandler.CreateProduct)
	products.Put("/:id", middleware.AuthMiddleware(), productHandler.UpdateProduct)
	products.Delete("/:id", middleware.AuthMiddleware(), productHandler.DeleteProduct)

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

	// Trade routes
	trades := api.Group("/trades")
	trades.Post("/", middleware.AuthMiddleware(), tradeHandler.CreateTrade)
	trades.Get("/", middleware.AuthMiddleware(), tradeHandler.GetTrades)
	trades.Put("/:id", middleware.AuthMiddleware(), tradeHandler.UpdateTrade)
	trades.Get("/:id", middleware.AuthMiddleware(), tradeHandler.GetTrade)
	trades.Get("/:id/messages", middleware.AuthMiddleware(), tradeHandler.GetTradeMessages)
	trades.Post("/:id/messages", middleware.AuthMiddleware(), tradeHandler.SendTradeMessage)
	trades.Get("/:id/history", middleware.AuthMiddleware(), tradeHandler.GetTradeHistory)
	trades.Get("/count", middleware.AuthMiddleware(), tradeHandler.CountTrades)
	trades.Post("/loop/suggest", middleware.AuthMiddleware(), tradeLoopHandler.Suggest)

	// Valuation routes
	valuation := api.Group("/valuation")
	valuation.Post("/preview", valuationHandler.Preview)

	// Notifications routes
	notifs := api.Group("/notifications")
	notifs.Get("/", middleware.AuthMiddleware(), notificationHandler.GetNotifications)
	notifs.Put("/:id/read", middleware.AuthMiddleware(), notificationHandler.MarkAsRead)
	notifs.Put("/read-all", middleware.AuthMiddleware(), notificationHandler.MarkAllAsRead)

	// Authenticity routes
	authenticity := api.Group("/authenticity")
	authenticity.Post("/upload", middleware.AuthMiddleware(), authHandler.Upload)
	authenticity.Post("/review", middleware.AuthMiddleware(), middleware.AdminMiddleware(), authHandler.Review)

	// Admin routes
	admin := api.Group("/admin")
	admin.Get("/stats", middleware.AuthMiddleware(), middleware.AdminMiddleware(), adminHandler.GetAdminStats)

	// Get port from environment or use default
	port := os.Getenv("PORT")
	if port == "" {
		port = "4000"
	}

	// Start nightly job ticker for value recomputation
	go func() {
		for {
			now := time.Now()
			next := time.Date(now.Year(), now.Month(), now.Day()+1, 3, 0, 0, 0, now.Location())
			t := time.NewTimer(next.Sub(now))
			<-t.C
			handlers.RecalculateApproxValues()
		}
	}()

	// Start server
	log.Printf("Starting Clovia server on port %s", port)
	log.Fatal(app.Listen(":" + port))
}
