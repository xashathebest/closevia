package handlers

import (
	"archive/zip"
	"bytes"
	"context"
	"database/sql"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"html"
	"log"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/xashathebest/clovia/database"
	"github.com/xashathebest/clovia/models"
)

type AdminHandler struct {
	db *sql.DB

	statsCacheMu  sync.RWMutex
	statsCache    *AdminStats
	statsCacheExp time.Time
}

type RevenueBreakdown struct {
	Period string  `json:"period"`
	Amount float64 `json:"amount"`
}

type RecentActivity struct {
	Action string    `json:"action"`
	Count  int       `json:"count"`
	Latest time.Time `json:"latest"`
}

type AdminStats struct {
	TotalUsers           int                `json:"total_users"`
	PremiumUsers         int                `json:"premium_users"`
	TotalIncome          float64            `json:"total_income"`
	ActiveListings       int                `json:"active_listings"`
	TotalTrades          int                `json:"total_trades"`
	NewUsersToday        int                `json:"new_users_today"`
	NewListingsToday     int                `json:"new_listings_today"`
	VerifiedUsers        int                `json:"verified_users"`
	PendingApprovals     int                `json:"pending_approvals"`
	PendingVerifications int                `json:"pending_verifications"`
	ReportsFiled         int                `json:"reports_filed"`
	SuspendedUsers       int                `json:"suspended_users"`
	StorageUsageMB       float64            `json:"storage_usage_mb"`
	RevenueBreakdown     []RevenueBreakdown `json:"revenue_breakdown"`
	RevenueBySource      map[string]float64 `json:"revenue_by_source"`
	RecentActivity       []RecentActivity   `json:"recent_activity"`
	LastUpdated          string             `json:"last_updated"`
}

func NewAdminHandler() *AdminHandler {
	return &AdminHandler{db: database.DB}
}

func (h *AdminHandler) loadMarketplaceSettings() fiber.Map {
	showOwnProducts := true
	var raw string
	if err := h.db.QueryRow("SELECT setting_value FROM app_settings WHERE setting_key = 'show_own_products_on_home'").Scan(&raw); err == nil {
		if parsed, parseErr := strconv.ParseBool(strings.TrimSpace(raw)); parseErr == nil {
			showOwnProducts = parsed
		}
	}

	return fiber.Map{
		"show_own_products_on_home": showOwnProducts,
	}
}

func (h *AdminHandler) GetMarketplaceSettings(c *fiber.Ctx) error {
	return c.JSON(models.APIResponse{Success: true, Data: h.loadMarketplaceSettings()})
}

func (h *AdminHandler) UpdateMarketplaceSettings(c *fiber.Ctx) error {
	var payload struct {
		ShowOwnProductsOnHome *bool `json:"show_own_products_on_home"`
	}
	if err := c.BodyParser(&payload); err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid marketplace settings payload"})
	}
	if payload.ShowOwnProductsOnHome == nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "show_own_products_on_home is required"})
	}

	value := strconv.FormatBool(*payload.ShowOwnProductsOnHome)
	if _, err := h.db.Exec(`
		INSERT INTO app_settings (setting_key, setting_value)
		VALUES ('show_own_products_on_home', ?)
		ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)
	`, value); err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to save marketplace settings"})
	}

	return c.JSON(models.APIResponse{Success: true, Data: h.loadMarketplaceSettings()})
}

// GetAdminStats returns essential dashboard statistics for admin
func (h *AdminHandler) GetAdminStats(c *fiber.Ctx) error {
	// Cache to avoid hammering DB on frequent admin refreshes.
	// Keeps UX snappy without changing data semantics (short TTL).
	const cacheTTL = 60 * time.Second
	h.statsCacheMu.RLock()
	if h.statsCache != nil && time.Now().Before(h.statsCacheExp) {
		cached := *h.statsCache
		h.statsCacheMu.RUnlock()
		return c.JSON(models.APIResponse{Success: true, Data: cached})
	}
	h.statsCacheMu.RUnlock()

	now := time.Now()
	const perQueryTimeout = 3 * time.Second

	queryInt := func(q string, args ...any) (int, error) {
		ctx, cancel := context.WithTimeout(context.Background(), perQueryTimeout)
		defer cancel()
		var v int
		err := h.db.QueryRowContext(ctx, q, args...).Scan(&v)
		return v, err
	}
	queryFloat := func(q string, args ...any) (float64, error) {
		ctx, cancel := context.WithTimeout(context.Background(), perQueryTimeout)
		defer cancel()
		var v float64
		err := h.db.QueryRowContext(ctx, q, args...).Scan(&v)
		return v, err
	}

	// ===== ESSENTIAL METRICS =====
	// Avoid a single fragile query: older DBs may be missing tables/columns (earnings, reports, is_premium, etc).
	// If a metric query fails, we default it to 0 rather than 500 the entire dashboard.
	var totalUsers, premiumUsers, activeListings, totalTrades int
	var newUsersToday, newListingsToday, verifiedUsers int
	var pendingApprovals, pendingVerifications, reportsFiled, suspendedUsers int
	var totalIncome float64

	if v, err := queryInt(`SELECT COUNT(*) FROM users`); err == nil {
		totalUsers = v
	}

	// Premium users: prefer products.is_premium if present.
	if v, err := queryInt(`
		SELECT COUNT(DISTINCT seller_id)
		FROM products
		WHERE is_premium = true AND status NOT IN ('sold', 'expired', 'draft')
	`); err == nil {
		premiumUsers = v
	}

	// Total income: prefer earnings table if present, else fallback to completed trades.net_amount.
	if v, err := queryFloat(`SELECT COALESCE(SUM(amount), 0) FROM earnings`); err == nil {
		totalIncome = v
	} else if v2, err2 := queryFloat(`SELECT COALESCE(SUM(net_amount), 0) FROM trades WHERE status = 'completed'`); err2 == nil {
		totalIncome = v2
	}

	if v, err := queryInt(`SELECT COUNT(*) FROM products WHERE status NOT IN ('sold', 'expired', 'draft', 'locked')`); err == nil {
		activeListings = v
	}
	if v, err := queryInt(`SELECT COUNT(*) FROM trades WHERE status = 'completed'`); err == nil {
		totalTrades = v
	}
	if v, err := queryInt(`SELECT COUNT(*) FROM users WHERE created_at >= CURDATE() AND created_at < DATE_ADD(CURDATE(), INTERVAL 1 DAY)`); err == nil {
		newUsersToday = v
	}
	if v, err := queryInt(`SELECT COUNT(*) FROM products WHERE created_at >= CURDATE() AND created_at < DATE_ADD(CURDATE(), INTERVAL 1 DAY)`); err == nil {
		newListingsToday = v
	}
	if v, err := queryInt(`SELECT COUNT(*) FROM users WHERE verified = true`); err == nil {
		verifiedUsers = v
	}
	if v, err := queryInt(`SELECT COUNT(*) FROM products WHERE status = 'pending_approval'`); err == nil {
		pendingApprovals = v
	}
	if v, err := queryInt(`SELECT COUNT(*) FROM users WHERE verification_status = 'pending'`); err == nil {
		pendingVerifications = v
	}
	if v, err := queryInt(`SELECT COUNT(*) FROM reports`); err == nil {
		reportsFiled = v
	}
	// Suspended users: older/newer schemas might use role='suspended' or is_suspended boolean.
	if v, err := queryInt(`SELECT COUNT(*) FROM users WHERE role = 'suspended'`); err == nil {
		suspendedUsers = v
	} else if v2, err2 := queryInt(`SELECT COUNT(*) FROM users WHERE is_suspended = true`); err2 == nil {
		suspendedUsers = v2
	}

	// Storage Usage (prefer information_schema for fast metadata-based estimate)
	var storageUsageMB float64
	{
		ctx, cancel := context.WithTimeout(context.Background(), perQueryTimeout)
		defer cancel()
		err := h.db.QueryRowContext(ctx, `
		SELECT COALESCE(SUM(data_length + index_length) / 1024 / 1024, 0)
		FROM information_schema.tables
		WHERE table_schema = DATABASE()
		`).Scan(&storageUsageMB)
		if err != nil {
			// Fallback to legacy estimate if information_schema isn't accessible.
			ctx2, cancel2 := context.WithTimeout(context.Background(), perQueryTimeout)
			defer cancel2()
			_ = h.db.QueryRowContext(ctx2, `
			SELECT COALESCE(SUM(CASE
				WHEN image_urls != '[]' THEN LENGTH(image_urls) * 0.001
				ELSE 0.1
			END), 0) as estimated_mb FROM products
			`).Scan(&storageUsageMB)
		}
	}

	// Revenue Breakdown (last 30 days by week)
	var revenueBreakdown []RevenueBreakdown
	var revenueRows *sql.Rows
	var revenueErr error
	{
		ctx, cancel := context.WithTimeout(context.Background(), perQueryTimeout)
		defer cancel()
		revenueRows, revenueErr = h.db.QueryContext(ctx, `
		SELECT 
			DATE_FORMAT(created_at, '%Y-%U') as week,
			SUM(amount) as revenue
		FROM earnings
		WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
		GROUP BY week
		ORDER BY week DESC
		LIMIT 4
		`)
	}
	if revenueErr == nil && revenueRows != nil {
		defer revenueRows.Close()
		for revenueRows.Next() {
			var rb RevenueBreakdown
			if err := revenueRows.Scan(&rb.Period, &rb.Amount); err == nil {
				// Format period as "Week XX" (guard against unexpected short strings)
				period := strings.TrimSpace(rb.Period)
				if len(period) >= 2 {
					rb.Period = "Week " + period[len(period)-2:]
				} else if period != "" {
					rb.Period = "Week " + period
				} else {
					rb.Period = "Week"
				}
				revenueBreakdown = append(revenueBreakdown, rb)
			}
		}
	}

	// Revenue by Source
	revenueBySource := map[string]float64{
		"trade_fee":            0,
		"premium_subscription": 0,
		"riders_remittance":    0,
		"advertisers_revenue":  0,
		"google_ads":           0,
	}
	var sourceRows *sql.Rows
	var sourceErr error
	{
		ctx, cancel := context.WithTimeout(context.Background(), perQueryTimeout)
		defer cancel()
		sourceRows, sourceErr = h.db.QueryContext(ctx, `SELECT source_type, COALESCE(SUM(amount), 0) FROM earnings GROUP BY source_type`)
	}
	if sourceErr == nil && sourceRows != nil {
		defer sourceRows.Close()
		for sourceRows.Next() {
			var st string
			var amt float64
			if err := sourceRows.Scan(&st, &amt); err != nil {
				continue
			}
			revenueBySource[st] = amt
		}
	}

	// Recent Activity (last 5 actions)
	var activityRows *sql.Rows
	var activityErr error
	{
		ctx, cancel := context.WithTimeout(context.Background(), perQueryTimeout)
		defer cancel()
		activityRows, activityErr = h.db.QueryContext(ctx, `
		SELECT 'New User' as action, COUNT(*) as count, MAX(created_at) as latest
		FROM users WHERE created_at >= DATE_SUB(NOW(), INTERVAL 1 DAY)
		UNION ALL
		SELECT 'New Listing' as action, COUNT(*) as count, MAX(created_at) as latest
		FROM products WHERE created_at >= DATE_SUB(NOW(), INTERVAL 1 DAY)
		UNION ALL
		SELECT 'Trade Completed' as action, COUNT(*) as count, MAX(created_at) as latest
		FROM trades WHERE status = 'completed' AND created_at >= DATE_SUB(NOW(), INTERVAL 1 DAY)
		`)
	}
	if activityErr != nil {
		activityRows = nil
	}

	var recentActivity []RecentActivity
	if activityRows != nil {
		defer activityRows.Close()
		for activityRows.Next() {
			var ai RecentActivity
			if err := activityRows.Scan(&ai.Action, &ai.Count, &ai.Latest); err == nil {
				recentActivity = append(recentActivity, ai)
			}
		}
	}

	// ===== COMPILE ESSENTIAL STATISTICS =====

	stats := AdminStats{
		TotalUsers:           totalUsers,
		PremiumUsers:         premiumUsers,
		TotalIncome:          totalIncome,
		ActiveListings:       activeListings,
		TotalTrades:          totalTrades,
		NewUsersToday:        newUsersToday,
		NewListingsToday:     newListingsToday,
		VerifiedUsers:        verifiedUsers,
		PendingApprovals:     pendingApprovals,
		PendingVerifications: pendingVerifications,
		ReportsFiled:         reportsFiled,
		SuspendedUsers:       suspendedUsers,
		StorageUsageMB:       storageUsageMB,
		RevenueBreakdown:     revenueBreakdown,
		RevenueBySource:      revenueBySource,
		RecentActivity:       recentActivity,
		LastUpdated:          now.Format("2006-01-02 15:04:05"),
	}

	h.statsCacheMu.Lock()
	h.statsCache = &stats
	h.statsCacheExp = time.Now().Add(cacheTTL)
	h.statsCacheMu.Unlock()

	return c.JSON(models.APIResponse{Success: true, Data: stats})
}

// GetDailyStats returns per-day activity counts for a given month (for calendar dots)
func (h *AdminHandler) GetDailyStats(c *fiber.Ctx) error {
	yearStr := c.Query("year", "")
	monthStr := c.Query("month", "")

	now := time.Now()
	year := now.Year()
	month := int(now.Month())

	if yearStr != "" {
		if y, err := strconv.Atoi(yearStr); err == nil {
			year = y
		}
	}
	if monthStr != "" {
		if m, err := strconv.Atoi(monthStr); err == nil && m >= 1 && m <= 12 {
			month = m
		}
	}

	// Build date range for the requested month
	startDate := fmt.Sprintf("%04d-%02d-01", year, month)
	// Last day of month: first day of next month minus 1 day
	firstOfNext := time.Date(year, time.Month(month+1), 1, 0, 0, 0, 0, time.UTC)
	endDate := firstOfNext.AddDate(0, 0, -1).Format("2006-01-02")

	type DayStats struct {
		Date            string `json:"date"`
		NewUsers        int    `json:"new_users"`
		NewListings     int    `json:"new_listings"`
		CompletedTrades int    `json:"completed_trades"`
		ReportsFiled    int    `json:"reports_filed"`
	}

	// Aggregate all activity per day using a UNION approach
	rows, err := h.db.Query(`
		SELECT
			day,
			SUM(new_users) AS new_users,
			SUM(new_listings) AS new_listings,
			SUM(completed_trades) AS completed_trades,
			SUM(reports_filed) AS reports_filed
		FROM (
			SELECT DATE(created_at) AS day, COUNT(*) AS new_users, 0 AS new_listings, 0 AS completed_trades, 0 AS reports_filed
			FROM users
			WHERE DATE(created_at) BETWEEN ? AND ?
			GROUP BY DATE(created_at)

			UNION ALL

			SELECT DATE(created_at) AS day, 0, COUNT(*), 0, 0
			FROM products
			WHERE DATE(created_at) BETWEEN ? AND ?
			GROUP BY DATE(created_at)

			UNION ALL

			SELECT DATE(created_at) AS day, 0, 0, COUNT(*), 0
			FROM trades
			WHERE status = 'completed' AND DATE(created_at) BETWEEN ? AND ?
			GROUP BY DATE(created_at)

			UNION ALL

			SELECT DATE(created_at) AS day, 0, 0, 0, COUNT(*)
			FROM reports
			WHERE DATE(created_at) BETWEEN ? AND ?
			GROUP BY DATE(created_at)
		) combined
		GROUP BY day
		ORDER BY day ASC
	`, startDate, endDate, startDate, endDate, startDate, endDate, startDate, endDate)

	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to fetch daily stats"})
	}
	defer rows.Close()

	var dailyStats []DayStats
	for rows.Next() {
		var ds DayStats
		var day time.Time
		if err := rows.Scan(&day, &ds.NewUsers, &ds.NewListings, &ds.CompletedTrades, &ds.ReportsFiled); err == nil {
			ds.Date = day.Format("2006-01-02")
			dailyStats = append(dailyStats, ds)
		}
	}

	if dailyStats == nil {
		dailyStats = []DayStats{}
	}

	return c.JSON(models.APIResponse{Success: true, Data: dailyStats})
}

// GetStatsByDate returns a full stats snapshot for a specific date (YYYY-MM-DD)
func (h *AdminHandler) GetStatsByDate(c *fiber.Ctx) error {
	dateStr := c.Query("date", "")
	if dateStr == "" {
		dateStr = time.Now().Format("2006-01-02")
	}

	// Validate date format
	if _, err := time.Parse("2006-01-02", dateStr); err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid date format, use YYYY-MM-DD"})
	}

	var newUsers, newListings, completedTrades, reportsFiled int

	h.db.QueryRow(`SELECT COUNT(*) FROM users WHERE DATE(created_at) = ?`, dateStr).Scan(&newUsers)
	h.db.QueryRow(`SELECT COUNT(*) FROM products WHERE DATE(created_at) = ?`, dateStr).Scan(&newListings)
	h.db.QueryRow(`SELECT COUNT(*) FROM trades WHERE status = 'completed' AND DATE(created_at) = ?`, dateStr).Scan(&completedTrades)
	h.db.QueryRow(`SELECT COUNT(*) FROM reports WHERE DATE(created_at) = ?`, dateStr).Scan(&reportsFiled)

	// Revenue for that day
	var dayRevenue float64
	h.db.QueryRow(`SELECT COALESCE(SUM(amount), 0) FROM earnings WHERE DATE(created_at) = ?`, dateStr).Scan(&dayRevenue)
	if dayRevenue == 0 {
		// Fallback to legacy trades if no earnings recorded yet
		h.db.QueryRow(`SELECT COALESCE(SUM(net_amount), 0) FROM trades WHERE status='completed' AND DATE(created_at) = ?`, dateStr).Scan(&dayRevenue)
	}

	// Active listings snapshot (products that existed on that day and were active)
	var activeListings int
	h.db.QueryRow(`SELECT COUNT(*) FROM products WHERE DATE(created_at) <= ? AND status NOT IN ('sold','expired','draft','locked')`, dateStr).Scan(&activeListings)

	return c.JSON(models.APIResponse{
		Success: true,
		Data: fiber.Map{
			"date":             dateStr,
			"new_users":        newUsers,
			"new_listings":     newListings,
			"completed_trades": completedTrades,
			"reports_filed":    reportsFiled,
			"revenue":          dayRevenue,
			"active_listings":  activeListings,
		},
	})
}

func parseAdminDateRange(c *fiber.Ctx) (start *time.Time, end *time.Time, err error) {
	startStr := c.Query("start", "")
	endStr := c.Query("end", "")

	if startStr != "" {
		s, err := time.ParseInLocation("2006-01-02", startStr, time.Local)
		if err != nil {
			return nil, nil, fmt.Errorf("invalid start date")
		}
		start = &s
	}
	if endStr != "" {
		e, err := time.ParseInLocation("2006-01-02", endStr, time.Local)
		if err != nil {
			return nil, nil, fmt.Errorf("invalid end date")
		}
		end = &e
	}

	return start, end, nil
}

// GetAdminRevenue returns revenue summed over an inclusive date range.
// Query params:
// - start=YYYY-MM-DD (optional)
// - end=YYYY-MM-DD (optional, inclusive)
func (h *AdminHandler) GetAdminRevenue(c *fiber.Ctx) error {
	startStr := c.Query("start", "")
	endStr := c.Query("end", "")

	var start *time.Time
	var endExclusive *time.Time

	if startStr != "" {
		s, err := time.ParseInLocation("2006-01-02", startStr, time.Local)
		if err != nil {
			return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid start date"})
		}
		start = &s
	}
	if endStr != "" {
		e, err := time.ParseInLocation("2006-01-02", endStr, time.Local)
		if err != nil {
			return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid end date"})
		}
		ex := e.AddDate(0, 0, 1) // inclusive end -> exclusive upper bound
		endExclusive = &ex
	}

	where := "WHERE 1=1"
	args := make([]interface{}, 0, 2)
	if start != nil {
		where += " AND created_at >= ?"
		args = append(args, *start)
	}
	if endExclusive != nil {
		where += " AND created_at < ?"
		args = append(args, *endExclusive)
	}

	var revenue float64
	if err := h.db.QueryRow("SELECT COALESCE(SUM(amount), 0) FROM earnings "+where, args...).Scan(&revenue); err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to fetch revenue"})
	}

	if revenue == 0 {
		// Fallback for installs without earnings records.
		var legacy float64
		tradeWhere := strings.Replace(where, "WHERE 1=1", "WHERE status = 'completed'", 1)
		_ = h.db.QueryRow("SELECT COALESCE(SUM(net_amount), 0) FROM trades "+tradeWhere, args...).Scan(&legacy)
		if legacy > 0 {
			revenue = legacy
		}
	}

	return c.JSON(models.APIResponse{Success: true, Data: fiber.Map{"revenue": revenue}})
}

// GetAdminTrades returns a paginated list of trades for admin usage.
func (h *AdminHandler) GetAdminTrades(c *fiber.Ctx) error {
	page, _ := strconv.Atoi(c.Query("page", "1"))
	limit, _ := strconv.Atoi(c.Query("limit", "20"))
	if page <= 0 {
		page = 1
	}
	if limit <= 0 {
		limit = 20
	}
	offset := (page - 1) * limit

	status := c.Query("status", "")
	start, end, derr := parseAdminDateRange(c)
	if derr != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: derr.Error()})
	}

	where := "WHERE 1=1"
	args := make([]interface{}, 0, 6)
	if status != "" {
		where += " AND t.status = ?"
		args = append(args, status)
	}
	if start != nil {
		where += " AND t.created_at >= ?"
		args = append(args, *start)
	}
	if end != nil {
		where += " AND t.created_at < ?"
		args = append(args, *end)
	}

	var total int
	if err := h.db.QueryRow("SELECT COUNT(*) FROM trades t "+where, args...).Scan(&total); err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to get trade count"})
	}

	rows, err := h.db.Query(`
		SELECT
			t.id,
			t.buyer_id,
			t.seller_id,
			t.target_product_id,
			t.status,
			COALESCE(t.trade_option, '') AS trade_option,
			t.created_at,
			t.updated_at,
			COALESCE(ub.name, '') AS buyer_name,
			COALESCE(us.name, '') AS seller_name,
			COALESCE(p.title, '') AS product_title
		FROM trades t
		LEFT JOIN users ub ON ub.id = t.buyer_id
		LEFT JOIN users us ON us.id = t.seller_id
		LEFT JOIN products p ON p.id = t.target_product_id
		`+where+`
		ORDER BY t.created_at DESC
		LIMIT ? OFFSET ?
	`, append(args, limit, offset)...)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to get trades"})
	}
	defer rows.Close()

	trades := make([]models.Trade, 0, limit)
	for rows.Next() {
		var t models.Trade
		var tradeOption sql.NullString
		var buyerName sql.NullString
		var sellerName sql.NullString
		var productTitle sql.NullString
		if err := rows.Scan(
			&t.ID,
			&t.BuyerID,
			&t.SellerID,
			&t.TargetProductID,
			&t.Status,
			&tradeOption,
			&t.CreatedAt,
			&t.UpdatedAt,
			&buyerName,
			&sellerName,
			&productTitle,
		); err != nil {
			continue
		}
		if tradeOption.Valid {
			t.TradeOption = tradeOption.String
		}
		if buyerName.Valid {
			t.BuyerName = buyerName.String
		}
		if sellerName.Valid {
			t.SellerName = sellerName.String
		}
		if productTitle.Valid {
			t.ProductTitle = productTitle.String
		}
		trades = append(trades, t)
	}

	totalPages := (total + limit - 1) / limit
	return c.JSON(models.APIResponse{Success: true, Data: models.PaginatedResponse{Data: trades, Total: total, Page: page, Limit: limit, TotalPages: totalPages}})
}

// GetAdminCategories returns aggregated category counts from products.
func (h *AdminHandler) GetAdminCategories(c *fiber.Ctx) error {
	limit, _ := strconv.Atoi(c.Query("limit", "50"))
	if limit <= 0 {
		limit = 50
	}

	start, end, derr := parseAdminDateRange(c)
	if derr != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: derr.Error()})
	}

	where := "WHERE 1=1"
	args := make([]interface{}, 0, 4)
	if start != nil {
		where += " AND created_at >= ?"
		args = append(args, *start)
	}
	if end != nil {
		where += " AND created_at < ?"
		args = append(args, *end)
	}

	type CategoryRow struct {
		Category    string    `json:"category"`
		Total       int       `json:"total"`
		Available   int       `json:"available"`
		Premium     int       `json:"premium"`
		LastCreated time.Time `json:"last_created_at"`
	}

	rows, err := h.db.Query(`
		SELECT
			COALESCE(NULLIF(TRIM(category), ''), 'Uncategorized') AS category,
			COUNT(*) AS total,
			SUM(CASE WHEN status = 'available' THEN 1 ELSE 0 END) AS available,
			SUM(CASE WHEN premium = true THEN 1 ELSE 0 END) AS premium,
			MAX(created_at) AS last_created_at
		FROM products
		`+where+`
		GROUP BY COALESCE(NULLIF(TRIM(category), ''), 'Uncategorized')
		ORDER BY total DESC
		LIMIT ?
	`, append(args, limit)...)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to get categories"})
	}
	defer rows.Close()

	result := make([]CategoryRow, 0, limit)
	for rows.Next() {
		var r CategoryRow
		if err := rows.Scan(&r.Category, &r.Total, &r.Available, &r.Premium, &r.LastCreated); err != nil {
			continue
		}
		result = append(result, r)
	}
	if result == nil {
		result = []CategoryRow{}
	}

	return c.JSON(models.APIResponse{Success: true, Data: result})
}

type adminExplorerSection struct {
	Key   string                   `json:"key"`
	Label string                   `json:"label"`
	Total int                      `json:"total"`
	Rows  []map[string]interface{} `json:"rows"`
}

type adminExplorerResult struct {
	Sections []adminExplorerSection `json:"sections"`
	Total    int                    `json:"total"`
}

type adminExplorerFilters struct {
	Types  map[string]bool
	Start  *time.Time
	End    *time.Time
	Page   int
	Limit  int
	Export bool
}

var adminOngoingStatuses = []string{"active", "ongoing", "multiway_active", "confirmed", "user3_accepted"}
var adminCompletedStatuses = []string{"completed", "history", "auto_completed"}
var adminCancelledStatuses = []string{"cancelled", "cancelled_due_to_conflict", "broken", "expired", "declined", "rejected", "user3_declined", "fully_declined"}

func parseAdminExplorerFilters(c *fiber.Ctx, forExport bool) (adminExplorerFilters, error) {
	types := map[string]bool{}
	for _, raw := range strings.Split(c.Query("types", ""), ",") {
		v := strings.TrimSpace(strings.ToLower(raw))
		if v != "" {
			types[v] = true
		}
	}
	if len(types) == 0 {
		return adminExplorerFilters{}, fmt.Errorf("select at least one dataset or filter")
	}

	start, end, err := parseAdminDateTimeRange(c.Query("start", ""), c.Query("end", ""))
	if err != nil {
		return adminExplorerFilters{}, err
	}

	page, _ := strconv.Atoi(c.Query("page", "1"))
	limit, _ := strconv.Atoi(c.Query("limit", "25"))
	if page <= 0 {
		page = 1
	}
	if limit <= 0 {
		limit = 25
	}
	if !forExport && limit > 100 {
		limit = 100
	}

	return adminExplorerFilters{Types: types, Start: start, End: end, Page: page, Limit: limit, Export: forExport}, nil
}

func parseAdminDateTimeRange(startStr, endStr string) (*time.Time, *time.Time, error) {
	parse := func(value string) (*time.Time, error) {
		value = strings.TrimSpace(value)
		if value == "" {
			return nil, nil
		}
		layouts := []string{
			time.RFC3339,
			"2006-01-02T15:04:05",
			"2006-01-02T15:04",
			"2006-01-02 15:04:05",
			"2006-01-02 15:04",
			"2006-01-02",
		}
		for _, layout := range layouts {
			if t, err := time.ParseInLocation(layout, value, time.Local); err == nil {
				return &t, nil
			}
		}
		return nil, fmt.Errorf("invalid date/time value")
	}

	start, err := parse(startStr)
	if err != nil {
		return nil, nil, fmt.Errorf("invalid start date/time")
	}
	end, err := parse(endStr)
	if err != nil {
		return nil, nil, fmt.Errorf("invalid end date/time")
	}
	if start != nil && end != nil && end.Before(*start) {
		return nil, nil, fmt.Errorf("end date/time must be after start date/time")
	}
	return start, end, nil
}

func adminAppendDateFilter(where *string, args *[]interface{}, column string, filters adminExplorerFilters) {
	if filters.Start != nil {
		*where += " AND " + column + " >= ?"
		*args = append(*args, *filters.Start)
	}
	if filters.End != nil {
		*where += " AND " + column + " <= ?"
		*args = append(*args, *filters.End)
	}
}

func adminHasAny(types map[string]bool, values ...string) bool {
	for _, v := range values {
		if types[v] {
			return true
		}
	}
	return false
}

func adminStatusList(filters adminExplorerFilters, includeDefault []string) []string {
	statusSet := map[string]bool{}
	if filters.Types["ongoing_trades"] {
		for _, s := range adminOngoingStatuses {
			statusSet[s] = true
		}
	}
	if filters.Types["completed_trades"] {
		for _, s := range adminCompletedStatuses {
			statusSet[s] = true
		}
	}
	if filters.Types["cancelled_trades"] {
		for _, s := range adminCancelledStatuses {
			statusSet[s] = true
		}
	}
	if len(statusSet) == 0 {
		return includeDefault
	}
	result := make([]string, 0, len(statusSet))
	for s := range statusSet {
		result = append(result, s)
	}
	return result
}

func adminAppendInClause(where *string, args *[]interface{}, column string, values []string) {
	if len(values) == 0 {
		return
	}
	placeholders := make([]string, len(values))
	for i, v := range values {
		placeholders[i] = "?"
		*args = append(*args, v)
	}
	*where += " AND " + column + " IN (" + strings.Join(placeholders, ",") + ")"
}

func (h *AdminHandler) GetDataExplorer(c *fiber.Ctx) error {
	filters, err := parseAdminExplorerFilters(c, false)
	if err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: err.Error()})
	}
	result, err := h.buildDataExplorerResult(filters)
	if err != nil {
		log.Printf("Admin data explorer failed: %v", err)
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to load admin data"})
	}
	return c.JSON(models.APIResponse{Success: true, Data: result})
}

func (h *AdminHandler) ExportDataExplorer(c *fiber.Ctx) error {
	filters, err := parseAdminExplorerFilters(c, true)
	if err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: err.Error()})
	}
	result, err := h.buildDataExplorerResult(filters)
	if err != nil {
		log.Printf("Admin data export failed: %v", err)
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to export admin data"})
	}

	format := strings.ToLower(strings.TrimSpace(c.Query("format", "csv")))
	filename := "clovia-data-export-" + time.Now().Format("20060102-150405")
	switch format {
	case "json":
		b, err := json.MarshalIndent(result, "", "  ")
		if err != nil {
			return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to generate JSON export"})
		}
		c.Set("Content-Type", "application/json")
		c.Set("Content-Disposition", `attachment; filename="`+filename+`.json"`)
		return c.Send(b)
	case "xlsx", "excel":
		b, err := buildAdminExplorerXLSX(result)
		if err != nil {
			return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to generate Excel export"})
		}
		c.Set("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
		c.Set("Content-Disposition", `attachment; filename="`+filename+`.xlsx"`)
		return c.Send(b)
	default:
		b, err := buildAdminExplorerCSV(result)
		if err != nil {
			return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to generate CSV export"})
		}
		c.Set("Content-Type", "text/csv; charset=utf-8")
		c.Set("Content-Disposition", `attachment; filename="`+filename+`.csv"`)
		return c.Send(b)
	}
}

func (h *AdminHandler) buildDataExplorerResult(filters adminExplorerFilters) (adminExplorerResult, error) {
	sections := make([]adminExplorerSection, 0, 8)

	add := func(section adminExplorerSection, err error) error {
		if err != nil {
			return err
		}
		if section.Rows == nil {
			section.Rows = []map[string]interface{}{}
		}
		sections = append(sections, section)
		return nil
	}

	if adminHasAny(filters.Types, "users", "premium_users", "verified_users", "unverified_users") {
		if err := add(h.buildExplorerUsers(filters)); err != nil {
			return adminExplorerResult{}, err
		}
	}
	if filters.Types["products"] {
		if err := add(h.buildExplorerProducts(filters)); err != nil {
			return adminExplorerResult{}, err
		}
	}
	if adminHasAny(filters.Types, "trades", "trade_matches", "ongoing_trades", "completed_trades", "cancelled_trades") {
		if err := add(h.buildExplorerTrades(filters)); err != nil {
			return adminExplorerResult{}, err
		}
	}
	if adminHasAny(filters.Types, "multiway_trades", "ongoing_trades", "completed_trades", "cancelled_trades") {
		if err := add(h.buildExplorerMultiway(filters)); err != nil {
			return adminExplorerResult{}, err
		}
	}
	if filters.Types["categories"] {
		if err := add(h.buildExplorerCategories(filters)); err != nil {
			return adminExplorerResult{}, err
		}
	}
	if filters.Types["reviews"] {
		if err := add(h.buildExplorerReviews(filters)); err != nil {
			return adminExplorerResult{}, err
		}
	}
	if adminHasAny(filters.Types, "reports", "flags") {
		if err := add(h.buildExplorerReports(filters)); err != nil {
			return adminExplorerResult{}, err
		}
	}
	if filters.Types["premium_plans"] {
		if err := add(h.buildExplorerPremiumPlans(filters)); err != nil {
			return adminExplorerResult{}, err
		}
	}
	if filters.Types["premium_revenue"] {
		if err := add(h.buildExplorerPremiumRevenue(filters)); err != nil {
			return adminExplorerResult{}, err
		}
	}

	total := 0
	for _, section := range sections {
		total += section.Total
	}
	return adminExplorerResult{Sections: sections, Total: total}, nil
}

func (h *AdminHandler) explorerLimitClause(filters adminExplorerFilters) string {
	if filters.Export {
		return ""
	}
	return fmt.Sprintf(" LIMIT %d OFFSET %d", filters.Limit, (filters.Page-1)*filters.Limit)
}

func (h *AdminHandler) countForQuery(query string, args []interface{}) int {
	var total int
	if err := h.db.QueryRow(query, args...).Scan(&total); err != nil {
		return 0
	}
	return total
}

func (h *AdminHandler) buildExplorerUsers(filters adminExplorerFilters) (adminExplorerSection, error) {
	where := "WHERE 1=1"
	args := []interface{}{}
	if filters.Types["premium_users"] {
		where += " AND COALESCE(u.is_premium, false) = true"
	}
	if filters.Types["verified_users"] && !filters.Types["unverified_users"] {
		where += " AND COALESCE(u.verified, false) = true"
	}
	if filters.Types["unverified_users"] && !filters.Types["verified_users"] {
		where += " AND COALESCE(u.verified, false) = false"
	}
	adminAppendDateFilter(&where, &args, "u.created_at", filters)

	total := h.countForQuery("SELECT COUNT(*) FROM users u "+where, args)
	rows, err := h.db.Query(`
		SELECT
			u.id,
			COALESCE(u.name, '') AS name,
			COALESCE(u.email, '') AS email,
			COALESCE(u.phone, '') AS phone,
			COALESCE(u.is_premium, false) AS premium_status,
			COALESCE(u.premium_tier, 'free') AS premium_tier,
			COALESCE(u.verified, false) AS verified_status,
			COALESCE(u.verification_status, 'not_verified') AS verification_status,
			COALESCE(u.role, 'user') AS role,
			u.created_at
		FROM users u
		`+where+`
		ORDER BY u.created_at DESC`+h.explorerLimitClause(filters), args...)
	if err != nil {
		return adminExplorerSection{}, fmt.Errorf("failed to load users")
	}
	defer rows.Close()
	mapped, err := rowsToAdminExplorerMaps(rows)
	return adminExplorerSection{Key: "users", Label: "Users", Total: total, Rows: mapped}, err
}

func (h *AdminHandler) buildExplorerProducts(filters adminExplorerFilters) (adminExplorerSection, error) {
	where := "WHERE 1=1"
	args := []interface{}{}
	adminAppendDateFilter(&where, &args, "p.created_at", filters)

	total := h.countForQuery("SELECT COUNT(*) FROM products p "+where, args)
	rows, err := h.db.Query(`
		SELECT
			p.id,
			COALESCE(p.title, '') AS title,
			COALESCE(p.status, '') AS status,
			COALESCE(u.name, '') AS seller,
			p.seller_id,
			COALESCE(p.category, '') AS category,
			COALESCE(p.premium, false) AS premium_listing,
			p.created_at
		FROM products p
		LEFT JOIN users u ON u.id = p.seller_id
		`+where+`
		ORDER BY p.created_at DESC`+h.explorerLimitClause(filters), args...)
	if err != nil {
		return adminExplorerSection{}, fmt.Errorf("failed to load products")
	}
	defer rows.Close()
	mapped, err := rowsToAdminExplorerMaps(rows)
	return adminExplorerSection{Key: "products", Label: "Products", Total: total, Rows: mapped}, err
}

func (h *AdminHandler) buildExplorerTrades(filters adminExplorerFilters) (adminExplorerSection, error) {
	where := "WHERE 1=1"
	args := []interface{}{}
	if statuses := adminStatusList(filters, nil); len(statuses) > 0 {
		adminAppendInClause(&where, &args, "t.status", statuses)
	}
	adminAppendDateFilter(&where, &args, "t.created_at", filters)

	total := h.countForQuery("SELECT COUNT(*) FROM trades t "+where, args)
	rows, err := h.db.Query(`
		SELECT
			t.id,
			'trade match' AS trade_type,
			CONCAT(COALESCE(ub.name, CONCAT('User #', t.buyer_id)), ' / ', COALESCE(us.name, CONCAT('User #', t.seller_id))) AS participants,
			COALESCE(t.status, '') AS status,
			COALESCE(p.title, '') AS target_product,
			COALESCE(t.trade_option, 'meetup') AS trade_option,
			t.created_at,
			t.completed_at
		FROM trades t
		LEFT JOIN users ub ON ub.id = t.buyer_id
		LEFT JOIN users us ON us.id = t.seller_id
		LEFT JOIN products p ON p.id = t.target_product_id
		`+where+`
		ORDER BY t.created_at DESC`+h.explorerLimitClause(filters), args...)
	if err != nil {
		return adminExplorerSection{}, fmt.Errorf("failed to load trades")
	}
	defer rows.Close()
	mapped, err := rowsToAdminExplorerMaps(rows)
	return adminExplorerSection{Key: "trades", Label: "Trade Matches", Total: total, Rows: mapped}, err
}

func (h *AdminHandler) buildExplorerMultiway(filters adminExplorerFilters) (adminExplorerSection, error) {
	where := "WHERE 1=1"
	args := []interface{}{}
	if statuses := adminStatusList(filters, nil); len(statuses) > 0 {
		adminAppendInClause(&where, &args, "m.status", statuses)
	}
	adminAppendDateFilter(&where, &args, "m.created_at", filters)

	total := h.countForQuery("SELECT COUNT(*) FROM multiway_trades m "+where, args)
	rows, err := h.db.Query(`
		SELECT
			m.id,
			m.chain_id,
			'multiway' AS trade_type,
			CONCAT_WS(' -> ', COALESCE(u1.name, CONCAT('User #', m.user1_id)), COALESCE(u2.name, CONCAT('User #', m.user2_id)), COALESCE(u3.name, CONCAT('User #', m.user3_id))) AS loop_participants,
			CONCAT_WS(' -> ', COALESCE(p1.title, ''), COALESCE(p2.title, ''), COALESCE(p3.title, '')) AS product_chain,
			COALESCE(m.status, '') AS status,
			m.created_at,
			CASE WHEN m.status IN ('completed','history') THEN m.updated_at ELSE NULL END AS completed_at
		FROM multiway_trades m
		LEFT JOIN users u1 ON u1.id = m.user1_id
		LEFT JOIN users u2 ON u2.id = m.user2_id
		LEFT JOIN users u3 ON u3.id = m.user3_id
		LEFT JOIN products p1 ON p1.id = m.user1_product_id
		LEFT JOIN products p2 ON p2.id = m.user2_product_id
		LEFT JOIN products p3 ON p3.id = m.user3_product_id
		`+where+`
		ORDER BY m.created_at DESC`+h.explorerLimitClause(filters), args...)
	if err != nil {
		return adminExplorerSection{}, fmt.Errorf("failed to load multiway trades")
	}
	defer rows.Close()
	mapped, err := rowsToAdminExplorerMaps(rows)
	return adminExplorerSection{Key: "multiway_trades", Label: "Multiway Trades", Total: total, Rows: mapped}, err
}

func (h *AdminHandler) buildExplorerCategories(filters adminExplorerFilters) (adminExplorerSection, error) {
	where := "WHERE 1=1"
	args := []interface{}{}
	adminAppendDateFilter(&where, &args, "p.created_at", filters)

	rows, err := h.db.Query(`
		SELECT
			COALESCE(NULLIF(TRIM(p.category), ''), 'Uncategorized') AS category,
			COUNT(*) AS total_products,
			SUM(CASE WHEN p.status = 'available' THEN 1 ELSE 0 END) AS available_products,
			SUM(CASE WHEN p.status IN ('traded','sold') THEN 1 ELSE 0 END) AS traded_products,
			SUM(CASE WHEN p.status = 'locked' THEN 1 ELSE 0 END) AS locked_products,
			SUM(CASE WHEN p.status = 'deleted' THEN 1 ELSE 0 END) AS deleted_products,
			MAX(p.created_at) AS last_created_at
		FROM products p
		`+where+`
		GROUP BY COALESCE(NULLIF(TRIM(p.category), ''), 'Uncategorized')
		ORDER BY total_products DESC`+h.explorerLimitClause(filters), args...)
	if err != nil {
		return adminExplorerSection{}, fmt.Errorf("failed to load categories")
	}
	defer rows.Close()
	mapped, err := rowsToAdminExplorerMaps(rows)
	return adminExplorerSection{Key: "categories", Label: "Categories", Total: len(mapped), Rows: mapped}, err
}

func (h *AdminHandler) buildExplorerReviews(filters adminExplorerFilters) (adminExplorerSection, error) {
	where := "WHERE 1=1"
	args := []interface{}{}
	adminAppendDateFilter(&where, &args, "r.created_at", filters)

	total := h.countForQuery("SELECT COUNT(*) FROM reviews r "+where, args)
	rows, err := h.db.Query(`
		SELECT
			r.id,
			COALESCE(reviewer.name, '') AS reviewer,
			COALESCE(reviewed.name, '') AS reviewed_user,
			r.rating,
			COALESCE(r.comment, '') AS comment,
			r.created_at
		FROM reviews r
		LEFT JOIN users reviewer ON reviewer.id = r.reviewer_id
		LEFT JOIN users reviewed ON reviewed.id = r.reviewed_user_id
		`+where+`
		ORDER BY r.created_at DESC`+h.explorerLimitClause(filters), args...)
	if err != nil {
		return adminExplorerSection{}, fmt.Errorf("failed to load reviews")
	}
	defer rows.Close()
	mapped, err := rowsToAdminExplorerMaps(rows)
	return adminExplorerSection{Key: "reviews", Label: "Reviews", Total: total, Rows: mapped}, err
}

func (h *AdminHandler) buildExplorerReports(filters adminExplorerFilters) (adminExplorerSection, error) {
	where := "WHERE 1=1"
	args := []interface{}{}
	adminAppendDateFilter(&where, &args, "r.created_at", filters)

	total := h.countForQuery("SELECT COUNT(*) FROM reports r "+where, args)
	rows, err := h.db.Query(`
		SELECT
			r.id,
			COALESCE(reporter.name, '') AS reporter,
			COALESCE(reported.name, '') AS reported_user,
			COALESCE(p.title, '') AS product,
			COALESCE(r.reason, '') AS reason,
			COALESCE(r.description, '') AS description,
			COALESCE(r.status, '') AS status,
			r.created_at,
			r.updated_at
		FROM reports r
		LEFT JOIN users reporter ON reporter.id = r.reporter_id
		LEFT JOIN users reported ON reported.id = r.reported_user_id
		LEFT JOIN products p ON p.id = r.product_id
		`+where+`
		ORDER BY r.created_at DESC`+h.explorerLimitClause(filters), args...)
	if err != nil {
		return adminExplorerSection{}, fmt.Errorf("failed to load reports")
	}
	defer rows.Close()
	mapped, err := rowsToAdminExplorerMaps(rows)
	return adminExplorerSection{Key: "reports", Label: "Reports / Flags", Total: total, Rows: mapped}, err
}

func (h *AdminHandler) buildExplorerPremiumPlans(filters adminExplorerFilters) (adminExplorerSection, error) {
	rows, err := h.db.Query(`
		SELECT plan_key, name, COALESCE(description, '') AS description, tier, billing_type, duration_days, price, COALESCE(badge_label, '') AS badge_label, COALESCE(access_scope, 'basic') AS access_scope, COALESCE(CAST(capabilities AS CHAR), '{}') AS capabilities, is_active, created_at, updated_at
		FROM premium_plans
		ORDER BY sort_order, price` + h.explorerLimitClause(filters))
	if err != nil {
		return adminExplorerSection{}, fmt.Errorf("failed to load premium plans")
	}
	defer rows.Close()
	mapped, err := rowsToAdminExplorerMaps(rows)
	return adminExplorerSection{Key: "premium_plans", Label: "Premium Plans", Total: len(mapped), Rows: mapped}, err
}

func (h *AdminHandler) buildExplorerPremiumRevenue(filters adminExplorerFilters) (adminExplorerSection, error) {
	where := "WHERE source_type = 'premium_upgrade'"
	args := []interface{}{}
	adminAppendDateFilter(&where, &args, "created_at", filters)
	total := h.countForQuery("SELECT COUNT(*) FROM earnings "+where, args)
	rows, err := h.db.Query(`
		SELECT id, user_id, source_type, amount, external_id, created_at
		FROM earnings
		`+where+`
		ORDER BY created_at DESC`+h.explorerLimitClause(filters), args...)
	if err != nil {
		return adminExplorerSection{}, fmt.Errorf("failed to load premium revenue")
	}
	defer rows.Close()
	mapped, err := rowsToAdminExplorerMaps(rows)
	return adminExplorerSection{Key: "premium_revenue", Label: "Premium Revenue", Total: total, Rows: mapped}, err
}

func rowsToAdminExplorerMaps(rows *sql.Rows) ([]map[string]interface{}, error) {
	columns, err := rows.Columns()
	if err != nil {
		return nil, err
	}
	result := []map[string]interface{}{}
	for rows.Next() {
		values := make([]interface{}, len(columns))
		scan := make([]interface{}, len(columns))
		for i := range values {
			scan[i] = &values[i]
		}
		if err := rows.Scan(scan...); err != nil {
			return result, err
		}
		row := map[string]interface{}{}
		for i, col := range columns {
			switch v := values[i].(type) {
			case nil:
				row[col] = nil
			case []byte:
				row[col] = string(v)
			case time.Time:
				row[col] = v.Format(time.RFC3339)
			default:
				row[col] = v
			}
		}
		result = append(result, row)
	}
	return result, rows.Err()
}

func adminExplorerHeaders(result adminExplorerResult) []string {
	seen := map[string]bool{"dataset": true}
	headers := []string{"dataset"}
	for _, section := range result.Sections {
		for _, row := range section.Rows {
			for key := range row {
				if !seen[key] {
					seen[key] = true
					headers = append(headers, key)
				}
			}
		}
	}
	return headers
}

func adminCellString(value interface{}) string {
	if value == nil {
		return ""
	}
	switch v := value.(type) {
	case string:
		return v
	case bool:
		if v {
			return "true"
		}
		return "false"
	case time.Time:
		return v.Format(time.RFC3339)
	default:
		return fmt.Sprint(v)
	}
}

func buildAdminExplorerCSV(result adminExplorerResult) ([]byte, error) {
	var buf bytes.Buffer
	writer := csv.NewWriter(&buf)
	headers := adminExplorerHeaders(result)
	if err := writer.Write(headers); err != nil {
		return nil, err
	}
	for _, section := range result.Sections {
		for _, row := range section.Rows {
			record := make([]string, len(headers))
			for i, h := range headers {
				if h == "dataset" {
					record[i] = section.Label
				} else {
					record[i] = adminCellString(row[h])
				}
			}
			if err := writer.Write(record); err != nil {
				return nil, err
			}
		}
	}
	writer.Flush()
	return buf.Bytes(), writer.Error()
}

func safeExcelSheetName(name string, fallback string) string {
	replacer := strings.NewReplacer("[", "", "]", "", ":", "", "*", "", "?", "", "/", "", "\\", "")
	cleaned := strings.TrimSpace(replacer.Replace(name))
	if cleaned == "" {
		cleaned = fallback
	}
	if len(cleaned) > 31 {
		cleaned = cleaned[:31]
	}
	return cleaned
}

func excelColumnName(n int) string {
	name := ""
	for n > 0 {
		n--
		name = string(rune('A'+(n%26))) + name
		n /= 26
	}
	return name
}

func buildAdminExplorerXLSX(result adminExplorerResult) ([]byte, error) {
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	writeFile := func(name, body string) error {
		w, err := zw.Create(name)
		if err != nil {
			return err
		}
		_, err = w.Write([]byte(body))
		return err
	}

	contentTypes := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`
	for i := range result.Sections {
		contentTypes += fmt.Sprintf(`<Override PartName="/xl/worksheets/sheet%d.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`, i+1)
	}
	contentTypes += `</Types>`
	if err := writeFile("[Content_Types].xml", contentTypes); err != nil {
		return nil, err
	}
	if err := writeFile("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`); err != nil {
		return nil, err
	}

	workbook := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>`
	rels := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
	for i, section := range result.Sections {
		sheetName := safeExcelSheetName(section.Label, fmt.Sprintf("Sheet %d", i+1))
		workbook += fmt.Sprintf(`<sheet name="%s" sheetId="%d" r:id="rId%d"/>`, html.EscapeString(sheetName), i+1, i+1)
		rels += fmt.Sprintf(`<Relationship Id="rId%d" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet%d.xml"/>`, i+1, i+1)
	}
	workbook += `</sheets></workbook>`
	rels += `</Relationships>`
	if err := writeFile("xl/workbook.xml", workbook); err != nil {
		return nil, err
	}
	if err := writeFile("xl/_rels/workbook.xml.rels", rels); err != nil {
		return nil, err
	}

	for i, section := range result.Sections {
		headers := []string{}
		seen := map[string]bool{}
		for _, row := range section.Rows {
			for key := range row {
				if !seen[key] {
					seen[key] = true
					headers = append(headers, key)
				}
			}
		}
		if len(headers) == 0 {
			headers = []string{"message"}
			section.Rows = []map[string]interface{}{{"message": "No rows matched the selected filters"}}
		}
		sheet := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>`
		sheet += `<row r="1">`
		for c, header := range headers {
			ref := excelColumnName(c+1) + "1"
			sheet += fmt.Sprintf(`<c r="%s" t="inlineStr"><is><t>%s</t></is></c>`, ref, html.EscapeString(header))
		}
		sheet += `</row>`
		for r, row := range section.Rows {
			rowNum := r + 2
			sheet += fmt.Sprintf(`<row r="%d">`, rowNum)
			for c, header := range headers {
				ref := excelColumnName(c+1) + strconv.Itoa(rowNum)
				sheet += fmt.Sprintf(`<c r="%s" t="inlineStr"><is><t>%s</t></is></c>`, ref, html.EscapeString(adminCellString(row[header])))
			}
			sheet += `</row>`
		}
		sheet += `</sheetData></worksheet>`
		if err := writeFile(fmt.Sprintf("xl/worksheets/sheet%d.xml", i+1), sheet); err != nil {
			return nil, err
		}
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

type PremiumPlanPayload struct {
	ID           int                    `json:"id"`
	PlanKey      string                 `json:"plan_key"`
	Name         string                 `json:"name"`
	Description  string                 `json:"description"`
	Tier         string                 `json:"tier"`
	BillingType  string                 `json:"billing_type"`
	DurationDays int                    `json:"duration_days"`
	Price        float64                `json:"price"`
	BadgeLabel   string                 `json:"badge_label"`
	AccessScope  string                 `json:"access_scope"`
	Capabilities map[string]interface{} `json:"capabilities"`
	IsActive     bool                   `json:"is_active"`
	SortOrder    int                    `json:"sort_order"`
}

type PremiumFeaturePayload struct {
	ID          int    `json:"id"`
	FeatureKey  string `json:"feature_key"`
	Label       string `json:"label"`
	Description string `json:"description"`
	Enabled     bool   `json:"enabled"`
	SortOrder   int    `json:"sort_order"`
}

type PremiumPromotionPayload struct {
	ID                    int                    `json:"id"`
	Title                 string                 `json:"title"`
	PlanKey               string                 `json:"plan_key"`
	DiscountedPrice       float64                `json:"discounted_price"`
	StartAt               string                 `json:"start_at"`
	EndAt                 string                 `json:"end_at"`
	Capabilities          map[string]interface{} `json:"capabilities"`
	OverridesCapabilities bool                   `json:"overrides_capabilities"`
	IsActive              bool                   `json:"is_active"`
}

func (h *AdminHandler) GetPremiumManagement(c *fiber.Ctx) error {
	data, err := h.loadPremiumManagement()
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: err.Error()})
	}
	return c.JSON(models.APIResponse{Success: true, Data: data})
}

func (h *AdminHandler) loadPremiumManagement() (fiber.Map, error) {
	settings := map[string]string{
		"premium_enabled":       "true",
		"premium_monthly_price": "79",
		"premium_yearly_price":  "699",
		"premium_promo_price":   "",
	}
	rows, err := h.db.Query("SELECT setting_key, setting_value FROM app_settings WHERE setting_key LIKE 'premium_%'")
	if err == nil {
		defer rows.Close()
		for rows.Next() {
			var k, v string
			if rows.Scan(&k, &v) == nil {
				settings[k] = v
			}
		}
	}

	plans, err := h.loadPremiumPlans()
	if err != nil {
		return nil, err
	}
	features, err := h.loadPremiumFeatures()
	if err != nil {
		return nil, err
	}
	promos, err := h.loadPremiumPromotions()
	if err != nil {
		return nil, err
	}
	users, err := h.loadPremiumUsers()
	if err != nil {
		return nil, err
	}

	return fiber.Map{
		"settings":   settings,
		"plans":      plans,
		"features":   features,
		"promotions": promos,
		"users":      users,
	}, nil
}

func (h *AdminHandler) loadPremiumPlans() ([]PremiumPlanPayload, error) {
	rows, err := h.db.Query(`SELECT id, plan_key, name, COALESCE(description, ''), tier, billing_type, duration_days, price, COALESCE(badge_label, ''), COALESCE(access_scope, 'basic'), COALESCE(CAST(capabilities AS CHAR), '{}'), is_active, sort_order FROM premium_plans ORDER BY sort_order, price`)
	if err != nil {
		return nil, fmt.Errorf("failed to load premium plans")
	}
	defer rows.Close()
	items := []PremiumPlanPayload{}
	for rows.Next() {
		var p PremiumPlanPayload
		var capsRaw string
		if rows.Scan(&p.ID, &p.PlanKey, &p.Name, &p.Description, &p.Tier, &p.BillingType, &p.DurationDays, &p.Price, &p.BadgeLabel, &p.AccessScope, &capsRaw, &p.IsActive, &p.SortOrder) == nil {
			p.Capabilities = map[string]interface{}{}
			_ = json.Unmarshal([]byte(capsRaw), &p.Capabilities)
			items = append(items, p)
		}
	}
	return items, nil
}

func (h *AdminHandler) loadPremiumFeatures() ([]PremiumFeaturePayload, error) {
	rows, err := h.db.Query(`SELECT id, feature_key, label, COALESCE(description, ''), enabled, sort_order FROM premium_features ORDER BY sort_order, label`)
	if err != nil {
		return nil, fmt.Errorf("failed to load premium features")
	}
	defer rows.Close()
	items := []PremiumFeaturePayload{}
	for rows.Next() {
		var f PremiumFeaturePayload
		if rows.Scan(&f.ID, &f.FeatureKey, &f.Label, &f.Description, &f.Enabled, &f.SortOrder) == nil {
			items = append(items, f)
		}
	}
	return items, nil
}

func (h *AdminHandler) loadPremiumPromotions() ([]PremiumPromotionPayload, error) {
	rows, err := h.db.Query(`SELECT id, title, COALESCE(plan_key, ''), discounted_price, start_at, end_at, COALESCE(CAST(capabilities AS CHAR), '{}'), overrides_capabilities, is_active FROM premium_promotions ORDER BY created_at DESC`)
	if err != nil {
		return nil, fmt.Errorf("failed to load premium promotions")
	}
	defer rows.Close()
	items := []PremiumPromotionPayload{}
	for rows.Next() {
		var p PremiumPromotionPayload
		var start, end sql.NullTime
		var capsRaw string
		if rows.Scan(&p.ID, &p.Title, &p.PlanKey, &p.DiscountedPrice, &start, &end, &capsRaw, &p.OverridesCapabilities, &p.IsActive) == nil {
			if start.Valid {
				p.StartAt = start.Time.Format("2006-01-02T15:04")
			}
			if end.Valid {
				p.EndAt = end.Time.Format("2006-01-02T15:04")
			}
			p.Capabilities = map[string]interface{}{}
			_ = json.Unmarshal([]byte(capsRaw), &p.Capabilities)
			items = append(items, p)
		}
	}
	return items, nil
}

func sanitizePremiumCapabilities(caps map[string]interface{}) map[string]interface{} {
	cleaned := map[string]interface{}{}
	for key, value := range caps {
		if strings.TrimSpace(key) == "" {
			continue
		}
		if text, ok := value.(string); ok && strings.TrimSpace(text) == "" {
			continue
		}
		cleaned[key] = value
	}
	return cleaned
}

func (h *AdminHandler) loadPremiumUsers() ([]map[string]interface{}, error) {
	rows, err := h.db.Query(`
		SELECT id, name, email, COALESCE(premium_tier, 'free') AS plan, COALESCE(is_premium, false) AS active, created_at, premium_expires_at
		FROM users
		WHERE COALESCE(is_premium, false) = true OR COALESCE(premium_tier, 'free') <> 'free' OR premium_expires_at IS NOT NULL
		ORDER BY COALESCE(premium_expires_at, created_at) DESC
		LIMIT 200
	`)
	if err != nil {
		return nil, fmt.Errorf("failed to load premium users")
	}
	defer rows.Close()
	return rowsToAdminExplorerMaps(rows)
}

func (h *AdminHandler) UpdatePremiumManagement(c *fiber.Ctx) error {
	var payload struct {
		Settings   map[string]string         `json:"settings"`
		Plans      []PremiumPlanPayload      `json:"plans"`
		Features   []PremiumFeaturePayload   `json:"features"`
		Promotions []PremiumPromotionPayload `json:"promotions"`
	}
	if err := c.BodyParser(&payload); err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid premium management payload"})
	}

	for _, key := range []string{"premium_enabled", "premium_monthly_price", "premium_yearly_price", "premium_promo_price"} {
		if value, ok := payload.Settings[key]; ok {
			if _, err := h.db.Exec(`INSERT INTO app_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`, key, value); err != nil {
				return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to save premium settings"})
			}
		}
	}
	if value, ok := payload.Settings["premium_monthly_price"]; ok {
		if price, err := strconv.ParseFloat(strings.TrimSpace(value), 64); err == nil && price >= 0 {
			_, _ = h.db.Exec("UPDATE premium_plans SET price = ? WHERE plan_key = 'plus_monthly'", price)
		}
	}
	if value, ok := payload.Settings["premium_yearly_price"]; ok {
		if price, err := strconv.ParseFloat(strings.TrimSpace(value), 64); err == nil && price >= 0 {
			_, _ = h.db.Exec("UPDATE premium_plans SET price = ? WHERE plan_key = 'plus_yearly'", price)
		}
	}
	for _, p := range payload.Plans {
		if strings.TrimSpace(p.PlanKey) == "" || strings.TrimSpace(p.Name) == "" {
			continue
		}
		if p.DurationDays <= 0 {
			p.DurationDays = 30
		}
		if p.AccessScope == "" {
			p.AccessScope = "basic"
		}
		capsBytes, _ := json.Marshal(sanitizePremiumCapabilities(p.Capabilities))
		_, err := h.db.Exec(`
			INSERT INTO premium_plans (plan_key, name, description, tier, billing_type, duration_days, price, badge_label, access_scope, capabilities, is_active, sort_order)
			VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
			ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description), tier = VALUES(tier), billing_type = VALUES(billing_type), duration_days = VALUES(duration_days), price = VALUES(price), badge_label = VALUES(badge_label), access_scope = VALUES(access_scope), capabilities = VALUES(capabilities), is_active = VALUES(is_active), sort_order = VALUES(sort_order)
		`, p.PlanKey, p.Name, p.Description, p.Tier, p.BillingType, p.DurationDays, p.Price, p.BadgeLabel, p.AccessScope, string(capsBytes), p.IsActive, p.SortOrder)
		if err != nil {
			return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to save premium plans"})
		}
	}
	for _, f := range payload.Features {
		if strings.TrimSpace(f.FeatureKey) == "" || strings.TrimSpace(f.Label) == "" {
			continue
		}
		_, err := h.db.Exec(`
			INSERT INTO premium_features (feature_key, label, description, enabled, sort_order)
			VALUES (?, ?, ?, ?, ?)
			ON DUPLICATE KEY UPDATE label = VALUES(label), description = VALUES(description), enabled = VALUES(enabled), sort_order = VALUES(sort_order)
		`, f.FeatureKey, f.Label, f.Description, f.Enabled, f.SortOrder)
		if err != nil {
			return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to save premium features"})
		}
	}
	for _, promo := range payload.Promotions {
		if strings.TrimSpace(promo.Title) == "" {
			continue
		}
		start, _ := parseAdminNullableDateTime(promo.StartAt)
		end, _ := parseAdminNullableDateTime(promo.EndAt)
		capsBytes, _ := json.Marshal(sanitizePremiumCapabilities(promo.Capabilities))
		var err error
		if promo.ID > 0 {
			_, err = h.db.Exec(`UPDATE premium_promotions SET title = ?, plan_key = NULLIF(?, ''), discounted_price = ?, start_at = ?, end_at = ?, capabilities = ?, overrides_capabilities = ?, is_active = ? WHERE id = ?`, promo.Title, promo.PlanKey, promo.DiscountedPrice, start, end, string(capsBytes), promo.OverridesCapabilities, promo.IsActive, promo.ID)
		} else {
			_, err = h.db.Exec(`INSERT INTO premium_promotions (title, plan_key, discounted_price, start_at, end_at, capabilities, overrides_capabilities, is_active) VALUES (?, NULLIF(?, ''), ?, ?, ?, ?, ?, ?)`, promo.Title, promo.PlanKey, promo.DiscountedPrice, start, end, string(capsBytes), promo.OverridesCapabilities, promo.IsActive)
		}
		if err != nil {
			return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to save premium promotions"})
		}
	}

	data, err := h.loadPremiumManagement()
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: err.Error()})
	}
	return c.JSON(models.APIResponse{Success: true, Data: data})
}

func parseAdminNullableDateTime(value string) (*time.Time, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return nil, nil
	}
	t, err := time.ParseInLocation("2006-01-02T15:04", value, time.Local)
	if err != nil {
		return nil, err
	}
	return &t, nil
}

func (h *AdminHandler) UpdatePremiumUser(c *fiber.Ctx) error {
	userID, err := strconv.Atoi(c.Params("id"))
	if err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid user ID"})
	}
	var payload struct {
		Action       string `json:"action"`
		Tier         string `json:"tier"`
		DurationDays int    `json:"duration_days"`
	}
	if err := c.BodyParser(&payload); err != nil {
		return c.Status(400).JSON(models.APIResponse{Success: false, Error: "Invalid premium user payload"})
	}
	if payload.Tier == "" {
		payload.Tier = "plus"
	}
	if payload.DurationDays <= 0 {
		payload.DurationDays = 30
	}

	switch payload.Action {
	case "cancel", "downgrade":
		_, err = h.db.Exec("UPDATE users SET is_premium = false, premium_tier = 'free', premium_expires_at = NULL WHERE id = ?", userID)
	case "extend":
		_, err = h.db.Exec(`
			UPDATE users
			SET is_premium = true,
			    premium_tier = ?,
			    verified = true,
			    premium_expires_at = DATE_ADD(CASE WHEN premium_expires_at IS NULL OR premium_expires_at < NOW() THEN NOW() ELSE premium_expires_at END, INTERVAL ? DAY)
			WHERE id = ?
		`, payload.Tier, payload.DurationDays, userID)
	default:
		_, err = h.db.Exec("UPDATE users SET is_premium = true, premium_tier = ?, verified = true, premium_expires_at = DATE_ADD(NOW(), INTERVAL ? DAY) WHERE id = ?", payload.Tier, payload.DurationDays, userID)
	}
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to update premium user"})
	}
	data, err := h.loadPremiumManagement()
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: err.Error()})
	}
	return c.JSON(models.APIResponse{Success: true, Data: data})
}
