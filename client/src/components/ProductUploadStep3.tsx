import React, { useState } from 'react'
import {
  Box,
  VStack,
  HStack,
  Text,
  Button,
  Badge,
  Icon,
  Progress,
  useToast,
  Image,
  AspectRatio,
  Divider,
  Checkbox,
  Alert,
  AlertIcon,
  Spinner,
  Center,
  Wrap,
  WrapItem,
  Heading,
  Skeleton,
} from '@chakra-ui/react'
import { ArrowBackIcon, CheckCircleIcon } from '@chakra-ui/icons'
import { MdCheckCircle } from 'react-icons/md'

interface ReviewProduct {
  images: string[]
  video?: string
  title: string
  description: string
  price: number
  category: string
  condition: string
  location: string
  allowBuying: boolean
  barterOnly: boolean
  wants?: string
  wanted_categories?: string[]
  estimated_value_min?: number
  estimated_value_max?: number
  show_estimated_value?: boolean
  isAnalyzing?: boolean
}

interface ProductUploadStep3Props {
  product: ReviewProduct
  onSubmit: () => void
  onBack: () => void
  onToggleEstimateVisibility?: (show: boolean) => void
  isLoading?: boolean
}

const ProductUploadStep3: React.FC<ProductUploadStep3Props> = ({
  product,
  onSubmit,
  onBack,
  onToggleEstimateVisibility,
  isLoading = false,
}) => {
  const [agreeTerms, setAgreeTerms] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const toast = useToast()

  const handleSubmit = async () => {
    if (!agreeTerms) {
      toast({
        id: "productuploadstep3-please-accept-terms",
        title: 'Please accept terms',
        description: 'You must agree to listing terms before posting',
        status: 'warning',
        duration: 3,
        isClosable: true,
      })
      return
    }

    setIsSubmitting(true)
    try {
      await onSubmit()
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Box w="full" minH="100vh" bg="gray.50" pb={24}>
      {/* Progress Indicator */}
      <Box bg="white" borderBottomWidth="1px" borderColor="gray.200" position="sticky" top={0} zIndex={10}>
        <VStack spacing={0} maxW="container.md" mx="auto" p={{ base: 4, md: 6 }}>
          <HStack w="full" justify="space-between" mb={4}>
            <Text fontSize="sm" fontWeight="600" color="gray.600">
              Step 3 of 3
            </Text>
            <Text fontSize="sm" color="gray.500">
              Review & Post
            </Text>
          </HStack>

          <Progress value={100} size="sm" w="full" colorScheme="brand" rounded="full" hasStripe />
        </VStack>
      </Box>

      {/* Main Content */}
      <VStack spacing={6} maxW="container.md" mx="auto" p={{ base: 4, md: 6 }} align="stretch">
        {/* Header */}
        <VStack spacing={1} align="start">
          <Text fontSize={{ base: 'md', md: 'lg' }} fontWeight="700" color="gray.900">
            Review Your Listing
          </Text>
          <Text fontSize="sm" color="gray.600">
            Make sure everything looks correct before posting
          </Text>
        </VStack>

        {/* Images Preview */}
        <VStack spacing={3} align="stretch">
          <Text fontWeight="600" fontSize="sm" color="gray.700" textTransform="uppercase" letterSpacing="0.5px">
            📸 Images
          </Text>

          <Box overflowX="auto">
            <HStack spacing={3} minW="min-content">
              {product.images.map((image, idx) => (
                <AspectRatio
                  key={idx}
                  ratio={1}
                  w="24"
                  rounded="lg"
                  overflow="hidden"
                  borderWidth="1px"
                  borderColor="gray.200"
                  flexShrink={0}
                >
                  <Image src={image} alt={`Product ${idx + 1}`} objectFit="cover" />
                </AspectRatio>
              ))}
            </HStack>
          </Box>

          {product.video && (
            <Box bg="gray.900" rounded="lg" overflow="hidden" h="32">
              <video src={product.video} controls style={{ width: '100%', height: '100%' }} />
            </Box>
          )}

          <Text fontSize="xs" color="gray.500">
            {product.images.length} image{product.images.length !== 1 ? 's' : ''}
            {product.video && ' + 1 video'}
          </Text>
        </VStack>

        {/* Market Value Ribbon — uses AI estimate when reliable, otherwise
            falls back to the user-entered price sFix trade matches card persistence + notify third party on accept/decline
            
            Fix counter offer routing so it appears in original offerer's received offerso the badge still renders. */}
        {(() => {
          const aiMin = product.estimated_value_min
          const aiMax = product.estimated_value_max
          const showEstimate = product.show_estimated_value !== false
          // An AI range is "reliable" when max/min <= 3. A 2k–100k swing is
          // meaningless and should trigger the user-price fallback.
          const aiReliable =
            aiMin !== undefined &&
            aiMax !== undefined &&
            aiMin > 0 &&
            aiMax > 0 &&
            aiMax / aiMin <= 3
          const userPrice = product.price || 0
          const showBadge = product.isAnalyzing || aiReliable || userPrice > 0
          if (!showBadge) return null
          const showFallback = !product.isAnalyzing && !aiReliable && userPrice > 0
          return (
            <Box
              p={4}
              bg={showEstimate ? "linear-gradient(135deg, #667eea 0%, #764ba2 100%)" : "gray.600"}
              borderRadius="xl"
              textAlign="center"
              color="white"
              shadow="md"
            >
              <HStack justify="space-between" align="center" mb={2} gap={3}>
                <Text fontSize="xs" fontWeight="semibold" opacity={0.9} textTransform="uppercase" letterSpacing="1px">
                  {showFallback ? 'Your Market Estimate' : 'Estimated Market Value'}
                </Text>
                <HStack spacing={0} borderWidth="1px" borderColor="whiteAlpha.500" borderRadius="md" overflow="hidden" flexShrink={0}>
                  <Button size="xs" borderRadius={0} colorScheme={showEstimate ? 'green' : 'whiteAlpha'} variant={showEstimate ? 'solid' : 'ghost'} onClick={() => onToggleEstimateVisibility?.(true)}>
                    On
                  </Button>
                  <Button size="xs" borderRadius={0} colorScheme={!showEstimate ? 'red' : 'whiteAlpha'} variant={!showEstimate ? 'solid' : 'ghost'} onClick={() => onToggleEstimateVisibility?.(false)}>
                    Off
                  </Button>
                </HStack>
              </HStack>
              {product.isAnalyzing ? (
                <Skeleton height="36px" borderRadius="md" speed={0.8} />
              ) : !showEstimate ? (
                <Heading fontSize="xl" fontWeight="800">
                  Hidden from product viewers
                </Heading>
              ) : aiReliable ? (
                <Heading fontSize="3xl" fontWeight="800">
                  ₱{(aiMin || 0).toLocaleString()} – ₱{(aiMax || 0).toLocaleString()}
                </Heading>
              ) : (
                <Heading fontSize="3xl" fontWeight="800">
                  ₱{userPrice.toLocaleString()}
                </Heading>
              )}
              <Text fontSize="2xs" opacity={0.85} mt={2}>
                {product.isAnalyzing
                  ? 'AI is analyzing your product...'
                  : !showEstimate
                    ? 'The estimate will not appear on the posted product.'
                    : showFallback
                    ? 'Based on the price you entered (AI estimate was unavailable)'
                    : 'Based on AI analysis of product condition and market data'}
              </Text>
            </Box>
          )
        })()}

        <Divider />

        {/* Product Details Card */}
        <VStack spacing={4} align="stretch" bg="white" p={4} rounded="lg" borderWidth="1px" borderColor="gray.200">
          {/* Title */}
          <VStack spacing={1} align="start">
            <Text fontSize="xs" color="gray.500" fontWeight="600" textTransform="uppercase" letterSpacing="0.5px">
              Product Title
            </Text>
            <Text fontSize="lg" fontWeight="700" color="gray.900">
              {product.title}
            </Text>
          </VStack>

          <Divider />

          {/* Description */}
          <VStack spacing={1} align="start">
            <Text fontSize="xs" color="gray.500" fontWeight="600" textTransform="uppercase" letterSpacing="0.5px">
              Description
            </Text>
            <Text fontSize="sm" color="gray.700" lineHeight="1.6" whiteSpace="pre-wrap">
              {product.description}
            </Text>
          </VStack>

          <Divider />

          {/* Details Grid */}
          <VStack spacing={3} align="stretch">
            <HStack justify="space-between">
              <Text fontSize="sm" color="gray.600">
                Category
              </Text>
              <Badge colorScheme="gray">{product.category}</Badge>
            </HStack>

            <HStack justify="space-between">
              <Text fontSize="sm" color="gray.600">
                Condition
              </Text>
              <Badge colorScheme="blue">{product.condition}</Badge>
            </HStack>

            {product.location && (
              <HStack justify="space-between" align="start">
                <Text fontSize="sm" color="gray.600">
                  Location
                </Text>
                <Text fontSize="sm" fontWeight="500" color="gray.900" textAlign="right">
                  📍 {product.location}
                </Text>
              </HStack>
            )}

            {(product.wants || (product.wanted_categories && product.wanted_categories.length > 0)) && (
              <>
                <Divider />
                <VStack align="stretch" spacing={2}>
                  <Text fontSize="xs" color="gray.500" fontWeight="600" textTransform="uppercase" letterSpacing="0.5px">
                    Looking For
                  </Text>
                  
                  {product.wanted_categories && product.wanted_categories.length > 0 && (
                    <Wrap spacing={1}>
                      {product.wanted_categories.map(cat => (
                        <WrapItem key={cat}>
                          <Badge size="sm" variant="subtle" colorScheme="brand" borderRadius="full">
                            {cat}
                          </Badge>
                        </WrapItem>
                      ))}
                    </Wrap>
                  )}
                  
                  {product.wants && (
                    <Text fontSize="sm" color="gray.700" fontStyle="italic">
                      " {product.wants} "
                    </Text>
                  )}
                </VStack>
              </>
            )}
          </VStack>

          <Divider />

          {/* Pricing */}
          <VStack spacing={2} align="stretch" bg="green.50" p={3} rounded="md">
            {product.allowBuying && (
              <HStack justify="space-between">
                <Text fontSize="sm" color="gray.700" fontWeight="500">
                  Selling Price
                </Text>
                <Text fontSize="lg" fontWeight="700" color="green.600">
                  ₱ {product.price.toLocaleString()}
                </Text>
              </HStack>
            )}

            {product.barterOnly && (
              <HStack>
                <Icon as={CheckCircleIcon} color="green.500" />
                <Text fontSize="sm" color="green.700" fontWeight="500">
                  Open to trades/barter
                </Text>
              </HStack>
            )}
          </VStack>
        </VStack>

        {/* Quality Checklist */}
        <VStack spacing={3} align="stretch" bg="blue.50" p={4} rounded="lg" borderWidth="1px" borderColor="blue.200">
          <Text fontWeight="600" fontSize="sm" color="blue.900">
            ✓ Quality Checklist
          </Text>

          <VStack spacing={2} align="start" fontSize="sm">
            <HStack>
              <Icon as={CheckCircleIcon} color="green.500" />
              <Text>Clear, well-lit product photos</Text>
            </HStack>

            <HStack>
              <Icon
                as={CheckCircleIcon}
                color={product.title.length >= 10 ? 'green.500' : 'gray.400'}
              />
              <Text>Descriptive title ({product.title.length}/60)</Text>
            </HStack>

            <HStack>
              <Icon
                as={CheckCircleIcon}
                color={product.description.length >= 20 ? 'green.500' : 'gray.400'}
              />
              <Text>Detailed description ({product.description.length}/500)</Text>
            </HStack>

            <HStack>
              <Icon
                as={CheckCircleIcon}
                color={product.allowBuying && product.price > 0 ? 'green.500' : 'gray.400'}
              />
              <Text>Pricing set</Text>
            </HStack>

            <HStack>
              <Icon as={CheckCircleIcon} color={product.location ? 'green.500' : 'gray.400'} />
              <Text>Location provided</Text>
            </HStack>
          </VStack>
        </VStack>

        {/* Terms & Conditions */}
        <Alert status="info" rounded="lg" flexDirection={['column', 'row']} gap={3}>
          <AlertIcon />
          <VStack align="start" spacing={2} flex={1}>
            <Text fontSize="sm" fontWeight="600">
              Before you post
            </Text>
            <Text fontSize="xs" color="gray.600">
              By posting this listing, you agree that all information is accurate and you have the right to sell this item. Ensure you follow all platform policies.
            </Text>
          </VStack>
        </Alert>

        {/* Agreement Checkbox */}
        <Box bg="white" p={4} rounded="lg" borderWidth="1px" borderColor="gray.200">
          <Checkbox
            isChecked={agreeTerms}
            onChange={(e) => setAgreeTerms(e.target.checked)}
            fontWeight="500"
            fontSize="sm"
          >
            I confirm all information is accurate and I agree to the listing terms
          </Checkbox>
        </Box>
      </VStack>

      {/* Success State (Loading) */}
      {isSubmitting && (
        <Box
          position="fixed"
          inset={0}
          bg="blackAlpha.600"
          display="flex"
          alignItems="center"
          justifyContent="center"
          zIndex={50}
        >
          <VStack spacing={4} bg="white" p={8} rounded="lg" shadow="xl">
            <Spinner size="lg" color="brand.500" thickness="4px" />
            <Text fontWeight="600" color="gray.800">
              Posting your product...
            </Text>
            <Text fontSize="sm" color="gray.600">
              Please wait, this may take a moment
            </Text>
          </VStack>
        </Box>
      )}

      {/* Bottom Navigation */}
      <Box
        position="fixed"
        bottom={0}
        left={0}
        right={0}
        bg="white"
        borderTopWidth="1px"
        borderColor="gray.200"
        p={4}
        maxW="container.md"
        mx="auto"
        w="full"
      >
        <VStack spacing={3} align="stretch">
          <HStack spacing={3}>
            <Button
              leftIcon={<ArrowBackIcon />}
              w="full"
              variant="ghost"
              onClick={onBack}
              isDisabled={isSubmitting || isLoading}
            >
              Back
            </Button>

            <Button
              rightIcon={<CheckCircleIcon />}
              colorScheme="green"
              w="full"
              onClick={handleSubmit}
              isLoading={isSubmitting || isLoading}
              isDisabled={!agreeTerms}
              size="lg"
            >
              Post Listing
            </Button>
          </HStack>

          {!agreeTerms && (
            <Text fontSize="xs" color="orange.600" textAlign="center">
              Please accept the terms to post your listing
            </Text>
          )}
        </VStack>
      </Box>
    </Box>
  )
}

export default ProductUploadStep3
