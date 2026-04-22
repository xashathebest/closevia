import React, { useEffect, useState, useMemo } from 'react'
import { Modal, ModalOverlay, ModalContent, ModalHeader, ModalBody, ModalCloseButton, VStack, Grid, Box, Image, Text, FormControl, FormLabel, Input, HStack, Button, useToast, Badge, Card, CardBody, Icon, useColorModeValue, Textarea, Spinner, Flex, Link, Checkbox, Alert, AlertIcon, Switch } from '@chakra-ui/react'
import { FaMapMarkerAlt, FaTruck, FaLocationArrow, FaBoxOpen, FaHandshake, FaTimes } from 'react-icons/fa'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../contexts/AuthContext'
import { useNotification } from '../contexts/NotificationContext'
import { api } from '../services/api'
import { Product, Trade, TradeCreate, TradeOption } from '../types'
import { getFirstImage } from '../utils/imageUtils'
import { reverseGeocodeToAddress, formatCoordinates } from '../utils/locationUtils'
import { useInvalidateDashboard, DASHBOARD_QUERY_KEYS } from '../hooks/useDashboard'
import { updateTrade } from '../services/tradeService'

interface TradeModalProps {
  isOpen: boolean
  onClose: () => void
  targetProductId: number | null
  editTrade?: Trade | null
}

const TradeModal: React.FC<TradeModalProps> = ({ isOpen, onClose, targetProductId, editTrade = null }) => {
  const { user, refreshUser } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const { showNotification } = useNotification()
  const queryClient = useQueryClient()
  const { invalidateOffers, invalidateDashboard } = useInvalidateDashboard()
  const [userProducts, setUserProducts] = useState<Product[]>([])
  const [targetProduct, setTargetProduct] = useState<Product | null>(null)
  const [selectedOfferIds, setSelectedOfferIds] = useState<number[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [tradeMessage, setTradeMessage] = useState('')
  const [submittingTrade, setSubmittingTrade] = useState(false)
  const [cashAmount, setCashAmount] = useState<string>('')
  const [cashError, setCashError] = useState('')
  const [tradeOption, setTradeOption] = useState<TradeOption | 'pickup' | null>(null)
  const [pickupAcknowledged, setPickupAcknowledged] = useState(false)
  const [hasPendingOfferOnTarget, setHasPendingOfferOnTarget] = useState(false)
  const [committedProductIds, setCommittedProductIds] = useState<Set<number>>(new Set())
  const [loadingPendingCheck, setLoadingPendingCheck] = useState(false)
  const [detectingLocation, setDetectingLocation] = useState(false)
  const [multiTargetMode, setMultiTargetMode] = useState(false)
  const [additionalTargetIds, setAdditionalTargetIds] = useState<number[]>([])
  const [sellerProducts, setSellerProducts] = useState<Product[]>([])
  const [targetSearchTerm, setTargetSearchTerm] = useState('')
  const [loadingSellerProducts, setLoadingSellerProducts] = useState(false)
  // Delivery location state
  const [detectedCoords, setDetectedCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [detectedLocationLabel, setDetectedLocationLabel] = useState('')
  const [profileLocationLabel, setProfileLocationLabel] = useState('')
  const [manualAddress, setManualAddress] = useState('')
  const isEditMode = !!editTrade
  const cardBg = useColorModeValue('white', 'gray.800')
  const borderColor = useColorModeValue('gray.200', 'gray.700')
  const targetCardBg = useColorModeValue('blue.50', 'blue.900')
  const targetCardBorderColor = useColorModeValue('blue.200', 'blue.700')
  const targetLabelColor = useColorModeValue('blue.700', 'blue.200')
  const selectedBg = '#E1F5EE'
  const selectedBorder = '#1D9E75'
  const selectedTextColor = '#1D9E75'
  const mutedTextColor = useColorModeValue('gray.600', 'gray.400')

  const selectedProducts = useMemo(() => userProducts.filter(p => selectedOfferIds.includes(p.id)), [userProducts, selectedOfferIds])
  const visibleProducts = useMemo(() => {
    const hidden = new Set(['traded', 'sold', 'suspended', 'deleted'])
    return userProducts
      .filter(p => p.title.toLowerCase().includes(searchTerm) && !hidden.has(p.status))
      .sort((a, b) => {
        const aOff = a.status !== 'available' || committedProductIds.has(a.id)
        const bOff = b.status !== 'available' || committedProductIds.has(b.id)
        return aOff === bOff ? 0 : aOff ? 1 : -1
      })
  }, [userProducts, searchTerm, committedProductIds])
  const selectedOfferIdSet = useMemo(() => new Set(selectedOfferIds), [selectedOfferIds])
  const visibleSellerProducts = useMemo(() => {
    const hidden = new Set(['traded', 'sold', 'suspended', 'deleted'])
    return sellerProducts
      .filter(p => p.title.toLowerCase().includes(targetSearchTerm) && !hidden.has(p.status))
      .sort((a, b) => {
        const aOff = a.status !== 'available'
        const bOff = b.status !== 'available'
        return aOff === bOff ? 0 : aOff ? 1 : -1
      })
  }, [sellerProducts, targetSearchTerm])

  const hasFixedLocation = useMemo(() => {
    const locationType = targetProduct?.location_type
    if (locationType === 'current_location' || locationType === 'pickup_location') return true
    if ((targetProduct as any)?.pickup_address && (targetProduct as any).pickup_address.trim()) return true
    if (targetProduct?.location && targetProduct.location.trim()) return true
    return false
  }, [targetProduct])

  const isTargetLoading = !!targetProductId && !targetProduct

  // Fetch target product details
  useEffect(() => {
    if (!isOpen || !targetProductId) {
      setTargetProduct(null)
      return
    }
    ; (async () => {
      try {
        const res = await api.get(`/api/products/${targetProductId}`)
        const product = res.data?.data?.product || res.data?.data
        setTargetProduct(product)
      } catch (_) {
        setTargetProduct(null)
      }
    })()
  }, [isOpen, targetProductId])

  useEffect(() => {
    if (!isOpen) return
    const existingOfferIds = (editTrade?.items || [])
      .filter((item) => (item.offered_by || '').toLowerCase() === 'buyer')
      .map((item) => Number(item.product_id))
      .filter((id) => Number.isFinite(id) && id > 0)
    setSelectedOfferIds(existingOfferIds)
    setSearchTerm('')
    setTradeMessage(editTrade?.message || '')
    setCashAmount(editTrade?.offered_cash_amount ? String(editTrade.offered_cash_amount) : '')
    setCashError('')
    setTradeOption((editTrade?.meeting_type || editTrade?.trade_option || null) as TradeOption | 'pickup' | null)
    setPickupAcknowledged(Boolean(editTrade && editTrade.meeting_type === 'pickup'))
    setHasPendingOfferOnTarget(false)
    setDetectedCoords(null)
    setDetectedLocationLabel('')
    setProfileLocationLabel('')
    setManualAddress('')
    setDetectingLocation(false)
    setCommittedProductIds(new Set())
    setMultiTargetMode(false)
    setAdditionalTargetIds([])
    setSellerProducts([])
    setTargetSearchTerm('')
    if (user && targetProductId) {
      ; (async () => {
        try {
          setLoadingPendingCheck(true)
          const [tradeRes, productRes] = await Promise.all([
            api.get(`/api/trades?limit=1000`),
            api.get(`/api/products/user/${user.id}?page=1&limit=100`),
          ])

          const trades = Array.isArray(tradeRes.data?.data) ? tradeRes.data.data : []
          const activeStatuses = new Set(['pending', 'pending_multiway', 'accepted_by_one', 'countered', 'accepted', 'active', 'ongoing', 'awaiting_confirmation', 'multiway_active'])
          const hasPending = trades.some((trade: any) =>
            trade.buyer_id === user.id &&
            trade.target_product_id === targetProductId &&
            trade.id !== editTrade?.id &&
            activeStatuses.has(trade.status)
          )
          const committedIds = new Set<number>()
          trades.forEach((trade: any) => {
            if (trade.id === editTrade?.id || !activeStatuses.has(trade.status)) return
            const targetId = Number(trade.target_product_id)
            if (Number.isFinite(targetId) && targetId > 0) committedIds.add(targetId)
            ;(trade.items || []).forEach((item: any) => {
              const productId = Number(item.product_id)
              if (Number.isFinite(productId) && productId > 0) committedIds.add(productId)
            })
          })
          setHasPendingOfferOnTarget(hasPending)
          setCommittedProductIds(committedIds)

          const data = productRes.data?.data
          const list: Product[] = Array.isArray(data?.data) ? data.data : []
          setUserProducts(list)
        } catch (_) {
          setUserProducts([])
          setCommittedProductIds(new Set())
        } finally {
          setLoadingPendingCheck(false)
        }
      })()
    } else {
      setUserProducts([])
      setCommittedProductIds(new Set())
    }
  }, [isOpen, user, targetProductId, editTrade])

  useEffect(() => {
    if (!isOpen || !user?.latitude || !user?.longitude) return

    let cancelled = false
    ;(async () => {
      const address = await reverseGeocodeToAddress(user.latitude as number, user.longitude as number)
      if (!cancelled) {
        setProfileLocationLabel(address)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [isOpen, user?.latitude, user?.longitude])

  // Reset the pickup acknowledgement whenever the user switches away from pickup
  // so they re-confirm the commitment if they come back to it.
  useEffect(() => {
    if (tradeOption !== 'pickup') setPickupAcknowledged(false)
  }, [tradeOption])

  // Fetch seller's other products when multi-target mode is enabled
  useEffect(() => {
    if (!multiTargetMode || !targetProduct?.seller_id || !isOpen) {
      setSellerProducts([])
      return
    }
    ;(async () => {
      setLoadingSellerProducts(true)
      try {
        const res = await api.get(`/api/products/user/${targetProduct.seller_id}?page=1&limit=100`)
        const data = res.data?.data
        const list: Product[] = Array.isArray(data?.data) ? data.data : []
        setSellerProducts(list.filter(p => p.id !== targetProductId))
      } catch (_) {
        setSellerProducts([])
      } finally {
        setLoadingSellerProducts(false)
      }
    })()
  }, [multiTargetMode, targetProduct?.seller_id, isOpen, targetProductId])

  const toggleAdditionalTarget = (productId: number) => {
    setAdditionalTargetIds(prev =>
      prev.includes(productId) ? prev.filter(id => id !== productId) : [...prev, productId]
    )
  }

  const getTargetUnavailableReason = (product: Product) => {
    if (product.status !== 'available') return product.status === 'locked' ? 'Locked' : 'Unavailable'
    return ''
  }

  const getUnavailableReason = (product: Product) => {
    if (selectedOfferIdSet.has(product.id)) return ''
    if (committedProductIds.has(product.id)) return 'Already offered'
    if (product.status !== 'available') return 'Locked'
    return ''
  }

  const toggleOfferSelection = (product: Product) => {
    const unavailableReason = getUnavailableReason(product)
    if (unavailableReason) {
      toast({
        id: `trademodal-product-disabled-${product.id}`,
        title: unavailableReason,
        description: unavailableReason === 'Already offered'
          ? 'Cancel the related sent offer before using this item again.'
          : 'This item cannot be offered right now.',
        status: 'info',
        duration: 2500,
        isClosable: true,
      })
      return
    }

    const id = product.id
    setSelectedOfferIds(prev => {
      if (prev.includes(id)) {
        return prev.filter(x => x !== id)
      }
      
      // Check limit
      const limit = targetProduct?.max_items_per_offer || 0
      if (limit > 0 && prev.length >= limit) {
        toast({
          id: 'trademodal-selection-limit',
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

  const normalizeCashAmount = (value: string) => {
    const cleaned = value.replace(/[^\d]/g, '')
    if (!cleaned) return ''
    return String(Number(cleaned))
  }

  const handleCashAmountChange = (value: string) => {
    if (/[.eE+-]/.test(value)) {
      setCashAmount(value)
      setCashError('Enter a clean whole PHP amount')
      return
    }
    const normalized = normalizeCashAmount(value)
    setCashAmount(normalized)
    if (!normalized) {
      setCashError('')
      return
    }
    const amount = Number(normalized)
    setCashError(amount > 0 ? '' : 'Offer money must be greater than 0')
  }

  const getValidCashAmount = () => {
    if (!cashAmount.trim()) return undefined
    const normalized = normalizeCashAmount(cashAmount)
    const amount = Number(normalized)
    if (!normalized || !Number.isInteger(amount) || amount <= 0) {
      return null
    }
    return amount
  }

  // Resolved delivery address for payload submission
  const resolvedDeliveryAddress = (): string | undefined => {
    if (detectedLocationLabel.trim()) return detectedLocationLabel.trim()
    if (detectedCoords) return formatCoordinates(detectedCoords.lat, detectedCoords.lng)
    if (profileLocationLabel.trim()) return profileLocationLabel.trim()
    if (user?.latitude && user?.longitude) return formatCoordinates(user.latitude, user.longitude)
    if (manualAddress.trim()) return manualAddress.trim()
    return undefined
  }

  const hasDeliveryLocation = !!(
    (user?.latitude && user?.longitude) || detectedCoords || manualAddress.trim()
  )

  const handleDetectLocation = () => {
    if (!navigator.geolocation) {
      toast({
        id: "trademodal-geolocation-not-supported", title: 'Geolocation not supported', description: 'Your browser does not support location detection.', status: 'error' })
      return
    }
    setDetectingLocation(true)
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = position.coords.latitude
        const lng = position.coords.longitude
        setDetectedCoords({ lat, lng })
        const address = await reverseGeocodeToAddress(lat, lng)
        setDetectedLocationLabel(address)
        setDetectingLocation(false)
        toast({
        id: "trademodal-location-detected", title: 'Location detected!', description: address, status: 'success', duration: 2500 })
      },
      (error) => {
        setDetectingLocation(false)
        const messages: Record<number, string> = {
          1: 'Location permission denied. Please enter your address manually.',
          2: 'Unable to determine your position. Please enter your address manually.',
          3: 'Location request timed out. Please enter your address manually.',
        }
        toast({
        id: "trademodal-location-error", title: 'Location error', description: messages[error.code] || 'Could not detect location.', status: 'warning', duration: 4000 })
      },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  const submitTrade = async () => {
    if (!targetProductId || selectedOfferIds.length === 0) {
      toast({
        id: "trademodal-select-items", title: 'Select items', description: 'Please select at least one of your items to offer.', status: 'warning' })
      return
    }

    if (!tradeOption) {
      toast({
        id: "trademodal-select-option", title: 'Select method', description: 'Please select Meetup or Pickup.', status: 'warning' })
      return
    }

    if (tradeOption === 'pickup' && !pickupAcknowledged) {
      toast({
        id: "trademodal-pickup-ack",
        title: 'Confirm pickup commitment',
        description: "Please confirm you're willing to travel to the seller's pickup location.",
        status: 'warning',
        duration: 3500,
      })
      return
    }

    // Layer 2 validation: Check for pending offer before submission
    if (hasPendingOfferOnTarget) {
      toast({
        id: "trademodal-pending-offer-already-exists",
        title: 'Pending Offer Already Exists',
        description: 'You already have a pending offer on this product. Please wait for the trader to respond to your existing offer before sending another one.',
        status: 'warning',
        duration: 4000,
        isClosable: true
      })
      return
    }

    const offeredCashAmount = getValidCashAmount()
    if (offeredCashAmount === null || cashError) {
      setCashError('Enter a clean whole PHP amount greater than 0')
      toast({
        id: "trademodal-invalid-cash",
        title: 'Invalid offer money',
        description: 'Enter a clean whole PHP amount greater than 0.',
        status: 'warning',
      })
      return
    }

    try {
      setSubmittingTrade(true)
      const payload: TradeCreate = {
        target_product_id: targetProductId,
        offered_product_ids: selectedOfferIds,
        message: tradeMessage,
        offered_cash_amount: offeredCashAmount || undefined,
        trade_option: 'meetup',
        meeting_type: tradeOption === 'pickup' ? 'pickup' : 'meetup',
        ...(multiTargetMode && additionalTargetIds.length > 0 && {
          additional_target_product_ids: additionalTargetIds,
        }),
      }
      if (isEditMode && editTrade?.id) {
        await updateTrade(editTrade.id, {
          action: 'edit_offer',
          offered_product_ids: selectedOfferIds,
          message: tradeMessage,
          offered_cash_amount: offeredCashAmount || undefined,
          trade_option: 'meetup',
          meeting_type: tradeOption === 'pickup' ? 'pickup' : 'meetup',
          payment_method: editTrade.payment_method,
        })
      } else {
        await api.post('/api/trades', payload)
      }

      // Invalidate dashboard cache so sent offers show immediately
      invalidateOffers()
      invalidateDashboard()
      await queryClient.refetchQueries({ queryKey: DASHBOARD_QUERY_KEYS.sentOffers })

      showNotification(isEditMode ? 'Trade Offer Updated' : 'Trade Offer Sent', 'success')
      setSelectedOfferIds([])
      setTradeMessage('')
      setCashAmount('')
      setTradeOption(null)
      setPickupAcknowledged(false)
      setDetectedCoords(null)
      setManualAddress('')
      setMultiTargetMode(false)
      setAdditionalTargetIds([])
      setSellerProducts([])
      setTargetSearchTerm('')
      onClose()
    } catch (e: any) {
      const errorMessage = e?.response?.data?.error || (isEditMode ? 'Failed to update trade' : 'Failed to send trade')
      toast({
        id: "trademodal-failed", title: 'Failed', description: errorMessage, status: 'error' })
    } finally {
      setSubmittingTrade(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} isCentered size="sm">
      <ModalOverlay />
      <ModalContent maxW="400px">
        <ModalHeader fontSize="lg" fontWeight="semibold">{user ? (isEditMode ? 'Edit Your Offer' : 'Propose a Trade') : 'Sign in to Continue'}</ModalHeader>
        <ModalCloseButton />
        <ModalBody pb={6}>
          {user ? (
            <VStack spacing={3} align="stretch">
              {/* Target Product Display */}
              {isTargetLoading ? (
                <Card variant="outline" borderColor={borderColor}>
                  <CardBody p={3}>
                    <HStack spacing={2} align="center">
                      <Spinner size="sm" />
                      <Text fontSize="11px" color={mutedTextColor}>Loading trade details...</Text>
                    </HStack>
                  </CardBody>
                </Card>
              ) : targetProduct ? (
                <Card variant="outline" bg={targetCardBg} borderColor={targetCardBorderColor}>
                  <CardBody p={3}>
                    <VStack spacing={2} align="stretch">
                      {/* Header row: label + toggle */}
                      <HStack justify="space-between" align="center">
                        <Text fontSize="10px" fontWeight="bold" color={targetLabelColor} textTransform="uppercase" letterSpacing="0.5px">
                          Trading For: {multiTargetMode ? `${additionalTargetIds.length + 1} Item${additionalTargetIds.length > 0 ? 's' : ''}` : '1 Item'}
                        </Text>
                        {!isEditMode && (
                          <HStack spacing={1} align="center">
                            <Text fontSize="9px" color={mutedTextColor} fontWeight="500">Multiple</Text>
                            <Switch
                              size="sm"
                              colorScheme="blue"
                              isChecked={multiTargetMode}
                              onChange={() => {
                                if (multiTargetMode) {
                                  setAdditionalTargetIds([])
                                  setTargetSearchTerm('')
                                }
                                setMultiTargetMode(prev => !prev)
                              }}
                            />
                          </HStack>
                        )}
                      </HStack>

                      {/* Primary target product — always shown */}
                      <HStack spacing={2} align="start">
                        <Image src={getFirstImage(targetProduct.image_urls)} alt={targetProduct.title} w="60px" h="60px" objectFit="cover" rounded="md" loading="lazy" />
                        <VStack spacing={1} align="start" flex={1}>
                          <Text fontWeight="600" fontSize="12px" wordBreak="break-word">{targetProduct.title}</Text>
                          <Text fontSize="10px" color="gray.500" noOfLines={2} wordBreak="break-word">{targetProduct.description}</Text>
                          {targetProduct.bidding_type && targetProduct.bidding_type !== 'none' && (
                            <HStack spacing={1}>
                              {targetProduct.bidding_type === 'blind' && (
                                <Badge colorScheme="orange" fontSize="9px">Blind Bidding</Badge>
                              )}
                              {targetProduct.bidding_type === 'open' && (
                                <Badge colorScheme="green" fontSize="9px">Open Bidding</Badge>
                              )}
                            </HStack>
                          )}
                        </VStack>
                      </HStack>

                      {/* Multi-target section */}
                      {multiTargetMode && (
                        <VStack spacing={2} align="stretch">
                          {additionalTargetIds.length > 0 && (
                            <VStack align="start" spacing={1}>
                              <Text fontSize="9px" color="blue.600" fontWeight="600">
                                +{additionalTargetIds.length} more item{additionalTargetIds.length > 1 ? 's' : ''} selected
                              </Text>
                              <HStack wrap="wrap" spacing={1}>
                                {sellerProducts
                                  .filter(p => additionalTargetIds.includes(p.id))
                                  .map(p => (
                                    <HStack key={p.id} bg="blue.100" borderRadius="sm" px={1.5} py={0.5} spacing={1}>
                                      <Image src={getFirstImage(p.image_urls)} w="14px" h="14px" objectFit="cover" rounded="sm" />
                                      <Text fontSize="9px" fontWeight="500" maxW="60px" noOfLines={1}>{p.title}</Text>
                                      <Icon as={FaTimes} boxSize={2} cursor="pointer" color="blue.500" onClick={() => toggleAdditionalTarget(p.id)} />
                                    </HStack>
                                  ))
                                }
                              </HStack>
                            </VStack>
                          )}

                          <Text fontSize="9px" color="blue.600">
                            Select more products from this seller to bundle into one trade.
                          </Text>

                          <Input
                            placeholder="Search seller's items..."
                            value={targetSearchTerm}
                            onChange={(e) => setTargetSearchTerm(e.target.value.toLowerCase())}
                            size="sm"
                            fontSize="11px"
                            _placeholder={{ color: 'gray.400' }}
                            bg="white"
                          />

                          {loadingSellerProducts ? (
                            <HStack justify="center" py={2}><Spinner size="sm" /></HStack>
                          ) : visibleSellerProducts.length === 0 ? (
                            <Text fontSize="9px" color={mutedTextColor} textAlign="center" py={2}>
                              No other available items from this seller.
                            </Text>
                          ) : (
                            <Box maxH="100px" overflowY="auto" pr={1}>
                              <Grid templateColumns="repeat(4, 1fr)" gap={1.5} gridAutoRows="70px">
                                {visibleSellerProducts.map(p => {
                                  const isSelected = additionalTargetIds.includes(p.id)
                                  const unavailReason = getTargetUnavailableReason(p)
                                  const isDisabled = Boolean(unavailReason)
                                  return (
                                    <Box
                                      key={p.id}
                                      minH="70px"
                                      borderWidth={isSelected ? '2px' : '0.5px'}
                                      borderColor={isSelected ? 'blue.500' : borderColor}
                                      rounded="md"
                                      overflow="hidden"
                                      onClick={() => !isDisabled && toggleAdditionalTarget(p.id)}
                                      cursor={isDisabled ? 'not-allowed' : 'pointer'}
                                      bg={isSelected ? 'blue.50' : 'white'}
                                      opacity={isDisabled ? 0.48 : 1}
                                      position="relative"
                                    >
                                      <Image src={getFirstImage(p.image_urls)} alt={p.title} w="full" h="35px" objectFit="cover" loading="lazy" filter={isDisabled ? 'grayscale(1)' : undefined} />
                                      <Box p="0.5">
                                        <Text fontSize="9px" noOfLines={1} fontWeight={isSelected ? '600' : '500'} color={isSelected ? 'blue.600' : 'inherit'}>{p.title}</Text>
                                        {isDisabled && <Text fontSize="8px" color="gray.700" fontWeight="700">{unavailReason}</Text>}
                                      </Box>
                                    </Box>
                                  )
                                })}
                              </Grid>
                            </Box>
                          )}
                        </VStack>
                      )}
                    </VStack>
                  </CardBody>
                </Card>
              ) : null}

              {/* Item Selection */}
              <VStack align="start" spacing={1} w="full">
                <Text fontWeight="600" fontSize="11px" textTransform="uppercase" color={mutedTextColor} letterSpacing="0.5px">
                  Offering: 1 or more of my items
                  {targetProduct?.max_items_per_offer ? (
                    <Badge ml={2} colorScheme="brand" variant="subtle" fontSize="9px">
                      Max {targetProduct.max_items_per_offer}
                    </Badge>
                  ) : null}
                </Text>
                {selectedOfferIds.length > 0 && (
                  <Text fontSize="9px" color={selectedTextColor} fontWeight="bold">
                    You are offering {selectedOfferIds.length} {selectedOfferIds.length === 1 ? 'item' : 'items'}
                    {targetProduct?.max_items_per_offer ? ` / ${targetProduct.max_items_per_offer}` : ''}
                  </Text>
                )}
                {selectedOfferIds.length > 1 && (
                  <Text fontSize="9px" color={mutedTextColor}>
                    These items will be sent as one bundled offer. The seller accepts or declines the whole bundle.
                  </Text>
                )}
              </VStack>

              {/* Search Bar */}
              <Input
                placeholder="Search your items..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value.toLowerCase())}
                size="sm"
                fontSize="11px"
                _placeholder={{ color: 'gray.400' }}
              />

              {/* Scrollable grid: 4 items per row, minimized boxes */}
              <Box maxH="90px" overflowY="auto" pr={2}>
                {visibleProducts.length === 0 ? (
                  <Flex direction="column" align="center" justify="center" h="140px" gap={2} p={4} bg="gray.50" borderRadius="md" borderWidth="1px" borderColor={borderColor}>
                    <Icon as={FaBoxOpen} boxSize={8} color="gray.400" />
                    <VStack spacing={1} textAlign="center">
                      <Text fontWeight="600" fontSize="11px" color="gray.700">
                        No items available to trade
                      </Text>
                      <Button
                        size="xs"
                        colorScheme="brand"
                        onClick={() => {
                          onClose()
                          navigate('/dashboard?tab=my-items')
                        }}
                      >
                        Add Item
                      </Button>
                    </VStack>
                  </Flex>
                ) : (
                  <Grid templateColumns="repeat(4, 1fr)" gap={1.5} gridAutoRows="70px" justifyContent="start">
                    {visibleProducts.map((p) => {
                      const isSelected = selectedOfferIds.includes(p.id)
                      const unavailableReason = getUnavailableReason(p)
                      const isDisabled = Boolean(unavailableReason)
                      return (
                      <Box
                        key={p.id}
                        minH="70px"
                        borderWidth={isSelected ? '2px' : '0.5px'}
                        borderColor={isSelected ? selectedBorder : borderColor}
                        rounded="md"
                        overflow="hidden"
                        onClick={() => toggleOfferSelection(p)}
                        cursor={isDisabled ? 'not-allowed' : 'pointer'}
                        bg={isSelected ? selectedBg : 'white'}
                        opacity={isDisabled ? 0.48 : 1}
                        position="relative"
                      >
                        <Image src={getFirstImage(p.image_urls)} alt={p.title} w="full" h="35px" objectFit="cover" loading="lazy" filter={isDisabled ? 'grayscale(1)' : undefined} />
                        <Box p="0.5">
                          <Text fontSize="9px" noOfLines={1} wordBreak="break-word" fontWeight={isSelected ? '600' : '500'} color={isSelected ? selectedTextColor : 'inherit'}>{p.title}</Text>
                          {isDisabled && (
                            <Text fontSize="8px" noOfLines={1} color="gray.700" fontWeight="700">{unavailableReason}</Text>
                          )}
                        </Box>
                      </Box>
                    )})}
                  </Grid>
                )}
              </Box>

              {/* Message Input */}
              <FormControl>
                <FormLabel fontSize="11px" fontWeight="bold" textTransform="uppercase" color={mutedTextColor} letterSpacing="0.5px" mb={1}>
                  Message (optional)
                </FormLabel>
                <Input 
                  placeholder="Add a note for the trader" 
                  value={tradeMessage} 
                  onChange={(e) => setTradeMessage(e.target.value)} 
                  fontSize="11px"
                  py={2}
                />
              </FormControl>

              {/* Cash Amount Input */}
              <FormControl>
                <FormLabel fontSize="11px" fontWeight="bold" textTransform="uppercase" color={mutedTextColor} letterSpacing="0.5px" mb={1}>
                  Offer money (optional, PHP)
                </FormLabel>
                <Input
                  type="text"
                  inputMode="numeric"
                  placeholder="e.g. 500"
                  value={cashAmount}
                  onChange={(e) => handleCashAmountChange(e.target.value)}
                  fontSize="11px"
                  py={2}
                  isInvalid={Boolean(cashError)}
                />
                {cashError && (
                  <Text fontSize="9px" color="red.500" mt={1}>{cashError}</Text>
                )}
              </FormControl>

              {/* Trade Method - Meetup and Pickup Options based on Product Location Type */}
              <FormControl isRequired>
                <FormLabel fontSize="11px" fontWeight="bold" textTransform="uppercase" color={mutedTextColor} letterSpacing="0.5px" mb={2}>
                  Trade Method
                </FormLabel>
                {isTargetLoading ? (
                  <Box p={2.5} bg="gray.50" borderWidth="1px" borderColor={borderColor} borderRadius="md" mb={3}>
                    <HStack spacing={2}>
                      <Spinner size="sm" />
                      <Text fontSize="10px" color={mutedTextColor}>Loading trade methods...</Text>
                    </HStack>
                  </Box>
                ) : (
                  <>
                    {hasFixedLocation ? (
                      // Product has fixed location: Pickup primary, Meetup optional
                      <HStack spacing={2} mb={3}>
                        {/* Pickup Option - Primary */}
                        <Button
                          flex={1}
                          size="sm"
                          height="36px"
                          variant={tradeOption === 'pickup' ? 'solid' : 'outline'}
                          bg={tradeOption === 'pickup' ? '#E67E22' : 'transparent'}
                          color={tradeOption === 'pickup' ? 'white' : 'inherit'}
                          borderColor={tradeOption === 'pickup' ? '#E67E22' : borderColor}
                          _hover={{ bg: tradeOption === 'pickup' ? '#D35400' : undefined }}
                          onClick={() => setTradeOption('pickup')}
                          leftIcon={<Icon as={FaMapMarkerAlt} boxSize={4} />}
                          fontSize="11px"
                          fontWeight="600"
                        >
                          Pickup
                        </Button>
                        {/* Meetup Option - Secondary */}
                        <Button
                          flex={1}
                          size="sm"
                          height="36px"
                          variant={tradeOption === 'meetup' ? 'solid' : 'outline'}
                          bg={tradeOption === 'meetup' ? selectedBorder : 'transparent'}
                          color={tradeOption === 'meetup' ? 'white' : 'inherit'}
                          borderColor={tradeOption === 'meetup' ? selectedBorder : borderColor}
                          _hover={{ bg: tradeOption === 'meetup' ? '#158A63' : undefined }}
                          onClick={() => setTradeOption('meetup')}
                          leftIcon={<Icon as={FaHandshake} boxSize={4} />}
                          fontSize="11px"
                          fontWeight="600"
                        >
                          Meetup
                        </Button>
                      </HStack>
                    ) : (
                      // Product has no fixed location: Only Meetup available
                      <HStack spacing={2} mb={3}>
                        {/* Pickup Disabled - No fixed location */}
                        <Button
                          flex={1}
                          size="sm"
                          height="36px"
                          variant="outline"
                          isDisabled
                          opacity={0.5}
                          leftIcon={<Icon as={FaMapMarkerAlt} boxSize={4} />}
                          fontSize="11px"
                          fontWeight="600"
                          title="Pickup unavailable - seller has no fixed location"
                        >
                          Pickup
                        </Button>
                        {/* Meetup Option - Only */}
                        <Button
                          flex={1}
                          size="sm"
                          height="36px"
                          variant={tradeOption === 'meetup' ? 'solid' : 'outline'}
                          bg={tradeOption === 'meetup' ? selectedBorder : 'transparent'}
                          color={tradeOption === 'meetup' ? 'white' : 'inherit'}
                          borderColor={tradeOption === 'meetup' ? selectedBorder : borderColor}
                          _hover={{ bg: tradeOption === 'meetup' ? '#158A63' : undefined }}
                          onClick={() => setTradeOption('meetup')}
                          leftIcon={<Icon as={FaHandshake} boxSize={4} />}
                          fontSize="11px"
                          fontWeight="600"
                        >
                          Meetup (Agree on Location)
                        </Button>
                      </HStack>
                    )}

                    {/* Info Box for Selected Option */}
                    {tradeOption === 'meetup' && (
                      <Box p={2.5} bg="blue.50" borderWidth="1px" borderColor="blue.200" borderRadius="md" mb={3}>
                        <Text fontSize="10px" color="blue.800" fontWeight="600" mb={1}>Agree on a Meeting Place</Text>
                        <Text fontSize="10px" color="blue.800">
                          ✓ Both parties agree on a mutual location, date, and time
                        </Text>
                        <Text fontSize="10px" color="blue.800">
                          ✓ Either user can propose or suggest changes
                        </Text>
                      </Box>
                    )}

                    {tradeOption === 'pickup' && (
                      <VStack spacing={2} align="stretch" mb={3}>
                        <Box p={2.5} bg="orange.50" borderWidth="1px" borderColor="orange.200" borderRadius="md">
                          <Text fontSize="10px" color="orange.800" fontWeight="600" mb={1}>Pick Up from Seller's Location</Text>
                          <Text fontSize="10px" color="orange.800">
                            ✓ You travel to the seller — the location is set by them and can't be changed
                          </Text>
                          <Text fontSize="10px" color="orange.800">
                            ✓ You pick the date and time; the seller can accept or propose a reschedule
                          </Text>
                        </Box>
                        <Alert status="warning" variant="left-accent" borderRadius="md" py={2} px={2.5} fontSize="11px">
                          <AlertIcon boxSize="14px" />
                          <Box>
                            <Text fontSize="11px" fontWeight="600" color="orange.900" mb={0.5}>
                              Heads-up: you're the one traveling
                            </Text>
                            <Text fontSize="10px" color="orange.800">
                              The seller stays at their pickup spot. Make sure you're willing and able to go there before sending this offer.
                            </Text>
                          </Box>
                        </Alert>
                        <Checkbox
                          size="sm"
                          colorScheme="orange"
                          isChecked={pickupAcknowledged}
                          onChange={(e) => setPickupAcknowledged(e.target.checked)}
                        >
                          <Text fontSize="11px" color="gray.700">
                            I understand and I'm willing to go to the seller's pickup location.
                          </Text>
                        </Checkbox>
                      </VStack>
                    )}

                    {!hasFixedLocation && (
                      <Box p={2.5} bg="yellow.50" borderWidth="1px" borderColor="yellow.200" borderRadius="md" mb={3}>
                        <Text fontSize="9px" color="yellow.800">
                          ℹ️ Seller has no fixed location. You must agree on a meeting place together.
                        </Text>
                      </Box>
                    )}
                  </>
                )}
              </FormControl>

              {/* Action Buttons */}
              <HStack justify="flex-end" spacing={3} pt={1}>
                <Button 
                  variant="ghost" 
                  onClick={onClose}
                  fontSize="11px"
                  height="36px"
                >
                  Cancel
                </Button>
                <Button
                  bg={selectedBorder}
                  color="white"
                  isLoading={submittingTrade}
                  onClick={submitTrade}
                  isDisabled={selectedOfferIds.length === 0 || !tradeOption}
                  fontSize="11px"
                  fontWeight="600"
                  height="36px"
                  flex="2"
                  _hover={{ bg: '#158A63' }}
                  _active={{ bg: '#0F5A42' }}
                >
                  {isEditMode ? 'Save Changes' : 'Confirm'}
                </Button>
              </HStack>
            </VStack>
          ) : (
            <VStack spacing={4}>
              <Text color="gray.600" fontSize="12px">
                You need to be signed in to trade or purchase items.
              </Text>
              <HStack spacing={3} w="full">
                <Button
                  onClick={onClose}
                  as={'a'}
                  href="/login"
                  colorScheme="brand"
                  flex={1}
                  size="sm"
                >
                  Sign In
                </Button>
                <Button
                  onClick={onClose}
                  as={'a'}
                  href="/register"
                  variant="outline"
                  flex={1}
                  size="sm"
                >
                  Sign Up
                </Button>
              </HStack>
            </VStack>
          )}
        </ModalBody>
      </ModalContent>
    </Modal>
  )
}

export default TradeModal
