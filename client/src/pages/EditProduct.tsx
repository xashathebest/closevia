import React, { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import {
  Box,
  Container,
  VStack,
  HStack,
  Heading,
  FormControl,
  FormLabel,
  Input,
  Textarea,
  Button,
  Text,
  Alert,
  AlertIcon,
  Spinner,
  useToast,
  Select,
  Image as ChakraImage,
  Grid,
  FormHelperText,
  SimpleGrid,
  Badge,
  Wrap,
  WrapItem,
  Radio,
  IconButton,
} from '@chakra-ui/react'
import { AddIcon, CloseIcon } from '@chakra-ui/icons'
import { MapContainer, TileLayer, Marker, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { AvailabilitySlot, ProductUpdate } from '../types'
import { api } from '../services/api'
import { useCustomLocations } from '../hooks/useCustomLocations'
import { SavedLocationsUI } from '../components/SavedLocationsUI'
import { PRODUCT_CATEGORIES, normalizeWantedCategories } from '../utils/categories'
import { getBackupPriceEstimate } from '../utils/priceEstimator'

// Fix leaflet icon issues
// @ts-ignore
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
})

const MapUpdater = ({ lat, lng }: { lat: number; lng: number }) => {
  const map = useMap()
  useEffect(() => {
    map.setView([lat, lng], 16, { animate: true })
    map.invalidateSize()
  }, [lat, lng, map])
  return null
}

const MapClickHandler = ({ onLocationSelect }: { onLocationSelect: (lat: number, lng: number) => void }) => {
  const map = useMap()
  useEffect(() => {
    const handleClick = (e: any) => {
      const { lat, lng } = e.latlng
      onLocationSelect(lat, lng)
    }
    map.on('click', handleClick)
    return () => {
      map.off('click', handleClick)
    }
  }, [map, onLocationSelect])
  return null
}

const formatEstimatedValueRange = (min?: number, max?: number) => {
  if (!min || !max || min <= 0 || max <= 0) return null
  const formatter = new Intl.NumberFormat('en-PH', {
    style: 'currency',
    currency: 'PHP',
    maximumFractionDigits: 0,
  })
  return min === max ? formatter.format(min) : `${formatter.format(min)} - ${formatter.format(max)}`
}

const EditProduct: React.FC = () => {
  const { id } = useParams<{ id: string }>()
  const queryClient = useQueryClient()
  const [formData, setFormData] = useState<ProductUpdate>({})
  const [loading, setLoading] = useState(false)
  const [fetching, setFetching] = useState(true)
  const [error, setError] = useState('')
  const [originalProduct, setOriginalProduct] = useState<any>(null)
  const [imagePreviews, setImagePreviews] = useState<string[]>([])
  const [detectingLocation, setDetectingLocation] = useState(false)
  
  // Custom locations
  const { locations, addLocation, deleteLocation, updateLocation } = useCustomLocations()
  
  // Location search and map state
  const [pickupSearchQuery, setPickupSearchQuery] = useState('')
  const [pickupSearchResults, setPickupSearchResults] = useState<Array<{ name: string; address: string; lat: number; lng: number }>>([])
  const [isSearchingPickupLocation, setIsSearchingPickupLocation] = useState(false)
  const [showPickupSearchDropdown, setShowPickupSearchDropdown] = useState(false)
  const [showLocationMap, setShowLocationMap] = useState(false)
  const [locationSet, setLocationSet] = useState(false)
  const [locationTypeSelected, setLocationTypeSelected] = useState<'current_location' | 'pickup_location' | 'no_location'>('no_location')
  const [avNewDate, setAvNewDate] = useState('')
  const [avNewStart, setAvNewStart] = useState('')
  const [avNewEnd, setAvNewEnd] = useState('')

  const useCurrentLocation = () => {
    if (!navigator.geolocation) {
      toast({ title: 'Geolocation unavailable', status: 'warning', duration: 3000, isClosable: true })
      return
    }
    setDetectingLocation(true)
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&zoom=18&addressdetails=1&lat=${latitude}&lon=${longitude}`
          )
          const data = await res.json()
          const addr = data.address || {}
          const street = [addr.house_number, addr.road || addr.street].filter(Boolean).join(' ')
          const barangay = addr.hamlet || addr.village || addr.suburb || addr.neighborhood || addr.quarter || ''
          const city = addr.city || addr.town || addr.municipality || ''
          const parts = [street, barangay, city].filter(Boolean)
          const address = parts.join(', ') || `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`
          setFormData((prev) => ({ ...prev, location: address, latitude, longitude } as any))
          setLocationSet(true)
        } catch {
          setFormData((prev) => ({
            ...prev,
            location: `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`,
            latitude,
            longitude,
          } as any))
          setLocationSet(true)
        }
        setDetectingLocation(false)
      },
      () => {
        setDetectingLocation(false)
        toast({ title: 'Could not get location', status: 'error', duration: 3000, isClosable: true })
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
    )
  }

  // Search for pickup locations
  const searchPickupLocations = useCallback(async (query: string) => {
    if (!query.trim()) {
      setPickupSearchResults([])
      return
    }
    setIsSearchingPickupLocation(true)
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5`
      )
      const results = await response.json()
      const formatted = results.map((r: any) => ({
        name: r.name || r.display_name.split(',')[0],
        address: r.display_name,
        lat: parseFloat(r.lat),
        lng: parseFloat(r.lon),
      }))
      setPickupSearchResults(formatted)
      setShowPickupSearchDropdown(true)
    } catch (err) {
      console.error('Error searching locations:', err)
      setPickupSearchResults([])
    } finally {
      setIsSearchingPickupLocation(false)
    }
  }, [])

  // Handle location selection from search
  const selectLocation = useCallback((result: { name: string; address: string; lat: number; lng: number }) => {
    setFormData(prev => ({
      ...prev,
      latitude: result.lat,
      longitude: result.lng,
      location: result.address,
    } as any))
    setLocationSet(true)
    setPickupSearchQuery('')
    setPickupSearchResults([])
    setShowPickupSearchDropdown(false)
  }, [])

  const navigate = useNavigate()
  const toast = useToast()
  const pageBg = '#FFFDF1'

  useEffect(() => {
    if (id) {
      fetchProduct()
    }
  }, [id])

  const fetchProduct = async () => {
    try {
      setFetching(true)
      setError('')
      const response = await api.get(`/api/products/${id}`)
      const resData = response.data

      // Handle different API response structures
      let product: any = null
      if (resData?.data?.product) {
        product = resData.data.product
      } else if (resData?.data?.id) {
        product = resData.data
      } else if (resData?.id) {
        product = resData
      }

      if (!product) {
        setError('Product not found')
        return
      }

      setOriginalProduct(product)

      // Pre-fill form with current values
      let parsedWantedCats: string[] = []
      try {
        if (Array.isArray(product.wanted_categories)) {
          parsedWantedCats = product.wanted_categories
        } else if (typeof product.wanted_categories === 'string' && product.wanted_categories) {
          parsedWantedCats = JSON.parse(product.wanted_categories)
        }
      } catch { /* ignore parse errors */ }

      let parsedAvailabilitySlots: AvailabilitySlot[] = []
      try {
        if (Array.isArray(product.availability_slots)) {
          parsedAvailabilitySlots = product.availability_slots
        } else if (typeof product.availability_slots === 'string' && product.availability_slots) {
          parsedAvailabilitySlots = JSON.parse(product.availability_slots)
        }
      } catch { /* ignore parse errors */ }

      setFormData({
        title: product.title || '',
        description: product.description || '',
        price: product.price ?? 0,
        image_urls: product.image_urls || [],
        condition: product.condition || '',
        category: product.category || '',
        location: product.location || '',
        max_items_per_offer: product.max_items_per_offer ?? 0,
        wants: product.wants || '',
        wanted_categories: normalizeWantedCategories(parsedWantedCats),
        estimated_value_min: product.estimated_value_min,
        estimated_value_max: product.estimated_value_max,
        show_estimated_value: product.show_estimated_value !== false,
        latitude: product.latitude,
        longitude: product.longitude,
        location_type: product.location_type || 'no_location',
        availability_slots: parsedAvailabilitySlots,
        availability_type: product.availability_type === 'strict' ? 'strict' : 'flexible',
        collection_setup: product.collection_setup,
      })

      // Set location type selector
      setLocationTypeSelected(product.location_type || 'no_location')

      // Load persisted previews for this product
      try {
        const key = `edit_images_${product.id}`
        const raw = localStorage.getItem(key)
        const persisted = raw ? (JSON.parse(raw) as string[]).filter(Boolean) : []

        const serverImages = (product.image_urls || []).filter((u: any) => typeof u === 'string' && !u.startsWith('data:'))

        const combined = [...serverImages, ...persisted.filter((p: string) => !serverImages.includes(p))]
        setImagePreviews(combined)
      } catch (e) {
        const serverImages = (product.image_urls || []).filter((u: any) => typeof u === 'string')
        setImagePreviews(serverImages)
      }
    } catch (error: any) {
      setError(error.response?.data?.error || 'Failed to fetch product')
    } finally {
      setFetching(false)
    }
  }

  const handleAddImageFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return
    const maxFiles = 10
    const incoming: File[] = []
    for (let i = 0; i < files.length && incoming.length < maxFiles; i++) {
      const f = files[i]
      if (!f.type || !f.type.startsWith('image/')) continue
      incoming.push(f)
    }
    if (incoming.length === 0) return

    ;(async () => {
      const readResults: string[] = []
      for (const f of incoming) {
        try {
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const fr = new FileReader()
            fr.onload = () => resolve(fr.result as string)
            fr.onerror = () => reject(new Error('Failed to read file'))
            try {
              fr.readAsDataURL(f)
            } catch (err) {
              reject(err)
            }
          })
          if (dataUrl) readResults.push(dataUrl)
        } catch (err) {
          console.warn('Skipping a file due to read error', err)
        }
      }

      if (readResults.length === 0) {
        toast({
          id: 'editproduct-no-images-added',
          title: 'No images added',
          description: 'Could not read any of the selected files. Try selecting fewer or smaller images.',
          status: 'warning',
          duration: 4000,
          isClosable: true,
        })
        try {
          const el = document.getElementById('edit-image-input') as HTMLInputElement | null
          if (el) el.value = ''
        } catch {}
        return
      }

      const combined = [...imagePreviews, ...readResults]
      const capped = combined.slice(-20)
      setImagePreviews(capped)

      try {
        const pid = originalProduct?.id || (id ? parseInt(id) : 'unknown')
        const key = `edit_images_${pid}`
        const onlyData = capped.filter((u) => typeof u === 'string' && u.startsWith('data:'))
        localStorage.setItem(key, JSON.stringify(onlyData))
      } catch (e) {
        console.warn('Failed to persist image previews', e)
      }

      setFormData((prev) => ({ ...prev, image_urls: capped }))

      try {
        const el = document.getElementById('edit-image-input') as HTMLInputElement | null
        if (el) el.value = ''
      } catch {}
    })()
  }

  const removeImageAt = (index: number) => {
    const next = imagePreviews.filter((_, i) => i !== index)
    setImagePreviews(next)
    try {
      const key = `edit_images_${originalProduct.id}`
      const onlyData = next.filter((u) => typeof u === 'string' && u.startsWith('data:'))
      localStorage.setItem(key, JSON.stringify(onlyData))
    } catch {}
    setFormData((prev) => ({ ...prev, image_urls: next }))
  }

  const handleInputChange = (field: keyof ProductUpdate, value: any) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!formData.title?.trim()) {
      setError('Please enter a product title')
      return
    }

    if (!formData.description?.trim()) {
      setError('Please enter a product description')
      return
    }

    try {
      setLoading(true)
      setError('')

      // Backend expects multipart form data, not JSON
      const form = new FormData()
      if (formData.title) form.append('title', formData.title)
      if (formData.description) form.append('description', formData.description)
      if (formData.price !== undefined && formData.price !== null) form.append('price', String(formData.price))
      if (formData.condition) form.append('condition', formData.condition)
      if (formData.category) form.append('category', formData.category)
      if (formData.location) form.append('location', formData.location)
      if ((formData as any).latitude !== undefined) form.append('latitude', String((formData as any).latitude))
      if ((formData as any).longitude !== undefined) form.append('longitude', String((formData as any).longitude))
      if (formData.max_items_per_offer !== undefined) form.append('max_items_per_offer', String(formData.max_items_per_offer))
      if (formData.wants !== undefined) form.append('wants', formData.wants)
      form.append('wanted_categories', JSON.stringify(formData.wanted_categories || []))
      form.append('show_estimated_value', formData.show_estimated_value !== false ? 'true' : 'false')
      const hasAiEstimate =
        formData.estimated_value_min !== undefined &&
        formData.estimated_value_max !== undefined &&
        formData.estimated_value_min > 0 &&
        formData.estimated_value_max > 0
      const fallbackEstimate = !hasAiEstimate && formData.category && formData.condition
        ? getBackupPriceEstimate(formData.category, formData.condition)
        : null
      const submitEstimate = hasAiEstimate
        ? { min: formData.estimated_value_min as number, max: formData.estimated_value_max as number }
        : fallbackEstimate
      if (submitEstimate) {
        form.append('estimated_value_min', String(submitEstimate.min))
        form.append('estimated_value_max', String(submitEstimate.max))
      }
      form.append('availability_slots', JSON.stringify(formData.availability_slots || []))
      form.append('availability_type', formData.availability_type || 'flexible')
      if (formData.collection_setup) {
        form.append('collection_setup', typeof formData.collection_setup === 'string' ? formData.collection_setup : JSON.stringify(formData.collection_setup))
      }

      // Add image files from previews that are data URLs (newly uploaded)
      // For existing server URLs, we keep them via image_urls field
      const serverImages = imagePreviews.filter((u) => !u.startsWith('data:'))
      const dataImages = imagePreviews.filter((u) => u.startsWith('data:'))

      // Convert data URLs to File objects and append
      for (const dataUrl of dataImages) {
        try {
          const res = await fetch(dataUrl)
          const blob = await res.blob()
          const file = new File([blob], `image_${Date.now()}.jpg`, { type: blob.type || 'image/jpeg' })
          form.append('images', file)
        } catch (err) {
          console.warn('Failed to convert data URL to file', err)
        }
      }

      // If there are existing server images, append them as image_urls
      if (serverImages.length > 0) {
        form.append('image_urls', JSON.stringify(serverImages))
      }

      await api.put(`/api/products/${id}`, form)
      
      // Invalidate dashboard products cache to ensure consistency
      await queryClient.invalidateQueries({ queryKey: ['dashboard', 'products'] })

      toast({
        id: 'editproduct-product-updated',
        title: 'Product updated!',
        description: 'Your product has been successfully updated',
        status: 'success',
        duration: 3000,
        isClosable: true,
      })

      // Clear persisted local previews
      try {
        localStorage.removeItem(`edit_images_${originalProduct.id}`)
      } catch {}

      navigate('/dashboard')
    } catch (error: any) {
      setError(error.response?.data?.error || error.message || 'Failed to update product')
    } finally {
      setLoading(false)
    }
  }

  if (fetching) {
    return (
      <Box minH="100vh" bg={pageBg} display="flex" alignItems="center" justifyContent="center">
        <Spinner size="xl" color="brand.500" />
      </Box>
    )
  }

  if (error && !originalProduct) {
    return (
      <Box minH="100vh" bg={pageBg} py={8}>
        <Container maxW="container.md">
          <Alert status="error">
            <AlertIcon />
            {error}
          </Alert>
        </Container>
      </Box>
    )
  }

  if (!originalProduct) {
    return (
      <Box minH="100vh" bg={pageBg} py={8}>
        <Container maxW="container.md">
          <Alert status="error">
            <AlertIcon />
            Product not found
          </Alert>
        </Container>
      </Box>
    )
  }

  return (
    <Box w="full" minH="100vh" bg="#FFFDF1" py={8} pb={24}>
      <VStack spacing={6} maxW="container.md" mx="auto" px={{ base: 4, md: 8 }} align="stretch">
        
        {/* Header Block inline with premium flow */}
        <VStack align="start" spacing={0} mb={2}>
          <Heading size="md" color="brand.600" fontWeight="800" letterSpacing="tight">Edit Product</Heading>
          <Text fontSize="xs" color="gray.500" fontWeight="600">Update the details of your listing below</Text>
        </VStack>

        {/* Elevated Form Container */}
        <Box 
          bg="white" 
          p={{ base: 6, md: 8 }} 
          borderRadius="2xl" 
          shadow="xl" 
          borderWidth="0" 
          position="relative" 
          overflow="hidden"
        >
          <form onSubmit={handleSubmit}>
            <VStack spacing={6} align="stretch">
                {error && (
                  <Alert status="error" fontSize="sm" rounded="md">
                    <AlertIcon />
                    {error}
                  </Alert>
                )}

                {/* Title */}
                <FormControl isRequired>
                  <FormLabel fontWeight="600" fontSize={{ base: 'sm', md: 'md' }}>Product Title</FormLabel>
                  <Input
                    value={formData.title || ''}
                    onChange={(e) => handleInputChange('title', e.target.value)}
                    placeholder="Enter product title"
                    maxLength={60}
                    size={{ base: 'md', md: 'lg' }}
                  />
                  <FormHelperText fontSize="xs" color={(formData.title?.length || 0) > 50 ? 'orange.500' : 'gray.500'}>
                    {formData.title?.length || 0}/60 characters
                  </FormHelperText>
                </FormControl>

                {/* Description */}
                <FormControl isRequired>
                  <FormLabel fontWeight="600" fontSize={{ base: 'sm', md: 'md' }}>Description</FormLabel>
                  <Textarea
                    value={formData.description || ''}
                    onChange={(e) => handleInputChange('description', e.target.value)}
                    placeholder="Describe your product in detail"
                    maxLength={500}
                    size={{ base: 'md', md: 'lg' }}
                    rows={4}
                  />
                  <FormHelperText fontSize="xs" color={(formData.description?.length || 0) > 450 ? 'orange.500' : 'gray.500'}>
                    {formData.description?.length || 0}/500 characters
                  </FormHelperText>
                </FormControl>

                {/* Price */}
                <FormControl>
                  <FormLabel fontWeight="600" fontSize={{ base: 'sm', md: 'md' }}>Price (₱)</FormLabel>
                  <Input
                    type="number"
                    value={formData.price || ''}
                    onChange={(e) => handleInputChange('price', Math.max(0, parseFloat(e.target.value) || 0))}
                    onKeyDown={(e) => {
                      if (e.key === '-' || e.key === '+') e.preventDefault()
                    }}
                    placeholder="Enter price"
                    size={{ base: 'md', md: 'lg' }}
                    min={0}
                    inputMode="numeric"
                  />
                </FormControl>

                {/* Estimated Value Visibility */}
                <Box
                  p={3}
                  bg="gray.50"
                  borderRadius="lg"
                  borderLeft="3px solid"
                  borderLeftColor={formData.show_estimated_value !== false ? 'purple.300' : 'gray.300'}
                >
                  <HStack justify="space-between" align="center" gap={3}>
                    <Box textAlign="left" minW={0}>
                      <Text fontSize="xs" fontWeight="medium" color="gray.600">
                        Estimated Value (Market Range)
                      </Text>
                      <Text fontSize="10px" color="gray.500">
                        Choose if other users can see this estimate.
                      </Text>
                      {formData.show_estimated_value !== false ? (
                        <Text fontSize="sm" color="gray.800" fontWeight="semibold" mt={1}>
                          {formatEstimatedValueRange(formData.estimated_value_min, formData.estimated_value_max) || 'No estimate available'}
                        </Text>
                      ) : (
                        <Text fontSize="sm" color="gray.600" fontWeight="semibold" mt={1}>
                          Hidden from product viewers
                        </Text>
                      )}
                    </Box>
                    <HStack spacing={0} borderWidth="1px" borderColor="gray.200" borderRadius="md" overflow="hidden" flexShrink={0}>
                      <Button
                        type="button"
                        size="xs"
                        borderRadius={0}
                        colorScheme={formData.show_estimated_value !== false ? 'green' : 'gray'}
                        variant={formData.show_estimated_value !== false ? 'solid' : 'ghost'}
                        onClick={() => handleInputChange('show_estimated_value', true)}
                      >
                        On
                      </Button>
                      <Button
                        type="button"
                        size="xs"
                        borderRadius={0}
                        colorScheme={formData.show_estimated_value === false ? 'red' : 'gray'}
                        variant={formData.show_estimated_value === false ? 'solid' : 'ghost'}
                        onClick={() => handleInputChange('show_estimated_value', false)}
                      >
                        Off
                      </Button>
                    </HStack>
                  </HStack>
                </Box>

                {/* Availability Schedule */}
                <Box
                  p={3}
                  bg="teal.50"
                  borderRadius="lg"
                  borderWidth="1px"
                  borderColor="teal.100"
                >
                  <HStack justify="space-between" align={{ base: 'start', sm: 'center' }} gap={3} mb={2} flexWrap="wrap">
                    <Box>
                      <HStack spacing={2}>
                        <Text fontSize="xs" fontWeight="bold" color="teal.900">Availability Schedule</Text>
                        <Badge colorScheme="teal" fontSize="8px">Optional</Badge>
                      </HStack>
                      <Text fontSize="10px" color="gray.600" mt={1}>
                        {formData.availability_type === 'strict'
                          ? 'Offerers must choose one of your listed time slots.'
                          : 'Offerers can pick these slots or suggest another time.'}
                      </Text>
                    </Box>
                    <HStack spacing={1}>
                      {(['flexible', 'strict'] as const).map((type) => (
                        <Button
                          key={type}
                          type="button"
                          size="xs"
                          fontSize="10px"
                          h="24px"
                          colorScheme={formData.availability_type === type ? (type === 'strict' ? 'orange' : 'teal') : 'gray'}
                          variant={formData.availability_type === type ? 'solid' : 'outline'}
                          onClick={() => handleInputChange('availability_type', type)}
                        >
                          {type === 'flexible' ? 'Flexible' : 'Strict'}
                        </Button>
                      ))}
                    </HStack>
                  </HStack>

                  {(formData.availability_slots || []).length > 0 && (
                    <VStack align="stretch" spacing={1.5} mb={3}>
                      {(formData.availability_slots || []).map((slot) => {
                        const d = new Date(`${slot.date}T00:00:00`)
                        const dateStr = Number.isNaN(d.getTime()) ? slot.date : d.toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' })
                        return (
                          <HStack key={slot.id} p={2} bg="white" borderRadius="md" borderLeft="3px solid" borderLeftColor="teal.400" justify="space-between">
                            <Text fontSize="11px" color="teal.900" fontWeight="600">
                              {dateStr} - {slot.start_time}-{slot.end_time}
                            </Text>
                            <IconButton
                              aria-label="Remove slot"
                              icon={<CloseIcon boxSize={2} />}
                              size="xs"
                              variant="ghost"
                              colorScheme="red"
                              onClick={() => handleInputChange('availability_slots', (formData.availability_slots || []).filter((s) => s.id !== slot.id))}
                            />
                          </HStack>
                        )
                      })}
                    </VStack>
                  )}

                  <VStack align="stretch" spacing={2} p={2} bg="white" borderRadius="md" borderWidth="1px" borderColor="teal.100">
                    <Text fontSize="10px" fontWeight="semibold" color="gray.600">Add a time slot</Text>
                    <HStack spacing={1.5} align="center" flexWrap={{ base: 'wrap', sm: 'nowrap' }}>
                      <Input type="date" value={avNewDate} onChange={(e) => setAvNewDate(e.target.value)} min={new Date().toISOString().split('T')[0]} size="sm" fontSize="11px" bg="white" flex={{ base: '1 1 100%', sm: 1.5 }} />
                      <Input type="time" value={avNewStart} onChange={(e) => setAvNewStart(e.target.value)} size="sm" fontSize="11px" bg="white" flex={1} />
                      <Text fontSize="10px" color="gray.400">to</Text>
                      <Input type="time" value={avNewEnd} onChange={(e) => setAvNewEnd(e.target.value)} size="sm" fontSize="11px" bg="white" flex={1} />
                      <IconButton
                        aria-label="Add availability slot"
                        icon={<AddIcon boxSize={2.5} />}
                        size="sm"
                        colorScheme="teal"
                        isDisabled={!avNewDate || !avNewStart || !avNewEnd || avNewEnd <= avNewStart}
                        onClick={() => {
                          if (!avNewDate || !avNewStart || !avNewEnd || avNewEnd <= avNewStart) return
                          const newSlot: AvailabilitySlot = {
                            id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                            date: avNewDate,
                            start_time: avNewStart,
                            end_time: avNewEnd,
                          }
                          handleInputChange('availability_slots', [...(formData.availability_slots || []), newSlot])
                          setAvNewDate('')
                          setAvNewStart('')
                          setAvNewEnd('')
                        }}
                      />
                    </HStack>
                    {avNewEnd && avNewStart && avNewEnd <= avNewStart && (
                      <Text fontSize="9px" color="red.500">End time must be after start time.</Text>
                    )}
                  </VStack>
                </Box>

                {/* Category & Condition */}
                <Grid templateColumns={{ base: '1fr', md: '1fr 1fr' }} gap={{ base: 3, md: 4 }} w="full">
                  <FormControl>
                    <FormLabel fontWeight="600">Category</FormLabel>
                    <Select
                      value={formData.category || ''}
                      onChange={(e) => handleInputChange('category', e.target.value)}
                      size="lg"
                    >
                      {PRODUCT_CATEGORIES.map((cat) => (
                        <option key={cat.value} value={cat.value}>
                          {cat.label}
                        </option>
                      ))}
                    </Select>
                  </FormControl>

                  <FormControl isRequired>
                    <FormLabel fontWeight="600">Condition</FormLabel>
                    <Select
                      value={formData.condition || ''}
                      onChange={(e) => handleInputChange('condition', e.target.value)}
                      size="lg"
                    >
                      <option value="New">New</option>
                      <option value="Like-New">Like-New</option>
                      <option value="Used">Used</option>
                      <option value="Fair">Fair</option>
                    </Select>
                  </FormControl>
                </Grid>

                {/* Location Type Selector */}
                <Box bg="yellow.50" p={3} borderRadius="md" borderWidth="1px" borderColor="yellow.200">
                  <FormControl>
                    <FormLabel fontSize="xs" fontWeight="bold" color="yellow.800" mb={2}>
                      📦 How would you like other users to collect this item?
                    </FormLabel>
                    <VStack align="stretch" spacing={2}>
                      {/* Option 1: Use Current Location */}
                      <Box 
                        p={2.5} 
                        borderWidth="1px" 
                        borderRadius="md"
                        bg={locationTypeSelected === 'current_location' ? 'yellow.100' : 'white'}
                        borderColor={locationTypeSelected === 'current_location' ? 'yellow.400' : 'gray.200'}
                        transition="all 0.2s"
                        cursor="pointer"
                        _hover={{ borderColor: 'yellow.300' }}
                      >
                        <HStack align="start" spacing={2}>
                          <Radio 
                            isChecked={locationTypeSelected === 'current_location'}
                            onChange={() => {
                              setLocationTypeSelected('current_location')
                              setFormData(prev => ({ ...prev, location_type: 'current_location' }))
                              useCurrentLocation()
                            }}
                            colorScheme="yellow"
                            flex="0 0 auto"
                            mt={0.5}
                            cursor="pointer"
                          />
                          <VStack align="start" spacing={0.5} flex={1} cursor="pointer" onClick={() => {
                            setLocationTypeSelected('current_location')
                            setFormData(prev => ({ ...prev, location_type: 'current_location' }))
                            useCurrentLocation()
                          }}>
                            <Text fontWeight="600" fontSize="xs">✓ Use My Current Location</Text>
                            <Text fontSize="9px" color="gray.600">Other users pick up from your detected location</Text>
                          </VStack>
                          {detectingLocation && <Spinner size="sm" />}
                        </HStack>
                        
                        {locationTypeSelected === 'current_location' && formData.location && formData.latitude && (
                          <HStack spacing={1.5} align="start" w="full" p={1.5} bg="green.50" borderRadius="md" borderWidth="1px" borderColor="green.200" mt={2}>
                            <Text fontSize="8px" fontWeight="600" color="green.700" flex="0 0 auto" mt={0.5}>✓</Text>
                            <VStack align="start" spacing={0} flex={1} minW={0}>
                              <Text 
                                fontSize="8px" 
                                color="gray.800" 
                                fontWeight="500"
                                noOfLines={2}
                              >
                                {formData.location}
                              </Text>
                              <Text fontSize="7px" color="gray.600">
                                {formData.latitude?.toFixed(4)}, {formData.longitude?.toFixed(4)}
                              </Text>
                            </VStack>
                          </HStack>
                        )}
                      </Box>

                      {/* Option 2: Custom Pickup Location */}
                      <Box 
                        p={2.5} 
                        borderWidth="1px" 
                        borderRadius="md"
                        bg={locationTypeSelected === 'pickup_location' ? 'yellow.100' : 'white'}
                        borderColor={locationTypeSelected === 'pickup_location' ? 'yellow.400' : 'gray.200'}
                        transition="all 0.2s"
                        cursor="pointer"
                        _hover={{ borderColor: 'yellow.300' }}
                      >
                        <HStack align="start" spacing={2} mb={locationTypeSelected === 'pickup_location' ? 1.5 : 0}>
                          <Radio 
                            isChecked={locationTypeSelected === 'pickup_location'}
                            onChange={() => {
                              setLocationTypeSelected('pickup_location')
                              setFormData(prev => ({ ...prev, location_type: 'pickup_location' }))
                            }}
                            colorScheme="yellow"
                            flex="0 0 auto"
                            mt={0.5}
                            cursor="pointer"
                          />
                          <VStack align="start" spacing={0.5} flex={1} cursor="pointer" onClick={() => {
                            setLocationTypeSelected('pickup_location')
                            setFormData(prev => ({ ...prev, location_type: 'pickup_location' }))
                          }}>
                            <Text fontWeight="600" fontSize="xs">📍 Set a Custom Pickup Location</Text>
                            <Text fontSize="9px" color="gray.600">Click on map to pinpoint your pickup location</Text>
                          </VStack>
                        </HStack>
                        
                        {locationTypeSelected === 'pickup_location' && (
                          <VStack align="stretch" spacing={1.5} pl={6}>
                            {/* Current Location Display */}
                            {formData.location && (locationSet || formData.latitude) ? (
                              <HStack spacing={1.5} align="start" w="full" p={1.5} bg="green.50" borderRadius="md" borderWidth="1px" borderColor="green.200">
                                <Text fontSize="8px" fontWeight="600" color="green.700" flex="0 0 auto" mt={0.5}>✓</Text>
                                <VStack align="start" spacing={0} flex={1} minW={0}>
                                  <Text 
                                    fontSize="8px" 
                                    color="gray.800" 
                                    fontWeight="500"
                                    noOfLines={2}
                                  >
                                    {formData.location}
                                  </Text>
                                </VStack>
                              </HStack>
                            ) : (
                              <Text fontSize="8px" color="gray.500">Pick a location using search or map below</Text>
                            )}

                            {/* Saved Locations */}
                            <SavedLocationsUI
                              locations={locations}
                              onSelectLocation={(loc) => {
                                setFormData(prev => ({
                                  ...prev,
                                  location: loc.address,
                                  latitude: loc.latitude,
                                  longitude: loc.longitude,
                                } as any))
                                setLocationSet(true)
                                setShowLocationMap(true)
                              }}
                              onAddLocation={(name, address, lat, lng) => {
                                addLocation({ name, address, latitude: lat, longitude: lng })
                              }}
                              onDeleteLocation={deleteLocation}
                              onRenameLocation={updateLocation}
                              currentLocation={
                                formData.location && formData.latitude && formData.longitude
                                  ? {
                                      address: formData.location,
                                      lat: formData.latitude,
                                      lng: formData.longitude,
                                    }
                                  : undefined
                              }
                              onAddNew={() => {}}
                            />
                            
                            {/* Search Location Section */}
                            <Box position="relative">
                              <Text fontSize="8px" fontWeight="600" color="yellow.700" mb={0.5}>Search</Text>
                              <Box position="relative">
                                <Input
                                  placeholder="Search location..."
                                  value={pickupSearchQuery}
                                  onChange={(e) => {
                                    setPickupSearchQuery(e.target.value)
                                    searchPickupLocations(e.target.value)
                                  }}
                                  onFocus={() => pickupSearchQuery && setShowPickupSearchDropdown(true)}
                                  size="sm"
                                  fontSize="8px"
                                  h="24px"
                                  py={1}
                                />
                                {isSearchingPickupLocation && (
                                  <Spinner 
                                    size="xs" 
                                    position="absolute" 
                                    right={1.5} 
                                    top={1}
                                  />
                                )}
                                {/* Search Results Dropdown */}
                                {showPickupSearchDropdown && pickupSearchResults.length > 0 && (
                                  <Box
                                    position="absolute"
                                    top="100%"
                                    left={0}
                                    right={0}
                                    bg="white"
                                    borderWidth="1px"
                                    borderColor="yellow.300"
                                    borderTop="none"
                                    borderRadius="0 0 md md"
                                    zIndex={10}
                                    maxH="120px"
                                    overflowY="auto"
                                    boxShadow="md"
                                  >
                                    {pickupSearchResults.map((result, idx) => (
                                      <Box
                                        key={idx}
                                        p={1}
                                        fontSize="8px"
                                        borderBottom={idx < pickupSearchResults.length - 1 ? "1px" : "none"}
                                        borderColor="gray.200"
                                        cursor="pointer"
                                        _hover={{ bg: 'yellow.50' }}
                                        onClick={() => selectLocation(result)}
                                      >
                                        <Text fontWeight="500" color="gray.800">{result.name}</Text>
                                        <Text fontSize="7px" color="gray.600" noOfLines={1}>{result.address}</Text>
                                      </Box>
                                    ))}
                                  </Box>
                                )}
                              </Box>
                            </Box>

                            {/* Use Current Location Button */}
                            <Button
                              size="xs"
                              variant="outline"
                              onClick={useCurrentLocation}
                              isLoading={detectingLocation}
                              fontSize="8px"
                              h="24px"
                              w="full"
                              colorScheme="yellow"
                            >
                              Use Current Location
                            </Button>

                            {/* Map Section */}
                            {(formData.latitude || 0) > 0 && (formData.longitude || 0) > 0 && (
                              <Box mt={1}>
                                <Text fontSize="8px" color="yellow.700" mb={1} fontWeight="600">Click to adjust location</Text>
                                <Box 
                                  h="160px"
                                  borderRadius="md" 
                                  overflow="hidden" 
                                  borderWidth="1.5px" 
                                  borderColor="yellow.300"
                                  shadow="sm"
                                >
                                  <MapContainer center={[formData.latitude || 0, formData.longitude || 0]} zoom={16} style={{ height: '100%', width: '100%' }}>
                                    <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; OpenStreetMap contributors' />
                                    <Marker position={[formData.latitude || 0, formData.longitude || 0]} />
                                    <MapUpdater lat={formData.latitude || 0} lng={formData.longitude || 0} />
                                    <MapClickHandler onLocationSelect={async (lat, lng) => {
                                      try {
                                        const res = await fetch(
                                          `https://nominatim.openstreetmap.org/reverse?format=json&zoom=18&addressdetails=1&lat=${lat}&lon=${lng}`
                                        )
                                        const data = await res.json()
                                        const addr = data.address || {}
                                        const street = [addr.house_number, addr.road || addr.street].filter(Boolean).join(' ')
                                        const barangay = addr.hamlet || addr.village || addr.suburb || addr.neighborhood || addr.quarter || ''
                                        const city = addr.city || addr.town || addr.municipality || ''
                                        const parts = [street, barangay, city].filter(Boolean)
                                        const address = parts.join(', ') || `${lat.toFixed(4)}, ${lng.toFixed(4)}`
                                        setFormData(prev => ({ ...prev, latitude: lat, longitude: lng, location: address } as any))
                                        setLocationSet(true)
                                      } catch {
                                        const fallback = `${lat.toFixed(4)}, ${lng.toFixed(4)}`
                                        setFormData(prev => ({ ...prev, latitude: lat, longitude: lng, location: fallback } as any))
                                        setLocationSet(true)
                                      }
                                    }} />
                                  </MapContainer>
                                </Box>
                              </Box>
                            )}
                          </VStack>
                        )}
                      </Box>


                    </VStack>
                    

                  </FormControl>
                </Box>

                {/* Desired Exchange */}
                <Box borderTopWidth="1px" borderColor="green.200" pt={2}>
                  <Text fontWeight="600" fontSize={{ base: 'xs', md: 'sm' }} mb={1.5}>
                    What are you looking for? (Optional)
                  </Text>
                  <VStack spacing={2} align="stretch">
                    <FormControl>
                      <FormLabel fontSize="xs" color="gray.600">Desired Item Categories</FormLabel>
                      <SimpleGrid columns={{ base: 2, sm: 3 }} spacing={1}>
                        {PRODUCT_CATEGORIES.map((cat) => {
                          const isSelected = (formData.wanted_categories || []).includes(cat.value)
                          const hasReachedWantedLimit = !isSelected && (formData.wanted_categories || []).length >= 3
                          return (
                            <Button
                              key={cat.value}
                              size="xs"
                              variant={isSelected ? 'solid' : 'outline'}
                              colorScheme={isSelected ? 'brand' : 'gray'}
                              isDisabled={hasReachedWantedLimit}
                              onClick={() => {
                                const current = formData.wanted_categories || []
                                if (!isSelected && current.length >= 3) return
                                const next = isSelected
                                  ? current.filter(v => v !== cat.value)
                                  : [...current, cat.value]
                                handleInputChange('wanted_categories', next)
                              }}
                              rounded="full"
                            >
                              {cat.label}
                            </Button>
                          )
                        })}
                      </SimpleGrid>
                      {(formData.wanted_categories || []).length > 0 && (
                        <Wrap mt={2} spacing={1}>
                          {(formData.wanted_categories || []).map(v => {
                            const cat = PRODUCT_CATEGORIES.find(c => c.value === v)
                            return (
                              <WrapItem key={v}>
                                <Badge colorScheme="brand" borderRadius="full" px={2} py={1} fontSize="xs" cursor="pointer"
                                  onClick={() => handleInputChange('wanted_categories', (formData.wanted_categories || []).filter(c => c !== v))}>
                                  {cat?.label || v} <CloseIcon boxSize="8px" ml={1} />
                                </Badge>
                              </WrapItem>
                            )
                          })}
                        </Wrap>
                      )}
                      <FormHelperText fontSize="7px" color="gray.500">
                        Choose up to 3.
                      </FormHelperText>
                    </FormControl>


                  </VStack>
                </Box>

                {/* Upload Images */}
                <FormControl>
                  <FormLabel fontWeight="600" fontSize={{ base: 'xs', md: 'sm' }}>Images</FormLabel>
                  <input
                    id="edit-image-input"
                    type="file"
                    accept="image/*"
                    multiple
                    hidden
                    onChange={(e) => handleAddImageFiles(e.target.files)}
                  />
                  <Button
                    size={{ base: 'xs', md: 'sm' }}
                    h={{ base: '24px', md: '28px' }}
                    fontSize={{ base: '11px', md: '12px' }}
                    onClick={() => document.getElementById('edit-image-input')?.click()}
                  >
                    Add image
                  </Button>
                  <Text fontSize="7px" color="gray.500" mt={0.5}>
                    You can add multiple images.
                  </Text>

                  {imagePreviews.length > 0 && (
                    <VStack align="stretch" spacing={1.5} mt={2}>
                      {imagePreviews.map((url, idx) => (
                        <HStack key={idx} spacing={1.5} align="center">
                          <Box
                            boxSize={{ base: '48px', md: '64px' }}
                            minW={{ base: '48px', md: '64px' }}
                            borderRadius="4px"
                            bg="gray.100"
                            display="flex"
                            alignItems="center"
                            justifyContent="center"
                            overflow="hidden"
                          >
                            <ChakraImage
                              src={url}
                              alt={`Preview ${idx + 1}`}
                              boxSize="100%"
                              objectFit="cover"
                              onError={(e: any) => {
                                e.target.style.display = 'none'
                              }}
                            />
                          </Box>
                          <Text fontSize="7px" color="gray.600" noOfLines={1} flex={1} minW={0}>
                            {url.startsWith('data:') ? 'New image' : 'Uploaded image'}
                          </Text>
                          <Button
                            size="xs"
                            colorScheme="red"
                            variant="ghost"
                            flexShrink={0}
                            h="20px"
                            fontSize="7px"
                            onClick={() => removeImageAt(idx)}
                          >
                            Remove
                          </Button>
                        </HStack>
                      ))}
                    </VStack>
                  )}
                </FormControl>

                <Box pt={4}>
                  <Button
                    type="submit"
                    bg="brand.500"
                    color="white"
                    _hover={{ bg: 'brand.600', transform: 'translateY(-2px)', shadow: 'md' }}
                    _active={{ transform: 'scale(0.98)' }}
                    size={{ base: "md", sm: "lg" }}
                    minH="48px"
                    w="full"
                    isLoading={loading}
                    loadingText="Updating..."
                    borderRadius="xl"
                    fontWeight="800"
                    fontSize="sm"
                    boxShadow="sm"
                    transition="all 0.2s"
                  >
                    Save Changes
                  </Button>
                </Box>
              </VStack>
            </form>
          </Box>
        </VStack>
      </Box>
  )
}

export default EditProduct
