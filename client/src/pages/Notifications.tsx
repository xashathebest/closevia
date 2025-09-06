import React, { useState, useEffect } from 'react'
import {
  Box,
  Container,
  VStack,
  HStack,
  Heading,
  Text,
  Badge,
  Spinner,
  Center,
  Alert,
  AlertIcon,
  Card,
  CardBody,
  CardHeader,
  Button,
  useToast,
  useColorModeValue,
  Flex,
} from '@chakra-ui/react'
import { useAuth } from '../contexts/AuthContext'
import { api } from '../services/api'

interface Notification {
  id: number
  user_id: number
  message: string
  type: string
  read: boolean
  created_at: string
  data?: any
}

const Notifications: React.FC = () => {
  const { user } = useAuth()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const toast = useToast()
  
  const bgColor = useColorModeValue('white', 'gray.800')
  const borderColor = useColorModeValue('gray.200', 'gray.700')
  // page background color (applies to entire viewport behind the container)
  const pageBg = '#FFFDF1'

  useEffect(() => {
    if (user) {
      fetchNotifications()
    }
  }, [user])

  const fetchNotifications = async () => {
    try {
      setLoading(true)
      setError('')
      const response = await api.get('/api/notifications')
      const list: Notification[] = Array.isArray(response.data?.data) ? response.data.data : []
      setNotifications(list)
    } catch (error: any) {
      setError(error.message || 'Failed to fetch notifications')
      toast({
        title: 'Error',
        description: 'Failed to load notifications',
        status: 'error',
        duration: 3000,
        isClosable: true,
      })
    } finally {
      setLoading(false)
    }
  }

  const markAsRead = async (notificationId: number) => {
    try {
      await api.put(`/api/notifications/${notificationId}/read`)
      setNotifications(prev => 
        prev.map(notif => 
          notif.id === notificationId ? { ...notif, read: true } : notif
        )
      )
    } catch (error: any) {
      toast({
        title: 'Error',
        description: 'Failed to mark notification as read',
        status: 'error',
        duration: 3000,
        isClosable: true,
      })
    }
  }

  const markAllAsRead = async () => {
    try {
      await api.put('/api/notifications/read-all')
      setNotifications(prev => 
        prev.map(notif => ({ ...notif, read: true }))
      )
      toast({
        title: 'Success',
        description: 'All notifications marked as read',
        status: 'success',
        duration: 3000,
        isClosable: true,
      })
    } catch (error: any) {
      toast({
        title: 'Error',
        description: 'Failed to mark all notifications as read',
        status: 'error',
        duration: 3000,
        isClosable: true,
      })
    }
  }

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case 'order':
        return '📦'
      case 'product':
        return '🛍️'
      case 'trade_offer':
        return '🔄'
      case 'trade_update':
        return '🔁'
      case 'system':
        return '🔔'
      default:
        return '📢'
    }
  }

  const getNotificationColor = (type: string) => {
    switch (type) {
      case 'order':
        return 'blue'
      case 'product':
        return 'green'
      case 'trade_offer':
        return 'purple'
      case 'trade_update':
        return 'orange'
      case 'system':
        return 'purple'
      default:
        return 'gray'
    }
  }

  if (loading) {
    return (
      <Center h="50vh">
        <Spinner size="xl" color="brand.500" />
      </Center>
    )
  }

  if (error) {
    return (
      <Container maxW="container.md" py={8}>
        <Alert status="error">
          <AlertIcon />
          {error}
        </Alert>
      </Container>
    )
  }

  const unreadCount = notifications.filter(n => !n.read).length

  return (
    // outer Box sets the viewport background color requested
    <Box minH="100vh" bg={pageBg} py={8}>
      <Container maxW="container.md" py={0}>
        <VStack spacing={6} align="stretch">
          {/* Header + Actions in one row: title + compact subtext on left, actions on right */}
          <Flex align="center" justify="space-between" flexWrap="wrap">
            <HStack spacing={3} align="center" minW={0}>
              <Heading size="md" color="brand.500" whiteSpace="nowrap" overflow="hidden" textOverflow="ellipsis">
                Notifications
              </Heading>
              <Text color="gray.600" fontSize="sm" whiteSpace="nowrap" overflow="hidden" textOverflow="ellipsis">
                {unreadCount > 0 ? `${unreadCount} unread${unreadCount > 1 ? 's' : ''}` : 'All caught up!'}
              </Text>
            </HStack>

            {unreadCount > 0 && (
              <Box mt={{ base: 3, md: 0 }}>
                <Button
                  size="sm"
                  variant="outline"
                  colorScheme="brand"
                  onClick={markAllAsRead}
                >
                  Mark All as Read
                </Button>
              </Box>
            )}
          </Flex>

          {/* Notifications List */}
          {notifications.length === 0 ? (
            <Box textAlign="center" py={12}>
              <Text fontSize="lg" color="gray.500" mb={4}>
                No notifications yet
              </Text>
              <Text color="gray.400">
                We'll notify you about orders, messages, and important updates here.
              </Text>
            </Box>
          ) : (
            <VStack spacing={4} align="stretch">
              {notifications.map((notification) => (
                <Card
                  key={notification.id}
                  bg={bgColor}
                  border="1px"
                  borderColor={borderColor}
                  shadow="sm"
                  opacity={notification.read ? 0.7 : 1}
                  transition="all 0.2s"
                  _hover={{ shadow: 'md' }}
                >
                  <CardHeader pb={2}>
                    <HStack justify="space-between" align="start">
                      <HStack spacing={3} align="start">
                        <Text fontSize="2xl">
                          {getNotificationIcon(notification.type)}
                        </Text>
                        <VStack align="start" spacing={1}>
                          <HStack spacing={2}>
                            <Text fontWeight="semibold" fontSize="md">
                              {notification.type.replace('_', ' ').toUpperCase()}
                            </Text>
                            {!notification.read && (
                              <Badge colorScheme="red" size="sm">
                                New
                              </Badge>
                            )}
                          </HStack>
                          <Badge colorScheme={getNotificationColor(notification.type)} size="sm">
                            {notification.type}
                          </Badge>
                        </VStack>
                      </HStack>
                      <Text fontSize="sm" color="gray.500">
                        {new Date(notification.created_at).toLocaleDateString()}
                      </Text>
                    </HStack>
                  </CardHeader>
                  
                  <CardBody pt={0}>
                    <Text color="gray.700" mb={4}>{notification.message}</Text>
                    
                    {!notification.read && (
                      <Button
                        size="sm"
                        variant="ghost"
                        colorScheme="brand"
                        onClick={() => markAsRead(notification.id)}
                      >
                        Mark as Read
                      </Button>
                    )}
                  </CardBody>
                </Card>
              ))}
            </VStack>
          )}
        </VStack>
      </Container>
    </Box>
  )
}

export default Notifications
