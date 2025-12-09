import React, { useEffect, useState, useMemo } from 'react'
import { Modal, ModalOverlay, ModalContent, ModalHeader, ModalBody, ModalCloseButton, VStack, Grid, Box, Image, Text, FormControl, FormLabel, Input, HStack, Button, useToast, Divider, Badge, Card, CardBody, Icon, useColorModeValue, Textarea } from '@chakra-ui/react'
import { FaMapMarkerAlt, FaTruck, FaCheckCircle } from 'react-icons/fa'
import { useAuth } from '../contexts/AuthContext'
import { api } from '../services/api'
import { Product, TradeCreate, TradeOption } from '../types'
import { getFirstImage } from '../utils/imageUtils'

interface TradeModalProps {
  isOpen: boolean
  onClose: () => void
  targetProductId: number | null
}

const TradeModal: React.FC<TradeModalProps> = ({ isOpen, onClose, targetProductId }) => {
  const { user } = useAuth()
  const toast = useToast()
  const [userProducts, setUserProducts] = useState<Product[]>([])
  const [selectedOfferIds, setSelectedOfferIds] = useState<number[]>([])
  const [tradeMessage, setTradeMessage] = useState('')
  const [submittingTrade, setSubmittingTrade] = useState(false)
  const [cashAmount, setCashAmount] = useState<string>('')
  const [showConfirmModal, setShowConfirmModal] = useState<boolean>(false)
  const [tradeOption, setTradeOption] = useState<TradeOption | null>(null)
  const [deliveryAddress, setDeliveryAddress] = useState<string>('')
  const cardBg = useColorModeValue('white', 'gray.800')
  const borderColor = useColorModeValue('gray.200', 'gray.700')
  const selectedBg = useColorModeValue('brand.50', 'brand.900')
  const selectedBorder = useColorModeValue('brand.500', 'brand.400')

  const selectedProducts = useMemo(() => userProducts.filter(p => selectedOfferIds.includes(p.id)), [userProducts, selectedOfferIds])

  useEffect(() => {
    if (!isOpen) return
    setSelectedOfferIds([])
    setTradeMessage('')
    setCashAmount('')
    setTradeOption(null)
    setDeliveryAddress('')
    if (user) {
      ;(async () => {
        try {
          const res = await api.get(`/api/products/user/${user.id}?page=1&limit=50`)
          const data = res.data?.data
          const list: Product[] = Array.isArray(data?.data) ? data.data : []
          // Filter out sold products from trade proposals
          const availableProducts = list.filter(product => product.status === 'available')
          setUserProducts(availableProducts)
        } catch (_) {
          setUserProducts([])
        }
      })()
    } else {
      setUserProducts([])
    }
  }, [isOpen, user])

  useEffect(() => {
    if (!isOpen) return
    console.log('Selected offer IDs:', selectedOfferIds)
    console.log('Selected products:', selectedProducts)
  }, [isOpen, selectedOfferIds, selectedProducts])

  const toggleOfferSelection = (id: number) => {
    setSelectedOfferIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  const submitTrade = async () => {
    if (!targetProductId || selectedOfferIds.length === 0) {
      toast({ title: 'Select items', description: 'Please select at least one of your items to offer.', status: 'warning' })
      return
    }
    if (!tradeOption) {
      toast({ title: 'Select trade option', description: 'Please select Meetup or Delivery option.', status: 'warning' })
      return
    }
    if (tradeOption === 'delivery' && !deliveryAddress.trim()) {
      toast({ title: 'Delivery address required', description: 'Please provide a delivery address for delivery option.', status: 'warning' })
      return
    }
    try {
      setSubmittingTrade(true)
      const payload: TradeCreate = {
        target_product_id: targetProductId,
        offered_product_ids: selectedOfferIds,
        message: tradeMessage,
        offered_cash_amount: cashAmount ? Number(cashAmount) : undefined,
        trade_option: tradeOption,
        delivery_address: tradeOption === 'delivery' ? deliveryAddress : undefined,
      }
      console.log('Submitting trade payload:', payload)
      await api.post('/api/trades', payload)
      toast({ title: 'Trade sent', description: 'Your trade offer was sent to the seller.', status: 'success' })
      setSelectedOfferIds([])
      setTradeMessage('')
      setCashAmount('')
      setTradeOption(null)
      setDeliveryAddress('')
      setShowConfirmModal(false)
      onClose()
    } catch (e: any) {
      toast({ title: 'Failed', description: e?.response?.data?.error || 'Failed to send trade', status: 'error' })
    } finally {
      setSubmittingTrade(false)
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} isCentered size="xl">
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>{user ? 'Propose a Trade' : 'Sign in to Continue'}</ModalHeader>
        <ModalCloseButton />
        <ModalBody pb={6}>
          {user ? (
            <VStack spacing={4} align="stretch">
              <Text fontWeight="semibold">Select your items to offer:</Text>
              {/* Scrollable grid: shows 2 full rows + small peek of 3rd; scroll when overflowing */}
              <Box maxH="244px" overflowY="auto" pr={2}>
                <Grid templateColumns="repeat(auto-fill, minmax(100px, 150px))" gap={3} gridAutoRows="120px" justifyContent="start">
                  {userProducts.map((p) => (
                    <Box key={p.id} minH="120px" borderWidth={selectedOfferIds.includes(p.id) ? '2px' : '1px'} borderColor={selectedOfferIds.includes(p.id) ? 'brand.500' : 'gray.200'} rounded="md" overflow="hidden" onClick={() => toggleOfferSelection(p.id)} cursor="pointer" bg={selectedOfferIds.includes(p.id) ? 'brand.50' : 'white'}>
                      <Image src={getFirstImage(p.image_urls)} alt={p.title} w="full" h="50px" objectFit="cover" />
                      <Box p={2}>
                        <Text fontSize="sm" noOfLines={2}>{p.title}</Text>
                      </Box>
                    </Box>
                  ))}
                </Grid>
              </Box>

              <FormControl>
                <FormLabel fontSize="sm">Message (optional)</FormLabel>
                <Input placeholder="Add a note for the seller" value={tradeMessage} onChange={(e) => setTradeMessage(e.target.value)} />
              </FormControl>

              <FormControl>
                <FormLabel fontSize="sm">Offer money (optional, PHP)</FormLabel>
                <Input type="number" placeholder="₱0.00" value={cashAmount} onChange={(e) => setCashAmount(e.target.value)} min={0} step="0.01" />
              </FormControl>

              <Divider />

              {/* Trade Option Selection */}
              <FormControl isRequired>
                <FormLabel fontSize="sm" fontWeight="semibold" mb={3}>
                  Trade Fulfillment Option
                </FormLabel>
                <Text fontSize="xs" color="gray.600" mb={3}>
                  Select how you want to complete this trade
                </Text>
                <Grid templateColumns="repeat(2, 1fr)" gap={4}>
                  {/* Meetup Option */}
                  <Card
                    variant="outline"
                    cursor="pointer"
                    borderWidth={tradeOption === 'meetup' ? '2px' : '1px'}
                    borderColor={tradeOption === 'meetup' ? selectedBorder : borderColor}
                    bg={tradeOption === 'meetup' ? selectedBg : cardBg}
                    onClick={() => setTradeOption('meetup')}
                    transition="all 0.2s"
                    _hover={{
                      borderColor: tradeOption === 'meetup' ? selectedBorder : 'brand.300',
                      shadow: 'md',
                      transform: 'translateY(-2px)',
                    }}
                  >
                    <CardBody p={4}>
                      <VStack spacing={3} align="center">
                        <Box
                          p={3}
                          borderRadius="full"
                          bg={tradeOption === 'meetup' ? 'brand.500' : 'gray.100'}
                          color={tradeOption === 'meetup' ? 'white' : 'gray.600'}
                        >
                          <Icon as={FaMapMarkerAlt} boxSize={6} />
                        </Box>
                        <VStack spacing={1} align="center">
                          <Text fontWeight="semibold" fontSize="sm">
                            Meetup
                          </Text>
                          <Text fontSize="xs" color="gray.600" textAlign="center">
                            Meet in person at a safe, public location
                          </Text>
                        </VStack>
                        {tradeOption === 'meetup' && (
                          <Icon as={FaCheckCircle} color="brand.500" boxSize={4} />
                        )}
                      </VStack>
                    </CardBody>
                  </Card>

                  {/* Delivery Option */}
                  <Card
                    variant="outline"
                    cursor="pointer"
                    borderWidth={tradeOption === 'delivery' ? '2px' : '1px'}
                    borderColor={tradeOption === 'delivery' ? selectedBorder : borderColor}
                    bg={tradeOption === 'delivery' ? selectedBg : cardBg}
                    onClick={() => setTradeOption('delivery')}
                    transition="all 0.2s"
                    _hover={{
                      borderColor: tradeOption === 'delivery' ? selectedBorder : 'brand.300',
                      shadow: 'md',
                      transform: 'translateY(-2px)',
                    }}
                  >
                    <CardBody p={4}>
                      <VStack spacing={3} align="center">
                        <Box
                          p={3}
                          borderRadius="full"
                          bg={tradeOption === 'delivery' ? 'brand.500' : 'gray.100'}
                          color={tradeOption === 'delivery' ? 'white' : 'gray.600'}
                        >
                          <Icon as={FaTruck} boxSize={6} />
                        </Box>
                        <VStack spacing={1} align="center">
                          <Text fontWeight="semibold" fontSize="sm">
                            Delivery
                          </Text>
                          <Text fontSize="xs" color="gray.600" textAlign="center">
                            Ship items to each other's addresses
                          </Text>
                        </VStack>
                        {tradeOption === 'delivery' && (
                          <Icon as={FaCheckCircle} color="brand.500" boxSize={4} />
                        )}
                      </VStack>
                    </CardBody>
                  </Card>
                </Grid>

                {/* Delivery Address Input (shown when delivery is selected) */}
                {tradeOption === 'delivery' && (
                  <Box mt={4}>
                    <FormControl isRequired>
                      <FormLabel fontSize="sm">Delivery Address</FormLabel>
                      <Textarea
                        placeholder="Enter your complete delivery address..."
                        value={deliveryAddress}
                        onChange={(e) => setDeliveryAddress(e.target.value)}
                        rows={3}
                        resize="vertical"
                        _focus={{
                          borderColor: 'brand.400',
                          boxShadow: '0 0 0 1px var(--chakra-colors-brand-400)',
                        }}
                      />
                      <Text fontSize="xs" color="gray.500" mt={1}>
                        This address will be shared with the seller for delivery purposes
                      </Text>
                    </FormControl>
                  </Box>
                )}
              </FormControl>

              <Divider />

              <HStack justify="flex-end">
                <Button variant="ghost" onClick={onClose}>Cancel</Button>
                <Button 
                  colorScheme="brand" 
                  isLoading={submittingTrade} 
                  onClick={() => setShowConfirmModal(true)} 
                  isDisabled={selectedOfferIds.length === 0 || !tradeOption || (tradeOption === 'delivery' && !deliveryAddress.trim())}
                >
                  Proceed
                </Button>
              </HStack>
            </VStack>
          ) : (
            <VStack spacing={4}>
              <Text color="gray.600">
                You need to be signed in to trade or purchase items.
              </Text>
              <HStack spacing={4} w="full">
                <Button
                  onClick={onClose}
                  as={'a'}
                  href="/login"
                  colorScheme="brand"
                  flex={1}
                >
                  Sign In
                </Button>
                <Button
                  onClick={onClose}
                  as={'a'}
                  href="/register"
                  variant="outline"
                  flex={1}
                >
                  Sign Up
                </Button>
              </HStack>
            </VStack>
          )}
        </ModalBody>
      </ModalContent>

      {/* Confirmation modal shown after clicking Proceed */}
      <Modal isOpen={showConfirmModal} onClose={() => setShowConfirmModal(false)} isCentered size="lg">
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Confirm Offer</ModalHeader>
          <ModalCloseButton onClick={() => setShowConfirmModal(false)} />
          <ModalBody pb={6}>
            <VStack spacing={4} align="stretch">
              <Box>
                <Text fontWeight="semibold" mb={2}>Your Offer Summary</Text>
                <Grid templateColumns="repeat(auto-fill, minmax(180px, 220px))" gap={3} justifyContent="start">
                  {selectedProducts.length === 0 && !cashAmount && (
                    <Text color="gray.500" gridColumn="1 / -1">No items selected.</Text>
                  )}
                  {selectedProducts.map((p) => (
                    <Box key={p.id} borderWidth="1px" borderColor="gray.200" rounded="md" overflow="hidden">
                      <Image src={getFirstImage(p.image_urls)} alt={p.title} w="full" h="100px" objectFit="cover" />
                      <Box p={2}>
                        <HStack justify="space-between">
                          <Text fontSize="sm" fontWeight="semibold" noOfLines={1}>{p.title}</Text>
                          {p.premium && <Badge colorScheme="yellow">Premium</Badge>}
                        </HStack>
                        <Text fontSize="xs" color="gray.600" noOfLines={2}>{p.description}</Text>
                      </Box>
                    </Box>
                  ))}
                </Grid>
                {cashAmount && Number(cashAmount) > 0 && (
                  <Text mt={2} fontSize="sm" color="green.700">Cash included: ₱{Number(cashAmount).toFixed(2)}</Text>
                )}

                {/* Labeled message block: show message or a fallback so user sees what's being sent */}
                <Box mt={3} bg="gray.50" borderWidth="1px" borderColor="gray.200" rounded="md" p={3}>
                  <Text fontSize="sm" fontWeight="semibold" mb={2}>Message</Text>
                  <Text fontSize="sm" color="gray.700">{tradeMessage && tradeMessage.trim() ? tradeMessage : 'No message provided'}</Text>
                </Box>

                {/* Trade Option Summary */}
                <Box mt={3} bg="blue.50" borderWidth="1px" borderColor="blue.200" rounded="md" p={3}>
                  <Text fontSize="sm" fontWeight="semibold" mb={2}>Trade Option</Text>
                  <HStack spacing={2}>
                    <Icon 
                      as={tradeOption === 'meetup' ? FaMapMarkerAlt : FaTruck} 
                      color="blue.600" 
                      boxSize={4} 
                    />
                    <Text fontSize="sm" color="blue.700" fontWeight="medium">
                      {tradeOption === 'meetup' ? 'Meetup' : 'Delivery'}
                    </Text>
                  </HStack>
                  {tradeOption === 'delivery' && deliveryAddress && (
                    <Text fontSize="xs" color="blue.600" mt={2}>
                      Address: {deliveryAddress}
                    </Text>
                  )}
                </Box>
              </Box>
              <HStack justify="flex-end" spacing={3}>
                <Button variant="ghost" onClick={() => setShowConfirmModal(false)}>Back</Button>
                <Button colorScheme="brand" isLoading={submittingTrade} onClick={submitTrade}>Send Offer</Button>
              </HStack>
            </VStack>
          </ModalBody>
        </ModalContent>
      </Modal>
    </Modal>
  )
}

export default TradeModal


