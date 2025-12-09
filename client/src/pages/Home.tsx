import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Link as RouterLink, useLocation, useNavigate } from 'react-router-dom'
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
  Tooltip,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalCloseButton,
  ModalBody,
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverBody,
  Divider,
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
  CloseIcon,
} from '@chakra-ui/icons'
import { FaUserCircle, FaHandshake } from 'react-icons/fa'
import { useProducts } from '../contexts/ProductContext'
import { useAuth } from '../contexts/AuthContext'
import { SearchFilters } from '../types'
import { getFirstImage } from '../utils/imageUtils'
import { formatPHP } from '../utils/currency'
import { getProductUrl } from '../utils/productUtils'
import { useMobileNav } from '../contexts/MobileNavContext'
import { api } from '../services/api'
import TradeModal from '../components/TradeModal'
import { useRealtime } from '../contexts/RealtimeContext' // added import

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
  const { user, logout } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const { isOpen, onOpen, onClose } = useDisclosure()
  const { onOpen: openMobileNav } = useMobileNav()
  const { isOpen: isLogoutModalOpen, onOpen: onOpenLogoutModal, onClose: onCloseLogoutModal } = useDisclosure()
  const { offerCount } = useRealtime() // added realtime usage
  
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

  // Category pills state
  const categories = [
    'All',
    'Bag',
    'School Supply',
    'Book',
    'Electronic',
    'Clothing',
    'Shoe',
    'Accessory',
    'Home & Living',
    'Toy',
    'Beauty',
  ]
  const [selectedCategory, setSelectedCategory] = useState<string>('All')

  // Category colors mapping
  const categoryColors: { [key: string]: string } = {
    'Bag': '#FFE5D0',
    'School Supply': '#CFF6DA',
    'Book': '#B9EEDC',
    'Electronic': '#D8D8FA',
    'Clothing': '#B8C5FF',
    'Shoe': '#FAD8EB',
    'Accessory': '#FADCB8',
    'Home & Living': '#FFE5D0',
    'Toy': '#CFF6DA',
    'Beauty': '#B9EEDC',
  }

  const handleCategorySelect = (category: string) => {
    setSelectedCategory(category)
    if (category === 'All') {
      setSearchTerm('')
      setFilters(prev => ({ ...prev, keyword: '', page: 1 }))
      setHasSearched(true)
      return
    }
    setSearchTerm(category)
    setFilters(prev => ({ ...prev, keyword: category, page: 1 }))
    setHasSearched(true)
  }

  // Load products immediately on component mount
  useEffect(() => {
  // Always fetch latest 10 available products on mount (default feed)
  searchProducts({ ...filters, status: 'available', limit: 10, page: 1 })
  setHasSearched(false)
  // empty deps intentional — only once on mount
  }, [])

  // Refetch when navigating back to Home route to ensure newest items appear
  useEffect(() => {
    if (location.pathname === '/home') {
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
      if (window.location.pathname === '/home') {
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
  const [selectedProductForOffers, setSelectedProductForOffers] = useState<number | null>(null)
  const [offersModalOpen, setOffersModalOpen] = useState(false)
  const [offersForProduct, setOffersForProduct] = useState<any[]>([])
  const [loadingOffers, setLoadingOffers] = useState(false)

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

  const handleViewOffers = async (productId: number) => {
    try {
      setLoadingOffers(true)
      setSelectedProductForOffers(productId)
      const response = await api.get(`/api/trades?target_product_id=${productId}`)
      setOffersForProduct(response.data?.data || [])
      setOffersModalOpen(true)
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to load offers for this product',
        status: 'error',
        duration: 3000,
        isClosable: true,
      })
    } finally {
      setLoadingOffers(false)
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

  const handleLogout = () => {
    logout()
    onCloseLogoutModal()
    navigate('/login')
  }

  // Add state for offer sorting
  const [offersSortBy, setOffersSortBy] = useState<'newest' | 'oldest' | 'accepted'>('accepted')

  const getRankedOffers = () => {
    const ranked = [...offersForProduct]
    
    if (offersSortBy === 'accepted') {
      ranked.sort((a, b) => {
        const statusOrder = { 'accepted': 0, 'active': 1, 'pending': 2, 'declined': 3, 'cancelled': 3 }
        const aOrder = statusOrder[a.status as keyof typeof statusOrder] ?? 4
        const bOrder = statusOrder[b.status as keyof typeof statusOrder] ?? 4
        return aOrder - bOrder
      })
    } else if (offersSortBy === 'newest') {
      ranked.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    } else if (offersSortBy === 'oldest') {
      ranked.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    }
    
    return ranked
  }

  // Product card with square image and fixed info area for uniform height
  const renderProductCard = (product: any) => (
    <Box
      key={product.id}
      bg="white"
      rounded="lg"
      shadow="sm"
      borderWidth="1px"
      borderColor="gray.100"
      overflow="hidden"
      transition="all 0.2s ease"
      w="full"
      display="flex"
      flexDirection="column"
      h="100%" // ensure card fills the grid cell
      _hover={{ boxShadow: 'md', transform: 'translateY(-2px)', cursor: 'pointer' }}
      onClick={() => navigate(getProductUrl(product))}
    >
      {/* Image container: use the same responsive height as the slider so sizes match */}
      <Box position="relative" w="full" overflow="hidden" h={{ base: 140, md: 200, lg: 220 }}>
        <Image
          src={getFirstImage(product.image_urls)}
          alt={product.title}
          w="100%"
          h="100%"
          objectFit="cover"
          loading="lazy"
          fallbackSrc="https://via.placeholder.com/600x600?text=No+Image"
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
            <StarIcon mr={0} />
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
        {product.status === 'sold' && (
          <Badge
            position="absolute"
            bottom={2}
            right={2}
            colorScheme="red"
            variant="solid"
            borderRadius="full"
            px={2}
          >
            Sold
          </Badge>
        )}

        {/* Location Badge - New */}
        <Badge
          position="absolute"
          bottom={2}
          left={2}
          colorScheme="gray"
          variant="solid"
          borderRadius="full"
          px={2}
          bg="blackAlpha.600"
          color="white"
          fontSize="xs"
        >
          <Text as="span" mr={1}>📍</Text>
          {product.distance || '1.2km nearby'}
        </Badge>
      </Box>

      {/* Product Info: flex so cards stay equal height; buttons pinned to bottom */}
      <Box p={4} display="flex" flexDirection="column" flex="1 1 auto" overflow="hidden">
        <Flex justify="space-between" align="center" mb={2}>
          <HStack spacing={2}>
            <Box
              as={RouterLink}
              to={`/users/${product.seller_id}`}
              w={7}
              h={7}
              rounded="full"
              bg="brand.500"
              display="flex"
              alignItems="center"
              justifyContent="center"
              flexShrink={0}
              cursor="pointer"
              _hover={{ opacity: 0.8 }}
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
            >
              <Text fontSize="md" fontWeight="bold" color="white">
                {(product.seller_name || 'U').charAt(0).toUpperCase()}
              </Text>
            </Box>
            <Text fontSize="sm" color="black" fontWeight="medium" noOfLines={1}>
              {product.seller_name || 'Unknown'}
            </Text>
          </HStack>
          <Badge 
            fontSize="xs" 
            colorScheme="blue" 
            flexShrink={0}
            borderWidth="1px"
          >
            {product.condition || 'Used'}
          </Badge>
        </Flex>

        <Heading size="sm" noOfLines={2} mb={2} color="gray.800" flexShrink={0}>
          {product.title}
        </Heading>
        
        <Text 
          color="gray.600" 
          noOfLines={{ base: 1, md: 2 }} 
          mb={3} 
          fontSize="sm" 
          flexShrink={0}
        >
          {product.description 
            ? product.description
                .split(' ')
                .slice(0, product.description.split(' ').length > 15 ? 8 : 15)
                .join(' ') + (product.description.split(' ').length > 15 ? '...' : '')
            : 'No description available'
          }
        </Text>

        {/* Action Buttons */}
        <HStack spacing={2} mt="auto">
          <Button
            size="sm"
            variant="outline"
            colorScheme="brand"
            flex={1}
            onClick={(e) => {
              e.stopPropagation()
              handleTradeClick(product.id)
            }}
            isDisabled={product.status === 'sold'}
          >
            {product.status === 'sold' ? 'Sold' : 'Trade'}
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
              isDisabled={product.status === 'sold'}
            >
              {product.status === 'sold' ? 'Sold' : 'Buy'}
            </Button>
          )}

          {/* New: View Offers Button */}
          <Tooltip label={`View offers (${product.offer_count || 0})`} placement="top">
            <IconButton
              aria-label="View offers"
              icon={<FaHandshake />}
              size="sm"
              variant="outline"
              colorScheme="blue"
              onClick={(e) => {
                e.stopPropagation()
                handleViewOffers(product.id)
              }}
              isDisabled={product.status === 'sold'}
            />
          </Tooltip>
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
          <HStack w="full" maxW="8xl" mx="auto" spacing={3} wrap="wrap">
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

            {/* Hidden on mobile to keep header compact: Search button (desktop only) */}
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

            {/* Profile button (desktop only) with Popover */}
            {user && (
              <Popover placement="bottom-end" trigger="hover">
                <PopoverTrigger>
                  <IconButton
                    aria-label="Profile"
                    icon={<FaUserCircle />}
                    variant="ghost"
                    size="lg"
                    display={{ base: 'none', md: 'inline-flex' }}
                    _hover={{ bg: 'gray.100' }}
                    onClick={() => navigate(`/users/${user.id}`)}
                  />
                </PopoverTrigger>
                <PopoverContent w="72" shadow="lg">
                  <PopoverBody p={4}>
                    <VStack align="stretch" spacing={3}>
                      {/* User Info */}
                      <Box>
                        <Text fontWeight="semibold" fontSize="sm" color="gray.800">
                          {user.name || 'User'}
                        </Text>
                        <Text fontSize="xs" color="gray.500">
                          {user.email}
                        </Text>
                        {user && (user as any).is_premium && (
                          <Badge colorScheme="yellow" fontSize="xs" mt={2}>
                            ⭐ Premium Member
                          </Badge>
                        )}
                      </Box>
                      <Divider />
                      {/* Action Buttons */}
                      <Button
                        as={RouterLink}
                        to="/settings"
                        size="sm"
                        variant="outline"
                        w="full"
                        fontSize="sm"
                      >
                        Settings
                      </Button>
                      <Button
                        as={RouterLink}
                        to="/dashboard"
                        size="sm"
                        variant="outline"
                        w="full"
                        fontSize="sm"
                      >
                        Dashboard
                      </Button>
                      <Divider />
                      <Button
                        size="sm"
                        colorScheme="red"
                        variant="outline"
                        w="full"
                        fontSize="sm"
                        onClick={onOpenLogoutModal}
                      >
                        Logout
                      </Button>
                    </VStack>
                  </PopoverBody>
                </PopoverContent>
              </Popover>
            )}

            {!user && (
              <IconButton
                as={RouterLink}
                to="/profile"
                aria-label="Profile"
                icon={<FaUserCircle />}
                variant="ghost"
                size="lg"
                display={{ base: 'none', md: 'inline-flex' }}
              />
            )}
          </HStack>

          {/* Expandable Filters */}
          {showFilters && (
            <Box 
              position="absolute"
              top="100%"
              left="50%"
              w="full"
              bg="white"
              p={4}
              rounded="lg"
              shadow="md"
              zIndex={50}
              maxW="6xl"
              mx="auto"
              transform="translateX(-50%)"
            >
              <Grid templateColumns="repeat(auto-fit, minmax(150px, 1fr))" gap={3}>
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
                    aria-label="Listing type"
                    title="Listing type"
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
                    aria-label="Trade type"
                    title="Trade type"
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
                    aria-label="Listing status"
                    title="Listing status"
                    value={filters.status || ''}
                    onChange={(e) => handleFilterChange('status', e.target.value)}
                    size="sm"
                  >
                    <option value="available">Available</option>
                    <option value="sold">Sold</option>
                    <option value="traded">Traded</option>
                  </Select>
                </FormControl>

                <FormControl>
                  <FormLabel fontSize="sm" color="gray.600">&nbsp;</FormLabel>
                  <Button
                    size="xs"
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
        maxW={{ base: 'calc(100% - 32px)', md: '100%', lg: '1160', xl: '1415px' }}
        mx="auto"
        mb={8}
        px={{ base: 2, md: 4 }}
      >
        <Box
          position="relative"
          overflow="hidden"
          h={{ base: 140, md: 200, lg: 220 }}
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
                onClick={(e: React.MouseEvent<HTMLButtonElement>) => { e.stopPropagation(); setSlideIndex(i); scheduleResume(2000) }}
              />
            ))}
          </HStack>
        </Box>
      </Box>
      {/* Horizontal category pills under search bar */}
      <Box px={{ base: 3, md: 7 }} py={0}>
        <Box
          w="full"
          maxW="8xl"
          mx="auto"
          rounded="lg"
          px={{ base: 0, md: 0 }}
          py={{ base: 0, md: 0 }}
        >
          <HStack
            spacing={{ base: 2, md: 2.5 }}
            overflowX="auto"
            whiteSpace="nowrap"
            align="center"
            pb={2}
            sx={{
              '::-webkit-scrollbar': { 
                display: 'none',
                height: '0px',
              },
              msOverflowStyle: 'none',
              scrollbarWidth: 'none',
              '&': {
                scrollBehavior: 'smooth',
              }
            }}
          >
            {categories.map((cat) => {
              const isSelected = selectedCategory === cat
              const bgColor = isSelected ? 'gray.200' : (categoryColors[cat] || 'gray.100')
              
              return (
                <Box key={cat} flexShrink={0} pl={3}>
                  <Button
                    size="sm"
                    rounded="full"
                    px={{ base: 4, md: 8 }}
                    py={{ base: 2, md: 2.5 }}
                    fontWeight="medium"
                    variant="solid"
                    bg={bgColor}
                    _hover={{ 
                      filter: 'brightness(0.85)',
                      transform: 'scale(1.02)',
                    }}
                    color="gray.800"
                    border={isSelected ? '2px solid' : '1px solid'}
                    borderColor={isSelected ? 'gray.400' : 'transparent'}
                    onClick={() => handleCategorySelect(cat)}
                    transition="all 0.2s ease"
                  >
                    {cat}
                  </Button>
                </Box>
              )
            })}
          </HStack>
        </Box>
      </Box>
      {/* Main Content */}
      <Box px={{ base: 3, md: 8 }} py={8}>
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

     {/* Products Grid - Shopee/Lazada Style */}
     {!loading && products.length > 0 && (
  <Box
    maxW={{ base: 'calc(100% - 12px)', md: '100%' }}
    mx="auto"
    px={{ base: 2, md: 4 }}
  >
    <Grid
      templateColumns={{ base: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)', lg: 'repeat(4, 1fr)', xl: 'repeat(5, 1fr)' }}
      gap={{ base: 3, md: 4 }}
      alignItems="stretch" // force grid cells to match heights
     >
       {products
         .filter((p) => p.status === 'available' && p.seller_id !== user?.id)
         .map((product) => (
          <Box key={product.id} h="100%"> {/* ensure grid item fills track height */}
            {renderProductCard(product)}
          </Box>
         ))}
     </Grid>

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

      {/* Logout Confirmation Modal */}
      <Modal isOpen={isLogoutModalOpen} onClose={onCloseLogoutModal} isCentered>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Confirm Logout</ModalHeader>
          <ModalCloseButton />
          <ModalBody>
            <Text>Are you sure you want to logout?</Text>
          </ModalBody>
          <Box p={4} display="flex" gap={3} justifyContent="flex-end">
            <Button variant="outline" onClick={onCloseLogoutModal}>
              Cancel
            </Button>
            <Button colorScheme="red" onClick={handleLogout}>
              Logout
            </Button>
          </Box>
        </ModalContent>
      </Modal>

      {/* Offers Modal - Simplified with Ranking */}
      <Modal isOpen={offersModalOpen} onClose={() => setOffersModalOpen(false)} size="2xl">
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>
            <HStack justify="space-between" w="full">
              <Heading size="md" color="brand.600">
                Offers ({offersForProduct.length})
              </Heading>
              <IconButton
                aria-label="Close"
                icon={<CloseIcon />}
                variant="ghost"
                onClick={() => setOffersModalOpen(false)}
              />
            </HStack>
          </ModalHeader>

          <ModalBody pb={6}>
            {loadingOffers ? (
              <Center py={8}>
                <Spinner color="brand.500" />
              </Center>
            ) : getRankedOffers().length === 0 ? (
              <Box textAlign="center" py={8}>
                <Text color="gray.600">No offers yet</Text>
              </Box>
            ) : (
              <VStack spacing={3} align="stretch">
                {getRankedOffers().map((offer: any, index: number) => (
                  <Box
                    key={offer.id}
                    p={4}
                    borderWidth="2px"
                    borderColor={index === 0 ? 'gold' : offer.status === 'accepted' ? 'green.400' : 'gray.200'}
                    rounded="lg"
                    bg={index === 0 ? 'yellow.50' : offer.status === 'accepted' ? 'green.50' : 'white'}
                    position="relative"
                  >
                    {/* Rank Badge */}
                    <Badge
                      position="absolute"
                      top={-3}
                      left={4}
                      colorScheme={index === 0 ? 'yellow' : index === 1 ? 'gray' : index === 2 ? 'orange' : 'gray'}
                      fontSize="xs"
                      px={2}
                      py={1}
                    >
                      #{index + 1}
                    </Badge>

                    <HStack justify="space-between" mb={2} mt={2}>
                      <HStack>
                        {index === 0 && (
                          <Text fontSize="lg">🏆</Text>
                        )}
                        <Text fontWeight="bold" fontSize="sm">
                          {offer.buyer_name || 'Anonymous'}
                        </Text>
                      </HStack>
                      <Badge
                        colorScheme={
                          offer.status === 'accepted' ? 'green' :
                          offer.status === 'pending' ? 'yellow' : 'gray'
                        }
                        fontSize="xs"
                      >
                        {offer.status.toUpperCase()}
                      </Badge>
                    </HStack>

                    <Text fontSize="sm" color="gray.600" mb={2}>
                      {offer.items?.length || 0} item(s) offered
                    </Text>

                    <HStack spacing={2} flexWrap="wrap">
                      {offer.items && offer.items.map((item: any, idx: number) => (
                        <Badge key={idx} colorScheme="blue" variant="outline" fontSize="xs">
                          {item.product_title?.substring(0, 15) || `Item ${idx + 1}`}
                        </Badge>
                      ))}
                    </HStack>
                  </Box>
                ))}
              </VStack>
            )}
          </ModalBody>
        </ModalContent>
      </Modal>

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

export default Home

{/*}
import React from 'react';
import { DotLottieReact } from '@lottiefiles/dotlottie-react';

const App = () => {
  return (
    <DotLottieReact
      src="path/to/animation.lottie"
      loop
      autoplay
    />
  );
};
*/}