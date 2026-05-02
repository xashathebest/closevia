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
  Box,
  Textarea,
  useToast,
  Spinner,
  Icon,
  Flex,
  Checkbox,
  useBreakpointValue
} from '@chakra-ui/react'
import { keyframes } from '@emotion/react'
import { FaStar, FaCheck, FaHandshake, FaImage } from 'react-icons/fa'
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
  status?: 'awaiting_confirmation' | 'completed' | 'did_not_push_through' | 'under_review' | string
  buyer_rating?: number
  seller_rating?: number
  buyer_feedback?: string
  seller_feedback?: string
  buyer_completion_outcome?: 'complete' | 'did_not_push_through' | ''
  seller_completion_outcome?: 'complete' | 'did_not_push_through' | ''
  buyer_completion_confirmed?: boolean
  seller_completion_confirmed?: boolean
  requires_outcome_confirmation?: boolean
  outcome_mismatch?: boolean
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
  const [policyAgreed, setPolicyAgreed] = useState(false)
  const [showFinishButton, setShowFinishButton] = useState(false)
  const [showConfirmationModal, setShowConfirmationModal] = useState(false)
  const [transactionProof, setTransactionProof] = useState<string | null>(null)
  const [uploadingImage, setUploadingImage] = useState(false)
  const fileInputRef = React.useRef<HTMLInputElement>(null)
  const hasEditedReviewRef = React.useRef(false)
  const toast = useToast()
  
  // Responsive modal sizing for mobile vs desktop
  const modalSize = useBreakpointValue({ base: 'sm', sm: 'md', md: 'lg', lg: 'xl' })
  const modalMaxH = useBreakpointValue({ base: '90vh', md: '85vh' })

  const isUserBuyer = trade && currentUserId === trade.buyer_id
  const isUserSeller = trade && currentUserId === trade.seller_id
  const isPhotoMandatory = trade?.trade_option === 'meetup' || trade?.trade_option === 'delivery'

  useEffect(() => {
    hasEditedReviewRef.current = false
  }, [trade?.id, isOpen])

  useEffect(() => {
    let isMounted = true

    const loadStatus = async () => {
      if (trade && isOpen && isMounted) {
        try {
          setLoading(true)
          const response = await api.get(`/api/trades/${trade.id}/completion-status`)
          
          if (!isMounted) return
          
          setStatus(response.data.data)

          const userAlreadySubmitted =
            (currentUserId === trade.buyer_id && response.data.data.buyer_completed) ||
            (currentUserId === trade.seller_id && response.data.data.seller_completed)

          setHasSubmitted(userAlreadySubmitted && !response.data.data.requires_outcome_confirmation)

          if (!hasEditedReviewRef.current) {
            if (currentUserId === trade.buyer_id && response.data.data.buyer_completed) {
              setRating(response.data.data.buyer_rating || 0)
              setFeedback(response.data.data.buyer_feedback || '')
            } else if (currentUserId === trade.seller_id && response.data.data.seller_completed) {
              setRating(response.data.data.seller_rating || 0)
              setFeedback(response.data.data.seller_feedback || '')
            }
          }

          if (response.data.data.status === 'completed') {
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
  }, [trade?.id, currentUserId, isOpen])

  const handleSubmitCompletion = () => {
    if (!rating) {
      toast({
        id: 'tradecompletionmodal-rating-required',
        title: 'Please add a rating',
        description: 'Choose a star rating before submitting your review.',
        status: 'warning',
      })
      return
    }
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

  const handleDidNotPushThrough = async () => {
    if (!trade) return
    if (!rating) {
      toast({
        id: 'tradecompletionmodal-backup-rating-required',
        title: 'Please add a rating',
        description: 'Choose a star rating before saving this outcome.',
        status: 'warning',
      })
      return
    }
    if (!feedback.trim()) {
      toast({
        id: 'tradecompletionmodal-backup-feedback-required',
        title: 'Please leave feedback',
        description: 'Add a short note about why the trade did not push through.',
        status: 'warning',
      })
      return
    }

    try {
      setSubmitting(true)
      const submitRes = await api.put(`/api/trades/${trade.id}/complete`, {
        rating,
        feedback: feedback.trim(),
        transaction_proof_url: transactionProof || '',
        is_camera_photo: !!transactionProof,
        completion_outcome: 'did_not_push_through',
      })

      const updatedRes = await api.get(`/api/trades/${trade.id}/completion-status`)
      const updatedStatus = updatedRes.data.data
      setStatus(updatedStatus)
      const needsConfirmation = !!updatedStatus.requires_outcome_confirmation || !!submitRes.data?.data?.requires_outcome_confirmation
      setHasSubmitted(!needsConfirmation)

      toast({
        id: 'tradecompletionmodal-did-not-push-through',
        title: needsConfirmation ? 'Confirm final outcome' : "Trade didn't push through",
        description: needsConfirmation
          ? 'Your trade partner selected a different outcome. Please confirm your final decision.'
          : 'You met or reviewed the trade, but decided not to continue. No penalty was applied.',
        status: needsConfirmation ? 'warning' : 'info',
        duration: 3500,
      })
      if (!needsConfirmation) {
        onCompleted()
        onClose()
      }
    } catch (error: any) {
      toast({
        id: 'tradecompletionmodal-backup-error',
        title: 'Error',
        description: error?.response?.data?.error || 'Failed to save this trade outcome',
        status: 'error',
      })
    } finally {
      setSubmitting(false)
    }
  }

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    hasEditedReviewRef.current = true

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast({
        id: "tradecompletionmodal-invalid-file-type",
        title: 'Images only, please',
        description: 'Please upload a photo (JPG, PNG, or WEBP).',
        status: 'warning',
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
        completion_outcome: 'complete',
      })

      setHasSubmitted(true)

      const updatedRes = await api.get(`/api/trades/${trade.id}/completion-status`)
      const updatedStatus = updatedRes.data.data
      setStatus(updatedStatus)
      const needsConfirmation = !!updatedStatus.requires_outcome_confirmation

      setHasSubmitted(!needsConfirmation)

      if (needsConfirmation) {
        toast({
          id: 'tradecompletionmodal-outcome-mismatch',
          title: 'Confirm final outcome',
          description: 'Your trade partner selected a different outcome. Please confirm your final decision.',
          status: 'warning',
          duration: 4000,
        })
      } else {
        toast({
          id: "tradecompletionmodal-trade-completion-submitted",
          title: 'Trade completion submitted!',
          description: 'Waiting for the other party to confirm...',
          status: 'success',
          duration: 3000
        })
      }

      if (updatedStatus.status === 'completed') {
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
          onClick={() => {
            hasEditedReviewRef.current = true
            onRate?.(star)
          }}
          _hover={onRate ? { transform: 'scale(1.1)' } : {}}
          transition="all 0.2s"
        />
      ))}
    </HStack>
  )

  const requiresOutcomeConfirmation = !!status?.requires_outcome_confirmation
  const isDidNotPushThrough = status?.status === 'did_not_push_through'
  const isUnderReview = status?.status === 'under_review'
  const bothCompleted = status?.status === 'completed'
  const canSubmitOutcome = !hasSubmitted || requiresOutcomeConfirmation

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

          <ModalBody
            flex="1"
            overflowY="auto"
            px={{ base: 3, md: 6 }}
            pt={{ base: 3, md: 2 }}
            pb={{ base: 'calc(env(safe-area-inset-bottom, 0px) + 164px)', md: 4 }}
          >
            {loading ? (
              <Flex justify="center" align="center" py={8} w="full">
                <Spinner size="lg" color="brand.500" />
              </Flex>
            ) : (
              <VStack spacing={5} w="full" maxW={{ base: '100%', md: '500px' }}>
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

                    {((isUserBuyer && status?.buyer_feedback) || (isUserSeller && status?.seller_feedback)) && (
                      <Box bg="gray.50" p={3} borderRadius="md" w="full">
                        <Text fontSize="sm" fontWeight="medium" color="gray.700">
                          Your feedback
                        </Text>
                        <Text fontSize="sm" color="gray.600" mt={1}>
                          "{isUserBuyer ? status?.buyer_feedback : status?.seller_feedback}"
                        </Text>
                      </Box>
                    )}
                  </VStack>
                ) : isDidNotPushThrough ? (
                  <Box
                    bg="gray.50"
                    border="1px solid"
                    borderColor="gray.200"
                    borderRadius="lg"
                    p={4}
                    w="full"
                    textAlign="center"
                  >
                    <Text fontWeight="bold" color="gray.700">
                      Trade didn't push through
                    </Text>
                    <Text color="gray.600" fontSize="sm" mt={1}>
                      You met or reviewed the trade, but decided not to continue. No penalty was applied.
                    </Text>
                  </Box>
                ) : isUnderReview ? (
                  <Box
                    bg="orange.50"
                    border="1px solid"
                    borderColor="orange.200"
                    borderRadius="lg"
                    p={4}
                    w="full"
                    textAlign="center"
                  >
                    <Text fontWeight="bold" color="orange.700">
                      Under Review
                    </Text>
                    <Text color="orange.600" fontSize="sm" mt={1}>
                      Your outcomes still do not match. The trade is locked for admin review.
                    </Text>
                  </Box>
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
                    {requiresOutcomeConfirmation && (
                      <Box
                        bg="orange.50"
                        border="1px solid"
                        borderColor="orange.200"
                        borderRadius="lg"
                        p={3}
                        w="full"
                      >
                        <Text fontSize="sm" color="orange.800" fontWeight="600">
                          Your trade partner selected a different outcome. Please confirm your final decision.
                        </Text>
                      </Box>
                    )}
                    <Box
                      bg="green.50"
                      border="1px solid"
                      borderColor="green.200"
                      borderRadius="lg"
                      p={3}
                      w="full"
                    >
                      <Text fontSize="sm" color="green.800" fontWeight="600">
                        Arrival confirmed. You can now check each other's items. If everything looks good, leave a review and complete the trade.
                      </Text>
                    </Box>
                    <Text fontWeight="semibold" textAlign="center">
                      Leave your review
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
                        onChange={(e) => {
                          hasEditedReviewRef.current = true
                          setFeedback(e.target.value)
                        }}
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
          {!loading && !bothCompleted && !isDidNotPushThrough && !isUnderReview && canSubmitOutcome && (
            <ModalFooter
              borderTopWidth="1px"
              borderColor="gray.100"
              flexDirection="column"
              gap={{ base: 1.5, md: 2 }}
              pt={{ base: 2, md: 3 }}
              pb={{ base: 'calc(env(safe-area-inset-bottom, 0px) + 12px)', md: 4 }}
              px={{ base: 3, md: 6 }}
              bg="white"
              position="sticky"
              bottom={0}
              zIndex={2}
              shadow="0 -10px 28px rgba(15, 23, 42, 0.08)"
            >
              <Text fontSize="xs" color="gray.600" textAlign="left" w="full">
                After meeting, check each other's items first. If everything looks good, complete the trade. If not, you can mark it as didn't push through and still leave feedback.
              </Text>
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
                {requiresOutcomeConfirmation ? 'Confirm Complete Trade' : 'Leave a Review and Complete Trade'}
              </Button>
              <Button
                colorScheme="gray"
                variant="outline"
                size="md"
                w="full"
                onClick={handleDidNotPushThrough}
                isLoading={submitting}
                loadingText="Saving..."
                isDisabled={uploadingImage}
              >
                {requiresOutcomeConfirmation ? "Confirm Didn't Push Through" : "Trade didn't push through"}
              </Button>
            </ModalFooter>
          )}
          {!loading && bothCompleted && showFinishButton && (
            <ModalFooter
              borderTopWidth="1px"
              borderColor="gray.100"
              pt={3}
              pb={{ base: 'calc(env(safe-area-inset-bottom, 0px) + 12px)', md: 4 }}
              bg="white"
              position="sticky"
              bottom={0}
              zIndex={2}
              shadow="0 -10px 28px rgba(15, 23, 42, 0.08)"
            >
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
