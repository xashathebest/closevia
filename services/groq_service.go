package services

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"mime/multipart"
	"net/http"
	"os"
	"strings"
	"time"
)

func AnalyzeProductWithGroq(images []*multipart.FileHeader) (*GeminiResponse, error) {
	// Using Groq API only (primary: llama-4-scout, fallback: llama-4-maverick)
	apiKey := os.Getenv("GROQ_API_KEY")
	if apiKey == "" {
		logMsg := "GROQ_API_KEY environment variable not set - required for Groq API"
		log.Printf("❌ CRITICAL ERROR: %s", logMsg)
		return nil, errors.New(logMsg)
	}

	// Sanitize API key (remove leading/trailing whitespace only)
	apiKey = strings.TrimSpace(apiKey)
	if apiKey == "" {
		logMsg := "GROQ_API_KEY is empty after trimming whitespace"
		log.Printf("❌ CRITICAL ERROR: %s", logMsg)
		return nil, errors.New(logMsg)
	}

	log.Printf("Using Groq API for product analysis (GROQ_API_KEY configured)")

	if len(images) < 1 {
		return nil, errors.New("at least 1 image required")
	}

	// Convert images to base64 (limit to 3 to avoid token limits)
	var imageBase64s []string
	for i, img := range images {
		if i >= 3 {
			log.Printf("Limiting to first 3 images (received %d total)", len(images))
			break
		}
		file, err := img.Open()
		if err != nil {
			log.Printf("Error opening image: %v", err)
			continue
		}

		data, err := io.ReadAll(file)
		file.Close() // Close immediately after reading
		if err != nil {
			log.Printf("Error reading image: %v", err)
			continue
		}

		log.Printf("Image info: filename=%s, size=%d bytes", img.Filename, len(data))

		// Detect MIME type
		mimeType := http.DetectContentType(data)
		if !strings.HasPrefix(mimeType, "image/") {
			fileName := strings.ToLower(img.Filename)
			switch {
			case strings.Contains(fileName, ".jpg") || strings.Contains(fileName, ".jpeg"):
				mimeType = "image/jpeg"
			case strings.Contains(fileName, ".png"):
				mimeType = "image/png"
			}
		}

		imageBase64 := base64.StdEncoding.EncodeToString(data)
		log.Printf("Image encoded to base64, size: %d bytes (MIME: %s)", len(imageBase64), mimeType)
		imageBase64s = append(imageBase64s, imageBase64)
	}

	if len(imageBase64s) == 0 {
		return nil, errors.New("failed to process images")
	}

	// Prepare prompt - SAFETY CHECKS ARE ABSOLUTE PRIORITY
	prompt := `⚠️ MANDATORY SAFETY CHECK - HIGHEST PRIORITY ACTION ⚠️

YOU MUST check for prohibited items FIRST, before doing ANYTHING ELSE.
This takes absolute priority over product analysis.

PROHIBITED ITEMS - BLOCK IMMEDIATELY IF DETECTED:
- Firearms: handguns, pistols, revolvers, rifles, shotguns, guns, ammunition, ammo, explosives, bombs, grenades, bullets, cartridges
- Weapons: knives, blades, swords, tasers, taser, brass knuckles, clubs, batons, spears, maces, axes
- Drugs: pills, syringes, syringe, cocaine, heroin, cannabis, marijuana, weed, methamphetamine, meth, fentanyl, powder, powder drugs, pills, tablets
- Alcohol: beer, wine, liquor, spirits, vodka, whiskey, rum, tequila, gin, alcohol bottles, wine bottles
- Counterfeit: fake, counterfeit, replica, knockoff, pirated, bootleg
- Adult content: sexual, adult, explicit, nude, nudity, sexual content
- People/Faces: person, face, human face, people, body, human

IF YOU DETECT ANY PROHIBITED ITEM:
⚠️ STOP IMMEDIATELY ⚠️
Do NOT analyze the product. Do NOT return title, description, value, condition, category, or ANY other field.
Return ONLY this JSON structure - nothing else:
{
  "prohibited": true,
  "reason": "This item can't be listed. Firearms and weapons are not allowed on this platform."
}

EXAMPLES OF CORRECT REJECTION RESPONSES:
- For handgun: {"prohibited": true, "reason": "This item can't be listed. Firearms and weapons are not allowed on this platform."}
- For knife: {"prohibited": true, "reason": "This item can't be listed. Weapons are not allowed on this platform."}
- For alcohol: {"prohibited": true, "reason": "This item can't be listed. Drugs and alcohol are not allowed on this platform."}
- For person: {"prohibited": true, "reason": "Please upload a photo of the item only. Photos containing people are not allowed for privacy reasons."}

⚠️ CRITICAL: If the image shows ANY of the prohibited items above, you MUST return only the rejection JSON.
⚠️ DO NOT try to analyze, describe, or provide any information about prohibited items.
⚠️ Returning product details for a prohibited item is a FAILURE - do not do this.

---

ONLY IF the image is COMPLETELY SAFE (no prohibited items):
Proceed with product analysis. Return this JSON structure:
{
  "prohibited": false,
  "title": "product name (max 25 chars)",
  "description": "detailed description",
  "condition": "New/Like-New/Good/Used/For Parts",
  "category": "product category",
  "subcategory": "specific subcategory like Smartphone, Sneakers, etc.",
  "item_type": "type of item",
  "brand": "brand name if visible",
  "authenticity_risks": "Low/Medium/High",
  "estimated_value_min": minimum_price,
  "estimated_value_max": maximum_price,
  "price_reasoning": "Briefly explain why this PHP resale estimate is realistic using item type, brand/model, condition, visible quality, rarity, demand, and local Philippine marketplace prices.",
  "tags": ["tag1", "tag2", "tag3"],
  "is_prohibited": false,
  "prohibited_reason": "",
  "contains_person": false,
  "person_warning": "",
  "is_suspicious_image": false,
  "suspicious_reason": "",
  "is_blurry_or_dark": false,
  "quality_warning": "",
  "is_non_product_image": false,
  "non_product_reason": "",
  "appears_online": false,
  "online_image_reason": ""
}

If "category" is "Other", you MUST still fill "subcategory" and "item_type" with a helpful short example based on the product image.
Use "Plants" when it looks like plants (plant pots, succulents, flowers, seeds, etc.), otherwise use "Others".

IMPORTANT - IMAGE QUALITY DETECTION (check carefully):
1. BLURRY/DARK: Set is_blurry_or_dark=true if the photo is noticeably blurry, out of focus, too dark (underexposed), or too bright (overexposed). Provide quality_warning with a specific reason.
2. SUSPICIOUS IMAGE: Set is_suspicious_image=true if the image looks like:
   - A screenshot from a website, app, or social media
   - A stock photo, marketing image, or catalog photo (perfect studio lighting, white background, multiple angles composited)
   - An image with visible watermarks, logos from other platforms, or text overlays
   - A photo taken of a screen/monitor showing another image
   Give the reason in suspicious_reason.
3. NON-PRODUCT IMAGE: Set is_non_product_image=true if the image is NOT a photo of a physical product, e.g.:
   - Memes, jokes, text-only images, collages
   - Screenshots of apps, games, or conversations
   - Random scenery, selfies, or unrelated content
   Give the reason in non_product_reason.
4. APPEARS ONLINE: Set appears_online=true if the image appears to be taken from an online source rather than an original photo. Indicators include:
   - Visible watermarks (Shutterstock, Getty, AliExpress, Amazon, etc.)
   - Perfect product placement typical of e-commerce listings
   - Marketing text or price tags from other platforms visible in the image
   - Compression artifacts typical of images downloaded and re-uploaded multiple times
   Give the reason in online_image_reason.

PRICE ESTIMATE RULES:
- Estimate realistic resale value in Philippine Pesos (PHP), not cents, points, or USD.
- Identify exact product type first, then brand/model if visible.
- Consider condition, visible wear, completeness/accessories, rarity, local demand, and visible quality.
- Do NOT lowball to 20-50 PHP unless the item is truly a tiny low-value accessory, scrap, paper, sticker, broken part, or cannot be identified as a sellable product.
- Category sanity floors for normal usable items:
  * Books: usually at least 80-150 PHP unless damaged/common pamphlet.
  * Helmets, sports gear, bags, shoes, branded clothing: usually at least 150-300 PHP.
  * Electronics, phones, computers, appliances, cameras, game devices: usually at least 500-1000 PHP, often higher by brand/model.
  * Collectibles and toys: usually at least 100-250 PHP unless clearly cheap/common.
- If uncertain, give a wider range above the category floor and explain uncertainty in price_reasoning.

Remember: SAFETY IS THE HIGHEST PRIORITY. Check for prohibited items first. If found, return ONLY the rejection JSON.`

	// Call Groq API with vision model (with fallback and retry logic)
	models := []string{
		"meta-llama/llama-4-scout-17b-16e-instruct", // primary vision model
	}

	// Retry logic - max 3 attempts total
	maxRetries := 3
	var lastErr error
	for attempt := 0; attempt < maxRetries; attempt++ {
		// Add exponential backoff between retries (but not before first attempt)
		if attempt > 0 {
			waitTime := time.Duration(1<<uint(attempt)) * time.Second // 2s, 4s, 8s...
			log.Printf("Rate limit detected. Waiting %v before retry attempt %d/%d...", waitTime, attempt+1, maxRetries)
			time.Sleep(waitTime)
		}

		for modelIdx, model := range models {
			log.Printf("Groq API: Attempt %d/%d, Model: %s", attempt+1, maxRetries, model)

			// Build content array with prompt + all images
			contentParts := []map[string]interface{}{
				{
					"type": "text",
					"text": prompt,
				},
			}

			// Add all images to content
			for _, imageBase64 := range imageBase64s {
				contentParts = append(contentParts, map[string]interface{}{
					"type": "image_url",
					"image_url": map[string]string{
						"url": "data:image/jpeg;base64," + imageBase64,
					},
				})
			}

			payload := map[string]interface{}{
				"model": model,
				"messages": []map[string]interface{}{
					{
						"role":    "user",
						"content": contentParts,
					},
				},
				"temperature":           0.2,
				"max_completion_tokens": 1024,
				"response_format": map[string]string{
					"type": "json_object",
				},
			}

			jsonData, err := json.Marshal(payload)
			if err != nil {
				log.Printf("Error marshaling Groq payload: %v", err)
				lastErr = fmt.Errorf("failed to marshal request: %v", err)
				continue
			}

			// Make request to Groq API
			url := "https://api.groq.com/openai/v1/chat/completions"
			req, err := http.NewRequest("POST", url, bytes.NewBuffer(jsonData))
			if err != nil {
				log.Printf("Error creating Groq request: %v", err)
				lastErr = err
				if modelIdx == len(models)-1 {
					break // Exit model loop to try next retry attempt
				}
				continue
			}

			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Authorization", "Bearer "+apiKey)

			client := &http.Client{Timeout: 45 * time.Second}
			resp, err := client.Do(req)
			if err != nil {
				log.Printf("Error making request to Groq API: %v", err)
				lastErr = err
				if modelIdx == len(models)-1 {
					break
				}
				continue
			}
			defer resp.Body.Close()

			body, _ := io.ReadAll(resp.Body)

			log.Printf("Groq API response status: %d", resp.StatusCode)

			if resp.StatusCode != http.StatusOK {
				log.Printf("Groq API error response: %s", string(body))
				if resp.StatusCode == 429 {
					// Rate limited - both models share the same quota, so break model loop
					// and wait before next retry attempt
					lastErr = fmt.Errorf("rate-limit: %s", string(body))
					log.Printf("Rate limit detected - will retry with backoff")
					break // Exit model loop to let backoff logic handle retry
				}
				if resp.StatusCode == 404 {
					lastErr = fmt.Errorf("model %s: not found", model)
					if modelIdx == len(models)-1 {
						break
					}
					continue
				}
				lastErr = fmt.Errorf("Groq API error (status %d)", resp.StatusCode)
				if modelIdx == len(models)-1 {
					break
				}
				continue
			}

			var groqResp struct {
				Choices []struct {
					Message struct {
						Content string `json:"content"`
					} `json:"message"`
				} `json:"choices"`
				Error struct {
					Message string `json:"message"`
					Code    string `json:"code"`
				} `json:"error"`
			}

			if err := json.Unmarshal(body, &groqResp); err != nil {
				log.Printf("Error unmarshaling Groq response: %v", err)
				lastErr = fmt.Errorf("failed to parse Groq response")
				if modelIdx == len(models)-1 {
					break
				}
				continue
			}

			// Check for API errors
			if groqResp.Error.Message != "" {
				log.Printf("Groq API returned error: %s (code: %s)", groqResp.Error.Message, groqResp.Error.Code)
				// Check if it's a rate limit error
				if groqResp.Error.Code == "rate_limit_exceeded" || strings.Contains(strings.ToLower(groqResp.Error.Message), "rate limit") {
					log.Printf("Rate limit detected in response - will retry with backoff")
					break // Exit model loop, let backoff retry handle it
				}
				lastErr = fmt.Errorf("Groq API error: %s", groqResp.Error.Message)
				if modelIdx == len(models)-1 {
					break
				}
				continue
			}

			if len(groqResp.Choices) == 0 {
				lastErr = errors.New("no response from Groq API")
				if modelIdx == len(models)-1 {
					break
				}
				continue
			}

			// Parse the JSON response from Groq
			responseText := groqResp.Choices[0].Message.Content
			log.Printf("Successfully received response from Groq model: %s", model)

			// Remove markdown code blocks if present
			responseText = strings.TrimPrefix(responseText, "```json\n")
			responseText = strings.TrimPrefix(responseText, "```\n")
			responseText = strings.TrimSuffix(responseText, "\n```")
			responseText = strings.TrimSuffix(responseText, "```")

			// Strip any prose prefix/suffix by locking to the outermost braces.
			if start := strings.Index(responseText, "{"); start >= 0 {
				if end := strings.LastIndex(responseText, "}"); end > start {
					responseText = responseText[start : end+1]
				}
			}

			var result GeminiResponse
			if err := json.Unmarshal([]byte(responseText), &result); err != nil {
				log.Printf("Error parsing Groq JSON response: %v", err)
				lastErr = fmt.Errorf("failed to parse response")
				if modelIdx == len(models)-1 {
					break
				}
				continue
			}

			// CRITICAL: Validate response for safety violations
			// If the AI returned product details for a prohibited item, override and reject it
			if violatesProhibition(&result) {
				log.Printf("⚠️ SAFETY VIOLATION: AI returned product analysis for prohibited item! Forcing rejection.")
				return &GeminiResponse{
					Prohibited: true,
					Reason:     "This item can't be listed. Weapons and firearms are not allowed on this platform.",
				}, nil
			}

			log.Printf("Successfully analyzed product with model %s: %s (Category: %s)", model, result.Title, result.Category)
			return &result, nil
		}
	}

	// All retries and models failed - return error with details
	failMsg := fmt.Sprintf("Groq API analysis failed after %d attempts", maxRetries)
	if lastErr != nil {
		failMsg = fmt.Sprintf("%s: %v", failMsg, lastErr)
		log.Printf("❌ %s", failMsg)
	} else {
		log.Printf("❌ %s (no specific error captured)", failMsg)
	}
	return nil, errors.New(failMsg)
}
