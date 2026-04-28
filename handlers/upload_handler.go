package handlers

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/google/uuid"
	"github.com/xashathebest/clovia/middleware"
	"github.com/xashathebest/clovia/services"
)

// UploadHandler handles generic file uploads (images)
type UploadHandler struct{}

// NewUploadHandler creates a new upload handler
func NewUploadHandler() *UploadHandler {
	return &UploadHandler{}
}

// UploadImage handles POST /api/upload
// Accepts multipart/form-data with field "image"
// Optional "type" field to specify the folder (e.g. "trade_proof", "product", "profile")
func (h *UploadHandler) UploadImage(c *fiber.Ctx) error {
	file, err := c.FormFile("image")
	if err != nil {
		services.Logger().Warn("upload rejected missing file", "service", "upload", "request_id", middleware.RequestIDFromFiber(c), "error", err.Error())
		return c.Status(400).JSON(fiber.Map{
			"success": false,
			"error":   "No image file provided. Use field name 'image'.",
		})
	}

	// Validate file type with both headers and magic bytes. Extension is only
	// a final mobile-browser compatibility fallback.
	contentType := file.Header.Get("Content-Type")
	detectedType := ""
	if opened, openErr := file.Open(); openErr == nil {
		defer opened.Close()
		buf := make([]byte, 512)
		if n, readErr := opened.Read(buf); readErr == nil && n > 0 {
			detectedType = http.DetectContentType(buf[:n])
		}
	}
	name := strings.ToLower(file.Filename)
	allowedExt := strings.HasSuffix(name, ".jpg") || strings.HasSuffix(name, ".jpeg") ||
		strings.HasSuffix(name, ".png") || strings.HasSuffix(name, ".gif") ||
		strings.HasSuffix(name, ".webp")
	if (!strings.HasPrefix(contentType, "image/") && !strings.HasPrefix(detectedType, "image/")) || !allowedExt {
		services.Logger().Warn("upload rejected invalid type", "service", "upload", "request_id", middleware.RequestIDFromFiber(c), "filename", file.Filename, "content_type", contentType, "detected_type", detectedType)
		return c.Status(400).JSON(fiber.Map{
			"success": false,
			"error":   "File must be an image (jpg, png, gif, webp)",
		})
	}

	// Validate file size (max 10MB)
	if file.Size > 10*1024*1024 {
		services.Logger().Warn("upload rejected too large", "service", "upload", "request_id", middleware.RequestIDFromFiber(c), "filename", file.Filename, "size", file.Size)
		return c.Status(400).JSON(fiber.Map{
			"success": false,
			"error":   "Image must be smaller than 10MB",
		})
	}

	// Determine Cloudinary folder from optional "type" field
	uploadType := c.FormValue("type", "uploads")
	folder := "uploads"
	switch uploadType {
	case "trade_proof":
		folder = "trade-proofs"
	case "product":
		folder = "products"
	case "profile":
		folder = "profile-pictures"
	case "delivery_proof":
		folder = "delivery-proofs"
	default:
		folder = strings.Trim(strings.Map(func(r rune) rune {
			if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') || r == '-' || r == '_' {
				return r
			}
			return '-'
		}, uploadType), "-")
		if folder == "" {
			folder = "uploads"
		}
	}

	fmt.Printf("📤 [Upload] file=%s size=%d type=%s folder=%s\n", file.Filename, file.Size, uploadType, folder)

	ctx := middleware.RequestContextFromFiber(c)
	url, err := services.UploadFileToCloudinaryContext(ctx, file, folder)
	if err != nil {
		fmt.Printf("❌ [Upload] Cloudinary error: %v (will fallback to local)\n", err)
	} else if url == "" {
		// Cloudinary returned success but empty URL — treat as error and fallback
		fmt.Printf("❌ [Upload] Cloudinary returned empty URL (will fallback to local)\n")
		err = services.ErrCloudinaryDisabled
	}

	// Fallback to local storage if Cloudinary failed (any error)
	if err != nil {
		// Fallback: save locally
		uploadsDir := filepath.Join(".", "uploads", folder)
		fmt.Printf("📂 [Upload] Creating/checking directory: %s\n", uploadsDir)
		if mkErr := os.MkdirAll(uploadsDir, 0755); mkErr != nil {
			fmt.Printf("❌ [Upload] Failed to create directory: %v\n", mkErr)
			return c.Status(500).JSON(fiber.Map{
				"success": false,
				"error":   "Failed to create upload directory: " + mkErr.Error(),
			})
		}

		ext := filepath.Ext(file.Filename)
		filename := fmt.Sprintf("%d_%s%s", time.Now().UnixMilli(), uuid.New().String()[:8], ext)
		savePath := filepath.Join(uploadsDir, filename)

		fmt.Printf("📝 [Upload] Saving to: %s (filename=%s)\n", savePath, filename)

		if saveErr := c.SaveFile(file, savePath); saveErr != nil {
			fmt.Printf("❌ [Upload] Save failed: %v\n", saveErr)
			return c.Status(500).JSON(fiber.Map{
				"success": false,
				"error":   "Failed to save image locally: " + saveErr.Error(),
			})
		}

		localURL := fmt.Sprintf("/uploads/%s/%s", folder, filename)
		fmt.Printf("✅ [Upload] SUCCESS - Saved locally: %s (folder=%s, filename=%s)\n", localURL, folder, filename)

		response := fiber.Map{
			"success": true,
			"message": "Image uploaded successfully (local)",
			"data": fiber.Map{
				"url":           localURL,
				"original_name": file.Filename,
				"size":          file.Size,
				"type":          uploadType,
			},
		}
		fmt.Printf("📤 [Upload] Returning response: %+v\n", response)
		return c.Status(201).JSON(response)
	}

	// Final validation - ensure we have a valid URL
	if url == "" {
		fmt.Printf("⚠️ [Upload] URL is empty after Cloudinary upload - this should not happen\n")
		return c.Status(500).JSON(fiber.Map{
			"success": false,
			"error":   "Upload succeeded but returned no URL. Please try again.",
		})
	}

	return c.Status(201).JSON(fiber.Map{
		"success": true,
		"message": "Image uploaded successfully",
		"data": fiber.Map{
			"url":           url,
			"original_name": file.Filename,
			"size":          file.Size,
			"type":          uploadType,
		},
	})
}

// AnalyzeProductImages handles POST /api/analyze-product
// Accepts multipart/form-data with field "images" (multiple files allowed)
// Returns AI-generated product details with Gemini as primary and Groq as fallback
func (h *UploadHandler) AnalyzeProductImages(c *fiber.Ctx) error {
	// Get all uploaded images
	form, err := c.MultipartForm()
	if err != nil {
		return c.Status(400).JSON(fiber.Map{
			"success": false,
			"error":   "Failed to parse uploaded files",
		})
	}

	images := form.File["images"]
	if len(images) == 0 {
		return c.Status(400).JSON(fiber.Map{
			"success": false,
			"error":   "No images provided. Use field name 'images'",
		})
	}

	// Limit to 3 images for faster processing
	if len(images) > 3 {
		images = images[:3]
	}

	fmt.Printf("📸 [AI Analysis] Analyzing %d product image(s)...\n", len(images))

	// Analyze with fallback
	ctx := middleware.RequestContextFromFiber(c)
	result, err := services.AnalyzeProductWithFallbackContext(ctx, images)
	if err != nil || result == nil {
		errMsg := "AI analysis failed"
		if err != nil {
			errMsg = err.Error()
		}
		fmt.Printf("❌ [AI Analysis] Failed: %s\n", errMsg)
		return c.Status(500).JSON(fiber.Map{
			"success": false,
			"error":   errMsg,
		})
	}

	// If analysis returns prohibited status
	if result.Data != nil && result.Data.Prohibited {
		return c.Status(400).JSON(fiber.Map{
			"success":    false,
			"error":      "This item cannot be listed",
			"reason":     result.Data.Reason,
			"provider":   result.Provider,
			"time_ms":    result.TimeMs,
			"prohibited": true,
		})
	}

	fmt.Printf("✅ [AI Analysis] Complete (%s in %dms)\n", result.Provider, result.TimeMs)

	return c.Status(200).JSON(fiber.Map{
		"success":  true,
		"message":  "Product analysis completed successfully",
		"provider": result.Provider,
		"retried":  result.Retried,
		"time_ms":  result.TimeMs,
		"data": fiber.Map{
			"title":               result.Data.Title,
			"description":         result.Data.Description,
			"condition":           result.Data.Condition,
			"category":            result.Data.Category,
			"subcategory":         result.Data.Subcategory,
			"item_type":           result.Data.ItemType,
			"brand":               result.Data.Brand,
			"authenticity_risks":  result.Data.AuthenticityRisks,
			"estimated_value_min": result.Data.EstimatedValueMin,
			"estimated_value_max": result.Data.EstimatedValueMax,
			"tags":                result.Data.Tags,
			"quality_warning":     result.Data.QualityWarning,
			"person_warning":      result.Data.PersonWarning,
		},
	})
}
