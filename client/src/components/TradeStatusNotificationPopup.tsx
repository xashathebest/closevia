import React, { useEffect, useState } from 'react'
import {
  Box,
  VStack,
  HStack,
  Text,
  Button,
  Icon,
  useColorModeValue,
  Fade,
  ScaleFade,
  CloseButton,
} from '@chakra-ui/react'
import { FaCheckCircle, FaTimesCircle, FaHandshake } from 'react-icons/fa'
import { TradeStatusNotification } from '../contexts/RealtimeContext'

interface TradeStatusNotificationPopupProps {
  notification: TradeStatusNotification
  onClose: () => void
  onViewTrade?: (tradeId: number) => void
}

const TradeStatusNotificationPopup: React.FC<TradeStatusNotificationPopupProps> = ({
  notification,
  onClose,
  onViewTrade,
}) => {
  const [isVisible, setIsVisible] = useState(true)
  const bgColor = useColorModeValue('white', 'gray.800')
  const borderColor = useColorModeValue('gray.200', 'gray.700')

  // Auto-close after 8 seconds
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsVisible(false)
      setTimeout(onClose, 300) // Wait for fade out animation
    }, 8000)
    return () => clearTimeout(timer)
  }, [onClose])

  const getStatusConfig = () => {
    switch (notification.status) {
      case 'accepted':
        return {
          icon: FaCheckCircle,
          color: 'green',
          title: 'Trade Accepted! 🎉',
          bgGradient: 'linear(to-r, green.50, emerald.50)',
          borderColor: 'green.300',
        }
      case 'declined':
        return {
          icon: FaTimesCircle,
          color: 'orange',
          title: 'Trade Declined',
          bgGradient: 'linear(to-r, orange.50, red.50)',
          borderColor: 'orange.300',
        }
      case 'completed':
        return {
          icon: FaHandshake,
          color: 'blue',
          title: 'Trade Completed! ✓',
          bgGradient: 'linear(to-r, blue.50, cyan.50)',
          borderColor: 'blue.300',
        }
      default:
        return {
          icon: FaCheckCircle,
          color: 'gray',
          title: 'Trade Update',
          bgGradient: 'linear(to-r, gray.50, gray.100)',
          borderColor: 'gray.300',
        }
    }
  }

  const config = getStatusConfig()

  return (
    <Fade in={isVisible}>
      <ScaleFade in={isVisible} initialScale={0.95}>
        <Box
          position="fixed"
          top={4}
          right={4}
          zIndex={9999}
          maxW="400px"
          w={{ base: 'calc(100% - 32px)', md: '400px' }}
          bgGradient={config.bgGradient}
          borderWidth="2px"
          borderColor={config.borderColor}
          borderRadius="lg"
          boxShadow="0 10px 40px rgba(0,0,0,0.16)"
          overflow="hidden"
          animation="slideIn 0.4s ease-out"
          css={{
            '@keyframes slideIn': {
              from: {
                transform: 'translateX(400px)',
                opacity: 0,
              },
              to: {
                transform: 'translateX(0)',
                opacity: 1,
              },
            },
          }}
        >
          <VStack spacing={0} align="stretch" h="100%">
            {/* Header with icon and title */}
            <HStack
              spacing={3}
              px={4}
              py={3}
              bg={`${config.color}.100`}
              borderBottomWidth="1px"
              borderColor={config.borderColor}
              justify="space-between"
            >
              <HStack spacing={2} flex={1}>
                <Icon
                  as={config.icon}
                  boxSize={5}
                  color={`${config.color}.600`}
                  flexShrink={0}
                />
                <Text
                  fontSize="lg"
                  fontWeight="bold"
                  color={`${config.color}.700`}
                  noOfLines={1}
                >
                  {config.title}
                </Text>
              </HStack>
              <CloseButton
                size="sm"
                onClick={() => {
                  setIsVisible(false)
                  setTimeout(onClose, 300)
                }}
                ml={2}
              />
            </HStack>

            {/* Content */}
            <VStack spacing={3} px={4} py={3} align="stretch" flex={1}>
              <Box>
                <Text fontSize="sm" color="gray.600" fontWeight="medium" mb={1}>
                  Trade Item
                </Text>
                <Text fontSize="md" fontWeight="semibold" color="gray.800">
                  {notification.productTitle}
                </Text>
              </Box>

              <Box>
                <Text fontSize="sm" color="gray.600" fontWeight="medium" mb={1}>
                  Trading Partner
                </Text>
                <Text fontSize="md" fontWeight="semibold" color="gray.800">
                  {notification.partnerName}
                </Text>
              </Box>

              <Box>
                <Text fontSize="sm" color="gray.600" fontWeight="medium" mb={1}>
                  Update
                </Text>
                <Text
                  fontSize="sm"
                  color={`${config.color}.700`}
                  fontWeight="medium"
                  bg={`${config.color}.50`}
                  px={3}
                  py={2}
                  borderRadius="md"
                  borderLeftWidth="3px"
                  borderLeftColor={`${config.color}.400`}
                >
                  {notification.message}
                </Text>
              </Box>

              {/* Action Button */}
              {onViewTrade && (
                <Button
                  size="sm"
                  colorScheme={config.color}
                  variant="solid"
                  w="full"
                  mt={2}
                  onClick={() => {
                    onViewTrade(notification.tradeId)
                    setIsVisible(false)
                    setTimeout(onClose, 300)
                  }}
                  _hover={{ transform: 'scale(1.02)' }}
                  transition="all 0.2s"
                >
                  View Trade Details
                </Button>
              )}
            </VStack>

            {/* Progress bar indicating auto-close time */}
            <Box
              h="2px"
              bg={`${config.color}.300`}
              animation="shrink 8s linear infinite"
              css={{
                '@keyframes shrink': {
                  from: { width: '100%' },
                  to: { width: '0%' },
                },
              }}
            />
          </VStack>
        </Box>
      </ScaleFade>
    </Fade>
  )
}

export default TradeStatusNotificationPopup
