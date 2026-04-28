import React, { useEffect, useRef } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { useLocation, useNavigate, useNavigationType } from 'react-router-dom'
import { motionDurations, motionEasings } from '../utils/motion'

interface PageTransitionProps {
  children: React.ReactNode
}

export const PageTransition: React.FC<PageTransitionProps> = ({ children }) => {
  const location = useLocation()
  const navigate = useNavigate()
  const navigationType = useNavigationType()
  const prefersReducedMotion = useReducedMotion()
  const startRef = useRef<{ x: number; y: number; active: boolean } | null>(null)
  const isProductDetail = /^\/products\/[^/]+/.test(location.pathname)
  const isBackNavigation = navigationType === 'POP'

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' })
  }, [location.pathname])

  useEffect(() => {
    if (prefersReducedMotion) return

    const onTouchStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) return
      const touch = event.touches[0]
      startRef.current = {
        x: touch.clientX,
        y: touch.clientY,
        active: touch.clientX <= 22,
      }
    }

    const onTouchMove = (event: TouchEvent) => {
      const start = startRef.current
      if (!start?.active || event.touches.length !== 1) return
      const touch = event.touches[0]
      const dx = touch.clientX - start.x
      const dy = Math.abs(touch.clientY - start.y)
      if (dy > 42 && dy > dx) {
        startRef.current = null
        return
      }
      if (dx > 86 && dy < 54) {
        startRef.current = null
        navigate(-1)
      }
    }

    const onTouchEnd = () => {
      startRef.current = null
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
  }, [navigate, prefersReducedMotion])

  const initialX = prefersReducedMotion ? 0 : isProductDetail && !isBackNavigation ? 24 : isBackNavigation ? -8 : 0
  const exitX = prefersReducedMotion ? 0 : isProductDetail || isBackNavigation ? 24 : -6

  return (
    <motion.div
      key={location.pathname}
      initial={{ opacity: 0, x: initialX }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: exitX }}
      transition={{
        duration: prefersReducedMotion ? 0 : motionDurations.page,
        ease: motionEasings.easeInOut,
      }}
      style={{ width: '100%', willChange: 'transform, opacity' }}
    >
      {children}
    </motion.div>
  )
}

export default PageTransition
