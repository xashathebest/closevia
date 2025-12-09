import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react'
import { createStandaloneToast } from '@chakra-ui/react'
import { useAuth } from './AuthContext'
import { api } from '../services/api'

type RealtimeContextValue = {
  offerCount: number
  notificationCount: number
  refreshCounts: () => void
}

const RealtimeContext = createContext<RealtimeContextValue>({ offerCount: 0, notificationCount: 0, refreshCounts: () => {} })

export const RealtimeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth()
  const esRef = useRef<EventSource | null>(null)
  const [offerCount, setOfferCount] = useState(0)
  const [notificationCount, setNotificationCount] = useState(0)
  const lastToastAtRef = useRef<number>(0)

  const refreshCounts = useCallback(async () => {
    try {
      const [offersRes, notifRes] = await Promise.all([
        api.get('/api/trades/count', { params: { direction: 'incoming', status: 'pending' } }),
        api.get('/api/notifications'),
      ])
      const count = offersRes.data?.data?.count ?? 0
      setOfferCount(count)
      const notifs = Array.isArray(notifRes.data?.data) ? notifRes.data.data : []
      setNotificationCount(notifs.filter((n: any) => !n.read).length)
    } catch {}
  }, [])

  useEffect(() => {
    if (!user) {
      if (esRef.current) {
        esRef.current.close()
        esRef.current = null
      }
      return
    }
    // Use token for SSE auth
    const token = localStorage.getItem('clovia_token')
    if (!token) return
    const url = `http://localhost:4000/api/chat/stream?token=${encodeURIComponent(token)}`
    const es = new EventSource(url)
    esRef.current = es

    es.onmessage = (ev) => {
      try {
        const payload = JSON.parse(ev.data)
        if (!payload?.type) return
        switch (payload.type) {
          case 'trade_created':
            refreshCounts()
            // Notify user about new offer
            try {
              const now = Date.now()
              // Simple rate-limit: avoid duplicate toasts within 2s
              if (now - lastToastAtRef.current < 2000) break
              lastToastAtRef.current = now
              const { toast } = createStandaloneToast()
              toast({
                title: 'New offer received',
                description: 'You have a new incoming offer.',
                status: 'info',
                duration: 4000,
                isClosable: true,
                position: 'top-right',
              })
            } catch {}
            break
          case 'trade_updated':
            refreshCounts()
            break
          case 'notification':
            refreshCounts()
            break
          case 'trade_message':
            // optional: toast or custom event
            break
          default:
            break
        }
      } catch {}
    }

    es.onerror = () => {
      // auto-reconnect pattern: close and let useEffect create again on next render
      es.close()
      esRef.current = null
    }

    return () => {
      es.close()
      esRef.current = null
    }
  }, [user])

  useEffect(() => { if (user) refreshCounts() }, [user, refreshCounts])

  return (
    <RealtimeContext.Provider value={{ offerCount, notificationCount, refreshCounts }}>
      {children}
    </RealtimeContext.Provider>
  )
}

export const useRealtime = () => useContext(RealtimeContext)


