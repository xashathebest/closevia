import React from 'react'
import {
  Box,
  HStack,
  VStack,
  Text,
  Badge,
  Button,
  Icon,
  useColorModeValue,
  ScaleFade,
  Heading,
  Divider,
  Card,
  CardBody,
} from '@chakra-ui/react'
import { FaLink, FaBell, FaTimes } from 'react-icons/fa'
import { useTradeLoopNotifications, TradeLoopNotification } from '../hooks/useTradeLoopNotifications'

interface TradeLoopNotificationsPanelProps {
  onViewTrades?: () => void
}

/**
 * Component to display trade loop notifications
 * Shows a card with badge count and list of recent notifications
 */
const TradeLoopNotificationsPanel: React.FC<TradeLoopNotificationsPanelProps> = ({
  onViewTrades,
}) => {
  const {
    notifications,
    markAsRead,
    clearNotifications,
    unreadCount,
  } = useTradeLoopNotifications()

  const cardBg = useColorModeValue('white', 'gray.800')
  const borderColor = useColorModeValue('gray.200', 'gray.700')
  const unreadBg = useColorModeValue('green.50', 'green.900')
  const unreadBorder = useColorModeValue('green.200', 'green.700')

  if (notifications.length === 0) {
    return null
  }

  return (
    <ScaleFade initialScale={0.9} in={notifications.length > 0}>
      <Card
        bg={cardBg}
        borderColor={borderColor}
        borderWidth="1px"
        mb={6}
        position="relative"
        overflow="hidden"
      >
        {/* Accent bar */}
        <Box
          position="absolute"
          top={0}
          left={0}
          right={0}
          height="3px"
          bg="linear-gradient(90deg, #48bb78, #38a169)"
        />

        <CardBody pt={6}>
          <HStack justify="space-between" align="start" mb={4}>
            <HStack spacing={3}>
              <Icon as={FaLink} fontSize="xl" color="green.500" />
              <VStack align="start" spacing={0}>
                <Heading size="sm">
                  Multi-Way Trade Opportunities
                </Heading>
                <Text fontSize="xs" color="gray.600">
                  {unreadCount} new {unreadCount === 1 ? 'notification' : 'notifications'}
                </Text>
              </VStack>
            </HStack>
            {unreadCount > 0 && (
              <Badge colorScheme="green" fontSize="sm">
                {unreadCount} NEW
              </Badge>
            )}
          </HStack>

          <Divider mb={3} />

          {/* Notifications list */}
          <VStack spacing={2} align="stretch" maxH="300px" overflowY="auto">
            {notifications.map((notif) => (
              <ScaleFade key={notif.id} in={true}>
                <Box
                  bg={!notif.read ? unreadBg : 'transparent'}
                  borderColor={!notif.read ? unreadBorder : 'transparent'}
                  borderWidth={!notif.read ? '1px' : '0px'}
                  borderRadius="md"
                  p={3}
                  transition="all 0.2s"
                  _hover={{ shadow: 'sm' }}
                >
                  <HStack justify="space-between" align="start" spacing={2}>
                    <VStack align="start" spacing={1} flex={1}>
                      <HStack spacing={2}>
                        <Icon as={FaBell} fontSize="sm" color="green.500" />
                        <Text
                          fontSize="sm"
                          fontWeight={!notif.read ? 'semibold' : 'normal'}
                        >
                          {notif.message}
                        </Text>
                      </HStack>
                      <HStack spacing={2} ml={6} fontSize="xs" color="gray.600">
                        <Badge fontSize="xs" colorScheme="purple">
                          {notif.participant_count} participants
                        </Badge>
                        <Text>
                          {new Date(notif.created_at).toLocaleString()}
                        </Text>
                      </HStack>
                    </VStack>
                    {!notif.read && (
                      <Button
                        size="xs"
                        variant="ghost"
                        onClick={() => markAsRead(notif.id)}
                        _hover={{ bg: 'transparent', opacity: 0.7 }}
                      >
                        <Icon as={FaTimes} />
                      </Button>
                    )}
                  </HStack>
                </Box>
              </ScaleFade>
            ))}
          </VStack>

          {/* Action buttons */}
          <HStack mt={4} spacing={2} justify="space-between">
            <Button
              size="sm"
              variant="ghost"
              onClick={clearNotifications}
              fontSize="xs"
            >
              Clear All
            </Button>
            <Button
              size="sm"
              colorScheme="green"
              onClick={onViewTrades}
              leftIcon={<FaLink />}
              fontSize="xs"
            >
              View Trade Chains
            </Button>
          </HStack>
        </CardBody>
      </Card>
    </ScaleFade>
  )
}

export default TradeLoopNotificationsPanel
