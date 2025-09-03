package handlers

import (
	"math"
	"net/http"

	"github.com/gofiber/fiber/v2"
)

type ValuationPreviewRequest struct {
	MarketPriceCents int64             `json:"market_price_cents"`
	CategoryID       int64             `json:"category_id"`
	Condition        string            `json:"condition"`
	Signals          *ValuationSignals `json:"signals"`
}

type ValuationSignals struct {
	Views       int64 `json:"views"`
	Saves       int64 `json:"saves"`
	Messages    int64 `json:"messages"`
	TradeOffers int64 `json:"trade_offers"`
}

type ValuationPreviewResponse struct {
	ApproxPoints  int64              `json:"approx_points"`
	ApproxCashPHP float64            `json:"approx_cash_php"`
	Confidence    float64            `json:"confidence"`
	Breakdown     map[string]float64 `json:"breakdown"`
}

// NewValuationHandler creates a handler for valuation routes
func NewValuationHandler() *ValuationHandler {
	return &ValuationHandler{}
}

type ValuationHandler struct{}

// simple in-memory multipliers; in production load from DB
var conditionMultipliers = map[string]float64{
	"NEW":          1.00,
	"LIKE_NEW":     0.85,
	"USED":         0.65,
	"HEAVILY_USED": 0.45,
	"DEFECTIVE":    0.20,
}

// category defaults; 1.0 baseline
func defaultCategoryMultiplier(categoryID int64) float64 { return 1.0 }

// demand factor from signals
func demandFactor(sig *ValuationSignals) float64 {
	if sig == nil {
		return 1.0
	}
	// Weight saves/messages higher than views
	score := float64(sig.Views)*0.0005 + float64(sig.Saves)*0.01 + float64(sig.Messages)*0.02 + float64(sig.TradeOffers)*0.03
	f := 0.8 + score
	if f < 0.7 {
		f = 0.7
	}
	if f > 1.3 {
		f = 1.3
	}
	return f
}

// confidence based on presence of price and signal volume
func confidence(marketPriceCents int64, sig *ValuationSignals) float64 {
	conf := 0.4
	if marketPriceCents > 0 {
		conf += 0.4
	}
	var vol float64
	if sig != nil {
		vol = math.Min(1.0, (float64(sig.Views)+3*float64(sig.Saves)+4*float64(sig.Messages))/500.0)
	}
	conf += 0.2 * vol
	if conf > 1.0 {
		conf = 1.0
	}
	return conf
}

// point_to_php_rate: e.g., 1000 points ~= ₱25 => pesos per point
const pesosPerPoint = 0.025

func (h *ValuationHandler) Preview(c *fiber.Ctx) error {
	var req ValuationPreviewRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "invalid_request"})
	}

	condMult, ok := conditionMultipliers[req.Condition]
	if !ok {
		condMult = 0.65
	}
	catMult := defaultCategoryMultiplier(req.CategoryID)
	demMult := demandFactor(req.Signals)

	// base points from market price
	basePoints := int64(0)
	if req.MarketPriceCents > 0 {
		php := float64(req.MarketPriceCents) / 100.0
		basePoints = int64(math.Round(php / pesosPerPoint))
	} else {
		// fallback baseline
		basePoints = 2000
	}

	points := int64(math.Round(float64(basePoints) * condMult * catMult * demMult))
	php := float64(points) * pesosPerPoint
	conf := confidence(req.MarketPriceCents, req.Signals)

	resp := ValuationPreviewResponse{
		ApproxPoints:  points,
		ApproxCashPHP: math.Round(php*100) / 100,
		Confidence:    math.Round(conf*100) / 100,
		Breakdown: map[string]float64{
			"condition_multiplier": condMult,
			"category_multiplier":  catMult,
			"demand_multiplier":    math.Round(demMult*100) / 100,
		},
	}
	return c.JSON(resp)
}
