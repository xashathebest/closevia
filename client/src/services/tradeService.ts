import { api } from './api'
import { Trade, TradeLoop, MultiWayTrade, TradeAction, APIResponse } from '../types'

/**
 * Trade Service - handles all trade-related API calls including multi-way trading
 */

/**
 * Fetch all trades for the current user
 * @param status Optional: filter by status (pending, accepted, completed, etc.)
 * @param direction Optional: 'incoming', 'outgoing', or both
 */
export const fetchTrades = async (
  status?: string,
  direction?: string
): Promise<Trade[]> => {
  try {
    let url = '/api/trades'
    const params = new URLSearchParams()
    if (status) params.append('status', status)
    if (direction) params.append('direction', direction)
    if (params.toString()) {
      url += `?${params.toString()}`
    }
    const response = await api.get<APIResponse<Trade[]>>(url)
    return response.data?.data || []
  } catch (error) {
    console.error('Failed to fetch trades:', error)
    throw error
  }
}

/**
 * Fetch a specific trade by ID
 */
export const fetchTradeById = async (tradeId: number): Promise<Trade> => {
  try {
    const response = await api.get<APIResponse<Trade>>(`/api/trades/${tradeId}`)
    return response.data?.data || ({} as Trade)
  } catch (error) {
    console.error(`Failed to fetch trade ${tradeId}:`, error)
    throw error
  }
}

/**
 * Fetch all detected trade loops (multi-way trading opportunities)
 * These are cyclical trade paths where a chain of trades can be executed
 */
export const fetchTradeLoops = async (): Promise<TradeLoop[]> => {
  try {
    const response = await api.get<APIResponse<TradeLoop[]>>('/api/trades/loops')
    return response.data?.data || []
  } catch (error) {
    console.error('Failed to fetch trade loops:', error)
    throw error
  }
}

/**
 * Fetch trade loops specifically for the current user
 */
export const fetchUserTradeLoops = async (): Promise<TradeLoop[]> => {
  try {
    const response = await api.get<APIResponse<TradeLoop[]>>('/api/trades/user/loops')
    return response.data?.data || []
  } catch (error) {
    console.error('Failed to fetch user trade loops:', error)
    throw error
  }
}

/**
 * Fetch a multi-way trade with all participants and their information
 */
export const fetchMultiWayTrade = async (loopId: string): Promise<MultiWayTrade> => {
  try {
    const response = await api.get<APIResponse<MultiWayTrade>>(
      `/api/trades/loops/${loopId}`
    )
    return response.data?.data || ({} as MultiWayTrade)
  } catch (error) {
    console.error(`Failed to fetch multi-way trade ${loopId}:`, error)
    throw error
  }
}

/**
 * Accept a multi-way trade (all participants need to accept)
 */
export const acceptMultiWayTrade = async (loopId: string): Promise<any> => {
  try {
    const response = await api.post(`/api/trades/loops/${loopId}/accept`)
    return response.data?.data || response.data
  } catch (error) {
    console.error(`Failed to accept multi-way trade ${loopId}:`, error)
    throw error
  }
}

/**
 * Decline a multi-way trade
 */
export const declineMultiWayTrade = async (loopId: string): Promise<void> => {
  try {
    await api.post(`/api/trades/loops/${loopId}/decline`)
  } catch (error) {
    console.error(`Failed to decline multi-way trade ${loopId}:`, error)
    throw error
  }
}

/**
 * Execute/complete a multi-way trade with review data
 */
export const executeMultiWayTrade = async (
  loopId: string,
  reviewData?: {
    rating: number
    feedback: string
    proof_url: string
    is_camera_photo: boolean
    completion_outcome?: 'did_not_push_through'
  }
): Promise<{ is_fully_completed?: boolean; completion_outcome?: string } | undefined> => {
  try {
    const response = await api.post(`/api/trades/loops/${loopId}/execute`, reviewData)
    return response.data?.data
  } catch (error) {
    console.error(`Failed to execute multi-way trade ${loopId}:`, error)
    throw error
  }
}

export type TradeLoopMeetupAction =
  | 'confirm_meetup'
  | 'reset_meetup_selection'
  | 'confirm_meetup_done'

export type TradeLoopMeetupStatus = {
  loop_id: string
  participants: Array<{
    user_id: number
    meetup_location: string
    meetup_date: string
    meetup_time: string
    meetup_lat?: number
    meetup_lng?: number
    meetup_confirmed: boolean
    met_confirmed: boolean
  }>
}

/**
 * Fetch per-participant meetup state for a trade loop.
 */
export const fetchTradeLoopMeetup = async (loopId: string): Promise<TradeLoopMeetupStatus> => {
  try {
    const response = await api.get<APIResponse<TradeLoopMeetupStatus>>(
      `/api/trades/loops/${loopId}/meetup`
    )
    return response.data?.data as any
  } catch (error) {
    console.error(`Failed to fetch trade loop meetup ${loopId}:`, error)
    throw error
  }
}

/**
 * Update meetup state for current user inside a trade loop.
 */
export const updateTradeLoopMeetup = async (
  loopId: string,
  action: TradeLoopMeetupAction,
  payload?: {
    meetup_location?: string
    meetup_date?: string
    meetup_time?: string
    meetup_lat?: number
    meetup_lng?: number
    user_lat?: number
    user_lng?: number
    location_accuracy_m?: number
  }
): Promise<TradeLoopMeetupStatus> => {
  try {
    const response = await api.put<APIResponse<TradeLoopMeetupStatus>>(
      `/api/trades/loops/${loopId}/meetup`,
      {
        action,
        meetup_location: payload?.meetup_location,
        meetup_date: payload?.meetup_date,
        meetup_time: payload?.meetup_time,
        meetup_lat: payload?.meetup_lat,
        meetup_lng: payload?.meetup_lng,
        user_lat: payload?.user_lat,
        user_lng: payload?.user_lng,
        location_accuracy_m: payload?.location_accuracy_m,
      }
    )
    return response.data?.data as any
  } catch (error) {
    console.error(`Failed to update trade loop meetup ${loopId}:`, error)
    throw error
  }
}

/**
 * Fetch the free-tier monthly loop quota for the current user.
 */
export const fetchLoopQuota = async (): Promise<{
  unlimited: boolean
  period: string
  used: number
  limit: number
}> => {
  try {
    const response = await api.get(`/api/trades/loops/quota`)
    return response.data?.data as any
  } catch (error) {
    console.error('Failed to fetch loop quota:', error)
    throw error
  }
}

/**
 * Pro-only: cancel a detected loop.
 */
export const cancelTradeLoop = async (loopId: string): Promise<void> => {
  try {
    await api.post(`/api/trades/loops/${loopId}/cancel`)
  } catch (error) {
    console.error(`Failed to cancel trade loop ${loopId}:`, error)
    throw error
  }
}

/**
 * Pro-only: reinvite a cancelled detected loop (resets agreements).
 */
export const reinviteTradeLoop = async (loopId: string): Promise<void> => {
  try {
    await api.post(`/api/trades/loops/${loopId}/reinvite`)
  } catch (error) {
    console.error(`Failed to reinvite trade loop ${loopId}:`, error)
    throw error
  }
}

/**
 * Fetch open multiway loops that the current user's products can match into.
 */
export const fetchDiscoverableMultiwayLoops = async (): Promise<any[]> => {
  try {
    const response = await api.get('/api/trades/multiway/discoverable')
    return response.data?.data || []
  } catch (error) {
    console.error('Failed to fetch discoverable multiway loops:', error)
    throw error
  }
}

/**
 * Volunteer to join an open multiway chain with a specific product.
 */
export const hopIntoMultiwayChain = async (chainId: string, productId: number): Promise<void> => {
  try {
    await api.post(`/api/trades/multiway/${chainId}/hop-in`, { product_id: productId })
  } catch (error) {
    console.error(`Failed to hop into chain ${chainId}:`, error)
    throw error
  }
}

/**
 * Create a new trade proposal
 */
export const createTrade = async (tradeData: any): Promise<Trade> => {
  try {
    const response = await api.post<APIResponse<Trade>>('/api/trades', tradeData)
    return response.data?.data || ({} as Trade)
  } catch (error) {
    console.error('Failed to create trade:', error)
    throw error
  }
}

/**
 * Update a trade (accept, decline, counter, complete, etc.)
 */
export const updateTrade = async (
  tradeId: number,
  action: TradeAction
): Promise<Trade> => {
  try {
    const response = await api.put<APIResponse<Trade>>(
      `/api/trades/${tradeId}`,
      action
    )
    return response.data?.data || ({} as Trade)
  } catch (error) {
    console.error(`Failed to update trade ${tradeId}:`, error)
    throw error
  }
}

/**
 * Fetch trade messages/chat for a specific trade
 */
export const fetchTradeMessages = async (tradeId: number): Promise<any[]> => {
  try {
    const response = await api.get<APIResponse<any[]>>(
      `/api/trades/${tradeId}/messages`
    )
    return response.data?.data || []
  } catch (error) {
    console.error(`Failed to fetch messages for trade ${tradeId}:`, error)
    throw error
  }
}

/**
 * Fetch all legs for an active multiway chain along with health indicator
 */
export const getChainLegs = async (chainId: string): Promise<any> => {
  try {
    const response = await api.get(`/api/trades/multiway/${chainId}/legs`)
    return response.data?.data
  } catch (error) {
    console.error(`Failed to fetch legs for chain ${chainId}:`, error)
    throw error
  }
}

/**
 * Set handoff method/location/time for a specific leg (either party in the leg can call this)
 */
export const updateLegHandoff = async (
  legId: number,
  handoffMethod: 'meetup' | 'delivery',
  handoffLocation?: string,
  handoffTime?: string
): Promise<void> => {
  try {
    await api.put(`/api/trades/multiway/legs/${legId}/handoff`, {
      handoff_method: handoffMethod,
      handoff_location: handoffLocation,
      handoff_time: handoffTime,
    })
  } catch (error) {
    console.error(`Failed to update handoff for leg ${legId}:`, error)
    throw error
  }
}

/**
 * Mark a multiway chain leg as received/completed (called by the receiver).
 */
export const completeLeg = async (legId: number, handoffPhotoUrl?: string): Promise<void> => {
  try {
    await api.post(`/api/trades/multiway/legs/${legId}/complete`, {
      handoff_photo_url: handoffPhotoUrl,
    })
  } catch (error) {
    console.error(`Failed to complete leg ${legId}:`, error)
    throw error
  }
}

/**
 * Send a message in a trade chat
 */
export const sendTradeMessage = async (
  tradeId: number,
  content: string
): Promise<void> => {
  try {
    await api.post(`/api/trades/${tradeId}/messages`, { content })
  } catch (error) {
    console.error(`Failed to send message for trade ${tradeId}:`, error)
    throw error
  }
}
