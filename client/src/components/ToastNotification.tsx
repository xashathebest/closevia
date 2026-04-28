import React, { useEffect, useRef } from 'react'
import { Box, HStack, Text, IconButton, Icon } from '@chakra-ui/react'
import { InfoIcon } from '@chakra-ui/icons'
import { FaCheckCircle, FaExclamationTriangle } from 'react-icons/fa'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useNotification } from '../contexts/NotificationContext'
import { NOTIFICATION_AUTO_DISMISS_MS } from '../contexts/NotificationContext'
import type { Notification, NotificationType } from '../contexts/NotificationContext'
import { motionDurations, motionEasings } from '../utils/motion'

const MotionBox = motion(Box)

const getIcon = (type: NotificationType) => {
  switch (type) {
    case 'success':
      return FaCheckCircle
    case 'alert':
      return FaExclamationTriangle
    default:
      return InfoIcon
  }
}

const getBorderColor = (type: NotificationType) => {
  switch (type) {
    case 'success':
      return '#38a169' // green.500
    case 'alert':
      return '#e53e3e' // red.500
    default:
      return 'transparent'
  }
}

const getIconColor = (type: NotificationType) => {
  switch (type) {
    case 'success':
      return 'green.500'
    case 'alert':
      return 'red.500'
    default:
      return 'brand.500'
  }
}

interface ToastItemProps {
  notification: Notification
  index: number
  onDismiss: (id: string) => void
  onExited: (id: string) => void
}

const ToastItem: React.FC<ToastItemProps> = ({ notification, index, onDismiss, onExited }) => {
  const { id, message, type } = notification
  const [isExiting, setIsExiting] = React.useState(false)
  const prefersReducedMotion = useReducedMotion()
  const timeoutRef = useRef<number | null>(null)
  const exitTimeoutRef = useRef<number | null>(null)

  useEffect(() => {
    timeoutRef.current = window.setTimeout(() => {
      setIsExiting(true)
      exitTimeoutRef.current = window.setTimeout(() => {
        onExited(id)
      }, 300)
    }, NOTIFICATION_AUTO_DISMISS_MS)

    return () => {
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current)
      if (exitTimeoutRef.current) window.clearTimeout(exitTimeoutRef.current)
    }
  }, [id, onExited])

  const handleClose = () => {
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current)
      timeoutRef.current = null
    }
    setIsExiting(true)
    exitTimeoutRef.current = window.setTimeout(() => {
      onExited(id)
    }, 300)
  }

  const IconComponent = getIcon(type)

  return (
    <MotionBox
      position="relative"
      w="full"
      maxW={{ base: 'calc(100vw - 32px)', md: '400px' }}
      mx="auto"
      mb={index < 2 ? 0 : 3}
      initial={prefersReducedMotion ? false : { opacity: 0, y: 18, scale: 0.98 }}
      animate={{ opacity: isExiting ? 0 : 1, y: isExiting ? 12 : 0, scale: isExiting ? 0.98 : 1 }}
      exit={prefersReducedMotion ? undefined : { opacity: 0, y: 12, scale: 0.98 }}
      transition={{ duration: motionDurations.uiSlow, ease: motionEasings.easeOut }}
      style={{ willChange: 'transform, opacity' }}
    >
      <Box
        bg="rgba(255, 255, 255, 0.85)"
        backdropFilter="blur(8px)"
        sx={{ WebkitBackdropFilter: 'blur(8px)' }}
        borderRadius="30px"
        border="1px solid rgba(255, 255, 255, 0.5)"
        borderLeft="4px solid"
        borderLeftColor={getBorderColor(type)}
        boxShadow="0 4px 20px rgba(0, 0, 0, 0.08), 0 0 1px rgba(0, 0, 0, 0.05)"
        px={4}
        py={3}
        _dark={{
          bg: 'rgba(45, 55, 72, 0.9)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
        }}
      >
        <HStack spacing={3} align="center" justify="space-between">
          <Icon
            as={IconComponent}
            boxSize={5}
            color={getIconColor(type)}
            flexShrink={0}
          />
          <Text
            fontSize="sm"
            fontWeight="medium"
            color="gray.800"
            noOfLines={2}
            flex={1}
            _dark={{ color: 'gray.100' }}
          >
            {message}
          </Text>
          <IconButton
            aria-label="Close notification"
            icon={<Box as="span" fontSize="14px" fontWeight="bold" lineHeight={1}>×</Box>}
            variant="ghost"
            size="sm"
            minW={8}
            h={8}
            onClick={handleClose}
            color="gray.500"
            _hover={{ bg: 'rgba(0,0,0,0.05)', color: 'gray.700' }}
            _dark={{ _hover: { bg: 'rgba(255,255,255,0.08)', color: 'gray.300' } }}
          />
        </HStack>
      </Box>
    </MotionBox>
  )
}

const ToastNotification: React.FC = () => {
  const { notifications, dismissNotification } = useNotification()

  if (notifications.length === 0) return null

  return (
    <Box
      position="fixed"
      top={{ base: '80px', md: '20px' }}
      left="50%"
      transform="translateX(-50%)"
      zIndex={9999}
      w="full"
      maxW={{ base: '100%', md: '420px' }}
      px={{ base: 4, md: 0 }}
      pointerEvents="none"
      sx={{ '& > *': { pointerEvents: 'auto' } }}
    >
      <AnimatePresence initial={false}>
        <Box display="flex" flexDirection="column" alignItems="center" gap={3}>
          {notifications.map((n, i) => (
            <ToastItem
              key={n.id}
              notification={n}
              index={i}
              onDismiss={dismissNotification}
              onExited={dismissNotification}
            />
          ))}
        </Box>
      </AnimatePresence>
    </Box>
  )
}

export default ToastNotification
