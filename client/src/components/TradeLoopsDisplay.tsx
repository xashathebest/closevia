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
import { FaArrowRight, FaLink, FaStar } from 'react-icons/fa'
import { TradeLoop, MultiWayTrade } from '../types'
import { fetchTradeLoops, fetchMultiWayTrade } from '../services/tradeService'
import MultiWayTradeModal from './MultiWayTradeModal.tsx'

const TradeLoopsDisplay: React.FC = () => {
  const [loops, setLoops] = useState<TradeLoop[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedLoop, setSelectedLoop] = useState<MultiWayTrade | null>(null)
  const { isOpen, onOpen, onClose } = useDisclosure()
  const toast = useToast()
  
  const cardBg = useColorModeValue('white', 'gray.800')
  const borderColor = useColorModeValue('gray.200', 'gray.700')
  const hoverBg = useColorModeValue('blue.50', 'blue.900')
  const badgeBg = useColorModeValue('green.100', 'green.900')

  const fetchLoops = async () => {
    try {
      setLoading(true)
      const data = await fetchTradeLoops()
      setLoops(data)
    } catch (error: any) {
      toast({
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

  const handleSelectLoop = async (loop: TradeLoop) => {
    try {
      setLoading(true)
      // Construct loop ID from edges
      const loopId = `loop_${loop.edges.map(e => e.trade_id).join('_')}`
      const multiWayTrade = await fetchMultiWayTrade(loopId)
      setSelectedLoop(multiWayTrade)
      onOpen()
    } catch (error: any) {
      toast({
        title: 'Error',
        description: 'Failed to load trade loop details',
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
        {loops.map((loop, idx) => (
          <Card
            key={idx}
            bg={cardBg}
            borderColor={borderColor}
            borderWidth="1px"
            _hover={{ bg: hoverBg, cursor: 'pointer', borderColor: 'brand.500' }}
            transition="all 0.2s"
            onClick={() => handleSelectLoop(loop)}
          >
            <CardBody>
              <Flex justify="space-between" align="start" mb={3}>
                <HStack spacing={2}>
                  <Badge colorScheme="green" variant="solid">
                    {loop.loop_length}-Way Trade
                  </Badge>
                  <Badge colorScheme="blue" variant="outline">
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
              <Box overflowX="auto" mb={3}>
                <HStack spacing={2} py={2} minW="max-content">
                  {loop.edges.map((edge, edgeIdx) => (
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

                      {edgeIdx < loop.edges.length - 1 && (
                        <>
                          <Icon as={FaArrowRight} color="gray.400" />
                        </>
                      )}
                    </React.Fragment>
                  ))}
                  
                  {/* Close the loop visualization */}
                  <Icon as={FaArrowRight} color="gray.400" />
                  <Tooltip label={loop.edges[0]?.from_user_name} placement="top">
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
                      {loop.edges[0]?.from_user_name || `User ${loop.edges[0]?.from_user}`}
                    </Box>
                  </Tooltip>
                </HStack>
              </Box>

              {/* Summary info */}
              <HStack spacing={4} fontSize="sm" color="gray.600">
                <HStack spacing={1}>
                  <Icon as={FaStar} color="yellow.400" />
                  <Text>Loop ID: {idx + 1}</Text>
                </HStack>
                <Text>
                  {/* participants is an array of ids; use edge status instead */}
                  Status: <Badge fontSize="xs" colorScheme="yellow">{loop.edges?.[0]?.status || 'pending'}</Badge>
                </Text>
              </HStack>
            </CardBody>
          </Card>
        ))}
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
