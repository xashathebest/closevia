import React, { useState, useCallback } from 'react'
import {
  Box,
  VStack,
  HStack,
  Text,
  Button,
  Input,
  Textarea,
  Select,
  FormControl,
  FormLabel,
  FormHelperText,
  Badge,
  Icon,
  Progress,
  useToast,
  Checkbox,
  InputGroup,
  InputLeftAddon,
  Grid,
  RadioGroup,
  Radio,
  SimpleGrid,
  Wrap,
  WrapItem,
  Spinner,
} from '@chakra-ui/react'
import { ArrowBackIcon, ArrowForwardIcon } from '@chakra-ui/icons'
import { FILTER_CATEGORIES } from '../utils/categories'

interface ProductDetails {
  title: string
  description: string
  price: number
  category: string
  condition: string
  location: string
  allowBuying: boolean
  barterOnly: boolean
  wants: string
  wanted_categories: string[] // List of desired categories
}

interface ProductUploadStep2Props {
  onNext: (details: ProductDetails) => void
  onBack: () => void
  initialData?: ProductDetails
  aiAnalysis?: {
    success: boolean
    provider: string
    retried: boolean
    time_ms: number
    data?: {
      title?: string
      description?: string
      condition?: string
      category?: string
      tags?: string[]
      estimated_value_min?: number
      estimated_value_max?: number
      authenticity_risks?: string[]
    }
  }
  isLoading?: boolean
}

const ProductUploadStep2: React.FC<ProductUploadStep2Props> = ({
  onNext,
  onBack,
  initialData,
  aiAnalysis,
  isLoading = false,
}) => {
  const [details, setDetails] = useState<ProductDetails>(
    initialData || {
      title: '',
      description: '',
      price: 0,
      category: 'General',
      condition: 'Used',
      location: '',
      allowBuying: true,
      barterOnly: false,
      wants: '',
      wanted_categories: [],
    }
  )
  const [isDetectingLocation, setIsDetectingLocation] = useState(false)
  const toast = useToast()

  const conditions = ['New', 'Like New', 'Good', 'Used', 'For Parts']

  const handleChange = (field: keyof ProductDetails, value: any) => {
    setDetails((prev) => ({
      ...prev,
      [field]: value,
    }))
  }

  // Location Detection
  const detectLocation = useCallback(() => {
    if (!navigator.geolocation) {
      toast({
        id: 'location-not-supported',
        title: 'Geolocation not available',
        description: 'Your browser does not support location detection',
        status: 'warning',
        duration: 3000,
      })
      return
    }
    setIsDetectingLocation(true)
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&zoom=18&addressdetails=1&lat=${latitude}&lon=${longitude}`
          )
          const data = await res.json()
          const addr = data.address || {}
          // Build address: barangay + city (like "Santo Niño, Zamboanga City")
          const barangay = addr.hamlet || addr.village || addr.suburb || addr.neighborhood || addr.quarter || ''
          const city = addr.city || addr.town || addr.municipality || ''
          const parts = [barangay, city].filter(Boolean)
          const address = parts.join(', ') || 'Current location detected'
          setDetails((prev) => ({ ...prev, location: address }))
          toast({
            id: 'location-detected',
            title: 'Location detected',
            description: address,
            status: 'success',
            duration: 2000,
          })
        } catch {
          const fallback = 'Current location detected'
          setDetails((prev) => ({ ...prev, location: fallback }))
          toast({
            id: 'location-fallback',
            title: 'Location detected',
            description: fallback,
            status: 'success',
            duration: 2000,
          })
        }
        setIsDetectingLocation(false)
      },
      () => {
        setIsDetectingLocation(false)
        toast({
          id: 'location-denied',
          title: 'Permission denied',
          description: 'Please enable location access to auto-detect your location',
          status: 'warning',
          duration: 3000,
        })
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
    )
  }, [toast])

  const handleNext = () => {
    // Validation
    if (!details.title.trim()) {
      toast({
        id: "productuploadstep2-title-required",
        title: 'Title required',
        description: 'Please enter a product title',
        status: 'error',
        duration: 3,
        isClosable: true,
      })
      return
    }

    if (!details.description.trim()) {
      toast({
        id: "productuploadstep2-description-required",
        title: 'Description required',
        description: 'Please describe your product',
        status: 'error',
        duration: 3,
        isClosable: true,
      })
      return
    }

    if (details.price <= 0 && details.allowBuying) {
      toast({
        id: "productuploadstep2-invalid-price",
        title: 'Invalid price',
        description: 'Please enter a valid price',
        status: 'error',
        duration: 3,
        isClosable: true,
      })
      return
    }

    onNext(details)
  }

  return (
    <Box w="full" minH="100vh" bg="gray.50" pb={24}>
      {/* Progress Indicator */}
      <Box bg="white" borderBottomWidth="1px" borderColor="gray.200" position="sticky" top={0} zIndex={10}>
        <VStack spacing={0} maxW="container.md" mx="auto" p={{ base: 4, md: 6 }}>
          <HStack w="full" justify="space-between" mb={4}>
            <Text fontSize="sm" fontWeight="600" color="gray.600">
              Step 2 of 3
            </Text>
            <Text fontSize="sm" color="gray.500">
              Details & Preferences
            </Text>
          </HStack>

          <Progress value={66} size="sm" w="full" colorScheme="brand" rounded="full" hasStripe />
        </VStack>
      </Box>

      {/* Main Content */}
      <VStack spacing={6} maxW="container.md" mx="auto" p={{ base: 4, md: 6 }} align="stretch">
        {/* AI Analysis Info */}
        {aiAnalysis?.success && (
          <Box bg="blue.50" border="1px" borderColor="blue.200" rounded="lg" p={3}>
            <HStack spacing={2} justify="space-between" wrap="wrap">
              <HStack spacing={2}>
                <Text fontSize="sm" fontWeight="600" color="blue.700">
                  ✨ {aiAnalysis.provider.charAt(0).toUpperCase() + aiAnalysis.provider.slice(1)} Analysis
                </Text>
                {aiAnalysis.retried && (
                  <Badge colorScheme="orange" fontSize="xs">
                    Backup AI
                  </Badge>
                )}
              </HStack>
              <Text fontSize="xs" color="blue.600">
                {aiAnalysis.time_ms}ms
              </Text>
            </HStack>
            {aiAnalysis.data?.authenticity_risks && aiAnalysis.data.authenticity_risks.length > 0 && (
              <Text fontSize="xs" color="orange.700" mt={2}>
                ⚠️ Note: {aiAnalysis.data.authenticity_risks.join(', ')}
              </Text>
            )}
          </Box>
        )}

        {/* Title */}
        <FormControl isRequired>
          <FormLabel fontWeight="600">Product Title</FormLabel>
          <Input
            placeholder="e.g., Nike Air Force 1 White Sneakers"
            value={details.title}
            onChange={(e) => handleChange('title', e.target.value)}
            maxLength={60}
            size="lg"
          />
          <FormHelperText color={details.title.length > 50 ? 'orange.500' : 'gray.500'}>
            {details.title.length}/60 characters
          </FormHelperText>
        </FormControl>

        {/* Description */}
        <FormControl isRequired>
          <FormLabel fontWeight="600">Description</FormLabel>
          <Textarea
            placeholder="Describe your product: condition, features, any defects..."
            value={details.description}
            onChange={(e) => handleChange('description', e.target.value)}
            maxLength={500}
            minH="120px"
            size="md"
          />
          <FormHelperText color={details.description.length > 450 ? 'orange.500' : 'gray.500'}>
            {details.description.length}/500 characters
          </FormHelperText>
        </FormControl>

        {/* Category & Condition */}
        <Grid templateColumns={{ base: '1fr', md: '1fr 1fr' }} gap={4}>
          <FormControl isRequired>
            <FormLabel fontWeight="600">Category</FormLabel>
            <Select
              value={details.category}
              onChange={(e) => handleChange('category', e.target.value)}
              size="lg"
            >
              {FILTER_CATEGORIES.map((cat) => (
                <option key={typeof cat === 'string' ? cat : cat.value} value={typeof cat === 'string' ? cat : cat.value}>
                  {typeof cat === 'string' ? cat : cat.label}
                </option>
              ))}
            </Select>
          </FormControl>

          <FormControl isRequired>
            <FormLabel fontWeight="600">Condition</FormLabel>
            <Select
              value={details.condition}
              onChange={(e) => handleChange('condition', e.target.value)}
              size="lg"
            >
              {conditions.map((cond) => (
                <option key={cond} value={cond}>
                  {cond}
                </option>
              ))}
            </Select>
          </FormControl>
        </Grid>

        {/* Location */}
        <FormControl>
          <FormLabel fontWeight="600">Location</FormLabel>
          <HStack spacing={2} align="flex-end">
            <VStack spacing={0} flex={1} align="stretch">
              <Input
                placeholder="e.g., Santo Niño, Zamboanga City"
                value={details.location}
                onChange={(e) => handleChange('location', e.target.value)}
                size="lg"
              />
              <FormHelperText>Used to calculate distance for nearby users</FormHelperText>
            </VStack>
            <Button
              size="lg"
              variant="outline"
              colorScheme="blue"
              onClick={detectLocation}
              isLoading={isDetectingLocation}
              loadingText="Detecting..."
              isDisabled={isDetectingLocation}
              whiteSpace="nowrap"
              h="44px"
            >
              📍 Detect
            </Button>
          </HStack>
        </FormControl>

        {/* Pricing Section */}
        <VStack spacing={3} align="stretch" bg="green.50" p={4} rounded="lg" borderWidth="1px" borderColor="green.200">
          <HStack justify="space-between">
            <Text fontWeight="600" color="gray.900">
              Selling Options
            </Text>
            <Badge colorScheme="green" fontSize="xs">
              Recommended
            </Badge>
          </HStack>

          {/* Allow Buying */}
          <FormControl display="flex" alignItems="center">
            <Checkbox
              isChecked={details.allowBuying}
              onChange={(e) => handleChange('allowBuying', e.target.checked)}
              mr={3}
            />
            <FormLabel mb={0} cursor="pointer" fontWeight="500">
              Allow direct purchase (buying)
            </FormLabel>
          </FormControl>

          {/* Price Input */}
          {details.allowBuying && (
            <InputGroup size="lg">
              <InputLeftAddon fontWeight="600" bg="green.100">
                ₱
              </InputLeftAddon>
              <Input
                type="number"
                placeholder="Enter price"
                value={details.price || ''}
                onChange={(e) => handleChange('price', parseFloat(e.target.value) || 0)}
                min={0}
              />
            </InputGroup>
          )}

          {/* Barter Only */}
          <FormControl display="flex" alignItems="center" pt={2} borderTopWidth="1px" borderColor="green.200">
            <Checkbox
              isChecked={details.barterOnly}
              onChange={(e) => handleChange('barterOnly', e.target.checked)}
              mr={3}
            />
            <FormLabel mb={0} cursor="pointer" fontWeight="500">
              Open to trading/bartering only
            </FormLabel>
          </FormControl>

          {details.barterOnly && (
            <Text fontSize="xs" color="gray.600" bg="white" p={2} rounded="sm">
              ✓ Your product will be available for trade offers. Price is optional for reference only.
            </Text>
          )}

          {/* New Desired Exchange Section */}
          <Box pt={4} borderTopWidth="1px" borderColor="green.200">
            <FormLabel fontWeight="600" mb={2}>What are you looking for? (Optional)</FormLabel>
            
            <VStack spacing={4} align="stretch">
              <FormControl>
                <FormLabel fontSize="sm" color="gray.600">Desired Item Categories</FormLabel>
                <SimpleGrid columns={{ base: 2, sm: 3 }} spacing={2}>
                  {FILTER_CATEGORIES.filter(c => (typeof c === 'string' ? c : c.value) !== 'All').map((cat) => {
                    const value = typeof cat === 'string' ? cat : cat.value
                    const label = typeof cat === 'string' ? cat : cat.label
                    const isSelected = details.wanted_categories.includes(value)
                    const hasReachedWantedLimit = !isSelected && details.wanted_categories.length >= 3
                    
                    return (
                      <Button
                        key={value}
                        size="xs"
                        variant={isSelected ? 'solid' : 'outline'}
                        colorScheme={isSelected ? 'brand' : 'gray'}
                        isDisabled={hasReachedWantedLimit}
                        onClick={() => {
                          if (!isSelected && details.wanted_categories.length >= 3) return
                          const next = isSelected 
                            ? details.wanted_categories.filter(v => v !== value)
                            : [...details.wanted_categories, value]
                          handleChange('wanted_categories', next)
                        }}
                        rounded="full"
                      >
                        {label}
                      </Button>
                    )
                  })}
                </SimpleGrid>
                <FormHelperText fontSize="2xs">Choose up to 3.</FormHelperText>
              </FormControl>

              <FormControl>
                <FormLabel fontSize="sm" color="gray.600" mb={2} fontWeight="600">Preferred Items (Optional)</FormLabel>
                <Input
                  placeholder="e.g. Any smartphone, mechanical keyboard, etc."
                  value={details.wants}
                  onChange={(e) => handleChange('wants', e.target.value)}
                  size="sm"
                  bg="white"
                />
                {details.wants === '' && (
                  <HStack spacing={1.5} mt={1.5}>
                    <Button
                      size="xs"
                      variant="ghost"
                      colorScheme="gray"
                      fontSize="10px"
                      fontWeight="500"
                      h="20px"
                      px={2}
                      onClick={() => handleChange('wants', 'Any')}
                      _hover={{ color: 'brand.600' }}
                    >
                      Any
                    </Button>
                  </HStack>
                )}
              </FormControl>
            </VStack>
          </Box>
        </VStack>

        {/* AI Suggestions (if available) */}
        <Box bg="blue.50" p={4} rounded="lg" borderWidth="1px" borderColor="blue.200">
          <Text fontSize="sm" fontWeight="600" color="blue.900" mb={2}>
            💡 AI Suggestions
          </Text>
          <VStack align="start" spacing={1} fontSize="sm" color="blue.800">
            <Text>✓ Great description - other users will appreciate the detail</Text>
            <Text>✓ Consider adding condition details for higher trustworthiness</Text>
            <Text>✓ Pricing looks competitive for this category</Text>
          </VStack>
        </Box>
      </VStack>

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
        <HStack spacing={3}>
          <Button
            leftIcon={<ArrowBackIcon />}
            w="full"
            variant="ghost"
            onClick={onBack}
            isDisabled={isLoading}
          >
            Back
          </Button>

          <Button
            rightIcon={<ArrowForwardIcon />}
            colorScheme="brand"
            w="full"
            onClick={handleNext}
            isLoading={isLoading}
          >
            Review
          </Button>
        </HStack>
      </Box>
    </Box>
  )
}

export default ProductUploadStep2
