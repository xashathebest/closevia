import React, { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Box,
  VStack,
  HStack,
  Heading,
  Text,
  Button,
  Card,
  CardBody,
  Badge,
  Icon,
  SimpleGrid,
  useToast,
  Tooltip,
  Tag,
  TagLabel,
  Progress,
  Divider,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  useDisclosure,
  Tabs,
  TabList,
  Tab,
  TabPanels,
  TabPanel,
  Spinner,
  Alert,
  AlertIcon,
  AlertDescription,
} from '@chakra-ui/react'
import { FaMapMarkerAlt, FaClock, FaBox, FaMoneyBillWave, FaCheckCircle, FaCar, FaMotorcycle, FaStar } from 'react-icons/fa'
import { InfoIcon, WarningIcon, CheckCircleIcon } from '@chakra-ui/icons'
import { api } from '../services/api'
import { Delivery, DeliveryStatus } from '../types'
import { useAuth } from '../contexts/AuthContext'

interface DeliveryJob {
  id: number
  tradeId?: number
  itemType?: string
  deliveryType: 'standard' | 'express'
  distance?: string
  distanceKm?: number
  fee: number
  pickupWindow?: string
  status: DeliveryStatus
  sender?: string
  recipient?: string
  pickupLocation: string
  dropoffLocation: string
  itemCount: number
  isFragile: boolean
  claimedBy?: string
  pickupLatitude?: number
  pickupLongitude?: number
  deliveryLatitude?: number
  deliveryLongitude?: number
  estimatedEta?: string
  user_name?: string
}

interface ClaimedBatch {
  batchId: string
  type: 'standard' | 'express'
  jobs: DeliveryJob[]
  totalEarnings: number
  totalDistance: string
  createdAt: string
}

interface Rider {
  id: number
  name: string
  rating: number
  vehicle: string
  eta_pickup: string
  eta_delivery: string
}

const RiderJobs: React.FC = () => {
  const navigate = useNavigate()
  const toast = useToast()
  const { user } = useAuth()
  const { isOpen, onOpen, onClose } = useDisclosure()

  const [pendingJobs, setPendingJobs] = useState<DeliveryJob[]>([])
  const [claimedDeliveries, setClaimedDeliveries] = useState<DeliveryJob[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedJob, setSelectedJob] = useState<DeliveryJob | null>(null)
  const [suggestedBatch, setSuggestedBatch] = useState<DeliveryJob[]>([])
  const [batchRiders, setBatchRiders] = useState<{ [batchId: string]: Rider }>({})

  // Calculate distance between two GPS coordinates
  const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
    const R = 6371 // Earth radius in kilometers
    const dLat = (lat2 - lat1) * Math.PI / 180
    const dLon = (lon2 - lon1) * Math.PI / 180
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLon/2) * Math.sin(dLon/2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
    return R * c
  }

  // Fetch available deliveries
  const fetchAvailableDeliveries = async () => {
    try {
      setLoading(true)
      const response = await api.get('/api/deliveries', {
        params: { status: 'pending' }
      })
      const deliveries: Delivery[] = response.data?.data || []
      
      // Convert to DeliveryJob format
      const jobs: DeliveryJob[] = deliveries.map((d: Delivery) => {
        let distanceKm = 0
        let distance = 'N/A'
        
        if (d.pickup_latitude && d.pickup_longitude && d.delivery_latitude && d.delivery_longitude) {
          distanceKm = calculateDistance(
            d.pickup_latitude,
            d.pickup_longitude,
            d.delivery_latitude,
            d.delivery_longitude
          )
          distance = `${distanceKm.toFixed(1)} km`
        }

        const etaDate = d.estimated_eta ? new Date(d.estimated_eta) : null
        const pickupWindow = etaDate 
          ? `${etaDate.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`
          : 'ASAP'

        return {
          id: d.id,
          tradeId: d.trade_id,
          deliveryType: d.delivery_type as 'standard' | 'express',
          distance,
          distanceKm,
          fee: d.total_cost,
          pickupWindow,
          status: d.status,
          sender: d.user_name || 'Customer',
          pickupLocation: d.pickup_address,
          dropoffLocation: d.delivery_address,
          itemCount: d.item_count,
          isFragile: d.is_fragile,
          pickupLatitude: d.pickup_latitude,
          pickupLongitude: d.pickup_longitude,
          deliveryLatitude: d.delivery_latitude,
          deliveryLongitude: d.delivery_longitude,
          estimatedEta: d.estimated_eta,
          user_name: d.user_name,
        }
      })

      setPendingJobs(jobs)
    } catch (error: any) {
      console.error('Failed to fetch available deliveries:', error.response?.status, error.response?.data)
      if (error.response?.status === 400) {
        toast({
          title: 'Bad Request',
          description: 'Invalid query parameters. Please try again.',
          status: 'warning',
        })
      } else {
        toast({
          title: 'Error',
          description: error?.response?.data?.error || 'Failed to load available deliveries',
          status: 'error',
        })
      }
      setPendingJobs([])
    } finally {
      setLoading(false)
    }
  }

  // Fetch rider's claimed deliveries
  const fetchClaimedDeliveries = async () => {
    try {
      const response = await api.get('/api/deliveries', {
        params: { status: 'claimed,picked_up,in_transit' }
      })
      const deliveries: Delivery[] = response.data?.data || []
      
      const jobs: DeliveryJob[] = deliveries.map((d: Delivery) => {
        let distanceKm = 0
        let distance = 'N/A'
        
        if (d.pickup_latitude && d.pickup_longitude && d.delivery_latitude && d.delivery_longitude) {
          distanceKm = calculateDistance(
            d.pickup_latitude,
            d.pickup_longitude,
            d.delivery_latitude,
            d.delivery_longitude
          )
          distance = `${distanceKm.toFixed(1)} km`
        }

        return {
          id: d.id,
          tradeId: d.trade_id,
          deliveryType: d.delivery_type as 'standard' | 'express',
          distance,
          distanceKm,
          fee: d.total_cost,
          status: d.status,
          sender: d.user_name || 'Customer',
          pickupLocation: d.pickup_address,
          dropoffLocation: d.delivery_address,
          itemCount: d.item_count,
          isFragile: d.is_fragile,
          user_name: d.user_name,
        }
      })

      setClaimedDeliveries(jobs)
    } catch (error: any) {
      console.error('Failed to fetch claimed deliveries:', error.response?.status, error.response?.data)
      if (error.response?.status === 403) {
        toast({
          title: 'Access Denied',
          description: 'You do not have permission to view these deliveries.',
          status: 'warning',
        })
      } else if (error.response?.status === 400) {
        toast({
          title: 'Bad Request',
          description: 'Invalid query. Please refresh the page.',
          status: 'warning',
        })
      } else {
        console.error('Error details:', error?.response?.data)
      }
      setClaimedDeliveries([])
    }
  }

  useEffect(() => {
    if (user) {
      fetchAvailableDeliveries()
      fetchClaimedDeliveries()
      
      // Auto-refresh every 10 seconds
      const interval = setInterval(() => {
        fetchAvailableDeliveries()
        fetchClaimedDeliveries()
      }, 10000)

      return () => clearInterval(interval)
    }
  }, [user])

  const handleAcceptDelivery = async (job: DeliveryJob) => {
    // Check if rider has active deliveries
    const activeDeliveries = claimedDeliveries.filter(
      d => d.status !== 'delivered' && d.status !== 'cancelled'
    )

    if (activeDeliveries.length > 0 && job.deliveryType === 'standard') {
      const totalItems = activeDeliveries.reduce((sum, d) => sum + d.itemCount, 0)
      if (totalItems + job.itemCount > 5) {
        toast({
          title: 'Batch Limit Reached',
          description: `Cannot add delivery: would exceed 5 item limit (current: ${totalItems}, adding: ${job.itemCount})`,
          status: 'warning',
          duration: 3000,
        })
        return
      }
    }

    setSelectedJob(job)

    if (job.deliveryType === 'express') {
      // Express: exclusive single-item
      setSuggestedBatch([job])
    } else {
      // Standard: suggest nearby jobs for batching
      const nearbyStandardJobs = pendingJobs.filter(
        j =>
          j.id !== job.id &&
          j.deliveryType === 'standard' &&
          j.status === 'pending' &&
          j.distanceKm !== undefined &&
          job.distanceKm !== undefined &&
          Math.abs(j.distanceKm - job.distanceKm) <= 2
      )
      // Limit to 5 total items
      let totalItems = job.itemCount
      const suggested: DeliveryJob[] = [job]
      for (const nearbyJob of nearbyStandardJobs) {
        if (totalItems + nearbyJob.itemCount <= 5) {
          suggested.push(nearbyJob)
          totalItems += nearbyJob.itemCount
        }
        if (suggested.length >= 5) break
      }
      setSuggestedBatch(suggested)
    }

    onOpen()
  }

  const handleConfirmBatch = async () => {
    if (!selectedJob || suggestedBatch.length === 0) return

    try {
      // Claim all deliveries in the batch
      const claimPromises = suggestedBatch.map(job =>
        api.post(`/api/deliveries/${job.id}/claim`)
      )

      await Promise.all(claimPromises)

      toast({
        title: selectedJob.deliveryType === 'express' ? '✓ Express Job Claimed!' : '✓ Batch Claimed!',
        description:
          selectedJob.deliveryType === 'express'
            ? 'Single-item delivery claimed successfully'
            : `${suggestedBatch.length} delivery(ies) claimed successfully`,
        status: 'success',
        duration: 3000,
      })

      // Refresh data
      await fetchAvailableDeliveries()
      await fetchClaimedDeliveries()

      // Navigate to task stepper for the first delivery
      if (suggestedBatch.length > 0) {
        navigate(`/task-stepper/${suggestedBatch[0].id}`)
      } else {
        onClose()
      }
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error?.response?.data?.error || 'Failed to claim delivery',
        status: 'error',
        duration: 3000,
      })
    } finally {
      onClose()
    }
  }

  const getDeliveryIcon = (type: 'standard' | 'express') =>
    type === 'express' ? <FaMotorcycle /> : <FaCar />

  const getDeliveryColor = (type: 'standard' | 'express') =>
    type === 'express' ? 'purple' : 'blue'

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

  return (
    <Box minH="100vh" bg="#FFFDF1" py={6} px={4}>
      <VStack spacing={4} maxW="md" mx="auto">
        {/* Header */}
        <VStack spacing={1} w="full">
          <Heading size="md" color="brand.500">
            Available Deliveries
          </Heading>
          <Text fontSize="sm" color="gray.600">
            {pendingJobs.filter(j => j.status === 'pending').length} jobs nearby
          </Text>
        </VStack>

        {/* Tabs: Pending vs Claimed */}
        <Tabs variant="soft-rounded" colorScheme="brand" w="full">
          <TabList>
            <Tab fontSize="sm">
              Pending ({pendingJobs.filter(j => j.status === 'pending').length})
            </Tab>
            <Tab fontSize="sm">
              Claimed ({claimedDeliveries.filter(d => d.status !== 'delivered' && d.status !== 'cancelled').length})
            </Tab>
          </TabList>

          <TabPanels>
            {/* Pending Jobs */}
            <TabPanel px={0}>
              <VStack spacing={3} align="stretch">
                {loading ? (
                  <VStack spacing={4} py={8}>
                    <Spinner size="xl" color="brand.500" />
                    <Text>Loading available deliveries...</Text>
                  </VStack>
                ) : (
                  <>
                    {pendingJobs
                      .filter(job => job.status === 'pending')
                      .map(job => (
                    <Card key={job.id} bg="white" border="1px" borderColor="gray.200">
                      <CardBody p={2}>
                        <VStack spacing={2} align="stretch">
                          {/* Header: Type & Fee */}
                          <HStack justify="space-between" align="start">
                            <HStack spacing={1}>
                              <Badge fontSize="2xs" colorScheme={getDeliveryColor(job.deliveryType)}>
                                {job.deliveryType === 'express' ? '⭐ Express' : '💰 Standard'}
                              </Badge>
                              {job.isFragile && (
                                <Badge fontSize="2xs" colorScheme="red">
                                  🔴 Fragile
                                </Badge>
                              )}
                            </HStack>
                            <Text fontWeight="bold" fontSize="md" color="brand.600">
                              ₱{job.fee}
                            </Text>
                          </HStack>

                          {/* Sender & Addresses - Single Block */}
                          <VStack spacing={1} align="stretch" fontSize="xs" bg="gray.50" p={2} borderRadius="md">
                            <HStack spacing={1}>
                              <Text color="gray.600" fontWeight="bold" minW="35px">From:</Text>
                              <Text fontSize="xs" color="gray.800" noOfLines={1} flex={1}>
                                {job.sender || 'Customer'}
                              </Text>
                            </HStack>
                            <HStack spacing={1} align="flex-start">
                              <Icon as={FaMapMarkerAlt} color="green.500" boxSize={3} flexShrink={0} minW="24px" />
                              <Text fontSize="xs" color="gray.800" noOfLines={1} flex={1}>
                                {job.pickupLocation || 'N/A'}
                              </Text>
                            </HStack>
                            <HStack spacing={1} align="flex-start">
                              <Icon as={FaMapMarkerAlt} color="red.500" boxSize={3} flexShrink={0} minW="24px" />
                              <Text fontSize="xs" color="gray.800" noOfLines={1} flex={1}>
                                {job.dropoffLocation || 'N/A'}
                              </Text>
                            </HStack>
                          </VStack>

                          {/* Distance, Items, Time - Grid */}
                          <SimpleGrid columns={3} spacing={1} fontSize="2xs">
                            <VStack align="center" spacing={0} bg="gray.50" py={1} px={1} borderRadius="sm">
                              <Icon as={FaMapMarkerAlt} color="orange.500" boxSize={3} />
                              <Text fontWeight="bold" color="gray.800">
                                {job.distance || 'N/A'}
                              </Text>
                            </VStack>
                            <VStack align="center" spacing={0} bg="gray.50" py={1} px={1} borderRadius="sm">
                              <Icon as={FaBox} color="blue.500" boxSize={3} />
                              <Text fontWeight="bold" color="gray.800">
                                {job.itemCount}
                              </Text>
                            </VStack>
                            <VStack align="center" spacing={0} bg="gray.50" py={1} px={1} borderRadius="sm">
                              <Icon as={FaClock} color="blue.500" boxSize={3} />
                              <Text fontWeight="bold" color="gray.800" noOfLines={1}>
                                {job.pickupWindow || 'ASAP'}
                              </Text>
                            </VStack>
                          </SimpleGrid>

                          {/* Claim Button */}
                          <Button
                            size="xs"
                            colorScheme="brand"
                            w="full"
                            onClick={() => handleAcceptDelivery(job)}
                            isDisabled={claimedDeliveries.some(d => 
                              d.status !== 'delivered' && d.status !== 'cancelled'
                            )}
                          >
                            Claim
                          </Button>
                        </VStack>
                      </CardBody>
                    </Card>
                  ))}

                    {pendingJobs.filter(j => j.status === 'pending').length === 0 && (
                      <Alert status="info" borderRadius="md">
                        <AlertIcon />
                        <AlertDescription>
                          No pending deliveries available. Check back soon!
                        </AlertDescription>
                      </Alert>
                    )}
                  </>
                )}
              </VStack>
            </TabPanel>

            {/* Claimed Deliveries */}
            <TabPanel px={0}>
              <VStack spacing={3} align="stretch">
                {loading ? (
                  <VStack spacing={4} py={8}>
                    <Spinner size="xl" color="brand.500" />
                    <Text>Loading claimed deliveries...</Text>
                  </VStack>
                ) : (
                  <>
                    {/* Group deliveries by status */}
                    {claimedDeliveries
                      .filter(d => d.status !== 'delivered' && d.status !== 'cancelled')
                      .map(delivery => {
                        const isCompleted = delivery.status === 'delivered'
                        
                        return (
                          <Card key={delivery.id} bg={isCompleted ? "gray.50" : "green.50"} border="2px" borderColor={isCompleted ? "gray.200" : "green.200"}>
                            <CardBody p={3}>
                              <VStack spacing={3} align="stretch">
                                {/* Delivery Header */}
                                <HStack justify="space-between" align="start">
                                  <VStack align="start" spacing={0}>
                                    <Badge colorScheme={delivery.deliveryType === 'express' ? 'purple' : 'blue'}>
                                      {delivery.deliveryType === 'express' ? 'Express' : 'Standard'}
                                    </Badge>
                                    <Text fontWeight="bold" fontSize="sm">
                                      Delivery #{delivery.id}
                                    </Text>
                                    <Text fontSize="xs" color="gray.600">
                                      {delivery.user_name || 'Customer'}
                                    </Text>
                                  </VStack>
                                  <VStack align="end" spacing={0}>
                                    <Text fontWeight="bold" color="green.600">
                                      ₱{delivery.fee}
                                    </Text>
                                    <Badge colorScheme={getStatusColor(delivery.status)} fontSize="2xs">
                                      {delivery.status.replace('_', ' ').toUpperCase()}
                                    </Badge>
                                  </VStack>
                                </HStack>

                                <Divider />

                                {/* Delivery Details */}
                                <SimpleGrid columns={2} spacing={2} fontSize="xs">
                                  <HStack spacing={1}>
                                    <Icon as={FaMapMarkerAlt} color="red.500" boxSize={3} />
                                    <Text color="gray.600" noOfLines={1}>{delivery.distance || 'N/A'}</Text>
                                  </HStack>
                                  <HStack spacing={1}>
                                    <Icon as={FaBox} color="gray.600" boxSize={3} />
                                    <Text color="gray.600">{delivery.itemCount} item(s)</Text>
                                  </HStack>
                                  <Text color="gray.600" fontSize="xs" gridColumn="1 / -1">
                                    📍 {delivery.pickupLocation}
                                  </Text>
                                  <Text color="gray.600" fontSize="xs" gridColumn="1 / -1">
                                    🎯 {delivery.dropoffLocation}
                                  </Text>
                                </SimpleGrid>

                                <Button
                                  size="sm"
                                  colorScheme={isCompleted ? "gray" : "green"}
                                  variant="solid"
                                  w="full"
                                  onClick={() => navigate(`/task-stepper/${delivery.id}`)}
                                >
                                  {isCompleted ? '✓ Completed' : 'Continue Delivery'}
                                </Button>
                              </VStack>
                            </CardBody>
                          </Card>
                        )
                      })}

                    {claimedDeliveries.filter(d => d.status !== 'delivered' && d.status !== 'cancelled').length === 0 && (
                      <Text textAlign="center" color="gray.500" py={6}>
                        No claimed deliveries yet
                      </Text>
                    )}
                  </>
                )}
              </VStack>
            </TabPanel>
          </TabPanels>
        </Tabs>

        {/* Navigation Buttons */}
        <HStack spacing={2} w="full" mt={4}>
          <Button
            flex={1}
            size="sm"
            colorScheme="brand"
            onClick={() => navigate('/rider-queue')}
          >
            📍 Batches
          </Button>
          <Button
            flex={1}
            size="sm"
            colorScheme="brand"
            onClick={() => navigate('/remittance-ledger')}
          >
            💰 Earnings
          </Button>
        </HStack>
      </VStack>

      {/* Batch Preview Modal */}
      <Modal isOpen={isOpen} onClose={onClose} size="sm" isCentered>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader fontSize="md">
            {selectedJob?.deliveryType === 'express' ? '✓ Claim Express Job?' : 'Claim Batch?'}
          </ModalHeader>
          <ModalBody>
            <VStack spacing={3} align="stretch">
              {/* Summary */}
              <Card bg="gray.50">
                <CardBody p={3}>
                  <VStack spacing={2} align="stretch" fontSize="sm">
                    <HStack justify="space-between">
                      <Text color="gray.600">Type:</Text>
                      <Badge colorScheme={getDeliveryColor(selectedJob?.deliveryType || 'standard')}>
                        {selectedJob?.deliveryType === 'express' ? 'Express (Single)' : `Standard (${suggestedBatch.length} jobs)`}
                      </Badge>
                    </HStack>
                    <HStack justify="space-between">
                      <Text color="gray.600">Total Earnings:</Text>
                      <Text fontWeight="bold" color="brand.600">
                        ₱{suggestedBatch.reduce((sum, j) => sum + j.fee, 0)}
                      </Text>
                    </HStack>
                    <HStack justify="space-between">
                      <Text color="gray.600">Distance:</Text>
                      <Text fontWeight="bold">
                        {suggestedBatch.reduce((sum, j) => sum + (j.distanceKm || 0), 0).toFixed(1)} km
                      </Text>
                    </HStack>
                  </VStack>
                </CardBody>
              </Card>

              {/* Job List */}
              {selectedJob?.deliveryType === 'standard' && suggestedBatch.length > 1 && (
                <VStack spacing={1} align="stretch">
                  <Text fontWeight="bold" fontSize="xs" color="gray.700">
                    Jobs in batch (max 5):
                  </Text>
                  {suggestedBatch.map((job, idx) => (
                    <HStack key={job.id} spacing={2} fontSize="2xs" py={1}>
                      <Badge colorScheme="gray">{idx + 1}</Badge>
                      <Text color="gray.600" flex={1} noOfLines={1}>
                        {job.itemType} • {job.sender}
                      </Text>
                      <Text fontWeight="bold">₱{job.fee}</Text>
                    </HStack>
                  ))}
                </VStack>
              )}

              {/* Risk Info */}
              {selectedJob?.deliveryType === 'standard' && (
                <HStack spacing={2} p={2} bg="blue.50" borderRadius="md">
                  <InfoIcon boxSize={4} color="blue.600" />
                  <Text fontSize="xs" color="blue.900">
                    Shared batch: slight risk of minor damage from batch handling
                  </Text>
                </HStack>
              )}

              {selectedJob?.deliveryType === 'express' && (
                <HStack spacing={2} p={2} bg="purple.50" borderRadius="md">
                  <InfoIcon boxSize={4} color="purple.600" />
                  <Text fontSize="xs" color="purple.900">
                    Single-item exclusive: minimal risk, dedicated handling
                  </Text>
                </HStack>
              )}

              {/* Batch Lock Warning */}
              <HStack spacing={2} p={2} bg="orange.50" borderRadius="md">
                <WarningIcon boxSize={4} color="orange.600" />
                <Text fontSize="xs" color="orange.900">
                  Cannot claim new batch until current one is completed
                </Text>
              </HStack>
            </VStack>
          </ModalBody>
          <ModalFooter>
            <HStack spacing={2} w="full">
              <Button variant="outline" flex={1} onClick={onClose}>
                Cancel
              </Button>
              <Button colorScheme="brand" flex={1} onClick={handleConfirmBatch}>
                Confirm Claim
              </Button>
            </HStack>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Box>
  )
}

export default RiderJobs
