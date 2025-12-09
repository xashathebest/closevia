import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react'
import { createStandaloneToast } from '@chakra-ui/react'
import { useAuth } from './AuthContext'
import { api } from '../services/api'

export type TradeStatusNotification = {
  id: string
  tradeId: number
  status: 'accepted' | 'declined' | 'completed'
  productTitle: string
  partnerName: string
  message: string
  isIncoming: boolean
  timestamp: number
}

type RealtimeContextValue = {
  offerCount: number
  notificationCount: number
  refreshCounts: () => void
  tradeStatusNotifications: TradeStatusNotification[]
  clearTradeNotification: (id: string) => void
}

const RealtimeContext = createContext<RealtimeContextValue>({ 
  offerCount: 0, 
  notificationCount: 0, 
  refreshCounts: () => {},
  tradeStatusNotifications: [],
  clearTradeNotification: () => {}
})

export const RealtimeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth()
  const esRef = useRef<EventSource | null>(null)
  const [offerCount, setOfferCount] = useState(0)
  const [notificationCount, setNotificationCount] = useState(0)
  const [tradeStatusNotifications, setTradeStatusNotifications] = useState<TradeStatusNotification[]>([])
  const lastToastAtRef = useRef<number>(0)

  const clearTradeNotification = useCallback((id: string) => {
    setTradeStatusNotifications(prev => prev.filter(n => n.id !== id))
  }, [])

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
            // Handle trade status updates with detailed information
            if (payload.data) {
              const { status, trade_id, product_title, partner_name, is_incoming } = payload.data
              const statusMap: Record<string, 'accepted' | 'declined' | 'completed'> = {
                'accepted': 'accepted',
                'declined': 'declined',
                'completed': 'completed'
              }
              
              if (status && statusMap[status]) {
                const notificationId = `${trade_id}-${status}-${Date.now()}`
                const statusMessages: Record<string, string> = {
                  'accepted': is_incoming ? 'has accepted your offer' : 'You accepted the offer',
                  'declined': is_incoming ? 'declined your offer' : 'You declined the offer',
                  'completed': 'Trade completed successfully'
                }
                
                const newNotification: TradeStatusNotification = {
                  id: notificationId,
                  tradeId: trade_id,
                  status: statusMap[status],
                  productTitle: product_title || 'Your item',
                  partnerName: partner_name || 'Trading partner',
                  message: statusMessages[status],
                  isIncoming: is_incoming ?? false,
                  timestamp: Date.now()
                }
                
                setTradeStatusNotifications(prev => [...prev, newNotification])
                
                // Also show toast notification
                try {
                  const { toast } = createStandaloneToast()
                  const statusColors: Record<string, any> = {
                    'accepted': 'success',
                    'declined': 'warning',
                    'completed': 'success'
                  }
                  
                  toast({
                    title: `Trade ${status}`,
                    description: `${newNotification.partnerName}: ${newNotification.productTitle}`,
                    status: statusColors[status] || 'info',
                    duration: 5000,
                    isClosable: true,
                    position: 'top-right',
                  })
                } catch {}
              }
            }
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
    <RealtimeContext.Provider value={{ offerCount, notificationCount, refreshCounts, tradeStatusNotifications, clearTradeNotification }}>
      {children}
    </RealtimeContext.Provider>
  )
}

export const useRealtime = () => useContext(RealtimeContext)


