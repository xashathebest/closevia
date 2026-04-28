package handlers

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/xashathebest/clovia/database"
	"github.com/xashathebest/clovia/middleware"
	"github.com/xashathebest/clovia/models"
)

// ProductTransactionHandler handles product status updates with race condition protection
type ProductTransactionHandler struct {
	db *sql.DB
}

// NewProductTransactionHandler creates a new product transaction handler
func NewProductTransactionHandler() *ProductTransactionHandler {
	return &ProductTransactionHandler{
		db: database.DB,
	}
}

// ReserveProduct temporarily reserves a product for a specific duration (e.g., during checkout)
func (h *ProductTransactionHandler) ReserveProduct(productID int, userID int, durationMinutes int) error {
	return h.ReserveProductContext(context.Background(), productID, userID, durationMinutes)
}

func (h *ProductTransactionHandler) ReserveProductContext(ctx context.Context, productID int, userID int, durationMinutes int) error {
	tx, err := h.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("failed to start transaction: %w", err)
	}
	defer tx.Rollback()

	// Lock the product row for update to prevent race conditions
	var currentStatus string
	var currentVersion int
	var reservedUntil sql.NullTime

	err = tx.QueryRowContext(ctx, `
		SELECT status, version, reserved_until 
		FROM products 
		WHERE id = ? 
		FOR UPDATE`, productID).Scan(&currentStatus, &currentVersion, &reservedUntil)

	if err != nil {
		return fmt.Errorf("product not found or locked: %w", err)
	}

	// Check if product is available
	if currentStatus != "available" {
		return fmt.Errorf("product is not available (status: %s)", currentStatus)
	}

	// Check if product is already reserved by someone else
	if reservedUntil.Valid && reservedUntil.Time.After(time.Now()) {
		return fmt.Errorf("product is currently reserved by another user")
	}

	// Reserve the product
	reserveUntil := time.Now().Add(time.Duration(durationMinutes) * time.Minute)
	_, err = tx.ExecContext(ctx, `
		UPDATE products 
		SET reserved_until = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP 
		WHERE id = ? AND version = ?`,
		reserveUntil, productID, currentVersion)

	if err != nil {
		return fmt.Errorf("failed to reserve product: %w", err)
	}

	return tx.Commit()
}

// CompleteProductSale marks a product as unavailable with optimistic locking
func (h *ProductTransactionHandler) CompleteProductSale(productID int, buyerID int) error {
	return h.CompleteProductSaleContext(context.Background(), productID, buyerID)
}

func (h *ProductTransactionHandler) CompleteProductSaleContext(ctx context.Context, productID int, buyerID int) error {
	tx, err := h.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("failed to start transaction: %w", err)
	}
	defer tx.Rollback()

	// Lock and verify product availability
	var currentStatus string
	var currentVersion int
	var sellerID int

	err = tx.QueryRowContext(ctx, `
		SELECT status, version, seller_id 
		FROM products 
		WHERE id = ? 
		FOR UPDATE`, productID).Scan(&currentStatus, &currentVersion, &sellerID)

	if err != nil {
		return fmt.Errorf("product not found: %w", err)
	}

	// Verify product is available
	if currentStatus != "available" {
		return fmt.Errorf("product is not available for sale (status: %s)", currentStatus)
	}

	// Prevent self-purchase
	if sellerID == buyerID {
		return fmt.Errorf("cannot purchase your own product")
	}

	// Update product status to unavailable with version increment
	result, err := tx.ExecContext(ctx, `
		UPDATE products 
		SET status = 'unavailable', version = version + 1, reserved_until = NULL, updated_at = CURRENT_TIMESTAMP 
		WHERE id = ? AND version = ? AND status = 'available'`,
		productID, currentVersion)

	if err != nil {
		return fmt.Errorf("failed to update product status: %w", err)
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to check update result: %w", err)
	}

	if rowsAffected == 0 {
		return fmt.Errorf("product was modified by another transaction, please retry")
	}

	// Create order record
	_, err = tx.ExecContext(ctx, `
		INSERT INTO orders (product_id, buyer_id, status, created_at) 
		VALUES (?, ?, 'completed', CURRENT_TIMESTAMP)`,
		productID, buyerID)

	if err != nil {
		return fmt.Errorf("failed to create order: %w", err)
	}

	return tx.Commit()
}

// CompleteProductTrade marks products as traded with optimistic locking
func (h *ProductTransactionHandler) CompleteProductTrade(tradeID int) error {
	return h.CompleteProductTradeContext(context.Background(), tradeID)
}

func (h *ProductTransactionHandler) CompleteProductTradeContext(ctx context.Context, tradeID int) error {
	tx, err := h.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("failed to start transaction: %w", err)
	}
	defer tx.Rollback()

	// Get trade details
	var targetProductID int
	var buyerID, sellerID int
	err = tx.QueryRowContext(ctx, `
		SELECT target_product_id, buyer_id, seller_id 
		FROM trades 
		WHERE id = ? AND status = 'active'`, tradeID).Scan(&targetProductID, &buyerID, &sellerID)

	if err != nil {
		return fmt.Errorf("trade not found or not active: %w", err)
	}

	// Get all offered products in this trade
	rows, err := tx.QueryContext(ctx, `
		SELECT product_id 
		FROM trade_items 
		WHERE trade_id = ?`, tradeID)

	if err != nil {
		return fmt.Errorf("failed to get trade items: %w", err)
	}
	defer rows.Close()

	var offeredProductIDs []int
	for rows.Next() {
		var productID int
		if err := rows.Scan(&productID); err != nil {
			return fmt.Errorf("failed to scan product ID: %w", err)
		}
		offeredProductIDs = append(offeredProductIDs, productID)
	}

	// Mark target product as unavailable
	err = h.markProductAsUnavailable(ctx, tx, targetProductID)
	if err != nil {
		return fmt.Errorf("failed to mark target product as unavailable: %w", err)
	}

	// Mark all offered products as unavailable
	for _, productID := range offeredProductIDs {
		err = h.markProductAsUnavailable(ctx, tx, productID)
		if err != nil {
			return fmt.Errorf("failed to mark offered product %d as unavailable: %w", productID, err)
		}
	}

	// Update trade status to completed
	_, err = tx.ExecContext(ctx, `
		UPDATE trades 
		SET status = 'completed', completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP 
		WHERE id = ?`, tradeID)

	if err != nil {
		return fmt.Errorf("failed to update trade status: %w", err)
	}

	return tx.Commit()
}

// markProductAsUnavailable is a helper function to mark a single product as unavailable
func (h *ProductTransactionHandler) markProductAsUnavailable(ctx context.Context, tx *sql.Tx, productID int) error {
	// Lock and verify product
	var currentStatus string
	var currentVersion int

	err := tx.QueryRowContext(ctx, `
		SELECT status, version 
		FROM products 
		WHERE id = ? 
		FOR UPDATE`, productID).Scan(&currentStatus, &currentVersion)

	if err != nil {
		return fmt.Errorf("product %d not found: %w", productID, err)
	}

	// Only update if product is available
	if currentStatus != "available" {
		log.Printf("Warning: Product %d is not available (status: %s), skipping trade update", productID, currentStatus)
		return nil // Don't fail the entire trade if one product is already unavailable
	}

	// Update product status to unavailable
	result, err := tx.ExecContext(ctx, `
		UPDATE products 
		SET status = 'unavailable', version = version + 1, reserved_until = NULL, updated_at = CURRENT_TIMESTAMP 
		WHERE id = ? AND version = ? AND status = 'available'`,
		productID, currentVersion)

	if err != nil {
		return fmt.Errorf("failed to update product %d status: %w", productID, err)
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("failed to check update result for product %d: %w", productID, err)
	}

	if rowsAffected == 0 {
		return fmt.Errorf("product %d was modified by another transaction", productID)
	}

	return nil
}

// CleanupExpiredReservations removes expired product reservations
func (h *ProductTransactionHandler) CleanupExpiredReservations() error {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	_, err := h.db.ExecContext(ctx, `
		UPDATE products 
		SET reserved_until = NULL, version = version + 1, updated_at = CURRENT_TIMESTAMP 
		WHERE reserved_until IS NOT NULL AND reserved_until < CURRENT_TIMESTAMP`)

	if err != nil {
		return fmt.Errorf("failed to cleanup expired reservations: %w", err)
	}

	return nil
}

// HTTP Handlers

// PurchaseProduct handles product purchase requests
func (h *ProductTransactionHandler) PurchaseProduct(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(401).JSON(models.APIResponse{
			Success: false,
			Error:   "User not authenticated",
		})
	}

	var req struct {
		ProductID int `json:"product_id" validate:"required"`
	}

	if err := c.BodyParser(&req); err != nil {
		return c.Status(400).JSON(models.APIResponse{
			Success: false,
			Error:   "Invalid request body",
		})
	}

	// First, try to reserve the product for 10 minutes
	ctx := middleware.RequestContextFromFiber(c)
	if err := h.ReserveProductContext(ctx, req.ProductID, userID, 10); err != nil {
		return c.Status(400).JSON(models.APIResponse{
			Success: false,
			Error:   err.Error(),
		})
	}

	// In a real application, you would process payment here
	// For now, we'll directly complete the sale

	if err := h.CompleteProductSaleContext(ctx, req.ProductID, userID); err != nil {
		return c.Status(400).JSON(models.APIResponse{
			Success: false,
			Error:   err.Error(),
		})
	}

	return c.JSON(models.APIResponse{
		Success: true,
		Message: "Product purchased successfully",
	})
}

// GetAvailableProducts returns only truly available products (not reserved or sold)
func (h *ProductTransactionHandler) GetAvailableProducts(c *fiber.Ctx) error {
	// First cleanup expired reservations
	h.CleanupExpiredReservations()

	ctx := middleware.RequestContextFromFiber(c)
	rows, err := h.db.QueryContext(ctx, `
		SELECT p.id, p.title, p.description, p.price, p.seller_id, p.premium, 
		       p.allow_buying, p.barter_only, p.location, p.created_at, p.updated_at,
		       u.name as seller_name, p.image_urls
		FROM products p
		JOIN users u ON p.seller_id = u.id
		WHERE p.status = 'available' 
		  AND (p.reserved_until IS NULL OR p.reserved_until < CURRENT_TIMESTAMP)
		ORDER BY p.created_at DESC`)

	if err != nil {
		return c.Status(500).JSON(models.APIResponse{
			Success: false,
			Error:   "Failed to fetch products",
		})
	}
	defer rows.Close()

	var products []models.Product
	for rows.Next() {
		var product models.Product
		var priceNull sql.NullFloat64
		var imageURLsJSON sql.NullString

		err := rows.Scan(&product.ID, &product.Title, &product.Description, &priceNull,
			&product.SellerID, &product.Premium, &product.AllowBuying, &product.BarterOnly,
			&product.Location, &product.CreatedAt, &product.UpdatedAt, &product.SellerName, &imageURLsJSON)

		if err != nil {
			continue
		}

		if priceNull.Valid {
			p := priceNull.Float64
			product.Price = &p
		}

		product.Status = "available"
		products = append(products, product)
	}

	return c.JSON(models.APIResponse{
		Success: true,
		Data:    products,
	})
}
