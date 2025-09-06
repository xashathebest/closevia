package handlers

import (
	"log"
	"math"
	"time"

	"github.com/xashathebest/clovia/database"
)

// RecalculateApproxValues recomputes approx_value_points nightly based on signals
func RecalculateApproxValues() {
	log.Println("Nightly job: RecalculateApproxValues started")

	// Fixed: Properly handle SQL null values and join
	rows, err := database.DB.Query(`
		SELECT p.id,
			COALESCE(s.views, 0) as views,
			COALESCE(s.saves, 0) as saves,
			COALESCE(s.messages, 0) as messages,
			COALESCE(s.trade_offers, 0) as trade_offers
		FROM products p
		LEFT JOIN item_value_signals s ON s.item_id = p.id`)
	if err != nil {
		log.Println("Job query error:", err)
		return
	}
	defer rows.Close()

	for rows.Next() {
		var id int64
		var views, saves, messages, offers int64
		if err := rows.Scan(&id, &views, &saves, &messages, &offers); err != nil {
			log.Println("Error scanning row:", err)
			continue
		}

		sig := &ValuationSignals{
			Views:       views,
			Saves:       saves,
			Messages:    messages,
			TradeOffers: offers,
		}

		base := int64(2000)
		// use the existing demandFactor from valuation_handler.go
		dem := demandFactor(sig)
		points := int64(math.Round(float64(base) * dem))
		// use the existing DollarsPerPoint from constants.go
		usdCents := int64(math.Round(float64(points) * DollarsPerPoint * 100))

		// Fixed: Update the products table with calculated values
		_, err := database.DB.Exec(`
			UPDATE products SET
				approx_value_points = ?,
				approx_value_usd_cents = ?,
				updated_at = NOW()
			WHERE id = ?`,
			points, usdCents, id)

		if err != nil {
			log.Println("Update product error:", err)
		}
	}

	if err := rows.Err(); err != nil {
		log.Println("Error iterating rows:", err)
	}

	log.Println("Nightly job: RecalculateApproxValues finished at", time.Now())
}

// CalculateReward calculates reward based on points
func CalculateReward(points int) float64 {
	return float64(points) * DollarsPerPoint
}
