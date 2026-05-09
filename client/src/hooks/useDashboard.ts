import { useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { api } from '../services/api'
import { Product, Order, Trade } from '../types'

// Query keys for consistent caching
export const DASHBOARD_QUERY_KEYS = {
  products: ['dashboard', 'products'] as const,
  orders: ['dashboard', 'orders'] as const,
  counts: ['dashboard', 'counts'] as const,
  sentOffers: ['dashboard', 'offers', 'sent'] as const,
  receivedOffers: ['dashboard', 'offers', 'received'] as const,
  ongoingTrades: ['dashboard', 'offers', 'ongoing'] as const,
  multiWayLoops: ['dashboard', 'offers', 'multiwayLoops'] as const,
  archivedTrades: ['dashboard', 'offers', 'archived'] as const,
  tradeHistory: ['dashboard', 'tradeHistory'] as const,
}

const OFFER_REFETCH_INTERVAL_MS = 30000

type DashboardQueryOptions = {
  enabled?: boolean
  refetchInterval?: number | false
}

const buildReciprocalOngoingKey = (trade: Trade): string | null => {
  if (trade.status !== 'active') return null

  const buyerOfferedItems = (trade.items || []).filter((item) => (item.offered_by || '').toLowerCase() === 'buyer')
  const buyerOfferedProductIDs = buyerOfferedItems
    .map((item) => Number(item.product_id))
    .filter((id) => Number.isFinite(id) && id > 0)

  const productIDs = Array.from(new Set([Number(trade.target_product_id), ...buyerOfferedProductIDs])).sort((a, b) => a - b)
  if (productIDs.length !== 2 || buyerOfferedProductIDs.length !== 1) return null

  const userIDs = [Number(trade.buyer_id), Number(trade.seller_id)].sort((a, b) => a - b)
  return `reciprocal:${userIDs.join('-')}:${productIDs.join('-')}`
}

// Custom hook for user products with caching
export const useDashboardProducts = (userId: number | undefined, options: DashboardQueryOptions = {}) => {
  return useQuery({
    queryKey: [...DASHBOARD_QUERY_KEYS.products, userId],
    queryFn: async (): Promise<Product[]> => {
      if (!userId) throw new Error('User ID required')
      try {
        // Use same method as UserProfile - direct API call (auth header set by interceptor)
        const response = await api.get(`/api/products/user/${userId}`)

        // response.data = { success: true, data: { data: [...], total, page, totalPages } }
        const paginatedResponse = response.data?.data
        if (paginatedResponse && Array.isArray(paginatedResponse.data)) {
          return paginatedResponse.data
        }
        // Fallback: direct array
        if (Array.isArray(response.data?.data)) {
          return response.data.data
        }
        if (Array.isArray(response.data)) {
          return response.data
        }
        return []
      } catch (error) {
        console.error('Error fetching products:', error)
        throw error
      }
    },
    enabled: (!!userId) && (options.enabled ?? true),
    // Products data reduced to 1 minute to avoid stale dashboard
    staleTime: 1000 * 60, // 1 minute for dashboard freshness
    refetchOnMount: false,
    placeholderData: keepPreviousData,
  })
}

// Custom hook for user orders with caching
export const useDashboardOrders = (options: DashboardQueryOptions = {}) => {
  return useQuery({
    queryKey: DASHBOARD_QUERY_KEYS.orders,
    queryFn: async (): Promise<Order[]> => {
      const response = await api.get('/api/orders?type=bought')
      return response.data?.data?.data || []
    },
    enabled: options.enabled ?? true,
    // Orders change less frequently
    staleTime: 1000 * 60 * 15, // 15 minutes
    placeholderData: keepPreviousData,
  })
}

// Custom hook for dashboard counts (notifications, offers) with caching
export const useDashboardCounts = (options: DashboardQueryOptions = {}) => {
  return useQuery({
    queryKey: DASHBOARD_QUERY_KEYS.counts,
    queryFn: async () => {
      const response = await api.get('/api/dashboard/counts')
      const data = response.data?.data || response.data || {}
      return {
        unread_notifications: data.unread_notifications || 0,
        pending_offers: data.pending_offers || 0,
      }
    },
    enabled: options.enabled ?? true,
    // Counts should refresh more frequently
    staleTime: 1000 * 30,
    refetchInterval: options.refetchInterval ?? 1000 * 30,
    placeholderData: keepPreviousData,
  })
}

// Custom hook for sent offers with caching
export const useSentOffers = (options: DashboardQueryOptions = {}) => {
  return useQuery({
    queryKey: DASHBOARD_QUERY_KEYS.sentOffers,
    queryFn: async (): Promise<Trade[]> => {
      const results = await Promise.allSettled([
        api.get('/api/trades', {
          params: {
            direction: 'outgoing',
            include: 'products',
            limit: 100,
          },
        }),
      ])

      const extractData = (response: any): Trade[] => {
        return Array.isArray(response?.data?.data)
          ? response.data.data
          : (Array.isArray(response?.data) ? response.data : [])
      }

      const allTrades = results.flatMap((result) => (
        result.status === 'fulfilled' ? extractData(result.value) : []
      ))

      const unique = new Map<number, Trade>()
      allTrades.forEach((tr: Trade) => {
        if (tr && tr.id) unique.set(tr.id, tr)
      })
      return Array.from(unique.values())
    },
    enabled: options.enabled ?? true,
    staleTime: 1000 * 15,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    refetchInterval: options.refetchInterval ?? OFFER_REFETCH_INTERVAL_MS,
    placeholderData: keepPreviousData,
  })
}

// Custom hook for received offers with caching
export const useReceivedOffers = (options: DashboardQueryOptions = {}) => {
  return useQuery({
    queryKey: DASHBOARD_QUERY_KEYS.receivedOffers,
    queryFn: async (): Promise<Trade[]> => {
      const results = await Promise.allSettled([
        api.get('/api/trades', {
          params: {
            direction: 'incoming',
            include: 'products',
            limit: 100,
          },
        }),
      ])

      const extractData = (response: any): Trade[] => {
        return Array.isArray(response?.data?.data)
          ? response.data.data
          : (Array.isArray(response?.data) ? response.data : [])
      }

      const allTrades = results.flatMap((result) => (
        result.status === 'fulfilled' ? extractData(result.value) : []
      ))

      const unique = new Map<number, Trade>()
      allTrades.forEach((tr: Trade) => {
        if (tr && tr.id) unique.set(tr.id, tr)
      })
      return Array.from(unique.values())
    },
    enabled: options.enabled ?? true,
    staleTime: 1000 * 15,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    refetchInterval: options.refetchInterval ?? OFFER_REFETCH_INTERVAL_MS,
    placeholderData: keepPreviousData,
  })
}

// Custom hook for ongoing trades with caching
export const useOngoingTrades = (options: DashboardQueryOptions = {}) => {
  return useQuery({
    queryKey: DASHBOARD_QUERY_KEYS.ongoingTrades,
    queryFn: async (): Promise<Trade[]> => {
      const response = await api.get('/api/trades', {
        params: {
          include: 'products',
          limit: 100,
        },
      })
      const extractData = (response: any) => {
        return Array.isArray(response?.data?.data) ? response.data.data : (Array.isArray(response?.data) ? response.data : [])
      }

      const ongoingStatuses = new Set(['accepted', 'active', 'ongoing', 'awaiting_confirmation', 'multiway_active'])
      const allTrades = extractData(response).filter((trade: Trade) => ongoingStatuses.has(trade.status))

      const uniqueTrades = new Map<string | number, Trade>()
      allTrades.forEach((tr: Trade) => {
        if (!tr || !tr.id) return
        const reciprocalKey = buildReciprocalOngoingKey(tr)
        const key = reciprocalKey || tr.id
        const existing = uniqueTrades.get(key)
        if (!existing || tr.id < existing.id) {
          uniqueTrades.set(key, tr)
        }
      })

      return Array.from(uniqueTrades.values())
    },
    enabled: options.enabled ?? true,
    staleTime: 1000 * 15,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    refetchInterval: options.refetchInterval ?? OFFER_REFETCH_INTERVAL_MS,
    placeholderData: keepPreviousData,
  })
}

// Custom hook for multiway/trade-loop rows used by Ongoing Trades and Multi-Way tabs.
// This intentionally loads alongside regular offer data instead of waiting for
// the user to open a specific dashboard tab.
export const useMultiWayLoops = (userId: number | undefined, options: DashboardQueryOptions = {}) => {
  return useQuery({
    queryKey: [...DASHBOARD_QUERY_KEYS.multiWayLoops, userId],
    queryFn: async (): Promise<any[]> => {
      const response = await api.get('/api/trades/loops', {
        params: userId ? { user_id: userId } : undefined,
      })
      return Array.isArray(response.data?.data)
        ? response.data.data
        : (Array.isArray(response.data) ? response.data : [])
    },
    enabled: (!!userId) && (options.enabled ?? true),
    staleTime: 1000 * 30,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    refetchInterval: options.refetchInterval ?? OFFER_REFETCH_INTERVAL_MS,
    placeholderData: keepPreviousData,
  })
}

// Custom hook for archived (expired) trades with caching
export const useArchivedTrades = (options: DashboardQueryOptions = {}) => {
  return useQuery({
    queryKey: DASHBOARD_QUERY_KEYS.archivedTrades,
    queryFn: async (): Promise<Trade[]> => {
      const [incomingExpired, outgoingExpired] = await Promise.all([
        api.get('/api/trades', { params: { direction: 'incoming', include: 'products', status: 'expired', limit: 100 } }),
        api.get('/api/trades', { params: { direction: 'outgoing', include: 'products', status: 'expired', limit: 100 } })
      ])

      const extractData = (response: any) => {
        return Array.isArray(response?.data?.data) ? response.data.data : (Array.isArray(response?.data) ? response.data : [])
      }

      const allTrades = [
        ...extractData(incomingExpired),
        ...extractData(outgoingExpired)
      ]

      // Deduplicate by trade ID
      const uniqueTrades = new Map<number, Trade>()
      allTrades.forEach((tr: Trade) => {
        if (tr && tr.id) uniqueTrades.set(tr.id, tr)
      })

      return Array.from(uniqueTrades.values())
    },
    enabled: options.enabled ?? true,
    staleTime: 1000 * 60 * 5,
    placeholderData: keepPreviousData,
  })
}

// Custom hook for trade history with caching
// Merges completed one-to-one trades with completed trade-match / multi-way loops
// so both show up in the Dashboard history tab.
export const useTradeHistory = (options: DashboardQueryOptions = {}) => {
  return useQuery({
    queryKey: DASHBOARD_QUERY_KEYS.tradeHistory,
    queryFn: async (): Promise<Trade[]> => {
      const [tradesRes, completedLoopsRes, cancelledLoopsRes] = await Promise.all([
        api.get('/api/trades', {
          params: { status: 'history', include: 'products', limit: 100 }
        }),
        api.get('/api/trades/loops', { params: { status: 'completed' } }).catch(() => ({ data: { data: [] } })),
        api.get('/api/trades/loops', { params: { status: 'cancelled' } }).catch(() => ({ data: { data: [] } })),
      ])

      const trades: Trade[] = Array.isArray(tradesRes.data?.data)
        ? tradesRes.data.data
        : (Array.isArray(tradesRes.data) ? tradesRes.data : [])

      const completedLoops: any[] = Array.isArray(completedLoopsRes.data?.data)
        ? completedLoopsRes.data.data
        : (Array.isArray(completedLoopsRes.data) ? completedLoopsRes.data : [])
      const cancelledLoops: any[] = Array.isArray(cancelledLoopsRes.data?.data)
        ? cancelledLoopsRes.data.data
        : (Array.isArray(cancelledLoopsRes.data) ? cancelledLoopsRes.data : [])
      const loops: any[] = [...completedLoops, ...cancelledLoops]

      // Resolve the current user's ID so we can shape each loop from their perspective.
      let storedUserId = Number(localStorage.getItem('userId') || 0)
      if (!storedUserId) {
        try {
          storedUserId = Number(JSON.parse(localStorage.getItem('clovia_user') || '{}')?.id || 0)
        } catch {
          storedUserId = 0
        }
      }

      const loopTrades: Trade[] = loops.flatMap((loop: any) => {
        const participants: any[] = Array.isArray(loop?.participants) ? loop.participants : []
        const me = participants.find((p: any) => Number(p?.user_id ?? p?.id) === storedUserId)
        const loopStatus = String(loop?.status || '').toLowerCase()
        const isClosedIncomplete = ['rejected', 'cancelled', 'cancelled_due_to_conflict', 'broken', 'expired', 'user3_declined'].includes(loopStatus)
        if (!me || (!me?.is_reviewed && !isClosedIncomplete)) return []
        // Partner = who received my offered product (i.e. who wanted it).
        const partner = participants.find((p: any) => Number(p?.wanted_product_id) === Number(me?.product_id)) || participants.find((p: any) => Number(p?.user_id ?? p?.id) !== storedUserId) || {}
        const completedAt: string = loop?.completed_at || loop?.updated_at || new Date().toISOString()
        const syntheticStatus = isClosedIncomplete
          ? (loopStatus === 'expired' || loopStatus === 'broken' ? 'expired' : 'cancelled')
          : 'completed'

        return [{
          // Negative synthetic id to avoid collision with real trade IDs.
          id: -Number(loop?.id || 0),
          buyer_id: Number(me?.user_id || storedUserId),
          seller_id: Number(partner?.user_id || 0),
          // "You received" = the product you wanted (and got)
          target_product_id: Number(me?.wanted_product_id || 0),
          product_title: String(me?.wanted_title || ''),
          product_image_url: String(partner?.product_image_url || ''),
          status: syntheticStatus,
          created_at: completedAt,
          updated_at: completedAt,
          completed_at: completedAt,
          items: [],
          buyer_name: String(me?.user_name || ''),
          seller_name: String(partner?.user_name || ''),
          // Tag so the UI can tell this came from a loop rather than a 1:1 trade.
          trade_option: 'meetup',
          // Extra context for loop-aware renderers (non-Trade fields are permissive here).
          ...({
            trade_type: 'multiway',
            loop_id: loop?.loop_id,
            chain_id: loop?.chain_id,
            loop_type: loop?.loop_type,
            loop_length: loop?.loop_length,
            is_trade_loop: true,
            is_multiway: true,
            participants,
            edges: Array.isArray(loop?.edges) ? loop.edges : [],
            loop_status: loop?.status,
            user_reviewed: true,
            fully_completed: participants.length > 0 && participants.every((p: any) => Boolean(p?.is_reviewed)),
          } as any),
        } as Trade]
      })

      // Deduplicate by id in case the same record is returned twice.
      const unique = new Map<number, Trade>()
      for (const t of [...trades, ...loopTrades]) {
        if (t && typeof t.id === 'number') unique.set(t.id, t)
      }
      return Array.from(unique.values())
    },
    enabled: options.enabled ?? true,
    staleTime: 1000 * 60 * 5, // 5 minutes (completed trades don't change)
    placeholderData: keepPreviousData,
  })
}

// Hook to prefetch dashboard data
export const usePrefetchDashboard = (userId: number | undefined) => {
  const queryClient = useQueryClient()

  const prefetchDashboardData = async () => {
    if (!userId) return

    // Prefetch all dashboard data in parallel
    await Promise.all([
      queryClient.prefetchQuery({
        queryKey: [...DASHBOARD_QUERY_KEYS.products, userId],
        queryFn: async (): Promise<Product[]> => {
          const response = await api.get(`/api/products/user/${userId}`)
          return response.data?.data?.data || response.data?.data || []
        },
        staleTime: 1000 * 60,
      }),
      queryClient.prefetchQuery({
        queryKey: DASHBOARD_QUERY_KEYS.orders,
        queryFn: async (): Promise<Order[]> => {
          const response = await api.get('/api/orders?type=bought')
          return response.data?.data?.data || []
        },
        staleTime: 1000 * 60 * 15,
      }),
      queryClient.prefetchQuery({
        queryKey: DASHBOARD_QUERY_KEYS.counts,
        queryFn: async () => {
          const response = await api.get('/api/dashboard/counts')
          return {
            unread_notifications: response.data?.unread_notifications || 0,
            pending_offers: response.data?.pending_offers || 0,
          }
        },
        staleTime: 1000 * 30,
      }),
    ])
  }

  return { prefetchDashboardData }
}

// Hook to invalidate dashboard cache when data changes
export const useInvalidateDashboard = () => {
  const queryClient = useQueryClient()

  const invalidateDashboard = () => {
    return queryClient.invalidateQueries({ queryKey: ['dashboard'] })
  }

  const invalidateProducts = () => {
    return queryClient.invalidateQueries({ queryKey: DASHBOARD_QUERY_KEYS.products })
  }

  const invalidateOffers = () => {
    return queryClient.invalidateQueries({ queryKey: ['dashboard', 'offers'] })
  }

  const invalidateMultiWay = () => {
    return queryClient.invalidateQueries({ queryKey: DASHBOARD_QUERY_KEYS.multiWayLoops })
  }

  const invalidateHistory = () => {
    return queryClient.invalidateQueries({ queryKey: DASHBOARD_QUERY_KEYS.tradeHistory })
  }

  const invalidateArchived = () => {
    return queryClient.invalidateQueries({ queryKey: DASHBOARD_QUERY_KEYS.archivedTrades })
  }

  const invalidateCounts = () => {
    return queryClient.invalidateQueries({ queryKey: DASHBOARD_QUERY_KEYS.counts })
  }

  return {
    invalidateDashboard,
    invalidateProducts,
    invalidateOffers,
    invalidateMultiWay,
    invalidateHistory,
    invalidateArchived,
    invalidateCounts,
  }
}
