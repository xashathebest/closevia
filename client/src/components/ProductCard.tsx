import React, { useCallback, useState, useEffect } from 'react'
import {
  Box,
  Heading,
  Text,
  Button,
  Image,
  Badge,
  HStack,
  Flex,
  Tooltip,
  Icon,
  useColorModeValue,
} from '@chakra-ui/react'
import { StarIcon } from '@chakra-ui/icons'
import { FaMoneyBillWave, FaHandshake, FaExchangeAlt, FaRocket, FaCheckCircle } from 'react-icons/fa'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import { getFirstImage, getImageUrl } from '../utils/imageUtils'
import { getProductUrl } from '../utils/productUtils'
import { IconButton } from '@chakra-ui/react'
import VerifiedAvatar from './VerifiedAvatar'
import ProximityBadge from './ProximityBadge'

interface ProductCardProps {
  product: any
  onTradeClick: (productId: number) => void
  onBuyoutClick: (productId: number) => void
  onBuyClick: (productId: number) => void
  onViewOffers: (productId: number) => void
  showPriceOverlay?: boolean
  onBoostClick?: (productId: number) => void
  isStagnant?: boolean
}

/**
 * ProductCard - Memoized product card component to prevent unnecessary re-renders
 * Displays product image, seller info, title, description, wishlist count, and action buttons
 */
const ProductCard: React.FC<ProductCardProps> = ({
  product,
  onTradeClick,
  onBuyoutClick,
  onBuyClick,
  onViewOffers,
  showPriceOverlay = false,
  onBoostClick,
  isStagnant = false,
}) => {
  const navigate = useNavigate()
  const [boostTimeRemaining, setBoostTimeRemaining] = useState<string | null>(null)
  const [isBoosted, setIsBoosted] = useState(false)

  // Calculate boost remaining time
  useEffect(() => {
    if (!product.boosted_at) {
      setIsBoosted(false)
      return
    }

    const calculateRemaining = () => {
      const boostedAtRaw = String(product.boosted_at)
      const normalizedBoostedAt = boostedAtRaw.includes('T') ? boostedAtRaw : boostedAtRaw.replace(' ', 'T')
      const boostedTime = new Date(normalizedBoostedAt).getTime()
      if (Number.isNaN(boostedTime)) {
        setIsBoosted(false)
        setBoostTimeRemaining(null)
        return
      }
      const expiresAt = boostedTime + 3 * 60 * 60 * 1000 // 3 hours in ms
      const now = new Date().getTime()
      const remaining = expiresAt - now

      if (remaining <= 0) {
        setIsBoosted(false)
        setBoostTimeRemaining(null)
      } else {
        setIsBoosted(true)
        const hours = Math.floor(remaining / (60 * 60 * 1000))
        const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000))
        
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
  }, [product.boosted_at])



  const sellerAvatar = product.seller_profile_picture
    ? getImageUrl(product.seller_profile_picture)
    : undefined

  // Memoize click handlers
  const handleCardClick = useCallback(async () => {
    // Navigate to product details page
    navigate(getProductUrl(product))
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
    <Box
      key={product.id}
      bg="white"
      borderRadius="2xl"
      shadow="sm"
      borderWidth="1px"
      borderColor={useColorModeValue('gray.200', 'gray.700')}
      overflow="hidden"
      transition="all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)"
      w="full"
      h="full"
      display="flex"
      flexDirection="column"
      _hover={{ boxShadow: 'lg', transform: 'translateY(-4px)', borderColor: 'brand.200', cursor: 'pointer' }}
      onClick={handleCardClick}
    >
      {/* Image section */}
      <Box position="relative" w="full" pt="100%" overflow="hidden" bg="gray.100">
        <Image
          src={getFirstImage(product.image_urls)}
          alt={product.title}
          position="absolute"
          top={0}
          left={0}
          w="100%"
          h="100%"
          objectFit="cover"
          loading="lazy"
          fallbackSrc="/no-image.svg"
        />

        {/* Top-right image badges */}
        <Box position="absolute" top={{ base: 2, md: 3 }} right={{ base: 2, md: 3 }} zIndex={1}>
          <Box display="flex" flexDirection="column" gap={1.5} alignItems="flex-end">
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
                    📊 Market Est. ₱{formatPriceUltraCompact(product.estimated_value_min)} – ₱{formatPriceUltraCompact(product.estimated_value_max)}
                  </Text>
                )}
                {product.price && product.price > 0 && canShowEstimate && (
                  <Text display={{ base: 'block', sm: 'none' }} fontSize="2xs" color={useColorModeValue('brand.600', 'brand.300')} lineHeight="1.2" mt={0.5} fontWeight="700" whiteSpace="nowrap">
                    📊 Est. ₱{formatPriceUltraCompact(product.estimated_value_min)}-₱{formatPriceUltraCompact(product.estimated_value_max)}
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
        </Box>

        {(product.tradeMatchScore != null && product.tradeMatchScore > 0) || isBoosted ? (
          <Box position="absolute" top={{ base: 2, md: 3 }} left={{ base: 2, md: 3 }} display="flex" flexDirection="column" gap={1.5} alignItems="flex-start">
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
        <Box position="absolute" bottom={{ base: 2, md: 3 }} left={{ base: 2, md: 3 }}>
          <ProximityBadge type="product" targetId={product.id} showIcon={true} />
        </Box>
      </Box>

      {/* Info section */}
      <Box
        p={{ base: 3, md: 4 }}
        display="flex"
        flexDirection="column"
        flex={1}
        overflow="hidden"
      >
        {/* Seller row (desktop) */}
        <Flex justify="space-between" align="center" mb={1}>
          <HStack spacing={1} align="center" mt="auto">
            {((product as any).seller_slug || product.seller_id) ? (
              <RouterLink to={`/users/${(product as any).seller_slug || product.seller_id}`} onClick={(e: React.MouseEvent) => e.stopPropagation()}>
                <VerifiedAvatar
                  size={{ base: 'xs', md: 'sm' } as any}
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
                size={{ base: 'xs', md: 'sm' } as any}
                src={sellerAvatar}
                name={product.seller_name || 'U'}
                bg="brand.500"
                flexShrink={0}
                isVerified={product.seller_verified || false}
              />
            )}
            <Text fontSize={{ base: 'xs', md: 'xs' }} color="black" fontWeight="medium" noOfLines={1}>
              {product.seller_name || 'Unknown'}
            </Text>
          </HStack>
          <Badge fontSize={{ base: 'xs', md: '2xs' }} colorScheme="blue" flexShrink={0} borderWidth="1px">
            {product.condition || 'Used'}
          </Badge>
        </Flex>

        {/* Title */}
        <Heading
          size="sm"
          noOfLines={1}
          mb={1}
          color="gray.800"
          flexShrink={0}
          textAlign="left"
          fontSize={{ base: '12px', md: '13px' }}
          lineHeight="1.3"
        >
          {product.title}
        </Heading>

        {/* Description */}
        <Text
          color="gray.600"
          noOfLines={1}
          mb={1}
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
            mb={0.5}
          >
            ₱{(product.value as number).toLocaleString()}
          </Text>
        )}

        {/* Wishlist badge */}
        <Flex mb={1} align="center" gap={1} minH={{ base: '16px', md: '18px' }}>
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

        {/* Organization Tags */}
        {product.organization_tags && product.organization_tags.length > 0 && (
          <Flex mb={1.5} align="center" gap={1} flexWrap="wrap">
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
        <HStack spacing={{ base: 1.5, md: 2 }} mt="auto" pt={2} w="full">
          <Tooltip label="Trade" placement="top">
            <Button
              size="sm"
              bg={useColorModeValue('brand.50', 'brand.900')}
              color={useColorModeValue('brand.600', 'brand.200')}
              leftIcon={<Icon as={FaExchangeAlt} />}
              flex={1}
              px={{ base: 1, md: 3 }}
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
            bg={useColorModeValue('orange.50', 'orange.900')}
            color={useColorModeValue('orange.600', 'orange.200')}
            leftIcon={<Icon as={FaMoneyBillWave} />}
            flex={1}
            px={{ base: 1, md: 3 }}
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
            <IconButton
              aria-label="View offers"
              icon={<FaHandshake />}
              size="sm"
              bg={useColorModeValue('blue.50', 'blue.900')}
              color={useColorModeValue('blue.600', 'blue.200')}
              borderRadius="xl"
              onClick={handleViewOffers}
              isDisabled={product.status === 'sold'}
              flexShrink={0}
              transition="all 0.2s"
              _hover={{ bg: useColorModeValue('blue.100', 'blue.800'), transform: 'translateY(-2px)', shadow: 'sm' }}
              _active={{ transform: 'scale(0.98)' }}
            />
          </Tooltip>
        </HStack>
      </Box>
    </Box>
  )
}

export default React.memo(ProductCard)
