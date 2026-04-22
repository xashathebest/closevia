import React, { useEffect, useMemo, useState, useRef } from 'react'
import { useParams, Link as RouterLink, useNavigate } from 'react-router-dom'
import {
  Box,
  Container,
  VStack,
  HStack,
  Stack,
  Heading,
  Text,
  Badge,
  Avatar,
  SimpleGrid,
  Stat,
  StatLabel,
  StatNumber,
  StatHelpText,
  Card,
  CardBody,
  CardHeader,
  CardFooter,
  Image,
  Wrap,
  WrapItem,
  Spinner,
  Center,
  Tooltip,
  Button,
  IconButton,
  Flex,
  Divider,
  Tabs,
  TabList,
  TabPanels,
  Tab,
  TabPanel,
  Icon,
  useDisclosure,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalCloseButton,
  FormControl,
  FormLabel,
  Textarea,
  Select,
  Input,
  useToast,
  Alert,
  AlertIcon,
} from '@chakra-ui/react'
import { FiMessageSquare, FiHeart, FiShare2, FiStar, FiClock, FiCheckCircle, FiSend, FiCamera, FiActivity, FiTag, FiInfo } from 'react-icons/fi'
import { FaHeart, FaBuilding, FaGraduationCap, FaStore, FaFileAlt, FaThumbsUp, FaThumbtack } from 'react-icons/fa'
import { api } from '../services/api'
import { useAuth } from '../contexts/AuthContext'
import VerifiedAvatar from '../components/VerifiedAvatar'
import { Product, User } from '../types'
import { useProducts } from '../contexts/ProductContext'
import { getFirstImage, getImageUrl } from '../utils/imageUtils'
import { getProductUrl } from '../utils/productUtils'
import TrustScoreCard from '../components/TrustScoreCard'
import { cacheService, sellerStatsCache, reviewsCache } from '../services/cacheService'

type PublicUser = Pick<User, 'id' | 'name' | 'verified' | 'created_at' | 'verification_status'> & {
  avatar_url?: string
  bio?: string
  background_url?: string
  background_position?: string
  rating?: number
  rank?: string
  is_organization?: boolean
  org_verified?: boolean
  org_name?: string
  org_logo_url?: string
  organization_type?: 'business' | 'school_organization' | 'marketplace_partner' | string
  department?: string
  response_time_minutes?: number
  positive_feedback?: number
  total_reviews?: number
  activity_status?: 'active_today' | 'active_this_week' | 'inactive'
  last_active_at?: string
  document_type?: string
}

interface UserProfileProps {
  /**
   * Optional explicit user ID. When provided, this overrides the route param
   * so the same component can be reused for the logged-in user's profile
   * (e.g. on the `/profile` route) and for public profiles (`/users/:id`).
   */
  userId?: number
}

type TrustFactor = {
  label: string
  status: 'pass' | 'warn' | 'fail'
  points: number
  max: number
}

type SellerStats = {
  avg_rating?: number
  positive_percent?: number
  total_feedback?: number
  total_trades?: number
  completed_trades?: number
  cancelled_trades?: number
  pending_trades?: number
  avg_response_time?: string
  trust_score?: number
  trust_level?: 'trusted' | 'new' | 'risky'
  report_count?: number
  has_reports?: boolean
  has_active_dispute?: boolean
  trust_factors?: TrustFactor[]
  conduct_summary?: {
    letter_grade: string
    overall_avg: number
    total_grades: number
    categories: { category: string; avg: number; count: number }[]
    cancellation_rate: number
    dispute_rate: number
  }
}

const UserProfile: React.FC<UserProfileProps> = ({ userId }) => {
  const { id: routeId } = useParams<{ id: string }>()
  // If we have an explicit userId, use it as a string.
  // Otherwise, use the routeId (which could be the numeric ID or the slug).
  const id = userId !== undefined ? String(userId) : (routeId || '')
  const navigate = useNavigate()
  const { user: currentUser } = useAuth()
  const [user, setUser] = useState<PublicUser | null>(null)
  const [isEditOpen, setIsEditOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const avatarInputRef = useRef<HTMLInputElement | null>(null)
  const [draftBio, setDraftBio] = useState('')
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null)
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [backgroundPreview, setBackgroundPreview] = useState<string | null>(null)
  const [backgroundFile, setBackgroundFile] = useState<File | null>(null)
  const [backgroundPos, setBackgroundPos] = useState<{ x: number; y: number }>({ x: 50, y: 50 })
  const dragStartRef = useRef<{ clientX: number; clientY: number; startX: number; startY: number } | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [isDraggingBg, setIsDraggingBg] = useState(false)
  const [loading, setLoading] = useState(true)
  const [products, setProducts] = useState<Product[]>([])
  const [error, setError] = useState<string>('')
  const [activeTab, setActiveTab] = useState(0)
  const [sortBy, setSortBy] = useState('newest')
  const [reviews, setReviews] = useState<any[]>([])
  const [sellerStats, setSellerStats] = useState<SellerStats | null>(null)
  const { getUserProducts } = useProducts()
  const { isOpen, onOpen, onClose } = useDisclosure()
  const toast = useToast()


  // Review form state
  const [reviewRating, setReviewRating] = useState(0)
  const [reviewComment, setReviewComment] = useState('')
  const [isSubmittingReview, setIsSubmittingReview] = useState(false)


  // Trade-specific review state
  const [tradeIdForReview, setTradeIdForReview] = useState<number | null>(null)
  const [reviewPhotoFile, setReviewPhotoFile] = useState<File | null>(null)
  const [reviewPhotoPreview, setReviewPhotoPreview] = useState<string | null>(null)
  const [completedTradesNeedingReview, setCompletedTradesNeedingReview] = useState<Set<number>>(new Set())
  const reviewPhotoInputRef = useRef<HTMLInputElement | null>(null)



  // Saved/wishlist state for product cards
  const [savedProductIds, setSavedProductIds] = useState<Set<number>>(new Set())


  // Reply state
  const [replyingTo, setReplyingTo] = useState<number | null>(null)
  const [replyText, setReplyText] = useState('')
  const [isSubmittingReply, setIsSubmittingReply] = useState(false)


  // Fetch reviews from API with caching
  useEffect(() => {
    const fetchReviews = async () => {
      if (!id) return
      try {
        const data = await reviewsCache.getOrFetch(
          `/api/users/${id}/reviews`,
          () => api.get(`/api/users/${id}/reviews`).then(r => r.data?.data || r.data || []),
          10 * 60 * 1000 // 10 minute cache
        )
        setReviews(data || [])
      } catch (error) {
        console.error('Failed to fetch reviews:', error)
        // Fallback to mock data if API fails
        const mockReviews = [
          {
            id: 1,
            reviewer: 'John D.',
            avatar: 'https://randomuser.me/api/portraits/men/1.jpg',
            rating: 5,
            comment: 'Great trader! Item was exactly as described.',
            date: '2023-10-15',
          },
          {
            id: 2,
            reviewer: 'Sarah M.',
            avatar: 'https://randomuser.me/api/portraits/women/1.jpg',
            rating: 4,
            comment: 'Smooth transaction, would trade again!',
            date: '2023-10-10',
          },
        ]
        setReviews(mockReviews)
      }
    }
    fetchReviews()
  }, [id])

  useEffect(() => {
    const fetchStats = async () => {
      if (!id) return
      try {
        const data = await sellerStatsCache.getOrFetch(
          `/api/users/${id}/stats`,
          () => api.get(`/api/users/${id}/stats`).then(r => r.data?.data || r.data || null),
          15 * 60 * 1000 // 15 minute cache for stats
        )
        setSellerStats(data || null)
      } catch (err) {
        setSellerStats(null)
      }
    }
    fetchStats()
  }, [id])

  useEffect(() => {
    const run = async () => {
      if (!id) return;
      setLoading(true);
      setError('');
      try {
        // If this is the currently authenticated user's page, fetch the protected profile (NO caching)
        let res
        const isOwnProfile = currentUser && (id === String(currentUser.id) || id === currentUser.slug)
        
        if (isOwnProfile) {
          res = await api.get('/api/users/profile')
        } else {
          // Fetch public user info with caching
          res = await cacheService.getOrFetch(
            `/api/users/${id}`,
            () => api.get(`/api/users/${id}`),
            5 * 60 * 1000 // 5 minute cache for public profiles
          )
        }


        const payload = res.data?.data || res.data
        const apiUser = (payload?.user || payload) as Partial<PublicUser>


        const finalizedUser: PublicUser = {
          id: apiUser.id || 0,
          name: (apiUser.name && apiUser.name.trim() !== '' && apiUser.name.toLowerCase() !== 'user') 
            ? apiUser.name 
            : ((apiUser as any).full_name && (apiUser as any).full_name.trim() !== '' 
              ? (apiUser as any).full_name 
              : 'Trader'),
          verified: Boolean(apiUser.verified),
          created_at: (apiUser as any).created_at || new Date().toISOString(),
          // Support multiple field names from different API versions
          avatar_url: getImageUrl((apiUser as any).profile_picture || (apiUser as any).avatar_url || (apiUser as any).org_logo_url || null),
          background_url: getImageUrl((apiUser as any).background_image || (apiUser as any).cover_photo || (apiUser as any).background_url || null),
          background_position: (apiUser as any).background_position || '50% 50%',
          bio: (apiUser as any).bio || 'No bio provided yet.',
          rating: apiUser.rating ?? 4.6,
          rank: apiUser.rank || 'Rising Trader',
          is_organization: Boolean((apiUser as any).is_organization),
          org_verified: Boolean((apiUser as any).org_verified),
          org_name: (apiUser as any).org_name,
          department: (apiUser as any).department || 'Unknown',
          activity_status: (apiUser as any).activity_status || 'inactive',
        }

        setUser(finalizedUser)

        // Only fetch products if we have a valid ID
        if (apiUser.id) {
          const page1 = await getUserProducts(apiUser.id as any, 1)
          setProducts(page1.data || [])
        } else {
          setProducts([])
        }
      } catch (e: any) {
        setError(e?.message || 'Failed to load user')
      } finally {
        setLoading(false)
      }
    }
    run()
  }, [id, currentUser?.id, currentUser?.slug])

  // Fetch which products are saved by current user
  useEffect(() => {
    if (!currentUser || products.length === 0) return
    const checkSaved = async () => {
      const ids = new Set<number>()
      await Promise.all(
        products.map(async (p) => {
          try {
            const res = await api.get(`/api/users/saved-products/${p.id}`)
            if (res.data?.data?.isSaved) ids.add(p.id)
          } catch { /* ignore */ }
        })
      )
      setSavedProductIds(ids)
    }
    checkSaved()
  }, [currentUser, products])

  const handleToggleSave = async (productId: number) => {
    if (!currentUser) {
      toast({ id: 'please-log-in-to-save-items', title: 'Please log in to save items', status: 'warning', duration: 2000 })
      navigate('/login')
      return
    }
    const targetProduct = products.find(p => p.id === productId)
    if (targetProduct?.seller_id === currentUser.id) {
      toast({ id: 'cannot-save-own-item', title: 'You cannot save your own item', status: 'info', duration: 2000 })
      return
    }
    const isSaved = savedProductIds.has(productId)
    try {
      if (isSaved) {
        await api.delete(`/api/users/saved-products/${productId}`)
        setSavedProductIds(prev => { const n = new Set(prev); n.delete(productId); return n })
        toast({ id: 'removed-from-saved', title: 'Removed from saved', status: 'info', duration: 1500 })
      } else {
        await api.post(`/api/users/saved-products`, { product_id: productId })
        setSavedProductIds(prev => new Set(prev).add(productId))
        toast({ id: 'saved', title: 'Saved!', status: 'success', duration: 1500 })
      }
    } catch {
      toast({ id: 'failed-to-update', title: 'Failed to update', status: 'error', duration: 2000 })
    }
  }

  const handleShareProduct = (product: Product) => {
    const url = `${window.location.origin}${getProductUrl(product)}`
    if (navigator.share) {
      navigator.share({ title: product.title, url }).catch(() => { })
    } else {
      navigator.clipboard.writeText(url)
      toast({ id: 'link-copied', title: 'Link copied!', status: 'success', duration: 1500 })
    }
  }

  const openEdit = () => {
    if (!user) return
    setDraftBio(user.bio || '')
    setBackgroundPreview(user.background_url || null)
    setAvatarPreview(user.avatar_url || null)
    setBackgroundFile(null)
    setAvatarFile(null)
    // Initialize background position from user if present
    if (user.background_position) {
      const parts = user.background_position.split(/\s+/)
      const px = parts[0]?.replace('%', '')
      const py = parts[1]?.replace('%', '')
      const nx = Number(px)
      const ny = Number(py)
      if (!isNaN(nx) && !isNaN(ny)) {
        setBackgroundPos({ x: Math.max(0, Math.min(100, nx)), y: Math.max(0, Math.min(100, ny)) })
      } else {
        setBackgroundPos({ x: 50, y: 50 })
      }
    } else {
      setBackgroundPos({ x: 50, y: 50 })
    }
    setIsEditOpen(true)
  }

  const closeEdit = () => {
    setIsEditOpen(false)
    setBackgroundFile(null)
    if (backgroundPreview && backgroundFile) URL.revokeObjectURL(backgroundPreview)
    setBackgroundPreview(null)
    if (avatarPreview && avatarFile) URL.revokeObjectURL(avatarPreview)
    setAvatarPreview(null)
    setAvatarFile(null)
  }

  const handleBackgroundSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    setBackgroundFile(f)
    const url = URL.createObjectURL(f)
    setBackgroundPreview(url)
  }

  const handleAvatarSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    setAvatarFile(f)
    const url = URL.createObjectURL(f)
    setAvatarPreview(url)
  }

  // Drag handlers for background repositioning
  const onBgPointerDown = (ev: React.MouseEvent | React.TouchEvent) => {
    ev.preventDefault()
    const clientX = 'touches' in ev ? ev.touches[0].clientX : (ev as React.MouseEvent).clientX
    const clientY = 'touches' in ev ? ev.touches[0].clientY : (ev as React.MouseEvent).clientY
    dragStartRef.current = { clientX, clientY, startX: backgroundPos.x, startY: backgroundPos.y }
    setIsDraggingBg(true)
  }

  const onBgPointerMove = (ev: React.MouseEvent | React.TouchEvent) => {
    if (!isDraggingBg || !dragStartRef.current) return
    const clientX = 'touches' in ev ? ev.touches[0].clientX : (ev as React.MouseEvent).clientX
    const clientY = 'touches' in ev ? ev.touches[0].clientY : (ev as React.MouseEvent).clientY
    const start = dragStartRef.current
    const container = containerRef.current
    if (!container) return
    const rect = container.getBoundingClientRect()
    const dx = clientX - start.clientX
    const dy = clientY - start.clientY
    const dxPercent = (dx / rect.width) * 100
    const dyPercent = (dy / rect.height) * 100
    const nx = Math.max(0, Math.min(100, start.startX + dxPercent))
    const ny = Math.max(0, Math.min(100, start.startY + dyPercent))
    setBackgroundPos({ x: nx, y: ny })
  }

  const onBgPointerUp = () => {
    setIsDraggingBg(false)
    dragStartRef.current = null
  }

  const handleSaveProfile = async () => {
    try {
      const payload: any = { bio: draftBio }
      // If user picked a new background file, upload it first
      // If user picked a new avatar file, upload it first
      if (avatarFile) {
        const fd = new FormData()
        fd.append('image', avatarFile)
        const uploadRes = await api.post('/api/users/profile-picture', fd)
        const returned = uploadRes.data?.data || uploadRes.data
        const uploadedUrl = returned?.url || returned?.path || returned
        if (uploadedUrl) payload.profile_picture = uploadedUrl
      }
      // Avatar upload done. Now background upload if present.
      if (backgroundFile) {
        const fd = new FormData()
        fd.append('image', backgroundFile)
        const uploadRes = await api.post('/api/users/profile-picture', fd)
        // server expected to return { url: '/uploads/...' } or similar
        const returned = uploadRes.data?.data || uploadRes.data
        const uploadedUrl = returned?.url || returned?.path || returned
        if (uploadedUrl) payload.background_image = uploadedUrl
      }

      // Include background position if we have a preview (either existing or newly uploaded)
      if (backgroundPreview || user?.background_url) {
        payload.background_position = `${Math.round(backgroundPos.x)}% ${Math.round(backgroundPos.y)}%`
      }
      await api.put('/api/users/profile', payload)
      // Update local user state optimistically
      setUser(prev => prev ? { ...prev, bio: draftBio, background_url: payload.background_image || prev.background_url, background_position: payload.background_position || prev.background_position, avatar_url: payload.profile_picture || prev.avatar_url } : prev)
      setIsEditOpen(false)


      // revoke temporary preview object URL if any
      if (backgroundPreview && backgroundFile) URL.revokeObjectURL(backgroundPreview)
      if (avatarPreview && avatarFile) URL.revokeObjectURL(avatarPreview)

    } catch (err: any) {
      console.error('Failed to save profile', err)
      toast({
        id: 'failed-to-save-profile',
        title: 'Failed to save profile',
        description: err?.response?.data?.message || err?.message || 'An error occurred',
        status: 'error',
        duration: 4000,
        isClosable: true,
      })
      return
    }
    toast({
      id: 'profile-updated',
      title: 'Profile updated',
      description: 'Your profile changes have been saved.',
      status: 'success',
      duration: 3000,
      isClosable: true,
    })
  }

  const stats = useMemo(() => {
    const total = products.length
    const active = products.filter(p => p.status === 'available').length
    const completed = products.filter(p => p.status === 'sold' || p.status === 'traded').length
    const rating = sellerStats?.avg_rating ?? user?.rating ?? 4.6
    const tradesCompleted = sellerStats?.completed_trades ?? completed
    const avgResponse = sellerStats?.avg_response_time ?? `${user?.response_time_minutes || 30} min`
    return { total, active, completed: tradesCompleted, rating, avgResponse }
  }, [products, user, sellerStats])

  const displayRating = sellerStats?.avg_rating ?? user?.rating ?? 4.8
  const displayTotalReviews = reviews.length || sellerStats?.total_feedback || user?.total_reviews || 0
  const displayPositivePercent = sellerStats?.positive_percent ?? user?.positive_feedback ?? 98

  // Fetch real trade history from backend for this specific user
  const [userTrades, setUserTrades] = useState<any[]>([])
  const [tradesLoading, setTradesLoading] = useState(true)
  const [tradesError, setTradesError] = useState<any>(null)

  useEffect(() => {
    const fetchTradeHistory = async () => {
      if (!id) return
      setTradesLoading(true)
      setTradesError(null)
      try {
        const res = await api.get(`/api/users/${id}/trades`)
        const data = res.data?.data || res.data || []
        setUserTrades(Array.isArray(data) ? data : [])
      } catch (err) {
        console.error('Failed to fetch trade history:', err)
        setTradesError(err)
        setUserTrades([])
      } finally {
        setTradesLoading(false)
      }
    }
    fetchTradeHistory()
  }, [id])

  // Filter products to only show available items in the Products tab
  const availableProducts = useMemo(() => {
    return products.filter(p => p.status === 'available')
  }, [products])

  // Sort products based on selected option
  const sortedProducts = useMemo(() => {
    const sorted = [...availableProducts]
    switch (sortBy) {
      case 'price_asc':
        return sorted.sort((a, b) => (a.price || 0) - (b.price || 0))
      case 'price_desc':
        return sorted.sort((a, b) => (b.price || 0) - (a.price || 0))
      case 'newest':
      default:
        return sorted.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    }
  }, [availableProducts, sortBy])

  // Merge trade history with reviews for unified "Trade Activity" feed
  const mergedTradeActivity = useMemo(() => {
    const completedTrades = userTrades.filter(t => t.status === 'completed' || t.completed_at)

    // Map reviews to their corresponding trades if possible
    const trades = completedTrades.map(trade => ({
      ...trade,
      type: 'trade',
      review: reviews.find(r => r.trade_id === trade.id || r.transaction_id === trade.id) || null
    }))

    // Sort by most recent first
    return trades.sort((a, b) => {
      const dateA = new Date(a.completed_at || a.created_at).getTime()
      const dateB = new Date(b.completed_at || b.created_at).getTime()
      return dateB - dateA
    })
  }, [userTrades, reviews])

  // Handle canceling a trade and reverting item to Available status
  const handleCancelTrade = async (tradeId: number) => {
    try {
      await api.post(`/api/trades/${tradeId}/cancel`)

      // Revert associated products back to 'available' status
      setProducts(prev =>
        prev.map(p => {
          // Find if this product was part of the canceled trade
          // This assumes trade.items contains product info
          return p.status === 'locked' ? { ...p, status: 'available' } : p
        })
      )

      // Remove trade from userTrades
      setUserTrades(prev => prev.filter(t => t.id !== tradeId))

      toast({
        id: 'trade-canceled',
        title: 'Trade canceled',
        description: 'Item status has been reverted to Available',
        status: 'success',
        duration: 3000,
        isClosable: true,
      })
    } catch (err) {
      toast({
        id: 'failed-to-cancel-trade',
        title: 'Failed to cancel trade',
        status: 'error',
        duration: 3000,
        isClosable: true,
      })
    }
  }

  // Handle photo upload for trade reviews
  const handleReviewPhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (!f) return
    setReviewPhotoFile(f)
    const url = URL.createObjectURL(f)
    setReviewPhotoPreview(url)
  }

  const clearReviewPhoto = () => {
    setReviewPhotoFile(null)
    if (reviewPhotoPreview) URL.revokeObjectURL(reviewPhotoPreview)
    setReviewPhotoPreview(null)
    if (reviewPhotoInputRef.current) reviewPhotoInputRef.current.value = ''
  }

  // Detect completed trades that need reviews from current user
  useEffect(() => {
    if (!currentUser) return

    const tradesNeedingReview = new Set<number>()
    mergedTradeActivity.forEach(trade => {
      // Check if trade is completed and current user hasn't reviewed it yet
      const hasBuyerReview = trade.buyer_rating != null
      const hasSellerReview = trade.seller_rating != null
      const currentUserHasReviewed =
        currentUser.id === trade.buyer_id ? hasBuyerReview :
        currentUser.id === trade.seller_id ? hasSellerReview :
        false

      if (trade.status === 'completed' && !currentUserHasReviewed) {
        // Only flag if current user is the one who should review
        // (typically the receiver of the item)
        const isReceiver = currentUser.id === trade.buyer_id || currentUser.id === trade.receiver_id
        if (isReceiver) {
          tradesNeedingReview.add(trade.id)
        }
      }
    })
    setCompletedTradesNeedingReview(tradesNeedingReview)
  }, [mergedTradeActivity, currentUser])

  const handleSendMessage = () => {
    // In a real app, this would open a chat with the user
    toast({
      id: 'message-sent',
      title: 'Message Sent',
      description: `Message sent to ${user?.name}`,
      status: 'success',
      duration: 3000,
      isClosable: true,
    })
  }

  const handleSubmitReview = async () => {
    if (!currentUser) {
      toast({
        id: "userprofile-login-required",
        title: 'Login required',
        description: 'Please sign in to leave a review.',
        status: 'warning',
        duration: 3000,
        isClosable: true,
      })
      navigate('/login')
      return
    }

    if (!reviewRating || reviewRating === 0) {
      toast({
        id: "userprofile-rating-required",
        title: 'Rating required',
        description: 'Please select a star rating before submitting.',
        status: 'warning',
        duration: 3000,
        isClosable: true,
      })
      return
    }

    if (!reviewComment.trim()) {
      toast({
        id: "userprofile-review-required",
        title: 'Review required',
        description: 'Please write a review before submitting.',
        status: 'warning',
        duration: 3000,
        isClosable: true,
      })
      return
    }

    setIsSubmittingReview(true)
    try {
      const payload: any = {
        rating: reviewRating,
        comment: reviewComment.trim() || 'No comment provided',
        trade_id: tradeIdForReview,
      }

      // Upload photo if one was selected
      if (reviewPhotoFile) {
        const fd = new FormData()
        fd.append('image', reviewPhotoFile)
        const uploadRes = await api.post('/api/users/review-photo', fd)
        const photoUrl = uploadRes.data?.data?.url || uploadRes.data?.data?.path || uploadRes.data?.url
        if (photoUrl) payload.photo_url = photoUrl
      }

      // Submit review
      const endpoint = tradeIdForReview
        ? `/api/trades/${tradeIdForReview}/review`
        : `/api/users/${id}/reviews`

      const reviewRes = await api.post(endpoint, payload)

      // Add review to local state
      const newReview = reviewRes.data?.data || reviewRes.data
      setReviews(prev => [newReview, ...prev])

      // Remove from trades needing review
      if (tradeIdForReview) {
        setCompletedTradesNeedingReview(prev => {
          const newSet = new Set(prev)
          newSet.delete(tradeIdForReview)
          return newSet
        })
      }

      toast({
        id: "userprofile-review-submitted",
        title: 'Review submitted!',
        description: 'Your review has been posted and is now visible on their profile.',
        status: 'success',
        duration: 3000,
        isClosable: true,
      })
    } catch (error: any) {
      console.error('Failed to submit review:', error)
      const status = error?.response?.status
      if (status === 401) {
        toast({
        id: "userprofile-login-required-2",
          title: 'Login required',
          description: 'Your session expired. Please sign in and try again.',
          status: 'warning',
          duration: 3000,
          isClosable: true,
        })
        navigate('/login')
      } else {
        toast({
        id: "userprofile-failed-to-submit-review",
          title: 'Failed to submit review',
          description: error?.response?.data?.message || error?.message || 'Please try again later.',
          status: 'error',
          duration: 4000,
          isClosable: true,
        })
      }
    } finally {
      setReviewRating(0)
      setReviewComment('')
      clearReviewPhoto()
      setTradeIdForReview(null)
      setIsSubmittingReview(false)
      onClose()
    }
  }

  const handleOpenReviewModal = (tradeId?: number) => {
    if (!currentUser) {
      toast({
        id: "userprofile-login-required-3",
        title: 'Login required',
        description: 'Please sign in to leave a review.',
        status: 'warning',
        duration: 3000,
        isClosable: true,
      })
      navigate('/login')
      return
    }
    setReviewRating(0)
    setReviewComment('')
    clearReviewPhoto()
    setTradeIdForReview(tradeId || null)
    onOpen()
  }

  const handleReplyToReview = async (reviewId: number) => {
    if (!currentUser) {
      toast({
        id: "userprofile-login-required-4",
        title: 'Login required',
        description: 'Please sign in to reply.',
        status: 'warning',
        duration: 3000,
        isClosable: true,
      })
      navigate('/login')
      return
    }

    if (!replyText.trim()) {
      toast({
        id: "userprofile-reply-required",
        title: 'Reply required',
        description: 'Please write a reply.',
        status: 'warning',
        duration: 3000,
        isClosable: true,
      })
      return
    }

    setIsSubmittingReply(true)
    try {
      const payload = {
        review_id: reviewId,
        reply: replyText.trim(),
      }

      await api.post(`/api/reviews/${reviewId}/reply`, payload)

      // Refresh reviews to show the new reply
      try {
        const response = await api.get(`/api/users/${id}/reviews`)
        setReviews(response.data?.data || response.data || [])
      } catch (fetchErr) {
        // Optimistically update
        setReviews(prev => prev.map(review =>
          review.id === reviewId
            ? {
              ...review,
              reply: replyText.trim(),
              reply_author: currentUser?.name || 'You',
              reply_date: new Date().toISOString().split('T')[0]
            }
            : review
        ))
      }

      setReplyText('')
      setReplyingTo(null)

      toast({
        id: "userprofile-reply-posted",
        title: 'Reply posted',
        description: 'Your reply has been posted successfully.',
        status: 'success',
        duration: 3000,
        isClosable: true,
      })
    } catch (error: any) {
      console.error('Failed to post reply:', error)
      toast({
        id: "userprofile-failed-to-post-reply",
        title: 'Failed to post reply',
        description: error?.response?.data?.message || error?.message || 'Please try again later.',
        status: 'error',
        duration: 4000,
        isClosable: true,
      })
    } finally {
      setIsSubmittingReply(false)
    }
  }

  const badges = useMemo(() => {
    const list: { label: string; color: string }[] = []
    if (stats.completed >= 20) list.push({ label: 'Top Trader', color: 'purple' })
    if (stats.completed >= 5) list.push({ label: 'Trusted Trader', color: 'green' })
    list.push({ label: 'Fast Responder', color: 'blue' })
    return list
  }, [stats])

  if (loading && !user) {
    return (
      <Box bg="#FFFDF1" minH="100vh" w="100%">
        <Center h="50vh">
          <VStack spacing={4}>
            <Spinner size="xl" color="brand.500" />
            <Text>Loading user profile...</Text>
          </VStack>
        </Center>
      </Box>
    )
  }

  if (error || !user) {
    return (
      <Box bg="#FFFDF1" minH="100vh" w="100%">
        <Center h="50vh" flexDirection="column" p={4} textAlign="center">
          <Text color="red.500" fontSize="lg" mb={4}>
            {error || 'User not found'}
          </Text>
          <Text color="gray.600" mb={6}>
            The user profile you're looking for doesn't exist or may have been removed.
          </Text>
          <Button
            colorScheme="brand"
            onClick={() => navigate('/')}
          >
            Back to Home
          </Button>
        </Center>
      </Box>
    )
  }

  return (
    <Box bg="#FFFDF1" minH="100vh" w="100%">
      <Container maxW="container.xl" py={8}>
        <VStack spacing={8} align="stretch">
          {/* Trader Info Header */}
          <Card bg="white" border="1px" borderColor="gray.200" shadow="sm" overflow="hidden">
            {/* Cover photo with gradient overlay */}
            <Box
              h="160px"
              w="100%"
              position="relative"
              bgImage={`url(${user.background_url || '/profile-bg-default.jpg'})`}
              bgSize="cover"
              bgPos={user.background_position || 'center'}
              _after={{
                content: '""',
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                h: '70%',
                bgGradient: 'linear(to-t, blackAlpha.600, transparent)',
                pointerEvents: 'none',
              }}
            >
              <Box position="absolute" bottom="-50px" left="6" zIndex={1}>
                <VerifiedAvatar
                  size="xl"
                  name={user.name}
                  src={user.avatar_url}
                  bg="brand.500"
                  color="white"
                  border="4px solid white"
                  boxShadow="md"
                  isVerified={user.verification_status === 'verified' || user.verified}
                />
              </Box>
            </Box>


            <CardBody pt="60px">
              {/* Name + Edit button row */}
              <Flex align="center" justify="space-between" mb={1}>
                <VStack align="start" spacing={0.5}>
                  <HStack spacing={1.5} align="baseline">
                    <Heading size="lg" color="gray.800" textTransform="capitalize" display="flex" alignItems="center">
                      {user.name}
                    </Heading>
                  </HStack>
                  {/* Organization Type tag */}
                  {user.is_organization && user.organization_type && (
                    <HStack spacing={1}>
                      <Icon
                        as={
                          user.organization_type === 'business' ? FaBuilding :
                          user.organization_type === 'school_organization' ? FaGraduationCap :
                          user.organization_type === 'marketplace_partner' ? FaStore : FaBuilding
                        }
                        boxSize={3}
                        color="purple.500"
                      />
                      <Text fontSize="xs" color="purple.600" fontWeight="medium">
                        {user.organization_type === 'business' ? 'Business' :
                         user.organization_type === 'school_organization' ? 'School Organization' :
                         user.organization_type === 'marketplace_partner' ? 'Marketplace Partner' :
                         user.organization_type}
                      </Text>
                    </HStack>
                  )}
                </VStack>

                {currentUser && (String(currentUser.id) === id || (currentUser as any).slug === id) && (
                  <Button
                    size="sm"
                    onClick={openEdit}
                    colorScheme="brand"
                    leftIcon={<Icon as={FiCamera} />}
                    flexShrink={0}
                  >
                    Edit Profile
                  </Button>
                )}
              </Flex>

              {/* Condensed rating/status line */}
              <HStack spacing={2} flexWrap="wrap" fontSize="sm" color="gray.600" mb={2}>
                {displayTotalReviews === 0 ? (
                  <Text color="gray.500">Positive: 0% (0 trades)</Text>
                ) : (
                  <>
                    <Icon as={FiStar} color="yellow.400" />
                    <Text fontWeight="semibold" color="gray.800">{displayRating.toFixed(1)}</Text>
                    <Text color="gray.500">({displayTotalReviews} reviews)</Text>
                    <Text color="gray.300">•</Text>
                    <Text fontWeight="semibold" color="green.500">Positive: {Math.round(displayPositivePercent)}%</Text>
                    <Text color="gray.800">({stats.completed} trades)</Text>
                  </>
                )}
              </HStack>

              {/* Combined status line for new/inactive/risky users */}
              <HStack spacing={2} mb={3} flexWrap="wrap">
                <Box as="span" fontSize="sm" color="gray.600" borderWidth="1px" borderColor="gray.300" borderRadius="md" px={2} py={0.5} bg="gray.50">
                  Status: {user.activity_status === 'active_today' ? 'Active today' : user.activity_status === 'active_this_week' ? 'Active this week' : 'Inactive'}
                  <Text as="span" color="gray.400" mx={1}>•</Text>
                  <Tooltip label={
                    sellerStats?.trust_level === 'risky'
                      ? 'Risky: This trader has a high risk level due to low ratings, negative feedback, or reports. Improve by completing positive trades.'
                      : sellerStats?.trust_level === 'new'
                        ? 'Medium: New traders have not yet established a risk level.'
                        : 'Low: Trusted trader with positive history.'
                  } hasArrow>
                    <Box as="span" cursor="pointer">
                      Risk Level: {sellerStats?.trust_level === 'trusted' ? 'Low' : sellerStats?.trust_level === 'new' ? 'Medium' : 'High'}
                      {sellerStats?.trust_level === 'risky' && (
                        <Icon as={FiInfo} ml={1} color="red.400" boxSize={4} />
                      )}
                      {sellerStats?.trust_level !== 'risky' && (
                        <Icon as={FiInfo} ml={1} color="gray.400" boxSize={4} />
                      )}
                    </Box>
                  </Tooltip>
                </Box>
              </HStack>

              {/* Verification Depth sub-badges (organization only) */}
              {/* Organization verification badges removed for redundancy. TrustScoreCard and check icon now serve as the only verification indicators. */}

              {/* Activity & Transparency (organization only) */}
              {user.is_organization && (
                <Box mb={3} p={3} bg="gray.50" borderRadius="md" borderLeft="3px solid" borderLeftColor="purple.300">
                  <HStack spacing={1} mb={2}>
                    <Icon as={FiActivity} color="purple.500" boxSize={4} />
                    <Text fontSize="xs" fontWeight="semibold" color="gray.600" textTransform="uppercase" letterSpacing="wide">
                      Recent Activity
                    </Text>
                  </HStack>
                  <VStack align="start" spacing={1}>
                    {user.last_active_at && (
                      <HStack spacing={2}>
                        <Icon as={FiClock} boxSize={3} color="gray.400" />
                        <Text fontSize="xs" color="gray.600">
                          Active {(() => {
                            const diff = Date.now() - new Date(user.last_active_at!).getTime()
                            const hours = Math.floor(diff / 3600000)
                            const days = Math.floor(diff / 86400000)
                            if (hours < 1) return 'just now'
                            if (hours < 24) return `${hours} hour${hours > 1 ? 's' : ''} ago`
                            return `${days} day${days > 1 ? 's' : ''} ago`
                          })()}
                        </Text>
                      </HStack>
                    )}
                    {(() => {
                      const oneWeekAgo = new Date(Date.now() - 7 * 86400000)
                      const recentListings = products.filter(p => new Date(p.created_at) > oneWeekAgo).length
                      if (recentListings > 0) return (
                        <HStack spacing={2}>
                          <Icon as={FiTag} boxSize={3} color="gray.400" />
                          <Text fontSize="xs" color="gray.600">Posted {recentListings} item{recentListings > 1 ? 's' : ''} this week</Text>
                        </HStack>
                      )
                      return null
                    })()}
                    {(() => {
                      const threeDaysAgo = new Date(Date.now() - 3 * 86400000)
                      const recentTrades = userTrades.filter(t => t.status === 'completed' && new Date(t.completed_at || t.created_at) > threeDaysAgo).length
                      if (recentTrades > 0) return (
                        <HStack spacing={2}>
                          <Icon as={FaThumbsUp} boxSize={3} color="gray.400" />
                          <Text fontSize="xs" color="gray.600">Completed {recentTrades} trade{recentTrades > 1 ? 's' : ''} in the last 3 days</Text>
                        </HStack>
                      )
                      return null
                    })()}
                  </VStack>
                </Box>
              )}

              {/* Bio section with CTA for owner */}
              {user.bio && user.bio !== 'No bio provided yet.' ? (
                <Text color="gray.700" fontSize="sm" mb={3}>{user.bio}</Text>
              ) : currentUser && (String(currentUser.id) === id || (currentUser as any).slug === id) ? (
                <Text color="gray.500" fontSize="sm" mb={3}>
                  Tell buyers about yourself — <Button variant="link" size="sm" colorScheme="brand" onClick={openEdit}>Add a bio</Button>
                </Text>
              ) : null}

              {/* Trust Score Card - Single comprehensive profile card */}
              {sellerStats ? (
                <Box mb={3}>
                  <TrustScoreCard
                    score={sellerStats.trust_score ?? 0}
                    trustLevel={sellerStats.trust_level}
                    factors={sellerStats.trust_factors}
                    conductSummary={sellerStats.conduct_summary}
                    isVerified={user.verification_status === 'verified' || user.verified}
                    listingCount={stats.total}
                    tradeCount={sellerStats.completed_trades ?? sellerStats.total_trades}
                    positivePercent={sellerStats.positive_percent}
                    tradeStats={{
                      successful: sellerStats.completed_trades ?? 0,
                      cancelled: sellerStats.cancelled_trades ?? 0,
                      pending: sellerStats.pending_trades ?? 0,
                    }}
                    responseTime={sellerStats.avg_response_time}
                    hasActiveDispute={sellerStats.has_active_dispute}
                    profileName={user.name}
                    profileAvatar={user.avatar_url}
                    memberSinceDate={user.created_at}
                    avgRating={displayRating}
                    reviewCount={displayTotalReviews}
                  />
                </Box>
              ) : (
                <SimpleGrid columns={{ base: 1, sm: 2, md: 3 }} spacing={4} p={4}>
                  {mergedTradeActivity.map((trade, idx) => (
                    <Box key={trade.id || idx} borderWidth="1px" borderColor="gray.200" borderRadius="md" p={4} bg="gray.50">
                      <Text fontSize="xs" color="gray.500" mb={1}>
                        Trade #{trade.id || idx}
                      </Text>
                      <Text fontSize="sm" color="gray.600" mb={2}>
                        {/* Label for trade type/status */}
                        {trade.status ? `Status: ${trade.status}` : 'Trade'}
                      </Text>
                      {/* ...existing trade details... */}
                      {/* Add more trade info here as needed */}
                    </Box>
                  ))}
                </SimpleGrid>
              )}
              {/* Show action buttons only when viewing someone else's profile */}

            </CardBody>
          </Card>

          {/* Tabs for different sections */}
          <Tabs variant="enclosed" isLazy>
            <TabList borderBottom="1px" borderColor="gray.200" bg="white" px={4}>
              <Tab _selected={{ color: 'brand.500', borderBottom: '2px solid', borderColor: 'brand.500' }}>
                Available Items ({sortedProducts.length})
              </Tab>
              <Tab _selected={{ color: 'brand.500', borderBottom: '2px solid', borderColor: 'brand.500' }}>
                Trade Activity ({mergedTradeActivity.length})
              </Tab>
            </TabList>

            <TabPanels bg="white" borderX="1px" borderBottom="1px" borderColor="gray.200" borderRadius="0 0 8px 8px">
              {/* Products Tab */}
              <TabPanel p={0}>
                <Box p={4} borderBottom="1px" borderColor="gray.100">
                  <HStack spacing={4} justify="space-between" flexWrap="wrap">
                    <Text fontWeight="medium">{sortedProducts.length} items</Text>
                    {currentUser && (String(currentUser.id) === id || (currentUser as any).slug === id) && (
                      <Text fontSize="xs" color="gray.500" fontStyle="italic">💡 Manage featured items by clicking the star icon on listings below</Text>
                    )}
                  </HStack>
                </Box>

                {sortedProducts.length === 0 ? (
                  <Center p={10}>
                    <VStack spacing={3}>
                      <Text fontSize="3xl">📦</Text>
                      <Text fontWeight="semibold" color="gray.600">
                        {user.is_organization ? `No listings yet` : 'No products found.'}
                      </Text>
                      <Text fontSize="sm" color="gray.400" textAlign="center" maxW="260px">
                        {user.is_organization
                          ? `No listings yet — this ${user.organization_type === 'school_organization' ? 'organization' : 'business'} is just getting started`
                          : 'This user hasn\'t listed any items yet'}
                      </Text>
                      {currentUser && (String(currentUser.id) === id || (currentUser as any).slug === id) && (
                        <Button colorScheme="brand" size="sm" mt={2} onClick={() => navigate('/add-product')}>
                          List an Item
                        </Button>
                      )}
                    </VStack>
                  </Center>
                ) : (
                  <Box>
                    {/* Pinned / Featured Listings */}
                    {sortedProducts.length > 0 && (
                      <Box p={4} borderBottom="1px" borderColor="gray.100">
                        <HStack spacing={2} mb={3} justify="space-between">
                          <HStack spacing={2}>
                            <Icon as={FaThumbtack} color="orange.400" boxSize={3.5} />
                            <Text fontSize="sm" fontWeight="semibold" color="gray.700">Featured Listings (Top 3)</Text>
                          </HStack>
                          {currentUser && (String(currentUser.id) === id || (currentUser as any).slug === id) && (
                            <Text fontSize="xs" color="orange.500" fontStyle="italic">Drag to reorder</Text>
                          )}
                        </HStack>
                        <SimpleGrid columns={{ base: 1, sm: 2, md: 3 }} spacing={3}>
                          {sortedProducts.slice(0, 3).map((product, idx) => (
                            <Box
                              key={`pin-${product.id}`}
                              position="relative"
                              border="1px"
                              borderColor="orange.200"
                              rounded="md"
                              overflow="hidden"
                              bg="white"
                              _hover={{ transform: 'translateY(-2px)', shadow: 'sm', borderColor: 'orange.400' }}
                              transition="all 0.2s"
                            >
                              <RouterLink to={getProductUrl(product)} style={{ textDecoration: 'none', display: 'block' }}>
                                <HStack display="flex" alignItems="center" gap={3} p={2} h="full">
                                  <Image
                                    src={getFirstImage(product.image_urls) || '/placeholder-item.jpg'}
                                    alt={product.title}
                                    boxSize="50px"
                                    objectFit="cover"
                                    borderRadius="md"
                                    flexShrink={0}
                                  />
                                  <Box minW={0}>
                                    <Text fontSize="xs" fontWeight="semibold" noOfLines={2} color="gray.800">{product.title}</Text>
                                    <Text fontSize="xs" color="brand.500" fontWeight="bold">
                                      {product.price ? `₱${product.price.toFixed(2)}` : 'For Trade'}
                                    </Text>
                                  </Box>
                                </HStack>
                              </RouterLink>
                              {currentUser && (String(currentUser.id) === id || (currentUser as any).slug === id) && (
                                <Tooltip label="Remove from featured" hasArrow>
                                  <IconButton
                                    aria-label="Remove from featured"
                                    icon={<Icon as={FaThumbtack} />}
                                    size="sm"
                                    position="absolute"
                                    top={1}
                                    right={1}
                                    colorScheme="orange"
                                    variant="solid"
                                    opacity={0}
                                    _groupHover={{ opacity: 1 }}
                                    transition="opacity 0.2s"
                                    onClick={(e) => {
                                      e.preventDefault()
                                      e.stopPropagation()
                                      // Will implement backend call to remove from featured
                                    }}
                                  />
                                </Tooltip>
                              )}
                            </Box>
                          ))}
                        </SimpleGrid>
                      </Box>
                    )}

                    {/* Category Breakdown */}
                    {(() => {
                      const catMap: Record<string, number> = {}
                      sortedProducts.forEach(p => {
                        const cat = (p as any).category || 'Other'
                        catMap[cat] = (catMap[cat] || 0) + 1
                      })
                      const cats = Object.entries(catMap).sort((a, b) => b[1] - a[1])
                      if (cats.length <= 1) return null
                      return (
                        <Box px={4} py={3} borderBottom="1px" borderColor="gray.100">
                          <HStack spacing={2} mb={2}>
                            <Icon as={FiTag} color="gray.500" boxSize={3.5} />
                            <Text fontSize="xs" fontWeight="semibold" color="gray.500" textTransform="uppercase" letterSpacing="wide">Categories</Text>
                          </HStack>
                          <HStack spacing={2} flexWrap="wrap">
                            {cats.map(([cat, count]) => (
                              <Badge key={cat} colorScheme="gray" variant="subtle" borderRadius="full" px={2}>
                                {cat} ({count})
                              </Badge>
                            ))}
                          </HStack>
                        </Box>
                      )
                    })()}

                    {/* All listings grid */}
                    <SimpleGrid
                      columns={{ base: 2, sm: 2, md: 3, lg: 4 }}
                      spacing={{ base: 2, md: 4 }}
                      p={4}
                    >
                      {sortedProducts.map((product) => (
                        <Box
                          key={product.id}
                          border="1px"
                          borderColor="gray.200"
                          rounded="md"
                          overflow="hidden"
                          bg="white"
                          _hover={{ transform: 'translateY(-4px)', shadow: 'md' }}
                          transition="all 0.2s"
                          position="relative"
                        >
                          <RouterLink to={getProductUrl(product)} style={{ textDecoration: 'none' }}>
                            <Box position="relative" cursor="pointer">
                              <Image
                                src={getFirstImage(product.image_urls) || '/placeholder-item.jpg'}
                                alt={product.title}
                                h="180px"
                                w="100%"
                                objectFit="cover"
                              />
                              {currentUser?.id !== product.seller_id && (
                                <Box position="absolute" top="2" right="2">
                                  <IconButton
                                    aria-label="Save item"
                                    icon={savedProductIds.has(product.id) ? <FaHeart /> : <FiHeart />}
                                    size="sm"
                                    borderRadius="full"
                                    bg="white"
                                    color={savedProductIds.has(product.id) ? 'red.500' : 'gray.600'}
                                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleToggleSave(product.id) }}
                                    _hover={{ color: savedProductIds.has(product.id) ? 'red.600' : 'red.500', bg: 'white' }}
                                  />
                                </Box>
                              )}
                              <Box position="absolute" top="2" left="2">
                                <Badge colorScheme={product.status === 'available' ? 'green' : 'red'}>
                                  {product.status}
                                </Badge>
                              </Box>
                            </Box>
                          </RouterLink>

                          <Box p={3}>
                            <RouterLink to={getProductUrl(product)} style={{ textDecoration: 'none' }}>
                              <Text
                                fontWeight="medium"
                                noOfLines={2}
                                mb={1}
                                wordBreak="break-word"
                                _hover={{ color: 'brand.500' }}
                              >
                                {product.title}
                              </Text>
                            </RouterLink>

                            <HStack justify="space-between" align="center" mt={2}>
                              <Text fontWeight="bold" color="gray.800">
                                {product.price ? `₱${product.price.toFixed(2)}` : 'Free'}
                              </Text>
                              <IconButton
                                aria-label="Share item"
                                icon={<FiShare2 />}
                                size="sm"
                                variant="ghost"
                                color="gray.500"
                                onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleShareProduct(product) }}
                              />
                            </HStack>
                          </Box>
                        </Box>
                      ))}
                    </SimpleGrid>
                  </Box>
                )}
              </TabPanel>

              {/* Trade Activity Tab - Combined Trade History & Reviews */}
              <TabPanel p={0}>
                <Box p={4} borderBottom="1px" borderColor="gray.100">
                  <HStack justify="space-between" align="flex-start" flexWrap="wrap">
                    <Box>
                      <Heading size="md" mb={1}>Trade Activity</Heading>
                      {displayTotalReviews === 0 ? (
                        <Text fontSize="md" color="gray.500" mb={1}>⭐ No reviews yet</Text>
                      ) : (
                        <>
                          <HStack spacing={1} mb={2}>
                            <Icon as={FiStar} color="yellow.400" boxSize={5} />
                            <Text fontSize="xl" fontWeight="bold">
                              {displayRating.toFixed(1)}
                              <Text as="span" fontSize="md" fontWeight="normal" color="gray.600" ml={1}>
                                ({displayTotalReviews} reviews)
                              </Text>
                            </Text>
                          </HStack>
                          <Text color="green.600" fontSize="sm">
                            {Math.round(displayPositivePercent)}% positive feedback
                          </Text>
                        </>
                      )}
                    </Box>

                  </HStack>
                </Box>


                {tradesLoading ? (
                  <Center p={10}>
                    <Spinner size="lg" color="brand.500" />
                  </Center>
                ) : tradesError ? (
                  <Center p={10}>
                    <Text color="red.500">Failed to load trade activity</Text>
                  </Center>
                ) : mergedTradeActivity.length === 0 ? (
                  <Center p={10}>
                    <VStack>
                      <Text color="gray.500">No completed trades yet.</Text>
                    </VStack>
                  </Center>
                ) : (
                  <Box>
                    {mergedTradeActivity.map((activity, index) => {
                      const trade = activity
                      const isBuyer = currentUser && trade.buyer_id === currentUser?.id
                      const counterpartName = isBuyer ? trade.seller_name : trade.buyer_name
                      
                      // Format completion datetime
                      const completedDateTime = trade.completed_at 
                        ? new Date(trade.completed_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
                        : new Date(trade.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

                      const buyerRating = trade.buyer_rating as number | null | undefined
                      const sellerRating = trade.seller_rating as number | null | undefined
                      const buyerFeedback = (trade.buyer_feedback || '') as string
                      const sellerFeedback = (trade.seller_feedback || '') as string

                      // Target product (what the seller listed)
                      const targetImage = trade.product_image_url || '/placeholder-item.jpg'
                      const targetTitle = trade.product_title || 'Product'

                      // Offered items (what the buyer offered)
                      const offeredItems = trade.items || []
                      const firstOffered = offeredItems.length > 0 ? offeredItems[0] : null
                      const offeredImage = firstOffered?.product_image_url || '/placeholder-item.jpg'
                      const offeredTitle = firstOffered?.product_title || 'Offered item'

                      const tradeAction = isBuyer ? 'Received' : 'Sent'

                      return (
                        <Box
                          key={trade.id}
                          p={2.5}
                          borderWidth="1px"
                          borderColor="gray.200"
                          borderRadius="md"
                          bg="linear-gradient(135deg, #FFFCF0 0%, #FFFDF1 100%)"
                          mb={2}
                          _hover={{ shadow: 'md', borderColor: 'blue.300' }}
                          transition="all 0.2s"
                        >
                          {/* COMPACT HEADER: Images, details, date */}
                          <VStack spacing={1.5} align="stretch">
                            {/* Top row: images and info */}
                            <HStack spacing={2} align="flex-start" justify="space-between">
                              <HStack spacing={1.5} align="center" flexShrink={0}>
                                {/* Offered item thumbnail */}
                                <Box w="40px" h="40px" bg="white" border="1px" borderColor="gray.300" borderRadius="md" overflow="hidden" flexShrink={0}>
                                  <Image src={offeredImage} alt={offeredTitle} w="100%" h="100%" objectFit="cover" fallbackSrc="/placeholder-item.jpg" />
                                </Box>
                                {/* Exchange arrow */}
                                <Text fontSize="xs" color="brand.400" fontWeight="bold">↔</Text>
                                {/* Target item thumbnail */}
                                <Box w="40px" h="40px" bg="white" border="1px" borderColor="gray.300" borderRadius="md" overflow="hidden" flexShrink={0}>
                                  <Image src={targetImage} alt={targetTitle} w="100%" h="100%" objectFit="cover" fallbackSrc="/placeholder-item.jpg" />
                                </Box>
                              </HStack>
                              
                              {/* Right side: date and details */}
                              <VStack spacing={0} align="end" flex={1}>
                                <Text fontSize="10px" color="gray.500" fontWeight="semibold">
                                  {completedDateTime}
                                </Text>
                                <Text fontSize="10px" color="gray.600">
                                  with {counterpartName || 'Trader'}
                                </Text>
                              </VStack>
                            </HStack>

                            {/* Product titles row */}
                            <Box>
                              <Text fontWeight="600" fontSize="11px" color="gray.900" noOfLines={1} title={offeredTitle}>
                                {offeredTitle}
                              </Text>
                              <Text fontWeight="600" fontSize="11px" color="gray.900" noOfLines={1} title={targetTitle}>
                                {targetTitle}
                              </Text>
                            </Box>

                            {/* Ratings row (compact inline) */}
                            {((buyerRating && buyerRating > 0) || (sellerRating && sellerRating > 0)) && (
                              <HStack spacing={2} fontSize="10px">
                                {buyerRating && buyerRating > 0 && (
                                  <HStack spacing={0.5} flexShrink={0}>
                                    <HStack spacing={0.25}>
                                      {[1, 2, 3, 4, 5].map((star) => (
                                        <Icon
                                          key={`buyer-star-${star}`}
                                          as={FiStar}
                                          boxSize={3}
                                          color={star <= buyerRating ? 'yellow.400' : 'gray.300'}
                                          fill={star <= buyerRating ? 'currentColor' : 'none'}
                                        />
                                      ))}
                                    </HStack>
                                    <Text fontSize="9px" color="gray.600" fontWeight="bold">{buyerRating}</Text>
                                  </HStack>
                                )}
                                {sellerRating && sellerRating > 0 && (
                                  <HStack spacing={0.5} flexShrink={0}>
                                    <HStack spacing={0.25}>
                                      {[1, 2, 3, 4, 5].map((star) => (
                                        <Icon
                                          key={`seller-star-${star}`}
                                          as={FiStar}
                                          boxSize={3}
                                          color={star <= sellerRating ? 'yellow.400' : 'gray.300'}
                                          fill={star <= sellerRating ? 'currentColor' : 'none'}
                                        />
                                      ))}
                                    </HStack>
                                    <Text fontSize="9px" color="gray.600" fontWeight="bold">{sellerRating}</Text>
                                  </HStack>
                                )}
                              </HStack>
                            )}

                            {/* Feedback (compact inline) */}
                            {(buyerFeedback?.trim() || sellerFeedback?.trim()) && (
                              <Box fontSize="9px" color="gray.700" bg="blue.50" p={1.5} borderRadius="sm">
                                {buyerFeedback?.trim() && (
                                  <Text noOfLines={1} fontStyle="italic">
                                    "{buyerFeedback.trim()}"
                                  </Text>
                                )}
                                {sellerFeedback?.trim() && (
                                  <Text noOfLines={1} fontStyle="italic">
                                    "{sellerFeedback.trim()}"
                                  </Text>
                                )}
                              </Box>
                            )}
                          </VStack>

                          {/* Action buttons if needed - compact */}
                          {trade.status === 'completed' && !activity.review && currentUser && completedTradesNeedingReview.has(trade.id) && (
                            <HStack justify="center" mt={1.5} pt={1.5} borderTop="1px solid" borderColor="gray.200" spacing={2}>
                              <Text fontSize="9px" color="amber.600" fontWeight="bold">
                                ⭐ Review needed
                              </Text>
                              <Button
                                size="xs"
                                colorScheme="brand"
                                height="20px"
                                fontSize="9px"
                                onClick={() => handleOpenReviewModal(trade.id)}
                              >
                                Rate
                              </Button>
                            </HStack>
                          )}
                        </Box>
                      )
                    })}
                  </Box>
                )}
              </TabPanel>


          </TabPanels>
        </Tabs>

        {/* Edit Profile Modal */}
        <Modal isOpen={isEditOpen} onClose={closeEdit} size="lg">
          <ModalOverlay />
          <ModalContent>
            <ModalHeader>Edit Profile</ModalHeader>
            <ModalCloseButton />
            <ModalBody pb={6}>
              <VStack spacing={4} align="stretch">
                <FormControl>
                  <FormLabel htmlFor="profile-photo-input">Profile Photo</FormLabel>
                  <HStack spacing={4} align="center">
                    <VerifiedAvatar size="lg" name={user.name} src={avatarPreview || user.avatar_url} isVerified={user.verification_status === 'verified' || user.verified} />
                    <Box>
                      <Input
                        id="profile-photo-input"
                        ref={avatarInputRef}
                        type="file"
                        accept="image/*"
                        display="none"
                        onChange={handleAvatarSelect}
                        aria-label="Choose profile photo"
                        title="Choose profile photo"
                      />
                      <HStack>
                        <Button size="sm" colorScheme="brand" onClick={() => avatarInputRef.current?.click()}>Choose Photo</Button>
                      </HStack>
                    </Box>
                  </HStack>
                </FormControl>
                <FormControl>
                  <FormLabel htmlFor="background-photo-input">Background Photo</FormLabel>
                  <Box>
                    <Box
                      ref={containerRef}
                      h="160px"
                      w="100%"
                      borderRadius="md"
                      mb={2}
                      bgImage={`url(${backgroundPreview || user?.background_url || '/profile-bg-default.jpg'})`}
                      bgSize="cover"
                      bgPos={`${backgroundPos.x}% ${backgroundPos.y}%`}
                      cursor={isDraggingBg ? 'grabbing' : 'grab'}
                      position="relative"
                      overflow="hidden"
                      onMouseDown={onBgPointerDown}
                      onMouseMove={onBgPointerMove}
                      onMouseUp={onBgPointerUp}
                      onMouseLeave={onBgPointerUp}
                      onTouchStart={onBgPointerDown}
                      onTouchMove={onBgPointerMove}
                      onTouchEnd={onBgPointerUp}
                    >
                      <Box position="absolute" bottom="2" left="3" bg="blackAlpha.600" color="white" px={2} py={1} borderRadius="md" fontSize="xs">
                        Drag to reposition
                      </Box>
                    </Box>
                    <Input
                      id="background-photo-input"
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      display="none"
                      onChange={handleBackgroundSelect}
                      aria-label="Choose background photo"
                      title="Choose background photo"
                    />
                    <HStack>
                      <Button size="sm" onClick={() => fileInputRef.current?.click()}>Choose Photo</Button>
                      <Button size="sm" variant="ghost" onClick={() => { setBackgroundFile(null); setBackgroundPreview(user?.background_url || null); setBackgroundPos({ x: 50, y: 50 }); }}>Reset</Button>
                    </HStack>
                  </Box>
                </FormControl>

                <FormControl isRequired>
                  <HStack justify="space-between" mb={2}>
                    <FormLabel mb={0}>Bio</FormLabel>
                    <Text fontSize="sm" color={draftBio.length < 30 ? 'red.500' : draftBio.length > 50 ? 'red.500' : 'green.500'}>
                      {draftBio.length}/50 {draftBio.length >= 30 ? '✓' : '(min 30)'}
                    </Text>
                  </HStack>
                  <Textarea
                    value={draftBio}
                    onChange={(e) => {
                      if (e.target.value.length <= 50) {
                        setDraftBio(e.target.value)
                      }
                    }}
                    rows={4}
                    placeholder="Tell buyers about yourself (30-50 characters required)"
                    maxLength={50}
                    borderColor={draftBio.length < 30 ? 'red.300' : 'gray.300'}
                  />
                </FormControl>

                <HStack justify="flex-end">
                  <Button onClick={closeEdit} variant="ghost">Cancel</Button>
                  <Button
                    colorScheme="brand"
                    onClick={handleSaveProfile}
                    isDisabled={draftBio.length < 30}
                    title={draftBio.length < 30 ? `Bio must be at least 30 characters (${30 - draftBio.length} more needed)` : ''}
                  >
                    Save Changes
                  </Button>
                </HStack>
              </VStack>
            </ModalBody>
          </ModalContent>
        </Modal>

        {/* Review Modal */}
        <Modal isOpen={isOpen} onClose={onClose} size="lg">
          <ModalOverlay />
          <ModalContent>
            <ModalHeader>Leave a Review for <Box as="span" textTransform="capitalize">{user.name}</Box></ModalHeader>
            <ModalCloseButton />
            <ModalBody pb={6}>
              <VStack spacing={4} align="stretch">
                <FormControl isRequired>
                  <FormLabel>Your Rating</FormLabel>
                  <HStack spacing={1} mb={2}>
                    {[1, 2, 3, 4, 5].map((star) => (
                      <IconButton
                        key={star}
                        aria-label={`${star} star`}
                        icon={<Icon as={FiStar} />}
                        variant="ghost"
                        color={star <= reviewRating ? 'yellow.400' : 'gray.300'}
                        _hover={{ color: 'yellow.500', transform: 'scale(1.1)' }}
                        transition="all 0.2s"
                        size="lg"
                        onClick={() => setReviewRating(star)}
                      />
                    ))}
                  </HStack>
                  {reviewRating > 0 && (
                    <Text fontSize="sm" color="gray.600">
                      {reviewRating === 1 && 'Poor'}
                      {reviewRating === 2 && 'Fair'}
                      {reviewRating === 3 && 'Good'}
                      {reviewRating === 4 && 'Very Good'}
                      {reviewRating === 5 && 'Excellent'}
                    </Text>
                  )}
                </FormControl>


                <FormControl>
                  <FormLabel>Upload Photo of Item (Optional)</FormLabel>
                  {reviewPhotoPreview ? (
                    <Box>
                      <Box
                        position="relative"
                        w="100%"
                        maxH="200px"
                        borderRadius="md"
                        overflow="hidden"
                        bg="gray.100"
                        mb={2}
                      >
                        <Image
                          src={reviewPhotoPreview}
                          alt="Review photo preview"
                          w="100%"
                          h="100%"
                          objectFit="cover"
                        />
                        <Button
                          position="absolute"
                          top={2}
                          right={2}
                          size="sm"
                          colorScheme="red"
                          onClick={clearReviewPhoto}
                        >
                          Remove
                        </Button>
                      </Box>
                      <Text fontSize="sm" color="green.600">
                        ✓ Photo selected
                      </Text>
                    </Box>
                  ) : (
                    <Box>
                      <Input
                        ref={reviewPhotoInputRef}
                        type="file"
                        accept="image/*"
                        display="none"
                        onChange={handleReviewPhotoSelect}
                        aria-label="Choose review photo"
                        title="Choose review photo"
                      />
                      <Button
                        size="sm"
                        variant="outline"
                        colorScheme="brand"
                        onClick={() => reviewPhotoInputRef.current?.click()}
                      >
                        Choose Photo
                      </Button>
                      <Text fontSize="xs" color="gray.500" mt={2}>
                        Upload a photo of the received item to verify the trade. (Optional)
                      </Text>
                    </Box>
                  )}
                </FormControl>


                  <FormControl isRequired>
                    <FormLabel>Your Review</FormLabel>
                    <Textarea
                      value={reviewComment}
                      onChange={(e) => setReviewComment(e.target.value)}
                      placeholder="Share details about your experience with this trader..."
                      rows={5}
                      maxLength={500}
                    />
                    <Text fontSize="xs" color="gray.500" mt={1} textAlign="right">
                      {reviewComment.length}/500 characters
                    </Text>
                  </FormControl>


                <HStack justify="flex-end" spacing={3}>
                  <Button
                    variant="ghost"
                    onClick={onClose}
                    isDisabled={isSubmittingReview}
                  >
                    Cancel
                  </Button>
                  <Button
                    colorScheme="brand"
                    leftIcon={<Icon as={FiSend} />}
                    onClick={handleSubmitReview}
                    isLoading={isSubmittingReview}
                    loadingText="Submitting..."
                    isDisabled={reviewRating === 0 || !reviewComment.trim()}
                  >
                    Submit Review
                  </Button>
                </HStack>
              </VStack>
            </ModalBody>
          </ModalContent>
        </Modal>
      </VStack>
    </Container>
    </Box >
  )
}

export default UserProfile



