import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from './AuthContext'
import { useNotification } from './NotificationContext'
import { api, API_BASE_URL } from '../services/api'
import { isNotificationAllowed } from '../utils/notificationPreferences'

type RealtimeContextValue = {
  offerCount: number
  notificationCount: number
  refreshCounts: () => void
  refreshProducts: () => void
  refreshSentOffers: () => void
  refreshReceivedOffers: () => void
  refreshOngoingTrades: () => void
  refreshMultiWayTrades: () => void
  refreshHistory: () => void
  setRefreshCallback: (tabType: 'products' | 'sentOffers' | 'receivedOffers' | 'ongoingTrades' | 'multiway' | 'history' | 'multiwayAlert', cb: () => void) => void
}

const RealtimeContext = createContext<RealtimeContextValue>({
  offerCount: 0,
  notificationCount: 0,
  refreshCounts: () => { },
  refreshProducts: () => { },
  refreshSentOffers: () => { },
  refreshReceivedOffers: () => { },
  refreshOngoingTrades: () => { },
  refreshMultiWayTrades: () => { },
  refreshHistory: () => { },
  setRefreshCallback: () => { },
})

const POLL_INTERVAL_MS = 60000
const SSE_MESSAGE_DEDUP_WINDOW = 2000  // Prevent duplicate SSE messages within 2 seconds

export const RealtimeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, token } = useAuth()
  const { showNotification } = useNotification()
  const queryClient = useQueryClient()
  const streamAbortRef = useRef<AbortController | null>(null)
  const seenNotifIdsRef = useRef<Set<number>>(new Set())
  const hasInitializedSeenRef = useRef(false)
  const recentSSEMessagesRef = useRef<Map<string, number>>(new Map())  // Track recent SSE messages
  const refreshCallbacksRef = useRef<{
    products: (() => void) | null
    sentOffers: (() => void) | null
    receivedOffers: (() => void) | null
    ongoingTrades: (() => void) | null
    multiway: (() => void) | null
    history: (() => void) | null
    multiwayAlert: (() => void) | null
  }>({
    products: null,
    sentOffers: null,
    receivedOffers: null,
    ongoingTrades: null,
    multiway: null,
    history: null,
    multiwayAlert: null,
  })
  const [offerCount, setOfferCount] = useState(0)
  const [notificationCount, setNotificationCount] = useState(0)
  const userNotificationPreferences = (user as any)?.notification_preferences

  const shouldNotify = useCallback((notification: { type?: string; notification_type?: string; message?: string; participant_count?: number | string }) => {
    return isNotificationAllowed(userNotificationPreferences, notification)
  }, [userNotificationPreferences])

  const getSseBaseUrl = useCallback(() => {
    const configured = (API_BASE_URL || '').replace(/\/$/, '')
    if (configured) return configured

    // Dev fallback: avoid relying on the Vite proxy for streaming.
    // This prevents EventSource from receiving a non-SSE response from the dev server.
    const { protocol, hostname } = window.location
    const host = hostname === 'localhost' ? '127.0.0.1' : hostname
    return `${protocol}//${host}:4000`
  }, [])

  const refreshCounts = useCallback(async () => {
    if (!user) return

    try {
      // Admin only sees report notifications, so only count those for the badge
      const notifEndpoint = user?.role === 'admin' ? '/api/notifications?type=report' : '/api/notifications'
      const [offersRes, notifRes] = await Promise.all([
        api.get('/api/trades/count', { params: { direction: 'incoming', status: 'pending' } }),
        api.get(notifEndpoint),
      ])
      const count = offersRes.data?.data?.count ?? 0
      setOfferCount(count)
      const notifs = Array.isArray(notifRes.data?.data) ? notifRes.data.data : []

      // Apply the same filter used in the Notifications page — multiway
      // "Trade Loop Found" notifications are hidden, so don't count them either.
      const visibleNotifs = notifs.filter((n: any) => {
        if (n.type === 'trade_loop') return false
        if (!shouldNotify(n)) return false
        return true
      })

      setNotificationCount(visibleNotifs.filter((n: any) => !n.read).length)

      // Polling fallback: show global toast for new unread notifications we haven't seen
      if (!hasInitializedSeenRef.current) {
        visibleNotifs.forEach((n: any) => seenNotifIdsRef.current.add(n.id))
        hasInitializedSeenRef.current = true
      } else {
        const unread = visibleNotifs.filter((n: any) => !n.read)
        const newest = unread.sort((a: any, b: any) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        )[0]
        if (newest && !seenNotifIdsRef.current.has(newest.id)) {
          seenNotifIdsRef.current.add(newest.id)

          // Trigger appropriate tab refreshes based on notification type
          const notifType = newest.type || ''
          if (notifType === 'trade_loop') {
            // Refresh multi-way tab — do NOT show global toast; Dashboard handles it
            if (refreshCallbacksRef.current.multiway) refreshCallbacksRef.current.multiway()
            if (refreshCallbacksRef.current.multiwayAlert) refreshCallbacksRef.current.multiwayAlert()
          } else {
            if (shouldNotify(newest)) {
              showNotification(newest.message || 'New notification', notifType === 'trade_offer' ? 'success' : 'info')
            }
          }
          if (notifType === 'trade_offer' || notifType === 'trade_update') {
            // Refresh offers/trades tabs when trade updates occur
            if (refreshCallbacksRef.current.receivedOffers) {
              refreshCallbacksRef.current.receivedOffers()
            }
            if (refreshCallbacksRef.current.ongoingTrades) {
              refreshCallbacksRef.current.ongoingTrades()
            }
          }
        }
      }
      if (seenNotifIdsRef.current.size > 50) {
        const ids = [...seenNotifIdsRef.current].slice(-25)
        seenNotifIdsRef.current = new Set(ids)
      }
    } catch { }
  }, [user, token, showNotification, shouldNotify])

  useEffect(() => {
    if (!user) {
      if (streamAbortRef.current) {
        streamAbortRef.current.abort()
        streamAbortRef.current = null
      }
      setOfferCount(0)
      setNotificationCount(0)
      seenNotifIdsRef.current = new Set()
      hasInitializedSeenRef.current = false
      return
    }

    const handleMessage = (rawData: string) => {
      try {
        const payload = JSON.parse(rawData)
        if (!payload?.type) return
        
        // Deduplicate SSE messages: create a unique key and check if we've processed this recently
        const messageKey = JSON.stringify(payload)
        const lastProcessedTime = recentSSEMessagesRef.current.get(messageKey)
        if (lastProcessedTime && Date.now() - lastProcessedTime < SSE_MESSAGE_DEDUP_WINDOW) {
          // Skip this duplicate message
          return
        }
        recentSSEMessagesRef.current.set(messageKey, Date.now())
        
        // Clean up old messages from the map to prevent memory leaks
        if (recentSSEMessagesRef.current.size > 100) {
          const oldestEntries = Array.from(recentSSEMessagesRef.current.entries())
            .sort((a, b) => a[1] - b[1])
            .slice(0, 50)
          oldestEntries.forEach(([key]) => recentSSEMessagesRef.current.delete(key))
        }
        
        const data = payload.data || {}
        const message = data.message ?? payload.message
        switch (payload.type) {
          case 'trade_created':
            // Invalidate offers/trades in React Query cache so Dashboard refreshes immediately
            queryClient.invalidateQueries({ queryKey: ['dashboard'] })
            queryClient.invalidateQueries({ queryKey: ['trades'] })
            refreshCounts()
            // Refresh received offers and ongoing trades
            if (refreshCallbacksRef.current.receivedOffers) {
              refreshCallbacksRef.current.receivedOffers()
            }
            if (refreshCallbacksRef.current.ongoingTrades) {
              refreshCallbacksRef.current.ongoingTrades()
            }
            break
          case 'multiway_opportunity':
            // Multiway loop found for this user — refresh data, let Dashboard show the alert
            if (refreshCallbacksRef.current.multiway) refreshCallbacksRef.current.multiway()
            if (refreshCallbacksRef.current.multiwayAlert) refreshCallbacksRef.current.multiwayAlert()
            break
          case 'trade_updated':
            if (data.notification_type === 'trade_loop') {
              // Multiway update — refresh data, let Dashboard show the alert (no global toast)
              if (refreshCallbacksRef.current.multiway) refreshCallbacksRef.current.multiway()
              if (refreshCallbacksRef.current.multiwayAlert) refreshCallbacksRef.current.multiwayAlert()
            } else {
              if (shouldNotify({ notification_type: data.notification_type || 'trade_update', message })) {
                showNotification(message || `Trade ${data.status || 'updated'}`, 'info')
              }
            }
            // Invalidate offers/trades cache so updated trade appears immediately
            queryClient.invalidateQueries({ queryKey: ['dashboard'] })
            queryClient.invalidateQueries({ queryKey: ['trades'] })
            refreshCounts()
            if (refreshCallbacksRef.current.receivedOffers) refreshCallbacksRef.current.receivedOffers()
            if (refreshCallbacksRef.current.ongoingTrades) refreshCallbacksRef.current.ongoingTrades()
            break
          case 'trade_review_submitted':
          case 'trade_completed':
          case 'trade_loop_message':
          case 'trade_loop_completed':
          case 'trade_loop_ongoing':
          case 'trade_loop_broken':
          case 'trade_loop_cancelled':
            if (payload.type !== 'trade_loop_message') {
              if (shouldNotify({ notification_type: payload.type, message })) {
                showNotification(message || (payload.type === 'trade_completed' ? 'Trade completed!' : 'Trade updated'), 'success')
              }
            }
            // Refresh counts and all relevant tabs
            refreshCounts()
            if (refreshCallbacksRef.current.multiway) refreshCallbacksRef.current.multiway()
            if (refreshCallbacksRef.current.multiwayAlert) refreshCallbacksRef.current.multiwayAlert()
            if (refreshCallbacksRef.current.ongoingTrades) refreshCallbacksRef.current.ongoingTrades()
            // Invalidate queries for fresh data
            queryClient.invalidateQueries({ queryKey: ['dashboard'] })
            queryClient.invalidateQueries({ queryKey: ['trades'] })
            break
          case 'notification':
            refreshCounts()
            if (data.notification_type === 'trade_loop') {
              // Multiway notification — let Dashboard handle the toast, not a global popup
              if (refreshCallbacksRef.current.multiway) refreshCallbacksRef.current.multiway()
              if (refreshCallbacksRef.current.multiwayAlert) refreshCallbacksRef.current.multiwayAlert()
            } else if (data.notification_type === 'trade_offer') {
              if (shouldNotify({ notification_type: 'trade_offer', message })) {
                showNotification(message || 'New notification', 'success')
              }
              queryClient.invalidateQueries({ queryKey: ['dashboard', 'offers'] })
              if (refreshCallbacksRef.current.receivedOffers) refreshCallbacksRef.current.receivedOffers()
            } else if (data.notification_type === 'trade_update') {
              if (shouldNotify({ notification_type: 'trade_update', message })) {
                showNotification(message || 'Trade updated', 'info')
              }
              queryClient.invalidateQueries({ queryKey: ['dashboard', 'offers'] })
              if (refreshCallbacksRef.current.receivedOffers) refreshCallbacksRef.current.receivedOffers()
              if (refreshCallbacksRef.current.ongoingTrades) refreshCallbacksRef.current.ongoingTrades()
            } else if (data.notification_type === 'product_sold') {
              if (shouldNotify({ notification_type: data.notification_type, message })) {
                showNotification(message || 'New notification', data.alert ? 'alert' : 'success')
              }
              if (refreshCallbacksRef.current.products) refreshCallbacksRef.current.products()
            } else {
              if (shouldNotify({ notification_type: data.notification_type, message })) {
                showNotification(message || 'New notification', data.alert ? 'alert' : 'success')
              }
            }
            break
          case 'trade_auto_completed':
            // Trade auto-completed after both reviews submitted
            if (shouldNotify({ notification_type: 'trade_update', message: 'Trade auto-completed!' })) {
              showNotification('Trade auto-completed!', 'success')
            }
            queryClient.invalidateQueries({ queryKey: ['dashboard'] })
            queryClient.invalidateQueries({ queryKey: ['trades'] })
            refreshCounts()
            if (refreshCallbacksRef.current.ongoingTrades) {
              refreshCallbacksRef.current.ongoingTrades()
            }
            break
          case 'trade_message':
            break
          default:
            break
        }
      } catch { }
    }

    const base = getSseBaseUrl()
    const url = `${base}/api/chat/stream`
    const controller = new AbortController()
    streamAbortRef.current = controller

    const readStream = async () => {
      try {
        const response = await fetch(url, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          credentials: 'include',
          signal: controller.signal,
        })
        if (!response.ok || !response.body) return

        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ''

        while (!controller.signal.aborted) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const events = buffer.split(/\n\n/)
          buffer = events.pop() || ''

          for (const event of events) {
            const data = event
              .split(/\n/)
              .filter(line => line.startsWith('data:'))
              .map(line => line.replace(/^data:\s?/, ''))
              .join('\n')
            if (data) handleMessage(data)
          }
        }
      } catch (error: any) {
        if (error?.name !== 'AbortError' && import.meta.env.DEV) {
          console.warn('Realtime stream disconnected')
        }
      }
    }

    void readStream()

    return () => {
      controller.abort()
      if (streamAbortRef.current === controller) {
        streamAbortRef.current = null
      }
    }
  }, [user, token, getSseBaseUrl, shouldNotify, showNotification, queryClient, refreshCounts])

  useEffect(() => { if (user) refreshCounts() }, [user, token, refreshCounts])

  // Polling fallback when SSE may not deliver (e.g. tab backgrounded, connection issues)
  useEffect(() => {
    if (!user) return
    const interval = setInterval(refreshCounts, POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [user, token, refreshCounts])

  const refreshMultiWayTrades = useCallback(() => {
    if (refreshCallbacksRef.current.multiway) {
      refreshCallbacksRef.current.multiway()
    }
  }, [])

  const refreshProducts = useCallback(() => {
    if (refreshCallbacksRef.current.products) {
      refreshCallbacksRef.current.products()
    }
  }, [])

  const refreshSentOffers = useCallback(() => {
    if (refreshCallbacksRef.current.sentOffers) {
      refreshCallbacksRef.current.sentOffers()
    }
  }, [])

  const refreshReceivedOffers = useCallback(() => {
    if (refreshCallbacksRef.current.receivedOffers) {
      refreshCallbacksRef.current.receivedOffers()
    }
  }, [])

  const refreshOngoingTrades = useCallback(() => {
    if (refreshCallbacksRef.current.ongoingTrades) {
      refreshCallbacksRef.current.ongoingTrades()
    }
  }, [])

  const refreshHistory = useCallback(() => {
    if (refreshCallbacksRef.current.history) {
      refreshCallbacksRef.current.history()
    }
  }, [])

  const setRefreshCallback = useCallback((tabType: 'products' | 'sentOffers' | 'receivedOffers' | 'ongoingTrades' | 'multiway' | 'history' | 'multiwayAlert', cb: () => void) => {
    refreshCallbacksRef.current[tabType] = cb
  }, [])

  return (
    <RealtimeContext.Provider value={{
      offerCount,
      notificationCount,
      refreshCounts,
      refreshProducts,
      refreshSentOffers,
      refreshReceivedOffers,
      refreshOngoingTrades,
      refreshMultiWayTrades,
      refreshHistory,
      setRefreshCallback,
    }}>
      {children}
    </RealtimeContext.Provider>
  )
}

export const useRealtime = () => useContext(RealtimeContext)
