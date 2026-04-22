package services

import "testing"

func TestFindTradeLoopsDetectsThreeToFiveWayCycles(t *testing.T) {
	tests := []struct {
		name      string
		edges     []TradeEdge
		wantLens  map[int]int
		wantCount int
	}{
		{
			name: "3-way",
			edges: []TradeEdge{
				{FromUser: 1, ToUser: 2, TradeID: 101},
				{FromUser: 2, ToUser: 3, TradeID: 102},
				{FromUser: 3, ToUser: 1, TradeID: 103},
			},
			wantLens:  map[int]int{3: 1},
			wantCount: 1,
		},
		{
			name: "4-way",
			edges: []TradeEdge{
				{FromUser: 1, ToUser: 2, TradeID: 201},
				{FromUser: 2, ToUser: 3, TradeID: 202},
				{FromUser: 3, ToUser: 4, TradeID: 203},
				{FromUser: 4, ToUser: 1, TradeID: 204},
			},
			wantLens:  map[int]int{4: 1},
			wantCount: 1,
		},
		{
			name: "5-way",
			edges: []TradeEdge{
				{FromUser: 1, ToUser: 2, TradeID: 301},
				{FromUser: 2, ToUser: 3, TradeID: 302},
				{FromUser: 3, ToUser: 4, TradeID: 303},
				{FromUser: 4, ToUser: 5, TradeID: 304},
				{FromUser: 5, ToUser: 1, TradeID: 305},
			},
			wantLens:  map[int]int{5: 1},
			wantCount: 1,
		},
		{
			name: "6-way is above cap",
			edges: []TradeEdge{
				{FromUser: 1, ToUser: 2, TradeID: 401},
				{FromUser: 2, ToUser: 3, TradeID: 402},
				{FromUser: 3, ToUser: 4, TradeID: 403},
				{FromUser: 4, ToUser: 5, TradeID: 404},
				{FromUser: 5, ToUser: 6, TradeID: 405},
				{FromUser: 6, ToUser: 1, TradeID: 406},
			},
			wantLens:  map[int]int{},
			wantCount: 0,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			graph := &TradeGraph{Edges: tt.edges, Nodes: map[int]bool{}}
			for _, edge := range tt.edges {
				graph.Nodes[edge.FromUser] = true
				graph.Nodes[edge.ToUser] = true
			}

			loops := graph.FindTradeLoops()
			if len(loops) != tt.wantCount {
				t.Fatalf("FindTradeLoops() returned %d loops, want %d: %#v", len(loops), tt.wantCount, loops)
			}

			gotLens := map[int]int{}
			for _, loop := range loops {
				gotLens[len(loop)]++
			}
			for length, want := range tt.wantLens {
				if gotLens[length] != want {
					t.Fatalf("length %d count = %d, want %d", length, gotLens[length], want)
				}
			}
		})
	}
}
