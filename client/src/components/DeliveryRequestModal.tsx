import React, { useState, useEffect } from 'react'
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalCloseButton,
  ModalBody,
  ModalFooter,
  VStack,
  HStack,
  FormControl,
  FormLabel,
  Input,
  Textarea,
  Button,
  Radio,
  RadioGroup,
  Stack,
  Text,
  Badge,
  Alert,
  AlertIcon,
  AlertDescription,
  Box,
  Icon,
  useToast,
  useColorModeValue,
  Spinner,
} from '@chakra-ui/react'
import { FaMapMarkerAlt, FaTruck, FaExclamationTriangle, FaLocationArrow } from 'react-icons/fa'
import { api } from '../services/api'
import { DeliveryRequest, DeliveryType, Product } from '../types'
import { formatPHP } from '../utils/currency'

interface DeliveryRequestModalProps {
  isOpen: boolean
  onClose: () => void
  onSuccess?: (deliveryId: number) => void
  tradeId?: number
  products: Product[] // Products to be delivered
}

const DeliveryRequestModal: React.FC<DeliveryRequestModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  tradeId,
  products,
}) => {
  const toast = useToast()
  const [deliveryType, setDeliveryType] = useState<DeliveryType>('standard')
  const [pickupAddress, setPickupAddress] = useState('')
  const [deliveryAddress, setDeliveryAddress] = useState('')
  const [specialInstructions, setSpecialInstructions] = useState('')
  const [pickupLatitude, setPickupLatitude] = useState<number | undefined>()
  const [pickupLongitude, setPickupLongitude] = useState<number | undefined>()
  const [deliveryLatitude, setDeliveryLatitude] = useState<number | undefined>()
  const [deliveryLongitude, setDeliveryLongitude] = useState<number | undefined>()
  const [isGettingLocation, setIsGettingLocation] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [locationPermission, setLocationPermission] = useState<'granted' | 'denied' | 'prompt'>('prompt')

  const cardBg = useColorModeValue('white', 'gray.800')
  const borderColor = useColorModeValue('gray.200', 'gray.700')
  const selectedBg = useColorModeValue('brand.50', 'brand.900')
  const selectedBorder = useColorModeValue('brand.500', 'brand.400')

  // Calculate cost
  const totalCost = deliveryType === 'express' ? 60 : 30

  // Validate item count based on delivery type
  const itemCount = products.length
  const isValidItemCount =
    (deliveryType === 'standard' && itemCount <= 5) ||
    (deliveryType === 'express' && itemCount === 1)

  // Check for fragile items
  const hasFragileItems = products.some(
    (p) =>
      p.description?.toLowerCase().includes('fragile') ||
      p.description?.toLowerCase().includes('breakable') ||
      p.description?.toLowerCase().includes('glass') ||
      p.category?.toLowerCase().includes('electronics')
  )

  // Get user location
  const getCurrentLocation = () => {
    if (!navigator.geolocation) {
      toast({
        title: 'Location not supported',
        description: 'Your browser does not support geolocation.',
        status: 'warning',
      })
      return
    }

    setIsGettingLocation(true)
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setPickupLatitude(position.coords.latitude)
        setPickupLongitude(position.coords.longitude)
        setLocationPermission('granted')
        setIsGettingLocation(false)
        toast({
          title: 'Location detected',
          description: 'GPS coordinates have been captured.',
          status: 'success',
          duration: 2000,
        })
      },
      (error) => {
        setIsGettingLocation(false)
        setLocationPermission('denied')
        toast({
          title: 'Location access denied',
          description: 'Please enter your address manually.',
          status: 'warning',
        })
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
    )
  }

  // Reset form when modal closes
  useEffect(() => {
    if (!isOpen) {
      setDeliveryType('standard')
      setPickupAddress('')
      setDeliveryAddress('')
      setSpecialInstructions('')
      setPickupLatitude(undefined)
      setPickupLongitude(undefined)
      setDeliveryLatitude(undefined)
      setDeliveryLongitude(undefined)
      setLocationPermission('prompt')
    }
  }, [isOpen])

  // Auto-detect location when modal opens
  useEffect(() => {
    if (isOpen && locationPermission === 'prompt') {
      getCurrentLocation()
    }
  }, [isOpen])

  const handleSubmit = async () => {
    // Validation
    if (!pickupAddress.trim() && !pickupLatitude) {
      toast({
        title: 'Pickup location required',
        description: 'Please provide a pickup address or allow location access.',
        status: 'warning',
      })
      return
    }

    if (!deliveryAddress.trim() && !deliveryLongitude) {
      toast({
        title: 'Delivery address required',
        description: 'Please provide a delivery address.',
        status: 'warning',
      })
      return
    }

    if (!isValidItemCount) {
      toast({
        title: 'Invalid item count',
        description:
          deliveryType === 'express'
            ? 'Express delivery allows only 1 item.'
            : 'Standard delivery allows maximum 5 items.',
        status: 'error',
      })
      return
    }

    try {
      setIsSubmitting(true)

      const payload: DeliveryRequest = {
        trade_id: tradeId,
        delivery_type: deliveryType,
        pickup_latitude: pickupLatitude,
        pickup_longitude: pickupLongitude,
        pickup_address: pickupAddress || 'GPS Location',
        delivery_latitude: deliveryLatitude,
        delivery_longitude: deliveryLongitude,
        delivery_address: deliveryAddress,
        special_instructions: specialInstructions.trim() || undefined,
        product_ids: products.map((p) => p.id),
      }

      const response = await api.post('/api/deliveries', payload)
      const delivery = response.data?.data

      toast({
        title: 'Delivery request created',
        description: 'Your delivery has been added to the rider queue.',
        status: 'success',
      })

      if (onSuccess && delivery?.id) {
        onSuccess(delivery.id)
      }

      onClose()
    } catch (error: any) {
      toast({
        title: 'Failed to create delivery',
        description: error?.response?.data?.error || 'Please try again.',
        status: 'error',
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} isCentered size="xl">
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>Request Delivery</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <VStack spacing={4} align="stretch">
            {/* Delivery Type Selection */}
            <FormControl isRequired>
              <FormLabel fontWeight="semibold">Delivery Type</FormLabel>
              <RadioGroup value={deliveryType} onChange={(value) => setDeliveryType(value as DeliveryType)}>
                <Stack direction="row" spacing={6}>
                  <Radio value="standard" colorScheme="brand">
                    Standard
                  </Radio>
                  <Radio value="express" colorScheme="brand">
                    Express
                  </Radio>
                </Stack>
              </RadioGroup>
              <Text fontSize="xs" color="gray.600" mt={2}>
                Standard: ₱30, 2-4 hours, up to 5 items | Express: ₱60, ~1 hour, 1 item only
              </Text>
            </FormControl>

            {/* Warning for Standard with fragile items */}
            {deliveryType === 'standard' && hasFragileItems && (
              <Alert status="warning" borderRadius="md">
                <AlertIcon />
                <AlertDescription fontSize="sm">
                  <Text fontWeight="semibold">Shared handling – avoid for fragile items.</Text>
                  <Text fontSize="xs" mt={1}>
                    Your items may be fragile. Consider Express delivery for maximum care.
                  </Text>
                </AlertDescription>
              </Alert>
            )}

            {/* Items Summary */}
            <Box borderWidth="1px" borderRadius="md" p={3} bg={cardBg} borderColor={borderColor}>
              <Text fontWeight="semibold" fontSize="sm" mb={2}>
                Items to Deliver ({itemCount})
              </Text>
              <VStack align="stretch" spacing={1}>
                {products.map((product) => (
                  <Text key={product.id} fontSize="xs" color="gray.600">
                    • {product.title}
                  </Text>
                ))}
              </VStack>
            </Box>

            {/* Pickup Location */}
            <FormControl isRequired>
              <FormLabel fontWeight="semibold">Pickup Location</FormLabel>
              <HStack spacing={2} mb={2}>
                <Button
                  size="sm"
                  leftIcon={<Icon as={FaLocationArrow} />}
                  onClick={getCurrentLocation}
                  isLoading={isGettingLocation}
                  variant="outline"
                  colorScheme="brand"
                >
                  Use GPS Location
                </Button>
                {pickupLatitude && pickupLongitude && (
                  <Badge colorScheme="green" fontSize="xs">
                    GPS: {pickupLatitude.toFixed(6)}, {pickupLongitude.toFixed(6)}
                  </Badge>
                )}
              </HStack>
              <Textarea
                placeholder="Enter pickup address (or use GPS location above)"
                value={pickupAddress}
                onChange={(e) => setPickupAddress(e.target.value)}
                rows={2}
              />
              <Text fontSize="xs" color="gray.500" mt={1}>
                GPS coordinates will be used if available, otherwise address will be used
              </Text>
            </FormControl>

            {/* Delivery Address */}
            <FormControl isRequired>
              <FormLabel fontWeight="semibold">Delivery Address</FormLabel>
              <Textarea
                placeholder="Enter complete delivery address"
                value={deliveryAddress}
                onChange={(e) => setDeliveryAddress(e.target.value)}
                rows={3}
              />
            </FormControl>

            {/* Special Instructions */}
            <FormControl>
              <FormLabel>Special Instructions (Optional)</FormLabel>
              <Textarea
                placeholder="Any special handling instructions for the rider..."
                value={specialInstructions}
                onChange={(e) => setSpecialInstructions(e.target.value)}
                rows={3}
              />
            </FormControl>

            {/* Cost Display */}
            <Box
              borderWidth="2px"
              borderColor="brand.200"
              borderRadius="md"
              p={4}
              bg={selectedBg}
            >
              <HStack justify="space-between">
                <VStack align="start" spacing={0}>
                  <Text fontSize="sm" color="gray.600">
                    Delivery Type
                  </Text>
                  <Text fontWeight="bold" fontSize="lg" textTransform="capitalize">
                    {deliveryType}
                  </Text>
                </VStack>
                <VStack align="end" spacing={0}>
                  <Text fontSize="sm" color="gray.600">
                    Total Cost
                  </Text>
                  <Text fontWeight="bold" fontSize="xl" color="brand.600">
                    {formatPHP(totalCost)}
                  </Text>
                </VStack>
              </HStack>
            </Box>

            {/* Info Alert */}
            <Alert status="info" borderRadius="md" fontSize="sm">
              <AlertIcon />
              <AlertDescription>
                Your delivery will be added to the rider queue. A rider will claim it when available.
                {deliveryType === 'express' && (
                  <Text mt={1} fontWeight="semibold">
                    Express: Exclusive handling – maximum care.
                  </Text>
                )}
                {deliveryType === 'standard' && (
                  <Text mt={1}>
                    Standard: Shared batch – avoid for fragile items.
                  </Text>
                )}
              </AlertDescription>
            </Alert>
          </VStack>
        </ModalBody>
        <ModalFooter>
          <HStack spacing={3}>
            <Button variant="ghost" onClick={onClose} isDisabled={isSubmitting}>
              Cancel
            </Button>
            <Button
              colorScheme="brand"
              onClick={handleSubmit}
              isLoading={isSubmitting}
              isDisabled={!isValidItemCount || (!pickupAddress.trim() && !pickupLatitude) || !deliveryAddress.trim()}
              leftIcon={<Icon as={FaTruck} />}
            >
              Request Delivery
            </Button>
          </HStack>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

export default DeliveryRequestModal

