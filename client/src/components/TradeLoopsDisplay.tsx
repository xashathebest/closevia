import React, { useState, useEffect } from 'react'
import {
  Box,
  VStack,
  HStack,
  Text,
  Badge,
  Button,
  Spinner,
  Center,
  useToast,
  Heading,
  Divider,
  Grid,
  Image,
  Tooltip,
  Icon,
  useDisclosure,
  Card,
  CardBody,
  Flex,
  useColorModeValue,
} from '@chakra-ui/react'
import { FaArrowRight, FaLink, FaStar, FaUsers } from 'react-icons/fa'
import { TradeLoop, TradeEdge, MultiWayTrade } from '../types'
import { fetchTradeLoops, fetchMultiWayTrade } from '../services/tradeService'
import MultiWayTradeModal from './MultiWayTradeModal.tsx'

/**
 * Extended loop type to handle both shapes returned by the backend:
 *   - "detected_loop": has edges[] array
 *   - "invited_chain": has participants as objects (no edges)
 * The backend uses map[string]interface{} so the JSON shape varies.
 */
interface BackendLoop {
  id?: string
  loop_id?: string
  chain_id?: string
  is_chain?: boolean
  loop_type?: string // 'detected_loop' | 'invited_chain'
  loop_length: number
  status?: string
  edges?: TradeEdge[]
  participants: any[] // number[] for detected_loop, object[] for invited_chain
  initiator_name?: string
  initiator_user_id?: number
  can_join?: boolean
  can_decline?: boolean
  can_create?: boolean
  expires_at?: string
}

/**
 * Synthesize edges from participant objects when the backend doesn't provide them.
 * Participants come as [{id, user_name, product_title, status}, ...].
 */
function synthesizeEdges(participants: any[]): TradeEdge[] {
  if (!Array.isArray(participants) || participants.length < 2) return []
  const edges: TradeEdge[] = []
  for (let i = 0; i < participants.length; i++) {
    const from = participants[i]
    const to = participants[(i + 1) % participants.length]
    edges.push({
      from_user: from.id || 0,
      to_user: to.id || 0,
      trade_id: 0,
      from_user_name: from.user_name || `User ${from.id}`,
      to_user_name: to.user_name || `User ${to.id}`,
      product_title: from.product_title || 'Product',
      status: from.status || 'pending',
    })
  }
  return edges
}

const TradeLoopsDisplay: React.FC = () => {
  const [loops, setLoops] = useState<BackendLoop[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedLoop, setSelectedLoop] = useState<MultiWayTrade | null>(null)
  const { isOpen, onOpen, onClose } = useDisclosure()
  const toast = useToast()
  
  const cardBg = useColorModeValue('white', 'gray.800')
  const borderColor = useColorModeValue('gray.200', 'gray.700')
  const hoverBg = useColorModeValue('blue.50', 'blue.900')

  const fetchLoops = async () => {
    try {
      setLoading(true)
      const data = await fetchTradeLoops()
      setLoops(data as any)
    } catch (error: any) {
      toast({
        id: "tradeloopsdisplay-error",
        title: 'Error',
        description: error?.response?.data?.error || 'Failed to fetch trade loops',
        status: 'error',
        duration: 5000,
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchLoops()
    // Refresh every 30 seconds to check for new loops
    const interval = setInterval(fetchLoops, 30000)
    return () => clearInterval(interval)
  }, [])

  const handleSelectLoop = async (loop: BackendLoop) => {
    try {
      setLoading(true)
      // Use the backend-provided loop_id / id / chain_id instead of constructing from edges
      const loopId = loop.loop_id || loop.id || loop.chain_id
        || (loop.edges && loop.edges.length > 0
          ? `loop_${loop.edges.map(e => e.trade_id).join('_')}`
          : '')
      if (!loopId) {
        throw new Error('Could not determine loop ID')
      }
      const multiWayTrade = await fetchMultiWayTrade(loopId)
      setSelectedLoop(multiWayTrade)
      onOpen()
    } catch (error: any) {
      toast({
        id: "tradeloopsdisplay-error-2",
        title: 'Error',
        description: error?.response?.data?.error || 'Failed to load trade loop details',
        status: 'error',
      })
    } finally {
      setLoading(false)
    }
  }

  const handleCloseModal = () => {
    onClose()
    setSelectedLoop(null)
    // Refresh loops when modal closes
    fetchLoops()
  }

  if (loading && loops.length === 0) {
    return (
      <Center py={8}>
        <Spinner size="lg" color="brand.500" />
      </Center>
    )
  }

  if (loops.length === 0) {
    return (
      <Card bg={cardBg} borderColor={borderColor} borderWidth="1px" mb={6}>
        <CardBody>
          <HStack spacing={3} justify="center" py={8}>
            <Icon as={FaLink} fontSize="2xl" color="gray.400" />
            <VStack align="start" spacing={0}>
              <Text fontWeight="semibold" color="gray.600">
                No multi-way trades available
              </Text>
              <Text fontSize="sm" color="gray.500">
                Create more trade offers to unlock trading loops
              </Text>
            </VStack>
          </HStack>
        </CardBody>
      </Card>
    )
  }

  return (
    <Box>
      <Heading size="md" mb={4} display="flex" alignItems="center" gap={2}>
        <Icon as={FaLink} color="green.500" />
        Multi-Way Trading Opportunities ({loops.length})
      </Heading>
      <Text fontSize="sm" color="gray.600" mb={4}>
        We found trade chains that can benefit multiple users! Click on any loop to review and participate.
      </Text>
      
      <VStack spacing={4} align="stretch">
        {loops.map((loop, idx) => {
          // Resolve edges: use backend edges if present, otherwise synthesize from participants
          const edges: TradeEdge[] = Array.isArray(loop.edges) && loop.edges.length > 0
            ? loop.edges
            : synthesizeEdges(loop.participants)

          const isChain = loop.is_chain || loop.loop_type === 'invited_chain'
          const loopStatus = loop.status || edges?.[0]?.status || 'pending'

          // Friendly status label
          const statusLabel = (() => {
            switch (loopStatus) {
              case 'pending_user3': return 'Awaiting Response'
              case 'partially_accepted': return 'Partially Accepted'
              case 'user3_accepted': return 'Accepted'
              case 'pending_initiator_upgrade': return 'Awaiting Response'
              case 'confirmed':
              case 'ongoing':
              case 'active': return 'Active'
              case 'completed': return 'Completed'
              case 'history': return 'History'
              case 'broken': return 'Broken'
              case 'expired': return 'Expired'
              case 'cancelled_due_to_conflict': return 'Cancelled by Conflict'
              case 'rejected': return 'Rejected'
              default: return loopStatus
            }
          })()
          const statusColor = (() => {
            switch (loopStatus) {
              case 'confirmed':
              case 'ongoing':
              case 'active':
              case 'user3_accepted': return 'green'
              case 'completed': return 'blue'
              case 'pending_initiator_upgrade': return 'yellow'
              case 'broken':
              case 'expired':
              case 'cancelled':
              case 'cancelled_due_to_conflict':
              case 'rejected': return 'red'
              case 'partially_accepted': return 'purple'
              default: return 'yellow'
            }
          })()

          return (
            <Card
              key={loop.loop_id || loop.id || idx}
              bg={cardBg}
              borderColor={borderColor}
              borderWidth="1px"
              _hover={{ bg: hoverBg, cursor: 'pointer', borderColor: 'brand.500' }}
              transition="all 0.2s"
              onClick={() => handleSelectLoop(loop)}
            >
              <CardBody>
                <Flex justify="space-between" align="start" mb={3}>
                  <HStack spacing={2} flexWrap="wrap">
                    <Badge colorScheme="green" variant="solid">
                      {loop.loop_length}-Way Trade
                    </Badge>
                    {isChain && (
                      <Badge colorScheme="purple" variant="subtle">
                        Chain
                      </Badge>
                    )}
                    <Badge colorScheme="blue" variant="outline">
                      <Icon as={FaUsers} mr={1} />
                      {loop.participants.length} participants
                    </Badge>
                  </HStack>
                  <Button
                    size="sm"
                    colorScheme="brand"
                    isLoading={loading}
                    onClick={(e) => {
                      e.stopPropagation()
                      handleSelectLoop(loop)
                    }}
                  >
                    View Details
                  </Button>
                </Flex>

                {/* Trade chain visualization */}
                {edges.length > 0 && (
                  <Box overflowX="auto" mb={3}>
                    <HStack spacing={2} py={2} minW="max-content">
                      {edges.map((edge, edgeIdx) => (
                        <React.Fragment key={edgeIdx}>
                          <Tooltip label={edge.from_user_name} placement="top">
                            <Box
                              bg="blue.100"
                              color="blue.900"
                              px={3}
                              py={2}
                              borderRadius="md"
                              fontSize="sm"
                              fontWeight="semibold"
                              whiteSpace="nowrap"
                              cursor="help"
                            >
                              {edge.from_user_name || `User ${edge.from_user}`}
                            </Box>
                          </Tooltip>

                          <Icon as={FaArrowRight} color="gray.400" />

                          <Tooltip label={edge.product_title} placement="top">
                            <Box
                              bg="purple.50"
                              color="purple.900"
                              px={3}
                              py={2}
                              borderRadius="md"
                              fontSize="sm"
                              fontWeight="medium"
                              whiteSpace="nowrap"
                              maxW="150px"
                              overflow="hidden"
                              textOverflow="ellipsis"
                              cursor="help"
                            >
                              {edge.product_title || 'Product'}
                            </Box>
                          </Tooltip>

                          {edgeIdx < edges.length - 1 && (
                            <Icon as={FaArrowRight} color="gray.400" />
                          )}
                        </React.Fragment>
                      ))}
                      
                      {/* Close the loop visualization */}
                      <Icon as={FaArrowRight} color="gray.400" />
                      <Tooltip label={edges[0]?.from_user_name} placement="top">
                        <Box
                          bg="green.100"
                          color="green.900"
                          px={3}
                          py={2}
                          borderRadius="md"
                          fontSize="sm"
                          fontWeight="semibold"
                          whiteSpace="nowrap"
                          cursor="help"
                        >
                          {edges[0]?.from_user_name || `User ${edges[0]?.from_user}`}
                        </Box>
                      </Tooltip>
                    </HStack>
                  </Box>
                )}

                {/* Summary info */}
                <HStack spacing={4} fontSize="sm" color="gray.600">
                  <HStack spacing={1}>
                    <Icon as={FaStar} color="yellow.400" />
                    <Text>Loop #{idx + 1}</Text>
                  </HStack>
                  {loop.initiator_name && (
                    <Text fontSize="xs">
                      Initiated by: <strong>{loop.initiator_name}</strong>
                    </Text>
                  )}
                  <Text>
                    Status: <Badge fontSize="xs" colorScheme={statusColor}>{statusLabel}</Badge>
                  </Text>
                </HStack>
              </CardBody>
            </Card>
          )
        })}
      </VStack>

      {/* Multi-Way Trade Modal */}
      {selectedLoop && (
        <MultiWayTradeModal
          isOpen={isOpen}
          onClose={handleCloseModal}
          multiWayTrade={selectedLoop}
          onTradeCompleted={fetchLoops}
        />
      )}
    </Box>
  )
}

export default TradeLoopsDisplay
