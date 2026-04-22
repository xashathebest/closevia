package services

import (
	"database/sql"
	"encoding/json"
	"log"
	"math"
	"sort"
	"strconv"
	"strings"

	"github.com/xashathebest/clovia/models"
)

// TradeEdge represents a directed edge in the trade graph.
// It signifies that `FromUser` has proposed a trade to `ToUser`.
type TradeEdge struct {
	FromUser int
	ToUser   int
	TradeID  int
}

// TradeGraph represents the graph of active trade proposals.
type TradeGraph struct {
	Edges []TradeEdge
	Nodes map[int]bool
}

// NewTradeGraph creates a new trade graph from the database.
func NewTradeGraph(db *sql.DB) (*TradeGraph, error) {
	graph := &TradeGraph{
		Edges: make([]TradeEdge, 0),
		Nodes: make(map[int]bool),
	}

	rows, err := db.Query(`
		SELECT t.id, t.buyer_id, t.seller_id
		FROM trades t
		JOIN users ub ON ub.id = t.buyer_id
		JOIN users us ON us.id = t.seller_id
		JOIN products pt ON pt.id = t.target_product_id
		WHERE t.status IN ('pending', 'pending_multiway')
		  AND ub.role != 'admin'
		  AND us.role != 'admin'
		  AND pt.status = 'available'
		  AND pt.created_at >= DATE_SUB(NOW(), INTERVAL 3 MONTH)
		  AND t.created_at >= DATE_SUB(NOW(), INTERVAL 3 MONTH)
		  AND NOT EXISTS (
		    SELECT 1 FROM trade_items ti
		    JOIN products tip ON tip.id = ti.product_id
		    WHERE ti.trade_id = t.id AND tip.status NOT IN ('available', 'locked')
		  )
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	for rows.Next() {
		var trade models.Trade
		if err := rows.Scan(&trade.ID, &trade.BuyerID, &trade.SellerID); err != nil {
			log.Printf("Error scanning trade row: %v", err)
			continue
		}

		edge := TradeEdge{
			FromUser: trade.BuyerID,
			ToUser:   trade.SellerID,
			TradeID:  trade.ID,
		}
		graph.Edges = append(graph.Edges, edge)
		graph.Nodes[trade.BuyerID] = true
		graph.Nodes[trade.SellerID] = true
	}

	return graph, nil
}

// MaxChainLength is the maximum number of parties in a multi-way trade chain.
// Multiway trades support circular loops from 3 through 5 participants.
const MaxChainLength = 5

// FindTradeLoops detects cycles in the trade graph and returns them.
// A loop is a path of trades that starts and ends at the same user.
// Chains are capped at MaxChainLength parties to keep coordination manageable.
func (g *TradeGraph) FindTradeLoops() [][]TradeEdge {
	// Adjacency list representation of the graph
	adj := make(map[int][]TradeEdge)
	for _, edge := range g.Edges {
		adj[edge.FromUser] = append(adj[edge.FromUser], edge)
	}

	var loops [][]TradeEdge
	seen := make(map[string]bool)
	for startNode := range g.Nodes {
		path := []TradeEdge{}
		visited := make(map[int]bool)
		g.dfs(startNode, startNode, adj, &path, &visited, &loops, seen, 0)
	}

	return loops
}

func canonicalTradeLoopKey(loop []TradeEdge) string {
	tradeIDs := make([]int, 0, len(loop))
	for _, edge := range loop {
		tradeIDs = append(tradeIDs, edge.TradeID)
	}
	sort.Ints(tradeIDs)
	parts := make([]string, len(tradeIDs))
	for i, id := range tradeIDs {
		parts[i] = strconv.Itoa(id)
	}
	return strings.Join(parts, "_")
}

// dfs is a helper function to perform a depth-first search for cycles.
// depth tracks how many edges deep we are; we stop exploring beyond MaxChainLength.
func (g *TradeGraph) dfs(startNode, currentNode int, adj map[int][]TradeEdge, path *[]TradeEdge, visited *map[int]bool, loops *[][]TradeEdge, seen map[string]bool, depth int) {
	(*visited)[currentNode] = true

	for _, edge := range adj[currentNode] {
		// Add edge to the current path
		*path = append(*path, edge)

		if edge.ToUser == startNode {
			// Found a loop — keep it if within the chain length cap
			if len(*path) >= 3 && len(*path) <= MaxChainLength {
				loop := make([]TradeEdge, len(*path))
				copy(loop, *path)
				key := canonicalTradeLoopKey(loop)
				if !seen[key] {
					seen[key] = true
					*loops = append(*loops, loop)
				}
			}
		} else if !(*visited)[edge.ToUser] && depth+1 < MaxChainLength {
			// Continue DFS only if we haven't hit the depth cap
			g.dfs(startNode, edge.ToUser, adj, path, visited, loops, seen, depth+1)
		}

		// Backtrack
		*path = (*path)[:len(*path)-1]
	}

	(*visited)[currentNode] = false
}

// MultiwayMatch represents a potential 3rd party match for multiway trading
type MultiwayMatch struct {
	User3ID           int    `json:"user3_id"`
	User3Name         string `json:"user3_name"`
	User3ProductID    int    `json:"user3_product_id"` // Product User 3 has (that User 2 wants)
	User3ProductTitle string `json:"user3_product_title"`
	User1ProductID    int    `json:"user1_product_id"` // Product from User 1 that User 3 wants
	User1ProductTitle string `json:"user1_product_title"`
	MatchScore        int    `json:"match_score"` // How good the match is (0-100)
}

type MultiwayCandidateDebug struct {
	User3ID           int      `json:"user3_id"`
	User3Name         string   `json:"user3_name"`
	User3ProductID    int      `json:"user3_product_id"`
	User3ProductTitle string   `json:"user3_product_title"`
	OfferedProductID  int      `json:"offered_product_id"`
	OfferedTitle      string   `json:"offered_title"`
	Score             int      `json:"score"`
	PassedThreshold   bool     `json:"passed_threshold"`
	Reasons           []string `json:"reasons"`
}

type MultiwayDebugInfo struct {
	TradeID       int                      `json:"trade_id"`
	Threshold     int                      `json:"threshold"`
	NoMatchReason string                   `json:"no_match_reason,omitempty"`
	Candidates    []MultiwayCandidateDebug `json:"candidates"`
}

// FindMultiwayMatch searches for a User 3 who:
// - Has a product that User 2 wants (matching category/title)
// - Wants something that User 1 has (offered items in the original trade)
func FindMultiwayMatch(db *sql.DB, user1ID, user2ID, originalTradeID int, excludeUserIDs []int) ([]MultiwayMatch, error) {
	matches, _, err := FindMultiwayMatchDetailed(db, user1ID, user2ID, originalTradeID, excludeUserIDs)
	return matches, err
}

func normalizeConditionBucket(raw string) string {
	v := strings.TrimSpace(strings.ToLower(raw))
	switch v {
	case "new", "brand new", "sealed":
		return "new"
	case "like new", "like-new", "excellent":
		return "like_new"
	case "good", "used - good", "used good":
		return "good"
	case "fair", "used - fair", "used fair":
		return "fair"
	default:
		return v
	}
}

// SemanticMatcher checks if two terms match semantically (synonyms, related terms)
func SemanticMatcher(need, have string) bool {
	need = strings.ToLower(strings.TrimSpace(need))
	have = strings.ToLower(strings.TrimSpace(have))

	// Direct match
	if strings.Contains(have, need) || strings.Contains(need, have) {
		return true
	}

	// Semantic equivalents
	equivalents := map[string][]string{
		"ps5":               {"playstation 5", "playstation", "gaming console", "game console", "console"},
		"playstation":       {"ps5", "playstation 5", "gaming console", "game console"},
		"xbox":              {"gaming console", "game console", "console"},
		"gaming console":    {"ps5", "playstation", "xbox", "console", "game"},
		"game console":      {"ps5", "playstation", "xbox", "console", "gaming"},
		"iphone":            {"phone", "mobile", "smartphone", "ios", "apple"},
		"iphone 15":         {"iphone", "phone", "mobile", "smartphone"},
		"iphone 15 pro":     {"iphone", "iphone 15", "phone", "mobile", "smartphone"},
		"iphone 15 pro max": {"iphone", "iphone 15", "phone", "mobile", "smartphone"},
		"phone":             {"iphone", "mobile", "smartphone", "android"},
		"mobile":            {"phone", "iphone", "smartphone", "android"},
		"smartphone":        {"phone", "iphone", "mobile", "android"},
		"macbook":           {"laptop", "notebook", "computer", "mac"},
		"macbook pro":       {"macbook", "laptop", "notebook", "computer", "mac"},
		"macbook air":       {"macbook", "laptop", "notebook", "computer", "mac"},
		"laptop":            {"macbook", "notebook", "computer", "pc"},
		"notebook":          {"laptop", "computer", "macbook", "pc"},
		"camera":            {"dslr", "mirrorless", "photography"},
		"dslr":              {"camera", "mirrorless", "photography"},
		"headphones":        {"earbuds", "audio", "headset", "wireless"},
		"earbuds":           {"headphones", "audio", "wireless"},
		"watch":             {"smartwatch", "wearable", "timepiece"},
		"smartwatch":        {"watch", "wearable", "device"},
		"tablet":            {"ipad", "android tablet", "device"},
		"ipad":              {"tablet", "device", "apple"},
	}

	if synList, exists := equivalents[need]; exists {
		for _, syn := range synList {
			if strings.Contains(have, syn) {
				return true
			}
		}
	}
	if synList, exists := equivalents[have]; exists {
		for _, syn := range synList {
			if strings.Contains(need, syn) {
				return true
			}
		}
	}

	return false
}

func wantedSignalScore(candidateWants, candidateWantedCategories, candidateDesiredProduct, offeredTitle, offeredCategory string) (int, bool) {
	needleTitle := strings.ToLower(strings.TrimSpace(offeredTitle))
	needleCategory := strings.ToLower(strings.TrimSpace(offeredCategory))

	normalizedWantedCat := candidateWantedCategories
	if strings.HasPrefix(strings.TrimSpace(candidateWantedCategories), "[") {
		var arr []string
		if err := json.Unmarshal([]byte(candidateWantedCategories), &arr); err == nil {
			normalizedWantedCat = strings.Join(arr, " ")
		}
	}

	haystack := strings.ToLower(candidateWants + " " + normalizedWantedCat + " " + candidateDesiredProduct)

	// 1. Direct cross-containment (Highest Priority)
	// Example: Title is "Ergonomic Office Chair", Wants is "Office Chair"
	// Example: Title is "Office Chair", Wants is "Ergonomic Office Chair"

	// Check against specific wants clauses
	wantsList := strings.Split(candidateWants, ",")
	if candidateDesiredProduct != "" {
		wantsList = append(wantsList, candidateDesiredProduct)
	}

	for _, want := range wantsList {
		wantStr := strings.ToLower(strings.TrimSpace(want))
		if wantStr == "" || len(wantStr) < 3 {
			continue
		}
		// If the specific want contains the title, or the title contains the specific want
		if strings.Contains(needleTitle, wantStr) || strings.Contains(wantStr, needleTitle) {
			return 30, true
		}
		// Semantic synonym check for the specific want
		if SemanticMatcher(needleTitle, wantStr) {
			return 25, true
		}
	}

	// 2. Keyword Intersection
	// Extract meaningful keywords (>3 chars) from offered title
	offeredKeywords := []string{}
	for _, part := range strings.Split(needleTitle, " ") {
		part = strings.Trim(part, ".,-![]()")
		if len(part) > 2 && part != "test" && part != "the" && part != "and" {
			offeredKeywords = append(offeredKeywords, part)
		}
	}

	// Check if meaningful keyword from title exists in the haystack
	matchedKeywords := 0
	for _, keyword := range offeredKeywords {
		if strings.Contains(haystack, keyword) {
			matchedKeywords++
		}
	}

	// Only score keyword matches if at least a significant portion matches, to avoid "office supplies" matching "office chair"
	if matchedKeywords > 0 {
		if matchedKeywords == len(offeredKeywords) || matchedKeywords >= 2 {
			return 18, true
		} else if len(offeredKeywords) == 1 {
			// Single word title matched
			return 15, true
		}
	}

	// Category match
	if needleCategory != "" && strings.Contains(haystack, needleCategory) {
		return 12, true
	}

	// Semantic match on category
	if needleCategory != "" {
		for _, want := range strings.Split(candidateWantedCategories, ",") {
			if SemanticMatcher(needleCategory, strings.TrimSpace(want)) {
				return 10, true
			}
		}
	}

	return 0, false
}

// FindMultiwayMatchDetailed runs a tolerant scoring-based multi-way matcher.
// Wants text is now a bonus signal, not a hard requirement.
func FindMultiwayMatchDetailed(db *sql.DB, user1ID, user2ID, originalTradeID int, excludeUserIDs []int) ([]MultiwayMatch, MultiwayDebugInfo, error) {
	log.Printf("[FindMultiwayMatch] Starting search. User1=%d, User2=%d, TradeID=%d", user1ID, user2ID, originalTradeID)
	const minScore = 30 // Lowered from 35 with improved semantic matching
	debug := MultiwayDebugInfo{TradeID: originalTradeID, Threshold: minScore, Candidates: []MultiwayCandidateDebug{}}

	// 1. Get what User 1 offered
	rows1, err := db.Query(`
		SELECT p.id, p.title, p.category, COALESCE(p.price, 0), COALESCE(p.`+"`condition`"+`, '')
		FROM trade_items ti
		JOIN products p ON p.id = ti.product_id
		WHERE ti.trade_id = ? AND ti.offered_by = 'buyer'
	`, originalTradeID)
	if err != nil {
		return nil, debug, err
	}
	defer rows1.Close()

	type prod struct {
		ID        int
		Title     string
		Category  string
		Price     float64
		Condition string
	}
	var u1Prods []prod
	for rows1.Next() {
		var p prod
		if err := rows1.Scan(&p.ID, &p.Title, &p.Category, &p.Price, &p.Condition); err == nil {
			u1Prods = append(u1Prods, p)
		}
	}

	if len(u1Prods) == 0 {
		debug.NoMatchReason = "No buyer-offered items were found for this trade."
		return nil, debug, nil
	}

	// 2. Get User 2's target product details and wants
	var targetCat, targetTitle, targetWants, targetWantedCat, targetDesiredProd string
	err = db.QueryRow(`
		SELECT p.category, p.title, COALESCE(p.wants, ''), COALESCE(p.wanted_categories, ''), COALESCE(p.desired_product, '')
		FROM trades t 
		JOIN products p ON p.id = t.target_product_id 
		WHERE t.id = ?
	`, originalTradeID).Scan(&targetCat, &targetTitle, &targetWants, &targetWantedCat, &targetDesiredProd)
	if err != nil {
		return nil, debug, err
	}

	// 3. Build exclude list
	excludeSet := map[int]bool{user1ID: true, user2ID: true}
	for _, id := range excludeUserIDs {
		excludeSet[id] = true
	}

	query := `
		SELECT DISTINCT u.id, u.name, p.id, p.title, COALESCE(p.category, ''), COALESCE(p.price, 0),
		       COALESCE(p.` + "`condition`" + `, ''), COALESCE(p.wants, ''), COALESCE(p.wanted_categories, ''), COALESCE(p.desired_product, '')
		FROM products p
		JOIN users u ON u.id = p.seller_id
		WHERE p.status = 'available'
		  AND u.role != 'admin'
		  AND p.created_at >= DATE_SUB(NOW(), INTERVAL 3 MONTH)
		  AND NOT EXISTS (
		    SELECT 1 FROM trades t
		    WHERE (t.target_product_id = p.id OR t.id IN (
		      SELECT trade_id FROM trade_items WHERE product_id = p.id
		    ))
		    AND t.status IN ('pending', 'pending_multiway', 'accepted', 'active', 'multiway_active')
		  )
	`
	// DB-level pre-filter: narrow candidates to products matching what User2 wants
	var queryArgs []interface{}
	wantsFilter := strings.TrimSpace(targetWants)
	wantedCatFilter := strings.TrimSpace(targetWantedCat)
	desiredProdFilter := strings.TrimSpace(targetDesiredProd)

	// Parse wantedCatFilter: it may be a JSON array like ["Clothing","Accessories"]
	// Extract individual category strings so LIKE clauses work correctly.
	var parsedWantedCats []string
	if wantedCatFilter != "" {
		if strings.HasPrefix(wantedCatFilter, "[") {
			var arr []string
			if err := json.Unmarshal([]byte(wantedCatFilter), &arr); err == nil {
				parsedWantedCats = arr
			}
		}
		if len(parsedWantedCats) == 0 {
			// Not a JSON array — use as-is
			parsedWantedCats = []string{wantedCatFilter}
		}
	}

	if wantsFilter != "" || len(parsedWantedCats) > 0 || desiredProdFilter != "" {
		var orClauses []string
		if wantsFilter != "" {
			// Make SQL matching more flexible by splitting words
			words := strings.Split(wantsFilter, " ")
			var wordClauses []string
			for _, w := range words {
				w = strings.TrimSpace(w)
				if len(w) > 2 {
					wordClauses = append(wordClauses, "LOWER(p.title) LIKE LOWER(?)")
					queryArgs = append(queryArgs, "%"+w+"%")
				}
			}
			if len(wordClauses) > 0 {
				// Require at least one significant word to match at the database level to cast a wider net
				// Strict filtering will happen in Go memory
				orClauses = append(orClauses, "("+strings.Join(wordClauses, " OR ")+")")
			} else {
				orClauses = append(orClauses, "LOWER(p.title) LIKE LOWER(?)")
				queryArgs = append(queryArgs, "%"+wantsFilter+"%")
			}
		}
		for _, cat := range parsedWantedCats {
			cat = strings.TrimSpace(cat)
			if cat != "" {
				orClauses = append(orClauses, "LOWER(p.category) LIKE LOWER(?)")
				queryArgs = append(queryArgs, "%"+cat+"%")
			}
		}
		if desiredProdFilter != "" {
			words := strings.Split(desiredProdFilter, " ")
			var dpClauses []string
			for _, w := range words {
				if len(w) > 2 {
					dpClauses = append(dpClauses, "LOWER(p.title) LIKE LOWER(?)")
					queryArgs = append(queryArgs, "%"+w+"%")
				}
			}
			if len(dpClauses) > 0 {
				orClauses = append(orClauses, "("+strings.Join(dpClauses, " OR ")+")")
			} else {
				orClauses = append(orClauses, "LOWER(p.title) LIKE LOWER(?)")
				queryArgs = append(queryArgs, "%"+desiredProdFilter+"%")
			}
		}
		if len(orClauses) > 0 {
			query += " AND (" + strings.Join(orClauses, " OR ") + ")"
		}
	} else if targetCat != "" {
		// Fallback: if no wants specified, at least match by category
		query += " AND LOWER(p.category) LIKE LOWER(?)"
		queryArgs = append(queryArgs, "%"+targetCat+"%")
	}
	query += " LIMIT 50"
	searchRows, err := db.Query(query, queryArgs...)
	if err != nil {
		return nil, debug, err
	}
	defer searchRows.Close()

	type candidateAgg struct {
		match MultiwayMatch
		score int
	}
	bestByUser3 := map[int]candidateAgg{}

	for searchRows.Next() {
		var user3ID, user3ProductID int
		var user3Name, user3ProductTitle, user3Category, user3Condition, wants, wantedCategories, desiredProduct string
		var user3Price float64
		if err := searchRows.Scan(&user3ID, &user3Name, &user3ProductID, &user3ProductTitle, &user3Category, &user3Price, &user3Condition, &wants, &wantedCategories, &desiredProduct); err != nil {
			continue
		}
		if excludeSet[user3ID] {
			continue
		}

		// STRATEGIC FILTER: Skip User3 if their product doesn't match what User2 wants
		// This prevents bad matches from scoring higher than good ones
		user2WantsMatch := false
		// Normalize targetWantedCat: flatten JSON arrays to space-separated strings
		normalizedTargetWantedCat := targetWantedCat
		if strings.HasPrefix(strings.TrimSpace(targetWantedCat), "[") {
			var arr []string
			if err := json.Unmarshal([]byte(targetWantedCat), &arr); err == nil {
				normalizedTargetWantedCat = strings.Join(arr, " ")
			}
		}
		u2Haystack := strings.ToLower(targetWants + " " + normalizedTargetWantedCat + " " + targetDesiredProd)
		u3TitleLower := strings.ToLower(strings.TrimSpace(user3ProductTitle))
		u3CatLower := strings.ToLower(strings.TrimSpace(user3Category))

		// Extract key words from product title (first 1-2 words usually are the product name)
		// E.g., "PlayStation 5 Console - Test" => extract "PlayStation 5"
		u3KeyWords := []string{}
		titleParts := strings.Split(u3TitleLower, " ")
		for i, part := range titleParts {
			if strings.Contains(part, "-") || strings.Contains(part, "test") {
				break // Skip everything after dash or "test"
			}
			u3KeyWords = append(u3KeyWords, part)
			if i >= 2 { // Limit to first 3 words
				break
			}
		}

		// Check if any key word semantically matches what User2 wants
		for _, keyword := range u3KeyWords {
			if SemanticMatcher(keyword, u2Haystack) {
				user2WantsMatch = true
				break
			}
		}

		// Check if User3's product semantically matches what User2 wants (full title)
		if !user2WantsMatch && SemanticMatcher(u3TitleLower, u2Haystack) {
			user2WantsMatch = true
		}

		// Also check category
		if !user2WantsMatch && SemanticMatcher(u3CatLower, u2Haystack) {
			user2WantsMatch = true
		}

		// Check with robust substring intersection
		// Example: user2 wants "office chair", user3 has "ergonomic office chair"
		for _, want := range strings.Split(targetWants+","+targetDesiredProd, ",") {
			wantStr := strings.TrimSpace(want)
			if wantStr == "" || len(wantStr) < 3 {
				continue
			}
			if strings.Contains(u3TitleLower, wantStr) || strings.Contains(wantStr, u3TitleLower) {
				user2WantsMatch = true
				break
			}
		}

		// Also check with direct string containment (full title and category as fallback)
		if !user2WantsMatch && (strings.Contains(u2Haystack, u3TitleLower) || strings.Contains(u2Haystack, u3CatLower) || strings.Contains(u3TitleLower, u2Haystack)) {
			user2WantsMatch = true
		}

		for _, up := range u1Prods {
			score := 0
			reasons := []string{}

			// If User3's product doesn't match User2's wants, this is not a good match - skip
			if !user2WantsMatch {
				reasons = append(reasons, "USER2 DOESN'T WANT THIS PRODUCT - REJECTED")
				debug.Candidates = append(debug.Candidates, MultiwayCandidateDebug{
					User3ID:           user3ID,
					User3Name:         user3Name,
					User3ProductID:    user3ProductID,
					User3ProductTitle: user3ProductTitle,
					OfferedProductID:  up.ID,
					OfferedTitle:      up.Title,
					Score:             0,
					PassedThreshold:   false,
					Reasons:           reasons,
				})
				continue
			}

			// Check if U3's product semantically matches U2's wants (STRONG SIGNAL)
			// (u2Haystack, u3TitleLower, u3CatLower already set above in strategic filter)
			if SemanticMatcher(u3TitleLower, targetWants) {
				score += 50 // Maximum score for perfect semantic match on wants
				reasons = append(reasons, "[PERFECT] User 3 product semantically matches User 2's explicit wants (+50)")
			} else if u3TitleLower != "" && strings.Contains(u2Haystack, u3TitleLower) {
				score += 35
				reasons = append(reasons, "User 3 title matched what User 2 wants (+35)")
			} else if u3CatLower != "" && strings.Contains(u2Haystack, u3CatLower) {
				score += 20
				reasons = append(reasons, "User 3 category matched what User 2 wants (+20)")
			} else {
				reasons = append(reasons, "User 3 product did not strongly match User 2's explicit wants (+0)")
			}

			if up.Price > 0 && user3Price > 0 {
				delta := math.Abs(user3Price-up.Price) / up.Price
				if delta <= 0.30 {
					score += 25
					reasons = append(reasons, "Price within +/-30% tolerance (+25)")
				} else {
					reasons = append(reasons, "Price outside +/-30% tolerance (+0)")
				}
			} else {
				score += 6
				reasons = append(reasons, "Price missing on one side; neutral tolerance (+6)")
			}

			u1Bucket := normalizeConditionBucket(up.Condition)
			u3Bucket := normalizeConditionBucket(user3Condition)
			if u1Bucket != "" && u3Bucket != "" {
				if (u1Bucket == "new" && u3Bucket == "like_new") || (u1Bucket == "like_new" && u3Bucket == "new") {
					score += 14
					reasons = append(reasons, "Condition compatibility: new/like new (+14)")
				} else if (u1Bucket == "good" && u3Bucket == "fair") || (u1Bucket == "fair" && u3Bucket == "good") {
					score += 12
					reasons = append(reasons, "Condition compatibility: good/fair (+12)")
				} else if u1Bucket == u3Bucket {
					score += 15
					reasons = append(reasons, "Condition matched exactly (+15)")
				} else {
					score += 4
					reasons = append(reasons, "Condition differs but still considered (+4)")
				}
			}

			wantsScore, wantsMatched := wantedSignalScore(wants, wantedCategories, desiredProduct, up.Title, up.Category)
			score += wantsScore
			if wantsMatched {
				reasons = append(reasons, "Wants text signal matched offered item (bonus)")
			} else {
				reasons = append(reasons, "Wants text did not match (no bonus)")
			}

			passed := score >= minScore
			debug.Candidates = append(debug.Candidates, MultiwayCandidateDebug{
				User3ID:           user3ID,
				User3Name:         user3Name,
				User3ProductID:    user3ProductID,
				User3ProductTitle: user3ProductTitle,
				OfferedProductID:  up.ID,
				OfferedTitle:      up.Title,
				Score:             score,
				PassedThreshold:   passed,
				Reasons:           reasons,
			})

			if !passed {
				continue
			}

			if prev, ok := bestByUser3[user3ID]; !ok || score > prev.score {
				bestByUser3[user3ID] = candidateAgg{
					score: score,
					match: MultiwayMatch{
						User3ID:           user3ID,
						User3Name:         user3Name,
						User3ProductID:    user3ProductID,
						User3ProductTitle: user3ProductTitle,
						User1ProductID:    up.ID,
						User1ProductTitle: up.Title,
						MatchScore:        score,
					},
				}
			}
		}
	}

	var matches []MultiwayMatch
	for _, cand := range bestByUser3 {
		matches = append(matches, cand.match)
	}

	sort.Slice(matches, func(i, j int) bool {
		return matches[i].MatchScore > matches[j].MatchScore
	})

	if len(matches) == 0 {
		if len(debug.Candidates) == 0 {
			debug.NoMatchReason = "No available User 3 found in the same category/title as the target product."
			log.Printf("[FindMultiwayMatch] ❌ NO MATCH (Trade %d): %s", originalTradeID, debug.NoMatchReason)
		} else {
			best := 0
			for _, c := range debug.Candidates {
				if c.Score > best {
					best = c.Score
				}
			}
			debug.NoMatchReason = "Candidates found, but none met the minimum score threshold."
			if best > 0 {
				debug.NoMatchReason += " Best score: " + strconv.Itoa(best) + "."
			}
			log.Printf("[FindMultiwayMatch] ❌ NO MATCH (Trade %d): %s Found %d candidates", originalTradeID, debug.NoMatchReason, len(debug.Candidates))
		}
	} else {
		log.Printf("[FindMultiwayMatch] ✅ LOOP FOUND (Trade %d): Found %d matching User 3 candidates!", originalTradeID, len(matches))
		for i, match := range matches {
			log.Printf("  [%d] User3=%d (%s) has %s, wants your %s | Score: %d",
				i+1, match.User3ID, match.User3Name, match.User3ProductTitle, match.User1ProductTitle, match.MatchScore)
		}
	}
	return matches, debug, nil
}
