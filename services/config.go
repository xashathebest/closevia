package services

import (
	"fmt"
	"os"
	"strings"
)

type ConfigValidationResult struct {
	Warnings []string `json:"warnings,omitempty"`
	Errors   []string `json:"errors,omitempty"`
	AppEnv   string   `json:"app_env"`
}

func ValidateStartupConfig() ConfigValidationResult {
	appEnv := strings.ToLower(strings.TrimSpace(os.Getenv("APP_ENV")))
	if appEnv == "" {
		appEnv = strings.ToLower(strings.TrimSpace(os.Getenv("GO_ENV")))
	}
	if appEnv == "" {
		appEnv = "local"
	}
	result := ConfigValidationResult{AppEnv: appEnv}
	required := []string{"DB_HOST", "DB_PORT", "DB_USER", "DB_NAME", "JWT_SECRET", "FRONTEND_URL"}
	for _, key := range required {
		if strings.TrimSpace(os.Getenv(key)) == "" {
			msg := fmt.Sprintf("%s is not set", key)
			if appEnv == "production" {
				result.Errors = append(result.Errors, msg)
			} else {
				result.Warnings = append(result.Warnings, msg)
			}
		}
	}
	if appEnv == "production" && strings.Contains(os.Getenv("JWT_SECRET"), "change-this") {
		result.Errors = append(result.Errors, "JWT_SECRET still contains the placeholder production value")
	}
	if appEnv == "production" && strings.TrimSpace(os.Getenv("XENDIT_API_KEY")) == "" {
		result.Errors = append(result.Errors, "XENDIT_API_KEY is required in production")
	}
	if appEnv == "production" && strings.TrimSpace(os.Getenv("XENDIT_WEBHOOK_TOKEN")) == "" {
		result.Errors = append(result.Errors, "XENDIT_WEBHOOK_TOKEN is required in production")
	}

	if strings.TrimSpace(os.Getenv("DB_CA_CERT")) != "" && strings.TrimSpace(os.Getenv("DB_PASSWORD")) == "" {
		msg := "DB_PASSWORD is required when DB_CA_CERT is set"
		if appEnv == "production" {
			result.Errors = append(result.Errors, msg)
		} else {
			result.Warnings = append(result.Warnings, msg)
		}
	}
	if strings.TrimSpace(os.Getenv("UPLOAD_PATH")) == "" {
		result.Warnings = append(result.Warnings, "UPLOAD_PATH is not set; defaulting to ./uploads")
	}
	if GetActiveAIProvider() == "none" {
		result.Warnings = append(result.Warnings, "no AI provider key configured; set GEMINI_API_KEY_PRIMARY, GEMINI_API_KEY, or GROQ_API_KEY")
	}

	for _, warning := range result.Warnings {
		Logger().Warn("startup config warning", "service", "config", "warning", warning)
	}
	for _, errMsg := range result.Errors {
		Logger().Error("startup config error", "service", "config", "error", errMsg)
	}
	return result
}
