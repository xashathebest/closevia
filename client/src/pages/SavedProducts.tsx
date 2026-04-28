import React, { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Alert,
  AlertIcon,
  Badge,
  Box,
  Button,
  Container,
  Flex,
  Heading,
  HStack,
  Icon,
  IconButton,
  Image,
  Skeleton,
  Text,
  Tooltip,
  useToast,
  VStack,
} from '@chakra-ui/react'
import { FiEye, FiHeart, FiMapPin, FiRefreshCw, FiTrash2, FiUser } from 'react-icons/fi'
import { FaExchangeAlt, FaMoneyBillWave } from 'react-icons/fa'
import { useAuth } from '../contexts/AuthContext'
import { Product } from '../types'
import { api } from '../services/api'
import { getFirstImage } from '../utils/imageUtils'
import { getProductUrl } from '../utils/productUtils'
import { getProductLocationLabel, getProductLocationKey } from '../utils/productLocation'
import FloatingTab from '../components/FloatingTab'
import TradeModal from '../components/TradeModal'
import AnimatedEmptyState from '../components/AnimatedEmptyState'
import { productImageTransitionName, runViewTransition } from '../utils/motion'

interface SavedProductsResponse {
  status: string
  data: {
    data: Product[]
    count?: number
  }
}

interface SellerGroup {
  sellerId: number
  sellerName: string
  products: Product[]
  hasDifferentLocations: boolean
}

const SavedProducts: React.FC = () => {
  const { user } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const [savedProducts, setSavedProducts] = useState<Product[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [removing, setRemoving] = useState<number | null>(null)
  const [tradeTargetProductId, setTradeTargetProductId] = useState<number | null>(null)

  useEffect(() => {
    if (!user) navigate('/login', { state: { from: '/saved-products' } })
  }, [user, navigate])

  const groupedSavedProducts = useMemo<SellerGroup[]>(() => {
    const map = new Map<number, SellerGroup>()

    savedProducts.forEach((product) => {
      const sellerId = product.seller_id || 0
      const existing = map.get(sellerId)
      if (existing) {
        existing.products.push(product)
        return
      }

      map.set(sellerId, {
        sellerId,
        sellerName: product.seller_name || 'Unknown trader',
        products: [product],
        hasDifferentLocations: false,
      })
    })

    return Array.from(map.values()).map((group) => {
      const locationKeys = new Set(group.products.map(getProductLocationKey))
      return {
        ...group,
        hasDifferentLocations: locationKeys.size > 1,
      }
    })
  }, [savedProducts])

  const fetchSavedProducts = async (retryCount = 0): Promise<void> => {
    setLoading(true)
    setError('')

    if (!user) {
      setLoading(false)
      setError("Log in to see the items you've saved.")
      return
    }

    try {
      const response = await api.get<SavedProductsResponse>('/api/users/saved-products?limit=100', {
        timeout: 30000,
      })
      const products = response?.data?.data?.data ?? []
      if (!Array.isArray(products)) throw new Error('Invalid response: products is not an array')
      setSavedProducts(products)
    } catch (error: any) {
      const status = error?.response?.status
      if (status === 401) {
        setError('Your session has expired. Please log in again.')
        localStorage.removeItem('token')
        return
      }
      if (status && status >= 500 && retryCount < 2) {
        await new Promise((resolve) => setTimeout(resolve, Math.pow(2, retryCount) * 1000))
        return fetchSavedProducts(retryCount + 1)
      }
      setError(error?.response?.data?.error || error?.response?.data?.message || error?.message || "We couldn't load your saved items right now. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  const handleRemoveFromSaved = async (productId: number) => {
    try {
      setRemoving(productId)
      await api.delete(`/api/users/saved-products/${productId}`)
      setSavedProducts((prev) => prev.filter((product) => product.id !== productId))
      toast({
        id: `savedproducts-removed-${productId}`,
        title: 'Removed from saved',
        status: 'info',
        duration: 2000,
      })
    } catch {
      toast({
        id: `savedproducts-remove-error-${productId}`,
        title: "Couldn't remove that item",
        status: 'error',
        duration: 3000,
        isClosable: true,
      })
    } finally {
      setRemoving(null)
    }
  }

  useEffect(() => {
    if (user) fetchSavedProducts()
  }, [user])

  if (loading) {
    return (
      <Box bg="#FFFDF1" minH="100vh" w="100%">
        <Container maxW="container.lg" py={8} px={{ base: 3, md: 4 }}>
          <VStack spacing={4} align="stretch">
            <Skeleton h="92px" borderRadius="xl" />
            {[1, 2, 3].map((item) => (
              <Skeleton key={item} h="150px" borderRadius="xl" />
            ))}
          </VStack>
        </Container>
      </Box>
    )
  }

  if (error) {
    return (
      <Box bg="#FFFDF1" minH="100vh" w="100%">
        <Container maxW="container.lg" py={8}>
          <Alert status="error" borderRadius="lg">
            <AlertIcon />
            <Box>
              <Text fontWeight="bold">Couldn't load your saved items</Text>
              <Text>{error}</Text>
            </Box>
          </Alert>
          <Button leftIcon={<FiRefreshCw />} onClick={() => fetchSavedProducts()} mt={4} colorScheme="blue">
            Try Again
          </Button>
        </Container>
      </Box>
    )
  }

  return (
    <Box bg="#FFFDF1" minH="100vh" w="100%">
      <Container maxW="container.lg" py={{ base: 4, md: 8 }} px={{ base: 3, md: 4 }}>
        <VStack spacing={5} align="stretch">
          <Box bg="white" borderRadius="xl" p={{ base: 4, md: 5 }} border="1px" borderColor="gray.200">
            <VStack align="start" spacing={0}>
              <Heading size="md" color="gray.800">Saved Products</Heading>
              <Text fontSize="sm" color="gray.500">
                {savedProducts.length} saved {savedProducts.length === 1 ? 'item' : 'items'} from {groupedSavedProducts.length} {groupedSavedProducts.length === 1 ? 'trader' : 'traders'}
              </Text>
            </VStack>
          </Box>

          {savedProducts.length === 0 ? (
            <AnimatedEmptyState
              icon={FiHeart}
              title="No saved products yet"
              description="Start exploring products and save the ones you like."
              actionLabel="Browse Products"
              onAction={() => navigate('/home')}
              colorScheme="red"
            />
          ) : (
            <VStack spacing={4} align="stretch">
              {groupedSavedProducts.map((group) => (
                <Box key={group.sellerId} bg="white" borderRadius="xl" border="1px" borderColor="gray.200" overflow="hidden">
                  <Flex p={{ base: 3, md: 4 }} gap={3} align={{ base: 'stretch', sm: 'center' }} justify="space-between" direction={{ base: 'column', sm: 'row' }} borderBottom="1px" borderColor="gray.100">
                    <VStack align="start" spacing={1}>
                      <HStack spacing={2}>
                        <Icon as={FiUser} color="gray.500" />
                        <Text fontWeight="700" color="gray.800">{group.sellerName}</Text>
                        <Badge colorScheme="gray" variant="subtle">{group.products.length} saved</Badge>
                      </HStack>
                      {group.hasDifferentLocations && (
                        <Badge colorScheme="yellow" variant="subtle" borderRadius="full">
                          Different pickup locations
                        </Badge>
                      )}
                    </VStack>
                    <HStack spacing={2} justify={{ base: 'stretch', sm: 'flex-end' }}>
                      <Button size="sm" leftIcon={<FiUser />} variant="outline" onClick={() => navigate(`/users/${group.sellerId}`)} flex={{ base: 1, sm: 'initial' }}>
                        Trader
                      </Button>
                      <Button size="sm" leftIcon={<FaExchangeAlt />} colorScheme="brand" onClick={() => setTradeTargetProductId(group.products[0]?.id || null)} flex={{ base: 1, sm: 'initial' }}>
                        Trade Selected
                      </Button>
                    </HStack>
                  </Flex>

                  <VStack spacing={0} align="stretch" divider={<Box borderBottom="1px" borderColor="gray.100" />}>
                    {group.products.map((product) => (
                      <Flex key={product.id} p={{ base: 3, md: 4 }} gap={3} align="center" cursor="pointer" _hover={{ bg: 'gray.50' }} onClick={() => runViewTransition(() => navigate(getProductUrl(product)))}>
                        <Box boxSize={{ base: '70px', md: '84px' }} borderRadius="lg" overflow="hidden" flexShrink={0} bg="gray.100">
                          <Image src={getFirstImage(product.image_urls)} alt={product.title} w="100%" h="100%" objectFit="cover" fallbackSrc="/no-image.svg" style={{ viewTransitionName: productImageTransitionName(product.id) }} />
                        </Box>
                        <VStack align="start" spacing={1.5} flex={1} minW={0}>
                          <HStack spacing={2} minW={0} w="full">
                            <Text fontWeight="700" fontSize={{ base: 'sm', md: 'md' }} noOfLines={1} color="gray.800">{product.title}</Text>
                            {product.premium && <Badge colorScheme="yellow" fontSize="9px">Premium</Badge>}
                          </HStack>
                          <HStack spacing={1.5} color="gray.600" w="full" minW={0}>
                            <Icon as={FiMapPin} boxSize={3.5} flexShrink={0} />
                            <Text fontSize="xs" noOfLines={1}>{getProductLocationLabel(product)}</Text>
                          </HStack>
                          <HStack spacing={2} flexWrap="wrap">
                            {product.allow_buying && product.price ? (
                              <Badge colorScheme="orange" variant="subtle">Buyout PHP {product.price.toLocaleString()}</Badge>
                            ) : (
                              <Badge colorScheme="green" variant="subtle">Barter</Badge>
                            )}
                            <Badge colorScheme={product.status === 'available' ? 'green' : product.status === 'locked' ? 'orange' : 'red'} variant="subtle">
                              {product.status}
                            </Badge>
                          </HStack>
                        </VStack>
                        <VStack spacing={2} align="end" onClick={(event) => event.stopPropagation()}>
                          <Tooltip label="Propose trade">
                            <IconButton aria-label="Propose trade" icon={<FaExchangeAlt />} size="sm" colorScheme="brand" variant="ghost" onClick={() => setTradeTargetProductId(product.id)} isDisabled={product.status === 'sold'} />
                          </Tooltip>
                          <Tooltip label="Buyout details">
                            <IconButton aria-label="Buyout details" icon={<FaMoneyBillWave />} size="sm" colorScheme="orange" variant="ghost" onClick={() => navigate(getProductUrl(product))} isDisabled={product.status === 'sold'} />
                          </Tooltip>
                          <Tooltip label="Remove from saved">
                            <IconButton aria-label="Remove from saved" icon={<FiTrash2 />} size="sm" colorScheme="red" variant="ghost" isLoading={removing === product.id} onClick={() => handleRemoveFromSaved(product.id)} />
                          </Tooltip>
                        </VStack>
                      </Flex>
                    ))}
                  </VStack>
                </Box>
              ))}
            </VStack>
          )}
        </VStack>
      </Container>

      <TradeModal isOpen={tradeTargetProductId !== null} onClose={() => setTradeTargetProductId(null)} targetProductId={tradeTargetProductId} />
      <FloatingTab />
    </Box>
  )
}

export default SavedProducts
