//go:build ignore

package main

import (
	"database/sql"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"

	"github.com/xashathebest/clovia/database"
	"github.com/xashathebest/clovia/services"
)

type productRecord struct {
	ID     int
	Images []string
}

func main() {
	dryRun := flag.Bool("dry-run", true, "preview changes without writing to the database")
	limit := flag.Int("limit", 0, "limit number of products to migrate (0 means all)")
	flag.Parse()

	if err := services.EnsureCloudinaryReady(); err != nil {
		log.Fatalf("Cloudinary not ready: %v", err)
	}

	if err := database.InitDatabase(); err != nil {
		log.Fatalf("failed to connect to database: %v", err)
	}
	defer database.CloseDatabase()

	if err := migrateProducts(*dryRun, *limit); err != nil {
		log.Fatalf("product migration failed: %v", err)
	}

	if err := migrateUserProfiles(*dryRun); err != nil {
		log.Fatalf("user profile migration failed: %v", err)
	}

	log.Println("Migration completed.")
}

func migrateProducts(dryRun bool, limit int) error {
	query := "SELECT id, image_urls FROM products WHERE image_urls IS NOT NULL AND image_urls != '[]'"
	if limit > 0 {
		query += fmt.Sprintf(" LIMIT %d", limit)
	}

	rows, err := database.DB.Query(query)
	if err != nil {
		return err
	}
	defer rows.Close()

	var updated int
	for rows.Next() {
		var id int
		var raw sql.NullString
		if err := rows.Scan(&id, &raw); err != nil {
			continue
		}

		var urls []string
		if raw.Valid {
			if err := json.Unmarshal([]byte(raw.String), &urls); err != nil {
				log.Printf("failed to parse image_urls for product %d: %v", id, err)
				continue
			}
		}

		changed, newURLs := migrateURLSlice(urls, "products", fmt.Sprintf("product_%d", id), dryRun)
		if changed && !dryRun {
			payload, _ := json.Marshal(newURLs)
			if _, err := database.DB.Exec("UPDATE products SET image_urls = ? WHERE id = ?", payload, id); err != nil {
				log.Printf("failed to update product %d: %v", id, err)
				continue
			}
			updated++
		}
	}

	log.Printf("Products updated: %d", updated)
	return nil
}

func migrateUserProfiles(dryRun bool) error {
	rows, err := database.DB.Query("SELECT id, profile_picture FROM users WHERE profile_picture IS NOT NULL AND profile_picture != ''")
	if err != nil {
		return err
	}
	defer rows.Close()

	var updated int
	for rows.Next() {
		var id int
		var url sql.NullString
		if err := rows.Scan(&id, &url); err != nil {
			continue
		}

		if !url.Valid || url.String == "" || !looksLikeLocalPath(url.String) {
			continue
		}

		newURL, err := migrateSingleURL(url.String, "profile-pictures", fmt.Sprintf("user_%d", id), dryRun)
		if err != nil {
			log.Printf("failed to migrate user %d image: %v", id, err)
			continue
		}
		if newURL == "" {
			continue
		}

		if !dryRun {
			if _, err := database.DB.Exec("UPDATE users SET profile_picture = ? WHERE id = ?", newURL, id); err != nil {
				log.Printf("failed to update user %d: %v", id, err)
				continue
			}
			updated++
		}
	}

	log.Printf("Users updated: %d", updated)
	return nil
}

func migrateURLSlice(urls []string, folder, prefix string, dryRun bool) (bool, []string) {
	changed := false
	newURLs := make([]string, len(urls))

	for i, url := range urls {
		if !looksLikeLocalPath(url) {
			newURLs[i] = url
			continue
		}

		newURL, err := migrateSingleURL(url, folder, fmt.Sprintf("%s_%d", prefix, i), dryRun)
		if err != nil {
			log.Printf("failed to migrate %s: %v", url, err)
			newURLs[i] = url
			continue
		}
		if newURL == "" {
			newURLs[i] = url
			continue
		}

		newURLs[i] = newURL
		changed = true
	}

	return changed, newURLs
}

func migrateSingleURL(oldURL, folder, publicID string, dryRun bool) (string, error) {
	localPath := resolveLocalPath(oldURL)
	if localPath == "" {
		return "", nil
	}

	if _, err := os.Stat(localPath); err != nil {
		return "", fmt.Errorf("missing file: %s", localPath)
	}

	if dryRun {
		log.Printf("[dry-run] would migrate %s -> Cloudinary", oldURL)
		return "", nil
	}

	newURL, err := services.UploadLocalFileToCloudinary(localPath, folder, publicID)
	if err != nil {
		return "", err
	}
	return newURL, nil
}

func looksLikeLocalPath(url string) bool {
	if url == "" {
		return false
	}
	if strings.HasPrefix(url, "http://") || strings.HasPrefix(url, "https://") {
		return strings.Contains(url, "/uploads/")
	}
	return strings.HasPrefix(url, "/uploads")
}

func resolveLocalPath(url string) string {
	if url == "" {
		return ""
	}
	path := url
	if strings.HasPrefix(path, "http://") || strings.HasPrefix(path, "https://") {
		idx := strings.Index(path, "/uploads/")
		if idx == -1 {
			return ""
		}
		path = path[idx:]
	}
	path = strings.TrimPrefix(path, "/")
	return filepath.Clean(path)
}
