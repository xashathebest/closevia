import React, { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Avatar,
  Badge,
  Box,
  Button,
  Container,
  Divider,
  Heading,
  HStack,
  Image,
  Input,
  Link,
  Skeleton,
  Spinner,
  Text,
  Textarea,
  useToast,
  VStack,
  IconButton,
  Select,
} from '@chakra-ui/react'
import { Link as RouterLink, useParams } from 'react-router-dom'
import { AddIcon, DeleteIcon } from '@chakra-ui/icons'
import { api } from '../services/api'
import { useAuth } from '../contexts/AuthContext'
import { getImageUrl } from '../utils/imageUtils'
import { User } from '../types'
import FloatingTab from '../components/FloatingTab'

const OrganizationProfile: React.FC = () => {
  const { user } = useAuth()
  const toast = useToast()
  const { handle } = useParams<{ handle: string }>()
  const [org, setOrg] = useState<User | null>(null)
  const [communityOrg, setCommunityOrg] = useState<any | null>(null)
  const [feedPosts, setFeedPosts] = useState<any[]>([])
  const [tradeFeed, setTradeFeed] = useState<any[]>([])
  const [joinRequests, setJoinRequests] = useState<any[]>([])
  const [members, setMembers] = useState<any[]>([])
  const [joinLoading, setJoinLoading] = useState(false)
  const [postContent, setPostContent] = useState('')
  const [postCategoryTag, setPostCategoryTag] = useState('')
  const [postType, setPostType] = useState<'regular' | 'looking_for'>('regular')
  const [postImages, setPostImages] = useState<File[]>([])
  const [imagePreviewUrls, setImagePreviewUrls] = useState<string[]>([])
  const [posting, setPosting] = useState(false)
  const [postComments, setPostComments] = useState<{ [postId: number]: any[] }>({})
  const [commentText, setCommentText] = useState<{ [postId: number]: string }>({})
  const [adminLoading, setAdminLoading] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [tradeFeedProducts, setTradeFeedProducts] = useState<any[]>([])
  const [tradeFeedLoading, setTradeFeedLoading] = useState(false)
  const [transferTarget, setTransferTarget] = useState<number | null>(null)
  const [transferConfirm, setTransferConfirm] = useState(false)
  const [transferLoading, setTransferLoading] = useState(false)

  const fetchOrganization = useCallback(async () => {
    if (!handle) return
    setLoading(true)
    setError('')
    try {
      const communityRes = await api.get(`/api/organizations/${handle}`)
      if (communityRes.data?.success && communityRes.data?.data) {
        setCommunityOrg(communityRes.data.data)
        setOrg(null)
      }
    } catch {
      try {
        const res = await api.get(`/api/users/organizations/${handle}`)
        setOrg((res.data?.data || null) as User | null)
        setCommunityOrg(null)
      } catch (err: any) {
        setError(err?.response?.data?.error || 'Failed to load organization profile')
      }
    } finally {
      setLoading(false)
    }
  }, [handle])

  const fetchFeed = useCallback(async () => {
    if (!handle || !communityOrg || communityOrg.membership_status !== 'approved') return
    try {
      const res = await api.get(`/api/organizations/${handle}/feed`)
      setFeedPosts(Array.isArray(res.data?.data) ? res.data.data : [])
    } catch {
      setFeedPosts([])
    }
  }, [handle, communityOrg])

  const fetchTradeFeed = useCallback(async () => {
    if (!handle || !communityOrg) return
    const ms = communityOrg?.membership_status
    const canView = ms === 'approved' || (user && Number(user.id) === Number(communityOrg.creator_user_id))
    if (!canView) return
    setTradeFeedLoading(true)
    try {
      const res = await api.get(`/api/organizations/${handle}/trade-feed`)
      const data = Array.isArray(res.data?.data) ? res.data.data : []
      setTradeFeed(data)
      setTradeFeedProducts(data)
    } catch {
      setTradeFeed([])
      setTradeFeedProducts([])
    } finally {
      setTradeFeedLoading(false)
    }
  }, [handle, communityOrg, user])

  const fetchAdminData = useCallback(async () => {
    if (!handle || !communityOrg || !user || communityOrg.creator_user_id !== user.id) return
    setAdminLoading(true)
    try {
      const [requestsRes, membersRes] = await Promise.all([
        api.get(`/api/organizations/${handle}/join-requests`),
        api.get(`/api/organizations/${handle}/members`),
      ])
      setJoinRequests(Array.isArray(requestsRes.data?.data) ? requestsRes.data.data : [])
      setMembers(Array.isArray(membersRes.data?.data) ? membersRes.data.data : [])
    } catch {
      setJoinRequests([])
      setMembers([])
    } finally {
      setAdminLoading(false)
    }
  }, [handle, communityOrg, user])

  useEffect(() => {
    fetchOrganization()
  }, [fetchOrganization])

  useEffect(() => {
    if (!communityOrg) return
    setPostCategoryTag(communityOrg.category || '')
    fetchFeed()
    fetchTradeFeed()
    fetchAdminData()
  }, [communityOrg, fetchFeed, fetchTradeFeed, fetchAdminData])

  const isCreator = useMemo(() => Boolean(user && communityOrg && Number(user.id) === Number(communityOrg.creator_user_id)), [user, communityOrg])
  const membershipStatus = communityOrg?.membership_status || 'none'

  const handleJoinRequest = async () => {
    if (!handle || !user) return
    setJoinLoading(true)
    try {
      await api.post(`/api/organizations/${handle}/join-request`)
      toast({ title: 'Join request sent', status: 'success' })
      await fetchOrganization()
    } catch (err: any) {
      toast({ title: 'Failed to send request', description: err?.response?.data?.error || 'Please try again', status: 'error' })
    } finally {
      setJoinLoading(false)
    }
  }

  const handleDecide = async (targetUserId: number, action: 'approve' | 'reject') => {
    if (!handle) return
    try {
      await api.post(`/api/organizations/${handle}/join-requests/${targetUserId}`, { action })
      toast({ title: `Request ${action}d`, status: 'success' })
      fetchAdminData()
      fetchOrganization()
    } catch (err: any) {
      toast({ title: 'Action failed', description: err?.response?.data?.error || 'Please try again', status: 'error' })
    }
  }

  const handleRemoveMember = async (targetUserId: number) => {
    if (!handle) return
    try {
      await api.post(`/api/organizations/${handle}/members/${targetUserId}/remove`)
      toast({ title: 'Member removed', status: 'success' })
      fetchAdminData()
      fetchFeed()
    } catch (err: any) {
      toast({ title: 'Failed to remove member', description: err?.response?.data?.error || 'Please try again', status: 'error' })
    }
  }

  const handleTransferOwnership = async () => {
    if (!handle || !transferTarget) return
    setTransferLoading(true)
    try {
      await api.post(`/api/organizations/${handle}/transfer-ownership`, { new_owner_user_id: transferTarget })
      toast({ title: 'Ownership transferred', description: 'You are no longer the owner of this organization.', status: 'success' })
      setTransferTarget(null)
      setTransferConfirm(false)
      fetchOrganization()
    } catch (err: any) {
      toast({ title: 'Transfer failed', description: err?.response?.data?.error || 'Please try again', status: 'error' })
    } finally {
      setTransferLoading(false)
    }
  }

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    const validFiles = files.filter(f => f.type.startsWith('image/'))
    setPostImages(prev => [...prev, ...validFiles])
    
    // Create preview URLs
    validFiles.forEach(file => {
      const reader = new FileReader()
      reader.onloadend = () => {
        setImagePreviewUrls(prev => [...prev, reader.result as string])
      }
      reader.readAsDataURL(file)
    })
    
    // Reset input value so same files can be selected again
    e.target.value = ''
  }

  const removeImage = (index: number) => {
    setPostImages(prev => prev.filter((_, i) => i !== index))
    setImagePreviewUrls(prev => prev.filter((_, i) => i !== index))
  }

  const handleAddComment = async (postId: number) => {
    if (!handle || !commentText[postId]?.trim()) return
    try {
      await api.post(`/api/organizations/${handle}/posts/${postId}/comments`, {
        content: commentText[postId].trim()
      })
      setCommentText(prev => ({ ...prev, [postId]: '' }))
      fetchFeed()
      toast({ title: 'Comment added', status: 'success' })
    } catch (err: any) {
      toast({ title: 'Failed to add comment', description: err?.response?.data?.error, status: 'error' })
    }
  }

  const handleCreatePost = async () => {
    // Allow posting if there's content OR images
    if (!handle || (!postContent.trim() && postImages.length === 0)) {
      toast({ title: 'Please add content or images', status: 'warning' })
      return
    }
    
    setPosting(true)
    try {
      const formData = new FormData()
      formData.append('content', postContent.trim())
      formData.append('category_tag', postCategoryTag || communityOrg?.category || '')
      formData.append('is_looking_for', postType === 'looking_for' ? 'true' : 'false')
      
      // Append images
      if (postImages.length > 0) {
        postImages.forEach(file => {
          formData.append('images', file)
        })
      }

      // Do NOT manually set Content-Type — axios sets it with the correct multipart boundary
      const res = await api.post(`/api/organizations/${handle}/posts`, formData)
      
      if (res.data?.success) {
        setPostContent('')
        setPostType('regular')
        setPostImages([])
        setImagePreviewUrls([])
        setPostCategoryTag('')
        toast({ title: 'Post published successfully!', status: 'success' })
        fetchFeed()
      } else {
        toast({ title: 'Failed to publish post', description: res.data?.error || 'Unknown error', status: 'error' })
      }
    } catch (err: any) {
      console.error('Post creation error:', err)
      const errorMsg = err?.response?.data?.error || err?.message || 'Please try again'
      toast({ title: 'Failed to publish post', description: errorMsg, status: 'error' })
    } finally {
      setPosting(false)
    }
  }

  if (loading) {
    return (
      <Container maxW="5xl" py={{ base: 6, md: 10 }}>
        <Box bg="white" borderWidth="1px" borderColor="gray.200" borderRadius="2xl" overflow="hidden">
          <Skeleton h={{ base: '150px', md: '220px' }} />

          <Box px={{ base: 4, md: 8 }} pb={{ base: 6, md: 8 }} mt="-48px" position="relative">
            <Skeleton w={{ base: '86px', md: '110px' }} h={{ base: '86px', md: '110px' }} borderRadius="full" mb={4} />

            <VStack align="start" spacing={3}>
              <Skeleton h="30px" w="260px" />
              <Skeleton h="18px" w="160px" />
              <Skeleton h="18px" w="140px" />
              <Skeleton h="16px" w="100%" />
              <Skeleton h="16px" w="85%" />

              <HStack spacing={6} pt={2} flexWrap="wrap">
                <Skeleton h="14px" w="180px" />
                <Skeleton h="14px" w="220px" />
                <Skeleton h="14px" w="120px" />
              </HStack>

              <HStack pt={3} spacing={3}>
                <Skeleton h="40px" w="160px" borderRadius="md" />
                <Skeleton h="40px" w="170px" borderRadius="md" />
              </HStack>
            </VStack>
          </Box>
        </Box>
      </Container>
    )
  }

  if (error || (!org && !communityOrg)) {
    return (
      <Container maxW="4xl" py={10}>
        <Text color="red.500" mb={4}>{error || 'Organization not found'}</Text>
        <Button as={RouterLink} to="/home" variant="outline">Go Home</Button>
      </Container>
    )
  }

  return (
    <Box bg="#FFFDF1" minH="100vh" pb={{ base: '100px', md: 0 }}>
      <Container maxW={{ base: 'full', md: '5xl' }} px={{ base: 4, md: 6 }} py={{ base: 6, md: 10 }}>
        <VStack align="stretch" spacing={{ base: 4, md: 6 }}>
        <Box bg="white" borderWidth="0" borderRadius={{ base: '2xl', md: '3xl' }} overflow="hidden" shadow="lg" transition="all 0.3s">
          <Box h={{ base: '160px', md: '260px' }} bg="gray.100" position="relative">
            <Image src={getImageUrl((communityOrg?.cover_url || (org as any)?.org_cover_url || (org as any)?.background_image))} alt="Organization cover" w="full" h="full" objectFit="cover" />
            <Box position="absolute" bottom="0" left="0" right="0" h="50%" bgGradient="linear(to-t, rgba(0,0,0,0.4), transparent)" />
          </Box>

          <Box px={{ base: 4, md: 8 }} pb={{ base: 6, md: 8 }} pt={0} mt={{ base: '-50px', md: '-60px' }} position="relative">
            <Box w={{ base: '100px', md: '130px' }} h={{ base: '100px', md: '130px' }} borderRadius="2xl" overflow="hidden" shadow="xl" border="4px solid white" bg="white" mb={{ base: 4, md: 5 }}>
              <Image src={getImageUrl((communityOrg?.logo_url || org?.org_logo_url || org?.profile_picture))} alt={(communityOrg?.name || org?.org_name || org?.name || 'Organization')} w="full" h="full" objectFit="cover" />
            </Box>

            <VStack align="start" spacing={{ base: 3, md: 4 }} w="full" minW={0} overflow="hidden">
              <VStack align="start" spacing={1} w="full" minW={0}>
                <HStack spacing={2} wrap="wrap" w="full" align="flex-start">
                  <Heading
                    size={{ base: 'md', md: 'xl' }}
                    fontWeight="800"
                    color="gray.800"
                    letterSpacing="tight"
                    wordBreak="break-word"
                    overflowWrap="anywhere"
                    maxW="full"
                    flex={1}
                    minW={0}
                  >
                    {communityOrg?.name || org?.org_name || org?.name}
                  </Heading>
                  <Badge bg="brand.50" color="brand.600" px={3} py={1} borderRadius="full" fontSize="xs" fontWeight="800" textTransform="uppercase" letterSpacing="wider" flexShrink={0} whiteSpace="nowrap">{communityOrg?.category || (org as any)?.org_category || 'Community'}</Badge>
                </HStack>
                <Text
                  color="brand.500"
                  fontWeight="700"
                  fontSize={{ base: 'sm', md: 'md' }}
                  wordBreak="break-all"
                  overflowWrap="anywhere"
                  maxW="full"
                >
                  @{communityOrg?.slug || org?.org_handle || handle}
                </Text>
              </VStack>

              <Text
                color="gray.600"
                fontSize={{ base: 'sm', md: 'md' }}
                lineHeight="tall"
                fontWeight="500"
                wordBreak="break-word"
                overflowWrap="anywhere"
                noOfLines={6}
                maxW="full"
              >
                {communityOrg?.description || org?.bio || 'No description yet.'}
              </Text>

              <VStack spacing={3} w="full" align="stretch" pt={2}>
                {(communityOrg?.creator_user_id || org?.id) && !isCreator ? <Button as={RouterLink} to={`/users/${communityOrg?.creator_user_id || org?.id}`} variant="outline" size={{ base: 'sm', md: 'md' }} h="44px" borderRadius="xl" fontWeight="700" _hover={{ bg: 'gray.50' }} w="full" whiteSpace="normal" overflow="hidden" textOverflow="ellipsis">View Owner Profile</Button> : null}
                {!user ? <Button as={RouterLink} to="/login" bg="brand.500" color="white" h="44px" borderRadius="xl" fontWeight="800" shadow="sm" _hover={{ bg: 'brand.600', transform: 'translateY(-2px)', shadow: 'md' }} transition="all 0.2s" size={{ base: 'sm', md: 'md' }} w="full">Login to Join</Button> : null}
                {user && !isCreator && membershipStatus === 'none' ? <Button bg="brand.500" color="white" h="44px" borderRadius="xl" fontWeight="800" shadow="sm" _hover={{ bg: 'brand.600', transform: 'translateY(-2px)', shadow: 'md' }} transition="all 0.2s" size={{ base: 'sm', md: 'md' }} onClick={handleJoinRequest} isLoading={joinLoading} w="full">Request to Join</Button> : null}
                
                <HStack spacing={2} w="full" wrap="wrap" pt={1}>
                  {user && membershipStatus === 'pending' ? <Badge colorScheme="orange" px={3} py={1.5} borderRadius="full" fontWeight="700">Join request pending</Badge> : null}
                  {user && membershipStatus === 'approved' ? <Badge colorScheme="green" px={3} py={1.5} borderRadius="full" fontWeight="700">✔ Approved member</Badge> : null}
                  {isCreator ? <Badge colorScheme="purple" px={3} py={1.5} borderRadius="full" fontWeight="700">⭐ Creator Admin</Badge> : null}
                </HStack>
                {isCreator ? <Button as={RouterLink} to="/organizations/new" size={{ base: 'sm', md: 'md' }} bg="brand.50" color="brand.600" variant="solid" borderRadius="xl" fontWeight="700" _hover={{ bg: 'brand.100' }} w={{ base: 'full', md: 'auto' }} px={6} alignSelf="flex-start">Create Another Organization</Button> : null}
              </VStack>
            </VStack>
          </Box>
        </Box>

        {communityOrg ? (
          <Box bg="white" borderWidth="0" borderRadius={{ base: '2xl', md: '3xl' }} p={{ base: 5, md: 8 }} shadow="md">
            <Heading size={{ base: 'md', md: 'lg' }} mb={{ base: 4, md: 6 }} color="gray.800" fontWeight="800" letterSpacing="tight">Organization Feed</Heading>
            {(membershipStatus === 'approved' || isCreator) ? (
              <VStack align="stretch" spacing={{ base: 4, md: 6 }}>
                {/* Trade feed: tagged products */}
                <Box borderWidth="0" borderRadius="2xl" p={{ base: 4, md: 6 }} bg="brand.50" shadow="sm">
                  <Text fontSize={{ base: 'sm', md: 'md' }} fontWeight="800" color="brand.800" mb={3} letterSpacing="tight">🏷️ Tagged Trade Posts</Text>
                  {tradeFeed.length === 0 ? (
                    <Text color="brand.600" fontSize={{ base: 'xs', md: 'sm' }} fontWeight="500">No tagged products yet.</Text>
                  ) : (
                    <VStack align="stretch" spacing={3}>
                      {tradeFeed.map((g: any) => (
                        <Box key={g.product_id} borderWidth="0" borderRadius="xl" bg="white" p={4} shadow="sm">
                          <HStack justify="space-between" spacing={3} wrap="wrap">
                            <VStack align="start" spacing={1} minW={0} flex={1}>
                              <Text fontSize={{ base: 'sm', md: 'md' }} fontWeight="800" color="gray.800" noOfLines={1}>{g.title || 'Untitled Product'}</Text>
                              <Text fontSize={{ base: 'xs', md: 'sm' }} color="gray.500" fontWeight="500" noOfLines={2}>{g.description || ''}</Text>
                              {g.category ? <Badge mt={1} bg="brand.50" color="brand.600" borderRadius="md" px={2} fontSize={{ base: '9px', md: 'xs' }}>{g.category}</Badge> : null}
                            </VStack>
                            <HStack spacing={3}>
                              {Array.isArray(g.members) && g.members.length > 0 ? (
                                <Avatar size="sm" src={g.members[0]?.profile_picture ? getImageUrl(g.members[0].profile_picture) : undefined} name={g.members[0]?.name || 'Member'} border="2px solid white" shadow="sm" />
                              ) : null}
                              <Button as={RouterLink} to={`/products/${g.product_id}`} size="sm" h="36px" borderRadius="xl" fontWeight="700" variant="outline" _hover={{ bg: 'gray.50', transform: 'translateY(-1px)', shadow: 'sm' }} transition="all 0.2s">View Item</Button>
                            </HStack>
                          </HStack>
                        </Box>
                      ))}
                    </VStack>
                  )}
                </Box>

                <Box borderWidth="0" borderRadius="2xl" p={{ base: 4, md: 6 }} bg="white" shadow="sm" border="1px solid" borderColor="gray.100">
                  <VStack align="stretch" spacing={{ base: 4, md: 5 }}>
                    <Text fontSize={{ base: 'sm', md: 'md' }} fontWeight="800" color="gray.800" letterSpacing="tight">✨ Create a Post</Text>

                    {/* Post Type Selection */}
                    <Select 
                      value={postType} 
                      onChange={(e) => setPostType(e.target.value as 'regular' | 'looking_for')} 
                      size="md"
                      borderRadius="xl"
                      bg="gray.50"
                      borderWidth="0"
                      fontWeight="600"
                      _focus={{ shadow: 'sm', bg: 'white' }}
                    >
                      <option value="regular">📝 Regular Post</option>
                      <option value="looking_for">🔍 Looking for Trade</option>
                    </Select>

                    {postType === 'looking_for' && (
                      <Box p={3} bg="brand.50" borderRadius="xl" borderWidth="0">
                        <Text fontSize={{ base: 'xs', md: 'sm' }} color="brand.700" fontWeight="600">💡 Share what items you're looking for in trades with other members</Text>
                      </Box>
                    )}

                    <Input 
                      value={postCategoryTag} 
                      onChange={(e) => setPostCategoryTag(e.target.value)} 
                      placeholder="Category tag (e.g., Cards, Electronics)" 
                      size="md" 
                      borderRadius="xl"
                      bg="gray.50"
                      borderWidth="0"
                      _focus={{ shadow: 'sm', bg: 'white' }}
                    />
                    <Textarea 
                      value={postContent} 
                      onChange={(e) => setPostContent(e.target.value)} 
                      placeholder={postType === 'looking_for' ? 'Describe what items or trades you\'re looking for...' : 'Share something relevant to this organization'} 
                      rows={3} 
                      size="md" 
                      borderRadius="xl"
                      bg="gray.50"
                      borderWidth="0"
                      _focus={{ shadow: 'sm', bg: 'white' }}
                      resize="none"
                    />

                    {/* Image Preview */}
                    {imagePreviewUrls.length > 0 && (
                      <Box>
                        <Text fontSize="xs" fontWeight="700" color="gray.500" textTransform="uppercase" mb={2}>Attached photos ({imagePreviewUrls.length})</Text>
                        <HStack spacing={3} wrap="wrap">
                          {imagePreviewUrls.map((url, idx) => (
                            <Box key={idx} position="relative" w={{ base: '80px', md: '100px' }} h={{ base: '80px', md: '100px' }} borderRadius="xl" overflow="hidden" shadow="sm">
                              <Image src={url} alt={`preview-${idx}`} w="full" h="full" objectFit="cover" />
                              <IconButton
                                aria-label="remove"
                                icon={<DeleteIcon />}
                                size="xs"
                                colorScheme="red"
                                position="absolute"
                                top={1}
                                right={1}
                                borderRadius="full"
                                onClick={() => removeImage(idx)}
                              />
                            </Box>
                          ))}
                        </HStack>
                      </Box>
                    )}

                    {/* File Input - Action Buttons — stack on narrow screens */}
                    <Box
                      display="flex"
                      flexDirection={{ base: 'column', sm: 'row' }}
                      gap={2}
                      pt={1}
                      w="full"
                      alignItems={{ base: 'stretch', sm: 'center' }}
                      justifyContent={{ sm: 'space-between' }}
                    >
                      <Box as="label" htmlFor="org-post-images" cursor="pointer" flexShrink={0}>
                        <Input
                          type="file"
                          multiple
                          accept="image/*"
                          onChange={handleImageSelect}
                          display="none"
                          id="org-post-images"
                        />
                        <Button
                          as="div"
                          size="md"
                          h="44px"
                          borderRadius="xl"
                          variant="ghost"
                          leftIcon={<AddIcon />}
                          cursor="pointer"
                          fontWeight="700"
                          color="gray.600"
                          _hover={{ bg: 'gray.100' }}
                          w={{ base: 'full', sm: 'auto' }}
                        >
                          {postImages.length > 0 ? `Photos (${postImages.length})` : 'Add Photos'}
                        </Button>
                      </Box>
                      <Button
                        bg="brand.500"
                        color="white"
                        size="md"
                        h="44px"
                        px={8}
                        borderRadius="xl"
                        fontWeight="800"
                        shadow="sm"
                        _hover={{ transform: 'translateY(-2px)', shadow: 'md', bg: 'brand.600' }}
                        transition="all 0.2s"
                        onClick={handleCreatePost}
                        isLoading={posting}
                        w={{ base: 'full', sm: 'auto' }}
                        loadingText="Publishing..."
                      >
                        Publish Post
                      </Button>
                    </Box>
                  </VStack>
                </Box>

                <Divider borderColor="gray.100" />

                {feedPosts.length === 0 ? <Text color="gray.500" fontSize={{ base: 'xs', md: 'sm' }} fontWeight="500">No posts yet.</Text> : null}
                {feedPosts.map((post) => (
                  <Box key={post.id} borderWidth="0" borderRadius="2xl" p={{ base: 4, md: 6 }} bg="white" transition="all 0.3s" shadow="sm" _hover={{ shadow: 'md', transform: 'translateY(-2px)' }} border="1px solid" borderColor="gray.50">
                    <VStack align="stretch" spacing={{ base: 3, md: 4 }}>
                      <HStack justify="space-between" spacing={2} wrap="wrap">
                        <HStack spacing={3} minW={0} flex={1}>
                          <Avatar size={{ base: 'sm', md: 'md' }} src={post.author_profile_picture ? getImageUrl(post.author_profile_picture) : undefined} name={post.author_name} shadow="sm" />
                          <VStack spacing={0} align="start" minW={0} flex={1}>
                            <Text fontSize={{ base: 'sm', md: 'md' }} fontWeight="800" color="gray.800" noOfLines={1} letterSpacing="tight">{post.author_name}</Text>
                            <Badge bg="gray.100" color="gray.600" fontSize={{ base: '9px', md: 'xs' }} px={2} py={0.5} borderRadius="md" fontWeight="700" noOfLines={1}>{post.category_tag}</Badge>
                          </VStack>
                        </HStack>
                        {post.is_looking_for && <Badge bg="blue.50" color="blue.600" px={2} py={1} borderRadius="full" fontSize={{ base: '9px', md: 'xs' }} fontWeight="700">🔍 Looking</Badge>}
                      </HStack>
                      <Text fontSize={{ base: 'sm', md: 'md' }} color="gray.700" whiteSpace="pre-wrap" mb={post.images && post.images.length > 0 ? 2 : 0} lineHeight="tall">{post.content}</Text>

                      {/* Post Images */}
                      {post.images && post.images.length > 0 && (
                        <HStack spacing={2} wrap="wrap" mb={2}>
                          {post.images.map((img: any, idx: number) => (
                            <Image key={idx} src={getImageUrl(img)} alt={`post-${idx}`} w={{ base: '120px', md: '150px' }} h={{ base: '120px', md: '150px' }} objectFit="cover" borderRadius="xl" shadow="sm" />
                          ))}
                        </HStack>
                      )}

                      {/* Comments Section */}
                      <Box mt={3} pt={4} borderTopWidth="1px" borderColor="gray.100">
                        <Text fontSize={{ base: 'xs', md: 'sm' }} fontWeight="700" color="gray.500" textTransform="uppercase" mb={3}>Comments ({post.comments_count || 0})</Text>

                        {/* Comment Input */}
                        <HStack spacing={2} mb={4}>
                          <Input
                            size={{ base: 'sm', md: 'md' }}
                            placeholder="Add a comment..."
                            value={commentText[post.id] || ''}
                            onChange={(e) => setCommentText(prev => ({ ...prev, [post.id]: e.target.value }))}
                            fontSize={{ base: 'sm', md: 'md' }}
                            borderRadius="xl"
                            borderWidth="0"
                            bg="gray.50"
                            _focus={{ shadow: 'sm', bg: 'white' }}
                          />
                          <Button
                            size={{ base: 'sm', md: 'md' }}
                            bg="white"
                            color="brand.500"
                            borderWidth="1px"
                            borderColor="gray.200"
                            borderRadius="xl"
                            fontWeight="800"
                            onClick={() => handleAddComment(post.id)}
                            isDisabled={!commentText[post.id]?.trim()}
                            _hover={commentText[post.id]?.trim() ? { transform: 'translateY(-1px)', shadow: 'sm', borderColor: 'brand.200' } : undefined}
                            transition="all 0.2s"
                          >
                            Reply
                          </Button>
                        </HStack>

                        {/* Existing Comments */}
                        {postComments[post.id] && postComments[post.id].length > 0 && (
                          <VStack align="stretch" spacing={2}>
                            {postComments[post.id].map((comment: any) => (
                              <Box key={comment.id} p={3} bg="gray.50" borderRadius="xl">
                                <HStack spacing={2} mb={1} wrap="wrap">
                                  <Avatar size="xs" name={comment.author_name} shadow="sm" />
                                  <Text fontSize={{ base: 'xs', md: 'sm' }} fontWeight="700" color="gray.800" noOfLines={1}>{comment.author_name}</Text>
                                </HStack>
                                <Text fontSize={{ base: 'sm', md: 'sm' }} color="gray.600" pl={8} lineHeight="tall">{comment.content}</Text>
                              </Box>
                            ))}
                          </VStack>
                        )}
                      </Box>
                    </VStack>
                  </Box>
                ))}
              </VStack>
            ) : (
              <Box p={6} bg="gray.50" borderRadius="2xl" textAlign="center">
                <Text color="gray.600" fontWeight="600" fontSize={{ base: 'sm', md: 'md' }}>Only approved members can view and interact with this feed.</Text>
              </Box>
            )}
          </Box>
        ) : null}

        {communityOrg && isCreator ? (
          <Box bg="white" borderWidth="0" borderRadius={{ base: '2xl', md: '3xl' }} p={{ base: 5, md: 8 }} shadow="md">
            <Heading size={{ base: 'md', md: 'lg' }} mb={{ base: 4, md: 6 }} color="gray.800" fontWeight="800" letterSpacing="tight">📦 Trade Feed</Heading>
            {tradeFeedLoading ? (
              <Spinner size="sm" color="brand.500" />
            ) : tradeFeedProducts.length === 0 ? (
              <Text color="gray.500" fontSize={{ base: 'xs', md: 'sm' }} fontWeight="500">No products in trade feed yet.</Text>
            ) : (
              <Box display="grid" gridTemplateColumns={{ base: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(3, 1fr)' }} gap={{ base: 4, md: 6 }}>
                {tradeFeedProducts.map((product: any) => {
                  const imageUrls = typeof product.image_urls === 'string' ? 
                    (product.image_urls.startsWith('[') ? JSON.parse(product.image_urls) : [product.image_urls]) 
                    : product.image_urls || []
                  const firstImage = Array.isArray(imageUrls) ? imageUrls[0] : imageUrls
                  return (
                    <Box key={product.product_id} borderWidth="0" shadow="sm" borderRadius="2xl" overflow="hidden" transition="all 0.3s" _hover={{ transform: 'translateY(-2px)', shadow: 'xl' }} bg="white" border="1px solid" borderColor="gray.50">
                      <Link as={RouterLink} to={`/products/${product.product_id}`} _hover={{ textDecoration: 'none' }}>
                        <Box h="180px" bg="gray.50" overflow="hidden" cursor="pointer" position="relative">
                          {firstImage ? (
                            <Image src={getImageUrl(firstImage)} alt={product.title} w="full" h="full" objectFit="cover" />
                          ) : (
                            <Box w="full" h="full" display="flex" alignItems="center" justifyContent="center">
                              <Text fontSize="xs" color="gray.400" fontWeight="600">No Image</Text>
                            </Box>
                          )}
                        </Box>
                        <Box p={4}>
                          <Text fontSize={{ base: 'sm', md: 'md' }} fontWeight="800" color="gray.800" noOfLines={2} mb={1} letterSpacing="tight">{product.title}</Text>
                          <Text fontSize="xs" color="gray.500" fontWeight="600" noOfLines={1} mb={3} textTransform="uppercase" letterSpacing="wider">{product.category}</Text>
                          <HStack justify="space-between">
                            <Text fontSize={{ base: 'sm', md: 'md' }} fontWeight="800" color="brand.500">₱{product.price}</Text>
                            <Badge bg="brand.50" color="brand.600" px={2} py={0.5} borderRadius="md" fontSize="10px" fontWeight="700" textTransform="uppercase">{product.status}</Badge>
                          </HStack>
                        </Box>
                      </Link>
                    </Box>
                  )
                })}
              </Box>
            )}
          </Box>
        ) : null}

        {communityOrg && isCreator ? (
          <Box bg="white" borderWidth="0" borderRadius={{ base: '2xl', md: '3xl' }} p={{ base: 5, md: 8 }} shadow="md">
            <Heading size={{ base: 'md', md: 'lg' }} mb={{ base: 4, md: 6 }} color="gray.800" fontWeight="800" letterSpacing="tight">🔐 Admin Controls</Heading>
            {adminLoading ? <Spinner size="sm" color="brand.500" /> : (
              <VStack align="stretch" spacing={{ base: 4, md: 8 }}>
                {/* Desktop Grid Layout */}
                <Box display={{ base: 'none', md: 'grid' }} gridTemplateColumns="1fr 1fr" gap={8}>
                  {/* Pending Requests */}
                  <Box>
                    <Text fontSize="sm" fontWeight="800" mb={4} color="gray.500" textTransform="uppercase" letterSpacing="wider">Pending Join Requests ({joinRequests.length})</Text>
                    {joinRequests.length === 0 ? <Text fontSize="sm" color="gray.400" fontWeight="500">No pending requests.</Text> : null}
                    <VStack align="stretch" spacing={4}>
                      {joinRequests.map((request) => (
                        <Box key={request.user_id} borderWidth="0" shadow="sm" borderRadius="2xl" p={4} bg="gray.50" transition="all 0.2s" _hover={{ transform: 'translateY(-2px)', shadow: 'md' }}>
                          <HStack justify="space-between" spacing={3} mb={4} wrap="wrap">
                            <HStack spacing={3} minW={0} flex={1}>
                              <Avatar size="md" src={request.profile_picture ? getImageUrl(request.profile_picture) : undefined} name={request.name} shadow="sm" />
                              <VStack align="start" spacing={0} minW={0} flex={1}>
                                <Text fontSize="sm" fontWeight="800" color="gray.800" noOfLines={1}>{request.name}</Text>
                                <Text fontSize="xs" fontWeight="600" color="gray.500" noOfLines={1}>Requested {new Date(request.requested_at).toLocaleDateString()}</Text>
                              </VStack>
                            </HStack>
                          </HStack>
                          <HStack spacing={3} w="full">
                            <Button flex={1} borderRadius="xl" fontWeight="800" size="sm" h="36px" bg="green.500" color="white" _hover={{ bg: 'green.600', transform: 'translateY(-1px)', shadow: 'sm' }} transition="all 0.2s" onClick={() => handleDecide(request.user_id, 'approve')}>Approve</Button>
                            <Button flex={1} borderRadius="xl" fontWeight="800" size="sm" h="36px" bg="white" color="red.500" borderWidth="1px" borderColor="red.100" _hover={{ bg: 'red.50', borderColor: 'red.200' }} onClick={() => handleDecide(request.user_id, 'reject')}>Reject</Button>
                          </HStack>
                        </Box>
                      ))}
                    </VStack>
                  </Box>

                  {/* Members List */}
                  <Box>
                    <Text fontSize="sm" fontWeight="800" mb={4} color="gray.500" textTransform="uppercase" letterSpacing="wider">Members ({members.length})</Text>
                    <VStack align="stretch" spacing={3}>
                      {members.map((member) => (
                        <HStack key={member.user_id} justify="space-between" spacing={3} shadow="sm" borderRadius="2xl" p={3} bg="white" border="1px solid" borderColor="gray.50" transition="all 0.2s" _hover={{ shadow: 'md' }} wrap="wrap">
                          <HStack spacing={3} minW={0} flex={1}>
                            <Avatar size="sm" src={member.profile_picture ? getImageUrl(member.profile_picture) : undefined} name={member.name} />
                            <Text fontSize="sm" fontWeight="800" color="gray.800" noOfLines={1}>{member.name}</Text>
                          </HStack>
                          {member.user_id !== user?.id ? <Button size="sm" h="32px" borderRadius="xl" fontWeight="700" bg="white" color="red.500" borderWidth="1px" borderColor="gray.200" _hover={{ bg: 'red.50', borderColor: 'red.200' }} onClick={() => handleRemoveMember(member.user_id)}>Remove</Button> : <Badge bg="purple.50" color="purple.600" px={2} py={1} borderRadius="md" fontWeight="800">YOU</Badge>}
                        </HStack>
                      ))}
                    </VStack>
                  </Box>
                </Box>

                {/* Transfer Ownership — desktop */}
                <Box borderTopWidth="1px" borderColor="red.100" pt={6}>
                  <Text fontSize="sm" fontWeight="800" mb={1} color="red.500" textTransform="uppercase" letterSpacing="wider">Transfer Ownership</Text>
                  <Text fontSize="xs" color="gray.500" mb={4}>Hand control to an approved member. You will lose owner privileges immediately.</Text>
                  {members.filter(m => m.user_id !== user?.id).length === 0 ? (
                    <Text fontSize="xs" color="gray.400" fontWeight="500">No other members to transfer to.</Text>
                  ) : (
                    <VStack align="stretch" spacing={3} maxW="360px">
                      <Select placeholder="Select new owner…" value={transferTarget ?? ''} onChange={e => { setTransferTarget(Number(e.target.value) || null); setTransferConfirm(false) }} borderRadius="xl" size="sm" borderColor="red.200" _focus={{ borderColor: 'red.400' }}>
                        {members.filter(m => m.user_id !== user?.id).map(m => (
                          <option key={m.user_id} value={m.user_id}>{m.name}</option>
                        ))}
                      </Select>
                      {transferTarget && !transferConfirm && (
                        <Button size="sm" h="36px" borderRadius="xl" fontWeight="800" bg="red.50" color="red.600" borderWidth="1px" borderColor="red.200" _hover={{ bg: 'red.100' }} onClick={() => setTransferConfirm(true)}>Transfer Ownership</Button>
                      )}
                      {transferTarget && transferConfirm && (
                        <Box bg="red.50" borderRadius="xl" p={4} borderWidth="1px" borderColor="red.200">
                          <Text fontSize="xs" fontWeight="700" color="red.700" mb={3}>Are you sure? You will lose all owner privileges for "{communityOrg?.name}" immediately. This cannot be undone.</Text>
                          <HStack spacing={2}>
                            <Button flex={1} size="sm" h="36px" borderRadius="xl" fontWeight="800" bg="red.500" color="white" _hover={{ bg: 'red.600' }} isLoading={transferLoading} onClick={handleTransferOwnership}>Yes, Transfer</Button>
                            <Button flex={1} size="sm" h="36px" borderRadius="xl" fontWeight="700" bg="white" color="gray.600" borderWidth="1px" borderColor="gray.200" onClick={() => { setTransferConfirm(false); setTransferTarget(null) }}>Cancel</Button>
                          </HStack>
                        </Box>
                      )}
                    </VStack>
                  )}
                </Box>

                {/* Mobile Stack Layout */}
                <VStack align="stretch" spacing={{ base: 5, md: 5 }} display={{ base: 'flex', md: 'none' }}>
                <Box>
                  <Text fontSize="xs" fontWeight="800" mb={3} color="gray.500" textTransform="uppercase" letterSpacing="wider">Pending Join Requests ({joinRequests.length})</Text>
                  {joinRequests.length === 0 ? <Text fontSize="xs" color="gray.400" fontWeight="500">No pending requests.</Text> : null}
                  <VStack align="stretch" spacing={3}>
                    {joinRequests.map((request) => (
                      <Box key={request.user_id} borderWidth="0" shadow="sm" borderRadius="2xl" p={4} bg="gray.50">
                        <HStack justify="space-between" spacing={2} mb={3} wrap="wrap">
                          <HStack spacing={3} minW={0} flex={1}>
                            <Avatar size="md" src={request.profile_picture ? getImageUrl(request.profile_picture) : undefined} name={request.name} />
                            <VStack align="start" spacing={0} minW={0} flex={1}>
                              <Text fontSize="sm" fontWeight="800" color="gray.800" noOfLines={1}>{request.name}</Text>
                              <Text fontSize="xs" fontWeight="600" color="gray.500" noOfLines={1}>Req: {new Date(request.requested_at).toLocaleDateString()}</Text>
                            </VStack>
                          </HStack>
                        </HStack>
                        <HStack spacing={2} w="full">
                          <Button flex={1} borderRadius="xl" fontWeight="800" size="sm" h="36px" bg="green.500" color="white" onClick={() => handleDecide(request.user_id, 'approve')}>Approve</Button>
                          <Button flex={1} borderRadius="xl" fontWeight="800" size="sm" h="36px" bg="white" color="red.500" borderWidth="1px" borderColor="gray.200" onClick={() => handleDecide(request.user_id, 'reject')}>Reject</Button>
                        </HStack>
                      </Box>
                    ))}
                  </VStack>
                </Box>

                <Divider borderColor="gray.100" />

                <Box>
                  <Text fontSize="xs" fontWeight="800" mb={3} color="gray.500" textTransform="uppercase" letterSpacing="wider">Members ({members.length})</Text>
                  <VStack align="stretch" spacing={2}>
                    {members.map((member) => (
                      <HStack key={member.user_id} justify="space-between" spacing={2} shadow="sm" borderRadius="xl" p={3} bg="white" border="1px solid" borderColor="gray.50" wrap="wrap">
                        <HStack spacing={3} minW={0} flex={1}>
                          <Avatar size="sm" src={member.profile_picture ? getImageUrl(member.profile_picture) : undefined} name={member.name} />
                          <Text fontSize="sm" fontWeight="800" color="gray.800" noOfLines={1}>{member.name}</Text>
                        </HStack>
                        {member.user_id !== user?.id ? <Button size="sm" h="32px" borderRadius="lg" fontWeight="800" bg="white" color="red.500" borderWidth="1px" borderColor="gray.200" onClick={() => handleRemoveMember(member.user_id)}>Remove</Button> : <Badge bg="purple.50" color="purple.600" px={2} py={0.5} borderRadius="md" fontWeight="800">YOU</Badge>}
                      </HStack>
                    ))}
                  </VStack>
                </Box>

                <Divider borderColor="red.100" />

                {/* Transfer Ownership — mobile */}
                <Box>
                  <Text fontSize="xs" fontWeight="800" mb={1} color="red.500" textTransform="uppercase" letterSpacing="wider">Transfer Ownership</Text>
                  <Text fontSize="xs" color="gray.500" mb={3}>Hand control to an approved member. You will lose owner privileges immediately.</Text>
                  {members.filter(m => m.user_id !== user?.id).length === 0 ? (
                    <Text fontSize="xs" color="gray.400" fontWeight="500">No other members to transfer to.</Text>
                  ) : (
                    <VStack align="stretch" spacing={3}>
                      <Select placeholder="Select new owner…" value={transferTarget ?? ''} onChange={e => { setTransferTarget(Number(e.target.value) || null); setTransferConfirm(false) }} borderRadius="xl" size="sm" borderColor="red.200" _focus={{ borderColor: 'red.400' }}>
                        {members.filter(m => m.user_id !== user?.id).map(m => (
                          <option key={m.user_id} value={m.user_id}>{m.name}</option>
                        ))}
                      </Select>
                      {transferTarget && !transferConfirm && (
                        <Button size="sm" h="36px" borderRadius="xl" fontWeight="800" bg="red.50" color="red.600" borderWidth="1px" borderColor="red.200" _hover={{ bg: 'red.100' }} onClick={() => setTransferConfirm(true)}>Transfer Ownership</Button>
                      )}
                      {transferTarget && transferConfirm && (
                        <Box bg="red.50" borderRadius="xl" p={4} borderWidth="1px" borderColor="red.200">
                          <Text fontSize="xs" fontWeight="700" color="red.700" mb={3}>Are you sure? You will lose all owner privileges for "{communityOrg?.name}" immediately. This cannot be undone.</Text>
                          <HStack spacing={2}>
                            <Button flex={1} size="sm" h="36px" borderRadius="xl" fontWeight="800" bg="red.500" color="white" _hover={{ bg: 'red.600' }} isLoading={transferLoading} onClick={handleTransferOwnership}>Yes, Transfer</Button>
                            <Button flex={1} size="sm" h="36px" borderRadius="xl" fontWeight="700" bg="white" color="gray.600" borderWidth="1px" borderColor="gray.200" onClick={() => { setTransferConfirm(false); setTransferTarget(null) }}>Cancel</Button>
                          </HStack>
                        </Box>
                      )}
                    </VStack>
                  )}
                </Box>
                </VStack>
              </VStack>
            )}
          </Box>
        ) : null}
        </VStack>
      </Container>

      {/* Mobile Bottom Navigation */}
      <FloatingTab />
    </Box>
  )
}

export default OrganizationProfile
