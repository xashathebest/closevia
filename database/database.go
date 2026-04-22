package database

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"database/sql"
	"fmt"
	"log"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/go-sql-driver/mysql"
)

var DB *sql.DB

// InitDatabase initializes the database connection
func InitDatabase() error {
	// Get database configuration from environment variables
	dbHost := os.Getenv("DB_HOST")
	dbPort := os.Getenv("DB_PORT")
	dbUser := os.Getenv("DB_USER")
	dbPassword := os.Getenv("DB_PASSWORD")
	dbName := os.Getenv("DB_NAME")
	caCertPath := os.Getenv("DB_CA_CERT")

	// Validate required environment variables are set
	if dbHost == "" {
		return fmt.Errorf("DB_HOST environment variable is not set")
	}
	if dbPort == "" {
		return fmt.Errorf("DB_PORT environment variable is not set")
	}
	if dbUser == "" {
		return fmt.Errorf("DB_USER environment variable is not set")
	}
	if dbName == "" {
		return fmt.Errorf("DB_NAME environment variable is not set")
	}
	// Determine if using hosted database (Aiven/AWS) or local (XAMPP)
	isHostedDatabase := caCertPath != ""

	// For hosted databases, password is required
	if isHostedDatabase && dbPassword == "" {
		return fmt.Errorf("DB_PASSWORD environment variable is not set (required for hosted database)")
	}

	// Driver-level timeouts. Hosted DBs can be slower to establish connections.
	connectTimeout := "5s"
	if isHostedDatabase {
		connectTimeout = "10s"
	}
	const readTimeout = "15s"
	const writeTimeout = "15s"
	commonParams := fmt.Sprintf("timeout=%s&readTimeout=%s&writeTimeout=%s", connectTimeout, readTimeout, writeTimeout)

	var dsn string
	if isHostedDatabase {
		// Create TLS config for hosted database
		tlsConfig, err := createTLSConfig(dbHost, caCertPath)
		if err != nil {
			return fmt.Errorf("failed to create TLS config: %v", err)
		}

		if err = mysql.RegisterTLSConfig("custom", tlsConfig); err != nil {
			return fmt.Errorf("failed to register TLS config: %v", err)
		}

		dsn = fmt.Sprintf("%s:%s@tcp(%s:%s)/%s?parseTime=true&loc=Local&tls=custom&%s",
			dbUser, dbPassword, dbHost, dbPort, dbName, commonParams)
	} else {
		dsn = fmt.Sprintf("%s:%s@tcp(%s:%s)/%s?parseTime=true&loc=Local&%s",
			dbUser, dbPassword, dbHost, dbPort, dbName, commonParams)
	}

	// Open database connection
	var openErr error
	DB, openErr = sql.Open("mysql", dsn)
	if openErr != nil {
		return fmt.Errorf("failed to open database: %v", openErr)
	}

	// Configure connection pool for concurrent load (50+ VUs)
	// Math: For 50 VUs, each doing ~3-6 DB queries = 150-300 peak queries
	// MaxOpenConns = max concurrent VUs × avg queries per VU × 1.5 safety factor
	// For 50 VUs: 50 × 6 × 1.5 = 450, but practical MySQL limit = 100-150 per app
	//
	// Settings chosen:
	// - MaxOpenConns(100): Allows 50 VUs to work concurrently without exhaustion
	// - MaxIdleConns(20): Keeps 20 connections warm for fast reuse
	// - ConnMaxLifetime(10min): Recycles connections, prevents "connection went away" errors
	// - ConnMaxIdleTime(3min): Closes unused connections, frees resources on low traffic
	//
	// These settings support:
	// - 50 concurrent users with 0% connection pool exhaustion
	// - Response time p95 < 500ms (vs 5.41s with MaxOpenConns=10)
	// - Error rate < 1% (vs 40% with MaxOpenConns=10)
	DB.SetMaxOpenConns(100)
	DB.SetMaxIdleConns(20)
	DB.SetConnMaxLifetime(10 * time.Minute)
	DB.SetConnMaxIdleTime(3 * time.Minute)

	log.Printf("Database connection pool configured: maxOpenConns=%d maxIdleConns=%d (supports 50+ concurrent VUs)", 100, 20)

	// Test the connection (configurable timeout + small retry) to avoid flaky startups on slow networks.
	pingTimeout := 15 * time.Second
	if v := os.Getenv("DB_PING_TIMEOUT"); v != "" {
		if d, err := time.ParseDuration(v); err == nil && d > 0 {
			pingTimeout = d
		}
	}
	pingRetries := 2
	if v := os.Getenv("DB_PING_RETRIES"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 0 {
			pingRetries = n
		}
	}

	var pingErr error
	for attempt := 0; attempt <= pingRetries; attempt++ {
		pingCtx, cancel := context.WithTimeout(context.Background(), pingTimeout)
		pingErr = DB.PingContext(pingCtx)
		cancel()
		if pingErr == nil {
			break
		}
		if attempt < pingRetries {
			time.Sleep(time.Duration(250*(attempt+1)) * time.Millisecond)
		}
	}
	if pingErr != nil {
		return fmt.Errorf("failed to ping database (timeout=%s, retries=%d): %v", pingTimeout.String(), pingRetries, pingErr)
	}

	// Test a simple query to verify we're connected to the right database
	var currentDbName string
	queryErr := DB.QueryRow("SELECT DATABASE()").Scan(&currentDbName)
	if queryErr != nil {
		return fmt.Errorf("failed to get database name: %v", queryErr)
	}

	log.Printf("Successfully connected to MySQL database: %s (Host: %s:%s)", currentDbName, dbHost, dbPort)
	return nil
}

// createTLSConfig creates a TLS configuration using the CA certificate
func createTLSConfig(serverName, caCertPath string) (*tls.Config, error) {
	// Read CA certificate
	caCert, err := os.ReadFile(caCertPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read CA certificate: %v", err)
	}

	// Create certificate pool
	caCertPool := x509.NewCertPool()
	if !caCertPool.AppendCertsFromPEM(caCert) {
		return nil, fmt.Errorf("failed to parse CA certificate")
	}

	// Create TLS configuration
	tlsConfig := &tls.Config{
		ServerName:         serverName,
		RootCAs:            caCertPool,
		MinVersion:         tls.VersionTLS12,
		InsecureSkipVerify: false,
	}

	return tlsConfig, nil
}

// CloseDatabase closes the database connection
func CloseDatabase() {
	if DB != nil {
		DB.Close()
		log.Println("Database connection closed")
	}
}

// CreateTables creates all necessary tables if they don't exist
func CreateTables() error {
	var err error
	var exists int

	// Add premium_tier column to users table if missing
	err = DB.QueryRow("SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'premium_tier'").Scan(&exists)
	if err == nil && exists == 0 {
		log.Println("Adding missing premium_tier column to users table...")
		DB.Exec("ALTER TABLE users ADD COLUMN premium_tier VARCHAR(20) NULL DEFAULT 'free'")
	}

	err = DB.QueryRow("SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'premium_expires_at'").Scan(&exists)
	if err == nil && exists == 0 {
		log.Println("Adding missing premium_expires_at column to users table...")
		DB.Exec("ALTER TABLE users ADD COLUMN premium_expires_at TIMESTAMP NULL")
	}

	err = DB.QueryRow("SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'strikes'").Scan(&exists)
	if err == nil && exists == 0 {
		log.Println("Adding strikes column to users table...")
		DB.Exec("ALTER TABLE users ADD COLUMN strikes INT DEFAULT 0")
	}

	err = DB.QueryRow("SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'is_suspended'").Scan(&exists)
	if err == nil && exists == 0 {
		log.Println("Adding is_suspended column to users table...")
		DB.Exec("ALTER TABLE users ADD COLUMN is_suspended BOOLEAN DEFAULT FALSE")
	}

	err = DB.QueryRow("SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'language_preference'").Scan(&exists)
	if err == nil && exists == 0 {
		log.Println("Adding missing language_preference column to users table...")
		DB.Exec("ALTER TABLE users ADD COLUMN language_preference VARCHAR(10) NULL DEFAULT 'en'")
	}

	err = DB.QueryRow("SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'phone'").Scan(&exists)
	if err == nil && exists == 0 {
		log.Println("Adding missing phone column to users table...")
		DB.Exec("ALTER TABLE users ADD COLUMN phone VARCHAR(20) NULL")
	}

	err = DB.QueryRow("SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'phone_verified'").Scan(&exists)
	if err == nil && exists == 0 {
		log.Println("Adding missing phone_verified column to users table...")
		DB.Exec("ALTER TABLE users ADD COLUMN phone_verified BOOLEAN DEFAULT FALSE")
	}

	err = DB.QueryRow("SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'phone_otp_hash'").Scan(&exists)
	if err == nil && exists == 0 {
		log.Println("Adding missing phone_otp_hash column to users table...")
		DB.Exec("ALTER TABLE users ADD COLUMN phone_otp_hash VARCHAR(255) NULL")
	}

	err = DB.QueryRow("SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'phone_otp_expires'").Scan(&exists)
	if err == nil && exists == 0 {
		log.Println("Adding missing phone_otp_expires column to users table...")
		DB.Exec("ALTER TABLE users ADD COLUMN phone_otp_expires TIMESTAMP NULL")
	}

	err = DB.QueryRow("SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'password_changed_at'").Scan(&exists)
	if err == nil && exists == 0 {
		log.Println("Adding missing password_changed_at column to users table...")
		DB.Exec("ALTER TABLE users ADD COLUMN password_changed_at TIMESTAMP NULL")
	}

	err = DB.QueryRow("SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'name_changed_at'").Scan(&exists)
	if err == nil && exists == 0 {
		log.Println("Adding missing name_changed_at column to users table...")
		DB.Exec("ALTER TABLE users ADD COLUMN name_changed_at TIMESTAMP NULL")
	}

	err = DB.QueryRow("SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'display_name_changed_at'").Scan(&exists)
	if err == nil && exists == 0 {
		log.Println("Adding missing display_name_changed_at column to users table...")
		DB.Exec("ALTER TABLE users ADD COLUMN display_name_changed_at TIMESTAMP NULL")
	}

	err = DB.QueryRow("SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'email_changed_at'").Scan(&exists)
	if err == nil && exists == 0 {
		log.Println("Adding missing email_changed_at column to users table...")
		DB.Exec("ALTER TABLE users ADD COLUMN email_changed_at TIMESTAMP NULL")
	}

	err = DB.QueryRow("SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'phone_changed_at'").Scan(&exists)
	if err == nil && exists == 0 {
		log.Println("Adding missing phone_changed_at column to users table...")
		DB.Exec("ALTER TABLE users ADD COLUMN phone_changed_at TIMESTAMP NULL")
	}

	err = DB.QueryRow("SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'reviews' AND COLUMN_NAME = 'reply'").Scan(&exists)
	if err == nil && exists == 0 {
		log.Println("Adding missing reply columns to reviews table...")
		DB.Exec("ALTER TABLE reviews ADD COLUMN reply TEXT NULL")
		DB.Exec("ALTER TABLE reviews ADD COLUMN reply_date DATETIME NULL")
		DB.Exec("ALTER TABLE reviews ADD COLUMN replied_by_user_id INT NULL")
		DB.Exec("ALTER TABLE reviews ADD CONSTRAINT fk_replied_by FOREIGN KEY (replied_by_user_id) REFERENCES users(id) ON DELETE SET NULL")
	}
	// Robust column migration for products table
	productCols := map[string]string{
		"value":                "DECIMAL(10,2) NULL",
		"estimated_value_min":  "DECIMAL(10,2) NULL",
		"estimated_value_max":  "DECIMAL(10,2) NULL",
		"show_estimated_value": "BOOLEAN NOT NULL DEFAULT TRUE",
		"wants":                "TEXT NULL",
		"wanted_categories":    "JSON NULL",
		"desired_price":        "DECIMAL(10,2) NULL",
		"desired_product":      "VARCHAR(255) NULL",
		"item_type":            "VARCHAR(100) NULL",
		"brand":                "VARCHAR(100) NULL",
		"authenticity_risks":   "VARCHAR(50) NULL",
		"tags":                 "JSON NULL",
		"boosted_at":           "TIMESTAMP NULL",
		"view_count":           "INT DEFAULT 0",
	}

	for col, def := range productCols {
		columnName := col
		if col == "value" {
			columnName = "`value`"
		}
		_, err := DB.Exec(fmt.Sprintf("ALTER TABLE products ADD COLUMN %s %s", columnName, def))
		if err != nil {
			// Ignore error 1060 (Duplicate column name)
			if mysqlErr, ok := err.(*mysql.MySQLError); ok && mysqlErr.Number == 1060 {
				continue
			}
			log.Printf("Note: Could not add column %s to products table: %v", col, err)
		} else {
			log.Printf("Migration: Added column %s to products table", col)
		}
	}

	// Multi-way review columns
	loopParticipantCols := map[string]string{
		"rating":      "INT DEFAULT 0",
		"feedback":    "TEXT NULL",
		"proof_url":   "VARCHAR(512) NULL",
		"is_reviewed": "BOOLEAN DEFAULT FALSE",
		"reviewed_at": "TIMESTAMP NULL",
	}
	for col, def := range loopParticipantCols {
		_, err := DB.Exec(fmt.Sprintf("ALTER TABLE trade_like_loop_participants ADD COLUMN %s %s", col, def))
		if err != nil {
			if mysqlErr, ok := err.(*mysql.MySQLError); ok && mysqlErr.Number == 1060 {
				continue
			}
		} else {
			log.Printf("Migration: Added column %s to trade_like_loop_participants table", col)
		}
	}
	_, _ = DB.Exec(`ALTER TABLE trade_like_loops MODIFY COLUMN status ENUM('pending','partially_accepted','accepted','confirmed','ongoing','completed','history','rejected','cancelled','cancelled_due_to_conflict','broken','expired') DEFAULT 'pending'`)
	_, _ = DB.Exec(`ALTER TABLE trade_like_loop_participants MODIFY COLUMN status ENUM('pending','confirmed','accepted','declined','rejected','cancelled','cancelled_due_to_conflict','expired') DEFAULT 'pending'`)

	queries := []string{
		`CREATE TABLE IF NOT EXISTS app_settings (
			setting_key VARCHAR(100) PRIMARY KEY,
			setting_value VARCHAR(255) NOT NULL,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS premium_plans (
			id INT AUTO_INCREMENT PRIMARY KEY,
			plan_key VARCHAR(50) NOT NULL UNIQUE,
			name VARCHAR(120) NOT NULL,
			description TEXT NULL,
			tier VARCHAR(20) NOT NULL DEFAULT 'plus',
			billing_type VARCHAR(20) NOT NULL DEFAULT 'monthly',
			duration_days INT NOT NULL DEFAULT 30,
			price DECIMAL(10,2) NOT NULL DEFAULT 0,
			badge_label VARCHAR(80) NULL,
			access_scope VARCHAR(40) NOT NULL DEFAULT 'basic',
			capabilities JSON NULL,
			is_active BOOLEAN NOT NULL DEFAULT TRUE,
			sort_order INT NOT NULL DEFAULT 0,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS premium_features (
			id INT AUTO_INCREMENT PRIMARY KEY,
			feature_key VARCHAR(80) NOT NULL UNIQUE,
			label VARCHAR(255) NOT NULL,
			description TEXT NULL,
			enabled BOOLEAN NOT NULL DEFAULT TRUE,
			sort_order INT NOT NULL DEFAULT 0,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS premium_promotions (
			id INT AUTO_INCREMENT PRIMARY KEY,
			title VARCHAR(160) NOT NULL,
			plan_key VARCHAR(50) NULL,
			discounted_price DECIMAL(10,2) NOT NULL DEFAULT 0,
			capabilities JSON NULL,
			overrides_capabilities BOOLEAN NOT NULL DEFAULT FALSE,
			start_at TIMESTAMP NULL,
			end_at TIMESTAMP NULL,
			is_active BOOLEAN NOT NULL DEFAULT TRUE,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			INDEX idx_premium_promos_dates (start_at, end_at),
			INDEX idx_premium_promos_plan (plan_key)
		)`,
		`CREATE TABLE IF NOT EXISTS premium_feature_usage (
			id INT AUTO_INCREMENT PRIMARY KEY,
			user_id INT NOT NULL,
			feature_key VARCHAR(80) NOT NULL,
			usage_month CHAR(7) NOT NULL,
			usage_count INT NOT NULL DEFAULT 0,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			UNIQUE KEY uniq_premium_feature_usage (user_id, feature_key, usage_month),
			INDEX idx_premium_usage_user_feature (user_id, feature_key),
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
		)`,
		`CREATE TABLE IF NOT EXISTS users (
			id INT AUTO_INCREMENT PRIMARY KEY,
			slug VARCHAR(255) NULL UNIQUE,
			name VARCHAR(255) NOT NULL,
			email VARCHAR(255) UNIQUE NOT NULL,
			phone VARCHAR(20) NULL,
			phone_verified BOOLEAN DEFAULT FALSE,
			phone_otp_hash VARCHAR(255) NULL,
			phone_otp_expires TIMESTAMP NULL,
			password_hash VARCHAR(255) NOT NULL,
			password_changed_at TIMESTAMP NULL,
			display_name_changed_at TIMESTAMP NULL,
			name_changed_at TIMESTAMP NULL,
			email_changed_at TIMESTAMP NULL,
			phone_changed_at TIMESTAMP NULL,
			role VARCHAR(10) NOT NULL DEFAULT 'user',
			is_organization TINYINT(1) NOT NULL DEFAULT 0,
			org_verified TINYINT(1) NOT NULL DEFAULT 0,
			org_name VARCHAR(255) NULL,
			org_handle VARCHAR(100) NULL,
			org_logo_url VARCHAR(512) NULL,
			org_cover_url VARCHAR(512) NULL,
			org_category VARCHAR(120) NULL,
			org_website VARCHAR(512) NULL,
			org_location VARCHAR(255) NULL,
			org_contact_email VARCHAR(255) NULL,
			profile_picture VARCHAR(255) NULL,
			background_image VARCHAR(512) NULL,
			background_position VARCHAR(64) NULL,
			department VARCHAR(255) NULL,
			bio TEXT NULL,
			badges JSON NULL,
			language_preference VARCHAR(10) NULL DEFAULT 'en',
			email_notifications_enabled BOOLEAN DEFAULT TRUE,
			push_notifications_enabled BOOLEAN DEFAULT TRUE,
			notification_preferences JSON NULL,
			verification_status VARCHAR(50) DEFAULT 'not_verified',
			school_name VARCHAR(255) NULL,
			school_email VARCHAR(255) NULL,
			academic_program VARCHAR(255) NULL,
			year_level VARCHAR(80) NULL,
			school_email_verified_at TIMESTAMP NULL,
			school_id_image_path VARCHAR(512) NULL,
			verification_rejection_reason TEXT NULL,
			is_premium BOOLEAN DEFAULT FALSE,
			premium_tier VARCHAR(20) DEFAULT 'free',
			verified BOOLEAN DEFAULT FALSE,
			strikes INT DEFAULT 0,
			is_suspended BOOLEAN DEFAULT FALSE,
			last_login TIMESTAMP NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			INDEX idx_users_is_org (is_organization),
			INDEX idx_users_department (department)
		)`,
		`CREATE TABLE IF NOT EXISTS products (
			id INT AUTO_INCREMENT PRIMARY KEY,
			slug VARCHAR(255) NULL,
			title VARCHAR(255) NOT NULL,
			description TEXT,
			price DECIMAL(10,2),
			image_urls JSON,
			image_url VARCHAR(500),
			seller_id INT NOT NULL,
			premium BOOLEAN DEFAULT FALSE,
			status ENUM('available', 'sold', 'traded', 'locked', 'suspended', 'deleted') DEFAULT 'available',
			allow_buying BOOLEAN DEFAULT TRUE,
			barter_only BOOLEAN DEFAULT FALSE,
			max_items_per_offer INT DEFAULT 0,
			location VARCHAR(255),
			` + "`condition`" + ` VARCHAR(50),
			suggested_value INT,
			category VARCHAR(100),
			estimated_value_min DECIMAL(10,2) NULL,
			estimated_value_max DECIMAL(10,2) NULL,
			show_estimated_value BOOLEAN NOT NULL DEFAULT TRUE,
			value DECIMAL(10,2) NULL,
			wants TEXT NULL,
			wanted_categories JSON NULL,
			desired_price DECIMAL(10,2) NULL,
			desired_product VARCHAR(255) NULL,
			item_type VARCHAR(100) NULL,
			brand VARCHAR(100) NULL,
			authenticity_risks VARCHAR(50) NULL,
			tags JSON NULL,
			latitude FLOAT,
			longitude FLOAT,
			video_url VARCHAR(500) NULL,
			bidding_type ENUM('none', 'blind', 'open') DEFAULT 'none',
			view_count INT DEFAULT 0,
			boosted_at TIMESTAMP NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE CASCADE,
			INDEX idx_products_slug (slug)
		)`,
		`CREATE TABLE IF NOT EXISTS orders (
			id INT AUTO_INCREMENT PRIMARY KEY,
			product_id INT NOT NULL,
			buyer_id INT NOT NULL,
			status ENUM('pending', 'completed', 'cancelled') DEFAULT 'pending',
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
			FOREIGN KEY (buyer_id) REFERENCES users(id) ON DELETE CASCADE
		)`,
		`CREATE TABLE IF NOT EXISTS transactions (
			id INT AUTO_INCREMENT PRIMARY KEY,
			order_id INT NOT NULL,
			amount DECIMAL(10,2) NOT NULL,
			payment_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
		)`,
		`CREATE TABLE IF NOT EXISTS premium_listings (
			id INT AUTO_INCREMENT PRIMARY KEY,
			product_id INT NOT NULL,
			start_date TIMESTAMP NOT NULL,
			end_date TIMESTAMP NOT NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
		)`,
		// Conversations for chat between buyer and seller about a product
		`CREATE TABLE IF NOT EXISTS conversations (
			id INT AUTO_INCREMENT PRIMARY KEY,
			product_id INT NOT NULL,
			buyer_id INT NOT NULL,
			seller_id INT NOT NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			UNIQUE KEY uniq_conversation (product_id, buyer_id, seller_id),
			FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
			FOREIGN KEY (buyer_id) REFERENCES users(id) ON DELETE CASCADE,
			FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE CASCADE
		)`,
		// Messages within a conversation
		`CREATE TABLE IF NOT EXISTS messages (
			id INT AUTO_INCREMENT PRIMARY KEY,
			conversation_id INT NOT NULL,
			sender_id INT NOT NULL,
			content TEXT NOT NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			read_at TIMESTAMP NULL,
			FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
			FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
		)`,
		// Trades and trade items for barter system
		`CREATE TABLE IF NOT EXISTS trades (
			id INT AUTO_INCREMENT PRIMARY KEY,
			buyer_id INT NOT NULL,
			seller_id INT NOT NULL,
			target_product_id INT NOT NULL,
			status ENUM('pending','accepted','declined','countered','active','completed','cancelled') DEFAULT 'pending',
			message TEXT NULL,
			offered_cash_amount DECIMAL(10,2) NULL,
			buyer_completed BOOLEAN DEFAULT FALSE,
			seller_completed BOOLEAN DEFAULT FALSE,
			completed_at TIMESTAMP NULL,
			buyer_rating INT NULL,
			seller_rating INT NULL,
			buyer_feedback TEXT NULL,
			seller_feedback TEXT NULL,
			meetup_location VARCHAR(500) NULL,
			buyer_meetup_confirmed BOOLEAN DEFAULT FALSE,
			seller_meetup_confirmed BOOLEAN DEFAULT FALSE,
			buyer_met BOOLEAN DEFAULT FALSE,
			seller_met BOOLEAN DEFAULT FALSE,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			FOREIGN KEY (buyer_id) REFERENCES users(id) ON DELETE CASCADE,
			FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE CASCADE,
			FOREIGN KEY (target_product_id) REFERENCES products(id) ON DELETE CASCADE
		)`,
		`CREATE TABLE IF NOT EXISTS trade_items (
			id INT AUTO_INCREMENT PRIMARY KEY,
			trade_id INT NOT NULL,
			product_id INT NOT NULL,
			offered_by ENUM('buyer','seller') NOT NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (trade_id) REFERENCES trades(id) ON DELETE CASCADE,
			FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
		)`,
		`CREATE TABLE IF NOT EXISTS trade_messages (
			id INT AUTO_INCREMENT PRIMARY KEY,
			trade_id INT NOT NULL,
			sender_id INT NOT NULL,
			content TEXT NOT NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (trade_id) REFERENCES trades(id) ON DELETE CASCADE,
			FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE
		)`,
		`CREATE TABLE IF NOT EXISTS trade_loop_messages (
			id INT AUTO_INCREMENT PRIMARY KEY,
			loop_id INT NOT NULL,
			sender_id INT NOT NULL,
			content TEXT NOT NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (loop_id) REFERENCES trade_like_loops(id) ON DELETE CASCADE,
			FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
			INDEX idx_loop_messages_loop_id (loop_id),
			INDEX idx_loop_messages_created_at (created_at)
		)`,
		`CREATE TABLE IF NOT EXISTS trade_events (
			id INT AUTO_INCREMENT PRIMARY KEY,
			trade_id INT NOT NULL,
			actor_id INT NULL,
			from_status VARCHAR(32) NULL,
			to_status VARCHAR(32) NULL,
			note VARCHAR(500) NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (trade_id) REFERENCES trades(id) ON DELETE CASCADE,
			FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL
		)`,
		`CREATE TABLE IF NOT EXISTS notifications (
			id INT AUTO_INCREMENT PRIMARY KEY,
			user_id INT NOT NULL,
			type VARCHAR(50) NOT NULL,
			message VARCHAR(500) NOT NULL,
			is_read BOOLEAN DEFAULT FALSE,
			target_type VARCHAR(50) NULL,
			target_id INT NULL,
			target_url VARCHAR(500) NULL,
			metadata JSON NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
		)`,
		`CREATE TABLE IF NOT EXISTS organizations (
			id INT AUTO_INCREMENT PRIMARY KEY,
			creator_user_id INT NOT NULL,
			name VARCHAR(255) NOT NULL,
			slug VARCHAR(80) NOT NULL UNIQUE,
			description TEXT NULL,
			category VARCHAR(120) NOT NULL,
			logo_url VARCHAR(512) NULL,
			cover_url VARCHAR(512) NULL,
			is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
			deleted_at TIMESTAMP NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			FOREIGN KEY (creator_user_id) REFERENCES users(id) ON DELETE CASCADE,
			INDEX idx_org_creator (creator_user_id),
			INDEX idx_org_deleted (is_deleted)
		)`,
		`CREATE TABLE IF NOT EXISTS organization_memberships (
			id INT AUTO_INCREMENT PRIMARY KEY,
			organization_id INT NOT NULL,
			user_id INT NOT NULL,
			status ENUM('pending','approved','rejected','removed','blocked','cancelled_org_deleted') NOT NULL DEFAULT 'pending',
			requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			decided_at TIMESTAMP NULL,
			decided_by_user_id INT NULL,
			removed_at TIMESTAMP NULL,
			cooldown_until TIMESTAMP NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			UNIQUE KEY uniq_org_user (organization_id, user_id),
			FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
			FOREIGN KEY (decided_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
			INDEX idx_org_membership_status (organization_id, status)
		)`,
		`CREATE TABLE IF NOT EXISTS organization_posts (
			id INT AUTO_INCREMENT PRIMARY KEY,
			organization_id INT NOT NULL,
			author_user_id INT NOT NULL,
			content TEXT NOT NULL,
			category_tag VARCHAR(120) NOT NULL,
			image_urls JSON NULL,
			is_looking_for BOOLEAN NULL DEFAULT FALSE,
			is_visible_in_org_feed BOOLEAN NOT NULL DEFAULT TRUE,
			hidden_reason ENUM('member_removed','org_deleted','admin_action') NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
			FOREIGN KEY (author_user_id) REFERENCES users(id) ON DELETE CASCADE,
			INDEX idx_org_posts_feed (organization_id, is_visible_in_org_feed, created_at),
			INDEX idx_org_posts_author (author_user_id, created_at)
		)`,
		`CREATE TABLE IF NOT EXISTS organization_trade_posts (
			id INT AUTO_INCREMENT PRIMARY KEY,
			organization_id INT NOT NULL,
			user_id INT NOT NULL,
			product_id INT NOT NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
			FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
			UNIQUE KEY uniq_org_product (organization_id, product_id),
			INDEX idx_org_trade_posts_org (organization_id, created_at),
			INDEX idx_org_trade_posts_user (user_id, created_at)
		)`,
		`CREATE TABLE IF NOT EXISTS product_organization_tags (
			id INT AUTO_INCREMENT PRIMARY KEY,
			product_id INT NOT NULL,
			organization_id INT NOT NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
			FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
			UNIQUE KEY uniq_product_org_tag (product_id, organization_id),
			INDEX idx_product_id (product_id),
			INDEX idx_organization_id (organization_id)
		)`,
		`CREATE TABLE IF NOT EXISTS comments (
			id INT AUTO_INCREMENT PRIMARY KEY,
			product_id INT NOT NULL,
			user_id INT NOT NULL,
			content TEXT NOT NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
		)`,
		`CREATE TABLE IF NOT EXISTS wishlists (
			id INT AUTO_INCREMENT PRIMARY KEY,
			user_id INT NOT NULL,
			product_id INT NOT NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
			FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
			UNIQUE KEY uniq_wishlist_item (user_id, product_id)
		)`,
		`CREATE TABLE IF NOT EXISTS trade_likes (
			id INT AUTO_INCREMENT PRIMARY KEY,
			liker_id INT NOT NULL,
			liked_product_id INT NOT NULL,
			offered_product_id INT NOT NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (liker_id) REFERENCES users(id) ON DELETE CASCADE,
			FOREIGN KEY (liked_product_id) REFERENCES products(id) ON DELETE CASCADE,
			FOREIGN KEY (offered_product_id) REFERENCES products(id) ON DELETE CASCADE,
			UNIQUE KEY uniq_trade_like (liker_id, liked_product_id, offered_product_id),
			INDEX idx_trade_likes_liker (liker_id),
			INDEX idx_trade_likes_liked_product (liked_product_id),
			INDEX idx_trade_likes_offered_product (offered_product_id)
		)`,
		`CREATE TABLE IF NOT EXISTS trade_like_loops (
			id INT AUTO_INCREMENT PRIMARY KEY,
			loop_key VARCHAR(255) NOT NULL,
			status ENUM('pending', 'partially_accepted', 'accepted', 'confirmed', 'ongoing', 'completed', 'history', 'rejected', 'cancelled', 'cancelled_due_to_conflict', 'broken', 'expired') DEFAULT 'pending',
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			confirmed_at TIMESTAMP NULL,
			UNIQUE KEY uniq_trade_like_loop_key (loop_key),
			INDEX idx_trade_like_loops_status (status)
		)`,
		`CREATE TABLE IF NOT EXISTS trade_like_loop_participants (
			id INT AUTO_INCREMENT PRIMARY KEY,
			loop_id INT NOT NULL,
			user_id INT NOT NULL,
			offered_product_id INT NOT NULL,
			wanted_product_id INT NOT NULL,
			position_in_loop INT NOT NULL,
			status ENUM('pending', 'confirmed', 'accepted', 'declined', 'rejected', 'cancelled', 'cancelled_due_to_conflict', 'expired') DEFAULT 'pending',
			confirmed_at TIMESTAMP NULL,
			rating INT DEFAULT 0,
			feedback TEXT NULL,
			proof_url VARCHAR(512) NULL,
			is_reviewed BOOLEAN DEFAULT FALSE,
			reviewed_at TIMESTAMP NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (loop_id) REFERENCES trade_like_loops(id) ON DELETE CASCADE,
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
			FOREIGN KEY (offered_product_id) REFERENCES products(id) ON DELETE CASCADE,
			FOREIGN KEY (wanted_product_id) REFERENCES products(id) ON DELETE CASCADE,
			UNIQUE KEY uniq_trade_like_loop_user (loop_id, user_id),
			INDEX idx_trade_like_loop_user (user_id),
			INDEX idx_trade_like_loop_loop (loop_id)
		)`,
		`CREATE TABLE IF NOT EXISTS saved_products (
			id INT AUTO_INCREMENT PRIMARY KEY,
			user_id INT NOT NULL,
			product_id INT NOT NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			deleted_at TIMESTAMP NULL DEFAULT NULL,
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
			FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
			UNIQUE KEY unique_user_product (user_id, product_id),
			INDEX idx_user_id (user_id),
			INDEX idx_product_id (product_id),
			INDEX idx_created_at (created_at),
			INDEX idx_deleted_at (deleted_at)
		)`,
		`CREATE TABLE IF NOT EXISTS product_votes (
			id INT AUTO_INCREMENT PRIMARY KEY,
			product_id INT NOT NULL,
			user_id INT NOT NULL,
			vote ENUM('under','over') NOT NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
			UNIQUE KEY uniq_product_user_vote (product_id, user_id)
		)`,
		`CREATE TABLE IF NOT EXISTS riders (
			id INT AUTO_INCREMENT PRIMARY KEY,
			user_id INT NOT NULL,
			name VARCHAR(255) NOT NULL,
			vehicle_type ENUM('motorcycle', 'bicycle', 'car') NOT NULL DEFAULT 'motorcycle',
			vehicle_plate VARCHAR(20) NULL,
			phone VARCHAR(20) NOT NULL,
			rating DECIMAL(3,2) DEFAULT 0.00,
			is_active BOOLEAN DEFAULT TRUE,
			latitude DECIMAL(10,8) NULL,
			longitude DECIMAL(11,8) NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
			UNIQUE KEY unique_rider_user (user_id)
		)`,
		`CREATE TABLE IF NOT EXISTS deliveries (
			id INT AUTO_INCREMENT PRIMARY KEY,
			user_id INT NOT NULL,
			trade_id INT NULL,
			delivery_type ENUM('standard', 'express') NOT NULL DEFAULT 'standard',
			status ENUM('pending', 'claimed', 'picked_up', 'in_transit', 'delivered', 'cancelled') NOT NULL DEFAULT 'pending',
			rider_id INT NULL,
			pickup_latitude DECIMAL(10,8) NULL,
			pickup_longitude DECIMAL(11,8) NULL,
			pickup_address TEXT NOT NULL,
			delivery_latitude DECIMAL(10,8) NULL,
			delivery_longitude DECIMAL(11,8) NULL,
			delivery_address TEXT NOT NULL,
			special_instructions TEXT NULL,
			total_cost DECIMAL(10,2) NOT NULL DEFAULT 0.00,
			estimated_eta TIMESTAMP NULL,
			item_count INT NOT NULL DEFAULT 1,
			is_fragile BOOLEAN DEFAULT FALSE,
			claimed_at TIMESTAMP NULL,
			picked_up_at TIMESTAMP NULL,
			in_transit_at TIMESTAMP NULL,
			delivered_at TIMESTAMP NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
			FOREIGN KEY (trade_id) REFERENCES trades(id) ON DELETE SET NULL,
			FOREIGN KEY (rider_id) REFERENCES riders(id) ON DELETE SET NULL,
			INDEX idx_delivery_user (user_id),
			INDEX idx_delivery_trade (trade_id),
			INDEX idx_delivery_rider (rider_id),
			INDEX idx_delivery_status (status),
			INDEX idx_delivery_type (delivery_type)
		)`,
		`CREATE TABLE IF NOT EXISTS trade_loop_agreements (
			id INT AUTO_INCREMENT PRIMARY KEY,
			loop_id VARCHAR(255) NOT NULL,
			user_id INT NOT NULL,
			status ENUM('accepted', 'declined') NOT NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			UNIQUE KEY uniq_loop_user (loop_id, user_id),
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
		)`,
		`CREATE TABLE IF NOT EXISTS trade_loop_meetup_selections (
			id INT AUTO_INCREMENT PRIMARY KEY,
			loop_id VARCHAR(255) NOT NULL,
			user_id INT NOT NULL,
			meetup_location VARCHAR(500) NULL,
			meetup_date VARCHAR(20) NULL,
			meetup_time VARCHAR(20) NULL,
			meetup_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
			met_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			UNIQUE KEY uniq_loop_meetup_user (loop_id, user_id),
			INDEX idx_loop_meetup_loop (loop_id),
			INDEX idx_loop_meetup_user (user_id),
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
		)`,
		`CREATE TABLE IF NOT EXISTS trade_rejection_signals (
			id INT AUTO_INCREMENT PRIMARY KEY,
			trade_id INT NOT NULL,
			rejector_user_id INT NOT NULL,
			rejected_user_id INT NOT NULL,
			target_product_id INT NULL,
			target_category VARCHAR(255) NULL,
			reason TEXT NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (trade_id) REFERENCES trades(id) ON DELETE CASCADE,
			FOREIGN KEY (rejector_user_id) REFERENCES users(id) ON DELETE CASCADE,
			FOREIGN KEY (rejected_user_id) REFERENCES users(id) ON DELETE CASCADE,
			INDEX idx_trade_rejector (rejector_user_id, created_at),
			INDEX idx_trade_rejected (rejected_user_id, created_at)
		)`,
		`CREATE TABLE IF NOT EXISTS trade_loop_cache (
			id INT AUTO_INCREMENT PRIMARY KEY,
			user_id INT NOT NULL,
			loop_id VARCHAR(255) NOT NULL,
			loop_type VARCHAR(20) NOT NULL DEFAULT 'graph',
			loop_length INT NOT NULL DEFAULT 0,
			score INT NOT NULL DEFAULT 0,
			payload_json LONGTEXT NOT NULL,
			expires_at TIMESTAMP NOT NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			UNIQUE KEY uniq_trade_loop_cache_user_loop (user_id, loop_id),
			INDEX idx_trade_loop_cache_expiry (user_id, expires_at),
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
		)`,
		`CREATE TABLE IF NOT EXISTS loop_quota_usage (
			id INT AUTO_INCREMENT PRIMARY KEY,
			user_id INT NOT NULL,
			period VARCHAR(7) NOT NULL COMMENT 'YYYY-MM',
			used INT NOT NULL DEFAULT 0,
			` + "`limit`" + ` INT NOT NULL DEFAULT 5,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			UNIQUE KEY uniq_loop_quota_usage_user_period (user_id, period),
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
		)`,
		`CREATE TABLE IF NOT EXISTS trade_loop_cancellations (
			id INT AUTO_INCREMENT PRIMARY KEY,
			loop_id VARCHAR(255) NOT NULL UNIQUE,
			cancelled_by INT NOT NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (cancelled_by) REFERENCES users(id) ON DELETE CASCADE
		)`,
		`CREATE TABLE IF NOT EXISTS delivery_items (
			id INT AUTO_INCREMENT PRIMARY KEY,
			delivery_id INT NOT NULL,
			product_id INT NOT NULL,
			product_name VARCHAR(255) NULL,
			is_fragile BOOLEAN DEFAULT FALSE,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (delivery_id) REFERENCES deliveries(id) ON DELETE CASCADE,
			FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE
		)`,
		`CREATE TABLE IF NOT EXISTS delivery_stops (
			id INT AUTO_INCREMENT PRIMARY KEY,
			delivery_id INT NOT NULL,
			stop_number INT NOT NULL,
			stop_type ENUM('pickup', 'delivery') NOT NULL,
			contact_name VARCHAR(255) NOT NULL,
			contact_phone VARCHAR(20) NOT NULL,
			address TEXT NOT NULL,
			latitude DECIMAL(10,8) NULL,
			longitude DECIMAL(11,8) NULL,
			item_qr_code VARCHAR(255) NULL,
			fee_amount DECIMAL(10,2) NOT NULL DEFAULT 0.00,
			status ENUM('pending', 'arrived', 'qr_scanned', 'fee_collected', 'completed') NOT NULL DEFAULT 'pending',
			arrived_at TIMESTAMP NULL,
			qr_scanned_at TIMESTAMP NULL,
			fee_collected_at TIMESTAMP NULL,
			completed_at TIMESTAMP NULL,
			photo_url VARCHAR(512) NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			FOREIGN KEY (delivery_id) REFERENCES deliveries(id) ON DELETE CASCADE,
			INDEX idx_delivery_stop (delivery_id, stop_number),
			INDEX idx_stop_status (status)
		)`,
		// ...existing code...
		// Move rider_cash_collections table creation after delivery_stops
		`CREATE TABLE IF NOT EXISTS rider_cash_collections (
				   id INT AUTO_INCREMENT PRIMARY KEY,
				   rider_id INT NOT NULL,
				   delivery_id INT NOT NULL,
				   stop_id INT NOT NULL,
				   collection_type ENUM('pickup_fee', 'delivery_fee') NOT NULL,
				   amount DECIMAL(10,2) NOT NULL,
				   collected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
				   FOREIGN KEY (rider_id) REFERENCES riders(id) ON DELETE CASCADE,
				   FOREIGN KEY (delivery_id) REFERENCES deliveries(id) ON DELETE CASCADE,
				   FOREIGN KEY (stop_id) REFERENCES delivery_stops(id) ON DELETE CASCADE,
				   INDEX idx_rider_collections (rider_id, collected_at),
				   INDEX idx_delivery_collections (delivery_id)
			   )`,
		`CREATE TABLE IF NOT EXISTS rider_ledger (
			id INT AUTO_INCREMENT PRIMARY KEY,
			rider_id INT NOT NULL UNIQUE,
			total_cash_collected DECIMAL(10,2) NOT NULL DEFAULT 0.00,
			remittance_owed DECIMAL(10,2) NOT NULL DEFAULT 0.00,
			take_home DECIMAL(10,2) NOT NULL DEFAULT 0.00,
			free_slots_remaining INT NOT NULL DEFAULT 3,
			total_free_slots_used INT NOT NULL DEFAULT 0,
			last_remittance_at TIMESTAMP NULL,
			is_locked_for_remittance BOOLEAN DEFAULT FALSE,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			FOREIGN KEY (rider_id) REFERENCES riders(id) ON DELETE CASCADE
		)`,
		`CREATE TABLE IF NOT EXISTS rider_remittance_payments (
			id INT AUTO_INCREMENT PRIMARY KEY,
			rider_id INT NOT NULL,
			amount_paid DECIMAL(10,2) NOT NULL,
			payment_method VARCHAR(100) NOT NULL,
			payment_proof_url VARCHAR(512) NULL,
			status ENUM('pending', 'verified', 'rejected') NOT NULL DEFAULT 'pending',
			verified_by INT NULL,
			verified_at TIMESTAMP NULL,
			rejection_reason TEXT NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (rider_id) REFERENCES riders(id) ON DELETE CASCADE,
			FOREIGN KEY (verified_by) REFERENCES users(id) ON DELETE SET NULL,
			INDEX idx_rider_payments (rider_id, created_at)
		)`,
		`CREATE TABLE IF NOT EXISTS reviews (
			id INT AUTO_INCREMENT PRIMARY KEY,
			reviewer_id INT NOT NULL,
			reviewed_user_id INT NOT NULL,
			rating INT NOT NULL CHECK (rating >= 1 AND rating <= 5),
			comment TEXT NOT NULL,
			reply TEXT NULL,
			reply_date DATETIME NULL,
			replied_by_user_id INT NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			FOREIGN KEY (reviewer_id) REFERENCES users(id) ON DELETE CASCADE,
			FOREIGN KEY (reviewed_user_id) REFERENCES users(id) ON DELETE CASCADE,
			FOREIGN KEY (replied_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
			INDEX idx_reviewed_user (reviewed_user_id),
			INDEX idx_reviewer (reviewer_id),
			INDEX idx_created_at (created_at)
		)`,
		`CREATE TABLE IF NOT EXISTS reports (
			id INT AUTO_INCREMENT PRIMARY KEY,
			reporter_id INT NOT NULL,
			reported_user_id INT NOT NULL,
			product_id INT NULL,
			reason VARCHAR(100) NOT NULL,
			description TEXT NOT NULL,
			status ENUM('pending', 'reviewed', 'resolved', 'dismissed') NOT NULL DEFAULT 'pending',
			reviewer_id INT NULL,
			reviewer_comment TEXT NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE CASCADE,
			FOREIGN KEY (reported_user_id) REFERENCES users(id) ON DELETE CASCADE,
			FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE SET NULL,
			FOREIGN KEY (reviewer_id) REFERENCES users(id) ON DELETE SET NULL,
			INDEX idx_reporter (reporter_id),
			INDEX idx_reported_user (reported_user_id),
			INDEX idx_status (status)
		)`,
		`CREATE TABLE IF NOT EXISTS trade_disputes (
			id INT AUTO_INCREMENT PRIMARY KEY,
			trade_id INT NOT NULL,
			raised_by_id INT NOT NULL,
			reported_user_id INT NOT NULL,
			reason VARCHAR(100) NOT NULL,
			description TEXT NOT NULL,
			evidence_image_1 VARCHAR(500) NULL,
			evidence_image_2 VARCHAR(500) NULL,
			status ENUM('pending', 'reviewed', 'resolved', 'dismissed') NOT NULL DEFAULT 'pending',
			reviewer_id INT NULL,
			resolution_notes TEXT NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			FOREIGN KEY (trade_id) REFERENCES trades(id) ON DELETE CASCADE,
			FOREIGN KEY (raised_by_id) REFERENCES users(id) ON DELETE CASCADE,
			FOREIGN KEY (reported_user_id) REFERENCES users(id) ON DELETE CASCADE,
			FOREIGN KEY (reviewer_id) REFERENCES users(id) ON DELETE SET NULL,
			INDEX idx_disputes_trade (trade_id),
			INDEX idx_disputes_status (status)
		)`,
		`CREATE TABLE IF NOT EXISTS user_strikes (
			id INT AUTO_INCREMENT PRIMARY KEY,
			user_id INT NOT NULL,
			admin_id INT NOT NULL,
			dispute_id INT NULL,
			reason TEXT NOT NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
			FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE CASCADE,
			FOREIGN KEY (dispute_id) REFERENCES trade_disputes(id) ON DELETE SET NULL,
			INDEX idx_strikes_user (user_id)
		)`,
		`CREATE TABLE IF NOT EXISTS trade_grades (
			id INT AUTO_INCREMENT PRIMARY KEY,
			trade_id INT NOT NULL,
			grader_id INT NOT NULL,
			graded_user_id INT NOT NULL,
			communication INT NOT NULL CHECK (communication >= 1 AND communication <= 5),
			item_accuracy INT NOT NULL CHECK (item_accuracy >= 1 AND item_accuracy <= 5),
			punctuality INT NOT NULL CHECK (punctuality >= 1 AND punctuality <= 5),
			overall INT NOT NULL CHECK (overall >= 1 AND overall <= 5),
			comment TEXT,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (trade_id) REFERENCES trades(id) ON DELETE CASCADE,
			FOREIGN KEY (grader_id) REFERENCES users(id) ON DELETE CASCADE,
			FOREIGN KEY (graded_user_id) REFERENCES users(id) ON DELETE CASCADE,
			UNIQUE KEY uk_trade_grader (trade_id, grader_id),
			INDEX idx_graded_user (graded_user_id),
			INDEX idx_trade_id (trade_id)
		)`,
		`CREATE TABLE IF NOT EXISTS campaigns (
			id INT AUTO_INCREMENT PRIMARY KEY,
			title VARCHAR(255) NOT NULL,
			description TEXT,
			image_url VARCHAR(500),
			button_text VARCHAR(100),
			button_link VARCHAR(500),
			start_date TIMESTAMP NULL,
			end_date TIMESTAMP NULL,
			target_users VARCHAR(50) DEFAULT 'all',
			frequency VARCHAR(50) DEFAULT 'once_per_user',
			is_active BOOLEAN DEFAULT TRUE,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			INDEX idx_campaigns_active (is_active),
			INDEX idx_campaigns_dates (start_date, end_date)
		)`,
		`CREATE TABLE IF NOT EXISTS earnings (
			id INT AUTO_INCREMENT PRIMARY KEY,
			user_id INT NOT NULL,
			amount DECIMAL(10,2) NOT NULL,
			source_type ENUM('trade_escrow', 'premium_upgrade', 'delivery_fee', 'product_boost', 'riders_remittance', 'advertisers_revenue', 'google_ads') NOT NULL,
			source_id INT NOT NULL,
			external_id VARCHAR(255) NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
			INDEX idx_earnings_source (source_type, source_id),
			INDEX idx_earnings_created (created_at)
		)`,
		`CREATE TABLE IF NOT EXISTS profile_views (
			id INT AUTO_INCREMENT PRIMARY KEY,
			target_user_id INT NOT NULL,
			viewer_user_id INT NULL,
			viewed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE CASCADE,
			FOREIGN KEY (viewer_user_id) REFERENCES users(id) ON DELETE SET NULL,
			INDEX idx_target_user (target_user_id),
			INDEX idx_viewed_at (viewed_at)
		)`,
		`CREATE TABLE IF NOT EXISTS product_views (
			id INT AUTO_INCREMENT PRIMARY KEY,
			product_id INT NOT NULL,
			viewer_user_id INT NULL,
			viewed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
			FOREIGN KEY (viewer_user_id) REFERENCES users(id) ON DELETE SET NULL,
			INDEX idx_product_id (product_id),
			INDEX idx_viewed_at (viewed_at)
		)`,
		`CREATE TABLE IF NOT EXISTS meetup_status (
			id INT AUTO_INCREMENT PRIMARY KEY,
			trade_id INT NOT NULL UNIQUE,
			stage VARCHAR(20) NOT NULL DEFAULT 'negotiating' COMMENT 'negotiating, scheduled, on_the_way, arrived, completed, no_show',
			buyer_proposed_time TIMESTAMP NULL,
			buyer_proposed_location VARCHAR(500) NULL,
			seller_proposed_time TIMESTAMP NULL,
			seller_proposed_location VARCHAR(500) NULL,
			agreed_time TIMESTAMP NULL,
			agreed_location VARCHAR(500) NULL,
			reminder_sent BOOLEAN DEFAULT FALSE,
			reminder_sent_at TIMESTAMP NULL,
			buyer_heading_out BOOLEAN DEFAULT FALSE,
			seller_heading_out BOOLEAN DEFAULT FALSE,
			buyer_arrived BOOLEAN DEFAULT FALSE,
			seller_arrived BOOLEAN DEFAULT FALSE,
			buyer_arrived_at TIMESTAMP NULL,
			seller_arrived_at TIMESTAMP NULL,
			completed_at TIMESTAMP NULL,
			no_show_reported_by INT NULL,
			no_show_reported_at TIMESTAMP NULL,
			no_show_reason VARCHAR(500) NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			FOREIGN KEY (trade_id) REFERENCES trades(id) ON DELETE CASCADE,
			FOREIGN KEY (no_show_reported_by) REFERENCES users(id) ON DELETE SET NULL,
			INDEX idx_stage (stage),
			INDEX idx_agreed_time (agreed_time)
		)`,
		`CREATE TABLE IF NOT EXISTS meetup_system_messages (
			id INT AUTO_INCREMENT PRIMARY KEY,
			trade_id INT NOT NULL,
			message_type VARCHAR(50) NOT NULL COMMENT 'negotiation_prompt, scheduled_confirmation, reminder, heading_out, arrived, completion_prompt, no_show_report',
			title VARCHAR(255) NOT NULL,
			description TEXT NOT NULL,
			actions JSON NULL COMMENT 'JSON array of action objects',
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (trade_id) REFERENCES trades(id) ON DELETE CASCADE,
			INDEX idx_trade_messages (trade_id, created_at),
			INDEX idx_message_type (message_type)
		)`,
		`CREATE TABLE IF NOT EXISTS meetup_proposals (
			id INT AUTO_INCREMENT PRIMARY KEY,
			trade_id INT NOT NULL,
			user_id INT NOT NULL,
			proposed_time TIMESTAMP NOT NULL,
			proposed_location VARCHAR(500) NOT NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			FOREIGN KEY (trade_id) REFERENCES trades(id) ON DELETE CASCADE,
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
			INDEX idx_trade_proposals (trade_id),
			INDEX idx_user_proposals (user_id)
		)`,
		`CREATE TABLE IF NOT EXISTS dispute_escalations (
			id INT AUTO_INCREMENT PRIMARY KEY,
			dispute_id INT NOT NULL UNIQUE,
			trade_id INT NOT NULL,
			raised_by_id INT NOT NULL,
			reported_user_id INT NOT NULL,
			reason VARCHAR(100) NOT NULL,
			status ENUM('open', 'under_review', 'resolved') NOT NULL DEFAULT 'open',
			assigned_to_id INT NULL,
			sla_due_at TIMESTAMP NOT NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			FOREIGN KEY (dispute_id) REFERENCES trade_disputes(id) ON DELETE CASCADE,
			FOREIGN KEY (trade_id) REFERENCES trades(id) ON DELETE CASCADE,
			FOREIGN KEY (raised_by_id) REFERENCES users(id) ON DELETE CASCADE,
			FOREIGN KEY (reported_user_id) REFERENCES users(id) ON DELETE CASCADE,
			FOREIGN KEY (assigned_to_id) REFERENCES users(id) ON DELETE SET NULL,
			INDEX idx_escalations_status (status),
			INDEX idx_escalations_sla_due (sla_due_at),
			INDEX idx_escalations_assigned (assigned_to_id)
		)`,
		`CREATE TABLE IF NOT EXISTS escalation_evidence (
			id INT AUTO_INCREMENT PRIMARY KEY,
			escalation_id INT NOT NULL,
			evidence_type ENUM('photo', 'chat_transcript') NOT NULL,
			evidence_url VARCHAR(500) NULL,
			evidence_data LONGTEXT NULL,
			uploaded_by_id INT NOT NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (escalation_id) REFERENCES dispute_escalations(id) ON DELETE CASCADE,
			FOREIGN KEY (uploaded_by_id) REFERENCES users(id) ON DELETE CASCADE,
			INDEX idx_evidence_escalation (escalation_id)
		)`,
		`CREATE TABLE IF NOT EXISTS escalation_resolutions (
			id INT AUTO_INCREMENT PRIMARY KEY,
			escalation_id INT NOT NULL UNIQUE,
			resolved_by_admin_id INT NULL,
			outcome_type ENUM('proceed', 'cancel_return_strike', 'suspend_pending', 'partial_refund', 'warning_only', 'conditional_strike', 'split_resolution') NOT NULL,
			refund_amount DECIMAL(10,2) NULL,
			notes TEXT,
			resolved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (escalation_id) REFERENCES dispute_escalations(id) ON DELETE CASCADE,
			FOREIGN KEY (resolved_by_admin_id) REFERENCES users(id) ON DELETE SET NULL,
			INDEX idx_resolution_escalation (escalation_id)
		)`,
		`CREATE TABLE IF NOT EXISTS escalation_reminders (
			id INT AUTO_INCREMENT PRIMARY KEY,
			escalation_id INT NOT NULL,
			milestone VARCHAR(20) NOT NULL,
			notified_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (escalation_id) REFERENCES dispute_escalations(id) ON DELETE CASCADE,
			INDEX idx_reminder_escalation (escalation_id),
			UNIQUE KEY unique_escalation_milestone (escalation_id, milestone)
		)`,
		`CREATE TABLE IF NOT EXISTS peer_tags (
			id INT AUTO_INCREMENT PRIMARY KEY,
			trade_id INT NOT NULL,
			giver_id INT NOT NULL,
			receiver_id INT NOT NULL,
			tag_name VARCHAR(100) NOT NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (trade_id) REFERENCES trades(id) ON DELETE CASCADE,
			FOREIGN KEY (giver_id) REFERENCES users(id) ON DELETE CASCADE,
			FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE,
			INDEX idx_peer_tags_trade (trade_id),
			INDEX idx_peer_tags_receiver (receiver_id),
			INDEX idx_peer_tags_giver (giver_id),
			UNIQUE KEY unique_tag_per_trade (trade_id, giver_id, receiver_id, tag_name)
		)`,
		`CREATE TABLE IF NOT EXISTS peer_tag_counts (
			id INT AUTO_INCREMENT PRIMARY KEY,
			receiver_id INT NOT NULL,
			tag_name VARCHAR(100) NOT NULL,
			count INT NOT NULL DEFAULT 0,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE,
			INDEX idx_tag_counts_receiver (receiver_id),
			UNIQUE KEY unique_user_tag (receiver_id, tag_name)
		)`,
	}

	// Execute table creation queries
	for _, query := range queries {
		if _, err := DB.Exec(query); err != nil {
			return fmt.Errorf("failed to create tables: %v", err)
		}
	}

	EnsureNotificationColumns(DB)
	ensureIndexes()

	ensureUserColumns()
	ensureProductColumns()
	ensureTradeColumns()
	ensureDisputeColumns()
	ensureMultiwayColumns()
	ensureRiderColumns()
	ensureDeliveryBatchColumns()
	ensureAppSettingsDefaults()

	// Seed Mock Rider: Wynry Perian
	mockRiderEmail := "wynry@clovia.com"
	var riderUserID int
	err = DB.QueryRow("SELECT id FROM users WHERE email = ?", mockRiderEmail).Scan(&riderUserID)
	if err == sql.ErrNoRows {
		res, execErr := DB.Exec("INSERT INTO users (name, email, password_hash, role, verified) VALUES (?, ?, ?, ?, ?)",
			"Wynry Perian", mockRiderEmail, "mock_password", "rider", true)
		if execErr == nil {
			id, _ := res.LastInsertId()
			riderUserID = int(id)
			log.Printf("Created mock rider user profile with ID: %d", riderUserID)
		} else {
			log.Printf("Failed to create mock rider user: %v", execErr)
		}
	}

	if riderUserID > 0 {
		var riderCount int
		DB.QueryRow("SELECT COUNT(*) FROM riders WHERE user_id = ?", riderUserID).Scan(&riderCount)
		if riderCount == 0 {
			_, err := DB.Exec("INSERT INTO riders (user_id, name, vehicle_type, vehicle_plate, phone, rating, is_active, latitude, longitude, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
				riderUserID, "Wynry Perian", "motorcycle", "WMSU-RX7", "09991234567", 5.0, true, 6.9214, 122.0790, "approved")
			if err == nil {
				log.Println("Seeded mock rider Wynry Perian into the database.")
			} else {
				log.Printf("Failed to seed mock rider: %v", err)
			}
		}
	}

	log.Println("Database tables and indexes created successfully")
	return nil
}

// ensureDisputeColumns adds missing columns and creates dispute_messages table if needed
func ensureDisputeColumns() {
	// Add missing columns to trade_disputes
	columns := []struct {
		name       string
		definition string
	}{
		{"category", "VARCHAR(50) NULL DEFAULT 'item_not_as_described' COMMENT 'item_not_as_described, no_show, rider_damage, safety, harassment'"},
		{"response_deadline", "TIMESTAMP NULL COMMENT 'filed_at + 48 hours'"},
		{"dispute_frozen_at", "TIMESTAMP NULL COMMENT 'When trade was frozen due to dispute'"},
		{"archive_timer_paused_at", "TIMESTAMP NULL COMMENT 'When 7-day archive timer was paused'"},
		{"resolution", "VARCHAR(50) NULL COMMENT 'accepted, mutual, admin_upheld, admin_reversed, admin_suspended'"},
		{"admin_notes", "TEXT NULL"},
		// Mutual agreement fields
		{"mutual_agreement_party1", "BOOLEAN DEFAULT FALSE COMMENT 'Party 1 (raised_by_id) agreed to resolution'"},
		{"mutual_agreement_party2", "BOOLEAN DEFAULT FALSE COMMENT 'Party 2 (reported_user_id) agreed to resolution'"},
		{"mutual_agreement_at", "TIMESTAMP NULL COMMENT 'When both parties agreed to resolution'"},
		{"agreed_resolution_type", "VARCHAR(50) NULL COMMENT 'complete or cancel - what both parties agreed to'"},
		// Rating fields (1-5 stars)
		{"party1_rating", "INT NULL COMMENT 'Rating given by raised_by_id (1-5)'"},
		{"party2_rating", "INT NULL COMMENT 'Rating given by reported_user_id (1-5)'"},
		// Auto-escalation fields
		{"auto_escalated", "BOOLEAN DEFAULT FALSE COMMENT 'Whether dispute was auto-escalated to admin'"},
		{"auto_escalated_at", "TIMESTAMP NULL COMMENT 'When dispute was auto-escalated'"},
		{"escalation_reason", "TEXT NULL COMMENT 'Reason for auto-escalation'"},
	}

	for _, col := range columns {
		var count int
		err := DB.QueryRow(`
			SELECT COUNT(*)
			FROM information_schema.COLUMNS
			WHERE TABLE_SCHEMA = DATABASE()
			AND TABLE_NAME = 'trade_disputes'
			AND COLUMN_NAME = ?
		`, col.name).Scan(&count)

		if err != nil {
			log.Printf("Warning: failed to check dispute column %s: %v", col.name, err)
			continue
		}

		if count == 0 {
			query := fmt.Sprintf("ALTER TABLE trade_disputes ADD COLUMN %s %s", col.name, col.definition)
			if _, err := DB.Exec(query); err != nil {
				log.Printf("Warning: failed to add dispute column %s: %v", col.name, err)
			} else {
				log.Printf("Added missing dispute column: %s", col.name)
			}
		}
	}

	// Ensure dispute status ENUM includes new states
	var disputeStatusType string
	if err := DB.QueryRow(`
		SELECT COLUMN_TYPE FROM information_schema.COLUMNS
		WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'trade_disputes' AND COLUMN_NAME = 'status'
	`).Scan(&disputeStatusType); err == nil {
		requiredStatuses := []string{"'filed'", "'mutual_resolution'", "'counter_evidence'", "'negotiation'",
			"'resolved_accepted'", "'resolved_mutual'", "'admin_escalation'", "'resolved_admin_upheld'",
			"'resolved_admin_reversed'", "'resolved_admin_suspended'", "'cancelled'"}

		needsUpdate := false
		for _, status := range requiredStatuses {
			if !contains(disputeStatusType, status) {
				needsUpdate = true
				break
			}
		}

		if needsUpdate {
			newEnum := "ENUM('filed','mutual_resolution','counter_evidence','negotiation','resolved_accepted','resolved_mutual','admin_escalation','resolved_admin_upheld','resolved_admin_reversed','resolved_admin_suspended','cancelled')"
			if _, err := DB.Exec(fmt.Sprintf(`ALTER TABLE trade_disputes MODIFY COLUMN status %s DEFAULT 'filed'`, newEnum)); err != nil {
				log.Printf("Warning: failed to update dispute status enum: %v", err)
			} else {
				log.Println("Updated trade_disputes status enum with new states")
			}
		}
	}

	// Create dispute_messages table if it doesn't exist
	_, _ = DB.Exec(`CREATE TABLE IF NOT EXISTS dispute_messages (
		id INT AUTO_INCREMENT PRIMARY KEY,
		dispute_id INT NOT NULL,
		sender_id INT NOT NULL,
		message TEXT NOT NULL,
		photo_evidence VARCHAR(500) NULL COMMENT 'Counter-evidence photo URL',
		sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		last_response_deadline TIMESTAMP NULL COMMENT '12 hours from message sent',
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (dispute_id) REFERENCES trade_disputes(id) ON DELETE CASCADE,
		FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
		INDEX idx_dispute_messages_dispute (dispute_id),
		INDEX idx_dispute_messages_sender (sender_id),
		INDEX idx_dispute_messages_deadline (last_response_deadline)
	)`)

	// Create trade_responses table for tracking party agreement and ratings
	_, _ = DB.Exec(`CREATE TABLE IF NOT EXISTS trade_responses (
		id INT AUTO_INCREMENT PRIMARY KEY,
		dispute_id INT NOT NULL,
		party_id INT NOT NULL COMMENT 'User ID of party responding',
		agreed_resolution_type VARCHAR(50) COMMENT 'complete or cancel - what this party agrees to',
		rating INT COMMENT 'Rating given by this party (1-5 stars)',
		user_feedback TEXT COMMENT 'Feedback text from party',
		response_type VARCHAR(50) COMMENT 'agreement, rating, or both',
		responded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		FOREIGN KEY (dispute_id) REFERENCES trade_disputes(id) ON DELETE CASCADE,
		FOREIGN KEY (party_id) REFERENCES users(id) ON DELETE CASCADE,
		INDEX idx_trade_responses_dispute (dispute_id),
		INDEX idx_trade_responses_party (party_id),
		UNIQUE KEY uk_dispute_party (dispute_id, party_id)
	)`)
}

func ensureAppSettingsDefaults() {
	// Ensure rider free slots default is present. This powers Task 19/20.
	_, err := DB.Exec(`INSERT IGNORE INTO app_settings (setting_key, setting_value) VALUES
		('rider_free_slots_default', '3'),
		('premium_enabled', 'true'),
		('premium_monthly_price', '79'),
		('premium_yearly_price', '699'),
		('premium_promo_price', ''),
		('show_own_products_on_home', 'true')`)
	if err != nil {
		log.Printf("Warning: failed to seed app_settings defaults: %v", err)
	}
	_, err = DB.Exec(`
		ALTER TABLE premium_plans
			ADD COLUMN description TEXT NULL,
			ADD COLUMN badge_label VARCHAR(80) NULL,
			ADD COLUMN access_scope VARCHAR(40) NOT NULL DEFAULT 'basic',
			ADD COLUMN capabilities JSON NULL
	`)
	if err != nil && !strings.Contains(strings.ToLower(err.Error()), "duplicate") {
		log.Printf("Warning: failed to ensure premium plan capability columns: %v", err)
	}
	_, err = DB.Exec(`
		INSERT IGNORE INTO premium_plans (plan_key, name, description, tier, billing_type, duration_days, price, badge_label, access_scope, capabilities, is_active, sort_order) VALUES
		('free', 'Free Plan', 'Baseline marketplace access for all users.', 'free', 'free', 0, 0, 'Free', 'basic', '{"listing_limit":10,"active_trade_limit":5,"monthly_boost_limit":0,"free_boost_enabled":false,"priority_listing_visibility":false,"featured_listing_enabled":false,"premium_badge_enabled":false,"premium_profile_styling_enabled":false,"advanced_trade_tools_enabled":false,"analytics_enabled":false,"premium_filters_enabled":false,"priority_support_enabled":false,"wider_visibility_enabled":false,"discovery_priority":1}', true, 0),
		('plus_monthly', 'Premium Monthly', 'Monthly Plus access.', 'plus', 'monthly', 30, 79, 'Plus', 'enhanced', '{"listing_limit":30,"active_trade_limit":25,"monthly_boost_limit":3,"free_boost_enabled":true,"priority_listing_visibility":true,"featured_listing_enabled":true,"premium_badge_enabled":true,"premium_profile_styling_enabled":true,"advanced_trade_tools_enabled":true,"analytics_enabled":true,"premium_filters_enabled":true,"priority_support_enabled":false,"wider_visibility_enabled":true,"discovery_priority":2}', true, 10),
		('plus_yearly', 'Premium Yearly', 'Yearly Plus access.', 'plus', 'yearly', 365, 699, 'Plus', 'enhanced', '{"listing_limit":30,"active_trade_limit":25,"monthly_boost_limit":3,"free_boost_enabled":true,"priority_listing_visibility":true,"featured_listing_enabled":true,"premium_badge_enabled":true,"premium_profile_styling_enabled":true,"advanced_trade_tools_enabled":true,"analytics_enabled":true,"premium_filters_enabled":true,"priority_support_enabled":false,"wider_visibility_enabled":true,"discovery_priority":2}', true, 20),
		('pro_monthly', 'Pro Monthly', 'Monthly Pro access with broader visibility.', 'pro', 'monthly', 30, 129, 'Pro', 'broad', '{"listing_limit":999999,"active_trade_limit":999999,"monthly_boost_limit":10,"free_boost_enabled":true,"priority_listing_visibility":true,"featured_listing_enabled":true,"premium_badge_enabled":true,"premium_profile_styling_enabled":true,"advanced_trade_tools_enabled":true,"analytics_enabled":true,"premium_filters_enabled":true,"priority_support_enabled":true,"wider_visibility_enabled":true,"discovery_priority":3}', true, 30),
		('pro_yearly', 'Pro Yearly', 'Yearly Pro access with broader visibility.', 'pro', 'yearly', 365, 1099, 'Pro', 'broad', '{"listing_limit":999999,"active_trade_limit":999999,"monthly_boost_limit":10,"free_boost_enabled":true,"priority_listing_visibility":true,"featured_listing_enabled":true,"premium_badge_enabled":true,"premium_profile_styling_enabled":true,"advanced_trade_tools_enabled":true,"analytics_enabled":true,"premium_filters_enabled":true,"priority_support_enabled":true,"wider_visibility_enabled":true,"discovery_priority":3}', true, 40),
		('student_promo', 'Student Promo Premium', 'Limited student promo access.', 'plus', 'promo', 30, 49, 'Student Promo', 'enhanced', '{"listing_limit":30,"active_trade_limit":25,"monthly_boost_limit":5,"free_boost_enabled":true,"priority_listing_visibility":true,"featured_listing_enabled":true,"premium_badge_enabled":true,"premium_profile_styling_enabled":true,"advanced_trade_tools_enabled":true,"analytics_enabled":true,"premium_filters_enabled":true,"priority_support_enabled":false,"wider_visibility_enabled":true,"discovery_priority":2}', false, 50)
	`)
	if err != nil {
		log.Printf("Warning: failed to seed premium plans: %v", err)
	}
	_, err = DB.Exec(`ALTER TABLE premium_promotions ADD COLUMN capabilities JSON NULL, ADD COLUMN overrides_capabilities BOOLEAN NOT NULL DEFAULT FALSE`)
	if err != nil && !strings.Contains(strings.ToLower(err.Error()), "duplicate") {
		log.Printf("Warning: failed to ensure premium promotion capability columns: %v", err)
	}
	_, err = DB.Exec(`
		INSERT IGNORE INTO premium_features (feature_key, label, description, enabled, sort_order) VALUES
		('boosted_listings', 'Boosted listings', 'Premium listings can be boosted for higher marketplace placement.', true, 10),
		('more_uploads', 'More product uploads', 'Premium members can keep more active listings.', true, 20),
		('priority_trade_visibility', 'Priority trade visibility', 'Premium members receive stronger trade discovery placement.', true, 30),
		('premium_badge', 'Premium badge', 'Show premium badges on profiles and listings.', true, 40),
		('featured_placement', 'Featured placement', 'Eligible listings can appear in featured inventory positions.', true, 50)
	`)
	if err != nil {
		log.Printf("Warning: failed to seed premium features: %v", err)
	}
}

// ensureUserColumns adds missing columns to the users table if they don't exist
func ensureUserColumns() {
	columns := []struct {
		name       string
		definition string
	}{
		{"slug", "VARCHAR(255) NULL UNIQUE"},
		{"is_organization", "TINYINT(1) NOT NULL DEFAULT 0"},
		{"org_verified", "TINYINT(1) NOT NULL DEFAULT 0"},
		{"org_name", "VARCHAR(255) NULL"},
		{"org_handle", "VARCHAR(100) NULL"},
		{"org_logo_url", "VARCHAR(512) NULL"},
		{"org_cover_url", "VARCHAR(512) NULL"},
		{"org_category", "VARCHAR(120) NULL"},
		{"org_website", "VARCHAR(512) NULL"},
		{"org_location", "VARCHAR(255) NULL"},
		{"org_contact_email", "VARCHAR(255) NULL"},
		{"profile_picture", "VARCHAR(255) NULL"},
		{"background_image", "VARCHAR(512) NULL"},
		{"background_position", "VARCHAR(64) NULL"},
		{"department", "VARCHAR(255) NULL"},
		{"bio", "TEXT NULL"},
		{"badges", "JSON NULL"},
		{"notification_preferences", "JSON NULL"},
		{"latitude", "DECIMAL(10,8) NULL"},
		{"longitude", "DECIMAL(11,8) NULL"},
		// School ID verification columns
		{"verification_status", "ENUM('not_verified','pending','verified','rejected') NOT NULL DEFAULT 'not_verified'"},
		{"school_name", "VARCHAR(255) NULL"},
		{"school_email", "VARCHAR(255) NULL"},
		{"academic_program", "VARCHAR(255) NULL"},
		{"year_level", "VARCHAR(80) NULL"},
		{"school_email_verified_at", "TIMESTAMP NULL"},
		{"school_id_image_path", "VARCHAR(512) NULL"},
		{"verification_rejection_reason", "TEXT NULL"},
		{"school_email_otp_hash", "VARCHAR(255) NULL"},
		{"school_email_otp_expires", "TIMESTAMP NULL"},
		{"phone", "VARCHAR(20) NULL"},
		{"phone_verified", "BOOLEAN DEFAULT FALSE"},
		{"phone_otp_hash", "VARCHAR(255) NULL"},
		{"phone_otp_expires", "TIMESTAMP NULL"},
		{"password_changed_at", "TIMESTAMP NULL"},
		{"display_name_changed_at", "TIMESTAMP NULL"},
		{"name_changed_at", "TIMESTAMP NULL"},
		{"email_changed_at", "TIMESTAMP NULL"},
		{"school_id_document_type", "VARCHAR(20) NULL"},
		{"is_premium", "BOOLEAN NOT NULL DEFAULT FALSE"},
		{"last_login", "TIMESTAMP NULL"},
		{"email_otp_hash", "VARCHAR(255) NULL"},
		{"email_otp_expires", "TIMESTAMP NULL"},
		{"reset_password_otp_hash", "VARCHAR(255) NULL"},
		{"reset_password_otp_expires", "TIMESTAMP NULL"},
		{"password_reset_otp_hash", "VARCHAR(255) NULL"},
		{"password_reset_otp_expires", "TIMESTAMP NULL"},
	}

	for _, col := range columns {
		// Check if column exists
		var count int
		err := DB.QueryRow(`
			SELECT COUNT(*) 
			FROM information_schema.COLUMNS 
			WHERE TABLE_SCHEMA = DATABASE() 
			AND TABLE_NAME = 'users' 
			AND COLUMN_NAME = ?
		`, col.name).Scan(&count)

		if err != nil {
			log.Printf("Warning: failed to check column %s: %v", col.name, err)
			continue
		}

		// Add column if it doesn't exist
		if count == 0 {
			query := fmt.Sprintf("ALTER TABLE users ADD COLUMN %s %s", col.name, col.definition)
			if _, err := DB.Exec(query); err != nil {
				log.Printf("Warning: failed to add column %s: %v", col.name, err)
			} else {
				log.Printf("Added missing column: %s", col.name)
			}
		}
	}

	// Ensure badges column is initialized for existing users
	DB.Exec("UPDATE users SET badges = JSON_ARRAY() WHERE badges IS NULL")
}

// ensureProductColumns adds missing columns to the products table if they don't exist
func ensureProductColumns() {
	columns := []struct {
		name       string
		definition string
	}{
		{"latitude", "FLOAT NULL"},
		{"longitude", "FLOAT NULL"},
		{"slug", "VARCHAR(255) NULL"},
		{"image_url", "VARCHAR(500) NULL"},
		{"condition", "VARCHAR(50) NULL"},
		{"suggested_value", "INT NULL"},
		{"category", "VARCHAR(255) DEFAULT 'General'"},
		{"authenticity_verified", "TINYINT(1) DEFAULT 0"},
		{"video_url", "VARCHAR(500) NULL"},
		{"wants", "VARCHAR(255) NULL"},
		{"wanted_categories", "VARCHAR(500) NULL"},
		{"desired_price", "DECIMAL(10,2) NULL"},
		{"desired_product", "VARCHAR(500) NULL"},
		{"item_type", "VARCHAR(100) NULL"},
		{"brand", "VARCHAR(100) NULL"},
		{"authenticity_risks", "VARCHAR(50) NULL"},
		{"tags", "JSON NULL"},
		{"estimated_value_min", "DECIMAL(10,2) NULL"},
		{"estimated_value_max", "DECIMAL(10,2) NULL"},
		{"show_estimated_value", "BOOLEAN NOT NULL DEFAULT TRUE"},
		{"value", "DECIMAL(10,2) NULL"},
		{"price_reasoning", "TEXT NULL"},
		{"ai_analysis_generated_at", "TIMESTAMP NULL"},
		{"boosted_at", "TIMESTAMP NULL"},
		{"max_items_per_offer", "INT DEFAULT 0"},
		{"view_count", "INT DEFAULT 0"},
	}

	for _, col := range columns {
		// Check if column exists
		var count int
		err := DB.QueryRow(`
			SELECT COUNT(*) 
			FROM information_schema.COLUMNS 
			WHERE TABLE_SCHEMA = DATABASE() 
			AND TABLE_NAME = 'products' 
			AND COLUMN_NAME = ?
		`, col.name).Scan(&count)

		if err != nil {
			log.Printf("Warning: failed to check column %s: %v", col.name, err)
			continue
		}

		// Add column if it doesn't exist
		if count == 0 {
			colName := col.name
			// Escape reserved identifiers
			if colName == "condition" || colName == "value" {
				colName = "`" + colName + "`"
			}
			query := fmt.Sprintf("ALTER TABLE products ADD COLUMN %s %s", colName, col.definition)
			if _, err := DB.Exec(query); err != nil {
				log.Printf("Warning: failed to add column %s: %v", col.name, err)
			} else {
				log.Printf("Added missing column to products: %s", col.name)
			}
		}
	}

	// Update status enum to include all required statuses
	updateProductStatusEnum()

	// Ensure defaults
	DB.Exec("UPDATE products SET max_items_per_offer = 0 WHERE max_items_per_offer IS NULL")
}

// EnsureNotificationColumns adds optional target metadata columns used for
// accurate notification click-throughs.
func EnsureNotificationColumns(db *sql.DB) {
	if db == nil {
		db = DB
	}
	if db == nil {
		return
	}

	columns := []struct {
		name       string
		definition string
	}{
		{"target_type", "VARCHAR(50) NULL"},
		{"target_id", "INT NULL"},
		{"target_url", "VARCHAR(500) NULL"},
		{"metadata", "JSON NULL"},
	}

	for _, col := range columns {
		var count int
		err := db.QueryRow(`
			SELECT COUNT(*)
			FROM information_schema.COLUMNS
			WHERE TABLE_SCHEMA = DATABASE()
			  AND TABLE_NAME = 'notifications'
			  AND COLUMN_NAME = ?
		`, col.name).Scan(&count)
		if err != nil {
			log.Printf("Warning: failed to check notifications.%s column: %v", col.name, err)
			continue
		}
		if count > 0 {
			continue
		}

		query := fmt.Sprintf("ALTER TABLE notifications ADD COLUMN %s %s", col.name, col.definition)
		if _, err := db.Exec(query); err != nil {
			log.Printf("Warning: failed to add notifications.%s column: %v", col.name, err)
			continue
		}
		log.Printf("Added missing column to notifications: %s", col.name)
	}
}

// updateProductStatusEnum ensures the status column has all required enum values
func updateProductStatusEnum() {
	// Check current status enum
	var columnType string
	err := DB.QueryRow(`
		SELECT COLUMN_TYPE
		FROM information_schema.COLUMNS
		WHERE TABLE_SCHEMA = DATABASE()
		AND TABLE_NAME = 'products'
		AND COLUMN_NAME = 'status'
	`).Scan(&columnType)

	if err != nil {
		log.Printf("Warning: failed to check status column type: %v", err)
		return
	}

	// If status doesn't include all required values, update it.
	if !contains(columnType, "'traded'") || !contains(columnType, "'locked'") || !contains(columnType, "'suspended'") || !contains(columnType, "'deleted'") {
		query := `ALTER TABLE products MODIFY COLUMN status ENUM('available','sold','traded','locked','suspended','deleted') DEFAULT 'available'`
		if _, err := DB.Exec(query); err != nil {
			log.Printf("Warning: failed to update status enum: %v", err)
		} else {
			log.Println("Updated products status enum to include 'traded', 'locked', 'suspended', and 'deleted'")
		}
	}
}

// ensureTradeColumns adds missing columns to the trades table if they don't exist
func ensureTradeColumns() {
	columns := []struct {
		name       string
		definition string
	}{
		{"buyer_accepted", "BOOLEAN DEFAULT FALSE"},
		{"seller_accepted", "BOOLEAN DEFAULT FALSE"},
		{"parent_trade_id", "INT NULL"},
		{"trade_option", "VARCHAR(20) NULL DEFAULT 'meetup'"},
		{"delivery_address", "TEXT NULL"},
		{"buyer_rating", "INT NULL"},
		{"seller_rating", "INT NULL"},
		{"buyer_feedback", "TEXT NULL"},
		{"seller_feedback", "TEXT NULL"},
		{"buyer_proof_url", "VARCHAR(500) NULL"},
		{"seller_proof_url", "VARCHAR(500) NULL"},
		{"first_completion_at", "TIMESTAMP NULL"},
		{"awaiting_confirmation_since", "TIMESTAMP NULL"},
		{"delivery_type", "VARCHAR(20) NULL DEFAULT 'standard'"},
		{"payment_method", "VARCHAR(20) NULL DEFAULT 'gcash'"},
		{"payment_confirmed", "BOOLEAN DEFAULT FALSE"},
		{"xendit_invoice_id", "VARCHAR(255) NULL"},
		{"xendit_external_id", "VARCHAR(255) NULL"},
		{"delivery_instructions", "TEXT NULL"},
		{"proof_of_delivery", "LONGTEXT NULL"},
		{"buyer_confirmed_receipt", "BOOLEAN DEFAULT FALSE"},
		{"seller_confirmed_delivery", "BOOLEAN DEFAULT FALSE"},
		{"auto_completed_at", "TIMESTAMP NULL DEFAULT NULL"},
		{"awaiting_confirmation_since", "TIMESTAMP NULL"},
		{"option_change_requested", "VARCHAR(20) NULL DEFAULT NULL"},
		{"net_amount", "DECIMAL(10,2) DEFAULT 0.00"},
		{"message", "TEXT NULL"},
		{"offered_cash_amount", "DECIMAL(10,2) NULL"},
		{"meetup_time", "VARCHAR(50) NULL"},
		{"buyer_meetup_location", "VARCHAR(500) NULL"},
		{"buyer_meetup_time", "VARCHAR(50) NULL"},
		{"seller_meetup_location", "VARCHAR(500) NULL"},
		{"seller_meetup_time", "VARCHAR(50) NULL"},
		{"buyer_met", "BOOLEAN DEFAULT FALSE"},
		{"seller_met", "BOOLEAN DEFAULT FALSE"},
		{"buyer_photo_is_camera", "BOOLEAN DEFAULT FALSE"},
		{"seller_photo_is_camera", "BOOLEAN DEFAULT FALSE"},
		{"cancellation_reason", "VARCHAR(255) NULL"},
		{"cancelled_by", "INT NULL"},
		{"cancelled_at", "TIMESTAMP NULL"},
		{"cancelled_while_active", "BOOLEAN DEFAULT FALSE"},
		{"dispute_id", "INT NULL COMMENT 'Reference to active dispute'"},
		{"is_dispute_frozen", "BOOLEAN DEFAULT FALSE COMMENT 'Trade is frozen due to dispute'"},
		{"archive_timer_paused", "BOOLEAN DEFAULT FALSE COMMENT 'Archive timer paused due to dispute'"},
		{"archive_timer_paused_at", "TIMESTAMP NULL COMMENT 'When archive timer was paused'"},
	}

	for _, col := range columns {
		// Check if column exists
		var count int
		err := DB.QueryRow(`
			SELECT COUNT(*)
			FROM information_schema.COLUMNS
			WHERE TABLE_SCHEMA = DATABASE()
			AND TABLE_NAME = 'trades'
			AND COLUMN_NAME = ?
		`, col.name).Scan(&count)

		if err != nil {
			log.Printf("Warning: failed to check trade column %s: %v", col.name, err)
			continue
		}

		// Add column if it doesn't exist
		if count == 0 {
			query := fmt.Sprintf("ALTER TABLE trades ADD COLUMN %s %s", col.name, col.definition)
			if _, err := DB.Exec(query); err != nil {
				log.Printf("Warning: failed to add trade column %s: %v", col.name, err)
			} else {
				log.Printf("Added missing trade column: %s", col.name)
			}
		}
	}

	// Ensure trades status ENUM includes richer lifecycle/conflict states used by the trading flow.
	var tradeStatusType string
	if err := DB.QueryRow(`
		SELECT COLUMN_TYPE FROM information_schema.COLUMNS
		WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'trades' AND COLUMN_NAME = 'status'
	`).Scan(&tradeStatusType); err == nil {
		requiredTradeStatuses := []string{
			"'accepted_by_one'",
			"'accepted_by_both'",
			"'ongoing'",
			"'cancelled_due_to_conflict'",
			"'broken'",
			"'history'",
			"'pending_multiway'",
			"'multiway_active'",
		}
		needsTradeStatusUpdate := false
		for _, required := range requiredTradeStatuses {
			if !contains(tradeStatusType, required) {
				needsTradeStatusUpdate = true
				break
			}
		}
		if needsTradeStatusUpdate {
			if _, err := DB.Exec(`ALTER TABLE trades MODIFY COLUMN status ENUM('pending','accepted','accepted_by_one','accepted_by_both','declined','countered','active','ongoing','awaiting_confirmation','completed','cancelled','cancelled_due_to_conflict','auto_completed','expired','broken','history','pending_multiway','multiway_active') DEFAULT 'pending'`); err != nil {
				log.Printf("Warning: failed to update trades status enum: %v", err)
			} else {
				log.Println("Updated trades status enum with lifecycle/conflict states")
			}
		}
	}

	// Ensure multiway_trades table exists for tracking multiway chain participants
	_, _ = DB.Exec(`CREATE TABLE IF NOT EXISTS multiway_trades (
		id INT AUTO_INCREMENT PRIMARY KEY,
		chain_id VARCHAR(255) NOT NULL,
		original_trade_id INT NOT NULL,
		initiator_user_id INT NOT NULL COMMENT 'User 2 who converted to multiway',
		user1_id INT NOT NULL COMMENT 'Original buyer (User 1)',
		user2_id INT NOT NULL COMMENT 'User who converted to multiway (User 2)',
		user3_id INT NULL COMMENT 'Matched third party (User 3)',
		user3_trade_id INT NULL COMMENT 'Trade ID linking User 3',
		status ENUM('searching','pending_user3','pending_initiator_upgrade','user3_accepted','user3_declined','active','completed','cancelled','fully_declined') DEFAULT 'searching',
		expires_at TIMESTAMP NULL COMMENT 'Expiry for pending_initiator_upgrade records (7 days)',
		cancelled_at TIMESTAMP NULL,
		cancelled_by INT NULL,
		trade_option VARCHAR(20) NULL DEFAULT 'meetup',
		meetup_location VARCHAR(500) NULL,
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
		FOREIGN KEY (original_trade_id) REFERENCES trades(id) ON DELETE CASCADE,
		FOREIGN KEY (initiator_user_id) REFERENCES users(id) ON DELETE CASCADE,
		FOREIGN KEY (user1_id) REFERENCES users(id) ON DELETE CASCADE,
		FOREIGN KEY (user2_id) REFERENCES users(id) ON DELETE CASCADE,
		FOREIGN KEY (user3_id) REFERENCES users(id) ON DELETE SET NULL,
		FOREIGN KEY (cancelled_by) REFERENCES users(id) ON DELETE SET NULL,
		UNIQUE KEY uniq_multiway_chain (chain_id),
		INDEX idx_multiway_status (status),
		INDEX idx_multiway_user3 (user3_id),
		INDEX idx_multiway_expires (expires_at)
	)`)

	// Ensure multiway_trades status enum includes lifecycle/conflict states on existing databases.
	var multiwayStatusType string
	if err := DB.QueryRow(`
		SELECT COLUMN_TYPE FROM information_schema.COLUMNS
		WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'multiway_trades' AND COLUMN_NAME = 'status'
	`).Scan(&multiwayStatusType); err == nil {
		requiredMultiwayStatuses := []string{
			"'pending_initiator_upgrade'",
			"'waiting_acceptance'",
			"'broken'",
			"'expired'",
			"'history'",
		}
		needsMultiwayStatusUpdate := false
		for _, required := range requiredMultiwayStatuses {
			if !contains(multiwayStatusType, required) {
				needsMultiwayStatusUpdate = true
				break
			}
		}
		if needsMultiwayStatusUpdate {
			if _, err := DB.Exec(`
				ALTER TABLE multiway_trades
				MODIFY COLUMN status ENUM('searching','pending_user3','pending_initiator_upgrade','waiting_acceptance','user3_accepted','user3_declined','active','completed','cancelled','expired','broken','history','fully_declined') DEFAULT 'searching'
			`); err != nil {
				log.Printf("Warning: failed to update multiway_trades status enum: %v", err)
			} else {
				log.Println("Updated multiway_trades status enum with lifecycle/conflict states")
			}
		}
	}

	// Ensure expires_at column exists on multiway_trades for 7-day TTL
	var expiresExists int
	if err := DB.QueryRow(`
		SELECT COUNT(*) FROM information_schema.COLUMNS
		WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'multiway_trades' AND COLUMN_NAME = 'expires_at'
	`).Scan(&expiresExists); err == nil && expiresExists == 0 {
		if _, err := DB.Exec(`
			ALTER TABLE multiway_trades
			ADD COLUMN expires_at TIMESTAMP NULL COMMENT 'Expiry for pending_initiator_upgrade records (7 days)',
			ADD COLUMN cancelled_at TIMESTAMP NULL,
			ADD COLUMN cancelled_by INT NULL,
			ADD FOREIGN KEY fk_cancelled_by (cancelled_by) REFERENCES users(id) ON DELETE SET NULL,
			ADD INDEX idx_multiway_expires (expires_at)
		`); err != nil {
			log.Printf("Warning: failed to add expires_at/cancelled columns to multiway_trades: %v", err)
		} else {
			log.Println("Added expires_at and cancellation columns to multiway_trades")
		}
	}
}

// ensureMultiwayColumns adds missing tables/columns for Phase 2/3 multi-way trading
func ensureMultiwayColumns() {
	// 1. Ensure multiway_trade_legs table exists
	_, _ = DB.Exec(`CREATE TABLE IF NOT EXISTS multiway_trade_legs (
		id INT AUTO_INCREMENT PRIMARY KEY,
		chain_id VARCHAR(255) NOT NULL,
		leg_index INT NOT NULL,
		from_user_id INT NOT NULL,
		to_user_id INT NOT NULL,
		product_id INT NOT NULL,
		handoff_method VARCHAR(20) DEFAULT 'meetup',
		handoff_location VARCHAR(500) NULL,
		handoff_time VARCHAR(50) NULL,
		handoff_photo_url VARCHAR(500) NULL,
		status ENUM('pending','in_progress','completed','cancelled','failed','disputed') DEFAULT 'pending',
		completed_at TIMESTAMP NULL,
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
		updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
		FOREIGN KEY (chain_id) REFERENCES multiway_trades(chain_id) ON DELETE CASCADE,
		FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE CASCADE,
		FOREIGN KEY (to_user_id) REFERENCES users(id) ON DELETE CASCADE,
		FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
		UNIQUE KEY uniq_chain_leg (chain_id, leg_index),
		INDEX idx_leg_chain (chain_id),
		INDEX idx_leg_status (status)
	)`)

	// For existing databases: add the unique constraint if it doesn't exist yet.
	var ukCount int
	_ = DB.QueryRow(`
		SELECT COUNT(*) FROM information_schema.STATISTICS
		WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'multiway_trade_legs' AND INDEX_NAME = 'uniq_chain_leg'
	`).Scan(&ukCount)
	if ukCount == 0 {
		if _, err := DB.Exec("ALTER TABLE multiway_trade_legs ADD UNIQUE KEY uniq_chain_leg (chain_id, leg_index)"); err != nil {
			log.Printf("Warning: could not add unique constraint on (chain_id, leg_index): %v", err)
		} else {
			log.Println("Added UNIQUE constraint on multiway_trade_legs(chain_id, leg_index)")
		}
	}

	// 2. Unify user3_product_id and user3_trade_id for multiway_trades
	var exists int
	_ = DB.QueryRow("SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'multiway_trades' AND COLUMN_NAME = 'user3_product_id'").Scan(&exists)
	if exists == 0 {
		_, _ = DB.Exec("ALTER TABLE multiway_trades ADD COLUMN user3_product_id INT NULL COMMENT 'The specific product ID that User 3 is contributing'")
	}

	_ = DB.QueryRow("SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'multiway_trades' AND COLUMN_NAME = 'user3_trade_id'").Scan(&exists)
	if exists == 0 {
		_, _ = DB.Exec("ALTER TABLE multiway_trades ADD COLUMN user3_trade_id INT NULL COMMENT 'The specific product ID that User 3 is contributing (Alias)'")
	}

	// 3. Ensure ongoing_deadline column exists (7-day timer after last acceptance)
	var hasOngoingDeadline int
	_ = DB.QueryRow("SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'multiway_trades' AND COLUMN_NAME = 'ongoing_deadline'").Scan(&hasOngoingDeadline)
	if hasOngoingDeadline == 0 {
		_, _ = DB.Exec("ALTER TABLE multiway_trades ADD COLUMN ongoing_deadline TIMESTAMP NULL COMMENT '7-day deadline after chain becomes active'")
		log.Println("Added ongoing_deadline column to multiway_trades")
	}

	// 4. Ensure multiway_trade_legs status ENUM includes 'in_progress' and 'disputed'
	// (needed for per-leg dispute flow and handoff tracking)
	_, _ = DB.Exec("ALTER TABLE multiway_trade_legs MODIFY COLUMN status ENUM('pending','in_progress','completed','cancelled','failed','disputed') DEFAULT 'pending'")

	// 5. Add support for proactive multiway suggestions
	// Make original_trade_id nullable for proactive matches
	var origTradeNullable int
	_ = DB.QueryRow("SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'multiway_trades' AND COLUMN_NAME = 'original_trade_id' AND IS_NULLABLE = 'YES'").Scan(&origTradeNullable)
	if origTradeNullable == 0 {
		if _, err := DB.Exec("ALTER TABLE multiway_trades MODIFY COLUMN original_trade_id INT NULL COMMENT 'NULL for proactive suggestions'"); err != nil {
			log.Printf("Warning: could not modify original_trade_id to nullable: %v", err)
		} else {
			log.Println("Made original_trade_id nullable for proactive multiway")
		}
	}

	// Add is_proactive_match flag to distinguish proactive suggestions from trade-triggered multiway
	var proactiveExists int
	_ = DB.QueryRow("SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'multiway_trades' AND COLUMN_NAME = 'is_proactive_match'").Scan(&proactiveExists)
	if proactiveExists == 0 {
		if _, err := DB.Exec("ALTER TABLE multiway_trades ADD COLUMN is_proactive_match BOOLEAN DEFAULT FALSE COMMENT 'TRUE if suggestion was auto-generated when product was posted'"); err != nil {
			log.Printf("Warning: could not add is_proactive_match column: %v", err)
		} else {
			log.Println("Added is_proactive_match flag to multiway_trades")
		}
	}

	// Add user1_product_id to track what User 1 is offering
	var user1ProdExists int
	_ = DB.QueryRow("SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'multiway_trades' AND COLUMN_NAME = 'user1_product_id'").Scan(&user1ProdExists)
	if user1ProdExists == 0 {
		if _, err := DB.Exec("ALTER TABLE multiway_trades ADD COLUMN user1_product_id INT NULL COMMENT 'Product ID that User 1 is offering'"); err != nil {
			log.Printf("Warning: could not add user1_product_id: %v", err)
		} else {
			log.Println("Added user1_product_id to multiway_trades")
		}
	}

	// Add user2_product_id to track what User 2 is offering
	var user2ProdExists int
	_ = DB.QueryRow("SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'multiway_trades' AND COLUMN_NAME = 'user2_product_id'").Scan(&user2ProdExists)
	if user2ProdExists == 0 {
		if _, err := DB.Exec("ALTER TABLE multiway_trades ADD COLUMN user2_product_id INT NULL COMMENT 'Product ID that User 2 is offering'"); err != nil {
			log.Printf("Warning: could not add user2_product_id: %v", err)
		} else {
			log.Println("Added user2_product_id to multiway_trades")
		}
	}

	// Ensure organization_posts has image_urls and is_looking_for (added after initial schema)
	var orgPostImageURLsExists int
	_ = DB.QueryRow("SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'organization_posts' AND COLUMN_NAME = 'image_urls'").Scan(&orgPostImageURLsExists)
	if orgPostImageURLsExists == 0 {
		if _, err := DB.Exec("ALTER TABLE organization_posts ADD COLUMN image_urls JSON NULL"); err != nil {
			log.Printf("Warning: could not add image_urls to organization_posts: %v", err)
		} else {
			log.Println("Added image_urls to organization_posts")
		}
	}

	var orgPostLookingForExists int
	_ = DB.QueryRow("SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'organization_posts' AND COLUMN_NAME = 'is_looking_for'").Scan(&orgPostLookingForExists)
	if orgPostLookingForExists == 0 {
		if _, err := DB.Exec("ALTER TABLE organization_posts ADD COLUMN is_looking_for BOOLEAN NULL DEFAULT FALSE"); err != nil {
			log.Printf("Warning: could not add is_looking_for to organization_posts: %v", err)
		} else {
			log.Println("Added is_looking_for to organization_posts")
		}
	}
}

// ensureRiderColumns adds missing columns to the riders table for the application flow
func ensureRiderColumns() {
	columns := []struct {
		name       string
		definition string
	}{
		{"status", "ENUM('pending','under_review','approved','rejected') NOT NULL DEFAULT 'pending'"},
		{"license_image_url", "VARCHAR(512) NULL"},
		{"selfie_image_url", "VARCHAR(512) NULL"},
		{"orcr_image_url", "VARCHAR(512) NULL"},
		{"motor_owner_image_url", "VARCHAR(512) NULL"},
		{"vehicle_color", "VARCHAR(50) NULL"},
		{"contact_number", "VARCHAR(20) NULL"},
		{"full_name", "VARCHAR(255) NULL"},
		{"rejection_reason", "TEXT NULL"},
		{"reviewed_at", "TIMESTAMP NULL"},
		{"reviewed_by", "INT NULL"},
		{"first_login_completed", "BOOLEAN DEFAULT FALSE"},
		{"free_delivery_slots", "INT DEFAULT 3"},
	}

	for _, col := range columns {
		var count int
		err := DB.QueryRow(`
			SELECT COUNT(*)
			FROM information_schema.COLUMNS
			WHERE TABLE_SCHEMA = DATABASE()
			AND TABLE_NAME = 'riders'
			AND COLUMN_NAME = ?
		`, col.name).Scan(&count)

		if err != nil {
			log.Printf("Warning: failed to check rider column %s: %v", col.name, err)
			continue
		}

		if count == 0 {
			query := fmt.Sprintf("ALTER TABLE riders ADD COLUMN %s %s", col.name, col.definition)
			if _, err := DB.Exec(query); err != nil {
				log.Printf("Warning: failed to add rider column %s: %v", col.name, err)
			} else {
				log.Printf("Added missing rider column: %s", col.name)
			}
		}
	}

	// Backfill existing active riders as approved
	DB.Exec("UPDATE riders SET status = 'approved' WHERE is_active = TRUE AND status = 'pending'")
}

// ensureDeliveryBatchColumns adds batch window columns to the deliveries table
// PHASE 3: Also adds step lock and photo enforcement columns
func ensureDeliveryBatchColumns() {
	columns := []struct {
		name       string
		definition string
	}{
		{"batch_id", "VARCHAR(36) NULL"},
		{"batch_window_expires_at", "TIMESTAMP NULL"},
		// Phase 3 - Task 15 & 16: Step lock and photo enforcement columns
		{"qr_verified", "BOOLEAN DEFAULT FALSE"},
		{"qr_code", "VARCHAR(255) NULL"},
		{"photo_uploaded", "BOOLEAN DEFAULT FALSE"},
		{"delivery_photo_url", "VARCHAR(512) NULL"},
	}

	for _, col := range columns {
		var count int
		err := DB.QueryRow(`
			SELECT COUNT(*)
			FROM information_schema.COLUMNS
			WHERE TABLE_SCHEMA = DATABASE()
			AND TABLE_NAME = 'deliveries'
			AND COLUMN_NAME = ?
		`, col.name).Scan(&count)

		if err != nil {
			log.Printf("Warning: failed to check delivery column %s: %v", col.name, err)
			continue
		}

		if count == 0 {
			query := fmt.Sprintf("ALTER TABLE deliveries ADD COLUMN %s %s", col.name, col.definition)
			if _, err := DB.Exec(query); err != nil {
				log.Printf("Warning: failed to add delivery column %s: %v", col.name, err)
			} else {
				log.Printf("Added missing delivery column: %s", col.name)
			}
		}
	}
}

// contains checks if a string contains a substring
func contains(s, substr string) bool {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return true
		}
	}
	return false
}

// ensureIndexes creates indexes if they do not exist (MySQL < 8.0.21 lacks CREATE INDEX IF NOT EXISTS)
func ensureIndexes() {
	indexes := []struct {
		table   string
		name    string
		columns string
	}{
		{"products", "idx_products_seller", "seller_id"},
		{"products", "idx_products_status", "status"},
		{"products", "idx_products_premium", "premium"},
		{"orders", "idx_orders_buyer", "buyer_id"},
		{"orders", "idx_orders_product", "product_id"},
		{"orders", "idx_orders_status", "status"},
		{"transactions", "idx_transactions_order", "order_id"},
		{"premium_listings", "idx_premium_listings_product", "product_id"},
		{"premium_listings", "idx_premium_listings_dates", "start_date, end_date"},
		{"conversations", "idx_conversations_participants", "buyer_id, seller_id"},
		{"messages", "idx_messages_conversation", "conversation_id"},
		{"messages", "idx_messages_sender", "sender_id"},
		{"trades", "idx_trades_participants", "buyer_id, seller_id"},
		{"trades", "idx_trades_target", "target_product_id"},
		{"trades", "idx_trades_status", "status"},
		{"trade_items", "idx_trade_items_trade", "trade_id"},
		{"trade_items", "idx_trade_items_product", "product_id"},
		{"trade_messages", "idx_trade_messages_trade", "trade_id"},
		{"trade_messages", "idx_trade_messages_sender", "sender_id"},
		{"notifications", "idx_notifications_user", "user_id"},
		{"notifications", "idx_notifications_read", "is_read"},
		{"notifications", "idx_notifications_type", "type"},
		{"notifications", "idx_notifications_target", "target_type, target_id"},
		{"users", "idx_users_org_handle", "org_handle"},
		{"comments", "idx_comments_product", "product_id"},
		{"comments", "idx_comments_user", "user_id"},
		{"wishlists", "idx_wishlists_user", "user_id"},
		{"wishlists", "idx_wishlists_product", "product_id"},
		{"riders", "idx_riders_user", "user_id"},
		{"riders", "idx_riders_active", "is_active"},
		{"deliveries", "idx_deliveries_user", "user_id"},
		{"deliveries", "idx_deliveries_status", "status"},
		{"delivery_items", "idx_delivery_items_delivery", "delivery_id"},
		{"trade_events", "idx_trade_events_trade", "trade_id"},
		{"trade_events", "idx_trade_events_actor", "actor_id"},
	}

	for _, idx := range indexes {
		var count int
		err := DB.QueryRow(`
			SELECT COUNT(*)
			FROM information_schema.STATISTICS
			WHERE TABLE_SCHEMA = DATABASE()
			  AND TABLE_NAME = ?
			  AND INDEX_NAME = ?
		`, idx.table, idx.name).Scan(&count)
		if err != nil {
			log.Printf("Warning: failed to check index %s on %s: %v", idx.name, idx.table, err)
			continue
		}
		if count > 0 {
			continue
		}

		query := fmt.Sprintf("CREATE INDEX %s ON %s(%s)", idx.name, idx.table, idx.columns)
		if _, err := DB.Exec(query); err != nil {
			log.Printf("Warning: failed to create index %s on %s: %v", idx.name, idx.table, err)
		} else {
			log.Printf("Created missing index %s on %s", idx.name, idx.table)
		}
	}
}
