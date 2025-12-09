import React, { useEffect, useMemo, useState, useRef } from 'react'
import { useParams, Link as RouterLink } from 'react-router-dom'
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
} from '@chakra-ui/react'
import { FiMessageSquare, FiHeart, FiShare2, FiStar, FiClock, FiCheckCircle, FiSend } from 'react-icons/fi'
import { api } from '../services/api'
import { useAuth } from '../contexts/AuthContext'
import { Product, User } from '../types'
import { useProducts } from '../contexts/ProductContext'
import { getFirstImage, getImageUrl } from '../utils/imageUtils'
import { getProductUrl } from '../utils/productUtils'

  type PublicUser = Pick<User, 'id' | 'name' | 'verified' | 'created_at'> & {
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
  department?: string
  response_time_minutes?: number
  positive_feedback?: number
  total_reviews?: number
  is_following?: boolean
}

const UserProfile: React.FC = () => {
  const { id } = useParams<{ id: string }>()
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
  const { getUserProducts } = useProducts()
  const { isOpen, onOpen, onClose } = useDisclosure()
  const toast = useToast()
  
  // Mock reviews data - replace with actual API call
  useEffect(() => {
    // In a real app, fetch reviews from API
    const mockReviews = [
      {
        id: 1,
        reviewer: 'John D.',
        avatar: 'https://randomuser.me/api/portraits/men/1.jpg',
        rating: 5,
        comment: 'Great seller! Item was exactly as described.',
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
  }, [])

  useEffect(() => {
    const run = async () => {
      if (!id) return;
      setLoading(true);
      setError('');
      try {
        // If this is the currently authenticated user's page, fetch the protected profile
        let res
        if (currentUser && Number(id) === currentUser.id) {
          res = await api.get('/api/users/profile')
        } else {
          // Fetch public user info
          res = await api.get(`/api/users/${id}`).catch(err => {
            // If user not found, use fallback data
            if (err.response?.status === 404) {
              return {
                data: {
                  id: Number(id),
                  name: 'User',
                  created_at: new Date().toISOString(),
                  rating: 4.8,
                  positive_feedback: 98,
                  response_time_minutes: 30,
                  total_reviews: 42,
                  is_following: false,
                  bio: 'This user prefers to keep an air of mystery about them.',
                  department: 'Unknown',
                  verified: false,
                  is_organization: false,
                },
              }
            }
            throw err
          })
        }

        const apiUser = (res.data?.data || res.data) as Partial<PublicUser>
        setUser({
          id: Number(id),
          name: apiUser.name || 'User',
          verified: Boolean(apiUser.verified),
          created_at: (apiUser as any).created_at || new Date().toISOString(),
          // Prefer profile_picture if provided, fall back to org logo
          avatar_url: getImageUrl((apiUser as any).profile_picture || (apiUser as any).org_logo_url || null),
            background_url: getImageUrl((apiUser as any).background_image || (apiUser as any).cover_photo || null),
            background_position: (apiUser as any).background_position || (apiUser as any).background_position || '50% 50%',
          // If the current user and API returned an email/name, prefer those
          is_following: (apiUser as any).is_following ?? false,
          bio: (apiUser as any).bio || 'No bio provided yet.',
          rating: apiUser.rating ?? 4.6,
          rank: apiUser.rank || 'Rising Trader',
          is_organization: (apiUser as any).is_organization,
          org_verified: (apiUser as any).org_verified,
          org_name: (apiUser as any).org_name,
          org_logo_url: (apiUser as any).org_logo_url,
          department: (apiUser as any).department,
        })

        // Fetch user's products to infer stats and successful trades
        const page1 = await getUserProducts(Number(id), 1)
        setProducts(page1.data || [])
      } catch (e: any) {
        setError(e?.message || 'Failed to load user')
      } finally {
        setLoading(false)
      }
    }
    run()
  }, [id, getUserProducts])

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
        title: 'Failed to save profile',
        description: err?.response?.data?.message || err?.message || 'An error occurred',
        status: 'error',
        duration: 4000,
        isClosable: true,
      })
      return
    }
    toast({
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
    const rating = user?.rating ?? 4.6
    return { total, active, completed, rating }
  }, [products, user])

  // Successful trades with more details
  const successfulTrades = useMemo(() => {
    const items = products
      .filter(p => p.status === 'traded' || p.status === 'sold')
      .slice(0, 8)
      .map((p, idx) => ({
        id: `${p.id}-${idx}`,
        title: p.title,
        date: new Date(p.updated_at || p.created_at).toLocaleDateString(),
        counterpart: 'Confidential',
        beforeImg: getFirstImage(p.image_urls),
        afterImg: getFirstImage(p.image_urls),
        tradeDetails: p.status === 'traded' 
          ? `Traded for ${['book', 'headphones', 'watch'][idx % 3]}`
          : `Sold for $${(Math.random() * 100 + 20).toFixed(2)}`,
        timestamp: p.updated_at || p.created_at
      }))
    return items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
  }, [products])

  // Sort products based on selected option
  const sortedProducts = useMemo(() => {
    const sorted = [...products]
    switch(sortBy) {
      case 'price_asc':
        return sorted.sort((a, b) => (a.price || 0) - (b.price || 0))
      case 'price_desc':
        return sorted.sort((a, b) => (b.price || 0) - (a.price || 0))
      case 'newest':
      default:
        return sorted.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    }
  }, [products, sortBy])

  const toggleFollow = () => {
    if (user) {
      setUser({...user, is_following: !user.is_following})
      toast({
        title: user.is_following ? 'Unfollowed' : 'Following',
        description: user.is_following ? `You've unfollowed ${user.name}` : `You're now following ${user.name}`,
        status: 'success',
        duration: 3000,
        isClosable: true,
      })
    }
  }

  const handleSendMessage = () => {
    // In a real app, this would open a chat with the user
    toast({
      title: 'Message Sent',
      description: `Message sent to ${user?.name}`,
      status: 'success',
      duration: 3000,
      isClosable: true,
    })
  }

  const badges = useMemo(() => {
    const list: { label: string; color: string }[] = []
    if (stats.completed >= 20) list.push({ label: 'Top Trader', color: 'purple' })
    if (stats.completed >= 5) list.push({ label: 'Trusted Seller', color: 'green' })
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
            as={RouterLink} 
            to="/" 
            colorScheme="brand"
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
          {/* Seller Info Header */}
          <Card bg="white" border="1px" borderColor="gray.200" shadow="sm" overflow="hidden">
            <Box
              h="160px"
              w="100%"
              position="relative"
              bgImage={`url(${user.background_url || '/profile-bg-default.jpg'})`}
              bgSize="cover"
              bgPos={user.background_position || 'center'}
            >
              {currentUser && Number(id) === currentUser.id && (
                <Button
                  position="absolute"
                  top={3}
                  right={3}
                  size="sm"
                  onClick={openEdit}
                  colorScheme="brand"
                >
                  Edit Profile
                </Button>
              )}

              <Box position="absolute" bottom="-50px" left="6">
                <Avatar 
                  size="xl" 
                  name={user.name} 
                  src={user.avatar_url} 
                  bg="brand.500" 
                  color="white" 
                  border="4px solid white"
                  boxShadow="md"
                />
              </Box>
            </Box>
            
            <CardBody pt="60px">
              <Flex justify="space-between" wrap="wrap">
                <Box flex="1" minW="200px" mr={4}>
                  <HStack spacing={3} align="center" mb={2}>
                    <Heading size="lg" color="gray.800">{user.name}</Heading>
                    {user.verified && (
                      <Badge colorScheme="green">
                        <HStack spacing={1}>
                          <Icon as={FiCheckCircle} boxSize={3} />
                          <Text>Verified Seller</Text>
                        </HStack>
                      </Badge>
                    )}
                  </HStack>
                  
                  <HStack spacing={6} mb={4} flexWrap="wrap">
                    <HStack>
                      <Icon as={FiStar} color="yellow.400" />
                      <Text>{user.rating?.toFixed(1) || '4.8'} <Text as="span" color="gray.500">({user.total_reviews || 98} reviews)</Text></Text>
                    </HStack>
                    <HStack>
                      <Text color="green.500">{user.positive_feedback || 98}%</Text>
                      <Text color="gray.500">Positive Feedback</Text>
                    </HStack>
                    <HStack>
                      <Text fontWeight="medium">{stats.completed}</Text>
                      <Text color="gray.500">Trades Completed</Text>
                    </HStack>
                    <HStack>
                      <Icon as={FiClock} color="gray.500" />
                      <Text color="gray.500">Avg. Response: {user.response_time_minutes || 30} min</Text>
                    </HStack>
                  </HStack>
                  
                  {user.bio && <Text color="gray.700" mb={4}>{user.bio}</Text>}
                  
                  {/* Show action buttons only when viewing someone else's profile */}
                  {!(currentUser && Number(id) === currentUser.id) && (
                    <HStack spacing={3}>
                      <Button 
                        leftIcon={<Icon as={FiMessageSquare} />} 
                        colorScheme="brand"
                        onClick={handleSendMessage}
                      >
                        Message Seller
                      </Button>
                      <Button 
                        variant="outline" 
                        colorScheme={user.is_following ? 'gray' : 'brand'}
                        onClick={toggleFollow}
                      >
                        {user.is_following ? 'Following' : 'Follow'}
                      </Button>
                    </HStack>
                  )}
                </Box>
                
                <Box bg="gray.50" p={4} borderRadius="md" minW="250px">
                  <VStack spacing={3} align="stretch">
                    <HStack justify="space-between">
                      <Text color="gray.600">Member Since</Text>
                      <Text fontWeight="medium">{new Date(user.created_at).toLocaleDateString()}</Text>
                    </HStack>
                    {user.department && (
                      <HStack justify="space-between">
                        <Text color="gray.600">Department</Text>
                        <Text fontWeight="medium">{user.department}</Text>
                      </HStack>
                    )}
                    <HStack justify="space-between">
                      <Text color="gray.600">Items for Sale</Text>
                      <Text fontWeight="medium">{stats.active}</Text>
                    </HStack>
                    <HStack justify="space-between">
                      <Text color="gray.600">Total Listings</Text>
                      <Text fontWeight="medium">{stats.total}</Text>
                    </HStack>
                  </VStack>
                </Box>
              </Flex>
            </CardBody>
          </Card>

          {/* Tabs for different sections */}
          <Tabs variant="enclosed" isLazy>
            <TabList borderBottom="1px" borderColor="gray.200" bg="white" px={4}>
              <Tab _selected={{ color: 'brand.500', borderBottom: '2px solid', borderColor: 'brand.500' }}>
                Products ({stats.active})
              </Tab>
              <Tab _selected={{ color: 'brand.500', borderBottom: '2px solid', borderColor: 'brand.500' }}>
                Trade History
              </Tab>
              <Tab _selected={{ color: 'brand.500', borderBottom: '2px solid', borderColor: 'brand.500' }}>
                Reviews ({reviews.length})
              </Tab>
            </TabList>

            <TabPanels bg="white" borderX="1px" borderBottom="1px" borderColor="gray.200" borderRadius="0 0 8px 8px">
              {/* Products Tab */}
              <TabPanel p={0}>
                <Box p={4} borderBottom="1px" borderColor="gray.100">
                  <HStack spacing={4} justify="space-between" flexWrap="wrap">
                    <Text fontWeight="medium">{sortedProducts.length} items</Text>
                    <HStack>
                      <Text fontSize="sm" color="gray.500">Sort by:</Text>
                      <Select 
                        size="sm" 
                        w="180px" 
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value)}
                        aria-label="Sort products"
                        title="Sort products"
                      >
                        <option value="newest">Newest First</option>
                        <option value="price_asc">Price: Low to High</option>
                        <option value="price_desc">Price: High to Low</option>
                      </Select>
                    </HStack>
                  </HStack>
                </Box>
                
                {sortedProducts.length === 0 ? (
                  <Center p={10}>
                    <VStack>
                      <Text color="gray.500">No products found.</Text>
                      <Button as={RouterLink} to="/add-product" colorScheme="brand" size="sm" mt={2}>
                        List an Item
                      </Button>
                    </VStack>
                  </Center>
                ) : (
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
                        <Box position="relative">
                          <Image 
                            src={getFirstImage(product.image_urls) || '/placeholder-item.jpg'} 
                            alt={product.title}
                            h="180px"
                            w="100%"
                            objectFit="cover"
                          />
                          <Box position="absolute" top="2" right="2">
                            <IconButton
                              aria-label="Save item"
                              icon={<FiHeart />}
                              size="sm"
                              borderRadius="full"
                              bg="white"
                              color="gray.600"
                              _hover={{ color: 'red.500', bg: 'white' }}
                            />
                          </Box>
                          <Box position="absolute" top="2" left="2">
                            <Badge colorScheme={product.status === 'available' ? 'green' : 'red'}>
                              {product.status}
                            </Badge>
                          </Box>
                        </Box>
                        
                        <Box p={3}>
                          <Text 
                            as={RouterLink} 
                            to={getProductUrl(product)}
                            fontWeight="medium" 
                            noOfLines={2} 
                            mb={1}
                            _hover={{ color: 'brand.500' }}
                          >
                            {product.title}
                          </Text>
                          
                          <HStack justify="space-between" align="center" mt={2}>
                            <Text fontWeight="bold" color="gray.800">
                              {product.price ? `$${product.price.toFixed(2)}` : 'Free'}
                            </Text>
                            <IconButton
                              aria-label="Share item"
                              icon={<FiShare2 />}
                              size="sm"
                              variant="ghost"
                              color="gray.500"
                            />
                          </HStack>
                        </Box>
                      </Box>
                    ))}
                  </SimpleGrid>
                )}
              </TabPanel>

              {/* Trade History Tab */}
              <TabPanel p={0}>
                <Box p={4} borderBottom="1px" borderColor="gray.100">
                  <Heading size="md" mb={2}>Trade History</Heading>
                  <Text color="gray.500" fontSize="sm">
                    {successfulTrades.length} completed trades
                  </Text>
                </Box>
                
                {successfulTrades.length === 0 ? (
                  <Center p={10}>
                    <Text color="gray.500">No trade history yet.</Text>
                  </Center>
                ) : (
                  <Box>
                    {successfulTrades.map((trade, index) => (
                      <Box 
                        key={trade.id} 
                        p={4} 
                        borderBottom={index < successfulTrades.length - 1 ? '1px' : 'none'} 
                        borderColor="gray.100"
                        _hover={{ bg: 'gray.50' }}
                      >
                        <HStack spacing={4} align="start">
                          <Box 
                            w="60px" 
                            h="60px" 
                            bg="gray.100" 
                            borderRadius="md" 
                            overflow="hidden"
                            flexShrink={0}
                          >
                            <Image 
                              src={trade.beforeImg || '/placeholder-item.jpg'} 
                              alt={trade.title}
                              w="100%"
                              h="100%"
                              objectFit="cover"
                            />
                          </Box>
                          
                          <Box flex="1">
                            <HStack justify="space-between" mb={1}>
                              <Text fontWeight="medium">{trade.title}</Text>
                              <Text fontSize="sm" color="gray.500">{trade.date}</Text>
                            </HStack>
                            
                            <Text fontSize="sm" color="gray.600" mb={2}>
                              {trade.tradeDetails}
                            </Text>
                            
                            <HStack spacing={2}>
                              <Badge colorScheme="green" variant="subtle" fontSize="xs">
                                Completed
                              </Badge>
                              <Text fontSize="xs" color="gray.500">
                                with {trade.counterpart}
                              </Text>
                            </HStack>
                          </Box>
                        </HStack>
                      </Box>
                    ))}
                  </Box>
                )}
              </TabPanel>

              {/* Reviews Tab */}
              <TabPanel p={0}>
                <Box p={4} borderBottom="1px" borderColor="gray.100">
                  <HStack justify="space-between" align="flex-start">
                    <Box>
                      <Heading size="md" mb={1}>Reviews</Heading>
                      <HStack spacing={1} mb={2}>
                        <Icon as={FiStar} color="yellow.400" boxSize={5} />
                        <Text fontSize="xl" fontWeight="bold">
                          {user.rating?.toFixed(1) || '4.8'}
                          <Text as="span" fontSize="md" fontWeight="normal" color="gray.600" ml={1}>
                            ({reviews.length} reviews)
                          </Text>
                        </Text>
                      </HStack>
                      <Text color="green.600" fontSize="sm">
                        {user.positive_feedback || 98}% positive feedback
                      </Text>
                    </Box>
                    
                    <Button 
                      colorScheme="brand" 
                      size="sm" 
                      onClick={onOpen}
                      leftIcon={<Icon as={FiStar} />}
                    >
                      Leave a Review
                    </Button>
                  </HStack>
                </Box>
                
                {reviews.length === 0 ? (
                  <Center p={10}>
                    <VStack>
                      <Text color="gray.500">No reviews yet.</Text>
                      <Button 
                        colorScheme="brand" 
                        variant="outline" 
                        size="sm" 
                        mt={2}
                        onClick={onOpen}
                      >
                        Be the first to review
                      </Button>
                    </VStack>
                  </Center>
                ) : (
                  <Box>
                    {reviews.map((review, index) => (
                      <Box 
                        key={review.id} 
                        p={4} 
                        borderBottom={index < reviews.length - 1 ? '1px' : 'none'} 
                        borderColor="gray.100"
                      >
                        <HStack spacing={3} mb={2}>
                          <Avatar 
                            size="sm" 
                            name={review.reviewer} 
                            src={review.avatar} 
                          />
                          <Box>
                            <Text fontWeight="medium">{review.reviewer}</Text>
                            <HStack spacing={1}>
                              {[...Array(5)].map((_, i) => (
                                <Icon 
                                  key={i} 
                                  as={FiStar} 
                                  color={i < review.rating ? 'yellow.400' : 'gray.300'} 
                                  boxSize={4}
                                />
                              ))}
                              <Text fontSize="sm" color="gray.500" ml={1}>
                                {review.date}
                              </Text>
                            </HStack>
                          </Box>
                        </HStack>
                        <Text color="gray.700" pl={12}>
                          {review.comment}
                        </Text>
                      </Box>
                    ))}
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
                      <Avatar size="lg" name={user.name} src={avatarPreview || user.avatar_url} />
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

                  <FormControl>
                    <FormLabel>Bio</FormLabel>
                    <Textarea value={draftBio} onChange={(e) => setDraftBio(e.target.value)} rows={4} />
                  </FormControl>

                  <HStack justify="flex-end">
                    <Button onClick={closeEdit} variant="ghost">Cancel</Button>
                    <Button colorScheme="brand" onClick={handleSaveProfile}>Save Changes</Button>
                  </HStack>
                </VStack>
              </ModalBody>
            </ModalContent>
          </Modal>

          {/* Review Modal */}
          <Modal isOpen={isOpen} onClose={onClose} size="lg">
            <ModalOverlay />
            <ModalContent>
              <ModalHeader>Leave a Review</ModalHeader>
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
                          icon={<FiStar />}
                          variant="ghost"
                          color={star <= 5 ? 'yellow.400' : 'gray.300'}
                          _hover={{ color: 'yellow.500' }}
                          size="lg"
                          onClick={() => {}}
                        />
                      ))}
                    </HStack>
                  </FormControl>
                  
                  <FormControl isRequired>
                    <FormLabel>Your Review</FormLabel>
                    <Textarea 
                      placeholder="Share details about your experience with this seller..." 
                      rows={5}
                    />
                  </FormControl>
                  
                  <Button 
                    colorScheme="brand" 
                    leftIcon={<Icon as={FiSend} />}
                    alignSelf="flex-end"
                  >
                    Submit Review
                  </Button>
                </VStack>
              </ModalBody>
            </ModalContent>
          </Modal>
        </VStack>
      </Container>
    </Box>
  )
}

export default UserProfile


