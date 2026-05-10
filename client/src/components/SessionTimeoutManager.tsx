import React, { useCallback, useEffect, useRef, useState } from 'react'
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Text,
  useToast,
} from '@chakra-ui/react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { api } from '../services/api'
import { markAuthInvalid, onAuthInvalid } from '../utils/authEvents'
import { broadcastSessionActivity, getLastSessionActivity, onSessionActivity } from '../utils/authSync'

const minutesFromEnv = Number(import.meta.env.VITE_SESSION_IDLE_TIMEOUT_MINUTES)
const warningSecondsFromEnv = Number(import.meta.env.VITE_SESSION_TIMEOUT_WARNING_SECONDS)

const IDLE_TIMEOUT_MS = Number.isFinite(minutesFromEnv) && minutesFromEnv > 0
  ? minutesFromEnv * 60 * 1000
  : 30 * 60 * 1000

const WARNING_MS = Number.isFinite(warningSecondsFromEnv) && warningSecondsFromEnv > 0
  ? warningSecondsFromEnv * 1000
  : 60 * 1000

const TOUCH_THROTTLE_MS = 5 * 60 * 1000

const SessionTimeoutManager: React.FC = () => {
  const { isAuthenticated, logout, refreshUser } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const toast = useToast()
  const warningTimerRef = useRef<number | undefined>()
  const logoutTimerRef = useRef<number | undefined>()
  const lastSessionTouchRef = useRef(0)
  const lastActivityRef = useRef(getLastSessionActivity())
  const handledExpiryRef = useRef(false)
  const [isWarningOpen, setIsWarningOpen] = useState(false)

  const clearTimers = useCallback(() => {
    if (warningTimerRef.current) window.clearTimeout(warningTimerRef.current)
    if (logoutTimerRef.current) window.clearTimeout(logoutTimerRef.current)
    warningTimerRef.current = undefined
    logoutTimerRef.current = undefined
  }, [])

  const handleSessionExpired = useCallback((reason = 'idle') => {
    if (handledExpiryRef.current) return
    handledExpiryRef.current = true
    clearTimers()
    setIsWarningOpen(false)
    const toastId = 'session-expired'
    if (!toast.isActive(toastId)) {
      toast({
        id: toastId,
        title: 'Session expired',
        description: reason === 'idle'
          ? 'You were away for a bit — please log in again to continue.'
          : 'Your session is no longer valid. Please sign in again.',
        status: 'info',
        duration: 5000,
        isClosable: true,
        position: 'top',
      })
    }
    navigate('/login', { replace: true, state: { sessionExpired: true, from: location.pathname } })
  }, [clearTimers, location.pathname, navigate, toast])

  const expireSession = useCallback(() => {
    if (!markAuthInvalid('idle')) {
      handleSessionExpired('idle')
    }
  }, [handleSessionExpired])

  const manualLogout = useCallback(() => {
    clearTimers()
    setIsWarningOpen(false)
    logout()
    navigate('/login', { replace: true })
  }, [clearTimers, logout, navigate])

  const scheduleTimers = useCallback(() => {
    clearTimers()
    if (!isAuthenticated) return

    const elapsed = Math.max(Date.now() - lastActivityRef.current, 0)
    const remaining = IDLE_TIMEOUT_MS - elapsed

    if (remaining <= 0) {
      expireSession()
      return
    }

    const warningDelay = Math.max(remaining - WARNING_MS, 0)
    warningTimerRef.current = window.setTimeout(() => setIsWarningOpen(true), warningDelay)
    logoutTimerRef.current = window.setTimeout(expireSession, remaining)
  }, [clearTimers, expireSession, isAuthenticated])

  const touchSession = useCallback(async (force = false): Promise<boolean> => {
    if (!isAuthenticated || handledExpiryRef.current) return false
    const now = Date.now()
    if (!force && now - lastSessionTouchRef.current < TOUCH_THROTTLE_MS) return true
    lastSessionTouchRef.current = now
    try {
      await api.post('/api/auth/refresh-session')
      return true
    } catch (error: any) {
      if (error?.response?.status === 401) {
        markAuthInvalid('refresh_failed')
      }
      return false
    }
  }, [isAuthenticated])

  const markActivity = useCallback(() => {
    if (!isAuthenticated || isWarningOpen) return
    lastActivityRef.current = broadcastSessionActivity()
    setIsWarningOpen(false)
    scheduleTimers()
    void touchSession()
  }, [isAuthenticated, isWarningOpen, scheduleTimers, touchSession])

  const stayLoggedIn = useCallback(async () => {
    setIsWarningOpen(false)
    lastActivityRef.current = broadcastSessionActivity()
    const refreshed = await touchSession(true)
    if (!refreshed) return
    await refreshUser().catch(() => undefined)
    scheduleTimers()
  }, [refreshUser, scheduleTimers, touchSession])

  useEffect(() => onAuthInvalid(handleSessionExpired), [handleSessionExpired])

  useEffect(() => {
    if (isAuthenticated) {
      handledExpiryRef.current = false
      // Treat stale stored timestamps (older than the full idle timeout) as "now" so a
      // fresh login after a long absence doesn't immediately trigger session expiry.
      const stored = getLastSessionActivity()
      const activity = Date.now() - stored >= IDLE_TIMEOUT_MS ? Date.now() : stored
      lastActivityRef.current = broadcastSessionActivity(activity)
    }
  }, [isAuthenticated])

  useEffect(() => {
    return onSessionActivity((at) => {
      lastActivityRef.current = at
      if (!isAuthenticated) return
      setIsWarningOpen(false)
      scheduleTimers()
    })
  }, [isAuthenticated, scheduleTimers])

  useEffect(() => {
    if (!isAuthenticated) {
      clearTimers()
      setIsWarningOpen(false)
      return
    }

    const stored = getLastSessionActivity()
    const activity = Date.now() - stored >= IDLE_TIMEOUT_MS ? Date.now() : stored
    lastActivityRef.current = broadcastSessionActivity(activity)
    scheduleTimers()
    void touchSession(true)

    const events: Array<keyof WindowEventMap> = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'pointerdown']
    events.forEach((event) => window.addEventListener(event, markActivity, { passive: true }))
    window.addEventListener('focus', markActivity)
    document.addEventListener('visibilitychange', markActivity)

    return () => {
      clearTimers()
      events.forEach((event) => window.removeEventListener(event, markActivity))
      window.removeEventListener('focus', markActivity)
      document.removeEventListener('visibilitychange', markActivity)
    }
  }, [clearTimers, isAuthenticated, markActivity, scheduleTimers, touchSession])

  useEffect(() => {
    if (isAuthenticated && !isWarningOpen) {
      markActivity()
    }
  }, [isAuthenticated, isWarningOpen, location.pathname, markActivity])

  return (
    <Modal isOpen={isWarningOpen} onClose={stayLoggedIn} isCentered closeOnEsc closeOnOverlayClick={false}>
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>Still there?</ModalHeader>
        <ModalBody>
          <Text>You've been away for a bit. Your session is about to expire — tap below to stay logged in.</Text>
        </ModalBody>
        <ModalFooter gap={3}>
          <Button variant="ghost" onClick={manualLogout}>Log Out</Button>
          <Button colorScheme="brand" onClick={stayLoggedIn}>Stay Logged In</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

export default SessionTimeoutManager
