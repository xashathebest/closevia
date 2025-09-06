package database

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"regexp"
	"time"

	_ "github.com/go-sql-driver/mysql" // MySQL driver
	_ "github.com/jackc/pgx/v5/stdlib" // Postgres driver (pgx stdlib)
)

var DB *sql.DB

// InitDatabase initializes the database connection
func InitDatabase() error {
	// Get database configuration from environment variables or use defaults
	// DATABASE_URL takes precedence if set (useful in Render)
	if dbURL := os.Getenv("DATABASE_URL"); dbURL != "" {
		// Use pgx driver for a DATABASE_URL assumed to be Postgres-style
		driver := "pgx"
		dsn := dbURL
		log.Printf("Using DATABASE_URL with driver=%s", driver)
		var err error
		DB, err = sql.Open(driver, dsn)
		if err != nil {
			return fmt.Errorf("failed to open database (%s): %v", driver, err)
		}
		// common pool config
		DB.SetMaxOpenConns(25)
		DB.SetMaxIdleConns(25)
		DB.SetConnMaxLifetime(5 * time.Minute)
		if err := DB.Ping(); err != nil {
			return fmt.Errorf("failed to ping database: %v", err)
		}
		var currentDbName string
		_ = DB.QueryRow("SELECT current_database()").Scan(&currentDbName)
		log.Printf("Connected using DATABASE_URL to Postgres database: %s", maskSensitive(currentDbName))
		return nil
	}

	dbType := getEnv("DB_TYPE", "postgres") // default to postgres
	dbHost := getEnv("DB_HOST", "127.0.0.1")
	dbPort := getEnv("DB_PORT", "5432")
	dbUser := getEnv("DB_USER", "postgres")
	dbPassword := getEnv("DB_PASSWORD", "")
	dbName := getEnv("DB_NAME", "clovia")

	// Build DSN and select driver based on DB_TYPE
	var driver string
	var dsn string

	if dbType == "mysql" {
		driver = "mysql"
		// MySQL DSN (kept for compatibility)
		dsn = fmt.Sprintf("%s:%s@tcp(%s:%s)/%s?parseTime=true&loc=Local",
			dbUser, dbPassword, dbHost, dbPort, dbName)
		log.Printf("Using DB_TYPE=mysql (connecting to %s:%s) — not using DATABASE_URL", dbHost, dbPort)
	} else {
		// default: postgres using pgx stdlib
		driver = "pgx"
		// Postgres DSN (postgresql://user:pass@host:port/dbname)
		if dbPassword == "" {
			dsn = fmt.Sprintf("postgresql://%s@%s:%s/%s", dbUser, dbHost, dbPort, dbName)
		} else {
			dsn = fmt.Sprintf("postgresql://%s:%s@%s:%s/%s", dbUser, dbPassword, dbHost, dbPort, dbName)
		}
		log.Printf("Using DB_TYPE=postgres (connecting to %s:%s) — not using DATABASE_URL", dbHost, dbPort)
	}

	// Open database connection
	var err error
	DB, err = sql.Open(driver, dsn)
	if err != nil {
		return fmt.Errorf("failed to open database (%s): %v", driver, err)
	}

	// Configure connection pool
	DB.SetMaxOpenConns(25)
	DB.SetMaxIdleConns(25)
	DB.SetConnMaxLifetime(5 * time.Minute)

	// Test the connection
	if err := DB.Ping(); err != nil {
		return fmt.Errorf("failed to ping database: %v", err)
	}

	// Test a simple query to verify we're connected to the right database
	var currentDbName string
	if driver == "pgx" {
		err = DB.QueryRow("SELECT current_database()").Scan(&currentDbName) // Postgres
	} else {
		err = DB.QueryRow("SELECT DATABASE()").Scan(&currentDbName) // MySQL
	}
	if err != nil {
		return fmt.Errorf("failed to get database name: %v", err)
	}

	log.Printf("Successfully connected to %s database: %s", driver, maskSensitive(currentDbName))
	return nil
}

// CloseDatabase closes the database connection
func CloseDatabase() {
	if DB != nil {
		DB.Close()
		log.Println("Database connection closed")
	}
}

// getEnv gets an environment variable or returns a default value
func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}

// CreateTables creates all necessary tables if they don't exist
func CreateTables() error {
	queries := []string{
		`CREATE TABLE IF NOT EXISTS users (
			id INT AUTO_INCREMENT PRIMARY KEY,
			name VARCHAR(255) NOT NULL,
			email VARCHAR(255) UNIQUE NOT NULL,
			password_hash VARCHAR(255) NOT NULL,
			role VARCHAR(10) NOT NULL DEFAULT 'user',
			verified BOOLEAN DEFAULT FALSE,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS products (
			id INT AUTO_INCREMENT PRIMARY KEY,
			title VARCHAR(255) NOT NULL,
			description TEXT,
			price DECIMAL(10,2) NOT NULL,
			image_url VARCHAR(500),
			seller_id INT NOT NULL,
			premium BOOLEAN DEFAULT FALSE,
			status ENUM('available', 'sold', 'traded') DEFAULT 'available',
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE CASCADE
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
			status ENUM('pending','accepted','declined','countered','active','pending_confirmation','completed','cancelled') DEFAULT 'pending',
			message TEXT NULL,
			offered_cash_amount DECIMAL(10,2) NULL,
			buyer_completed BOOLEAN DEFAULT FALSE,
			seller_completed BOOLEAN DEFAULT FALSE,
			completed_at TIMESTAMP NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
			FOREIGN KEY (buyer_id) REFERENCES users(id) ON DELETE CASCADE,
			FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE CASCADE,
			FOREIGN KEY (target_product_id) REFERENCES products(id) ON DELETE CASCADE
		)`,
		// Backfill/alter for existing deployments (ignore errors if already applied)
		`ALTER TABLE trades CHANGE COLUMN status status ENUM('pending','accepted','declined','countered','active','pending_confirmation','completed','cancelled') DEFAULT 'pending'`,
		`ALTER TABLE products CHANGE COLUMN status status ENUM('available', 'sold', 'traded') DEFAULT 'available'`,
		`ALTER TABLE trades ADD COLUMN IF NOT EXISTS buyer_completed BOOLEAN DEFAULT FALSE`,
		`ALTER TABLE trades ADD COLUMN IF NOT EXISTS seller_completed BOOLEAN DEFAULT FALSE`,
		`ALTER TABLE trades ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP NULL`,
		`ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(10) NOT NULL DEFAULT 'user'`,
		`ALTER TABLE trades ADD COLUMN IF NOT EXISTS offered_cash_amount DECIMAL(10,2) NULL`,
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
		// Trade events history log
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
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
		)`,
		// Authenticity proofs for products
		`CREATE TABLE IF NOT EXISTS authenticity_proofs (
			id INT AUTO_INCREMENT PRIMARY KEY,
			product_id INT NOT NULL,
			user_id INT NOT NULL,
			type ENUM('receipt','serial_number','certificate') NOT NULL,
			status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
			proof_url VARCHAR(500) NULL,
			serial_number VARCHAR(255) NULL,
			certificate_text TEXT NULL,
			reviewer_id INT NULL,
			reviewed_at TIMESTAMP NULL,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
			FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
			FOREIGN KEY (reviewer_id) REFERENCES users(id) ON DELETE SET NULL,
			INDEX idx_auth_proofs_product (product_id),
			INDEX idx_auth_proofs_status (status)
		)`,
	}

	for _, query := range queries {
		if _, err := DB.Exec(query); err != nil {
			return fmt.Errorf("failed to create table: %v", err)
		}
	}

	// Create indexes
	indexQueries := []string{
		"CREATE INDEX IF NOT EXISTS idx_products_seller ON products(seller_id)",
		"CREATE INDEX IF NOT EXISTS idx_products_status ON products(status)",
		"CREATE INDEX IF NOT EXISTS idx_products_premium ON products(premium)",
		"CREATE INDEX IF NOT EXISTS idx_orders_buyer ON orders(buyer_id)",
		"CREATE INDEX IF NOT EXISTS idx_orders_product ON orders(product_id)",
		"CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)",
		"CREATE INDEX IF NOT EXISTS idx_transactions_order ON transactions(order_id)",
		"CREATE INDEX IF NOT EXISTS idx_premium_listings_product ON premium_listings(product_id)",
		"CREATE INDEX IF NOT EXISTS idx_premium_listings_dates ON premium_listings(start_date, end_date)",
		"CREATE INDEX IF NOT EXISTS idx_conversations_participants ON conversations(buyer_id, seller_id)",
		"CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id)",
		"CREATE INDEX IF NOT EXISTS idx_messages_sender ON messages(sender_id)",
		"CREATE INDEX IF NOT EXISTS idx_trades_participants ON trades(buyer_id, seller_id)",
		"CREATE INDEX IF NOT EXISTS idx_trades_target ON trades(target_product_id)",
		"CREATE INDEX IF NOT EXISTS idx_trades_status ON trades(status)",
		"CREATE INDEX IF NOT EXISTS idx_trade_items_trade ON trade_items(trade_id)",
		"CREATE INDEX IF NOT EXISTS idx_trade_items_product ON trade_items(product_id)",
		"CREATE INDEX IF NOT EXISTS idx_trade_messages_trade ON trade_messages(trade_id)",
		"CREATE INDEX IF NOT EXISTS idx_trade_messages_sender ON trade_messages(sender_id)",
		"CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id)",
		"CREATE INDEX IF NOT EXISTS idx_notifications_read ON notifications(is_read)",
		"CREATE INDEX IF NOT EXISTS idx_notifications_type ON notifications(type)",
	}

	for _, query := range indexQueries {
		if _, err := DB.Exec(query); err != nil {
			// Index creation might fail if they already exist, which is fine
			log.Printf("Warning: failed to create index: %v", err)
		}
	}

	// Ensure authenticity flag on products (non-destructive)
	if err := ensureColumn("products", "authenticity_verified", "ALTER TABLE products ADD COLUMN authenticity_verified TINYINT(1) NOT NULL DEFAULT 0"); err != nil {
		log.Printf("Warning: failed to add products.authenticity_verified: %v", err)
	}

	log.Println("Database tables and indexes created successfully")
	return nil
}

// ensureColumn adds a column if it does not exist. Returns error only on add attempt failure.
func ensureColumn(table string, column string, alterSQL string) error {
	var count int
	q := `SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`
	if err := DB.QueryRow(q, table, column).Scan(&count); err != nil {
		return err
	}
	if count == 0 {
		_, err := DB.Exec(alterSQL)
		return err
	}
	return nil
}

// maskSensitive masks obvious secrets in logs (keeps short strings unchanged)
func maskSensitive(s string) string {
	if s == "" {
		return ""
	}
	// simple mask: if contains '@' or ':' treat as a connection string; otherwise return as-is
	re := regexp.MustCompile(`(?i)(://)([^/]+)`)
	res := re.ReplaceAllStringFunc(s, func(m string) string {
		// replace credentials segment with ****
		return regexp.MustCompile(`://[^/]+`).ReplaceAllString(m, "://****")
	})
	if res == s {
		// fallback: if longer than 32 chop middle
		if len(s) > 32 {
			return s[:12] + "..." + s[len(s)-12:]
		}
		return s
	}
	return res
}
