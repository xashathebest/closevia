package handlers

import (
	"database/sql"
	"log"
	"path/filepath"
	"strings"

	"github.com/gofiber/fiber/v2"
	"github.com/xashathebest/clovia/database"
	"github.com/xashathebest/clovia/models"
	"github.com/xashathebest/clovia/services"
)

type AdvertisementHandler struct {
	db *sql.DB
}

func NewAdvertisementHandler() *AdvertisementHandler {
	return &AdvertisementHandler{db: database.DB}
}

// GetActiveAdvertisements returns public facing active banners
func (h *AdvertisementHandler) GetActiveAdvertisements(c *fiber.Ctx) error {
	rows, err := h.db.Query(`
		SELECT id, title, description, media_url, media_type, link_url, cta_text, is_active, priority, start_date, end_date, views, clicks 
		FROM advertisements
		WHERE is_active = true 
		AND (start_date IS NULL OR start_date <= NOW())
		AND (end_date IS NULL OR end_date >= NOW())
		ORDER BY priority ASC, created_at DESC 
	`)
	if err != nil {
		log.Printf("Failed to fetch active advertisements: %v", err)
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to fetch advertisements"})
	}
	defer rows.Close()

	var ads []models.Advertisement
	for rows.Next() {
		var ad models.Advertisement
		if err := rows.Scan(&ad.ID, &ad.Title, &ad.Description, &ad.MediaURL, &ad.MediaType, &ad.LinkURL, &ad.CtaText, &ad.IsActive, &ad.Priority, &ad.StartDate, &ad.EndDate, &ad.Views, &ad.Clicks); err != nil {
			continue
		}
		ads = append(ads, ad)
	}

	return c.JSON(models.APIResponse{Success: true, Data: ads})
}

func (h *AdvertisementHandler) GetAllAdvertisements(c *fiber.Ctx) error {
	rows, err := h.db.Query(`SELECT id, title, description, media_url, media_type, link_url, cta_text, is_active, priority, start_date, end_date, views, clicks, created_at FROM advertisements ORDER BY priority ASC, created_at DESC`)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to fetch advertisements"})
	}
	defer rows.Close()

	var ads []models.Advertisement
	for rows.Next() {
		var ad models.Advertisement
		if err := rows.Scan(&ad.ID, &ad.Title, &ad.Description, &ad.MediaURL, &ad.MediaType, &ad.LinkURL, &ad.CtaText, &ad.IsActive, &ad.Priority, &ad.StartDate, &ad.EndDate, &ad.Views, &ad.Clicks, &ad.CreatedAt); err != nil {
			continue
		}
		ads = append(ads, ad)
	}

	return c.JSON(models.APIResponse{Success: true, Data: ads})
}

// Create Advertisement
func (h *AdvertisementHandler) CreateAdvertisement(c *fiber.Ctx) error {
	title := c.FormValue("title")
	description := c.FormValue("description")
	linkURL := c.FormValue("link_url")
	ctaText := c.FormValue("cta_text")
	isActive := c.FormValue("is_active") == "true"
	priority := 0
	if p := c.FormValue("priority"); p != "" {
		priority = stringToIntDef(p, 0)
	}

	startDateStr := c.FormValue("start_date")
	endDateStr := c.FormValue("end_date")

	file, err := c.FormFile("media")
	if err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Media file is required"})
	}

	// Determine file type
	ext := strings.ToLower(filepath.Ext(file.Filename))
	mediaType := "image"
	if ext == ".mp4" || ext == ".webm" || ext == ".mov" || ext == ".avi" {
		mediaType = "video"
	}

	url, uploadErr := services.UploadFileToCloudinary(file, "advertisements")
	if uploadErr != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to upload media: " + uploadErr.Error()})
	}

	var startExpr, endExpr interface{} = nil, nil
	if startDateStr != "" && startDateStr != "null" {
		startExpr = startDateStr
	}
	if endDateStr != "" && endDateStr != "null" {
		endExpr = endDateStr
	}

	res, err := h.db.Exec(`INSERT INTO advertisements (title, description, media_url, media_type, link_url, cta_text, is_active, priority, start_date, end_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		title, description, url, mediaType, linkURL, ctaText, isActive, priority, startExpr, endExpr)
	if err != nil {
		log.Printf("Failed to insert advertisement: %v", err)
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to create advertisement"})
	}

	id, _ := res.LastInsertId()
	return c.JSON(models.APIResponse{Success: true, Data: id})
}

// UpdateAdvertisement
func (h *AdvertisementHandler) UpdateAdvertisement(c *fiber.Ctx) error {
	id := c.Params("id")
	title := c.FormValue("title")
	description := c.FormValue("description")
	linkURL := c.FormValue("link_url")
	ctaText := c.FormValue("cta_text")
	isActive := c.FormValue("is_active") == "true"
	priority := 0
	if p := c.FormValue("priority"); p != "" {
		priority = stringToIntDef(p, 0)
	}

	startDateStr := c.FormValue("start_date")
	endDateStr := c.FormValue("end_date")

	var startExpr, endExpr interface{} = nil, nil
	if startDateStr != "" && startDateStr != "null" {
		startExpr = startDateStr
	}
	if endDateStr != "" && endDateStr != "null" {
		endExpr = endDateStr
	}

	file, err := c.FormFile("media")
	if err == nil && file != nil {
		// Calculate type
		ext := strings.ToLower(filepath.Ext(file.Filename))
		mediaType := "image"
		if ext == ".mp4" || ext == ".webm" || ext == ".mov" || ext == ".avi" {
			mediaType = "video"
		}
		url, uploadErr := services.UploadFileToCloudinary(file, "advertisements")
		if uploadErr != nil {
			return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to upload media: " + uploadErr.Error()})
		}

		_, dbErr := h.db.Exec(`UPDATE advertisements SET title=?, description=?, link_url=?, cta_text=?, is_active=?, priority=?, start_date=?, end_date=?, media_url=?, media_type=? WHERE id=?`,
			title, description, linkURL, ctaText, isActive, priority, startExpr, endExpr, url, mediaType, id)
		if dbErr != nil {
			return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to update advertisement"})
		}
	} else {
		// Update without new media
		_, dbErr := h.db.Exec(`UPDATE advertisements SET title=?, description=?, link_url=?, cta_text=?, is_active=?, priority=?, start_date=?, end_date=? WHERE id=?`,
			title, description, linkURL, ctaText, isActive, priority, startExpr, endExpr, id)
		if dbErr != nil {
			return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to update advertisement"})
		}
	}

	return c.JSON(models.APIResponse{Success: true})
}

func (h *AdvertisementHandler) DeleteAdvertisement(c *fiber.Ctx) error {
	id := c.Params("id")
	_, err := h.db.Exec(`DELETE FROM advertisements WHERE id=?`, id)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to delete advertisement"})
	}
	return c.JSON(models.APIResponse{Success: true})
}

func (h *AdvertisementHandler) RecordView(c *fiber.Ctx) error {
	id := c.Params("id")
	_, _ = h.db.Exec(`UPDATE advertisements SET views = views + 1 WHERE id=?`, id)
	return c.JSON(models.APIResponse{Success: true})
}

func (h *AdvertisementHandler) RecordClick(c *fiber.Ctx) error {
	id := c.Params("id")
	_, _ = h.db.Exec(`UPDATE advertisements SET clicks = clicks + 1 WHERE id=?`, id)
	return c.JSON(models.APIResponse{Success: true})
}

func stringToIntDef(s string, _ int) int {
	var result int
	if s == "" {
		return 0
	}
	start := 0
	isNegative := false
	if s[0] == '-' {
		isNegative = true
		start = 1
	}

	for i := start; i < len(s); i++ {
		ch := s[i]
		if ch >= '0' && ch <= '9' {
			result = result*10 + int(ch-'0')
		}
	}

	if isNegative {
		return -result
	}
	return result
}
