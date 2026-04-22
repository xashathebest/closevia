//go:build ignore

package routes

import (
	"github.com/gofiber/fiber/v2"
	"github.com/xashathebest/clovia/handlers"
)

// RegisterTradeRoutes registers trade-related HTTP routes.
// Call this from main (after creating app and handler), for example:
//
//	th := handlers.NewTradeHandler()
//	routes.RegisterTradeRoutes(app, th)
func RegisterTradeRoutes(app *fiber.App, th *handlers.TradeHandler) {
	// ...existing code...
	app.Get("/api/trades/:id", th.GetTrade)
	// Ensure the completion endpoint accepts PUT (and POST for compatibility)
	app.Put("/api/trades/:id/complete", th.CompleteTrade)
	app.Post("/api/trades/:id/complete", th.CompleteTrade)
	// ...existing code...
}
