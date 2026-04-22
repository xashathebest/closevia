package services

import (
	"fmt"
	"log"
	"mime/multipart"
	"os"
	"strings"
	"time"
)

// AIAnalysisResult represents the unified response from either Gemini or Groq
type AIAnalysisResult struct {
	Success  bool
	Provider string // "gemini" or "groq"
	Data     *GeminiResponse
	Error    string
	TimeMs   int64
	Retried  bool
}

// AnalyzeProductWithFallback attempts to analyze product images with Gemini first,
// and automatically falls back to Groq if Gemini fails due to rate limits or errors
func AnalyzeProductWithFallback(images []*multipart.FileHeader) (*AIAnalysisResult, error) {
	result := &AIAnalysisResult{}
	startTime := time.Now()

	// Step 1: Try Gemini first (primary provider - fastest)
	log.Printf("🚀 [AI] PRIMARY: Attempting Gemini analysis...")
	geminiResult, geminiErr := GenerateProductDetails(images)
	geminiTimeMs := time.Since(startTime).Milliseconds()

	if geminiErr == nil && geminiResult != nil {
		enrichOtherCategoryExamples(geminiResult)
		normalizeMarketEstimate(geminiResult)

		// ✅ Gemini succeeded - return immediately (fast path)
		result.Success = true
		result.Provider = "gemini"
		result.Data = geminiResult
		result.TimeMs = geminiTimeMs
		result.Retried = false
		log.Printf("✅ [AI] Gemini SUCCESS in %dms (FAST PATH)", geminiTimeMs)
		return result, nil
	}

	// Step 2: Gemini failed - log the error
	if geminiErr != nil {
		log.Printf("⚠️  [AI] Gemini FAILED after %dms: %v", geminiTimeMs, geminiErr)
	}

	// Step 3: Fall back to Groq (backup provider)
	log.Printf("🔄 [AI] FALLBACK: Trying Groq backup provider...")
	groqStartTime := time.Now()
	groqResult, groqErr := AnalyzeProductWithGroq(images)
	groqTimeMs := time.Since(groqStartTime).Milliseconds()
	totalTimeMs := time.Since(startTime).Milliseconds()

	if groqErr == nil && groqResult != nil {
		enrichOtherCategoryExamples(groqResult)
		normalizeMarketEstimate(groqResult)

		// ✅ Groq succeeded
		result.Success = true
		result.Provider = "groq"
		result.Data = groqResult
		result.TimeMs = totalTimeMs
		result.Retried = true
		log.Printf("✅ [AI] Groq FALLBACK SUCCESS in %dms (Total: %dms, Gemini failed: %dms + Groq analysis: %dms)",
			groqTimeMs, totalTimeMs, geminiTimeMs, groqTimeMs)
		return result, nil
	}

	// ❌ Both Gemini AND Groq failed
	result.Success = false
	result.Provider = "none"
	result.TimeMs = totalTimeMs
	result.Error = fmt.Sprintf("Both AI providers failed. Gemini: %v | Groq: %v", geminiErr, groqErr)
	log.Printf("❌ [AI] CRITICAL: Both Gemini and Groq failed after %dms total: %s", totalTimeMs, result.Error)

	return result, fmt.Errorf("AI analysis unavailable: %s", result.Error)
}

type marketFloorRule struct {
	Floor    float64
	MaxFloor float64
	Terms    []string
}

var marketFloorRules = []marketFloorRule{
	{Floor: 500, MaxFloor: 900, Terms: []string{"electronics", "phone", "smartphone", "tablet", "laptop", "computer", "camera", "appliance", "monitor", "keyboard", "console", "game device", "earbuds", "headphones", "speaker", "printer", "smartwatch"}},
	{Floor: 300, MaxFloor: 550, Terms: []string{"helmet", "sports", "bike", "bicycle", "motorcycle", "tool", "power tool", "bag", "backpack", "luggage"}},
	{Floor: 220, MaxFloor: 450, Terms: []string{"fashion", "shoes", "sneakers", "boots", "jacket", "dress", "pants", "branded", "clothing", "wallet"}},
	{Floor: 150, MaxFloor: 350, Terms: []string{"collectible", "collectibles", "toy", "figure", "lego", "model", "board game"}},
	{Floor: 100, MaxFloor: 220, Terms: []string{"book", "books", "textbook", "novel", "manual", "magazine"}},
}

func normalizeMarketEstimate(data *GeminiResponse) {
	if data == nil || data.Prohibited || data.IsProhibited {
		return
	}
	if data.EstimatedValueMin < 0 {
		data.EstimatedValueMin = 0
	}
	if data.EstimatedValueMax < 0 {
		data.EstimatedValueMax = 0
	}
	if data.EstimatedValueMax > 0 && data.EstimatedValueMin > data.EstimatedValueMax {
		data.EstimatedValueMin, data.EstimatedValueMax = data.EstimatedValueMax, data.EstimatedValueMin
	}

	text := strings.ToLower(strings.Join([]string{
		data.Category,
		data.Subcategory,
		data.ItemType,
		data.Brand,
		data.Title,
		data.Description,
	}, " "))
	if isClearlyLowValue(text) {
		return
	}

	floor, maxFloor := estimateFloorForText(text)
	if floor <= 0 {
		return
	}
	if data.EstimatedValueMax == 0 && hasIdentifiableProductDetails(data) {
		data.EstimatedValueMin = floor
		data.EstimatedValueMax = maxFloor
		appendPriceReasoning(data, "AI returned no usable market estimate, so a conservative category-aware PHP resale range was applied.")
		return
	}
	if data.EstimatedValueMax > 0 && data.EstimatedValueMax < floor {
		originalMin := data.EstimatedValueMin
		originalMax := data.EstimatedValueMax
		data.EstimatedValueMin = floor
		data.EstimatedValueMax = maxFloor
		appendPriceReasoning(data, fmt.Sprintf("Initial AI estimate (PHP %.0f-%.0f) was below normal local resale ranges for this item type, so it was adjusted to a conservative category-aware range.", originalMin, originalMax))
		return
	}
	if data.EstimatedValueMin > 0 && data.EstimatedValueMin < floor && data.EstimatedValueMax >= floor {
		data.EstimatedValueMin = floor
		appendPriceReasoning(data, "Minimum estimate was raised to avoid an unrealistic lowball for this category.")
	}
}

func estimateFloorForText(text string) (float64, float64) {
	for _, rule := range marketFloorRules {
		for _, term := range rule.Terms {
			if strings.Contains(text, term) {
				return rule.Floor, rule.MaxFloor
			}
		}
	}
	return 0, 0
}

func hasIdentifiableProductDetails(data *GeminiResponse) bool {
	if data == nil || data.IsNonProductImage {
		return false
	}
	identifyingText := strings.TrimSpace(strings.Join([]string{
		data.Title,
		data.ItemType,
		data.Subcategory,
		data.Brand,
	}, " "))
	return identifyingText != ""
}

func isClearlyLowValue(text string) bool {
	lowValueTerms := []string{
		"sticker", "paper", "scrap", "damaged", "broken", "for parts", "parts only",
		"freebie", "pamphlet", "flyer", "sample", "accessory only", "case only",
		"cable only", "small accessory",
	}
	for _, term := range lowValueTerms {
		if strings.Contains(text, term) {
			return true
		}
	}
	return false
}

func appendPriceReasoning(data *GeminiResponse, note string) {
	if data.PriceReasoning == "" {
		data.PriceReasoning = note
		return
	}
	if !strings.Contains(data.PriceReasoning, note) {
		data.PriceReasoning = strings.TrimSpace(data.PriceReasoning) + " " + note
	}
}

func enrichOtherCategoryExamples(data *GeminiResponse) {
	if data == nil {
		return
	}

	if normalizeCategory(data.Category) != "other" {
		return
	}

	// If the AI left subcategory/item_type blank (or set them to "Other"),
	// fill them with a helpful example so the UI doesn't show "—".
	title := strings.ToLower(data.Title)
	description := strings.ToLower(data.Description)
	text := title + " " + description

	plantKeywords := []string{
		"plant", "plants",
		"flower", "flowers",
		"seed", "seeds",
		"succulent",
		"cactus",
		"bonsai",
		"potted", "pot",
		"soil",
		"garden",
		"tree", "trees",
		"hydroponic",
		"sprout", "sprouts",
	}

	example := "Others"
	for _, kw := range plantKeywords {
		if kw != "" && strings.Contains(text, kw) {
			example = "Plants"
			break
		}
	}

	if isBlankOrOther(data.ItemType) {
		data.ItemType = example
	}
	if isBlankOrOther(data.Subcategory) {
		data.Subcategory = example
	}
}

func normalizeCategory(s string) string {
	return strings.ToLower(strings.TrimSpace(s))
}

func isBlankOrOther(s string) bool {
	t := strings.TrimSpace(s)
	if t == "" {
		return true
	}
	lower := strings.ToLower(t)
	return lower == "other" || lower == "others"
}

// GetActiveAIProvider returns which AI provider is currently available
func GetActiveAIProvider() string {
	// Try Gemini first
	if isGeminiAvailable() {
		return "gemini"
	}
	// Fallback to Groq
	if isGroqAvailable() {
		return "groq"
	}
	return "none"
}

func isGeminiAvailable() bool {
	// Actual availability is tested during analysis.
	return len(configuredGeminiAPIKeys()) > 0
}

func isGroqAvailable() bool {
	// Check if GROQ_API_KEY is set and not empty
	// This is a simple check; actual availability is tested during analysis
	return os.Getenv("GROQ_API_KEY") != ""
}
