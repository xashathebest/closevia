import { useEffect, useState, useCallback } from 'react'
import { useToast } from '@chakra-ui/react'
import { api } from '../services/api'

export interface TradeLoopNotification {
  id: string
  type: 'trade_loop'
  message: string
  participant_count: number
  loop_id: string
  created_at: string
  read: boolean
}

/**
 * Hook to monitor for trade loop notifications
 * Automatically shows toast notifications when a trade loop is detected
 */
export const useTradeLoopNotifications = () => {
  const [notifications, setNotifications] = useState<TradeLoopNotification[]>([])
  const [isListening, setIsListening] = useState(false)
  const toast = useToast()

  // Subscribe to trade loop notifications via SSE or polling
  useEffect(() => {
    let pollInterval: ReturnType<typeof setInterval> | null = null

    const startPolling = () => {
      setIsListening(true)
      // Poll for trade loop notifications every 15 seconds
      pollInterval = setInterval(async () => {
        try {
          const response = await api.get('/api/trades/loops/notifications')
          const data: TradeLoopNotification[] = Array.isArray(response.data?.data)
            ? response.data.data
            : []

          // Check for new notifications (that we haven't shown yet)
          const newNotifications = data.filter(
            (n) =>
              !notifications.some((existing) => existing.id === n.id) &&
              n.type === 'trade_loop' &&
              !n.read
          )

          // Show toast for new trade loop notifications
          newNotifications.forEach((notif) => {
            toast({
              title: '🔗 Multi-Way Trade Detected!',
              description: notif.message,
              status: 'success',
              duration: 8000,
              isClosable: true,
              position: 'top-right',
            })
          })

          setNotifications(data)
        } catch (error) {
          console.error('Failed to poll trade loop notifications:', error)
        }
      }, 15000)
    }

    startPolling()

    return () => {
      if (pollInterval) {
        clearInterval(pollInterval)
      }
      setIsListening(false)
    }
  }, [notifications, toast])

  const markAsRead = useCallback(async (notificationId: string) => {
    try {
      await api.post(`/api/trades/loops/notifications/${notificationId}/read`)
      setNotifications((prev) =>
        prev.map((n) => (n.id === notificationId ? { ...n, read: true } : n))
      )
    } catch (error) {
      console.error('Failed to mark notification as read:', error)
    }
  }, [])

  const clearNotifications = useCallback(async () => {
    try {
      await api.post('/api/trades/loops/notifications/clear')
      setNotifications([])
    } catch (error) {
      console.error('Failed to clear notifications:', error)
    }
  }, [])

  return {
    notifications,
    isListening,
    markAsRead,
    clearNotifications,
    unreadCount: notifications.filter((n) => !n.read).length,
  }
}
