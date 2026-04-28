import React, { useEffect, useRef, useState } from 'react'
import { Box, Text } from '@chakra-ui/react'
import { motion, useReducedMotion } from 'framer-motion'
import { useQueryClient } from '@tanstack/react-query'
import { motionDurations, motionEasings } from '../utils/motion'

const MotionBox = motion(Box)
const MAX_PULL = 84
const TRIGGER_PULL = 64

const PullToRefresh: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const queryClient = useQueryClient()
  const prefersReducedMotion = useReducedMotion()
  const startYRef = useRef(0)
  const startXRef = useRef(0)
  const pullingRef = useRef(false)
  const [pull, setPull] = useState(0)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    if (prefersReducedMotion) return

    const onTouchStart = (event: TouchEvent) => {
      if (window.scrollY > 0 || event.touches.length !== 1) return
      startYRef.current = event.touches[0].clientY
      startXRef.current = event.touches[0].clientX
      pullingRef.current = true
    }

    const onTouchMove = (event: TouchEvent) => {
      if (!pullingRef.current || event.touches.length !== 1) return
      const deltaY = event.touches[0].clientY - startYRef.current
      const deltaX = Math.abs(event.touches[0].clientX - startXRef.current)
      if (deltaY <= 0 || deltaX > deltaY) {
        pullingRef.current = false
        setPull(0)
        return
      }
      if (window.scrollY > 0) return
      const resistedPull = Math.min(MAX_PULL, Math.sqrt(deltaY) * 9)
      setPull(resistedPull)
    }

    const onTouchEnd = () => {
      if (!pullingRef.current) return
      pullingRef.current = false
      if (pull >= TRIGGER_PULL) {
        setRefreshing(true)
        window.dispatchEvent(new CustomEvent('clovia:pull-refresh'))
        queryClient.invalidateQueries()
        window.setTimeout(() => {
          setRefreshing(false)
          setPull(0)
        }, 450)
        return
      }
      setPull(0)
    }

    window.addEventListener('touchstart', onTouchStart, { passive: true })
    window.addEventListener('touchmove', onTouchMove, { passive: true })
    window.addEventListener('touchend', onTouchEnd, { passive: true })
    window.addEventListener('touchcancel', onTouchEnd, { passive: true })
    return () => {
      window.removeEventListener('touchstart', onTouchStart)
      window.removeEventListener('touchmove', onTouchMove)
      window.removeEventListener('touchend', onTouchEnd)
      window.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [prefersReducedMotion, pull, queryClient])

  return (
    <>
      <MotionBox
        position="fixed"
        top="env(safe-area-inset-top, 0px)"
        left="50%"
        zIndex={1500}
        px={3}
        py={1.5}
        borderRadius="full"
        bg="whiteAlpha.950"
        color="brand.700"
        boxShadow="sm"
        borderWidth="1px"
        borderColor="blackAlpha.100"
        pointerEvents="none"
        initial={false}
        animate={{
          opacity: pull > 10 || refreshing ? 1 : 0,
          y: pull > 10 || refreshing ? 10 : -18,
          x: '-50%',
          scale: refreshing ? 1 : Math.min(1, 0.92 + pull / 420),
        }}
        transition={{ duration: motionDurations.ui, ease: motionEasings.easeOut }}
      >
        <Text fontSize="11px" fontWeight="700">
          {refreshing ? 'Refreshing...' : pull >= TRIGGER_PULL ? 'Release to refresh' : 'Pull to refresh'}
        </Text>
      </MotionBox>
      <MotionBox
        initial={false}
        animate={{ y: prefersReducedMotion ? 0 : Math.min(pull, 48) }}
        transition={{ duration: motionDurations.ui, ease: motionEasings.easeOut }}
        style={{ willChange: pull > 0 ? 'transform' : 'auto' }}
      >
        {children}
      </MotionBox>
    </>
  )
}

export default PullToRefresh
