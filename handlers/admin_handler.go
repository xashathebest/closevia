package handlers

import (
	"database/sql"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/xashathebest/clovia/database"
	"github.com/xashathebest/clovia/models"
)

type AdminHandler struct {
	db *sql.DB
}

func NewAdminHandler() *AdminHandler {
	return &AdminHandler{db: database.DB}
}

// GetAdminStats returns comprehensive dashboard statistics for admin
func (h *AdminHandler) GetAdminStats(c *fiber.Ctx) error {
	// Get current time and 30 days ago for date calculations
	now := time.Now()
	thirtyDaysAgo := now.AddDate(0, 0, -30)

	// ===== KPI METRICS =====

	// Active Listings (exclude sold/expired/draft)
	var activeListings int
	err := h.db.QueryRow(`
		SELECT COUNT(*) FROM products 
		WHERE status NOT IN ('sold', 'expired', 'draft') 
		AND deleted_at IS NULL
	`).Scan(&activeListings)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to fetch active listings"})
	}

	// Premium Listings (active listings where is_premium=true)
	var premiumListings int
	err = h.db.QueryRow(`
		SELECT COUNT(*) FROM products 
		WHERE is_premium = true 
		AND status NOT IN ('sold', 'expired', 'draft') 
		AND deleted_at IS NULL
	`).Scan(&premiumListings)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to fetch premium listings"})
	}

	// Transactions (Last 30 Days)
	var transactions30Days int
	err = h.db.QueryRow(`
		SELECT COUNT(*) FROM trades 
		WHERE status = 'completed' 
		AND created_at >= ?
	`, thirtyDaysAgo).Scan(&transactions30Days)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to fetch transactions count"})
	}

	// Net Revenue (Last 30 Days)
	var netRevenue30Days float64
	err = h.db.QueryRow(`
		SELECT COALESCE(SUM(net_amount), 0) FROM trades 
		WHERE status = 'completed' 
		AND created_at >= ? 
		AND net_amount IS NOT NULL
	`, thirtyDaysAgo).Scan(&netRevenue30Days)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to fetch net revenue"})
	}

	// Registered Users breakdown
	var totalUsers, adminUsers int
	err = h.db.QueryRow(`
		SELECT COUNT(*) FROM users WHERE deleted_at IS NULL
	`).Scan(&totalUsers)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to fetch total users"})
	}

	err = h.db.QueryRow(`
		SELECT COUNT(*) FROM users WHERE role = 'admin' AND deleted_at IS NULL
	`).Scan(&adminUsers)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to fetch admin users"})
	}

	// ===== OPERATIONAL METRICS =====

	// Reports to Review
	var reportsToReview int
	err = h.db.QueryRow(`
		SELECT COUNT(*) FROM reports WHERE status = 'pending'
	`).Scan(&reportsToReview)
	if err != nil {
		reportsToReview = 0 // Set to 0 if table doesn't exist
	}

	// Pending Verifications
	var pendingVerifications int
	err = h.db.QueryRow(`
		SELECT COUNT(*) FROM user_verifications WHERE status = 'pending'
	`).Scan(&pendingVerifications)
	if err != nil {
		pendingVerifications = 0 // Set to 0 if table doesn't exist
	}

	// Listings Awaiting Approval
	var listingsAwaitingApproval int
	err = h.db.QueryRow(`
		SELECT COUNT(*) FROM products WHERE status = 'pending_approval' AND deleted_at IS NULL
	`).Scan(&listingsAwaitingApproval)
	if err != nil {
		listingsAwaitingApproval = 0 // Set to 0 if table doesn't exist
	}

	// Disputes Pending
	var disputesPending int
	err = h.db.QueryRow(`
		SELECT COUNT(*) FROM disputes WHERE status = 'pending'
	`).Scan(&disputesPending)
	if err != nil {
		disputesPending = 0 // Set to 0 if table doesn't exist
	}

	// Payouts Pending
	var payoutsPending int
	err = h.db.QueryRow(`
		SELECT COUNT(*) FROM payouts WHERE status = 'pending'
	`).Scan(&payoutsPending)
	if err != nil {
		payoutsPending = 0 // Set to 0 if table doesn't exist
	}

	// ===== GROWTH METRICS =====

	// DAU (Daily Active Users)
	var dau int
	err = h.db.QueryRow(`
		SELECT COUNT(DISTINCT user_id) FROM user_activity 
		WHERE DATE(created_at) = CURDATE()
	`).Scan(&dau)
	if err != nil {
		dau = 0 // Set to 0 if table doesn't exist
	}

	// WAU (Weekly Active Users)
	var wau int
	err = h.db.QueryRow(`
		SELECT COUNT(DISTINCT user_id) FROM user_activity 
		WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
	`).Scan(&wau)
	if err != nil {
		wau = 0 // Set to 0 if table doesn't exist
	}

	// MAU (Monthly Active Users)
	var mau int
	err = h.db.QueryRow(`
		SELECT COUNT(DISTINCT user_id) FROM user_activity 
		WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
	`).Scan(&mau)
	if err != nil {
		mau = 0 // Set to 0 if table doesn't exist
	}

	// ===== CONVERSION FUNNEL =====

	// Views (product views)
	var totalViews int
	err = h.db.QueryRow(`
		SELECT COUNT(*) FROM product_views WHERE created_at >= ?
	`, thirtyDaysAgo).Scan(&totalViews)
	if err != nil {
		totalViews = 0 // Set to 0 if table doesn't exist
	}

	// Chats initiated
	var totalChats int
	err = h.db.QueryRow(`
		SELECT COUNT(*) FROM chats WHERE created_at >= ?
	`, thirtyDaysAgo).Scan(&totalChats)
	if err != nil {
		totalChats = 0 // Set to 0 if table doesn't exist
	}

	// Offers made
	var totalOffers int
	err = h.db.QueryRow(`
		SELECT COUNT(*) FROM offers WHERE created_at >= ?
	`, thirtyDaysAgo).Scan(&totalOffers)
	if err != nil {
		totalOffers = 0 // Set to 0 if table doesn't exist
	}

	// Completed transactions
	var completedTransactions int
	err = h.db.QueryRow(`
		SELECT COUNT(*) FROM trades WHERE status = 'completed' AND created_at >= ?
	`, thirtyDaysAgo).Scan(&completedTransactions)
	if err != nil {
		completedTransactions = 0
	}

	// ===== TOP CATEGORIES =====

	// Get top categories by share of active listings
	categoryRows, err := h.db.Query(`
		SELECT c.name, COUNT(p.id) as count
		FROM categories c
		LEFT JOIN products p ON p.category_id = c.id 
		AND p.status NOT IN ('sold', 'expired', 'draft') 
		AND p.deleted_at IS NULL
		GROUP BY c.id, c.name
		ORDER BY count DESC
		LIMIT 5
	`)
	if err != nil {
		// If categories table doesn't exist, create empty data
		categoryRows = nil
	}

	type CategoryData struct {
		Name  string  `json:"name"`
		Count int     `json:"count"`
		Share float64 `json:"share"`
	}

	var topCategories []CategoryData
	if categoryRows != nil {
		defer categoryRows.Close()

		for categoryRows.Next() {
			var cat CategoryData
			if err := categoryRows.Scan(&cat.Name, &cat.Count); err == nil {
				if activeListings > 0 {
					cat.Share = float64(cat.Count) / float64(activeListings) * 100
				}
				topCategories = append(topCategories, cat)
			}
		}
	}

	// ===== TRANSACTION TRENDS CHART =====

	// Get transaction data for chart (last 30 days) with multiple metrics
	trendRows, err := h.db.Query(`
		SELECT 
			DATE_FORMAT(created_at, '%Y-%m-%d') as date,
			COUNT(*) as count,
			COALESCE(SUM(net_amount), 0) as gmv,
			COALESCE(SUM(net_amount), 0) as revenue
		FROM trades 
		WHERE status = 'completed' 
		AND created_at >= ?
		GROUP BY DATE(created_at)
		ORDER BY date
	`, thirtyDaysAgo)
	if err != nil {
		return c.Status(500).JSON(models.APIResponse{Success: false, Error: "Failed to fetch transaction chart data"})
	}
	defer trendRows.Close()

	type TrendData struct {
		Date    string  `json:"date"`
		Count   int     `json:"count"`
		GMV     float64 `json:"gmv"`
		Revenue float64 `json:"revenue"`
	}

	var trendData []TrendData
	for trendRows.Next() {
		var data TrendData
		if err := trendRows.Scan(&data.Date, &data.Count, &data.GMV, &data.Revenue); err == nil {
			trendData = append(trendData, data)
		}
	}

	// ===== RECENT ADMIN ACTIVITY =====

	// Get recent admin actions (reports, approvals, etc.)
	activityRows, err := h.db.Query(`
		SELECT 
			'Report' as action_type,
			r.id,
			r.status,
			r.created_at,
			CONCAT('Report #', r.id) as description,
			u.name as user_name
		FROM reports r
		JOIN users u ON u.id = r.reported_user_id
		WHERE r.created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
		UNION ALL
		SELECT 
			'Verification' as action_type,
			v.id,
			v.status,
			v.created_at,
			CONCAT('Verification for ', u.name) as description,
			u.name as user_name
		FROM user_verifications v
		JOIN users u ON u.id = v.user_id
		WHERE v.created_at >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
		ORDER BY created_at DESC
		LIMIT 10
	`)
	if err != nil {
		// If tables don't exist, create empty data
		activityRows = nil
	}

	type AdminActivity struct {
		ActionType  string    `json:"action_type"`
		ID          int       `json:"id"`
		Status      string    `json:"status"`
		CreatedAt   time.Time `json:"created_at"`
		Description string    `json:"description"`
		UserName    string    `json:"user_name"`
	}

	var recentAdminActivity []AdminActivity
	if activityRows != nil {
		defer activityRows.Close()

		for activityRows.Next() {
			var activity AdminActivity
			if err := activityRows.Scan(&activity.ActionType, &activity.ID, &activity.Status, &activity.CreatedAt, &activity.Description, &activity.UserName); err == nil {
				recentAdminActivity = append(recentAdminActivity, activity)
			}
		}
	}

	// ===== COMPILE ALL STATISTICS =====

	stats := fiber.Map{
		// KPI Metrics
		"active_listings":      activeListings,
		"premium_listings":     premiumListings,
		"transactions_30_days": transactions30Days,
		"net_revenue_30_days":  netRevenue30Days,
		"total_users":          totalUsers,
		"admin_users":          adminUsers,
		"regular_users":        totalUsers - adminUsers,

		// Operational Metrics
		"reports_to_review":          reportsToReview,
		"pending_verifications":      pendingVerifications,
		"listings_awaiting_approval": listingsAwaitingApproval,
		"disputes_pending":           disputesPending,
		"payouts_pending":            payoutsPending,

		// Growth Metrics
		"dau": dau,
		"wau": wau,
		"mau": mau,

		// Conversion Funnel
		"total_views":            totalViews,
		"total_chats":            totalChats,
		"total_offers":           totalOffers,
		"completed_transactions": completedTransactions,

		// Charts and Data
		"top_categories":        topCategories,
		"trend_data":            trendData,
		"recent_admin_activity": recentAdminActivity,
	}

	return c.JSON(models.APIResponse{Success: true, Data: stats})
}
