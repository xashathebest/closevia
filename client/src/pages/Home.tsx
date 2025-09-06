import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Link as RouterLink, useLocation } from 'react-router-dom'
import {
  Box,
  Heading,
  Input,
  Select,
  HStack,
  VStack,
  Text,
  Button,
  Image,
  Badge,
  Flex,
  Spinner,
  Center,
  useToast,
  IconButton,
  Grid,
  useDisclosure,
  InputGroup,
  InputLeftElement,
  FormControl,
  FormLabel,
} from '@chakra-ui/react'
import { 
  SearchIcon, 
  RepeatIcon, 
  StarIcon, 
  ViewIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  AddIcon,
  HamburgerIcon,
  ArrowLeftIcon,   
  ArrowRightIcon,   
} from '@chakra-ui/icons'
import { FaUserCircle } from 'react-icons/fa'
import { useProducts } from '../contexts/ProductContext'
import { useAuth } from '../contexts/AuthContext'
import { SearchFilters } from '../types'
import { getFirstImage } from '../utils/imageUtils'
import { useMobileNav } from '../contexts/MobileNavContext'
import { api } from '../services/api'
import TradeModal from '../components/TradeModal'

// Custom debounce hook
const useDebounce = (value: string, delay: number) => {
  const [debouncedValue, setDebouncedValue] = useState(value)

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value)
    }, delay)

    return () => {
      clearTimeout(handler)
    }
  }, [value, delay])

  return debouncedValue
}

const Home: React.FC = () => {
  const { products, loading, error, searchProducts, loadMore, hasMore, isLoadingMore } = useProducts()
  const { user } = useAuth()
  const location = useLocation()
  const { isOpen, onOpen, onClose } = useDisclosure()
  const { onOpen: openMobileNav } = useMobileNav()
  
  // Search state management
  const [searchTerm, setSearchTerm] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [filters, setFilters] = useState<SearchFilters>({
    keyword: '',
    min_price: undefined,
    max_price: undefined,
    premium: undefined,
    status: 'available', // default to available so home shows items
    barter_only: undefined, // Show all by default
    location: '',
    page: 1,
    limit: 20, // Load more products
  })
  const [hasSearched, setHasSearched] = useState(false)
  
  // Debounce search term for smooth UX
  const debouncedSearchTerm = useDebounce(searchTerm, 400)
  
  const toast = useToast()

  // Load products immediately on component mount
  useEffect(() => {
  // Always fetch latest 10 available products on mount (default feed)
  searchProducts({ ...filters, status: 'available', limit: 10, page: 1 })
  setHasSearched(false)
  // empty deps intentional — only once on mount
  }, [])

  // Refetch when navigating back to Home route to ensure newest items appear
  useEffect(() => {
    if (location.pathname === '/') {
      searchProducts({ ...filters, status: 'available', limit: 10, page: 1 })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname])

  // Infinite scroll: IntersectionObserver for sentinel
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!sentinelRef.current) return
    const el = sentinelRef.current
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[0]
      if (entry.isIntersecting) {
        if (!loading && !isLoadingMore && hasMore) {
          loadMore()
        }
      }
    }, { root: null, rootMargin: '200px', threshold: 0 })
    observer.observe(el)
    return () => observer.unobserve(el)
  }, [sentinelRef, loading, isLoadingMore, hasMore, loadMore])

  // Refetch on tab/window focus to keep feed fresh
  useEffect(() => {
    const handleFocus = () => {
      if (window.location.pathname === '/') {
        searchProducts({ ...filters, status: 'available', limit: 10, page: 1 })
      }
    }
    window.addEventListener('focus', handleFocus)
    return () => window.removeEventListener('focus', handleFocus)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Update filters when debounced search term changes
  useEffect(() => {
    if (debouncedSearchTerm.trim() === '') return
    setFilters(prev => ({ ...prev, keyword: debouncedSearchTerm, page: 1 }))
    setHasSearched(true)
  }, [debouncedSearchTerm])

  // Search when filters change — only run when hasSearched is true
  useEffect(() => {
    if (!hasSearched) return

    // perform the search once, then reset the flag
    searchProducts(filters)
    setHasSearched(false)

    // intentionally exclude searchProducts from deps to avoid loops if it's not stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, hasSearched])

  const handleSearch = () => {
    setFilters(prev => ({ ...prev, keyword: searchTerm, page: 1 }))
    setHasSearched(true)
  }

  // Trigger search on Enter key
  const handleSearchInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSearch()
    }
  }

  // change: mark filter changes as user-initiated so the effect runs
  const handleFilterChange = (key: keyof SearchFilters, value: any) => {
    setFilters(prev => ({ ...prev, [key]: value, page: 1 }))
    setHasSearched(true)
  }

  // Trade modal state
  const [tradeTargetProductId, setTradeTargetProductId] = useState<number | null>(null)

  // Slider state: cycles public/1.jpg, public/2.jpg, public/3.jpg every 3s
  const sliderImages = ['/1.jpg', '/2.jpg', '/3.jpg']
  const [slideIndex, setSlideIndex] = useState(0)
  const sliderIntervalRef = useRef<number | null>(null)
  const resumeTimeoutRef = useRef<number | null>(null)
  const touchStartX = useRef<number | null>(null)

  const startAuto = () => {
    if (sliderIntervalRef.current) window.clearInterval(sliderIntervalRef.current)
    sliderIntervalRef.current = window.setInterval(() => {
      setSlideIndex(i => (i + 1) % sliderImages.length)
    }, 3000)
  }

  const stopAuto = () => {
    if (sliderIntervalRef.current) {
      window.clearInterval(sliderIntervalRef.current)
      sliderIntervalRef.current = null
    }
  }

  const scheduleResume = (delay = 2000) => {
    // stop immediate auto and restart after delay
    stopAuto()
    if (resumeTimeoutRef.current) window.clearTimeout(resumeTimeoutRef.current)
    resumeTimeoutRef.current = window.setTimeout(() => {
      startAuto()
    }, delay)
  }

  useEffect(() => {
    startAuto()
    return () => {
      stopAuto()
      if (resumeTimeoutRef.current) window.clearTimeout(resumeTimeoutRef.current)
    }
  }, [])

  const goNext = () => {
    setSlideIndex(i => (i + 1) % sliderImages.length)
    scheduleResume(2000)
  }

  const goPrev = () => {
    setSlideIndex(i => (i - 1 + sliderImages.length) % sliderImages.length)
    scheduleResume(2000)
  }

  const onWheelSlide = (e: React.WheelEvent) => {
    if (Math.abs(e.deltaY) < 10) return
    if (e.deltaY > 0) goNext()
    else goPrev()
  }

  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0]?.clientX ?? null
  }

  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current == null) return
    const endX = e.changedTouches[0]?.clientX ?? 0
    const diff = touchStartX.current - endX
    if (Math.abs(diff) > 40) {
      if (diff > 0) goNext()
      else goPrev()
    }
    touchStartX.current = null
  }

  const openTradeModal = async (productId: number) => {
    setTradeTargetProductId(productId)
    onOpen()
  }

  const handleTradeClick = (productId: number) => {
    if (!user) {
      onOpen() // Show login modal
    } else {
      openTradeModal(productId)
    }
  }

  const handleBuyClick = (productId: number) => {
    if (!user) {
      onOpen() // Show login modal
    } else {
      // Proceed with purchase
      toast({
        title: 'Purchase initiated!',
        description: 'Contact the seller to complete the purchase.',
        status: 'success',
        duration: 3000,
        isClosable: true,
      })
    }
  }

  const clearFilters = () => {
    setSearchTerm('')
    setFilters({
      keyword: '',
      min_price: undefined,
      max_price: undefined,
      premium: undefined,
      status: 'available',
      barter_only: undefined,
      location: '',
      page: 1,
      limit: 20,
    })
    setHasSearched(false)
  }

  // Pinterest-style masonry grid
  const renderProductCard = (product: any) => (
    <Box
      key={product.id}
      bg="white"
      rounded="2xl"
      shadow="sm"
      overflow="hidden"
      transition="all 0.3s ease"
      display="inline-block"
      w="full"
      mb={6}
      sx={{ breakInside: 'avoid', WebkitColumnBreakInside: 'avoid', pageBreakInside: 'avoid' }}
      _hover={{ 
        shadow: 'lg', 
        transform: 'translateY(-4px)',
        cursor: 'pointer'
      }}
      onClick={() => window.location.href = `/products/${product.id}`}
    >
      {/* Product Image */}
      <Box position="relative">
        <Image
          src={getFirstImage(product.image_urls)}
          alt={product.title}
          w="full"
          h="auto"
          objectFit="cover"
          loading="lazy"
          fallbackSrc="https://via.placeholder.com/300x400?text=No+Image"
        />
        
        {/* Premium Badge */}
        {product.premium && (
          <Badge
            position="absolute"
            top={2}
            right={2}
            colorScheme="yellow"
            variant="solid"
            borderRadius="full"
            px={2}
          >
            <StarIcon mr={1} />
            Premium
          </Badge>
        )}
        
        {/* Trade/Buy Badge */}
        <Badge
          position="absolute"
          top={2}
          left={2}
          colorScheme={product.allow_buying && product.price && !product.barter_only ? "blue" : "green"}
          variant="solid"
          borderRadius="full"
          px={2}
        >
          {product.allow_buying && product.price && !product.barter_only ? "Buy Available" : "Barter Only"}
        </Badge>
        
        {/* Status Badge */}
        {(product.status === 'sold' || product.status === 'traded') && (
          <Badge
            position="absolute"
            bottom={2}
            right={2}
            colorScheme={product.status === 'sold' ? 'red' : 'purple'}
            variant="solid"
            borderRadius="full"
            px={2}
          >
            {product.status === 'sold' ? 'Sold' : 'Traded'}
          </Badge>
        )}
      </Box>

      {/* Product Info */}
      <Box p={4}>
        <Heading size="sm" noOfLines={2} mb={2} color="gray.800">
          {product.title}
        </Heading>
        
        <Text color="gray.600" noOfLines={2} mb={3} fontSize="sm">
          {product.description || 'No description available'}
        </Text>
        
        {/* Price and Seller Info */}
        <Flex justify="space-between" align="center" mb={3}>
          {product.allow_buying && product.price && !product.barter_only ? (
            <Text fontSize="lg" fontWeight="bold" color="brand.500">
              ₱{product.price.toFixed(2)}
            </Text>
          ) : (
            <Text fontSize="sm" color="green.600" fontWeight="medium">
              Barter Only
            </Text>
          )}
          
          <Text fontSize="xs" color="gray.500">
            by {product.seller_name || 'Unknown'}
          </Text>
        </Flex>

        {/* Action Buttons */}
        <HStack spacing={2}>
          <Button
            size="sm"
            variant="outline"
            colorScheme="brand"
            flex={1}
            onClick={(e) => {
              e.stopPropagation()
              handleTradeClick(product.id)
            }}
            isDisabled={product.status === 'sold' || product.status === 'traded'}
          >
            {product.status === 'sold' ? 'Sold' : product.status === 'traded' ? 'Traded' : 'Trade'}
          </Button>
          
          {product.allow_buying && product.price && !product.barter_only && (
            <Button
              size="sm"
              colorScheme="brand"
              flex={1}
              onClick={(e) => {
                e.stopPropagation()
                handleBuyClick(product.id)
              }}
              isDisabled={product.status === 'sold' || product.status === 'traded'}
            >
              {product.status === 'sold' ? 'Sold' : product.status === 'traded' ? 'Traded' : 'Buy'}
            </Button>
          )}
        </HStack>
      </Box>
    </Box>
  )

  return (
    <Box minH="100vh" bg="#FFFDF1">
      {/* Sticky Search Header */}
      <Box
        position="sticky"
        top={0}
        zIndex={100}
        bg="#FFFDF1"
        borderColor="gray.200"
        px={8}
        py={4}
      >
        <VStack spacing={4}>
          {/* Main Search Bar */}
          <HStack w="full" maxW="6xl" mx="auto" spacing={3} wrap="wrap">
            <InputGroup size="lg" flex={1} minW={{ base: 0, md: 'auto' }}>
              <InputLeftElement pointerEvents="none">
                <SearchIcon color="gray.400" />
              </InputLeftElement>
              <Input
                placeholder="Search products, categories, or keywords..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                bg="white"
                border="2px"
                borderColor="gray.200"
                _focus={{
                  borderColor: "brand.500",
                  boxShadow: "0 0 0 1px var(--chakra-colors-brand-500)"
                }}
              />
            </InputGroup> 

            {/* Toggle Filters icon (mobile inline, right side) */}
            <IconButton
              aria-label="Toggle filters"
              icon={showFilters ? <ChevronUpIcon /> : <ChevronDownIcon />}
              variant="outline"
              size={{ base: 'md', md: 'lg' }}
              onClick={() => setShowFilters(!showFilters)}
              display={{ base: 'inline-flex', md: 'none' }}
            />

            {/* Mobile hamburger to open nav drawer (after filters icon) */}
            <IconButton
              aria-label="Open navigation"
              icon={<HamburgerIcon />}
              display={{ base: 'inline-flex', md: 'none' }}
              size={{ base: 'md', md: 'lg' }}
              variant="ghost"
              onClick={openMobileNav}
            />

            {/* Profile button (desktop only) */}
            <IconButton
              as={RouterLink}
              to="/profile"
              aria-label="Profile"
              icon={<FaUserCircle />}
              variant="ghost"
              size="lg"
              display={{ base: 'none', md: 'inline-flex' }}
            />

            {/* Hidden on mobile to keep header compact */}
            <Button
              leftIcon={<SearchIcon />}
              colorScheme="brand"
              size="lg"
              onClick={handleSearch}
              px={8}
              display={{ base: 'none', md: 'inline-flex' }}
            >
              Search
            </Button>

            {/* Desktop filters toggle at the end to keep desktop layout */}
            <IconButton
              aria-label="Toggle filters"
              icon={showFilters ? <ChevronUpIcon /> : <ChevronDownIcon />}
              variant="outline"
              size="lg"
              onClick={() => setShowFilters(!showFilters)}
              display={{ base: 'none', md: 'inline-flex' }}
            />
          </HStack>

          {/* Expandable Filters */}
          {showFilters && (
            <Box w="full" maxW="4xl" mx="auto" bg="white" p={4} rounded="lg">
              <Grid templateColumns="repeat(auto-fit, minmax(200px, 1fr))" gap={4}>
                <FormControl>
                  <FormLabel fontSize="sm" color="gray.600">Price Range</FormLabel>
                  <HStack>
                    <Input
                      placeholder="Min"
                      type="number"
                      value={filters.min_price || ''}
                      onChange={(e) => handleFilterChange('min_price', e.target.value ? Number(e.target.value) : undefined)}
                      size="sm"
                    />
                    <Text fontSize="sm" color="gray.500">-</Text>
                    <Input
                      placeholder="Max"
                      type="number"
                      value={filters.max_price || ''}
                      onChange={(e) => handleFilterChange('max_price', e.target.value ? Number(e.target.value) : undefined)}
                      size="sm"
                    />
                  </HStack>
                </FormControl>

                <FormControl>
                  <FormLabel fontSize="sm" color="gray.600">Location</FormLabel>
                  <Input
                    placeholder="Enter location"
                    value={filters.location || ''}
                    onChange={(e) => handleFilterChange('location', e.target.value)}
                    size="sm"
                  />
                </FormControl>

                <FormControl>
                  <FormLabel fontSize="sm" color="gray.600">Listing Type</FormLabel>
                  <Select
                    value={filters.premium === undefined ? '' : filters.premium.toString()}
                    onChange={(e) => handleFilterChange('premium', e.target.value === '' ? undefined : e.target.value === 'true')}
                    size="sm"
                  >
                    <option value="">All listings</option>
                    <option value="true">Premium only</option>
                    <option value="false">Regular only</option>
                  </Select>
                </FormControl>

                <FormControl>
                  <FormLabel fontSize="sm" color="gray.600">Trade Type</FormLabel>
                  <Select
                    value={filters.barter_only === undefined ? '' : filters.barter_only.toString()}
                    onChange={(e) => handleFilterChange('barter_only', e.target.value === '' ? undefined : e.target.value === 'true')}
                    size="sm"
                  >
                    <option value="">All options</option>
                    <option value="true">Barter only</option>
                    <option value="false">Buy available</option>
                  </Select>
                </FormControl>

                <FormControl>
                  <FormLabel fontSize="sm" color="gray.600">Status</FormLabel>
                  <Select
                    value={filters.status || ''}
                    onChange={(e) => handleFilterChange('status', e.target.value)}
                    size="sm"
                  >
                    <option value="available">Available</option>
                    <option value="sold">Sold</option>
                  </Select>
                </FormControl>

                <FormControl>
                  <FormLabel fontSize="sm" color="gray.600">&nbsp;</FormLabel>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={clearFilters}
                    w="full"
                  >
                    Clear Filters
                  </Button>
                </FormControl>
              </Grid>
            </Box>
          )}
        </VStack>
      </Box>
      {/* slider / visual box between header and main content (keeps same dimensions) */}
      <Box
        /* slightly narrower on mobile and reduce horizontal padding on small screens */
        maxW={{ base: 'calc(100% - 32px)', md: '4xl', lg: '6xl', xl: '1160px' }}
        mx="auto"
        mb={4}
        px={{ base: 2, md: 4 }}
      >
        <Box
          position="relative"
          overflow="hidden"
          h={{ base: 28, md: 28, lg: 32 }}    /* keep same chakra size tokens as before */
          rounded="lg"
          border="1px"
          borderColor="gray.200"
          bg="gray.50"
          onWheel={onWheelSlide}
          onTouchStart={onTouchStart}
          onTouchEnd={onTouchEnd}
        >
          {sliderImages.map((src, idx) => (
            <Image
              key={src}
              src={src}
              alt={`slide-${idx + 1}`}
              position="absolute"
              top={0}
              left={0}
              w="100%"
              h="100%"
              objectFit="cover"
              transition="opacity 600ms ease"
              opacity={idx === slideIndex ? 1 : 0}
              zIndex={idx === slideIndex ? 2 : 1}
              loading="eager"
              draggable={false}
              onClick={() => { /* allow click-through if desired */ }}
            />
          ))}

          {/* Prev / Next controls (desktop only). Mobile users swipe instead. */}
          <IconButton
            aria-label="Previous slide"
            icon={<ArrowLeftIcon />}
            position="absolute"
            left={3}
            top="50%"
            transform="translateY(-50%)"
            zIndex={5}
            size="sm"
            colorScheme="blackAlpha"
            variant="ghost"
            display={{ base: 'none', md: 'flex' }}
            onClick={(e) => { e.stopPropagation(); goPrev() }}
          />

          <IconButton
            aria-label="Next slide"
            icon={<ArrowRightIcon />}
            position="absolute"
            right={3}
            top="50%"
            transform="translateY(-50%)"
            zIndex={5}
            size="sm"
            colorScheme="blackAlpha"
            variant="ghost"
            display={{ base: 'none', md: 'flex' }}
            onClick={(e) => { e.stopPropagation(); goNext() }}
          />

          {/* Dots */}
          <HStack spacing={2} position="absolute" bottom={3} left="50%" transform="translateX(-50%)" zIndex={5}>
            {sliderImages.map((_, i) => (
              <Box
                key={i}
                as="button"
                w={i === slideIndex ? 3 : 2.5}
                h={i === slideIndex ? 3 : 2.5}
                bg={i === slideIndex ? 'brand.500' : 'gray.300'}
                borderRadius="full"
                onClick={(e: React.MouseEvent) => { e.stopPropagation(); setSlideIndex(i); scheduleResume(2000) }}
              />
            ))}
          </HStack>
        </Box>
      </Box>
      {/* Main Content */}
      <Box px={{ base: 3, md: 8 }} py={6}>
        {/* Loading State */}
        {loading && !products.length && (
          <Center h="50vh">
            <VStack spacing={4}>
              <Spinner size="xl" color="brand.500" />
              <Text color="gray.600">Loading products...</Text>
            </VStack>
          </Center>
        )}

        {/* Error Display */}
        {error && (
          <Box bg="red.50" border="1px" borderColor="red.200" rounded="lg" p={6} maxW="4xl" mx="auto">
            <VStack spacing={4} align="stretch">
              <Text color="red.800" fontWeight="semibold">
                Error loading products
              </Text>
              <Text color="red.700" fontSize="sm">
                {error}
              </Text>
              <Button
                size="sm"
                colorScheme="red"
                variant="outline"
                onClick={() => searchProducts(filters)}
              >
                Retry
              </Button>
            </VStack>
          </Box>
        )}

        {/* Products Grid - Pinterest Style */}
        {!loading && products.length > 0 && (
          <Box maxW={{ base: 'calc(100% - 12px)', md: '25xl' }} mx="auto" mt={-6} px={{ base: 1, md: 0 }}>
            <Box
              sx={{
                columnCount: { base: 2, sm: 2, md: 2, lg: 3, xl: 4 },
                columnGap: '1rem',
              }}
            >
              {products.map(renderProductCard)}
            </Box>
            {/* Sentinel for infinite scroll */}
            <Box ref={sentinelRef} h="1px" />
            {/* Subtle loading indicator for loading more */}
            {isLoadingMore && (
              <Center py={6}>
                <Spinner size="md" color="brand.500" />
              </Center>
            )}
          </Box>
        )}

        {/* Empty State (single, correct location) */}
        {!loading && products.length === 0 && (
          <Box textAlign="center" py={16} maxW="2xl" mx="auto">
            <VStack spacing={6}>
              <Box fontSize="6xl" color="gray.300">
                📦
              </Box>
              <VStack spacing={2}>
                <Heading size="lg" color="gray.700">
                  No products found
                </Heading>
                <Text color="gray.500" fontSize="lg">
                  {filters.keyword || filters.min_price || filters.max_price || filters.premium !== undefined || filters.status !== 'available' 
                    ? "Try adjusting your search criteria or clearing filters to see all products."
                    : "No products are currently available. Check back later!"
                  }
                </Text>
              </VStack>
              <Button
                size="lg"
                colorScheme="brand"
                onClick={clearFilters}
              >
                {filters.keyword || filters.min_price || filters.max_price || filters.premium !== undefined || filters.status !== 'available' 
                  ? "Clear All Filters"
                  : "Refresh Page"
                }
              </Button>
            </VStack>
          </Box>
        )}
      </Box>

      <TradeModal isOpen={isOpen} onClose={onClose} targetProductId={tradeTargetProductId} />

      {/* Floating Add Product FAB (bottom-right) - more visible with stronger shadows and border */}
      <IconButton
        as={RouterLink}
        to="/add-product"
        aria-label="Add product"
        icon={<AddIcon />}
        position="fixed"
        bottom={12}
        right={6}
        // explicit size for a prominent FAB
        h={14}
        w={14}
        display="flex"
        alignItems="center"
        justifyContent="center"
        bgGradient="linear(to-br, brand.500, teal.400)"
        color="white"
        borderRadius="full"
        borderWidth={2}
        borderColor="white"
        zIndex={200}
        // layered shadow for depth
        boxShadow="0 8px 30px rgba(16, 185, 129, 0.18), 0 4px 10px rgba(0,0,0,0.08)"
        // interactive states
        _hover={{ transform: 'translateY(-4px) scale(1.03)', boxShadow: '0 12px 40px rgba(16,185,129,0.22), 0 6px 16px rgba(0,0,0,0.12)' }}
        _active={{ transform: 'translateY(-1px) scale(0.99)', boxShadow: '0 6px 20px rgba(16,185,129,0.16)' }}
        _focus={{ boxShadow: '0 0 0 6px rgba(16,185,129,0.12)' }}
        title="Add product"
      />
    </Box>
  )
}

export default Home