import React, { useEffect, useState } from 'react'
import { Link as RouterLink } from 'react-router-dom'
import {
  Box,
  HStack,
  Button,
  IconButton,
  Icon,
  VStack,
} from '@chakra-ui/react'
import {
  AddIcon,
  HamburgerIcon,
} from '@chakra-ui/icons'
import { FaHome, FaBell } from 'react-icons/fa'
import { FiShoppingBag } from 'react-icons/fi'
import { Badge as CBadge } from '@chakra-ui/react'
import { useRealtime } from '../contexts/RealtimeContext'
import { useMobileNav } from '../contexts/MobileNavContext'
import { useNavigate } from 'react-router-dom'
import { motion, useReducedMotion } from 'framer-motion'
import { motionDurations, motionEasings } from '../utils/motion'

const MotionBox = motion(Box)
const MotionBadge = motion(CBadge)

interface FloatingTabProps {
  dashboardLink?: string
  homeLink?: string
  addProductLink?: string
  showAddButton?: boolean
  isSelectMode?: boolean
}

const FloatingTab: React.FC<FloatingTabProps> = ({
  dashboardLink = '/dashboard',
  homeLink = '/home',
  addProductLink = '/add-product',
  showAddButton = true,
  isSelectMode = false,
}) => {
  const { notificationCount, offerCount } = useRealtime()
  const { onOpen: openMobileNav } = useMobileNav()
  const navigate = useNavigate()
  const prefersReducedMotion = useReducedMotion()
  const [hidden, setHidden] = useState(false)
  const [notificationPulseKey, setNotificationPulseKey] = useState(0)
  const [offerPulseKey, setOfferPulseKey] = useState(0)
  const previousNotificationCount = React.useRef(notificationCount)
  const previousOfferCount = React.useRef(offerCount)

  useEffect(() => {
    let lastY = window.scrollY
    let ticking = false
    const onScroll = () => {
      if (ticking) return
      ticking = true
      window.requestAnimationFrame(() => {
        const nextY = window.scrollY
        const delta = nextY - lastY
        if (Math.abs(delta) > 8) {
          setHidden(delta > 0 && nextY > 120)
          lastY = nextY
        }
        ticking = false
      })
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  useEffect(() => {
    if (notificationCount > previousNotificationCount.current) {
      setNotificationPulseKey(key => key + 1)
    }
    previousNotificationCount.current = notificationCount
  }, [notificationCount])

  useEffect(() => {
    if (offerCount > previousOfferCount.current) {
      setOfferPulseKey(key => key + 1)
    }
    previousOfferCount.current = offerCount
  }, [offerCount])

  const tapStyles = {
    _active: {
      bg: 'rgba(49, 151, 149, 0.16)',
      transform: prefersReducedMotion ? undefined : 'scale(0.97)',
    },
  }

  return (
    <>
      {/* Mobile Bottom Navigation Bar - Floating Tab */}
      <MotionBox
        position="fixed"
        bottom="calc(env(safe-area-inset-bottom, 0px) + 16px)"
        left="50%"
        display={{ base: 'block', md: 'none' }}
        zIndex={200}
        boxShadow="0 8px 32px rgba(0,0,0,0.12)"
        borderRadius="full"
        overflow="hidden"
        initial={false}
        animate={{
          x: '-50%',
          y: (hidden || isSelectMode) && !prefersReducedMotion ? 120 : 0,
          opacity: (hidden || isSelectMode) && !prefersReducedMotion ? 0 : 1,
          scale: isSelectMode && !prefersReducedMotion ? 0.85 : 1,
          pointerEvents: isSelectMode ? 'none' : 'auto',
        }}
        transition={{ duration: motionDurations.uiSlow, ease: motionEasings.easeOut }}
        style={{ willChange: 'transform, opacity' }}
      >
        <HStack
          spacing={0}
          h="64px"
          justify="space-between"
          align="center"
          bg="rgba(255, 255, 255, 0.95)"
          backdropFilter="blur(20px)"
          border="1px solid rgba(255, 255, 255, 0.4)"
          px={2}
          py={2}
        >
          {/* Home Button */}
          <IconButton
            as={RouterLink}
            to={homeLink}
            aria-label="Home"
            icon={<FaHome />}
            h="full"
            w="56px"
            flexShrink={0}
            bg="transparent"
            color="brand.500"
            borderRadius="full"
            variant="ghost"
            fontSize="20px"
            transition="transform 180ms ease-out, background-color 180ms ease-out, color 180ms ease-out"
            _hover={{
              bg: 'rgba(49, 151, 149, 0.1)',
              color: 'brand.600',
              transform: prefersReducedMotion ? undefined : 'scale(1.03)',
            }}
            {...tapStyles}
          />

          {/* Dashboard Button */}
          <Box position="relative" h="full" w="56px" flexShrink={0}>
            <IconButton
              as={RouterLink}
              to={dashboardLink}
              aria-label="Dashboard"
              icon={<FiShoppingBag />}
              h="full"
              w="full"
              minW="56px"
              bg="transparent"
              color="brand.500"
              borderRadius="full"
              variant="ghost"
              fontSize="20px"
              transition="transform 180ms ease-out, background-color 180ms ease-out, color 180ms ease-out"
              _hover={{
                bg: 'rgba(49, 151, 149, 0.1)',
                color: 'brand.600',
                transform: prefersReducedMotion ? undefined : 'scale(1.03)',
              }}
              {...tapStyles}
            />
            {offerCount > 0 && (
              <MotionBadge
                key={`offers-${offerPulseKey}`}
                position="absolute"
                top="-4px"
                right="-4px"
                colorScheme="red"
                borderRadius="full"
                fontSize="0.7em"
                px={1}
                zIndex={1}
                animate={prefersReducedMotion ? undefined : { scale: [1, 1.18, 1] }}
                transition={{ duration: 0.32, ease: motionEasings.easeOut }}
              >
                {offerCount}
              </MotionBadge>
            )}
          </Box>

          {/* Add Product Button - LARGE CIRCULAR CENTER */}
          {showAddButton && (
            <Button
              as={RouterLink}
              to={addProductLink}
              h="72px"
              w="72px"
              flexShrink={0}
              bg="linear(to-br, brand.500, teal.400)"
              color="white"
              borderRadius="full"
              boxShadow="0 6px 24px rgba(49, 151, 149, 0.4)"
              transition="transform 200ms ease-out, box-shadow 200ms ease-out, background 200ms ease-out"
              display="flex"
              alignItems="center"
              justifyContent="center"
              _hover={{
                transform: prefersReducedMotion ? undefined : 'translateY(-2px) scale(1.03)',
                boxShadow: '0 12px 32px rgba(49, 151, 149, 0.5)',
                bg: 'linear(to-br, brand.600, teal.500)',
              }}
              _active={{
                transform: prefersReducedMotion ? undefined : 'scale(0.97)',
                boxShadow: '0 8px 24px rgba(49, 151, 149, 0.4)',
              }}
              position="relative"
            >
              <Icon as={AddIcon} boxSize={10} color="green.500" strokeWidth="3" />
            </Button>
          )}

          {/* Notification Button */}
          <Box position="relative" h="full" w="56px" flexShrink={0}>
            <IconButton
              aria-label="Notifications"
              icon={<FaBell />}
              h="full"
              w="full"
              minW="56px"
              bg="transparent"
              color="brand.500"
              borderRadius="full"
              variant="ghost"
              fontSize="20px"
              transition="transform 180ms ease-out, background-color 180ms ease-out, color 180ms ease-out"
              _hover={{
                bg: 'rgba(49, 151, 149, 0.1)',
                color: 'brand.600',
                transform: prefersReducedMotion ? undefined : 'scale(1.03)',
              }}
              {...tapStyles}
              onClick={() => navigate('/notifications')}
            />
            {notificationCount > 0 && (
              <MotionBadge
                key={`notifications-${notificationPulseKey}`}
                position="absolute"
                top="-4px"
                right="-4px"
                colorScheme="red"
                borderRadius="full"
                fontSize="0.7em"
                px={1}
                zIndex={1}
                pointerEvents="none"
                animate={prefersReducedMotion ? undefined : { scale: [1, 1.18, 1] }}
                transition={{ duration: 0.32, ease: motionEasings.easeOut }}
              >
                {notificationCount}
              </MotionBadge>
            )}
          </Box>

          {/* Hamburger Menu Button */}
          <IconButton
            aria-label="Menu"
            icon={<HamburgerIcon />}
            h="full"
            w="56px"
            flexShrink={0}
            bg="transparent"
            color="brand.500"
            borderRadius="full"
            variant="ghost"
            fontSize="20px"
            transition="transform 180ms ease-out, background-color 180ms ease-out, color 180ms ease-out"
            _hover={{
              bg: 'rgba(49, 151, 149, 0.1)',
              color: 'brand.600',
              transform: prefersReducedMotion ? undefined : 'scale(1.03)',
            }}
            {...tapStyles}
            onClick={openMobileNav}
          />
        </HStack>
      </MotionBox>

      {/* Floating Add Product FAB - Desktop/Tablet */}
      {showAddButton && (
        <IconButton
          as={RouterLink}
          to={addProductLink}
          aria-label="Add product"
          icon={<AddIcon />}
          position="fixed"
          bottom="calc(env(safe-area-inset-bottom, 0px) + 48px)"
          right={6}
          h={14}
          w={14}
          bgGradient="linear(to-br, brand.500, teal.400)"
          color="white"
          borderRadius="full"
          zIndex={200}
          boxShadow="lg"
          display={{ base: 'none', md: 'flex' }}
          transition="all 0.2s ease"
          _hover={{
            transform: 'translateY(-2px) scale(1.05)',
            boxShadow: '0 14px 24px rgba(0, 0, 0, 0.2)',
            bgGradient: 'linear(to-br, brand.600, teal.500)',
          }}
          _active={{
            transform: 'translateY(0) scale(1.01)',
          }}
        />
      )}
    </>
  )
}

export default FloatingTab
