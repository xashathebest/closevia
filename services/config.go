package services

import (
	"fmt"
	"os"
	"strings"
)

type ConfigValidationResult struct {
	Warnings []string `json:"warnings,omitempty"`
}

func ValidateStartupConfig() ConfigValidationResult {
	result := ConfigValidationResult{}
	required := []string{"DB_HOST", "DB_PORT", "DB_USER", "DB_NAME", "JWT_SECRET", "FRONTEND_URL"}
	for _, key := range required {
		if strings.TrimSpace(os.Getenv(key)) == "" {
			result.Warnings = append(result.Warnings, fmt.Sprintf("%s is not set", key))
		}
	}

	if strings.TrimSpace(os.Getenv("DB_CA_CERT")) != "" && strings.TrimSpace(os.Getenv("DB_PASSWORD")) == "" {
		result.Warnings = append(result.Warnings, "DB_PASSWORD is required when DB_CA_CERT is set")
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
	return result
}
