import React, { useState, useEffect } from 'react'
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  Button,
  VStack,
  HStack,
  Text,
  Box,
  Badge,
  Divider,
  Spinner,
  Alert,
  AlertIcon,
  useToast,
} from '@chakra-ui/react'
import { CheckIcon } from '@chakra-ui/icons'
import { Delivery, BatchAddonSuggestion, RiderSlotLedger } from '../types'
import { api } from '../services/api'

interface BatchClaimModalProps {
  isOpen: boolean
  onClose: () => void
  anchorDelivery?: Delivery
  isLoading?: boolean
  onInitiate: (anchor: Delivery, selectedAddons: number[]) => Promise<void>
}

export const BatchClaimModal: React.FC<BatchClaimModalProps> = ({
  isOpen,
  onClose,
  anchorDelivery,
  isLoading = false,
  onInitiate,
}) => {
  const toast = useToast()
  const [selectedAddons, setSelectedAddons] = useState<number[]>([])
  const [nearbyAddons, setNearbyAddons] = useState<BatchAddonSuggestion[]>([])
  const [slotStatus, setSlotStatus] = useState<RiderSlotLedger | null>(null)
  const [isLoadingAddons, setIsLoadingAddons] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Fetch nearby add-ons when anchor delivery changes
  useEffect(() => {
    if (isOpen && anchorDelivery?.id) {
      fetchNearbyAddons()
      fetchSlotStatus()
    }
  }, [isOpen, anchorDelivery?.id])

  const fetchNearbyAddons = async () => {
    if (!anchorDelivery?.id) return
    
    try {
      setIsLoadingAddons(true)
      const response = await api.get('/api/batches/nearby-addons', {
        params: { anchor_delivery_id: anchorDelivery.id },
      })
      const { data } = response.data
      setNearbyAddons(data || [])
    } catch (error) {
      toast({
        title: 'Error fetching nearby deliveries',
        description: error instanceof Error ? error.message : 'Unknown error',
        status: 'error',
        duration: 5000,
      })
    } finally {
      setIsLoadingAddons(false)
    }
  }

  const fetchSlotStatus = async () => {
    try {
      const response = await api.get('/api/batches/rider-slots')
      const { data } = response.data
      setSlotStatus(data)
    } catch (error) {
      toast({
        title: 'Error fetching slot status',
        description: error instanceof Error ? error.message : 'Unknown error',
        status: 'error',
        duration: 5000,
      })
    }
  }

  const handleAddonToggle = (deliveryId: number) => {
    setSelectedAddons((prev) => {
      if (prev.includes(deliveryId)) {
        return prev.filter((id) => id !== deliveryId)
      } else {
        // Check slot availability
        const slotsNeeded = 1 + selectedAddons.length + 1
        if (slotStatus && slotsNeeded > slotStatus.free_slots_remaining) {
          toast({
            title: 'Insufficient slots',
            description: `Need ${slotsNeeded} slots, have ${slotStatus.free_slots_remaining} available`,
            status: 'warning',
            duration: 5000,
          })
          return prev
        }
        return [...prev, deliveryId]
      }
    })
  }

  const handleClaim = async () => {
    if (!anchorDelivery?.id) return

    try {
      setIsSubmitting(true)
      await onInitiate(anchorDelivery, selectedAddons)
      
      toast({
        title: 'Batch claimed successfully!',
        description: `You claimed ${1 + selectedAddons.length} deliveries`,
        status: 'success',
        duration: 5000,
      })
      
      setSelectedAddons([])
      onClose()
    } catch (error) {
      toast({
        title: 'Error claiming batch',
        description: error instanceof Error ? error.message : 'Unknown error',
        status: 'error',
        duration: 5000,
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const slotsNeeded = 1 + selectedAddons.length
  const slotsAvailable = slotStatus?.free_slots_remaining || 0
  const canClaim = slotsNeeded <= slotsAvailable && !slotStatus?.is_locked_for_batching

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg" isCentered>
      <ModalOverlay />
      <ModalContent>
        <ModalHeader>Claim Batch Delivery</ModalHeader>

        <ModalBody>
          <VStack spacing={6} align="stretch">
            {/* Slot Status */}
            {slotStatus && (
              <Alert
                status={slotStatus.is_locked_for_batching ? 'error' : 'info'}
                borderRadius="md"
              >
                <AlertIcon />
                <VStack align="start" spacing={1}>
                  <Text fontWeight="bold">
                    {slotStatus.free_slots_remaining} / {slotStatus.free_slots_total} slots available
                  </Text>
                  {slotStatus.is_locked_for_batching && (
                    <Text fontSize="sm">
                      Account locked: Remittance owed ₱{slotStatus.remittance_owed.toFixed(2)}
                    </Text>
                  )}
                  {slotStatus.remittance_owed > 0 && (
                    <Text fontSize="sm" color="orange.600">
                      Cash to remit: ₱{slotStatus.remittance_owed.toFixed(2)}
                    </Text>
                  )}
                </VStack>
              </Alert>
            )}

            {/* Anchor Delivery */}
            {anchorDelivery && (
              <Box>
                <Text fontWeight="bold" mb={2}>
                  Anchor Delivery (1 slot)
                </Text>
                <Box
                  p={4}
                  bg="green.50"
                  borderLeft="4px solid"
                  borderColor="green.500"
                  borderRadius="md"
                >
                  <HStack justify="space-between" mb={2}>
                    <VStack align="start" spacing={1}>
                      <Text fontWeight="bold">{anchorDelivery.pickup_address}</Text>
                      <Text fontSize="sm" color="gray.600">
                        → {anchorDelivery.delivery_address}
                      </Text>
                    </VStack>
                    <CheckIcon color="green.500" />
                  </HStack>
                  <HStack spacing={4} fontSize="sm">
                    <Text>Distance: {anchorDelivery.distance_km?.toFixed(1)}km</Text>
                    <Text fontWeight="bold">₱{anchorDelivery.total_cost.toFixed(2)}</Text>
                  </HStack>
                </Box>
              </Box>
            )}

            <Divider />

            {/* Add-ons Section */}
            <Box>
              <HStack justify="space-between" mb={3}>
                <Text fontWeight="bold">Suggested Add-ons</Text>
                <Badge colorScheme="blue">
                  {selectedAddons.length} selected ({slotsNeeded} total slots)
                </Badge>
              </HStack>

              {isLoadingAddons ? (
                <HStack justify="center" py={4}>
                  <Spinner size="sm" />
                  <Text>Finding nearby deliveries...</Text>
                </HStack>
              ) : nearbyAddons.length === 0 ? (
                <Text color="gray.500" textAlign="center" py={4}>
                  No nearby deliveries available
                </Text>
              ) : (
                <VStack spacing={2} maxH="300px" overflowY="auto">
                  {nearbyAddons.map((addon) => (
                    <Box
                      key={addon.suggested_delivery_id}
                      p={3}
                      bg={selectedAddons.includes(addon.suggested_delivery_id) ? 'blue.50' : 'gray.50'}
                      borderRadius="md"
                      borderLeft={selectedAddons.includes(addon.suggested_delivery_id) ? '4px solid' : 'none'}
                      borderColor="blue.500"
                      cursor="pointer"
                      onClick={() => handleAddonToggle(addon.suggested_delivery_id)}
                      transition="all 0.2s"
                      _hover={{ bg: 'blue.100' }}
                    >
                      <HStack justify="space-between" spacing={2}>
                        <VStack align="start" spacing={1} flex={1}>
                          <Text fontSize="sm" fontWeight="bold">
                            Delivery #{addon.suggested_delivery_id}
                          </Text>
                          <HStack spacing={4} fontSize="xs" color="gray.600">
                            <Text>{addon.distance_from_anchor_km.toFixed(1)}km away</Text>
                            <Text>+{addon.route_detour_percent.toFixed(0)}% detour</Text>
                          </HStack>
                        </VStack>
                        <VStack align="end" spacing={1}>
                          <Text fontWeight="bold" fontSize="sm">
                            Score: {addon.score.toFixed(0)}
                          </Text>
                          {selectedAddons.includes(addon.suggested_delivery_id) && (
                            <CheckIcon color="blue.500" boxSize={4} />
                          )}
                        </VStack>
                      </HStack>
                    </Box>
                  ))}
                </VStack>
              )}
            </Box>

            {/* Summary */}
            <Box p={3} bg="gray.50" borderRadius="md">
              <VStack align="start" spacing={2} fontSize="sm">
                <HStack justify="space-between" w="full">
                  <Text>Total deliveries:</Text>
                  <Text fontWeight="bold">{1 + selectedAddons.length}</Text>
                </HStack>
                <HStack justify="space-between" w="full">
                  <Text>Slots needed:</Text>
                  <Text fontWeight="bold" color={slotsNeeded > slotsAvailable ? 'red.500' : 'green.500'}>
                    {slotsNeeded}
                  </Text>
                </HStack>
              </VStack>
            </Box>
          </VStack>
        </ModalBody>

        <ModalFooter gap={2}>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            colorScheme="green"
            isDisabled={!canClaim || slotsNeeded === 1}
            isLoading={isSubmitting || isLoading}
            onClick={handleClaim}
          >
            Claim Batch ({slotsNeeded} slots)
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  )
}
