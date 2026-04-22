import React, { useEffect, useMemo, useState } from 'react'
import { Modal, ModalOverlay, ModalContent, ModalHeader, ModalCloseButton, ModalBody, VStack, HStack, Box, Image, Text, Badge, Button, Divider, Grid, useToast, ModalFooter, AlertDialog, AlertDialogOverlay, AlertDialogContent, AlertDialogHeader, AlertDialogBody, AlertDialogFooter, useDisclosure, Icon, Card, CardBody, useColorModeValue, FormControl, FormLabel, Textarea } from '@chakra-ui/react'
import { FaMapMarkerAlt, FaTruck, FaHandshake, FaChevronLeft, FaChevronRight } from 'react-icons/fa'
import { formatPHP } from '../utils/currency'
import { Trade, Product, TradeAction, TradeOption } from '../types'
import { useProducts } from '../contexts/ProductContext'
import { getFirstImage } from '../utils/imageUtils'
import { getProductUrl } from '../utils/productUtils'
import { useAuth } from '../contexts/AuthContext'
import { api } from '../services/api'

interface OfferDetailsModalProps {
  trade: Trade | null
  isOpen: boolean
  onClose: () => void
  onAccepted: (action?: 'accept' | 'counter') => void
  onDeclined: () => void
}

const OfferDetailsModal: React.FC<OfferDetailsModalProps> = ({ trade, isOpen, onClose, onAccepted, onDeclined }) => {
  const toast = useToast()
  const { getProduct } = useProducts()
  const { user } = useAuth()
  const [requested, setRequested] = useState<Product | null>(null)
  const [offered, setOffered] = useState<Product[]>([])
  const [loading, setLoading] = useState(false)
  const [counterOpen, setCounterOpen] = useState(false)
  const [userInventory, setUserInventory] = useState<Product[]>([])
  const [selectedCounterIds, setSelectedCounterIds] = useState<number[]>([])
  const [detailedTrade, setDetailedTrade] = useState<Trade | null>(null)
  const [showDebug, setShowDebug] = useState<boolean>(false)
  const [showOptionChangeModal, setShowOptionChangeModal] = useState(false)
  const [requestedOption, setRequestedOption] = useState<TradeOption | null>(null)
  const [requestedDeliveryAddress, setRequestedDeliveryAddress] = useState<string>('')
  const [requestingOptionChange, setRequestingOptionChange] = useState(false)
  const [isAccepting, setIsAccepting] = useState(false)
  const [isDeclining, setIsDeclining] = useState(false)
  const [isCountering, setIsCountering] = useState(false)

  // Build instant placeholder products from trade data to avoid blink
  const buildPlaceholderProduct = (id: number, title?: string, imageUrl?: string): Product => ({
    id,
    title: title || `Product #${id}`,
    description: '',
    status: 'available',
    seller_id: 0,
    image_urls: imageUrl ? [imageUrl] : [],
    created_at: '',
    updated_at: '',
  } as Product)

  // If incoming trade from list lacks items, fetch detailed trade
  useEffect(() => {
    if (!isOpen || !trade) return
    const tradeId = Number(trade.id)
    if ((!trade.items || trade.items.length === 0) && Number.isInteger(tradeId) && tradeId > 0) {
      ;(async () => {
        try {
          const res = await api.get(`/api/trades/${tradeId}`)
          const dt: Trade | null = res.data?.data || null
          setDetailedTrade(dt)
        } catch (e) {
          setDetailedTrade(null)
        }
      })()
    } else {
      setDetailedTrade(null)
    }
  }, [isOpen, trade])

  const effectiveTrade = detailedTrade || trade
  const needsUserAcceptance = Boolean(
    effectiveTrade?.status === 'accepted_by_one' &&
    user?.id &&
    ((effectiveTrade.buyer_id === user.id && !effectiveTrade.buyer_accepted) ||
      (effectiveTrade.seller_id === user.id && !effectiveTrade.seller_accepted))
  )
  const canRespondToOffer = Boolean(
    ((effectiveTrade?.status === 'pending' || effectiveTrade?.status === 'pending_multiway') && effectiveTrade?.seller_id === user?.id) ||
    needsUserAcceptance ||
    (effectiveTrade?.status === 'countered' && effectiveTrade?.countered_by !== user?.id)
  )

  const activeOfferRole = useMemo(() => {
    if (!effectiveTrade) return 'buyer'
    if (effectiveTrade.status === 'countered') {
      return effectiveTrade.countered_by === effectiveTrade.seller_id ? 'seller' : 'buyer'
    }
    return 'buyer'
  }, [effectiveTrade])

  // Resilient extraction of the items that belong to the currently active offer.
  const activeOfferItems = useMemo(() => {
    const items = (effectiveTrade?.items || []) as Array<any>
    const filtered = items.filter((i: any) => {
      const offeredBy = (i?.offered_by ?? i?.offeredBy ?? i?.sender ?? i?.from_user_role)
      if (typeof offeredBy === 'string') {
        const v = offeredBy.toLowerCase().trim()
        if (activeOfferRole === 'seller') {
          return v === 'seller' || v === 'from_seller'
        }
        return v === 'buyer' || v === 'from_buyer' || v === 'sender'
      }
      return false
    })
    return filtered
  }, [effectiveTrade, activeOfferRole])
  const offeredItemIds = useMemo(() => {
    const ids = activeOfferItems.map((i: any) => {
      const pid = (i?.product_id ?? i?.productId)
      return typeof pid === 'string' ? Number(pid) : pid
    })
    const filtered = ids
      .filter((x: any) => typeof x === 'number' && !Number.isNaN(x)) as number[]
    return filtered
  }, [activeOfferItems])

  // Immediately set placeholder data from trade object (no API call needed)
  useEffect(() => {
    if (!isOpen || !effectiveTrade) return

    // Instant placeholder for requested (target) product
    const tradeAny = effectiveTrade as any
    const targetImg = tradeAny.product_image_url || tradeAny.productImageUrl || ''
    const targetTitle = effectiveTrade.product_title || ''
    if (effectiveTrade.target_product_id) {
      setRequested(prev => prev?.id === effectiveTrade.target_product_id ? prev :
        buildPlaceholderProduct(effectiveTrade.target_product_id, targetTitle, targetImg)
      )
    }

    // Instant placeholders for offered items
    if (activeOfferItems.length > 0) {
      const placeholders = activeOfferItems.map((item: any) => {
        const pid = item.product_id ?? item.productId
        const pTitle = item.product_title ?? item.productTitle ?? ''
        const pImg = item.product_image_url ?? item.productImageUrl ?? ''
        return buildPlaceholderProduct(Number(pid), pTitle, pImg)
      }).filter((p: Product) => p.id > 0)
      if (placeholders.length > 0) {
        setOffered(placeholders)
      }
    }
  }, [isOpen, effectiveTrade, activeOfferItems])

  // Then fetch full product details in background (upgrades placeholder data)
  useEffect(() => {
    if (!isOpen || !effectiveTrade) return
    ;(async () => {
      try {
        setLoading(true)
        const req = await getProduct(effectiveTrade.target_product_id)
        setRequested(req)
        const details: Product[] = []
        for (const pid of offeredItemIds) {
          const p = await getProduct(pid)
          if (p) details.push(p)
        }
        setOffered(details)
      } finally {
        setLoading(false)
      }
    })()
  }, [isOpen, effectiveTrade, getProduct, offeredItemIds])

  const accept = async () => {
    if (!effectiveTrade || isAccepting) return
    try {
      setIsAccepting(true)
      await api.put(`/api/trades/${effectiveTrade.id}`, { action: 'accept' } as TradeAction)
      toast({
        id: "offerdetailsmodal-offer-accepted", title: 'Offer accepted', status: 'success' })
      onAccepted('accept')
      onClose()
    } catch (e: any) {
      toast({
        id: "offerdetailsmodal-failed-to-accept", title: 'Failed to accept', description: e?.response?.data?.error || 'Try again', status: 'error' })
    } finally {
      setIsAccepting(false)
    }
  }

  const decline = async () => {
    onDeclineOpen()
  }

  const confirmDecline = async () => {
    if (!effectiveTrade || isDeclining) return
    try {
      setIsDeclining(true)
      await api.put(`/api/trades/${effectiveTrade.id}`, { action: 'decline' } as TradeAction)
      toast({
        id: "offerdetailsmodal-offer-declined", title: 'Offer declined', status: 'success' })
      onDeclined()
      onClose()
      onDeclineClose()
    } catch (e: any) {
      toast({
        id: "offerdetailsmodal-failed-to-decline", title: 'Failed to decline', description: e?.response?.data?.error || 'Try again', status: 'error' })
    } finally {
      setIsDeclining(false)
    }
  }

  const openCounter = async () => {
    if (!effectiveTrade) return
    
    // Reset form fields
    setCashDelta('')
    setCounterMsg('')
    
    try {
      // Load sender (User A) active listings
      const res = await api.get(`/api/products/user/${effectiveTrade.buyer_id}?active=true&page=1&limit=50`)
      const list: Product[] = Array.isArray(res.data?.data?.data) ? res.data.data.data : []
      setUserInventory(list)
      
      // For buyout trades, don't preselect items (they don't have items anyway)
      // For regular trades, preselect current offered items
      if (!isBuyout) {
        setSelectedCounterIds(offeredItemIds)
      } else {
        setSelectedCounterIds([])
      }
      setCounterOpen(true)
    } catch {
      setUserInventory([])
      setSelectedCounterIds(isBuyout ? [] : offeredItemIds)
      setCounterOpen(true)
    }
  }

  const toggleCounter = (id: number) => {
    setSelectedCounterIds(prev => {
      if (prev.includes(id)) {
        return prev.filter(x => x !== id)
      }
      
      const limit = requested?.max_items_per_offer || 0
      if (limit > 0 && prev.length >= limit) {
        toast({
          id: 'offerdetailsmodal-selection-limit',
          title: 'Selection Limit Reached',
          description: `You can only select up to ${limit} items for this trade.`,
          status: 'warning',
          duration: 3000,
          isClosable: true,
        })
        return prev
      }
      
      return [...prev, id]
    })
  }

  const [cashDelta, setCashDelta] = useState<string>('')
  const [counterMsg, setCounterMsg] = useState<string>('')
  const { isOpen: isDeclineOpen, onOpen: onDeclineOpen, onClose: onDeclineClose } = useDisclosure()
  const cancelRef = React.useRef<HTMLButtonElement>(null)

  // Check if this is a buyout trade (no items offered, only cash)
  const isBuyout = useMemo(() => {
    return (!effectiveTrade?.items || effectiveTrade.items.length === 0) && 
           (effectiveTrade?.offered_cash_amount && effectiveTrade.offered_cash_amount > 0)
  }, [effectiveTrade])

  const submitCounter = async () => {
    if (!effectiveTrade || isCountering) return
    try {
      setIsCountering(true)
      await api.put(`/api/trades/${effectiveTrade.id}`, { action: 'counter', counter_offered_product_ids: selectedCounterIds, message: counterMsg, counter_offered_cash_amount: cashDelta ? Number(cashDelta) : undefined } as TradeAction)
      toast({
        id: "offerdetailsmodal-counter-offer-sent", title: 'Counter offer sent', status: 'success' })
      onAccepted('counter')
      onClose()
    } catch (e: any) {
      toast({
        id: "offerdetailsmodal-failed-to-counter", title: 'Failed to counter', description: e?.response?.data?.error || 'Try again', status: 'error' })
    } finally {
      setIsCountering(false)
    }
  }

  // Option change request functionality
  const canRequestOptionChange = () => {
    if (!effectiveTrade || !user) return false
    // Only allow option change before trade is ongoing (status is pending or accepted, but not active)
    const isPendingOrAccepted = effectiveTrade.status === 'pending' || effectiveTrade.status === 'accepted'
    // Only buyer can request option change (since seller set the initial option)
    const isBuyer = effectiveTrade.buyer_id === user.id
    // Don't allow if there's already a pending change request
    const hasPendingRequest = !!effectiveTrade.option_change_requested
    return isPendingOrAccepted && isBuyer && !hasPendingRequest
  }

  const requestOptionChange = async () => {
    if (!effectiveTrade || !requestedOption) return
    if (requestedOption === 'delivery' && !requestedDeliveryAddress.trim()) {
      toast({
        id: "offerdetailsmodal-delivery-address-required", title: 'Delivery address required', description: 'Please provide a delivery address for delivery option.', status: 'warning' })
      return
    }
    try {
      setRequestingOptionChange(true)
      await api.put(`/api/trades/${effectiveTrade.id}`, {
        action: 'request_option_change',
        requested_option: requestedOption,
        delivery_address: requestedOption === 'delivery' ? requestedDeliveryAddress : undefined,
      } as TradeAction)
      toast({
        id: "offerdetailsmodal-option-change-requested", 
        title: 'Option change requested', 
        description: 'The trader will be notified of your request to change the trade option.', 
        status: 'success' 
      })
      setShowOptionChangeModal(false)
      setRequestedOption(null)
      setRequestedDeliveryAddress('')
      onAccepted() // Refresh trade data
    } catch (e: any) {
      toast({
        id: "offerdetailsmodal-failed-to-request-change", title: 'Failed to request change', description: e?.response?.data?.error || 'Try again', status: 'error' })
    } finally {
      setRequestingOptionChange(false)
    }
  }

  const approveOptionChange = async () => {
    if (!effectiveTrade) return
    try {
      await api.put(`/api/trades/${effectiveTrade.id}`, {
        action: 'approve_option_change',
      } as TradeAction)
      toast({
        id: "offerdetailsmodal-option-change-approved", title: 'Option change approved', description: 'The trade option has been updated.', status: 'success' })
      onAccepted() // Refresh trade data
    } catch (e: any) {
      toast({
        id: "offerdetailsmodal-failed-to-approve-change", title: 'Failed to approve change', description: e?.response?.data?.error || 'Try again', status: 'error' })
    }
  }

  const rejectOptionChange = async () => {
    if (!effectiveTrade) return
    try {
      await api.put(`/api/trades/${effectiveTrade.id}`, {
        action: 'reject_option_change',
      } as TradeAction)
      toast({
        id: "offerdetailsmodal-option-change-rejected", title: 'Option change rejected', description: 'The trade will proceed with the original option.', status: 'success' })
      onAccepted() // Refresh trade data
    } catch (e: any) {
      toast({
        id: "offerdetailsmodal-failed-to-reject-change", title: 'Failed to reject change', description: e?.response?.data?.error || 'Try again', status: 'error' })
    }
  }

  const isUserSeller = effectiveTrade && user && effectiveTrade.seller_id === user.id
  const hasPendingOptionChange = !!effectiveTrade?.option_change_requested

  // Resolve image URL robustly from various product shapes
  const resolveImage = (p?: Product | null): string | undefined => {
    if (!p) return undefined
    const maybeImgs: any = (p as any).image_urls ?? (p as any).images ?? null
    if (Array.isArray(maybeImgs) && maybeImgs.length > 0) {
      return getFirstImage(maybeImgs)
    }
    if (typeof maybeImgs === 'string' && maybeImgs.trim().startsWith('[')) {
      try {
        const parsed = JSON.parse(maybeImgs)
        if (Array.isArray(parsed) && parsed.length > 0) return getFirstImage(parsed)
      } catch {
        // ignore parse error
      }
    }
    if ((p as any).image_url) return (p as any).image_url
    if ((p as any).imageUrl) return (p as any).imageUrl
    return undefined
  }

  const renderProductCard = (p: Product | null, opts?: { compact?: boolean }) => {
    if (!p) return null
    const compact = !!opts?.compact
    const showPrice = !!p.allow_buying && !p.barter_only && typeof p.price === 'number'
    const imageHeight = compact ? '120px' : '180px' // Increased height for better visibility
    const padding = compact ? 2 : 3
    const titleSize = compact ? 'xs' : 'sm'
    const titleFontWeight = 'semibold'

    const imgSrc = resolveImage(p)

    return (
      <Box borderWidth="1px" borderColor="gray.100" rounded="lg" overflow="hidden" bg="white" height="100%" display="flex" flexDirection="column" shadow="sm" transition="all 0.2s" _hover={{ shadow: 'md' }}>
        <Box w="full" h={imageHeight} bg="gray.100" display="flex" alignItems="center" justifyContent="center" overflow="hidden" position="relative">
          <Image 
            src={imgSrc || ''} 
            alt={p.title} 
            w="100%" 
            h="100%" 
            objectFit="cover" 
            fallbackSrc="/no-image.svg" 
          />
          {/* Show premium badge */}
          {p.premium && !compact && (
             <Badge position="absolute" top={2} right={2} colorScheme="brand" backdropFilter="blur(4px)" bg="brand.500" color="white" fontSize="xs" px={2} py={0.5} borderRadius="full">Boosted</Badge>
          )}
        </Box>
        <Box p={padding} display="flex" flexDirection="column" flex={1}>
          <Text fontWeight={titleFontWeight} fontSize={titleSize} noOfLines={2} mb={1}>{p.title}</Text>

          {/* Status badges */}
          {!compact && (
            <HStack spacing={2} mb={2}>
              <Badge colorScheme={p.status === 'available' ? 'green' : 'red'} fontSize="2xs" variant="subtle">{p.status}</Badge>
              {p.barter_only ? <Badge colorScheme="purple" fontSize="2xs" variant="subtle">Barter</Badge> : <Badge colorScheme="blue" fontSize="2xs" variant="subtle">For Sale</Badge>}
            </HStack>
          )}

          {!compact && p.description && <Text color="gray.500" mb={2} fontSize="11px" noOfLines={2}>{p.description}</Text>}

          {showPrice && (
            <Text mb={compact ? 1 : 2} fontWeight="bold" fontSize="xs" color="brand.600">{formatPHP(p.price as number)}</Text>
          )}

          {!compact && <Text mt="auto" mb={2} fontSize="10px" color="gray.500" fontWeight="medium">Seller: {p.seller_name || `#${p.seller_id}`}</Text>}

          <Button as={'a'} href={getProductUrl(p)} variant="outline" colorScheme="brand" mt="auto" size="xs" w="full" borderRadius="md">View Listing</Button>
        </Box>
      </Box>
    )
  }

  const disableAccept = (offeredItemIds.length === 0) && (!effectiveTrade?.offered_cash_amount || effectiveTrade.offered_cash_amount === 0)

  return (
    <Modal isOpen={isOpen} onClose={onClose} size={{ base: 'full', md: 'lg' }} isCentered>
      <ModalOverlay bg="blackAlpha.600" backdropFilter="blur(4px)" />
      <ModalContent maxH="90vh" display="flex" flexDirection="column" bg="white" borderRadius="lg" boxShadow="lg">
        {/* Compact Header */}
        <Box bg="white" borderBottomWidth="1px" borderColor="gray.200" p={2.5}>
          <HStack justify="space-between" align="center">
            <VStack align="start" spacing={0}>
              <Text fontSize="base" fontWeight="bold" color="gray.900">Offer Details</Text>
              <Badge 
                colorScheme={
                  effectiveTrade?.status === 'pending' ? 'yellow' : 
                  effectiveTrade?.status === 'accepted' ? 'green' : 
                  effectiveTrade?.status === 'declined' ? 'red' : 
                  effectiveTrade?.status === 'countered' ? 'purple' : 'gray'
                } 
                fontSize="xs"
              >
                {effectiveTrade?.status === 'countered' 
                  ? (effectiveTrade?.countered_by === user?.id ? 'COUNTER-OFFER SENT' : 'COUNTER-OFFER RECEIVED')
                  : (effectiveTrade?.status ? effectiveTrade.status.replace(/_/g, ' ').toUpperCase() : 'UNKNOWN')
                }
              </Badge>
            </VStack>
            <ModalCloseButton position="static" />
          </HStack>
        </Box>

        {/* Scrollable Content */}
        <ModalBody p={3} overflowY="auto" flex={1}>
          <VStack align="stretch" spacing={3}>
            {/* User Info Section */}
            <Box p={3} bg="gray.50" borderRadius="lg" borderWidth="1px" borderColor="gray.200">
              <Text fontSize="10px" fontWeight="bold" color="gray.500" mb={2} textTransform="uppercase" letterSpacing="wider">Trade Participant</Text>
              <HStack align="center" justify="space-between">
                <HStack spacing={3}>
                  <Box p={2} bg="brand.100" color="brand.600" borderRadius="full">
                    <Icon as={effectiveTrade?.buyer_id === user?.id ? FaChevronRight : FaChevronLeft} boxSize={3} />
                  </Box>
                  <VStack align="start" spacing={0}>
                    <Text fontSize="10px" color="gray.500">{effectiveTrade?.buyer_id === user?.id ? 'You sent offer to' : 'Offer received from'}</Text>
                    <Text fontWeight="bold" fontSize="13px" color="gray.800">
                      {effectiveTrade?.buyer_id === user?.id ? effectiveTrade?.seller_name : effectiveTrade?.buyer_name}
                    </Text>
                  </VStack>
                </HStack>
                <VStack align="end" spacing={1}>
                  <Badge variant="subtle" colorScheme="gray" fontSize="9px">
                    <Text as="span" mr={1}>📍</Text>
                    {effectiveTrade?.buyer_id === user?.id 
                      ? (effectiveTrade?.seller_location || 'Not specified') 
                      : (effectiveTrade?.buyer_location || 'Not specified')}
                  </Badge>
                </VStack>
              </HStack>
            </Box>

            {/* Offer Details Section - Compact 2-Column Info Grid */}
            <Box p={2.5} bg="orange.50" borderRadius="md" borderWidth="1px" borderColor="orange.200">
              <Text fontSize="10px" fontWeight="bold" color="orange.900" mb={2} textTransform="uppercase">Offer Details</Text>
              <Grid templateColumns="1fr 1fr" gap={2}>
                {/* Offer Timestamp */}
                <VStack align="start" spacing={0.5}>
                  <Text fontSize="9px" fontWeight="bold" color="orange.700" textTransform="uppercase">Offered</Text>
                  <Text fontSize="11px" color="orange.900" fontWeight="semibold">
                    {effectiveTrade?.created_at 
                      ? new Date(effectiveTrade.created_at).toLocaleDateString('en-PH', { 
                          month: 'short', 
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })
                      : 'N/A'
                    }
                  </Text>
                </VStack>

                {/* Cash Amount (if applicable) */}
                {effectiveTrade?.offered_cash_amount && effectiveTrade.offered_cash_amount > 0 ? (
                  <VStack align="start" spacing={0.5}>
                    <Text fontSize="9px" fontWeight="bold" color="orange.700" textTransform="uppercase">💰 Cash</Text>
                    <Text fontSize="11px" color="green.700" fontWeight="bold">
                      {formatPHP(effectiveTrade.offered_cash_amount)}
                    </Text>
                  </VStack>
                ) : (
                  <VStack align="start" spacing={0.5}>
                    <Text fontSize="9px" fontWeight="bold" color="orange.700" textTransform="uppercase">💰 Cash</Text>
                    <Text fontSize="11px" color="gray.600">
                      Pure trade
                    </Text>
                  </VStack>
                )}

                {/* Product Location */}
                {requested && (
                  <VStack align="start" spacing={0.5}>
                    <Text fontSize="9px" fontWeight="bold" color="orange.700" textTransform="uppercase">📍 Item Location</Text>
                    <Text fontSize="11px" color="orange.900" fontWeight="semibold" noOfLines={1}>
                      {requested.location || 'Not specified'}
                    </Text>
                  </VStack>
                )}

                {/* Offer Validity (Suggested) */}
                <VStack align="start" spacing={0.5}>
                  <Text fontSize="9px" fontWeight="bold" color="orange.700" textTransform="uppercase">⏰ Valid Until</Text>
                  <Text fontSize="11px" color="orange.900" fontWeight="semibold">
                    {effectiveTrade?.created_at
                      ? new Date(new Date(effectiveTrade.created_at).getTime() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })
                      : '7 days'
                    }
                  </Text>
                </VStack>

                {/* Suggested: Response Time Badge */}
                <VStack align="start" spacing={0.5}>
                  <Text fontSize="9px" fontWeight="bold" color="orange.700" textTransform="uppercase">⚡ Response</Text>
                  <Badge colorScheme="green" fontSize="9px" px={1.5} py={0.5}>
                    Quick
                  </Badge>
                </VStack>

                {/* Suggested: Payment Method (if applicable) */}
                {effectiveTrade?.payment_method && (
                  <VStack align="start" spacing={0.5}>
                    <Text fontSize="9px" fontWeight="bold" color="orange.700" textTransform="uppercase">Payment</Text>
                    <Text fontSize="11px" color="orange.900" fontWeight="semibold" textTransform="capitalize">
                      {effectiveTrade.payment_method}
                    </Text>
                  </VStack>
                )}
              </Grid>
            </Box>

            {/* Counter Offer Info - if status is 'countered' */}
            {effectiveTrade?.status === 'countered' && (
              <Box p={3} bg="purple.50" borderRadius="md" borderWidth="1px" borderColor="purple.200">
                <Text fontSize="sm" fontWeight="bold" color="purple.900" mb={2}>📤 Counter Offer Received</Text>
                <VStack align="start" spacing={2} fontSize="xs" color="purple.800">
                  {isBuyout ? (
                    <>
                      <Text fontWeight="bold">Original Offer: ₱{formatPHP(effectiveTrade?.offered_cash_amount || 0)}</Text>
                      {effectiveTrade?.counter_offered_cash_amount && (
                        <Text fontWeight="bold" color="purple.700">
                          💰 Counter Price: <span style={{ fontSize: '14px', fontWeight: 'bold' }}>₱{formatPHP(effectiveTrade.counter_offered_cash_amount)}</span>
                        </Text>
                      )}
                    </>
                  ) : (
                    <>
                      {effectiveTrade.counter_offered_product_ids && effectiveTrade.counter_offered_product_ids.length > 0 && (
                        <VStack align="start" w="full">
                          <Text fontWeight="bold">Their Items:</Text>
                          <HStack spacing={2} w="full" wrap="wrap">
                            {effectiveTrade.counter_offered_product_ids.map((pid: any) => {
                              const counterProduct = offered.find(p => p.id === pid)
                              return (
                                <Badge key={pid} colorScheme="purple" variant="outline">
                                  {counterProduct?.title || `Product #${pid}`}
                                </Badge>
                              )
                            })}
                          </HStack>
                        </VStack>
                      )}
                      {effectiveTrade.counter_offered_cash_amount && effectiveTrade.counter_offered_cash_amount > 0 && (
                        <Text fontWeight="bold">
                          💰 Additional Cash: ₱{formatPHP(effectiveTrade.counter_offered_cash_amount)}
                        </Text>
                      )}
                    </>
                  )}
                </VStack>
              </Box>
            )}

            {/* Items Comparison - Compact */}
            <Box>
              <Text fontSize="10px" fontWeight="bold" color="gray.700" mb={1.5} textTransform="uppercase">Items</Text>
              <Grid templateColumns={{ base: '1fr', md: '1fr 1fr' }} gap={1.5}>
                {/* Your Requested Item */}
                <Box borderWidth="1px" borderColor="gray.200" borderRadius="md" overflow="hidden" bg="gray.50" display="flex" flexDirection="column" h="100%">
                  {loading ? (
                    <Box p={2} textAlign="center">
                      <Text fontSize="11px" color="gray.500">Loading...</Text>
                    </Box>
                  ) : (
                    <>
                      {renderProductCard(requested, { compact: true })}
                    </>
                  )}
                </Box>

                {/* Their Offered Items */}
                <Box>
                  {activeOfferItems.length > 0 ? (
                    <VStack spacing={1.5} align="stretch" h="100%">
                      {activeOfferItems.map((item: any, idx: number) => {
                        const product = offered.find(p => p.id === (item.product_id ?? item.productId));
                        const itemId = item.product_id ?? item.productId
                        
                        if (!product) {
                          const itemImg = item.product_image_url || item.productImageUrl || item.image || ''
                          const itemTitle = item.product_title || item.productTitle || 'Unknown Item'
                          return (
                            <Box key={item.id || idx} borderWidth="1px" borderColor="gray.100" borderRadius="lg" overflow="hidden" bg="white" height="100%" display="flex" flexDirection="column" shadow="sm">
                              <Box w="full" h="120px" bg="gray.100" display="flex" alignItems="center" justifyContent="center">
                                <Image 
                                  src={itemImg} 
                                  alt={itemTitle} 
                                  w="full" 
                                  h="100%" 
                                  objectFit="cover" 
                                  fallbackSrc="/no-image.svg" 
                                />
                              </Box>
                              <Box p={2} display="flex" flexDirection="column" flex={1}>
                                <Text fontWeight="semibold" fontSize="xs" noOfLines={2} mb={2}>{itemTitle}</Text>
                                <Button 
                                  as="a" 
                                  href={itemId ? `/products/${itemId}` : '#'} 
                                  variant="outline" 
                                  colorScheme="brand" 
                                  w="full" 
                                  size="xs"
                                  mt="auto"
                                  borderRadius="md"
                                  isDisabled={!itemId}
                                >
                                  View Listing
                                </Button>
                              </Box>
                            </Box>
                          )
                        }
                        
                        return (
                          <Box key={item.id || idx} h="100%">
                            {renderProductCard(product, { compact: true })}
                          </Box>
                        );
                      })}
                    </VStack>
                  ) : (
                    <Box p={3} bg="gray.50" borderRadius="md" textAlign="center">
                      <Text fontSize="xs" color="gray.500">No items offered</Text>
                    </Box>
                  )}
                </Box>
              </Grid>
            </Box>

            {/* Trade Summary */}
            {effectiveTrade?.status === 'completed' && (
              <Box p={2} bg="green.50" borderRadius="md" borderWidth="1px" borderColor="green.200">
                <VStack align="stretch" spacing={1.5} fontSize="11px">
                  <HStack justify="space-between">
                    <Text fontWeight="bold" color="green.900">Trade Summary:</Text>
                  </HStack>
                  {effectiveTrade?.completed_at && (
                    <HStack justify="space-between">
                      <Text color="gray.700">Completed:</Text>
                      <Text fontWeight="semibold" color="gray.900">{new Date(effectiveTrade.completed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</Text>
                    </HStack>
                  )}
                  {/* Show buyer/seller ratings if available */}
                  {(effectiveTrade.buyer_rating || effectiveTrade.seller_rating) && (
                    <HStack justify="space-between">
                      <Text color="gray.700">Ratings:</Text>
                      <HStack spacing={2}>
                        {effectiveTrade.buyer_rating && (
                          <HStack spacing={0.5}>
                            <Text fontSize="10px" color="gray.600">Buyer:</Text>
                            <Text fontWeight="bold" color="yellow.500">⭐ {effectiveTrade.buyer_rating}/5</Text>
                          </HStack>
                        )}
                        {effectiveTrade.seller_rating && (
                          <HStack spacing={0.5}>
                            <Text fontSize="10px" color="gray.600">Seller:</Text>
                            <Text fontWeight="bold" color="yellow.500">⭐ {effectiveTrade.seller_rating}/5</Text>
                          </HStack>
                        )}
                      </HStack>
                    </HStack>
                  )}
                </VStack>
              </Box>
            )}

            {trade?.message && (
              <Box p={2} bg="gray.50" borderRadius="md" borderWidth="1px" borderColor="gray.200">
                <Text fontSize="10px" fontWeight="bold" color="gray.700" mb={1}>Message</Text>
                <Text fontSize="11px" color="gray.700" lineHeight="1.4" noOfLines={2}>
                  {trade.message}
                </Text>
              </Box>
            )}

            {/* Trade Method */}
            {effectiveTrade?.trade_option && (
              <Box borderRadius="md" bg="brand.50" p={2} borderWidth="1px" borderColor="brand.200">
                <HStack spacing={2}>
                  <Icon as={effectiveTrade.trade_option === 'meetup' ? FaMapMarkerAlt : effectiveTrade.trade_option === 'delivery' ? FaTruck : FaHandshake} boxSize={3.5} color="brand.600" flexShrink={0} />
                  <VStack align="start" spacing={0} flex={1}>
                    <Text fontWeight="semibold" fontSize="12px" color="brand.900">
                      {effectiveTrade.trade_option === 'meetup' ? 'Meetup' : effectiveTrade.trade_option === 'delivery' ? 'Delivery' : 'Buyout'}
                    </Text>
                    {effectiveTrade.trade_option === 'delivery' && effectiveTrade.delivery_address && (
                      <Text fontSize="10px" color="gray.700">{effectiveTrade.delivery_address}</Text>
                    )}
                    {effectiveTrade.trade_option === 'delivery' && (effectiveTrade as any).delivery_fee !== undefined && (
                      <Text fontSize="10px" color="green.700" fontWeight="semibold">
                        Delivery Fee: {formatPHP((effectiveTrade as any).delivery_fee)}
                      </Text>
                    )}
                  </VStack>
                </HStack>

                {/* Pending Change */}
                {hasPendingOptionChange && effectiveTrade.option_change_requested && (
                  <Box mt={2} pt={2} borderTopWidth="1px" borderColor="brand.200">
                    <Text fontSize="xs" fontWeight="bold" color="brand.700" mb={1}>
                      ⏳ Pending: {effectiveTrade.option_change_requested === 'meetup' ? 'Meetup' : 'Delivery'}
                    </Text>
                    {isUserSeller ? (
                      <HStack spacing={2} mt={2}>
                        <Button size="xs" colorScheme="green" onClick={approveOptionChange}>Approve</Button>
                        <Button size="xs" colorScheme="red" variant="outline" onClick={rejectOptionChange}>Reject</Button>
                      </HStack>
                    ) : (
                      <Text fontSize="xs" color="gray.600" fontStyle="italic">Waiting for seller...</Text>
                    )}
                  </Box>
                )}

                {canRequestOptionChange() && !hasPendingOptionChange && (
                  <Button size="xs" variant="outline" colorScheme="brand" onClick={() => setShowOptionChangeModal(true)} w="full" mt={2}>
                    Request Change
                  </Button>
                )}
              </Box>
            )}
          </VStack>
        </ModalBody>

        {/* Footer */}
        <Box borderTopWidth="1px" borderColor="gray.200" p={2} bg="white">
          <HStack spacing={1.5} justify="flex-end">
            {canRespondToOffer ? (
              <>
                {/* Decline Button */}
                <Button size="xs" variant="outline" colorScheme="red" onClick={decline} fontSize="11px">
                  Decline
                </Button>

                {/* Counter Back Button */}
                <Button size="xs" variant="outline" colorScheme="brand" onClick={openCounter} fontSize="11px">
                  Counter Back
                </Button>

                {/* Accept Button */}
                <Button size="xs" colorScheme="brand" onClick={accept} isDisabled={disableAccept} fontSize="11px">
                  Accept
                </Button>
              </>
            ) : (
              <Text fontSize="11px" color="gray.500" fontStyle="italic">
                {effectiveTrade?.status === 'countered' && effectiveTrade?.countered_by === user?.id 
                  ? 'Waiting for other party to respond to your counter-offer' 
                  : (effectiveTrade?.buyer_id === user?.id && (effectiveTrade?.status === 'pending' || effectiveTrade?.status === 'pending_multiway'))
                    ? 'No actions available for offers you sent' 
                    : `No actions available for ${effectiveTrade?.status?.replace(/_/g, ' ')} trades`
                }
              </Text>
            )}
          </HStack>
        </Box>

        {/* Counter Modal */}
        <Modal isOpen={counterOpen} onClose={() => setCounterOpen(false)} isCentered size={isBuyout ? "sm" : "md"}>
          <ModalOverlay />
          <ModalContent>
            <ModalHeader fontSize="sm">
              {isBuyout ? 'Counter Buyout Offer' : 'Counter Offer'}
              {!isBuyout && requested?.max_items_per_offer ? (
                <Badge ml={2} colorScheme="brand" variant="subtle" verticalAlign="middle">
                  Max {requested.max_items_per_offer} items
                </Badge>
              ) : null}
            </ModalHeader>
            <ModalCloseButton size="sm" />
            <ModalBody fontSize="sm">
              {isBuyout ? (
                // Buyout counter: only money input
                <VStack spacing={3} align="stretch">
                  <Box p={3} bg="blue.50" borderRadius="md" borderWidth="1px" borderColor="blue.200">
                    <Text fontSize="xs" fontWeight="bold" color="blue.700" mb={2}>Original Offer</Text>
                    <Text fontSize="sm" fontWeight="bold" color="blue.900">
                      ₱{formatPHP(effectiveTrade?.offered_cash_amount || 0)}
                    </Text>
                  </Box>
                  <FormControl isRequired>
                    <FormLabel fontSize="xs" fontWeight="bold">Your Counter Price (PHP)</FormLabel>
                    <input 
                      type="number" 
                      value={cashDelta} 
                      onChange={e => setCashDelta(e.target.value)} 
                      min={0} 
                      step="100" 
                      placeholder="Enter your offer price"
                      style={{ width: '100%', padding: '8px', fontSize: '12px', border: '1px solid #E2E8F0', borderRadius: '4px' }} 
                    />
                  </FormControl>
                  <FormControl>
                    <FormLabel fontSize="xs">Message (optional)</FormLabel>
                    <Textarea 
                      value={counterMsg} 
                      onChange={e => setCounterMsg(e.target.value)} 
                      placeholder="Add a note..." 
                      size="sm" 
                      rows={2}
                    />
                  </FormControl>
                </VStack>
              ) : (
                // Regular trade counter: items + money
                <>
                  {selectedCounterIds.length > 0 && (
                    <Text fontSize="xs" color="brand.500" fontWeight="bold" mb={2}>
                      {selectedCounterIds.length} {requested?.max_items_per_offer ? `/ ${requested.max_items_per_offer}` : ''} items selected
                    </Text>
                  )}
                  <Grid templateColumns="repeat(auto-fill, minmax(70px, 1fr))" gap={1.5}>
                    {userInventory.map(p => (
                      <Box key={p.id} borderWidth={selectedCounterIds.includes(p.id) ? '2px' : '1px'} borderColor={selectedCounterIds.includes(p.id) ? 'brand.500' : 'gray.200'} rounded="md" overflow="hidden" onClick={() => toggleCounter(p.id)} cursor="pointer" bg={selectedCounterIds.includes(p.id) ? 'brand.50' : 'white'} h="100%">
                        <Box w="full" h="50px" bg="gray.50" display="flex" alignItems="center" justifyContent="center" overflow="hidden">
                          <Image src={getFirstImage(p.image_urls)} alt={p.title} w="100%" h="100%" objectFit="contain" loading="lazy" />
                        </Box>
                        <Box p={0.75}>
                          <Text fontSize="10px" noOfLines={1}>{p.title}</Text>
                        </Box>
                      </Box>
                    ))}
                  </Grid>
                  <VStack spacing={2} mt={4}>
                    <FormControl size="sm">
                      <FormLabel fontSize="xs">Add Cash</FormLabel>
                      <input type="number" value={cashDelta} onChange={e => setCashDelta(e.target.value)} min={0} step="100" style={{ width: '100%', padding: '6px', fontSize: '12px', border: '1px solid #E2E8F0', borderRadius: '4px' }} />
                    </FormControl>
                    <FormControl size="sm">
                      <FormLabel fontSize="xs">Message</FormLabel>
                      <input value={counterMsg} onChange={e => setCounterMsg(e.target.value)} placeholder="Optional..." style={{ width: '100%', padding: '6px', fontSize: '12px', border: '1px solid #E2E8F0', borderRadius: '4px' }} />
                    </FormControl>
                  </VStack>
                </>
              )}
            </ModalBody>
            <ModalFooter>
              <Button size="sm" variant="ghost" mr={2} onClick={() => setCounterOpen(false)} isDisabled={isCountering}>Cancel</Button>
              <Button size="sm" colorScheme="brand" onClick={submitCounter} isLoading={isCountering}>Send</Button>
            </ModalFooter>
          </ModalContent>
        </Modal>

        {/* Decline Dialog */}
        <AlertDialog isOpen={isDeclineOpen} leastDestructiveRef={cancelRef} onClose={onDeclineClose} isCentered>
          <AlertDialogOverlay>
            <AlertDialogContent>
              <AlertDialogHeader fontSize="sm">Decline Offer?</AlertDialogHeader>
              <AlertDialogBody fontSize="xs">
                You can send a counter offer instead to negotiate.
              </AlertDialogBody>
              <AlertDialogFooter>
                <Button ref={cancelRef} size="sm" onClick={onDeclineClose} isDisabled={isDeclining}>Cancel</Button>
                <Button size="sm" colorScheme="red" onClick={confirmDecline} ml={2} isLoading={isDeclining}>Decline</Button>
                <Button size="sm" colorScheme="brand" variant="outline" onClick={openCounter} ml={2} isDisabled={isDeclining}>Counter</Button>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialogOverlay>
        </AlertDialog>

        {/* Option Change Modal */}
        <Modal isOpen={showOptionChangeModal} onClose={() => setShowOptionChangeModal(false)} size="sm" isCentered>
          <ModalOverlay />
          <ModalContent>
            <ModalHeader fontSize="sm">Trade Method</ModalHeader>
            <ModalCloseButton size="sm" />
            <ModalBody fontSize="sm">
              <Grid templateColumns="repeat(2, 1fr)" gap={2} mb={4}>
                <Card variant="outline" cursor="pointer" borderWidth={requestedOption === 'meetup' ? '2px' : '1px'} borderColor={requestedOption === 'meetup' ? 'brand.500' : 'gray.200'} bg={requestedOption === 'meetup' ? 'brand.50' : 'white'} onClick={() => setRequestedOption('meetup')}>
                  <CardBody p={2}>
                    <VStack spacing={1} align="center">
                      <Icon as={FaMapMarkerAlt} boxSize={4} color={requestedOption === 'meetup' ? 'brand.600' : 'gray.400'} />
                      <Text fontSize="xs" fontWeight="semibold">Meetup</Text>
                    </VStack>
                  </CardBody>
                </Card>
                <Card variant="outline" cursor="pointer" borderWidth={requestedOption === 'delivery' ? '2px' : '1px'} borderColor={requestedOption === 'delivery' ? 'brand.500' : 'gray.200'} bg={requestedOption === 'delivery' ? 'brand.50' : 'white'} onClick={() => setRequestedOption('delivery')}>
                  <CardBody p={2}>
                    <VStack spacing={1} align="center">
                      <Icon as={FaTruck} boxSize={4} color={requestedOption === 'delivery' ? 'brand.600' : 'gray.400'} />
                      <Text fontSize="xs" fontWeight="semibold">Delivery</Text>
                    </VStack>
                  </CardBody>
                </Card>
              </Grid>
              {requestedOption === 'delivery' && (
                <FormControl isRequired mb={3}>
                  <FormLabel fontSize="xs">Address</FormLabel>
                  <Textarea placeholder="Your address..." value={requestedDeliveryAddress} onChange={(e) => setRequestedDeliveryAddress(e.target.value)} rows={2} size="sm" />
                </FormControl>
              )}
            </ModalBody>
            <ModalFooter>
              <Button size="sm" variant="ghost" mr={2} onClick={() => setShowOptionChangeModal(false)}>Cancel</Button>
              <Button size="sm" colorScheme="brand" onClick={requestOptionChange} isLoading={requestingOptionChange} isDisabled={!requestedOption || (requestedOption === 'delivery' && !requestedDeliveryAddress.trim())}>Request</Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      </ModalContent>
    </Modal>
  )
}

export default OfferDetailsModal
