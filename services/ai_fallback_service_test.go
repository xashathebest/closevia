package services

import "testing"

func TestNormalizeMarketEstimateRaisesSuspiciousLowElectronics(t *testing.T) {
	result := &GeminiResponse{
		Title:             "Bluetooth Speaker",
		Category:          "Electronics",
		ItemType:          "Speaker",
		Condition:         "Good",
		EstimatedValueMin: 20,
		EstimatedValueMax: 50,
	}

	normalizeMarketEstimate(result)

	if result.EstimatedValueMin < 500 || result.EstimatedValueMax < result.EstimatedValueMin {
		t.Fatalf("expected electronics estimate to be raised, got %.0f-%.0f", result.EstimatedValueMin, result.EstimatedValueMax)
	}
	if result.PriceReasoning == "" {
		t.Fatal("expected price reasoning to explain the adjustment")
	}
}

func TestNormalizeMarketEstimateAllowsClearlyCheapItems(t *testing.T) {
	result := &GeminiResponse{
		Title:             "Sticker Pack",
		Category:          "General",
		ItemType:          "Small accessory",
		Condition:         "Good",
		EstimatedValueMin: 20,
		EstimatedValueMax: 50,
	}

	normalizeMarketEstimate(result)

	if result.EstimatedValueMin != 20 || result.EstimatedValueMax != 50 {
		t.Fatalf("expected cheap accessory estimate to remain low, got %.0f-%.0f", result.EstimatedValueMin, result.EstimatedValueMax)
	}
}

func TestNormalizeMarketEstimateAppliesFloorWhenRecognizableItemHasNoEstimate(t *testing.T) {
	result := &GeminiResponse{
		Title:             "Used Bluetooth Speaker",
		Category:          "Electronics",
		ItemType:          "Speaker",
		EstimatedValueMin: 0,
		EstimatedValueMax: 0,
	}

	normalizeMarketEstimate(result)

	if result.EstimatedValueMin < 500 || result.EstimatedValueMax < result.EstimatedValueMin {
		t.Fatalf("recognizable electronics with empty estimate should receive floor, got %.0f-%.0f", result.EstimatedValueMin, result.EstimatedValueMax)
	}
	if result.PriceReasoning == "" {
		t.Fatal("expected price reasoning for adjusted estimate")
	}
}

func TestConfiguredGeminiAPIKeysOrderAndDedupes(t *testing.T) {
	t.Setenv("GEMINI_API_KEY_PRIMARY", " primary-key ")
	t.Setenv("GEMINI_API_KEY_SECONDARY", "secondary-key")
	t.Setenv("GEMINI_API_KEY", " primary-key ")

	keys := configuredGeminiAPIKeys()
	if len(keys) != 2 {
		t.Fatalf("expected 2 unique keys, got %d", len(keys))
	}
	if keys[0].Name != "GEMINI_API_KEY_PRIMARY" || keys[0].Value != "primary-key" {
		t.Fatalf("unexpected first key: %+v", keys[0])
	}
	if keys[1].Name != "GEMINI_API_KEY_SECONDARY" || keys[1].Value != "secondary-key" {
		t.Fatalf("unexpected second key: %+v", keys[1])
	}
}

func TestConfiguredGeminiAPIKeysFallsBackToLegacyLast(t *testing.T) {
	t.Setenv("GEMINI_API_KEY_PRIMARY", "")
	t.Setenv("GEMINI_API_KEY_SECONDARY", "")
	t.Setenv("GEMINI_API_KEY", "legacy-key")

	keys := configuredGeminiAPIKeys()
	if len(keys) != 1 {
		t.Fatalf("expected legacy fallback key only, got %d", len(keys))
	}
	if keys[0].Name != "GEMINI_API_KEY" || keys[0].Value != "legacy-key" || keys[0].Tier != 3 {
		t.Fatalf("unexpected legacy key config: %+v", keys[0])
	}
}

func TestConfiguredGeminiAPIKeysDoesNotReadFrontendKeys(t *testing.T) {
	t.Setenv("VITE_GEMINI_API_KEY", "do-not-use")
	t.Setenv("GEMINI_API_KEY_PRIMARY", "")
	t.Setenv("GEMINI_API_KEY_SECONDARY", "")
	t.Setenv("GEMINI_API_KEY", "")

	if keys := configuredGeminiAPIKeys(); len(keys) != 0 {
		t.Fatalf("expected no server keys from frontend env vars, got %+v", keys)
	}
}
