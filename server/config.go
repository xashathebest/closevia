package config

import (
	"log"
	"os"

	"github.com/joho/godotenv"
)

// LoadEnv attempts to load a .env file but continues if not present.
// This mirrors the behavior you saw: "No .env file found, using default values".
func LoadEnv() {
	if err := godotenv.Load(); err != nil {
		log.Println("No .env file found, using environment variables")
	}
}

// GetSupabaseKey returns SUPABASE_KEY from environment (may be empty).
func GetSupabaseKey() string {
	key := os.Getenv("SUPABASE_KEY")
	if key == "" {
		log.Println("Warning: SUPABASE_KEY is not set in environment")
	}
	return key
}

// DB env helpers
func GetDBDSN() string {
	// Read common DB env vars with sensible defaults
	user := getenvOrDefault("DB_USER", "root")
	pass := getenvOrDefault("DB_PASSWORD", "")
	host := getenvOrDefault("DB_HOST", "127.0.0.1")
	port := getenvOrDefault("DB_PORT", "3306")
	name := getenvOrDefault("DB_NAME", "clovia")

	// MySQL DSN: user:password@tcp(host:port)/dbname?parseTime=true
	return user + ":" + pass + "@tcp(" + host + ":" + port + ")/" + name + "?parseTime=true"
}

func getenvOrDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
