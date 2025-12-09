import React, { useState, useEffect } from 'react'
import { useNavigate, Link as RouterLink } from 'react-router-dom'
import {
  Box,
  Container,
  VStack,
  HStack,
  Heading,
  Text,
  Button,
  Image,
  Badge,
  Flex,
  Spinner,
  Center,
  Alert,
  AlertIcon,
  SimpleGrid,
  useToast,
  IconButton,
  Tooltip,
  Card,
  CardBody,
  CardHeader,
  Divider,
} from '@chakra-ui/react'
import { 
  FiHeart, 
  FiEye, 
  FiShoppingCart,
  FiRefreshCw,
  FiArrowLeft,
  FiTrash2
} from 'react-icons/fi'
import { AddIcon } from '@chakra-ui/icons'
import { useAuth } from '../contexts/AuthContext'
import { Product } from '../types'
import { api } from '../services/api'
import { getFirstImage, getImageUrl } from '../utils/imageUtils'
import { getProductUrl } from '../utils/productUtils'
import axios, { AxiosError } from 'axios'

interface SavedProductsResponse {
  status: string;
  data: {
    data: Product[];
    count?: number;
  };
}

const SavedProducts: React.FC = () => {
  const { user } = useAuth()
  const navigate = useNavigate()
  
  // Force redirect if not authenticated
  useEffect(() => {
    if (!user) {
      navigate('/login', { state: { from: '/saved-products' } });
    }
  }, [user, navigate]);

  const [savedProducts, setSavedProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [removing, setRemoving] = useState<number | null>(null)
  
  const toast = useToast()

  const fetchSavedProducts = async (retryCount = 0): Promise<void> => {
    setLoading(true)
    setError('')

    // Guard: must be logged-in and have token
    if (!user) {
      setLoading(false)
      setError('Please log in to view your saved products.')
      // Optional: redirect after a short delay
      // navigate('/login', { state: { from: '/saved-products' } })
      return
    }

    const token = localStorage.getItem('clovia_token') || localStorage.getItem('token') || ''
    if (!token) {
      setLoading(false)
      setError('No authentication token found')
      console.warn('❌ Saved products fetch failed:\nMessage: No authentication token found')
      return
    }

    try {
      const response = await api.get<SavedProductsResponse>('/api/users/saved-products', {
        timeout: 12000,
        headers: {
          Authorization: `Bearer ${token}`,
        },
      })

      const products = response?.data?.data?.data ?? []
      if (!Array.isArray(products)) {
        throw new Error('Invalid response: products is not an array')
      }
      setSavedProducts(products)
    } catch (error: unknown) {
      // Normalize error details
      const axErr = (error as AxiosError) || ({} as AxiosError)
      const msg = (axErr?.message as string) || 'Unknown error'
      const status = axErr?.response?.status
      const statusText = axErr?.response?.statusText
      const resp = axErr?.response?.data
      const stack = (error as any)?.stack

      // Structured console output
      console.error(
        `❌ Saved products fetch failed:\n` +
        `Message: ${msg}\n` +
        `Status: ${status ?? 'N/A'}\n` +
        `StatusText: ${statusText ?? 'N/A'}\n` +
        `Response: ${typeof resp === 'string' ? resp : JSON.stringify(resp)}\n` +
        `Stack: ${stack ?? 'N/A'}`
      )

      if (status === 401) {
        setError('Your session has expired. Please log in again.')
        localStorage.removeItem('clovia_token')
        localStorage.removeItem('token')
        return
      }

      // Exponential backoff retry for transient server errors
      if (status && status >= 500 && retryCount < 2) {
        const delayMs = Math.pow(2, retryCount) * 1000
        await new Promise((r) => setTimeout(r, delayMs))
        return fetchSavedProducts(retryCount + 1)
      }

      let uiMessage = msg
      if (resp && typeof resp === 'object') {
        const anyResp = resp as { error?: string; message?: string }
        uiMessage = anyResp.error || anyResp.message || msg
      }
      setError(uiMessage)
    } finally {
      setLoading(false)
    }
  }

  const handleRemoveFromSaved = async (productId: number) => {
    try {
      setRemoving(productId)
      
      if (user) {
        // Use API for logged-in users
        await api.delete(`/api/users/saved-products/${productId}`)
      } 
      
      // Update local state
      setSavedProducts(prev => prev.filter(p => p.id !== productId))
      
      toast({
        title: 'Removed from saved',
        description: 'Product removed from your saved items',
        status: 'info',
        duration: 2000,
        isClosable: true,
      })
    } catch (error: any) {
      console.error('Failed to remove saved product:', error)
      toast({
        title: 'Error',
        description: 'Failed to remove product from saved items',
        status: 'error',
        duration: 3000,
        isClosable: true,
      })
    } finally {
      setRemoving(null)
    }
  }

  const handleViewProduct = (product: any) => {
    navigate(getProductUrl(product))
  }

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-PH', { 
      style: 'currency', 
      currency: 'PHP' 
    }).format(amount)
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  useEffect(() => {
    if (user) {
      fetchSavedProducts()
    }
  }, [user])

  if (loading) {
    return (
      <Box bg="#FFFDF1" minH="100vh" w="100%">
        <Container maxW="container.xl" py={8}>
          <Center h="50vh">
            <VStack spacing={4}>
              <Spinner size="xl" color="brand.500" />
              <Text color="gray.600">Loading your saved products...</Text>
            </VStack>
          </Center>
        </Container>
      </Box>
    )
  }

  if (error) {
    return (
      <Box bg="#FFFDF1" minH="100vh" w="100%">
        <Container maxW="container.xl" py={8}>
          <Alert status="error" borderRadius="lg">
            <AlertIcon />
            <Box>
              <Text fontWeight="bold">Error loading saved products</Text>
              <Text>{error}</Text>
            </Box>
          </Alert>
          <Button 
            leftIcon={<FiRefreshCw />} 
            onClick={() => fetchSavedProducts()}
            mt={4}
            colorScheme="blue"
          >
            Try Again
          </Button>
        </Container>
      </Box>
    )
  }

  return (
    <Box bg="#FFFDF1" minH="100vh" w="100%">
      <Container maxW="container.xl" py={8}>
        <VStack spacing={6} align="stretch">
          {/* Header */}
          <Flex justify="space-between" align="center">
            <HStack spacing={4}>
              <VStack align="start" spacing={1}>
                <Heading size="lg" color="brand.500">
                  Saved Products
                </Heading>
                <Text color="gray.600">
                  {savedProducts.length} {savedProducts.length === 1 ? 'item' : 'items'} saved
                </Text>
              </VStack>
            </HStack>
            
            <Button 
              leftIcon={<FiRefreshCw />} 
              onClick={() => fetchSavedProducts()}
              colorScheme="blue" 
              variant="outline"
              size="sm"
            >
              Refresh
            </Button>
          </Flex>

          {/* Saved Products Grid */}
          {savedProducts.length === 0 ? (
            <Card>
              <CardBody textAlign="center" py={12}>
                <VStack spacing={4}>
                  <FiHeart size={48} color="#CBD5E0" />
                  <Heading size="md" color="gray.500">
                    No saved products yet
                  </Heading>
                  <Text color="gray.600">
                    Start exploring products and save the ones you like!
                  </Text>
                  <Button 
                    colorScheme="brand" 
                    onClick={() => navigate('/')}
                    leftIcon={<FiEye />}
                  >
                    Browse Products
                  </Button>
                </VStack>
              </CardBody>
            </Card>
          ) : (
            <SimpleGrid columns={{ base: 2, md: 2, lg: 4 }} spacing={3}>
              {savedProducts.map((product) => (
                <Card key={product.id} bg="white" shadow="sm" overflow="hidden" h="full">
                  <Box position="relative">
                    <Image
                      src={getFirstImage(product.image_urls)}
                      alt={product.title}
                      h="120px"
                      w="full"
                      objectFit="cover"
                      fallbackSrc="https://via.placeholder.com/300x200?text=No+Image"
                    />
                    <IconButton
                      aria-label="Remove from saved"
                      icon={<FiTrash2 />}
                      position="absolute"
                      top={1}
                      right={1}
                      size="xs"
                      colorScheme="red"
                      variant="solid"
                      isLoading={removing === product.id}
                      onClick={() => handleRemoveFromSaved(product.id)}
                    />
                  </Box>
                  
                  <CardBody py={2} px={2}>
                    <VStack spacing={1.5} align="stretch">
                      <Box>
                        <Heading size="xs" color="brand.500" noOfLines={1}>
                          {product.title}
                        </Heading>
                        <Text color="gray.600" fontSize="xs" noOfLines={1} mt={0.5}>
                          {product.description}
                        </Text>
                      </Box>

                      <HStack spacing={1} wrap="wrap" fontSize="xs">
                        {product.premium && (
                          <Badge colorScheme="yellow" size="xs">Premium</Badge>
                        )}
                        <Badge 
                          colorScheme={
                            product.status === 'available' ? 'green' : 
                            product.status === 'locked' ? 'orange' : 'red'
                          }
                          size="xs"
                        >
                          {product.status}
                        </Badge>
                      </HStack>

                      <Box>
                        <Text fontSize="sm" fontWeight="bold" color="brand.500">
                          {product.price ? formatCurrency(product.price) : 'Barter Only'}
                        </Text>
                        <Text fontSize="xs" color="gray.500" noOfLines={1}>
                          by {product.seller_name}
                        </Text>
                      </Box>

                      <HStack spacing={1} pt={0.5}>
                        <Button
                          leftIcon={<FiEye />}
                          colorScheme="blue"
                          variant="outline"
                          size="xs"
                          flex={1}
                          onClick={() => handleViewProduct(product)}
                        >
                          View
                        </Button>
                        {product.status === 'available' && (
                          <Button
                            leftIcon={<FiShoppingCart />}
                            colorScheme="brand"
                            size="xs"
                            flex={1}
                            onClick={() => handleViewProduct(product)}
                          >
                            {product.price ? 'Buy' : 'Trade'}
                          </Button>
                        )}
                      </HStack>
                    </VStack>
                  </CardBody>
                </Card>
              ))}
            </SimpleGrid>
          )}
        </VStack>
      </Container>

    {/* Floating Add Product FAB */}
    <IconButton
      as={RouterLink}
      to="/add-product"
      aria-label="Add product"
      icon={<AddIcon />}
      position="fixed"
      bottom={12}
      right={6}
      h={14}
      w={14}
      bgGradient="linear(to-br, brand.500, teal.400)"
      color="white"
      borderRadius="full"
      zIndex={200}
      boxShadow="lg"
      _hover={{ transform: 'scale(1.05)' }}
    />
    </Box>
  )
}

export default SavedProducts
