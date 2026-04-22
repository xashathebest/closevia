import React, { useState, useEffect, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Box,
  Container,
  VStack,
  HStack,
  Input,
  InputGroup,
  InputLeftElement,
  Heading,
  Text,
  Badge,
  Alert,
  AlertIcon,
  Button,
  useToast,
  useColorModeValue,
  Flex,
  Image as ChakraImage,
  IconButton,
  Skeleton,
  SkeletonText,
  ScaleFade,
  Divider,
  Icon,
} from '@chakra-ui/react'
import { SearchIcon, CheckIcon, BellIcon, ChevronLeftIcon, ChevronRightIcon } from '@chakra-ui/icons'
import { FaHandshake, FaExchangeAlt, FaSyncAlt, FaLightbulb, FaFire, FaFlag, FaCog, FaBullhorn, FaBox, FaShoppingBag, FaCheckDouble, FaInbox } from 'react-icons/fa'
import { useAuth } from '../contexts/AuthContext'
import { useProducts } from '../contexts/ProductContext'
import { useRealtime } from '../contexts/RealtimeContext'
import { getFirstImage } from '../utils/imageUtils'
import { formatPHP } from '../utils/currency'
import { getProductUrl } from '../utils/productUtils'
import { isNotificationAllowed } from '../utils/notificationPreferences'
import { api } from '../services/api'
import FloatingTab from '../components/FloatingTab'

interface Notification {
  id: number
  user_id: number
  message: string
  type: string
  read: boolean
  created_at: string
  data?: {
    target_type?: string
    target_id?: number | string
    target_url?: string
    product_id?: number | string
    product_slug?: string
    product_title?: string
    product?: {
      id?: number | string
      slug?: string
      title?: string
    }
    trade_id?: number | string
    [key: string]: any
  }
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const ICON_MAP: Record<string, any> = {
  order: FaBox,
  product: FaShoppingBag,
  trade_offer: FaHandshake,
  trade_update: FaSyncAlt,
  trade_loop: FaExchangeAlt,
  similar_item: FaLightbulb,
  popular_item: FaFire,
  report: FaFlag,
  system: FaCog,
}

const COLOR_MAP: Record<string, string> = {
  order: 'blue',
  product: 'green',
  trade_offer: 'teal',
  trade_update: 'orange',
  trade_loop: 'purple',
  similar_item: 'cyan',
  popular_item: 'red',
  report: 'red',
  system: 'purple',
}

const ACCENT_MAP: Record<string, string> = {
  order: '#3182CE',
  product: '#38A169',
  trade_offer: '#319795',
  trade_update: '#DD6B20',
  trade_loop: '#805AD5',
  similar_item: '#00B5D8',
  popular_item: '#E53E3E',
  report: '#E53E3E',
  system: '#805AD5',
}

const TITLE_MAP: Record<string, string> = {
  trade_offer: 'Trade Offer',
  trade_update: 'Trade Update',
  trade_loop: 'Trade Loop Found',
  similar_item: 'Item Match',
  popular_item: 'Trending Item',
  report: 'Report',
  system: 'System',
  order: 'Order',
  product: 'Product',
}

function getRelativeTime(dateStr: string): string {
  const now = new Date()
  const date = new Date(dateStr)
  const diffMs = now.getTime() - date.getTime()
  const diffSec = Math.floor(diffMs / 1000)
  const diffMin = Math.floor(diffSec / 60)
  const diffHr = Math.floor(diffMin / 60)
  const diffDay = Math.floor(diffHr / 24)

  if (diffSec < 60) return 'Just now'
  if (diffMin < 60) return `${diffMin}m ago`
  if (diffHr < 24) return `${diffHr}h ago`
  if (diffDay === 1) return 'Yesterday'
  if (diffDay < 7) return `${diffDay}d ago`
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function getDateGroup(dateStr: string): string {
  const now = new Date()
  const date = new Date(dateStr)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const yesterday = new Date(today.getTime() - 86400000)
  const dateDay = new Date(date.getFullYear(), date.getMonth(), date.getDate())

  if (dateDay.getTime() === today.getTime()) return 'Today'
  if (dateDay.getTime() === yesterday.getTime()) return 'Yesterday'
  return 'Earlier'
}

function asPositiveNumber(value: unknown): number | undefined {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN
  return Number.isFinite(n) && n > 0 ? n : undefined
}

function getQuotedProductTitle(message: string): string | undefined {
  const match = message.match(/"([^"]+)"/)
  return match?.[1]?.trim() || undefined
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

const Notifications: React.FC = () => {
  const { user } = useAuth()
  const { products } = useProducts()
  const { refreshCounts } = useRealtime()
  const navigate = useNavigate()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [loading, setLoading] = useState(false)
  const [initialLoading, setInitialLoading] = useState(true)
  const [error, setError] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [query, setQuery] = useState('')
  const itemsPerPage = 8
  const toast = useToast()

  const bgColor = useColorModeValue('white', 'gray.800')
  const cardBg = useColorModeValue('white', 'gray.750')
  const borderColor = useColorModeValue('gray.100', 'gray.700')
  const pageBg = useColorModeValue('#FFFDF1', '#1A202C')
  const subtleBg = useColorModeValue('gray.50', 'gray.700')
  const unreadBg = useColorModeValue('blue.50', 'rgba(66, 153, 225, 0.08)')
  const groupLabelColor = useColorModeValue('gray.500', 'gray.400')
  const inputBg = useColorModeValue('white', 'gray.700')

  /* --- Data fetching --- */
  useEffect(() => {
    if (user) {
      const endpoint = user?.role === 'admin' ? '/api/notifications?type=report' : '/api/notifications'
      const cacheKey = `clovia_notifications_cache_${user?.role || 'user'}`

      try {
        const cached = localStorage.getItem(cacheKey)
        if (cached) {
          const parsed = JSON.parse(cached)
          if (Array.isArray(parsed)) setNotifications(parsed)
        }
      } catch {
        // ignore
      }

      fetchNotifications(endpoint, cacheKey)
    } else {
      setInitialLoading(false)
    }
  }, [user])

  const fetchNotifications = async (endpointArg?: string, cacheKeyArg?: string) => {
    const endpoint = endpointArg || (user?.role === 'admin' ? '/api/notifications?type=report' : '/api/notifications')
    const cacheKey = cacheKeyArg || `clovia_notifications_cache_${user?.role || 'user'}`

    try {
      if (notifications.length === 0) setLoading(true)
      setError('')
      const response = await api.get(endpoint)
      const list: Notification[] = Array.isArray(response.data?.data) ? response.data.data : []
      setNotifications(list)
      try { localStorage.setItem(cacheKey, JSON.stringify(list)) } catch {}
    } catch (error: any) {
      setError(error.message || 'Failed to fetch notifications')
      toast({ id: 'notifications-error', title: 'Error', description: 'Failed to load notifications', status: 'error', duration: 3000, isClosable: true })
    } finally {
      setLoading(false)
      setInitialLoading(false)
    }
  }

  const markAsRead = useCallback(async (notificationId: number) => {
    try {
      await api.put(`/api/notifications/${notificationId}/read`)
      setNotifications(prev => prev.map(n => n.id === notificationId ? { ...n, read: true } : n))
      refreshCounts()
    } catch {
      toast({ id: 'mark-read-error', title: 'Error', description: 'Failed to mark notification as read', status: 'error', duration: 3000, isClosable: true })
    }
  }, [refreshCounts, toast])

  const markAllAsRead = useCallback(async () => {
    try {
      await api.put('/api/notifications/read-all')
      setNotifications(prev => prev.map(n => ({ ...n, read: true })))
      refreshCounts()
      toast({ id: 'mark-all-success', title: 'All caught up!', description: 'All notifications marked as read', status: 'success', duration: 2000, isClosable: true })
    } catch {
      toast({ id: 'mark-all-error', title: 'Error', description: 'Failed to mark all as read', status: 'error', duration: 3000, isClosable: true })
    }
  }, [refreshCounts, toast])

  /* --- Filtering & Pagination --- */
  const filtered = useMemo(() => {
    return notifications.filter(n => {
      // Hide all multiway/loop "Trade Loop Found" notifications — users found
      // these noisy (loop-confirmed, participant-confirmed, mutual-like pending).
      if (n.type === 'trade_loop') return false
      if (!isNotificationAllowed((user as any)?.notification_preferences, n)) return false

      if (!query) return true
      const q = query.toLowerCase()
      if ((n.message || '').toLowerCase().includes(q)) return true
      if ((n.type || '').toLowerCase().includes(q)) return true

      try {
        const matchingProductIds = new Set<number>()
        for (const p of (products || [])) {
          if (p?.title?.toLowerCase().includes(q)) matchingProductIds.add(p.id)
        }
        const data = n.data as any
        if (data) {
          if (typeof data.product_id === 'number' && matchingProductIds.has(data.product_id)) return true
          if (data.product?.id && matchingProductIds.has(data.product.id)) return true
          if (data.product?.title?.toLowerCase().includes(q)) return true
        }
      } catch {}

      return false
    })
  }, [notifications, query, products, user])

  const unreadCount = useMemo(() => filtered.filter(n => !n.read).length, [filtered])
  const totalPages = Math.max(1, Math.ceil(filtered.length / itemsPerPage))
  const paginated = useMemo(() => filtered.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage), [filtered, currentPage])

  /* Group paginated results by date group */
  const grouped = useMemo(() => {
    const groups: { label: string; items: Notification[] }[] = []
    const map = new Map<string, Notification[]>()
    for (const n of paginated) {
      const g = getDateGroup(n.created_at)
      if (!map.has(g)) { map.set(g, []); groups.push({ label: g, items: map.get(g)! }) }
      map.get(g)!.push(n)
    }
    return groups
  }, [paginated])

  const matchingProducts = useMemo(() => {
    if (!query || !products?.length) return []
    return products.filter((p: any) => p?.title?.toLowerCase().includes(query.toLowerCase()))
  }, [query, products])

  /* --- Redirect logic --- */
  const getRedirectPath = useCallback((notification: Notification): string | null => {
    const data = notification.data || {}

    if (typeof data.target_url === 'string' && data.target_url.trim()) {
      return data.target_url
    }

    const productId = asPositiveNumber(data.product_id ?? data.target_id ?? data.product?.id)
    const productSlug = data.product_slug || data.product?.slug
    const pointsToProduct =
      data.target_type === 'product' ||
      notification.type === 'product' ||
      notification.type === 'similar_item' ||
      notification.type === 'popular_item'

    if (pointsToProduct) {
      if (productSlug) return `/products/${productSlug}`
      if (productId) return `/products/${productId}`

      const title = data.product_title || data.product?.title || getQuotedProductTitle(notification.message)
      if (title) {
        const match = products.find((p: any) => p?.title?.trim().toLowerCase() === title.toLowerCase())
        if (match) return getProductUrl(match)
      }

      return null
    }

    if (notification.type === 'trade_offer' || notification.type === 'trade_update') {
      return data.trade_id ? `/offers/buyout/${data.trade_id}` : '/offers/buyout'
    }
    if (notification.type === 'trade_loop') return '/dashboard?tab=2'
    return null
  }, [products])

  const handleNotificationClick = useCallback(async (notification: Notification) => {
    if (!notification.read) await markAsRead(notification.id)
    const path = getRedirectPath(notification)
    if (path) navigate(path)
  }, [getRedirectPath, markAsRead, navigate])

  /* ------------------------------------------------------------------ */
  /*  Loading Skeleton                                                    */
  /* ------------------------------------------------------------------ */
  if (loading && initialLoading && notifications.length === 0) {
    return (
      <Box minH="100vh" bg={pageBg} py={8}>
        <Container maxW="container.md">
          <VStack spacing={6} align="stretch">
            {/* Header skeleton */}
            <Box bg={bgColor} borderRadius="2xl" p={{ base: 4, md: 5 }} border="1px" borderColor={borderColor}>
              <HStack justify="space-between" align="start">
                <HStack spacing={3}>
                  <Skeleton h="42px" w="42px" borderRadius="xl" />
                  <VStack align="start" spacing={2}>
                    <Skeleton h="24px" w="150px" borderRadius="md" />
                    <Skeleton h="16px" w="100px" borderRadius="md" />
                  </VStack>
                </HStack>
                <Skeleton h="32px" w="200px" borderRadius="full" />
              </HStack>
            </Box>
            {/* Card skeletons */}
            {[1, 2, 3, 4].map(i => (
              <Box key={i} bg={bgColor} borderRadius="xl" p={5} border="1px" borderColor={borderColor}>
                <HStack spacing={4} align="start">
                  <Skeleton h="44px" w="44px" borderRadius="xl" flexShrink={0} />
                  <VStack align="start" spacing={2} flex={1}>
                    <Skeleton h="16px" w="60%" borderRadius="md" />
                    <SkeletonText noOfLines={2} spacing="2" w="100%" />
                    <Skeleton h="12px" w="80px" borderRadius="md" />
                  </VStack>
                </HStack>
              </Box>
            ))}
          </VStack>
        </Container>
        <FloatingTab />
      </Box>
    )
  }

  if (error) {
    return (
      <Box minH="100vh" bg={pageBg} py={8}>
        <Container maxW="container.md">
          <Alert status="error" borderRadius="xl">
            <AlertIcon />
            {error}
          </Alert>
        </Container>
      </Box>
    )
  }

  /* ------------------------------------------------------------------ */
  /*  Render                                                              */
  /* ------------------------------------------------------------------ */
  return (
    <Box minH="100vh" bg={pageBg} py={{ base: 4, md: 8 }}>
      <Container maxW="container.md" px={{ base: 4, md: 6 }}>
        <VStack spacing={6} align="stretch">

          {/* ===== Header ===== */}
          <Box
            bg={bgColor}
            borderRadius="2xl"
            px={{ base: 4, md: 6 }}
            py={{ base: 4, md: 5 }}
            border="1px"
            borderColor={borderColor}
            boxShadow="0 1px 3px rgba(0,0,0,0.04)"
          >
            <Flex
              align={{ base: 'start', md: 'center' }}
              justify="space-between"
              direction={{ base: 'column', md: 'row' }}
              gap={3}
            >
              <HStack spacing={3}>
                <Flex
                  align="center"
                  justify="center"
                  w="42px"
                  h="42px"
                  borderRadius="xl"
                  bg="brand.50"
                  color="brand.500"
                  flexShrink={0}
                >
                  <Icon as={BellIcon} boxSize={5} />
                </Flex>
                <VStack align="start" spacing={0}>
                  <Heading size="md" color="gray.800" _dark={{ color: 'gray.100' }}>
                    {user?.role === 'admin' ? 'User Reports' : 'Notifications'}
                  </Heading>
                  <Text fontSize="sm" color="gray.500">
                    {unreadCount > 0
                      ? `${unreadCount} unread notification${unreadCount > 1 ? 's' : ''}`
                      : "You're all caught up!"}
                  </Text>
                </VStack>
              </HStack>

              <HStack spacing={2} w={{ base: '100%', md: 'auto' }}>
                <InputGroup size="sm" maxW={{ base: '100%', md: '220px' }} flex={1}>
                  <InputLeftElement pointerEvents="none">
                    <SearchIcon color="gray.400" boxSize={3.5} />
                  </InputLeftElement>
                  <Input
                    placeholder="Search notifications..."
                    value={query}
                    onChange={(e) => { setQuery(e.target.value); setCurrentPage(1) }}
                    bg={inputBg}
                    borderRadius="full"
                    borderColor={borderColor}
                    _focus={{ borderColor: 'brand.400', boxShadow: '0 0 0 1px var(--chakra-colors-brand-400)' }}
                    fontSize="sm"
                  />
                </InputGroup>
                {unreadCount > 0 && (
                  <Button
                    size="sm"
                    variant="ghost"
                    colorScheme="brand"
                    borderRadius="full"
                    leftIcon={<Icon as={FaCheckDouble} boxSize={3} />}
                    onClick={markAllAsRead}
                    fontWeight="semibold"
                    fontSize="xs"
                    px={3}
                    flexShrink={0}
                    _hover={{ bg: 'brand.50', transform: 'scale(1.02)' }}
                    transition="all 0.15s"
                  >
                    Mark all as read
                  </Button>
                )}
              </HStack>
            </Flex>

            {/* Unread count pill */}
            {unreadCount > 0 && (
              <Flex mt={3} pt={3} borderTop="1px" borderColor={borderColor}>
                <HStack
                  spacing={2}
                  bg="red.50"
                  _dark={{ bg: 'rgba(254, 178, 178, 0.1)' }}
                  px={3}
                  py={1.5}
                  borderRadius="full"
                >
                  <Box w="8px" h="8px" borderRadius="full" bg="red.400" />
                  <Text fontSize="xs" fontWeight="semibold" color="red.600" _dark={{ color: 'red.300' }}>
                    {unreadCount} new
                  </Text>
                </HStack>
              </Flex>
            )}
          </Box>

          {/* ===== Notification List ===== */}
          {paginated.length === 0 ? (
            matchingProducts.length > 0 ? (
              /* Product match results when searching */
              <VStack spacing={3} align="stretch">
                <Text fontSize="sm" color="gray.500" px={1}>
                  No notifications found, but we found matching products:
                </Text>
                {matchingProducts.map((p: any) => (
                  <Box
                    key={p.id}
                    bg={bgColor}
                    borderRadius="xl"
                    border="1px"
                    borderColor={borderColor}
                    p={4}
                    cursor="pointer"
                    transition="all 0.2s"
                    _hover={{ shadow: 'md', transform: 'translateY(-1px)' }}
                    onClick={() => { window.location.href = getProductUrl(p) }}
                  >
                    <HStack spacing={4} align="center">
                      <Box boxSize="64px" borderRadius="lg" overflow="hidden" flexShrink={0} bg="gray.100">
                        <ChakraImage src={getFirstImage(p.image_urls)} alt={p.title} w="100%" h="100%" objectFit="cover" />
                      </Box>
                      <VStack align="start" spacing={1} flex={1} minW={0}>
                        <Text fontWeight="semibold" fontSize="sm" noOfLines={1}>{p.title}</Text>
                        <Text fontSize="xs" color="gray.500" noOfLines={1}>{p.description}</Text>
                        <HStack spacing={2}>
                          {p.allow_buying && p.price ? (
                            <Text fontWeight="bold" fontSize="sm" color="brand.500">{formatPHP(p.price)}</Text>
                          ) : (
                            <Badge colorScheme="green" fontSize="2xs">Barter</Badge>
                          )}
                        </HStack>
                      </VStack>
                    </HStack>
                  </Box>
                ))}
              </VStack>
            ) : (
              /* Empty state */
              <VStack spacing={4} py={16} align="center">
                <Flex
                  w="80px"
                  h="80px"
                  borderRadius="full"
                  bg={subtleBg}
                  align="center"
                  justify="center"
                >
                  <Icon as={FaInbox} boxSize={8} color="gray.300" />
                </Flex>
                <VStack spacing={1}>
                  <Text fontSize="lg" fontWeight="semibold" color="gray.600" _dark={{ color: 'gray.300' }}>
                    {query ? 'No results found' : user?.role === 'admin' ? 'No reports yet' : 'No notifications yet'}
                  </Text>
                  <Text fontSize="sm" color="gray.400" textAlign="center" maxW="300px">
                    {query
                      ? `Nothing matches "${query}". Try a different search.`
                      : user?.role === 'admin'
                        ? "You'll see user reports here when they come in."
                        : "We'll let you know about trades, offers, and important updates."}
                  </Text>
                </VStack>
              </VStack>
            )
          ) : (
            /* Grouped notification cards */
            <VStack spacing={4} align="stretch">
              {grouped.map((group) => (
                <VStack key={group.label} spacing={2} align="stretch">
                  {/* Group label */}
                  <HStack px={1} pt={1}>
                    <Text fontSize="xs" fontWeight="bold" textTransform="uppercase" letterSpacing="wider" color={groupLabelColor}>
                      {group.label}
                    </Text>
                    <Divider borderColor={borderColor} />
                  </HStack>

                  {group.items.map((notification, idx) => {
                    const redirectPath = getRedirectPath(notification)
                    const accent = ACCENT_MAP[notification.type] || '#A0AEC0'
                    const colorScheme = COLOR_MAP[notification.type] || 'gray'
                    const IconComp = ICON_MAP[notification.type] || FaBullhorn
                    const title = TITLE_MAP[notification.type] || notification.type.replace('_', ' ')

                    return (
                      <ScaleFade key={notification.id} in={true} initialScale={0.97}>
                        <Box
                          position="relative"
                          bg={notification.read ? cardBg : unreadBg}
                          borderRadius="xl"
                          border="1px"
                          borderColor={notification.read ? borderColor : `${colorScheme}.200`}
                          overflow="hidden"
                          transition="all 0.25s cubic-bezier(0.4, 0, 0.2, 1)"
                          _hover={{
                            shadow: 'md',
                            transform: 'translateY(-2px)',
                            borderColor: `${colorScheme}.300`,
                          }}
                          cursor={redirectPath ? 'pointer' : 'default'}
                          onClick={redirectPath ? () => handleNotificationClick(notification) : undefined}
                          role="article"
                          aria-label={`Notification: ${title}`}
                        >
                          {/* Accent bar */}
                          <Box
                            position="absolute"
                            left={0}
                            top={0}
                            bottom={0}
                            w="4px"
                            bg={notification.read ? 'transparent' : accent}
                            borderRadius="4px 0 0 4px"
                            transition="background 0.3s"
                          />

                          <Box px={5} py={4} pl={6}>
                            <Flex align="start" gap={3}>
                              {/* Icon */}
                              <Flex
                                align="center"
                                justify="center"
                                w="40px"
                                h="40px"
                                borderRadius="xl"
                                bg={`${colorScheme}.50`}
                                _dark={{ bg: `${colorScheme}.900` }}
                                flexShrink={0}
                                mt="2px"
                              >
                                <Icon as={IconComp} boxSize={4} color={`${colorScheme}.500`} />
                              </Flex>

                              {/* Content */}
                              <VStack align="start" spacing={1} flex={1} minW={0}>
                                <Flex align="center" justify="space-between" w="100%" gap={2}>
                                  <HStack spacing={2} minW={0}>
                                    <Text
                                      fontWeight={notification.read ? 'medium' : 'bold'}
                                      fontSize="sm"
                                      color="gray.800"
                                      _dark={{ color: 'gray.100' }}
                                      noOfLines={1}
                                    >
                                      {title}
                                    </Text>
                                    {!notification.read && (
                                      <Box w="7px" h="7px" borderRadius="full" bg="blue.400" flexShrink={0} />
                                    )}
                                  </HStack>
                                  <Text fontSize="xs" color="gray.400" flexShrink={0} whiteSpace="nowrap">
                                    {getRelativeTime(notification.created_at)}
                                  </Text>
                                </Flex>

                                <Text
                                  fontSize="sm"
                                  color={notification.read ? 'gray.500' : 'gray.700'}
                                  _dark={{ color: notification.read ? 'gray.400' : 'gray.300' }}
                                  noOfLines={2}
                                  lineHeight="tall"
                                >
                                  {notification.message}
                                </Text>

                                {/* Actions */}
                                <HStack spacing={2} mt={1}>
                                  {redirectPath && (
                                    <Button
                                      size="xs"
                                      variant={notification.read ? 'ghost' : 'solid'}
                                      colorScheme="brand"
                                      borderRadius="full"
                                      px={3}
                                      fontWeight="semibold"
                                      onClick={(e) => { e.stopPropagation(); handleNotificationClick(notification) }}
                                      _hover={{ transform: 'scale(1.02)' }}
                                      transition="all 0.15s"
                                    >
                                      {notification.read ? 'View' : 'View Details'}
                                    </Button>
                                  )}
                                  {!notification.read && !redirectPath && (
                                    <Button
                                      size="xs"
                                      variant="ghost"
                                      colorScheme="gray"
                                      borderRadius="full"
                                      px={3}
                                      leftIcon={<CheckIcon boxSize={2.5} />}
                                      onClick={(e) => { e.stopPropagation(); markAsRead(notification.id) }}
                                      fontSize="xs"
                                      _hover={{ bg: 'gray.100' }}
                                    >
                                      Mark as read
                                    </Button>
                                  )}
                                  {notification.read && !redirectPath && (
                                    <Text fontSize="2xs" color="gray.400" fontStyle="italic">
                                      Read
                                    </Text>
                                  )}
                                </HStack>
                              </VStack>
                            </Flex>
                          </Box>
                        </Box>
                      </ScaleFade>
                    )
                  })}
                </VStack>
              ))}
            </VStack>
          )}

          {/* ===== Pagination ===== */}
          {totalPages > 1 && (
            <Flex justify="center" align="center" gap={1} pt={2} pb={4}>
              <IconButton
                aria-label="Previous page"
                icon={<ChevronLeftIcon />}
                size="sm"
                variant="ghost"
                borderRadius="full"
                isDisabled={currentPage === 1}
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              />
              {Array.from({ length: totalPages }, (_, i) => i + 1)
                .filter(page => {
                  // Show first, last, and pages near current
                  if (page === 1 || page === totalPages) return true
                  return Math.abs(page - currentPage) <= 1
                })
                .reduce<(number | 'ellipsis')[]>((acc, page, idx, arr) => {
                  if (idx > 0 && page - (arr[idx - 1] as number) > 1) acc.push('ellipsis')
                  acc.push(page)
                  return acc
                }, [])
                .map((item, idx) =>
                  item === 'ellipsis' ? (
                    <Text key={`ellipsis-${idx}`} fontSize="sm" color="gray.400" px={1}>…</Text>
                  ) : (
                    <Button
                      key={item}
                      size="sm"
                      variant={item === currentPage ? 'solid' : 'ghost'}
                      colorScheme={item === currentPage ? 'brand' : 'gray'}
                      borderRadius="full"
                      minW="36px"
                      h="36px"
                      fontSize="sm"
                      fontWeight={item === currentPage ? 'bold' : 'medium'}
                      onClick={() => setCurrentPage(item as number)}
                    >
                      {item}
                    </Button>
                  )
                )}
              <IconButton
                aria-label="Next page"
                icon={<ChevronRightIcon />}
                size="sm"
                variant="ghost"
                borderRadius="full"
                isDisabled={currentPage === totalPages}
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              />
            </Flex>
          )}
        </VStack>
      </Container>

      <FloatingTab />
    </Box>
  )
}

export default Notifications
