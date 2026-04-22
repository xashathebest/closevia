import React, { createContext, useContext, useState, ReactNode, useEffect, useRef } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Product, ProductCreate, ProductUpdate, SearchFilters, PaginatedResponse } from '../types'
import { api } from '../services/api'
import { apiCallWithRetry } from '../utils/apiUtils'
import { getStoredToken } from '../utils/authStorage'

interface ProductContextType {
  products: Product[]
  loading: boolean
  error: string | null
  hasMore: boolean
  isLoadingMore: boolean
  searchProducts: (filters: SearchFilters) => Promise<void>
  loadMore: () => Promise<void>
  getProduct: (idOrSlug: number | string) => Promise<Product | null>
  createProduct: (product: ProductCreate | FormData) => Promise<Product>
  updateProduct: (id: number, product: ProductUpdate) => Promise<void>
  deleteProduct: (id: number) => Promise<void>
  getUserProducts: (userId: number, page?: number) => Promise<PaginatedResponse<Product>>
  markProductBoosted: (productId: number, boostedAt?: string) => void
  recordProductView: (productId: number) => void
  clearError: () => void
}

// Default no-op context so HMR / out-of-provider renders never crash
const defaultContext: ProductContextType = {
  products: [],
  loading: false,
  error: null,
  hasMore: false,
  isLoadingMore: false,
  searchProducts: async () => {},
  loadMore: async () => {},
  getProduct: async () => null,
  createProduct: async () => ({ id: 0, title: '', description: '', seller_id: 0, status: 'available', created_at: '', updated_at: '' } as any),
  updateProduct: async () => {},
  deleteProduct: async () => {},
  getUserProducts: async () => ({ data: [], total: 0, page: 1, limit: 20, total_pages: 0 }),
  markProductBoosted: () => {},
  recordProductView: () => {},
  clearError: () => {},
}

const ProductContext = createContext<ProductContextType>(defaultContext)

export const useProducts = () => {
  return useContext(ProductContext)
}

interface ProductProviderProps {
  children: ReactNode
}

export const ProductProvider: React.FC<ProductProviderProps> = ({ children }) => {
  const queryClient = useQueryClient()
  // Avoid calling `useAuth()` here to prevent errors when provider ordering
  // is incorrect during initialization. Read token from the shared auth helper.
  const [token] = useState<string | null>(() => getStoredToken())
  const [products, setProducts] = useState<Product[]>(() => {
    // Try to restore from localStorage on mount
    try {
      const cached = localStorage.getItem('clovia_home_products')
      if (!cached) return []
      // Strip cached distances — they were computed against the user's
      // previous location and can be stale (e.g. showing 1.7km on every
      // card). Backend will refill on the next fetch.
      const parsed = JSON.parse(cached) as Product[]
      return parsed.map((p) => ({ ...p, distance: '', distanceKm: Infinity }))
    } catch {
      return []
    }
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasMore, setHasMore] = useState<boolean>(true)
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false)
  const [currentPage, setCurrentPage] = useState<number>(1)
  const [currentFilters, setCurrentFilters] = useState<SearchFilters | null>(null)
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number; isHome?: boolean } | null>(() => {
    // Priority 1: User's saved home address directly from profile
    try {
      const userCached = localStorage.getItem('clovia_user')
      if (userCached) {
        const user = JSON.parse(userCached)
        if (user?.home_latitude != null && user?.home_longitude != null) {
          return { lat: user.home_latitude, lng: user.home_longitude, isHome: true }
        }
      }
    } catch { /* ignore */ }
    return null
  })
  const locationWatchId = useRef<number | null>(null)

  // Cache management refs
  const cacheRef = useRef<{ filters: string; products: Product[]; timestamp: number } | null>(null)
  const loadDistanceCacheFromStorage = () => {
    try {
      const raw = localStorage.getItem('clovia_product_distance_cache')
      if (!raw) return new Map<string, { distanceKm: number; distance: string }>()
      const parsed = JSON.parse(raw) as Record<string, { distanceKm: number; distance: string }>
      const map = new Map<string, { distanceKm: number; distance: string }>()
      Object.entries(parsed).forEach(([key, value]) => {
        if (value && typeof value.distanceKm === 'number') {
          map.set(key, value)
        }
      })
      return map
    } catch (e) {
      console.warn('Failed to read distance cache:', e)
      return new Map<string, { distanceKm: number; distance: string }>()
    }
  }
  const persistDistanceCache = () => {
    try {
      const serialized: Record<string, { distanceKm: number; distance: string }> = {}
      distanceCacheRef.current.forEach((value, key) => {
        serialized[key] = value
      })
      localStorage.setItem('clovia_product_distance_cache', JSON.stringify(serialized))
    } catch (e) {
      console.warn('Failed to persist distance cache:', e)
    }
  }
  const distanceCacheRef = useRef<Map<string, { distanceKm: number; distance: string }>>(loadDistanceCacheFromStorage())
  const pendingRequestRef = useRef<Promise<void> | null>(null)
  const hasInitialized = useRef(false)
  // Always reflects the latest userLocation synchronously (avoids stale closure in event handlers)
  const latestUserLocationRef = useRef<{ lat: number; lng: number; isHome?: boolean } | null>(null)
  // Tracks the last set of filters used — needed for re-fetching after home address change
  const currentFiltersRef = useRef<SearchFilters>({})

  // Persist products to localStorage
  useEffect(() => {
    if (products.length > 0) {
      try {
        localStorage.setItem('clovia_home_products', JSON.stringify(products))
      } catch (e) {
        console.warn('Failed to persist products:', e)
      }
    }
  }, [products])

  // Get the viewer's location — STRICTLY use saved home address from clovia_user
  useEffect(() => {
    // Priority 1: User's saved home address directly from profile
    try {
      const userCached = localStorage.getItem('clovia_user')
      if (userCached) {
        const user = JSON.parse(userCached)
        if (user?.home_latitude != null && user?.home_longitude != null) {
          return // already loaded in state initializer
        }
      }
    } catch { /* ignore */ }

    // Priority 2/3: The user specifically requested NOT to use navigator.geolocation
    // because it is inaccurate on laptops. Since we are in a React Web App (not Expo),
    // we cannot use expo-location. So if the home address is missing, we simply 
    // leave userLocation as null and gracefully hide distance badges (Priority 3).
  }, [])

  // Keep latestUserLocationRef in sync (synchronous — no re-render delay)
  useEffect(() => {
    latestUserLocationRef.current = userLocation
  }, [userLocation])

  // Listen for home address updates from Settings page
  useEffect(() => {
    const handleHomeAddressChanged = (e: Event) => {
      const evt = e as CustomEvent<{ lat: number; lng: number }>
      if (evt.detail?.lat && evt.detail?.lng) {
        const newLoc = { lat: evt.detail.lat, lng: evt.detail.lng, isHome: true }

        // 1. Bust all caches so the new fetch goes to the API with fresh viewer coords
        distanceCacheRef.current = new Map()
        try { localStorage.removeItem('clovia_product_distance_cache') } catch { /* ignore */ }
        try { localStorage.removeItem('clovia_home_products') } catch { /* ignore */ }
        cacheRef.current = null          // <-- bust API response cache
        pendingRequestRef.current = null // <-- allow a new in-flight request

        // 2. Update the synchronous ref first so searchProducts uses the new coords immediately
        latestUserLocationRef.current = newLoc

        // 3. Update React state (triggers re-renders elsewhere)
        setUserLocation(newLoc)

        // 4. Re-fetch products with the new home as viewer coords
        //    Use a short delay so React state settles before the next page call
        setTimeout(() => {
          const filters = currentFiltersRef.current || {}
          searchProductsWithLocation(filters, newLoc)
        }, 50)
      }
    }
    window.addEventListener('homeAddressChanged', handleHomeAddressChanged)
    return () => window.removeEventListener('homeAddressChanged', handleHomeAddressChanged)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Recalculate distances when user location becomes available for the first time (GPS fallback)
  useEffect(() => {
    if (userLocation && !userLocation.isHome && products.length > 0) {
      // Only apply client-side recalc for GPS fallback (not for home address — backend handles that)
      const productsWithDistance = addDistanceToProducts(products)
      setProducts(productsWithDistance)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userLocation])

  // Calculate distance between two coordinates using Haversine formula
  const calculateDistance = (
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number
  ): number => {
    const R = 6371 // Earth's radius in kilometers
    const dLat = ((lat2 - lat1) * Math.PI) / 180
    const dLng = ((lng2 - lng1) * Math.PI) / 180
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    return R * c
  }

  // Format distance for display - refined for accuracy as per user request
  const formatDistance = (distanceKm: number): string => {
    if (distanceKm === 0) return '0 m away'
    
    // Convert to meters
    const meters = distanceKm * 1000
    
    if (meters < 2000) {
      // Show nearby distances in meters for better granularity (up to ~2km)
      if (meters < 10) {
        return `${meters.toFixed(1)} m away`
      }
      return `${Math.round(meters)} m away`
    } else {
      // If more than 1km, show in KM with 1 decimal place
      return `${distanceKm.toFixed(1)} km away`
    }
  }

  // Pre-compute boost expiration times to avoid redundant Date operations in sort
  const getBoostStatus = (product: Product): { isBoosted: boolean; timeRemaining: number } => {
    if (!product.boosted_at) return { isBoosted: false, timeRemaining: 0 }
    const boostedAtRaw = String(product.boosted_at)
    const normalizedBoostedAt = boostedAtRaw.includes('T') ? boostedAtRaw : boostedAtRaw.replace(' ', 'T')
    const boostTimestamp = new Date(normalizedBoostedAt).getTime()
    if (Number.isNaN(boostTimestamp)) return { isBoosted: false, timeRemaining: 0 }
    const boostExpiry = boostTimestamp + 3 * 60 * 60 * 1000
    const timeRemaining = boostExpiry - Date.now()
    return { isBoosted: timeRemaining > 0, timeRemaining }
  }

  // Helper to parse distance string quickly (avoids regex in hot path)
  const parseDistanceString = (distStr: string): number => {
    const lowerStr = distStr.toLowerCase().trim()
    const match = lowerStr.match(/([\d.]+)\s*(km|m)\b/)
    if (!match) return Infinity

    const value = parseFloat(match[1])
    if (!Number.isFinite(value)) return Infinity

    return match[2] === 'km' ? value : value / 1000
  }

  const getDistanceCacheKey = (product: Product): string => {
    const productLat = product.latitude != null ? product.latitude.toFixed(5) : 'no-lat'
    const productLng = product.longitude != null ? product.longitude.toFixed(5) : 'no-lng'
    return [product.id, product.updated_at, productLat, productLng].join('|')
  }

  const compareByDistance = (a: Product, b: Product): number => {
    const distA = a.distanceKm ?? Infinity
    const distB = b.distanceKm ?? Infinity

    if (distA === distB) return 0
    if (distA === Infinity) return 1
    if (distB === Infinity) return -1
    return distA - distB
  }

  // Add distance to products and sort by nearest first
  // skipProcessed=true skips products that already have distanceKm set (optimization for pagination)
  const addDistanceToProducts = (productsList: Product[], skipProcessed = false): Product[] => {
    // IMPORTANT: Parse distances and sort even if userLocation isn't available yet
    // This ensures products with backend distance strings still sort correctly on initial load

    const withDistance = productsList.map((product) => {
      // Skip if already processed (optimization: don't recalculate old products on pagination)
      if (skipProcessed && product.distanceKm !== undefined && product.distanceKm !== Infinity) {
        return {
          ...product,
          // Ensure boosted items keep priority when re-sorting after pagination.
          // @ts-ignore - extending product with cache for sorting
          _boostStatus: (product as any)._boostStatus || getBoostStatus(product),
        }
      }

      let dist = Infinity
      const cacheKey = getDistanceCacheKey(product)
      const cachedDistance = distanceCacheRef.current.get(cacheKey)

      if (cachedDistance) {
        return {
          ...product,
          distance: cachedDistance.distance,
          distanceKm: cachedDistance.distanceKm,
          // @ts-ignore - extending product with cache for sorting
          _boostStatus: getBoostStatus(product),
        }
      }
      
      // Priority 1: Use backend-computed distance string (SQL Haversine — always accurate)
      // The backend receives viewer_lat/viewer_lng from the home address and computes distance in MySQL.
      // We never recalculate on the frontend to avoid inaccurate browser GPS.
      if (product.distance) {
        dist = parseDistanceString(product.distance)
      }
      // Priority 2: If backend sent no distance string but we have coords + home location,
      // compute client-side as a fallback (e.g. for products loaded before home address was set)
      else if (userLocation?.isHome && product.latitude && product.longitude) {
        dist = calculateDistance(
          userLocation.lat,
          userLocation.lng,
          product.latitude,
          product.longitude
        )
      }

      // Preserve backend distance label exactly (it uses the correct "58M AWAY" / "2.2KM AWAY" format)
      const nextDistance =
        dist === Infinity ? (product.distance || '') : (product.distance || formatDistance(dist))

      // Cache boost status on product to avoid recomputing during sort
      const boostStatus = getBoostStatus(product)
      
      return {
        ...product,
        distance: nextDistance,
        distanceKm: dist,
        // @ts-ignore - extending product with cache for sorting
        _boostStatus: boostStatus,
      }
    })

    withDistance.forEach((product) => {
      distanceCacheRef.current.set(getDistanceCacheKey(product), {
        distanceKm: product.distanceKm ?? Infinity,
        distance: product.distance || '',
      })
    })
    persistDistanceCache()

    // Sort by:
    // 1. Boosted status (boosted products first for 3 hours, then by remaining time)
    // 2. Premium pin status
    // 3. Distance (nearest first)
    // 4. Newest first (for identical everything else)
    withDistance.sort((a, b) => {
      // Use pre-cached boost status (computed once per product during mapping, not during sort)
      const boostA = (a as any)._boostStatus || { isBoosted: false, timeRemaining: 0 }
      const boostB = (b as any)._boostStatus || { isBoosted: false, timeRemaining: 0 }

      // Prioritize boosted products first
      if (boostA.isBoosted !== boostB.isBoosted) {
        return boostA.isBoosted ? -1 : 1
      }

      // If both are boosted, sort by remaining boost time (more time remaining first)
      if (boostA.isBoosted) {
        return boostB.timeRemaining - boostA.timeRemaining
      }

      // Otherwise, prioritize premium pins
      if (a.premium !== b.premium) {
        return a.premium ? -1 : 1
      }

      const distanceComparison = compareByDistance(a, b)
      if (distanceComparison !== 0) {
        return distanceComparison
      }
      
      // Finally, newest first
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    })

    return withDistance
  }

  // Helper function to ensure products is always an array
  const safeSetProducts = (newProducts: Product[] | null | undefined) => {
    if (Array.isArray(newProducts)) {
      const productsWithDistance = addDistanceToProducts(newProducts)
      setProducts(productsWithDistance)
    } else {
      setProducts([])
    }
  }

  const markProductBoosted = (productId: number, boostedAt?: string) => {
    const boostedAtValue = boostedAt || new Date().toISOString()
    setProducts((current) => {
      const nextProducts = (current || []).map((product) =>
        product.id === productId ? { ...product, boosted_at: boostedAtValue } : product
      )
      const nextWithDistance = addDistanceToProducts(nextProducts)
      if (cacheRef.current) {
        cacheRef.current = { ...cacheRef.current, products: nextWithDistance, timestamp: Date.now() }
      }
      try {
        localStorage.setItem('clovia_home_products', JSON.stringify(nextWithDistance))
      } catch (e) {
        console.warn('Failed to persist products:', e)
      }
      return nextWithDistance
    })
  }

  // Helper function to get headers with auth token
  const getAuthHeaders = () => {
    const headers: any = {}
    if (token) {
      headers['Authorization'] = `Bearer ${token}`
    }
    return headers
  }

  const searchProducts = async (filters: SearchFilters) =>
    searchProductsWithLocation(filters, latestUserLocationRef.current)

  // Core fetch — accepts an explicit location override so we can call it from
  // event handlers without stale React closures
  const searchProductsWithLocation = async (
    filters: SearchFilters,
    location: { lat: number; lng: number; isHome?: boolean } | null = null
  ) => {
    const activeLoc = location ?? latestUserLocationRef.current
    try {
      const filterKey = JSON.stringify(filters) + (activeLoc ? `@${activeLoc.lat},${activeLoc.lng}` : '')

      // Keep currentFiltersRef in sync for re-fetch on home change
      currentFiltersRef.current = filters

      // Return pending request if same request is already in flight
      if (pendingRequestRef.current) {
        return pendingRequestRef.current
      }

      // Create the fetch promise
      const fetchPromise = (async () => {
        setLoading(true)
        setError(null)
        setCurrentFilters(filters)

        const params = new URLSearchParams()
        if (filters.keyword) params.append(filters.useSmartSearch ? 'q' : 'keyword', filters.keyword)
        if (filters.category) params.append('category', filters.category)
        if (filters.condition) params.append('condition', filters.condition)
        if (filters.verified_seller_only !== undefined) params.append('verified_seller_only', filters.verified_seller_only.toString())
        if (filters.has_active_offers !== undefined) params.append('has_active_offers', filters.has_active_offers.toString())
        if (filters.sort_by) params.append('sort_by', filters.sort_by)
        if (filters.premium !== undefined) params.append('premium', filters.premium.toString())
        if (filters.seller_id) params.append('seller_id', filters.seller_id.toString())
        if (filters.barter_only !== undefined) params.append('barter_only', filters.barter_only.toString())
        if (filters.allow_buying !== undefined) params.append('allow_buying', filters.allow_buying.toString())
        // Pass viewer coordinates for server-side distance calculation
        // First priority — User's saved home address directly from profile
        let viewerLat: number | null = null
        let viewerLng: number | null = null

        try {
          const userCached = localStorage.getItem('clovia_user')
          if (userCached) {
            const userProfile = JSON.parse(userCached)
            if (userProfile?.home_latitude != null && userProfile?.home_longitude != null) {
              viewerLat = userProfile.home_latitude
              viewerLng = userProfile.home_longitude
            }
          }
        } catch (e) {
          console.warn('[API_REQUEST] Error parsing clovia_user for location:', e)
        }

        if (viewerLat !== null && viewerLng !== null) {
          params.append(filters.useSmartSearch ? 'lat' : 'viewer_lat', viewerLat.toString())
          params.append(filters.useSmartSearch ? 'lng' : 'viewer_lng', viewerLng.toString())
        }
        params.append('page', (filters.page || 1).toString())
        params.append('limit', (filters.limit || 10).toString())

        const endpoint = filters.useSmartSearch ? '/api/products/smart-search' : '/api/products'
        const response = await apiCallWithRetry(async () => {
          return await api.get(`${endpoint}?${params.toString()}`, {
            headers: getAuthHeaders(),
          })
        })

        // Handle different response structures safely
        if (response.data && response.data.data) {
          const data = response.data.data as PaginatedResponse<Product>
          if (data && data.data && Array.isArray(data.data)) {
            safeSetProducts(data.data)
            // Cache the result
            cacheRef.current = { filters: filterKey, products: data.data, timestamp: Date.now() }
            // Update pagination state
            setCurrentPage(data.page || 1)
            const total = data.total || 0
            const limit = data.limit || (filters.limit || 10)
            const loaded = data.data.length
            // If returned fewer than limit, we know there's no more
            setHasMore(loaded >= limit && (data.page < (data.total_pages || Number.MAX_SAFE_INTEGER)))
          } else {
            safeSetProducts([])
            setHasMore(false)
          }
        } else if (response.data && Array.isArray(response.data)) {
          // Direct array response
          safeSetProducts(response.data)
          cacheRef.current = { filters: filterKey, products: response.data, timestamp: Date.now() }
          setHasMore(false)
        } else {
          // Fallback to empty array
          safeSetProducts([])
          setHasMore(false)
        }
      })()

      pendingRequestRef.current = fetchPromise
      try {
        await fetchPromise
      } finally {
        pendingRequestRef.current = null
      }
    } catch (error: any) {
      console.error('Error fetching products:', error)

      // Handle different types of errors
      let errorMessage = 'Failed to fetch products'
      if (error.response?.data?.error) {
        errorMessage = error.response.data.error
      } else if (error.message) {
        errorMessage = error.message
      } else if (error.code === 'NETWORK_ERROR') {
        errorMessage = 'Network error. Please check your connection.'
      }

      setError(errorMessage)
      safeSetProducts([]) // Ensure products is always an array
      setHasMore(false)
    } finally {
      setLoading(false)
    }
  }

  const loadMore = async () => {
    if (loading || isLoadingMore || !hasMore) return
    if (!currentFilters) return
    try {
      setIsLoadingMore(true)
      const nextPage = (currentPage || 1) + 1

      const params = new URLSearchParams()
      const filters = currentFilters
      if (filters.keyword) params.append(filters.useSmartSearch ? 'q' : 'keyword', filters.keyword)
      if (filters.category) params.append('category', filters.category)
      if (filters.condition) params.append('condition', filters.condition)
      if (filters.verified_seller_only !== undefined) params.append('verified_seller_only', filters.verified_seller_only.toString())
      if (filters.has_active_offers !== undefined) params.append('has_active_offers', filters.has_active_offers.toString())
      if (filters.sort_by) params.append('sort_by', filters.sort_by)
      if (filters.premium !== undefined) params.append('premium', filters.premium.toString())
      if (filters.seller_id) params.append('seller_id', filters.seller_id.toString())
      if (filters.barter_only !== undefined) params.append('barter_only', filters.barter_only.toString())
      if (filters.allow_buying !== undefined) params.append('allow_buying', filters.allow_buying.toString())
      // Pass viewer coordinates for server-side distance calculation
      let viewerLat: number | null = null
      let viewerLng: number | null = null

      try {
        const userCached = localStorage.getItem('clovia_user')
        if (userCached) {
          const userProfile = JSON.parse(userCached)
          if (userProfile?.home_latitude != null && userProfile?.home_longitude != null) {
            viewerLat = userProfile.home_latitude
            viewerLng = userProfile.home_longitude
          }
        }
      } catch { /* ignore */ }

      if (viewerLat !== null && viewerLng !== null) {
        params.append(filters.useSmartSearch ? 'lat' : 'viewer_lat', viewerLat.toString())
        params.append(filters.useSmartSearch ? 'lng' : 'viewer_lng', viewerLng.toString())
      }
      params.append('page', nextPage.toString())
      params.append('limit', (filters.limit || 10).toString())

      const endpoint = filters.useSmartSearch ? '/api/products/smart-search' : '/api/products'
      const response = await apiCallWithRetry(async () => {
        return await api.get(`${endpoint}?${params.toString()}`, {
          headers: getAuthHeaders(),
        })
      })

      if (response.data && response.data.data) {
        const data = response.data.data as PaginatedResponse<Product>
        const newItems = Array.isArray(data?.data) ? data.data : []
        // OPTIMIZATION: Only compute distance for new items, skip reprocessing old items
        const newItemsWithDistance = addDistanceToProducts(newItems, false)
        // Merge new items with existing, then sort entire list once (not twice)
        const allProducts = Array.isArray(products) ? [...products, ...newItemsWithDistance] : newItemsWithDistance
        const sortedProducts = addDistanceToProducts(allProducts, true) // skipProcessed=true avoids recalculating
        setProducts(sortedProducts)
        setCurrentPage(data.page || nextPage)
        const totalPages = data.total_pages || 0
        if (totalPages > 0) {
          setHasMore((data.page || nextPage) < totalPages)
        } else {
          // Fallback: if fewer than requested returned, no more
          setHasMore(newItems.length >= (currentFilters.limit || 10))
        }
      } else if (response.data && Array.isArray(response.data)) {
        const newItems = response.data as Product[]
        const allProducts = Array.isArray(products) ? [...products, ...newItems] : newItems
        const sortedProducts = addDistanceToProducts(allProducts)
        setProducts(sortedProducts)
        setHasMore(newItems.length > 0)
        setCurrentPage(nextPage)
      } else {
        setHasMore(false)
      }
    } catch (error) {
      // On error do not change hasMore permanently; allow retry on next intersection
      console.error('Error loading more products:', error)
    } finally {
      setIsLoadingMore(false)
    }
  }

  const getProduct = async (idOrSlug: number | string): Promise<Product | null> => {
    try {
      setError(null)

      const response = await api.get(`/api/products/${idOrSlug}`, {
        headers: getAuthHeaders(),
      })

      // Handle different response structures
      // API returns { data: { product: {...}, votes: {...}, user_vote: "" } }
      // We need to extract the actual product object
      const data = response.data?.data
      if (data?.product) {
        return data.product as Product
      } else if (data) {
        return data as Product
      } else if (response.data) {
        return response.data as Product
      }

      return null
    } catch (error: any) {
      console.error(`❌ Error fetching product ${idOrSlug}:`, error)

      // Provide specific error messages
      if (error.response?.status === 404) {
        const message = `Product not found. It may have been deleted or doesn't exist.`
        console.error(message)
        setError(message)
      } else if (error.response?.status === 403) {
        const message = `This item is no longer available`
        setError(message)
      } else if (error.response?.status === 401) {
        setError('Authentication failed. Please log in again.')
      } else {
        setError(error.response?.data?.error || `Failed to fetch product: ${error.message}`)
      }

      return null
    }
  }

  const createProduct = async (product: ProductCreate | FormData): Promise<Product> => {
    try {
      setError(null)

      let formData: FormData

      if (product instanceof FormData) {
        // If FormData is already provided, use it directly
        formData = product
      } else {
        // Create FormData from ProductCreate object
        formData = new FormData()
        formData.append('title', product.title)
        formData.append('description', product.description)
        if (product.price !== undefined) {
          formData.append('price', product.price.toString())
        }
        formData.append('premium', product.premium.toString())
        formData.append('allow_buying', product.allow_buying.toString())
        formData.append('barter_only', product.barter_only.toString())
        if (product.location) {
          formData.append('location', product.location)
        }
        if ((product as any).condition) {
          formData.append('condition', (product as any).condition)
        }
        if ((product as any).category) {
          formData.append('category', (product as any).category as string)
        }

        // Add images if they exist
        if (product.image_urls && product.image_urls.length > 0) {
          // Convert base64 data URLs to files
          for (let i = 0; i < product.image_urls.length && i < 8; i++) {
            const imageUrl = product.image_urls[i]
            if (imageUrl.startsWith('data:image/')) {
              // Convert base64 to blob
              const response = await fetch(imageUrl)
              const blob = await response.blob()
              const file = new File([blob], `image_${i}.jpg`, { type: blob.type })
              formData.append('images', file)
            }
          }
        }
      }

      const response = await api.post('/api/products', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
          ...getAuthHeaders(),
        },
      })
      const newProduct = response.data.data
      safeSetProducts([newProduct, ...(products || [])])
      
      // Invalidate dashboard products cache
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'products'] })
      
      return newProduct
    } catch (error: any) {
      setError(error.response?.data?.error || 'Failed to create product')
      throw error
    }
  }

  const updateProduct = async (id: number, product: ProductUpdate): Promise<void> => {
    try {
      setError(null)
      // Sanitize payload: do not send client-side data: URLs to the server
      const payload: any = { ...product }
      if (payload.image_urls && Array.isArray(payload.image_urls)) {
        const nonData = payload.image_urls.filter((u: any) => typeof u === 'string' && !u.startsWith('data:'))
        if (nonData.length > 0) {
          payload.image_urls = nonData
        } else {
          // Remove image_urls entirely if only local previews were present
          delete payload.image_urls
        }
      }

      await api.put(`/api/products/${id}`, payload, {
        headers: getAuthHeaders(),
      })
      safeSetProducts((products || []).map(p => p.id === id ? { ...p, ...product } : p))
      
      // Invalidate dashboard products cache
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'products'] })
    } catch (error: any) {
      setError(error.response?.data?.error || 'Failed to update product')
      throw error
    }
  }

  const deleteProduct = async (id: number): Promise<void> => {
    try {
      setError(null)
      await api.delete(`/api/products/${id}`, {
        headers: getAuthHeaders(),
      })
      safeSetProducts((products || []).filter(p => p.id !== id))
      
      // Invalidate dashboard products cache
      queryClient.invalidateQueries({ queryKey: ['dashboard', 'products'] })
    } catch (error: any) {
      const errorMsg = error.response?.data?.error || 'Failed to delete product'
      setError(errorMsg)
      const err = new Error(errorMsg)
      throw err
    }
  }

  const recordProductView = (productId: number) => {
    setProducts((currentProducts) => {
      const nextProducts = (currentProducts || []).map((product) => {
        if (product.id !== productId) return product
        const currentViewCount = typeof product.view_count === 'number' ? product.view_count : 0
        return { ...product, view_count: currentViewCount + 1 }
      })

      try {
        localStorage.setItem('clovia_home_products', JSON.stringify(nextProducts))
      } catch (e) {
        console.warn('Failed to persist updated view count:', e)
      }

      return nextProducts
    })
  }

  const getUserProducts = async (userId: number, page: number = 1): Promise<PaginatedResponse<Product>> => {
    try {
      setError(null)
      const response = await api.get(`/api/products/user/${userId}?page=${page}`, {
        headers: getAuthHeaders(),
      })
      return response.data.data
    } catch (error: any) {
      setError(error.response?.data?.error || 'Failed to fetch user products')
      throw error
    }
  }

  const clearError = () => setError(null)

  const value: ProductContextType = {
    products: products || [], // Ensure products is never null
    loading,
    error,
    hasMore,
    isLoadingMore,
    searchProducts,
    loadMore,
    getProduct,
    createProduct,
    updateProduct,
    deleteProduct,
    getUserProducts,
    markProductBoosted,
    recordProductView,
    clearError,
  }

  return (
    <ProductContext.Provider value={value}>
      {children}
    </ProductContext.Provider>
  )
}
