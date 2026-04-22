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
  Skeleton,
  Icon,
} from '@chakra-ui/react'
import {
  FiHeart,
  FiEye,
  FiShoppingCart,
  FiRefreshCw,
  FiArrowLeft,
  FiTrash2
} from 'react-icons/fi'
import { FaExchangeAlt, FaMoneyBillWave, FaHandshake } from 'react-icons/fa'
import { AddIcon } from '@chakra-ui/icons'
import { useAuth } from '../contexts/AuthContext'
import { Product } from '../types'
import { api } from '../services/api'
import { getFirstImage, getImageUrl } from '../utils/imageUtils'
import { getProductUrl } from '../utils/productUtils'
import axios, { AxiosError } from 'axios'
import FloatingTab from '../components/FloatingTab'

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

    // Guard: must be logged in
    if (!user) {
      setLoading(false)
      setError('Please log in to view your saved products.')
      // Optional: redirect after a short delay
      // navigate('/login', { state: { from: '/saved-products' } })
      return
    }

    try {
      const response = await api.get<SavedProductsResponse>('/api/users/saved-products', {
        timeout: 30000,
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
      const resp = axErr?.response?.data

      if (import.meta.env.DEV) {
        console.warn('Saved products fetch failed', { status, message: msg })
      }

      if (status === 401) {
        setError('Your session has expired. Please log in again.')
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
        id: "savedproducts-removed-from-saved",
        title: 'Removed from saved',
        description: 'Product removed from your saved items',
        status: 'info',
        duration: 2000,
        isClosable: true,
      })
    } catch {
      toast({
        id: "savedproducts-error",
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
          <VStack spacing={6} align="stretch">
            <Box bg="white" borderRadius="2xl" p={{ base: 4, md: 5 }} border="1px" borderColor="gray.200">
              <Flex justify="space-between" align="start">
                <HStack spacing={3}>
                  <Skeleton h="42px" w="42px" borderRadius="xl" />
                  <VStack align="start" spacing={2}>
                    <Skeleton h="24px" w="150px" borderRadius="md" />
                    <Skeleton h="16px" w="100px" borderRadius="md" />
                  </VStack>
                </HStack>
                <Skeleton h="32px" w="90px" borderRadius="full" />
              </Flex>
            </Box>

            <VStack spacing={3} align="stretch">
              {[1, 2, 3, 4].map((n) => (
                <Box key={n} bg="white" borderRadius="xl" border="1px" borderColor="gray.200" p={4}>
                  <HStack spacing={4} align="center">
                    <Skeleton boxSize={{ base: '72px', md: '84px' }} borderRadius="lg" />
                    <VStack align="start" spacing={3} flex={1}>
                      <Skeleton h="20px" w="60%" borderRadius="md" />
                      <Skeleton h="14px" w="40%" borderRadius="md" />
                      <HStack mt={1} w="full" justify="space-between">
                         <Skeleton h="20px" w="80px" borderRadius="md" />
                         <Skeleton h="24px" w="70px" borderRadius="full" />
                      </HStack>
                    </VStack>
                  </HStack>
                </Box>
              ))}
            </VStack>
          </VStack>
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
      <Container maxW="container.md" py={8} px={{ base: 3, md: 4 }}>
        <VStack spacing={6} align="stretch">
          {/* Header */}
          <Box
            bg="white"
            borderRadius="2xl"
            p={{ base: 4, md: 5 }}
            border="1px"
            borderColor="gray.200"
            _dark={{ bg: 'gray.800', borderColor: 'gray.700' }}
            position="sticky"
            top={{ base: 2, md: 4 }}
            zIndex={10}
            boxShadow="0 1px 3px rgba(0,0,0,0.04)"
          >
            <Flex
              align={{ base: 'start', md: 'center' }}
              justify="space-between"
              direction={{ base: 'column', md: 'row' }}
              gap={3}
            >
              <HStack spacing={3}>
                <Flex
                  align="center"
                  justify="center"
                  w="42px"
                  h="42px"
                  borderRadius="xl"
                  bg="red.50"
                  color="red.500"
                  flexShrink={0}
                >
                  <Icon as={FiHeart} boxSize={5} />
                </Flex>
                <VStack align="start" spacing={0}>
                  <Heading size="md" color="gray.800" _dark={{ color: 'gray.100' }}>
                    Saved Products
                  </Heading>
                  <Text fontSize="sm" color="gray.500">
                    {savedProducts.length} {savedProducts.length === 1 ? 'item' : 'items'} saved
                  </Text>
                </VStack>
              </HStack>

              <Button
                leftIcon={<FiRefreshCw />}
                onClick={() => fetchSavedProducts()}
                colorScheme="blue"
                variant="ghost"
                size="sm"
                borderRadius="full"
              >
                Refresh
              </Button>
            </Flex>
          </Box>

          {/* Saved Products List */}
          {savedProducts.length === 0 ? (
            <Box py={16} textAlign="center">
              <VStack spacing={4}>
                <Flex w="80px" h="80px" bg="red.50" color="red.300" borderRadius="full" align="center" justify="center">
                  <FiHeart size={32} />
                </Flex>
                <Heading size="md" color="gray.600">
                  No saved products yet
                </Heading>
                <Text color="gray.500">
                  Start exploring products and save the ones you like!
                </Text>
                <Button
                  colorScheme="brand"
                  onClick={() => navigate('/home')}
                  leftIcon={<FiEye />}
                  borderRadius="full"
                  mt={2}
                >
                  Browse Products
                </Button>
              </VStack>
            </Box>
          ) : (
            <VStack spacing={3} align="stretch">
              {savedProducts.map((product) => (
                <Box
                  key={product.id}
                  bg="white"
                  borderRadius="xl"
                  border="1px"
                  borderColor="gray.200"
                  p={4}
                  cursor="pointer"
                  transition="all 0.25s cubic-bezier(0.4, 0, 0.2, 1)"
                  _hover={{ shadow: 'md', transform: 'translateY(-2px)', borderColor: 'brand.300' }}
                  onClick={() => handleViewProduct(product)}
                  position="relative"
                >
                  <IconButton
                    aria-label="Remove from saved"
                    icon={<FiHeart fill="currentColor" />}
                    position="absolute"
                    top={3}
                    right={3}
                    size="sm"
                    color="red.500"
                    variant="ghost"
                    _hover={{ bg: 'red.50' }}
                    isLoading={removing === product.id}
                    onClick={(e) => { e.stopPropagation(); handleRemoveFromSaved(product.id); }}
                  />
                  <HStack spacing={4} align="center">
                    <Box boxSize={{ base: '72px', md: '84px' }} borderRadius="lg" overflow="hidden" flexShrink={0} bg="gray.100">
                      <Image src={getFirstImage(product.image_urls)} alt={product.title} w="100%" h="100%" objectFit="cover" fallbackSrc="/no-image.svg" />
                    </Box>
                    <VStack align="start" spacing={1} flex={1} minW={0} justify="center">
                      <HStack spacing={2} minW={0} mr={8}>
                        <Text fontWeight="bold" fontSize={{ base: 'sm', md: 'md' }} noOfLines={1} color="gray.800">{product.title}</Text>
                        {product.premium && (
                          <Badge colorScheme="yellow" size="xs" fontSize="9px">Premium</Badge>
                        )}
                      </HStack>
                      <Text fontSize="xs" color="gray.500" noOfLines={1}>{product.description || `by ${product.seller_name}`}</Text>
                      
                      <HStack spacing={2} mt={1} flexWrap="wrap" w="full">
                        {product.allow_buying && product.price ? (
                          <Text fontWeight="bold" fontSize="sm" color="brand.500">{formatCurrency(product.price)}</Text>
                        ) : (
                          <Badge colorScheme="green" fontSize="2xs" variant="subtle">Barter</Badge>
                        )}
                        <Badge
                          colorScheme={
                            product.status === 'available' ? 'green' :
                              product.status === 'locked' ? 'orange' : 'red'
                          }
                          fontSize="2xs"
                          variant="subtle"
                          borderRadius="sm"
                          px={1.5}
                        >
                          {product.status}
                        </Badge>
                        
                        <HStack spacing={1} flex={1} justify="flex-end" display={{ base: 'flex', sm: 'flex' }} flexWrap="nowrap">
                          <Tooltip label="Trade" placement="top">
                            <Button
                              size="xs"
                              variant="outline"
                              colorScheme="brand"
                              leftIcon={<Icon as={FaExchangeAlt} />}
                              fontSize={{ base: '10px', md: '11px' }}
                              onClick={(e) => { e.stopPropagation(); handleViewProduct(product); }}
                              isDisabled={product.status === 'sold'}
                              transition="all 0.2s"
                              _hover={{ transform: 'translateY(-1px)' }}
                              _active={{ transform: 'scale(0.98)' }}
                              borderRadius="full"
                            >
                              {product.status === 'sold' ? 'Sold' : 'Trade'}
                            </Button>
                          </Tooltip>

                          <Button
                            size="xs"
                            variant="outline"
                            colorScheme="orange"
                            leftIcon={<Icon as={FaMoneyBillWave} />}
                            fontSize={{ base: '10px', md: '11px' }}
                            _hover={{ transform: 'translateY(-1px)' }}
                            _active={{ transform: 'scale(0.98)' }}
                            onClick={(e) => { e.stopPropagation(); handleViewProduct(product); }}
                            isDisabled={product.status === 'sold'}
                            transition="all 0.2s"
                            borderRadius="full"
                          >
                            Buyout
                          </Button>

                          <Tooltip label="View offers" placement="top">
                            <IconButton
                              aria-label="View offers"
                              icon={<Icon as={FaHandshake} />}
                              size="xs"
                              variant="outline"
                              colorScheme="blue"
                              onClick={(e) => { e.stopPropagation(); handleViewProduct(product); }}
                              isDisabled={product.status === 'sold'}
                              flexShrink={0}
                              transition="all 0.2s"
                              _hover={{ transform: 'translateY(-1px)' }}
                              _active={{ transform: 'scale(0.98)' }}
                              borderRadius="full"
                            />
                          </Tooltip>
                        </HStack>
                      </HStack>
                    </VStack>
                  </HStack>
                </Box>
              ))}
            </VStack>
          )}
        </VStack>
      </Container>

      <FloatingTab />
    </Box>
  )
}

export default SavedProducts
