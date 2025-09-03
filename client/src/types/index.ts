export interface User {
  id: number
  name: string
  email: string
  role: string
  verified: boolean
  created_at: string
  updated_at: string
}

export interface Product {
  id: number
  title: string
  description: string
  price?: number
  image_urls: string[]
  seller_id: number
  seller_name?: string
  premium: boolean
  status: 'available' | 'sold' | 'traded'
  allow_buying: boolean
  barter_only: boolean
  location?: string
  created_at: string
  updated_at: string
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
}

export interface ProductUpdate {
  title?: string
  description?: string
  price?: number
  image_urls?: string[]
  premium?: boolean
  status?: 'available' | 'sold' | 'traded'
  allow_buying?: boolean
  barter_only?: boolean
  location?: string
}

export interface OrderCreate {
  product_id: number
}

export interface OrderUpdate {
  status?: 'pending' | 'completed' | 'cancelled'
}

export interface SearchFilters {
  keyword?: string
  min_price?: number
  max_price?: number
  premium?: boolean
  status?: string
  seller_id?: number
  barter_only?: boolean
  allow_buying?: boolean
  location?: string
  page?: number
  limit?: number
}

export interface PaginatedResponse<T> {
  data: T[]
  total: number
  page: number
  limit: number
  total_pages: number
}

export type TradeStatus = 'pending' | 'accepted' | 'declined' | 'countered' | 'active' | 'pending_confirmation' | 'completed' | 'cancelled'

export interface TradeItem {
  id: number
  trade_id: number
  product_id: number
  offered_by: 'buyer' | 'seller'
  created_at: string
  product_title?: string
  product_status?: 'available' | 'sold' | 'traded'
  product_image_url?: string
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
  buyer_completed?: boolean
  seller_completed?: boolean
  completed_at?: string | null
}

export interface TradeCreate {
  target_product_id: number
  offered_product_ids: number[]
  message?: string
  offered_cash_amount?: number
}

export interface TradeAction {
  action: 'accept' | 'decline' | 'counter' | 'complete' | 'cancel'
  message?: string
  counter_offered_product_ids?: number[]
  counter_offered_cash_amount?: number
}

export interface APIResponse<T = any> {
  success: boolean
  message?: string
  data?: T
  error?: string
}
