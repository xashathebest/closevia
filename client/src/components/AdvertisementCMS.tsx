import React, { useCallback, useState, useEffect, useRef } from 'react'
import {
  Box, Flex, VStack, HStack, Text, Heading, Button, IconButton,
  Table, Thead, Tbody, Tr, Th, Td, Tag, Switch, Modal, ModalOverlay,
  ModalContent, ModalHeader, ModalCloseButton, ModalBody, ModalFooter,
  FormControl, FormLabel, Input, Textarea, Select, useDisclosure,
  useToast, Center, Spinner, Icon, Image, Badge
} from '@chakra-ui/react'
import { FiMonitor, FiPlus, FiEdit2, FiTrash2, FiRefreshCw, FiImage, FiVideo } from 'react-icons/fi'
import { api } from '../services/api'
import { getImageUrl } from '../utils/imageUtils'

interface Advertisement {
  id: number
  title: string
  description: string
  media_url: string
  media_type: 'image' | 'video'
  link_url: string
  cta_text: string
  is_active: boolean
  priority: number
  start_date: string | null
  end_date: string | null
  views: number
  clicks: number
}

const AdvertisementCMS = () => {
  const [ads, setAds] = useState<Advertisement[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const { isOpen, onOpen, onClose } = useDisclosure()
  const [editingAd, setEditingAd] = useState<Partial<Advertisement> | null>(null)
  const [mediaFile, setMediaFile] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const toast = useToast()

  const fetchAds = useCallback(async () => {
    setLoading(true)
    try {
      const response = await api.get('/api/admin/advertisements')
      if (response.data?.success) {
        setAds(response.data.data || [])
      }
    } catch (err) {
      toast({ title: 'Failed to fetch ads', status: 'error' })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    fetchAds()
  }, [fetchAds])

  const handleToggleActive = async (ad: Advertisement) => {
    try {
      const formData = new FormData()
      formData.append('title', ad.title)
      formData.append('is_active', (!ad.is_active).toString())
      await api.put(`/api/admin/advertisements/${ad.id}`, formData)
      toast({ title: 'Status updated', status: 'success' })
      await fetchAds()
    } catch (err) {
      toast({ title: 'Failed to update status', status: 'error' })
    }
  }

  const handleDelete = async (id: number) => {
    if (!window.confirm('Are you sure you want to delete this ad?')) return
    try {
      await api.delete(`/api/admin/advertisements/${id}`)
      toast({ title: 'Ad deleted', status: 'success' })
      await fetchAds()
    } catch (err) {
      toast({ title: 'Failed to delete ad', status: 'error' })
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)

    try {
      const formData = new FormData()
      if (editingAd?.title) formData.append('title', editingAd.title)
      if (editingAd?.description) formData.append('description', editingAd.description)
      if (editingAd?.link_url) formData.append('link_url', editingAd.link_url)
      if (editingAd?.cta_text) formData.append('cta_text', editingAd.cta_text)
      if (editingAd?.priority !== undefined) formData.append('priority', editingAd.priority.toString())
      formData.append('is_active', (editingAd?.is_active ?? true).toString())

      if (editingAd?.start_date) formData.append('start_date', editingAd.start_date)
      if (editingAd?.end_date) formData.append('end_date', editingAd.end_date)

      if (!editingAd?.id && !mediaFile) {
        toast({ title: 'Media file is required for new ads', status: 'error' })
        setSubmitting(false)
        return
      }
      if (mediaFile) {
        formData.append('media', mediaFile)
      }

      if (editingAd?.id) {
        await api.put(`/api/admin/advertisements/${editingAd.id}`, formData)
        toast({ title: 'Ad updated', status: 'success' })
      } else {
        await api.post('/api/admin/advertisements', formData)
        toast({ title: 'Ad created', status: 'success' })
      }
      await fetchAds()
      setMediaFile(null)
      onClose()
    } catch (err: any) {
      toast({ title: 'Submission failed', description: err?.response?.data?.error || err.message, status: 'error' })
    } finally {
      setSubmitting(false)
    }
  }

  const openModal = (ad?: Advertisement) => {
    if (ad) {
      setEditingAd({ ...ad })
    } else {
      setEditingAd({ is_active: true, priority: 0 })
    }
    setMediaFile(null)
    onOpen()
  }

  return (
    <Box bg="white" p={{ base: 4, md: 5 }} rounded="xl" shadow="sm" border="1px solid" borderColor="gray.200" w="full">
      <Flex justify="space-between" align={{ base: 'stretch', md: 'center' }} gap={3} mb={4} direction={{ base: 'column', md: 'row' }}>
        <HStack align="start">
          <Box w={9} h={9} borderRadius="lg" bg="brand.50" display="flex" alignItems="center" justifyContent="center" flexShrink={0}>
            <Icon as={FiMonitor} color="brand.500" boxSize={5} />
          </Box>
          <Box>
            <Heading size="sm" color="gray.800">Homepage Advertisements</Heading>
            <Text fontSize="xs" color="gray.500">Manage carousel media, priority, visibility, and campaign links.</Text>
          </Box>
        </HStack>
        <HStack justify={{ base: 'stretch', md: 'flex-end' }}>
          <Button size="sm" colorScheme="brand" leftIcon={<FiPlus />} onClick={() => openModal()} flex={{ base: 1, md: 'initial' }}>
            New Ad
          </Button>
          <Button size="sm" variant="outline" leftIcon={<FiRefreshCw />} onClick={fetchAds} isLoading={loading} flex={{ base: 1, md: 'initial' }}>
            Refresh
          </Button>
        </HStack>
      </Flex>

      {loading ? (
        <Center py={10}><Spinner color="brand.500" /></Center>
      ) : ads.length === 0 ? (
        <Center py={10} flexDir="column">
          <Icon as={FiMonitor} boxSize={10} color="gray.300" mb={3} />
          <Text color="gray.500">No advertisements found</Text>
        </Center>
      ) : (
        <Box overflowX="auto" borderWidth="1px" borderColor="gray.100" borderRadius="lg">
          <Table variant="simple" size="sm" minW="720px">
            <Thead bg="gray.50">
              <Tr>
                <Th>Media</Th>
                <Th>Title</Th>
                <Th>Metrics</Th>
                <Th>Priority</Th>
                <Th>Status</Th>
                <Th>Actions</Th>
              </Tr>
            </Thead>
            <Tbody>
              {ads.map(ad => (
                <Tr key={ad.id} _hover={{ bg: 'gray.50' }}>
                  <Td>
                    <Box h="40px" w="70px" bg="gray.100" rounded="md" overflow="hidden" position="relative">
                      {ad.media_type === 'video' ? (
                        <Box as="video" src={getImageUrl(ad.media_url)} h="full" w="full" objectFit="cover" muted />
                      ) : (
                        <Image src={getImageUrl(ad.media_url)} h="full" w="full" objectFit="cover" />
                      )}
                      <Icon as={ad.media_type === 'video' ? FiVideo : FiImage} position="absolute" bottom={1} right={1} color="white" dropShadow="lg" boxSize={3} />
                    </Box>
                  </Td>
                  <Td>
                    <Text fontWeight="bold" fontSize="sm" noOfLines={1} maxW="200px">{ad.title}</Text>
                    <Text fontSize="xs" color="gray.500" noOfLines={1} maxW="200px">{ad.link_url || 'No link'}</Text>
                  </Td>
                  <Td>
                    <VStack align="start" spacing={0}>
                      <Badge colorScheme="blue" fontSize="2xs" borderRadius="full">Views: {ad.views}</Badge>
                      <Badge colorScheme="green" fontSize="2xs" borderRadius="full">Clicks: {ad.clicks}</Badge>
                    </VStack>
                  </Td>
                  <Td><Tag size="sm" colorScheme="purple">{ad.priority}</Tag></Td>
                  <Td>
                    <HStack spacing={2}>
                      <Switch colorScheme="green" size="sm" isChecked={ad.is_active} onChange={() => handleToggleActive(ad)} />
                      <Badge colorScheme={ad.is_active ? 'green' : 'gray'} variant="subtle" textTransform="none">{ad.is_active ? 'Active' : 'Hidden'}</Badge>
                    </HStack>
                  </Td>
                  <Td>
                    <HStack spacing={2}>
                      <IconButton aria-label="Edit" icon={<FiEdit2 />} size="xs" colorScheme="blue" variant="ghost" onClick={() => openModal(ad)} />
                      <IconButton aria-label="Delete" icon={<FiTrash2 />} size="xs" colorScheme="red" variant="ghost" onClick={() => handleDelete(ad.id)} />
                    </HStack>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        </Box>
      )}

      {/* Create/Edit Modal */}
      <Modal isOpen={isOpen} onClose={onClose} size="lg" scrollBehavior="inside" closeOnOverlayClick={false}>
        <ModalOverlay />
        <ModalContent borderRadius="xl">
          <form
            onSubmit={handleSubmit}
            onKeyDown={(e) => {
              const tag = (e.target as HTMLElement).tagName
              if (e.key === 'Enter' && tag !== 'BUTTON' && tag !== 'TEXTAREA') {
                e.preventDefault()
              }
            }}
          >
            <ModalHeader>{editingAd?.id ? 'Edit Advertisement' : 'Create Advertisement'}</ModalHeader>
            <ModalCloseButton />
            <ModalBody>
              <VStack spacing={4}>
                <FormControl isRequired>
                  <FormLabel>Title</FormLabel>
                  <Input value={editingAd?.title || ''} onChange={(e) => setEditingAd({ ...editingAd, title: e.target.value })} placeholder="Holiday Sale!" />
                </FormControl>

                <FormControl>
                  <FormLabel>Description (Optional)</FormLabel>
                  <Textarea value={editingAd?.description || ''} onChange={(e) => setEditingAd({ ...editingAd, description: e.target.value })} placeholder="Get 50% off on premium items..." rows={2} />
                </FormControl>

                <Flex w="full" gap={4} direction={{ base: 'column', md: 'row' }}>
                  <FormControl>
                    <FormLabel>CTA Button Text</FormLabel>
                    <Input value={editingAd?.cta_text || ''} onChange={(e) => setEditingAd({ ...editingAd, cta_text: e.target.value })} placeholder="Shop Now" />
                  </FormControl>
                  <FormControl>
                    <FormLabel>Target Link / Redirect URL</FormLabel>
                    <Input value={editingAd?.link_url || ''} onChange={(e) => setEditingAd({ ...editingAd, link_url: e.target.value })} placeholder="https://..." />
                  </FormControl>
                </Flex>

                <FormControl isRequired={!editingAd?.id}>
                  <FormLabel>Media (Image/Video)</FormLabel>
                  <Input type="file" ref={fileInputRef} p={1} accept="image/*,video/mp4,video/webm" onChange={(e) => setMediaFile(e.target.files?.[0] || null)} />
                  {editingAd?.media_url && !mediaFile && (
                    <Text fontSize="xs" color="gray.500" mt={1}>Current media: {editingAd.media_url.split('/').pop()}</Text>
                  )}
                  <Text fontSize="xs" color="orange.500" mt={1}>For best results, use 16:9 aspect ratio media under 10MB.</Text>
                </FormControl>

                <Flex w="full" gap={4} direction={{ base: 'column', md: 'row' }}>
                  <FormControl>
                    <FormLabel>Priority (Higher = first)</FormLabel>
                    <Input type="number" value={editingAd?.priority || 0} onChange={(e) => setEditingAd({ ...editingAd, priority: parseInt(e.target.value) || 0 })} />
                  </FormControl>
                  <FormControl>
                    <FormLabel>Status</FormLabel>
                    <HStack mt={2}>
                      <Switch isChecked={editingAd?.is_active} onChange={(e) => setEditingAd({ ...editingAd, is_active: e.target.checked })} />
                      <Text fontSize="sm">{editingAd?.is_active ? 'Active' : 'Hidden'}</Text>
                    </HStack>
                  </FormControl>
                </Flex>

                <Flex w="full" gap={4} direction={{ base: 'column', md: 'row' }}>
                  <FormControl>
                    <FormLabel>Start Date (Optional)</FormLabel>
                    <Input type="datetime-local" value={editingAd?.start_date?.slice(0, 16) || ''} onChange={(e) => setEditingAd({ ...editingAd, start_date: e.target.value })} />
                  </FormControl>
                  <FormControl>
                    <FormLabel>End Date (Optional)</FormLabel>
                    <Input type="datetime-local" value={editingAd?.end_date?.slice(0, 16) || ''} onChange={(e) => setEditingAd({ ...editingAd, end_date: e.target.value })} />
                  </FormControl>
                </Flex>
              </VStack>
            </ModalBody>
            <ModalFooter>
              <Button variant="ghost" mr={3} onClick={onClose}>Cancel</Button>
              <Button colorScheme="brand" type="submit" isLoading={submitting}>Save Advertisement</Button>
            </ModalFooter>
          </form>
        </ModalContent>
      </Modal>
    </Box>
  )
}

export default AdvertisementCMS
