import React, { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate, Link as RouterLink } from 'react-router-dom'
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
  Divider,
  SimpleGrid,
  useToast,
  Icon,
  IconButton,
  Menu,
  MenuButton,
  MenuList,
  MenuItem,
  useDisclosure,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalCloseButton,
  Input,
  Tooltip,
  Grid,
  Avatar,
  ButtonGroup,
  Select,
  Textarea,
  Skeleton,
  useColorModeValue,
  Wrap,
  WrapItem,
} from '@chakra-ui/react'
import {
  FiHeart,
  FiShare2,
  FiCopy,
  FiCheckCircle,
  FiFacebook,
  FiTwitter,
  FiInstagram,
  FiMail,
  FiMessageCircle,
  FiBookmark,
  FiCalendar,
  FiTrendingUp,
  FiTrendingDown,
  FiFlag,
  FiAlertTriangle,
  FiStar,
} from 'react-icons/fi'
import { FaHandshake } from 'react-icons/fa'
import { useAuth } from '../contexts/AuthContext'
import { useProducts } from '../contexts/ProductContext'
import { Product, User } from '../types'
import { api } from '../services/api'
import { getFirstImage, getImageUrl } from '../utils/imageUtils';
import { getProductUrl } from '../utils/productUtils'
import TradeModal from '../components/TradeModal'
import BuyoutModal from '../components/BuyoutModal'
import CounterfeitWarning from '../components/CounterfeitWarning'
import ProximityBadge from '../components/ProximityBadge'
import ResponseMetricsBadge from '../components/ResponseMetricsBadge'
import FloatingTab from '../components/FloatingTab'
import VerifiedAvatar from '../components/VerifiedAvatar'
import MediaGallery from '../components/MediaGallery'
import TrustScoreCard from '../components/TrustScoreCard'
import axios from 'axios';
import { CloseIcon } from '@chakra-ui/icons'

const ProductDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const { user } = useAuth()
  const { getProduct, getUserProducts, recordProductView, markProductBoosted } = useProducts()
  const [product, setProduct] = useState<Product | null>(null)
  const [sellerProducts, setSellerProducts] = useState<Product[]>([])
  const [sellerStats, setSellerStats] = useState<any | null>(null)
  const [sellerProfile, setSellerProfile] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [purchasing, setPurchasing] = useState(false)
  const [isTradeOpen, setIsTradeOpen] = useState(false)
  const [isBuyoutOpen, setIsBuyoutOpen] = useState(false)
  const [tradeTargetProductId, setTradeTargetProductId] = useState<number | null>(null)
  const [isSaved, setIsSaved] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [wishlistCount, setWishlistCount] = useState<number>(0)
  const [isWishlisted, setIsWishlisted] = useState<boolean>(false)
  const [votes, setVotes] = useState<{ under: number; over: number }>({ under: 0, over: 0 })
  const [userVote, setUserVote] = useState<string>('')
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false)
  const [offersForProduct, setOffersForProduct] = useState<any[]>([])
  const [loadingOffers, setLoadingOffers] = useState(false)
  const [offersModalOpen, setOffersModalOpen] = useState(false)
  const [offersSortBy, setOffersSortBy] = useState<'newest' | 'oldest' | 'accepted'>('accepted')
  const [isReportOpen, setIsReportOpen] = useState(false)
  const [reportReason, setReportReason] = useState('')
  const [reportDescription, setReportDescription] = useState('')
  const [isSubmittingReport, setIsSubmittingReport] = useState(false)
  const [hasPendingOfferOnProduct, setHasPendingOfferOnProduct] = useState(false)
  const [loadingPendingOffer, setLoadingPendingOffer] = useState(false)
  const [isBuyModalOpen, setIsBuyModalOpen] = useState(false)
  const [isSettingCover, setIsSettingCover] = useState(false)
  const [isVoting, setIsVoting] = useState(false)
  const [isCopying, setIsCopying] = useState(false)
  const [isWishlisting, setIsWishlisting] = useState(false)
  const [loadingProducts, setLoadingProducts] = useState(false)
  const [upgradingPremium, setUpgradingPremium] = useState(false)
  const [boosting, setBoosting] = useState(false)
  const trackedViewRef = useRef<string | null>(null)

  const navigate = useNavigate()
  const toast = useToast()
  const { isOpen: isShareOpen, onOpen: onShareOpen, onClose: onShareClose } = useDisclosure()
  const detailBg = useColorModeValue('white', 'gray.900')
  const detailText = useColorModeValue('gray.800', 'gray.100')
  const detailMuted = useColorModeValue('gray.600', 'gray.400')
  const detailBorder = useColorModeValue('gray.200', 'gray.700')
  const detailSurface = useColorModeValue('gray.50', 'gray.800')

  const handleSetCover = async (imageIndex: number) => {
    if (!product) return
    setIsSettingCover(true)
    try {
      const reordered = [...product.image_urls]
      const [selected] = reordered.splice(imageIndex, 1)
      reordered.unshift(selected)
      await api.put(`/api/products/${product.id}/reorder-images`, { image_urls: reordered })
      setProduct({ ...product, image_urls: reordered })
      toast({ id: 'cover-image-updated', title: 'Cover image updated', status: 'success', duration: 2000 })
    } catch {
      toast({ id: 'failed-update-cover-image', title: 'Failed to update cover image', status: 'error', duration: 3000 })
    } finally {
      setIsSettingCover(false)
    }
  }

  useEffect(() => {
    if (id) {
      fetchProduct()
    }
  }, [id])

  useEffect(() => {
    if (!product || !id) return

    const trackedKey = `product_viewed_${product.id}`
    if (trackedViewRef.current === trackedKey || sessionStorage.getItem(trackedKey) === '1') {
      return
    }

    trackedViewRef.current = trackedKey
    sessionStorage.setItem(trackedKey, '1')

    api.post(`/api/products/${product.id}/view`).then((response) => {
      recordProductView(product.id)
      const nextViewCount = response.data?.data?.view_count
      if (typeof nextViewCount === 'number') {
        setProduct((current) => current ? { ...current, view_count: nextViewCount } : current)
      }
    }).catch((error) => {
      console.error('Failed to track view:', error)
    })
  }, [product, id, recordProductView])

  // Fetch seller's other products (for Seller Products section)
  useEffect(() => {
    const loadSellerProducts = async () => {
      if (!product) return
      try {
        const resp = await getUserProducts(product.seller_id, 1)
        setSellerProducts(resp?.data || [])
      } catch (err) {
        // ignore errors for this non-critical UX enhancement
        setSellerProducts([])
      }
    }
    loadSellerProducts()
  }, [product, getUserProducts])

  // Fetch seller's statistics
  useEffect(() => {
    const loadSellerStats = async () => {
      if (!product) return
      try {
        // Use the axios `api` client so requests go to the configured backend
        // The backend API in this project is prefixed with /api
        const resp = await api.get(`/api/users/${product.seller_id}/stats`)
        if (resp && resp.data) {
          setSellerStats(resp.data.data)
        }
      } catch (err) {
        // Treat 404 (endpoint missing) as non-fatal and use safe defaults
        if (axios.isAxiosError(err)) {
          const status = err.response?.status
          if (import.meta.env.DEV) {
            // eslint-disable-next-line no-console
            console.debug('Seller stats request failed', { status, url: err.config?.url })
          }
          if (status === 404) {
            // Provide sensible defaults so UI shows N/A instead of failing
            setSellerStats({ avg_rating: null, positive_percent: null, total_trades: 0, avg_response_time: null })
            return
          }
          // For other statuses, log details for debugging
          // eslint-disable-next-line no-console
          console.error('Failed to fetch seller stats:', JSON.stringify({
            message: err.message,
            status: err.response?.status,
            url: err.config?.url,
            data: err.response?.data,
          }))
        } else {
          // eslint-disable-next-line no-console
          console.error('Failed to fetch seller stats (non-Axios error):', err)
        }
        // Fallback defaults to keep UI stable
        setSellerStats({ avg_rating: null, positive_percent: null, total_trades: 0, avg_response_time: null })
      }
    }
    loadSellerStats()
  }, [product])

  // Load seller profile (to display uploaded profile picture)
  useEffect(() => {
    const loadSellerProfile = async () => {
      if (!product) return
      try {
        const resp = await api.get(`/api/users/${product.seller_id}`)
        const userData = resp.data?.data as User | undefined

        if (userData) {
          // Normalize profile picture URL if it exists and is not empty
          const profilePic = userData.profile_picture
          if (profilePic && typeof profilePic === 'string' && profilePic.trim() !== '' && profilePic !== 'undefined') {
            try {
              const normalizedUrl = getImageUrl(profilePic)
              userData.profile_picture = normalizedUrl
            } catch (e) {
              console.error('❌ Failed to normalize profile picture URL:', e)
              userData.profile_picture = undefined
            }
          } else {
            userData.profile_picture = undefined
          }
        }
        setSellerProfile(userData || null)
      } catch (err) {
        console.error('❌ Failed to load seller profile', err)
        setSellerProfile(null)
      }
    }
    loadSellerProfile()
  }, [product])

  useEffect(() => {
    if (product && user) {
      checkWishlistStatus();
    }
    if (product) {
      setWishlistCount(product.wishlist_count || 0);
    }
  }, [product, user]);

  // Check if user has a pending offer on this product
  useEffect(() => {
    if (!product || !user) {
      setHasPendingOfferOnProduct(false)
      return
    }

    const checkPendingOffer = async () => {
      try {
        setLoadingPendingOffer(true)
        // Fetch user's outgoing pending trades
        const response = await api.get(`/api/trades?direction=outgoing&status=pending&limit=100`)
        const trades = Array.isArray(response.data?.data) ? response.data.data : []

        // Check if any pending trade matches current product ID
        const hasPending = trades.some((trade: any) => trade.target_product_id === product.id)
        setHasPendingOfferOnProduct(hasPending)
      } catch (error) {
        console.error('Failed to check pending offers:', error)
        setHasPendingOfferOnProduct(false)
      } finally {
        setLoadingPendingOffer(false)
      }
    }

    checkPendingOffer()
  }, [product, user]);

  const checkWishlistStatus = async () => {
    if (!product || !user) return;
    try {
      const response = await api.get(`/api/products/${product.id}/wishlist/status`);
      if (response.data.success) {
        setIsWishlisted(response.data.data.is_wishlisted);
      }
    } catch (error) {
      // Handle error
    }
  };

  const handleWishlist = async () => {
    if (!user) {
      toast({
        id: "auth-required-wishlist",
        title: "Authentication required",
        description: "Please log in to wishlist this product",
        status: "warning",
        duration: 3000,
        isClosable: true,
      });
      navigate("/login");
      return;
    }

    if (!product || isWishlisting) return;
    setIsWishlisting(true);

    try {
      if (isWishlisted) {
        await api.delete(`/api/products/${product.id}/wishlist`);
        setWishlistCount(wishlistCount - 1);
        setIsWishlisted(false);
        toast({
          id: "removed-from-wishlist",
          title: "Removed from wishlist",
          status: "success",
          duration: 2000,
          isClosable: true,
        });
      } else {
        await api.post(`/api/products/${product.id}/wishlist`);
        setWishlistCount(wishlistCount + 1);
        setIsWishlisted(true);
        toast({
          id: "added-to-wishlist",
          title: "Added to wishlist",
          status: "success",
          duration: 2000,
          isClosable: true,
        });
      }
    } catch (error) {
      toast({
        id: "error-wishlist",
        title: "Error",
        description: "Something went wrong. Please try again.",
        status: "error",
        duration: 3000,
        isClosable: true,
      });
    } finally {
      setIsWishlisting(false);
    }
  };

  const fetchProduct = async () => {
    try {
      setLoading(true)
      setError('')

      const identifier = id!
      // Direct API call so we can read vote counts and user_vote in the response
      const productId = parseInt(identifier)
      if (!isNaN(productId) && identifier === productId.toString()) {
        // numeric ID - fetch and possibly redirect
        const response = await api.get(`/api/products/${productId}`)
        const data = response.data?.data
        if (data?.product) {
          const p = data.product as Product
          setProduct(p)
          setVotes(data.votes || { under: 0, over: 0 })
          setUserVote(data.user_vote || '')
          if (p.slug) {
            navigate(`/products/${p.slug}`, { replace: true })
            return
          }
        } else if (data) {
          const p = data as Product
          setProduct(p)
          setVotes({ under: 0, over: 0 })
          setUserVote('')
        } else {
          setError('Product not found')
        }
      } else {
        const response = await api.get(`/api/products/${identifier}`)
        const data = response.data?.data
        if (data?.product) {
          const p = data.product as Product
          setProduct(p)
          setVotes(data.votes || { under: 0, over: 0 })
          setUserVote(data.user_vote || '')
        } else if (data) {
          const p = data as Product
          setProduct(p)
          setVotes({ under: 0, over: 0 })
          setUserVote('')
        } else {
          setError('Product not found')
        }
      }
    } catch (err: unknown) {
      if (axios.isAxiosError(err)) {
        const status = err.response?.status
        if (status === 403) {
          setError('This item is no longer available')
        } else if (status === 404) {
          setError('Product not found')
        } else {
          setError(err.response?.data?.error || 'An unexpected error occurred')
        }
      } else if (err instanceof Error) {
        setError(err.message)
      } else {
        setError('An unexpected error occurred')
      }
    } finally {
      setLoading(false)
    }
  }

  const handlePurchase = () => {
    if (!user) {
      toast({
        id: 'auth-required-purchase',
        title: 'Authentication required',
        description: 'Please log in to purchase this product',
        status: 'warning',
        duration: 3000,
        isClosable: true,
      })
      navigate('/login')
      return
    }
    if (!product) return
    setIsBuyModalOpen(true)
  }

  const confirmPurchase = async () => {
    if (!product) return
    try {
      setPurchasing(true)
      await api.post('/api/orders', {
        product_id: product.id,
      })
      setIsBuyModalOpen(false)
      toast({
        id: 'order-placed-successfully',
        title: 'Order placed successfully!',
        description: 'Your order has been created and is pending trader confirmation.',
        status: 'success',
        duration: 5000,
        isClosable: true,
      })
      navigate('/dashboard')
    } catch (err: unknown) {
      let description = 'Failed to place order';
      if (axios.isAxiosError(err)) {
        description = err.response?.data?.error || description;
      } else if (err instanceof Error) {
        description = err.message;
      }
      toast({
        id: 'purchase-failed',
        title: 'Purchase failed',
        description,
        status: 'error',
        duration: 5000,
        isClosable: true,
      })
    } finally {
      setPurchasing(false)
    }
  }

  const handleSubmitReport = async () => {
    if (!user) {
      toast({
        id: 'auth-required-report',
        title: 'Authentication required',
        description: 'Please log in to report this trader',
        status: 'warning',
        duration: 3000,
        isClosable: true,
      })
      navigate('/login')
      return
    }

    if (!product) return

    if (!reportReason.trim()) {
      toast({
        id: 'reason-required',
        title: 'Reason required',
        description: 'Please select a reason for your report',
        status: 'warning',
        duration: 3000,
        isClosable: true,
      })
      return
    }

    try {
      setIsSubmittingReport(true)
      await api.post('/api/products/report', {
        product_id: product.id,
        reason: reportReason,
        details: reportDescription,
      })

      toast({
        id: 'report-submitted',
        title: 'Report submitted',
        description: 'Thank you for helping keep Clovia safe. We will review your report.',
        status: 'success',
        duration: 5000,
        isClosable: true,
      })

      // Reset and close modal
      setReportReason('')
      setReportDescription('')
      setIsReportOpen(false)
    } catch (err: unknown) {
      let description = 'Failed to submit report';
      if (axios.isAxiosError(err)) {
        description = err.response?.data?.error || description;
      } else if (err instanceof Error) {
        description = err.message;
      }
      toast({
        id: 'report-failed',
        title: 'Report failed',
        description,
        status: 'error',
        duration: 5000,
        isClosable: true,
      })
    } finally {
      setIsSubmittingReport(false)
    }
  }

  const openTrade = () => {
    if (!user) {
      toast({
        id: 'auth-required-trade',
        title: 'Authentication required',
        description: 'Please log in to propose a trade',
        status: 'warning',
        duration: 3000,
        isClosable: true,
      })
      navigate('/login')
      return
    }
    if (product) {
      setTradeTargetProductId(product.id)
      setIsTradeOpen(true)
    }
  }

  const openBuyout = () => {
    if (!user) {
      toast({
        id: 'auth-required-buyout',
        title: 'Authentication required',
        description: 'Please log in to make a buyout offer',
        status: 'warning',
        duration: 3000,
        isClosable: true,
      })
      navigate('/login')
      return
    }
    if (product) {
      setIsBuyoutOpen(true)
    }
  }

  // Check if product is saved on component mount
  useEffect(() => {
    if (product && user) {
      checkSavedStatus()
    } else if (product && !user) {
      // Check localStorage for guest users
      const savedProducts = JSON.parse(localStorage.getItem('savedProducts') || '[]')
      setIsSaved(savedProducts.includes(product.id))
    }
  }, [product, user])

  const checkSavedStatus = async () => {
    if (!product || !user) return

    try {
      const response = await api.get(`/api/users/saved-products/${product.id}`)
      setIsSaved(response.data.data.isSaved)
    } catch (error) {
      // If API fails, check localStorage as fallback
      const savedProducts = JSON.parse(localStorage.getItem('savedProducts') || '[]')
      setIsSaved(savedProducts.includes(product.id))
    }
  }

  const handleSaveToggle = async () => {
    if (!product) return

    if (!user) {
      // For guest users, use localStorage
      const savedProducts = JSON.parse(localStorage.getItem('savedProducts') || '[]')
      if (isSaved) {
        const updatedSaved = savedProducts.filter((id: number) => id !== product.id)
        localStorage.setItem('savedProducts', JSON.stringify(updatedSaved))
        setIsSaved(false)
        toast({
          id: 'removed-from-saved',
          title: 'Removed from saved',
          description: 'Product removed from your saved items',
          status: 'info',
          duration: 2000,
          isClosable: true,
        })
      } else {
        savedProducts.push(product.id)
        localStorage.setItem('savedProducts', JSON.stringify(savedProducts))
        setIsSaved(true)
        toast({
          id: 'saved-to-watchlist',
          title: 'Saved to watchlist',
          description: 'Product added to your saved items',
          status: 'success',
          duration: 2000,
          isClosable: true,
        })
      }
      return
    }

    // For logged-in users, use API
    try {
      setIsSaving(true)
      if (isSaved) {
        await api.delete(`/api/users/saved-products/${product.id}`)
        setIsSaved(false)
        toast({
          id: 'removed-from-saved-api',
          title: 'Removed from saved',
          description: 'Product removed from your saved items',
          status: 'info',
          duration: 2000,
          isClosable: true,
        })
      } else {
        await api.post(`/api/users/saved-products`, { product_id: product.id })
        setIsSaved(true)
        toast({
          id: 'saved-to-watchlist-api',
          title: 'Saved to watchlist',
          description: 'Product added to your saved items',
          status: 'success',
          duration: 2000,
          isClosable: true,
        })
      }
    } catch (error: any) {
      console.error('Save/unsave error:', error)
      let errorMessage = 'Failed to update saved status'

      if (error.response?.data?.error) {
        errorMessage = error.response.data.error
      } else if (error.response?.status === 404) {
        errorMessage = 'Product not found'
      } else if (error.response?.status === 401) {
        errorMessage = 'Please log in to save products'
      } else if (error.response?.status === 409) {
        errorMessage = 'Product already saved'
      }

      toast({
        id: 'error-save',
        title: 'Error',
        description: errorMessage,
        status: 'error',
        duration: 3000,
        isClosable: true,
      })
    } finally {
      setIsSaving(false)
    }
  }

  const handleShare = () => {
    if (!user) {
      toast({
        id: 'auth-required-share',
        title: 'Authentication required',
        description: 'Please log in to share this product',
        status: 'warning',
        duration: 3000,
        isClosable: true,
      })
      navigate('/login')
      return
    }
    onShareOpen()
  }

  const handleVote = async (voteType: 'under' | 'over') => {
    if (!user) {
      toast({
        id: 'auth-required-vote',
        title: 'Authentication required',
        description: 'Please log in to vote on price',
        status: 'warning',
        duration: 3000,
        isClosable: true,
      })
      navigate('/login')
      return
    }
    if (!product || isVoting) return

    // Show immediate feedback to user
    setIsVoting(true)
    toast({
      id: 'vote-recording',
      title: 'Recording your vote...',
      status: 'info',
      duration: 1000,
      isClosable: false,
    })

    try {
      const response = await api.post(`/api/products/${product.id}/vote`, { vote: voteType })
      const data = response.data?.data
      setVotes(data?.votes || { under: 0, over: 0 })
      setUserVote(data?.user_vote || voteType)
    } catch (err: unknown) {
      let description = 'Failed to submit vote'
      if (axios.isAxiosError(err)) {
        description = err.response?.data?.error || description
      } else if (err instanceof Error) {
        description = err.message
      }
      toast({
        id: 'error-vote',
        title: 'Error',
        description,
        status: 'error',
        duration: 3000,
        isClosable: true,
      })
    } finally {
      setIsVoting(false)
    }
  }

  const copyToClipboard = async () => {
    if (isCopying) return
    setIsCopying(true)
    // Use slug-based URL if available, otherwise use current URL
    const url = product?.slug
      ? `${window.location.origin}/products/${product.slug}`
      : window.location.href
    try {
      await navigator.clipboard.writeText(url)
      toast({
        id: "productdetail-link-copied",
        title: 'Link copied!',
        description: 'Product link copied to clipboard',
        status: 'success',
        duration: 2000,
        isClosable: true,
      })
    } catch (error) {
      toast({
        id: "productdetail-copy-failed",
        title: 'Copy failed',
        description: 'Failed to copy link to clipboard',
        status: 'error',
        duration: 3000,
        isClosable: true,
      })
    } finally {
      setTimeout(() => setIsCopying(false), 2000)
    }
  }

  const handleUpgradeToPremium = async () => {
    if (!product || upgradingPremium) return
    try {
      setUpgradingPremium(true)
      const response = await api.post(`/api/payments/premium/${product.id}`)
      if (response.data?.success && response.data?.data?.checkout_url) {
        window.location.href = response.data.data.checkout_url
      } else {
        throw new Error('Failed to create checkout session')
      }
    } catch (error: any) {
      toast({
        id: 'premium-upgrade-error',
        title: 'Upgrade Failed',
        description: error.response?.data?.error || error.message || 'An error occurred',
        status: 'error',
      })
    } finally {
      setUpgradingPremium(false)
    }
  }

  const handleBoostNow = async () => {
    if (!product || boosting) return

    try {
      setBoosting(true)
      toast({
        id: 'boost-pending',
        title: 'Boosting...',
        description: 'Your product is being boosted to the top of the feed.',
        status: 'loading',
        duration: null,
        isClosable: false,
      })

      const response = await api.post(`/api/products/boost/${product.id}`)
      if (response.data?.success) {
        toast({
          id: 'boost-success',
          title: '🚀 Boost Successful!',
          description: response.data.message || `"${product.title}" is now boosted for 3 hours!`,
          status: 'success',
          duration: 5000,
          isClosable: true,
        })
        markProductBoosted(product.id, new Date().toISOString())
        fetchProduct() // Refresh to update boosted_at
      }
    } catch (error: any) {
      const errorMsg = error.response?.data?.error || error.message || 'An error occurred'
      toast({
        id: 'boost-error',
        title: 'Boost Failed',
        description: errorMsg,
        status: 'error',
        duration: 5000,
        isClosable: true,
      })
    } finally {
      setBoosting(false)
    }
  }

  const shareToSocial = (platform: string) => {
    // Use slug-based URL if available
    const productUrl = product?.slug
      ? `${window.location.origin}/products/${product.slug}`
      : window.location.href
    const url = encodeURIComponent(productUrl)
    const title = encodeURIComponent(product?.title || 'Check out this product')
    const description = encodeURIComponent(product?.description || '')

    let shareUrl = ''
    switch (platform) {
      case 'facebook':
        shareUrl = `https://www.facebook.com/sharer/sharer.php?u=${url}`
        break
      case 'twitter':
        shareUrl = `https://twitter.com/intent/tweet?url=${url}&text=${title}`
        break
      case 'instagram':
        // Instagram doesn't support direct URL sharing, so we'll copy the link
        copyToClipboard()
        toast({
        id: "productdetail-instagram-sharing",
          title: 'Instagram sharing',
          description: 'Link copied! Paste it in your Instagram story or post',
          status: 'info',
          duration: 3000,
          isClosable: true,
        })
        return
      case 'email':
        shareUrl = `mailto:?subject=${title}&body=${description}%0A%0A${url}`
        break
      case 'whatsapp':
        shareUrl = `https://wa.me/?text=${title}%20${url}`
        break
    }
    if (shareUrl) {
      window.open(shareUrl, '_blank', 'width=600,height=400')
    }
  }

  const handleViewOffers = async () => {
    try {
      setLoadingOffers(true)
      const response = await api.get(`/api/trades`, {
        params: {
          direction: 'incoming',
          status: 'pending',
          limit: 100
        }
      })
      // Filter for this specific product
      const filteredOffers = (response.data?.data || []).filter((trade: any) => trade.target_product_id === product?.id)
      setOffersForProduct(filteredOffers)
      setOffersModalOpen(true)
    } catch (error) {
      toast({
        id: "productdetail-error",
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
    } else {
      ranked.sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    }

    return ranked
  }

  if (loading) {
    return (
      <Box bg="#FFFDF1" minH="100vh" w="100%">
        <Container maxW="container.xl" py={8}>
          <Grid templateColumns={{ base: '1fr', lg: '1fr 1fr' }} gap={8}>
            {/* Left side - Image skeleton */}
            <VStack spacing={4} align="stretch">
              <Skeleton height="400px" borderRadius="lg" />
              <HStack spacing={2}>
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} height="80px" flex="1" borderRadius="md" />
                ))}
              </HStack>
            </VStack>

            {/* Right side - Details skeleton */}
            <VStack spacing={6} align="stretch">
              {/* Title */}
              <VStack spacing={3} align="stretch">
                <Skeleton height="32px" width="100%" />
                <Skeleton height="24px" width="60%" />
              </VStack>

              {/* Category badges */}
              <HStack spacing={2}>
                <Skeleton height="24px" width="80px" borderRadius="full" />
                <Skeleton height="24px" width="100px" borderRadius="full" />
              </HStack>

              {/* Price section */}
              <VStack spacing={2} align="stretch" borderY="1px" borderColor="gray.200" py={4}>
                <Skeleton height="28px" width="40%" />
                <Skeleton height="20px" width="30%" />
              </VStack>

              {/* Seller info */}
              <HStack spacing={3} p={4} bg="gray.50" borderRadius="lg">
                <Skeleton height="50px" width="50px" borderRadius="full" />
                <VStack spacing={2} align="start" flex="1">
                  <Skeleton height="18px" width="40%" />
                  <Skeleton height="16px" width="60%" />
                </VStack>
              </HStack>

              {/* Action buttons */}
              <VStack spacing={3} align="stretch">
                <Skeleton height="44px" borderRadius="md" />
                <Skeleton height="44px" borderRadius="md" />
              </VStack>

              {/* Description skeleton */}
              <VStack spacing={2} align="stretch" pt={4}>
                <Skeleton height="20px" width="30%" />
                <Skeleton height="16px" width="100%" />
                <Skeleton height="16px" width="100%" />
                <Skeleton height="16px" width="80%" />
              </VStack>
            </VStack>
          </Grid>
        </Container>
      </Box>
    )
  }

  if (error || !product) {
    return (
      <Box bg="#FFFDF1" minH="100vh" w="100%">
        <Container maxW="container.md" py={8}>
          <Alert status="error">
            <AlertIcon />
            {error || 'Product not found'}
          </Alert>
        </Container>
      </Box>
    )
  }

  const isOwner = user && user.id === product.seller_id
  const isUnavailable = product.status === 'traded' || product.status === 'sold' || product.status === 'locked'
  const canTradeOrPurchase = !isOwner && product.status === 'available'

  const formatPrice = (value: unknown): string => {
    const num = Number(value)
    if (!Number.isFinite(num)) return ''
    return num.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })
  }

  const listedPrice = Number(product.price)
  const hasListedPrice = Number.isFinite(listedPrice) && listedPrice > 0
  const fairMin = Number(product.estimated_value_min)
  const fairMax = Number(product.estimated_value_max)
  const canShowEstimate = product.show_estimated_value !== false
  const hasFairRange = canShowEstimate && Number.isFinite(fairMin) && Number.isFinite(fairMax) && fairMin > 0 && fairMax > fairMin

  const belowEstimateThreshold = 0.85
  const isSignificantlyBelowEstimate = hasListedPrice && hasFairRange && listedPrice < fairMin * belowEstimateThreshold
  const isOverpricedEstimate = hasListedPrice && hasFairRange && listedPrice > fairMax
  const isPricedRightEstimate = hasListedPrice && hasFairRange && listedPrice >= fairMin && listedPrice <= fairMax

  let scaleMin = 0
  let scaleMax = 100
  let fairStart = 0
  let fairWidth = 0
  let listedPosition = 0

  if (hasFairRange) {
    const spread = Math.max(fairMax - fairMin, fairMax * 0.18)
    scaleMin = Math.max(0, fairMin - spread)
    scaleMax = fairMax + spread
    const denominator = Math.max(scaleMax - scaleMin, 1)
    fairStart = ((fairMin - scaleMin) / denominator) * 100
    fairWidth = ((fairMax - fairMin) / denominator) * 100
    listedPosition = hasListedPrice ? ((listedPrice - scaleMin) / denominator) * 100 : fairStart + fairWidth / 2
    listedPosition = Math.min(100, Math.max(0, listedPosition))
  }

  let estimateGapNote = 'AI estimate is not available for this listing yet.'
  if (hasListedPrice && hasFairRange) {
    if (listedPrice < fairMin) {
      estimateGapNote = `Listed at ₱${formatPrice(listedPrice)} - significantly below the estimated fair range. Verify item condition.`
    } else if (listedPrice > fairMax) {
      estimateGapNote = `Listed at ₱${formatPrice(listedPrice)} - above the estimated fair range. Compare against similar listings.`
    } else {
      estimateGapNote = `Listed at ₱${formatPrice(listedPrice)} - within the estimated fair range.`
    }
  }

  return (
    <Box bg="#FFFDF1" minH="100vh" w="100%" pb={{ base: 20, lg: 6 }}>
      <Container maxW="container.xl" py={{ base: 4, md: 8 }}>
        <VStack spacing={8} align="stretch">
          <Box bg="white" borderRadius="3xl" overflow="hidden" shadow="xl" p={{ base: 2, md: 4 }}>
            <SimpleGrid columns={{ base: 1, lg: 2 }} spacing={6}>
              {/* Product Media Gallery */}
              <VStack spacing={3} align="stretch" p={{ base: 2, md: 4 }}>
                <Box position="relative">
                  <MediaGallery
                    imageUrls={product.image_urls}
                    videoUrl={product.video_url}
                    productTitle={product.title}
                    productStatus={product.status}
                    isPremium={product.premium}
                    wishlistCount={wishlistCount}
                    condition={product.condition}
                    category={product.category}
                    listedDate={new Date(product.created_at).toLocaleDateString()}
                    isOwner={user?.id === product.seller_id}
                    onSetCover={handleSetCover}
                    isSettingCover={isSettingCover}
                  />

                  {!isOwner && (
                    <Box
                      position="absolute"
                      top={{ base: 'auto', md: 2 }}
                      bottom={{ base: 2, md: 'auto' }}
                      right={{ base: 1.5, md: 2 }}
                      zIndex={2}
                      bg="blackAlpha.600"
                      color="white"
                      border="1px solid"
                      borderColor="whiteAlpha.300"
                      borderRadius={{ base: '8px', md: '10px' }}
                      px={{ base: 1.5, md: 2 }}
                      py={{ base: 1, md: 1.5 }}
                      boxShadow="0 4px 14px rgba(0, 0, 0, 0.35)"
                      backdropFilter="blur(6px)"
                      maxW={{ base: '170px', md: 'none' }}
                    >
                      <VStack spacing={1} align="end">
                        <Text fontSize="2xs" fontWeight="700" color="white" lineHeight="1" textAlign="right">
                          Is this price accurate?
                        </Text>
                        <HStack spacing={1} flexWrap="wrap" justify="flex-end">
                          <Button
                            leftIcon={<FiTrendingUp />}
                            borderRadius="full"
                            size="xs"
                            h={{ base: '21px', md: '24px' }}
                            px={{ base: 1.5, md: 2 }}
                            fontSize="2xs"
                            variant={userVote === 'under' ? 'solid' : 'outline'}
                            colorScheme={userVote === 'under' ? 'green' : 'gray'}
                            borderColor="whiteAlpha.500"
                            color={userVote === 'under' ? 'white' : 'white'}
                            onClick={() => handleVote('under')}
                            isDisabled={Boolean(product.price === null || product.price === undefined || isOwner)}
                            isLoading={isVoting}
                          >
                            Too low
                          </Button>
                          <Button
                            leftIcon={<FiTrendingDown />}
                            borderRadius="full"
                            size="xs"
                            h={{ base: '21px', md: '24px' }}
                            px={{ base: 1.5, md: 2 }}
                            fontSize="2xs"
                            variant={userVote === 'over' ? 'solid' : 'outline'}
                            colorScheme={userVote === 'over' ? 'orange' : 'gray'}
                            borderColor="whiteAlpha.500"
                            color={userVote === 'over' ? 'white' : 'white'}
                            onClick={() => handleVote('over')}
                            isDisabled={Boolean(product.price === null || product.price === undefined || isOwner)}
                            isLoading={isVoting}
                          >
                            Too high
                          </Button>
                        </HStack>
                      </VStack>
                    </Box>
                  )}
                </Box>
                {product.id && user && <ProximityBadge type="product" targetId={product.id} />}
              </VStack>

              {/* Product Details */}
              <Box
                p={{ base: 4, md: 5, lg: 6 }}
                display="flex"
                flexDirection="column"
                bg={detailBg}
                borderRadius="3xl"
                borderWidth="0"
                boxShadow="sm"
                bgGradient="linear(to-br, gray.50, white)"
                maxW="560px"
                w="100%"
                mx="auto"
                sx={{
                  '--pd-bg': detailBg,
                  '--pd-text': detailText,
                  '--pd-muted': detailMuted,
                  '--pd-border': detailBorder,
                  '--pd-surface': detailSurface,
                }}
              >
                <VStack spacing={6} align="stretch" flex={1}>
                  {/* Counterfeit Warning */}
                  {product && <CounterfeitWarning productId={product.id} />}

                  <Box>
                    <VStack spacing={4} align="stretch">
                      {/* Section 1: Header */}
                      <Box>
                        <Flex justify="space-between" align="flex-start" gap={3} flexDirection={{ base: 'column', md: 'row' }}>
                          <VStack align="start" spacing={2} flex={1} minW={0}>
                            <Heading
                              mb={0}
                              color="var(--pd-text)"
                              fontSize={{ base: 'xl', md: '2xl' }}
                              lineHeight="1.25"
                              wordBreak="break-word"
                            >
                              {product.title.charAt(0).toUpperCase() + product.title.slice(1)}
                            </Heading>
                            {isSignificantlyBelowEstimate && (
                              <Badge
                                colorScheme="orange"
                                variant="subtle"
                                borderRadius="full"
                                px={3}
                                py={1}
                                fontSize="xs"
                              >
                                Priced below AI estimate
                              </Badge>
                            )}
                            {!isSignificantlyBelowEstimate && isOverpricedEstimate && (
                              <Badge
                                colorScheme="red"
                                variant="subtle"
                                borderRadius="full"
                                px={3}
                                py={1}
                                fontSize="xs"
                              >
                                Overpriced vs AI estimate
                              </Badge>
                            )}
                            {!isSignificantlyBelowEstimate && !isOverpricedEstimate && isPricedRightEstimate && (
                              <Badge
                                colorScheme="green"
                                variant="subtle"
                                borderRadius="full"
                                px={3}
                                py={1}
                                fontSize="xs"
                              >
                                Priced right for AI estimate
                              </Badge>
                            )}
                            {product.bidding_type && product.bidding_type !== 'none' && (
                              <Badge
                                colorScheme="gray"
                                variant="subtle"
                                borderRadius="full"
                                px={3}
                                py={1}
                                fontSize="xs"
                              >
                                {product.bidding_type === 'blind' ? 'Blind Bidding' : 'Open Bidding'}
                              </Badge>
                            )}
                            {product.max_items_per_offer && product.max_items_per_offer > 0 && (
                              <Badge
                                colorScheme="brand"
                                variant="subtle"
                                borderRadius="full"
                                px={3}
                                py={1}
                                fontSize="xs"
                              >
                                Max {product.max_items_per_offer} items per offer
                              </Badge>
                            )}
                          </VStack>

                          <VStack spacing={1} align={{ base: 'start', md: 'end' }} flexShrink={0} w={{ base: 'full', md: 'auto' }}>
                            <Text
                              color="var(--pd-text)"
                              fontSize={{ base: '2xl', md: '3xl' }}
                              lineHeight="1"
                              fontWeight="800"
                              whiteSpace="nowrap"
                            >
                              {hasListedPrice
                                ? `₱${formatPrice(listedPrice)}`
                                : hasFairRange
                                  ? `₱${formatPrice(fairMin)} - ₱${formatPrice(fairMax)}`
                                  : 'Price Unavailable'}
                            </Text>

                            <HStack spacing={1} justify="flex-end" flexWrap="wrap" maxW={{ base: '130px', md: '156px' }}>
                              <Tooltip label={isSaved ? 'Saved' : 'Save'} hasArrow>
                                <IconButton
                                  onClick={handleSaveToggle}
                                  isLoading={isSaving}
                                  aria-label={isSaved ? 'Saved' : 'Save'}
                                  icon={<FiHeart />}
                                  variant="outline"
                                  bg="transparent"
                                  borderColor="var(--pd-border)"
                                  color={isSaved ? 'red.500' : 'var(--pd-text)'}
                                  h={{ base: '30px', md: '34px' }}
                                  w={{ base: '30px', md: '34px' }}
                                  minW={{ base: '30px', md: '34px' }}
                                  borderRadius="7px"
                                  _hover={{ bg: 'var(--pd-surface)' }}
                                />
                              </Tooltip>

                              <Tooltip label="Share" hasArrow>
                                <IconButton
                                  onClick={handleShare}
                                  aria-label="Share"
                                  icon={<FiShare2 />}
                                  variant="outline"
                                  bg="transparent"
                                  borderColor="var(--pd-border)"
                                  color="var(--pd-text)"
                                  h={{ base: '30px', md: '34px' }}
                                  w={{ base: '30px', md: '34px' }}
                                  minW={{ base: '30px', md: '34px' }}
                                  borderRadius="7px"
                                  _hover={{ bg: 'var(--pd-surface)' }}
                                />
                              </Tooltip>

                              {!isOwner && (
                                <Tooltip label="Report" hasArrow>
                                  <IconButton
                                    onClick={() => {
                                      if (!user) {
                                        toast({
                                          id: 'auth-required-report-flag',
                                          title: 'Authentication required',
                                          description: 'Please log in to report this product',
                                          status: 'warning',
                                          duration: 3000,
                                          isClosable: true,
                                        })
                                        navigate('/login')
                                        return
                                      }
                                      setIsReportOpen(true)
                                    }}
                                    aria-label="Report"
                                    icon={<FiAlertTriangle />}
                                    variant="outline"
                                    bg="transparent"
                                    borderColor="red.300"
                                    color="red.600"
                                    h={{ base: '30px', md: '34px' }}
                                    w={{ base: '30px', md: '34px' }}
                                    minW={{ base: '30px', md: '34px' }}
                                    borderRadius="7px"
                                    _hover={{ bg: 'red.50' }}
                                  />
                                </Tooltip>
                              )}
                            </HStack>
                          </VStack>
                        </Flex>
                      </Box>

                      <Divider borderColor="var(--pd-border)" />

                      {/* Section 2: AI estimate bar */}
                      <Box>
                        <VStack align="stretch" spacing={2}>
                          <Text fontSize="sm" fontWeight="600" color="var(--pd-text)">
                            AI Estimate
                          </Text>
                          {hasFairRange ? (
                            <>
                              <Box
                                position="relative"
                                h="12px"
                                borderRadius="full"
                                bg="var(--pd-surface)"
                                borderWidth="1px"
                                borderColor="var(--pd-border)"
                              >
                                <Box
                                  position="absolute"
                                  left={`${fairStart}%`}
                                  w={`${fairWidth}%`}
                                  top={0}
                                  bottom={0}
                                  bg="green.500"
                                  borderRadius="full"
                                />
                                <Box
                                  position="absolute"
                                  top="-5px"
                                  left={`calc(${listedPosition}% - 4px)`}
                                  w="8px"
                                  h="22px"
                                  borderRadius="full"
                                  bg={isSignificantlyBelowEstimate ? 'orange.500' : 'blue.500'}
                                />
                              </Box>
                              <Text fontSize="xs" color="green.600" fontWeight="600">
                                Fair range: ₱{formatPrice(fairMin)} - ₱{formatPrice(fairMax)}
                              </Text>
                            </>
                          ) : (
                            <Text fontSize="sm" color="var(--pd-muted)">
                              AI fair-value range is not available yet.
                            </Text>
                          )}
                          <Text fontSize="sm" color="var(--pd-muted)">
                            {estimateGapNote}
                          </Text>
                        </VStack>
                      </Box>

                    </VStack>

                  </Box>

                  <Divider borderColor={detailBorder} />

                  {/* Product Info: Location, Condition, Category */}
                  <Box px={1} bg="transparent">
                    <Wrap spacing={2} align="center">
                      {product.location && (
                        <WrapItem>
                          <HStack spacing={1} px={3} py={1.5} borderRadius="full" bg="white" shadow="sm">
                            <Text fontSize="xs" fontWeight="600" color="brand.500">📍</Text>
                            <Text fontSize="xs" color={detailText} fontWeight="700">{product.location}</Text>
                          </HStack>
                        </WrapItem>
                      )}
                      
                      {product.condition && (
                        <WrapItem>
                          <HStack spacing={1} px={3} py={1.5} borderRadius="full" bg="white" shadow="sm">
                            <Text fontSize="xs" color={detailMuted} fontWeight="600">Condition:</Text>
                            <Text fontSize="xs" color={detailText} fontWeight="800" textTransform="capitalize">{product.condition}</Text>
                          </HStack>
                        </WrapItem>
                      )}
                      
                      {product.category && (
                        <WrapItem>
                          <HStack spacing={1} px={3} py={1.5} borderRadius="full" bg="white" shadow="sm">
                            <Text fontSize="xs" color={detailMuted} fontWeight="600">Category:</Text>
                            <Text fontSize="xs" color={detailText} fontWeight="800">{product.category}</Text>
                          </HStack>
                        </WrapItem>
                      )}
                    </Wrap>
                  </Box>

                  <Divider borderColor={detailBorder} opacity={0.6} />

                  <Box
                    p={5}
                    borderRadius="2xl"
                    bg="white"
                    shadow="sm"
                    borderWidth="0"
                  >
                    <Heading size="sm" mb={3} color={detailText} fontWeight="600">
                      Description
                    </Heading>
                    <Text
                      color={detailMuted}
                      lineHeight="tall"
                      fontSize="sm"
                      whiteSpace="pre-line"
                      wordBreak="break-word"
                      noOfLines={isDescriptionExpanded ? undefined : 6}
                    >
                      {product.description}
                    </Text>
                    {product.description && product.description.length > 260 && (
                      <Button
                        mt={2}
                        size="xs"
                        variant="ghost"
                        color={detailMuted}
                        fontWeight="500"
                        _hover={{ bg: detailBg }}
                        onClick={() => setIsDescriptionExpanded(prev => !prev)}
                      >
                        {isDescriptionExpanded ? 'Show less' : 'Show more'}
                      </Button>
                    )}
                  </Box>

                </VStack>

                {/* Action Buttons: full-width primary + compact Offers icon square */}
                <VStack spacing={{ base: 3, md: 4 }} mt={{ base: 2, md: 3 }} pt={0}>
                  {!isOwner && product.status === 'available' && (
                    <VStack spacing={{ base: 2, md: 3 }} w="full">
                        <HStack w="full" spacing={3} align="stretch">
                          <Tooltip label={hasPendingOfferOnProduct ? "You already have a pending offer on this product" : "Propose a trade"}>
                            <Button
                              flex={1}
                              size="lg"
                              borderRadius="2xl"
                              fontWeight="800"
                              bg={hasPendingOfferOnProduct ? 'gray.300' : 'brand.500'}
                              color="white"
                              _hover={hasPendingOfferOnProduct ? { bg: 'gray.300' } : { bg: 'brand.600', transform: 'translateY(-2px)' }}
                              _active={{ transform: 'scale(0.98)' }}
                              boxShadow={hasPendingOfferOnProduct ? 'none' : 'md'}
                              transition="all 0.2s cubic-bezier(0.25, 0.8, 0.25, 1)"
                              onClick={openTrade}
                              isDisabled={hasPendingOfferOnProduct}
                              opacity={hasPendingOfferOnProduct ? 0.7 : 1}
                            >
                              {hasPendingOfferOnProduct ? "Pending Offer Sent" : "Trade"}
                            </Button>
                          </Tooltip>
                          <Tooltip label="Offer to buy this item with cash">
                            <Button
                              flex={1}
                              size="lg"
                              borderRadius="2xl"
                              fontWeight="800"
                              variant="outline"
                              colorScheme="orange"
                              borderWidth="2px"
                              bg="white"
                              borderColor="orange.300"
                              color="orange.600"
                              _hover={{ bg: 'orange.50', borderColor: 'orange.500', transform: 'translateY(-2px)', shadow: 'sm' }}
                              _active={{ transform: 'scale(0.98)' }}
                              transition="all 0.2s cubic-bezier(0.25, 0.8, 0.25, 1)"
                              onClick={openBuyout}
                              isDisabled={hasPendingOfferOnProduct}
                              opacity={hasPendingOfferOnProduct ? 0.7 : 1}
                            >
                              Buyout
                            </Button>
                          </Tooltip>
                          <Tooltip label={`Offers (${(product as any).offer_count || 0})`}>
                            <IconButton
                              aria-label="View offers"
                              icon={<FaHandshake />}
                              w={{ base: "48px", md: "52px" }}
                              h={{ base: "48px", md: "52px" }}
                              minW={{ base: "48px", md: "52px" }}
                              borderRadius="2xl"
                              variant="outline"
                              colorScheme="brand"
                              borderWidth="2px"
                              borderColor="brand.200"
                              color="brand.600"
                              bg="brand.50"
                              onClick={handleViewOffers}
                              _hover={{ bg: 'brand.100', borderColor: 'brand.400', transform: 'translateY(-2px)', shadow: 'sm' }}
                              _active={{ transform: 'scale(0.98)' }}
                              transition="all 0.2s cubic-bezier(0.25, 0.8, 0.25, 1)"
                            />
                          </Tooltip>
                        </HStack>
                    </VStack>
                  )}

                  {isOwner && (
                    <VStack spacing={4} w="full" align="stretch">
                      <HStack spacing={{ base: 2, md: 4 }} w="full">
                        <Button
                          variant="outline"
                          colorScheme="gray"
                          size="lg"
                          flex={1}
                          fontWeight="800"
                          borderRadius="2xl"
                          borderWidth="2px"
                          borderColor="gray.200"
                          _hover={{ bg: 'gray.50', borderColor: 'gray.300', transform: 'translateY(-2px)' }}
                          transition="all 0.2s"
                          onClick={() => navigate(`/edit-product/${product.id}`)}
                        >
                          Edit Product
                        </Button>
                        <Button
                          variant="outline"
                          colorScheme="gray"
                          size="lg"
                          flex={1}
                          fontWeight="800"
                          borderRadius="2xl"
                          borderWidth="2px"
                          borderColor="gray.200"
                          _hover={{ bg: 'gray.50', borderColor: 'gray.300', transform: 'translateY(-2px)' }}
                          transition="all 0.2s"
                          onClick={() => navigate('/dashboard')}
                        >
                          View Dashboard
                        </Button>
                      </HStack>

                      <HStack spacing={{ base: 2, md: 4 }} w="full">
                        {!product.premium && (
                          <Button
                            colorScheme="purple"
                            size="lg"
                            flex={1}
                            fontWeight="800"
                            borderRadius="2xl"
                            leftIcon={<FiStar />}
                            isLoading={upgradingPremium}
                            onClick={handleUpgradeToPremium}
                            _hover={{ bg: 'purple.600', transform: 'translateY(-2px)', shadow: 'md' }}
                            transition="all 0.2s"
                          >
                            Upgrade to Premium
                          </Button>
                        )}
                        <Button
                          colorScheme="blue"
                          size="lg"
                          fontWeight="800"
                          flex={!product.premium ? 1 : 2}
                          borderRadius="2xl"
                          leftIcon={<FiTrendingUp />}
                          isLoading={boosting}
                          onClick={handleBoostNow}
                          _hover={{ bg: 'blue.600', transform: 'translateY(-2px)', shadow: 'md' }}
                          transition="all 0.2s"
                        >
                          Boost listing
                        </Button>
                      </HStack>
                    </VStack>
                  )}

                  {/* Unavailable Status Messages */}
                  {isUnavailable && !isOwner && (
                    <Alert status="warning" borderRadius="md">
                      <AlertIcon />
                      <VStack align="start" spacing={1}>
                        <Text fontWeight="bold">
                          {product.status === 'traded'
                            ? 'This item has already been traded and is no longer available'
                            : product.status === 'sold'
                              ? 'This product has been sold'
                              : 'This item is currently reserved in a trade'}
                        </Text>
                        <Text fontSize="sm" color="gray.600">
                          Only the original owner can view this item.
                        </Text>
                      </VStack>
                    </Alert>
                  )}
                  {product.status === 'sold' && isOwner && (
                    <Box textAlign="center" py={4} w="full">
                      <Text color="red.500" fontWeight="bold">
                        This product has been sold
                      </Text>
                    </Box>
                  )}
                  {product.status === 'locked' && isOwner && (
                    <Box textAlign="center" py={4} w="full">
                      <Text color="orange.500" fontWeight="bold">
                        This item is currently reserved in a trade.
                      </Text>
                    </Box>
                  )}
                  {product.status === 'traded' && isOwner && (
                    <Box textAlign="center" py={4} w="full">
                      <Text color="green.500" fontWeight="bold">
                        This item has been successfully traded.
                      </Text>
                    </Box>
                  )}
                </VStack>
              </Box>
            </SimpleGrid>
          </Box>

          {/* Seller Information */}
          <Box bg="white" p={{ base: 4, md: 6 }} rounded="lg" shadow="sm">
            <Heading size="md" mb={4}>
              About the Trader
            </Heading>
            <Flex justify="space-between" align="stretch" gap={6} flexDir={{ base: 'column', lg: 'row' }}>
              <HStack spacing={4} flex={1}>
                {((sellerProfile as any)?.slug || product.seller_id) ? (
                  <RouterLink to={`/users/${(sellerProfile as any)?.slug || product.seller_id}`}>
                    <VerifiedAvatar
                      size="lg"
                      src={sellerProfile?.profile_picture}
                      name={product.seller_name}
                      bg="red.500"
                      color="white"
                      cursor="pointer"
                      _hover={{ opacity: 0.8, transform: 'scale(1.05)' }}
                      transition="all 0.2s"
                      isVerified={sellerProfile?.verification_status === 'verified' || sellerProfile?.verified || false}
                    />
                  </RouterLink>
                ) : (
                  <VerifiedAvatar
                    size="lg"
                    src={sellerProfile?.profile_picture}
                    name={product.seller_name}
                    bg="red.500"
                    color="white"
                    isVerified={sellerProfile?.verification_status === 'verified' || sellerProfile?.verified || false}
                  />
                )}
                <Box>
                  <HStack spacing={2} align="center" flexWrap="wrap">
                    {((sellerProfile as any)?.slug || product.seller_id) ? (
                      <Button
                        as={RouterLink}
                        to={`/users/${(sellerProfile as any)?.slug || product.seller_id}`}
                        variant="link"
                        color="brand.600"
                        _hover={{ textDecoration: 'underline' }}
                      >
                        {sellerProfile?.name && sellerProfile.name.toLowerCase() !== 'user' ? sellerProfile.name : product.seller_name}
                      </Button>
                    ) : (
                      <Text color="brand.600" fontWeight="medium">{sellerProfile?.name || product.seller_name}</Text>
                    )}
                    {(sellerProfile as any)?.verification_status === 'verified' && (
                      <Badge colorScheme="teal" borderRadius="full" px={2} py={0.5} fontSize="xs">
                        <HStack spacing={1}>
                          <Icon as={FiCheckCircle} boxSize={3} />
                          <Text as="span" fontSize="xs">Verified</Text>
                        </HStack>
                      </Badge>
                    )}
                    {sellerStats?.trust_level && (
                      <Badge
                        colorScheme={sellerStats.trust_level === 'trusted' ? 'green' : sellerStats.trust_level === 'new' ? 'yellow' : 'red'}
                        borderRadius="full"
                        px={2}
                        py={0.5}
                        fontSize="xs"
                      >
                        {sellerStats.trust_level === 'trusted' ? '🟢 Trusted Trader' : sellerStats.trust_level === 'new' ? '🟡 New Trader' : '🔴 Risky Trader'}
                      </Badge>
                    )}
                    {sellerStats?.has_active_dispute && (
                      <Badge
                        colorScheme="orange"
                        variant="solid"
                        borderRadius="full"
                        px={2}
                        py={0.5}
                        fontSize="xs"
                        fontWeight="bold"
                      >
                        ⚠️ Active Dispute
                      </Badge>
                    )}
                  </HStack>
                  <Text color="gray.600" fontSize="sm">
                    Member since {sellerStats?.member_since_year ?? new Date().getFullYear()}
                  </Text>
                  <HStack spacing={2} mt={2}>
                    {product.seller_id && <ResponseMetricsBadge userId={product.seller_id} />}
                    {product.seller_id && user && <ProximityBadge type="user" targetId={product.seller_id} />}
                  </HStack>
                </Box>
              </HStack>

              {/* Seller Stats */}
              <SimpleGrid columns={{ base: 3, md: 5 }} spacing={{ base: 3, md: 4 }} flex={1} alignItems="start" mt={{ base: 0, lg: -6 }}>
                <VStack spacing={1} align="center">
                  {sellerStats?.avg_rating ? (
                    <HStack spacing={1}>
                      <Icon as={FiStar} color="yellow.400" boxSize={{ base: 4, md: 5 }} />
                      <Text fontSize={{ base: 'lg', md: 'xl', lg: '2xl' }} fontWeight="bold" color="brand.500">
                        {sellerStats.avg_rating.toFixed(1)}
                      </Text>
                    </HStack>
                  ) : (
                    <HStack spacing={1}>
                      <Icon as={FiStar} color="yellow.400" boxSize={{ base: 4, md: 5 }} />
                      <Text fontSize={{ base: 'lg', md: 'xl', lg: '2xl' }} fontWeight="bold" color="gray.400">
                        New
                      </Text>
                    </HStack>
                  )}
                  <Text fontSize={{ base: '2xs', md: 'xs', lg: 'sm' }} color="gray.600" textAlign="center">
                    Rating
                  </Text>
                </VStack>
                <VStack spacing={1} align="center">
                  <Text fontSize={{ base: 'lg', md: 'xl', lg: '2xl' }} fontWeight="bold" color="green.500">
                    {sellerStats?.positive_percent != null ? `${sellerStats.positive_percent.toFixed(0)}%` : '100%'}
                  </Text>
                  <Text fontSize={{ base: '2xs', md: 'xs', lg: 'sm' }} color="gray.600" textAlign="center">
                    Positive
                  </Text>
                </VStack>
                <VStack spacing={1} align="center">
                  <Text fontSize={{ base: 'lg', md: 'xl', lg: '2xl' }} fontWeight="bold" color="blue.500">
                    {sellerStats?.total_trades ?? 0}
                  </Text>
                  <Text fontSize={{ base: '2xs', md: 'xs', lg: 'sm' }} color="gray.600" textAlign="center">
                    Trades
                  </Text>
                </VStack>
                <VStack spacing={1} align="center">
                  <Text fontSize={{ base: 'lg', md: 'xl', lg: '2xl' }} fontWeight="bold" color="purple.500">
                    {sellerStats?.avg_response_time ?? '< 1 hr'}
                  </Text>
                  <Text fontSize={{ base: '2xs', md: 'xs', lg: 'sm' }} color="gray.600" textAlign="center">
                    Avg Response
                  </Text>
                </VStack>
              </SimpleGrid>
            </Flex>

            {/* Trust Score Breakdown */}
            {sellerStats?.trust_factors && sellerStats.trust_factors.length > 0 && (
              <Box mt={4}>
                <TrustScoreCard
                  score={sellerStats.trust_score ?? 0}
                  trustLevel={sellerStats.trust_level}
                  factors={sellerStats.trust_factors}
                  conductSummary={sellerStats.conduct_summary}
                  isVerified={sellerProfile?.verification_status === 'verified' || sellerProfile?.verified || false}
                  listingCount={sellerProducts.length}
                  tradeCount={sellerStats.completed_trades ?? sellerStats.total_trades}
                  positivePercent={sellerStats.positive_percent}
                  tradeStats={{
                    successful: sellerStats.completed_trades ?? 0,
                    cancelled: sellerStats.cancelled_trades ?? 0,
                    pending: sellerStats.pending_trades ?? 0,
                  }}
                  responseTime={sellerStats?.avg_response_time}
                />
              </Box>
            )}

            {/* Report Warning Banner */}
            {sellerStats?.has_reports && sellerStats.report_count > 0 && (
              <Alert status="warning" borderRadius="md" mt={4}>
                <AlertIcon />
                <Box>
                  <Text fontWeight="bold" fontSize="sm">⚠ This trader has received reports</Text>
                  <Text fontSize="xs" color="gray.600">Trade with caution</Text>
                </Box>
              </Alert>
            )}

            {/* Organization Tags Section */}
            {product?.organization_tags && product.organization_tags.length > 0 && (
              <Box mt={6} p={4} bg="purple.50" borderRadius="lg" borderWidth="1px" borderColor="purple.200">
                <Heading size="sm" mb={3} display="flex" alignItems="center" gap={2}>
                  <Text>🏢 Tagged Organizations</Text>
                </Heading>
                <Wrap spacing={3}>
                  {product.organization_tags.map((org: any) => (
                    <WrapItem key={org.id}>
                      <Button
                        as={RouterLink}
                        to={`/organizations/${org.slug}`}
                        variant="outline"
                        colorScheme="purple"
                        size="sm"
                        leftIcon={
                          org.logo_url ? (
                            <Image
                              src={org.logo_url}
                              alt={org.name}
                              boxSize="18px"
                              borderRadius="50%"
                              onError={(e: any) => {
                                e.target.style.display = 'none'
                              }}
                            />
                          ) : undefined
                        }
                        onClick={(e: React.MouseEvent) => e.stopPropagation()}
                        _hover={{ bg: 'purple.100' }}
                      >
                        {org.name}
                      </Button>
                    </WrapItem>
                  ))}
                </Wrap>
                {product.organization_tags[0]?.description && (
                  <Text fontSize="xs" color="gray.600" mt={2}>
                    This product is listed in {product.organization_tags.length} organization{"(s)"}
                  </Text>
                )}
              </Box>
            )}
          </Box>

          {/* Seller Products Section */}
          <Box bg="white" p={6} rounded="lg" shadow="sm">
            <Heading size="md" mb={6}>
              Trader Products
            </Heading>
            <SimpleGrid columns={{ base: 1, sm: 2, md: 3, lg: 4 }} spacing={4}>
              {sellerProducts && sellerProducts.length > 0 ? (
                sellerProducts.map((p) => (
                  <Box
                    key={p.id}
                    borderWidth="1px"
                    borderRadius="lg"
                    overflow="hidden"
                    bg="white"
                    _hover={{ shadow: 'md', cursor: 'pointer' }}
                    transition="all 0.3s"
                    onClick={() => navigate(getProductUrl(p))}
                  >
                    <Box h="200px" bg="gray.200" position="relative" overflow="hidden">
                      <Image
                        src={getFirstImage(p.image_urls)}
                        alt={p.title}
                        w="full"
                        h="full"
                        objectFit="cover"
                        fallbackSrc="/images/placeholder.jpg"
                      />
                      {p.status !== 'available' && (
                        <Badge position="absolute" top={2} right={2} colorScheme={p.status === 'sold' ? 'red' : 'orange'} fontSize="xs">
                          {p.status}
                        </Badge>
                      )}
                    </Box>
                    <Box p={3}>
                      <HStack justify="space-between" mb={2}>
                        <Heading size="sm" noOfLines={1} wordBreak="break-word">{p.title}</Heading>
                        {p.premium && (
                          <Badge colorScheme="orange" fontSize="xs">Premium</Badge>
                        )}
                      </HStack>
                      <Text fontSize="xs" color="gray.600" mb={2} noOfLines={2} wordBreak="break-word">
                        {p.description}
                      </Text>
                      <Text fontSize="sm" fontWeight="bold" color="brand.500">
                        ₱{p.price ? p.price.toFixed(2) : '0.00'}
                      </Text>
                      {p.barter_only && (
                        <Badge colorScheme="cyan" mt={2} fontSize="xs">Barter Only</Badge>
                      )}
                    </Box>
                  </Box>
                ))
              ) : (
                <Box p={4} w="full">
                  <Text color="gray.600">No other products from this trader.</Text>
                </Box>
              )}
            </SimpleGrid>
          </Box>
        </VStack>
        <TradeModal isOpen={isTradeOpen} onClose={() => setIsTradeOpen(false)} targetProductId={tradeTargetProductId} />
        <BuyoutModal isOpen={isBuyoutOpen} onClose={() => setIsBuyoutOpen(false)} targetProductId={product?.id ?? null} />

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
                <VStack spacing={3} align="stretch" py={2}>
                  {[0, 1, 2].map((idx) => (
                    <Box key={idx} p={4} borderWidth="2px" borderColor="gray.200" rounded="lg" bg="white">
                      <HStack justify="space-between" mb={3}>
                        <HStack spacing={2}>
                          <Skeleton h="16px" w="16px" borderRadius="full" />
                          <Skeleton h="14px" w="140px" />
                        </HStack>
                        <Skeleton h="18px" w="72px" borderRadius="md" />
                      </HStack>
                      <Skeleton h="12px" w="120px" mb={3} />
                      <HStack spacing={2} flexWrap="wrap">
                        <Skeleton h="20px" w="80px" borderRadius="md" />
                        <Skeleton h="20px" w="96px" borderRadius="md" />
                        <Skeleton h="20px" w="72px" borderRadius="md" />
                      </HStack>
                    </Box>
                  ))}
                </VStack>
              ) : (() => {
                const isBlind = product?.bidding_type === 'blind'
                const showAll = !isBlind || isOwner
                const allOffers = getRankedOffers()
                const visibleOffers = showAll ? allOffers : allOffers.filter((o: any) => user && o.buyer_id === user.id)

                if (allOffers.length === 0) {
                  return (
                    <Box textAlign="center" py={8}>
                      <Text color="gray.600">No offers yet</Text>
                    </Box>
                  )
                }

                return (
                  <VStack spacing={3} align="stretch">
                    {!showAll && (
                      <Box textAlign="center" p={3} bg="orange.50" rounded="md" borderWidth="1px" borderColor="orange.200">
                        <HStack justify="center" spacing={2} mb={1}>
                          <Text fontSize="lg">🤐</Text>
                          <Text fontSize="sm" color="orange.800" fontWeight="bold">Blind Bidding Active</Text>
                        </HStack>
                        <Text fontSize="xs" color="orange.800">
                          Offers are hidden. You can only view your own offers.
                        </Text>
                      </Box>
                    )}

                    {!showAll && visibleOffers.length === 0 && (
                      <Box textAlign="center" py={8}>
                        <Text color="gray.500">You haven't made an offer yet.</Text>
                      </Box>
                    )}

                    {visibleOffers.map((offer: any, index: number) => (
                      <Box
                        key={offer.id}
                        p={4}
                        borderWidth="2px"
                        borderColor={showAll && index === 0 ? 'gold' : offer.status === 'accepted' ? 'green.400' : 'gray.200'}
                        rounded="lg"
                        bg={showAll && index === 0 ? 'yellow.50' : offer.status === 'accepted' ? 'green.50' : 'white'}
                        position="relative"
                      >
                        {/* Rank Badge - Only show if showing all */}
                        {showAll && (
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
                        )}

                        <HStack justify="space-between" mb={2} mt={showAll ? 2 : 0}>
                          <HStack>
                            {showAll && index === 0 && (
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
                              {item.product_title?.substring(0, 20) || `Item ${idx + 1}`}
                            </Badge>
                          ))}
                        </HStack>
                      </Box>
                    ))}
                  </VStack>
                )
              })()}
            </ModalBody>
          </ModalContent>
        </Modal>

        {/* Share Modal */}
        <Modal isOpen={isShareOpen} onClose={onShareClose} size="md">
          <ModalOverlay />
          <ModalContent>
            <ModalHeader>Share this product</ModalHeader>
            <ModalCloseButton />
            <ModalBody pb={6}>
              <VStack spacing={4} align="stretch">
                {/* Copy Link */}
                <Box>
                  <Text fontWeight="medium" mb={2}>Copy Link</Text>
                  <HStack>
                    <Input
                      value={product?.slug ? `${window.location.origin}/products/${product.slug}` : window.location.href}
                      readOnly
                      size="sm"
                      bg="gray.50"
                    />
                    <Button
                      leftIcon={<FiCopy />}
                      onClick={copyToClipboard}
                      size="sm"
                      colorScheme="blue"
                    >
                      Copy
                    </Button>
                  </HStack>
                </Box>

                <Divider />

                {/* Social Media Sharing */}
                <Box>
                  <Text fontWeight="medium" mb={3}>Share on Social Media</Text>
                  <SimpleGrid columns={2} spacing={3}>
                    <Button
                      leftIcon={<FiFacebook />}
                      colorScheme="blue"
                      variant="outline"
                      onClick={() => shareToSocial('facebook')}
                      size="sm"
                    >
                      Facebook
                    </Button>
                    <Button
                      leftIcon={<FiTwitter />}
                      colorScheme="blue"
                      variant="outline"
                      onClick={() => shareToSocial('twitter')}
                      size="sm"
                    >
                      Twitter
                    </Button>
                    <Button
                      leftIcon={<FiInstagram />}
                      colorScheme="pink"
                      variant="outline"
                      onClick={() => shareToSocial('instagram')}
                      size="sm"
                    >
                      Instagram
                    </Button>
                    <Button
                      leftIcon={<FiMessageCircle />}
                      colorScheme="green"
                      variant="outline"
                      onClick={() => shareToSocial('whatsapp')}
                      size="sm"
                    >
                      WhatsApp
                    </Button>
                    <Button
                      leftIcon={<FiMail />}
                      colorScheme="gray"
                      variant="outline"
                      onClick={() => shareToSocial('email')}
                      size="sm"
                      gridColumn="span 2"
                    >
                      Email
                    </Button>
                  </SimpleGrid>
                </Box>
              </VStack>
            </ModalBody>
          </ModalContent>
        </Modal>

        {/* Report Listing Modal */}
        <Modal isOpen={isReportOpen} onClose={() => setIsReportOpen(false)} size="md">
          <ModalOverlay />
          <ModalContent>
            <ModalHeader>Report This Listing</ModalHeader>
            <ModalCloseButton />
            <ModalBody>
              <VStack spacing={4}>
                <Box w="full">
                  <Text fontWeight="medium" mb={2}>Why are you reporting this listing?</Text>
                  <Select
                    value={reportReason}
                    onChange={(e) => setReportReason(e.target.value)}
                    placeholder="Select a reason..."
                    size="md"
                  >
                    <option value="wrong_category">Wrong Category</option>
                    <option value="prohibited_item">Prohibited Item</option>
                    <option value="fake_or_scam">Fake or Scam</option>
                    <option value="inappropriate_photo">Inappropriate Photo</option>
                    <option value="other">Other</option>
                  </Select>
                </Box>

                <Box w="full">
                  <Text fontWeight="medium" mb={2}>Additional Details (Optional)</Text>
                  <Textarea
                    value={reportDescription}
                    onChange={(e) => setReportDescription(e.target.value)}
                    placeholder="Tell us more about your concern..."
                    size="md"
                    minH="100px"
                  />
                </Box>
              </VStack>
            </ModalBody>
            <Box p={4} borderTop="1px solid" borderColor="gray.200">
              <HStack spacing={3}>
                <Button
                  flex={1}
                  variant="outline"
                  onClick={() => setIsReportOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  flex={1}
                  colorScheme="red"
                  onClick={handleSubmitReport}
                  isLoading={isSubmittingReport}
                  loadingText="Submitting..."
                >
                  Report Listing
                </Button>
              </HStack>
            </Box>
          </ModalContent>
        </Modal>
      </Container>

      {/* Buy Confirmation Modal */}
      <Modal isOpen={isBuyModalOpen} onClose={() => setIsBuyModalOpen(false)} isCentered size="sm">
        <ModalOverlay backdropFilter="blur(4px)" />
        <ModalContent borderRadius="16px" overflow="hidden">
          <ModalHeader
            bgGradient="linear(to-r, gray.800, gray.700)"
            color="white"
            py={4}
            px={6}
            fontSize="lg"
          >
            Confirm Purchase
          </ModalHeader>
          <ModalCloseButton color="white" />
          <ModalBody py={6} px={6}>
            <VStack spacing={4} align="stretch">
              {product && (
                <HStack spacing={4} p={3} bg="gray.50" borderRadius="12px" borderWidth="1px" borderColor="gray.100">
                  {product.image_urls && product.image_urls.length > 0 && (
                    <Image
                      src={getImageUrl(product.image_urls[0])}
                      alt={product.title}
                      w="60px"
                      h="60px"
                      objectFit="cover"
                      borderRadius="8px"
                      fallbackSrc="/no-image.svg"
                    />
                  )}
                  <VStack align="start" spacing={0} flex={1} minW={0}>
                    <Text fontWeight="600" fontSize="sm" noOfLines={2} color="gray.800">
                      {product.title}
                    </Text>
                    <Text fontWeight="800" fontSize="xl" color="gray.800" mt={1}>
                      {canShowEstimate && product.estimated_value_min && product.estimated_value_max
                        ? `₱${(product.estimated_value_min).toLocaleString()}–₱${(product.estimated_value_max).toLocaleString()}`
                        : product.price && product.price > 0
                          ? `₱${product.price.toFixed(2)}`
                          : 'Est. Value Unavailable'}
                    </Text>
                    {canShowEstimate && product.estimated_value_min && product.estimated_value_max && (
                      <Text fontSize="xs" color="purple.600" fontWeight="600" mt={0.5}>
                        📊 Market Range Estimate
                      </Text>
                    )}
                  </VStack>
                </HStack>
              )}
              <VStack align="stretch" spacing={1}>
                <HStack justify="space-between">
                  <Text fontSize="sm" color="gray.600">Trader</Text>
                  <Text fontSize="sm" fontWeight="500">{product?.seller_name ?? 'Unknown'}</Text>
                </HStack>
                <HStack justify="space-between">
                  <Text fontSize="sm" color="gray.600">Status</Text>
                  <Badge colorScheme="green" borderRadius="6px" px={2}>Available</Badge>
                </HStack>
              </VStack>
              <Alert status="info" borderRadius="10px" fontSize="sm">
                <AlertIcon />
                The trader will confirm your order. You will be notified once it is accepted.
              </Alert>
            </VStack>
          </ModalBody>
          <Box px={6} py={4} borderTop="1px" borderColor="gray.100">
            <HStack spacing={3}>
              <Button
                flex={1}
                variant="outline"
                borderRadius="10px"
                onClick={() => setIsBuyModalOpen(false)}
                isDisabled={purchasing}
              >
                Cancel
              </Button>
              <Button
                flex={2}
                bg="gray.800"
                color="white"
                borderRadius="10px"
                _hover={{ bg: 'gray.700' }}
                onClick={confirmPurchase}
                isLoading={purchasing}
                loadingText="Placing Order..."
                leftIcon={<FiBookmark />}
              >
                Confirm ₱{product?.price?.toFixed(2) ?? '0.00'}
              </Button>
            </HStack>
          </Box>
        </ModalContent>
      </Modal>

      <FloatingTab />
    </Box>
  )
}

export default ProductDetail
