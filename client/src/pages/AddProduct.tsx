import React, { useState, useCallback, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import {
  Box,
  VStack,
  HStack,
  Heading,
  Text,
  Button,
  Input,
  Textarea,
  FormControl,
  FormLabel,
  FormHelperText,
  useToast,
  Progress,
  IconButton,
  Image,
  SimpleGrid,
  useColorModeValue,
  Badge,
  Select,
  Spinner,
  Alert,
  AlertIcon,
  AlertTitle,
  AlertDescription,
  Skeleton,
  Tooltip,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalBody,
  ModalCloseButton,
  Circle,
  Checkbox,
  Wrap,
  WrapItem,
  Radio,
  RadioGroup,
  Stack,
} from '@chakra-ui/react'
import { AddIcon, CloseIcon, ArrowForwardIcon, ArrowBackIcon, CheckIcon, InfoOutlineIcon } from '@chakra-ui/icons'
import { MapContainer, TileLayer, Marker, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useCustomLocations } from '../hooks/useCustomLocations'
import { SavedLocationsUI } from '../components/SavedLocationsUI'

export interface ProductFormData {
  title: string
  description: string
  price?: number
  condition: string
  category: string
  images: File[]
  video?: File
  premium: boolean
  allow_buying: boolean
  barter_only: boolean
  bidding_type: string
  max_items_per_offer: number
  location: string
  location_type?: 'current_location' | 'pickup_location' | 'no_location'
  latitude?: number
  longitude?: number

  // AI Generated fields
  item_type?: string
  brand?: string
  authenticity_risks?: string
  estimated_value_min?: number
  estimated_value_max?: number
  show_estimated_value: boolean
  tags?: string

  // Product value
  value?: number

  // Barter preferences
  wanted_categories?: string[]
  wants?: string
  desired_product?: string
}

import { useAuth } from '../contexts/AuthContext'
import { useProducts } from '../contexts/ProductContext'
import { api } from '../services/api'
import { DASHBOARD_QUERY_KEYS } from '../hooks/useDashboard'
import FloatingTab from '../components/FloatingTab'
import { prepareImageForAIAnalysis, prepareImageForUpload } from '../utils/imageConverter'
import { PRODUCT_CATEGORIES } from '../utils/categories'
import { checkMultipleImageQuality, getQualityLabel, getQualityColorScheme, type ImageQualityResult as ClientQualityResult } from '../utils/imageQualityChecker'
import { getBackupPriceEstimate } from '../utils/priceEstimator'

// ── Constants ────────────────────────────────────────────────────────────────

const CONDITION_OPTIONS = ['New', 'Like New', 'Good', 'Used', 'For Parts']
const MAX_DAILY_AI_REQUESTS = 100

// ── Daily Budget Helpers ──────────────────────────────────────────────────

const getDailyRequestKey = (): string => {
  const today = new Date().toISOString().split('T')[0]
  return `ai_requests_${today}`
}

const getCurrentDailyCount = (): number => {
  const key = getDailyRequestKey()
  const stored = localStorage.getItem(key)
  return stored ? parseInt(stored, 10) : 0
}

const incrementDailyCount = (): void => {
  const key = getDailyRequestKey()
  const current = getCurrentDailyCount()
  localStorage.setItem(key, String(current + 1))
}

const canMakeAIRequest = (): boolean => {
  return getCurrentDailyCount() < MAX_DAILY_AI_REQUESTS
}

// ── Component ────────────────────────────────────────────────────────────────

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

const AddProduct: React.FC = () => {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { user } = useAuth()
  const { createProduct } = useProducts()
  const toast = useToast()
  const aiTriggeredRef = useRef(false)

  // Custom locations
  const { locations, addLocation, deleteLocation, updateLocation } = useCustomLocations()

  // Webcam state for desktop camera capture
  const [isCameraOpen, setIsCameraOpen] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const streamRef = useRef<MediaStream | null>(null)

  const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)

  const openCamera = useCallback(async () => {
    if (isMobile) {
      // On mobile, use the native file input with capture
      document.getElementById('img-camera')?.click()
      return
    }
    setIsCameraOpen(true)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
      }
    } catch (err) {
      console.error('Camera access denied:', err)
      toast({ id: 'camera-error', title: 'Camera unavailable', description: 'Could not access your camera. Please use "Upload from Gallery" instead.', status: 'warning', duration: 4000, isClosable: true })
      setIsCameraOpen(false)
    }
  }, [isMobile, toast])

  const closeCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
    setIsCameraOpen(false)
  }, [])

  const openVideoCamera = useCallback(() => {
    // On mobile, use native file input with video capture
    if (isMobile) {
      document.getElementById('vid-camera')?.click()
      return
    }
    // On desktop, use the same camera modal but for video capture
    // For simplicity, just trigger the gallery upload
    document.getElementById('vid-upload')?.click()
  }, [isMobile])

  const [currentStep, setCurrentStep] = useState(1)
  const TOTAL_STEPS = 3

  const [formData, setFormData] = useState<ProductFormData>({
    title: '',
    description: '',
    price: undefined,
    premium: false,
    allow_buying: false,
    barter_only: true,
    location: '',
    location_type: 'no_location',
    condition: '',
    category: '',
    bidding_type: 'none',
    max_items_per_offer: 0,
    images: [],
    latitude: undefined,
    longitude: undefined,
    item_type: undefined,
    brand: undefined,
    authenticity_risks: undefined,
    estimated_value_min: undefined,
    estimated_value_max: undefined,
    show_estimated_value: true,
    tags: '[]',
    value: undefined,
    wanted_categories: [],
    wants: '',
    desired_product: '',
  })

  const [uploadedImages, setUploadedImages] = useState<File[]>([])
  const [imagePreviewUrls, setImagePreviewUrls] = useState<string[]>([])
  const [uploadedVideo, setUploadedVideo] = useState<File | null>(null)
  const [videoPreviewUrl, setVideoPreviewUrl] = useState<string>('')

  const [isSubmitting, setIsSubmitting] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [aiDone, setAiDone] = useState(false)

  // AI Analysis blocking/warning state
  const [aiBlockingError, setAiBlockingError] = useState<string | null>(null) // Blocks form submission
  type AIWarningKind = 'person' | 'suspicious' | 'quality' | 'non_product' | 'online'
  type AIWarning = { kind: AIWarningKind; message: string }

  const [aiWarnings, setAiWarnings] = useState<AIWarning[]>([]) // Just warnings (server-side)
  const [showAllAiWarnings, setShowAllAiWarnings] = useState(false)

  // Client-side image quality state
  const [clientQualityResults, setClientQualityResults] = useState<ClientQualityResult[]>([])

  const [titleLength, setTitleLength] = useState(0)
  const [descriptionLength, setDescriptionLength] = useState(0)


  const [locationText, setLocationText] = useState<string>('')
  const [locationDetected, setLocationDetected] = useState(false)
  const [isGettingLocation, setIsGettingLocation] = useState(false)
  const [useMockLocation, setUseMockLocation] = useState(false)
  const [mockLocationText, setMockLocationText] = useState('Makati City')
  const [showCustomPickupMap, setShowCustomPickupMap] = useState(false)
  const [customPickupLocationSet, setCustomPickupLocationSet] = useState(false)
  const [nameFieldFocused, setNameFieldFocused] = useState(false)
  const [descriptionFieldFocused, setDescriptionFieldFocused] = useState(false)
  const [expandProductDetails, setExpandProductDetails] = useState(false)

  // Pickup location search state
  const [pickupSearchQuery, setPickupSearchQuery] = useState('')
  const [pickupSearchResults, setPickupSearchResults] = useState<Array<{ name: string; address: string; lat: number; lng: number }>>([])
  const [isSearchingPickupLocation, setIsSearchingPickupLocation] = useState(false)
  const [showPickupSearchDropdown, setShowPickupSearchDropdown] = useState(false)

  // Organization tagging state
  interface Organization {
    id: number
    name: string
    slug: string
    logo_url?: string
    description?: string
  }
  const [approvedOrganizations, setApprovedOrganizations] = useState<Organization[]>([])
  const [selectedOrganizationIds, setSelectedOrganizationIds] = useState<number[]>([])
  const [isLoadingOrganizations, setIsLoadingOrganizations] = useState(false)
  
  const bgColor = useColorModeValue('white', 'gray.800')
  const borderColor = useColorModeValue('gray.200', 'gray.700')
  const pageBg = '#FFFDF1'

  // ── Location ──────────────────────────────────────────────────────────────

  const detectLocation = useCallback(() => {
    if (!navigator.geolocation) return
    setIsGettingLocation(true)
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords
        setFormData(prev => ({ ...prev, latitude, longitude }))
        try {
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=json&zoom=18&addressdetails=1&lat=${latitude}&lon=${longitude}`
          )
          const data = await res.json()
          const addr = data.address || {}
          // Build most specific address we can: street + barangay + city.
          const street = [addr.house_number, addr.road || addr.street].filter(Boolean).join(' ')
          const barangay = addr.hamlet || addr.village || addr.suburb || addr.neighborhood || addr.quarter || ''
          const city = addr.city || addr.town || addr.municipality || ''
          const parts = [street, barangay, city].filter(Boolean)
          const address = parts.join(', ') || `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`
          setLocationText(address)
          setFormData(prev => ({ ...prev, location: address }))
          setLocationDetected(true)
        } catch {
          const fallback = `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`
          setLocationText(fallback)
          setFormData(prev => ({ ...prev, location: fallback }))
          setLocationDetected(true)
        }
        setIsGettingLocation(false)
      },
      () => {
        setIsGettingLocation(false)
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 10000 }
    )
  }, [])

  // Manual-entry fallback: user types an address, we forward-geocode it and
  // save both the text and resolved coords so distance is still accurate.
  const [manualLocationOpen, setManualLocationOpen] = useState(false)
  const [manualLocationInput, setManualLocationInput] = useState('')
  const [manualLocationSaving, setManualLocationSaving] = useState(false)
  const saveManualLocation = useCallback(async () => {
    const q = manualLocationInput.trim()
    if (!q) return
    setManualLocationSaving(true)
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&addressdetails=1&countrycodes=ph&q=${encodeURIComponent(q)}`
      )
      const results = await response.json()
      const bestMatch = Array.isArray(results) && results.length > 0 ? results[0] : null
      if (bestMatch) {
        const lat = parseFloat(bestMatch.lat)
        const lng = parseFloat(bestMatch.lon)
        const countryCode = String(bestMatch.address?.country_code || '').toLowerCase()
        if (countryCode && countryCode !== 'ph') {
          toast({
            title: 'PH locations only',
            description: 'Please select a location within the Philippines.',
            status: 'warning',
            duration: 3000,
          })
          return
        }
        const label = bestMatch.display_name || q
        if (!isNaN(lat) && !isNaN(lng)) {
          setFormData(prev => ({ ...prev, latitude: lat, longitude: lng, location: label }))
        } else {
          setFormData(prev => ({ ...prev, location: label }))
        }
        setLocationText(label)
      } else {
        setFormData(prev => ({ ...prev, location: q }))
        setLocationText(q)
      }
      setLocationDetected(true)
      setManualLocationOpen(false)
      setManualLocationInput('')
    } catch (err: any) {
      toast({
        title: 'Could not find that place',
        description: err?.response?.data?.error || 'Try a more specific address.',
        status: 'warning',
        duration: 3000,
      })
    } finally {
      setManualLocationSaving(false)
    }
  }, [manualLocationInput, toast])

  // Search for pickup locations
  const searchPickupLocations = useCallback(async (query: string) => {
    if (!query.trim()) {
      setPickupSearchResults([])
      return
    }
    setIsSearchingPickupLocation(true)
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&addressdetails=1&countrycodes=ph&q=${encodeURIComponent(query)}&limit=5`
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

  // Handle pickup location selection from search
  const selectPickupLocation = useCallback((result: { name: string; address: string; lat: number; lng: number }) => {
    setFormData(prev => ({
      ...prev,
      latitude: result.lat,
      longitude: result.lng,
      location: result.address,
    }))
    setCustomPickupLocationSet(true)
    setPickupSearchQuery('')
    setPickupSearchResults([])
    setShowPickupSearchDropdown(false)
  }, [])

  useEffect(() => {
    detectLocation()
  }, [detectLocation])

  // Fetch user's approved organizations
  useEffect(() => {
    const fetchApprovedOrganizations = async () => {
      try {
        setIsLoadingOrganizations(true)
        const response = await api.get('/api/organizations/my-approved')
        if (response.data.success && response.data.data) {
          setApprovedOrganizations(response.data.data)
        }
      } catch (err) {
        console.error('❌ [AddProduct] Failed to fetch approved organizations:', err)
        setApprovedOrganizations([])
      } finally {
        setIsLoadingOrganizations(false)
      }
    }

    if (user) {
      fetchApprovedOrganizations()
    }
  }, [user])

  // ── AI Generation ─────────────────────────────────────────────────────────

  const triggerAI = useCallback(async (images: File[]) => {
    // Check daily request limit
    if (!canMakeAIRequest()) {
      toast({
        id: "addproduct-daily-limit-reached",
        title: '⏱️ Daily limit reached',
        description: 'AI analysis limit reached for today. Try again tomorrow.',
        status: 'warning',
        duration: 5000,
        isClosable: true,
        position: 'top-right',
      })
      return
    }

    if (aiTriggeredRef.current || isGenerating) return
    aiTriggeredRef.current = true
    setIsGenerating(true)

    // Removed: 'Analyzing images...' notification (handled by inline UI)

    try {
      // Send all images in a batch (single API request)
      const fd = new FormData()
      const aiImages = await Promise.all(
        images.slice(0, 3).map(image => prepareImageForAIAnalysis(image))
      )
      aiImages.forEach(f => fd.append('images', f))

      const response = await api.post('/api/products/generate-details', fd)
      const data = response.data
      if (data.success && data.data) {
        const d = data.data

        // SAFETY CHECK: Handle top-level prohibition first (most critical)
        if (d.prohibited) {
          // Increment daily counter ONLY for safety check rejections (still count as a request)
          incrementDailyCount()

          setIsGenerating(false)
          aiTriggeredRef.current = false

          // Clear the uploaded images since they contain prohibited content
          setUploadedImages([])
          setImagePreviewUrls([])

          // Show prominent error message
          toast({
        id: "addproduct-cannot-list-this-item",
            title: '❌ Cannot list this item',
            description: d.reason || 'This item cannot be listed for trading.',
            status: 'error',
            duration: 8000,
            isClosable: true,
            position: 'top-right',
          })

          // Set blocking error to show it on Step 1
          setAiBlockingError(d.reason || 'This item cannot be listed for trading.')

          // Stay on Step 1 - do NOT navigate to Step 2
          setCurrentStep(1)
          return
        }

        // Increment daily counter for successful analysis
        incrementDailyCount()

        const warnings: AIWarning[] = []

        // Check for secondary blocking issues (older field structure)
        if (d.is_prohibited) {
          setAiBlockingError(d.prohibited_reason || 'This item cannot be listed for trading.')
          setIsGenerating(false)
          toast({
        id: "addproduct-item-cannot-be-listed",
            title: '❌ Item cannot be listed',
            description: d.prohibited_reason || 'This item cannot be listed for trading.',
            status: 'error',
            duration: 5000,
            isClosable: true,
            position: 'top-right',
          })
          return
        }

        // Check for person warning
        if (d.contains_person) {
          warnings.push({
            kind: 'person',
            message: d.person_warning || 'This photo contains a person. Please retake without people in frame.',
          })
        }

        // Stock / catalog / downloaded photo — one note only (AI often sets both flags with near-duplicate text)
        if (d.is_suspicious_image && d.appears_online) {
          warnings.push({
            kind: 'suspicious',
            message:
              'This looks like a stock, catalog, or downloaded product photo (e.g. perfect lighting or plain white background). Your own original photos usually get better engagement and trust.',
          })
        } else if (d.is_suspicious_image) {
          const reason = d.suspicious_reason || 'This may be a screenshot or stock-style image'
          warnings.push({
            kind: 'suspicious',
            message: `⚠️ ${reason}. Original photos of your actual item work better.`,
          })
        } else if (d.appears_online) {
          warnings.push({
            kind: 'online',
            message: `⚠️ ${d.online_image_reason || 'This may have been saved from the web.'} Original photos build more trust.`,
          })
        }

        // Non-product image
        if (d.is_non_product_image) {
          warnings.push({
            kind: 'non_product',
            message: `⚠️ ${d.non_product_reason || 'This does not appear to be a product photo.'} Please upload a clear photo of the actual item.`,
          })
        }

        // Skip AI blur/resolution/exposure warnings: the client "Image Quality Check" already covers pixel-level issues and listing them twice felt noisy.

        setAiWarnings(warnings)
        setShowAllAiWarnings(false)

        // Fill form with AI data
        setFormData(prev => {
          const aiTitle = d.title || prev.title
          const finalTitle = aiTitle ? aiTitle.substring(0, 25) : ''
          const aiCat = d.category || prev.category || 'General'
          const isValidCat = PRODUCT_CATEGORIES.some(c => c.value === aiCat)
          const finalCat = isValidCat ? aiCat : 'Others'

          return {
            ...prev,
            title: finalTitle,
            description: d.description || prev.description,
            condition: d.condition || prev.condition || 'Used',
            category: finalCat,
            item_type: d.subcategory || d.item_type || prev.item_type,
            brand: d.brand || prev.brand,
            authenticity_risks: d.authenticity_risks || prev.authenticity_risks,
            estimated_value_min: d.estimated_value_min ?? prev.estimated_value_min,
            estimated_value_max: d.estimated_value_max ?? prev.estimated_value_max,
            tags: d.tags ? JSON.stringify(d.tags) : prev.tags,
          }
        })
        if (d.title) setTitleLength(Math.min(d.title.length, 25))
        if (d.description) setDescriptionLength(d.description.length)
        setAiDone(true)

        // No toast for normal completion — inline UI on step 1 already shows status and tips
      } else {
        throw new Error(data.error || 'AI generation failed')
      }
    } catch (err: any) {
      aiTriggeredRef.current = false // allow retry
      // Only increment daily counter on failures if we haven't already
      // (safety rejections already increment above)
      incrementDailyCount()
      const backendMessage = err?.response?.data?.error || err?.message
      const fallbackMessage = 'No problem! Just click "Continue" and fill in the product details on the next page.'
      const description = backendMessage
        ? `${backendMessage} ${fallbackMessage}`
        : fallbackMessage

      toast({
        id: "addproduct-ai-analysis-failed",
        title: 'AI analysis failed',
        description,
        status: backendMessage ? 'warning' : 'info',
        duration: backendMessage ? 7000 : 5000,
        isClosable: true,
        position: 'top-right',
      })
    } finally {
      setIsGenerating(false)
    }
  }, [toast])

  // ── Effects ───────────────────────────────────────────────────────────────

  // Scroll to top on step change
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [currentStep])

  // ── Image Handling ────────────────────────────────────────────────────────

  const handleImageUpload = useCallback((files: FileList | null) => {
    if (!files) return
    const validFiles = Array.from(files).filter(f => f.type.startsWith('image/'))
    if (!validFiles.length) {
      toast({
        id: "addproduct-invalid-file-type", title: 'Invalid file type', description: 'Please select image files only.', status: 'error', duration: 3000 })
      return
    }

    const processFiles = async () => {
      const processed: File[] = []
      const previews: string[] = []

      for (const file of validFiles.slice(0, 8 - uploadedImages.length)) {
        try {
          const { file: pf } = await prepareImageForUpload(file, 5)
          processed.push(pf)
          const url = await new Promise<string>(resolve => {
            const reader = new FileReader()
            reader.onload = e => resolve(e.target?.result as string)
            reader.readAsDataURL(pf)
          })
          previews.push(url)
        } catch (e: any) {
          toast({
        id: "addproduct-error-processing-file-name", title: `Error processing ${file.name}`, description: e.message, status: 'error', duration: 3000 })
        }
      }

      const finalImages = [...uploadedImages, ...processed].slice(0, 8)

      // Reset AI state for this batch before analysis (avoid clearing after AI finishes)
      setAiBlockingError(null)
      setAiWarnings([])
      setShowAllAiWarnings(false)
      setAiDone(false)
      aiTriggeredRef.current = false

      setUploadedImages(finalImages)
      setImagePreviewUrls(prev => [...prev, ...previews].slice(0, 8))

      // Instant client quality first, then AI — keeps technical issues in one place
      try {
        const qualityResults = await checkMultipleImageQuality(processed)
        setClientQualityResults(prev => [...prev, ...qualityResults])
      } catch (err) {
        console.warn('Client-side quality check failed (non-blocking):', err)
      }

      triggerAI(finalImages)
    }
    processFiles()
  }, [uploadedImages.length, toast, triggerAI, uploadedImages])

  const capturePhoto = useCallback(() => {
    if (!videoRef.current) return
    const video = videoRef.current
    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(video, 0, 0)
    canvas.toBlob((blob) => {
      if (!blob) return
      const file = new File([blob], `camera-${Date.now()}.jpg`, { type: 'image/jpeg' })
      const dt = new DataTransfer()
      dt.items.add(file)
      handleImageUpload(dt.files)
      closeCamera()
    }, 'image/jpeg', 0.92)
  }, [closeCamera, handleImageUpload])

  const removeImage = (index: number) => {
    setUploadedImages(prev => prev.filter((_, i) => i !== index))
    setImagePreviewUrls(prev => prev.filter((_, i) => i !== index))
    setClientQualityResults(prev => prev.filter((_, i) => i !== index))
    // Clear AI errors and allow re-triggering when images are removed
    setAiBlockingError(null)
    setAiWarnings([])
    setShowAllAiWarnings(false)
    aiTriggeredRef.current = false
    setAiDone(false)
  }

  const handleVideoUpload = useCallback((files: FileList | null) => {
    if (!files || !files[0]) return
    const file = files[0]
    if (!file.type.startsWith('video/')) {
      toast({
        id: "addproduct-invalid-file-type-2", title: 'Invalid file type', status: 'error', duration: 3000 })
      return
    }
    if (file.size > 50 * 1024 * 1024) {
      toast({
        id: "addproduct-video-too-large", title: 'Video too large', description: 'Max 50MB', status: 'error', duration: 3000 })
      return
    }
    setUploadedVideo(file)
    setVideoPreviewUrl(URL.createObjectURL(file))
  }, [toast])

  const removeVideo = () => {
    if (videoPreviewUrl) URL.revokeObjectURL(videoPreviewUrl)
    setUploadedVideo(null)
    setVideoPreviewUrl('')
  }

  // ── Field Handlers ────────────────────────────────────────────────────────

  const handleField = (field: keyof ProductFormData, value: any) => {
    if (field === 'title') {
      const len = value?.length || 0
      if (len > 25) return
      setTitleLength(len)
    }
    if (field === 'description') {
      const len = value?.length || 0
      if (len > 800) return
      setDescriptionLength(len)
    }
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  // ── Validation ────────────────────────────────────────────────────────────

  const canProceed = (): boolean => {
    // If there's a blocking AI error, cannot proceed
    if (aiBlockingError) {
      return false
    }

    if (isGenerating) {
      return false
    }

    // Cannot proceed if daily AI request limit reached on step 1
    if (currentStep === 1 && uploadedImages.length >= 1 && !canMakeAIRequest()) {
      return false
    }

    switch (currentStep) {
      case 1:
        // Just need at least 1 image - always enabled for navigation
        return uploadedImages.length >= 1
      case 2:
        return (
          formData.title.trim().length > 0 &&
          formData.title.trim().length <= 25 &&
          formData.description.trim().length >= 50 &&
          !!formData.category &&
          !!formData.location?.trim() &&
          !!formData.wanted_categories && 
          formData.wanted_categories.length > 0 &&
          !!formData.price &&
          formData.price > 0
        )
      case 3:
        return true
      default:
        return false
    }
  }

  // Get reason why Next button is disabled
  const getDisabledReason = (): string => {
    // AI Blocking Error
    if (aiBlockingError) {
      return aiBlockingError
    }

    if (isGenerating) {
      return 'Analyzing details...'
    }

    // Daily limit reached on step 1
    if (currentStep === 1 && uploadedImages.length >= 1 && !canMakeAIRequest()) {
      return `Daily AI analysis limit reached (${getCurrentDailyCount()}/${MAX_DAILY_AI_REQUESTS})`
    }

    switch (currentStep) {
      case 1:
        return `Upload at least 1 image to proceed`
      case 2:
        const issues = []
        if (!formData.title.trim()) issues.push('Add a title')
        if (formData.title.trim().length > 25) issues.push('Title must be ≤25 characters')
        if (formData.description.trim().length < 50) issues.push('Description must be ≥50 characters')
        if (!formData.condition) issues.push('Select a condition')
        if (!formData.category) issues.push('Select a category')
        if (!formData.location?.trim()) issues.push('Add a location')
        if (!formData.wanted_categories || formData.wanted_categories.length === 0) issues.push('Select desired categories')
        if (!formData.price || formData.price <= 0) issues.push('Enter a desired price')
        return issues.length > 0 ? issues.join(' • ') : 'Complete all required fields'
      case 3:
        return 'Ready to post'
      default:
        return 'Fill in required information'
    }
  }

  // ── Submit ────────────────────────────────────────────────────────────────

  const handleSubmit = async () => {
    if (!formData.title.trim()) {
      toast({
        id: "addproduct-missing-name", title: 'We need a short name!', description: 'Please provide a catchy title for your item.', status: 'warning', position: 'top', duration: 4000, isClosable: true })
      return
    }
    if (formData.description.trim().length < 50) {
      toast({
        id: "addproduct-description-too-short", title: 'Tell us a bit more!', description: 'Your description is too short. Please add a few more details (minimum 50 characters).', status: 'warning', position: 'top', duration: 4000, isClosable: true })
      return
    }
    if (uploadedImages.length === 0) {
      toast({
        id: "addproduct-no-images", title: 'Show off your item!', description: 'Upload at least one picture so others can see what you are offering.', status: 'warning', position: 'top', duration: 4000, isClosable: true })
      return
    }
    if (!formData.price || formData.price <= 0) {
      toast({
        id: "addproduct-missing-price", title: 'Price required!', description: 'Please enter your desired price.', status: 'warning', position: 'top', duration: 4000, isClosable: true })
      return
    }

    setIsSubmitting(true)
    try {
      const fd = new FormData()
      fd.append('title', formData.title.trim())
      fd.append('description', formData.description.trim())
      fd.append('price', formData.price?.toString() || '0')
      fd.append('premium', formData.premium ? '1' : '0')
      fd.append('allow_buying', formData.allow_buying ? '1' : '0')
      fd.append('barter_only', formData.barter_only ? '1' : '0')
      fd.append('bidding_type', formData.bidding_type || 'none')
      fd.append('max_items_per_offer', String(formData.max_items_per_offer || 0))
      fd.append('location', formData.location?.trim() || '')
      fd.append('condition', formData.condition || 'Used')
      fd.append('category', formData.category || 'General')

      if (formData.latitude !== undefined && formData.longitude !== undefined) {
        fd.append('latitude', formData.latitude.toString())
        fd.append('longitude', formData.longitude.toString())
      }
      if (formData.item_type) fd.append('item_type', formData.item_type)
      if (formData.brand) fd.append('brand', formData.brand)
      if (formData.authenticity_risks) fd.append('authenticity_risks', formData.authenticity_risks)
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
        fd.append('estimated_value_min', String(submitEstimate.min))
        fd.append('estimated_value_max', String(submitEstimate.max))
      }
      fd.append('show_estimated_value', formData.show_estimated_value ? 'true' : 'false')
      fd.append('tags', formData.tags || '[]')
      if (formData.value !== undefined) fd.append('value', String(formData.value))
      if (formData.wanted_categories && formData.wanted_categories.length > 0) {
        fd.append('wanted_categories', JSON.stringify(formData.wanted_categories))
      }
      if (formData.wants) fd.append('wants', formData.wants)
      if (formData.desired_product) fd.append('desired_product', formData.desired_product)
      
      // Add organization IDs for tagging
      if (selectedOrganizationIds.length > 0) {
        fd.append('organization_ids', JSON.stringify(selectedOrganizationIds))
      }

      uploadedImages.forEach(f => fd.append('images', f))
      if (uploadedVideo) fd.append('video', uploadedVideo)

      await createProduct(fd)

      // Ensure the dashboard shows the new listing immediately after redirect.
      // Invalidate + prefetch so even if the dashboard query wasn't mounted yet,
      // the cache is already warm when we navigate.
      await queryClient.invalidateQueries({ queryKey: DASHBOARD_QUERY_KEYS.products })
      if (user?.id) {
        await queryClient.prefetchQuery({
          queryKey: [...DASHBOARD_QUERY_KEYS.products, user.id],
          queryFn: async () => {
            const response = await api.get(`/api/products/user/${user.id}`)
            const paginatedResponse = response.data?.data
            if (paginatedResponse && Array.isArray(paginatedResponse.data)) return paginatedResponse.data
            if (Array.isArray(response.data?.data)) return response.data.data
            if (Array.isArray(response.data)) return response.data
            return []
          },
        })
      }
      toast({
        id: "addproduct-product-posted", title: 'All set! 🎉', description: 'Your item is now live and visible to others.', status: 'success', position: 'top', duration: 3000, isClosable: true })
      navigate('/dashboard')
    } catch (err: any) {
      let friendlyMsg = 'Something went wrong while saving your item. Please try again.'
      if (err.response?.status === 413) {
        friendlyMsg = 'One or more of your files are too large. Try uploading a smaller image.'
      } else if (err.response?.data?.error) {
        friendlyMsg = err.response.data.error // Sometimes backend errors are already nice
      }
      
      toast({
        id: "addproduct-error-creating-product", 
        title: 'Oops! Could not post your item.', 
        description: friendlyMsg, 
        status: 'error', 
        position: 'top',
        duration: 6000,
        isClosable: true
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  // ── Step Rendering ────────────────────────────────────────────────────────

  const renderStep1 = () => (
    <VStack spacing={4} align="stretch">
      {/* Compact Header with AI Status - Single Line */}
      <HStack justify="space-between" align="center">
        <VStack spacing={0.5} align="start" flex={1}>
          <Text fontSize="sm" color="gray.600" fontWeight="semibold">📸 Upload Media</Text>
          <Text fontSize="xs" color="gray.500">Min 1 photo. AI analyzes automatically.</Text>
        </VStack>
        {!isGenerating && aiDone && (
          <Badge colorScheme="green" px={3} py={1.5} borderRadius="md" fontSize="xs" whiteSpace="nowrap">
            ✓ Auto-filled
          </Badge>
        )}
      </HStack>

      {/* Streamlined Drop Zone - Balanced Height, Mobile Responsive */}
      <Box
        border="2px dashed"
        borderColor={borderColor}
        borderRadius="xl"
        p={{ base: 4, sm: 5 }}
        textAlign="center"
        cursor="auto"
        _hover={{ borderColor: 'brand.400', bg: 'brand.50' }}
        transition="all 0.2s"
        minH={{ base: '120px', sm: '140px' }}
      >
        <VStack spacing={4}>
          <AddIcon boxSize={6} color="gray.400" />
          
          {/* Three Button Options - Side by Side */}
          <VStack spacing={2} w="full">
            <HStack spacing={3} w="full" justify="center" flexWrap={{ base: 'wrap', sm: 'nowrap' }}>
              <Button
                leftIcon={<span>📁</span>}
                colorScheme="brand"
                variant="outline"
                size="sm"
                onClick={() => document.getElementById('img-upload')?.click()}
                minW={{ base: 'calc(50% - 6px)', sm: 'auto' }}
              >
                Upload from Gallery
              </Button>
              <Button
                leftIcon={<span>📷</span>}
                colorScheme="brand"
                variant="outline"
                size="sm"
                onClick={openCamera}
                minW={{ base: 'calc(50% - 6px)', sm: 'auto' }}
              >
                Take Photo
              </Button>
              <Button
                leftIcon={<span>🎥</span>}
                colorScheme="brand"
                variant="outline"
                size="sm"
                onClick={openVideoCamera}
                minW={{ base: 'calc(50% - 6px)', sm: 'auto' }}
              >
                Take Video
              </Button>
            </HStack>
            <HStack spacing={1} fontSize="xs" color="gray.500" justify="center" flexWrap="wrap">
              <Text>JPEG/PNG • max 5MB • up to 8 images</Text>
              <Text>•</Text>
              <Text>MP4/MOV • up to 50MB</Text>
            </HStack>
          </VStack>
        </VStack>
      </Box>
      
      {/* Gallery Upload Input */}
      <input id="img-upload" type="file" multiple accept="image/*" style={{ display: 'none' }}
        onChange={e => handleImageUpload(e.target.files)} />
      
      {/* Camera Capture Input - Mobile friendly */}
      <input id="img-camera" type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
        onChange={e => handleImageUpload(e.target.files)} />

      {/* Video Upload Input */}
      <input id="vid-upload" type="file" accept="video/*" style={{ display: 'none' }}
        onChange={e => handleVideoUpload(e.target.files)} />

      {/* Video Capture Input - Mobile friendly */}
      <input id="vid-camera" type="file" accept="video/*" capture="environment" style={{ display: 'none' }}
        onChange={e => handleVideoUpload(e.target.files)} />

      {/* Video Preview */}
      {uploadedVideo && (
        <VStack spacing={2} align="stretch" bg="gray.50" p={4} borderRadius="lg" border="1px solid" borderColor="gray.200">
          <HStack justify="space-between" align="center">
            <Text fontSize="sm" fontWeight="semibold" color="gray.700">
              🎥 Video Added
            </Text>
            <Button
              size="xs"
              colorScheme="red"
              variant="ghost"
              onClick={removeVideo}
            >
              Remove
            </Button>
          </HStack>
          <Box position="relative" borderRadius="lg" overflow="hidden" bg="black" w="full">
            <video 
              src={videoPreviewUrl} 
              controls 
              style={{ width: '100%', maxHeight: '200px', objectFit: 'contain' }} 
            />
          </Box>
        </VStack>
      )}

      {/* Image Preview Grid */}
      {uploadedImages.length > 0 && (
        <VStack spacing={3} align="stretch" bg="gray.50" p={4} borderRadius="lg" border="1px solid" borderColor="gray.200">
          {/* Preview Header */}
          <HStack justify="space-between" align="center">
            <VStack spacing={0.5} align="start">
              <Text fontSize="sm" fontWeight="semibold" color="gray.700">
                📷 Your Photos ({uploadedImages.length}/8)
              </Text>
              <Text fontSize="xs" color="gray.500">
                {uploadedImages.length === 1 ? 'First image will be your cover photo' : 'First image is your cover photo • Tap × to remove'}
              </Text>
            </VStack>
            {uploadedImages.length < 8 && (
              <Button
                size="xs"
                variant="solid"
                colorScheme="brand"
                fontSize="xs"
                h="28px"
                px={2}
                onClick={() => document.getElementById('img-upload')?.click()}
                whiteSpace="nowrap"
              >
                + Add
              </Button>
            )}
          </HStack>

          {/* Horizontal Thumbnail Grid */}
          <Box 
            display="flex" 
            gap={{ base: 1.5, sm: 2 }} 
            overflowX="auto" 
            pb={2}
            css={{
              '&::-webkit-scrollbar': {
                height: '4px',
              },
              '&::-webkit-scrollbar-track': {
                background: 'transparent',
              },
              '&::-webkit-scrollbar-thumb': {
                background: '#cbd5e0',
                borderRadius: '4px',
                '&:hover': {
                  background: '#a0aec0',
                },
              },
            }}
          >
            {uploadedImages.map((_, i) => (
              <Box 
                key={i} 
                position="relative" 
                minW="90px" 
                w="90px" 
                h="90px" 
                flexShrink={0}
                borderRadius="lg"
                overflow="hidden"
                transition="all 0.2s"
                _hover={{
                  transform: 'scale(1.05)',
                  shadow: 'md',
                }}
              >
                <Image
                  src={imagePreviewUrls[i]}
                  alt={`Preview ${i + 1}`}
                  borderRadius="lg"
                  objectFit="cover"
                  w="full"
                  h="full"
                  border={i === 0 ? '3px solid' : '1px solid'}
                  borderColor={i === 0 ? 'brand.400' : 'gray.300'}
                  shadow={i === 0 ? 'md' : 'sm'}
                />
                
                {/* Cover Badge */}
                {i === 0 && (
                  <Badge 
                    position="absolute" 
                    bottom={2} 
                    left={2} 
                    colorScheme="brand" 
                    fontSize="9px" 
                    px={2}
                    py={1}
                    borderRadius="md"
                  >
                    ★ Cover
                  </Badge>
                )}
                {/* Quality indicator badge on thumbnail */}
                {clientQualityResults[i] && clientQualityResults[i].issues.length > 0 && (
                  <Badge
                    position="absolute"
                    top={1}
                    left={1}
                    colorScheme={getQualityColorScheme(clientQualityResults[i].overallScore)}
                    fontSize="7px"
                    px={1.5}
                    py={0.5}
                    borderRadius="sm"
                  >
                    {clientQualityResults[i].issues.some(iss => iss.severity === 'error') ? '⚠' : '!'} {clientQualityResults[i].overallScore}
                  </Badge>
                )}
                <IconButton
                  icon={<CloseIcon boxSize={3} />}
                  aria-label="Remove"
                  size="sm"
                  position="absolute"
                  top={-3}
                  right={-3}
                  colorScheme="red"
                  onClick={() => removeImage(i)}
                  borderRadius="full"
                  minW="24px"
                  h="24px"
                />
                
                {/* Position Counter */}
                <Badge 
                  position="absolute" 
                  top={1} 
                  left={1} 
                  bg="rgba(0,0,0,0.6)" 
                  color="white" 
                  fontSize="10px" 
                  px={1.5}
                  borderRadius="md"
                >
                  #{i + 1}
                </Badge>
                
                {/* Remove Button */}
                <Tooltip label="Delete this photo" size="sm">
                  <IconButton
                    icon={<CloseIcon boxSize={3} />}
                    aria-label="Remove photo"
                    size="md"
                    position="absolute"
                    top={1}
                    right={1}
                    colorScheme="red"
                    variant="solid"
                    bg="red.500"
                    _hover={{ bg: 'red.600' }}
                    onClick={() => removeImage(i)}
                    borderRadius="full"
                    minW="28px"
                    h="28px"
                    boxShadow="md"
                  />
                </Tooltip>
              </Box>
            ))}
          </Box>

          {/* Info Text */}
          <Text fontSize="xs" color="gray.500" mt={1}>
            💡 Tip: Clear, well-lit photos get analyzed faster and attract more interest
          </Text>
        </VStack>
      )}

      {/* AI Analysis Status - Loading, Errors, & Warnings */}
      {isGenerating && (
        <HStack spacing={2} w="full" bg="blue.50" px={3} py={2} borderRadius="md" border="1px solid" borderColor="blue.100">
          <Spinner size="sm" color="blue.500" />
          <Text fontSize="xs" color="blue.700" fontWeight="medium">
            Extracting title, category, and details from your photos…
          </Text>
        </HStack>
      )}

      {/* Client-side Image Quality Results (instant feedback) */}
      {clientQualityResults.length > 0 && clientQualityResults.some(qr => qr.issues.length > 0) && (
        <Alert status="warning" borderRadius="lg" variant="subtle" py={2} px={3}>
          <AlertIcon boxSize="14px" alignSelf="flex-start" mt={0.5} />
          <Box flex="1">
            <HStack justify="space-between" mb={1}>
              <AlertTitle fontSize="xs" fontWeight="semibold">Image Quality Check</AlertTitle>
              {(() => {
                const avgScore = Math.round(clientQualityResults.reduce((a, r) => a + r.overallScore, 0) / clientQualityResults.length)
                return (
                  <Badge colorScheme={getQualityColorScheme(avgScore)} fontSize="9px">
                    {getQualityLabel(avgScore)} ({avgScore})
                  </Badge>
                )
              })()}
            </HStack>
            <VStack spacing={0.5} align="stretch">
              {clientQualityResults.flatMap((qr, imgIdx) =>
                qr.issues.map((issue, issIdx) => (
                  <Text key={`${imgIdx}-${issIdx}`} fontSize="11px" color="gray.700" lineHeight="1.2">
                    <Text as="span" color={issue.severity === 'error' ? 'red.500' : 'orange.500'} mr={1}>•</Text>
                    {clientQualityResults.length > 1 ? `Photo ${imgIdx + 1}: ` : ''} 
                    <Text as="span" fontWeight="medium">{issue.message}</Text> 
                    <Text as="span" color="gray.500"> — {issue.suggestion}</Text>
                  </Text>
                ))
              )}
            </VStack>
          </Box>
        </Alert>
      )}

      {aiBlockingError && (
        <Alert status="error" borderRadius="lg" variant="left-accent">
          <AlertIcon />
          <Box flex="1">
            <AlertTitle fontSize="sm" fontWeight="semibold">Cannot list this item</AlertTitle>
            <AlertDescription fontSize="sm" mt={1}>
              {aiBlockingError}
            </AlertDescription>
          </Box>
        </Alert>
      )}

      {aiWarnings.length > 0 && (
        (() => {
          // Never repeat pixel-level quality here — "Image Quality Check" above is the source of truth
          const filtered = aiWarnings.filter(w => w.kind !== 'quality')

          // Dedupe by kind + message
          const unique: typeof filtered = []
          const seen = new Set<string>()
          filtered.forEach(w => {
            const key = `${w.kind}::${w.message}`
            if (seen.has(key)) return
            seen.add(key)
            unique.push(w)
          })

          if (unique.length === 0) return null

          const genericTip =
            'Optional tip: original photos you take yourself usually work better than catalog or website images.'
          const primaryText = unique.length === 1 ? unique[0].message : genericTip

          return (
            <VStack spacing={2} align="stretch" w="full">
              <Text fontSize="xs" fontWeight="semibold" color="orange.600" px={1}>
                🤖 Photo suggestions ({unique.length}) — you can still post
              </Text>
              <Alert status="warning" borderRadius="md" variant="subtle">
                <AlertIcon />
                <Box flex="1">
                  <AlertDescription fontSize="xs" color="gray.700">
                    {primaryText}
                  </AlertDescription>
                </Box>
              </Alert>
              {showAllAiWarnings && (
                <VStack spacing={1} align="stretch">
                  {unique.map((warning, idx) => (
                    <Alert key={`${warning.kind}-${warning.message}-${idx}`} status="warning" borderRadius="lg" variant="left-accent">
                      <AlertIcon />
                      <Box flex="1">
                        <AlertDescription fontSize="sm">
                          {warning.message}
                        </AlertDescription>
                      </Box>
                    </Alert>
                  ))}
                </VStack>
              )}
              {unique.length > 1 && (
                <Button
                  size="xs"
                  variant="link"
                  colorScheme="orange"
                  alignSelf="flex-start"
                  onClick={() => setShowAllAiWarnings(v => !v)}
                  px={0}
                >
                  {showAllAiWarnings ? 'Show less' : 'View details'}
                </Button>
              )}
            </VStack>
          )
        })()
      )}
    </VStack>
  )

  const renderStep2 = () => (
    <VStack spacing={2} align="stretch">
      {/* ──────── AI SUMMARY CARD (Collapsed by default) ──────── */}
      <Box
        bg="white"
        borderRadius="lg"
        borderWidth="1px"
        borderColor="gray.200"
        p={2.5}
        cursor={expandProductDetails ? 'default' : 'pointer'}
        transition="all 0.2s"
        _hover={{ borderColor: "brand.300", shadow: "sm" }}
      >
        {/* Collapsed View */}
        {!expandProductDetails ? (
          <HStack justify="space-between" align="center" spacing={2} onClick={() => setExpandProductDetails(true)}>
            {/* AI Badges or Loading Skeleton */}
            {isGenerating && !aiDone ? (
              <HStack spacing={2} flex={1} minW={0}>
                <Skeleton height="20px" width="60px" borderRadius="md" />
                <Skeleton height="20px" width="80px" borderRadius="md" />
                <Skeleton height="20px" width="70px" borderRadius="md" />
              </HStack>
            ) : aiDone ? (
              <HStack spacing={1} flex={1} minW={0}>
                <Text fontSize="8px" fontWeight="bold" color="purple.600">✨</Text>
                <Badge fontSize="7px" colorScheme="purple" py={0.5} noOfLines={1}>
                  {formData.item_type || '—'}
                </Badge>
                <Badge fontSize="7px" colorScheme="gray" py={0.5} noOfLines={1}>
                  {formData.brand || '—'}
                </Badge>
                <Badge
                  fontSize="7px"
                  colorScheme={
                    formData.authenticity_risks === 'High' ? 'red' :
                      formData.authenticity_risks === 'Medium' ? 'orange' : 'green'
                  }
                  py={0.5}
                  noOfLines={1}
                >
                  {formData.authenticity_risks || 'Low'}
                </Badge>
              </HStack>
            ) : (
              <Text fontSize="xs" color="gray.600" flex={1}>
                {formData.title || 'Enter product details...'}
              </Text>
            )}
            {/* Dropdown Arrow */}
            <Text
              fontSize="lg"
              color="gray.500"
              transform={expandProductDetails ? "rotate(180deg)" : "rotate(0deg)"}
              transition="transform 0.2s"
              flexShrink={0}
            >
              ▼
            </Text>
          </HStack>
        ) : (
          /* Expanded View */
          <VStack spacing={2} align="stretch" onClick={e => e.stopPropagation()}>
            {/* Close/Collapse hint - clicking these closes the dropdown */}
            <HStack justify="space-between" align="center" onClick={() => setExpandProductDetails(false)}>
              <Text fontSize="xs" fontWeight="bold" color="gray.700">Edit Details</Text>
              <Text fontSize="lg" color="gray.500" cursor="pointer">▲</Text>
            </HStack>

            {/* Product Name */}
            <FormControl isRequired>
              <FormLabel fontSize="xs" fontWeight="bold" color="gray.600">Product Name</FormLabel>
              <Input
                placeholder="e.g., Nike Air Force 1"
                value={formData.title}
                onChange={e => {
                  handleField('title', e.target.value)
                  setTitleLength(e.target.value.length)
                }}
                onFocus={() => setNameFieldFocused(true)}
                onBlur={() => setNameFieldFocused(false)}
                maxLength={25}
                onClick={e => e.stopPropagation()}
                size="sm"
                h="32px"
              />
              {nameFieldFocused && (
                <Badge colorScheme={titleLength <= 25 ? 'green' : 'orange'} fontSize="9px" mt={1}>
                  {titleLength}/25
                </Badge>
              )}
            </FormControl>

            {/* Product Description */}
            <FormControl isRequired>
              <FormLabel fontSize="xs" fontWeight="bold" color="gray.600">Description</FormLabel>
              <Textarea
                placeholder="Describe your product..."
                value={formData.description}
                onChange={e => {
                  handleField('description', e.target.value)
                  setDescriptionLength(e.target.value.length)
                }}
                onFocus={() => setDescriptionFieldFocused(true)}
                onBlur={() => setDescriptionFieldFocused(false)}
                onClick={e => e.stopPropagation()}
                rows={2}
                size="sm"
              />
              {descriptionFieldFocused && (
                <HStack justify="space-between" mt={1}>
                  <Text fontSize="9px" color={descriptionLength < 50 ? 'red.500' : 'gray.500'}>
                    {descriptionLength < 50 ? `${50 - descriptionLength} more chars` : '✓ Min met'}
                  </Text>
                  <Badge colorScheme={descriptionLength < 50 ? 'red' : 'green'} fontSize="9px">
                    {descriptionLength}/800
                  </Badge>
                </HStack>
              )}
            </FormControl>

            {/* Condition + Category - Responsive */}
            <SimpleGrid columns={{ base: 1, sm: 2 }} spacing={2}>
              <FormControl isRequired>
                <FormLabel fontSize="xs" fontWeight="bold" color="gray.600">Condition</FormLabel>
                <Select
                  placeholder="Select"
                  value={formData.condition}
                  onChange={e => handleField('condition', e.target.value)}
                  onClick={e => e.stopPropagation()}
                  size="sm"
                  h="32px"
                >
                  {CONDITION_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
                </Select>
              </FormControl>

              <FormControl isRequired>
                <FormLabel fontSize="xs" fontWeight="bold" color="gray.600">Category</FormLabel>
                <Select
                  placeholder="Select"
                  value={formData.category}
                  onChange={e => handleField('category', e.target.value)}
                  onClick={e => e.stopPropagation()}
                  size="sm"
                  h="32px"
                >
                  {PRODUCT_CATEGORIES.map(cat => (
                    <option key={cat.value} value={cat.value}>{cat.label}</option>
                  ))}
                </Select>
              </FormControl>
            </SimpleGrid>
          </VStack>
        )}
      </Box>

      {/* ──────── LOCATION DETECTOR ──────── */}
      <Box p={3} borderRadius="xl" borderWidth="1px" borderColor="brand.100" bg="white" shadow="sm">
        <VStack align="stretch" spacing={3}>
          <Text fontSize="xs" color="gray.600" fontWeight="bold" textTransform="uppercase" letterSpacing="wider">
            Your Current Location
          </Text>

          {isGettingLocation ? (
            <HStack spacing={3} p={3} bg="gray.50" borderRadius="lg" border="1px dashed" borderColor="gray.200">
              <Spinner size="sm" color="brand.500" />
              <VStack align="start" spacing={0}>
                <Text fontSize="xs" fontWeight="600" color="gray.700">Detecting your location...</Text>
                <Text fontSize="10px" color="gray.500">Please wait while we automatically find you</Text>
              </VStack>
            </HStack>
          ) : locationDetected && locationText ? (
            <VStack align="stretch" spacing={3}>
              <HStack align="center" spacing={3} p={3} bg="brand.50" borderRadius="lg" border="1px dashed" borderColor="brand.200">
                <Box p={2} bg="brand.100" borderRadius="full">
                  <Text fontSize="md">📍</Text>
                </Box>
                <VStack align="start" spacing={0} flex={1}>
                  <Text fontSize="sm" fontWeight="bold" color="brand.800" noOfLines={1} title={locationText}>
                    {locationText}
                  </Text>
                  <Text fontSize="10px" color="brand.600" fontWeight="500">This is your current detected location</Text>
                </VStack>
                <Button
                  size="xs"
                  variant="outline"
                  colorScheme="brand"
                  px={3}
                  h="24px"
                  borderRadius="full"
                  onClick={detectLocation}
                  isLoading={isGettingLocation}
                  bg="white"
                >
                  Refresh
                </Button>
              </HStack>
            </VStack>
          ) : (
            <VStack align="stretch" spacing={2}>
               <Box p={3} bg="gray.50" borderRadius="lg" border="1px dashed" borderColor="gray.200" textAlign="center">
                 <Text fontSize="xs" mb={3} color="gray.500">We need your location to match you with nearby trades.</Text>
                 <Button
                  size="sm"
                  colorScheme="brand"
                  variant="solid"
                  onClick={detectLocation}
                  isLoading={isGettingLocation}
                  w="100%"
                  borderRadius="md"
                 >
                   📍 Auto-Detect Location
                 </Button>
               </Box>
            </VStack>
          )}
        </VStack>
      </Box>

      {/* ──────── LOCATION TYPE SELECTOR ──────── */}
      <Box bg="blue.50" p={2} borderRadius="md" borderWidth="1px" borderColor="blue.200">
        <FormControl>
          <FormLabel fontSize="xs" fontWeight="bold" color="blue.800" mb={1.5}>
            📦 How would you like buyers to collect this item?
          </FormLabel>
          <VStack align="stretch" spacing={1.5}>
            {/* Option 1: Use Current Location */}
            <Box 
              p={2} 
              borderWidth="1px" 
              borderRadius="md"
              bg={formData.location_type === 'current_location' ? 'blue.100' : 'white'}
              borderColor={formData.location_type === 'current_location' ? 'blue.500' : 'gray.200'}
              transition="all 0.2s"
            >
              <HStack align="start" mb={formData.location_type === 'current_location' && locationText ? 1.5 : 0} spacing={2}>
                <Radio 
                  isChecked={formData.location_type === 'current_location'}
                  onChange={() => {
                    setFormData(prev => ({ ...prev, location_type: 'current_location' }))
                    setCustomPickupLocationSet(false)
                    detectLocation()
                  }}
                  colorScheme="blue"
                  flex="0 0 auto"
                  mt={0.5}
                  cursor="pointer"
                />
                <VStack align="start" spacing={0} flex={1} cursor="pointer" onClick={() => {
                  setFormData(prev => ({ ...prev, location_type: 'current_location' }))
                  setCustomPickupLocationSet(false)
                  detectLocation()
                }}>
                  <Text fontWeight="600" fontSize="xs">✓ Use My Current Location</Text>
                  <Text fontSize="10px" color="gray.600">Buyers pick up from your detected location</Text>
                </VStack>
              </HStack>
              {formData.location_type === 'current_location' && locationText && (
                <Box pl={6} pt={1} borderTopWidth="1px" borderTopColor="blue.200">
                  <HStack spacing={1.5} align="start">
                    <Text fontSize="10px" fontWeight="600" color="green.700" flex="0 0 auto">✓</Text>
                    <VStack align="start" spacing={0}>
                      <Text fontSize="10px" color="gray.800" fontWeight="500">{locationText}</Text>
                      {formData.latitude && formData.longitude && (
                        <Text fontSize="8px" color="gray.500">{formData.latitude.toFixed(4)}, {formData.longitude.toFixed(4)}</Text>
                      )}
                    </VStack>
                  </HStack>
                </Box>
              )}
            </Box>

            {/* Option 2: Custom Pickup Location */}
            <Box 
              p={2} 
              borderWidth="1px" 
              borderRadius="md"
              bg={formData.location_type === 'pickup_location' ? 'blue.100' : 'white'}
              borderColor={formData.location_type === 'pickup_location' ? 'blue.500' : 'gray.200'}
              transition="all 0.2s"
            >
              <HStack align="start" mb={formData.location_type === 'pickup_location' ? 1.5 : 0} spacing={2}>
                <Radio 
                  isChecked={formData.location_type === 'pickup_location'}
                  onChange={() => {
                    setFormData(prev => ({ ...prev, location_type: 'pickup_location' }))
                    setShowCustomPickupMap(true)
                  }}
                  colorScheme="blue"
                  flex="0 0 auto"
                  mt={0.5}
                  cursor="pointer"
                />
                <VStack align="start" spacing={0} flex={1} cursor="pointer" onClick={() => {
                  setFormData(prev => ({ ...prev, location_type: 'pickup_location' }))
                  setShowCustomPickupMap(true)
                }}>
                  <Text fontWeight="600" fontSize="xs">📍 Set a Custom Pickup Location</Text>
                  <Text fontSize="10px" color="gray.600">Click on map to pinpoint your pickup location</Text>
                </VStack>
              </HStack>
              {formData.location_type === 'pickup_location' && (
                <Box pl={{ base: 4, md: 6 }} pt={1}>
                  {customPickupLocationSet && formData.latitude && formData.longitude ? (
                    <VStack align="start" spacing={1} mb={1.5}>
                      <HStack spacing={1.5} align="start" w="full">
                        <Text fontSize={{ base: '8px', md: '9px' }} fontWeight="600" color="green.700" flex="0 0 auto" mt={0.5}>✓</Text>
                        <VStack align="start" spacing={0} flex={1} minW={0}>
                          <Text 
                            fontSize={{ base: '8px', md: '9px' }} 
                            color="gray.800" 
                            fontWeight="500"
                            noOfLines={2}
                            cursor="pointer"
                            _hover={{ textDecoration: 'underline', color: 'blue.600' }}
                            onClick={() => {
                              setPickupSearchQuery('')
                              setShowCustomPickupMap(false)
                              setShowPickupSearchDropdown(false)
                            }}
                          >
                            {formData.location}
                          </Text>
                        </VStack>
                        <Button 
                          size="xs"
                          variant="ghost"
                          fontSize={{ base: '7px', md: '8px' }}
                          h="20px"
                          px={1.5}
                          onClick={() => {
                            setPickupSearchQuery('')
                            setShowPickupSearchDropdown(false)
                            setShowCustomPickupMap(!showCustomPickupMap)
                          }}
                        >
                          {showCustomPickupMap ? 'Hide' : 'Edit'}
                        </Button>
                      </HStack>
                    </VStack>
                  ) : (
                    <Text fontSize={{ base: '8px', md: '9px' }} color="gray.500" mb={1}>Pick a location or search below</Text>
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
                      setCustomPickupLocationSet(true)
                      setShowCustomPickupMap(true)
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
                  
                  {/* Search Location Section - Compact */}
                  <Box mb={1} position="relative">
                    <Text fontSize={{ base: '8px', md: '9px' }} fontWeight="600" color="blue.700" mb={0.5}>Search</Text>
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
                        fontSize={{ base: '8px', md: '9px' }}
                        h={{ base: '24px', md: '28px' }}
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
                          borderColor="blue.300"
                          borderTop="none"
                          borderRadius="0 0 md md"
                          zIndex={10}
                          maxH={{ base: '120px', md: '150px' }}
                          overflowY="auto"
                          boxShadow="md"
                        >
                          {pickupSearchResults.map((result, idx) => (
                            <Box
                              key={idx}
                              p={{ base: 1, md: 1.5 }}
                              fontSize={{ base: '8px', md: '9px' }}
                              borderBottom={idx < pickupSearchResults.length - 1 ? "1px" : "none"}
                              borderColor="gray.200"
                              cursor="pointer"
                              _hover={{ bg: 'blue.50' }}
                              onClick={() => selectPickupLocation(result)}
                            >
                              <Text fontWeight="500" color="gray.800">{result.name}</Text>
                              <Text fontSize={{ base: '7px', md: '8px' }} color="gray.600" noOfLines={1}>{result.address}</Text>
                            </Box>
                          ))}
                        </Box>
                      )}
                    </Box>
                  </Box>
                  
                  {/* Map Section - Compact & Responsive */}
                  {showCustomPickupMap && formData.latitude && formData.longitude && (
                    <Box mt={1}>
                      <Text fontSize={{ base: '8px', md: '9px' }} color="blue.700" mb={0.5} fontWeight="500">Click map to adjust</Text>
                      <Box 
                        h={{ base: '150px', sm: '180px', md: '200px' }} 
                        borderRadius="md" 
                        overflow="hidden" 
                        borderWidth="1px" 
                        borderColor="blue.300"
                      >
                        <MapContainer center={[formData.latitude, formData.longitude]} zoom={16} style={{ height: '100%', width: '100%' }}>
                          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" attribution='&copy; OpenStreetMap contributors' />
                          <Marker position={[formData.latitude, formData.longitude]} />
                          <MapUpdater lat={formData.latitude} lng={formData.longitude} />
                          <MapClickHandler onLocationSelect={async (lat, lng) => {
                            try {
                              const res = await fetch(
                                `https://nominatim.openstreetmap.org/reverse?format=json&zoom=18&addressdetails=1&lat=${lat}&lon=${lng}`
                              )
                              const data = await res.json()
                              const addr = data.address || {}
                              const countryCode = String(addr.country_code || '').toLowerCase()
                              if (countryCode && countryCode !== 'ph') {
                                toast({
                                  title: 'PH locations only',
                                  description: 'Please select a location within the Philippines.',
                                  status: 'warning',
                                  duration: 3000,
                                })
                                return
                              }
                              const street = [addr.house_number, addr.road || addr.street].filter(Boolean).join(' ')
                              const barangay = addr.hamlet || addr.village || addr.suburb || addr.neighborhood || addr.quarter || ''
                              const city = addr.city || addr.town || addr.municipality || ''
                              const parts = [street, barangay, city].filter(Boolean)
                              const address = parts.join(', ') || `${lat.toFixed(4)}, ${lng.toFixed(4)}`
                              setFormData(prev => ({ ...prev, latitude: lat, longitude: lng, location: address }))
                              setCustomPickupLocationSet(true)
                            } catch {
                              setFormData(prev => ({ ...prev, latitude: lat, longitude: lng, location: `${lat.toFixed(4)}, ${lng.toFixed(4)}` }))
                              setCustomPickupLocationSet(true)
                            }
                          }} />
                        </MapContainer>
                      </Box>
                    </Box>
                  )}
                </Box>
              )}
            </Box>


          </VStack>
          <FormHelperText fontSize="8px" mt={1.5} color="blue.700">
            💡 Choose how buyers will collect your product
          </FormHelperText>
        </FormControl>
      </Box>
      <Box p={4} bg="brand.50" borderRadius="lg" border="1px dashed" borderColor="brand.200">
        <HStack mb={1}>
          <Text fontSize="sm" fontWeight="bold" color="brand.700">
            🔍 What are you looking for?
          </Text>
          <Tooltip label="This is how the system matches your items to other products based on your wants. It is strictly required for trading." placement="top" hasArrow>
            <Box cursor="help" color="brand.500"><InfoOutlineIcon boxSize={3.5} mb={0.5} /></Box>
          </Tooltip>
        </HStack>
        <Text fontSize="xs" color="gray.600" mb={3}>
          Please select up to 3 categories.
        </Text>
        <VStack spacing={3} align="stretch">
          <FormControl isRequired>
            <FormLabel fontSize="xs" fontWeight="semibold" color="gray.600">Desired Categories (Select multiple)</FormLabel>
            <SimpleGrid columns={{ base: 2, sm: 3, md: 4 }} spacing={1.5}>
              {PRODUCT_CATEGORIES.map((cat) => {
                const isSelected = formData.wanted_categories?.includes(cat.value)
                return (
                  <Button
                    key={cat.value}
                    size="xs"
                    variant={isSelected ? 'solid' : 'outline'}
                    colorScheme={isSelected ? 'brand' : 'gray'}
                    onClick={(e) => {
                      e.stopPropagation()
                      const current = formData.wanted_categories || []
                      if (!isSelected && current.length >= 3) {
                        toast({
                          id: 'addproduct-wanted-categories-max',
                          title: 'Maximum 3 categories',
                          description: 'You can choose up to 3 desired categories only.',
                          status: 'warning',
                          duration: 2500,
                          isClosable: true,
                          position: 'top-right',
                        })
                        return
                      }
                      const next = isSelected
                        ? current.filter(v => v !== cat.value)
                        : [...current, cat.value]
                      handleField('wanted_categories', next)
                    }}
                    isDisabled={!isSelected && (formData.wanted_categories?.length || 0) >= 3}
                    fontSize="9px"
                    h="24px"
                    rounded="full"
                    leftIcon={<cat.icon size={10} />}
                  >
                    {cat.label}
                  </Button>
                )
              })}
            </SimpleGrid>
            <FormHelperText fontSize="10px">Choose up to 3 categories.</FormHelperText>
          </FormControl>
          
          <FormControl isRequired>
            <FormLabel fontSize="xs" fontWeight="semibold" color="gray.600">Asking Price</FormLabel>
            <Input
              placeholder="e.g. 500"
              type="number"
              value={formData.price ?? ''}
              onChange={e => {
                let val = e.target.value ? Number(e.target.value) : undefined
                // Prevent negative numbers
                if (val !== undefined && val < 0) {
                  val = undefined
                }
                handleField('price', val)
              }}
              onKeyDown={(e) => {
                // Block minus and plus signs
                if (e.key === '-' || e.key === '+') {
                  e.preventDefault()
                }
              }}
              onBlur={(e) => {
                const val = Number(e.target.value)
                if (val < 0) {
                  handleField('price', undefined)
                  e.target.value = ''
                }
              }}
              size="sm"
              bg="white"
              h="40px"
              onClick={e => e.stopPropagation()}
              min={0}
              step={1}
              inputMode="numeric"
            />
            <FormHelperText fontSize="10px" color="gray.500">Your asking price in ₱</FormHelperText>
          </FormControl>
        </VStack>
      </Box>
    </VStack>
  )

  const renderStep3 = () => {
    const tags: string[] = (() => {
      try { return formData.tags ? JSON.parse(formData.tags) : [] }
      catch { return [] }
    })()

    const listingDate = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })

    return (
      <VStack spacing={4} align="stretch">
        {/* ──────── PRODUCT IMAGES GALLERY (Compact) ──────── */}
        <Box>
          {imagePreviewUrls.length > 0 ? (
            <SimpleGrid columns={{ base: 9, sm: 12 }} spacing={0.5}>
              {imagePreviewUrls.map((url, idx) => (
                <Box
                  key={idx}
                  position="relative"
                  paddingBottom="100%"
                  bg="gray.100"
                  borderRadius="xs"
                  overflow="hidden"
                >
                  <Image
                    src={url}
                    alt={`Product ${idx + 1}`}
                    position="absolute"
                    top={0}
                    left={0}
                    w="full"
                    h="full"
                    objectFit="cover"
                  />
                </Box>
              ))}
            </SimpleGrid>
          ) : (
            <Box
              w="full"
              h="100px"
              display="flex"
              alignItems="center"
              justifyContent="center"
              bg="gray.100"
              color="gray.400"
              borderRadius="lg"
            >
              <Text fontSize="sm">No images</Text>
            </Box>
          )}
        </Box>

        {/* ──────── CONSOLIDATED PRODUCT DETAILS ──────── */}
        <Box p={4} bg="white" borderRadius="lg" borderWidth="1px" borderColor="gray.200">
          <VStack align="stretch" spacing={3}>
            {/* Title */}
            <Box>
              <Heading fontSize="xl" fontWeight="bold" color="gray.900">
                {formData.title}
              </Heading>
            </Box>

            {/* Description */}
            {formData.description && (
              <Box>
                <Text
                  fontSize="sm"
                  color="gray.700"
                  lineHeight={1.6}
                  whiteSpace="pre-wrap"
                  fontFamily="system-ui, -apple-system, sans-serif"
                >
                  {formData.description}
                </Text>
              </Box>
            )}

            {/* Divider */}
            <Box borderBottomWidth="1px" borderBottomColor="gray.200" />

            {/* Details Grid - Compact */}
            <SimpleGrid columns={{ base: 2, sm: 3 }} spacing={3}>
              <Box>
                <Text fontSize="xs" color="gray.500" fontWeight="bold" textTransform="uppercase" mb={1}>
                  Condition
                </Text>
                <Text fontSize="sm" fontWeight="semibold" color="gray.800">
                  {formData.condition}
                </Text>
              </Box>

              <Box>
                <Text fontSize="xs" color="gray.500" fontWeight="bold" textTransform="uppercase" mb={1}>
                  Category
                </Text>
                <Text fontSize="sm" fontWeight="semibold" color="gray.800">
                  {formData.category}{formData.item_type ? ` · ${formData.item_type}` : ''}
                </Text>
              </Box>

              <Box>
                <Text fontSize="xs" color="gray.500" fontWeight="bold" textTransform="uppercase" mb={1}>
                  Location
                </Text>
                <Text fontSize="sm" fontWeight="semibold" color="gray.800">
                  📍 {formData.location || 'Not detected'}
                </Text>
              </Box>

              {/* Type & Brand */}
              {formData.item_type && (
                <Box>
                  <Text fontSize="xs" color="gray.500" fontWeight="bold" textTransform="uppercase" mb={1}>
                    Type
                  </Text>
                  <Text fontSize="sm" fontWeight="semibold" color="gray.800">
                    ✨ {formData.item_type}
                  </Text>
                </Box>
              )}

              {formData.brand && (
                <Box>
                  <Text fontSize="xs" color="gray.500" fontWeight="bold" textTransform="uppercase" mb={1}>
                    Brand
                  </Text>
                  <Text fontSize="sm" fontWeight="semibold" color="gray.800">
                    {formData.brand}
                  </Text>
                </Box>
              )}

              {formData.authenticity_risks && formData.authenticity_risks !== 'Low' && (
                <Box>
                  <Text fontSize="xs" color="gray.500" fontWeight="bold" textTransform="uppercase" mb={1}>
                    Authenticity Risk
                  </Text>
                  <Badge
                    colorScheme={
                      formData.authenticity_risks === 'High' ? 'red' :
                        formData.authenticity_risks === 'Medium' ? 'orange' : 'green'
                    }
                    fontSize="xs"
                  >
                    {formData.authenticity_risks}
                  </Badge>
                </Box>
              )}
            </SimpleGrid>
          </VStack>
        </Box>

        {/* ──────── ESTIMATED VALUE (Subtle) ──────── */}
        <Box
          p={3}
          bg="gray.50"
          borderRadius="lg"
          borderLeft="3px solid"
          borderLeftColor={formData.show_estimated_value ? 'purple.300' : 'gray.300'}
        >
          <HStack justify="space-between" align="center" mb={2} gap={3}>
            <Box textAlign="left">
              <Text fontSize="xs" fontWeight="medium" color="gray.600">
                Estimated Value (Market Range)
              </Text>
              <Text fontSize="10px" color="gray.500">
                Choose if buyers can see this estimate.
              </Text>
            </Box>
            <HStack spacing={0} borderWidth="1px" borderColor="gray.200" borderRadius="md" overflow="hidden" flexShrink={0}>
              <Button
                size="xs"
                borderRadius={0}
                colorScheme={formData.show_estimated_value ? 'green' : 'gray'}
                variant={formData.show_estimated_value ? 'solid' : 'ghost'}
                onClick={() => handleField('show_estimated_value', true)}
              >
                On
              </Button>
              <Button
                size="xs"
                borderRadius={0}
                colorScheme={!formData.show_estimated_value ? 'red' : 'gray'}
                variant={!formData.show_estimated_value ? 'solid' : 'ghost'}
                onClick={() => handleField('show_estimated_value', false)}
              >
                Off
              </Button>
            </HStack>
          </HStack>
          {isGenerating && !aiDone ? (
            <Skeleton height="32px" borderRadius="md" />
          ) : !formData.show_estimated_value ? (
            <Text fontSize="sm" color="gray.600" fontWeight="semibold" textAlign="center">
              Hidden from product viewers
            </Text>
          ) : (() => {
            const aiEstimate = formData.estimated_value_min && formData.estimated_value_max && formData.estimated_value_min > 0
              ? { min: formData.estimated_value_min, max: formData.estimated_value_max }
              : null
            
            const fallbackEstimate = !aiEstimate && formData.category && formData.condition
              ? getBackupPriceEstimate(formData.category, formData.condition)
              : null
            
            const estimate = aiEstimate || fallbackEstimate

            return estimate ? (
              <Heading fontSize="2xl" fontWeight="bold" color={aiEstimate ? 'gray.800' : 'amber.700'}>
                ₱{Number(estimate.min).toLocaleString()} – ₱{Number(estimate.max).toLocaleString()}
              </Heading>
            ) : (
              <Text fontSize="sm" color="gray.600" fontStyle="italic">
                Add product details to see estimate
              </Text>
            )
          })()}
        </Box>

        {/* ──────── VALUE DISPLAY ──────── */}
        {formData.value !== undefined && formData.value > 0 && (
          <Box p={3} bg="green.50" borderRadius="lg" borderLeft="3px solid" borderLeftColor="green.400">
            <Text fontSize="xs" fontWeight="bold" color="green.900" mb={1}>💰 Product Value</Text>
            <Text fontSize="lg" fontWeight="bold" color="green.700">₱{formData.value.toLocaleString()}</Text>
          </Box>
        )}

        {/* ──────── TRADE PREFERENCES DISPLAY ──────── */}
        {( (formData.wanted_categories && formData.wanted_categories.length > 0) || formData.wants) && (
          <Box p={3} bg="blue.50" borderRadius="lg" borderLeft="3px solid" borderLeftColor="blue.400">
            <VStack align="stretch" spacing={1.5}>
              <Box>
                <Text fontSize="xs" fontWeight="bold" color="blue.900">🔍 What I'm Looking For (Trade Preferences)</Text>
                <Text fontSize="10px" color="blue.700" mt={0.5}>These categories and items will help match you with compatible trades</Text>
              </Box>
              {formData.wanted_categories && formData.wanted_categories.length > 0 && (
                <HStack spacing={1.5} flexWrap="wrap">
                  {formData.wanted_categories.map(cat => (
                    <Badge key={cat} colorScheme="blue" variant="solid" fontSize="9px" borderRadius="full" px={2} py={0.5}>
                      {PRODUCT_CATEGORIES.find(c => c.value === cat)?.label || cat}
                    </Badge>
                  ))}
                </HStack>
              )}
              {formData.wants && (
                <Text fontSize="sm" fontWeight="medium" color="blue.800" fontStyle="italic">
                  " {formData.wants} "
                </Text>
              )}
            </VStack>
          </Box>
        )}

        {/* ──────── ORGANIZATION TAGGING ──────── */}
        {approvedOrganizations.length > 0 && (
          <Box p={4} bg="orange.50" borderRadius="lg" borderLeft="3px solid" borderLeftColor="orange.400">
            <VStack align="stretch" spacing={3}>
              <Box>
                <Text fontSize="sm" fontWeight="bold" color="orange.900">🏢 Tag Organizations</Text>
                <Text fontSize="xs" color="orange.700" mt={1}>
                  Tag one or more organizations to also display your product in their marketplace. This is optional.
                </Text>
              </Box>

              {isLoadingOrganizations ? (
                <Box display="flex" justifyContent="center" py={4}>
                  <Spinner size="sm" color="orange.500" />
                </Box>
              ) : approvedOrganizations.length === 0 ? (
                <Text fontSize="sm" color="orange.700" fontStyle="italic">
                  You don't have any approved organizations yet.
                </Text>
              ) : (
                <VStack align="stretch" spacing={2}>
                  {approvedOrganizations.map(org => (
                    <HStack
                      key={org.id}
                      p={3}
                      bg="white"
                      borderRadius="md"
                      borderWidth="1px"
                      borderColor={selectedOrganizationIds.includes(org.id) ? 'orange.400' : 'gray.200'}
                      cursor="pointer"
                      onClick={() => {
                        setSelectedOrganizationIds(prev =>
                          prev.includes(org.id)
                            ? prev.filter(id => id !== org.id)
                            : [...prev, org.id]
                        )
                      }}
                      _hover={{ borderColor: 'orange.300', bg: 'orange.50' }}
                      transition="all 0.2s"
                    >
                      <Checkbox
                        isChecked={selectedOrganizationIds.includes(org.id)}
                        onChange={() => {}}
                        pointerEvents="none"
                        cursor="pointer"
                      />
                      <VStack align="start" spacing={0} flex={1}>
                        <Text fontSize="sm" fontWeight="semibold" color="gray.900">
                          {org.name}
                        </Text>
                        {org.description && (
                          <Text fontSize="xs" color="gray.600">
                            {org.description}
                          </Text>
                        )}
                      </VStack>
                    </HStack>
                  ))}
                </VStack>
              )}

              {selectedOrganizationIds.length > 0 && (
                <HStack spacing={1} flexWrap="wrap">
                  {selectedOrganizationIds.map(orgId => {
                    const org = approvedOrganizations.find(o => o.id === orgId)
                    return org ? (
                      <Badge
                        key={orgId}
                        colorScheme="orange"
                        variant="solid"
                        fontSize="xs"
                        borderRadius="full"
                        px={2}
                        py={1}
                      >
                        {org.name}
                      </Badge>
                    ) : null
                  })}
                </HStack>
              )}
            </VStack>
          </Box>
        )}

        {/* ──────── READY INDICATOR ──────── */}
        <Box p={3} bg="green.50" borderRadius="lg" textAlign="center" borderLeft="3px solid" borderLeftColor="green.400">
          <HStack justify="center" spacing={2}>
            <CheckIcon color="green.600" boxSize={4} />
            <Text fontWeight="semibold" fontSize="sm" color="green.800">
              Everything looks great! Ready to publish.
            </Text>
          </HStack>
        </Box>
      </VStack>
    )
  }

  // ── Navigation ──────────────────────────────────────────────────────────

  const handleNextClick = useCallback(() => {
    // If on step 1 with images, navigate to step 2 first
    if (currentStep === 1 && uploadedImages.length > 0) {
      // Move to step 2 immediately (instant, snappy navigation)
      setCurrentStep(2)
      // Then trigger AI analysis in the background
      setTimeout(() => {
        triggerAI(uploadedImages)
      }, 0)
      return
    }
    // Otherwise, proceed to next step
    setCurrentStep(s => s + 1)
  }, [currentStep, uploadedImages, triggerAI])

  const stepLabels = [
    { number: 1, title: 'Upload Media', icon: '📸' },
    { number: 2, title: 'Details & Preferences', icon: '✏️' },
    { number: 3, title: 'Review & Post', icon: '📋' },
  ]

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <Box minH="100vh" bg={useColorModeValue('#FFFDF1', 'gray.900')} py={8}>
      <Box px={{ base: 4, md: 8 }} maxW="3xl" mx="auto">
        <VStack spacing={6} align="stretch">
          {/* Detailed Header with Premium Typography */}
          <HStack justify="space-between" align="center" spacing={3}>
            <VStack align="start" spacing={0}>
              <Heading size="md" color="brand.600" fontWeight="800" letterSpacing="tight">Post a Product</Heading>
              <Text fontSize="xs" color="gray.500" fontWeight="600">Complete the steps below to list your item</Text>
            </VStack>
            
            {/* Soft Pill Step Dots */}
            <HStack spacing={2}>
              {stepLabels.map((step) => (
                <Tooltip key={step.number} label={step.title} placement="top" hasArrow>
                  <Circle
                    size={{ base: '32px', sm: '36px' }}
                    bg={currentStep === step.number ? 'brand.500' : currentStep > step.number ? 'brand.100' : 'white'}
                    borderWidth={currentStep > step.number ? '0' : '1px'}
                    borderColor={currentStep === step.number ? 'transparent' : 'gray.200'}
                    cursor={currentStep !== step.number ? 'pointer' : 'default'}
                    onClick={() => currentStep > step.number && setCurrentStep(step.number)}
                    transition="all 0.3s cubic-bezier(.08,.52,.52,1)"
                    shadow={currentStep === step.number ? 'md' : 'sm'}
                    _hover={currentStep !== step.number ? { transform: 'translateY(-2px)', shadow: 'md' } : {}}
                    display="flex"
                    alignItems="center"
                    justifyContent="center"
                  >
                    <Text
                      fontSize={{ base: '11px', sm: '13px' }}
                      fontWeight="800"
                      color={currentStep === step.number ? 'white' : currentStep > step.number ? 'brand.600' : 'gray.400'}
                    >
                      {currentStep > step.number ? '✓' : step.number}
                    </Text>
                  </Circle>
                </Tooltip>
              ))}
            </HStack>
          </HStack>

          {/* Elevated Step Content Card */}
          <Box 
            bg={bgColor} 
            p={{ base: 6, md: 8 }} 
            borderRadius="2xl" 
            shadow="xl" 
            borderWidth="0" 
            position="relative" 
            overflow="hidden"
          >
            {currentStep === 1 && renderStep1()}
            {currentStep === 2 && renderStep2()}
            {currentStep === 3 && renderStep3()}
          </Box>

          {/* Premium Fluid Navigation Buttons */}
          <HStack justify="space-between" pb={{ base: 24, sm: 8 }} pt={2} spacing={{ base: 3, sm: 4 }}>
            <Button
              leftIcon={<ArrowBackIcon />}
              onClick={() => setCurrentStep(s => Math.max(1, s - 1))}
              isDisabled={currentStep === 1}
              variant="outline"
              size={{ base: "md", sm: "lg" }}
              fontSize="sm"
              borderRadius="xl"
              fontWeight="700"
              colorScheme="gray"
              boxShadow="sm"
            >
              Back
            </Button>

            {currentStep < TOTAL_STEPS ? (
              <Tooltip 
                label={!canProceed() ? getDisabledReason() : 'Proceed to next step'}
                isDisabled={!canProceed()}
                placement="top"
                hasArrow
              >
                <Button
                  rightIcon={<ArrowForwardIcon />}
                  onClick={handleNextClick}
                  isDisabled={!canProceed()}
                  bg="brand.500"
                  color="white"
                  _hover={{ bg: 'brand.600', transform: 'translateY(-2px)' }}
                  _active={{ transform: 'scale(0.98)' }}
                  size={{ base: "md", sm: "lg" }}
                  fontSize="sm"
                  borderRadius="xl"
                  fontWeight="800"
                  boxShadow="md"
                  transition="all 0.2s"
                >
                  {!isGenerating && !canMakeAIRequest() && currentStep === 1 ? 'Limit Reached' : 'Next Step'}
                </Button>
              </Tooltip>
            ) : (
              <Button
                onClick={handleSubmit}
                isLoading={isSubmitting}
                loadingText="Posting..."
                bg="brand.500"
                color="white"
                _hover={{ bg: 'brand.600', transform: 'translateY(-2px)' }}
                _active={{ transform: 'scale(0.98)' }}
                size={{ base: "md", sm: "lg" }}
                fontSize="sm"
                borderRadius="xl"
                fontWeight="800"
                boxShadow="lg"
                px={{ base: 6, sm: 10 }}
                leftIcon={<CheckIcon />}
                transition="all 0.2s"
              >
                Publish Product
              </Button>
            )}
          </HStack>
        </VStack>
      </Box>

      {/* Webcam Camera Modal for Desktop */}
      <Modal isOpen={isCameraOpen} onClose={closeCamera} size="xl" isCentered>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>Take a Photo</ModalHeader>
          <ModalCloseButton />
          <ModalBody pb={6}>
            <VStack spacing={4}>
              <Box
                w="100%"
                borderRadius="md"
                overflow="hidden"
                bg="black"
                position="relative"
              >
                <video
                  ref={(el) => {
                    videoRef.current = el
                    if (el && streamRef.current) {
                      el.srcObject = streamRef.current
                    }
                  }}
                  autoPlay
                  playsInline
                  muted
                  style={{ width: '100%', maxHeight: '400px', objectFit: 'cover' }}
                />
              </Box>
              <Button
                colorScheme="brand"
                size="lg"
                w="full"
                onClick={capturePhoto}
                leftIcon={<span>📸</span>}
              >
                Capture
              </Button>
            </VStack>
          </ModalBody>
        </ModalContent>
      </Modal>

      <FloatingTab showAddButton={false} />
    </Box>
  )
}

export default AddProduct
