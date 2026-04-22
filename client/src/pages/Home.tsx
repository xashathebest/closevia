import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
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
  Icon,
  Avatar,
} from '@chakra-ui/react'
import {
  SearchIcon,
  RepeatIcon,
  StarIcon,
  ViewIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  AddIcon,
  BellIcon,
  HamburgerIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  CloseIcon,
  SmallCloseIcon,
} from '@chakra-ui/icons'
import { InputRightElement } from '@chakra-ui/react'
import { FaUserCircle, FaHandshake, FaHome, FaTag, FaMotorcycle, FaCrown } from 'react-icons/fa'
import { FiShoppingBag, FiDownload } from 'react-icons/fi'
import { FILTER_CATEGORIES } from '../utils/categories'
import { useProducts } from '../contexts/ProductContext'
import { useAuth } from '../contexts/AuthContext'
import { SearchFilters, SearchSuggestions } from '../types'
import { getFirstImage, getImageUrl } from '../utils/imageUtils'
import { formatPHP } from '../utils/currency'
import { getProductUrl } from '../utils/productUtils'
import { useMobileNav } from '../contexts/MobileNavContext'
import { api } from '../services/api'
import TradeModal from '../components/TradeModal'
import BuyoutModal from '../components/BuyoutModal'
import { useRealtime } from '../contexts/RealtimeContext' // added import
import FloatingTab from '../components/FloatingTab'
import { useStudentAdInjection, StudentAdCard } from '../components/StudentAdInjector'
import VerifiedAvatar from '../components/VerifiedAvatar'
import ProductCard from '../components/ProductCard'
import { ProductGridSkeleton } from '../components/ProductSkeleton'
import ActivityFeed from '../components/ActivityFeed'
import { useTradeMatchScores } from '../hooks/useTradeMatchScore'
import InstallAppPrompt from '../components/InstallAppPrompt'
import AdvertisementCarousel from '../components/AdvertisementCarousel'
import AppDownloadBanner from '../components/AppDownloadBanner'
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

  // Rider status for profile dropdown
  const [riderStatus, setRiderStatus] = useState<{ is_rider: boolean; status?: string } | null>(null)

  useEffect(() => {
    if (user) {
      api.get('/api/deliveries/rider-status').then(res => {
        if (res.data?.success) setRiderStatus(res.data.data)
      }).catch(() => {})
      
      // Location reminder
      if (!(user as any).home_address) {
        setShowLocationReminder(true)
      }
    }
  }, [user])

  // Search state management
  const [showLocationReminder, setShowLocationReminder] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [filters, setFilters] = useState<SearchFilters>({
    keyword: '',
    premium: undefined,
    condition: undefined,
    verified_seller_only: undefined,
    has_active_offers: undefined,
    sort_by: 'most_relevant',
    barter_only: undefined, // Show all by default
    page: 1,
    limit: 20, // Load more products
  })
  const [hasSearched, setHasSearched] = useState(false)

  // Smart search suggestions state
  const [suggestions, setSuggestions] = useState<SearchSuggestions>({ products: [], categories: [], tags: [], brands: [], users: [] })
  const [showSuggestions, setShowSuggestions] = useState(false)
  const [suggestionsLoading, setSuggestionsLoading] = useState(false)
  const searchContainerRef = useRef<HTMLDivElement>(null)
  const debouncedSuggestionTerm = useDebounce(searchTerm, 500)

  // Fetch search suggestions
  useEffect(() => {
    if (debouncedSuggestionTerm.trim().length < 2) {
      setSuggestions({ products: [], categories: [], tags: [], brands: [], users: [] })
      setShowSuggestions(false)
      return
    }
    let cancelled = false
    const fetchSuggestions = async () => {
      setSuggestionsLoading(true)
      try {
        const [productRes, userRes, orgRes] = await Promise.all([
          api.get(`/api/products/search-suggestions?q=${encodeURIComponent(debouncedSuggestionTerm.trim())}`),
          api.get(`/api/users/search?q=${encodeURIComponent(debouncedSuggestionTerm.trim())}&limit=5`),
          api.get(`/api/organizations?q=${encodeURIComponent(debouncedSuggestionTerm.trim())}&limit=5`),
        ])
        if (!cancelled && productRes.data?.success && productRes.data?.data) {
          const users = userRes.data?.success && Array.isArray(userRes.data?.data) ? userRes.data.data : []
          const organizations = orgRes.data?.success && Array.isArray(orgRes.data?.data) ? orgRes.data.data : []
          const merged: SearchSuggestions & { organizations?: any[] } = {
            ...productRes.data.data,
            users,
            organizations,
          }
          setSuggestions(merged)
          const d = merged
          const hasResults = d.products?.length > 0 || d.categories?.length > 0 || d.tags?.length > 0 || d.brands?.length > 0 || (d.users?.length || 0) > 0 || (d.organizations?.length || 0) > 0
          setShowSuggestions(hasResults)
        }
      } catch {
        // Silently fail — suggestions are non-critical
      } finally {
        if (!cancelled) setSuggestionsLoading(false)
      }
    }
    fetchSuggestions()
    return () => { cancelled = true }
  }, [debouncedSuggestionTerm])

  // Close suggestions on outside click
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Debounce search term for smooth UX
  const debouncedSearchTerm = useDebounce(searchTerm, 400)

  const toast = useToast()

  // Category pills - shared config
  const categories = FILTER_CATEGORIES
  const [selectedCategory, setSelectedCategory] = useState<string>('All')
  
  // Track the category being transitioned to for instant visual feedback
  const [transitingCategory, setTransitingCategory] = useState<string | null>(null)
  
  // Track if we're actively loading a category change
  const [isLoadingCategoryChange, setIsLoadingCategoryChange] = useState(false)

  const handleCategorySelect = (categoryValue: string) => {
    // Instant visual feedback on click
    setTransitingCategory(categoryValue)
    
    // Mark that we're loading a category change
    setIsLoadingCategoryChange(true)
    
    // Update the selected category
    setSelectedCategory(categoryValue)
    
    if (categoryValue === 'All') {
      setSearchTerm('')
      setFilters(prev => ({ ...prev, keyword: '', category: '', page: 1 }))
      setHasSearched(true)
      return
    }
    setSearchTerm('')
    setFilters(prev => ({ ...prev, keyword: '', category: categoryValue, page: 1 }))
    setHasSearched(true)
  }

  // Load products on component mount or when navigating back to /home
  useEffect(() => {
    // Reset category and search state to defaults on mount
    setSelectedCategory('All')
    setSearchTerm('')
    // Trigger a single initial fetch through the filters effect
    setFilters(prev => ({ ...prev, keyword: '', category: '', page: 1, limit: 20 }))
    setHasSearched(true)

    // Set flag so returning users bypass landing page
    localStorage.setItem('has_visited', 'true')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Clear the transiting state and loading flag after products have loaded
  useEffect(() => {
    if (transitingCategory && selectedCategory === transitingCategory && !loading) {
      // Clear transiting state once products are loaded
      setTransitingCategory(null)
    }
    if (isLoadingCategoryChange && !loading) {
      setIsLoadingCategoryChange(false)
    }
  }, [selectedCategory, transitingCategory, loading, isLoadingCategoryChange])

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

  // DISABLED: Do NOT refetch on tab/window focus to keep persistent cache
  // The cached products will remain on screen even when switching tabs
  useEffect(() => {
    // Window focus events disabled to maintain persistent data
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Update filters when debounced search term changes
  useEffect(() => {
    if (debouncedSearchTerm.trim() === '') {
      // Search was cleared — reset to show all products
      setFilters(prev => {
        // Only trigger refetch if there was a keyword before
        if (prev.keyword) {
          setHasSearched(true)
          return { ...prev, keyword: '', page: 1 }
        }
        return prev
      })
      return
    }
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

  const handleSearch = async () => {
    setSelectedCategory('All')
    setShowSuggestions(false)
    
    const term = searchTerm.trim()
    const termLower = term.toLowerCase()
    
    
    // Check if search term matches an organization in current suggestions
    const matchedOrg = organizationSuggestions.find(org => {
      const orgNameLower = (org.org_name || org.name || '').toLowerCase()
      return orgNameLower === termLower
    })
    
    if (matchedOrg) {
      // Navigate directly to the organization page
      const orgHandle = matchedOrg.org_handle || matchedOrg.slug
      if (orgHandle) {
        navigate(`/org/${orgHandle}`)
        return
      }
    }
    
    // Fallback: Check API for organization if not in suggestions
    if (term.length >= 2) {
      try {
        const response = await api.get(`/api/organizations?q=${encodeURIComponent(term)}&limit=1`)
        if (response.data?.success && Array.isArray(response.data?.data) && response.data.data.length > 0) {
          const org = response.data.data[0]
          const orgHandle = org.org_handle || org.slug
          if (orgHandle) {
            navigate(`/org/${orgHandle}`)
            return
          }
        }
      } catch (error) {
        // API call failed, continue with product search
        console.error('❌ [Search] Error checking for organization:', error)
      }
    }
    
    // Otherwise, do a regular product keyword search
    // Detect natural language queries for smart search
    const smartSignals = ['near me', 'nearby', 'cheap', 'budget', 'expensive', 'under ', 'below ', 'above ']
    const isSmartQuery = termLower.split(/\s+/).length >= 2 && smartSignals.some(s => termLower.includes(s))
    setFilters(prev => ({ ...prev, keyword: searchTerm, category: '', page: 1, useSmartSearch: isSmartQuery || undefined }))
    setHasSearched(true)
  }

  const handleSuggestionClick = (
    text: string,
    type: 'product' | 'category' | 'tag' | 'brand' | 'user',
    userId?: number,
    selectedUser?: NonNullable<SearchSuggestions['users']>[number]
  ) => {
    setShowSuggestions(false)
    if (type === 'user' && userId) {
      if (selectedUser?.is_organization) {
        const orgHandle = selectedUser.org_handle || selectedUser.slug
        if (orgHandle) {
          navigate(`/org/${orgHandle}`)
          return
        }
      }
      navigate(`/users/${selectedUser?.slug || userId}`)
      return
    }
    if (type === 'category') {
      setSearchTerm('')
      setSelectedCategory(text)
      setFilters(prev => ({ ...prev, keyword: '', category: text, page: 1, useSmartSearch: undefined }))
    } else {
      setSearchTerm(text)
      setSelectedCategory('All')
      setFilters(prev => ({ ...prev, keyword: text, category: '', page: 1, useSmartSearch: undefined }))
    }
    setHasSearched(true)
  }

  const handleRetrySearch = () => {
    // Clear error and retry with current filters
    searchProducts(filters)
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

  // Buyout modal state
  const { isOpen: buyoutOpen, onOpen: onBuyoutOpen, onClose: onBuyoutClose } = useDisclosure()
  const [buyoutTargetProductId, setBuyoutTargetProductId] = useState<number | null>(null)

  // Slider state: cycles public/1.jpg, public/2.jpg, public/3.jpg every 3s
  const sliderImages = ['/1.jpg', '/2.jpg', '/3.jpg']
  const [slideIndex, setSlideIndex] = useState(0)
  const sliderIntervalRef = useRef<number | null>(null)
  const resumeTimeoutRef = useRef<number | null>(null)
  const touchStartX = useRef<number | null>(null)

  const startAuto = () => {
    // Auto-advance disabled to prevent dizziness
    // Slider now only changes on user interaction (swipe/click)
  }

  const stopAuto = () => {
    if (sliderIntervalRef.current) {
      window.clearInterval(sliderIntervalRef.current)
      sliderIntervalRef.current = null
    }
  }

  const scheduleResume = (delay = 2000) => {
    // Resume logic disabled - slider stays on user-selected slide
    stopAuto()
  }

  useEffect(() => {
    // Auto-start disabled - slider stays on initial image
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

  const openTradeModal = useCallback(async (productId: number) => {
    setTradeTargetProductId(productId)
    onOpen()
  }, [onOpen])

  const handleTradeClick = useCallback((productId: number) => {
    if (!user) {
      onOpen() // Show login modal
    } else {
      openTradeModal(productId)
    }
  }, [user, onOpen, openTradeModal])

  const handleBuyClick = useCallback((productId: number) => {
    if (!user) {
      onOpen() // Show login modal
    } else {
      // Proceed with purchase
      toast({
        id: "home-purchase-initiated",
        title: 'Purchase initiated!',
        description: 'Contact the trader to complete the purchase.',
        status: 'success',
        duration: 3000,
        isClosable: true,
      })
    }
  }, [user, onOpen, toast])

  const handleBuyoutClick = useCallback((productId: number) => {
    if (!user) {
      onOpen() // Show login modal
    } else {
      setBuyoutTargetProductId(productId)
      onBuyoutOpen()
    }
  }, [user, onOpen, onBuyoutOpen])

  const handleViewOffers = useCallback(async (productId: number) => {
    // Open modal immediately, load data in background
    setSelectedProductForOffers(productId)
    setOffersForProduct([])
    setLoadingOffers(true)
    setOffersModalOpen(true)
    try {
      const response = await api.get(`/api/trades`, {
        params: {
          limit: 100
        }
      })
      const filteredOffers = (response.data?.data || []).filter(
        (trade: any) => trade.target_product_id === productId && trade.status !== 'cancelled'
      )
      setOffersForProduct(filteredOffers)
    } catch (error) {
      toast({
        id: "home-error",
        title: 'Error',
        description: 'Failed to load offers for this product',
        status: 'error',
        duration: 3000,
        isClosable: true,
      })
    } finally {
      setLoadingOffers(false)
    }
  }, [toast])

  const clearFilters = useCallback(() => {
    setSearchTerm('')
    setSelectedCategory('All')
    setFilters({
      keyword: '',
      premium: undefined,
      condition: undefined,
      verified_seller_only: undefined,
      has_active_offers: undefined,
      sort_by: 'most_relevant',
      barter_only: undefined,
      page: 1,
      limit: 20,
    })
    setHasSearched(true)
  }, [])

  const handleLogout = useCallback(() => {
    logout()
    onCloseLogoutModal()
    navigate('/login')
  }, [logout, onCloseLogoutModal, navigate])

  const userSuggestions = useMemo(
    () => (suggestions.users || []).filter((u) => !u.is_organization),
    [suggestions.users]
  )

  const organizationSuggestions = useMemo(
    () => {
      const userOrgs = (suggestions.users || []).filter((u) => u.is_organization);
      const communityOrgs = (suggestions as any).organizations || [];
      // Combine and add a flag to distinguish them if needed
      return [
        ...userOrgs.map(u => ({ ...u, type: 'user_org' })),
        ...communityOrgs.map((o: any) => ({ ...o, is_organization: true, type: 'community_org' }))
      ];
    },
    [suggestions.users, (suggestions as any).organizations]
  )

  // Add state for offer sorting
  const [offersSortBy, setOffersSortBy] = useState<'newest' | 'oldest' | 'accepted'>('accepted')

  // Memoize ranked offers calculation to prevent unnecessary re-computation
  const rankedOffers = useMemo(() => {
    const ranked = [...offersForProduct]

    if (offersSortBy === 'accepted') {
      ranked.sort((a, b) => {
        const statusOrder = { 'accepted': 0, 'active': 1, 'pending': 2, 'declined': 3, 'cancelled': 3 }
        const aOrder = statusOrder[a.status as keyof typeof statusOrder] ?? 4
        const bOrder = statusOrder[b.status as keyof typeof statusOrder] ?? 4
        if (aOrder !== bOrder) return aOrder - bOrder
        // Within same status, rank by total value (cash + item count)
        const aValue = (a.offered_cash_amount || 0) + (a.items?.length || 0) * 100
        const bValue = (b.offered_cash_amount || 0) + (b.items?.length || 0) * 100
        return bValue - aValue
      })
    } else if (offersSortBy === 'newest') {
      ranked.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    } else if (offersSortBy === 'oldest') {
      ranked.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    }

    return ranked
  }, [offersForProduct, offersSortBy])

  // Trade match scores for logged-in users
  const tradeScores = useTradeMatchScores(products)

  // Product card rendering now handled by memoized ProductCard component

  // Component to render product grid with git pull --no-edit injections
  const ProductGridWithAds: React.FC<{ products: any[]; user: any }> = ({ products, user }) => {
    const filteredProducts = products.filter((p) => p.status === 'available')

    // Use the ad injection hook
    const { shouldInsertAdAt, getAdForPosition, getAdIndexAt } = useStudentAdInjection(
      filteredProducts.length,
      undefined, // Use default ads
      { min: 3, max: 6 } // Insertion interval
    )

    // Build the combined list with ads
    const itemsWithAds: Array<{ type: 'product' | 'ad'; data: any; index: number }> = []

    filteredProducts.forEach((product, idx) => {
      itemsWithAds.push({
        type: 'product',
        data: product,
        index: idx,
      })

      // Check if ad should be inserted after this product
      if (shouldInsertAdAt(idx + 1)) {
        const ad = getAdForPosition(getAdIndexAt(idx + 1))
        if (ad) {
          itemsWithAds.push({
            type: 'ad',
            data: ad,
            index: idx + 1,
          })
        }
      }
    })

    return (
      <Grid
        templateColumns={{
          base: 'repeat(2, 1fr)',
          sm: 'repeat(3, 1fr)',
          md: 'repeat(5, 1fr)',
        }}
        gap={{ base: 2, md: 3 }}
        w="full"
        sx={{
          '& > *': {
            minW: 0,
          },
        }}
      >
        {itemsWithAds.map((item, displayIndex) =>
          item.type === 'product' ? (
            <Box key={`product-${item.data.id}`} w="full" h="full">
              {(() => {
                const scoreDetail = tradeScores.get(item.data.id)
                return (
              <ProductCard
                product={{
                  ...item.data,
                  tradeMatchScore: scoreDetail?.total,
                  tradeMatchBreakdown: scoreDetail,
                }}
                onTradeClick={handleTradeClick}
                onBuyoutClick={handleBuyoutClick}
                onBuyClick={handleBuyClick}
                onViewOffers={handleViewOffers}
                showPriceOverlay
              />
                )
              })()}
            </Box>
          ) : (
            <Box key={`ad-${item.data.id}-${item.index}-${displayIndex}`} w="full" h="full">
              <StudentAdCard ad={item.data} />
            </Box>
          )
        )}
      </Grid>
    )
  }

  return (
    <Box minH="100vh" bg="#FFFDF1">
      <AppDownloadBanner variant="card" position="top" />
      {/* Sticky Search Header - desktop: centered max-width */}
      <Box
        position="sticky"
        top={0}
        zIndex={100}
        bg="#FFFDF1"
        borderColor="gray.200"
        px={{ base: 3, md: 6, lg: 8, xl: 10 }}
        py={{ base: 3, md: 4 }}
      >
        <VStack
          spacing={4}
          w="full"
          maxW={{ lg: '1600px', xl: '1620px', '2xl': '1920px' }}
          mx={{ base: 'auto', lg: 0 }}
          ml={{ base: 0, md: -2, lg: -6, xl: -8 }}
          position="relative"
        >
          {/* Main Search Bar - Full width on mobile, inline on desktop */}
          {/* Mobile: Stacked layout */}
          <VStack w="full" spacing={2} align="stretch" ref={searchContainerRef} display={{ base: 'flex', md: 'none' }}>
            {/* Search Input - Full width on mobile */}
            <Box position="relative" w="full">
              <InputGroup size="lg">
                <InputLeftElement pointerEvents="none">
                  <SearchIcon color="gray.400" />
                </InputLeftElement>
                <Input
                  placeholder="Search products, categories, or keywords..."
                  value={searchTerm}
                  onChange={(e) => { setSearchTerm(e.target.value); if (e.target.value.trim().length >= 2) setShowSuggestions(true) }}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); if (e.key === 'Escape') setShowSuggestions(false) }}
                  onFocus={() => { if (searchTerm.trim().length >= 2 && (suggestions.products.length > 0 || suggestions.categories.length > 0 || suggestions.tags.length > 0 || suggestions.brands.length > 0 || (suggestions.users?.length || 0) > 0)) setShowSuggestions(true) }}
                  bg="white"
                  border="2px"
                  borderColor="gray.200"
                  _focus={{
                    borderColor: "brand.500",
                    boxShadow: "0 0 0 1px var(--chakra-colors-brand-500)"
                  }}
                  pr="40px"
                />
                {/* Filter icon inside search - mobile only */}
                <InputRightElement pointerEvents="auto">
                  <IconButton
                    aria-label="Toggle filters"
                    icon={showFilters ? <ChevronUpIcon /> : <ChevronDownIcon />}
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowFilters(!showFilters)}
                  />
                </InputRightElement>
              </InputGroup>

              {/* Search Suggestions Dropdown - Mobile */}
              {showSuggestions && (
                <Box
                  position="absolute"
                  top="calc(100% + 4px)"
                  left={0}
                  right={0}
                  w="100%"
                  bg="white"
                  border="1px solid"
                  borderColor="gray.200"
                  rounded="xl"
                  shadow="0 4px 20px rgba(0,0,0,0.15)"
                  zIndex={999}
                  maxH="360px"
                  overflowY="auto"
                >
                  {suggestionsLoading ? (
                    <Center py={4}><Spinner size="sm" color="brand.500" /><Text ml={2} fontSize="sm" color="gray.500">Searching...</Text></Center>
                  ) : (
                    <VStack align="stretch" spacing={0} py={2}>
                      {suggestions.products.length > 0 && (
                        <>
                          <Text px={4} pt={2} pb={1} fontSize="xs" fontWeight="bold" color="gray.500" textTransform="uppercase" letterSpacing="wider">Products</Text>
                          {suggestions.products.map((p, i) => (
                            <Box key={`p-${i}`} px={4} py={2} cursor="pointer" _hover={{ bg: 'gray.50' }} onClick={() => handleSuggestionClick(p, 'product')}>
                              <HStack spacing={3}>
                                <SearchIcon color="gray.400" boxSize={3} />
                                <Text fontSize="sm" color="gray.700" noOfLines={1}>{p}</Text>
                              </HStack>
                            </Box>
                          ))}
                        </>
                      )}
                      {suggestions.categories.length > 0 && (
                        <>
                          {suggestions.products.length > 0 && <Box mx={3} my={1} borderTop="1px solid" borderColor="gray.100" />}
                          <Text px={4} pt={2} pb={1} fontSize="xs" fontWeight="bold" color="gray.500" textTransform="uppercase" letterSpacing="wider">Categories</Text>
                          {suggestions.categories.map((c, i) => (
                            <Box key={`c-${i}`} px={4} py={2} cursor="pointer" _hover={{ bg: 'gray.50' }} onClick={() => handleSuggestionClick(c, 'category')}>
                              <HStack spacing={3}>
                                <Icon as={FaTag} color="brand.400" boxSize={3} />
                                <Text fontSize="sm" color="gray.700">{c}</Text>
                              </HStack>
                            </Box>
                          ))}
                        </>
                      )}
                      {suggestions.tags.length > 0 && (
                        <>
                          {(suggestions.products.length > 0 || suggestions.categories.length > 0) && <Box mx={3} my={1} borderTop="1px solid" borderColor="gray.100" />}
                          <Text px={4} pt={2} pb={1} fontSize="xs" fontWeight="bold" color="gray.500" textTransform="uppercase" letterSpacing="wider">Tags</Text>
                          {suggestions.tags.map((t, i) => (
                            <Box key={`t-${i}`} px={4} py={2} cursor="pointer" _hover={{ bg: 'gray.50' }} onClick={() => handleSuggestionClick(t, 'tag')}>
                              <HStack spacing={3}>
                                <Text color="brand.400" fontSize="xs" fontWeight="bold">#</Text>
                                <Text fontSize="sm" color="gray.700">{t}</Text>
                              </HStack>
                            </Box>
                          ))}
                        </>
                      )}
                      {suggestions.brands.length > 0 && (
                        <>
                          {(suggestions.products.length > 0 || suggestions.categories.length > 0 || suggestions.tags.length > 0) && <Box mx={3} my={1} borderTop="1px solid" borderColor="gray.100" />}
                          <Text px={4} pt={2} pb={1} fontSize="xs" fontWeight="bold" color="gray.500" textTransform="uppercase" letterSpacing="wider">Brands</Text>
                          {suggestions.brands.map((b, i) => (
                            <Box key={`b-${i}`} px={4} py={2} cursor="pointer" _hover={{ bg: 'gray.50' }} onClick={() => handleSuggestionClick(b, 'brand')}>
                              <HStack spacing={3}>
                                <StarIcon color="yellow.400" boxSize={3} />
                                <Text fontSize="sm" color="gray.700">{b}</Text>
                              </HStack>
                            </Box>
                          ))}
                        </>
                      )}
                      {userSuggestions.length > 0 && (
                        <>
                          {(suggestions.products.length > 0 || suggestions.categories.length > 0 || suggestions.tags.length > 0 || suggestions.brands.length > 0) && <Box mx={3} my={1} borderTop="1px solid" borderColor="gray.100" />}
                          <Text px={4} pt={2} pb={1} fontSize="xs" fontWeight="bold" color="gray.500" textTransform="uppercase" letterSpacing="wider">Users</Text>
                          {userSuggestions.map((u, i) => (
                            <Box key={`u-${u.id}-${i}`} px={4} py={2} cursor="pointer" _hover={{ bg: 'gray.50' }} onClick={() => handleSuggestionClick(u.name, 'user', u.id, u)}>
                              <HStack spacing={3}>
                                <Avatar size="xs" src={u.profile_picture ? getImageUrl(u.profile_picture) : undefined} name={u.name} />
                                <Text fontSize="sm" color="gray.700" noOfLines={1}>{u.name}</Text>
                              </HStack>
                            </Box>
                          ))}
                        </>
                      )}
                      {organizationSuggestions.length > 0 && (
                        <>
                          {(suggestions.products.length > 0 || suggestions.categories.length > 0 || suggestions.tags.length > 0 || suggestions.brands.length > 0 || userSuggestions.length > 0) && <Box mx={3} my={1} borderTop="1px solid" borderColor="gray.100" />}
                          <Text px={4} pt={2} pb={1} fontSize="xs" fontWeight="bold" color="gray.500" textTransform="uppercase" letterSpacing="wider">Organizations</Text>
                          {organizationSuggestions.map((u, i) => (
                            <Box key={`o-${u.id}-${i}`} px={4} py={2} cursor="pointer" _hover={{ bg: 'gray.50' }} onClick={() => handleSuggestionClick(u.org_name || u.name, 'user', u.id, u)}>
                              <HStack spacing={3}>
                                <Avatar size="xs" src={getImageUrl(u.org_logo_url || u.logo_url || u.profile_picture)} name={u.org_name || u.name} />
                                <Text fontSize="sm" color="gray.700" noOfLines={1}>{u.org_name || u.name}</Text>
                                {(u as any).type === 'community_org' && <Badge size="xs" colorScheme="purple" fontSize="10px">Community</Badge>}
                              </HStack>
                            </Box>
                          ))}
                        </>
                      )}
                    </VStack>
                  )}
                </Box>
              )}
            </Box>
          </VStack>

          {/* Desktop: Horizontal layout with search bar on left, buttons on right */}
          <HStack 
            w="full" 
            spacing={3} 
            display={{ base: 'none', md: 'flex' }}
            align="flex-start"
            ref={searchContainerRef}
          >
            {/* Desktop Search Input */}
            <Box position="relative" flex={1} minW={0}>
              <InputGroup size="lg">
                <InputLeftElement pointerEvents="none">
                  <SearchIcon color="gray.400" />
                </InputLeftElement>
                <Input
                  placeholder="Search products, categories, or keywords..."
                  value={searchTerm}
                  onChange={(e) => { setSearchTerm(e.target.value); if (e.target.value.trim().length >= 2) setShowSuggestions(true) }}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSearch(); if (e.key === 'Escape') setShowSuggestions(false) }}
                  onFocus={() => { if (searchTerm.trim().length >= 2 && (suggestions.products.length > 0 || suggestions.categories.length > 0 || suggestions.tags.length > 0 || suggestions.brands.length > 0 || (suggestions.users?.length || 0) > 0)) setShowSuggestions(true) }}
                  bg="white"
                  border="2px"
                  borderColor="gray.200"
                  _focus={{
                    borderColor: "brand.500",
                    boxShadow: "0 0 0 1px var(--chakra-colors-brand-500)"
                  }}
                />
              </InputGroup>

              {/* Search Suggestions Dropdown - Desktop */}
              {showSuggestions && (
                <Box
                  position="absolute"
                  top="calc(100% + 4px)"
                  left={0}
                  right={0}
                  w="100%"
                  bg="white"
                  border="1px solid"
                  borderColor="gray.200"
                  rounded="xl"
                  shadow="0 4px 20px rgba(0,0,0,0.15)"
                  zIndex={999}
                  maxH="360px"
                  overflowY="auto"
                >
                  {suggestionsLoading ? (
                    <Center py={4}><Spinner size="sm" color="brand.500" /><Text ml={2} fontSize="sm" color="gray.500">Searching...</Text></Center>
                  ) : (
                    <VStack align="stretch" spacing={0} py={2}>
                      {suggestions.products.length > 0 && (
                        <>
                          <Text px={4} pt={2} pb={1} fontSize="xs" fontWeight="bold" color="gray.500" textTransform="uppercase" letterSpacing="wider">Products</Text>
                          {suggestions.products.map((p, i) => (
                            <Box key={`p-${i}`} px={4} py={2} cursor="pointer" _hover={{ bg: 'gray.50' }} onClick={() => handleSuggestionClick(p, 'product')}>
                              <HStack spacing={3}>
                                <SearchIcon color="gray.400" boxSize={3} />
                                <Text fontSize="sm" color="gray.700" noOfLines={1}>{p}</Text>
                              </HStack>
                            </Box>
                          ))}
                        </>
                      )}
                      {suggestions.categories.length > 0 && (
                        <>
                          {suggestions.products.length > 0 && <Box mx={3} my={1} borderTop="1px solid" borderColor="gray.100" />}
                          <Text px={4} pt={2} pb={1} fontSize="xs" fontWeight="bold" color="gray.500" textTransform="uppercase" letterSpacing="wider">Categories</Text>
                          {suggestions.categories.map((c, i) => (
                            <Box key={`c-${i}`} px={4} py={2} cursor="pointer" _hover={{ bg: 'gray.50' }} onClick={() => handleSuggestionClick(c, 'category')}>
                              <HStack spacing={3}>
                                <Icon as={FaTag} color="brand.400" boxSize={3} />
                                <Text fontSize="sm" color="gray.700">{c}</Text>
                              </HStack>
                            </Box>
                          ))}
                        </>
                      )}
                      {suggestions.tags.length > 0 && (
                        <>
                          {(suggestions.products.length > 0 || suggestions.categories.length > 0) && <Box mx={3} my={1} borderTop="1px solid" borderColor="gray.100" />}
                          <Text px={4} pt={2} pb={1} fontSize="xs" fontWeight="bold" color="gray.500" textTransform="uppercase" letterSpacing="wider">Tags</Text>
                          {suggestions.tags.map((t, i) => (
                            <Box key={`t-${i}`} px={4} py={2} cursor="pointer" _hover={{ bg: 'gray.50' }} onClick={() => handleSuggestionClick(t, 'tag')}>
                              <HStack spacing={3}>
                                <Text color="brand.400" fontSize="xs" fontWeight="bold">#</Text>
                                <Text fontSize="sm" color="gray.700">{t}</Text>
                              </HStack>
                            </Box>
                          ))}
                        </>
                      )}
                      {suggestions.brands.length > 0 && (
                        <>
                          {(suggestions.products.length > 0 || suggestions.categories.length > 0 || suggestions.tags.length > 0) && <Box mx={3} my={1} borderTop="1px solid" borderColor="gray.100" />}
                          <Text px={4} pt={2} pb={1} fontSize="xs" fontWeight="bold" color="gray.500" textTransform="uppercase" letterSpacing="wider">Brands</Text>
                          {suggestions.brands.map((b, i) => (
                            <Box key={`b-${i}`} px={4} py={2} cursor="pointer" _hover={{ bg: 'gray.50' }} onClick={() => handleSuggestionClick(b, 'brand')}>
                              <HStack spacing={3}>
                                <StarIcon color="yellow.400" boxSize={3} />
                                <Text fontSize="sm" color="gray.700">{b}</Text>
                              </HStack>
                            </Box>
                          ))}
                        </>
                      )}
                      {userSuggestions.length > 0 && (
                        <>
                          {(suggestions.products.length > 0 || suggestions.categories.length > 0 || suggestions.tags.length > 0 || suggestions.brands.length > 0) && <Box mx={3} my={1} borderTop="1px solid" borderColor="gray.100" />}
                          <Text px={4} pt={2} pb={1} fontSize="xs" fontWeight="bold" color="gray.500" textTransform="uppercase" letterSpacing="wider">Users</Text>
                          {userSuggestions.map((u, i) => (
                            <Box key={`u-${u.id}-${i}`} px={4} py={2} cursor="pointer" _hover={{ bg: 'gray.50' }} onClick={() => handleSuggestionClick(u.name, 'user', u.id, u)}>
                              <HStack spacing={3}>
                                <Avatar size="xs" src={u.profile_picture ? getImageUrl(u.profile_picture) : undefined} name={u.name} />
                                <Text fontSize="sm" color="gray.700" noOfLines={1}>{u.name}</Text>
                              </HStack>
                            </Box>
                          ))}
                        </>
                      )}
                      {organizationSuggestions.length > 0 && (
                        <>
                          {(suggestions.products.length > 0 || suggestions.categories.length > 0 || suggestions.tags.length > 0 || suggestions.brands.length > 0 || userSuggestions.length > 0) && <Box mx={3} my={1} borderTop="1px solid" borderColor="gray.100" />}
                          <Text px={4} pt={2} pb={1} fontSize="xs" fontWeight="bold" color="gray.500" textTransform="uppercase" letterSpacing="wider">Organizations</Text>
                          {organizationSuggestions.map((u, i) => (
                            <Box key={`o-${u.id}-${i}`} px={4} py={2} cursor="pointer" _hover={{ bg: 'gray.50' }} onClick={() => handleSuggestionClick(u.org_name || u.name, 'user', u.id, u)}>
                              <HStack spacing={3}>
                                <Avatar size="xs" src={getImageUrl(u.org_logo_url || u.logo_url || u.profile_picture)} name={u.org_name || u.name} />
                                <Text fontSize="sm" color="gray.700" noOfLines={1}>{u.org_name || u.name}</Text>
                                {(u as any).type === 'community_org' && <Badge size="xs" colorScheme="purple" fontSize="10px">Community</Badge>}
                              </HStack>
                            </Box>
                          ))}
                        </>
                      )}
                    </VStack>
                  )}
                </Box>
              )}
            </Box>

            {/* Desktop Controls - Right side buttons */}
            <HStack spacing={2} flexShrink={0}>
              {/* Search button */}
              <Button
                leftIcon={<SearchIcon />}
                colorScheme="brand"
                size="lg"
                onClick={handleSearch}
                px={6}
              >
                Search
              </Button>

              {/* Filters toggle */}
              <IconButton
                aria-label="Toggle filters"
                icon={showFilters ? <ChevronUpIcon /> : <ChevronDownIcon />}
                variant="outline"
                size="lg"
                onClick={() => setShowFilters(!showFilters)}
              />

              {/* Profile button */}
              {user && (
              <Popover placement="bottom-end" trigger="hover">
                <PopoverTrigger>
                  <Box
                    as="button"
                    cursor={user.id ? "pointer" : "not-allowed"}
                    alignItems="center"
                    justifyContent="center"
                    borderRadius="full"
                    _hover={{ opacity: user.id ? 0.8 : 1, transform: user.id ? 'scale(1.05)' : 'scale(1)' }}
                    transition="all 0.2s"
                    onClick={() => user.id && navigate(`/users/${user.slug || user.id}`)}
                    disabled={!user.id}
                    opacity={user.id ? 1 : 0.5}
                    display="inline-flex"
                  >
                    <VerifiedAvatar
                      size="sm"
                      name={user.name || 'User'}
                      src={user.profile_picture ? getImageUrl(user.profile_picture) : undefined}
                      bg="teal.500"
                      color="white"
                      isVerified={user.verified || (user as any).verification_status === 'verified'}
                    />
                  </Box>
                </PopoverTrigger>
                <PopoverContent w="72" shadow="lg">
                  <PopoverBody p={4}>
                    <VStack align="stretch" spacing={3}>
                      {/* User Profile Card */}
                      <Box
                        bg="brand.50"
                        p={4}
                        borderRadius="lg"
                      >
                        <Box display="flex" alignItems="center" gap={3} mb={3}>
                          <VerifiedAvatar
                            size="lg"
                            name={user.name || 'User'}
                            src={user.profile_picture ? getImageUrl(user.profile_picture) : undefined}
                            isVerified={user.verified || (user as any).verification_status === 'verified'}
                          />
                          <Box flex={1}>
                            <Text fontWeight="bold" fontSize="md" noOfLines={1} textTransform="capitalize">
                              {user.name || 'User'}
                            </Text>
                            <Text fontSize="xs" color="gray.500" noOfLines={1}>
                              {user.email}
                            </Text>
                            {user && (user as any).is_premium && (
                              <Badge colorScheme="yellow" fontSize="xs" mt={1}>
                                Premium Member
                              </Badge>
                            )}
                            {riderStatus?.is_rider && riderStatus?.status === 'approved' && (
                              <Badge colorScheme="green" fontSize="xs" mt={1}>
                                Verified Rider
                              </Badge>
                            )}
                          </Box>
                        </Box>
                        <Button
                          as={RouterLink}
                          to={user.id ? `/users/${user.id}` : '#'}
                          isDisabled={!user.id}
                          size="sm"
                          w="full"
                          colorScheme="brand"
                          variant="outline"
                        >
                          View Profile
                        </Button>
                      </Box>

                      {/* Menu Items */}
                      <Button
                        as={RouterLink}
                        to={riderStatus?.is_rider && riderStatus?.status === 'approved' ? '/rider-home' : '/rider-application'}
                        size="sm"
                        w="full"
                        variant="ghost"
                        justifyContent="flex-start"
                        leftIcon={<Icon as={FaMotorcycle} />}
                      >
                        {riderStatus?.is_rider && riderStatus?.status === 'approved' ? 'Rider Dashboard' : 'Apply as Rider'}
                      </Button>

                      <Button
                        as={RouterLink}
                        to="/premium"
                        size="sm"
                        w="full"
                        variant="ghost"
                        justifyContent="flex-start"
                        leftIcon={<Icon as={FaCrown} color="purple.500" />}
                        color="purple.600"
                      >
                        {(user as any).is_premium ? 'Premium' : 'Buy Premium'}
                      </Button>

                      <Button
                        as={RouterLink}
                        to="/organizations"
                        size="sm"
                        w="full"
                        variant="ghost"
                        justifyContent="flex-start"
                        leftIcon={<Icon as={FaHome} />}
                      >
                        Organizations
                      </Button>

                      <Button
                        as="a"
                        href="/clovia.apk"
                        download="clovia.apk"
                        size="sm"
                        w="full"
                        variant="ghost"
                        justifyContent="flex-start"
                        leftIcon={<Icon as={FiDownload} />}
                        display={{ base: 'flex', md: 'none' }}
                      >
                        Install Clovia (Android)
                      </Button>

                      <Box display={{ base: 'block', md: 'none' }} w="full">
                        <InstallAppPrompt variant="profile-menu" />
                      </Box>

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
              <Box
                as={RouterLink}
                to="/login"
                display="inline-flex"
                alignItems="center"
                justifyContent="center"
                borderRadius="full"
                cursor="pointer"
                _hover={{ opacity: 0.8, transform: 'scale(1.05)' }}
                transition="all 0.2s"
              >
                <Avatar size="sm" bg="gray.400" />
              </Box>
              )}
            </HStack>
          </HStack>

          {/* Expandable Filters */}
          {showFilters && (
            <Box
              position="absolute"
              top="100%"
              left={0}
              right={0}
              bg="white"
              p={4}
              rounded="lg"
              shadow="lg"
              zIndex={50}
            >
              <Flex
                gap={3}
                align="flex-end"
                direction={{ base: 'column', md: 'row' }}
              >
                <FormControl flex={1} minW={0}>
                  <FormLabel fontSize="sm" color="gray.600">Sort By</FormLabel>
                  <Select
                    aria-label="Sort by"
                    title="Sort by"
                    value={filters.sort_by || 'most_relevant'}
                    onChange={(e) => handleFilterChange('sort_by', e.target.value)}
                    size="sm"
                  >
                    <option value="most_relevant">Most Relevant</option>
                    <option value="newest">Newest First</option>
                    <option value="most_offers">Most Offers</option>
                    <option value="trending">Trending</option>
                  </Select>
                </FormControl>

                <FormControl flex={1} minW={0}>
                  <FormLabel fontSize="sm" color="gray.600">Condition</FormLabel>
                  <Select
                    aria-label="Condition"
                    title="Condition"
                    value={filters.condition || ''}
                    onChange={(e) => handleFilterChange('condition', e.target.value || undefined)}
                    size="sm"
                  >
                    <option value="">All Conditions</option>
                    <option value="new">New</option>
                    <option value="like_new">Like New</option>
                    <option value="good">Good</option>
                    <option value="fair">Fair</option>
                    <option value="poor">Poor</option>
                  </Select>
                </FormControl>

                <FormControl flex={1} minW={0}>
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

                <FormControl flex={1} minW={0}>
                  <FormLabel fontSize="sm" color="gray.600">Bidding & Offers</FormLabel>
                  <Select
                    aria-label="Bidding & offers"
                    title="Bidding & offers"
                    value={filters.has_active_offers === undefined ? '' : filters.has_active_offers.toString()}
                    onChange={(e) => handleFilterChange('has_active_offers', e.target.value === '' ? undefined : e.target.value === 'true')}
                    size="sm"
                  >
                    <option value="">All items</option>
                    <option value="true">With active offers</option>
                    <option value="false">No offers yet</option>
                  </Select>
                </FormControl>

                <FormControl flex={1} minW={0}>
                  <FormLabel fontSize="sm" color="gray.600">Trader</FormLabel>
                  <Select
                    aria-label="Trader verification"
                    title="Trader verification"
                    value={filters.verified_seller_only === undefined ? '' : filters.verified_seller_only.toString()}
                    onChange={(e) => handleFilterChange('verified_seller_only', e.target.value === '' ? undefined : e.target.value === 'true')}
                    size="sm"
                  >
                    <option value="">All traders</option>
                    <option value="true">Verified traders only</option>
                  </Select>
                </FormControl>

                <Box flex="none" alignSelf={{ base: 'stretch', md: 'flex-end' }} ml={{ base: 0, md: 'auto' }}>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={clearFilters}
                    w={{ base: 'full', md: 'auto' }}
                  >
                    Reset Filters
                  </Button>
                </Box>
              </Flex>
            </Box>
          )}
        </VStack>
      </Box>
      {/* Dynamic Advertisement Carousel Box */}
      <AdvertisementCarousel />
      {/* Horizontal category pills - desktop: centered max-width */}
      <Box
        px={{ base: 3, md: 6, lg: 8, xl: 10 }}
        bg="linear-gradient(135deg, #FFFDF1 0%, #FFFCF0 100%)"
        borderBottomColor="gray.100"
      >
        <Box
          w="full"
          maxW={{ lg: '1600px', xl: '1620px', '2xl': '1920px' }}
          mx={{ base: 'auto', lg: 0 }}
          ml={{ base: 0, md: -2, lg: -6, xl: -8 }}
        >
          <HStack
            spacing={{ base: 2.5, md: 3 }}
            overflowX="auto"
            whiteSpace="nowrap"
            align="center"
            pb={{ base: 2, md: 0 }}
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
            {categories.map((category) => {
              // Show selected state for either the current selection or the one being transitioned to
              const isSelected = selectedCategory === category.value || transitingCategory === category.value
              const IconComponent = category.icon

              return (
                <Box
                  key={category.value}
                  flexShrink={0}
                  as="button"
                  onClick={() => handleCategorySelect(category.value)}
                  cursor="pointer"
                  transition="transform 0.15s ease-out"
                  _active={{
                    transform: 'scale(0.92)',
                  }}
                  _focusVisible={{
                    outline: 'none'
                  }}
                >
                  <Box
                    display="flex"
                    alignItems="center"
                    gap={{ base: 1.5, md: 2 }}
                    px={{ base: 3, md: 5 }}
                    py={{ base: 2, md: 3 }}
                    rounded="full"
                    bg={isSelected ? (category.value === 'All' ? 'brand.600' : category.color) : 'white'}
                    color={isSelected ? 'white' : 'gray.700'}
                    fontWeight={isSelected ? '600' : '500'}
                    fontSize={{ base: 'xs', md: 'sm' }}
                    border="2px solid"
                    borderColor={isSelected ? category.accentColor : 'gray.200'}
                    boxShadow={isSelected ? '0 4px 8px rgba(0, 0, 0, 0.12)' : '0 2px 4px rgba(0, 0, 0, 0.05)'}
                    transition="all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)"
                    position="relative"
                    overflow="hidden"
                    _before={{
                      content: '""',
                      position: 'absolute',
                      inset: 0,
                      bg: isSelected ? 'rgba(255, 255, 255, 0.1)' : 'transparent',
                      transition: 'background 0.2s ease',
                    }}
                    _hover={{
                      transform: isSelected ? 'translateY(-1px)' : 'translateY(-2px)',
                      boxShadow: '0 6px 12px rgba(0, 0, 0, 0.1)',
                      borderColor: category.accentColor,
                      bg: isSelected ? (category.value === 'All' ? 'brand.600' : category.color) : category.lightColor,
                    }}
                    _focusVisible={{
                      outline: '2px solid',
                      outlineColor: category.accentColor,
                      outlineOffset: '2px',
                    }}
                  >
                    <Icon
                      as={IconComponent}
                      w={{ base: 3.5, md: 4 }}
                      h={{ base: 3.5, md: 4 }}
                      transition="all 0.2s cubic-bezier(0.34, 1.56, 0.64, 1)"
                      transform={isSelected ? 'scale(1.1)' : 'scale(1)'}
                      opacity={isSelected ? 1 : 0.7}
                    />
                    <Text
                      as="span"
                      transition="all 0.2s ease"
                      display={{ base: category.value === 'All' ? 'inline' : 'none', md: 'inline' }}
                    >
                      {category.label}
                    </Text>
                  </Box>
                </Box>
              )
            })}
          </HStack>
        </Box>
      </Box>

      <Box mt={{ base: 0, md: 6, lg: 8 }}>
        <ActivityFeed />
      </Box>

      {/* Main Content - desktop: centered max-width */}
      <Box
        px={{ base: 3, md: 6, lg: 8, xl: 10 }}
        py={8}
        sx={{ '@media (max-width: 850px)': { paddingLeft: '12px', paddingRight: '12px' } }}
        maxW={{ lg: '1600px', xl: '1620px', '2xl': '1920px' }}
        mx={{ base: 'auto', lg: 0 }}
        ml={{ base: 0, md: -2, lg: -6, xl: -8 }}
        w="full"
      >
        {/* Loading State with Skeleton */}
        {(loading || isLoadingCategoryChange) && (
          <Box>
            <ProductGridSkeleton count={12} />
          </Box>
        )}

        {/* Error Display removed intentionally for cleaner UX */}

        {/* Products Grid - desktop: no extra maxW (parent constrains), 2xl: 6 cols */}
        {!loading && !isLoadingCategoryChange && products.length > 0 && (
          <Box
            w="full"
            mx="auto"
            px={{ base: 3.5, md: 4, lg: 0 }}
            pb={{ base: 20, md: 0 }}
            minH={{ base: '1200px', md: '1600px' }}
            sx={{ '@media (max-width: 850px)': { paddingLeft: '12px', paddingRight: '12px', marginLeft: 0 } }}
          >
            <ProductGridWithAds products={products} user={user} />

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
        {!loading && !isLoadingCategoryChange && products.length === 0 && (
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
                  {filters.keyword || filters.condition || filters.verified_seller_only || filters.sort_by !== 'most_relevant'
                    ? "Try adjusting your search criteria or resetting filters to see all products."
                    : "No products are currently available. Check back later!"
                  }
                </Text>
              </VStack>
              <Button
                size="lg"
                colorScheme="brand"
                onClick={() => {
                  const hasExtraFilters = filters.keyword || filters.condition || filters.verified_seller_only || filters.sort_by !== 'most_relevant'
                  if (hasExtraFilters) {
                    clearFilters()
                  } else {
                    setHasSearched(true)
                  }
                }}
              >
                {filters.keyword || filters.condition || filters.verified_seller_only || filters.sort_by !== 'most_relevant'
                  ? "Reset All Filters"
                  : "Refresh Page"
                }
              </Button>
            </VStack>
          </Box>
        )}
      </Box>

      <TradeModal isOpen={isOpen} onClose={onClose} targetProductId={tradeTargetProductId} />

      <BuyoutModal isOpen={buyoutOpen} onClose={onBuyoutClose} targetProductId={buyoutTargetProductId} />

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

      {/* Offers Modal - Enhanced with Ranking, Cash & Items */}
      <Modal isOpen={offersModalOpen} onClose={() => setOffersModalOpen(false)} size="2xl">
        <ModalOverlay />
        <ModalContent>
          <ModalHeader pb={2}>
            <HStack justify="space-between" w="full">
              <HStack spacing={3}>
                <Icon as={FaHandshake} color="brand.500" boxSize={5} />
                <VStack align="start" spacing={0}>
                  <Heading size="md" color="brand.600">
                    Offers ({offersForProduct.length})
                  </Heading>
                  {!loadingOffers && offersForProduct.length > 0 && (
                    <HStack spacing={2} mt={0.5}>
                      <Badge colorScheme="yellow" fontSize="xs">
                        {offersForProduct.filter((o: any) => o.status === 'pending').length} Pending
                      </Badge>
                      <Badge colorScheme="green" fontSize="xs">
                        {offersForProduct.filter((o: any) => o.status === 'accepted' || o.status === 'active').length} Accepted
                      </Badge>
                      {offersForProduct.filter((o: any) => o.status === 'countered').length > 0 && (
                        <Badge colorScheme="purple" fontSize="xs">
                          {offersForProduct.filter((o: any) => o.status === 'countered').length} Countered
                        </Badge>
                      )}
                    </HStack>
                  )}
                </VStack>
              </HStack>
              <IconButton
                aria-label="Close"
                icon={<CloseIcon />}
                variant="ghost"
                size="sm"
                onClick={() => setOffersModalOpen(false)}
              />
            </HStack>
          </ModalHeader>

          <ModalBody pb={6}>
            {loadingOffers ? (
              <Center py={8}>
                <Spinner color="brand.500" />
              </Center>
            ) : rankedOffers.length === 0 ? (
              <VStack py={8} spacing={4}>
                <Icon as={FaHandshake} color="gray.300" boxSize={12} />
                <Text color="gray.500" fontWeight="medium">No offers yet</Text>
                <Text color="gray.400" fontSize="sm" textAlign="center">
                  Be the first to make an offer on this product!
                </Text>
                {selectedProductForOffers && (
                  <Button
                    colorScheme="brand"
                    size="sm"
                    onClick={() => {
                      setOffersModalOpen(false)
                      handleTradeClick(selectedProductForOffers)
                    }}
                  >
                    Make an Offer
                  </Button>
                )}
              </VStack>
            ) : (
              <VStack spacing={3} align="stretch">
                {rankedOffers.map((offer: any, index: number) => {
                  const cashAmount = offer.offered_cash_amount || 0
                  const itemCount = offer.items?.length || 0

                  return (
                    <Box
                      key={offer.id}
                      p={4}
                      borderWidth="2px"
                      borderColor={index === 0 ? 'gold' : offer.status === 'accepted' ? 'green.400' : 'gray.200'}
                      rounded="lg"
                      bg={index === 0 ? 'yellow.50' : offer.status === 'accepted' ? 'green.50' : 'white'}
                      position="relative"
                      _hover={{ shadow: 'md', borderColor: index === 0 ? 'gold' : 'brand.300' }}
                      transition="all 0.2s"
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
                        {index === 0 ? '🏆 #1' : `#${index + 1}`}
                      </Badge>

                      <HStack justify="space-between" mb={3} mt={2}>
                        <HStack spacing={2}>
                          <Avatar size="xs" name={offer.buyer_name || 'A'} />
                          <Text fontWeight="bold" fontSize="sm">
                            {offer.buyer_name || 'Anonymous'}
                          </Text>
                        </HStack>
                        <Badge
                          colorScheme={
                            offer.status === 'accepted' ? 'green' :
                              offer.status === 'pending' ? 'yellow' :
                                offer.status === 'countered' ? 'purple' : 'gray'
                          }
                          fontSize="xs"
                        >
                          {offer.status.toUpperCase()}
                        </Badge>
                      </HStack>

                      {/* Offer Details: Cash + Items */}
                      <VStack align="stretch" spacing={2}>
                        {/* Cash offered */}
                        {cashAmount > 0 && (
                          <HStack bg="green.50" p={2} rounded="md" spacing={2}>
                            <Text fontSize="lg">💰</Text>
                            <Text fontSize="sm" fontWeight="bold" color="green.700">
                              {formatPHP(cashAmount)}
                            </Text>
                            <Text fontSize="xs" color="green.600">cash offered</Text>
                          </HStack>
                        )}

                        {/* Items offered */}
                        {itemCount > 0 && (
                          <Box>
                            <Text fontSize="xs" color="gray.500" mb={1} fontWeight="medium">
                              📦 {itemCount} item{itemCount > 1 ? 's' : ''} offered:
                            </Text>
                            <HStack spacing={2} flexWrap="wrap">
                              {offer.items.map((item: any, idx: number) => (
                                <HStack
                                  key={idx}
                                  bg="gray.50"
                                  p={1.5}
                                  rounded="md"
                                  borderWidth="1px"
                                  borderColor="gray.200"
                                  spacing={2}
                                >
                                  {item.product_image_url && (
                                    <Image
                                      src={getImageUrl(item.product_image_url)}
                                      alt={item.product_title || 'Item'}
                                      boxSize="32px"
                                      objectFit="cover"
                                      rounded="sm"
                                      fallback={<Box boxSize="32px" bg="gray.200" rounded="sm" />}
                                    />
                                  )}
                                  <Text fontSize="xs" fontWeight="medium" noOfLines={1} maxW="120px">
                                    {item.product_title || `Item ${idx + 1}`}
                                  </Text>
                                </HStack>
                              ))}
                            </HStack>
                          </Box>
                        )}

                        {/* Summary line */}
                        {cashAmount === 0 && itemCount === 0 && (
                          <Text fontSize="xs" color="gray.400" fontStyle="italic">
                            No details available
                          </Text>
                        )}
                      </VStack>

                      {/* Time ago */}
                      <Text fontSize="xs" color="gray.400" mt={2}>
                        {new Date(offer.created_at).toLocaleDateString()}
                      </Text>
                    </Box>
                  )
                })}

                {/* Make an offer button at bottom */}
                {selectedProductForOffers && (
                  <Button
                    colorScheme="brand"
                    size="md"
                    w="full"
                    mt={2}
                    leftIcon={<Icon as={FaHandshake} />}
                    onClick={() => {
                      setOffersModalOpen(false)
                      handleTradeClick(selectedProductForOffers)
                    }}
                  >
                    Make an Offer
                  </Button>
                )}
              </VStack>
            )}
          </ModalBody>
        </ModalContent>
      </Modal>

      <Box mb={{ base: 5, md: 0 }}>
        <FloatingTab />
      </Box>

      {/* Location Reminder Modal */}
      <Modal isOpen={showLocationReminder} onClose={() => setShowLocationReminder(false)} isCentered>
        <ModalOverlay backdropFilter="blur(3px)" />
        <ModalContent mx={4} borderRadius="2xl" p={2}>
          <ModalHeader>Set Your Location 📍</ModalHeader>
          <ModalCloseButton />
          <ModalBody pb={6}>
            <Text color="gray.600" mb={4}>
              You haven't set your home location yet! Setting your location helps you discover items and connect with potential barter mates near you.
            </Text>
            <Button
              colorScheme="brand"
              w="full"
              onClick={() => {
                setShowLocationReminder(false)
                navigate('/settings')
              }}
            >
              Go to Settings
            </Button>
          </ModalBody>
        </ModalContent>
      </Modal>
    </Box>
  )
}

export default Home
