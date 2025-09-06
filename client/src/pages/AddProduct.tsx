import React, { useState, useCallback } from 'react'
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
} from '@chakra-ui/react'
import { AddIcon, CloseIcon, ArrowForwardIcon, ArrowBackIcon } from '@chakra-ui/icons'
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
    price: undefined,
    image_urls: [],
    premium: false,
    allow_buying: false,
    barter_only: true,
    location: '',
  })
  
  const [uploadedImages, setUploadedImages] = useState<File[]>([])
  const [imagePreviewUrls, setImagePreviewUrls] = useState<string[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  
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
    
    const newFiles = Array.from(files)
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

    setUploadedImages(prev => [...prev, ...validFiles])
    
    // Create preview URLs
    validFiles.forEach(file => {
      const reader = new FileReader()
      reader.onload = (e) => {
        setImagePreviewUrls(prev => [...prev, e.target?.result as string])
      }
      reader.readAsDataURL(file)
    })
  }, [toast])

  const removeImage = (index: number) => {
    setUploadedImages(prev => prev.filter((_, i) => i !== index))
    setImagePreviewUrls(prev => prev.filter((_, i) => i !== index))
  }

  const handleInputChange = (field: keyof ProductCreate, value: any) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

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
    if (!user) return
    
    setIsSubmitting(true)
    
    try {
      // Create FormData for file upload
      const formDataToSend = new FormData()
      formDataToSend.append('title', formData.title)
      formDataToSend.append('description', formData.description)
      if (formData.price) {
        formDataToSend.append('price', formData.price.toString())
      }
      formDataToSend.append('premium', formData.premium.toString())
      formDataToSend.append('allow_buying', formData.allow_buying.toString())
      formDataToSend.append('barter_only', formData.barter_only.toString())
      if (formData.location) {
        formDataToSend.append('location', formData.location)
      }
      
      // Append image files
      uploadedImages.forEach((file) => {
        formDataToSend.append('images', file)
      })
      
      await createProduct(formDataToSend)
      
      toast({
        title: 'Product created!',
        description: 'Your product has been successfully posted',
        status: 'success',
        duration: 3000,
        isClosable: true,
      })
      
      navigate('/dashboard')
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error.message || 'Failed to create product',
        status: 'error',
        duration: 3000,
        isClosable: true,
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const canProceed = () => {
    switch (currentStep) {
      case 1: return uploadedImages.length > 0
      case 2: return formData.title.trim() && formData.description.trim()
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
              Upload photos of your product. First image will be the cover.
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
                  PNG, JPG up to 10MB each
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
            
            {/* Image Previews */}
            {uploadedImages.length > 0 && (
              <SimpleGrid columns={{ base: 2, md: 3 }} spacing={4}>
                {uploadedImages.map((_, index) => (
                  <Box key={index} position="relative">
                    <Image
                      src={imagePreviewUrls[index]}
                      alt={`Preview ${index + 1}`}
                      borderRadius="lg"
                      objectFit="cover"
                      w="full"
                      h="32"
                    />
                    <IconButton
                      icon={<CloseIcon />}
                      aria-label="Remove image"
                      size="sm"
                      position="absolute"
                      top={2}
                      right={2}
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
              <FormLabel>Product Title</FormLabel>
              <Input
                placeholder="e.g., iPhone 13 Pro, MacBook Air M1"
                value={formData.title}
                onChange={(e) => handleInputChange('title', e.target.value)}
                size="lg"
              />
              <FormHelperText>Be descriptive and specific</FormHelperText>
            </FormControl>
            
            <FormControl isRequired>
              <FormLabel>Description</FormLabel>
              <Textarea
                placeholder="Describe your product in detail..."
                value={formData.description}
                onChange={(e) => handleInputChange('description', e.target.value)}
                rows={6}
                size="lg"
              />
              <FormHelperText>Include condition, features, and what you're looking for in exchange</FormHelperText>
            </FormControl>
            
            <FormControl>
              <FormLabel>Location</FormLabel>
              <Input
                placeholder="City, State (optional)"
                value={formData.location}
                onChange={(e) => handleInputChange('location', e.target.value)}
                size="lg"
              />
            </FormControl>
          </VStack>
        )
        
      case 3:
        return (
          <VStack spacing={6} align="stretch">
            <Text fontSize="lg" color="gray.600">
              Configure your exchange preferences
            </Text>
            
            <FormControl>
              <FormLabel>Premium Listing</FormLabel>
              <HStack justify="space-between">
                <Text fontSize="sm" color="gray.600">
                  Feature your product at the top of search results
                </Text>
                <Switch
                  isChecked={formData.premium}
                  onChange={(e) => handleInputChange('premium', e.target.checked)}
                  colorScheme="brand"
                />
              </HStack>
            </FormControl>
            
            <FormControl>
              <FormLabel>Allow Buying</FormLabel>
              <HStack justify="space-between">
                <Text fontSize="sm" color="gray.600">
                  Accept cash offers in addition to barter
                </Text>
                <Switch
                  isChecked={formData.allow_buying}
                  onChange={(e) => {
                    handleInputChange('allow_buying', e.target.checked)
                    if (!e.target.checked) {
                      handleInputChange('price', undefined)
                    }
                  }}
                  colorScheme="brand"
                />
              </HStack>
            </FormControl>
            
            <FormControl>
              <FormLabel>Barter Only</FormLabel>
              <HStack justify="space-between">
                <Text fontSize="sm" color="gray.600">
                  Accept only item exchanges (no cash)
                </Text>
                <Switch
                  isChecked={formData.barter_only}
                  onChange={(e) => handleInputChange('barter_only', e.target.checked)}
                  colorScheme="brand"
                />
              </HStack>
            </FormControl>
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
                  onChange={(e) => handleInputChange('price', e.target.value ? Number(e.target.value) : undefined)}
                  size="lg"
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
                    This product will only accept item exchanges
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
              Add New Product
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
    </Box>
  )
}

export default AddProduct
