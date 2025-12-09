import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  Box,
  Container,
  VStack,
  HStack,
  Grid,
  Heading,
  Text,
  Spinner,
  Center,
  Image,
  Badge,
  Button,
} from '@chakra-ui/react'
import { useProducts } from '../contexts/ProductContext'
import { getFirstImage } from '../utils/imageUtils'
import { getProductUrl } from '../utils/productUtils'
import { formatPHP } from '../utils/currency'

const ProductsList: React.FC = () => {
  const { products, loading, error, searchProducts, clearError } = useProducts()
  const location = useLocation()
  const navigate = useNavigate()
  const [initialized, setInitialized] = useState(false)

  const sellerId = useMemo(() => {
    const params = new URLSearchParams(location.search)
    const idStr = params.get('seller_id')
    return idStr ? parseInt(idStr) : undefined
  }, [location.search])

  const lastRunSellerRef = useRef<number | undefined>(undefined)
  useEffect(() => {
    if (lastRunSellerRef.current === sellerId) return
    lastRunSellerRef.current = sellerId
    const load = async () => {
      clearError()
      await searchProducts({ page: 1, limit: 20, seller_id: sellerId })
      setInitialized(true)
    }
    load()
    // Intentionally depend only on sellerId to avoid re-runs on provider renders
  }, [sellerId])

  const renderCard = (p: any) => (
    <Box
      key={p.id}
      bg="white"
      rounded="lg"
      shadow="sm"
      borderWidth="1px"
      borderColor="gray.100"
      overflow="hidden"
      transition="all 0.2s ease"
      w="full"
      _hover={{ boxShadow: 'md', transform: 'translateY(-2px)', cursor: 'pointer' }}
      onClick={() => navigate(getProductUrl(p))}
    >
      <Box position="relative" w="full" pt="100%" overflow="hidden">
        <Image
          src={getFirstImage(p.image_urls)}
          alt={p.title}
          position="absolute"
          top={0}
          left={0}
          w="100%"
          h="100%"
          objectFit="cover"
          loading="lazy"
          fallbackSrc="https://via.placeholder.com/600x600?text=No+Image"
        />
        {p.premium && (
          <Badge position="absolute" top={2} right={2} colorScheme="yellow" variant="solid" borderRadius="full" px={2}>
            Premium
          </Badge>
        )}
      </Box>
      <Box p={4} display="flex" flexDirection="column" h={{ base: 180, md: 192 }} overflow="hidden">
        <Heading size="sm" noOfLines={2} mb={2} color="gray.800" flexShrink={0}>
          {p.title}
        </Heading>
        <Text color="gray.600" noOfLines={2} mb={3} fontSize="sm" flexShrink={0}>
          {p.description || 'No description available'}
        </Text>
        <HStack justify="space-between" align="center" mt="auto">
          {p.allow_buying && p.price && !p.barter_only ? (
            <Text fontSize="lg" fontWeight="bold" color="brand.500">
              {formatPHP(p.price)}
            </Text>
          ) : (
            <Text fontSize="sm" color="green.600" fontWeight="medium">Barter Only</Text>
          )}
          <Badge colorScheme={p.status === 'available' ? 'green' : p.status === 'traded' ? 'blue' : 'red'}>
            {p.status}
          </Badge>
        </HStack>
      </Box>
    </Box>
  )

  return (
    <Box bg="#FFFDF1" minH="100vh" w="100%">
      <Container maxW="container.xl" py={6}>
        <VStack align="stretch" spacing={4}>
          <HStack justify="space-between" align="center">
            <Heading size="md" color="gray.800">
              {sellerId ? 'Seller Products' : 'All Products'}
            </Heading>
            {sellerId && (
              <Button size="sm" variant="outline" onClick={() => navigate('/products')}>View All</Button>
            )}
          </HStack>

          {loading && (
            <Center h="40vh">
              <Spinner size="xl" color="brand.500" />
            </Center>
          )}

          {!loading && error && (
            <Center h="40vh">
              <Text color="red.500">{error}</Text>
            </Center>
          )}

          {!loading && !error && initialized && products.length === 0 && (
            <Box bg="white" border="1px" borderColor="gray.200" rounded="lg" p={8} textAlign="center">
              <Text color="gray.600">No products available</Text>
            </Box>
          )}

          {!loading && !error && products.length > 0 && (
            <Grid
              templateColumns={{ base: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)', lg: 'repeat(4, 1fr)', xl: 'repeat(5, 1fr)' }}
              gap={{ base: 3, md: 4 }}
              alignItems="start"
            >
              {products.map(renderCard)}
            </Grid>
          )}
        </VStack>
      </Container>
    </Box>
  )
}

export default ProductsList


