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
  Spinner,
  Center,
  useToast,
  Tooltip,
  Flex,
  Progress,
  Tag,
  TagLabel,
  Alert,
  AlertIcon,
  AlertDescription,
} from '@chakra-ui/react'
import { FaMapMarkerAlt, FaClock, FaBox, FaMoneyBillWave, FaStar, FaWifi } from 'react-icons/fa'
import { InfoIcon, WarningIcon } from '@chakra-ui/icons'
import { api } from '../services/api'
import { Delivery } from '../types'
import { useAuth } from '../contexts/AuthContext'

interface BatchCluster {
  id: string
  taskCount: number
  sizePoints: number
  maxCapacity: number
  estimatedEarnings: number
  requiredPass: string
  passValidity: string
  distance: string
  estimatedTime: string
  zone: string
  isHighDemand: boolean
  pickupCount: number
  deliveryCount: number
  systemFee: number
}

const RiderQueue: React.FC = () => {
  const navigate = useNavigate()
  const toast = useToast()
  const { user } = useAuth()
  const [isOnline, setIsOnline] = useState(true)
  const [selectedBatch, setSelectedBatch] = useState<string | null>(null)
  const [batches, setBatches] = useState<BatchCluster[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Fetch rider's claimed deliveries and group them into batches
  const fetchBatches = async () => {
    if (!user) return

    try {
      setLoading(true)
      setError(null)
      // Use correct endpoint with status filter
      const response = await api.get('/api/deliveries', {
        params: { status: 'claimed,picked_up,in_transit' }
      })
      const deliveries: Delivery[] = response.data?.data || []

      // Group standard deliveries into batches (max 5 items per batch)
      const standardDeliveries = deliveries.filter(d => 
        d.delivery_type === 'standard' && 
        d.status !== 'delivered' && 
        d.status !== 'cancelled'
      )

      // Create batches from standard deliveries
      const batchClusters: BatchCluster[] = []
      let currentBatch: Delivery[] = []
      let currentItems = 0

      for (const delivery of standardDeliveries) {
        if (currentItems + delivery.item_count <= 5) {
          currentBatch.push(delivery)
          currentItems += delivery.item_count
        } else {
          // Create batch from current deliveries
          if (currentBatch.length > 0) {
            const totalEarnings = currentBatch.reduce((sum, d) => sum + d.total_cost, 0)
            batchClusters.push({
              id: `batch-${currentBatch[0].id}`,
              taskCount: currentBatch.length,
              sizePoints: currentItems,
              maxCapacity: 12,
              estimatedEarnings: totalEarnings,
              requiredPass: 'Standard',
              passValidity: 'Active',
              distance: 'Multiple',
              estimatedTime: 'Varies',
              zone: 'Multiple',
              isHighDemand: false,
              pickupCount: currentBatch.length,
              deliveryCount: currentBatch.length,
              systemFee: totalEarnings * 0.1, // 10% system fee
            })
          }
          // Start new batch
          currentBatch = [delivery]
          currentItems = delivery.item_count
        }
      }

      // Add remaining batch
      if (currentBatch.length > 0) {
        const totalEarnings = currentBatch.reduce((sum, d) => sum + d.total_cost, 0)
        batchClusters.push({
          id: `batch-${currentBatch[0].id}`,
          taskCount: currentBatch.length,
          sizePoints: currentItems,
          maxCapacity: 12,
          estimatedEarnings: totalEarnings,
          requiredPass: 'Standard',
          passValidity: 'Active',
          distance: 'Multiple',
          estimatedTime: 'Varies',
          zone: 'Multiple',
          isHighDemand: false,
          pickupCount: currentBatch.length,
          deliveryCount: currentBatch.length,
          systemFee: totalEarnings * 0.1,
        })
      }

      // Add express deliveries as individual batches
      const expressDeliveries = deliveries.filter(d => 
        d.delivery_type === 'express' && 
        d.status !== 'delivered' && 
        d.status !== 'cancelled'
      )

      expressDeliveries.forEach(delivery => {
        batchClusters.push({
          id: `express-${delivery.id}`,
          taskCount: 1,
          sizePoints: delivery.item_count,
          maxCapacity: 12,
          estimatedEarnings: delivery.total_cost,
          requiredPass: 'Express',
          passValidity: 'Active',
          distance: 'N/A',
          estimatedTime: '~1 hour',
          zone: 'Express',
          isHighDemand: true,
          pickupCount: 1,
          deliveryCount: 1,
          systemFee: delivery.total_cost * 0.1,
        })
      })

      setBatches(batchClusters)
    } catch (err: any) {
      console.error('Failed to fetch batches:', err.response?.status, err.response?.data)
      const errorMsg = err?.response?.data?.error || 'Failed to load batches'
      setError(errorMsg)
      toast({
        title: 'Error Loading Batches',
        description: errorMsg,
        status: 'error',
        duration: 3000,
      })
      setBatches([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (user) {
      fetchBatches()
      
      // Auto-refresh every 15 seconds
      const interval = setInterval(() => {
        fetchBatches()
      }, 15000)

      return () => clearInterval(interval)
    }
  }, [user])

  useEffect(() => {
    const handleOnline = () => setIsOnline(true)
    const handleOffline = () => setIsOnline(false)
    
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  const handleClaimBatch = (batchId: string) => {
    const batch = batches.find(b => b.id === batchId)
    if (batch) {
      navigate(`/rider/batch-preview/${batchId}`, { state: { batch } })
    }
  }

  const capacityPercentage = (sizePoints: number, maxCapacity: number) => {
    return Math.round((sizePoints / maxCapacity) * 100)
  }

  return (
    <Box minH="100vh" bg="#FFFDF1" py={6} px={4}>
      <VStack spacing={6} align="stretch" maxW="md" mx="auto">
        {/* Header with Connection Status */}
        <HStack justify="space-between" align="center">
          <VStack align="start" spacing={0}>
            <Heading size="lg" color="brand.500">
              Available Batches
            </Heading>
            <Text fontSize="sm" color="gray.600">
              Near you, ready to claim
            </Text>
          </VStack>
          <HStack spacing={1} px={3} py={2} bg={isOnline ? 'green.50' : 'red.50'} borderRadius="lg">
            <Icon as={FaWifi} color={isOnline ? 'green.600' : 'red.600'} />
            <Text fontSize="xs" fontWeight="bold" color={isOnline ? 'green.700' : 'red.700'}>
              {isOnline ? 'Online' : 'Offline'}
            </Text>
          </HStack>
        </HStack>

        {/* Filter/Sort Bar */}
        <HStack spacing={2} justify="space-between">
          <Badge colorScheme="purple" px={3} py={1.5}>
            📍 BGC • 2.3 km away
          </Badge>
          <Button size="sm" variant="outline" colorScheme="brand">
            Filter
          </Button>
        </HStack>

        {/* Batches List */}
        <VStack spacing={4} align="stretch">
          {loading ? (
            <Center py={12}>
              <VStack spacing={3} textAlign="center">
                <Spinner size="lg" color="brand.500" />
                <Text color="gray.600">Loading your batches...</Text>
              </VStack>
            </Center>
          ) : error ? (
            <Alert status="error" borderRadius="md">
              <AlertIcon />
              <AlertDescription>
                {error}. Try refreshing or check your connection.
              </AlertDescription>
            </Alert>
          ) : batches.length === 0 ? (
            <Alert status="info" borderRadius="md">
              <AlertIcon />
              <AlertDescription>
                No active batches. Claim deliveries from the Available Deliveries screen to see batches here.
              </AlertDescription>
            </Alert>
          )}
          {batches.map((batch) => (
            <Card
              key={batch.id}
              bg="white"
              border="1px"
              borderColor="gray.200"
              cursor="pointer"
              transition="all 0.2s"
              _hover={{ shadow: 'md', borderColor: 'brand.400' }}
              onClick={() => setSelectedBatch(batch.id)}
            >
              <CardBody>
                <VStack spacing={4}>
                {/* Top Row: Zone + High Demand Badge */}
                <HStack justify="space-between" align="start">
                  <VStack align="start" spacing={1}>
                    <HStack spacing={2}>
                      <Text fontWeight="bold" fontSize="md" color="gray.800">
                        {batch.taskCount} tasks
                      </Text>
                    </VStack>
                    <VStack align="end" spacing={0}>
                      <Text fontWeight="bold" fontSize="lg" color="brand.600">
                        ₱{batch.estimatedEarnings}
                      </Text>
                      <Text fontSize="xs" color="gray.500">
                        your earn
                      </Text>
                    </VStack>
                  </HStack>

                  {/* Capacity Progress */}
                  <VStack spacing={1} align="stretch">
                    <HStack justify="space-between" fontSize="xs">
                      <HStack spacing={1}>
                        <Icon as={FaBox} boxSize={3} color="gray.600" />
                        <Text color="gray.600">
                          Capacity: {batch.sizePoints}/{batch.maxCapacity} points
                        </Text>
                        <Tooltip label="Small item=1pt, Medium=2pts, Large=3pts. Your van holds 12pts max." placement="top">
                          <InfoIcon boxSize={3} color="blue.500" cursor="help" />
                        </Tooltip>
                      </HStack>
                    </HStack>
                    <Progress
                      value={capacityPercentage(batch.sizePoints, batch.maxCapacity)}
                      colorScheme="brand"
                      borderRadius="full"
                      h="6px"
                    />
                  </VStack>

                  {/* Distance + Time */}
                  <HStack spacing={4} fontSize="sm">
                    <HStack spacing={1}>
                      <Icon as={FaMapMarkerAlt} color="red.500" boxSize={4} />
                      <Text color="gray.700">{batch.distance}</Text>
                    </HStack>
                    <HStack spacing={1}>
                      <Icon as={FaClock} color="blue.500" boxSize={4} />
                      <Text color="gray.700">~{batch.estimatedTime}</Text>
                    </HStack>
                  </HStack>

                  {/* Pickups + Deliveries */}
                  <HStack spacing={3} fontSize="xs" color="gray.600">
                    <Tag size="sm" colorScheme="blue" variant="subtle">
                      <TagLabel>📍 {batch.pickupCount} pickup(s)</TagLabel>
                    </Tag>
                    <Tag size="sm" colorScheme="green" variant="subtle">
                      <TagLabel>✓ {batch.deliveryCount} delivery(s)</TagLabel>
                    </Tag>
                  </HStack>

                  {/* Required Pass */}
                  <HStack spacing={2} bg="yellow.50" p={2} borderRadius="md">
                    <Icon as={WarningIcon} boxSize={4} color="yellow.600" />
                    <VStack align="start" spacing={0} fontSize="xs">
                      <Text fontWeight="bold" color="yellow.900">
                        {batch.requiredPass} Pass needed
                      </Text>
                      <Text color="yellow.800">{batch.passValidity}</Text>
                    </VStack>
                  </HStack>

                  {/* Claim Button */}
                  <Button
                    w="full"
                    colorScheme="brand"
                    size="md"
                    onClick={() => handleClaimBatch(batch.id)}
                    isDisabled={!isOnline}
                  >
                    {isOnline ? 'Claim batch (15m lock)' : 'Offline - Reconnect to claim'}
                  </Button>
                </CardBody>
              </Card>
            ))
          )}
        </VStack>

        {/* Navigation Buttons */}
        <HStack spacing={2} w="full">
          <Button
            flex={1}
            size="sm"
            variant="outline"
            colorScheme="brand"
            onClick={() => navigate('/rider')}
          >
            📋 My Jobs
          </Button>
          <Button
            flex={1}
            size="sm"
            variant="outline"
            colorScheme="brand"
            onClick={() => navigate('/remittance-ledger')}
          >
            💰 Remittance
          </Button>
        </HStack>
      </VStack>
    </Box>
  )
}

export default RiderQueue
