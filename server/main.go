package main

import (
	"database/sql"
	"fmt"
	"log"
	"time"

	"github.com/xashathebest/clovia/server/config"

	_ "github.com/go-sql-driver/mysql"
)

func main() {
	// Load environment (.env optional)
	config.LoadEnv()

	// Read SUPABASE_KEY
	supabaseKey := config.GetSupabaseKey()
	if supabaseKey == "" {
		log.Println("SUPABASE_KEY is empty; ensure you set SUPABASE_KEY in environment or .env")
	} else {
		// Do not log the full key in production; this is just an existence check.
		log.Println("SUPABASE_KEY found in environment")
	}

	// Attempt to connect to the database with a few retries
	dsn := config.GetDBDSN()
	var db *sql.DB
	var err error
	retries := 5
	for i := 1; i <= retries; i++ {
		db, err = sql.Open("mysql", dsn)
		if err != nil {
			log.Printf("Attempt %d: failed to open DB connection: %v/n", i, err)
		} else {
			err = db.Ping()
			if err == nil {
				log.Println("Connected to database")
				break
			}
			log.Printf("Attempt %d: failed to ping database: %v/n", i, err)
		}
		if i < retries {
			sleep := time.Duration(i*2) * time.Second
			log.Printf("Retrying in %s.../n", sleep)
			time.Sleep(sleep)
		}
	}
	if err != nil {
		log.Fatalf("Failed to initialize database after %d attempts: %v/n", retries, err)
	}
	defer db.Close()

	// ...existing code...
	fmt.Println("Server startup complete")
}
