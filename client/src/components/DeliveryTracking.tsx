import React, { useState, useEffect, useRef } from 'react'
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
  Box,
  Text,
  Badge,
  Progress,
  Icon,
  useToast,
  Spinner,
  Card,
  CardBody,
  Divider,
  Alert,
  AlertIcon,
  AlertDescription,
  useColorModeValue,
  Avatar,
  SimpleGrid,
  Button,
} from '@chakra-ui/react'
import {
  FaTruck,
  FaMapMarkerAlt,
  FaClock,
  FaCheckCircle,
  FaUser,
  FaMotorcycle,
  FaBicycle,
  FaCar,
  FaStar,
} from 'react-icons/fa'
import { api } from '../services/api'
import { Delivery, DeliveryStatus } from '../types'
import { formatPHP } from '../utils/currency'

interface DeliveryTrackingProps {
  isOpen: boolean
  onClose: () => void
  deliveryId: number
}

const DeliveryTracking: React.FC<DeliveryTrackingProps> = ({ isOpen, onClose, deliveryId }) => {
  const toast = useToast()
  const [delivery, setDelivery] = useState<Delivery | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const cardBg = useColorModeValue('white', 'gray.800')
  const borderColor = useColorModeValue('gray.200', 'gray.700')

  // Status progression
  const statusSteps: { status: DeliveryStatus; label: string; icon: any }[] = [
    { status: 'pending', label: 'Pending', icon: FaClock },
    { status: 'claimed', label: 'Claimed', icon: FaUser },
    { status: 'picked_up', label: 'Picked Up', icon: FaTruck },
    { status: 'in_transit', label: 'In Transit', icon: FaTruck },
    { status: 'delivered', label: 'Delivered', icon: FaCheckCircle },
  ]

  const getCurrentStepIndex = () => {
    if (!delivery) return 0
    return statusSteps.findIndex((step) => step.status === delivery.status)
  }

  const fetchDelivery = async () => {
    try {
      setLoading(true)
      setError(null)
      const response = await api.get(`/api/deliveries/${deliveryId}`)
      const deliveryData = response.data?.data
      if (deliveryData) {
        setDelivery(deliveryData)
      } else {
        setError('Delivery not found')
      }
    } catch (err: any) {
      setError(err?.response?.data?.error || 'Failed to fetch delivery')
      toast({
        title: 'Error',
        description: 'Failed to load delivery information',
        status: 'error',
      })
    } finally {
      setLoading(false)
    }
  }

  // Auto-refresh every 5 seconds if delivery is active
  useEffect(() => {
    if (isOpen && deliveryId) {
      fetchDelivery()

      // Set up auto-refresh for active deliveries
      intervalRef.current = setInterval(() => {
        if (delivery && delivery.status !== 'delivered' && delivery.status !== 'cancelled') {
          fetchDelivery()
        }
      }, 5000) // Refresh every 5 seconds

      return () => {
        if (intervalRef.current) {
          clearInterval(intervalRef.current)
        }
      }
    }
  }, [isOpen, deliveryId])

  // Cleanup interval on unmount
  useEffect(() => {
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
      }
    }
  }, [])

  const getStatusColor = (status: DeliveryStatus) => {
    switch (status) {
      case 'pending':
        return 'yellow'
      case 'claimed':
        return 'blue'
      case 'picked_up':
        return 'purple'
      case 'in_transit':
        return 'orange'
      case 'delivered':
        return 'green'
      case 'cancelled':
        return 'red'
      default:
        return 'gray'
    }
  }

  const getVehicleIcon = (vehicleType?: string) => {
    switch (vehicleType) {
      case 'motorcycle':
        return FaMotorcycle
      case 'bicycle':
        return FaBicycle
      case 'car':
        return FaCar
      default:
        return FaTruck
    }
  }

  const formatETA = (eta?: string) => {
    if (!eta) return 'Calculating...'
    const etaDate = new Date(eta)
    const now = new Date()
    const diffMs = etaDate.getTime() - now.getTime()
    const diffMins = Math.floor(diffMs / 60000)

    if (diffMins < 0) return 'Arriving soon'
    if (diffMins < 60) return `${diffMins} minutes`
    const hours = Math.floor(diffMins / 60)
    const mins = diffMins % 60
    return `${hours}h ${mins}m`
  }

  if (loading && !delivery) {
    return (
      <Modal isOpen={isOpen} onClose={onClose} isCentered size="xl">
        <ModalOverlay />
        <ModalContent>
          <ModalBody>
            <VStack spacing={4} py={8}>
              <Spinner size="xl" color="brand.500" />
              <Text>Loading delivery information...</Text>
            </VStack>
          </ModalBody>
        </ModalContent>
      </Modal>
    )
  }

  if (error || !delivery) {
    return (
      <Modal isOpen={isOpen} onClose={onClose} isCentered size="xl">
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Delivery Tracking</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <Alert status="error">
              <AlertIcon />
              <AlertDescription>{error || 'Delivery not found'}</AlertDescription>
            </Alert>
          </ModalBody>
        </ModalContent>
      </Modal>
    )
  }

  const currentStep = getCurrentStepIndex()
  const progress = ((currentStep + 1) / statusSteps.length) * 100

  return (
    <Modal isOpen={isOpen} onClose={onClose} isCentered size="xl">
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>Delivery Tracking</ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <VStack spacing={4} align="stretch">
            {/* Status Progress */}
            <Box>
              <HStack justify="space-between" mb={2}>
                <Text fontWeight="semibold">Status</Text>
                <Badge colorScheme={getStatusColor(delivery.status)} fontSize="sm" px={2} py={1}>
                  {delivery.status.replace('_', ' ').toUpperCase()}
                </Badge>
              </HStack>
              <Progress value={progress} colorScheme={getStatusColor(delivery.status)} size="sm" borderRadius="full" />
              <SimpleGrid columns={statusSteps.length} spacing={2} mt={3}>
                {statusSteps.map((step, index) => {
                  const isActive = index <= currentStep
                  const isCurrent = index === currentStep
                  const StepIcon = step.icon
                  return (
                    <VStack key={step.status} spacing={1}>
                      <Box
                        p={2}
                        borderRadius="full"
                        bg={isActive ? `${getStatusColor(delivery.status)}.500` : 'gray.200'}
                        color={isActive ? 'white' : 'gray.600'}
                      >
                        <Icon as={StepIcon} boxSize={4} />
                      </Box>
                      <Text fontSize="xs" textAlign="center" fontWeight={isCurrent ? 'bold' : 'normal'}>
                        {step.label}
                      </Text>
                    </VStack>
                  )
                })}
              </SimpleGrid>
            </Box>

            <Divider />

            {/* Delivery Details */}
            <Card bg={cardBg} borderWidth="1px" borderColor={borderColor}>
              <CardBody>
                <VStack spacing={3} align="stretch">
                  <HStack justify="space-between">
                    <Text fontSize="sm" color="gray.600">
                      Delivery Type
                    </Text>
                    <Badge colorScheme={delivery.delivery_type === 'express' ? 'purple' : 'blue'} textTransform="capitalize">
                      {delivery.delivery_type}
                    </Badge>
                  </HStack>
                  <HStack justify="space-between">
                    <Text fontSize="sm" color="gray.600">
                      Total Cost
                    </Text>
                    <Text fontWeight="bold">{formatPHP(delivery.total_cost)}</Text>
                  </HStack>
                  <HStack justify="space-between">
                    <Text fontSize="sm" color="gray.600">
                      Items
                    </Text>
                    <Text>{delivery.item_count} item{delivery.item_count !== 1 ? 's' : ''}</Text>
                  </HStack>
                  {delivery.is_fragile && (
                    <Alert status="warning" size="sm" borderRadius="md">
                      <AlertIcon />
                      <AlertDescription fontSize="xs">Fragile items - handle with care</AlertDescription>
                    </Alert>
                  )}
                </VStack>
              </CardBody>
            </Card>

            {/* Rider Information (if claimed) */}
            {delivery.status !== 'pending' && delivery.rider_id && (
              <>
                <Divider />
                <Card bg={cardBg} borderWidth="1px" borderColor={borderColor}>
                  <CardBody>
                    <VStack spacing={3} align="stretch">
                      <HStack>
                        <Icon as={FaUser} color="brand.500" />
                        <Text fontWeight="semibold">Rider Information</Text>
                      </HStack>
                      <HStack spacing={3}>
                        <Avatar size="md" name={delivery.rider_name || 'Rider'} />
                        <VStack align="start" spacing={0} flex={1}>
                          <Text fontWeight="semibold">{delivery.rider_name || 'Rider'}</Text>
                          <HStack spacing={2}>
                            <Icon as={getVehicleIcon(delivery.rider_vehicle)} boxSize={4} color="gray.600" />
                            <Text fontSize="sm" color="gray.600" textTransform="capitalize">
                              {delivery.rider_vehicle || 'Vehicle'}
                            </Text>
                          </HStack>
                          {delivery.rider_rating && (
                            <HStack spacing={1}>
                              <Icon as={FaStar} color="yellow.400" boxSize={3} />
                              <Text fontSize="sm">{delivery.rider_rating.toFixed(1)}</Text>
                            </HStack>
                          )}
                        </VStack>
                      </HStack>
                      {delivery.rider_latitude && delivery.rider_longitude && (
                        <Alert status="info" size="sm" borderRadius="md">
                          <AlertIcon />
                          <AlertDescription fontSize="xs">
                            Rider location: {delivery.rider_latitude.toFixed(4)}, {delivery.rider_longitude.toFixed(4)}
                          </AlertDescription>
                        </Alert>
                      )}
                    </VStack>
                  </CardBody>
                </Card>
              </>
            )}

            {/* ETA */}
            {delivery.estimated_eta && (
              <>
                <Divider />
                <HStack spacing={2}>
                  <Icon as={FaClock} color="brand.500" />
                  <Text fontWeight="semibold">Estimated Arrival</Text>
                </HStack>
                <Text fontSize="lg" color="brand.600">
                  {formatETA(delivery.estimated_eta)}
                </Text>
                <Text fontSize="xs" color="gray.500">
                  {new Date(delivery.estimated_eta).toLocaleString()}
                </Text>
              </>
            )}

            {/* Addresses */}
            <Divider />
            <VStack spacing={3} align="stretch">
              <Box>
                <HStack mb={2}>
                  <Icon as={FaMapMarkerAlt} color="green.500" />
                  <Text fontWeight="semibold">Pickup Location</Text>
                </HStack>
                <Text fontSize="sm" color="gray.700">
                  {delivery.pickup_address}
                </Text>
                {delivery.pickup_latitude && delivery.pickup_longitude && (
                  <Text fontSize="xs" color="gray.500" mt={1}>
                    GPS: {delivery.pickup_latitude.toFixed(6)}, {delivery.pickup_longitude.toFixed(6)}
                  </Text>
                )}
              </Box>
              <Box>
                <HStack mb={2}>
                  <Icon as={FaMapMarkerAlt} color="red.500" />
                  <Text fontWeight="semibold">Delivery Address</Text>
                </HStack>
                <Text fontSize="sm" color="gray.700">
                  {delivery.delivery_address}
                </Text>
                {delivery.delivery_latitude && delivery.delivery_longitude && (
                  <Text fontSize="xs" color="gray.500" mt={1}>
                    GPS: {delivery.delivery_latitude.toFixed(6)}, {delivery.delivery_longitude.toFixed(6)}
                  </Text>
                )}
              </Box>
            </VStack>

            {/* Special Instructions */}
            {delivery.special_instructions && (
              <>
                <Divider />
                <Box>
                  <Text fontWeight="semibold" mb={2}>
                    Special Instructions
                  </Text>
                  <Text fontSize="sm" color="gray.700">
                    {delivery.special_instructions}
                  </Text>
                </Box>
              </>
            )}

            {/* Status Messages */}
            {delivery.status === 'pending' && (
              <Alert status="info" borderRadius="md">
                <AlertIcon />
                <AlertDescription fontSize="sm">
                  Waiting for a rider to claim your delivery. You'll be notified once a rider picks it up.
                </AlertDescription>
              </Alert>
            )}
            {delivery.status === 'claimed' && (
              <Alert status="success" borderRadius="md">
                <AlertIcon />
                <AlertDescription fontSize="sm">
                  A rider has claimed your delivery! They will pick it up soon.
                </AlertDescription>
              </Alert>
            )}
            {delivery.delivery_type === 'standard' && (
              <Alert status="warning" borderRadius="md" size="sm">
                <AlertIcon />
                <AlertDescription fontSize="xs">
                  Shared batch – avoid for fragile items.
                </AlertDescription>
              </Alert>
            )}
            {delivery.delivery_type === 'express' && (
              <Alert status="success" borderRadius="md" size="sm">
                <AlertIcon />
                <AlertDescription fontSize="xs">
                  Exclusive handling – maximum care.
                </AlertDescription>
              </Alert>
            )}
          </VStack>
        </ModalBody>
        <ModalFooter>
          <Button colorScheme="brand" onClick={onClose}>
            Close
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

export default DeliveryTracking

