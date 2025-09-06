package handlers

import (
	"database/sql"
	"log"
	"math"
	"time"

	"github.com/xashathebest/clovia/database"
)

const (
	// DollarsPerPoint is the conversion rate from points to USD
	DollarsPerPoint = 0.01
)

// RecalculateApproxValues recomputes approx_value_points nightly based on signals
func RecalculateApproxValues() {
	log.Println("Nightly job: RecalculateApproxValues started")
	rows, err := database.DB.Query(`
		SELECT p.id,
			COALESCE(s.views,0), COALESCE(s.saves,0), COALESCE(s.messages,0), COALESCE(s.trade_offers,0)
		FROM products p
		LEFT JOIN item_value_signals s ON s.item_id = p.id`)
	if err != nil {
		log.Println("job query error:", err)
		return
	}
	defer rows.Close()

	for rows.Next() {
		var id int64
		var views, saves, messages, offers sql.NullInt64
		if err := rows.Scan(&id, &views, &saves, &messages, &offers); err != nil {
			continue
		}
		sig := &ValuationSignals{Views: views.Int64, Saves: saves.Int64, Messages: messages.Int64, TradeOffers: offers.Int64}
		base := int64(2000)
		dem := demandFactor(sig)
		points := int64(math.Round(float64(base) * dem))
		usd := float64(points) * DollarsPerPoint
		_, err := database.DB.Exec(`
			UPDATE products SET
				price = price,
				updated_at = NOW()
			WHERE id = ?`, id)
		if err != nil {
			log.Println("update product error:", err)
		}
		// store into items-like columns if present
		_, _ = database.DB.Exec(`UPDATE items SET approx_value_points = ?, approx_value_usd_cents = ? WHERE id = ?`, points, int64(math.Round(usd*100)), id)
	}
	log.Println("Nightly job: RecalculateApproxValues finished at", time.Now())
}

func calculateReward(points int) float64 {
	// fixed: use exported constant from handlers/constants.go
	reward := float64(points) * DollarsPerPoint

	return reward
}
