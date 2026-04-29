import React, { useEffect, useMemo, useState } from 'react'
import {
  Modal, ModalOverlay, ModalContent, ModalHeader, ModalBody, ModalCloseButton,
  VStack, Box, Image, Text, FormControl, FormLabel, Input, HStack, Button,
  useToast, Badge, Card, CardBody, Icon, useColorModeValue, Textarea, Grid,
  Link, Progress, useBreakpointValue, Spinner, Flex,
} from '@chakra-ui/react'
import { AnimatePresence, motion, useDragControls, useReducedMotion, type PanInfo } from 'framer-motion'
import {
  FaMapMarkerAlt, FaTruck, FaCreditCard, FaUsers, FaMotorcycle, FaRocket,
  FaTag, FaCheckCircle, FaPlus,
} from 'react-icons/fa'
import { useAuth } from '../contexts/AuthContext'
import { useNotification } from '../contexts/NotificationContext'
import { api } from '../services/api'
import { CollectionSetup, Product, TradeCreate, TradeOption } from '../types'
import { getFirstImage } from '../utils/imageUtils'
import { reverseGeocodeToAddress, formatCoordinates } from '../utils/locationUtils'
import { getProductRawLocation } from '../utils/productLocation'
import { motionDurations, motionEasings } from '../utils/motion'

interface BuyoutModalProps {
  isOpen: boolean
  onClose: () => void
  targetProductId: number | null
}

const mobileSteps = ['Your Offer', 'How to Get It']

const BuyoutModal: React.FC<BuyoutModalProps> = ({ isOpen, onClose, targetProductId }) => {
  const { user, refreshUser } = useAuth()
  const toast = useToast()
  const { showNotification } = useNotification()
  const [targetProduct, setTargetProduct] = useState<Product | null>(null)

  const [tradeMessage, setTradeMessage] = useState('')
  const [submittingTrade, setSubmittingTrade] = useState(false)
  const [cashAmount, setCashAmount] = useState<string>('')
  const [tradeOption, setTradeOption] = useState<TradeOption | null>(null)

  // Multi-product selection
  const [additionalProductIds, setAdditionalProductIds] = useState<number[]>([])
  const [sellerProducts, setSellerProducts] = useState<Product[]>([])
  const [loadingSellerProducts, setLoadingSellerProducts] = useState(false)

  const [detectingLocation, setDetectingLocation] = useState(false)
  const [detectedCoords, setDetectedCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [detectedLocationLabel, setDetectedLocationLabel] = useState('')
  const [profileLocationLabel, setProfileLocationLabel] = useState('')
  const [customLocationLabel, setCustomLocationLabel] = useState('')
  const [deliveryType, setDeliveryType] = useState<'standard' | 'express'>('standard')
  const [deliveryInstructions, setDeliveryInstructions] = useState('')
  const [collectionMethod, setCollectionMethod] = useState<'pickup' | 'meetup' | null>(null)
  const [meetupLocation, setMeetupLocation] = useState('')
  const [meetupDate, setMeetupDate] = useState('')
  const [meetupTime, setMeetupTime] = useState('')
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null)
  const [mobileStep, setMobileStep] = useState(0)

  const isMobile = useBreakpointValue({ base: true, md: false }) ?? false
  const prefersReducedMotion = useReducedMotion()
  const sheetDragControls = useDragControls()

  const distance = targetProduct?.distanceKm || 10.0
  const standardFee = Math.round(35 + (distance > 5 ? (distance - 5) * 3 : 0))
  const expressFee = Math.round(80 + (distance > 5 ? (distance - 5) * 5 : 0))

  const cardBg = useColorModeValue('white', 'gray.800')
  const borderColor = useColorModeValue('gray.200', 'gray.700')
  const pageBg = useColorModeValue('gray.50', 'gray.900')
  const selectedBg = '#E1F5EE'
  const selectedBorder = '#1D9E75'
  const selectedTextColor = '#1D9E75'
  const mutedTextColor = useColorModeValue('gray.500', 'gray.400')
  const subtleBg = useColorModeValue('gray.50', 'gray.800')

  const collectionSetup = useMemo<CollectionSetup>(() => {
    const raw = (targetProduct as any)?.collection_setup
    const fallback: CollectionSetup = {
      methods: ['pickup', 'meetup'],
      pickup: { days: [], time_start: '', time_end: '' },
      meetup: { locations: [], days: [], time_start: '', time_end: '' },
    }
    if (!raw) return fallback
    try {
      return typeof raw === 'string' ? JSON.parse(raw) : raw
    } catch {
      return fallback
    }
  }, [targetProduct])

  const enabledCollectionMethods = collectionSetup.methods?.length ? collectionSetup.methods : ['pickup', 'meetup']
  const pickupEnabled = enabledCollectionMethods.includes('pickup')
  const meetupEnabled = enabledCollectionMethods.includes('meetup')
  const productPickupLocation = getProductRawLocation(targetProduct)
  const preferredMeetupLocations = (collectionSetup.meetup?.locations || []).map(location => location.trim()).filter(Boolean)
  const sellerAvailabilityType = (targetProduct as any)?.availability_type as 'flexible' | 'strict' | undefined
  const sellerAvailabilitySlots = useMemo(() => {
    const raw = (targetProduct as any)?.availability_slots
    if (!raw) return []
    try {
      const slots = typeof raw === 'string' ? JSON.parse(raw) : raw
      const today = new Date().toISOString().split('T')[0]
      return Array.isArray(slots) ? slots.filter(slot => slot.date >= today) : []
    } catch {
      return []
    }
  }, [targetProduct])
  const currentAvailabilitySlots = sellerAvailabilitySlots.filter(slot => !slot.method || !collectionMethod || slot.method === collectionMethod)
  const strictSlotSatisfied = sellerAvailabilityType !== 'strict' || currentAvailabilitySlots.length === 0 || !!selectedSlotId

  const getProductCoords = (p: Partial<Product> | null): { lat: number; lng: number } | null => {
    if (!p) return null
    const lat = (p as any).pickup_latitude ?? (p as any).latitude
    const lng = (p as any).pickup_longitude ?? (p as any).longitude
    return lat != null && lng != null ? { lat: Number(lat), lng: Number(lng) } : null
  }

  const resolvedCollectionLocation = () => {
    if (collectionMethod === 'pickup') return productPickupLocation || ''
    return meetupLocation.trim()
  }

  const resolvedCollectionCoords = () => {
    if (collectionMethod === 'pickup') return getProductCoords(targetProduct)
    return null
  }

  const handleSheetDragEnd = (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    if (!isMobile) return
    if (info.offset.y > 80 || info.velocity.y > 500) onClose()
  }

  const mobileSheetMotionProps = isMobile ? ({
    as: motion.div,
    initial: { y: '100%', opacity: 1 },
    animate: { y: 0, opacity: 1 },
    exit: { y: '100%', opacity: 1 },
    transition: { duration: motionDurations.page, ease: motionEasings.easeOut },
    drag: 'y',
    dragControls: sheetDragControls,
    dragListener: false,
    dragConstraints: { top: 0 },
    dragElastic: { top: 0, bottom: 0.25 },
    onDragEnd: handleSheetDragEnd,
  } as any) : {}

  // Fetch target product
  useEffect(() => {
    if (!isOpen || !targetProductId) { setTargetProduct(null); return }
    ;(async () => {
      try {
        const res = await api.get(`/api/products/${targetProductId}`)
        const product = res.data?.data?.product || res.data?.data
        setTargetProduct(product)
        if (product?.price) setCashAmount(product.price.toString())
      } catch { setTargetProduct(null) }
    })()
  }, [isOpen, targetProductId])

  // Fetch seller's other available products
  useEffect(() => {
    if (!isOpen || !targetProduct?.seller_id) { setSellerProducts([]); return }
    setLoadingSellerProducts(true)
    ;(async () => {
      try {
        const res = await api.get(`/api/products/user/${targetProduct.seller_id}?page=1&limit=100`)
        const list: Product[] = Array.isArray(res.data?.data?.data) ? res.data.data.data : []
        const hidden = new Set(['traded', 'sold', 'suspended', 'deleted', 'locked'])
        setSellerProducts(list.filter(p => p.id !== targetProductId && !hidden.has(p.status)))
      } catch { setSellerProducts([]) }
      finally { setLoadingSellerProducts(false) }
    })()
  }, [isOpen, targetProduct?.seller_id, targetProductId])

  // Reset on open
  useEffect(() => {
    if (!isOpen) return
    setTradeMessage('')
    setCashAmount(targetProduct?.price ? targetProduct.price.toString() : '')
    setTradeOption(null)
    setAdditionalProductIds([])
    setDetectedCoords(null)
    setDetectedLocationLabel('')
    setProfileLocationLabel('')
    setCustomLocationLabel('')
    setDeliveryType('standard')
    setDeliveryInstructions('')
    setCollectionMethod(null)
    setMeetupLocation('')
    setMeetupDate('')
    setMeetupTime('')
    setSelectedSlotId(null)
    setMobileStep(0)
    if (user?.latitude && user?.longitude) setTradeOption('delivery')
  }, [isOpen, targetProduct])

  useEffect(() => {
    if (!isOpen || !targetProduct) return
    const defaultMethod = pickupEnabled && productPickupLocation ? 'pickup' : (meetupEnabled ? 'meetup' : null)
    setCollectionMethod(defaultMethod)
    setMeetupLocation(defaultMethod === 'meetup' ? (preferredMeetupLocations[0] || '') : '')
  }, [isOpen, targetProduct, pickupEnabled, meetupEnabled, productPickupLocation, preferredMeetupLocations.join('|')])

  // Resolve profile location label
  useEffect(() => {
    if (!isOpen || !user?.latitude || !user?.longitude) return
    let cancelled = false
    ;(async () => {
      const address = await reverseGeocodeToAddress(user.latitude as number, user.longitude as number)
      if (!cancelled) setProfileLocationLabel(address)
    })()
    return () => { cancelled = true }
  }, [isOpen, user?.latitude, user?.longitude])

  const toggleAdditionalProduct = (id: number) => {
    setAdditionalProductIds(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    )
  }

  const resolvedDeliveryAddress = (): string | undefined => {
    if (customLocationLabel.trim()) return customLocationLabel.trim()
    if (detectedLocationLabel.trim()) return detectedLocationLabel.trim()
    if (detectedCoords) return formatCoordinates(detectedCoords.lat, detectedCoords.lng)
    if (profileLocationLabel.trim()) return profileLocationLabel.trim()
    if (user?.latitude && user?.longitude) return formatCoordinates(user.latitude, user.longitude)
    return undefined
  }

  const submitTrade = async () => {
    if (!targetProductId) return
    if (!cashAmount || Number(cashAmount) <= 0) {
      toast({ id: 'buyout-amount', title: 'Enter an offer amount', description: 'Please enter a cash amount greater than ₱0.', status: 'warning' })
      return
    }
    if (!tradeOption) {
      toast({ id: 'buyout-option', title: 'Select how to get it', description: 'Choose Meetup or Delivery.', status: 'warning' })
      return
    }
    if (tradeOption === 'delivery' && !resolvedDeliveryAddress()) {
      toast({ id: 'buyout-location', title: 'Delivery location required', description: 'Please detect or enter your delivery location.', status: 'warning' })
      return
    }
    const collectionLocation = resolvedCollectionLocation()
    if (!collectionMethod || !collectionLocation || !meetupDate || !meetupTime || !strictSlotSatisfied) {
      toast({
        id: 'buyout-collection',
        title: 'Collection details required',
        description: 'Choose where and when the seller can hand over the item.',
        status: 'warning',
      })
      return
    }
    try {
      setSubmittingTrade(true)
      const collectionCoords = resolvedCollectionCoords()
      const payload: TradeCreate = {
        target_product_id: targetProductId,
        offered_product_ids: [],
        message: tradeMessage,
        offered_cash_amount: Number(cashAmount),
        trade_option: tradeOption,
        meeting_type: collectionMethod,
        delivery_address: tradeOption === 'delivery' ? resolvedDeliveryAddress() : undefined,
        payment_method: tradeOption === 'meetup' ? 'upfront' : 'cod',
        meetup_location: collectionLocation,
        meetup_label: collectionLocation,
        meetup_date: meetupDate,
        meetup_time: meetupTime,
        ...(collectionCoords && { meetup_lat: collectionCoords.lat, meetup_lng: collectionCoords.lng }),
        ...(selectedSlotId && { selected_availability_slot_id: selectedSlotId }),
        ...(additionalProductIds.length > 0 && { additional_target_product_ids: additionalProductIds }),
        ...(tradeOption === 'delivery' && { delivery_type: deliveryType, delivery_instructions: deliveryInstructions }),
      } as TradeCreate & { delivery_type: string; delivery_instructions: string }
      await api.post('/api/trades', payload)
      showNotification('Buyout Offer Sent', 'success')
      setTradeMessage('')
      setCashAmount('')
      setTradeOption(null)
      setAdditionalProductIds([])
      onClose()
    } catch (e: any) {
      toast({ id: 'buyout-failed', title: "Couldn't send offer", description: e?.response?.data?.error || 'Something went wrong.', status: 'error' })
    } finally {
      setSubmittingTrade(false)
    }
  }

  const handleDetectLocation = async () => {
    if (!navigator.geolocation) {
      toast({ id: 'buyout-geo', title: 'Geolocation not supported', status: 'error', duration: 3000 })
      return
    }
    if (tradeOption !== 'delivery') setTradeOption('delivery')
    setDetectingLocation(true)
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords
        const address = await reverseGeocodeToAddress(latitude, longitude)
        setDetectedCoords({ lat: latitude, lng: longitude })
        setDetectedLocationLabel(address)
        try {
          await api.put('/api/users/profile', { latitude, longitude })
          if (refreshUser) await refreshUser()
          toast({ id: 'buyout-loc-saved', title: 'Location saved!', description: address, status: 'success', duration: 3000 })
        } catch {
          toast({ id: 'buyout-loc-detected', title: 'Detected for this offer only', description: address, status: 'warning', duration: 3500 })
        }
        setDetectingLocation(false)
      },
      () => {
        toast({ id: 'buyout-loc-denied', title: 'Location access denied', status: 'warning', duration: 4000 })
        setDetectingLocation(false)
      },
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  const totalItems = 1 + additionalProductIds.length
  const canGoNext = mobileStep === 0 ? (!!cashAmount && Number(cashAmount) > 0) : true
  const canSubmit =
    !!cashAmount && Number(cashAmount) > 0 &&
    !!tradeOption &&
    (tradeOption !== 'delivery' || !!resolvedDeliveryAddress()) &&
    !!collectionMethod &&
    !!resolvedCollectionLocation() &&
    !!meetupDate &&
    !!meetupTime &&
    strictSlotSatisfied

  // ─── Section: Offer Details ───────────────────────────────────────────────
  const offerSection = (
    <VStack spacing={5} align="stretch">
      {/* Primary product */}
      {targetProduct && (
        <Box borderRadius="16px" overflow="hidden" border="1.5px solid" borderColor={useColorModeValue('green.200', 'green.700')} bg={useColorModeValue('green.50', 'green.900')}>
          <HStack spacing={0} align="stretch">
            <Box flexShrink={0} w="88px" h="88px">
              <Image src={getFirstImage(targetProduct.image_urls)} alt={targetProduct.title} w="full" h="full" objectFit="cover" />
            </Box>
            <VStack spacing={1} align="start" flex={1} p={3} justify="center">
              <HStack spacing={1}>
                <Icon as={FaTag} boxSize={2.5} color={selectedTextColor} />
                <Text fontSize="9px" fontWeight="800" color={selectedTextColor} textTransform="uppercase" letterSpacing="0.8px">
                  Buying Out
                </Text>
              </HStack>
              <Text fontWeight="700" fontSize="13px" noOfLines={2} lineHeight="1.3">{targetProduct.title}</Text>
              {targetProduct.price && (
                <Badge colorScheme="green" fontSize="11px" px={2} py={0.5} borderRadius="full">
                  Listed at ₱{targetProduct.price.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                </Badge>
              )}
            </VStack>
          </HStack>
        </Box>
      )}

      {/* Additional products from the same seller */}
      {targetProduct && (
        <Box>
          <HStack justify="space-between" mb={2.5}>
            <VStack spacing={0} align="start">
              <Text fontSize="11px" fontWeight="700" textTransform="uppercase" color={mutedTextColor} letterSpacing="0.6px">
                Add More from This Seller
              </Text>
              <Text fontSize="10px" color={mutedTextColor}>Bundle multiple items into one offer</Text>
            </VStack>
            {additionalProductIds.length > 0 && (
              <Badge colorScheme="green" fontSize="10px" px={2} py={0.5} borderRadius="full">
                +{additionalProductIds.length} added
              </Badge>
            )}
          </HStack>

          {loadingSellerProducts ? (
            <Flex justify="center" py={4}>
              <Spinner size="sm" color={selectedBorder} />
            </Flex>
          ) : sellerProducts.length === 0 ? (
            <Box p={3} borderRadius="10px" bg={subtleBg} border="1px dashed" borderColor={borderColor}>
              <Text fontSize="11px" color={mutedTextColor} textAlign="center">
                No other available items from this seller
              </Text>
            </Box>
          ) : (
            <Grid templateColumns="repeat(4, 1fr)" gap={1.5}>
              {sellerProducts.map(p => {
                const isSelected = additionalProductIds.includes(p.id)
                return (
                  <Box
                    key={p.id}
                    borderRadius="10px"
                    overflow="hidden"
                    border="2px solid"
                    borderColor={isSelected ? selectedBorder : borderColor}
                    bg={isSelected ? selectedBg : cardBg}
                    cursor="pointer"
                    transition="all 0.15s"
                    onClick={() => toggleAdditionalProduct(p.id)}
                    position="relative"
                    _hover={{ borderColor: selectedBorder, shadow: 'sm' }}
                  >
                    <Box position="relative">
                      <Image
                        src={getFirstImage(p.image_urls)}
                        alt={p.title}
                        w="full"
                        h="56px"
                        objectFit="cover"
                      />
                      <Box position="absolute" top={0.5} right={0.5} bg={isSelected ? selectedBorder : 'blackAlpha.500'} borderRadius="full" p="2px">
                        <Icon as={isSelected ? FaCheckCircle : FaPlus} boxSize={2.5} color="white" />
                      </Box>
                    </Box>
                    <VStack spacing={0} align="start" p={1}>
                      <Text fontSize="9px" fontWeight="600" noOfLines={2} lineHeight="1.3" color={isSelected ? selectedTextColor : 'inherit'}>
                        {p.title}
                      </Text>
                      {p.price && (
                        <Text fontSize="8px" fontWeight="700" color={isSelected ? selectedTextColor : mutedTextColor}>
                          ₱{p.price.toLocaleString('en-PH')}
                        </Text>
                      )}
                    </VStack>
                  </Box>
                )
              })}
            </Grid>
          )}
        </Box>
      )}

      {/* Summary chip when items added */}
      {additionalProductIds.length > 0 && (
        <Box p={3} borderRadius="10px" bg={selectedBg} border="1.5px solid" borderColor={selectedBorder}>
          <HStack justify="space-between">
            <Text fontSize="12px" fontWeight="700" color={selectedTextColor}>
              {totalItems} item{totalItems > 1 ? 's' : ''} in this buyout
            </Text>
            <Link fontSize="11px" fontWeight="600" color={selectedTextColor} onClick={() => setAdditionalProductIds([])} _hover={{ textDecoration: 'underline' }}>
              Clear extras
            </Link>
          </HStack>
        </Box>
      )}

      {/* Cash offer */}
      <FormControl isRequired>
        <FormLabel fontSize="11px" fontWeight="700" textTransform="uppercase" color={mutedTextColor} letterSpacing="0.6px" mb={2}>
          Your Cash Offer {totalItems > 1 ? `(for all ${totalItems} items)` : ''}
        </FormLabel>
        <HStack spacing={0} border="2px solid" borderColor={cashAmount && Number(cashAmount) > 0 ? selectedBorder : borderColor} borderRadius="12px" overflow="hidden" transition="border-color 0.2s" bg={cardBg}>
          <Box px={4} py={3} bg={cashAmount && Number(cashAmount) > 0 ? selectedBg : subtleBg} borderRight="1px solid" borderColor={borderColor}>
            <Text fontWeight="800" fontSize="16px" color={cashAmount && Number(cashAmount) > 0 ? selectedTextColor : mutedTextColor}>₱</Text>
          </Box>
          <Input
            type="number"
            placeholder="0.00"
            value={cashAmount}
            onChange={(e) => setCashAmount(e.target.value)}
            min={1}
            step="0.01"
            fontSize="20px"
            fontWeight="700"
            border="none"
            _focus={{ boxShadow: 'none' }}
            px={4}
            py={6}
            h="auto"
            color={cashAmount && Number(cashAmount) > 0 ? selectedTextColor : 'inherit'}
          />
        </HStack>
        {targetProduct?.price && cashAmount && Number(cashAmount) > 0 && (
          <Text fontSize="10px" color={Number(cashAmount) >= targetProduct.price ? selectedTextColor : 'orange.500'} mt={1.5} fontWeight="600">
            {Number(cashAmount) >= targetProduct.price
              ? `✓ At or above listed price`
              : `${((Number(cashAmount) / targetProduct.price) * 100).toFixed(0)}% of primary item's listed price`}
          </Text>
        )}
      </FormControl>

      {/* Message */}
      <FormControl>
        <FormLabel fontSize="11px" fontWeight="700" textTransform="uppercase" color={mutedTextColor} letterSpacing="0.6px" mb={2}>
          Message to Seller <Text as="span" fontWeight="400" textTransform="none" letterSpacing="0">(optional)</Text>
        </FormLabel>
        <Textarea
          placeholder="Tell the seller why they should accept your offer..."
          value={tradeMessage}
          onChange={(e) => setTradeMessage(e.target.value)}
          rows={2}
          fontSize="13px"
          borderRadius="12px"
          resize="none"
          _focus={{ borderColor: selectedBorder, boxShadow: `0 0 0 1px ${selectedBorder}` }}
        />
      </FormControl>
    </VStack>
  )

  // ─── Section: Fulfillment ─────────────────────────────────────────────────
  const fulfillmentSection = (
    <VStack spacing={5} align="stretch">
      <FormControl isRequired>
        <FormLabel fontSize="11px" fontWeight="700" textTransform="uppercase" color={mutedTextColor} letterSpacing="0.6px" mb={3}>
          How would you like to get it?
        </FormLabel>
        <Grid templateColumns="repeat(2, 1fr)" gap={3}>
          {/* Meetup */}
          <Card variant="outline" cursor="pointer" borderWidth={tradeOption === 'meetup' ? '2px' : '1px'} borderColor={tradeOption === 'meetup' ? selectedBorder : borderColor} bg={tradeOption === 'meetup' ? selectedBg : cardBg} onClick={() => setTradeOption('meetup')} transition="all 0.18s" borderRadius="14px" _hover={{ shadow: 'md', borderColor: selectedBorder }}>
            <CardBody p={4}>
              <VStack spacing={3} align="center">
                <Box p={2.5} borderRadius="12px" bg={tradeOption === 'meetup' ? selectedBorder : useColorModeValue('gray.100', 'gray.700')} color={tradeOption === 'meetup' ? 'white' : mutedTextColor} transition="all 0.18s">
                  <Icon as={FaUsers} boxSize={5} />
                </Box>
                <VStack spacing={1} align="center">
                  <Text fontWeight="700" fontSize="13px" color={tradeOption === 'meetup' ? selectedTextColor : 'inherit'}>Meetup</Text>
                  <Text fontSize="10px" color={tradeOption === 'meetup' ? selectedTextColor : mutedTextColor} textAlign="center" lineHeight="1.4">Meet in person, pay cash on the spot</Text>
                </VStack>
                {tradeOption === 'meetup' && <Badge colorScheme="green" fontSize="9px" borderRadius="full">Cash upfront</Badge>}
              </VStack>
            </CardBody>
          </Card>

          {/* Delivery */}
          <Card variant="outline" cursor="pointer" borderWidth={tradeOption === 'delivery' ? '2px' : '1px'} borderColor={tradeOption === 'delivery' ? selectedBorder : borderColor} bg={tradeOption === 'delivery' ? selectedBg : cardBg} onClick={() => setTradeOption('delivery')} transition="all 0.18s" borderRadius="14px" _hover={{ shadow: 'md', borderColor: selectedBorder }}>
            <CardBody p={4}>
              <VStack spacing={3} align="center">
                <Box p={2.5} borderRadius="12px" bg={tradeOption === 'delivery' ? selectedBorder : useColorModeValue('gray.100', 'gray.700')} color={tradeOption === 'delivery' ? 'white' : mutedTextColor} transition="all 0.18s">
                  <Icon as={FaTruck} boxSize={5} />
                </Box>
                <VStack spacing={1} align="center">
                  <Text fontWeight="700" fontSize="13px" color={tradeOption === 'delivery' ? selectedTextColor : 'inherit'}>Delivery</Text>
                  <Text fontSize="10px" color={tradeOption === 'delivery' ? selectedTextColor : mutedTextColor} textAlign="center" lineHeight="1.4">Rider picks up & delivers to you</Text>
                </VStack>
                {tradeOption === 'delivery' && <Badge colorScheme="green" fontSize="9px" borderRadius="full">Cash on delivery</Badge>}
              </VStack>
            </CardBody>
          </Card>
        </Grid>
      </FormControl>

      <FormControl isRequired>
        <FormLabel fontSize="11px" fontWeight="700" textTransform="uppercase" color={mutedTextColor} letterSpacing="0.6px" mb={2}>
          Seller handoff
        </FormLabel>
        <VStack spacing={3} align="stretch">
          <HStack spacing={2}>
            <Button
              flex={1}
              size="sm"
              minH="40px"
              variant={collectionMethod === 'pickup' ? 'solid' : 'outline'}
              bg={collectionMethod === 'pickup' ? selectedBorder : 'transparent'}
              color={collectionMethod === 'pickup' ? 'white' : 'inherit'}
              borderColor={collectionMethod === 'pickup' ? selectedBorder : borderColor}
              onClick={() => setCollectionMethod('pickup')}
              isDisabled={!pickupEnabled || !productPickupLocation}
              fontSize="12px"
              _hover={{ bg: collectionMethod === 'pickup' ? '#158A63' : undefined }}
            >
              Pickup
            </Button>
            <Button
              flex={1}
              size="sm"
              minH="40px"
              variant={collectionMethod === 'meetup' ? 'solid' : 'outline'}
              bg={collectionMethod === 'meetup' ? selectedBorder : 'transparent'}
              color={collectionMethod === 'meetup' ? 'white' : 'inherit'}
              borderColor={collectionMethod === 'meetup' ? selectedBorder : borderColor}
              onClick={() => {
                setCollectionMethod('meetup')
                if (!meetupLocation.trim()) setMeetupLocation(preferredMeetupLocations[0] || '')
              }}
              isDisabled={!meetupEnabled}
              fontSize="12px"
              _hover={{ bg: collectionMethod === 'meetup' ? '#158A63' : undefined }}
            >
              Meetup
            </Button>
          </HStack>

          {collectionMethod === 'pickup' && (
            <Box p={3} borderRadius="10px" bg={subtleBg} border="1px solid" borderColor={borderColor}>
              <Text fontSize="10px" fontWeight="700" color={mutedTextColor} textTransform="uppercase" mb={1}>Pickup from seller</Text>
              <Text fontSize="12px" fontWeight="600" noOfLines={2}>{productPickupLocation}</Text>
            </Box>
          )}

          {collectionMethod === 'meetup' && (
            <VStack spacing={2} align="stretch">
              {preferredMeetupLocations.length > 0 && (
                <HStack spacing={2} flexWrap="wrap">
                  {preferredMeetupLocations.map(location => (
                    <Button
                      key={location}
                      size="xs"
                      variant={meetupLocation === location ? 'solid' : 'outline'}
                      colorScheme={meetupLocation === location ? 'green' : 'gray'}
                      onClick={() => setMeetupLocation(location)}
                      borderRadius="full"
                      fontSize="10px"
                    >
                      {location}
                    </Button>
                  ))}
                </HStack>
              )}
              <Input
                value={meetupLocation}
                onChange={(e) => setMeetupLocation(e.target.value)}
                placeholder="Meetup location"
                fontSize="13px"
                borderRadius="12px"
                _focus={{ borderColor: selectedBorder, boxShadow: `0 0 0 1px ${selectedBorder}` }}
              />
            </VStack>
          )}

          {currentAvailabilitySlots.length > 0 && (
            <Grid templateColumns="repeat(2, 1fr)" gap={2}>
              {currentAvailabilitySlots.slice(0, 4).map(slot => {
                const isSelected = selectedSlotId === slot.id
                return (
                  <Button
                    key={slot.id}
                    size="xs"
                    h="auto"
                    py={2}
                    whiteSpace="normal"
                    variant={isSelected ? 'solid' : 'outline'}
                    colorScheme={isSelected ? 'green' : 'gray'}
                    onClick={() => {
                      setSelectedSlotId(slot.id)
                      setMeetupDate(slot.date)
                      setMeetupTime(slot.start_time)
                    }}
                    fontSize="10px"
                  >
                    {slot.date} {slot.start_time}
                  </Button>
                )
              })}
            </Grid>
          )}

          <Grid templateColumns="repeat(2, 1fr)" gap={3}>
            <Input
              type="date"
              value={meetupDate}
              min={new Date().toISOString().split('T')[0]}
              onChange={(e) => {
                setMeetupDate(e.target.value)
                setSelectedSlotId(null)
              }}
              fontSize="13px"
              borderRadius="12px"
              _focus={{ borderColor: selectedBorder, boxShadow: `0 0 0 1px ${selectedBorder}` }}
            />
            <Input
              type="time"
              value={meetupTime}
              onChange={(e) => {
                setMeetupTime(e.target.value)
                setSelectedSlotId(null)
              }}
              fontSize="13px"
              borderRadius="12px"
              _focus={{ borderColor: selectedBorder, boxShadow: `0 0 0 1px ${selectedBorder}` }}
            />
          </Grid>

          {sellerAvailabilityType === 'strict' && currentAvailabilitySlots.length > 0 && !selectedSlotId && (
            <Text fontSize="10px" color="orange.500" fontWeight="600">
              This seller uses fixed slots. Pick one above.
            </Text>
          )}
        </VStack>
      </FormControl>

      {/* Delivery sub-options */}
      {tradeOption === 'delivery' && (
        <AnimatePresence>
          <motion.div
            initial={prefersReducedMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.2 }}
          >
            <VStack spacing={4} align="stretch">
              <Box>
                <Text fontSize="11px" fontWeight="700" color={mutedTextColor} mb={2.5} textTransform="uppercase" letterSpacing="0.6px">Delivery Speed</Text>
                <Grid templateColumns="repeat(2, 1fr)" gap={3}>
                  {([
                    { type: 'standard', label: 'Standard', fee: standardFee, icon: FaMotorcycle, hint: '1–2 days' },
                    { type: 'express', label: 'Express', fee: expressFee, icon: FaRocket, hint: 'Same day' },
                  ] as const).map(({ type, label, fee, icon, hint }) => (
                    <Card key={type} variant="outline" cursor="pointer" borderWidth={deliveryType === type ? '2px' : '1px'} borderColor={deliveryType === type ? selectedBorder : borderColor} bg={deliveryType === type ? selectedBg : cardBg} onClick={() => setDeliveryType(type)} transition="all 0.18s" borderRadius="14px" _hover={{ shadow: 'md', borderColor: selectedBorder }}>
                      <CardBody p={3}>
                        <VStack spacing={2} align="center">
                          <Box p={2} borderRadius="10px" bg={deliveryType === type ? selectedBorder : useColorModeValue('gray.100', 'gray.700')} color={deliveryType === type ? 'white' : mutedTextColor} transition="all 0.18s">
                            <Icon as={icon} boxSize={4} />
                          </Box>
                          <Text fontWeight="700" fontSize="12px" color={deliveryType === type ? selectedTextColor : 'inherit'}>{label}</Text>
                          <Text fontWeight="800" fontSize="13px" color={deliveryType === type ? selectedTextColor : mutedTextColor}>₱{fee}</Text>
                          <Text fontSize="9px" color={deliveryType === type ? selectedTextColor : mutedTextColor}>{hint}</Text>
                        </VStack>
                      </CardBody>
                    </Card>
                  ))}
                </Grid>
              </Box>

              <Box p={3.5} borderRadius="12px" border="1.5px solid" borderColor={resolvedDeliveryAddress() ? selectedBorder : borderColor} bg={resolvedDeliveryAddress() ? selectedBg : subtleBg} transition="all 0.2s">
                <HStack justify="space-between" align="start">
                  <HStack spacing={2.5} flex={1} minW={0}>
                    <Box p={1.5} borderRadius="8px" bg={resolvedDeliveryAddress() ? selectedBorder : useColorModeValue('gray.200', 'gray.600')} flexShrink={0}>
                      <Icon as={FaMapMarkerAlt} boxSize={3} color={resolvedDeliveryAddress() ? 'white' : mutedTextColor} />
                    </Box>
                    <VStack spacing={0} align="start" minW={0} flex={1}>
                      <Text fontSize="10px" fontWeight="700" color={mutedTextColor} textTransform="uppercase" letterSpacing="0.5px">Deliver to</Text>
                      <Text fontSize="12px" fontWeight="600" noOfLines={2} color={resolvedDeliveryAddress() ? 'inherit' : mutedTextColor}>
                        {resolvedDeliveryAddress() || 'No location set yet'}
                      </Text>
                    </VStack>
                  </HStack>
                  {(customLocationLabel || detectedCoords || profileLocationLabel) && (
                    <Link fontSize="10px" fontWeight="600" color={selectedBorder} onClick={() => { setDetectedCoords(null); setDetectedLocationLabel(''); setCustomLocationLabel('') }} flexShrink={0} _hover={{ textDecoration: 'underline' }}>
                      Clear
                    </Link>
                  )}
                </HStack>
              </Box>

              <Button size="md" variant="outline" w="full" borderRadius="12px" isLoading={detectingLocation} loadingText="Detecting..." onClick={handleDetectLocation} borderColor={selectedBorder} color={selectedTextColor} fontWeight="600" fontSize="13px" _hover={{ bg: selectedBg }}>
                📍 Use my current location
              </Button>

              <FormControl>
                <FormLabel fontSize="11px" fontWeight="700" color={mutedTextColor} mb={1.5} textTransform="uppercase" letterSpacing="0.6px">
                  Or enter a different address
                </FormLabel>
                <Input placeholder="e.g., sister's house, office, etc." value={customLocationLabel} onChange={(e) => setCustomLocationLabel(e.target.value)} fontSize="13px" borderRadius="12px" _focus={{ borderColor: selectedBorder, boxShadow: `0 0 0 1px ${selectedBorder}` }} />
              </FormControl>

              <FormControl>
                <FormLabel fontSize="11px" fontWeight="700" color={mutedTextColor} mb={1.5} textTransform="uppercase" letterSpacing="0.6px">
                  Rider Instructions <Text as="span" fontWeight="400" textTransform="none" letterSpacing="0">(optional)</Text>
                </FormLabel>
                <Textarea value={deliveryInstructions} onChange={(e) => setDeliveryInstructions(e.target.value.slice(0, 200))} placeholder="Gate code, landmark, call before arriving..." rows={2} fontSize="13px" borderRadius="12px" resize="none" _focus={{ borderColor: selectedBorder, boxShadow: `0 0 0 1px ${selectedBorder}` }} />
                <Text fontSize="10px" color={mutedTextColor} mt={1}>{deliveryInstructions.length}/200</Text>
              </FormControl>

              <Box p={3} borderRadius="10px" bg={useColorModeValue('blue.50', 'blue.900')} borderLeft="3px solid" borderLeftColor="blue.400">
                <Text fontSize="11px" color={useColorModeValue('blue.700', 'blue.200')} lineHeight="1.5">
                  The rider collects your payment + delivery fee first, pays the seller, then delivers the item{totalItems > 1 ? 's' : ''} to you.
                </Text>
              </Box>
            </VStack>
          </motion.div>
        </AnimatePresence>
      )}

      {tradeOption === 'meetup' && (
        <Box p={3} borderRadius="10px" bg={useColorModeValue('green.50', 'green.900')} borderLeft="3px solid" borderLeftColor={selectedBorder}>
          <Text fontSize="11px" color={useColorModeValue('green.700', 'green.200')} lineHeight="1.5">
            You and the seller agree on a meetup place. Bring exact cash — payment is upfront on the spot.
          </Text>
        </Box>
      )}
    </VStack>
  )

  // ─── Action buttons ───────────────────────────────────────────────────────
  const actionButtons = isMobile ? (
    <HStack spacing={3}>
      {mobileStep > 0 && (
        <Button variant="ghost" onClick={() => setMobileStep(s => s - 1)} flex={1} borderRadius="12px" fontSize="13px" fontWeight="600">
          Back
        </Button>
      )}
      {mobileStep < mobileSteps.length - 1 ? (
        <Button bg={selectedBorder} color="white" flex={2} borderRadius="12px" fontSize="13px" fontWeight="700" onClick={() => setMobileStep(s => s + 1)} isDisabled={!canGoNext} _hover={{ bg: '#158A63' }} _active={{ bg: '#0F5A42' }}>
          Next →
        </Button>
      ) : (
        <Button bg={selectedBorder} color="white" flex={2} borderRadius="12px" fontSize="13px" fontWeight="700" isLoading={submittingTrade} onClick={submitTrade} isDisabled={!canSubmit} leftIcon={<FaCreditCard />} _hover={{ bg: '#158A63' }} _active={{ bg: '#0F5A42' }}>
          Confirm Buyout{totalItems > 1 ? ` (${totalItems} items)` : ''}
        </Button>
      )}
    </HStack>
  ) : (
    <HStack justify="flex-end" spacing={3}>
      <Button variant="ghost" onClick={onClose} fontSize="13px" borderRadius="10px">Cancel</Button>
      <Button bg={selectedBorder} color="white" isLoading={submittingTrade} onClick={submitTrade} isDisabled={!canSubmit} leftIcon={<FaCreditCard />} fontSize="13px" fontWeight="700" borderRadius="10px" px={6} _hover={{ bg: '#158A63' }} _active={{ bg: '#0F5A42' }}>
        Confirm Buyout{totalItems > 1 ? ` (${totalItems} items)` : ''}
      </Button>
    </HStack>
  )

  return (
    <Modal isOpen={isOpen} onClose={onClose} isCentered={!isMobile} size={isMobile ? 'full' : 'lg'} scrollBehavior="inside" motionPreset={isMobile ? 'slideInBottom' : 'scale'}>
      <ModalOverlay backdropFilter="blur(2px)" />
      <ModalContent
        {...mobileSheetMotionProps}
        display="flex"
        flexDirection="column"
        w={{ base: '100vw', md: 'calc(100vw - 32px)' }}
        maxW={{ base: '100vw', md: '520px' }}
        h={{ base: '90vh', md: 'min(92vh, 720px)' }}
        maxH="92vh"
        my={{ base: 0, md: 4 }}
        mt={{ base: 'auto', md: 4 }}
        mb={{ base: 0, md: 4 }}
        borderTopRadius={{ base: '20px', md: '16px' }}
        borderBottomRadius={{ base: 0, md: '16px' }}
        overflow="hidden"
        bg={pageBg}
      >
        {isMobile && (
          <Box display="flex" justifyContent="center" pt={3} pb={1} flexShrink={0} cursor="grab" style={{ touchAction: 'none' }} onPointerDown={(e) => sheetDragControls.start(e)}>
            <Box w="44px" h="5px" bg="gray.300" borderRadius="full" />
          </Box>
        )}

        <ModalHeader flexShrink={0} fontSize="17px" fontWeight="700" pb={isMobile ? 1 : 2} pt={isMobile ? 2 : 5} px={{ base: 4, md: 6 }}>
          {user ? 'Make a Buyout Offer' : 'Sign in to Continue'}
        </ModalHeader>
        <ModalCloseButton top={isMobile ? 3 : 4} right={4} />

        <ModalBody p={0} flex="1" minH={0} overflow="hidden">
          {user ? (
            <VStack spacing={0} align="stretch" h="full" minH={0}>
              {isMobile && (
                <Box px={4} pb={3} flexShrink={0}>
                  <HStack justify="space-between" mb={2}>
                    {mobileSteps.map((label, i) => (
                      <Text key={label} fontSize="10px" fontWeight={mobileStep === i ? '800' : '600'} color={mobileStep === i ? selectedTextColor : mutedTextColor}>
                        {i + 1}. {label}
                      </Text>
                    ))}
                  </HStack>
                  <Progress value={((mobileStep + 1) / mobileSteps.length) * 100} size="xs" colorScheme="green" borderRadius="full" />
                </Box>
              )}

              <Box flex="1" minH={0} overflowY="auto" px={{ base: 4, md: 6 }} pt={2} pb={4}>
                {isMobile ? (
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.div
                      key={mobileStep}
                      initial={prefersReducedMotion ? false : { opacity: 0, x: 20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={prefersReducedMotion ? undefined : { opacity: 0, x: -20 }}
                      transition={{ duration: motionDurations.uiSlow, ease: motionEasings.easeOut }}
                      style={{ willChange: 'transform, opacity' }}
                    >
                      {mobileStep === 0 && offerSection}
                      {mobileStep === 1 && fulfillmentSection}
                    </motion.div>
                  </AnimatePresence>
                ) : (
                  <VStack spacing={6} align="stretch">
                    {offerSection}
                    <Box h="1px" bg={borderColor} />
                    {fulfillmentSection}
                  </VStack>
                )}
              </Box>
            </VStack>
          ) : (
            <VStack spacing={4} p={6}>
              <Text color={mutedTextColor} fontSize="13px">You need to be signed in to purchase items.</Text>
              <HStack spacing={3} w="full">
                <Button onClick={onClose} as="a" href="/login" colorScheme="brand" flex={1} borderRadius="10px">Sign In</Button>
                <Button onClick={onClose} as="a" href="/register" variant="outline" flex={1} borderRadius="10px">Sign Up</Button>
              </HStack>
            </VStack>
          )}
        </ModalBody>

        {user && (
          <Box flexShrink={0} bg={cardBg} borderTopWidth="1px" borderColor={borderColor} px={{ base: 4, md: 6 }} py={3.5} boxShadow={{ base: '0 -8px 20px rgba(0,0,0,0.08)', md: 'none' }}>
            {actionButtons}
          </Box>
        )}
      </ModalContent>
    </Modal>
  )
}

export default BuyoutModal
