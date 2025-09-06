package database

import (
	"database/sql"
	"fmt"
	"log"
	"net"
	"net/url"
	"os"
	"regexp"
	"strings"
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
		// Force IPv4 in Render environment
		if os.Getenv("RENDER") == "true" {
			dbURL = forceIPv4InURL(dbURL)
		}
		
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

	// Use Supabase defaults and avoid empty host/user causing malformed DSNs
	dbType := getEnv("DB_TYPE", "postgres") // default to postgres
	// Default to Supabase-managed Postgres host and database name; allow overrides via env
	dbHost := getEnv("DB_HOST", "db.zvljxbnnziygamuzzccv.supabase.co")
	dbPort := getEnv("DB_PORT", "5432")
	dbUser := getEnv("DB_USER", "postgres")
	// DO NOT hardcode a production password here — require it from env
	dbPassword := getEnv("DB_PASSWORD", "")
	dbName := getEnv("DB_NAME", "postgres")

	// Force IPv4 in Render environment
	if os.Getenv("RENDER") == "true" && dbType == "postgres" {
		if ip, err := resolveHostToIPv4(dbHost); err == nil {
			dbHost = ip
			log.Printf("Using IPv4 address for database connection: %s", dbHost)
		} else {
			log.Printf("Warning: Failed to resolve %s to IPv4: %v", dbHost, err)
		}
	}

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
		// Build a properly-escaped Postgres DSN using net/url so passwords with special chars won't break parsing
		u := &url.URL{
			Scheme: "postgresql",
			User:   url.UserPassword(dbUser, dbPassword),
			Host:   fmt.Sprintf("%s:%s", dbHost, dbPort),
			Path:   dbName,
		}
		// Ensure TLS for Supabase
		q := u.Query()
		q.Set("sslmode", "require")
		u.RawQuery = q.Encode()

		dsn = u.String()
		log.Printf("Using DB_TYPE=postgres (connecting to %s:%s) — not using DATABASE_URL", dbHost, dbPort)
		if dbPassword == "" {
			log.Println("Warning: DB_PASSWORD is empty. For Supabase direct Postgres connections, set DB_PASSWORD to your database password (not the REST API key).")
		}
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

// resolveHostToIPv4 resolves a hostname to its IPv4 address
func resolveHostToIPv4(host string) (string, error) {
	ips, err := net.LookupIP(host)
	if err != nil {
		return "", err
	}
	
	for _, ip := range ips {
		if ipv4 := ip.To4(); ipv4 != nil {
			return ipv4.String(), nil
		}
	}
	
	return "", fmt.Errorf("no IPv4 address found for host: %s", host)
}

// forceIPv4InURL replaces hostname with IPv4 address in a database URL
func forceIPv4InURL(dbURL string) string {
	// Parse the URL
	parsedURL, err := url.Parse(dbURL)
	if err != nil {
		log.Printf("Warning: Failed to parse database URL: %v", err)
		return dbURL
	}
	
	// Extract hostname
	hostname := parsedURL.Hostname()
	if net.ParseIP(hostname) != nil {
		// Already an IP address
		return dbURL
	}
	
	// Resolve to IPv4
	ip, err := resolveHostToIPv4(hostname)
	if err != nil {
		log.Printf("Warning: Failed to resolve %s to IPv4: %v", hostname, err)
		return dbURL
	}
	
	// Replace hostname with IP
	port := parsedURL.Port()
	if port != "" {
		parsedURL.Host = ip + ":" + port
	} else {
		parsedURL.Host = ip
	}
	
	return parsedURL.String()
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
	// Use PostgreSQL-compatible syntax
	queries := []string{
		`CREATE TABLE IF NOT EXISTS users (
			id SERIAL PRIMARY KEY,
			name VARCHAR(255) NOT NULL,
			email VARCHAR(255) UNIQUE NOT NULL,
			password_hash VARCHAR(255) NOT NULL,
			role VARCHAR(10) NOT NULL DEFAULT 'user',
			verified BOOLEAN DEFAULT FALSE,
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
		)`,
		`CREATE TABLE IF NOT EXISTS products (
			id SERIAL PRIMARY KEY,
			title VARCHAR(255) NOT NULL,
			description TEXT,
			price DECIMAL(10,2) NOT NULL,
			image_url VARCHAR(500),
			seller_id INT NOT NULL,
			premium BOOLEAN DEFAULT FALSE,
			status VARCHAR(20) DEFAULT 'available' CHECK (status IN ('available', 'sold', 'traded')),
			created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
			FOREIGN KEY (seller_id) REFERENCES users(id) ON DELETE CASCADE
		)`,
		// Add other tables with PostgreSQL-compatible syntax...
		// Note: Replace ENUM with CHECK constraints for PostgreSQL compatibility
	}

	for _, query := range queries {
		if _, err := DB.Exec(query); err != nil {
			return fmt.Errorf("failed to create table: %v", err)
		}
	}

	// PostgreSQL-compatible version of ensureColumn
	if err := ensureColumnPostgreSQL("products", "authenticity_verified", "ALTER TABLE products ADD COLUMN IF NOT EXISTS authenticity_verified BOOLEAN NOT NULL DEFAULT FALSE"); err != nil {
		log.Printf("Warning: failed to add products.authenticity_verified: %v", err)
	}

	log.Println("Database tables and indexes created successfully")
	return nil
}

// ensureColumnPostgreSQL adds a column if it does not exist for PostgreSQL
func ensureColumnPostgreSQL(table string, column string, alterSQL string) error {
	var count int
	q := `SELECT COUNT(*) FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`
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