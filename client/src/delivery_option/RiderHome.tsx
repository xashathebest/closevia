import React, { useState, useEffect, useCallback } from 'react'
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
  Spinner,
  Center,
  useToast,
  Tabs,
  TabList,
  Tab,
  TabPanels,
  TabPanel,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  ModalCloseButton,
  useDisclosure,
  Divider,
  SimpleGrid,
  Alert,
  AlertIcon,
  Progress,
  Tooltip,
} from '@chakra-ui/react'
import {
  FaHome,
  FaTruck,
  FaWallet,
  FaMapMarkerAlt,
  FaClock,
  FaBox,
  FaRoute,
  FaExclamationTriangle,
  FaLayerGroup,
  FaArrowRight,
  FaCheckCircle,
  FaTimesCircle,
  FaSync,
  FaBolt,
} from 'react-icons/fa'
import { WarningIcon } from '@chakra-ui/icons'
import { api } from '../services/api'
import RemittanceLedger from './RemittanceLedger'
import { Delivery } from '../types'
import { useRiderState } from '../hooks/useRiderState'

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────
interface DeliveryWithBatch extends Delivery {
  batch_id?: string
  batch_countdown?: number // seconds remaining
  batch_size?: number
  is_batching?: boolean
  distance_km?: number
  estimated_minutes?: number
  sender_fee?: number
  receiver_fee?: number
  rider_cut?: number
}

type RiderOrder = {
  key: string
  trade_id?: number
  deliveries: DeliveryWithBatch[]
}

const sortLegs = (a: DeliveryWithBatch, b: DeliveryWithBatch) => {
  const aTime = new Date(a.created_at).getTime()
  const bTime = new Date(b.created_at).getTime()
  if (aTime !== bTime) return aTime - bTime
  return a.id - b.id
}

const formatDateTime = (iso?: string) => {
  if (!iso) return ''
  const time = new Date(iso)
  if (Number.isNaN(time.getTime())) return ''
  return time.toLocaleString()
}

const buildRiderOrders = (deliveries: DeliveryWithBatch[]): RiderOrder[] => {
  const byTradeId = new Map<number, DeliveryWithBatch[]>()
  const singles: RiderOrder[] = []

  for (const delivery of deliveries) {
    if (delivery.trade_id) {
      const existing = byTradeId.get(delivery.trade_id) || []
      existing.push(delivery)
      byTradeId.set(delivery.trade_id, existing)
    } else {
      singles.push({ key: `delivery:${delivery.id}`, deliveries: [delivery] })
    }
  }

  const grouped: RiderOrder[] = []
  for (const [tradeId, group] of byTradeId.entries()) {
    grouped.push({ key: `trade:${tradeId}`, trade_id: tradeId, deliveries: group.slice().sort(sortLegs) })
  }

  // Show newest orders first
  const all = [...grouped, ...singles]
  all.sort((a, b) => {
    const aTop = a.deliveries[0]
    const bTop = b.deliveries[0]
    const aTime = new Date(aTop.created_at).getTime()
    const bTime = new Date(bTop.created_at).getTime()
    return bTime - aTime
  })
  return all
}

// ─────────────────────────────────────────────────────────────────────────────
// DELIVERY CARD - Task 8
// ─────────────────────────────────────────────────────────────────────────────
interface DeliveryCardProps {
  delivery: DeliveryWithBatch
  onViewDetails: () => void
  onAccept: () => void
  accepting: boolean
}

const DeliveryCard: React.FC<DeliveryCardProps> = ({ delivery, onViewDetails, onAccept, accepting }) => {
  const isExpress = delivery.delivery_type === 'express'
  const isBatching = delivery.is_batching && !isExpress

  return (
    <Card
      bg="white"
      border="1px"
      borderColor={isExpress ? 'purple.200' : 'gray.200'}
      transition="all 0.2s"
      _hover={{ shadow: 'md', borderColor: isExpress ? 'purple.400' : 'brand.400' }}
    >
      <CardBody p={4}>
        <VStack spacing={3} align="stretch">
          {/* Header Row: Type Badge + Earnings */}
          <HStack justify="space-between" align="start">
            <HStack spacing={2}>
              <Badge
                colorScheme={isExpress ? 'purple' : 'blue'}
                fontSize="xs"
                px={2}
                py={1}
                borderRadius="full"
              >
                <HStack spacing={1}>
                  <Icon as={isExpress ? FaBolt : FaTruck} boxSize={3} />
                  <Text>{isExpress ? 'EXPRESS' : 'STANDARD'}</Text>
                </HStack>
              </Badge>
              {delivery.is_fragile && (
                <Badge colorScheme="red" fontSize="xs">
                  <HStack spacing={1}>
                    <Icon as={FaExclamationTriangle} boxSize={3} />
                    <Text>Fragile</Text>
                  </HStack>
                </Badge>
              )}
            </HStack>
            <VStack align="end" spacing={0}>
              <Text fontWeight="bold" fontSize="xl" color="green.600">
                ₱{delivery.rider_cut || delivery.total_cost}
              </Text>
              <Text fontSize="2xs" color="gray.500">your earnings</Text>
            </VStack>
          </HStack>

          {/* Batch Countdown (Standard jobs only) */}
          {isBatching && delivery.batch_countdown && delivery.batch_countdown > 0 && (
            <Box bg="orange.50" p={2} borderRadius="md" border="1px" borderColor="orange.200">
              <HStack justify="space-between">
                <HStack spacing={2}>
                  <Icon as={FaLayerGroup} color="orange.500" />
                  <Text fontSize="sm" color="orange.700" fontWeight="medium">
                    Batch forms in {Math.floor(delivery.batch_countdown / 60)}:{String(delivery.batch_countdown % 60).padStart(2, '0')}
                  </Text>
                </HStack>
                {delivery.batch_size && (
                  <Badge colorScheme="orange" fontSize="xs">{delivery.batch_size} orders</Badge>
                )}
              </HStack>
              <Progress
                value={(delivery.batch_countdown / (20 * 60)) * 100}
                size="xs"
                colorScheme="orange"
                mt={2}
                borderRadius="full"
              />
            </Box>
          )}

          {/* Addresses */}
          <VStack spacing={2} align="stretch">
            {delivery.trade_id ? (
              <>
                <HStack spacing={2}>
                  <Box w="20px" display="flex" justifyContent="center">
                    <Box w="8px" h="8px" borderRadius="full" bg="blue.500" />
                  </Box>
                  <VStack spacing={0} align="start" flex={1} minW={0}>
                    <Text fontSize="sm" color="gray.700" noOfLines={1} w="full">
                      {delivery.delivery_address}
                    </Text>
                    <Text fontSize="2xs" color="gray.500" noOfLines={1} w="full">
                      Buyer payment
                    </Text>
                  </VStack>
                </HStack>
                <HStack spacing={2}>
                  <Box w="20px" display="flex" justifyContent="center">
                    <Icon as={FaArrowRight} color="gray.400" boxSize={3} />
                  </Box>
                  <Box h="20px" borderLeft="2px dashed" borderColor="gray.300" ml="3px" />
                </HStack>
                <HStack spacing={2}>
                  <Box w="20px" display="flex" justifyContent="center">
                    <Box w="8px" h="8px" borderRadius="full" bg="orange.500" />
                  </Box>
                  <VStack spacing={0} align="start" flex={1} minW={0}>
                    <Text fontSize="sm" color="gray.700" noOfLines={1} w="full">
                      {delivery.pickup_address}
                    </Text>
                    <Text fontSize="2xs" color="gray.500" noOfLines={1} w="full">
                      Seller pickup
                    </Text>
                  </VStack>
                </HStack>
                <HStack spacing={2}>
                  <Box w="20px" display="flex" justifyContent="center">
                    <Icon as={FaArrowRight} color="gray.400" boxSize={3} />
                  </Box>
                  <Box h="20px" borderLeft="2px dashed" borderColor="gray.300" ml="3px" />
                </HStack>
                <HStack spacing={2}>
                  <Box w="20px" display="flex" justifyContent="center">
                    <Box w="8px" h="8px" borderRadius="full" bg="green.500" />
                  </Box>
                  <VStack spacing={0} align="start" flex={1} minW={0}>
                    <Text fontSize="sm" color="gray.700" noOfLines={1} w="full">
                      {delivery.delivery_address}
                    </Text>
                    <Text fontSize="2xs" color="gray.500" noOfLines={1} w="full">
                      Deliver to buyer
                    </Text>
                  </VStack>
                </HStack>
              </>
            ) : (
              <>
                <HStack spacing={2}>
                  <Box w="20px" display="flex" justifyContent="center">
                    <Box w="8px" h="8px" borderRadius="full" bg="blue.500" />
                  </Box>
                  <VStack spacing={0} align="start" flex={1} minW={0}>
                    <Text fontSize="sm" color="gray.700" noOfLines={1} w="full">
                      {delivery.pickup_address}
                    </Text>
                    {(delivery.user_name || delivery.receiver_name) && (
                      <Text fontSize="2xs" color="gray.500" noOfLines={1} w="full">
                        Pickup from {delivery.user_name || 'Sender'}
                      </Text>
                    )}
                  </VStack>
                </HStack>
                <HStack spacing={2}>
                  <Box w="20px" display="flex" justifyContent="center">
                    <Icon as={FaArrowRight} color="gray.400" boxSize={3} />
                  </Box>
                  <Box h="20px" borderLeft="2px dashed" borderColor="gray.300" ml="3px" />
                </HStack>
                <HStack spacing={2}>
                  <Box w="20px" display="flex" justifyContent="center">
                    <Box w="8px" h="8px" borderRadius="full" bg="green.500" />
                  </Box>
                  <VStack spacing={0} align="start" flex={1} minW={0}>
                    <Text fontSize="sm" color="gray.700" noOfLines={1} w="full">
                      {delivery.delivery_address}
                    </Text>
                    {(delivery.user_name || delivery.receiver_name) && (
                      <Text fontSize="2xs" color="gray.500" noOfLines={1} w="full">
                        Drop-off to {delivery.receiver_name || 'Receiver'}
                      </Text>
                    )}
                  </VStack>
                </HStack>
              </>
            )}
          </VStack>

          {/* Stats Row */}
          <HStack spacing={4} justify="center" py={2} bg="gray.50" borderRadius="md">
            <VStack spacing={0}>
              <HStack spacing={1}>
                <Icon as={FaRoute} color="gray.500" boxSize={3} />
                <Text fontSize="sm" fontWeight="bold" color="gray.700">
                  {delivery.distance_km?.toFixed(1) || '~'} km
                </Text>
              </HStack>
              <Text fontSize="2xs" color="gray.500">distance</Text>
            </VStack>
            <Divider orientation="vertical" h="30px" />
            <VStack spacing={0}>
              <HStack spacing={1}>
                <Icon as={FaClock} color="gray.500" boxSize={3} />
                <Text fontSize="sm" fontWeight="bold" color="gray.700">
                  {delivery.estimated_minutes || '~'} mins
                </Text>
              </HStack>
              <Text fontSize="2xs" color="gray.500">est. time</Text>
            </VStack>
            <Divider orientation="vertical" h="30px" />
            <VStack spacing={0}>
              <HStack spacing={1}>
                <Icon as={FaBox} color="gray.500" boxSize={3} />
                <Text fontSize="sm" fontWeight="bold" color="gray.700">
                  {delivery.item_count}
                </Text>
              </HStack>
              <Text fontSize="2xs" color="gray.500">items</Text>
            </VStack>
          </HStack>

          {/* Time */}
          <HStack justify="space-between" px={1}>
            <HStack spacing={2} color="gray.500">
              <Icon as={FaClock} boxSize={3} />
              <Text fontSize="2xs">Posted {formatDateTime(delivery.created_at)}</Text>
            </HStack>
            {delivery.estimated_eta && (
              <Text fontSize="2xs" color="gray.500">ETA {formatDateTime(delivery.estimated_eta)}</Text>
            )}
          </HStack>

          {/* Action Buttons */}
          <HStack spacing={2}>
            <Button
              flex={1}
              variant="outline"
              colorScheme="gray"
              size="md"
              onClick={onViewDetails}
            >
              View Details
            </Button>
            <Button
              flex={1}
              colorScheme="brand"
              size="md"
              onClick={onAccept}
              isLoading={accepting}
              loadingText="Accepting..."
            >
              Accept
            </Button>
          </HStack>
        </VStack>
      </CardBody>
    </Card>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// VIEW DETAILS MODAL - Task 9
// ─────────────────────────────────────────────────────────────────────────────
interface ViewDetailsModalProps {
  delivery: DeliveryWithBatch | null
  isOpen: boolean
  onClose: () => void
  onAccept: () => void
  accepting: boolean
}

const ViewDetailsModal: React.FC<ViewDetailsModalProps> = ({
  delivery,
  isOpen,
  onClose,
  onAccept,
  accepting,
}) => {
  if (!delivery) return null

  const isExpress = delivery.delivery_type === 'express'
  const isBuyoutDelivery = !!delivery.trade_id

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg" scrollBehavior="inside">
      <ModalOverlay />
      <ModalContent mx={4}>
        <ModalHeader pb={2}>
          <HStack>
            <Badge colorScheme={isExpress ? 'purple' : 'blue'} fontSize="sm">
              {isExpress ? 'EXPRESS' : 'STANDARD'}
            </Badge>
            <Text>Delivery Details</Text>
          </HStack>
        </ModalHeader>
        <ModalCloseButton />
        <ModalBody>
          <VStack spacing={4} align="stretch">
            {/* Mini Map Preview */}
            <Box
              h="150px"
              bg="gray.100"
              borderRadius="md"
              display="flex"
              alignItems="center"
              justifyContent="center"
              border="1px"
              borderColor="gray.200"
              overflow="hidden"
            >
              <VStack spacing={2}>
                <Icon as={FaMapMarkerAlt} color="gray.400" boxSize={8} />
                <Text fontSize="sm" color="gray.500">Route preview</Text>
              </VStack>
            </Box>

            {/* Addresses */}
            <Box>
              <Text fontWeight="bold" fontSize="sm" mb={2}>Route</Text>
              <VStack spacing={2} align="stretch" bg="gray.50" p={3} borderRadius="md">
                {isBuyoutDelivery ? (
                  <>
                    <HStack spacing={2}>
                      <Badge colorScheme="blue" fontSize="xs">BUYER PAYMENT</Badge>
                      <VStack spacing={0} align="start">
                        <Text fontSize="sm">{delivery.delivery_address}</Text>
                        <Text fontSize="2xs" color="gray.500">Collect buyer payment + delivery fee</Text>
                      </VStack>
                    </HStack>
                    <HStack spacing={2}>
                      <Badge colorScheme="orange" fontSize="xs">SELLER PICKUP</Badge>
                      <VStack spacing={0} align="start">
                        <Text fontSize="sm">{delivery.pickup_address}</Text>
                        <Text fontSize="2xs" color="gray.500">Pay seller and pick up item</Text>
                      </VStack>
                    </HStack>
                    <HStack spacing={2}>
                      <Badge colorScheme="green" fontSize="xs">DELIVER TO BUYER</Badge>
                      <VStack spacing={0} align="start">
                        <Text fontSize="sm">{delivery.delivery_address}</Text>
                        <Text fontSize="2xs" color="gray.500">Deliver item to buyer</Text>
                      </VStack>
                    </HStack>
                  </>
                ) : (
                  <>
                    <HStack spacing={2}>
                      <Badge colorScheme="blue" fontSize="xs">PICKUP</Badge>
                      <VStack spacing={0} align="start">
                        <Text fontSize="sm">{delivery.pickup_address}</Text>
                        {(delivery.user_name || delivery.receiver_name) && (
                          <Text fontSize="2xs" color="gray.500">From {delivery.user_name || 'Sender'}</Text>
                        )}
                      </VStack>
                    </HStack>
                    <HStack spacing={2}>
                      <Badge colorScheme="green" fontSize="xs">DROP-OFF</Badge>
                      <VStack spacing={0} align="start">
                        <Text fontSize="sm">{delivery.delivery_address}</Text>
                        {(delivery.user_name || delivery.receiver_name) && (
                          <Text fontSize="2xs" color="gray.500">To {delivery.receiver_name || 'Receiver'}</Text>
                        )}
                      </VStack>
                    </HStack>
                  </>
                )}
              </VStack>
            </Box>

            {/* Item List */}
            <Box>
              <Text fontWeight="bold" fontSize="sm" mb={2}>Items ({delivery.item_count})</Text>
              <VStack spacing={2} align="stretch">
                {delivery.items?.map((item, idx) => (
                  <HStack key={idx} bg="gray.50" p={2} borderRadius="md" justify="space-between">
                    <HStack spacing={2}>
                      <Icon as={FaBox} color="gray.500" />
                      <Text fontSize="sm">{item.product_name || `Item ${idx + 1}`}</Text>
                    </HStack>
                    {item.is_fragile && (
                      <Badge colorScheme="red" fontSize="xs">Fragile</Badge>
                    )}
                  </HStack>
                )) || (
                  <HStack bg="gray.50" p={2} borderRadius="md">
                    <Icon as={FaBox} color="gray.500" />
                    <Text fontSize="sm">{delivery.item_count} item(s)</Text>
                  </HStack>
                )}
              </VStack>
            </Box>

            {/* Special Handling Notes */}
            {(delivery.special_instructions || delivery.is_fragile) && (
              <Box>
                <Text fontWeight="bold" fontSize="sm" mb={2}>Special Handling</Text>
                <VStack spacing={2} align="stretch">
                  {delivery.is_fragile && (
                    <Alert status="warning" borderRadius="md" py={2}>
                      <AlertIcon />
                      <Text fontSize="sm">Fragile items - handle with care</Text>
                    </Alert>
                  )}
                  {delivery.special_instructions && (
                    <Box bg="yellow.50" p={3} borderRadius="md" border="1px" borderColor="yellow.200">
                      <Text fontSize="sm" color="yellow.800">{delivery.special_instructions}</Text>
                    </Box>
                  )}
                </VStack>
              </Box>
            )}

            {/* Fee Breakdown */}
            <Box>
              <Text fontWeight="bold" fontSize="sm" mb={2}>Fee Breakdown</Text>
              <VStack spacing={2} align="stretch" bg="green.50" p={3} borderRadius="md">
                {isBuyoutDelivery ? (
                  <>
                    <HStack justify="space-between">
                      <Text fontSize="sm" color="gray.600">Delivery fee (buyer):</Text>
                      <Text fontSize="sm" fontWeight="bold">₱{delivery.total_cost}</Text>
                    </HStack>
                    <HStack justify="space-between">
                      <Text fontSize="sm" color="gray.600">Product cash:</Text>
                      <Text fontSize="sm" fontWeight="bold">Collected from buyer, paid to seller</Text>
                    </HStack>
                    <Divider />
                    <HStack justify="space-between">
                      <Text fontSize="sm" fontWeight="bold" color="green.700">Your earnings:</Text>
                      <Text fontSize="lg" fontWeight="bold" color="green.600">
                        ₱{delivery.rider_cut || delivery.total_cost}
                      </Text>
                    </HStack>
                  </>
                ) : (
                  <>
                    <HStack justify="space-between">
                      <Text fontSize="sm" color="gray.600">Sender pays:</Text>
                      <Text fontSize="sm" fontWeight="bold">₱{delivery.sender_fee || delivery.total_cost}</Text>
                    </HStack>
                    <HStack justify="space-between">
                      <Text fontSize="sm" color="gray.600">Receiver pays:</Text>
                      <Text fontSize="sm" fontWeight="bold">₱{delivery.receiver_fee || 0}</Text>
                    </HStack>
                    <Divider />
                    <HStack justify="space-between">
                      <Text fontSize="sm" fontWeight="bold" color="green.700">Your earnings:</Text>
                      <Text fontSize="lg" fontWeight="bold" color="green.600">
                        ₱{delivery.rider_cut || delivery.total_cost}
                      </Text>
                    </HStack>
                  </>
                )}
              </VStack>
            </Box>

            {/* Distance & Time */}
            <SimpleGrid columns={2} spacing={3}>
              <Box bg="gray.50" p={3} borderRadius="md" textAlign="center">
                <Icon as={FaRoute} color="brand.500" boxSize={5} mb={1} />
                <Text fontSize="lg" fontWeight="bold">{delivery.distance_km?.toFixed(1) || '~'} km</Text>
                <Text fontSize="xs" color="gray.500">Total distance</Text>
              </Box>
              <Box bg="gray.50" p={3} borderRadius="md" textAlign="center">
                <Icon as={FaClock} color="brand.500" boxSize={5} mb={1} />
                <Text fontSize="lg" fontWeight="bold">{delivery.estimated_minutes || '~'} mins</Text>
                <Text fontSize="xs" color="gray.500">Est. duration</Text>
              </Box>
            </SimpleGrid>

            {/* Timing */}
            <Box>
              <Text fontWeight="bold" fontSize="sm" mb={2}>Time</Text>
              <VStack spacing={2} align="stretch" bg="gray.50" p={3} borderRadius="md">
                <HStack justify="space-between">
                  <Text fontSize="sm" color="gray.600">Posted:</Text>
                  <Text fontSize="sm" fontWeight="medium">{formatDateTime(delivery.created_at)}</Text>
                </HStack>
                {delivery.estimated_eta && (
                  <HStack justify="space-between">
                    <Text fontSize="sm" color="gray.600">Estimated ETA:</Text>
                    <Text fontSize="sm" fontWeight="medium">{formatDateTime(delivery.estimated_eta)}</Text>
                  </HStack>
                )}
                {delivery.claimed_at && (
                  <HStack justify="space-between">
                    <Text fontSize="sm" color="gray.600">Claimed:</Text>
                    <Text fontSize="sm" fontWeight="medium">{formatDateTime(delivery.claimed_at)}</Text>
                  </HStack>
                )}
              </VStack>
            </Box>
          </VStack>
        </ModalBody>
        <ModalFooter>
          <HStack spacing={2} w="full">
            <Button flex={1} variant="outline" onClick={onClose}>
              Close
            </Button>
            <Button
              flex={1}
              colorScheme="brand"
              onClick={onAccept}
              isLoading={accepting}
              loadingText="Accepting..."
            >
              Accept Delivery
            </Button>
          </HStack>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// BATCH UPGRADE MODAL - Task 10
// ─────────────────────────────────────────────────────────────────────────────
interface BatchUpgradeModalProps {
  delivery: DeliveryWithBatch | null
  isOpen: boolean
  onClose: () => void
  onUpgrade: () => void
  onDispatchSolo: () => void
  loading: boolean
}

const BatchUpgradeModal: React.FC<BatchUpgradeModalProps> = ({
  delivery,
  isOpen,
  onClose,
  onUpgrade,
  onDispatchSolo,
  loading,
}) => {
  if (!delivery) return null

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="md" isCentered>
      <ModalOverlay />
      <ModalContent mx={4}>
        <ModalHeader textAlign="center" pb={2}>
          <Icon as={FaClock} color="orange.500" boxSize={8} mb={2} />
          <Text>Batch Window Expired</Text>
        </ModalHeader>
        <ModalBody>
          <VStack spacing={4} align="stretch">
            <Text textAlign="center" color="gray.600">
              No matching orders found within 20 minutes. You can dispatch this order solo at the standard rate, or upgrade to express for priority delivery.
            </Text>

            <Box bg="gray.50" p={3} borderRadius="md">
              <HStack justify="space-between" mb={2}>
                <Text fontSize="sm" color="gray.600">Current rate:</Text>
                <Text fontWeight="bold">₱{delivery.rider_cut || delivery.total_cost}</Text>
              </HStack>
              <HStack justify="space-between">
                <Text fontSize="sm" color="gray.600">Express rate:</Text>
                <Text fontWeight="bold" color="purple.600">
                  ₱{Math.round((delivery.rider_cut || delivery.total_cost) * 1.5)}
                </Text>
              </HStack>
            </Box>

            <Alert status="info" borderRadius="md">
              <AlertIcon />
              <Text fontSize="sm">Express orders get priority matching and higher earnings.</Text>
            </Alert>
          </VStack>
        </ModalBody>
        <ModalFooter>
          <VStack spacing={2} w="full">
            <Button
              w="full"
              colorScheme="purple"
              onClick={onUpgrade}
              isLoading={loading}
              leftIcon={<Icon as={FaBolt} />}
            >
              Upgrade to Express
            </Button>
            <Button
              w="full"
              variant="outline"
              onClick={onDispatchSolo}
              isLoading={loading}
            >
              Dispatch Solo (Standard)
            </Button>
          </VStack>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN RIDER HOME PAGE - Tasks 6 & 7
// ─────────────────────────────────────────────────────────────────────────────
const RiderHome: React.FC = () => {
  const navigate = useNavigate()
  const toast = useToast()
  const { riderState, loading: stateLoading } = useRiderState()
  const debugUIEnabled = import.meta.env.VITE_ENABLE_DEBUG_UI === 'true'

  // Tab state
  const [activeTab, setActiveTab] = useState<'home' | 'jobs' | 'earnings'>('home')
  const [deliveryTab, setDeliveryTab] = useState(0) // 0: Available, 1: Active, 2: Completed

  // Deliveries data
  const [availableDeliveries, setAvailableDeliveries] = useState<DeliveryWithBatch[]>([])
  const [activeDeliveries, setActiveDeliveries] = useState<DeliveryWithBatch[]>([])
  const [completedDeliveries, setCompletedDeliveries] = useState<DeliveryWithBatch[]>([])
  const [loading, setLoading] = useState(true)
  const [accepting, setAccepting] = useState<number | null>(null)
  // Task 14: Express job lock message
  const [expressLockMessage, setExpressLockMessage] = useState('')

  // Modal state
  const { isOpen: isDetailsOpen, onOpen: openDetails, onClose: closeDetails } = useDisclosure()
  const { isOpen: isBatchOpen, onOpen: openBatch, onClose: closeBatch } = useDisclosure()
  const { isOpen: isDebugOpen, onOpen: openDebug, onClose: closeDebug } = useDisclosure()
  const [selectedDelivery, setSelectedDelivery] = useState<DeliveryWithBatch | null>(null)
  const [batchExpiredDelivery, setBatchExpiredDelivery] = useState<DeliveryWithBatch | null>(null)

  // Diagnostics (helps debug "accepted but not showing")
  const [debugLoading, setDebugLoading] = useState(false)
  const [debugData, setDebugData] = useState<any>(null)

  // Fetch deliveries
  const fetchDeliveries = useCallback(async () => {
    if (!riderState?.permissions?.can_view_jobs) return

    try {
      const [availableRes, activeRes, completedRes] = await Promise.all([
        api.get('/api/deliveries/available'),
        api.get('/api/deliveries/my-jobs?status=active'),
        api.get('/api/deliveries/my-jobs?status=completed'),
      ])

      setAvailableDeliveries(availableRes.data?.data || [])
      setActiveDeliveries(activeRes.data?.data || [])
      setCompletedDeliveries(completedRes.data?.data || [])

      // Task 14: Show message if rider is locked on express job
      if (availableRes.data?.message) {
        setExpressLockMessage(availableRes.data.message)
      } else {
        setExpressLockMessage('')
      }
    } catch (error: any) {
      console.error('Failed to fetch deliveries:', error)
      const msg = error?.response?.data?.error || error?.message || 'Failed to fetch deliveries'
      toast({ title: 'Deliveries error', description: msg, status: 'error', duration: 3500 })
    } finally {
      setLoading(false)
    }
  }, [riderState?.permissions?.can_view_jobs, toast])

  useEffect(() => {
    fetchDeliveries()
    const interval = setInterval(fetchDeliveries, 15000)
    return () => clearInterval(interval)
  }, [fetchDeliveries])

  // Batch countdown timer
  useEffect(() => {
    const interval = setInterval(() => {
      setAvailableDeliveries(prev => prev.map(d => {
        if (d.is_batching && d.batch_countdown && d.batch_countdown > 0) {
          const newCountdown = d.batch_countdown - 1
          if (newCountdown <= 0) {
            // Batch window expired - show upgrade modal
            setBatchExpiredDelivery(d)
            openBatch()
          }
          return { ...d, batch_countdown: newCountdown }
        }
        return d
      }))
    }, 1000)
    return () => clearInterval(interval)
  }, [openBatch])

  // Handle accept delivery
  const handleAccept = async (delivery: DeliveryWithBatch) => {
    if (!riderState?.permissions?.can_claim_jobs) {
      toast({ title: 'Cannot accept', description: 'You are not authorized to claim deliveries.', status: 'error', duration: 3000 })
      return
    }

    setAccepting(delivery.id)
    try {
      await api.post(`/api/deliveries/${delivery.id}/claim`)
      toast({ title: 'Delivery Accepted!', description: 'Moved to Active jobs.', status: 'success', duration: 3000 })
      closeDetails()
      // Show the claimed job immediately
      setDeliveryTab(1)
      fetchDeliveries()
    } catch (error: any) {
      toast({ title: 'Error', description: error?.response?.data?.error || 'Failed to accept delivery', status: 'error', duration: 3000 })
    } finally {
      setAccepting(null)
    }
  }

  // Handle batch upgrade
  const handleBatchUpgrade = async () => {
    if (!batchExpiredDelivery) return
    // TODO: Implement upgrade to express API call
    toast({ title: 'Upgraded to Express', status: 'success', duration: 3000 })
    closeBatch()
    setBatchExpiredDelivery(null)
    fetchDeliveries()
  }

  const runJobsDiagnostics = async () => {
    if (!debugUIEnabled) return

    setDebugLoading(true)
    try {
      const res = await api.get('/api/deliveries/my-jobs-debug')
      setDebugData(res.data?.data || null)
      openDebug()
    } catch (error: any) {
      const msg = error?.response?.data?.error || error?.message || 'Failed to run diagnostics'
      toast({ title: 'Diagnostics error', description: msg, status: 'error', duration: 3500 })
    } finally {
      setDebugLoading(false)
    }
  }

  // Handle solo dispatch
  const handleDispatchSolo = async () => {
    if (!batchExpiredDelivery) return
    await handleAccept(batchExpiredDelivery)
    closeBatch()
    setBatchExpiredDelivery(null)
  }


  // Loading state
  if (stateLoading) {
    return (
      <Center minH="100vh" bg="#FFFDF1">
        <Spinner size="lg" color="brand.500" />
      </Center>
    )
  }

  // Task 20: Locked state view (single Pay Now button)
  if (riderState?.state === 'LOCKED') {
    return (
      <Center minH="100vh" bg="#FFFDF1" px={6}>
        <VStack spacing={4} maxW="sm" w="full" bg="white" border="1px" borderColor="orange.200" borderRadius="xl" p={5}>
          <HStack spacing={2}>
            <WarningIcon color="orange.500" boxSize={6} />
            <Heading size="sm" color="gray.800">Account Locked</Heading>
          </HStack>
          <Text fontSize="sm" color="gray.600" textAlign="center">
            {riderState?.message || 'You have remittance due. Pay now to unlock your next job.'}
          </Text>
          <Button w="full" colorScheme="brand" onClick={() => navigate('/remittance-ledger')}>
            Pay Now
          </Button>
        </VStack>
      </Center>
    )
  }

  // If not authorized to view jobs, show message (avoid blank screen)
  if (!riderState?.permissions?.can_view_jobs) {
    return (
      <Center minH="100vh" bg="#FFFDF1" px={6}>
        <VStack spacing={4} maxW="sm" w="full" bg="white" border="1px" borderColor="gray.200" borderRadius="xl" p={5}>
          <Heading size="sm" color="gray.800">Rider Access</Heading>
          <Text fontSize="sm" color="gray.600" textAlign="center">
            {riderState?.message || 'You are not authorized to view rider jobs.'}
          </Text>
          <Button w="full" variant="outline" colorScheme="brand" onClick={() => navigate('/rider-application')}>
            Go to Rider Application
          </Button>
        </VStack>
      </Center>
    )
  }

  // ─── RENDER HOME CONTENT ─────────────────────────────────────────────
  const renderHomeContent = () => (
    <VStack spacing={4} align="stretch" flex={1} overflowY="auto" pb="80px">
      {/* Header */}
      <HStack justify="space-between" align="center" px={4} pt={4}>
        <Heading size="md" color="gray.800">Available Deliveries</Heading>
        <Button
          size="sm"
          variant="outline"
          colorScheme="brand"
          leftIcon={<Icon as={FaHome} />}
          onClick={() => navigate('/home')}
        >
          Back to Home
        </Button>
      </HStack>

      {/* Delivery Tabs */}
      <Tabs index={deliveryTab} onChange={setDeliveryTab} colorScheme="brand" px={4}>
        <TabList>
          <Tab fontSize="sm">Available ({availableDeliveries.length})</Tab>
          <Tab fontSize="sm">Active ({activeDeliveries.length})</Tab>
          <Tab fontSize="sm">Completed ({completedDeliveries.length})</Tab>
        </TabList>

        <TabPanels>
          {/* Available Tab */}
          <TabPanel px={0}>
            {loading ? (
              <Center py={8}>
                <Spinner size="lg" color="brand.500" />
              </Center>
            ) : expressLockMessage ? (
              // Task 14: Show express lock message
              <Center py={12}>
                <VStack spacing={3}>
                  <Icon as={FaBolt} boxSize={12} color="purple.400" />
                  <Text color="gray.600" textAlign="center" fontWeight="medium">
                    Express Job Active
                  </Text>
                  <Text fontSize="sm" color="gray.500" textAlign="center" maxW="280px">
                    {expressLockMessage}
                  </Text>
                  <Button
                    size="sm"
                    colorScheme="purple"
                    onClick={() => setActiveTab('jobs')}
                  >
                    View Active Job
                  </Button>
                </VStack>
              </Center>
            ) : availableDeliveries.length === 0 ? (
              <Center py={12}>
                <VStack spacing={3}>
                  <Icon as={FaTruck} boxSize={12} color="gray.300" />
                  <Text color="gray.500" textAlign="center">
                    No deliveries right now.
                  </Text>
                  <Text fontSize="sm" color="gray.400" textAlign="center">
                    We'll notify you when new jobs are available.
                  </Text>
                  <Button
                    size="sm"
                    variant="outline"
                    colorScheme="brand"
                    leftIcon={<Icon as={FaSync} />}
                    onClick={fetchDeliveries}
                  >
                    Refresh
                  </Button>
                </VStack>
              </Center>
            ) : (
              <VStack spacing={3}>
                {availableDeliveries.map(delivery => (
                  <DeliveryCard
                    key={delivery.id}
                    delivery={delivery}
                    onViewDetails={() => {
                      setSelectedDelivery(delivery)
                      openDetails()
                    }}
                    onAccept={() => handleAccept(delivery)}
                    accepting={accepting === delivery.id}
                  />
                ))}
              </VStack>
            )}
          </TabPanel>

          {/* Active Tab */}
          <TabPanel px={0}>
            {activeDeliveries.length === 0 ? (
              <Center py={12}>
                <VStack spacing={3}>
                  <Icon as={FaCheckCircle} boxSize={12} color="gray.300" />
                  <Text color="gray.500">No active deliveries</Text>
                  {debugUIEnabled && (
                    <>
                      <Text fontSize="xs" color="gray.400" textAlign="center" maxW="280px">
                        If you just accepted a job but it’s not showing, run diagnostics to see what the backend has assigned to your rider.
                      </Text>
                      <Button
                        size="sm"
                        variant="outline"
                        colorScheme="brand"
                        onClick={runJobsDiagnostics}
                        isLoading={debugLoading}
                        loadingText="Checking..."
                      >
                        Run Diagnostics
                      </Button>
                    </>
                  )}
                </VStack>
              </Center>
            ) : (
              <VStack spacing={3}>
                {buildRiderOrders(activeDeliveries).map(order => {
                  if (order.deliveries.length === 1) {
                    const delivery = order.deliveries[0]
                    return (
                      <Card key={order.key} bg="white" border="1px" borderColor="green.200">
                        <CardBody p={3}>
                          <VStack spacing={2} align="stretch">
                            <HStack justify="space-between">
                              <HStack spacing={2}>
                                <Badge colorScheme="green">In Progress</Badge>
                                <Badge colorScheme={delivery.delivery_type === 'express' ? 'purple' : 'blue'}>
                                  {delivery.delivery_type === 'express' ? 'EXPRESS' : 'STANDARD'}
                                </Badge>
                              </HStack>
                              <Text fontWeight="bold" color="green.600">₱{delivery.total_cost}</Text>
                            </HStack>
                            {delivery.trade_id ? (
                              <VStack align="start" spacing={0}>
                                <Text fontSize="sm" noOfLines={1}>Buyer payment: {delivery.delivery_address}</Text>
                                <Text fontSize="xs" color="gray.500" noOfLines={1}>Seller pickup: {delivery.pickup_address}</Text>
                                <Text fontSize="xs" color="gray.500" noOfLines={1}>Deliver to buyer: {delivery.delivery_address}</Text>
                              </VStack>
                            ) : (
                              <>
                                <Text fontSize="sm" noOfLines={1}>{delivery.pickup_address}</Text>
                                <Text fontSize="xs" color="gray.500">→ {delivery.delivery_address}</Text>
                              </>
                            )}
                            <Text fontSize="2xs" color="gray.400">Claimed {formatDateTime(delivery.claimed_at || delivery.created_at)}</Text>
                            <Button size="sm" colorScheme="brand" onClick={() => navigate(`/task-stepper/${delivery.id}`)}>
                              Continue
                            </Button>
                          </VStack>
                        </CardBody>
                      </Card>
                    )
                  }

                  const firstIncomplete = order.deliveries.find(d => d.status !== 'delivered') || order.deliveries[0]
                  const totalEarnings = order.deliveries.reduce((sum, d) => sum + (d.rider_cut || d.total_cost || 0), 0)
                  return (
                    <Card key={order.key} bg="white" border="1px" borderColor="green.200">
                      <CardBody p={3}>
                        <VStack spacing={3} align="stretch">
                          <HStack justify="space-between">
                            <HStack spacing={2}>
                              <Badge colorScheme="green">Trade Delivery</Badge>
                              <Badge colorScheme="gray" variant="subtle">{order.deliveries.length} legs</Badge>
                            </HStack>
                            <Text fontWeight="bold" color="green.600">₱{Math.round(totalEarnings)}</Text>
                          </HStack>

                          <VStack spacing={2} align="stretch" bg="gray.50" p={3} borderRadius="md">
                            {order.deliveries.map((leg, idx) => (
                              <Box key={leg.id}>
                                <HStack justify="space-between" mb={1}>
                                  <Text fontSize="xs" color="gray.600" fontWeight="bold">Leg {idx + 1}</Text>
                                  <Badge colorScheme={leg.delivery_type === 'express' ? 'purple' : 'blue'} fontSize="xs">
                                    {leg.delivery_type === 'express' ? 'EXPRESS' : 'STANDARD'}
                                  </Badge>
                                </HStack>
                                <Text fontSize="sm" noOfLines={1}>{leg.pickup_address}</Text>
                                <Text fontSize="xs" color="gray.500" noOfLines={1}>→ {leg.delivery_address}</Text>
                              </Box>
                            ))}
                          </VStack>

                          <Text fontSize="2xs" color="gray.400">Claimed {formatDateTime(firstIncomplete.claimed_at || firstIncomplete.created_at)}</Text>
                          <Button size="sm" colorScheme="brand" onClick={() => navigate(`/task-stepper/${firstIncomplete.id}`)}>
                            Continue Delivery
                          </Button>
                        </VStack>
                      </CardBody>
                    </Card>
                  )
                })}
              </VStack>
            )}
          </TabPanel>

          {/* Completed Tab */}
          <TabPanel px={0}>
            {completedDeliveries.length === 0 ? (
              <Center py={12}>
                <VStack spacing={3}>
                  <Icon as={FaTruck} boxSize={12} color="gray.300" />
                  <Text color="gray.500">No completed deliveries yet</Text>
                </VStack>
              </Center>
            ) : (
              <VStack spacing={3}>
                {buildRiderOrders(completedDeliveries).map(order => {
                  if (order.deliveries.length === 1) {
                    const delivery = order.deliveries[0]
                    return (
                      <Card key={order.key} bg="white" border="1px" borderColor="gray.200">
                        <CardBody p={3}>
                          <HStack justify="space-between">
                            <VStack align="start" spacing={1}>
                              <HStack>
                                <Icon as={FaCheckCircle} color="green.500" />
                                <Text fontSize="sm" fontWeight="bold">₱{delivery.total_cost}</Text>
                              </HStack>
                              {delivery.trade_id ? (
                                <VStack align="start" spacing={0}>
                                  <Text fontSize="xs" color="gray.500" noOfLines={1}>
                                    Buyer payment: {delivery.delivery_address}
                                  </Text>
                                  <Text fontSize="xs" color="gray.500" noOfLines={1}>
                                    Seller pickup: {delivery.pickup_address}
                                  </Text>
                                  <Text fontSize="xs" color="gray.500" noOfLines={1}>
                                    Deliver to buyer: {delivery.delivery_address}
                                  </Text>
                                </VStack>
                              ) : (
                                <Text fontSize="xs" color="gray.500" noOfLines={1}>
                                  {delivery.pickup_address} → {delivery.delivery_address}
                                </Text>
                              )}
                              <Text fontSize="2xs" color="gray.400">
                                {delivery.delivered_at ? formatDateTime(delivery.delivered_at) : ''}
                              </Text>
                            </VStack>
                          </HStack>
                        </CardBody>
                      </Card>
                    )
                  }

                  const lastDeliveredAt = order.deliveries
                    .map(d => d.delivered_at)
                    .filter(Boolean)
                    .sort()
                    .slice(-1)[0]

                  const total = order.deliveries.reduce((sum, d) => sum + (d.total_cost || 0), 0)
                  return (
                    <Card key={order.key} bg="white" border="1px" borderColor="gray.200">
                      <CardBody p={3}>
                        <VStack spacing={2} align="stretch">
                          <HStack justify="space-between">
                            <HStack spacing={2}>
                              <Icon as={FaCheckCircle} color="green.500" />
                              <Text fontSize="sm" fontWeight="bold">Trade Delivery</Text>
                              <Badge colorScheme="gray" variant="subtle">{order.deliveries.length} legs</Badge>
                            </HStack>
                            <Text fontSize="sm" fontWeight="bold">₱{total}</Text>
                          </HStack>

                          <VStack spacing={1} align="stretch">
                            {order.deliveries.map((leg, idx) => (
                              <Text key={leg.id} fontSize="xs" color="gray.600" noOfLines={1}>
                                Leg {idx + 1}: {leg.pickup_address} → {leg.delivery_address}
                              </Text>
                            ))}
                          </VStack>

                          <Text fontSize="2xs" color="gray.400">
                            {lastDeliveredAt ? formatDateTime(lastDeliveredAt) : ''}
                          </Text>
                        </VStack>
                      </CardBody>
                    </Card>
                  )
                })}
              </VStack>
            )}
          </TabPanel>
        </TabPanels>
      </Tabs>
    </VStack>
  )

  // ─── RENDER JOBS CONTENT ─────────────────────────────────────────────
  const renderJobsContent = () => (
    <VStack spacing={4} align="stretch" flex={1} pb="80px" px={4} pt={4}>
      <Heading size="md" color="gray.800">My Jobs</Heading>
      {activeDeliveries.length === 0 ? (
        <Center py={12}>
          <VStack spacing={3}>
            <Icon as={FaTruck} boxSize={12} color="gray.300" />
            <Text color="gray.500">No active jobs</Text>
            <Button size="sm" colorScheme="brand" onClick={() => setActiveTab('home')}>
              Find Jobs
            </Button>
          </VStack>
        </Center>
      ) : (
        <VStack spacing={3}>
          {buildRiderOrders(activeDeliveries).map(order => {
            if (order.deliveries.length === 1) {
              const delivery = order.deliveries[0]
              return (
                <Card key={order.key} bg="white" border="2px" borderColor="brand.200">
                  <CardBody>
                    <VStack spacing={3} align="stretch">
                      <HStack justify="space-between">
                        <HStack spacing={2}>
                          <Badge colorScheme="green">{delivery.status}</Badge>
                          <Badge colorScheme={delivery.delivery_type === 'express' ? 'purple' : 'blue'}>
                            {delivery.delivery_type === 'express' ? 'EXPRESS' : 'STANDARD'}
                          </Badge>
                        </HStack>
                        <Text fontWeight="bold" color="green.600">₱{delivery.total_cost}</Text>
                      </HStack>
                      {delivery.trade_id ? (
                        <VStack align="start" spacing={0}>
                          <Text fontSize="sm">Buyer payment: {delivery.delivery_address}</Text>
                          <Text fontSize="sm">Seller pickup: {delivery.pickup_address}</Text>
                          <Text fontSize="sm">Deliver to buyer: {delivery.delivery_address}</Text>
                        </VStack>
                      ) : (
                        <>
                          <Text fontSize="sm">{delivery.pickup_address}</Text>
                          <Text fontSize="sm">→ {delivery.delivery_address}</Text>
                        </>
                      )}
                      <Text fontSize="2xs" color="gray.400">Claimed {formatDateTime(delivery.claimed_at || delivery.created_at)}</Text>
                      <Button colorScheme="brand" onClick={() => navigate(`/task-stepper/${delivery.id}`)}>
                        Continue Delivery
                      </Button>
                    </VStack>
                  </CardBody>
                </Card>
              )
            }

            const firstIncomplete = order.deliveries.find(d => d.status !== 'delivered') || order.deliveries[0]
            const total = order.deliveries.reduce((sum, d) => sum + (d.total_cost || 0), 0)
            return (
              <Card key={order.key} bg="white" border="2px" borderColor="brand.200">
                <CardBody>
                  <VStack spacing={3} align="stretch">
                    <HStack justify="space-between">
                      <HStack spacing={2}>
                        <Badge colorScheme="green">Trade Delivery</Badge>
                        <Badge colorScheme="gray" variant="subtle">{order.deliveries.length} legs</Badge>
                      </HStack>
                      <Text fontWeight="bold" color="green.600">₱{total}</Text>
                    </HStack>

                    <VStack spacing={1} align="stretch" bg="gray.50" p={3} borderRadius="md">
                      {order.deliveries.map((leg, idx) => (
                        <Box key={leg.id}>
                          <Text fontSize="xs" fontWeight="bold" color="gray.600">Leg {idx + 1}</Text>
                          <Text fontSize="sm">{leg.pickup_address}</Text>
                          <Text fontSize="sm">→ {leg.delivery_address}</Text>
                        </Box>
                      ))}
                    </VStack>

                    <Text fontSize="2xs" color="gray.400">Claimed {formatDateTime(firstIncomplete.claimed_at || firstIncomplete.created_at)}</Text>
                    <Button colorScheme="brand" onClick={() => navigate(`/task-stepper/${firstIncomplete.id}`)}>
                      Continue Delivery
                    </Button>
                  </VStack>
                </CardBody>
              </Card>
            )
          })}
        </VStack>
      )}
    </VStack>
  )

  // ─── RENDER EARNINGS CONTENT ─────────────────────────────────────────
  const renderEarningsContent = () => (
    <Box flex={1} overflowY="auto" pb="80px">
      <RemittanceLedger
        embedded
        totalEarnings={completedDeliveries.reduce((sum, d) => sum + d.total_cost, 0)}
      />
    </Box>
  )

  return (
    <Box minH="100vh" bg="#FFFDF1" display="flex" flexDirection="column">
      {/* Main Content */}
      <Box w="full" maxW="md" mx="auto" flex={1}>
        {activeTab === 'home' && renderHomeContent()}
        {activeTab === 'jobs' && renderJobsContent()}
        {activeTab === 'earnings' && renderEarningsContent()}
      </Box>

      {/* Bottom Navigation - Task 6 */}
      <Box
        position="fixed"
        bottom={0}
        left="50%"
        transform="translateX(-50%)"
        w="full"
        maxW="md"
        bg="white"
        borderTop="1px"
        borderColor="gray.200"
        px={4}
        py={2}
        zIndex={100}
      >
        <HStack justify="space-around">
          <Button
            variant="ghost"
            flexDirection="column"
            h="60px"
            flex={1}
            color={activeTab === 'home' ? 'brand.500' : 'gray.500'}
            onClick={() => setActiveTab('home')}
          >
            <Icon as={FaHome} boxSize={5} mb={1} />
            <Text fontSize="xs">Home</Text>
          </Button>
          <Button
            variant="ghost"
            flexDirection="column"
            h="60px"
            flex={1}
            color={activeTab === 'earnings' ? 'brand.500' : 'gray.500'}
            onClick={() => setActiveTab('earnings')}
          >
            <Icon as={FaWallet} boxSize={5} mb={1} />
            <Text fontSize="xs">Earnings</Text>
          </Button>
        </HStack>
      </Box>

      {/* Modals */}
      <ViewDetailsModal
        delivery={selectedDelivery}
        isOpen={isDetailsOpen}
        onClose={closeDetails}
        onAccept={() => selectedDelivery && handleAccept(selectedDelivery)}
        accepting={accepting === selectedDelivery?.id}
      />

      <BatchUpgradeModal
        delivery={batchExpiredDelivery}
        isOpen={isBatchOpen}
        onClose={closeBatch}
        onUpgrade={handleBatchUpgrade}
        onDispatchSolo={handleDispatchSolo}
        loading={accepting === batchExpiredDelivery?.id}
      />

      <Modal isOpen={isDebugOpen} onClose={closeDebug} size="lg">
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Rider Jobs Diagnostics</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <Box
              as="pre"
              fontSize="xs"
              whiteSpace="pre-wrap"
              bg="gray.50"
              border="1px"
              borderColor="gray.200"
              borderRadius="md"
              p={3}
            >
              {JSON.stringify(debugData, null, 2)}
            </Box>
          </ModalBody>
          <ModalFooter>
            <Button onClick={closeDebug}>Close</Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Box>
  )
}

export default RiderHome
