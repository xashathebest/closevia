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

// IntArray is a custom type for scanning JSON arrays of integers from SQL
type IntArray []int

// MarshalJSON ensures []int is marshalled as a JSON array
func (a IntArray) MarshalJSON() ([]byte, error) {
	return json.Marshal([]int(a))
}

// Scan implements the sql.Scanner interface for []int
func (a *IntArray) Scan(value interface{}) error {
	if value == nil {
		*a = IntArray{}
		return nil
	}
	switch v := value.(type) {
	case []byte:
		return json.Unmarshal(v, a)
	case string:
		return json.Unmarshal([]byte(v), a)
	default:
		return errors.New("unsupported type for IntArray")
	}
}

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
	ID                          int        `json:"id"`
	Slug                        string     `json:"slug,omitempty"` // Unique URL identifier
	Name                        string     `json:"name" validate:"required,min=2,max=255"`
	Email                       string     `json:"email" validate:"required,email"`
	Phone                       string     `json:"phone,omitempty"`
	PhoneVerified               bool       `json:"phone_verified,omitempty"`
	PasswordHash                string     `json:"-" validate:"required"`
	Role                        string     `json:"role" validate:"oneof=user admin"`
	Verified                    bool       `json:"verified"`
	IsOrganization              bool       `json:"is_organization"`
	OrgVerified                 bool       `json:"org_verified"`
	OrgName                     string     `json:"org_name,omitempty"`
	OrgHandle                   string     `json:"org_handle,omitempty"`
	OrgLogoURL                  string     `json:"org_logo_url,omitempty"`
	OrgCoverURL                 string     `json:"org_cover_url,omitempty"`
	OrgCategory                 string     `json:"org_category,omitempty"`
	OrgWebsite                  string     `json:"org_website,omitempty"`
	OrgLocation                 string     `json:"org_location,omitempty"`
	OrgContactEmail             string     `json:"org_contact_email,omitempty"`
	Department                  string     `json:"department,omitempty"`
	Bio                         string     `json:"bio,omitempty"`
	Badges                      IntArray   `json:"badges,omitempty"`
	ProfilePicture              string     `json:"profile_picture,omitempty"`
	LanguagePreference          string     `json:"language_preference,omitempty"`
	BackgroundImage             string     `json:"background_image,omitempty"`
	BackgroundPosition          string     `json:"background_position,omitempty"`
	Latitude                    *float64   `json:"latitude,omitempty"`
	Longitude                   *float64   `json:"longitude,omitempty"`
	HomeLatitude                *float64   `json:"home_latitude,omitempty"`  // Saved home address lat
	HomeLongitude               *float64   `json:"home_longitude,omitempty"` // Saved home address lng
	HomeAddress                 string     `json:"home_address,omitempty"`   // Human-readable home address
	IsPremium                   bool       `json:"is_premium"`
	PremiumTier                 string     `json:"premium_tier"` // "free", "plus", "pro"
	PremiumExpiresAt            *time.Time `json:"premium_expires_at,omitempty"`
	CreatedAt                   time.Time  `json:"created_at"`
	UpdatedAt                   time.Time  `json:"updated_at"`
	VerificationStatus          string     `json:"verification_status,omitempty"`
	SchoolName                  string     `json:"school_name,omitempty"`
	SchoolEmail                 string     `json:"school_email,omitempty"`
	AcademicProgram             string     `json:"academic_program,omitempty"`
	YearLevel                   string     `json:"year_level,omitempty"`
	SchoolEmailVerifiedAt       *time.Time `json:"school_email_verified_at,omitempty"`
	SchoolIDImagePath           string     `json:"school_id_image_path,omitempty"`
	VerificationRejectionReason string     `json:"verification_rejection_reason,omitempty"`
	EmailNotificationsEnabled   bool       `json:"email_notifications_enabled"`
	PushNotificationsEnabled    bool       `json:"push_notifications_enabled"`
	NotificationPreferences     string     `json:"notification_preferences,omitempty"`
	PasswordChangedAt           *time.Time `json:"password_changed_at,omitempty"`
	LastLogin                   *time.Time `json:"last_login,omitempty"`
	ActivityStatus              string     `json:"activity_status,omitempty"`
	Strikes                     int        `json:"strikes"`
	IsSuspended                 bool       `json:"is_suspended"`
	DisplayNameChangedAt        *time.Time `json:"display_name_changed_at,omitempty"`
	NameChangedAt               *time.Time `json:"name_changed_at,omitempty"`
	PhoneChangedAt              *time.Time `json:"phone_changed_at,omitempty"`
	EmailChangedAt              *time.Time `json:"email_changed_at,omitempty"`
}

// UserLogin represents login credentials
type UserLogin struct {
	Email    string `json:"email" validate:"required,email"`
	Password string `json:"password" validate:"required,min=6"`
}

// UserRegister represents registration data
type UserRegister struct {
	Name           string  `json:"name" validate:"required,min=2,max=255"`
	Email          string  `json:"email" validate:"required,email"`
	Phone          string  `json:"phone"`
	Password       string  `json:"password" validate:"required,min=6"`
	Role           string  `json:"role" validate:"omitempty,oneof=user admin"`
	IsOrganization bool    `json:"is_organization"`
	OrgName        string  `json:"org_name"`
	OrgLogoURL     string  `json:"org_logo_url"`
	Department     *string `json:"department"`
	Bio            string  `json:"bio"`
}

// ProductAnalytics represents popularity statistics for a listing
type ProductAnalytics struct {
	Views int    `json:"views"`
	Saves int    `json:"saves"`
	Rank  string `json:"rank"` // Percentile rank (e.g. "Top 5%")
}

// Organization represents a community organization or group
type Organization struct {
	ID          int    `json:"id"`
	Name        string `json:"name"`
	Slug        string `json:"slug"`
	LogoURL     string `json:"logo_url,omitempty"`
	Description string `json:"description,omitempty"`
}

// Product represents a product listing
type Product struct {
	ID                   int               `json:"id"`
	Slug                 string            `json:"slug,omitempty"` // SEO-friendly URL identifier
	Title                string            `json:"title" validate:"required,min=2,max=255"`
	Description          string            `json:"description"`
	Price                *float64          `json:"price,omitempty"`      // Optional for barter-only items
	ImageURLs            StringArray       `json:"image_urls,omitempty"` // Multiple images
	ImageURL             string            `json:"image_url,omitempty"`  // Single image for compatibility
	SellerID             int               `json:"seller_id"`
	SellerName           string            `json:"seller_name,omitempty"`
	SellerProfilePicture string            `json:"seller_profile_picture,omitempty"`
	Premium              bool              `json:"premium"`
	Status               string            `json:"status" validate:"oneof=available sold traded locked suspended deleted"`
	AllowBuying          bool              `json:"allow_buying"` // Whether buying is allowed
	BarterOnly           bool              `json:"barter_only"`  // Whether it's barter only
	Location             string            `json:"location,omitempty"`
	Condition            string            `json:"condition,omitempty" validate:"omitempty,oneof=New Like-New Used Fair"`
	EstimatedValueMin    *float64          `json:"estimated_value_min,omitempty"`
	EstimatedValueMax    *float64          `json:"estimated_value_max,omitempty"`
	ShowEstimatedValue   bool              `json:"show_estimated_value"`
	SuggestedValue       int               `json:"suggested_value,omitempty"`
	Value                *float64          `json:"value,omitempty"` // User-defined product value
	Category             string            `json:"category,omitempty"`
	LocationType         string            `json:"location_type,omitempty" validate:"omitempty,oneof=current_location pickup_location no_location"` // Type of product location setting
	PickupLatitude       *float64          `json:"pickup_latitude,omitempty"`
	PickupLongitude      *float64          `json:"pickup_longitude,omitempty"`
	PickupAddress        string            `json:"pickup_address,omitempty"`
	Wants                string            `json:"wants,omitempty"`
	WantedCategories     StringArray       `json:"wanted_categories,omitempty"`
	DesiredPrice         *float64          `json:"desired_price,omitempty"`
	DesiredProduct       string            `json:"desired_product,omitempty"`
	ItemType             string            `json:"item_type,omitempty"`
	Brand                string            `json:"brand,omitempty"`
	AuthenticityRisks    string            `json:"authenticity_risks,omitempty"`
	PriceReasoning       string            `json:"price_reasoning,omitempty"`
	Tags                 StringArray       `json:"tags,omitempty"`
	BiddingType          string            `json:"bidding_type,omitempty"`
	MaxItemsPerOffer     int               `json:"max_items_per_offer,omitempty"`
	Latitude             *float64          `json:"latitude,omitempty"`
	Longitude            *float64          `json:"longitude,omitempty"`
	VideoURL             string            `json:"video_url,omitempty"`
	Analytics            *ProductAnalytics `json:"analytics,omitempty"`
	Distance             string            `json:"distance,omitempty"` // Computed distance from viewer (e.g. "3.2 KM")
	CreatedAt            time.Time         `json:"created_at"`
	UpdatedAt            time.Time         `json:"updated_at"`
	WishlistCount        int               `json:"wishlist_count,omitempty"`
	WantCount            int               `json:"want_count"`
	OfferCount           int               `json:"offer_count"`
	ViewCount            int               `json:"view_count,omitempty"`
	BoostedAt            *time.Time        `json:"boosted_at,omitempty"`
	OrganizationTags     []Organization    `json:"organization_tags,omitempty"` // Tagged organizations
}

// ProductCreate represents data for creating a product
type ProductCreate struct {
	Title              string      `json:"title" validate:"required,min=2,max=255"`
	Description        string      `json:"description"`
	Price              *float64    `json:"price,omitempty"` // Optional for barter-only items
	ImageURLs          StringArray `json:"image_urls,omitempty"`
	Premium            bool        `json:"premium"`
	AllowBuying        bool        `json:"allow_buying"`
	BarterOnly         bool        `json:"barter_only"`
	Location           string      `json:"location,omitempty"`
	LocationType       string      `json:"location_type,omitempty" validate:"omitempty,oneof=current_location pickup_location no_location"` // Type of product location setting
	Condition          string      `json:"condition,omitempty" validate:"omitempty,oneof=New Like-New Used Fair"`
	Category           string      `json:"category,omitempty"`
	ShowEstimatedValue bool        `json:"show_estimated_value"`
	Value              *float64    `json:"value,omitempty"` // User-defined product value
	BiddingType        string      `json:"bidding_type,omitempty"`
	MaxItemsPerOffer   int         `json:"max_items_per_offer,omitempty"`
}

// ProductUpdate represents data for updating a product
type ProductUpdate struct {
	Title              *string      `json:"title,omitempty" validate:"omitempty,min=2,max=255"`
	Description        *string      `json:"description,omitempty"`
	Price              *float64     `json:"price,omitempty" validate:"omitempty,gt=0"`
	ImageURLs          *StringArray `json:"image_urls,omitempty"`
	Premium            *bool        `json:"premium,omitempty"`
	Status             *string      `json:"status,omitempty" validate:"omitempty,oneof=available sold traded locked suspended deleted"`
	AllowBuying        *bool        `json:"allow_buying,omitempty"`
	BarterOnly         *bool        `json:"barter_only,omitempty"`
	Location           *string      `json:"location,omitempty"`
	Condition          *string      `json:"condition,omitempty" validate:"omitempty,oneof=New Like-New Used Fair"`
	Category           *string      `json:"category,omitempty"`
	ShowEstimatedValue *bool        `json:"show_estimated_value,omitempty"`
	BiddingType        *string      `json:"bidding_type,omitempty" validate:"omitempty,oneof=none blind open"`
	Value              *float64     `json:"value,omitempty"` // User-defined product value
	MaxItemsPerOffer   *int         `json:"max_items_per_offer,omitempty"`
}

// ProductVote represents a user's vote on a product price
type ProductVote struct {
	ID        int       `json:"id"`
	ProductID int       `json:"product_id"`
	UserID    int       `json:"user_id"`
	Vote      string    `json:"vote"` // "under" or "over"
	CreatedAt time.Time `json:"created_at"`
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
	Status          string      `json:"status" validate:"oneof=pending accepted accepted_by_one accepted_by_both declined countered active ongoing awaiting_confirmation completed auto_completed cancelled cancelled_due_to_conflict expired broken history pending_multiway multiway_active"`
	Message         string      `json:"message,omitempty"`
	OfferedCash     *float64    `json:"offered_cash_amount,omitempty"`
	CreatedAt       time.Time   `json:"created_at"`
	UpdatedAt       time.Time   `json:"updated_at"`
	Items           []TradeItem `json:"items"`
	BuyerCompleted  bool        `json:"buyer_completed"`
	SellerCompleted bool        `json:"seller_completed"`
	BuyerAccepted   bool        `json:"buyer_accepted"`
	SellerAccepted  bool        `json:"seller_accepted"`
	CompletedAt     *time.Time  `json:"completed_at,omitempty"`
	// Timeout-based completion fields
	FirstCompletionAt         *time.Time `json:"first_completion_at,omitempty"`
	AwaitingConfirmationSince *time.Time `json:"awaiting_confirmation_since,omitempty"`
	AutoCompletedAt           *time.Time `json:"auto_completed_at,omitempty"`
	// Trade option and delivery fields
	TradeOption     string `json:"trade_option,omitempty" validate:"omitempty,oneof=meetup delivery"`
	MeetingType     string `json:"meeting_type,omitempty" validate:"omitempty,oneof=meetup pickup"`
	DeliveryAddress string `json:"delivery_address,omitempty"`
	// Delivery state fields (for progress tracking and persistence)
	DeliveryType            string `json:"delivery_type,omitempty" validate:"omitempty,oneof=standard express meetup"`
	PaymentMethod           string `json:"payment_method,omitempty" validate:"omitempty,oneof=gcash cod wallet upfront"`
	PaymentConfirmed        bool   `json:"payment_confirmed"`
	DeliveryInstructions    string `json:"delivery_instructions,omitempty"`
	ProofOfDelivery         string `json:"proof_of_delivery,omitempty"` // Base64 encoded image
	BuyerConfirmedReceipt   bool   `json:"buyer_confirmed_receipt"`
	SellerConfirmedDelivery bool   `json:"seller_confirmed_delivery"`
	// Review and proof fields
	BuyerRating         *int   `json:"buyer_rating,omitempty"`
	SellerRating        *int   `json:"seller_rating,omitempty"`
	BuyerFeedback       string `json:"buyer_feedback,omitempty"`
	SellerFeedback      string `json:"seller_feedback,omitempty"`
	BuyerProofURL       string `json:"buyer_proof_url,omitempty"`
	SellerProofURL      string `json:"seller_proof_url,omitempty"`
	BuyerPhotoIsCamera  bool   `json:"buyer_photo_is_camera"`
	SellerPhotoIsCamera bool   `json:"seller_photo_is_camera"`
	// Meetup-related fields
	MeetupLocation        string `json:"meetup_location,omitempty"`
	MeetupTime            string `json:"meetup_time,omitempty"`
	BuyerMeetupConfirmed  bool   `json:"buyer_meetup_confirmed"`
	SellerMeetupConfirmed bool   `json:"seller_meetup_confirmed"`
	BuyerMeetupLocation   string `json:"buyer_meetup_location,omitempty"`
	BuyerMeetupTime       string `json:"buyer_meetup_time,omitempty"`
	SellerMeetupLocation  string `json:"seller_meetup_location,omitempty"`
	SellerMeetupTime      string `json:"seller_meetup_time,omitempty"`
	BuyerName             string `json:"buyer_name,omitempty"`
	SellerName            string `json:"seller_name,omitempty"`
	ProductTitle          string `json:"product_title,omitempty"`
	ProductImageURL       string `json:"product_image_url,omitempty"`
	// Pickup address of the target (seller's) product, surfaced at trade level
	// so the pickup UI can show it without relying on trade_items rows.
	TargetProductPickupAddress string `json:"target_product_pickup_address,omitempty"`
	BuyerMet                   bool   `json:"buyer_met"`
	SellerMet                  bool   `json:"seller_met"`
	// Enhanced review system fields
	BuyerReviewCreatedAt      *time.Time    `json:"buyer_review_created_at,omitempty"`  // Timestamp of initial review
	SellerReviewCreatedAt     *time.Time    `json:"seller_review_created_at,omitempty"` // Timestamp of initial review
	BuyerInitialReviewLocked  bool          `json:"buyer_initial_review_locked"`        // Prevents tampering with initial review
	SellerInitialReviewLocked bool          `json:"seller_initial_review_locked"`       // Prevents tampering with initial review
	ReviewHistory             []TradeReview `json:"reviews,omitempty"`                  // Full review history (initial + followups)
	// Counter offer fields
	CounteredBy   int  `json:"countered_by,omitempty"`
	ParentTradeID *int `json:"parent_trade_id,omitempty"`
}

// TradeItem represents an item offered in a trade
type TradeItem struct {
	ID        int       `json:"id"`
	TradeID   int       `json:"trade_id"`
	ProductID int       `json:"product_id"`
	OfferedBy string    `json:"offered_by" validate:"oneof=buyer seller"`
	CreatedAt time.Time `json:"created_at"`
	// Denormalized product details for display
	ProductTitle         string `json:"product_title,omitempty"`
	ProductStatus        string `json:"product_status,omitempty"`
	ProductImageURL      string `json:"product_image_url,omitempty"`
	ProductPickupAddress string `json:"product_pickup_address,omitempty"`
}

// TradeReview represents a review submitted by a user for a trade
type TradeReview struct {
	ID              int       `json:"id"`
	TradeID         int       `json:"trade_id"`
	ReviewerID      int       `json:"reviewer_id"`
	Rating          int       `json:"rating" validate:"min=1,max=5"` // 1-5 stars
	Feedback        string    `json:"feedback,omitempty"`
	ProofURL        string    `json:"proof_url,omitempty"`
	IsCameraPhoto   bool      `json:"is_camera_photo"`
	IsFollowup      bool      `json:"is_followup"`       // false=initial, true=followup
	IsAutoGenerated bool      `json:"is_auto_generated"` // true if auto-completed at 3 days with 5-star
	RatingDelta     int       `json:"rating_delta"`      // For followups only: positive=increase, negative=decrease
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
	ReviewerName    string    `json:"reviewer_name,omitempty"`   // Denormalized for display
	ReviewerAvatar  string    `json:"reviewer_avatar,omitempty"` // Denormalized for display
}

// TradeReviewCreate represents payload for submitting a review
type TradeReviewCreate struct {
	Rating        int    `json:"rating" validate:"required,min=1,max=5"`
	Feedback      string `json:"feedback" validate:"required,min=1"`
	ProofURL      string `json:"proof_url,omitempty"`
	IsCameraPhoto bool   `json:"is_camera_photo"`
	IsFollowup    bool   `json:"is_followup"` // true to submit as follow-up instead of initial
}

// TradeReviewUpdate represents updating a followup review (not initial)
type TradeReviewUpdate struct {
	Rating        *int    `json:"rating" validate:"omitempty,min=1,max=5"`
	Feedback      *string `json:"feedback" validate:"omitempty,min=1"`
	ProofURL      *string `json:"proof_url,omitempty"`
	IsCameraPhoto *bool   `json:"is_camera_photo"`
}

// ReviewSummary shows initial vs latest review for a trader
type ReviewSummary struct {
	InitialReview *TradeReview `json:"initial_review,omitempty"` // Locked, immutable
	LatestReview  *TradeReview `json:"latest_review,omitempty"`  // May be same as initial or a followup
	HasFollowup   bool         `json:"has_followup"`             // Whether latest is different from initial
	RatingTrend   string       `json:"rating_trend"`             // "up", "down", "stable", or "auto"
	RatingChange  int          `json:"rating_change"`            // positive=increase, negative=decrease, 0=same
	FollowupCount int          `json:"followup_count"`           // Number of followup reviews
}

// TradeCreate represents payload to create a trade
type TradeCreate struct {
	TargetProductID      int      `json:"target_product_id" validate:"required"`
	OfferedProductIDs    []int    `json:"offered_product_ids" validate:"omitempty,dive,gt=0"`
	Message              string   `json:"message"`
	OfferedCashAmount    *float64 `json:"offered_cash_amount,omitempty"`
	TradeOption          string   `json:"trade_option" validate:"required,oneof=meetup delivery"`
	MeetingType          string   `json:"meeting_type" validate:"omitempty,oneof=meetup pickup"`
	DeliveryAddress      string   `json:"delivery_address,omitempty"`
	DeliveryType         string   `json:"delivery_type,omitempty" validate:"omitempty,oneof=standard express"`
	DeliveryInstructions string   `json:"delivery_instructions,omitempty"`
	PaymentMethod              string `json:"payment_method,omitempty" validate:"omitempty,oneof=cod upfront"`
	AdditionalTargetProductIDs []int  `json:"additional_target_product_ids,omitempty" validate:"omitempty,dive,gt=0"`
}

// TradeAction represents accept/decline/counter actions
type TradeAction struct {
	Action                   string   `json:"action" validate:"required,oneof=accept decline counter edit_offer complete cancel confirm_meetup confirm_meetup_done reset_meetup_selection update_delivery_state request_option_change approve_option_change reject_option_change convert_to_multiway"`
	OfferedProductIDs        []int    `json:"offered_product_ids,omitempty"`
	OfferedCashAmount        *float64 `json:"offered_cash_amount,omitempty"`
	Message                  string   `json:"message,omitempty"`
	CounterOfferedProductIDs []int    `json:"counter_offered_product_ids,omitempty"`
	CounterOfferedCashAmount *float64 `json:"counter_offered_cash_amount,omitempty"`
	TradeOption              string   `json:"trade_option,omitempty" validate:"omitempty,oneof=meetup delivery"`
	MeetingType              string   `json:"meeting_type,omitempty" validate:"omitempty,oneof=meetup pickup"`
	MeetupLocation           string   `json:"meetup_location,omitempty"`
	MeetupTime               string   `json:"meetup_time,omitempty"`
	MeetupDate               string   `json:"meetup_date,omitempty"`
	RequestedOption          string   `json:"requested_option,omitempty"`
	DeliveryAddress          string   `json:"delivery_address,omitempty"`
	PaymentMethod            string   `json:"payment_method,omitempty"`
	CancellationReason       string   `json:"cancellation_reason,omitempty"`
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

// Comment represents a comment on a product listing
type Comment struct {
	ID            int       `json:"id"`
	ProductID     int       `json:"product_id"`
	UserID        int       `json:"user_id"`
	Content       string    `json:"content" validate:"required"`
	CreatedAt     time.Time `json:"created_at"`
	UpdatedAt     time.Time `json:"updated_at"`
	CommenterName string    `json:"commenter_name,omitempty"`
}

// Wishlist represents a user's wishlist item
type Wishlist struct {
	ID        int       `json:"id"`
	UserID    int       `json:"user_id"`
	ProductID int       `json:"product_id"`
	CreatedAt time.Time `json:"created_at"`
	Product   *Product  `json:"product,omitempty"`
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

// Rider represents a delivery rider
type Rider struct {
	ID              int        `json:"id"`
	UserID          int        `json:"user_id"`
	Name            string     `json:"name"`
	VehicleType     string     `json:"vehicle_type" validate:"oneof=motorcycle bicycle car"`
	VehiclePlate    string     `json:"vehicle_plate,omitempty"`
	Phone           string     `json:"phone"`
	Rating          float64    `json:"rating"`
	IsActive        bool       `json:"is_active"`
	Status          string     `json:"status"`
	LicenseImageURL string     `json:"license_image_url,omitempty"`
	SelfieImageURL  string     `json:"selfie_image_url,omitempty"`
	ContactNumber   string     `json:"contact_number,omitempty"`
	FullName        string     `json:"full_name,omitempty"`
	RejectionReason string     `json:"rejection_reason,omitempty"`
	ReviewedAt      *time.Time `json:"reviewed_at,omitempty"`
	ReviewedBy      *int       `json:"reviewed_by,omitempty"`
	Latitude        *float64   `json:"latitude,omitempty"`
	Longitude       *float64   `json:"longitude,omitempty"`
	CreatedAt       time.Time  `json:"created_at"`
	UpdatedAt       time.Time  `json:"updated_at"`
}

// Delivery represents a delivery request
type Delivery struct {
	ID                  int        `json:"id"`
	UserID              int        `json:"user_id"`
	TradeID             *int       `json:"trade_id,omitempty"` // Optional: can be standalone delivery
	DeliveryType        string     `json:"delivery_type" validate:"oneof=standard express"`
	Status              string     `json:"status" validate:"oneof=pending claimed picked_up in_transit delivered cancelled"`
	RiderID             *int       `json:"rider_id,omitempty"`
	PickupLatitude      *float64   `json:"pickup_latitude,omitempty"`
	PickupLongitude     *float64   `json:"pickup_longitude,omitempty"`
	PickupAddress       string     `json:"pickup_address"`
	DeliveryLatitude    *float64   `json:"delivery_latitude,omitempty"`
	DeliveryLongitude   *float64   `json:"delivery_longitude,omitempty"`
	DeliveryAddress     string     `json:"delivery_address"`
	SpecialInstructions string     `json:"special_instructions,omitempty"`
	TotalCost           float64    `json:"total_cost"`
	EstimatedETA        *time.Time `json:"estimated_eta,omitempty"`
	ItemCount           int        `json:"item_count"` // Number of items in delivery
	IsFragile           bool       `json:"is_fragile"` // Flag for fragile items
	ClaimedAt           *time.Time `json:"claimed_at,omitempty"`
	PickedUpAt          *time.Time `json:"picked_up_at,omitempty"`
	InTransitAt         *time.Time `json:"in_transit_at,omitempty"`
	DeliveredAt         *time.Time `json:"delivered_at,omitempty"`
	CreatedAt           time.Time  `json:"created_at"`
	UpdatedAt           time.Time  `json:"updated_at"`
	// Denormalized fields for display
	UserName       string   `json:"user_name,omitempty"`
	ReceiverName   string   `json:"receiver_name,omitempty"`
	RiderName      string   `json:"rider_name,omitempty"`
	RiderPhone     string   `json:"rider_phone,omitempty"`
	RiderVehicle   string   `json:"rider_vehicle,omitempty"`
	RiderRating    *float64 `json:"rider_rating,omitempty"`
	RiderLatitude  *float64 `json:"rider_latitude,omitempty"`
	RiderLongitude *float64 `json:"rider_longitude,omitempty"`
	// Items included in this delivery
	Items []DeliveryItem `json:"items,omitempty"`
	// Stops for job execution (pickup and delivery stops)
	Stops []DeliveryStop `json:"stops,omitempty"`
	// Batch window fields (for standard deliveries)
	BatchID              *string    `json:"batch_id,omitempty"`
	BatchWindowExpiresAt *time.Time `json:"batch_window_expires_at,omitempty"`
	IsBatching           bool       `json:"is_batching,omitempty"`
	BatchCountdown       int        `json:"batch_countdown,omitempty"` // seconds remaining
	BatchSize            int        `json:"batch_size,omitempty"`
	// Card display fields (calculated)
	DistanceKm       float64 `json:"distance_km,omitempty"`
	EstimatedMinutes int     `json:"estimated_minutes,omitempty"`
	SenderFee        float64 `json:"sender_fee,omitempty"`
	ReceiverFee      float64 `json:"receiver_fee,omitempty"`
	RiderCut         float64 `json:"rider_cut,omitempty"`
}

// DeliveryItem represents an item in a delivery
type DeliveryItem struct {
	ID          int       `json:"id"`
	DeliveryID  int       `json:"delivery_id"`
	ProductID   int       `json:"product_id"`
	ProductName string    `json:"product_name,omitempty"`
	IsFragile   bool      `json:"is_fragile"`
	CreatedAt   time.Time `json:"created_at"`
}

// DeliveryStop represents a pickup or delivery stop in a multi-stop job
type DeliveryStop struct {
	ID             int        `json:"id"`
	DeliveryID     int        `json:"delivery_id"`
	StopNumber     int        `json:"stop_number"`
	StopType       string     `json:"stop_type"` // pickup or delivery
	ContactName    string     `json:"contact_name"`
	ContactPhone   string     `json:"contact_phone"`
	Address        string     `json:"address"`
	Latitude       *float64   `json:"latitude"`
	Longitude      *float64   `json:"longitude,omitempty"`
	ItemQRCode     string     `json:"item_qr_code,omitempty"`
	FeeAmount      float64    `json:"fee_amount"`
	Status         string     `json:"status"` // pending, arrived, qr_scanned, fee_collected, completed
	ArrivedAt      *time.Time `json:"arrived_at,omitempty"`
	QRScannedAt    *time.Time `json:"qr_scanned_at,omitempty"`
	FeeCollectedAt *time.Time `json:"fee_collected_at,omitempty"`
	CompletedAt    *time.Time `json:"completed_at,omitempty"`
	PhotoURL       string     `json:"photo_url,omitempty"`
	CreatedAt      time.Time  `json:"created_at"`
	UpdatedAt      time.Time  `json:"updated_at"`
}

// RiderCashCollection represents a cash collection event at a stop
type RiderCashCollection struct {
	ID             int       `json:"id"`
	RiderID        int       `json:"rider_id"`
	DeliveryID     int       `json:"delivery_id"`
	StopID         int       `json:"stop_id"`
	CollectionType string    `json:"collection_type"` // pickup_fee or delivery_fee
	Amount         float64   `json:"amount"`
	CollectedAt    time.Time `json:"collected_at"`
}

// RiderLedger represents the rider's cash tracking
type RiderLedger struct {
	ID                     int        `json:"id"`
	RiderID                int        `json:"rider_id"`
	TotalCashCollected     float64    `json:"total_cash_collected"`
	RemittanceOwed         float64    `json:"remittance_owed"`
	TakeHome               float64    `json:"take_home"`
	TotalRemittancePaid    float64    `json:"total_remittance_paid"`
	RemittanceThreshold    float64    `json:"remittance_threshold"`
	RemittancePaidProgress float64    `json:"remittance_paid_progress"`
	FreeSlotsRemaining     int        `json:"free_slots_remaining"`
	TotalFreeSlotsUsed     int        `json:"total_free_slots_used"`
	LastRemittanceAt       *time.Time `json:"last_remittance_at,omitempty"`
	IsLockedForRemittance  bool       `json:"is_locked_for_remittance"`
	CreatedAt              time.Time  `json:"created_at"`
	UpdatedAt              time.Time  `json:"updated_at"`
}

// RiderRemittancePayment represents a remittance payment submission
type RiderRemittancePayment struct {
	ID              int        `json:"id"`
	RiderID         int        `json:"rider_id"`
	AmountPaid      float64    `json:"amount_paid"`
	PaymentMethod   string     `json:"payment_method"`
	PaymentProofURL string     `json:"payment_proof_url,omitempty"`
	Status          string     `json:"status"` // pending, verified, rejected
	VerifiedBy      *int       `json:"verified_by,omitempty"`
	VerifiedAt      *time.Time `json:"verified_at,omitempty"`
	RejectionReason string     `json:"rejection_reason,omitempty"`
	CreatedAt       time.Time  `json:"created_at"`
}

// DeliveryRequest represents a request to create a delivery
type DeliveryRequest struct {
	TradeID             *int     `json:"trade_id,omitempty"`
	DeliveryType        string   `json:"delivery_type" validate:"required,oneof=standard express"`
	PickupLatitude      *float64 `json:"pickup_latitude,omitempty"`
	PickupLongitude     *float64 `json:"pickup_longitude,omitempty"`
	PickupAddress       string   `json:"pickup_address"`
	DeliveryLatitude    *float64 `json:"delivery_latitude,omitempty"`
	DeliveryLongitude   *float64 `json:"delivery_longitude,omitempty"`
	DeliveryAddress     string   `json:"delivery_address"`
	SpecialInstructions string   `json:"special_instructions,omitempty"`
	ProductIDs          []int    `json:"product_ids" validate:"required,min=1"` // Products to deliver
}

// DeliveryUpdate represents an update to delivery status
type DeliveryUpdate struct {
	Status       *string    `json:"status,omitempty" validate:"omitempty,oneof=claimed picked_up in_transit delivered cancelled"`
	RiderID      *int       `json:"rider_id,omitempty"`
	Latitude     *float64   `json:"latitude,omitempty"`
	Longitude    *float64   `json:"longitude,omitempty"`
	EstimatedETA *time.Time `json:"estimated_eta,omitempty"`
	// Phase 3 enforcement fields
	QRCode   *string `json:"qr_code,omitempty"`   // QR code scanned for verification
	PhotoURL *string `json:"photo_url,omitempty"` // Photo proof URL (required for delivery step)
}

// JWTClaims represents JWT token claims
type JWTClaims struct {
	UserID int    `json:"user_id"`
	Email  string `json:"email"`
	Exp    int64  `json:"exp"`
}

// ListingReport represents a report against a product listing for moderation
type ListingReport struct {
	ID         int       `json:"id"`
	ProductID  int       `json:"product_id"`
	ReporterID int       `json:"reporter_id"`
	Reason     string    `json:"reason" validate:"required,oneof=wrong_category prohibited_item fake_or_scam inappropriate_photo other"`
	Details    string    `json:"details,omitempty"` // Optional detailed explanation
	Status     string    `json:"status" validate:"oneof=pending reviewed"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
	// Denormalized fields for display
	ProductTitle   string `json:"product_title,omitempty"`
	ReporterName   string `json:"reporter_name,omitempty"`
	ReporterAvatar string `json:"reporter_avatar,omitempty"`
}

// ListingReportCreate represents payload to create a listing report
type ListingReportCreate struct {
	ProductID int    `json:"product_id" validate:"required"`
	Reason    string `json:"reason" validate:"required,oneof=wrong_category prohibited_item fake_or_scam inappropriate_photo other"`
	Details   string `json:"details,omitempty"`
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

// TrustFactor represents a single factor in the trust score breakdown
type TrustFactor struct {
	Label  string `json:"label"`
	Status string `json:"status"` // "pass", "warn", "fail"
	Points int    `json:"points"` // Points earned for this factor
	Max    int    `json:"max"`    // Maximum possible points
}

// SellerStats represents seller statistics for display on product pages
type SellerStats struct {
	UserID           int                 `json:"user_id"`
	AvgRating        float64             `json:"avg_rating"`
	PositivePercent  float64             `json:"positive_percent"`
	TotalTrades      int                 `json:"total_trades"`
	AvgResponseTime  string              `json:"avg_response_time"`
	TotalFeedback    int                 `json:"total_feedback"`
	ResponseMetric   string              `json:"response_metric,omitempty"`   // "excellent", "good", etc.
	MemberSinceYear  int                 `json:"member_since_year,omitempty"` // Year user joined
	CompletedTrades  int                 `json:"completed_trades,omitempty"`
	CancelledTrades  int                 `json:"cancelled_trades,omitempty"`
	PendingTrades    int                 `json:"pending_trades,omitempty"`
	TrustScore       int                 `json:"trust_score"`               // 0-100 calculated trust score
	TrustLevel       string              `json:"trust_level"`               // "trusted", "new", "risky"
	ReportCount      int                 `json:"report_count"`              // Number of reviewed/resolved reports
	HasReports       bool                `json:"has_reports"`               // Whether user has been reported
	TrustFactors     []TrustFactor       `json:"trust_factors,omitempty"`   // Detailed breakdown of trust score
	ConductSummary   *UserConductSummary `json:"conduct_summary,omitempty"` // Trade quality & conduct grades
	HasActiveDispute bool                `json:"has_active_dispute"`        // Whether user has an active unresolved dispute
}

// Report represents a trader report for policy violations
type Report struct {
	ID              int       `json:"id"`
	ReporterID      int       `json:"reporter_id"`
	ReportedUserID  int       `json:"reported_user_id"`
	ProductID       *int      `json:"product_id,omitempty"`
	Reason          string    `json:"reason"`
	Description     string    `json:"description"`
	Status          string    `json:"status"`
	ReviewerID      *int      `json:"reviewer_id,omitempty"`
	ReviewerComment *string   `json:"reviewer_comment,omitempty"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`

	// Related data for context
	Reporter     *User    `json:"reporter,omitempty"`
	ReportedUser *User    `json:"reported_user,omitempty"`
	Product      *Product `json:"product,omitempty"`
}

// ReportCreate represents payload for submitting a new trader report
type ReportCreate struct {
	ReportedUserID int    `json:"reported_user_id" validate:"required"`
	ProductID      *int   `json:"product_id,omitempty"`
	Reason         string `json:"reason" validate:"required,oneof=inappropriate counterfeit spam scam"`
	Description    string `json:"description" validate:"required,min=10,max=1000"`
}

// ReportUpdate represents data for updating report status (admin use only)
type ReportUpdate struct {
	Status          string `json:"status" validate:"required,oneof=pending reviewed dismissed resolved"`
	ReviewerComment string `json:"reviewer_comment,omitempty"`
}

// Campaign represents a popup ad campaign
type Campaign struct {
	ID          int        `json:"id"`
	Title       string     `json:"title" validate:"required"`
	Description string     `json:"description,omitempty"`
	ImageURL    string     `json:"image_url,omitempty"`
	ButtonText  string     `json:"button_text,omitempty"`
	ButtonLink  string     `json:"button_link,omitempty"`
	StartDate   *time.Time `json:"start_date,omitempty"`
	EndDate     *time.Time `json:"end_date,omitempty"`
	TargetUsers string     `json:"target_users" validate:"oneof=all new verified unverified"`
	Frequency   string     `json:"frequency" validate:"oneof=once_per_user once_per_day every_login"`
	IsActive    bool       `json:"is_active"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
}

// CampaignCreate represents data for creating a campaign
type CampaignCreate struct {
	Title       string     `json:"title" validate:"required"`
	Description string     `json:"description,omitempty"`
	ImageURL    string     `json:"image_url,omitempty"`
	ButtonText  string     `json:"button_text,omitempty"`
	ButtonLink  string     `json:"button_link,omitempty"`
	StartDate   *time.Time `json:"start_date,omitempty"`
	EndDate     *time.Time `json:"end_date,omitempty"`
	TargetUsers string     `json:"target_users" validate:"required,oneof=all new verified unverified"`
	Frequency   string     `json:"frequency" validate:"required,oneof=once_per_user once_per_day every_login"`
	IsActive    bool       `json:"is_active"`
}

// CampaignUpdate represents data for updating a campaign
type CampaignUpdate struct {
	Title       *string    `json:"title,omitempty"`
	Description *string    `json:"description,omitempty"`
	ImageURL    *string    `json:"image_url,omitempty"`
	ButtonText  *string    `json:"button_text,omitempty"`
	ButtonLink  *string    `json:"button_link,omitempty"`
	StartDate   *time.Time `json:"start_date,omitempty"`
	EndDate     *time.Time `json:"end_date,omitempty"`
	TargetUsers *string    `json:"target_users,omitempty" validate:"omitempty,oneof=all new verified unverified"`
	Frequency   *string    `json:"frequency,omitempty" validate:"omitempty,oneof=once_per_user once_per_day every_login"`
	IsActive    *bool      `json:"is_active,omitempty"`
}

// TradeGrade represents a per-trade quality and conduct grade given by one party to the other
type TradeGrade struct {
	ID            int       `json:"id"`
	TradeID       int       `json:"trade_id"`
	GraderID      int       `json:"grader_id"`
	GradedUserID  int       `json:"graded_user_id"`
	Communication int       `json:"communication"` // 1-5
	ItemAccuracy  int       `json:"item_accuracy"` // 1-5
	Punctuality   int       `json:"punctuality"`   // 1-5
	Overall       int       `json:"overall"`       // 1-5
	Comment       string    `json:"comment,omitempty"`
	CreatedAt     time.Time `json:"created_at"`
}

// TradeGradeCreate represents the payload for submitting a trade grade
type TradeGradeCreate struct {
	Communication int    `json:"communication" validate:"required,min=1,max=5"`
	ItemAccuracy  int    `json:"item_accuracy" validate:"required,min=1,max=5"`
	Punctuality   int    `json:"punctuality" validate:"required,min=1,max=5"`
	Overall       int    `json:"overall" validate:"required,min=1,max=5"`
	Comment       string `json:"comment,omitempty" validate:"max=500"`
}

// ConductGrade holds the averaged grade for a single category
type ConductGrade struct {
	Category string  `json:"category"`
	Avg      float64 `json:"avg"`
	Count    int     `json:"count"`
}

// UserConductSummary represents the aggregated conduct profile for a user
type UserConductSummary struct {
	UserID           int            `json:"user_id"`
	LetterGrade      string         `json:"letter_grade"` // A+, A, B+, B, C, D, F
	OverallAvg       float64        `json:"overall_avg"`  // 0.0-5.0
	TotalGrades      int            `json:"total_grades"`
	Categories       []ConductGrade `json:"categories"`
	CancellationRate float64        `json:"cancellation_rate"` // 0.0-1.0
	DisputeRate      float64        `json:"dispute_rate"`      // 0.0-1.0
}

// DisputeEscalation represents an escalation case for admin review
type DisputeEscalation struct {
	ID             int       `json:"id"`
	DisputeID      int       `json:"dispute_id"`
	TradeID        int       `json:"trade_id"`
	RaisedByID     int       `json:"raised_by_id"`
	ReportedUserID int       `json:"reported_user_id"`
	Reason         string    `json:"reason"`
	Status         string    `json:"status"` // open, under_review, resolved
	AssignedToID   *int      `json:"assigned_to_id"`
	SLADueAt       time.Time `json:"sla_due_at"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

// EscalationQueueItem represents a summary item in the admin queue
type EscalationQueueItem struct {
	ID               int       `json:"id"`
	DisputeID        int       `json:"dispute_id"`
	TradeID          int       `json:"trade_id"`
	RaisedByName     string    `json:"raised_by_name"`
	RaisedByID       int       `json:"raised_by_id"`
	ReportedUserName string    `json:"reported_user_name"`
	ReportedUserID   int       `json:"reported_user_id"`
	Reason           string    `json:"reason"`
	Status           string    `json:"status"`
	AssignedToID     *int      `json:"assigned_to_id"`
	AssignedToName   *string   `json:"assigned_to_name"`
	SLADueAt         time.Time `json:"sla_due_at"`
	SLAStatus        string    `json:"sla_status"` // on_track, warning, overdue
	CreatedAt        time.Time `json:"created_at"`
	HoursUntilDue    float64   `json:"hours_until_due"`
	IsOverdue        bool      `json:"is_overdue"`
}

// EscalationEvidence represents a piece of evidence attached to an escalation
type EscalationEvidence struct {
	ID           int       `json:"id"`
	EscalationID int       `json:"escalation_id"`
	EvidenceType string    `json:"evidence_type"` // photo, chat_transcript
	EvidenceURL  *string   `json:"evidence_url"`
	EvidenceData *string   `json:"evidence_data"` // JSON for chat transcripts
	UploadedByID int       `json:"uploaded_by_id"`
	CreatedAt    time.Time `json:"created_at"`
}

// EscalationResolution represents the final resolution of an escalation
type EscalationResolution struct {
	ID                int       `json:"id"`
	EscalationID      int       `json:"escalation_id"`
	ResolvedByAdminID int       `json:"resolved_by_admin_id"`
	OutcomeType       string    `json:"outcome_type"` // proceed, cancel_return_strike, suspend_pending, partial_refund, warning_only, conditional_strike, split_resolution
	RefundAmount      *float64  `json:"refund_amount"`
	Notes             *string   `json:"notes"`
	ResolvedAt        time.Time `json:"resolved_at"`
}

// EscalationDetail represents the full detail view of an escalation with evidence and resolution
type EscalationDetail struct {
	Escalation *DisputeEscalation    `json:"escalation"`
	Evidence   []*EscalationEvidence `json:"evidence"`
	Resolution *EscalationResolution `json:"resolution"`
}

// EscalationStats represents admin dashboard statistics
type EscalationStats struct {
	OpenCount           int     `json:"open_count"`
	UnderReviewCount    int     `json:"under_review_count"`
	OverdueCount        int     `json:"overdue_count"`
	AvgResolutionHours  float64 `json:"avg_resolution_hours"`
	MedianResolutionHrs float64 `json:"median_resolution_hours"`
	TotalResolved       int     `json:"total_resolved"`
}

// EscalationDetail response wrapper
type PaginatedEscalationQueue struct {
	Items      []*EscalationQueueItem `json:"items"`
	Total      int                    `json:"total"`
	Page       int                    `json:"page"`
	Limit      int                    `json:"limit"`
	TotalPages int                    `json:"total_pages"`
}

// PeerTag represents a tag given by one user to another after a completed trade
type PeerTag struct {
	ID         int       `json:"id"`
	TradeID    int       `json:"trade_id"`
	GiverID    int       `json:"giver_id"`
	ReceiverID int       `json:"receiver_id"`
	TagName    string    `json:"tag_name"`
	CreatedAt  time.Time `json:"created_at"`
}

// PeerTagCreate represents the request payload for creating a peer tag
type PeerTagCreate struct {
	TradeID int    `json:"trade_id" validate:"required"`
	TagName string `json:"tag_name" validate:"required,oneof=Item as described On time Friendly Safe meetup spot Smooth delivery Responsive"`
}

// PeerTagCount represents the count of a specific tag for a user
type PeerTagCount struct {
	TagName string `json:"tag_name"`
	Count   int    `json:"count"`
}

// PeerTagProfile represents all peer tags and their counts for a user
type PeerTagProfile struct {
	UserID int            `json:"user_id"`
	Tags   []PeerTagCount `json:"tags"`
	Total  int            `json:"total"` // Total number of tags given by all peers
}
