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
  const [isWarningOpen, setIsWarningOpen] = useState(false)

  const clearTimers = useCallback(() => {
    if (warningTimerRef.current) window.clearTimeout(warningTimerRef.current)
    if (logoutTimerRef.current) window.clearTimeout(logoutTimerRef.current)
    warningTimerRef.current = undefined
    logoutTimerRef.current = undefined
  }, [])

  const expireSession = useCallback(() => {
    clearTimers()
    setIsWarningOpen(false)
    logout()
    toast({
      id: 'session-expired-idle',
      title: 'Session expired',
      description: 'Your session expired due to inactivity.',
      status: 'info',
      duration: 5000,
      isClosable: true,
    })
    navigate('/login', { replace: true, state: { sessionExpired: true, from: location.pathname } })
  }, [clearTimers, location.pathname, logout, navigate, toast])

  const scheduleTimers = useCallback(() => {
    clearTimers()
    if (!isAuthenticated) return

    const warningDelay = Math.max(IDLE_TIMEOUT_MS - WARNING_MS, 1000)
    warningTimerRef.current = window.setTimeout(() => setIsWarningOpen(true), warningDelay)
    logoutTimerRef.current = window.setTimeout(expireSession, IDLE_TIMEOUT_MS)
  }, [clearTimers, expireSession, isAuthenticated])

  const touchSession = useCallback(async (force = false) => {
    if (!isAuthenticated) return
    const now = Date.now()
    if (!force && now - lastSessionTouchRef.current < TOUCH_THROTTLE_MS) return
    lastSessionTouchRef.current = now
    try {
      await api.post('/api/auth/refresh-session')
    } catch (error: any) {
      if (error?.response?.status === 401) {
        expireSession()
      }
    }
  }, [expireSession, isAuthenticated])

  const markActivity = useCallback(() => {
    if (!isAuthenticated || isWarningOpen) return
    scheduleTimers()
    void touchSession()
  }, [isAuthenticated, isWarningOpen, scheduleTimers, touchSession])

  const stayLoggedIn = useCallback(async () => {
    setIsWarningOpen(false)
    await touchSession(true)
    await refreshUser().catch(() => undefined)
    scheduleTimers()
  }, [refreshUser, scheduleTimers, touchSession])

  useEffect(() => {
    if (!isAuthenticated) {
      clearTimers()
      setIsWarningOpen(false)
      return
    }

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
        <ModalHeader>Session Expiring Soon</ModalHeader>
        <ModalBody>
          <Text>You have been inactive for a while. Your session will expire soon unless you stay logged in.</Text>
        </ModalBody>
        <ModalFooter gap={3}>
          <Button variant="ghost" onClick={expireSession}>Log Out</Button>
          <Button colorScheme="brand" onClick={stayLoggedIn}>Stay Logged In</Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

export default SessionTimeoutManager
