import React, { useCallback, useState, useEffect } from 'react'
import {
  Box,
  Heading,
  Text,
  Button,
  Image,
  Badge,
  HStack,
  VStack,
  Flex,
  Tooltip,
  Icon,
  useColorModeValue,
  useToast,
  useBreakpointValue,
} from '@chakra-ui/react'
import { EditIcon, StarIcon, ViewIcon } from '@chakra-ui/icons'
import { FaMoneyBillWave, FaHandshake, FaExchangeAlt, FaCheckCircle, FaHeart, FaRegHeart } from 'react-icons/fa'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import { getFirstImage, getImageUrl } from '../utils/imageUtils'
import { getProductUrl } from '../utils/productUtils'
import { IconButton } from '@chakra-ui/react'
import VerifiedAvatar from './VerifiedAvatar'
import ProximityBadge from './ProximityBadge'
import OptimizedImage from './OptimizedImage'
import { getBoostStatus } from '../utils/boostUtils'
import { useAuth } from '../contexts/AuthContext'
import { api } from '../services/api'
import AvailabilitySlots from './AvailabilitySlots'
import { AvailabilitySlot } from '../types'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import { cardReveal, motionDurations, motionEasings, productImageTransitionName, runViewTransition, uiTap } from '../utils/motion'

const MotionBox = motion(Box)

interface ProductCardProps {
  product: any
  onTradeClick: (productId: number) => void
  onBuyoutClick: (productId: number) => void
  onBuyClick: (productId: number) => void
  onViewOffers: (productId: number) => void
  showPriceOverlay?: boolean
  onBoostClick?: (productId: number) => void
  isStagnant?: boolean
  imageLoading?: 'lazy' | 'eager'
  showAvailability?: boolean
}

const ProductCard: React.FC<ProductCardProps> = ({
  product,
  onTradeClick,
  onBuyoutClick,
  onBuyClick,
  onViewOffers,
  showPriceOverlay = false,
  onBoostClick,
  isStagnant = false,
  imageLoading = 'lazy',
  showAvailability = false,
}) => {
  const navigate = useNavigate()
  const toast = useToast()
  const { user } = useAuth()
  const isMobile = useBreakpointValue({ base: true, md: false })
  const [boostTimeRemaining, setBoostTimeRemaining] = useState<string | null>(null)
  const [isBoosted, setIsBoosted] = useState(false)
  const [isSaved, setIsSaved] = useState(Boolean(product.is_saved))
  const [isSaving, setIsSaving] = useState(false)
  const prefersReducedMotion = useReducedMotion()
  const isOwnProduct = Boolean(user?.id && product.seller_id && Number(user.id) === Number(product.seller_id))

  // Calculate boost remaining time
  useEffect(() => {
    if (!product.boosted_at) {
      setIsBoosted(false)
      setBoostTimeRemaining(null)
      return
    }

    const calculateRemaining = () => {
      const { isBoosted: boostActive, remainingMs } = getBoostStatus(product)

      if (!boostActive || remainingMs <= 0) {
        setIsBoosted(false)
        setBoostTimeRemaining(null)
      } else {
        setIsBoosted(true)
        const hours = Math.floor(remainingMs / (60 * 60 * 1000))
        const minutes = Math.floor((remainingMs % (60 * 60 * 1000)) / (60 * 1000))
        
        if (hours > 0) {
          setBoostTimeRemaining(`${hours}h ${minutes}m`)
        } else {
          setBoostTimeRemaining(`${minutes}m`)
        }
      }
    }

    calculateRemaining()
    const interval = setInterval(calculateRemaining, 60000) // Update every minute

    return () => clearInterval(interval)
  }, [product.boosted_at, product.seller_premium_tier])

  useEffect(() => {
    setIsSaved(Boolean(product.is_saved))

    if (!product.id) return
    if (!user) {
      const savedProducts = JSON.parse(localStorage.getItem('savedProducts') || '[]')
      setIsSaved(savedProducts.includes(product.id))
    }
  }, [product.id, product.is_saved, user])



  const sellerAvatar = product.seller_profile_picture
    ? getImageUrl(product.seller_profile_picture)
    : undefined

  // Memoize click handlers
  const handleCardClick = useCallback(async () => {
    // Navigate to product details page
    runViewTransition(() => navigate(getProductUrl(product)))
  }, [product, navigate])

  const handleTradeClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onTradeClick(product.id)
    },
    [product.id, onTradeClick]
  )

  const handleBuyoutClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onBuyoutClick(product.id)
    },
    [product.id, onBuyoutClick]
  )

  const handleBuyClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onBuyClick(product.id)
    },
    [product.id, onBuyClick]
  )

  const handleViewOffers = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      onViewOffers(product.id)
    },
    [product.id, onViewOffers]
  )

  const handleEditClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      navigate(`/edit-product/${product.id}`)
    },
    [navigate, product.id]
  )

  const handleViewListingClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      navigate(getProductUrl(product))
    },
    [navigate, product]
  )

  const handleSaveToggle = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation()
      if (!product.id || isSaving) return

      if (user?.id === product.seller_id) {
        toast({
          id: `productcard-own-save-${product.id}`,
          title: "That's your own listing!",
          description: "You can't save your own items, but others can.",
          status: 'info',
          duration: 2000,
        })
        return
      }

      if (!user) {
        const savedProducts = JSON.parse(localStorage.getItem('savedProducts') || '[]')
        const nextSaved = !isSaved
        const updated = nextSaved
          ? Array.from(new Set([...savedProducts, product.id]))
          : savedProducts.filter((id: number) => id !== product.id)
        localStorage.setItem('savedProducts', JSON.stringify(updated))
        setIsSaved(nextSaved)
        toast({
          id: `productcard-save-local-${product.id}`,
          title: nextSaved ? 'Saved' : 'Removed from saved',
          status: nextSaved ? 'success' : 'info',
          duration: 1800,
        })
        return
      }

      const nextSaved = !isSaved
      setIsSaved(nextSaved)
      try {
        setIsSaving(true)
        if (!nextSaved) {
          await api.delete(`/api/users/saved-products/${product.id}`)
        } else {
          await api.post('/api/users/saved-products', { product_id: product.id })
        }
        toast({
          id: `productcard-save-${product.id}`,
          title: nextSaved ? 'Saved' : 'Removed from saved',
          status: nextSaved ? 'success' : 'info',
          duration: 1800,
        })
      } catch (error: any) {
        setIsSaved(!nextSaved)
        toast({
          id: `productcard-save-error-${product.id}`,
          title: "Couldn't update your saved items",
          description: error?.response?.data?.error || 'Something went wrong. Please try again.',
          status: 'error',
          duration: 3000,
          isClosable: true,
        })
      } finally {
        setIsSaving(false)
      }
    },
    [isSaved, isSaving, product.id, product.seller_id, toast, user]
  )

  const formatPriceCompact = (value: unknown): string => {
    const num = Number(value)
    if (!Number.isFinite(num)) return ''
    return num.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })
  }

  const formatPriceUltraCompact = (value: unknown): string => {
    const num = Number(value)
    if (!Number.isFinite(num)) return ''
    if (num >= 1000000) return (num / 1000000).toFixed(0) + 'M'
    if (num >= 1000) return (num / 1000).toFixed(0) + 'k'
    return num.toString()
  }
  const canShowEstimate = product.show_estimated_value !== false && product.estimated_value_min && product.estimated_value_max

  return (
    <MotionBox
      key={product.id}
      bg="white"
      borderRadius="2xl"
      shadow="sm"
      borderWidth="1px"
      borderColor={useColorModeValue('gray.200', 'gray.700')}
      overflow="hidden"
      transition="box-shadow 180ms ease-out, transform 180ms ease-out, border-color 180ms ease-out"
      w="full"
      h="full"
      display="flex"
      flexDirection="column"
      initial={prefersReducedMotion ? false : 'hidden'}
      whileInView={prefersReducedMotion ? undefined : 'visible'}
      viewport={{ once: true, margin: '0px 0px -40px 0px' }}
      variants={cardReveal}
      whileTap={prefersReducedMotion ? undefined : uiTap}
      _hover={{ boxShadow: 'lg', transform: prefersReducedMotion ? undefined : 'translateY(-3px)', borderColor: 'brand.200', cursor: 'pointer' }}
      onClick={handleCardClick}
      style={{ willChange: 'transform, opacity' }}
    >
      {/* Image section */}
      <Box position="relative" w="full" pt="100%" overflow="hidden" bg="gray.100">
        <OptimizedImage
          src={getFirstImage(product.image_urls)}
          alt={product.title}
          displayWidth="100%"
          displayHeight="100%"
          objectFit="cover"
          loading={imageLoading}
          fallbackSrc="/no-image.svg"
          position="absolute"
          top={0}
          left={0}
          style={{ viewTransitionName: productImageTransitionName(product.id) }}
        />

        {/* Top-right image badges */}
        <Box
          position="absolute"
          top={{ base: 2, md: 3 }}
          right={{ base: 2, md: 3 }}
          zIndex={1}
          maxW={{ base: '58%', md: '62%' }}
          display="flex"
          flexDirection="column"
          gap={1.5}
          alignItems="flex-end"
        >
            {isStagnant && onBoostClick && (
              <Tooltip label="Boost this listing" placement="left" hasArrow>
                <Button
                  size="xs"
                  colorScheme="blue"
                  variant="solid"
                  fontSize={{ base: '10px', md: '11px' }}
                  px={{ base: 1, md: 1.5 }}
                  py={{ base: 0.5, md: 1 }}
                  onClick={(e) => {
                    e.stopPropagation()
                    onBoostClick(product.id)
                  }}
                  fontWeight="bold"
                  boxShadow="md"
                  _hover={{ transform: 'scale(1.05)', boxShadow: 'lg' }}
                  transition="all 0.2s"
                >
                  Boost
                </Button>
              </Tooltip>
            )}
            {/* Premium/pinned badge moved to left stack */}



            {showPriceOverlay && (
              <Box
                px={{ base: 1.5, md: 3 }}
                py={{ base: 0.5, md: 1.5 }}
                bg={useColorModeValue('whiteAlpha.900', 'blackAlpha.800')}
                color={useColorModeValue('gray.800', 'white')}
                borderRadius="full"
                textAlign="right"
                display="inline-flex"
                flexDirection="column"
                alignItems="flex-end"
                w="auto"
                boxShadow="sm"
                backdropFilter="blur(8px)"
                maxW="100%"
              >
                <Text fontSize={{ base: '9px', md: 'xs' }} fontWeight="800" lineHeight="1.2">
                  {product.price && product.price > 0
                    ? `₱${formatPriceCompact(product.price)}`
                    : canShowEstimate
                      ? `₱${formatPriceCompact(product.estimated_value_min)} – ₱${formatPriceCompact(product.estimated_value_max)}`
                      : 'Price Unavailable'}
                </Text>
                {product.price && product.price > 0 && canShowEstimate && (
                  <Text display={{ base: 'none', sm: 'block' }} fontSize="2xs" color={useColorModeValue('brand.600', 'brand.300')} lineHeight="1.25" mt={0.5} fontWeight="700" whiteSpace="nowrap">
                    📊 Market Est. {product.estimated_value_min === product.estimated_value_max
                      ? `₱${formatPriceUltraCompact(product.estimated_value_min)}`
                      : `₱${formatPriceUltraCompact(product.estimated_value_min)} – ₱${formatPriceUltraCompact(product.estimated_value_max)}`}
                  </Text>
                )}
                {product.price && product.price > 0 && canShowEstimate && (
                  <Text display={{ base: 'block', sm: 'none' }} fontSize="2xs" color={useColorModeValue('brand.600', 'brand.300')} lineHeight="1.2" mt={0.5} fontWeight="700" whiteSpace="nowrap">
                    📊 Est. {product.estimated_value_min === product.estimated_value_max
                      ? `₱${formatPriceUltraCompact(product.estimated_value_min)}`
                      : `₱${formatPriceUltraCompact(product.estimated_value_min)}-₱${formatPriceUltraCompact(product.estimated_value_max)}`}
                  </Text>
                )}
                {(!product.price || product.price <= 0) && canShowEstimate && (
                  <Text fontSize="2xs" color={useColorModeValue('green.600', 'green.300')} mt={0.5} fontWeight="700">
                    📊 Market Est. range
                  </Text>
                )}
              </Box>
            )}
        </Box>

        {(product.tradeMatchScore != null && product.tradeMatchScore > 0) || isBoosted ? (
          <Box
            position="absolute"
            top={{ base: 2, md: 3 }}
            left={{ base: 2, md: 3 }}
            zIndex={2}
            display="flex"
            flexDirection="column"
            gap={1.5}
            alignItems="flex-start"
          >
            {product.tradeMatchScore != null && product.tradeMatchScore > 0 && (
              <Tooltip
                hasArrow
                placement="top-start"
                label={
                  product.tradeMatchBreakdown
                    ? `${product.tradeMatchBreakdown.isSuperCheap ? 'Warning: super cheap vs AI estimate | ' : ''}Value ${product.tradeMatchBreakdown.value} | Category ${product.tradeMatchBreakdown.category} | Demand ${product.tradeMatchBreakdown.demand} | Distance ${product.tradeMatchBreakdown.distance}${product.tradeMatchBreakdown.valueNote ? ` | ${product.tradeMatchBreakdown.valueNote}` : ''}`
                    : 'Trade ready score'
                }
              >
                <Badge
                  variant="solid"
                  borderRadius="full"
                  px={{ base: 1.5, md: 2.5 }}
                  py={{ base: 0.5, md: 1 }}
                  fontSize={{ base: '8px', md: '10px' }}
                  fontWeight="800"
                  bg="brand.500"
                  color="white"
                  shadow="sm"
                  letterSpacing="0.5px"
                >
                  <Text display={{ base: 'flex', md: 'none' }} alignItems="center">
                    {product.tradeMatchScore}% <Icon as={FaCheckCircle} ml={1} boxSize="9px" />
                  </Text>
                  <Text display={{ base: 'none', md: 'block' }}>{product.tradeMatchScore}% Ready</Text>
                </Badge>
              </Tooltip>
            )}
            {isBoosted && (
              <Tooltip label={boostTimeRemaining ? `Boosted for ${boostTimeRemaining} more` : 'Boosted'} placement="top-start" hasArrow>
                <Badge
                  variant="solid"
                  borderRadius="full"
                  px={{ base: 1, md: 1.5 }}
                  py={{ base: 0.5, md: 0.5 }}
                  fontSize={{ base: '7px', md: '9px' }}
                  fontWeight="800"
                  bg={useColorModeValue('whiteAlpha.900', 'blackAlpha.800')}
                  color={useColorModeValue('brand.600', 'brand.300')}
                  shadow="sm"
                  backdropFilter="blur(8px)"
                  display="inline-flex"
                  alignItems="center"
                  gap={0.5}
                >
                  <StarIcon boxSize={{ base: 1.5, md: 2 }} />
                  Boosted {boostTimeRemaining ? `• ${boostTimeRemaining}` : ''}
                </Badge>
              </Tooltip>
            )}
          </Box>
        ) : null}

        {/* Status badge (e.g. sold) */}
        {product.status === 'sold' && (
          <Badge
            position="absolute"
            bottom={2}
            right={2}
            colorScheme="red"
            variant="solid"
            borderRadius="full"
            px={2}
          >
            Sold
          </Badge>
        )}

        {/* Location badge - Using accurate ProximityBadge */}
        <Box position="absolute" bottom={{ base: 2, md: 3 }} left={{ base: 2, md: 3 }} zIndex={2}>
          <ProximityBadge
            type="product"
            targetId={product.id}
            showIcon={true}
            prefetchedDistanceKm={product.distanceKm}
            prefetchedDistanceLabel={product.distance}
          />
        </Box>

        {/* Mobile-only condition badge overlay — bottom right of image, avoids sold badge */}
        {product.condition && product.status !== 'sold' && (
          <Badge
            display={{ base: 'flex', md: 'none' }}
            position="absolute"
            bottom={2}
            right={2}
            colorScheme={
              (() => {
                const c = (product.condition || '').toLowerCase().trim()
                if (c === 'new') return 'green'
                if (c === 'like new') return 'teal'
                if (c === 'good') return 'blue'
                if (c === 'fair') return 'orange'
                return 'gray'
              })()
            }
            variant="solid"
            borderRadius="md"
            fontSize="9px"
            fontWeight="700"
            px={1.5}
            py={0.5}
            zIndex={2}
            opacity={0.9}
            maxW="calc(100% - 16px)"
            noOfLines={1}
            overflow="hidden"
            textOverflow="ellipsis"
            whiteSpace="nowrap"
          >
            {product.condition}
          </Badge>
        )}
      </Box>

      {/* Info section */}
      <Box
        px={{ base: 2.5, md: 4 }}
        pt={{ base: 1.5, md: 3 }}
        pb={{ base: 2, md: 4 }}
        display="flex"
        flexDirection="column"
        flex={1}
        overflow="hidden"
      >
        {/* Seller row — desktop only */}
        <Flex display={{ base: 'none', md: 'flex' }} justify="space-between" align="center" gap={2} mb={1}>
          <HStack spacing={1} align="center" minW={0} flex={1}>
            {((product as any).seller_slug || product.seller_id) ? (
              <RouterLink to={`/users/${(product as any).seller_slug || product.seller_id}`} onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                <VerifiedAvatar
                  size="sm"
                  src={sellerAvatar}
                  name={product.seller_name || 'U'}
                  bg="brand.500"
                  flexShrink={0}
                  cursor="pointer"
                  _hover={{ opacity: 0.8 }}
                  isVerified={product.seller_verified || false}
                />
              </RouterLink>
            ) : (
              <VerifiedAvatar
                size="sm"
                src={sellerAvatar}
                name={product.seller_name || 'U'}
                bg="brand.500"
                flexShrink={0}
                isVerified={product.seller_verified || false}
              />
            )}
            <Text fontSize="xs" color="black" fontWeight="medium" noOfLines={1}>
              {product.seller_name || 'Unknown'}
            </Text>
          </HStack>
          <HStack spacing={1.5} flexShrink={0}>
            <Badge fontSize="2xs" colorScheme="blue" flexShrink={0} borderWidth="1px" borderRadius="md" px={1.5}>
              {product.condition || 'Used'}
            </Badge>
            {isOwnProduct ? (
              <Badge colorScheme="gray" variant="subtle" borderRadius="full" fontSize="2xs" px={2}>
                Your item
              </Badge>
            ) : (
              <Tooltip label={isSaved ? 'Remove from saved' : 'Save'} placement="top" hasArrow>
                <IconButton
                  aria-label={isSaved ? 'Remove from saved' : 'Save product'}
                  icon={
                    <AnimatePresence mode="wait" initial={false}>
                      <motion.span
                        key={isSaved ? 'saved' : 'unsaved'}
                        initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.88 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={prefersReducedMotion ? undefined : { opacity: 0, scale: 0.88 }}
                        transition={{ duration: motionDurations.ui, ease: motionEasings.easeOut }}
                        style={{ display: 'inline-flex' }}
                      >
                        {isSaved ? <FaHeart /> : <FaRegHeart />}
                      </motion.span>
                    </AnimatePresence>
                  }
                  size="xs"
                  minW="28px"
                  h="28px"
                  borderRadius="full"
                  variant="ghost"
                  color={isSaved ? 'red.500' : 'gray.600'}
                  isLoading={isSaving}
                  onClick={handleSaveToggle}
                  _hover={{ bg: 'red.50', color: isSaved ? 'red.600' : 'red.500' }}
                  _active={{ transform: 'scale(0.96)' }}
                />
              </Tooltip>
            )}
          </HStack>
        </Flex>

        {/* Title + save button on same row (mobile) / title alone (desktop) */}
        <Flex align="center" gap={1} mb={{ base: 0.5, md: 1 }} minW={0} overflow="hidden">
          <Heading
            size="sm"
            noOfLines={1}
            flex={1}
            minW={0}
            color="gray.800"
            flexShrink={1}
            textAlign="left"
            fontSize={{ base: '12px', md: '13px' }}
            lineHeight="1.3"
            overflow="hidden"
          >
            {product.title}
          </Heading>
          {/* Save / Your-item — mobile only; desktop version lives in seller row above */}
          {isOwnProduct ? (
            <Badge display={{ base: 'flex', md: 'none' }} colorScheme="gray" variant="subtle" borderRadius="full" fontSize="10px" px={1.5} flexShrink={0}>
              Yours
            </Badge>
          ) : (
            <Tooltip label={isSaved ? 'Remove from saved' : 'Save'} placement="top" hasArrow>
              <IconButton
                display={{ base: 'flex', md: 'none' }}
                aria-label={isSaved ? 'Remove from saved' : 'Save product'}
                icon={
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.span
                      key={isSaved ? 'saved-mobile' : 'unsaved-mobile'}
                      initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.88 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={prefersReducedMotion ? undefined : { opacity: 0, scale: 0.88 }}
                      transition={{ duration: motionDurations.ui, ease: motionEasings.easeOut }}
                      style={{ display: 'inline-flex' }}
                    >
                      {isSaved ? <FaHeart /> : <FaRegHeart />}
                    </motion.span>
                  </AnimatePresence>
                }
                size="xs"
                minW="24px"
                h="24px"
                borderRadius="full"
                variant="ghost"
                flexShrink={0}
                color={isSaved ? 'red.500' : 'gray.400'}
                isLoading={isSaving}
                onClick={handleSaveToggle}
                _hover={{ bg: 'red.50', color: isSaved ? 'red.600' : 'red.500' }}
                _active={{ transform: 'scale(0.96)' }}
              />
            </Tooltip>
          )}
        </Flex>

        {/* Description */}
        <Text
          color="gray.600"
          noOfLines={1}
          mb={{ base: 0.5, md: 1 }}
          fontSize={{ base: '11px', md: '12px' }}
          flexShrink={0}
          textAlign="left"
        >
          {product.description
            ? product.description
              .split(' ')
              .slice(0, product.description.split(' ').length > 15 ? 8 : 15)
              .join(' ') + (product.description.split(' ').length > 15 ? '...' : '')
            : 'No description available'}
        </Text>

        {/* Product Value */}
        {product.value !== undefined && product.value > 0 && (
          <Text
            fontSize="xs"
            fontWeight="bold"
            color="green.600"
            mb={{ base: 0, md: 0.5 }}
          >
            ₱{(product.value as number).toLocaleString()}
          </Text>
        )}

        {/* Wishlist badge */}
        <Flex mb={{ base: 0.5, md: 1 }} align="center" gap={1} minH={{ base: 0, md: '18px' }}>
          {isBoosted && (
            <Tooltip label={boostTimeRemaining ? `Boosted for ${boostTimeRemaining} more` : 'Boosted'} placement="top" hasArrow>
              <Badge
                colorScheme="orange"
                variant="solid"
                borderRadius="full"
                px={2}
                py={0.5}
                fontSize="xs"
                display="inline-flex"
                alignItems="center"
                gap={1}
              >
                <StarIcon boxSize={2.5} />
                Boosted
              </Badge>
            </Tooltip>
          )}
          {product.wishlist_count > 0 && (
            <Badge
              colorScheme="pink"
              variant="subtle"
              borderRadius="full"
              px={2}
              py={0.5}
              fontSize="xs"
            >
              ❤️ {product.wishlist_count} {product.wishlist_count === 1 ? 'person wants' : 'people want'}
            </Badge>
          )}
        </Flex>

        {/* Availability Slots (compact) — only when explicitly enabled */}
        {showAvailability && (() => {
          const raw = (product as any).availability_slots
          if (!raw) return null
          try {
            const slots: AvailabilitySlot[] = typeof raw === 'string' ? JSON.parse(raw) : raw
            if (!Array.isArray(slots) || slots.length === 0) return null
            return (
              <Box mb={{ base: 0.5, md: 1 }}>
                <AvailabilitySlots slots={slots} availabilityType={(product as any).availability_type} compact />
              </Box>
            )
          } catch { return null }
        })()}

        {/* Organization Tags */}
        {product.organization_tags && product.organization_tags.length > 0 && (
          <Flex mb={{ base: 0.5, md: 1.5 }} align="center" gap={1} flexWrap="wrap">
            {product.organization_tags.map((org: any) => (
              <Tooltip key={org.id} label={org.description || org.name} placement="top" hasArrow>
                <Badge
                  as="a"
                  href={`/organizations/${org.slug}`}
                  onClick={(e: React.MouseEvent) => e.stopPropagation()}
                  colorScheme="purple"
                  variant="subtle"
                  borderRadius="full"
                  px={2}
                  py={0.5}
                  fontSize="xs"
                  cursor="pointer"
                  _hover={{ transform: 'scale(1.05)', boxShadow: 'sm' }}
                  transition="all 0.2s"
                  display="flex"
                  alignItems="center"
                  gap={1}
                >
                  {org.logo_url && (
                    <Image
                      src={org.logo_url}
                      alt={org.name}
                      boxSize="14px"
                      borderRadius="50%"
                      onError={(e: any) => {
                        e.target.style.display = 'none'
                      }}
                    />
                  )}
                  <Text fontSize="10px" noOfLines={1}>
                    {org.name}
                  </Text>
                </Badge>
              </Tooltip>
            ))}
          </Flex>
        )}

        {/* Action buttons */}
        {isOwnProduct ? (
          <VStack spacing={{ base: 1, md: 2 }} align="stretch" mt="auto" pt={{ base: 1, md: 2 }} w="full">
            <Badge alignSelf="flex-start" colorScheme="gray" variant="subtle" borderRadius="full" px={2.5} py={0.5}>
              This is your item
            </Badge>
            <HStack spacing={{ base: 1, md: 2 }} w="full">
              <Button
                size="sm"
                h={{ base: '40px', md: '40px' }}
                minH="40px"
                leftIcon={<EditIcon />}
                flex={1}
                px={{ base: 1, md: 3 }}
                borderRadius="xl"
                fontSize={{ base: '10px', md: '13px' }}
                fontWeight="700"
                colorScheme="brand"
                variant="outline"
                onClick={handleEditClick}
              >
                Edit
              </Button>
              <Button
                size="sm"
                h={{ base: '40px', md: '40px' }}
                minH="40px"
                leftIcon={<ViewIcon />}
                flex={1}
                px={{ base: 1, md: 3 }}
                borderRadius="xl"
                fontSize={{ base: '10px', md: '13px' }}
                fontWeight="700"
                variant="ghost"
                onClick={handleViewListingClick}
              >
                View
              </Button>
            </HStack>
          </VStack>
        ) : (
          <HStack spacing={{ base: 1, md: 2 }} mt="auto" pt={{ base: 1, md: 2 }} w="full" overflow="hidden">
            <Tooltip label="Trade" placement="top">
              <Button
                size="sm"
                h={{ base: '40px', md: '40px' }}
                minH="40px"
                bg={useColorModeValue('brand.50', 'brand.900')}
                color={useColorModeValue('brand.600', 'brand.200')}
                leftIcon={isMobile ? undefined : <Icon as={FaExchangeAlt} boxSize="13px" />}
                flex={1}
                minW={0}
                px={{ base: '6px', md: 3 }}
                borderRadius="xl"
                fontSize={{ base: '10px', md: '13px' }}
                fontWeight="700"
                onClick={handleTradeClick}
                isDisabled={product.status === 'sold'}
                transition="all 0.2s"
                _hover={{ bg: useColorModeValue('brand.100', 'brand.800'), transform: 'translateY(-2px)', shadow: 'sm' }}
                _active={{ transform: 'scale(0.98)' }}
              >
                {product.status === 'sold' ? 'Sold' : 'Trade'}
              </Button>
            </Tooltip>

            <Button
              size="sm"
              h={{ base: '40px', md: '40px' }}
              minH="40px"
              bg={useColorModeValue('orange.50', 'orange.900')}
              color={useColorModeValue('orange.600', 'orange.200')}
              leftIcon={isMobile ? undefined : <Icon as={FaMoneyBillWave} boxSize="13px" />}
              flex={1}
              minW={0}
              px={{ base: '6px', md: 3 }}
              borderRadius="xl"
              fontSize={{ base: '10px', md: '13px' }}
              fontWeight="700"
              _hover={{ bg: useColorModeValue('orange.100', 'orange.800'), transform: 'translateY(-2px)', shadow: 'sm' }}
              _active={{ transform: 'scale(0.98)' }}
              onClick={handleBuyoutClick}
              isDisabled={product.status === 'sold'}
              transition="all 0.2s"
            >
              Buyout
            </Button>

            <Tooltip label="View offers" placement="top">
              <Box position="relative" flexShrink={0}>
                <IconButton
                  aria-label="View offers"
                  icon={<FaHandshake />}
                  size="sm"
                  h={{ base: '40px', md: '40px' }}
                  w={{ base: '40px', md: '40px' }}
                  minW={{ base: '40px', md: '40px' }}
                  bg={useColorModeValue('brand.50', 'brand.900')}
                  color={useColorModeValue('brand.600', 'brand.200')}
                  borderRadius="xl"
                  onClick={handleViewOffers}
                  isDisabled={product.status === 'sold'}
                  transition="all 0.2s"
                  _hover={{ bg: useColorModeValue('brand.100', 'brand.800'), transform: 'translateY(-2px)', shadow: 'sm' }}
                  _active={{ transform: 'scale(0.98)' }}
                />
                {Number(product.offer_count || 0) > 0 && (
                  <Badge
                    position="absolute"
                    top="-6px"
                    right="-6px"
                    minW="17px"
                    h="17px"
                    px={1}
                    borderRadius="full"
                    colorScheme="brand"
                    fontSize="9px"
                    display="grid"
                    placeItems="center"
                    pointerEvents="none"
                  >
                    {product.offer_count}
                  </Badge>
                )}
              </Box>
            </Tooltip>
          </HStack>
        )}
      </Box>
    </MotionBox>
  )
}

export default React.memo(ProductCard)
