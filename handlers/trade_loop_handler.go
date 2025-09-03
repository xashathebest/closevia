package handlers

import (
	"net/http"

	"github.com/gofiber/fiber/v2"
)

type LoopSuggestRequest struct {
	UserID            int64   `json:"user_id"`
	WantedItemIDs     []int64 `json:"wanted_item_ids"`
	OfferedItemIDs    []int64 `json:"offered_item_ids"`
	MaxDistanceKm     int64   `json:"max_distance_km"`
	ValueTolerancePct int64   `json:"value_tolerance_pct"`
}

type LoopNode struct {
	UserID int64 `json:"user_id"`
	ItemID int64 `json:"item_id"`
}

type LoopSuggestion struct {
	LoopSize int        `json:"loop_size"`
	Nodes    []LoopNode `json:"nodes"`
}

type LoopSuggestResponse struct {
	Suggestions []LoopSuggestion `json:"suggestions"`
}

// NewTradeLoopHandler constructs the handler
func NewTradeLoopHandler() *TradeLoopHandler { return &TradeLoopHandler{} }

type TradeLoopHandler struct{}

// Suggest finds simple 3-way loops from the provided context.
// This is a placeholder algorithm with mocked data to demonstrate API shape.
func (h *TradeLoopHandler) Suggest(c *fiber.Ctx) error {
	var req LoopSuggestRequest
	if err := c.BodyParser(&req); err != nil {
		return c.Status(http.StatusBadRequest).JSON(fiber.Map{"error": "invalid_request"})
	}

	// In production: build a graph from DB matching wanted/offered across users with constraints.
	// For now, return at most one synthetic 3-way loop if there are at least 3 items overall.
	count := len(req.WantedItemIDs) + len(req.OfferedItemIDs)
	if count < 3 {
		return c.JSON(LoopSuggestResponse{Suggestions: []LoopSuggestion{}})
	}

	sugg := LoopSuggestion{
		LoopSize: 3,
		Nodes: []LoopNode{
			{UserID: req.UserID, ItemID: safeGet(req.OfferedItemIDs, 0)},
			{UserID: req.UserID + 1, ItemID: 1001},
			{UserID: req.UserID + 2, ItemID: safeGet(req.WantedItemIDs, 0)},
		},
	}
	return c.JSON(LoopSuggestResponse{Suggestions: []LoopSuggestion{sugg}})
}

func safeGet(arr []int64, idx int) int64 {
	if len(arr) > idx {
		return arr[idx]
	}
	return 0
}
