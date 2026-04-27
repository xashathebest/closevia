package handlers

import (
	"os"

	"github.com/gofiber/fiber/v2"
	"github.com/xashathebest/clovia/database"
	"github.com/xashathebest/clovia/middleware"
	"github.com/xashathebest/clovia/models"
	"github.com/xashathebest/clovia/services"
)

type PushHandler struct {
	service *services.PushService
}

func NewPushHandler() *PushHandler {
	return &PushHandler{service: services.NewPushService(database.DB)}
}

func (h *PushHandler) GetPublicKey(c *fiber.Ctx) error {
	publicKey := os.Getenv("VAPID_PUBLIC_KEY")
	return c.JSON(models.APIResponse{
		Success: true,
		Data: fiber.Map{
			"enabled":    publicKey != "",
			"public_key": publicKey,
		},
	})
}

func (h *PushHandler) Subscribe(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(fiber.StatusUnauthorized).JSON(models.APIResponse{Success: false, Error: "Missing authentication token"})
	}

	var req struct {
		Endpoint string `json:"endpoint"`
		Keys     struct {
			P256dh string `json:"p256dh"`
			Auth   string `json:"auth"`
		} `json:"keys"`
	}
	if err := c.BodyParser(&req); err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(models.APIResponse{Success: false, Error: "Invalid push subscription"})
	}

	err := h.service.SaveSubscription(userID, services.PushSubscription{
		Endpoint: req.Endpoint,
		P256dh:   req.Keys.P256dh,
		Auth:     req.Keys.Auth,
	})
	if err != nil {
		return c.Status(fiber.StatusBadRequest).JSON(models.APIResponse{Success: false, Error: err.Error()})
	}

	return c.JSON(models.APIResponse{Success: true, Message: "Push subscription saved"})
}

func (h *PushHandler) Unsubscribe(c *fiber.Ctx) error {
	userID, ok := middleware.GetUserIDFromContext(c)
	if !ok {
		return c.Status(fiber.StatusUnauthorized).JSON(models.APIResponse{Success: false, Error: "Missing authentication token"})
	}

	var req struct {
		Endpoint string `json:"endpoint"`
	}
	_ = c.BodyParser(&req)
	if err := h.service.DeleteSubscription(userID, req.Endpoint); err != nil {
		return c.Status(fiber.StatusInternalServerError).JSON(models.APIResponse{Success: false, Error: "Failed to remove push subscription"})
	}
	return c.JSON(models.APIResponse{Success: true, Message: "Push subscription removed"})
}
