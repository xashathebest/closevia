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

const OFFER_REFETCH_INTERVAL_MS = 5000

// Custom hook for user products with caching
export const useDashboardProducts = (userId: number | undefined) => {
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
    enabled: !!userId,
    // Products data reduced to 1 minute to avoid stale dashboard
    staleTime: 1000 * 30, // 30 seconds for dashboard freshness
    refetchOnMount: 'always',
    placeholderData: keepPreviousData,
  })
}

// Custom hook for user orders with caching
export const useDashboardOrders = () => {
  return useQuery({
    queryKey: DASHBOARD_QUERY_KEYS.orders,
    queryFn: async (): Promise<Order[]> => {
      const response = await api.get('/api/orders?type=bought')
      return response.data?.data?.data || []
    },
    // Orders change less frequently
    staleTime: 1000 * 60 * 15, // 15 minutes
    placeholderData: keepPreviousData,
  })
}

// Custom hook for dashboard counts (notifications, offers) with caching
export const useDashboardCounts = () => {
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
    // Counts should refresh more frequently
    staleTime: 1000 * 15,
    refetchInterval: 1000 * 15,
    placeholderData: keepPreviousData,
  })
}

// Custom hook for sent offers with caching
export const useSentOffers = () => {
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
    staleTime: 1000 * 5,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    refetchInterval: OFFER_REFETCH_INTERVAL_MS,
    placeholderData: keepPreviousData,
  })
}

// Custom hook for received offers with caching
export const useReceivedOffers = () => {
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
    staleTime: 1000 * 5,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    refetchInterval: OFFER_REFETCH_INTERVAL_MS,
    placeholderData: keepPreviousData,
  })
}

// Custom hook for ongoing trades with caching
export const useOngoingTrades = () => {
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

      // Deduplicate by trade ID
      const uniqueTrades = new Map<number, Trade>()
      allTrades.forEach((tr: Trade) => {
        if (tr && tr.id) uniqueTrades.set(tr.id, tr)
      })

      return Array.from(uniqueTrades.values())
    },
    staleTime: 1000 * 5,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    refetchInterval: OFFER_REFETCH_INTERVAL_MS,
    placeholderData: keepPreviousData,
  })
}

// Custom hook for multiway/trade-loop rows used by Ongoing Trades and Multi-Way tabs.
// This intentionally loads alongside regular offer data instead of waiting for
// the user to open a specific dashboard tab.
export const useMultiWayLoops = (userId: number | undefined) => {
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
    enabled: !!userId,
    staleTime: 1000 * 5,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    refetchInterval: OFFER_REFETCH_INTERVAL_MS,
    placeholderData: keepPreviousData,
  })
}

// Custom hook for archived (expired) trades with caching
export const useArchivedTrades = () => {
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
    staleTime: 1000 * 60 * 5,
    placeholderData: keepPreviousData,
  })
}

// Custom hook for trade history with caching
// Merges completed one-to-one trades with completed trade-match / multi-way loops
// so both show up in the Dashboard history tab.
export const useTradeHistory = () => {
  return useQuery({
    queryKey: DASHBOARD_QUERY_KEYS.tradeHistory,
    queryFn: async (): Promise<Trade[]> => {
      const [tradesRes, loopsRes] = await Promise.all([
        api.get('/api/trades', {
          params: { status: 'completed', include: 'products', limit: 100 }
        }),
        api.get('/api/trades/loops').catch(() => ({ data: { data: [] } })),
      ])

      const trades: Trade[] = Array.isArray(tradesRes.data?.data)
        ? tradesRes.data.data
        : (Array.isArray(tradesRes.data) ? tradesRes.data : [])

      const loops: any[] = Array.isArray(loopsRes.data?.data)
        ? loopsRes.data.data
        : (Array.isArray(loopsRes.data) ? loopsRes.data : [])

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
        if (!me?.is_reviewed) return []
        // Partner = who received my offered product (i.e. who wanted it).
        const partner = participants.find((p: any) => Number(p?.wanted_product_id) === Number(me?.product_id)) || participants.find((p: any) => Number(p?.user_id ?? p?.id) !== storedUserId) || {}
        const completedAt: string = loop?.completed_at || loop?.updated_at || new Date().toISOString()

        return [{
          // Negative synthetic id to avoid collision with real trade IDs.
          id: -Number(loop?.id || 0),
          buyer_id: Number(me?.user_id || storedUserId),
          seller_id: Number(partner?.user_id || 0),
          // "You received" = the product you wanted (and got)
          target_product_id: Number(me?.wanted_product_id || 0),
          product_title: String(me?.wanted_title || ''),
          product_image_url: String(partner?.product_image_url || ''),
          status: 'completed',
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
            loop_id: loop?.loop_id,
            loop_length: loop?.loop_length,
            is_trade_loop: true,
            participants,
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

  const invalidateCounts = () => {
    return queryClient.invalidateQueries({ queryKey: DASHBOARD_QUERY_KEYS.counts })
  }

  return {
    invalidateDashboard,
    invalidateProducts,
    invalidateOffers,
    invalidateCounts,
  }
}
