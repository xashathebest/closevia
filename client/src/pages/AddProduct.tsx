import React, { useState, useCallback, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Box,
  VStack,
  HStack,
  Heading,
  Text,
  Button,
  Input,
  Textarea,
  Switch,
  FormControl,
  FormLabel,
  FormHelperText,
  useToast,
  Progress,
  IconButton,
  Image,
  SimpleGrid,
  Center,
  useColorModeValue,
  Badge,
  Select,
  useDisclosure,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalCloseButton,
  Spinner,
} from '@chakra-ui/react'
import { AddIcon, CloseIcon, ArrowForwardIcon, ArrowBackIcon, WarningIcon } from '@chakra-ui/icons'
import { useAuth } from '../contexts/AuthContext'
import { useProducts } from '../contexts/ProductContext'
import { ProductCreate } from '../types'


const AddProduct: React.FC = () => {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { createProduct } = useProducts()
  const toast = useToast()
  
  const [currentStep, setCurrentStep] = useState(1)
  const [formData, setFormData] = useState<ProductCreate>({
    title: '',
    description: '',
    price: 0, 
    image_urls: [],
    premium: false,
    allow_buying: false,
    barter_only: true,
    location: '',
    condition: 'Used',
    category: 'General',
  })
  
  const [uploadedImages, setUploadedImages] = useState<File[]>([])
  const [imagePreviewUrls, setImagePreviewUrls] = useState<string[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [descriptionLength, setDescriptionLength] = useState(0)
  const [titleLength, setTitleLength] = useState(0)
  const [locationCoordinates, setLocationCoordinates] = useState<{ lat: number; lng: number } | null>(null)
  const [isGettingLocation, setIsGettingLocation] = useState(true)
  const [locationError, setLocationError] = useState<string | null>(null)
  const { isOpen: isPremiumModalOpen, onOpen: onOpenPremiumModal, onClose: onClosePremiumModal } = useDisclosure()
  const { isOpen: isLocationModalOpen, onOpen: onOpenLocationModal, onClose: onCloseLocationModal } = useDisclosure()

  const bgColor = useColorModeValue('white', 'gray.800')
  const borderColor = useColorModeValue('gray.200', 'gray.700')
  // page background color (applies to entire viewport)
  const pageBg = '#FFFDF1'

  const steps = [
    { number: 1, title: 'Upload Photos', description: 'Add product images' },
    { number: 2, title: 'Basic Info', description: 'Title and description' },
    { number: 3, title: 'Barter Options', description: 'Set exchange preferences' },
    { number: 4, title: 'Price (Optional)', description: 'If buying is allowed' },
    { number: 5, title: 'Review & Post', description: 'Confirm and publish' },
  ]

  const handleImageUpload = useCallback((files: FileList | null) => {
    if (!files) return
    
    let newFiles = Array.from(files)
    const validFiles = newFiles.filter(file => file.type.startsWith('image/'))
    
    if (validFiles.length === 0) {
      toast({
        title: 'Invalid file type',
        description: 'Please select only image files',
        status: 'error',
        duration: 3000,
        isClosable: true,
      })
      return
    }

    // Enforce a maximum of 8 images overall
    setUploadedImages(prev => {
      const remainingSlots = Math.max(0, 8 - prev.length)
      const filesToAdd = validFiles.slice(0, remainingSlots)
      if (filesToAdd.length < validFiles.length) {
        toast({
          title: 'Image limit reached',
          description: 'You can upload up to 8 images per product.',
          status: 'warning',
          duration: 3000,
          isClosable: true,
        })
      }
      // Create preview URLs for the files we actually accept
      filesToAdd.forEach(file => {
        const reader = new FileReader()
        reader.onload = (e) => {
          setImagePreviewUrls(prevUrls => [...prevUrls, e.target?.result as string])
        }
        reader.readAsDataURL(file)
      })
      return [...prev, ...filesToAdd]
    })
  }, [toast])

  const removeImage = (index: number) => {
    setUploadedImages(prev => prev.filter((_, i) => i !== index))
    setImagePreviewUrls(prev => prev.filter((_, i) => i !== index))
  }

  const handleInputChange = (field: keyof ProductCreate, value: any) => {
    if (field === 'title') {
      const length = value?.length || 0
      if (length > 15) {
        toast({
          title: 'Title too long',
          description: `Maximum 15 characters allowed (currently ${length})`,
          status: 'warning',
          duration: 2000,
          isClosable: true,
        })
        return
      }
      setTitleLength(length)
    }
    if (field === 'description') {
      const length = value?.length || 0
      if (length > 800) {
        toast({
          title: 'Description too long',
          description: `Maximum 800 characters allowed (currently ${length})`,
          status: 'warning',
          duration: 2000,
          isClosable: true,
        })
        return
      }
      setDescriptionLength(length)
    }
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  const handleGetCurrentLocation = useCallback(() => {
    setIsGettingLocation(true)
    setLocationError(null)
    
    if (!navigator.geolocation) {
      setLocationError('Geolocation is not supported by your browser')
      setIsGettingLocation(false)
      return
    }

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const { latitude, longitude } = position.coords
        setLocationCoordinates({ lat: latitude, lng: longitude })
        
        // Reverse geocode to get full address
        try {
          const response = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`
          )
          const data = await response.json()
          const address = data.address || {}
          
          // Build full address: purok, barangay, city, municipality
          const purok = address.hamlet || address.village || ''
          const barangay = address.suburb || address.neighborhood || ''
          const city = address.city || address.town || ''
          const municipality = address.county || ''
          
          const addressParts = [purok, barangay, city, municipality].filter(Boolean)
          const fullAddress = addressParts.join(', ') || `Location ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`
          
          handleInputChange('location', fullAddress)
        } catch (error) {
          handleInputChange('location', `Location ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`)
        }
        
        setIsGettingLocation(false)
      },
      (error) => {
        let errorMessage = 'Unable to retrieve your location'
        if (error.code === error.PERMISSION_DENIED) {
          errorMessage = 'Location permission denied. Please enable it in your browser settings.'
        } else if (error.code === error.POSITION_UNAVAILABLE) {
          errorMessage = 'Location information is unavailable.'
        } else if (error.code === error.TIMEOUT) {
          errorMessage = 'The request to get user location timed out.'
        }
        setLocationError(errorMessage)
        setIsGettingLocation(false)
      }
    )
  }, [])

  // Auto-load location on component mount
  useEffect(() => {
    handleGetCurrentLocation()
  }, [handleGetCurrentLocation])

  const nextStep = () => {
    if (currentStep < steps.length) {
      setCurrentStep(currentStep + 1)
    }
  }

  const prevStep = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1)
    }
  }

  const handleSubmit = async () => {
    // Validation before submission
    if (!formData.title.trim()) {
      toast({
        title: 'Missing title',
        description: 'Please enter a product title',
        status: 'warning',
        duration: 3000,
        isClosable: true,
      })
      return
    }
    
    if (!formData.description.trim()) {
      toast({
        title: 'Missing description',
        description: 'Please enter a product description',
        status: 'warning',
        duration: 3000,
        isClosable: true,
      })
      return
    }
    
    if (formData.description.trim().length < 50) {
      toast({
        title: 'Description too short',
        description: 'Please enter at least 50 characters in the description',
        status: 'warning',
        duration: 3000,
        isClosable: true,
      })
      return
    }
    
    if (uploadedImages.length === 0) {
      toast({
        title: 'No images',
        description: 'Please upload at least one product image',
        status: 'warning',
        duration: 3000,
        isClosable: true,
      })
      return
    }

    if (formData.allow_buying && (!formData.price || formData.price <= 0)) {
      toast({
        title: 'Invalid price',
        description: 'Please enter a valid price if buying is allowed',
        status: 'warning',
        duration: 3000,
        isClosable: true,
      })
      return
    }

    // Validate file sizes (5MB per image)
    const MAX_FILE_SIZE = 5 * 1024 * 1024 // 5MB
    for (const file of uploadedImages) {
      if (file.size > MAX_FILE_SIZE) {
        toast({
          title: 'File too large',
          description: `${file.name} exceeds 5MB limit`,
          status: 'error',
          duration: 3000,
          isClosable: true,
        })
        return
      }
    }
    
    setIsSubmitting(true)
    
    try {
      const formDataToSend = new FormData()
      
      // Append fields in exact order backend expects
      formDataToSend.append('title', formData.title.trim())
      formDataToSend.append('description', formData.description.trim())
      formDataToSend.append('price', String(formData.price || 0))
      formDataToSend.append('premium', formData.premium ? '1' : '0')
      formDataToSend.append('allow_buying', formData.allow_buying ? '1' : '0')
      formDataToSend.append('barter_only', formData.barter_only ? '1' : '0')
      formDataToSend.append('location', formData.location?.trim() || '')
      formDataToSend.append('condition', formData.condition || 'Used')
      formDataToSend.append('category', formData.category || 'General')
      
      // Append each image file
      uploadedImages.forEach((file) => {
        formDataToSend.append('images', file)
      })

      // Log what we're sending
      console.log('=== FORM DATA CONTENTS ===')
      for (let [key, value] of formDataToSend.entries()) {
        if (value instanceof File) {
          console.log(`${key}: File - ${value.name} (${value.size} bytes, ${value.type})`)
        } else {
          console.log(`${key}: ${value}`)
        }
      }
      console.log('========================')
      
      const response = await createProduct(formDataToSend)
      console.log('Product created successfully:', response)
      
      toast({
        title: 'Product created!',
        description: 'Your product has been successfully posted',
        status: 'success',
        duration: 3000,
        isClosable: true,
      })
      
      navigate('/dashboard')
    } catch (error: any) {
      console.error('=== PRODUCT CREATION ERROR ===')
      console.error('HTTP Status:', error.response?.status)
      console.error('Backend Response:', error.response?.data)
      console.error('Backend Message:', error.response?.data?.error || error.response?.data?.message)
      console.error('Request URL:', error.config?.url)
      console.error('Request Headers:', error.config?.headers)
      console.error('Full Error:', error.message)
      console.error('=============================')
      
      const errorMessage = 
        error.response?.data?.details ||
        error.response?.data?.message || 
        error.response?.data?.error || 
        error.message ||
        'Failed to create product. Please check the browser console for details.'
      
      toast({
        title: 'Error creating product',
        description: errorMessage,
        status: 'error',
        duration: 6000,
        isClosable: true,
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const canProceed = () => {
    switch (currentStep) {
      case 1: return uploadedImages.length >= 3
      case 2: return formData.title.trim() && formData.description.trim() && titleLength > 0 && titleLength <= 15 && descriptionLength >= 50 && descriptionLength <= 500
      case 3: return true // Barter options are always valid
      case 4: return !formData.allow_buying || (formData.allow_buying && formData.price && formData.price > 0)
      case 5: return true
      default: return false
    }
  }

  const renderStepContent = () => {
    switch (currentStep) {
      case 1:
        return (
          <VStack spacing={6} align="stretch">
            <Text fontSize="lg" color="gray.600">
              Upload at least 3 photos of your product. First image will be the cover.
            </Text>
            
            {/* Drag & Drop Area */}
            <Box
              border="2px dashed"
              borderColor={borderColor}
              borderRadius="lg"
              p={8}
              textAlign="center"
              cursor="pointer"
              _hover={{ borderColor: 'brand.500' }}
              onClick={() => document.getElementById('image-upload')?.click()}
              
            >
              <VStack spacing={4}>
                <AddIcon boxSize={8} color="gray.400" />
                <Text fontSize="lg" color="gray.600">
                  Click to upload images or drag and drop
                </Text>
                <Text fontSize="sm" color="gray.500">
                  PNG, JPG up to 5MB each (minimum 3 images required)
                </Text>
              </VStack>
            </Box>
            
            <input
              id="image-upload"
              type="file"
              multiple
              accept="image/*"
              onChange={(e) => handleImageUpload(e.target.files)}
              style={{ display: 'none' }}
            />
            
            {/* Image Count Status */}
            <Box>
              <HStack justify="space-between" mb={3}>
                <Text fontWeight="semibold" color="gray.700">
                  Images uploaded: {uploadedImages.length}/8
                </Text>
                {uploadedImages.length === 0 && (
                  <Badge colorScheme="orange">
                    Need {3 - uploadedImages.length} more image(s)
                  </Badge>
                )}
                {uploadedImages.length >= 3 && (
                  <Badge colorScheme="green">
                    Ready to proceed
                  </Badge>
                )}
              </HStack>
            </Box>
            
            {/* Image Previews */}
            {uploadedImages.length > 0 && (
              <SimpleGrid columns={{ base: 3, md: 4 }} spacing={2}>
                {uploadedImages.map((_, index) => (
                  <Box key={index} position="relative" aspectRatio="1">
                    <Image
                      src={imagePreviewUrls[index]}
                      alt={`Preview ${index + 1}`}
                      borderRadius="md"
                      objectFit="cover"
                      w="full"
                      h="full"
                    />
                    <IconButton
                      icon={<CloseIcon />}
                      aria-label="Remove image"
                      size="xs"
                      position="absolute"
                      top={1}
                      right={1}
                      colorScheme="red"
                      onClick={() => removeImage(index)}
                    />
                  </Box>
                ))}
              </SimpleGrid>
            )}
          </VStack>
        )
        
      case 2:
        return (
          <VStack spacing={6} align="stretch">
            <FormControl isRequired>
              <HStack justify="space-between" align="center">
                <FormLabel mb={0}>Product Title</FormLabel>
                <Button
                  size="xs"
                  variant="outline"
                  colorScheme="purple"
                  mb="2"
                  title="Generate title from description"
                  onClick={() => {
                    if (!user?.is_premium) {
                      onOpenPremiumModal()
                    } else {
                      // TODO: Add auto-generate logic here for premium users
                    }
                  }}
                >
                  ✨ Auto Generate
                </Button>
              </HStack>
              <Input
                placeholder="e.g., iPhone 13 Pro"
                value={formData.title}
                onChange={(e) => handleInputChange('title', e.target.value)}
                size="lg"
                maxLength={15}
              />
              <HStack justify="space-between" mt={1}>
                <FormHelperText>Be specific (max 15 chars)</FormHelperText>
                <Badge
                  colorScheme={titleLength === 0 ? 'gray' : titleLength <= 15 ? 'green' : 'orange'}
                  fontSize="xs"
                >
                  {titleLength}/15
                </Badge>
              </HStack>
            </FormControl>
            
            <FormControl isRequired>
              <FormLabel>
                <HStack justify="space-between" w="full">
                  <Text>Description</Text>
                  <Badge
                    colorScheme={
                      descriptionLength < 50 ? 'red' :
                      descriptionLength <= 500 ? 'green' : 'orange'
                    }
                    fontSize="xs"
                  >
                    {descriptionLength}/500 chars
                  </Badge>
                </HStack>
              </FormLabel>
              <Textarea
                placeholder="Describe your product in detail..."
                value={formData.description}
                onChange={(e) => {
                  handleInputChange('description', e.target.value)
                }}
                rows={6}
                size="lg"
                borderColor={
                  descriptionLength < 50 ? 'red.300' :
                  descriptionLength <= 500 ? 'green.300' : 'orange.300'
                }
                _focus={{
                  borderColor:
                    descriptionLength < 50 ? 'red.500' :
                    descriptionLength <= 500 ? 'green.500' : 'orange.500',
                }}
              />
              <Box
                mt={2}
                p={2}
                bg={
                  descriptionLength < 50 ? 'red.50' :
                  descriptionLength <= 500 ? 'green.50' : 'orange.50'
                }
                borderRadius="md"
                borderLeftWidth="4px"
                borderLeftColor={
                  descriptionLength < 50 ? 'red.400' :
                  descriptionLength <= 500 ? 'green.400' : 'orange.400'
                }
              >
                <Text fontSize="sm" color="gray.700">
                  {descriptionLength < 50
                    ? `⚠️ Add at least ${50 - descriptionLength} more characters (minimum 50)`
                    : descriptionLength <= 500
                    ? `✓ Perfect length! ${descriptionLength} characters`
                    : `❌ Description exceeds limit by ${descriptionLength - 500} characters`
                  }
                </Text>
              </Box>
            </FormControl>
            
            <FormControl isRequired>
              <FormLabel>Condition</FormLabel>
              <Select
                placeholder="Select condition"
                value={formData.condition}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => handleInputChange('condition', e.target.value)}
                size="lg"
              >
                <option value="New">New</option>
                <option value="Like-New">Like-New</option>
                <option value="Used">Used</option>
                <option value="Fair">Fair</option>
              </Select>
            </FormControl>

            <FormControl>
              <FormLabel>Category</FormLabel>
              <Select
                placeholder="Select category"
                value={formData.category}
                onChange={(e: React.ChangeEvent<HTMLSelectElement>) => handleInputChange('category', e.target.value)}
                size="lg"
              >
                <option value="General">General</option>
                <option value="Electronics">Electronics</option>
                <option value="Mobile Phones">Mobile Phones</option>
                <option value="Computers">Computers</option>
                <option value="Home Appliances">Home Appliances</option>
                <option value="Fashion">Fashion</option>
                <option value="Collectibles">Collectibles</option>
                <option value="Sports">Sports</option>
                <option value="Toys">Toys</option>
                <option value="Books">Books</option>
                <option value="Automotive">Automotive</option>
                <option value="Other">Other</option>
              </Select>
            </FormControl>

            <FormControl>
              <FormLabel>Location</FormLabel>
              <VStack spacing={2}>
                {!locationCoordinates ? (
                  <Box 
                    p={3} 
                    bg="yellow.50" 
                    borderRadius="md" 
                    w="full"
                    borderLeft="3px solid"
                    borderLeftColor="yellow.400"
                  >
                    <HStack spacing={2}>
                      <Spinner size="sm" color="yellow.600" />
                      <Text fontSize="sm" color="yellow.800">
                        Detecting your location...
                      </Text>
                    </HStack>
                  </Box>
                ) : (
                  <>
                    <Box 
                      p={3} 
                      bg="green.50" 
                      borderRadius="md" 
                      w="full"
                      borderLeft="3px solid"
                      borderLeftColor="green.400"
                    >
                      <Text fontSize="sm" color="green.800" fontWeight="semibold" mb={1}>
                        ✓ Location Detected
                      </Text>
                      <Text fontSize="sm" color="gray.700">
                        {formData.location}
                      </Text>
                    </Box>
                    <Button
                      variant="outline"
                      w="full"
                      size="sm"
                      onClick={() => {
                        setLocationCoordinates(null)
                        setLocationError(null)
                        handleInputChange('location', '')
                        handleGetCurrentLocation()
                      }}
                    >
                      Detect Location Again
                    </Button>
                  </>
                )}
                {locationError && (
                  <Box 
                    p={2} 
                    bg="red.50" 
                    borderRadius="md" 
                    w="full"
                    borderLeft="3px solid"
                    borderLeftColor="red.400"
                  >
                    <HStack spacing={2}>
                      <WarningIcon color="red.600" boxSize={3} />
                      <Text fontSize="xs" color="red.700">
                        {locationError}
                      </Text>
                    </HStack>
                  </Box>
                )}
                <FormHelperText fontSize="xs">
                  Location is required. Your location will be automatically detected via GPS.
                </FormHelperText>
              </VStack>
            </FormControl>
          </VStack>
        )
        
      case 3:
        return (
          <VStack spacing={8} align="stretch">
            <Box>
              <Heading size="sm" mb={2} color="gray.700">
                Exchange Preferences
              </Heading>
              <Text fontSize="sm" color="gray.500">
                Choose how you'd like to exchange your product
              </Text>
            </Box>

            {/* Barter Only - Available to All */}
            <Box 
              p={5} 
              bg="blue.50" 
              borderRadius="lg" 
              borderLeft="4px solid" 
              borderLeftColor="blue.400"
            >
              <FormControl>
                <HStack justify="space-between" align="start">
                  <VStack align="start" spacing={1} flex={1}>
                    <FormLabel m={0} fontWeight="semibold" color="gray.800">
                      Barter Only
                    </FormLabel>
                    <Text fontSize="sm" color="gray.600">
                      Accept item exchanges and barter. 
                    </Text>
                    <Badge colorScheme="blue" variant="subtle" fontSize="xs" mt={2}>
                      Available to All Users
                    </Badge>
                  </VStack>
                  <Switch
                    isChecked={formData.barter_only}
                    onChange={(e) => handleInputChange('barter_only', e.target.checked)}
                    colorScheme="blue"
                  />
                </HStack>
              </FormControl>
            </Box>

            {/* Premium Features Section */}
            <Box>
              <Heading size="sm" mb={3} color="gray.700">
                Premium Features
              </Heading>
              
              {!user?.is_premium && (
                <Box 
                  p={4} 
                  bg="orange.50" 
                  borderRadius="lg" 
                  borderLeft="4px solid" 
                  borderLeftColor="orange.400"
                  mb={4}
                  cursor="pointer"
                  _hover={{ bg: "orange.100", transform: "translateY(-2px)" }}
                  transition="all 0.2s ease"
                  onClick={onOpenPremiumModal}
                >
                  <HStack spacing={2}>
                    <Box fontSize="lg">⭐</Box>
                    <VStack align="start" spacing={0} flex={1}>
                      <Text fontWeight="semibold" color="orange.900" fontSize="sm">
                        Upgrade to Premium
                      </Text>
                      <Text fontSize="xs" color="orange.800">
                        Unlock premium listing and buying features to reach more buyers
                      </Text>
                    </VStack>
                    <Box fontSize="lg" color="orange.600">→</Box>
                  </HStack>
                </Box>
              )}

              {/* Premium Listing */}
              <Box 
                p={5} 
                bg={user?.is_premium ? "yellow.50" : "gray.50"}
                borderRadius="lg" 
                borderLeft="4px solid" 
                borderLeftColor={user?.is_premium ? "yellow.400" : "gray.300"}
                opacity={user?.is_premium ? 1 : 0.6}
                mb={3}
              >
                <FormControl isDisabled={!user?.is_premium}>
                  <HStack justify="space-between" align="start">
                    <VStack align="start" spacing={1} flex={1}>
                      <HStack spacing={2}>
                        <FormLabel m={0} fontWeight="semibold" color="gray.800">
                          Premium Listing
                        </FormLabel>
                        <Badge colorScheme="yellow" variant="solid" fontSize="xs">
                          ⭐ Premium
                        </Badge>
                      </HStack>
                      <Text fontSize="sm" color={user?.is_premium ? "gray.600" : "gray.500"}>
                        {user?.is_premium 
                          ? 'Feature your product at the top of search results for maximum visibility'
                          : 'Feature your product at the top of search results'
                        }
                      </Text>
                      {user?.is_premium && (
                        <Badge colorScheme="purple" variant="subtle" fontSize="xs" mt={2}>
                          Up to 20 premium listings
                        </Badge>
                      )}
                    </VStack>
                    <Switch
                      isChecked={formData.premium}
                      onChange={(e) => handleInputChange('premium', e.target.checked)}
                      colorScheme="yellow"
                      isDisabled={!user?.is_premium}
                    />
                  </HStack>
                </FormControl>
              </Box>

              {/* Allow Buying */}
              <Box 
                p={5} 
                bg={user?.is_premium ? "green.50" : "gray.50"}
                borderRadius="lg" 
                borderLeft="4px solid" 
                borderLeftColor={user?.is_premium ? "green.400" : "gray.300"}
                opacity={user?.is_premium ? 1 : 0.6}
              >
                <FormControl isDisabled={!user?.is_premium}>
                  <HStack justify="space-between" align="start">
                    <VStack align="start" spacing={1} flex={1}>
                      <HStack spacing={2}>
                        <FormLabel m={0} fontWeight="semibold" color="gray.800">
                          Allow Buying
                        </FormLabel>
                        <Badge colorScheme="green" variant="solid" fontSize="xs">
                          💰 Premium
                        </Badge>
                      </HStack>
                      <Text fontSize="sm" color={user?.is_premium ? "gray.600" : "gray.500"}>
                        {user?.is_premium
                          ? 'Accept cash only offers'
                          : 'Accept cash only offers'
                        }
                      </Text>
                      {user?.is_premium && (
                        <Badge colorScheme="purple" variant="subtle" fontSize="xs" mt={2}>
                          Accept both barter & cash transactions
                        </Badge>
                      )}
                    </VStack>
                    <Switch
                      isChecked={formData.allow_buying}
                      onChange={(e) => {
                        handleInputChange('allow_buying', e.target.checked)
                        if (!e.target.checked) {
                          handleInputChange('price', undefined)
                        }
                      }}
                      colorScheme="green"
                      isDisabled={!user?.is_premium}
                    />
                  </HStack>
                </FormControl>
              </Box>
            </Box>
          </VStack>
        )
        
      case 4:
        return (
          <VStack spacing={6} align="stretch">
            {formData.allow_buying ? (
              <FormControl isRequired>
                <FormLabel>Price (PHP)</FormLabel>
                <Input
                  type="number"
                  placeholder="0.00"
                  value={formData.price || ''}
                  onChange={(e) => handleInputChange('price', e.target.value ? Number(e.target.value) : 0)}
                  size="lg"
                  min="0"
                  step="0.01"
                />
                <FormHelperText>Set a fair price for your product</FormHelperText>
              </FormControl>
            ) : (
              <Center py={8}>
                <VStack spacing={4}>
                  <Badge colorScheme="green" variant="solid" size="lg">
                    Barter Only
                  </Badge>
                  <Text color="gray.600">
                    This product will only accept item exchanges. Price set to ₱0.00
                  </Text>
                </VStack>
              </Center>
            )}
          </VStack>
        )
        
      case 5:
        return (
          <VStack spacing={6} align="stretch">
            <Text fontSize="lg" color="gray.600">
              Review your product details before posting
            </Text>
            
            <Box bg="gray.50" p={6} borderRadius="lg">
              <VStack spacing={4} align="stretch">
                <HStack justify="space-between">
                  <Text fontWeight="semibold">Title:</Text>
                  <Text>{formData.title}</Text>
                </HStack>
                <HStack justify="space-between">
                  <Text fontWeight="semibold">Images:</Text>
                  <Text>{uploadedImages.length} photo(s)</Text>
                </HStack>
                <HStack justify="space-between">
                  <Text fontWeight="semibold">Premium:</Text>
                  <Badge colorScheme={formData.premium ? 'yellow' : 'gray'}>
                    {formData.premium ? 'Yes' : 'No'}
                  </Badge>
                </HStack>
                <HStack justify="space-between">
                  <Text fontWeight="semibold">Buying:</Text>
                  <Badge colorScheme={formData.allow_buying ? 'blue' : 'green'}>
                    {formData.allow_buying ? 'Allowed' : 'Barter Only'}
                  </Badge>
                </HStack>
                {formData.allow_buying && formData.price && (
                  <HStack justify="space-between">
                    <Text fontWeight="semibold">Price:</Text>
                    <Text color="brand.500" fontWeight="bold">
                      ₱{formData.price.toFixed(2)}
                    </Text>
                  </HStack>
                )}
              </VStack>
            </Box>
          </VStack>
        )
        
      default:
        return null
    }
  }

  return (
    // outer Box sets the viewport background color requested
    <Box minH="100vh" bg={pageBg} py={8}>
      <Box p={8} maxW="4xl" mx="auto">
        <VStack spacing={8} align="stretch">
          {/* Header */}
          <Box textAlign="center">
            <Heading size="xl" color="brand.500" mb={2}>
              Add New Products
            </Heading>
            <Text color="gray.600">
              Step {currentStep} of {steps.length}: {steps[currentStep - 1].title}
            </Text>
          </Box>

          {/* Progress Bar */}
          <Box>
            <Progress
              value={(currentStep / steps.length) * 100}
              colorScheme="brand"
              size="lg"
              borderRadius="full"
            />
          </Box>

          {/* Step Content */}
          <Box bg={bgColor} p={8} borderRadius="lg" shadow="sm" border="1px" borderColor={borderColor}>
            {renderStepContent()}
          </Box>

          {/* Navigation */}
          <HStack justify="space-between">
            <Button
              leftIcon={<ArrowBackIcon />}
              onClick={prevStep}
              isDisabled={currentStep === 1}
              variant="outline"
            >
              Previous
            </Button>
            
            {currentStep < steps.length ? (
              <Button
                rightIcon={<ArrowForwardIcon />}
                onClick={nextStep}
                isDisabled={!canProceed()}
                colorScheme="brand"
              >
                Next
              </Button>
            ) : (
              <Button
                onClick={handleSubmit}
                isLoading={isSubmitting}
                loadingText="Posting..."
                colorScheme="brand"
                size="lg"
                px={8}
              >
                Post Product
              </Button>
            )}
          </HStack>
        </VStack>
      </Box>

      {/* Premium Upgrade Modal */}
      <Modal isOpen={isPremiumModalOpen} onClose={onClosePremiumModal} isCentered size="md">
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>
            <HStack spacing={2}>
              <Box fontSize="2xl">✨</Box>
              <Box>
                <Heading size="md">Upgrade to Premium</Heading>
              </Box>
            </HStack>
          </ModalHeader>
          <ModalCloseButton />
          <ModalBody pb={6}>
            <VStack spacing={4} align="stretch">
              <Box>
                <Text color="gray.700" fontSize="sm">
                  Unlock powerful AI tools and premium features to maximize your trading potential.
                </Text>
              </Box>
              
              {/* Pricing Box */}
              <Box 
                p={4} 
                bg="gradient.500" 
                borderRadius="lg" 
                textAlign="center"
                bgGradient="linear(to-br, purple.400, pink.400)"
              >
                <VStack spacing={1}>
                  <Text fontSize="sm" color="white" fontWeight="semibold">
                    Annual Membership
                  </Text>
                  <HStack justify="center" spacing={1}>
                    <Text fontSize="3xl" fontWeight="bold" color="white">
                      ₱299
                    </Text>
                    <Text fontSize="sm" color="whiteAlpha.900">
                      /year
                    </Text>
                  </HStack>
                  <Text fontSize="xs" color="whiteAlpha.800">
                    That's just ₱25/month!
                  </Text>
                </VStack>
              </Box>

              {/* Features List */}
              <Box 
                p={4} 
                bg="purple.50" 
                borderRadius="lg"
              >
                <VStack align="start" spacing={3}>
                  <Text fontWeight="bold" color="purple.900" fontSize="sm">
                    Premium Features Included:
                  </Text>
                  
                  <HStack spacing={2} align="start">
                    <Box color="purple.600" fontWeight="bold">✓</Box>
                    <VStack align="start" spacing={0}>
                      <Text fontSize="sm" fontWeight="semibold" color="gray.800">AI-Powered Title Generation</Text>
                      <Text fontSize="xs" color="gray.600">Auto-generate perfect titles from descriptions</Text>
                    </VStack>
                  </HStack>

                  <HStack spacing={2} align="start">
                    <Box color="purple.600" fontWeight="bold">✓</Box>
                    <VStack align="start" spacing={0}>
                      <Text fontSize="sm" fontWeight="semibold" color="gray.800">Featured Listings</Text>
                      <Text fontSize="xs" color="gray.600">Up to 20 products featured at top of search</Text>
                    </VStack>
                  </HStack>

                  <HStack spacing={2} align="start">
                    <Box color="purple.600" fontWeight="bold">✓</Box>
                    <VStack align="start" spacing={0}>
                      <Text fontSize="sm" fontWeight="semibold" color="gray.800">Accept Cash Offers</Text>
                      <Text fontSize="xs" color="gray.600">Enable buying functionality on your products</Text>
                    </VStack>
                  </HStack>

                  <HStack spacing={2} align="start">
                    <Box color="purple.600" fontWeight="bold">✓</Box>
                    <VStack align="start" spacing={0}>
                      <Text fontSize="sm" fontWeight="semibold" color="gray.800">Priority Support</Text>
                      <Text fontSize="xs" color="gray.600">Get help faster with dedicated support</Text>
                    </VStack>
                  </HStack>

                  <HStack spacing={2} align="start">
                    <Box color="purple.600" fontWeight="bold">✓</Box>
                    <VStack align="start" spacing={0}>
                      <Text fontSize="sm" fontWeight="semibold" color="gray.800">Analytics Dashboard</Text>
                      <Text fontSize="xs" color="gray.600">Track views, offers, and performance metrics</Text>
                    </VStack>
                  </HStack>

                  <HStack spacing={2} align="start">
                    <Box color="purple.600" fontWeight="bold">✓</Box>
                    <VStack align="start" spacing={0}>
                      <Text fontSize="sm" fontWeight="semibold" color="gray.800">Bulk Product Upload</Text>
                      <Text fontSize="xs" color="gray.600">List multiple products at once</Text>
                    </VStack>
                  </HStack>

                  <HStack spacing={2} align="start">
                    <Box color="purple.600" fontWeight="bold">✓</Box>
                    <VStack align="start" spacing={0}>
                      <Text fontSize="sm" fontWeight="semibold" color="gray.800">Badge & Verification</Text>
                      <Text fontSize="xs" color="gray.600">Stand out with a premium member badge</Text>
                    </VStack>
                  </HStack>
                </VStack>
              </Box>

              {/* CTA Buttons */}
              <VStack spacing={2}>
                <Button
                  colorScheme="purple"
                  size="lg"
                  w="full"
                  fontWeight="bold"
                  onClick={() => {
                    onClosePremiumModal()
                    navigate('/premium')
                  }}
                >
                  Upgrade Now
                </Button>
                <Button
                  variant="outline"
                  w="full"
                  onClick={onClosePremiumModal}
                >
                  Maybe Later
                </Button>
              </VStack>

              <Text fontSize="xs" color="gray.500" textAlign="center">
                Secure payment • Auto-renewable • Cancel anytime
              </Text>
            </VStack>
          </ModalBody>
        </ModalContent>
      </Modal>

      {/* Location Map Modal */}
      <Modal isOpen={isLocationModalOpen} onClose={onCloseLocationModal} isCentered size="xl">
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>
            <HStack spacing={2}>
              <Box fontSize="2xl">📍</Box>
              <Box>
                <Heading size="md">Product Location</Heading>
              </Box>
            </HStack>
          </ModalHeader>
          <ModalCloseButton />
          <ModalBody pb={6}>
            <VStack spacing={4} align="stretch">
              <Box>
                <Text fontSize="sm" color="gray.600" mb={2}>
                  Your product location has been set. Buyers will see this location when viewing your product.
                </Text>
              </Box>

              {/* Map Preview */}
              {locationCoordinates && (
                <Box 
                  w="full" 
                  h="300px" 
                  borderRadius="lg" 
                  overflow="hidden"
                  border="1px"
                  borderColor="gray.200"
                >
                  <iframe
                    width="100%"
                    height="100%"
                    frameBorder="0"
                    src={`https://www.openstreetmap.org/export/embed.html?bbox=${locationCoordinates.lng - 0.01},${locationCoordinates.lat - 0.01},${locationCoordinates.lng + 0.01},${locationCoordinates.lat + 0.01}&layer=mapnik&marker=${locationCoordinates.lat},${locationCoordinates.lng}`}
                    style={{ borderRadius: '8px' }}
                  />
                </Box>
              )}

              {/* Location Details */}
              <Box p={4} bg="blue.50" borderRadius="lg" borderLeft="3px solid" borderLeftColor="blue.400">
                <VStack align="start" spacing={2}>
                  <Text fontWeight="semibold" color="blue.900" fontSize="sm">
                    Location Details
                  </Text>
                  <Text fontSize="sm" color="gray.700">
                    <strong>Address:</strong> {formData.location}
                  </Text>
                  <Text fontSize="xs" color="gray.600">
                    ✓ Location confirmed via GPS
                  </Text>
                </VStack>
              </Box>

              {/* CTA Buttons */}
              <VStack spacing={2}>
                <Button
                  colorScheme="brand"
                  w="full"
                  onClick={onCloseLocationModal}
                >
                  Confirm Location
                </Button>
                <Button
                  variant="outline"
                  w="full"
                  onClick={() => {
                    setLocationCoordinates(null)
                    setLocationError(null)
                    onCloseLocationModal()
                  }}
                >
                  Select Different Location
                </Button>
              </VStack>
            </VStack>
          </ModalBody>
        </ModalContent>
      </Modal>
    </Box>
  )
}

export default AddProduct
