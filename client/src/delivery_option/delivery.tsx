import React, { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import {
  Box,
  VStack,
  HStack,
  Heading,
  Text,
  Button,
  Textarea,
  FormControl,
  FormLabel,
  useToast,
  SimpleGrid,
  useColorModeValue,
  Badge,
  Card,
  CardBody,
  Icon,
  Alert,
  AlertIcon,
  AlertTitle,
  AlertDescription,
  Spinner,
} from '@chakra-ui/react'
import { CheckCircleIcon } from '@chakra-ui/icons'
import { FaTruck, FaClock, FaLocationArrow, FaMap } from 'react-icons/fa'
import { api } from '../services/api'
import { DeliveryRequest, Product } from '../types'
import DeliveryTracking from '../components/DeliveryTracking'
import { useAuth } from '../contexts/AuthContext'

const DeliveryUI: React.FC = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const toast = useToast()
  const { user } = useAuth()
  const bgColor = useColorModeValue('white', 'gray.800')
  const borderColor = useColorModeValue('gray.200', 'gray.700')

  const [selectedDelivery, setSelectedDelivery] = useState<string>('standard')
  const [deliveryAddress, setDeliveryAddress] = useState('')
  const [notes, setNotes] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [deliveryLatitude, setDeliveryLatitude] = useState<number | undefined>()
  const [deliveryLongitude, setDeliveryLongitude] = useState<number | undefined>()
  const [isGettingLocation, setIsGettingLocation] = useState(false)
  const [showMap, setShowMap] = useState(false)
  const [products, setProducts] = useState<Product[]>([])
  const [loadingProducts, setLoadingProducts] = useState(true)
  const [deliveryTrackingOpen, setDeliveryTrackingOpen] = useState(false)
  const [currentDeliveryId, setCurrentDeliveryId] = useState<number | null>(null)
  const [tradeId, setTradeId] = useState<number | undefined>()
  const [showProductsList, setShowProductsList] = useState(false)

  const deliveryOptions = [
    {
      id: 'standard',
      name: 'Standard Delivery',
      description: 'Batch up to 5 orders',
      icon: FaTruck,
      cost: 30,
      estimatedDays: '2-4hrs',
      maxOrders: 5,
      features: [
        '₱30 flat rate',
        'Up to 5 orders batched',
        'Shared rider route',
        'Real-time tracking',
      ],
      available: true,
    },
    {
      id: 'express',
      name: 'Express Delivery',
      description: 'Single order only',
      icon: FaClock,
      cost: 60,
      estimatedDays: '~1 hour',
      maxOrders: 1,
      features: [
        '₱60 priority rate',
        'Single order exclusive',
        'No batching',
        'Priority handling',
      ],
      available: true,
    },
  ]

  // Get products from location state or fetch from API
  useEffect(() => {
    const fetchProducts = async () => {
      setLoadingProducts(true)
      try {
        // Check if products are passed via location state
        const stateProducts = (location.state as any)?.products as Product[] | undefined
        const stateTradeId = (location.state as any)?.tradeId as number | undefined
        
        if (stateProducts && stateProducts.length > 0) {
          setProducts(stateProducts)
          setTradeId(stateTradeId)
        } else if (user) {
          // If no products in state, try to get user's available products
          const response = await api.get(`/api/products/user/${user.id}?status=available&limit=10`)
          const data = response.data?.data
          const productList: Product[] = Array.isArray(data?.data) ? data.data : []
          setProducts(productList)
        }
      } catch (error) {
        console.error('Failed to fetch products:', error)
        toast({
          title: 'Error',
          description: 'Failed to load products',
          status: 'error',
        })
      } finally {
        setLoadingProducts(false)
      }
    }

    fetchProducts()
  }, [location.state, user])

  // Auto-detect location when component mounts
  useEffect(() => {
    if (navigator.geolocation) {
      setIsGettingLocation(true)
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const lat = position.coords.latitude
          const lng = position.coords.longitude
          setDeliveryLatitude(lat)
          setDeliveryLongitude(lng)
          
          // Reverse geocode to get address
          try {
            const address = await reverseGeocode(lat, lng)
            setDeliveryAddress(address)
          } catch (error) {
            console.error('Reverse geocoding failed:', error)
          }
          setIsGettingLocation(false)
        },
        () => setIsGettingLocation(false),
        { enableHighAccuracy: true, timeout: 10000 }
      )
    }
  }, [])

  const reverseGeocode = async (latitude: number, longitude: number): Promise<string> => {
    try {
      // Using Nominatim (free, no API key required)
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`
      )
      const data = await response.json()
      return data.address?.road || data.address?.street || data.display_name || `${latitude}, ${longitude}`
    } catch (error) {
      console.error('Reverse geocoding error:', error)
      return `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`
    }
  }

  const getCurrentLocation = async () => {
    if (!navigator.geolocation) {
      toast({ title: 'Not supported', description: 'Geolocation not available', status: 'warning' })
      return
    }

    setIsGettingLocation(true)
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = position.coords.latitude
        const lng = position.coords.longitude
        setDeliveryLatitude(lat)
        setDeliveryLongitude(lng)
        
        // Reverse geocode to get address
        try {
          const address = await reverseGeocode(lat, lng)
          setDeliveryAddress(address)
          toast({ title: 'Location detected & address filled', status: 'success', duration: 2000 })
        } catch (error) {
          toast({ title: 'Location detected', description: 'Could not find address', status: 'info', duration: 2000 })
        }
        setIsGettingLocation(false)
      },
      () => {
        setIsGettingLocation(false)
        toast({ title: 'Location access denied', description: 'Enter address manually', status: 'warning' })
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    )
  }

  const handleSubmit = async () => {
    const selectedOption = deliveryOptions.find(d => d.id === selectedDelivery)
    const maxOrders = selectedOption?.maxOrders || 1

    if (!deliveryAddress.trim() && !deliveryLatitude) {
      toast({ title: 'Missing Delivery Address', status: 'warning', duration: 3000 })
      return
    }

    if (products.length === 0) {
      toast({ title: 'No Orders Selected', description: 'Please select orders to deliver', status: 'warning', duration: 3000 })
      return
    }

    if (products.length > maxOrders) {
      toast({
        title: 'Too Many Orders',
        description: `${selectedDelivery === 'express' ? 'Express' : 'Standard'} delivery allows maximum ${maxOrders} order(s)`,
        status: 'error',
        duration: 3000,
      })
      return
    }

    setIsProcessing(true)
    try {
      const payload: DeliveryRequest = {
        trade_id: tradeId,
        delivery_type: selectedDelivery as 'standard' | 'express',
        pickup_latitude: undefined,
        pickup_longitude: undefined,
        pickup_address: '',
        delivery_latitude: deliveryLatitude,
        delivery_longitude: deliveryLongitude,
        delivery_address: deliveryAddress || 'GPS Location',
        special_instructions: notes.trim() || undefined,
        product_ids: products.map((p) => p.id),
      }

      const response = await api.post('/api/deliveries', payload)
      const delivery = response.data?.data

      toast({ title: 'Delivery Request Created', status: 'success', duration: 2000 })

      // Show tracking modal
      if (delivery?.id) {
        setCurrentDeliveryId(delivery.id)
        setDeliveryTrackingOpen(true)
      }
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error?.response?.data?.error || 'Failed to create delivery',
        status: 'error',
        duration: 3000,
      })
    } finally {
      setIsProcessing(false)
    }
  }

  const selectedOption = deliveryOptions.find(d => d.id === selectedDelivery)

  return (
    <Box minH="100vh" bg="#FFFDF1" py={6} px={4}>
      <Box maxW="md" mx="auto">
        <VStack spacing={4} align="stretch">
          {/* Header */}
          <VStack spacing={1} align="start">
            <Heading size="md" color="brand.500">Delivery Option</Heading>
            <Text fontSize="sm" color="gray.600">Choose your delivery preference</Text>
          </VStack>

          {/* Delivery Options */}
          <SimpleGrid columns={2} spacing={3}>
            {deliveryOptions.map((option) => (
              <Card
                key={option.id}
                bg={bgColor}
                border="2px solid"
                borderColor={selectedDelivery === option.id ? 'brand.500' : borderColor}
                cursor="pointer"
                transition="all 0.2s"
                _hover={{ shadow: 'md', borderColor: 'brand.400' }}
                onClick={() => setSelectedDelivery(option.id)}
              >
                <CardBody p={3}>
                  <VStack spacing={2} align="stretch">
                    <HStack justify="space-between" align="flex-start">
                      <Box p={2} bg="brand.50" borderRadius="lg" display="flex" alignItems="center" justifyContent="center">
                        <Icon as={option.icon} boxSize={5} color="brand.500" />
                      </Box>
                      <HStack spacing={1}>
                        {selectedDelivery === option.id && <Icon as={CheckCircleIcon} boxSize={4} color="green.500" />}
                        <Badge fontSize="2xs" colorScheme={option.id === 'standard' ? 'blue' : 'purple'}>
                          {option.id === 'standard' ? '📦' : '⭐'}
                        </Badge>
                      </HStack>
                    </HStack>

                    <VStack spacing={0} align="start">
                      <Text fontWeight="bold" fontSize="sm">{option.name}</Text>
                      <Text fontSize="xs" color="gray.600">{option.description}</Text>
                    </VStack>

                    <HStack justify="space-between" fontSize="xs">
                      <Text fontWeight="bold" color="brand.600">₱{option.cost}</Text>
                      <Text fontWeight="bold">{option.estimatedDays}</Text>
                    </HStack>
                  </VStack>
                </CardBody>
              </Card>
            ))}
          </SimpleGrid>

          {/* Selected Details */}
          {selectedOption && (
            <Card bg={bgColor} border="1px" borderColor={borderColor}>
              <CardBody p={4}>
                <VStack spacing={3} align="stretch">
                  {/* Info Alert */}
                  {selectedOption.id === 'standard' && (
                    <Alert status="info" borderRadius="md" fontSize="xs">
                      <AlertIcon boxSize={4} />
                      <VStack align="start" spacing={0} ml={2}>
                        <AlertTitle fontSize="xs">Batch Delivery</AlertTitle>
                        <AlertDescription fontSize="2xs">
                          Up to {selectedOption.maxOrders} orders will be grouped together with other orders
                        </AlertDescription>
                      </VStack>
                    </Alert>
                  )}

                  {selectedOption.id === 'express' && (
                    <Alert status="success" borderRadius="md" fontSize="xs">
                      <AlertIcon boxSize={4} />
                      <VStack align="start" spacing={0} ml={2}>
                        <AlertTitle fontSize="xs">Exclusive Delivery</AlertTitle>
                        <AlertDescription fontSize="2xs">
                          Your order will be delivered exclusively by a single rider
                        </AlertDescription>
                      </VStack>
                    </Alert>
                  )}

                  {/* Delivery Address - With GPS */}
                  <FormControl isRequired>
                    <FormLabel fontSize="sm" fontWeight="bold">Delivery Location</FormLabel>
                    <HStack spacing={2} mb={3}>
                      <Button
                        size="sm"
                        leftIcon={<Icon as={FaLocationArrow} />}
                        onClick={getCurrentLocation}
                        isLoading={isGettingLocation}
                        variant="solid"
                        colorScheme="brand"
                        flex={1}
                      >
                        {isGettingLocation ? 'Detecting...' : 'Use GPS'}
                      </Button>
                      {deliveryLatitude && deliveryLongitude && (
                        <Button
                          size="sm"
                          leftIcon={<Icon as={FaMap} />}
                          variant="outline"
                          colorScheme="brand"
                          onClick={() => setShowMap(!showMap)}
                        >
                          {showMap ? 'Hide Map' : 'View Map'}
                        </Button>
                      )}
                    </HStack>

                    {/* Location Display */}
                    {deliveryAddress && (
                      <Card bg="brand.50" border="2px" borderColor="brand.200" p={3} mb={2}>
                        <HStack spacing={2}>
                          <Icon as={FaLocationArrow} color="brand.600" boxSize={5} />
                          <VStack align="start" spacing={0}>
                            <Text fontWeight="bold" fontSize="sm" color="gray.800">
                              {deliveryAddress}
                            </Text>
                            <Badge colorScheme="green" fontSize="2xs" mt={1}>
                              ✓ Location Detected
                            </Badge>
                          </VStack>
                        </HStack>
                      </Card>
                    )}

                    {!deliveryAddress && (
                      <Card bg="gray.50" border="1px dashed" borderColor="gray.300" p={3} mb={2}>
                        <Text fontSize="sm" color="gray.600" textAlign="center">
                          Tap "Use GPS" to detect your location
                        </Text>
                      </Card>
                    )}
                  </FormControl>

                  {/* Map Preview */}
                  {showMap && deliveryLatitude && deliveryLongitude && (
                    <Card bg="gray.50" border="1px" borderColor={borderColor}>
                      <CardBody p={3}>
                        <VStack spacing={2} align="stretch">
                          <Text fontWeight="bold" fontSize="sm">Location Map</Text>
                          <Box
                            as="iframe"
                            src={`https://www.openstreetmap.org/export/embed.html?bbox=${deliveryLongitude - 0.01},${deliveryLatitude - 0.01},${deliveryLongitude + 0.01},${deliveryLatitude + 0.01}&layer=mapnik&marker=${deliveryLatitude},${deliveryLongitude}`}
                            h="280px"
                            w="full"
                            borderRadius="md"
                            border="1px solid"
                            borderColor={borderColor}
                          />
                        </VStack>
                      </CardBody>
                    </Card>
                  )}

                  {/* Notes */}
                  <FormControl>
                    <FormLabel fontSize="sm" fontWeight="bold">Special Instructions (Optional)</FormLabel>
                    <Textarea
                      placeholder="Any special handling instructions..."
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      rows={2}
                      size="sm"
                    />
                  </FormControl>

                  {/* Cost Summary */}
                  <HStack justify="space-between" bg="gray.50" p={3} borderRadius="md" fontSize="sm">
                    <Text color="gray.600">Total Cost:</Text>
                    <Text fontWeight="bold" color="brand.600">₱{selectedOption.cost}</Text>
                  </HStack>


                  {/* Action Buttons */}
                  <HStack spacing={2}>
                    <Button variant="outline" size="sm" onClick={() => navigate(-1)} flex={1}>
                      Back
                    </Button>
                    <Button
                      colorScheme="brand"
                      size="sm"
                      flex={1}
                      onClick={handleSubmit}
                      isLoading={isProcessing}
                      isDisabled={products.length > selectedOption.maxOrders}
                    >
                      Confirm
                    </Button>
                  </HStack>
                </VStack>
              </CardBody>
            </Card>
          )}
        </VStack>
      </Box>

      {/* Delivery Tracking Modal */}
      {currentDeliveryId && (
        <DeliveryTracking
          isOpen={deliveryTrackingOpen}
          onClose={() => {
            setDeliveryTrackingOpen(false)
            setCurrentDeliveryId(null)
          }}
          deliveryId={currentDeliveryId}
        />
      )}

      {/* Loading State */}
      {loadingProducts && (
        <Box position="fixed" top="50%" left="50%" transform="translate(-50%, -50%)" zIndex={1000}>
          <VStack spacing={4}>
            <Spinner size="xl" color="brand.500" />
            <Text>Loading orders...</Text>
          </VStack>
        </Box>
      )}

      {/* No Products Warning */}
      {!loadingProducts && products.length === 0 && (
        <Alert status="warning" borderRadius="md" mt={4} maxW="md" mx="auto">
          <AlertIcon />
          <AlertDescription fontSize="sm">
            No orders selected. Navigate from a trade page to request delivery.
          </AlertDescription>
        </Alert>
      )}
    </Box>
  )
}

export default DeliveryUI

