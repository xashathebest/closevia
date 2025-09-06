//go:build create_admin
// +build create_admin

package main

import (
	"log"

	"github.com/xashathebest/clovia/database"
	"github.com/xashathebest/clovia/utils"
)

func main() {
	// Initialize database
	if err := database.InitDatabase(); err != nil {
		log.Fatal("Failed to initialize database:", err)
	}
	defer database.CloseDatabase()

	// Create admin user
	adminEmail := "admin@clovia.com"
	adminPassword := "admin123"
	adminName := "Admin User"

	// Check if admin already exists
	var existingID int
	err := database.DB.QueryRow("SELECT id FROM users WHERE email = ?", adminEmail).Scan(&existingID)
	if err == nil {
		log.Printf("Admin user already exists with ID: %d", existingID)
		return
	}

	// Hash password
	hashedPassword, err := utils.HashPassword(adminPassword)
	if err != nil {
		log.Fatal("Failed to hash password:", err)
	}

	// Insert admin user
	result, err := database.DB.Exec(
		"INSERT INTO users (name, email, password_hash, role, verified) VALUES (?, ?, ?, 'admin', true)",
		adminName, adminEmail, hashedPassword,
	)
	if err != nil {
		log.Fatal("Failed to create admin user:", err)
	}

	adminID, _ := result.LastInsertId()
	log.Printf("Admin user created successfully with ID: %d", adminID)
	log.Printf("Email: %s", adminEmail)
	log.Printf("Password: %s", adminPassword)
	log.Printf("Role: admin")
}
