import React, { useState } from 'react'
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalCloseButton,
  ModalFooter,
  Button,
  VStack,
  HStack,
  Box,
  Text,
  Badge,
  Divider,
  Image,
  Grid,
  GridItem,
  Icon,
  Spinner,
  useToast,
  Card,
  CardBody,
  Heading,
  Avatar,
  AvatarGroup,
  useColorModeValue,
  Flex,
  Stack,
} from '@chakra-ui/react'
import { FaArrowRight, FaCheck, FaTimes, FaUser, FaBox } from 'react-icons/fa'
import { MultiWayTrade, MultiWayTradeParticipant } from '../types'
import {
  acceptMultiWayTrade,
  declineMultiWayTrade,
  executeMultiWayTrade,
} from '../services/tradeService'

interface MultiWayTradeModalProps {
  isOpen: boolean
  onClose: () => void
  multiWayTrade: MultiWayTrade
  onTradeCompleted?: () => void
}

const MultiWayTradeModal: React.FC<MultiWayTradeModalProps> = ({
  isOpen,
  onClose,
  multiWayTrade,
  onTradeCompleted,
}) => {
  const [loading, setLoading] = useState(false)
  const [selectedAction, setSelectedAction] = useState<'accept' | 'decline' | 'execute' | null>(null)
  const toast = useToast()

  const cardBg = useColorModeValue('white', 'gray.800')
  const borderColor = useColorModeValue('gray.200', 'gray.700')
  const participantBg = useColorModeValue('blue.50', 'blue.900')
  const participantBorder = useColorModeValue('blue.200', 'blue.700')

  const handleAccept = async () => {
    try {
      setLoading(true)
      setSelectedAction('accept')
      await acceptMultiWayTrade(multiWayTrade.loop_id)
      toast({
        title: 'Success',
        description: 'You accepted this multi-way trade opportunity',
        status: 'success',
      })
      onTradeCompleted?.()
      onClose()
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error?.response?.data?.error || 'Failed to accept trade',
        status: 'error',
      })
    } finally {
      setLoading(false)
      setSelectedAction(null)
    }
  }

  const handleDecline = async () => {
    try {
      setLoading(true)
      setSelectedAction('decline')
      await declineMultiWayTrade(multiWayTrade.loop_id)
      toast({
        title: 'Declined',
        description: 'You declined this multi-way trade',
        status: 'info',
      })
      onClose()
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error?.response?.data?.error || 'Failed to decline trade',
        status: 'error',
      })
    } finally {
      setLoading(false)
      setSelectedAction(null)
    }
  }

  const handleExecute = async () => {
    try {
      setLoading(true)
      setSelectedAction('execute')
      await executeMultiWayTrade(multiWayTrade.loop_id)
      toast({
        title: 'Success',
        description: 'Multi-way trade executed successfully!',
        status: 'success',
      })
      onTradeCompleted?.()
      onClose()
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error?.response?.data?.error || 'Failed to execute trade',
        status: 'error',
      })
    } finally {
      setLoading(false)
      setSelectedAction(null)
    }
  }

  const statusColorScheme = (status: string) => {
    switch (status) {
      case 'pending':
        return 'yellow'
      case 'accepted':
        return 'green'
      case 'declined':
        return 'red'
      case 'completed':
        return 'cyan'
      default:
        return 'gray'
    }
  }

  const sortedParticipants = [...multiWayTrade.participants].sort(
    (a, b) => a.position_in_loop - b.position_in_loop
  )

  // Show Execute button only when the overall trade is active AND every participant has accepted.
  const canExecute = multiWayTrade.status === 'active' && sortedParticipants.every(p => p.trade_status === 'accepted')

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="2xl" isCentered scrollBehavior="inside">
      <ModalOverlay backdropFilter="blur(4px)" />
      <ModalContent bg={cardBg} maxH="90vh" overflowY="auto">
        <ModalHeader borderBottomWidth="1px" borderColor={borderColor}>
          <VStack align="start" spacing={2}>
            <HStack justify="space-between" w="full">
              <Heading size="md">
                {sortedParticipants.length}-Way Trade Chain
              </Heading>
              <Badge colorScheme={statusColorScheme(multiWayTrade.status)}>
                {multiWayTrade.status}
              </Badge>
            </HStack>
            <Text fontSize="sm" color="gray.600">
              A successful trade chain that benefits all participants
            </Text>
          </VStack>
        </ModalHeader>

        <ModalCloseButton />

        <ModalBody py={6}>
          <VStack spacing={6} align="stretch">
            {/* Trade Chain Visualization */}
            <Box>
              <Heading size="sm" mb={4}>
                Trade Flow
              </Heading>
              <VStack spacing={3} align="start" pl={4}>
                {multiWayTrade.edges.map((edge, idx) => (
                  <Box key={idx} w="full">
                    <HStack spacing={2} mb={2}>
                      <Badge colorScheme="blue" variant="subtle">
                        Trade {idx + 1}
                      </Badge>
                      <Text fontSize="sm" fontWeight="medium">
                        {edge.from_user_name} offers to {edge.to_user_name}
                      </Text>
                    </HStack>
                    <HStack spacing={3} pl={4}>
                      <Icon as={FaBox} color="orange.500" />
                      <Text fontSize="sm" color="gray.600">
                        {edge.product_title}
                      </Text>
                      <Badge size="sm" colorScheme={statusColorScheme(edge.status || 'pending')}>
                        {edge.status || 'pending'}
                      </Badge>
                    </HStack>
                  </Box>
                ))}
              </VStack>
            </Box>

            <Divider />

            {/* Participants Details */}
            <Box>
              <Heading size="sm" mb={4}>
                Participants ({sortedParticipants.length})
              </Heading>
              <Grid
                templateColumns={{ base: '1fr', md: '1fr 1fr' }}
                gap={4}
              >
                {sortedParticipants.map((participant, idx) => (
                  <Card
                    key={idx}
                    bg={participantBg}
                    borderColor={participantBorder}
                    borderWidth="1px"
                  >
                    <CardBody>
                      <VStack align="start" spacing={3}>
                        {/* Position indicator */}
                        <HStack spacing={2}>
                          <Badge colorScheme="purple">
                            Position {participant.position_in_loop + 1}
                          </Badge>
                          <Badge colorScheme={statusColorScheme(participant.trade_status)}>
                            {participant.trade_status}
                          </Badge>
                        </HStack>

                        {/* User info */}
                        <HStack spacing={3} w="full">
                          <Avatar
                            name={participant.user_name}
                            size="sm"
                            bg="brand.500"
                          />
                          <VStack align="start" spacing={0}>
                            <Text fontWeight="semibold">{participant.user_name}</Text>
                            <Text fontSize="xs" color="gray.600">
                              User ID: {participant.user_id}
                            </Text>
                          </VStack>
                        </HStack>

                        {/* Product info */}
                        <Box w="full">
                          <HStack spacing={2} mb={2}>
                            <Icon as={FaBox} fontSize="sm" />
                            <Text fontSize="sm" fontWeight="medium">
                              Product:
                            </Text>
                          </HStack>
                          <Box pl={6} borderLeftWidth="2px" borderColor="brand.200">
                            {participant.product_image && (
                              <Image
                                src={participant.product_image}
                                alt={participant.product_title}
                                maxH="80px"
                                objectFit="cover"
                                borderRadius="md"
                                mb={2}
                              />
                            )}
                            <Text fontSize="sm" fontWeight="semibold">
                              {participant.product_title}
                            </Text>
                            <Text fontSize="xs" color="gray.600">
                              Product ID: {participant.product_id}
                            </Text>
                          </Box>
                        </Box>

                        {/* Trade link */}
                        <Box w="full" fontSize="xs" color="gray.500">
                          Trade ID: <Badge fontSize="xs">{participant.trade_id}</Badge>
                        </Box>
                      </VStack>
                    </CardBody>
                  </Card>
                ))}
              </Grid>
            </Box>

            {multiWayTrade.total_value && (
              <>
                <Divider />
                <HStack justify="space-between" bg={useColorModeValue('gray.50', 'gray.700')} p={3} borderRadius="md">
                  <Text fontWeight="semibold">Estimated Total Value:</Text>
                  <Text fontSize="lg" fontWeight="bold" color="green.500">
                    ₱{multiWayTrade.total_value.toFixed(2)}
                  </Text>
                </HStack>
              </>
            )}

            {/* Info message */}
            <Box bg="blue.50" borderLeftWidth="4px" borderColor="blue.500" p={3} borderRadius="md">
              <Text fontSize="sm" color="blue.900">
                <strong>How it works:</strong> Once all participants accept, the trades will be automatically synchronized and completed. Everyone gets the product they wanted in this chain!
              </Text>
            </Box>
          </VStack>
        </ModalBody>

        <ModalFooter borderTopWidth="1px" borderColor={borderColor} gap={3}>
          <Stack direction={{ base: 'column', sm: 'row' }} w="full" spacing={2}>
            <Button
              flex={1}
              variant="ghost"
              isDisabled={loading}
              onClick={handleDecline}
              isLoading={selectedAction === 'decline' && loading}
              leftIcon={<FaTimes />}
            >
              Decline
            </Button>
            <Button
              flex={1}
              colorScheme="green"
              isDisabled={loading || multiWayTrade.status !== 'active'}
              isLoading={selectedAction === 'accept' && loading}
              onClick={handleAccept}
              leftIcon={<FaCheck />}
            >
              Accept Trade
            </Button>
            {canExecute && (
              <Button
                flex={1}
                colorScheme="brand"
                isDisabled={loading}
                isLoading={selectedAction === 'execute' && loading}
                onClick={handleExecute}
              >
                Execute Trade
              </Button>
            )}
          </Stack>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}

export default MultiWayTradeModal
