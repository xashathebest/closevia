import React, { useEffect, useState, useMemo } from 'react'
import { Modal, ModalOverlay, ModalContent, ModalHeader, ModalBody, ModalCloseButton, VStack, Grid, Box, Image, Text, FormControl, FormLabel, Input, HStack, Button, useToast, Divider, Badge } from '@chakra-ui/react'
import { useAuth } from '../contexts/AuthContext'
import { api } from '../services/api'
import { Product, TradeCreate } from '../types'
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

  const selectedProducts = useMemo(() => userProducts.filter(p => selectedOfferIds.includes(p.id)), [userProducts, selectedOfferIds])

  useEffect(() => {
    if (!isOpen) return
    setSelectedOfferIds([])
    setTradeMessage('')
    setCashAmount('')
    if (user) {
      ;(async () => {
        try {
          const res = await api.get(`/api/products/user/${user.id}?page=1&limit=50`)
          const data = res.data?.data
          const list: Product[] = Array.isArray(data?.data) ? data.data : []
          setUserProducts(list)
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
    try {
      setSubmittingTrade(true)
      const payload: TradeCreate = {
        target_product_id: targetProductId,
        offered_product_ids: selectedOfferIds,
        message: tradeMessage,
        offered_cash_amount: cashAmount ? Number(cashAmount) : undefined,
      }
      console.log('Submitting trade payload:', payload)
      await api.post('/api/trades', payload)
      toast({ title: 'Trade sent', description: 'Your trade offer was sent to the seller.', status: 'success' })
      setSelectedOfferIds([])
      setTradeMessage('')
      setCashAmount('')
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
                <Grid templateColumns="repeat(auto-fit, minmax(140px, 1fr))" gap={3} gridAutoRows="120px">
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
                <Input type="number" placeholder="0.00" value={cashAmount} onChange={(e) => setCashAmount(e.target.value)} min={0} step="0.01" />
              </FormControl>

              <Divider />

              <HStack justify="flex-end">
                <Button variant="ghost" onClick={onClose}>Cancel</Button>
                <Button colorScheme="brand" isLoading={submittingTrade} onClick={() => setShowConfirmModal(true)} isDisabled={selectedOfferIds.length === 0}>Proceed</Button>
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
                <HStack align="start" spacing={3} flexWrap="wrap">
                  {selectedProducts.length === 0 && !cashAmount && (
                    <Text color="gray.500">No items selected.</Text>
                  )}
                  {selectedProducts.map((p) => (
                    <Box key={p.id} minW="200px" maxW="240px" borderWidth="1px" borderColor="gray.200" rounded="md" overflow="hidden">
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
                </HStack>
                {cashAmount && Number(cashAmount) > 0 && (
                  <Text mt={2} fontSize="sm" color="green.700">Cash included: ₱{Number(cashAmount).toFixed(2)}</Text>
                )}
                {tradeMessage && (
                  <Box mt={3} bg="gray.50" borderWidth="1px" borderColor="gray.200" rounded="md" p={2}>
                    <Text fontSize="sm" color="gray.700">{tradeMessage}</Text>
                  </Box>
                )}
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


