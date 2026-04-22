import React, { useState, useEffect, useMemo } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import {
  Box,
  VStack,
  HStack,
  Container,
  Heading,
  Text,
  Button,
  IconButton,
  Card,
  CardBody,
  Badge,
  Spinner,
  Center,
  useToast,
  Icon,
  Divider,
  Switch,
  List,
  ListItem,
  ListIcon,
  useDisclosure,
  Flex,
  SimpleGrid,
  useColorModeValue,
  Collapse,
  Table,
  Thead,
  Tbody,
  Tr,
  Th,
  Td,
  TableContainer,
  Alert,
  AlertIcon,
} from '@chakra-ui/react'
import {
  FaCrown, FaLink, FaArrowRight, FaCheck, FaRocket,
  FaShieldAlt, FaBolt, FaCheckCircle, FaTimes,
  FaInfinity, FaChevronDown, FaChevronUp,
  FaChartLine, FaTruck, FaHandshake, FaPercentage,
  FaEye, FaStar, FaStore, FaHeadset, FaBoxes,
  FaRedoAlt, FaSearch, FaUserShield, FaImage,
  FaArrowLeft,
} from 'react-icons/fa'
import { useAuth } from '../contexts/AuthContext'
import { useProducts } from '../contexts/ProductContext'
import { TradeLoop, MultiWayTrade } from '../types'
import { fetchTradeLoops, fetchMultiWayTrade } from '../services/tradeService'
import MultiWayTradeModal from '../components/MultiWayTradeModal'
import { api } from '../services/api'

const Premium: React.FC = () => {
  const { user, refreshUser } = useAuth()
  const { markProductBoosted } = useProducts()
  const toast = useToast()
  const { isOpen, onOpen, onClose } = useDisclosure()
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const handleBack = () => {
    if (window.history.length > 1) {
      navigate(-1)
    } else {
      navigate('/home')
    }
  }

  const [loops, setLoops] = useState<TradeLoop[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedLoop, setSelectedLoop] = useState<MultiWayTrade | null>(null)
  const [isYearly, setIsYearly] = useState(false)
  const [upgrading, setUpgrading] = useState<string | null>(null) // 'plus' | 'pro' | null
  const [expandedFaq, setExpandedFaq] = useState<number | null>(null)
  const [userProducts, setUserProducts] = useState<any[]>([])
  const [productsLoading, setProductsLoading] = useState(false)
  const [boostingProduct, setBoostingProduct] = useState<number | null>(null)
  const [subscriptionData, setSubscriptionData] = useState<any>(null)
  const [subscriptionLoading, setSubscriptionLoading] = useState(true)
  const [premiumConfig, setPremiumConfig] = useState<any>({ enabled: true, plans: [], features: [] })

  const pageBg = useColorModeValue('#FFFDF1', 'gray.900')
  const cardBg = useColorModeValue('white', 'gray.800')
  const borderColor = useColorModeValue('gray.200', 'gray.700')
  const hoverBg = useColorModeValue('gray.50', 'gray.700')
  const subtleBg = useColorModeValue('gray.50', 'gray.900')
  const mutedText = useColorModeValue('gray.500', 'gray.400')

  const isWmsuUser = (user?.email || '').toLowerCase().endsWith('@wmsu.edu.ph')

  // Derive current tier: prefer live subscriptionData over potentially stale user cache
  const currentTier = useMemo(() => {
    const subTier = subscriptionData?.tier as 'free' | 'plus' | 'pro' | undefined
    const userTier = user?.premium_tier as 'free' | 'plus' | 'pro' | undefined
    // If subscription says paid but user cache says free, trust the subscription
    if (subTier && subTier !== 'free') return subTier
    return userTier || 'free'
  }, [subscriptionData, user?.premium_tier])

  const isPremiumUser = currentTier !== 'free'

  useEffect(() => {
    // Always refresh user on page mount to bust stale localStorage cache
    refreshUser()
    fetchPremiumConfig()
    fetchLoops()
    fetchSubscriptionData()
    const interval = setInterval(fetchLoops, 30000)
    return () => clearInterval(interval)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Fetch products once we know the user is premium
  useEffect(() => {
    if (isPremiumUser) fetchUserProducts()
  }, [isPremiumUser])

  useEffect(() => {
    const xenditExternalID = searchParams.get('xendit_external_id')
    const paymentStatus = searchParams.get('payment')
    if (!xenditExternalID) return

    const toastKey = `xendit_user_premium_${xenditExternalID}`
    if (sessionStorage.getItem(toastKey)) return
    sessionStorage.setItem(toastKey, '1')

    ;(async () => {
      if (paymentStatus === 'failed') {
        toast({
          title: 'Payment Failed',
          description: 'Your payment was not completed. Please try again.',
          status: 'error',
          duration: 5000,
        })
        return
      }

      toast({
        title: 'Payment Successful!',
        description: 'Syncing your subscription... this can take a few seconds.',
        status: 'success',
        duration: 5000,
      })

      try {
        for (let i = 0; i < 5; i++) {
          let r
          try {
            r = await api.post('/api/payments/subscription/sync', { external_id: xenditExternalID })
          } catch (err: any) {
            if (err?.response?.status === 405) {
              r = await api.get('/api/payments/subscription/sync', { params: { external_id: xenditExternalID } })
            } else {
              throw err
            }
          }
          if (r?.data?.data?.paid) break
          await new Promise(res => setTimeout(res, 1500))
        }
      } catch (_) {
        // Best-effort sync; UI will refresh below.
      }

      await refreshUser()
      fetchSubscriptionData()
    })()
  }, [searchParams, refreshUser, toast])

  const fetchLoops = async () => {
    try {
      setLoading(true)
      const data = await fetchTradeLoops()
      setLoops(data)
    } catch (error: any) {
      // Silently fail
    } finally {
      setLoading(false)
    }
  }

  const handleSelectLoop = async (loop: TradeLoop) => {
    try {
      setLoading(true)
      const loopId = `loop_${loop.edges.map(e => e.trade_id).join('_')}`
      const multiWayTrade = await fetchMultiWayTrade(loopId)
      setSelectedLoop(multiWayTrade)
      onOpen()
    } catch (error: any) {
      toast({
        id: 'premium-error-2',
        title: 'Error',
        description: 'Failed to load trade loop details',
        status: 'error',
      })
    } finally {
      setLoading(false)
    }
  }

  const handleCloseModal = () => {
    onClose()
    setSelectedLoop(null)
    fetchLoops()
  }

  const fetchSubscriptionData = async () => {
    try {
      setSubscriptionLoading(true)
      const response = await api.get('/api/payments/subscription')
      if (response.data?.data) {
        setSubscriptionData(response.data.data)
      }
    } catch (error: any) {
      // Silently fail - subscription data is optional
    } finally {
      setSubscriptionLoading(false)
    }
  }

  const fetchPremiumConfig = async () => {
    try {
      const response = await api.get('/api/payments/premium-config')
      if (response.data?.data) setPremiumConfig(response.data.data)
    } catch (_) {
      // Keep default pricing if the config endpoint is temporarily unavailable.
    }
  }

  const getPlan = (tier: 'plus' | 'pro', billingType: 'monthly' | 'yearly') => {
    return (premiumConfig?.plans || []).find((p: any) => p.tier === tier && p.billing_type === billingType)
  }

  const formatPlanPrice = (tier: 'plus' | 'pro', billingType: 'monthly' | 'yearly', fallback: number) => {
    const plan = getPlan(tier, billingType)
    const price = plan?.promo_price || plan?.price || fallback
    return `₱${Number(price).toLocaleString('en-PH')}`
  }

  const fetchUserProducts = async () => {
    if (!user?.id) return
    try {
      setProductsLoading(true)
      const response = await api.get(`/api/products/user/${user.id}`, { params: { limit: 200, active: true } })
      const payload = response.data?.data
      const products = Array.isArray(payload) ? payload : payload?.data
      if (Array.isArray(products)) {
        setUserProducts(products)
      }
    } catch (error: any) {
      // Silently fail
    } finally {
      setProductsLoading(false)
    }
  }

  const handleBoostProduct = async (productId: number) => {
    try {
      setBoostingProduct(productId)
      const product = userProducts.find(p => p.id === productId)
      const productName = product?.title || 'Product'
      
      const response = await api.post(`/api/products/boost/${productId}`)
      
      if (response.data?.success) {
        const boostData = response.data?.data || {}
        const boostedAt = boostData.boosted_at || new Date().toISOString()
        const alreadyBoosted = !!boostData.already_boosted
        toast({
          id: 'boost-success',
          title: alreadyBoosted ? 'Already Boosted' : 'Boost Successful!',
          description: response.data.message || `"${productName}" is now boosted and will appear at the top of the feed for the next 3 hours!`,
          status: 'success',
          duration: 4000,
          isClosable: true,
        })
        if (boostData.active !== false) {
          markProductBoosted(productId, boostedAt)
          setUserProducts((current) =>
            current.map((p) => p.id === productId ? { ...p, boosted_at: boostedAt } : p)
          )
        }
        // Refresh products list to show updated boost status
        fetchUserProducts()
      }
    } catch (error: any) {
      const errorMsg = error.response?.data?.error || error.response?.data?.message || 'Failed to boost product'
      toast({
        id: 'boost-error',
        title: 'Boost Failed',
        description: errorMsg,
        status: 'error',
        duration: 4000,
        isClosable: true,
      })
    } finally {
      setBoostingProduct(null)
    }
  }

  const handleUpgrade = async (tier: 'plus' | 'pro') => {
    if (!premiumConfig?.enabled) {
      toast({ id: 'premium-disabled', title: 'Premium unavailable', description: 'Premium subscriptions are temporarily disabled.', status: 'info', duration: 4000, isClosable: true })
      return
    }
    try {
      setUpgrading(tier)
      const plan = isYearly ? 'yearly' : 'monthly'
      
      const response = await api.post('/api/payments/subscription', { tier, plan })
      const { data: responsePayload } = response
      
      // Check if response was successful and has checkout URL
      if (responsePayload?.success && responsePayload?.data?.checkout_url) {
        window.location.href = responsePayload.data.checkout_url
      } else if (responsePayload?.checkout_url) {
        // Fallback if response structure is different
        window.location.href = responsePayload.checkout_url
      } else {
        throw new Error('Invalid response: No checkout URL found')
      }
    } catch (error: any) {
      const errorMsg = error.response?.data?.error || error.response?.data?.message || error.message || 'Something went wrong'
      toast({
        id: 'premium-upgrade-error',
        title: 'Upgrade Failed',
        description: errorMsg,
        status: 'error',
        duration: 5000,
        isClosable: true,
      })
    } finally {
      setUpgrading(null)
    }
  }

  const toggleFaq = (index: number) => {
    setExpandedFaq(expandedFaq === index ? null : index)
  }

  // Helper to get subscription summary
  const getSubscriptionSummary = () => {
    if (!subscriptionData) return null
    const endDate = subscriptionData.end_date ? new Date(subscriptionData.end_date) : null
    const daysRemaining = endDate ? Math.ceil((endDate.getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)) : null
    return {
      endDate: endDate?.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      daysRemaining: daysRemaining && daysRemaining > 0 ? daysRemaining : 0,
      isExpiring: daysRemaining && daysRemaining <= 7,
    }
  }

  // Helper to get listing quota
  const getListingQuota = () => {
    const limits = { free: 10, plus: 30, pro: Infinity }
    const limit = limits[currentTier] || 10
    const used = userProducts.filter(p => ['available', 'locked'].includes(p.status)).length
    return {
      limit,
      used,
      remaining: Math.max(0, limit - used),
      percentage: limit === Infinity ? 100 : Math.round((used / limit) * 100),
    }
  }

  // ─── Feature Section Component ───
  const FeatureSection = ({ title, features, color = 'green' }: { title: string; features: { text: string; icon: any; muted?: boolean; bold?: boolean }[]; color?: string }) => (
    <Box>
      <Text fontWeight="bold" fontSize="xs" textTransform="uppercase" letterSpacing="wider" color={mutedText} mb={3}>
        {title}
      </Text>
      <List spacing={2}>
        {features.map((f, i) => (
          <ListItem key={i} display="flex" alignItems="center" fontSize="sm" color={f.muted ? mutedText : undefined}>
            <ListIcon as={f.icon} color={f.muted ? 'gray.400' : `${color}.400`} />
            <Text fontWeight={f.bold ? 'semibold' : undefined}>{f.text}</Text>
          </ListItem>
        ))}
      </List>
    </Box>
  )

  // ─── Feature Definitions ───
  const freeFeatures = {
    listings: [
      { text: '10 active listings', icon: FaBoxes },
      { text: 'No boosts included', icon: FaRocket, muted: true },
    ],
    trading: [
      { text: 'Browse and trade freely', icon: FaHandshake },
      { text: 'Standard delivery only', icon: FaTruck },
      { text: 'Standard match feed', icon: FaSearch },
    ],
    insights: [
      { text: 'See total profile views only', icon: FaEye },
    ],
    profile: [
      { text: 'Create 1 organization', icon: FaStore },
    ],
  }

  const plusFeatures = {
    listings: [
      { text: '30 active listings', icon: FaBoxes, bold: true },
      { text: '3 boosted listings — pinned higher in the feed', icon: FaRocket, bold: true },
    ],
    trading: [
      { text: '10% delivery discount', icon: FaPercentage, bold: true },
      { text: 'Trade dispute reviewed first', icon: FaShieldAlt, bold: true },
    ],
    insights: [
      { text: 'Item popularity breakdown — views, saves, feed rank', icon: FaChartLine, bold: true },
      { text: 'AI price confidence — see what data backs the estimate', icon: FaStar, bold: true },
    ],
    profile: [
      { text: 'Create up to 3 organizations', icon: FaStore, bold: true },
      { text: 'Plus badge on profile and listings', icon: FaUserShield, bold: true },
    ],
  }

  const proFeatures = {
    listings: [
      { text: 'Unlimited listings', icon: FaInfinity, bold: true },
      { text: '10 boosted listings — always pinned', icon: FaRocket, bold: true },
    ],
    trading: [
      { text: 'Express delivery access', icon: FaTruck, bold: true },
      { text: '20% delivery discount', icon: FaPercentage, bold: true },
      { text: 'Trade dispute reviewed first', icon: FaShieldAlt, bold: true },
    ],
    insights: [
      { text: 'Full trade analytics — volume, best items, trends', icon: FaChartLine, bold: true },
      { text: 'AI price confidence + market data', icon: FaStar, bold: true },
    ],
    profile: [
      { text: 'Create up to 3 organizations', icon: FaStore, bold: true },
      { text: 'Verified Pro badge on all listings', icon: FaUserShield, bold: true },
      { text: 'Priority support', icon: FaHeadset, bold: true },
    ],
  }

  const comparisonFeatures = [
    { feature: 'Active Listings', free: '10', plus: '30', pro: 'Unlimited' },
    { feature: 'Boosted Listings', free: '—', plus: '3', pro: '10 always pinned' },
    { feature: 'Express Delivery', free: '—', plus: '✓', pro: '✓' },
    { feature: 'Delivery Fee Discount', free: '—', plus: '10%', pro: '20%' },
    { feature: 'Organizations', free: '1', plus: 'Up to 3', pro: 'Up to 3' },
    { feature: 'Trade Dispute Priority', free: '—', plus: '✓', pro: '✓' },
    { feature: 'AI Price Confidence', free: 'Range only', plus: 'Data-backed', pro: '+ market data' },
    { feature: 'Badge', free: '—', plus: 'Plus badge', pro: 'Verified Pro' },
    { feature: 'Priority Support', free: '—', plus: '—', pro: '✓' },
  ]

  const faqItems = [
    {
      question: 'How does the subscription work?',
      answer: 'Plus is ₱79/month or ₱699/year (save 26%). Pro is ₱129/month or ₱1,099/year (save 24%). Cancel anytime from your account settings.'
    },
    {
      question: 'What is Multi-Way Trading?',
      answer: 'When someone declines your trade, they can convert it to a multi-way trade. The system finds a third user who wants what you have and has what the second user wants — creating a 3-way (or more) trade chain. This is now available to all users.'
    },
    {
      question: 'What is the Store Page (Alegre)?',
      answer: 'Pro members get their own Alegre store page — a personalized shop link where all your listings are showcased. Great for power traders who want to build a brand on the platform.'
    },
    {
      question: 'Do WMSU students get premium for free?',
      answer: 'Yes! Students who register and verify with a @wmsu.edu.ph email address automatically receive Plus access at no cost.'
    },
    {
      question: 'Can I upgrade from Plus to Pro?',
      answer: 'Yes! You can upgrade from Plus to Pro anytime. The price difference will be prorated based on your remaining billing period.'
    },
    {
      question: 'Can I get a refund?',
      answer: 'Due to the digital nature of premium features, refunds are handled on a case-by-case basis. Contact our support team if you have any concerns.'
    },
    {
      question: 'Will I lose features if I cancel?',
      answer: 'Your premium features remain active until the end of your billing period. After that, you\'ll revert to the free tier but keep all your data and listings (listings beyond 10 will be hidden, not deleted).'
    },
  ]

  // ─── Cell Renderer ───
  const renderCell = (value: string, color: string) => {
    if (value === '—') return <Icon as={FaTimes} color="gray.300" />
    if (value === '✓') return <Icon as={FaCheck} color={`${color}.400`} />
    return <Text fontSize="sm" fontWeight="medium" color={`${color}.600`}>{value}</Text>
  }

  // ─── Render: Premium Active State ───
  const renderPremiumActive = () => (
    <VStack spacing={8} align="stretch">
      {/* Premium Status Banner */}
      <Card
        bg={`linear-gradient(135deg, ${currentTier === 'pro' ? '#9F7AEA' : '#3182CE'} 0%, ${currentTier === 'pro' ? '#6B46C1' : '#2C5282'} 100%)`}
        borderWidth="0"
        overflow="hidden"
        position="relative"
        boxShadow="lg"
      >
        <Box position="absolute" top={-40} right={-40} w="200px" h="200px" borderRadius="full" opacity={0.1} bg="white" />
        <CardBody py={8} position="relative" zIndex={1}>
          <VStack spacing={6} align="stretch" color="white">
            <Flex justify="space-between" align="start" wrap="wrap" gap={4}>
              <VStack align="start" spacing={2}>
                <HStack spacing={3}>
                  <Icon as={FaCheckCircle} fontSize="2xl" />
                  <Heading size="lg">{currentTier === 'pro' ? 'Pro' : 'Plus'} Member</Heading>
                </HStack>
                <Text fontSize="md" opacity={0.95}>
                  {currentTier === 'pro' ? 'You have full access to all premium features' : 'Enhanced trading features unlocked. Upgrade to Pro for more powerful tools'}
                </Text>
              </VStack>
              <VStack align={{ base: 'start', md: 'end' }} spacing={2}>
                <Badge
                  colorScheme={currentTier === 'pro' ? 'purple' : 'blue'}
                  fontSize="md"
                  px={4}
                  py={2}
                  borderRadius="full"
                  bg="rgba(255,255,255,0.2)"
                  color="white"
                  backdropFilter="blur(10px)"
                >
                  {currentTier === 'pro' ? 'Pro' : 'Plus'}
                </Badge>
                {currentTier === 'plus' && (
                  <Button
                    size="sm"
                    bg="white"
                    color="blue.600"
                    _hover={{ bg: 'gray.100' }}
                    leftIcon={<FaCrown />}
                    onClick={() => handleUpgrade('pro')}
                    isLoading={upgrading === 'pro'}
                    fontWeight="bold"
                  >
                    Upgrade to Pro
                  </Button>
                )}
              </VStack>
            </Flex>
          </VStack>
        </CardBody>
      </Card>

      {/* Subscription Details Grid */}
      <SimpleGrid columns={{ base: 1, md: 3 }} spacing={4}>
        {/* Subscription End Date */}
        <Card bg={cardBg} borderWidth="1px" borderColor={borderColor}>
          <CardBody>
            <VStack align="start" spacing={2}>
              <HStack spacing={2}>
                <Icon as={FaCheckCircle} color={currentTier === 'pro' ? 'purple.500' : 'blue.500'} fontSize="lg" />
                <Text fontWeight="bold" fontSize="sm" textTransform="uppercase" color={mutedText}>Subscription Ends</Text>
              </HStack>
              {subscriptionData?.end_date ? (
                <>
                  <Text fontSize="xl" fontWeight="bold">{getSubscriptionSummary()?.endDate}</Text>
                  <HStack spacing={2} w="full">
                    <Badge
                      colorScheme={getSubscriptionSummary()?.isExpiring ? 'red' : 'green'}
                      variant="subtle"
                      fontSize="xs"
                      borderRadius="full"
                    >
                      {getSubscriptionSummary()?.daysRemaining} days left
                    </Badge>
                  </HStack>
                </>
              ) : (
                <Text fontSize="sm" color={mutedText}>
                  {isWmsuUser && currentTier === 'plus'
                    ? 'WMSU Plus — no expiration'
                    : 'No active subscription'}
                </Text>
              )}
            </VStack>
          </CardBody>
        </Card>

        {/* Listing Quota */}
        <Card bg={cardBg} borderWidth="1px" borderColor={borderColor}>
          <CardBody>
            <VStack align="start" spacing={2}>
              <HStack spacing={2}>
                <Icon as={FaBoxes} color={currentTier === 'pro' ? 'purple.500' : 'blue.500'} fontSize="lg" />
                <Text fontWeight="bold" fontSize="sm" textTransform="uppercase" color={mutedText}>Listings Used</Text>
              </HStack>
              <Text fontSize="xl" fontWeight="bold">
                {getListingQuota().used} / {getListingQuota().limit === Infinity ? '∞' : getListingQuota().limit}
              </Text>
              {getListingQuota().limit !== Infinity && (
                <Box w="full">
                  <Box
                    h="2px"
                    bg={borderColor}
                    borderRadius="full"
                    overflow="hidden"
                  >
                    <Box
                      h="100%"
                      bg={getListingQuota().percentage > 90 ? 'red.400' : currentTier === 'pro' ? 'purple.400' : 'blue.400'}
                      w={`${getListingQuota().percentage}%`}
                      transition="all 0.3s"
                    />
                  </Box>
                  <Text fontSize="xs" color={mutedText} mt={1}>
                    {getListingQuota().remaining} remaining
                  </Text>
                </Box>
              )}
            </VStack>
          </CardBody>
        </Card>

        {/* Current Plan */}
        <Card bg={cardBg} borderWidth="1px" borderColor={borderColor}>
          <CardBody>
            <VStack align="start" spacing={2}>
              <HStack spacing={2}>
                <Icon as={FaCrown} color={currentTier === 'pro' ? 'purple.500' : 'blue.500'} fontSize="lg" />
                <Text fontWeight="bold" fontSize="sm" textTransform="uppercase" color={mutedText}>Current Plan</Text>
              </HStack>
              <Badge
                colorScheme={currentTier === 'pro' ? 'purple' : 'blue'}
                variant="solid"
                fontSize="md"
                px={3}
                py={1}
                borderRadius="md"
              >
                {currentTier.charAt(0).toUpperCase() + currentTier.slice(1)}
              </Badge>
              <Button
                size="xs"
                variant="ghost"
                colorScheme={currentTier === 'pro' ? 'purple' : 'blue'}
                fontSize="xs"
                onClick={() => handleUpgrade(currentTier === 'plus' ? 'pro' : 'plus')}
              >
                {currentTier === 'pro' ? 'View Details' : 'Upgrade →'}
              </Button>
            </VStack>
          </CardBody>
        </Card>
      </SimpleGrid>

      {/* Your Products - Boost Section */}
      {isPremiumUser && (
        <VStack align="start" spacing={4}>
          <Heading size="md">Your Products</Heading>
          {productsLoading ? (
            <Center w="100%" py={8}>
              <Spinner size="lg" color="brand.500" />
            </Center>
          ) : userProducts.length === 0 ? (
            <Card bg={cardBg} borderWidth="1px" borderColor={borderColor} w="100%">
              <CardBody>
                <HStack spacing={3} justify="center" py={8}>
                  <Icon as={FaBoxes} fontSize="2xl" color="gray.400" />
                  <VStack align="start" spacing={0}>
                    <Text fontWeight="semibold" color="gray.600">No products yet</Text>
                    <Text fontSize="sm" color={mutedText}>Create your first product to start boosting</Text>
                  </VStack>
                </HStack>
              </CardBody>
            </Card>
          ) : (
            <SimpleGrid columns={{ base: 1, md: 2, lg: 3 }} spacing={4} w="100%">
              {userProducts.map((product) => (
                <Card
                  key={product.id}
                  bg={cardBg}
                  borderWidth="1px"
                  borderColor={product.boosted_at ? 'brand.300' : borderColor}
                  _hover={{ shadow: 'md', borderColor: 'brand.400' }}
                  transition="all 0.2s"
                  overflow="hidden"
                >
                  {/* Product Image Preview */}
                  {product.image_urls?.[0] && (
                    <Box
                      h="150px"
                      bg="gray.200"
                      bgImage={`url(${product.image_urls[0]})`}
                      bgSize="cover"
                      bgPos="center"
                      position="relative"
                    >
                      {product.boosted_at && (
                        <Badge
                          position="absolute"
                          top={2}
                          right={2}
                          colorScheme="brand"
                          variant="solid"
                          borderRadius="full"
                          px={2}
                          py={1}
                          fontSize="xs"
                          display="flex"
                          alignItems="center"
                          gap={1}
                        >
                          <Icon as={FaRocket} fontSize="xs" />
                          Boosted
                        </Badge>
                      )}
                    </Box>
                  )}
                  <CardBody>
                    <VStack align="start" spacing={3}>
                      <Box>
                        <Text fontSize="sm" fontWeight="bold" noOfLines={2}>{product.title}</Text>
                        <Text fontSize="xs" color={mutedText} mt={1}>
                          Status: <Badge fontSize="xs" colorScheme={product.status === 'available' ? 'green' : 'gray'}>{product.status}</Badge>
                        </Text>
                      </Box>
                      
                      {/* Boost Button */}
                      <Button
                        size="sm"
                        colorScheme={product.boosted_at ? 'orange' : 'brand'}
                        variant={product.boosted_at ? 'solid' : 'outline'}
                        w="full"
                        leftIcon={<FaRocket />}
                        isLoading={boostingProduct === product.id}
                        isDisabled={product.status !== 'available' || boostingProduct === product.id}
                        onClick={() => handleBoostProduct(product.id)}
                        title={product.boosted_at ? 'Product is currently boosted' : 'Boost for 3 hours to top of feed'}
                      >
                        {product.boosted_at ? '⭐ Boosted Now' : '🚀 Boost for 3h'}
                      </Button>
                    </VStack>
                  </CardBody>
                </Card>
              ))}
            </SimpleGrid>
          )}
        </VStack>
      )}

    </VStack>
  )

  // ─── Render: Non-premium (Locked) Content ───
  const renderLockedContent = () => (
    <VStack spacing={10} align="stretch">
      {/* 3-Tier Pricing Cards */}
      {!premiumConfig?.enabled && (
        <Alert status="info" borderRadius="xl">
          <AlertIcon />
          Premium subscriptions are temporarily unavailable. Existing premium access remains unchanged.
        </Alert>
      )}
      {(premiumConfig?.features || []).filter((feature: any) => feature.enabled).length > 0 && (
        <Card bg={cardBg} borderWidth="1px" borderColor={borderColor} borderRadius="2xl">
          <CardBody>
            <VStack align="stretch" spacing={3}>
              <Heading size="sm">Premium benefits included</Heading>
              <SimpleGrid columns={{ base: 1, md: 2, lg: 3 }} spacing={3}>
                {(premiumConfig.features || []).filter((feature: any) => feature.enabled).map((feature: any) => (
                  <HStack key={feature.feature_key} align="start" spacing={2}>
                    <Icon as={FaCheckCircle} color="green.400" mt={1} />
                    <Box>
                      <Text fontWeight="700" fontSize="sm">{feature.label}</Text>
                      {feature.description && <Text fontSize="xs" color={mutedText}>{feature.description}</Text>}
                    </Box>
                  </HStack>
                ))}
              </SimpleGrid>
            </VStack>
          </CardBody>
        </Card>
      )}
      <SimpleGrid columns={{ base: 1, md: 3 }} spacing={6} alignItems="stretch">
        {/* ── Free Tier ── */}
        <Card bg={cardBg} borderWidth="1px" borderColor={borderColor} borderRadius="3xl" overflow="hidden" opacity={0.8} h="100%" shadow="sm" transition="all 0.3s" _hover={{ opacity: 1, shadow: 'md' }}>
          <CardBody p={8}>
            <VStack spacing={6} align="stretch">
              <VStack spacing={1} align="start">
                <Text fontWeight="800" fontSize="xl" letterSpacing="tight">Free</Text>
                <Text fontWeight="600" fontSize="sm" color={mutedText}>Perfect to Start</Text>
              </VStack>
              <HStack align="baseline" spacing={1}>
                <Text fontSize="4xl" fontWeight="900" letterSpacing="tighter">₱0</Text>
                <Text color={mutedText} fontWeight="600">/ month</Text>
              </HStack>
              <Text fontSize="xs" color="gray.400" fontWeight="600">Forever free</Text>
              <Divider borderColor={borderColor} />
              <FeatureSection title="Listings" features={freeFeatures.listings} color="gray" />
              <Divider borderColor={borderColor} />
              <FeatureSection title="Trading" features={freeFeatures.trading} color="gray" />
              <Divider borderColor={borderColor} />
              <Button variant="outline" colorScheme="gray" size="lg" borderRadius="xl" isDisabled opacity={0.6} fontWeight="700">
                Your Current Plan
              </Button>
              <Text fontSize="xs" textAlign="center" color={mutedText} fontWeight="600">
                Upgrade anytime to unlock premium features
              </Text>
            </VStack>
          </CardBody>
        </Card>

        {/* ── Plus Tier ── */}
        <Card
          bg={cardBg}
          borderWidth="0"
          borderRadius="3xl"
          overflow="hidden"
          position="relative"
          shadow="xl"
          h="100%"
          transform={{ base: 'none', lg: 'scale(1.03)' }}
          zIndex={2}
        >
          <Box position="absolute" top={0} left={0} right={0} h="6px" bg="linear-gradient(90deg, #3182CE, #63B3ED)" />
          <Badge
            position="absolute" top={4} right={4} bg="blue.500" color="white"
            borderRadius="full" px={3} py={1} fontSize="10px" fontWeight="800" shadow="sm" letterSpacing="0.5px"
          >
            MOST POPULAR
          </Badge>
          <CardBody p={8}>
            <VStack spacing={6} align="stretch">
              <VStack spacing={1} align="start">
                <HStack spacing={2}>
                  <Icon as={FaStar} color="blue.500" fontSize="xl" />
                  <Text fontWeight="800" fontSize="2xl" letterSpacing="tight">Plus</Text>
                </HStack>
              </VStack>
              <VStack align="start" spacing={0}>
                <HStack align="baseline" spacing={1}>
                  <Text fontSize="5xl" fontWeight="900" color="blue.600" letterSpacing="tighter">
                    {isYearly ? formatPlanPrice('plus', 'yearly', 699) : formatPlanPrice('plus', 'monthly', 79)}
                  </Text>
                  <Text color={mutedText} fontWeight="600">/ {isYearly ? 'year' : 'month'}</Text>
                </HStack>
                {isYearly ? (
                  <HStack spacing={2} pt={1}>
                    <Text fontSize="sm" color={mutedText} textDecoration="line-through" fontWeight="600">₱948/yr</Text>
                    <Badge colorScheme="green" variant="subtle" borderRadius="full" fontSize="10px" fontWeight="800" px={2}>save 26%</Badge>
                  </HStack>
                ) : (
                  <Text fontSize="sm" color={mutedText} fontWeight="600" pt={1}>
                    or {formatPlanPrice('plus', 'yearly', 699)}/year{' '}
                    <Text as="span" color="green.500" fontWeight="800">save 26%</Text>
                  </Text>
                )}
              </VStack>
              <Divider borderColor={borderColor} />
              <FeatureSection title="Listings" features={plusFeatures.listings} color="blue" />
              <Divider borderColor={borderColor} />
              <FeatureSection title="Trading" features={plusFeatures.trading} color="blue" />
              <Divider borderColor={borderColor} />
              <FeatureSection title="Profile" features={plusFeatures.profile} color="blue" />
              <Box pt={2}>
                <Button
                  colorScheme="blue" size="lg" leftIcon={<FaStar />}
                  isLoading={upgrading === 'plus'} onClick={() => handleUpgrade('plus')}
                  isDisabled={currentTier !== 'free' || !premiumConfig?.enabled || !getPlan('plus', isYearly ? 'yearly' : 'monthly')}
                  w="full"
                  borderRadius="2xl"
                  fontWeight="800"
                  _hover={{ transform: 'translateY(-2px)', shadow: 'md' }} transition="all 0.2s"
                >
                  Get Plus
                </Button>
              </Box>
            </VStack>
          </CardBody>
        </Card>

        {/* ── Pro Tier ── */}
        <Card
          bg={useColorModeValue('purple.50', 'gray.800')}
          borderWidth="1px"
          borderColor={useColorModeValue('purple.100', 'purple.800')}
          borderRadius="3xl"
          overflow="hidden"
          position="relative"
          shadow="xl"
          h="100%"
        >
          <Box position="absolute" top={0} left={0} right={0} h="6px" bg="linear-gradient(90deg, #9F7AEA, #805AD5, #6B46C1)" />
          <Badge
            position="absolute" top={4} right={4} bg="purple.500" color="white"
            borderRadius="full" px={3} py={1} fontSize="10px" fontWeight="800" shadow="sm" letterSpacing="0.5px"
          >
            POWER TRADER
          </Badge>
          <CardBody p={8}>
            <VStack spacing={6} align="stretch">
              <VStack spacing={1} align="start">
                <HStack spacing={2}>
                  <Icon as={FaCrown} color="purple.500" fontSize="xl" />
                  <Text fontWeight="800" fontSize="2xl" letterSpacing="tight">Pro</Text>
                </HStack>
              </VStack>
              <VStack align="start" spacing={0}>
                <HStack align="baseline" spacing={1}>
                  <Text fontSize="5xl" fontWeight="900" color="purple.600" letterSpacing="tighter">
                    {isYearly ? formatPlanPrice('pro', 'yearly', 1099) : formatPlanPrice('pro', 'monthly', 129)}
                  </Text>
                  <Text color={mutedText} fontWeight="600">/ {isYearly ? 'year' : 'month'}</Text>
                </HStack>
                {isYearly ? (
                  <HStack spacing={2} pt={1}>
                    <Text fontSize="sm" color={mutedText} textDecoration="line-through" fontWeight="600">₱1,548/yr</Text>
                    <Badge colorScheme="green" variant="subtle" borderRadius="full" px={2} fontSize="10px" fontWeight="800">save 24%</Badge>
                  </HStack>
                ) : (
                  <Text fontSize="sm" color={mutedText} fontWeight="600" pt={1}>
                    or {formatPlanPrice('pro', 'yearly', 1099)}/year{' '}
                    <Text as="span" color="green.500" fontWeight="800">save 24%</Text>
                  </Text>
                )}
              </VStack>
              <Divider borderColor="purple.200" />
              <FeatureSection title="Listings" features={proFeatures.listings} color="purple" />
              <Divider borderColor="purple.200" />
              <FeatureSection title="Trading" features={proFeatures.trading} color="purple" />
              <Divider borderColor="purple.200" />
              <FeatureSection title="Profile" features={proFeatures.profile} color="purple" />
              <Box pt={2}>
                <Button
                  colorScheme="purple" size="lg" leftIcon={<FaCrown />}
                  isLoading={upgrading === 'pro'} onClick={() => handleUpgrade('pro')}
                  isDisabled={currentTier === 'pro' || !premiumConfig?.enabled || !getPlan('pro', isYearly ? 'yearly' : 'monthly')}
                  w="full"
                  borderRadius="2xl"
                  fontWeight="800"
                  _hover={{ transform: 'translateY(-2px)', shadow: 'md' }} transition="all 0.2s"
                >
                  Get Pro
                </Button>
              </Box>
            </VStack>
          </CardBody>
        </Card>
      </SimpleGrid>

      {currentTier === 'free' && (
        <Box>
          <Heading size="md" mb={6} textAlign="center">Feature Comparison</Heading>
          <Card bg={cardBg} borderWidth="1px" borderColor={borderColor} overflow="hidden">
            <TableContainer>
              <Table variant="simple" size="sm">
                <Thead bg={subtleBg}>
                  <Tr>
                    <Th>Feature</Th>
                    <Th textAlign="center">Free</Th>
                    <Th textAlign="center" color="blue.600">Plus</Th>
                    <Th textAlign="center" color="purple.600">Pro</Th>
                  </Tr>
                </Thead>
                <Tbody>
                  {comparisonFeatures.map((row, i) => (
                    <Tr key={i} _hover={{ bg: hoverBg }}>
                      <Td fontSize="sm" fontWeight="medium">{row.feature}</Td>
                      <Td textAlign="center">{renderCell(row.free, 'gray')}</Td>
                      <Td textAlign="center">{renderCell(row.plus, 'blue')}</Td>
                      <Td textAlign="center">{renderCell(row.pro, 'purple')}</Td>
                    </Tr>
                  ))}
                </Tbody>
              </Table>
            </TableContainer>
          </Card>
        </Box>
      )}

      {/* FAQ */}
      {currentTier === 'free' && (
        <Box>
          <Heading size="md" mb={6} textAlign="center">Frequently Asked Questions</Heading>
          <VStack spacing={3} align="stretch">
            {faqItems.map((faq, i) => (
              <Card
                key={i} bg={cardBg} borderWidth="1px" borderColor={borderColor}
                cursor="pointer" onClick={() => toggleFaq(i)}
                _hover={{ borderColor: 'purple.300', shadow: 'md' }} transition="all 0.2s"
              >
                <CardBody py={4}>
                  <Flex justify="space-between" align="center">
                    <Text fontWeight="semibold" fontSize="sm">{faq.question}</Text>
                    <Icon as={expandedFaq === i ? FaChevronUp : FaChevronDown} color={mutedText} fontSize="sm" />
                  </Flex>
                  <Collapse in={expandedFaq === i} animateOpacity>
                    <Text fontSize="sm" color={mutedText} mt={3} lineHeight="tall">{faq.answer}</Text>
                  </Collapse>
                </CardBody>
              </Card>
            ))}
          </VStack>
        </Box>
      )}

      {currentTier === 'free' && (
        <Card bg="linear-gradient(135deg, #667eea 0%, #764ba2 100%)" borderWidth="0">
          <CardBody py={12}>
            <VStack spacing={4} textAlign="center" color="white">
              <Heading size="lg">Ready to Transform Your Trading Experience?</Heading>
              <Text fontSize="md" maxW="2xl" opacity={0.95}>
                Join thousands of traders using Clovia Premium to close deals faster, safer, and smarter.
              </Text>
              <HStack spacing={4} pt={4}>
                <Button
                  colorScheme="whiteAlpha" size="lg" variant="solid"
                  onClick={() => handleUpgrade('plus')}
                  isLoading={upgrading === 'plus'}
                >
                  Start with Plus
                </Button>
                <Button
                  colorScheme="whiteAlpha" size="lg" variant="outline"
                  onClick={() => handleUpgrade('pro')}
                  isLoading={upgrading === 'pro'}
                >
                  Go Pro
                </Button>
              </HStack>
            </VStack>
          </CardBody>
        </Card>
      )}
    </VStack>
  )

  return (
    <Box minH="100vh" bg={pageBg}>
      <Container maxW="container.xl" py={12}>
        <IconButton
          aria-label="Go back"
          icon={<Icon as={FaArrowLeft} />}
          onClick={handleBack}
          variant="ghost"
          size="lg"
          mb={2}
          alignSelf="flex-start"
        />
        <VStack spacing={12} align="stretch">
          {currentTier === 'free' && (
            <VStack spacing={4} textAlign="center">
              <Badge colorScheme="purple" px={4} py={1} borderRadius="full" fontSize="sm" fontWeight="bold">
                Clovia Premium
              </Badge>
              <Heading size="2xl" fontWeight="extrabold">
                Level up your trading game
              </Heading>
              <Text fontSize="lg" color={mutedText} maxW="2xl">
                Unlock the full potential of Clovia with premium features designed to help you trade faster, safer, and smarter.
              </Text>

              {!isPremiumUser && (
                <HStack spacing={4} pt={4}>
                  <Text fontWeight="medium" color={!isYearly ? 'gray.800' : mutedText}>Monthly</Text>
                  <Switch
                    colorScheme="purple" size="lg" isChecked={isYearly}
                    onChange={(e) => setIsYearly(e.target.checked)}
                  />
                  <HStack spacing={2}>
                    <Text fontWeight="medium" color={isYearly ? 'gray.800' : mutedText}>Yearly</Text>
                    <Badge colorScheme="green" variant="subtle" borderRadius="full" px={2}>save up to 26%</Badge>
                  </HStack>
                </HStack>
              )}
            </VStack>
          )}

          {subscriptionLoading ? (
            <Center py={20}>
              <VStack spacing={4}>
                <Spinner size="xl" color="purple.500" thickness="3px" />
                <Text color={mutedText} fontSize="sm">Loading your plan...</Text>
              </VStack>
            </Center>
          ) : isPremiumUser ? renderPremiumActive() : renderLockedContent()}
        </VStack>
      </Container>

      {selectedLoop && (
        <MultiWayTradeModal isOpen={isOpen} onClose={handleCloseModal} multiWayTrade={selectedLoop} />
      )}
    </Box>
  )
}

export default Premium

