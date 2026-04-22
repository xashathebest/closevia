import React, { useState, useEffect } from 'react'
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalFooter,
  ModalCloseButton,
  VStack,
  HStack,
  Text,
  Button,
  Avatar,
  Box,
  Textarea,
  useToast,
  Spinner,
  Badge,
  Divider,
  Icon,
  Flex,
  Progress,
  Checkbox,
  useBreakpointValue
} from '@chakra-ui/react'
import { keyframes } from '@emotion/react'
import { FaStar, FaHeart, FaThumbsUp, FaCheck, FaHandshake, FaImage } from 'react-icons/fa'
import { Trade } from '../types'
import { api } from '../services/api'

interface TradeCompletionModalProps {
  trade: Trade | null
  isOpen: boolean
  onClose: () => void
  onCompleted: () => void
  currentUserId?: number
}

interface CompletionStatus {
  buyer_completed: boolean
  seller_completed: boolean
  buyer_rating?: number
  seller_rating?: number
  buyer_feedback?: string
  seller_feedback?: string
}

const fadeInAnimation = keyframes`
  0% { opacity: 0; transform: translateY(-10px); }
  100% { opacity: 1; transform: translateY(0); }
`

const TradeCompletionModal: React.FC<TradeCompletionModalProps> = ({
  trade,
  isOpen,
  onClose,
  onCompleted,
  currentUserId
}) => {
  const [status, setStatus] = useState<CompletionStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [rating, setRating] = useState(0)
  const [feedback, setFeedback] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [hasSubmitted, setHasSubmitted] = useState(false)
  const [showCelebration, setShowCelebration] = useState(false)
  const [policyAgreed, setPolicyAgreed] = useState(false)
  const [showFinishButton, setShowFinishButton] = useState(false)
  const [showConfirmationModal, setShowConfirmationModal] = useState(false)
  const [transactionProof, setTransactionProof] = useState<string | null>(null)
  const [uploadingImage, setUploadingImage] = useState(false)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const toast = useToast()
  
  // Responsive modal sizing for mobile vs desktop
  const modalSize = useBreakpointValue({ base: 'sm', sm: 'md', md: 'lg', lg: 'xl' })
  const modalMaxH = useBreakpointValue({ base: '90vh', md: '85vh' })
  const userProfileSpacing = useBreakpointValue({ base: 4, md: 8 })

  const isUserBuyer = trade && currentUserId === trade.buyer_id
  const isUserSeller = trade && currentUserId === trade.seller_id
  const isPhotoMandatory = trade?.trade_option === 'meetup' || trade?.trade_option === 'delivery'

  // Determine if this is a buyout (no items, only cash) vs regular trade
  const isBuyout = !!((!trade?.items || trade.items.length === 0) && 
           (trade?.offered_cash_amount && trade.offered_cash_amount > 0))

  // Get role labels based on transaction type
  const buyerLabel = isBuyout ? 'Buyer' : 'Trader 1'
  const sellerLabel = isBuyout ? 'Seller' : 'Trader 2'

  const fetchCompletionStatus = async () => {
    if (!trade) return

    try {
      setLoading(true)
      const response = await api.get(`/api/trades/${trade.id}/completion-status`)
      setStatus(response.data.data)

      // Check if current user has already submitted
      if (isUserBuyer && response.data.data.buyer_completed) {
        setHasSubmitted(true)
        setRating(response.data.data.buyer_rating || 0)
        setFeedback(response.data.data.buyer_feedback || '')
      } else if (isUserSeller && response.data.data.seller_completed) {
        setHasSubmitted(true)
        setRating(response.data.data.seller_rating || 0)
        setFeedback(response.data.data.seller_feedback || '')
      }

      // Check if both completed for celebration
      if (response.data.data.buyer_completed && response.data.data.seller_completed) {
        setShowCelebration(true)
        setShowFinishButton(true)
      }
    } catch (error) {
      console.error('Failed to fetch completion status:', error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let isMounted = true

    const loadStatus = async () => {
      if (trade && isOpen && isMounted) {
        try {
          setLoading(true)
          const response = await api.get(`/api/trades/${trade.id}/completion-status`)
          
          if (!isMounted) return
          
          setStatus(response.data.data)

          // Check if current user has already submitted
          if (isUserBuyer && response.data.data.buyer_completed) {
            setHasSubmitted(true)
            setRating(response.data.data.buyer_rating || 0)
            setFeedback(response.data.data.buyer_feedback || '')
          } else if (isUserSeller && response.data.data.seller_completed) {
            setHasSubmitted(true)
            setRating(response.data.data.seller_rating || 0)
            setFeedback(response.data.data.seller_feedback || '')
          }

          // Check if both completed for celebration
          if (response.data.data.buyer_completed && response.data.data.seller_completed) {
            setShowCelebration(true)
            setShowFinishButton(true)
          }
        } catch (error) {
          console.error('Failed to fetch completion status:', error)
        } finally {
          if (isMounted) {
            setLoading(false)
          }
        }
      }
    }

    loadStatus()

    return () => {
      isMounted = false
    }
  }, [trade, isOpen])

  const handleSubmitCompletion = () => {
    if (!policyAgreed) {
      toast({
        id: 'tradecompletionmodal-policy-required',
        title: 'Please confirm completion',
        description: 'Check the acknowledgement box before completing the trade.',
        status: 'warning',
      })
      return
    }
    if (!trade) return
    setShowConfirmationModal(true)
  }

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast({
        id: "tradecompletionmodal-invalid-file-type",
        title: 'Invalid file type',
        description: 'Please upload an image file',
        status: 'error',
      })
      return
    }

    // Validate file size (max 5MB)
    if (file.size > 5 * 1024 * 1024) {
      toast({
        id: "tradecompletionmodal-file-too-large",
        title: 'File too large',
        description: 'Please upload an image smaller than 5MB',
        status: 'error',
      })
      return
    }

    try {
      setUploadingImage(true)
      const formData = new FormData()
      formData.append('image', file)
      formData.append('type', 'trade_proof')

      const response = await api.post('/api/upload', formData)

      // Check if response indicates success
      if (!response.data?.success) {
        throw new Error(response.data?.error || 'Upload failed: invalid response')
      }

      const imageUrl = response.data?.data?.url
      if (!imageUrl) {
        throw new Error(response.data?.error || 'Upload succeeded but no image URL was returned. Please try again.')
      }

      setTransactionProof(imageUrl)
      toast({
        id: "tradecompletionmodal-image-uploaded",
        title: 'Image uploaded',
        description: 'Transaction proof uploaded successfully',
        status: 'success',
      })
    } catch (error: any) {
      // Upload failed — non-blocking. User can still submit without proof.
      const isServiceUnavailable = error?.response?.status === 503
      const errorMessage = error?.message || error?.response?.data?.error || 'Failed to upload image'
      
      toast({
        id: "tradecompletionmodal-toast-4",
        title: isServiceUnavailable ? 'Image upload unavailable' : 'Upload failed',
        description: isServiceUnavailable
          ? 'Image upload service is not configured. You can still submit your completion without a proof photo.'
          : errorMessage,
        status: 'warning',
        duration: 5000,
        isClosable: true,
      })
      // Clear any partial state
      setTransactionProof(null)
    } finally {
      setUploadingImage(false)
      // Reset input so same file can be re-selected if needed
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleConfirmCompletion = async () => {
    if (!trade) return

    try {
      setSubmitting(true)
      setShowConfirmationModal(false)

      await api.put(`/api/trades/${trade.id}/complete`, {
        rating,
        feedback: feedback.trim(),
        transaction_proof_url: transactionProof || '',
        is_camera_photo: !!transactionProof,
      })

      setHasSubmitted(true)
      toast({
        id: "tradecompletionmodal-trade-completion-submitted",
        title: 'Trade completion submitted!',
        description: 'Waiting for the other party to confirm...',
        status: 'success',
        duration: 3000
      })

      const updatedRes = await api.get(`/api/trades/${trade.id}/completion-status`)
      const updatedStatus = updatedRes.data.data
      setStatus(updatedStatus)

      if (updatedStatus.buyer_completed && updatedStatus.seller_completed) {
        setShowCelebration(true)
        setShowFinishButton(true)
        onCompleted()
      }
    } catch (error: any) {
      toast({
        id: "tradecompletionmodal-error",
        title: 'Error',
        description: error?.response?.data?.error || 'Failed to submit completion',
        status: 'error'
      })
    } finally {
      setSubmitting(false)
    }
  }

  const handleFinishTrade = () => {
    onClose()
    onCompleted()
  }

  const renderRatingStars = (currentRating: number, onRate?: (rating: number) => void) => (
    <HStack spacing={1}>
      {[1, 2, 3, 4, 5].map((star) => (
        <Icon
          key={star}
          as={FaStar}
          color={star <= currentRating ? 'yellow.400' : 'gray.300'}
          cursor={onRate ? 'pointer' : 'default'}
          onClick={() => onRate?.(star)}
          _hover={onRate ? { transform: 'scale(1.1)' } : {}}
          transition="all 0.2s"
        />
      ))}
    </HStack>
  )

  const renderUserProfile = (
    name: string,
    userId: number,
    isCurrentUser: boolean,
    hasCompleted: boolean,
    userRating?: number
  ) => (
    <VStack spacing={3} flex={1} align="center">
      <Box position="relative">
        <Avatar
          size="lg"
          name={name}
          bg={isCurrentUser ? 'brand.500' : 'gray.500'}
          color="white"
        />
        {hasCompleted && (
          <Box
            position="absolute"
            bottom={0}
            right={0}
            bg="green.500"
            borderRadius="full"
            p={1}
          >
            <Icon as={FaCheck} color="white" boxSize={3} />
          </Box>
        )}
      </Box>

      <VStack spacing={1} align="center">
        <Text fontWeight="bold" fontSize="lg">
          {name} {isCurrentUser && '(You)'}
        </Text>
        {userRating && userRating > 0 && (
          <HStack>
            <Text fontSize="sm" color="gray.600">Rating:</Text>
            {renderRatingStars(userRating)}
          </HStack>
        )}
      </VStack>
    </VStack>
  )

  const bothCompleted = status?.buyer_completed && status?.seller_completed

  if (!trade) return null

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} size={modalSize} isCentered scrollBehavior="inside">
        <ModalOverlay bg="blackAlpha.600" backdropFilter="blur(4px)" />
        <ModalContent
          bg="white"
          borderRadius="xl"
          boxShadow="xl"
          mx={{ base: 2, md: 4 }}
          maxW={{ base: '100%', sm: '400px', md: '500px' }}
          maxH={modalMaxH}
          display="flex"
          flexDirection="column"
        >
          <ModalHeader fontSize="md" pb={2}>
            Trade Completion
          </ModalHeader>
          <ModalCloseButton color="gray.600" />

          <ModalBody flex="1" overflowY="auto" px={{ base: 3, md: 6 }} py={{ base: 3, md: 2 }}>
            {loading ? (
              <Flex justify="center" align="center" py={8} w="full">
                <Spinner size="lg" color="brand.500" />
              </Flex>
            ) : (
              <VStack spacing={6} w="full" maxW={{ base: '100%', md: '500px' }}>
                {/* Progress Indicator */}
                <Box w="full">
                  <Text fontSize="sm" color="gray.600" mb={2} textAlign="center">
                    Completion Progress
                  </Text>
                  <Progress
                    value={
                      status?.buyer_completed && status?.seller_completed ? 100 :
                        (status?.buyer_completed || status?.seller_completed) ? 50 : 0
                    }
                    colorScheme="green"
                    borderRadius="full"
                    bg="gray.100"
                  />
                </Box>

                {/* User Profiles - Responsive layout */}
                <Flex flexDirection={{ base: 'column', md: 'row' }} w="full" justify="center" gap={{ base: 4, md: 8 }} align="center">
                  {renderUserProfile(
                    trade.buyer_name || `User #${trade.buyer_id}`,
                    trade.buyer_id,
                    !!isUserBuyer,
                    !!(status?.buyer_completed),
                    status?.buyer_rating
                  )}
                  <Icon
                    as={FaHandshake}
                    color={bothCompleted ? 'green.500' : 'gray.400'}
                    boxSize={{ base: 6, md: 8 }}
                  />
                  {renderUserProfile(
                    trade.seller_name || `User #${trade.seller_id}`,
                    trade.seller_id,
                    !!isUserSeller,
                    !!(status?.seller_completed),
                    status?.seller_rating
                  )}
                </Flex>

                <Divider />

                {/* Completion Form or Status */}
                {bothCompleted ? (
                  <VStack spacing={4} w="full">
                    <Box
                      bg="green.50"
                      border="1px solid"
                      borderColor="green.200"
                      borderRadius="md"
                      p={4}
                      w="full"
                      textAlign="center"
                      animation={`${fadeInAnimation} 0.3s ease-out`}
                    >
                      <Icon as={FaCheck} color="green.500" boxSize={5} mb={2} />
                      <Text fontWeight="semibold" color="green.700" fontSize="md">
                        Trade Successfully Completed
                      </Text>
                      <Text color="green.600" fontSize="sm" mt={1}>
                        Both parties have confirmed completion
                      </Text>
                    </Box>

                    {/* Show feedback if available */}
                    {(status?.buyer_feedback || status?.seller_feedback) && (
                      <VStack spacing={3} w="full">
                        <Text fontWeight="semibold">Feedback:</Text>
                        {status?.buyer_feedback && (
                          <Box bg="gray.50" p={3} borderRadius="md" w="full">
                            <Text fontSize="sm" fontWeight="medium" color="gray.700">
                              From {trade.buyer_name || `User #${trade.buyer_id}`}:
                            </Text>
                            <Text fontSize="sm" color="gray.600" mt={1}>
                              "{status.buyer_feedback}"
                            </Text>
                          </Box>
                        )}
                        {status?.seller_feedback && (
                          <Box bg="gray.50" p={3} borderRadius="md" w="full">
                            <Text fontSize="sm" fontWeight="medium" color="gray.700">
                              From {trade.seller_name || `User #${trade.seller_id}`}:
                            </Text>
                            <Text fontSize="sm" color="gray.600" mt={1}>
                              "{status.seller_feedback}"
                            </Text>
                          </Box>
                        )}
                      </VStack>
                    )}
                  </VStack>
                ) : hasSubmitted ? (
                  <Box
                    bg="blue.50"
                    border="2px solid"
                    borderColor="blue.200"
                    borderRadius="lg"
                    p={4}
                    w="full"
                    textAlign="center"
                  >
                    <Spinner size="md" color="blue.500" mb={2} />
                    <Text fontWeight="bold" color="blue.700">
                      Waiting for confirmation...
                    </Text>
                    <Text color="blue.600" fontSize="sm" mt={1}>
                      You've confirmed the trade. Waiting for the other party to confirm.
                    </Text>
                  </Box>
                ) : (
                  <VStack spacing={4} w="full">
                    <Text fontWeight="semibold" textAlign="center">
                      Please rate your experience and confirm completion
                    </Text>

                    {/* Upload Transaction Photo — compact pill (never expands modal) */}
                    <Box w="full">
                      <Text fontSize="sm" fontWeight="medium" color={isPhotoMandatory && !transactionProof ? "red.500" : "gray.700"} mb={2}>
                        Proof of Transaction {isPhotoMandatory ? '(Required)' : '(Optional)'}
                      </Text>
                      <HStack
                        p={{ base: 1.5, md: 2 }}
                        px={{ base: 2, md: 3 }}
                        border="1.5px dashed"
                        borderColor={transactionProof ? 'green.400' : uploadingImage ? 'blue.300' : 'gray.300'}
                        borderRadius="full"
                        bg={transactionProof ? 'green.50' : uploadingImage ? 'blue.50' : 'gray.50'}
                        spacing={{ base: 1.5, md: 2 }}
                        justify="space-between"
                        cursor={uploadingImage ? 'not-allowed' : 'pointer'}
                        onClick={() => !uploadingImage && fileInputRef.current?.click()}
                        _hover={!uploadingImage ? { borderColor: 'brand.400', bg: 'brand.50' } : {}}
                        transition="all 0.2s"
                      >
                        <HStack spacing={{ base: 1.5, md: 2 }} flex={1} minW={0}>
                          {uploadingImage ? (
                            <Spinner size="xs" color="blue.400" />
                          ) : transactionProof ? (
                            <Icon as={FaCheck} color="green.500" boxSize={{ base: 3, md: 3.5 }} />
                          ) : (
                            <Icon as={FaImage} color="gray.400" boxSize={{ base: 3, md: 3.5 }} />
                          )}
                          <Text fontSize={{ base: '2xs', md: 'xs' }} color={transactionProof ? 'green.700' : isPhotoMandatory ? 'red.500' : 'gray.500'} isTruncated>
                            {uploadingImage
                              ? 'Uploading…'
                              : transactionProof
                              ? 'Proof ✓'
                              : isPhotoMandatory
                              ? 'Take photo (required)'
                              : 'Add photo (optional)'}
                          </Text>
                        </HStack>
                        {transactionProof && !uploadingImage && (
                          <HStack spacing={{ base: 0.5, md: 1 }} display={{ base: 'flex', md: 'flex' }}>
                            <Button
                              size={{ base: 'sm', md: 'xs' }}
                              colorScheme="brand"
                              variant="ghost"
                              px={{ base: 1.5, md: 2 }}
                              py={1}
                              onClick={(e) => {
                                e.stopPropagation()
                                fileInputRef.current?.click()
                              }}
                            >
                              Change
                            </Button>
                            <Button
                              size={{ base: 'sm', md: 'xs' }}
                              colorScheme="red"
                              variant="ghost"
                              px={{ base: 1.5, md: 2 }}
                              py={1}
                              onClick={(e) => {
                                e.stopPropagation()
                                setTransactionProof(null)
                                if (fileInputRef.current) fileInputRef.current.value = ''
                              }}
                            >
                              Remove
                            </Button>
                          </HStack>
                        )}
                        {!transactionProof && !uploadingImage && (
                          <Text fontSize={{ base: '2xs', md: 'xs' }} color="brand.500" fontWeight="600" flexShrink={0}>
                            {isPhotoMandatory ? 'Photo' : 'Browse'}
                          </Text>
                        )}
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/*"
                          capture="environment"
                          style={{ display: 'none' }}
                          onChange={handleImageUpload}
                        />
                      </HStack>
                    </Box>

                    <VStack spacing={3} w="full">
                      <Text fontSize="sm" color="gray.600">Rate this trade:</Text>
                      <HStack spacing={{ base: 2, md: 3 }} justify="center">
                        {renderRatingStars(rating, setRating)}
                      </HStack>
                    </VStack>

                    <VStack spacing={2} w="full">
                      <Text fontSize="sm" color="gray.600">
                        Leave feedback (optional):
                      </Text>
                      <Textarea
                        value={feedback}
                        onChange={(e) => setFeedback(e.target.value)}
                        placeholder="Share your experience with this trade..."
                        resize="none"
                        rows={3}
                        fontSize={{ base: 'sm', md: 'md' }}
                        px={{ base: 2, md: 3 }}
                        py={{ base: 2, md: 3 }}
                      />
                    </VStack>
                  </VStack>
                )}
              </VStack>
            )}
          </ModalBody>

          {/* Sticky footer — always visible, contains the main action button */}
          {!loading && !bothCompleted && !hasSubmitted && (
            <ModalFooter borderTopWidth="1px" borderColor="gray.100" flexDirection="column" gap={{ base: 1.5, md: 2 }} pt={{ base: 2, md: 3 }} pb={{ base: 3, md: 4 }} px={{ base: 3, md: 6 }}>
              <HStack spacing={{ base: 2, md: 3 }} justify="center" align="start" w="full">
                <Checkbox
                  isChecked={policyAgreed}
                  onChange={(e) => setPolicyAgreed(e.target.checked)}
                  colorScheme="green"
                  size={{ base: 'md', md: 'sm' }}
                  flexShrink={0}
                />
                <Text fontSize={{ base: 'xs', md: 'xs' }} color="gray.500" textAlign="left" flex={1}>
                  By confirming, you acknowledge that the trade has been completed successfully
                </Text>
              </HStack>
              <Button
                colorScheme="green"
                size="lg"
                w="full"
                onClick={handleSubmitCompletion}
                isLoading={submitting}
                loadingText="Completing..."
                leftIcon={<FaCheck />}
                isDisabled={uploadingImage}
                mt={{ base: 2, md: 4 }}
              >
                Leave a Review and Complete Trade
              </Button>
            </ModalFooter>
          )}
          {!loading && bothCompleted && showFinishButton && (
            <ModalFooter borderTopWidth="1px" borderColor="gray.100" pt={3} pb={4}>
              <Button
                colorScheme="blue"
                size="lg"
                w="full"
                onClick={handleFinishTrade}
                leftIcon={<FaCheck />}
              >
                Finish
              </Button>
            </ModalFooter>
          )}
        </ModalContent>
      </Modal>

      {/* Compact Confirmation Modal */}
      <Modal isOpen={showConfirmationModal} onClose={() => setShowConfirmationModal(false)} size="sm" isCentered>
        <ModalOverlay bg="blackAlpha.600" backdropFilter="blur(4px)" />
        <ModalContent
          bg="white"
          borderRadius="xl"
          boxShadow="xl"
          mx={4}
        >
          <ModalBody p={6} textAlign="center">
            <VStack spacing={4}>
              <Icon as={FaHandshake} color="blue.500" boxSize={8} />
              <VStack spacing={2}>
                <Text fontWeight="bold" fontSize="lg" color="gray.800">
                  Confirm Trade Completion
                </Text>
                <Text fontSize="sm" color="gray.600" textAlign="center">
                  Are you sure you want to mark this trade as completed? This action cannot be undone.
                </Text>
              </VStack>

              <HStack spacing={3} w="full">
                <Button
                  variant="outline"
                  size="md"
                  flex={1}
                  onClick={() => setShowConfirmationModal(false)}
                  isDisabled={submitting}
                >
                  Cancel
                </Button>
                <Button
                  colorScheme="green"
                  size="md"
                  flex={1}
                  onClick={handleConfirmCompletion}
                  isLoading={submitting}
                  loadingText="Confirming..."
                  leftIcon={<FaCheck />}
                >
                  Confirm
                </Button>
              </HStack>
            </VStack>
          </ModalBody>
        </ModalContent>
      </Modal>
    </>
  )
}

export default TradeCompletionModal
