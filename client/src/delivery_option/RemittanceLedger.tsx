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
  Divider,
  SimpleGrid,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  useDisclosure,
  useToast,
  Spinner,
  Center,
  Badge,
  Progress
} from '@chakra-ui/react'
import { CheckCircleIcon, WarningIcon, RepeatIcon } from '@chakra-ui/icons'
import { FaMoneyBillWave, FaCreditCard, FaLock } from 'react-icons/fa'
import { api } from '../services/api'

interface RiderLedger {
  id: number
  rider_id: number
  total_cash_collected: number
  remittance_owed: number
  take_home: number
  total_remittance_paid?: number
  remittance_threshold?: number
  remittance_paid_progress?: number
  free_slots_remaining: number
  total_free_slots_used: number
  last_remittance_at: string | null
  is_locked_for_remittance: boolean
}

type RemittanceLedgerProps = {
  embedded?: boolean
  totalEarnings?: number
}

const RemittanceLedger: React.FC<RemittanceLedgerProps> = ({ embedded = false, totalEarnings }) => {
  const navigate = useNavigate()
  const toast = useToast()
  const { isOpen, onOpen, onClose } = useDisclosure()

  const [selectedAmount, setSelectedAmount] = useState<number | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)

  const [ledgerData, setLedgerData] = useState<RiderLedger | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const fetchLedger = async () => {
    setIsLoading(true)
    try {
      const res = await api.get('/api/deliveries/rider-ledger')
      if (res.data?.success) {
        setLedgerData(res.data.data)
      }
    } catch {
      toast({
        id: "remittance-error",
        title: 'Error loading ledger',
        status: 'error',
        duration: 3000
      })
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    const syncFromRedirect = async () => {
      const params = new URLSearchParams(window.location.search)
      const externalID = params.get('xendit_external_id')
      if (!externalID) return
      try {
        await api.post('/api/payments/remittance/sync', { external_id: externalID })
      } catch {
        // Ignore sync failures; ledger will still load.
      }
    }

    ;(async () => {
      await syncFromRedirect()
      fetchLedger()
    })()
  }, [])

  const totalCashCollected = ledgerData?.total_cash_collected || 0
  const totalFeesDue = ledgerData?.remittance_owed || 0
  const computedTotalEarnings = ledgerData?.take_home || 0
  const isLocked = ledgerData?.is_locked_for_remittance || false
  const totalEarningsToDisplay = typeof totalEarnings === 'number' ? totalEarnings : computedTotalEarnings

  const remittanceThreshold = (ledgerData?.remittance_threshold && ledgerData.remittance_threshold > 0)
    ? ledgerData.remittance_threshold
    : 50
  const totalRemittancePaid = ledgerData?.total_remittance_paid || 0
  const remittancePaidProgress = ledgerData?.remittance_paid_progress || 0
  const remittancePaidPercent = remittanceThreshold > 0
    ? Math.min(100, (remittancePaidProgress / remittanceThreshold) * 100)
    : 0
  const minUnlockAmount = Math.min(remittanceThreshold, totalFeesDue)
  const showMinOption = minUnlockAmount > 0 && Math.abs(minUnlockAmount - totalFeesDue) > 0.009

  const handleRemitFees = async () => {
    if (!selectedAmount || selectedAmount <= 0) {
      toast({
        id: "remittanceledger-select-amount",
        title: 'Select an option',
        description: 'Choose a Xendit checkout option to continue.',
        status: 'warning',
        duration: 2000,
      })
      return
    }

    setIsProcessing(true)
    try {
      const res = await api.post('/api/payments/remittance-invoice', {
        amount: selectedAmount,
      })

      const checkoutUrl = res.data?.data?.checkout_url
      if (!checkoutUrl) {
        throw new Error('Missing checkout URL')
      }

      toast({
        id: 'remittanceledger-opening-xendit',
        title: 'Opening Xendit checkout',
        status: 'info',
        duration: 1500,
      })
      window.location.href = checkoutUrl
    } catch (error: any) {
      const status = error?.response?.status
      const backendErr = error?.response?.data?.error
      const isXenditNotConfigured =
        status === 503 && typeof backendErr === 'string' && /xendit is not configured/i.test(backendErr)

      toast({
        id: "remittanceledger-payment-failed",
        title: 'Payment Failed',
        description:
          (isXenditNotConfigured
            ? 'Online remittance is temporarily unavailable. Please try again later or contact support.'
            : backendErr || error.message || 'Please try again'),
        status: 'error',
        duration: 2000,
      })
    } finally {
      setIsProcessing(false)
    }
  }

  if (isLoading) {
    return (
      <Center py={10} bg={embedded ? 'transparent' : '#FFFDF1'}>
        <Spinner size="xl" color="brand.500" />
      </Center>
    )
  }

  return (
    <Box minH={embedded ? 'auto' : '100vh'} bg="#FFFDF1" py={6} px={4}>
      <VStack spacing={6} maxW="md" mx="auto">
        {/* Header */}
        <HStack w="full" justify="space-between">
          <VStack spacing={1} align="start">
            <Heading size="lg" color="brand.500">
              Rider Ledger
            </Heading>
            <Text fontSize="sm" color="gray.600">
              Live updates of your cash earnings
            </Text>
          </VStack>
          <Button size="sm" variant="ghost" onClick={fetchLedger} leftIcon={<RepeatIcon />}>
            Refresh
          </Button>
        </HStack>

        {/* Summary Cards */}
        <SimpleGrid columns={3} spacing={3} w="full">
          <Card bg="white" border="2px" borderColor="brand.200" shadow="sm">
            <CardBody p={3}>
              <VStack spacing={1} align="center">
                <Text fontSize="xs" color="gray.600" fontWeight="bold" textAlign="center">
                  Total Cash Collected
                </Text>
                <Text fontSize="lg" fontWeight="bold" color="blue.600">
                  ₱{totalCashCollected.toFixed(2)}
                </Text>
              </VStack>
            </CardBody>
          </Card>

          <Card bg="white" border="2px" borderColor="red.200" shadow="sm">
            <CardBody p={3}>
              <VStack spacing={1} align="center">
                <Text fontSize="xs" color="gray.600" fontWeight="bold" textAlign="center">
                  Remittance Owed
                </Text>
                <Text fontSize="lg" fontWeight="bold" color="red.600">
                  ₱{totalFeesDue.toFixed(2)}
                </Text>
              </VStack>
            </CardBody>
          </Card>

          <Card bg="green.50" border="2px" borderColor="green.400" shadow="md">
            <CardBody p={3}>
              <VStack spacing={1} align="center">
                <Text fontSize="xs" color="green.800" fontWeight="bold" textAlign="center">
                  Total Earnings
                </Text>
                <Text fontSize="lg" fontWeight="bold" color="green.600">
                  ₱{totalEarningsToDisplay.toFixed(2)}
                </Text>
              </VStack>
            </CardBody>
          </Card>
        </SimpleGrid>

        {/* How Fees Work */}
        <Card bg="blue.50" w="full" border="1px" borderColor="blue.200">
          <CardBody>
            <VStack spacing={2} align="stretch">
              <Text fontWeight="bold" fontSize="sm" color="blue.900">
                How Cash Collection Works
              </Text>
              <Text fontSize="xs" color="blue.800">
                • Each delivery fee collection includes a ₱2 platform tax (counts toward Remittance Owed).
              </Text>
              <Text fontSize="xs" color="blue.800">
                • Your ledger updates automatically after completing a job.
              </Text>
              <Text fontSize="xs" color="blue.800">
                • ₱{remittanceThreshold.toFixed(0)} limit: You’ll be locked from claiming new batches until you remit.
              </Text>
            </VStack>
          </CardBody>
        </Card>

        {/* Lock Warning (if fees due) */}
        {isLocked && (
          <Card bg="orange.50" w="full" border="2px" borderColor="orange.400">
            <CardBody>
              <HStack spacing={2} align="start">
                <WarningIcon color="orange.600" boxSize={5} flexShrink={0} />
                <VStack align="start" spacing={0}>
                  <Text fontWeight="bold" fontSize="sm" color="orange.900">
                    Account Lock Warning
                  </Text>
                  <Text fontSize="xs" color="orange.800">
                    You have ₱{totalFeesDue.toFixed(2)} in pending fees. Pay now to unlock new batch claims.
                  </Text>
                </VStack>
              </HStack>
            </CardBody>
          </Card>
        )}

        {/* Account Details Box */}
        <Card bg="white" w="full" border="1px" borderColor="gray.200">
          <CardBody>
            <VStack spacing={3} align="stretch">
              <Heading size="sm" color="gray.700">Ledger Details</Heading>
              <Divider />
              <HStack justify="space-between" fontSize="sm">
                <Text color="gray.600">Remittance Threshold:</Text>
                <Badge colorScheme="orange">₱{remittanceThreshold.toFixed(0)}</Badge>
              </HStack>

              <VStack align="stretch" spacing={1}>
                <HStack justify="space-between" fontSize="sm">
                  <Text color="gray.600">Remittance Paid (toward limit):</Text>
                  <Text fontWeight="medium">₱{remittancePaidProgress.toFixed(2)} / ₱{remittanceThreshold.toFixed(2)}</Text>
                </HStack>
                <Progress value={remittancePaidPercent} size="sm" colorScheme="green" borderRadius="md" />
                <Text fontSize="xs" color="gray.500">Lifetime remittance paid: ₱{totalRemittancePaid.toFixed(2)}</Text>
              </VStack>

              <HStack justify="space-between" fontSize="sm">
                <Text color="gray.600">Last Remittance:</Text>
                <Text fontWeight="medium">{ledgerData?.last_remittance_at ? new Date(ledgerData.last_remittance_at).toLocaleDateString() : 'Never'}</Text>
              </HStack>
            </VStack>
          </CardBody>
        </Card>

        {/* Remit Button */}
        <Button
          w="full"
          colorScheme="brand"
          size="lg"
          onClick={onOpen}
          isDisabled={totalFeesDue <= 0}
        >
          {totalFeesDue > 0 ? `Pay ₱${totalFeesDue.toFixed(2)} Fees Now` : `No Remittance Fees Owed`}
        </Button>

        {!embedded && (
          <>
            {/* Navigation Buttons */}
            <HStack spacing={2} w="full">
              <Button
                flex={1}
                size="sm"
                variant="outline"
                colorScheme="brand"
                onClick={() => navigate('/rider-home')}
              >
                📍 Find Batches
              </Button>
              <Button
                flex={1}
                size="sm"
                variant="outline"
                colorScheme="brand"
                onClick={() => navigate('/rider-home')}
              >
                📋 My Jobs
              </Button>
            </HStack>

            {/* Back to Queue */}
            <Button
              w="full"
              variant="ghost"
              colorScheme="brand"
              fontSize="sm"
              onClick={() => navigate('/rider-home')}
            >
              ← Back to Queue
            </Button>
          </>
        )}
      </VStack>

      {/* Payment Modal */}
      <Modal isOpen={isOpen} onClose={onClose} isCentered size="sm">
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Pay Remittance Fees (Xendit)</ModalHeader>
          <ModalBody>
            <VStack spacing={4} align="stretch">
              <Card bg="gray.50">
                <CardBody>
                  <HStack justify="space-between">
                    <Text fontWeight="bold">Total Due:</Text>
                    <Text fontWeight="bold" fontSize="lg" color="brand.600">
                      ₱{totalFeesDue.toFixed(2)}
                    </Text>
                  </HStack>
                </CardBody>
              </Card>

              <VStack spacing={2} align="stretch">
                <Text fontWeight="bold" fontSize="sm">
                  Select a Xendit checkout option:
                </Text>

                {showMinOption && (
                  <Card
                    bg={selectedAmount === minUnlockAmount ? 'blue.50' : 'white'}
                    border="2px"
                    borderColor={selectedAmount === minUnlockAmount ? 'blue.400' : 'gray.200'}
                    cursor="pointer"
                    onClick={() => setSelectedAmount(minUnlockAmount)}
                  >
                    <CardBody p={3}>
                      <HStack spacing={2}>
                        <FaLock size={22} color={selectedAmount === minUnlockAmount ? '#0066FF' : '#999'} />
                        <VStack align="start" spacing={0} flex={1}>
                          <Text fontWeight="bold" fontSize="sm">Pay Minimum to Unlock</Text>
                          <Text fontSize="xs" color="gray.600">Pay ₱{minUnlockAmount.toFixed(2)} and continue claiming batches</Text>
                        </VStack>
                        {selectedAmount === minUnlockAmount && <CheckCircleIcon color="green.500" />}
                      </HStack>
                    </CardBody>
                  </Card>
                )}

                <Card
                  bg={selectedAmount === totalFeesDue ? 'blue.50' : 'white'}
                  border="2px"
                  borderColor={selectedAmount === totalFeesDue ? 'blue.400' : 'gray.200'}
                  cursor="pointer"
                  onClick={() => setSelectedAmount(totalFeesDue)}
                >
                  <CardBody p={3}>
                    <HStack spacing={2}>
                      <FaMoneyBillWave size={22} color={selectedAmount === totalFeesDue ? '#0066FF' : '#999'} />
                      <VStack align="start" spacing={0} flex={1}>
                        <Text fontWeight="bold" fontSize="sm">Pay Full Balance</Text>
                        <Text fontSize="xs" color="gray.600">Pay ₱{totalFeesDue.toFixed(2)} total remittance owed</Text>
                      </VStack>
                      {selectedAmount === totalFeesDue && <CheckCircleIcon color="green.500" />}
                    </HStack>
                  </CardBody>
                </Card>

                <Card bg="gray.50" border="1px" borderColor="gray.200">
                  <CardBody p={3}>
                    <HStack spacing={2}>
                      <FaCreditCard size={18} color="#666" />
                      <Text fontSize="xs" color="gray.600">
                        You’ll complete payment in Xendit checkout (no receipt upload needed).
                      </Text>
                    </HStack>
                  </CardBody>
                </Card>
              </VStack>
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
                onClick={handleRemitFees}
                isLoading={isProcessing}
                loadingText="Processing..."
              >
                Continue to Xendit
              </Button>
            </HStack>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </Box>
  )
}

export default RemittanceLedger
