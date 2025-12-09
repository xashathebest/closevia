# Trade Notification System - Architecture Diagram

## System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          TRADE NOTIFICATION SYSTEM                          │
└─────────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────────┐
│                              BACKEND (Go/Fiber)                              │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │ trade_handler.go - UpdateTrade()                                       │ │
│  ├────────────────────────────────────────────────────────────────────────┤ │
│  │ case "accept":                                                         │ │
│  │   - Update trade status to "active"                                   │ │
│  │   - Query product_title                                               │ │
│  │   - Query seller_name, buyer_name                                     │ │
│  │   - publishToUser() with detailed payload:                            │ │
│  │     {                                                                 │ │
│  │       "type": "trade_updated",                                        │ │
│  │       "data": {                                                       │ │
│  │         "trade_id": 123,                                              │ │
│  │         "status": "accepted",                                         │ │
│  │         "product_title": "iPhone 13",                                 │ │
│  │         "partner_name": "John Doe",                                   │ │
│  │         "is_incoming": true                                           │ │
│  │       }                                                               │ │
│  │     }                                                                 │ │
│  │                                                                        │ │
│  │ case "decline":                                                        │ │
│  │   - Similar to accept but status = "declined"                         │ │
│  │                                                                        │ │
│  │ case "complete":                                                       │ │
│  │   - When both parties complete                                        │ │
│  │   - status = "completed"                                              │ │
│  │   - Query product & user info                                         │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                              ↓                                               │
│                    publishToUser() function                                   │
│                      (sends via SSE)                                          │
│                              ↓                                               │
│                   /api/chat/stream (SSE)                                      │
│                                                                              │
└──────────────────────────────────────────────────────────────────────────────┘
                                   │
                     ┌─────────────┴─────────────┐
                     │    SSE Connection         │
                     │   (Real-time Push)        │
                     │                           │
                     ↓                           ↓
┌────────────────────────────────────────────────────────────────────────────┐
│                        FRONTEND (React/TypeScript)                         │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│  ┌──────────────────────────────────────────────────────────────────────┐ │
│  │ RealtimeContext.tsx                                                  │ │
│  ├──────────────────────────────────────────────────────────────────────┤ │
│  │                                                                      │ │
│  │ EventSource listening on /api/chat/stream                           │ │
│  │                                                                      │ │
│  │ es.onmessage = (ev) => {                                            │ │
│  │   const payload = JSON.parse(ev.data)                               │ │
│  │                                                                      │ │
│  │   if (payload.type === 'trade_updated') {                           │ │
│  │     const {                                                          │ │
│  │       status,                                                        │ │
│  │       trade_id,                                                      │ │
│  │       product_title,                                                 │ │
│  │       partner_name,                                                  │ │
│  │       is_incoming                                                    │ │
│  │     } = payload.data                                                 │ │
│  │                                                                      │ │
│  │     // Create TradeStatusNotification                                │ │
│  │     const notification: TradeStatusNotification = {                  │ │
│  │       id: `${trade_id}-${status}-${Date.now()}`,                    │ │
│  │       tradeId: trade_id,                                             │ │
│  │       status: 'accepted'|'declined'|'completed',                     │ │
│  │       productTitle: product_title,                                   │ │
│  │       partnerName: partner_name,                                     │ │
│  │       message: getStatusMessage(status),                             │ │
│  │       isIncoming: is_incoming,                                       │ │
│  │       timestamp: Date.now()                                          │ │
│  │     }                                                                │ │
│  │                                                                      │ │
│  │     // Add to state                                                  │ │
│  │     setTradeStatusNotifications(prev => [...prev, notification])    │ │
│  │                                                                      │ │
│  │     // Show toast                                                    │ │
│  │     toast({...})                                                     │ │
│  │   }                                                                  │ │
│  │ }                                                                    │ │
│  │                                                                      │ │
│  │ Type: TradeStatusNotification                                        │ │
│  │ ├─ id: string (unique)                                              │ │
│  │ ├─ tradeId: number                                                  │ │
│  │ ├─ status: 'accepted'|'declined'|'completed'                        │ │
│  │ ├─ productTitle: string                                             │ │
│  │ ├─ partnerName: string                                              │ │
│  │ ├─ message: string                                                  │ │
│  │ ├─ isIncoming: boolean                                              │ │
│  │ └─ timestamp: number                                                │ │
│  │                                                                      │ │
│  │ State:                                                               │ │
│  │ tradeStatusNotifications: TradeStatusNotification[]                 │ │
│  │                                                                      │ │
│  │ Function:                                                            │ │
│  │ clearTradeNotification(id: string) => void                          │ │
│  │                                                                      │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                              ↓                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐ │
│  │ Dashboard.tsx (Consumer)                                             │ │
│  ├──────────────────────────────────────────────────────────────────────┤ │
│  │                                                                      │ │
│  │ const { tradeStatusNotifications, clearTradeNotification }          │ │
│  │   = useRealtime()                                                   │ │
│  │                                                                      │ │
│  │ Renders:                                                             │ │
│  │ {tradeStatusNotifications.map((notification) => (                   │ │
│  │   <TradeStatusNotificationPopup                                     │ │
│  │     key={notification.id}                                           │ │
│  │     notification={notification}                                     │ │
│  │     onClose={() => clearTradeNotification(notification.id)}        │ │
│  │     onViewTrade={(tradeId) => {                                     │ │
│  │       // Open ViewTradeModal with trade                             │ │
│  │     }}                                                              │ │
│  │   />                                                                │ │
│  │ ))}                                                                 │ │
│  │                                                                      │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                              ↓                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐ │
│  │ TradeStatusNotificationPopup.tsx (Presentation)                      │ │
│  ├──────────────────────────────────────────────────────────────────────┤ │
│  │                                                                      │ │
│  │ Displays popup based on status:                                      │ │
│  │                                                                      │ │
│  │ Status    │ Color  │ Icon      │ Title                              │ │
│  │ ──────────┼────────┼───────────┼──────────────────────────────     │ │
│  │ accepted  │ green  │ ✓ check   │ Trade Accepted! 🎉                │ │
│  │ declined  │ orange │ ✗ times   │ Trade Declined                    │ │
│  │ completed │ blue   │ 🤝 shake  │ Trade Completed! ✓                │ │
│  │                                                                      │ │
│  │ Features:                                                            │ │
│  │ - Auto-dismiss after 8 seconds                                      │ │
│  │ - Progress bar countdown                                            │ │
│  │ - Manual close button (X)                                           │ │
│  │ - "View Trade Details" button                                       │ │
│  │ - Smooth slide-in animation (400ms)                                 │ │
│  │ - Smooth fade-out animation (300ms)                                 │ │
│  │ - Responsive design (mobile & desktop)                              │ │
│  │                                                                      │ │
│  │ Position: Fixed top-right corner                                    │ │
│  │ Width: 400px (desktop), 100%-32px (mobile)                          │ │
│  │ Z-index: 9999 (on top of all content)                               │ │
│  │                                                                      │ │
│  └──────────────────────────────────────────────────────────────────────┘ │
│                                                                            │
└────────────────────────────────────────────────────────────────────────────┘
```

## Data Flow Sequence

```
User Action                    Backend                         Frontend
─────────────────────────────────────────────────────────────────────────────

User clicks              ┌──────────────────┐
"Accept Trade"    ──→    │ UpdateTrade()    │
                         │ case "accept"    │
                         └────────┬─────────┘
                                  │
                    ┌─────────────┴─────────────┐
                    │ Database Update           │
                    │ - trades.status="active"  │
                    │ - Update timestamp        │
                    └──────────────┬────────────┘
                                   │
                    ┌──────────────┴──────────────┐
                    │ Query Information          │
                    │ - product_title            │
                    │ - buyer_name               │
                    │ - seller_name              │
                    └──────────────┬──────────────┘
                                   │
                    ┌──────────────┴──────────────────────┐
                    │ publishToUser() SSE Event          │
                    │ - trade_id: 123                    │
                    │ - status: "accepted"               │
                    │ - product_title: "iPhone 13"       │
                    │ - partner_name: "John Doe"         │
                    │ - is_incoming: true                │
                    └──────────────┬──────────────────────┘
                                   │
                                   │ HTTP/SSE
                                   ↓
                                                 ┌──────────────┐
                                          ──→   │ Received SSE  │
                                                │ event in      │
                                                │ RealtimeCtx   │
                                                └────┬─────────┘
                                                     │
                                         ┌───────────┴──────────┐
                                         │ Create               │
                                         │ Notification Object  │
                                         │ - id unique          │
                                         │ - timestamp now      │
                                         └───────────┬──────────┘
                                                     │
                                         ┌───────────┴──────────┐
                                         │ Add to state         │
                                         │ setNotifications()   │
                                         └───────────┬──────────┘
                                                     │
                                         ┌───────────┴──────────┐
                                         │ Dashboard re-renders │
                                         │ Maps notifications   │
                                         └───────────┬──────────┘
                                                     │
                                         ┌───────────┴──────────────┐
                                         │ Display popup:            │
                                         │ - Top-right corner        │
                                         │ - Green styling           │
                                         │ - ✓ Checkmark icon       │
                                         │ - "Trade Accepted! 🎉"    │
                                         │ - Product & partner info  │
                                         │ - Progress bar (8s)       │
                                         └───────────┬──────────────┘
                                                     │
                                                     ├→ User waits 8s ──→ Auto-close
                                                     │
                                                     └→ User clicks ──────┐
                                                        "View Trade"      │
                                                                          ↓
                                                        ┌────────────────────┐
                                                        │ ViewTradeModal      │
                                                        │ opens with trade    │
                                                        │ details             │
                                                        └────────────────────┘
```

## Component Relationship Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                   RealtimeProvider                          │
│                                                             │
│  ├─ State:                                                 │
│  │  ├─ offerCount                                          │
│  │  ├─ notificationCount                                   │
│  │  └─ tradeStatusNotifications: []                        │
│  │                                                         │
│  ├─ Provides:                                              │
│  │  ├─ refreshCounts()                                     │
│  │  ├─ clearTradeNotification()                            │
│  │  └─ tradeStatusNotifications                            │
│  │                                                         │
│  └─ SSE Listener:                                          │
│     ├─ Connects to /api/chat/stream                        │
│     ├─ Parses trade_updated events                         │
│     └─ Creates TradeStatusNotification objects             │
│                                                             │
└──────────────────┬──────────────────────────────────────────┘
                   │ useRealtime()
                   ↓
┌─────────────────────────────────────────────────────────────┐
│                    Dashboard                               │
│                                                             │
│  ├─ Consumes:                                              │
│  │  ├─ tradeStatusNotifications[]                          │
│  │  └─ clearTradeNotification(id)                          │
│  │                                                         │
│  ├─ State:                                                 │
│  │  ├─ incoming[]                                          │
│  │  ├─ outgoing[]                                          │
│  │  ├─ selectedTrade                                       │
│  │  └─ viewTradeModalOpen                                  │
│  │                                                         │
│  └─ Renders:                                               │
│     ├─ Main content area                                   │
│     ├─ ViewTradeModal                                      │
│     └─ TradeStatusNotificationPopup[]                      │
│        ├─ (for each notification)                          │
│        └─ (fixed position top-right)                       │
│                                                             │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ├──→ TradeStatusNotificationPopup
                     │    (per notification)
                     │    ├─ Props:
                     │    │  ├─ notification
                     │    │  ├─ onClose
                     │    │  └─ onViewTrade
                     │    │
                     │    └─ Features:
                     │       ├─ Auto-dismiss (8s)
                     │       ├─ Manual close
                     │       ├─ View details action
                     │       └─ Animations
                     │
                     └──→ ViewTradeModal
                          (opens on button click)
```

## State Flow Diagram

```
SSE Event Received
        │
        ↓
┌───────────────────────┐
│ parse(event.data)     │
└─────────┬─────────────┘
          │
          ↓
┌─────────────────────────────────────┐
│ if type === 'trade_updated'         │
└─────────┬───────────────────────────┘
          │
          ├─ Extract:
          │  ├─ status
          │  ├─ trade_id
          │  ├─ product_title
          │  ├─ partner_name
          │  └─ is_incoming
          │
          ↓
┌──────────────────────────────────────┐
│ Create TradeStatusNotification       │
├──────────────────────────────────────┤
│ {                                    │
│   id: "123-accepted-1702115234567"   │
│   tradeId: 123                       │
│   status: "accepted"                 │
│   productTitle: "iPhone 13"          │
│   partnerName: "John Doe"            │
│   message: "has accepted your offer" │
│   isIncoming: true                   │
│   timestamp: 1702115234567           │
│ }                                    │
└─────────┬──────────────────────────────┘
          │
          ↓
┌──────────────────────────────────┐
│ Add to tradeStatusNotifications   │
│ state array                       │
└─────────┬────────────────────────┘
          │
          ↓
┌──────────────────────────────────┐
│ Dashboard re-renders with new    │
│ notifications in state            │
└─────────┬────────────────────────┘
          │
          ↓
┌──────────────────────────────────┐
│ Map array and render             │
│ TradeStatusNotificationPopup     │
│ for each notification            │
└─────────┬────────────────────────┘
          │
          ├─ User action (close/view)
          │       │
          │       ↓
          │  clearTradeNotification(id)
          │       │
          │       ↓
          │  Remove from state
          │       │
          │       ↓
          │  Re-render without that notification
          │
          └─ Auto-dismiss (8s)
                  │
                  ↓
             Same as above
```

---

This architecture ensures:
- ✅ Real-time notifications via SSE
- ✅ Proper state management
- ✅ Clean component separation
- ✅ Smooth user experience
- ✅ Scalable design
