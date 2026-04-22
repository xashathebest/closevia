export interface User {
  id: number
  slug?: string // Unique URL identifier
  name: string
  email: string
  phone?: string
  phone_verified?: boolean
  role: string
  verified: boolean
  profile_picture?: string
  is_organization?: boolean
  org_verified?: boolean
  org_name?: string
  org_handle?: string
  org_logo_url?: string
  org_cover_url?: string
  org_category?: string
  org_website?: string
  org_location?: string
  org_contact_email?: string
  background_image?: string
  background_position?: string
  department?: string
  bio?: string
  badges?: number[]
  created_at: string
  updated_at: string
  response_score?: number
  response_rating?: 'excellent' | 'good' | 'average' | 'poor'
  latitude?: number
  longitude?: number
  home_latitude?: number   // Saved home address latitude
  home_longitude?: number  // Saved home address longitude
  home_address?: string    // Human-readable home address label
  is_premium?: boolean
  premium_tier?: 'free' | 'plus' | 'pro'
  verification_status?: 'not_verified' | 'pending' | 'verified' | 'rejected'
  school_name?: string
  school_email?: string
  password_changed_at?: string
  last_login?: string
  activity_status?: 'active_today' | 'active_this_week' | 'inactive'
  email_notifications_enabled?: boolean
  push_notifications_enabled?: boolean
  notification_preferences?: string
}

export interface Product {
  id: number
  slug?: string // SEO-friendly URL identifier (e.g., "eco-bag-3f8a9d2a")
  title: string
  description: string
  price?: number
  image_urls: string[]
  video_url?: string
  seller_id: number
  seller_name?: string
  seller_profile_picture?: string
  premium: boolean
  status: 'available' | 'sold' | 'traded' | 'locked' | 'suspended' | 'deleted'
  allow_buying: boolean
  barter_only: boolean
  location?: string
  location_type?: 'current_location' | 'pickup_location' | 'no_location'
  condition?: string
  suggested_value?: number
  category?: string
  distance?: string // Calculated distance from user (e.g., "1.2km nearby")
  distanceKm?: number // Numeric distance in km for sorting
  created_at: string
  updated_at: string
  boosted_at?: string
  wishlist_count?: number;
  bidding_type?: 'none' | 'blind' | 'open'
  counterfeit_confidence?: number;
  counterfeit_flags?: string[];
  // latitude/longitude are declared on Product above; avoid duplicate declarations
  latitude?: number;
  longitude?: number;
  offer_count?: number;
  want_count?: number;
  estimated_value_min?: number;
  estimated_value_max?: number;
  show_estimated_value?: boolean;
  desired_price?: number;
  desired_product?: string;
  wanted_categories?: string[];
  wants?: string;
  brand?: string;
  max_items_per_offer?: number;
  view_count?: number;
  organization_tags?: Array<{
    id: number;
    slug: string;
    name: string;
    logo_url?: string;
    description?: string;
  }>;
}

export interface Order {
  id: number
  product_id: number
  buyer_id: number
  status: 'pending' | 'completed' | 'cancelled'
  created_at: string
  updated_at: string
  product?: Product
  buyer?: User
}

export interface ProductCreate {
  title: string
  description: string
  price?: number
  image_urls: string[]
  premium: boolean
  allow_buying: boolean
  barter_only: boolean
  location?: string
  condition: string
  category?: string
  show_estimated_value?: boolean
  bidding_type?: 'none' | 'blind' | 'open'
  wants?: string
  max_items_per_offer?: number
}

export interface ProductUpdate {
  title?: string
  description?: string
  price?: number
  image_urls?: string[]
  premium?: boolean
  status?: 'available' | 'sold' | 'traded' | 'locked' | 'suspended' | 'deleted'
  allow_buying?: boolean
  barter_only?: boolean
  location?: string
  condition?: string
  category?: string
  show_estimated_value?: boolean
  bidding_type?: 'none' | 'blind' | 'open'
  max_items_per_offer?: number
  wants?: string
  wanted_categories?: string[]
  latitude?: number
  longitude?: number
  location_type?: 'current_location' | 'pickup_location' | 'no_location'
}

export interface OrderCreate {
  product_id: number
}

export interface OrderUpdate {
  status?: 'pending' | 'completed' | 'cancelled'
}

export interface SearchFilters {
  keyword?: string
  category?: string
  premium?: boolean
  condition?: string // 'new' | 'like_new' | 'good' | 'fair' | 'poor'
  verified_seller_only?: boolean
  has_active_offers?: boolean // Filter for items with active bidding/offers
  sort_by?: string // 'most_relevant' | 'newest' | 'most_offers' | 'trending'
  seller_id?: number
  barter_only?: boolean
  allow_buying?: boolean
  page?: number
  limit?: number
  useSmartSearch?: boolean
}

export interface SearchSuggestions {
  products: string[]
  categories: string[]
  tags: string[]
  brands: string[]
  users?: Array<{
    id: number
    slug?: string
    name: string
    profile_picture?: string
    verified?: boolean
    is_organization?: boolean
    org_name?: string
    org_handle?: string
  }>
}

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  limit: number
  total_pages: number
}

export type TradeStatus = 'pending' | 'partially_accepted' | 'pending_multiway' | 'accepted' | 'accepted_by_one' | 'accepted_by_both' | 'confirmed' | 'declined' | 'rejected' | 'countered' | 'active' | 'ongoing' | 'awaiting_confirmation' | 'completed' | 'auto_completed' | 'cancelled' | 'cancelled_due_to_conflict' | 'expired' | 'broken' | 'history' | 'multiway_active' | 'pending_user3' | 'user3_accepted'
export type TradeOption = 'meetup' | 'delivery'

export interface TradeItem {
  id: number
  trade_id: number
  product_id: number
  offered_by: 'buyer' | 'seller'
  created_at: string
  product_title?: string
  product_status?: 'available' | 'sold' | 'traded' | 'locked' | 'deleted'
  product_image_url?: string
  product_pickup_address?: string
}

export interface Trade {
  id: number
  buyer_id: number
  seller_id: number
  target_product_id: number
  status: TradeStatus
  message?: string
  offered_cash_amount?: number | null
  created_at: string
  updated_at: string
  items: TradeItem[]
  buyer_name?: string
  seller_name?: string
  product_title?: string
  product_image_url?: string
  target_product_pickup_address?: string
  buyer_completed?: boolean
  seller_completed?: boolean
  buyer_accepted?: boolean
  seller_accepted?: boolean
  completed_at?: string | null
  meetup_status?: 'pending' | 'accepted' | 'declined' | 'disputed' | string
  meetup_confirmed?: boolean
  meetup_location?: string
  meetup_time?: string
  buyer_meetup_confirmed?: boolean
  seller_meetup_confirmed?: boolean
  buyer_meetup_location?: string
  buyer_meetup_time?: string
  seller_meetup_location?: string
  seller_meetup_time?: string
  buyer_met?: boolean
  seller_met?: boolean
  transaction_proof_url?: string
  trade_option?: TradeOption // 'meetup' or 'delivery'
  meeting_type?: 'meetup' | 'pickup' // Type of meeting flow: 'meetup' (mutual agreement) or 'pickup' (seller-set location)
  option_change_requested?: TradeOption // Requested option change (pending approval)
  option_change_requested_by?: number // User ID who requested the change
  delivery_address?: string // Delivery address if option is 'delivery'
  // Delivery state fields
  delivery_type?: 'standard' | 'express' // Removed meetup - only delivery options
  payment_method?: 'gcash' | 'cod' | 'wallet' | 'online' // online includes GCash/PayMaya via Xendit
  payment_confirmed?: boolean
  delivery_instructions?: string
  proof_of_delivery?: string | null // Base64 encoded image
  buyer_confirmed_receipt?: boolean
  seller_confirmed_delivery?: boolean
  delivery_estimated_time?: string // Estimated delivery time
  buyer_location?: string // Buyer coordinates as "lat,lng"
  seller_location?: string // Seller coordinates as "lat,lng"
  // Counter offer fields
  counter_offered_product_ids?: number[] // Product IDs offered in counter
  counter_offered_cash_amount?: number | null // Cash amount offered in counter
  // Review rating fields
  buyer_rating?: number // Rating given by buyer (1-5)
  seller_rating?: number // Rating given by seller (1-5)
  countered_by?: number
  parent_trade_id?: number | null
}

// Multi-way/Three-way Trading Types
export interface TradeEdge {
  from_user: number
  to_user: number
  trade_id: number
  from_user_name?: string
  to_user_name?: string
  product_title?: string
  status?: TradeStatus
}

export interface TradeLoop {
  edges: TradeEdge[]
  loop_length: number
  participants: number[]
}

export interface MultiWayTradeParticipant {
  user_id: number
  user_name: string
  user_slug?: string
  product_id: number
  product_title: string
  product_slug?: string
  product_image?: string
  trade_id: number
  trade_status: TradeStatus
  position_in_loop: number // 0 = first, 1 = second, etc.
  is_reviewed?: boolean
}

export interface MultiWayTrade {
  loop_id: string
  participants: MultiWayTradeParticipant[]
  edges: TradeEdge[]
  total_value?: number
  status: 'pending' | 'partially_accepted' | 'accepted' | 'confirmed' | 'ongoing' | 'cancelled' | 'cancelled_due_to_conflict' | 'broken' | 'expired' | 'rejected' | 'history' | 'active' | 'completed' | 'user3_accepted' | 'pending_user3' | 'multiway_active'
  created_at?: string
  expires_at?: string
}

export interface TradeLoopNotification {
  loop_id: string
  message: string
  participant_count: number
  created_at: string
}

export interface TradeCreate {
  target_product_id: number
  offered_product_ids: number[]
  message?: string
  offered_cash_amount?: number
  trade_option: TradeOption // Required: 'meetup' or 'delivery'
  meeting_type?: 'meetup' | 'pickup' // Type of meeting flow for trades
  delivery_address?: string // Required if trade_option is 'delivery'
  payment_method?: 'cod' | 'upfront' // Payment method preference for buyout offers
}

export interface TradeAction {
  action: 'accept' | 'decline' | 'counter' | 'edit_offer' | 'complete' | 'cancel' | 'confirm_meetup' | 'confirm_meetup_done' | 'reset_meetup_selection' | 'update_delivery_state' | 'request_option_change' | 'approve_option_change' | 'reject_option_change' | 'convert_to_multiway'
  offered_product_ids?: number[]
  offered_cash_amount?: number
  message?: string
  counter_offered_product_ids?: number[]
  counter_offered_cash_amount?: number
  trade_option?: TradeOption
  meeting_type?: 'meetup' | 'pickup'
  meetup_location?: string
  meetup_time?: string
  meetup_date?: string
  requested_option?: TradeOption // For option change requests
  delivery_address?: string // For delivery option
  payment_method?: 'gcash' | 'cod' | 'wallet' | 'online'
}

export interface APIResponse<T = any> {
  success: boolean
  message?: string
  data?: T
  error?: string
}

// AI Features Types
export interface DistanceResult {
  distance_km: number
  distance_miles: number
  distance_m: number
}

export interface ResponseMetrics {
  average_response_time_hours: number
  average_response_time_mins: number
  response_rate: number
  total_messages: number
  total_responses: number
  response_score: number
  last_response_at?: string
  rating: 'excellent' | 'good' | 'average' | 'poor'
}

export interface ProfileAnalysis {
  is_outdated: boolean
  is_inactive: boolean
  last_activity_at?: string
  profile_age_days: number
  recommendations: string[]
  score: number
}

export interface CounterfeitReport {
  is_suspicious: boolean
  reason: string
  confidence: number
  flags: string[]
}

// Delivery Types
export type DeliveryType = 'standard' | 'express'
export type DeliveryStatus = 'pending' | 'claimed' | 'picked_up' | 'in_transit' | 'delivered' | 'cancelled'

export interface Rider {
  id: number
  user_id: number
  name: string
  vehicle_type: 'motorcycle' | 'bicycle' | 'car'
  vehicle_plate?: string
  phone: string
  rating: number
  is_active: boolean
  status?: 'pending' | 'under_review' | 'approved' | 'rejected'
  license_image_url?: string
  selfie_image_url?: string
  contact_number?: string
  full_name?: string
  rejection_reason?: string
  reviewed_at?: string
  reviewed_by?: number
  latitude?: number
  longitude?: number
  created_at: string
  updated_at: string
}

export interface DeliveryItem {
  id: number
  delivery_id: number
  product_id: number
  product_name?: string
  is_fragile: boolean
  created_at: string
}

export interface DeliveryStop {
  id: number
  delivery_id: number
  stop_number: number
  stop_type: string
  contact_name: string
  contact_phone: string
  address: string
  latitude?: number
  longitude?: number
  item_qr_code?: string
  fee_amount: number
  status: 'pending' | 'arrived' | 'qr_scanned' | 'fee_collected' | 'completed'
  arrived_at?: string
  qr_scanned_at?: string
  fee_collected_at?: string
  completed_at?: string
  photo_url?: string
  created_at: string
  updated_at: string
}

export interface Delivery {
  id: number
  user_id: number
  trade_id?: number
  delivery_type: DeliveryType
  status: DeliveryStatus
  rider_id?: number
  pickup_latitude?: number
  pickup_longitude?: number
  pickup_address: string
  delivery_latitude?: number
  delivery_longitude?: number
  delivery_address: string
  special_instructions?: string
  total_cost: number
  estimated_eta?: string
  item_count: number
  is_fragile: boolean
  claimed_at?: string
  picked_up_at?: string
  in_transit_at?: string
  delivered_at?: string
  created_at: string
  updated_at: string
  // Denormalized fields
  user_name?: string
  receiver_name?: string
  rider_name?: string
  rider_phone?: string
  rider_vehicle?: string
  rider_rating?: number
  rider_latitude?: number
  rider_longitude?: number
  items?: DeliveryItem[]
  stops?: DeliveryStop[]
  // Batch window fields
  batch_id?: string
  batch_countdown?: number
  batch_size?: number
  is_batching?: boolean
  batch_window_expires_at?: string
  // Card display fields
  distance_km?: number
  estimated_minutes?: number
  sender_fee?: number
  receiver_fee?: number
  rider_cut?: number
}

export interface DeliveryRequest {
  trade_id?: number
  delivery_type: DeliveryType
  pickup_latitude?: number
  pickup_longitude?: number
  pickup_address: string
  delivery_latitude?: number
  delivery_longitude?: number
  delivery_address: string
  special_instructions?: string
  product_ids: number[]
}

export interface DeliveryUpdate {
  status?: DeliveryStatus
  rider_id?: number
  latitude?: number
  longitude?: number
  estimated_eta?: string
}

// ═══════════════════════════════════════════════════════════════════════════════
// BATCH DELIVERY TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export type BatchStatus = 'pending' | 'collecting_addons' | 'ready' | 'in_progress' | 'completed' | 'cancelled'

export interface BatchDelivery {
  id: number
  rider_id: number
  status: BatchStatus
  anchor_delivery_id: number
  batch_name?: string
  total_slots_used: number
  total_distance_km: number
  estimated_minutes: number
  optimized_route: number[] // delivery IDs in geographic order
  total_rider_commission: number
  total_clovia_commission: number
  claimed_at: string
  started_at?: string
  completed_at?: string
  created_at: string
  updated_at: string
  deliveries?: Delivery[] // populated deliveries in batch
}

export interface BatchDeliveryMapping {
  batch_id: number
  delivery_id: number
  route_order: number
  is_anchor: boolean
}

export interface RiderSlotLedger {
  rider_id: number
  free_slots_total: number
  free_slots_remaining: number
  current_batch_slots_used: number
  cash_collected_current_batch: number
  remittance_owed: number
  remittance_threshold: number
  is_locked_for_batching: boolean
  locked_reason?: string
}

export interface BatchAddonSuggestion {
  suggested_delivery_id: number
  distance_from_anchor_km: number
  route_detour_percent: number
  score: number
}

export interface ClaimBatchRequest {
  anchor_delivery_id: number
  addon_delivery_ids: number[]
}

export interface RemitCashRequest {
  batch_id: number
  amount: number
  payment_method: 'cash' | 'bank_transfer' | 'e_wallet'
  payment_reference: string
  proof_url: string
}

export interface BatchRemittanceHistory {
  id: number
  rider_id: number
  batch_id: number
  cash_amount_remitted: number
  clovia_commission_15_percent: number
  rider_take_home: number
  payment_method: string
  payment_reference: string
  proof_url?: string
  slots_unlocked_count: number
  status: 'pending' | 'verified' | 'failed'
  created_at: string
  updated_at: string
}

export interface Report {
  id: number
  reporter_id: number
  reported_user_id: number
  product_id?: number
  reason: string
  description: string
  status: string
  reviewer_id?: number
  reviewer_comment?: string
  created_at: string
  updated_at: string
  reporter?: User
  reported_user?: User
  product?: Product
}

export interface ReportCreate {
  reported_user_id: number
  product_id?: number
  reason: 'inappropriate' | 'counterfeit' | 'spam' | 'scam'
  description: string
}

export interface ReportUpdate {
  status: 'pending' | 'reviewed' | 'dismissed' | 'resolved'
  reviewer_comment?: string
}

export interface PeerVotedTag {
  tag: string
  count: number
}

export interface TrustProfile {
  average_rating: number // 1-5 star scale
  completed_trade_count: number
  peer_voted_tags: PeerVotedTag[]
  phone_verified: boolean // Required
  id_verified?: boolean // Optional
  verified_at: string
  updated_at: string
}
