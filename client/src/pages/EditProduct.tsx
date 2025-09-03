import React, { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Box,
  Container,
  VStack,
  Heading,
  FormControl,
  FormLabel,
  Input,
  Textarea,
  Button,
  Text,
  Alert,
  AlertIcon,
  NumberInput,
  NumberInputField,
  NumberInputStepper,
  NumberIncrementStepper,
  NumberDecrementStepper,
  Switch,
  FormHelperText,
  Spinner,
  Center,
  useToast,
} from '@chakra-ui/react'
import { useProducts } from '../contexts/ProductContext'
import { ProductUpdate } from '../types'
import { api } from '../services/api'

const EditProduct: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const { updateProduct } = useProducts()
  const [formData, setFormData] = useState<ProductUpdate>({})
  const [loading, setLoading] = useState(false)
  const [fetching, setFetching] = useState(true)
  const [error, setError] = useState('')
  const [originalProduct, setOriginalProduct] = useState<any>(null)
  
  const navigate = useNavigate()
  const toast = useToast()

  useEffect(() => {
    if (id) {
      fetchProduct()
    }
  }, [id])

  const fetchProduct = async () => {
    try {
      setFetching(true)
      setError('')
      const response = await api.get(`/api/products/${id}`)
      const product = response.data.data
      setOriginalProduct(product)
      
      // Pre-fill form with current values
      setFormData({
  title: product.title,
  description: product.description,
  price: product.price,
  image_urls: product.image_urls || [],
  premium: product.premium,
  status: product.status,
      })
    } catch (error: any) {
      setError(error.response?.data?.error || 'Failed to fetch product')
    } finally {
      setFetching(false)
    }
  }

  const handleInputChange = (field: keyof ProductUpdate, value: any) => {
    // Special handling for image_urls: accept a string and convert to array
    if (field === 'image_urls') {
      setFormData(prev => ({ ...prev, image_urls: value ? [value] : [] }))
    } else {
      setFormData(prev => ({ ...prev, [field]: value }))
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!formData.title && !formData.description && !formData.price && 
  (!formData.image_urls || formData.image_urls.length === 0) && formData.premium === undefined && 
  formData.status === undefined) {
      setError('Please make at least one change to update the product')
      return
    }

    if (formData.price !== undefined && formData.price <= 0) {
      setError('Price must be greater than 0')
      return
    }

    try {
      setLoading(true)
      setError('')
      await updateProduct(parseInt(id!), formData)
      
      toast({
        title: 'Product updated!',
        description: 'Your product has been successfully updated',
        status: 'success',
        duration: 3000,
        isClosable: true,
      })
      
      navigate('/dashboard')
    } catch (error: any) {
      setError(error.message || 'Failed to update product')
    } finally {
      setLoading(false)
    }
  }

  if (fetching) {
    return (
      <Center h="50vh">
        <Spinner size="xl" color="brand.500" />
      </Center>
    )
  }

  if (error && !originalProduct) {
    return (
      <Container maxW="container.md" py={8}>
        <Alert status="error">
          <AlertIcon />
          {error}
        </Alert>
      </Container>
    )
  }

  if (!originalProduct) {
    return (
      <Container maxW="container.md" py={8}>
        <Alert status="error">
          <AlertIcon />
          Product not found
        </Alert>
      </Container>
    )
  }

  return (
    <Container maxW="container.md" py={8}>
      <VStack spacing={8}>
        <Box textAlign="center">
          <Heading size="xl" color="brand.500" mb={2}>
            Edit Product
          </Heading>
          <Text color="gray.600">
            Update your product listing
          </Text>
        </Box>

        <Box bg="white" p={8} rounded="lg" shadow="sm" w="full">
          <form onSubmit={handleSubmit}>
            <VStack spacing={6}>
              {error && (
                <Alert status="error">
                  <AlertIcon />
                  {error}
                </Alert>
              )}

              <FormControl>
                <FormLabel>Product Title</FormLabel>
                <Input
                  value={formData.title || originalProduct.title}
                  onChange={(e) => handleInputChange('title', e.target.value)}
                  placeholder="Enter product title"
                  size="lg"
                />
                <FormHelperText>
                  Leave empty to keep current title
                </FormHelperText>
              </FormControl>

              <FormControl>
                <FormLabel>Description</FormLabel>
                <Textarea
                  value={formData.description || originalProduct.description}
                  onChange={(e) => handleInputChange('description', e.target.value)}
                  placeholder="Describe your product in detail"
                  size="lg"
                  rows={4}
                />
                <FormHelperText>
                  Leave empty to keep current description
                </FormHelperText>
              </FormControl>

              <FormControl>
                <FormLabel>Price (PHP)</FormLabel>
                <NumberInput
                  value={formData.price !== undefined ? formData.price : originalProduct.price}
                  onChange={(value) => handleInputChange('price', parseFloat(value) || 0)}
                  min={0}
                  precision={2}
                  size="lg"
                >
                  <NumberInputField placeholder="0.00" />
                  <NumberInputStepper>
                    <NumberIncrementStepper />
                    <NumberDecrementStepper />
                  </NumberInputStepper>
                </NumberInput>
                <FormHelperText>
                  Leave empty to keep current price
                </FormHelperText>
              </FormControl>

              <FormControl>
                <FormLabel>Image URL</FormLabel>
                <Input
                  value={formData.image_urls && formData.image_urls.length > 0 ? formData.image_urls[0] : (originalProduct.image_urls && originalProduct.image_urls[0])}
                  onChange={(e) => handleInputChange('image_urls', e.target.value)}
                  placeholder="https://example.com/image.jpg"
                  size="lg"
                />
                <FormHelperText>
                  Leave empty to keep current image
                </FormHelperText>
              </FormControl>

              <FormControl display="flex" alignItems="center">
                <FormLabel htmlFor="premium" mb="0">
                  Premium Listing
                </FormLabel>
                <Switch
                  id="premium"
                  isChecked={formData.premium !== undefined ? formData.premium : originalProduct.premium}
                  onChange={(e) => handleInputChange('premium', e.target.checked)}
                  colorScheme="yellow"
                />
                <FormHelperText ml={3}>
                  Premium listings get featured placement
                </FormHelperText>
              </FormControl>

              <FormControl>
                <FormLabel>Status</FormLabel>
                <Input
                  value={formData.status || originalProduct.status}
                  onChange={(e) => handleInputChange('status', e.target.value)}
                  placeholder="available or sold"
                  size="lg"
                />
                <FormHelperText>
                  Leave empty to keep current status
                </FormHelperText>
              </FormControl>

              <Button
                type="submit"
                colorScheme="brand"
                size="lg"
                w="full"
                isLoading={loading}
                loadingText="Updating product..."
              >
                Update Product
              </Button>
            </VStack>
          </form>
        </Box>
      </VStack>
    </Container>
  )
}

export default EditProduct
