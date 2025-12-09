# Multi-Way Trading API Contract

## Expected Backend Endpoints

The frontend implementation expects the following API endpoints to be available on the backend.

---

## 1. Fetch Trade Loops

### GET `/api/trades/loops`

Fetches all detected trade loops in the system.

**Query Parameters:**
- None

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "loop_length": 3,
      "participants": [1, 2, 3],
      "edges": [
        {
          "from_user": 1,
          "to_user": 2,
          "trade_id": 101,
          "from_user_name": "Alice",
          "to_user_name": "Bob",
          "product_title": "iPhone",
          "status": "pending"
        },
        {
          "from_user": 2,
          "to_user": 3,
          "trade_id": 102,
          "from_user_name": "Bob",
          "to_user_name": "Charlie",
          "product_title": "Laptop",
          "status": "pending"
        },
        {
          "from_user": 3,
          "to_user": 1,
          "trade_id": 103,
          "from_user_name": "Charlie",
          "to_user_name": "Alice",
          "product_title": "PlayStation",
          "status": "pending"
        }
      ]
    }
  ]
}
```

---

## 2. Fetch User's Trade Loops

### GET `/api/trades/user/loops`

Fetches trade loops involving the current authenticated user.

**Query Parameters:**
- None

**Response:**
Same format as `/api/trades/loops` but filtered for current user

---

## 3. Fetch Specific Trade Loop Details

### GET `/api/trades/loops/:loopId`

Fetches complete details of a specific trade loop with all participant information.

**URL Parameters:**
- `loopId` (string, required) - Unique identifier for the loop (e.g., `loop_101_102_103`)

**Response:**
```json
{
  "success": true,
  "data": {
    "loop_id": "loop_101_102_103",
    "status": "active",
    "created_at": "2025-11-24T10:30:00Z",
    "total_value": 45000,
    "participants": [
      {
        "user_id": 1,
        "user_name": "Alice",
        "product_id": 42,
        "product_title": "iPhone 15 Pro",
        "product_image": "https://...",
        "trade_id": 101,
        "trade_status": "pending",
        "position_in_loop": 0
      },
      {
        "user_id": 2,
        "user_name": "Bob",
        "product_id": 89,
        "product_title": "MacBook Pro",
        "product_image": "https://...",
        "trade_id": 102,
        "trade_status": "pending",
        "position_in_loop": 1
      },
      {
        "user_id": 3,
        "user_name": "Charlie",
        "product_id": 156,
        "product_title": "PlayStation 5",
        "product_image": "https://...",
        "trade_id": 103,
        "trade_status": "pending",
        "position_in_loop": 2
      }
    ],
    "edges": [
      {
        "from_user": 1,
        "to_user": 2,
        "trade_id": 101,
        "from_user_name": "Alice",
        "to_user_name": "Bob",
        "product_title": "iPhone 15 Pro",
        "status": "pending"
      },
      {
        "from_user": 2,
        "to_user": 3,
        "trade_id": 102,
        "from_user_name": "Bob",
        "to_user_name": "Charlie",
        "product_title": "MacBook Pro",
        "status": "pending"
      },
      {
        "from_user": 3,
        "to_user": 1,
        "trade_id": 103,
        "from_user_name": "Charlie",
        "to_user_name": "Alice",
        "product_title": "PlayStation 5",
        "status": "pending"
      }
    ]
  }
}
```

---

## 4. Accept Multi-Way Trade

### POST `/api/trades/loops/:loopId/accept`

Current user accepts the multi-way trade opportunity.

**URL Parameters:**
- `loopId` (string, required) - Unique identifier for the loop

**Request Body:**
```json
{}
```

**Response:**
```json
{
  "success": true,
  "message": "You accepted this multi-way trade opportunity",
  "data": {
    "loop_id": "loop_101_102_103",
    "status": "pending_acceptance",
    "accepted_by": [1, 2],
    "pending_from": [3]
  }
}
```

**Error Cases:**
- 401: User not authenticated
- 404: Loop not found
- 400: User not part of this loop
- 400: Loop already completed or declined

---

## 5. Decline Multi-Way Trade

### POST `/api/trades/loops/:loopId/decline`

Current user declines the multi-way trade opportunity.

**URL Parameters:**
- `loopId` (string, required) - Unique identifier for the loop

**Request Body:**
```json
{}
```

**Response:**
```json
{
  "success": true,
  "message": "You declined this multi-way trade",
  "data": {
    "loop_id": "loop_101_102_103",
    "status": "declined",
    "declined_by": 3
  }
}
```

**Error Cases:**
- 401: User not authenticated
- 404: Loop not found
- 400: User not part of this loop

---

## 6. Execute Multi-Way Trade

### POST `/api/trades/loops/:loopId/execute`

Executes all trades in the loop simultaneously. Should only work when all participants have accepted.

**URL Parameters:**
- `loopId` (string, required) - Unique identifier for the loop

**Request Body:**
```json
{}
```

**Response:**
```json
{
  "success": true,
  "message": "Multi-way trade executed successfully!",
  "data": {
    "loop_id": "loop_101_102_103",
    "status": "completed",
    "completed_at": "2025-11-24T11:45:00Z",
    "trades_executed": [101, 102, 103]
  }
}
```

**Error Cases:**
- 401: User not authenticated
- 404: Loop not found
- 400: Not all participants have accepted
- 400: One or more trades no longer available
- 500: Transaction failed (should rollback all trades)

---

## 7. Fetch Trade Loop Notifications

### GET `/api/trades/loops/notifications`

Fetches all trade loop notifications for the current user.

**Query Parameters:**
- `limit` (integer, optional, default: 50) - Maximum number of notifications
- `offset` (integer, optional, default: 0) - Pagination offset
- `unread_only` (boolean, optional, default: false) - Only unread notifications

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "notif_001",
      "type": "trade_loop",
      "message": "Loop Trade Found! A potential multi-way trade is available.",
      "participant_count": 3,
      "loop_id": "loop_101_102_103",
      "created_at": "2025-11-24T10:30:00Z",
      "read": false
    },
    {
      "id": "notif_002",
      "type": "trade_loop",
      "message": "Loop Trade Found! A potential multi-way trade is available.",
      "participant_count": 4,
      "loop_id": "loop_104_105_106_107",
      "created_at": "2025-11-24T09:15:00Z",
      "read": true
    }
  ]
}
```

---

## 8. Mark Notification as Read

### POST `/api/trades/loops/notifications/:notificationId/read`

Marks a specific notification as read.

**URL Parameters:**
- `notificationId` (string, required) - Unique identifier for the notification

**Request Body:**
```json
{}
```

**Response:**
```json
{
  "success": true,
  "message": "Notification marked as read"
}
```

---

## 9. Clear All Notifications

### POST `/api/trades/loops/notifications/clear`

Clears all trade loop notifications for the current user.

**Request Body:**
```json
{}
```

**Response:**
```json
{
  "success": true,
  "message": "All notifications cleared",
  "data": {
    "cleared_count": 5
  }
}
```

---

## Data Models

### TradeLoop
```go
type TradeLoop struct {
  LoopLength   int
  Participants []int          // User IDs
  Edges        []TradeEdge
}
```

### TradeEdge
```go
type TradeEdge struct {
  FromUser      int
  ToUser        int
  TradeID       int
  FromUserName  string
  ToUserName    string
  ProductTitle  string
  Status        string // 'pending', 'accepted', etc.
}
```

### MultiWayTrade
```go
type MultiWayTrade struct {
  LoopID       string
  Participants []MultiWayTradeParticipant
  Edges        []TradeEdge
  TotalValue   float64
  Status       string // 'active', 'completed', 'declined'
  CreatedAt    time.Time
}
```

### MultiWayTradeParticipant
```go
type MultiWayTradeParticipant struct {
  UserID         int
  UserName       string
  ProductID      int
  ProductTitle   string
  ProductImage   string
  TradeID        int
  TradeStatus    string
  PositionInLoop int
}
```

### TradeLoopNotification
```go
type TradeLoopNotification struct {
  ID              string
  Type            string    // 'trade_loop'
  Message         string
  ParticipantCount int
  LoopID          string
  CreatedAt       time.Time
  Read            bool
}
```

---

## Authentication

All endpoints require authentication via Bearer token in the `Authorization` header:
```
Authorization: Bearer <jwt_token>
```

The token is extracted from the `Authorization` header and the user ID is determined from it.

---

## Error Handling

All endpoints should return consistent error responses:

```json
{
  "success": false,
  "error": "Error message describing what went wrong",
  "data": null
}
```

### Standard HTTP Status Codes:
- `200` - Success (GET requests)
- `201` - Created (POST requests creating resources)
- `400` - Bad Request (validation errors, invalid state)
- `401` - Unauthorized (missing/invalid token)
- `403` - Forbidden (user doesn't have permission)
- `404` - Not Found (resource doesn't exist)
- `500` - Server Error (transaction failures, database errors)

---

## Implementation Notes

### Loop ID Format
The `loop_id` should be a unique, deterministic identifier. Suggested format:
```
loop_<trade_id_1>_<trade_id_2>_<trade_id_3>_...
```
Example: `loop_101_102_103`

### Transaction Safety
The `/execute` endpoint must be **atomic**:
- Either all trades complete successfully, or all rollback
- No partial execution is acceptable
- Use database transactions to ensure consistency

### Notifications
When a trade loop is detected:
1. Create notifications for all involved users with type `'trade_loop'`
2. Mark as `read = false`
3. Broadcast via WebSocket or rely on polling

### Status Transitions
```
pending → accepted (single user action)
pending → declined (single user action)
declined → (no further changes)
accepted (all users) → can execute
execution → completed
```

### Authorization
- Users can only accept/decline if they are part of the loop
- Users can only execute if all participants have accepted
- Users can only view loops they're part of

---

## Rate Limiting Recommendations

- `GET /api/trades/loops/notifications` - Poll every 15-30 seconds (client-side throttling)
- `POST /api/trades/loops/:loopId/execute` - No rate limit needed (infrequent action)
- All endpoints should have standard API rate limiting (e.g., 100 requests/minute per user)

---

## Future Enhancements

- WebSocket support for real-time loop notifications (instead of polling)
- Webhook notifications for external integrations
- Loop expiration (remove after X hours if not all accepted)
- Analytics endpoint to track loop success rates
- Loop filtering by status, participant count, total value
- Bulk operations (accept/decline multiple loops)
