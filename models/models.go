package models

import (
	"database/sql/driver"
	"encoding/json"
	"errors"
	"reflect"
	"time"
)

// StringArray is a custom type for scanning JSON arrays from SQL
type StringArray []string

// UnmarshalJSON accepts either a JSON array, null, or a JSON-encoded string containing an array.
func (a *StringArray) UnmarshalJSON(data []byte) error {
	if string(data) == "null" {
		*a = StringArray{}
		return nil
	}

	// Try unmarshalling as []string first
	var arr []string
	if err := json.Unmarshal(data, &arr); err == nil {
		*a = StringArray(arr)
		return nil
	}

	// Try as a JSON string that may contain a JSON array (e.g. "\"[\\\"u1\\\",\\\"u2\\\"]\"")
	var asString string
	if err := json.Unmarshal(data, &asString); err == nil {
		// Try to unmarshal the inner string as JSON array
		if err2 := json.Unmarshal([]byte(asString), &arr); err2 == nil {
			*a = StringArray(arr)
			return nil
		}
		// Fallback: treat the whole string as single-element array
		*a = StringArray{asString}
		return nil
	}

	return errors.New("StringArray: unsupported JSON type")
}

// MarshalJSON ensures []string is marshalled as a JSON array
func (a StringArray) MarshalJSON() ([]byte, error) {
	return json.Marshal([]string(a))
}

// Scan implements the sql.Scanner interface
func (a *StringArray) Scan(value interface{}) error {
	if value == nil {
		*a = StringArray{}
		return nil
	}
	switch v := value.(type) {
	case []byte:
		// []byte from DB (JSON or text)
		return json.Unmarshal(v, a)
	case string:
		// string from DB (JSON text)
		return json.Unmarshal([]byte(v), a)
	default:
		return errors.New("unsupported type for StringArray")
	}
}

// Value implements the driver.Valuer interface
func (a StringArray) Value() (driver.Value, error) {
	return json.Marshal(a)
}

// User represents a user in the system
type User struct {
	ID           int       `json:"id"`
	Name         string    `json:"name" validate:"required,min=2,max=255"`
	Email        string    `json:"email" validate:"required,email"`
	PasswordHash string    `json:"-" validate:"required"`
	Role         string    `json:"role" validate:"oneof=user admin"`
	Verified     bool      `json:"verified"`
	CreatedAt    time.Time `json:"created_at"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// UserLogin represents login credentials
type UserLogin struct {
	Email    string `json:"email" validate:"required,email"`
	Password string `json:"password" validate:"required,min=6"`
}

// UserRegister represents registration data
type UserRegister struct {
	Name     string `json:"name" validate:"required,min=2,max=255"`
	Email    string `json:"email" validate:"required,email"`
	Password string `json:"password" validate:"required,min=6"`
	Role     string `json:"role" validate:"omitempty,oneof=user admin"`
}

// Product represents a product listing
type Product struct {
	ID          int         `json:"id"`
	Title       string      `json:"title" validate:"required,min=2,max=255"`
	Description string      `json:"description"`
	Price       *float64    `json:"price,omitempty"`      // Optional for barter-only items
	ImageURLs   StringArray `json:"image_urls,omitempty"` // Multiple images
	ImageURL    string      `json:"image_url,omitempty"`  // Single image for compatibility
	SellerID    int         `json:"seller_id"`
	SellerName  string      `json:"seller_name,omitempty"`
	Premium     bool        `json:"premium"`
	Status      string      `json:"status" validate:"oneof=available sold"`
	AllowBuying bool        `json:"allow_buying"` // Whether buying is allowed
	BarterOnly  bool        `json:"barter_only"`  // Whether it's barter only
	Location    string      `json:"location,omitempty"`
	CreatedAt   time.Time   `json:"created_at"`
	UpdatedAt   time.Time   `json:"updated_at"`
}

// ProductCreate represents data for creating a product
type ProductCreate struct {
	Title       string      `json:"title" validate:"required,min=2,max=255"`
	Description string      `json:"description"`
	Price       *float64    `json:"price,omitempty"` // Optional for barter-only items
	ImageURLs   StringArray `json:"image_urls,omitempty"`
	Premium     bool        `json:"premium"`
	AllowBuying bool        `json:"allow_buying"`
	BarterOnly  bool        `json:"barter_only"`
	Location    string      `json:"location,omitempty"`
}

// ProductUpdate represents data for updating a product
type ProductUpdate struct {
	Title       *string      `json:"title,omitempty" validate:"omitempty,min=2,max=255"`
	Description *string      `json:"description,omitempty"`
	Price       *float64     `json:"price,omitempty" validate:"omitempty,gt=0"`
	ImageURLs   *StringArray `json:"image_urls,omitempty"`
	Premium     *bool        `json:"premium,omitempty"`
	Status      *string      `json:"status,omitempty" validate:"omitempty,oneof=available sold"`
	AllowBuying *bool        `json:"allow_buying,omitempty"`
	BarterOnly  *bool        `json:"barter_only,omitempty"`
	Location    *string      `json:"location,omitempty"`
}

// Order represents an order
type Order struct {
	ID        int       `json:"id"`
	ProductID int       `json:"product_id"`
	BuyerID   int       `json:"buyer_id"`
	Status    string    `json:"status" validate:"oneof=pending completed cancelled"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`

	// Related data
	Product *Product `json:"product,omitempty"`
	Buyer   *User    `json:"buyer,omitempty"`
}

// OrderCreate represents data for creating an order
type OrderCreate struct {
	ProductID int `json:"product_id" validate:"required"`
}

// OrderUpdate represents data for updating an order
type OrderUpdate struct {
	Status *string `json:"status,omitempty" validate:"omitempty,oneof=pending completed cancelled"`
}

// Transaction represents a payment transaction
type Transaction struct {
	ID          int       `json:"id"`
	OrderID     int       `json:"order_id"`
	Amount      float64   `json:"amount"`
	PaymentDate time.Time `json:"payment_date"`
}

// Trade represents a barter trade proposal
type Trade struct {
	ID              int         `json:"id"`
	BuyerID         int         `json:"buyer_id"`
	SellerID        int         `json:"seller_id"`
	TargetProductID int         `json:"target_product_id"`
	Status          string      `json:"status" validate:"oneof=pending accepted declined countered active completed cancelled"`
	Message         string      `json:"message,omitempty"`
	OfferedCash     *float64    `json:"offered_cash_amount,omitempty"`
	CreatedAt       time.Time   `json:"created_at"`
	UpdatedAt       time.Time   `json:"updated_at"`
	Items           []TradeItem `json:"items"`
	BuyerCompleted  bool        `json:"buyer_completed"`
	SellerCompleted bool        `json:"seller_completed"`
	CompletedAt     *time.Time  `json:"completed_at,omitempty"`
	BuyerName       string      `json:"buyer_name,omitempty"`
	SellerName      string      `json:"seller_name,omitempty"`
	ProductTitle    string      `json:"product_title,omitempty"`
}

// TradeItem represents an item offered in a trade
type TradeItem struct {
	ID        int       `json:"id"`
	TradeID   int       `json:"trade_id"`
	ProductID int       `json:"product_id"`
	OfferedBy string    `json:"offered_by" validate:"oneof=buyer seller"`
	CreatedAt time.Time `json:"created_at"`
	// Denormalized product details for display
	ProductTitle    string `json:"product_title,omitempty"`
	ProductStatus   string `json:"product_status,omitempty"`
	ProductImageURL string `json:"product_image_url,omitempty"`
}

// TradeCreate represents payload to create a trade
type TradeCreate struct {
	TargetProductID   int      `json:"target_product_id" validate:"required"`
	OfferedProductIDs []int    `json:"offered_product_ids" validate:"required,min=1,dive,gt=0"`
	Message           string   `json:"message"`
	OfferedCashAmount *float64 `json:"offered_cash_amount,omitempty"`
}

// TradeAction represents accept/decline/counter actions
type TradeAction struct {
	Action                   string   `json:"action" validate:"required,oneof=accept decline counter complete cancel"`
	Message                  string   `json:"message,omitempty"`
	CounterOfferedProductIDs []int    `json:"counter_offered_product_ids,omitempty"`
	CounterOfferedCashAmount *float64 `json:"counter_offered_cash_amount,omitempty"`
}

// ChatConversation represents a conversation between a buyer and seller about a product
type ChatConversation struct {
	ID        int       `json:"id"`
	ProductID int       `json:"product_id"`
	BuyerID   int       `json:"buyer_id"`
	SellerID  int       `json:"seller_id"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// ChatMessage represents a message within a conversation
type ChatMessage struct {
	ID             int        `json:"id"`
	ConversationID int        `json:"conversation_id"`
	SenderID       int        `json:"sender_id"`
	Content        string     `json:"content"`
	CreatedAt      time.Time  `json:"created_at"`
	ReadAt         *time.Time `json:"read_at,omitempty"`
}

// PremiumListing represents a premium listing
type PremiumListing struct {
	ID        int       `json:"id"`
	ProductID int       `json:"product_id"`
	StartDate time.Time `json:"start_date"`
	EndDate   time.Time `json:"end_date"`
	CreatedAt time.Time `json:"created_at"`
}

// SearchFilters represents search and filter parameters
type SearchFilters struct {
	Keyword    string   `query:"keyword"`
	MinPrice   *float64 `query:"min_price"`
	MaxPrice   *float64 `query:"max_price"`
	Premium    *bool    `query:"premium"`
	Status     string   `query:"status"`
	SellerID   *int     `query:"seller_id"`
	BarterOnly *bool    `query:"barter_only"`
	Location   string   `query:"location"`
	Page       int      `query:"page"`
	Limit      int      `query:"limit"`
}

// PaginatedResponse represents a paginated API response
type PaginatedResponse struct {
	Data       interface{} `json:"data"`
	Total      int         `json:"total"`
	Page       int         `json:"page"`
	Limit      int         `json:"limit"`
	TotalPages int         `json:"total_pages"`
}

// MarshalJSON ensures Data is a predictable non-null value (empty array) when nil or a typed nil slice.
func (p PaginatedResponse) MarshalJSON() ([]byte, error) {
	type alias PaginatedResponse
	a := alias(p)

	// If Data is a plain nil interface, set to empty slice
	if a.Data == nil {
		a.Data = []interface{}{}
		return json.Marshal(a)
	}

	// If Data is a typed nil slice (e.g., []Product(nil)), the interface itself is non-nil.
	// Detect that and replace with an empty slice to avoid JSON null.
	v := reflect.ValueOf(a.Data)
	if v.Kind() == reflect.Slice && v.IsNil() {
		a.Data = []interface{}{}
	}

	return json.Marshal(a)
}

// APIResponse represents a standard API response
type APIResponse struct {
	Success bool        `json:"success"`
	Message string      `json:"message,omitempty"`
	Data    interface{} `json:"data,omitempty"`
	Error   string      `json:"error,omitempty"`
}

// MarshalJSON ensures Data is present (at least a PaginatedResponse with empty data) when Success is true.
// This prevents frontend code from encountering response.data.data === null.
func (r APIResponse) MarshalJSON() ([]byte, error) {
	type alias APIResponse
	a := alias(r)
	if a.Success && a.Data == nil {
		// Provide a default PaginatedResponse so frontend can safely read data.data.length
		a.Data = PaginatedResponse{
			Data:       []interface{}{},
			Total:      0,
			Page:       1,
			Limit:      10,
			TotalPages: 0,
		}
	}
	return json.Marshal(a)
}

// JWTClaims represents JWT token claims
type JWTClaims struct {
	UserID int    `json:"user_id"`
	Email  string `json:"email"`
	Exp    int64  `json:"exp"`
}

// MarshalJSON ensures image_url is populated for compatibility with frontends expecting a single image.
func (p Product) MarshalJSON() ([]byte, error) {
	type alias Product
	a := alias(p)
	// If image_url is empty but image_urls has at least one element, set image_url to the first entry
	if a.ImageURL == "" && len(a.ImageURLs) > 0 {
		a.ImageURL = a.ImageURLs[0]
	}
	// Ensure nil slice becomes empty array in JSON (optional; StringArray.MarshalJSON already handles this)
	return json.Marshal(a)
}
