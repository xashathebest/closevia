// ADD LANG DITO IF NEEDED
import React, { useState, useEffect } from 'react'
import {
  Box,
  VStack,
  HStack,
  Container,
  Heading,
  Text,
  Button,
  Card,
  CardBody,
  Badge,
  Spinner,
  Center,
  useToast,
  Icon,
  Image,
  Grid,
  GridItem,
  Divider,
  useColorModeValue,
  Flex,
  Stack,
  Tabs,
  TabList,
  TabPanels,
  Tab,
  TabPanel,
} from '@chakra-ui/react'
import { FaLock, FaCrown, FaLink, FaArrowRight, FaCheck, FaUser, FaBox, FaStar } from 'react-icons/fa'
import { useAuth } from '../contexts/AuthContext'
import { TradeLoop, MultiWayTrade } from '../types'
import { fetchTradeLoops, fetchMultiWayTrade } from '../services/tradeService'
import MultiWayTradeModal from '../components/MultiWayTradeModal'
import { useDisclosure } from '@chakra-ui/react'

const Premium: React.FC = () => {
  const { user } = useAuth()
  const toast = useToast()
  const { isOpen, onOpen, onClose } = useDisclosure()
  
  const [loops, setLoops] = useState<TradeLoop[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedLoop, setSelectedLoop] = useState<MultiWayTrade | null>(null)
  
  const cardBg = useColorModeValue('white', 'gray.800')
  const borderColor = useColorModeValue('gray.200', 'gray.700')
  const hoverBg = useColorModeValue('blue.50', 'blue.900')
  const premiumBadgeBg = useColorModeValue('purple.100', 'purple.900')
  const premiumBadgeColor = useColorModeValue('purple.800', 'purple.100')
  const lockedBg = useColorModeValue('gray.100', 'gray.700')
  const lockedText = useColorModeValue('gray.500', 'gray.400')

  const isPremiumUser = user?.is_premium === true

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
    if (isPremiumUser) {
      fetchLoops()
      // Refresh every 30 seconds to check for new loops
      const interval = setInterval(fetchLoops, 30000)
      return () => clearInterval(interval)
    }
  }, [isPremiumUser])

  const handleSelectLoop = async (loop: TradeLoop) => {
    if (!isPremiumUser) {
      toast({
        title: 'Premium Feature',
        description: 'Multi-way trading is available to premium members only',
        status: 'info',
      })
      return
    }

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

  const renderPremiumFeature = () => {
    return (
      <VStack spacing={8} align="stretch">
        {/* Premium Header */}
        <Card bg={premiumBadgeBg} borderWidth="2px" borderColor="purple.400">
          <CardBody>
            <HStack spacing={4} justify="center" py={6}>
              <Icon as={FaCrown} fontSize="3xl" color={premiumBadgeColor} />
              <VStack align="start" spacing={0}>
                <Heading size="lg" color={premiumBadgeColor}>
                  Premium Member Benefits
                </Heading>
                <Text color={premiumBadgeColor} fontSize="sm">
                  Unlock advanced trading opportunities with multi-way trading
                </Text>
              </VStack>
            </HStack>
          </CardBody>
        </Card>

        {/* Multi-Way Trading Section */}
        <Box>
          <Heading size="md" mb={4} display="flex" alignItems="center" gap={2}>
            <Icon as={FaLink} color="green.500" />
            Multi-Way Trading Loops
          </Heading>
          <Text fontSize="sm" color="gray.600" mb={4}>
            Participate in trading chains where multiple users exchange products simultaneously. Find the perfect trading loop and complete transactions with confidence.
          </Text>

          {loading && loops.length === 0 ? (
            <Center py={8}>
              <Spinner size="lg" color="brand.500" />
            </Center>
          ) : loops.length === 0 ? (
            <Card bg={cardBg} borderColor={borderColor} borderWidth="1px">
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
          ) : (
            <VStack spacing={4} align="stretch">
              {loops.map((loop, idx) => (
                <Card
                  key={idx}
                  bg={cardBg}
                  borderColor={borderColor}
                  borderWidth="1px"
                  _hover={{ bg: hoverBg, cursor: 'pointer', borderColor: 'brand.500', boxShadow: 'md' }}
                  transition="all 0.2s"
                  onClick={() => handleSelectLoop(loop)}
                >
                  <CardBody>
                    <VStack spacing={3} align="stretch">
                      <Flex justify="space-between" align="start">
                        <HStack spacing={2}>
                          <Badge colorScheme="green" variant="solid">
                            {loop.loop_length}-Way Trade
                          </Badge>
                          <Badge colorScheme="blue" variant="outline">
                            {loop.participants.length} participants
                          </Badge>
                          <Badge colorScheme="purple" variant="subtle">
                            <HStack spacing={1}>
                              <Icon as={FaCrown} fontSize="sm" />
                              <Text>Premium</Text>
                            </HStack>
                          </Badge>
                        </HStack>
                      </Flex>

                      {/* Loop visualization */}
                      <Box overflowX="auto" py={2}>
                        <Flex align="center" gap={2} minW="fit-content" px={2}>
                          {loop.edges.map((edge, edgeIdx) => (
                            <React.Fragment key={edgeIdx}>
                              <VStack spacing={1} align="center" minW="120px">
                                <Badge colorScheme="gray" variant="outline" fontSize="xs">
                                  User {edge.from_user}
                                </Badge>
                                <Text fontSize="xs" color="gray.600" textAlign="center">
                                  {edge.product_title?.substring(0, 15)}...
                                </Text>
                              </VStack>
                              {edgeIdx < loop.edges.length - 1 && (
                                <Icon as={FaArrowRight} color="brand.500" fontSize="lg" />
                              )}
                              {edgeIdx === loop.edges.length - 1 && (
                                <Icon as={FaArrowRight} color="brand.500" fontSize="lg" />
                              )}
                            </React.Fragment>
                          ))}
                          <VStack spacing={1} align="center" minW="120px">
                            <Badge colorScheme="gray" variant="outline" fontSize="xs">
                              User {loop.edges[0].from_user}
                            </Badge>
                            <Text fontSize="xs" color="gray.600" textAlign="center">
                              Completes loop
                            </Text>
                          </VStack>
                        </Flex>
                      </Box>

                      <Divider />

                      <Flex justify="space-between" align="center">
                        <Text fontSize="sm" color="gray.600">
                          Click to view details and participate
                        </Text>
                        <Button
                          size="sm"
                          colorScheme="brand"
                          rightIcon={<FaArrowRight />}
                          onClick={(e) => {
                            e.stopPropagation()
                            handleSelectLoop(loop)
                          }}
                        >
                          View Details
                        </Button>
                      </Flex>
                    </VStack>
                  </CardBody>
                </Card>
              ))}
            </VStack>
          )}
        </Box>

        {/* Additional Premium Features */}
        <Box>
          <Heading size="md" mb={4}>
            Other Premium Features
          </Heading>
          <Grid templateColumns={{ base: '1fr', md: '1fr 1fr' }} gap={4}>
            <Card bg={cardBg} borderColor={borderColor} borderWidth="1px">
              <CardBody>
                <HStack spacing={3} mb={3}>
                  <Icon as={FaStar} fontSize="xl" color="yellow.500" />
                  <Heading size="sm">Priority Support</Heading>
                </HStack>
                <Text fontSize="sm" color="gray.600">
                  Get faster responses from our support team
                </Text>
              </CardBody>
            </Card>

            <Card bg={cardBg} borderColor={borderColor} borderWidth="1px">
              <CardBody>
                <HStack spacing={3} mb={3}>
                  <Icon as={FaLink} fontSize="xl" color="green.500" />
                  <Heading size="sm">Multi-Way Trading</Heading>
                </HStack>
                <Text fontSize="sm" color="gray.600">
                  Access advanced trading loops and chains
                </Text>
              </CardBody>
            </Card>
          </Grid>
        </Box>
      </VStack>
    )
  }

  const renderLockedContent = () => {
    return (
      <Card bg={lockedBg} borderWidth="2px" borderColor={borderColor}>
        <CardBody py={12}>
          <VStack spacing={6} align="center">
            <Icon as={FaLock} fontSize="4xl" color={lockedText} />
            <VStack spacing={2} textAlign="center">
              <Heading size="lg" color={lockedText}>
                Premium Features Locked
              </Heading>
              <Text color={lockedText} maxW="400px">
                Upgrade to premium to unlock multi-way trading and other exclusive features
              </Text>
            </VStack>
            <Button
              colorScheme="purple"
              size="lg"
              leftIcon={<FaCrown />}
              onClick={() => {
                toast({
                  title: 'Upgrade',
                  description: 'Premium upgrade functionality coming soon',
                  status: 'info',
                })
              }}
            >
              Upgrade to Premium
            </Button>
          </VStack>
        </CardBody>
      </Card>
    )
  }

  return (
    <Container maxW="container.lg" py={8}>
      <VStack spacing={8} align="stretch">
        {/* Page Header */}
        <VStack spacing={2} align="start">
          <Heading size="xl" display="flex" alignItems="center" gap={2}>
            <Icon as={FaCrown} color="purple.500" />
            Premium Features
          </Heading>
          <Text color="gray.600">
            {isPremiumUser
              ? 'Welcome to premium! Access exclusive trading features and benefits.'
              : 'Unlock premium features to enhance your trading experience.'}
          </Text>
        </VStack>

        {/* Main Content */}
        {isPremiumUser ? renderPremiumFeature() : renderLockedContent()}
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
    </Container>
  )
}

export default Premium