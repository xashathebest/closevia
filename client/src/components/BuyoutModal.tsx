import React, { useEffect, useState } from 'react'
import { Modal, ModalOverlay, ModalContent, ModalHeader, ModalBody, ModalCloseButton, VStack, Box, Image, Text, FormControl, FormLabel, Input, HStack, Button, useToast, Divider, Badge, Card, CardBody, Icon, useColorModeValue, Textarea, Grid, Link, SimpleGrid } from '@chakra-ui/react'
import { FaMapMarkerAlt, FaTruck, FaCheckCircle, FaCreditCard, FaUsers, FaMotorcycle, FaRocket } from 'react-icons/fa'
import { useAuth } from '../contexts/AuthContext'
import { useNotification } from '../contexts/NotificationContext'
import { api } from '../services/api'
import { Product, TradeCreate, TradeOption } from '../types'
import { getFirstImage } from '../utils/imageUtils'
import { reverseGeocodeToAddress, formatCoordinates } from '../utils/locationUtils'

interface BuyoutModalProps {
  isOpen: boolean
  onClose: () => void
  targetProductId: number | null
}

const BuyoutModal: React.FC<BuyoutModalProps> = ({ isOpen, onClose, targetProductId }) => {
  const { user, refreshUser } = useAuth()
  const toast = useToast()
  const { showNotification } = useNotification()
  const [targetProduct, setTargetProduct] = useState<Product | null>(null)
  
  const [tradeMessage, setTradeMessage] = useState('')
  const [submittingTrade, setSubmittingTrade] = useState(false)
  const [cashAmount, setCashAmount] = useState<string>('')
  const [tradeOption, setTradeOption] = useState<TradeOption | null>(null)
  
  const [hasPendingOfferOnTarget, setHasPendingOfferOnTarget] = useState(false)
  const [loadingPendingCheck, setLoadingPendingCheck] = useState(false)
  const [detectingLocation, setDetectingLocation] = useState(false)
  const [detectedCoords, setDetectedCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [detectedLocationLabel, setDetectedLocationLabel] = useState('')
  const [profileLocationLabel, setProfileLocationLabel] = useState('')
  const [customLocationLabel, setCustomLocationLabel] = useState('')
  const [deliveryType, setDeliveryType] = useState<'standard' | 'express'>('standard')
  const [deliveryInstructions, setDeliveryInstructions] = useState('')

  const distance = targetProduct?.distanceKm || 10.0;
  const standardFee = Math.round(35 + (distance > 5 ? (distance - 5) * 3 : 0));
  const expressFee = Math.round(80 + (distance > 5 ? (distance - 5) * 5 : 0));
  
  const cardBg = useColorModeValue('white', 'gray.800')
  const borderColor = useColorModeValue('gray.200', 'gray.700')
  const selectedBg = '#E1F5EE'
  const selectedBorder = '#1D9E75'
  const selectedTextColor = '#1D9E75'
  const mutedTextColor = useColorModeValue('gray.600', 'gray.400')

  // Fetch target product details
  useEffect(() => {
    if (!isOpen || !targetProductId) {
      setTargetProduct(null)
      return
    }
    ;(async () => {
      try {
        const res = await api.get(`/api/products/${targetProductId}`)
        const product = res.data?.data?.product || res.data?.data
        setTargetProduct(product)
        if (product && product.price) {
            setCashAmount(product.price.toString())
        }
      } catch (_) {
        setTargetProduct(null)
      }
    })()
  }, [isOpen, targetProductId])

  // Reset form only when modal opens
  useEffect(() => {
    if (!isOpen) return
    setTradeMessage('')
    setCashAmount(targetProduct && targetProduct.price ? targetProduct.price.toString() : '')
    setTradeOption(null)
    setHasPendingOfferOnTarget(false)
    setDetectedCoords(null)
    setDetectedLocationLabel('')
    setProfileLocationLabel('')
    setCustomLocationLabel('')
    setDeliveryType('standard')
    setDeliveryInstructions('')

    // Auto-set delivery option if user has location
    if (user?.latitude && user?.longitude) {
      setTradeOption('delivery')
    }
  }, [isOpen, targetProduct])

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

  const resolvedDeliveryAddress = (): string | undefined => {
    if (customLocationLabel.trim()) return customLocationLabel.trim()
    if (detectedLocationLabel.trim()) return detectedLocationLabel.trim()
    if (detectedCoords) return formatCoordinates(detectedCoords.lat, detectedCoords.lng)
    if (profileLocationLabel.trim()) return profileLocationLabel.trim()
    if (user?.latitude && user?.longitude) return formatCoordinates(user.latitude, user.longitude)
    return undefined
  }

  // Check for pending offers separately
  useEffect(() => {
    if (!isOpen || !user || !targetProductId) return
    ;(async () => {
      try {
        setLoadingPendingCheck(true)
        const pendingRes = await api.get(`/api/trades?direction=outgoing&status=pending&limit=100`)
        const trades = Array.isArray(pendingRes.data?.data) ? pendingRes.data.data : []
        const hasPending = trades.some((trade: any) => trade.target_product_id === targetProductId)
        setHasPendingOfferOnTarget(hasPending)
      } catch (_) {
        // Ignore
      } finally {
        setLoadingPendingCheck(false)
      }
    })()
  }, [isOpen, user, targetProductId])

  const submitTrade = async () => {
    if (!targetProductId) return
    
    if (!cashAmount || Number(cashAmount) <= 0) {
      toast({
        id: "buyoutmodal-invalid-amount", title: 'Invalid amount', description: 'Please enter a valid cash amount to offer.', status: 'warning' })
      return
    }
    
    if (!tradeOption) {
      toast({
        id: "buyoutmodal-select-fulfillment-option", title: 'Select fulfillment option', description: 'Please select Meetup or Delivery option.', status: 'warning' })
      return
    }

    if (tradeOption === 'delivery' && !resolvedDeliveryAddress()) {
      toast({
        id: "buyoutmodal-delivery-location-required", title: 'Delivery location required', description: 'Please detect your current location before sending a delivery buyout.', status: 'warning' })
      return
    }
    
    // Layer 2 validation: Check for pending offer before submission
    if (hasPendingOfferOnTarget) {
      toast({
        id: "buyoutmodal-pending-offer-already-exists", 
        title: 'Pending Offer Already Exists', 
        description: 'You already have a pending offer on this product. Please wait for the trader to respond before sending another one.', 
        status: 'warning',
        duration: 4000,
        isClosable: true 
      })
      return
    }
    
    try {
      setSubmittingTrade(true)
      const deliveryAddress = resolvedDeliveryAddress()
      
      // Determine payment method based on trade option:
      // Meetup = always upfront (cash on spot)
      // Delivery = cod (rider collects payment)
      const paymentMethod = tradeOption === 'meetup' ? 'upfront' : 'cod'
      
      const payload: TradeCreate = {
        target_product_id: targetProductId,
        offered_product_ids: [],
        message: tradeMessage,
        offered_cash_amount: Number(cashAmount),
        trade_option: tradeOption,
        delivery_address: tradeOption === 'delivery' ? deliveryAddress : undefined,
        payment_method: paymentMethod,
        ...(tradeOption === 'delivery' && {
          delivery_type: deliveryType,
          delivery_instructions: deliveryInstructions
        })
      } as TradeCreate & { delivery_type: string, delivery_instructions: string }
      
      await api.post('/api/trades', payload)
      showNotification('Buyout Offer Sent', 'success')
      setTradeMessage('')
      setCashAmount('')
      setTradeOption(null)
      onClose()
    } catch (e: any) {
      const errorMessage = e?.response?.data?.error || 'Failed to send buyout offer'
      toast({
        id: "buyoutmodal-failed", title: 'Failed', description: errorMessage, status: 'error' })
    } finally {
      setSubmittingTrade(false)
    }
  }

  const handleDetectLocation = async () => {
    if (!navigator.geolocation) {
      toast({
        id: "buyoutmodal-geolocation-not-supported", title: 'Geolocation not supported', status: 'error', duration: 3000 })
      return
    }

    if (tradeOption !== 'delivery') {
      setTradeOption('delivery')
    }

    setDetectingLocation(true)
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords
        const address = await reverseGeocodeToAddress(latitude, longitude)
        setDetectedCoords({ lat: latitude, lng: longitude })
        setDetectedLocationLabel(address)

        try {
          await api.put('/api/users/profile', { latitude, longitude })
          if (refreshUser) await refreshUser()
          toast({
            id: "buyoutmodal-location-saved", title: 'Location saved!', description: address, status: 'success', duration: 3000 })
        } catch {
          toast({
            id: "buyoutmodal-failed-to-save-location", title: 'Detected location only for this offer', description: address, status: 'warning', duration: 3500 })
        }

        setDetectingLocation(false)
      },
      () => {
        toast({
          id: "buyoutmodal-location-access-denied", title: 'Location access denied', status: 'warning', duration: 4000 })
        setDetectingLocation(false)
      },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} isCentered size="sm">
      <ModalOverlay />
      <ModalContent maxW="400px">
        <ModalHeader fontSize="lg" fontWeight="semibold">{user ? 'Make a Buyout Offer' : 'Sign in to Continue'}</ModalHeader>
        <ModalCloseButton />
        <ModalBody pb={6}>
          {user ? (
            <VStack spacing={4} align="stretch">
              {/* Target Product Display */}
              {targetProduct && (
                <Card variant="outline" bg={useColorModeValue('green.50', 'green.900')} borderColor={useColorModeValue('green.200', 'green.700')}>
                  <CardBody p={3}>
                    <VStack spacing={2} align="stretch">
                      <HStack justify="space-between">
                        <Text fontSize="10px" fontWeight="bold" color={useColorModeValue('green.700', 'green.200')} textTransform="uppercase" letterSpacing="0.5px">
                          Buying Out
                        </Text>
                        {targetProduct.price && (
                          <Badge colorScheme="green" fontSize="xs">
                            ₱{targetProduct.price.toFixed(2)}
                          </Badge>
                        )}
                      </HStack>
                      <HStack spacing={2} align="start">
                        <Image src={getFirstImage(targetProduct.image_urls)} alt={targetProduct.title} w="60px" h="60px" objectFit="cover" rounded="md" loading="lazy" />
                        <VStack spacing={1} align="start" flex={1}>
                          <Text fontWeight="600" fontSize="12px">{targetProduct.title}</Text>
                          <Text fontSize="10px" color="gray.500" noOfLines={2}>{targetProduct.description}</Text>
                        </VStack>
                      </HStack>
                    </VStack>
                  </CardBody>
                </Card>
              )}

              {/* Cash Offer Input */}
              <FormControl isRequired>
                <FormLabel fontSize="11px" fontWeight="bold" textTransform="uppercase" color={mutedTextColor} letterSpacing="0.5px" mb={2}>
                  Your Cash Offer
                </FormLabel>
                <HStack spacing={2}>
                  <Text fontWeight="bold" fontSize="sm" color={selectedTextColor}>₱</Text>
                  <Input 
                    type="number" 
                    placeholder="0.00" 
                    value={cashAmount} 
                    onChange={(e) => setCashAmount(e.target.value)} 
                    min={1} 
                    step="0.01" 
                    fontSize="12px"
                    py={5}
                  />
                </HStack>
              </FormControl>

              {/* Message to Trader (optional) */}
              <FormControl>
                <FormLabel fontSize="11px" fontWeight="bold" textTransform="uppercase" color={mutedTextColor} letterSpacing="0.5px" mb={2}>
                  Message (Optional)
                </FormLabel>
                <Textarea 
                  placeholder="Add a note to convince the trader..." 
                  value={tradeMessage} 
                  onChange={(e) => setTradeMessage(e.target.value)} 
                  rows={2}
                  fontSize="11px"
                  py={3}
                />
              </FormControl>

              {/* Fulfillment & Payment Section */}
              <FormControl isRequired>
                <FormLabel fontSize="11px" fontWeight="bold" textTransform="uppercase" color={mutedTextColor} letterSpacing="0.5px" mb={3}>
                  Fulfillment & Payment
                </FormLabel>
                <Grid templateColumns="repeat(2, 1fr)" gap={3}>
                  {/* Meetup Option */}
                  <Card
                    variant="outline"
                    cursor="pointer"
                    borderWidth={tradeOption === 'meetup' ? '2px' : '0.5px'}
                    borderColor={tradeOption === 'meetup' ? selectedBorder : borderColor}
                    bg={tradeOption === 'meetup' ? selectedBg : cardBg}
                    onClick={() => setTradeOption('meetup')}
                    transition="all 0.2s"
                    _hover={{
                      shadow: tradeOption === 'meetup' ? 'md' : 'sm',
                    }}
                  >
                    <CardBody p={3}>
                      <VStack spacing={2} align="center">
                        <Box 
                          p={2} 
                          borderRadius="lg" 
                          bg={tradeOption === 'meetup' ? selectedBorder : 'gray.200'} 
                          color={tradeOption === 'meetup' ? 'white' : 'gray.600'}
                        >
                          <Icon as={FaUsers} boxSize={5} />
                        </Box>
                        <Text fontWeight="600" fontSize="12px" color={tradeOption === 'meetup' ? selectedTextColor : 'inherit'}>
                          Meetup
                        </Text>
                        <Text 
                          fontSize="10px" 
                          color={tradeOption === 'meetup' ? selectedTextColor : mutedTextColor}
                          textAlign="center"
                          lineHeight="1.3"
                        >
                          Meet the seller in person and pay cash upfront on the spot.
                        </Text>
                      </VStack>
                    </CardBody>
                  </Card>

                  {/* Delivery Option */}
                  <Card
                    variant="outline"
                    cursor="pointer"
                    borderWidth={tradeOption === 'delivery' ? '2px' : '0.5px'}
                    borderColor={tradeOption === 'delivery' ? selectedBorder : borderColor}
                    bg={tradeOption === 'delivery' ? selectedBg : cardBg}
                    onClick={() => setTradeOption('delivery')}
                    transition="all 0.2s"
                    _hover={{
                      shadow: tradeOption === 'delivery' ? 'md' : 'sm',
                    }}
                  >
                    <CardBody p={3}>
                      <VStack spacing={2} align="center">
                        <Box 
                          p={2} 
                          borderRadius="lg" 
                          bg={tradeOption === 'delivery' ? selectedBorder : 'gray.200'} 
                          color={tradeOption === 'delivery' ? 'white' : 'gray.600'}
                        >
                          <Icon as={FaTruck} boxSize={5} />
                        </Box>
                        <Text fontWeight="600" fontSize="12px" color={tradeOption === 'delivery' ? selectedTextColor : 'inherit'}>
                          Delivery
                        </Text>
                        <Text 
                          fontSize="10px" 
                          color={tradeOption === 'delivery' ? selectedTextColor : mutedTextColor}
                          textAlign="center"
                          lineHeight="1.3"
                        >
                          Rider collects payment and delivery fee from you before picking up the item.
                        </Text>
                      </VStack>
                    </CardBody>
                  </Card>
                </Grid>

                {/* Delivery Location Row (visible only when Delivery is selected) */}
                {tradeOption === 'delivery' && (
                  <VStack spacing={2} mt={3} align="stretch">
                    {/* Compact Delivery Options */}
                    <Box w="100%">
                      <Text fontSize="10px" fontWeight="600" color={mutedTextColor} mb={1} textTransform="uppercase">
                        Delivery Method
                      </Text>
                      <Grid templateColumns="repeat(2, 1fr)" gap={3}>
                        <Card
                          variant="outline"
                          cursor="pointer"
                          borderWidth={deliveryType === 'standard' ? '2px' : '0.5px'}
                          borderColor={deliveryType === 'standard' ? selectedBorder : borderColor}
                          bg={deliveryType === 'standard' ? selectedBg : cardBg}
                          onClick={() => setDeliveryType('standard')}
                          transition="all 0.2s"
                          _hover={{ shadow: deliveryType === 'standard' ? 'md' : 'sm' }}
                        >
                          <CardBody p={3}>
                            <VStack spacing={2} align="center">
                              <Box 
                                p={2} 
                                borderRadius="lg" 
                                bg={deliveryType === 'standard' ? selectedBorder : 'gray.200'} 
                                color={deliveryType === 'standard' ? 'white' : 'gray.600'}
                              >
                                <Icon as={FaMotorcycle} boxSize={5} />
                              </Box>
                              <Text fontWeight="600" fontSize="12px" color={deliveryType === 'standard' ? selectedTextColor : 'inherit'}>
                                Standard
                              </Text>
                              <Text 
                                fontSize="11px" 
                                fontWeight="bold"
                                color={deliveryType === 'standard' ? selectedTextColor : mutedTextColor}
                              >
                                ₱{standardFee}
                              </Text>
                            </VStack>
                          </CardBody>
                        </Card>

                        <Card
                          variant="outline"
                          cursor="pointer"
                          borderWidth={deliveryType === 'express' ? '2px' : '0.5px'}
                          borderColor={deliveryType === 'express' ? selectedBorder : borderColor}
                          bg={deliveryType === 'express' ? selectedBg : cardBg}
                          onClick={() => setDeliveryType('express')}
                          transition="all 0.2s"
                          _hover={{ shadow: deliveryType === 'express' ? 'md' : 'sm' }}
                        >
                          <CardBody p={3}>
                            <VStack spacing={2} align="center">
                              <Box 
                                p={2} 
                                borderRadius="lg" 
                                bg={deliveryType === 'express' ? selectedBorder : 'gray.200'} 
                                color={deliveryType === 'express' ? 'white' : 'gray.600'}
                              >
                                <Icon as={FaRocket} boxSize={5} />
                              </Box>
                              <Text fontWeight="600" fontSize="12px" color={deliveryType === 'express' ? selectedTextColor : 'inherit'}>
                                Express
                              </Text>
                              <Text 
                                fontSize="11px" 
                                fontWeight="bold"
                                color={deliveryType === 'express' ? selectedTextColor : mutedTextColor}
                              >
                                ₱{expressFee}
                              </Text>
                            </VStack>
                          </CardBody>
                        </Card>
                      </Grid>
                    </Box>

                    {/* Instructions - Optional compact textarea */}
                    <Box w="100%" mb={2}>
                      <FormControl>
                        <FormLabel fontSize="10px" fontWeight="600" color={mutedTextColor} mb={1} textTransform="uppercase">
                          Delivery Notes (Optional)
                        </FormLabel>
                        <Textarea
                          value={deliveryInstructions}
                          onChange={(e) => setDeliveryInstructions(e.target.value)}
                          placeholder="Instructions for the rider"
                          size="sm"
                          rows={2}
                          fontSize={["xs", "sm"]}
                        />
                        <Text fontSize="xs" color="gray.500" mt={1}>{deliveryInstructions.length}/200 characters</Text>
                      </FormControl>
                    </Box>

                    {/* Location Display */}
                    <Box 
                      p={2.5} 
                      bg={useColorModeValue('gray.50', 'gray.700')} 
                      borderWidth="1px" 
                      borderColor={useColorModeValue('gray.200', 'gray.600')} 
                      rounded="md"
                    >
                      <HStack justify="space-between" align="center" spacing={2}>
                        <HStack spacing={2} flex={1} minW={0}>
                          <Icon as={FaMapMarkerAlt} boxSize={4} color={selectedBorder} flexShrink={0} />
                          <VStack spacing={0} align="start" minW={0} flex={1}>
                            <Text fontSize="11px" fontWeight="600" noOfLines={1}>
                              {customLocationLabel || detectedLocationLabel || profileLocationLabel || 'Location not set'}
                            </Text>
                            <Text fontSize="9px" color={mutedTextColor} noOfLines={1}>
                              {customLocationLabel ? 'Custom address' : 'Detected from your device'}
                            </Text>
                          </VStack>
                        </HStack>
                        {(customLocationLabel || detectedCoords || profileLocationLabel) && (
                          <Link
                            fontSize="9px"
                            fontWeight="600"
                            color={selectedBorder}
                            onClick={() => {
                              setDetectedCoords(null)
                              setDetectedLocationLabel('')
                              setCustomLocationLabel('')
                            }}
                            textDecoration="none"
                            _hover={{ textDecoration: 'underline' }}
                            flexShrink={0}
                          >
                            Clear
                          </Link>
                        )}
                      </HStack>
                    </Box>

                    {/* Custom Location Input */}
                    <FormControl>
                      <FormLabel fontSize="10px" fontWeight="600" color={mutedTextColor} mb={1}>
                        Use a different delivery location
                      </FormLabel>
                      <Input
                        placeholder="Enter another address (e.g., sister's house)"
                        value={customLocationLabel}
                        onChange={(e) => setCustomLocationLabel(e.target.value)}
                        fontSize="11px"
                        py={4}
                      />
                      {customLocationLabel && (
                        <Text fontSize="9px" color={mutedTextColor} mt={1}>
                          This will be used instead of your detected location.
                        </Text>
                      )}
                    </FormControl>

                    {/* Detect Location Button */}
                    <Button
                      size="sm"
                      variant="outline"
                      w="full"
                      fontSize="11px"
                      height="32px"
                      isLoading={detectingLocation}
                      loadingText="Detecting..."
                      onClick={handleDetectLocation}
                      borderColor={selectedBorder}
                      color={selectedBorder}
                      _hover={{ bg: selectedBg }}
                    >
                      📍 Detect my location
                    </Button>


                  </VStack>
                )}
              </FormControl>

              {/* Info Notice */}
              <Box 
                p={2.5}
                bg={useColorModeValue('gray.100', 'gray.700')}
                borderRadius="md"
                borderLeft="3px"
                borderLeftColor={mutedTextColor}
              >
                <Text fontSize="10px" color={mutedTextColor} lineHeight="1.4">
                  Delivery is buyout-only. The rider collects your payment first, pays the seller, then delivers the item.
                </Text>
              </Box>

              {/* Action Row */}
              <HStack justify="flex-end" spacing={3} pt={2}>
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
                  isDisabled={!cashAmount || Number(cashAmount) <= 0 || !tradeOption || (tradeOption === 'delivery' && !resolvedDeliveryAddress())}
                  fontSize="11px"
                  fontWeight="600"
                  height="36px"
                  flex="2"
                  leftIcon={<FaCreditCard />}
                  _hover={{ bg: '#158A63' }}
                  _active={{ bg: '#0F5A42' }}
                >
                  Confirm Buyout
                </Button>
              </HStack>
            </VStack>
          ) : (
            <VStack spacing={4}>
              <Text color="gray.600" fontSize="12px">You need to be signed in to purchase items.</Text>
              <HStack spacing={3} w="full">
                <Button onClick={onClose} as={'a'} href="/login" colorScheme="brand" flex={1} size="sm">Sign In</Button>
                <Button onClick={onClose} as={'a'} href="/register" variant="outline" flex={1} size="sm">Sign Up</Button>
              </HStack>
            </VStack>
          )}
        </ModalBody>
      </ModalContent>
    </Modal>
  )
}

export default BuyoutModal
