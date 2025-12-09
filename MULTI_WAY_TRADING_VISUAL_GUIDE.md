# Multi-Way Trading System - Visual Guide

## User Interface Overview

### 1. Trades Page with Notifications
```
┌─────────────────────────────────────────────────────────────────┐
│ Trades & Multi-Way Trading                                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│ ┌─ 🔗 Multi-Way Trade Opportunities (3 NEW) ──────────────────┐ │
│ │                                                              │ │
│ │  🔔 Loop 1 detected: 3 participants ready to trade          │ │
│ │     • 3 participants  •  2 hours ago                         │ │
│ │  🔔 Loop 2 detected: 4 participants ready to trade          │ │
│ │     • 4 participants  •  30 mins ago                         │ │
│ │                                                              │ │
│ │  [Clear All]                        [View Trade Chains ▶]  │ │
│ └──────────────────────────────────────────────────────────────┘ │
│                                                                  │
│  [Individual Trades] [Multi-Way Opportunities]                 │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 2. Trade Loop Display Component
```
┌─────────────────────────────────────────────────────────────────┐
│ Multi-Way Trading Opportunities (3)                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│ ┌─ [3-Way Trade] [3 participants] ────────────────────────────┐ │
│ │                                                              │ │
│ │ Trade Flow:                                                 │ │
│ │  Alice ──────────────────────────────────────────┐         │ │
│ │    ↓                                             │         │ │
│ │  [iPhone] ──────────────────────────────────────┼────→    │ │
│ │                                                  │         │ │
│ │  Bob ────────────────────────────────────────────↓         │ │
│ │    ↓                                             │         │ │
│ │  [Laptop] ────────────────────────────────────┬──┘        │ │
│ │                                                ↓          │ │
│ │  Charlie ──────────────────────────────────────          │ │
│ │    ↓                                                      │ │
│ │  [PlayStation] ──→ (back to Alice)                       │ │
│ │                                                           │ │
│ │ Status: [⏳ pending]  Loop ID: 1                          │ │
│ │                                        [View Details ▶]   │ │
│ └───────────────────────────────────────────────────────────┘ │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 3. Multi-Way Trade Modal
```
┌─────────────────────────────────────────────────────────────────┐
│ 3-Way Trade Chain                                   [⌚ active]  │ X
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│ Trade Flow:                                                      │
│  Trade 1: Alice offers to Bob                                   │
│    📦 iPhone [⏳ pending]                                        │
│                                                                  │
│  Trade 2: Bob offers to Charlie                                 │
│    📦 Laptop [⏳ pending]                                        │
│                                                                  │
│  Trade 3: Charlie offers to Alice                               │
│    📦 PlayStation [⏳ pending]                                   │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│ Participants (3):                                                │
│                                                                  │
│ ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│ │ [1] Alice        │  │ [2] Bob          │  │ [3] Charlie      │
│ │ ───────────────  │  │ ───────────────  │  │ ───────────────  │
│ │ 🎯 pending       │  │ 🎯 pending       │  │ 🎯 pending       │
│ │                  │  │                  │  │                  │
│ │ Product:         │  │ Product:         │  │ Product:         │
│ │ 🎮 iPhone        │  │ 💻 Laptop        │  │ 🕹️ PlayStation   │
│ │ ID: 42           │  │ ID: 89           │  │ ID: 156          │
│ │                  │  │                  │  │                  │
│ │ Trade ID: 1001   │  │ Trade ID: 1002   │  │ Trade ID: 1003   │
│ └──────────────────┘  └──────────────────┘  └──────────────────┘
│                                                                  │
│ ℹ️  How it works: Once all participants accept, the trades     │
│    will be automatically synchronized and completed.            │
│                                                                  │
│ Total Value: ₱45,000                                            │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│ [Decline]  [Accept Trade]  [Execute Trade]                      │
└─────────────────────────────────────────────────────────────────┘
```

## Data Flow Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                         USER BROWSER                              │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │           Trades Page (Trades.tsx)                          │ │
│  │  ┌──────────────────────────────────────────────────────┐   │ │
│  │  │ TradeLoopNotificationsPanel                          │   │ │
│  │  │ - useTradeLoopNotifications hook                     │   │ │
│  │  │ - Auto-poll every 15 seconds                         │   │ │
│  │  │ - Show toast alerts                                  │   │ │
│  │  └──────────────────────────────────────────────────────┘   │ │
│  │                                                               │ │
│  │  ┌──────────────────────────────────────────────────────┐   │ │
│  │  │ Tabs:                                                │   │ │
│  │  │ ┌─ Individual Trades ┐  ┌─ Multi-Way Opportunities ┐   │ │
│  │  │ │                    │  │  TradeLoopsDisplay       │   │ │
│  │  │ │ (existing trades)  │  │  - fetchTradeLoops()     │   │ │
│  │  │ │                    │  │  - Show loop cards       │   │ │
│  │  │ └────────────────────┘  │  - onClick → Modal       │   │ │
│  │  │                         │                          │   │ │
│  │  │                         │  ┌─ MultiWayTradeModal ─┐   │ │
│  │  │                         │  │ - fetchMultiWayTrade  │   │ │
│  │  │                         │  │ - Accept/Decline/Exec │   │ │
│  │  │                         │  │ - Show participants   │   │ │
│  │  │                         │  └───────────────────────┘   │ │
│  │  │                         └──────────────────────────────┘   │ │
│  │  └──────────────────────────────────────────────────────┘   │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │             Services & API Layer                            │ │
│  │                                                              │ │
│  │  tradeService.ts                                            │ │
│  │  - fetchTradeLoops()                                        │ │
│  │  - fetchMultiWayTrade(loopId)                               │ │
│  │  - acceptMultiWayTrade(loopId)                              │ │
│  │  - executeMultiWayTrade(loopId)                             │ │
│  │  - (+ all other trade functions)                            │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                   │
└─────────────────────────────────────────────────────────────────┬┘
                                                                  │
                    HTTP/REST API Calls
                                                                  │
┌─────────────────────────────────────────────────────────────────┴┐
│                      BACKEND API SERVER                           │
├──────────────────────────────────────────────────────────────────┤
│                                                                   │
│  GET  /api/trades/loops              ← Fetch all loops           │
│  GET  /api/trades/user/loops         ← User's specific loops     │
│  GET  /api/trades/loops/:loopId      ← Get loop details          │
│  POST /api/trades/loops/:loopId/accept                          │
│  POST /api/trades/loops/:loopId/decline                         │
│  POST /api/trades/loops/:loopId/execute                         │
│  GET  /api/trades/loops/notifications                           │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Trade Handler with Loop Detection                       │   │
│  │  - CheckForTradeLoops()                                  │   │
│  │  - Find cycles in trade graph                            │   │
│  │  - Create/manage multi-way trades                        │   │
│  │  - Send notifications                                    │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Trade Service (services/trade_matcher.go)               │   │
│  │  - TradeGraph structure                                  │   │
│  │  - DFS cycle detection                                   │   │
│  │  - FindTradeLoops()                                      │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

## User Journey

### Scenario: Finding and Executing a Multi-Way Trade

```
1. USER CREATES INDIVIDUAL TRADES
   ├─ Alice offers iPhone to Bob
   ├─ Bob offers Laptop to Charlie
   └─ Charlie offers PlayStation to Alice
       ↓
2. BACKEND DETECTS LOOP
   ├─ Builds trade graph
   ├─ Runs DFS cycle detection
   ├─ Finds the 3-way loop
   └─ Creates multi-way trade notification
       ↓
3. FRONTEND RECEIVES NOTIFICATION
   ├─ Hook polls /api/trades/loops/notifications
   ├─ New notification detected
   ├─ Toast alert: "🔗 Multi-Way Trade Detected!"
   └─ Updates notification panel
       ↓
4. USER VIEWS MULTI-WAY OPPORTUNITY
   ├─ Clicks "View Trade Chains" or opens Multi-Way tab
   ├─ Sees TradeLoopsDisplay component
   ├─ Clicks "View Details" on loop card
   └─ Modal opens with full details
       ↓
5. USER REVIEWS AND ACCEPTS
   ├─ Reviews all participants (Alice, Bob, Charlie)
   ├─ Reviews products in the loop
   ├─ Sees total estimated value
   ├─ Clicks "Accept Trade"
   └─ Frontend calls acceptMultiWayTrade()
       ↓
6. ALL PARTICIPANTS ACCEPT
   ├─ Bob reviews and accepts
   ├─ Charlie reviews and accepts
   ├─ System detects all acceptances
   └─ "Execute Trade" button becomes available
       ↓
7. EXECUTE MULTI-WAY TRADE
   ├─ Any participant clicks "Execute Trade"
   ├─ Frontend calls executeMultiWayTrade()
   ├─ Backend synchronously executes all trades
   ├─ Products exchange simultaneously
   └─ All users get notifications of completion
       ↓
8. TRADE COMPLETE
   ├─ All products marked as traded/transferred
   ├─ Modal closes
   ├─ Notification removed
   └─ Users see their new items in inventory
```

## Component Hierarchy

```
App
└── Trades (Page)
    ├── TradeLoopNotificationsPanel
    │   └── useTradeLoopNotifications (hook)
    │       └── polls: /api/trades/loops/notifications
    │
    └── Tabs
        ├── Tab 1: Individual Trades (existing)
        │   └── Trade list & chat interface
        │
        └── Tab 2: Multi-Way Opportunities
            └── TradeLoopsDisplay
                ├── calls: fetchTradeLoops()
                ├── renders loop cards with chain visualization
                │
                └── [on click] → MultiWayTradeModal
                    ├── calls: fetchMultiWayTrade(loopId)
                    ├── shows all participants with their products
                    ├── actions: Accept, Decline, Execute
                    └── calls: acceptMultiWayTrade, etc.
```

## Status Flow Diagram

```
TRADE LOOP LIFECYCLE:
┌─────────┐
│ ACTIVE  │ ← Trade loop detected, all trades pending
└────┬────┘
     │
     ├─→ User clicks "Decline" → DECLINED (removed from view)
     │
     └─→ User clicks "Accept"
         ↓
    ┌─────────────┐
    │ PENDING ACC │ ← Waiting for other participants to accept
    └────┬────────┘
         │
         ├─→ Someone declines → DECLINED
         │
         └─→ All accept
             ↓
        ┌──────────┐
        │ ACCEPTED │ ← Ready to execute
        └────┬─────┘
             │
             ├─→ Someone changes mind → DECLINED
             │
             └─→ Click "Execute Trade"
                 ↓
            ┌──────────────┐
            │ COMPLETED    │ ← All trades executed!
            └──────────────┘
```

## Notification Badges & Indicators

```
🔗 Trade Loop Icon          - Indicates multi-way trading feature
⏳ Pending Status          - Trade waiting for action
✅ Accepted Status         - User has accepted
❌ Declined Status         - User has declined
🎯 Position in Chain        - Shows where user fits in loop
🔔 Unread Notification     - New loop alert
📦 Product in Loop         - Item being traded
👥 Participant Count       - How many in the loop
💰 Total Value             - Estimated total value of all products
```
