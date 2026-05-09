import React from 'react'
import { Box, Center, Text, VStack } from '@chakra-ui/react'
import { AnimatePresence, motion } from 'framer-motion'
import { API_BASE_URL } from '../services/api'

const MotionBox = motion(Box)

const WAKE_DELAY_MS = 900
const MAX_HEALTH_WAIT_MS = 25000
const MIN_VISIBLE_MS = 450
const HEALTH_REQUEST_TIMEOUT_MS = 8000
const HEALTH_RETRY_DELAY_MS = 1500

let healthCheckPromise: Promise<void> | null = null

function getHealthUrl(): string {
  const baseUrl = API_BASE_URL || (import.meta.env.DEV ? 'http://localhost:4000' : '')
  return `${baseUrl.replace(/\/$/, '')}/health`
}

function checkBackendHealth(): Promise<void> {
  if (healthCheckPromise) return healthCheckPromise

  healthCheckPromise = new Promise((resolve) => {
    const deadline = Date.now() + MAX_HEALTH_WAIT_MS
    const sleep = (ms: number) => new Promise(done => window.setTimeout(done, ms))

    const attempt = async () => {
      while (Date.now() < deadline) {
        const controller = new AbortController()
        const timeoutId = window.setTimeout(() => controller.abort(), HEALTH_REQUEST_TIMEOUT_MS)
        const startedAt = Date.now()

        try {
          const response = await fetch(getHealthUrl(), {
            method: 'GET',
            cache: 'no-store',
            credentials: 'omit',
            signal: controller.signal,
          })
          const responseMs = Date.now() - startedAt
          if (response.ok) {
            try {
              const body = await response.clone().json()
              console.info('[AppLoader] /health ready', {
                response_ms: responseMs,
                utc: body?.wake_status?.utc,
                philippine_time: body?.wake_status?.philippine_time,
                timezone: body?.timezone,
              })
            } catch {
              console.info('[AppLoader] /health ready', { response_ms: responseMs })
            }
            resolve()
            return
          }
        } catch {
          // Backend may be waking. Retry until fallback deadline.
        } finally {
          window.clearTimeout(timeoutId)
        }

        await sleep(HEALTH_RETRY_DELAY_MS)
      }

      console.warn('[AppLoader] /health did not respond before fallback timeout; allowing app to render.')
      resolve()
    }

    void attempt()
  })

  return healthCheckPromise
}

const WakingServerScreen: React.FC = () => (
  <MotionBox
    position="fixed"
    inset={0}
    zIndex={10000}
    bg="linear-gradient(145deg, #f0fdfa 0%, #ffffff 48%, #e6fffa 100%)"
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    exit={{ opacity: 0 }}
    transition={{ duration: 0.35, ease: 'easeOut' }}
  >
    <Center minH="100vh" px={6}>
      <VStack spacing={6} textAlign="center">
        <MotionBox
          w="88px"
          h="88px"
          borderRadius="28px"
          bg="white"
          border="1px solid"
          borderColor="teal.100"
          boxShadow="0 22px 60px rgba(49, 151, 149, 0.22)"
          display="flex"
          alignItems="center"
          justifyContent="center"
          animate={{ scale: [1, 1.04, 1], opacity: [0.92, 1, 0.92] }}
          transition={{ duration: 1.8, repeat: Infinity, ease: 'easeInOut' }}
          aria-hidden="true"
        >
          <Box
            w="48px"
            h="48px"
            borderRadius="16px"
            bg="#319795"
            boxShadow="inset 0 -10px 18px rgba(0, 0, 0, 0.08)"
          />
        </MotionBox>

        <VStack spacing={2}>
          <Text
            as="h1"
            fontSize={{ base: '2xl', md: '3xl' }}
            fontWeight="800"
            color="gray.800"
            lineHeight="1.15"
          >
            Waking up CloviaPH...
          </Text>
          <Text fontSize={{ base: 'md', md: 'lg' }} color="gray.600">
            First load may take a few seconds ☁️
          </Text>
        </VStack>
      </VStack>
    </Center>
  </MotionBox>
)

const AppLoader: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [ready, setReady] = React.useState(false)
  const [showWakeScreen, setShowWakeScreen] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    let shownAt = 0
    const delayId = window.setTimeout(() => {
      shownAt = Date.now()
      if (!cancelled) setShowWakeScreen(true)
    }, WAKE_DELAY_MS)

    checkBackendHealth().finally(() => {
      window.clearTimeout(delayId)
      const visibleFor = shownAt ? Date.now() - shownAt : 0
      const remainingVisibleTime = Math.max(0, MIN_VISIBLE_MS - visibleFor)

      window.setTimeout(() => {
        if (cancelled) return
        setReady(true)
        setShowWakeScreen(false)
      }, remainingVisibleTime)
    })

    return () => {
      cancelled = true
      window.clearTimeout(delayId)
    }
  }, [])

  return (
    <>
      {ready ? children : null}
      <AnimatePresence>{showWakeScreen && !ready ? <WakingServerScreen /> : null}</AnimatePresence>
    </>
  )
}

export default AppLoader
