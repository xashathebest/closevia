import React, { useState } from 'react'
import { useParams, useLocation, useNavigate } from 'react-router-dom'
import {
  Box,
  VStack,
  HStack,
  Heading,
  Text,
  Button,
  Card,
  CardBody,
  Icon,
  Divider,
  Badge,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  ModalCloseButton,
  useDisclosure,
  Collapse,
  useToast,
  Spinner,
  Center,
  SimpleGrid,
} from '@chakra-ui/react'
import { ChevronDownIcon, ChevronUpIcon, CheckCircleIcon, LockIcon } from '@chakra-ui/icons'
import { FaMapMarkerAlt, FaClock, FaMoneyBillWave, FaShieldAlt } from 'react-icons/fa'

interface BatchCluster {
  id: string
  taskCount: number
  sizePoints: number
  estimatedEarnings: number
  requiredPass: string
  passValidity: string
  distance: string
  estimatedTime: string
  zone: string
  pickupCount: number
  deliveryCount: number
  systemFee: number
  isHighDemand?: boolean
  maxCapacity?: number
}

interface PickupAddress {
  id: string
  name: string
  address: string
  contact: string
  items: number
  points: number
}

const BatchPreview: React.FC = () => {
  const { batchId } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const toast = useToast()
  const { isOpen, onOpen, onClose } = useDisclosure()
  
  const batch: BatchCluster = location.state?.batch
  const [expandedAddresses, setExpandedAddresses] = useState<Set<string>>(new Set())
  const [isClaimingBatch, setIsClaimingBatch] = useState(false)
  const [claimCountdown, setClaimCountdown] = useState(15)

  const pickupAddresses: PickupAddress[] = [
    {
      id: 'pickup-1',
      name: 'Juan Dela Cruz',
      address: '123 Makati Ave, Makati City',
      contact: '09171234567',
      items: 2,
      points: 3,
    },
    {
      id: 'pickup-2',
      name: 'Maria Santos',
      address: '456 Paseo de Roxas, Makati City',
      contact: '09189876543',
      items: 3,
      points: 4,
    },
  ]

  const toggleAddressExpand = (id: string) => {
    const newExpanded = new Set(expandedAddresses)
    if (newExpanded.has(id)) {
      newExpanded.delete(id)
    } else {
      newExpanded.add(id)
    }
    setExpandedAddresses(newExpanded)
  }

  const handleClaimBatch = async () => {
    setIsClaimingBatch(true)
    
    // Simulate claim API call
    try {
      await new Promise(resolve => setTimeout(resolve, 1500))
      
      // Start countdown
      const interval = setInterval(() => {
        setClaimCountdown(prev => {
          if (prev <= 1) {
            clearInterval(interval)
            return 0
          }
          return prev - 1
        })
      }, 1000)

      toast({
        title: 'Batch Locked! ✅',
        description: 'Tasks secured for 15 minutes. Proceed to pickup.',
        status: 'success',
        duration: 3000,
        isClosable: true,
      })

      navigate(`/rider/task-stepper/${batchId}`)
    } catch (error) {
      toast({
        title: 'Claim Failed',
        description: 'Unable to lock batch. Please try again.',
        status: 'error',
        duration: 3000,
        isClosable: true,
      })
    } finally {
      setIsClaimingBatch(false)
    }
  }

  if (!batch) {
    return (
      <Center h="100vh">
        <Spinner size="lg" color="brand.500" />
      </Center>
    )
  }

  return (
    <Box minH="100vh" bg="#FFFDF1" py={6} px={4}>
      <VStack spacing={6} maxW="md" mx="auto">
        {/* Back Button */}
        <HStack w="full" justify="space-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => navigate(-1)}
          >
            ← Back
          </Button>
          <Heading size="md" color="brand.500">
            Batch Details
          </Heading>
          <Box w="8" />
        </HStack>

        {/* Batch Summary Card */}
        <Card bg="white" w="full" border="2px" borderColor="brand.400">
          <CardBody>
            <VStack spacing={4} align="stretch">
              {/* Header */}
              <HStack justify="space-between" align="start">
                <VStack align="start" spacing={1}>
                  <Heading size="lg" color="gray.800">
                    ₱{batch.estimatedEarnings}
                  </Heading>
                  <Text fontSize="sm" color="gray.600">
                    Your estimated earnings
                  </Text>
                </VStack>
                {batch.isHighDemand && (
                  <Badge colorScheme="orange" fontSize="sm" px={3} py={1}>
                    🔥 +50% bonus zone
                  </Badge>
                )}
              </HStack>

              <Divider />

              {/* Key Stats */}
              <SimpleGrid columns={3} spacing={3}>
                <VStack spacing={1} align="center" p={2} bg="blue.50" borderRadius="md">
                  <Text fontSize="xs" color="gray.600" textAlign="center">Tasks</Text>
                  <Text fontWeight="bold" fontSize="lg" color="blue.600">
                    {batch.taskCount}
                  </Text>
                </VStack>
                <VStack spacing={1} align="center" p={2} bg="green.50" borderRadius="md">
                  <Text fontSize="xs" color="gray.600" textAlign="center">Route Time</Text>
                  <Text fontWeight="bold" fontSize="lg" color="green.600">
                    {batch.estimatedTime}
                  </Text>
                </VStack>
                <VStack spacing={1} align="center" p={2} bg="purple.50" borderRadius="md">
                  <Text fontSize="xs" color="gray.600" textAlign="center">Distance</Text>
                  <Text fontWeight="bold" fontSize="lg" color="purple.600">
                    {batch.distance}
                  </Text>
                </VStack>
              </SimpleGrid>

              <Divider />

              {/* Pass Requirement */}
              <HStack bg="yellow.50" p={3} borderRadius="md" spacing={2} align="start">
                <Icon as={LockIcon} color="yellow.600" boxSize={5} flexShrink={0} />
                <VStack align="start" spacing={0}>
                  <Text fontWeight="bold" fontSize="sm" color="yellow.900">
                    {batch.requiredPass} Pass
                  </Text>
                  <Text fontSize="xs" color="yellow.800">
                    {batch.passValidity}
                  </Text>
                </VStack>
              </HStack>
            </VStack>
          </CardBody>
        </Card>

        {/* Pickup Addresses */}
        <VStack spacing={3} align="stretch" w="full">
          <Heading size="sm" color="gray.800">
            📍 Pickup Addresses ({batch.pickupCount})
          </Heading>
          {pickupAddresses.map((pickup) => (
            <Card key={pickup.id} bg="white" border="1px" borderColor="gray.200">
              <CardBody p={3}>
                <VStack spacing={2} align="stretch">
                  {/* Header */}
                  <HStack justify="space-between" cursor="pointer" onClick={() => toggleAddressExpand(pickup.id)}>
                    <VStack align="start" spacing={0} flex={1}>
                      <Text fontWeight="bold" fontSize="sm" color="gray.800">
                        {pickup.name}
                      </Text>
                      <Text fontSize="xs" color="gray.600" noOfLines={1}>
                        {pickup.address}
                      </Text>
                    </VStack>
                    <Icon as={expandedAddresses.has(pickup.id) ? ChevronUpIcon : ChevronDownIcon} />
                  </HStack>

                  {/* Expanded Details */}
                  <Collapse in={expandedAddresses.has(pickup.id)}>
                    <VStack spacing={2} align="stretch" bg="gray.50" p={2} borderRadius="md" mt={2}>
                      <HStack justify="space-between" fontSize="xs">
                        <Text color="gray.600">Contact:</Text>
                        <Text fontWeight="bold" color="gray.800">
                          {pickup.contact}
                        </Text>
                      </HStack>
                      <HStack justify="space-between" fontSize="xs">
                        <Text color="gray.600">Items:</Text>
                        <Badge colorScheme="blue">{pickup.items}</Badge>
                      </HStack>
                      <HStack justify="space-between" fontSize="xs">
                        <Text color="gray.600">Size Points:</Text>
                        <Badge colorScheme="purple">{pickup.points}pt</Badge>
                      </HStack>
                      <Button size="xs" variant="outline" colorScheme="brand" w="full">
                        📞 Call Sender
                      </Button>
                    </VStack>
                  </Collapse>
                </VStack>
              </CardBody>
            </Card>
          ))}
        </VStack>

        {/* Summary */}
        <Card bg="gray.50" w="full">
          <CardBody>
            <VStack spacing={2} align="stretch">
              <HStack justify="space-between" fontSize="sm">
                <Text color="gray.600">Total Items:</Text>
                <Text fontWeight="bold">{batch.taskCount * 2} items</Text>
              </HStack>
              <HStack justify="space-between" fontSize="sm">
                <Text color="gray.600">Total Size Points:</Text>
                <Text fontWeight="bold">{batch.sizePoints}/{batch.maxCapacity}</Text>
              </HStack>
              <Divider />
              <HStack justify="space-between" fontSize="sm">
                <Text color="gray.600">Clovia Fee (System):</Text>
                <Text fontWeight="bold" color="red.600">-₱{batch.systemFee}</Text>
              </HStack>
              <HStack justify="space-between" fontSize="md">
                <Text fontWeight="bold" color="gray.800">Your Remittance Due:</Text>
                <Text fontWeight="bold" color="brand.600">₱{batch.systemFee}</Text>
              </HStack>
            </VStack>
          </CardBody>
        </Card>

        {/* Lock Info */}
        <HStack bg="blue.50" p={3} borderRadius="md" spacing={2} align="start" fontSize="xs">
          <Icon as={CheckCircleIcon} color="blue.600" boxSize={4} flexShrink={0} />
          <Text color="blue.900">
            Tap "Accept & Lock" to reserve this batch for 15 minutes. If you don't start pickup within 15m, the batch returns to queue.
          </Text>
        </HStack>

        {/* Action Buttons */}
        <VStack spacing={2} w="full">
          <Button
            w="full"
            colorScheme="brand"
            size="lg"
            onClick={onOpen}
            isLoading={isClaimingBatch}
            loadingText="Locking tasks..."
          >
            Accept & Lock (15m)
          </Button>
          <Button
            w="full"
            variant="outline"
            colorScheme="brand"
            onClick={() => navigate(-1)}
          >
            View Other Batches
          </Button>
        </VStack>
      </VStack>

      {/* Confirmation Modal */}
      <Modal isOpen={isOpen} onClose={onClose} isCentered size="sm">
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Lock Batch for 15 Minutes?</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <VStack spacing={3} align="stretch">
              <Text fontSize="sm" color="gray.700">
                You're about to lock this batch. You have 15 minutes to begin pickup. If time expires, the batch returns to queue.
              </Text>
              <Card bg="blue.50">
                <CardBody p={3}>
                  <HStack justify="space-between" fontSize="sm">
                    <Text fontWeight="bold" color="gray.800">Earnings:</Text>
                    <Text fontWeight="bold" color="brand.600">₱{batch.estimatedEarnings - batch.systemFee}</Text>
                  </HStack>
                  <HStack justify="space-between" fontSize="sm">
                    <Text fontWeight="bold" color="gray.800">System Fee Due:</Text>
                    <Text fontWeight="bold" color="red.600">₱{batch.systemFee}</Text>
                  </HStack>
                </CardBody>
              </Card>
            </VStack>
          </ModalBody>
          <ModalFooter>
            <HStack spacing={3} w="full">
              <Button variant="outline" w="full" onClick={onClose}>
                Cancel
              </Button>
              <Button
                colorScheme="brand"
                w="full"
                onClick={() => {
                  handleClaimBatch()
                  onClose()
                }}
              >
                Yes, Lock It
              </Button>
            </HStack>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Box>
  )
}

export default BatchPreview
