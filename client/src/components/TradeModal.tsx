import React, { useEffect, useState, useMemo } from 'react'
import { Modal, ModalOverlay, ModalContent, ModalHeader, ModalBody, VStack, Grid, Box, Image, Text, FormControl, FormLabel, Input, HStack, Button, useToast, Badge, Card, CardBody, Icon, useColorModeValue, Spinner, Flex, Checkbox, Alert, AlertIcon, RadioGroup, Radio, useBreakpointValue, Accordion, AccordionItem, AccordionButton, AccordionPanel, AccordionIcon, Progress, Divider, Tooltip, CloseButton } from '@chakra-ui/react'
import { AnimatePresence, motion, useDragControls, useReducedMotion, type PanInfo } from 'framer-motion'
import { FaMapMarkerAlt, FaTruck, FaLocationArrow, FaBoxOpen, FaHandshake, FaTimes, FaCheckCircle, FaExternalLinkAlt, FaClock, FaLock, FaInfoCircle } from 'react-icons/fa'
import { AvailabilitySlot } from '../types'
import { useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../contexts/AuthContext'
import { useNotification } from '../contexts/NotificationContext'
import { api } from '../services/api'
import { CollectionSetup, Product, Trade, TradeCreate, TradeOption } from '../types'
import { getFirstImage } from '../utils/imageUtils'
import { reverseGeocodeToAddress, formatCoordinates } from '../utils/locationUtils'
import { getProductLocationKey, getProductLocationLabel, getProductRawLocation } from '../utils/productLocation'
import { useInvalidateDashboard, DASHBOARD_QUERY_KEYS } from '../hooks/useDashboard'
import { updateTrade } from '../services/tradeService'
import { motionDurations, motionEasings } from '../utils/motion'

interface TradeModalProps {
  isOpen: boolean
  onClose: () => void
  targetProductId: number | null
  editTrade?: Trade | null
}

type MeetupPoint = { name: string; address: string; lat: number; lng: number }

const PH_SEARCH_VIEWBOX = '116.0,21.5,127.0,4.5'
const isInPhilippines = (lat: number, lng: number) => (
  Number.isFinite(lat) && Number.isFinite(lng) && lat >= 4.4 && lat <= 21.3 && lng >= 116.8 && lng <= 127.2
)
const buildPhilippinesSearchUrl = (query: string, limit = 5) => (
  `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query + ', Philippines')}&limit=${limit}&countrycodes=ph&addressdetails=1&viewbox=${PH_SEARCH_VIEWBOX}&bounded=0`
)

const distanceMeters = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const earthRadius = 6371000
  const dLat = (b.lat - a.lat) * Math.PI / 180
  const dLng = (b.lng - a.lng) * Math.PI / 180
  const lat1 = a.lat * Math.PI / 180
  const lat2 = b.lat * Math.PI / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return earthRadius * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

const formatDistance = (meters: number | null) => {
  if (meters === null) return 'Distance unavailable'
  if (meters < 1000) return `${Math.round(meters)}m away`
  return `${(meters / 1000).toFixed(1)}km away`
}

const TradeModal: React.FC<TradeModalProps> = ({ isOpen, onClose, targetProductId, editTrade = null }) => {
  const { user, refreshUser } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()
  const { showNotification } = useNotification()
  const queryClient = useQueryClient()
  const sheetDragControls = useDragControls()
  const { invalidateOffers, invalidateDashboard } = useInvalidateDashboard()
  const [userProducts, setUserProducts] = useState<Product[]>([])
  const [targetProduct, setTargetProduct] = useState<Product | null>(null)
  const [selectedOfferIds, setSelectedOfferIds] = useState<number[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [tradeMessage, setTradeMessage] = useState('')
  const [submittingTrade, setSubmittingTrade] = useState(false)
  const [cashAmount, setCashAmount] = useState<string>('')
  const [cashError, setCashError] = useState('')
  const [tradeOption, setTradeOption] = useState<TradeOption | 'pickup' | null>(null)
  const [hasPendingOfferOnTarget, setHasPendingOfferOnTarget] = useState(false)
  const [committedProductIds, setCommittedProductIds] = useState<Set<number>>(new Set())
  const [loadingPendingCheck, setLoadingPendingCheck] = useState(false)
  const [detectingLocation, setDetectingLocation] = useState(false)
  const [additionalTargetIds, setAdditionalTargetIds] = useState<number[]>([])
  const [sellerProducts, setSellerProducts] = useState<Product[]>([])
  const [targetSearchTerm, setTargetSearchTerm] = useState('')
  const [loadingSellerProducts, setLoadingSellerProducts] = useState(false)
  const [pickupLocationProductId, setPickupLocationProductId] = useState<number | null>(null)
  const [mobileStep, setMobileStep] = useState(0)

  // One-time trade method onboarding hint
  const [showTradeHint, setShowTradeHint] = useState(() => {
    try { return !localStorage.getItem('clovia_trade_hint_seen') } catch { return false }
  })
  const dismissTradeHint = () => {
    setShowTradeHint(false)
    try { localStorage.setItem('clovia_trade_hint_seen', '1') } catch { /* ignore */ }
  }
  const [scheduleAgreed, setScheduleAgreed] = useState(false)
  // Delivery location state
  const [detectedCoords, setDetectedCoords] = useState<{ lat: number; lng: number } | null>(null)
  const [detectedLocationLabel, setDetectedLocationLabel] = useState('')
  const [profileLocationLabel, setProfileLocationLabel] = useState('')
  const [manualAddress, setManualAddress] = useState('')
  // Meetup location state
  const [meetupChoice, setMeetupChoice] = useState<'my_product' | 'their_product' | 'midpoint' | 'custom' | null>(null)
  const [customMeetupAddress, setCustomMeetupAddress] = useState('')
  const [customMeetupPoint, setCustomMeetupPoint] = useState<{ name: string; address: string; lat: number; lng: number } | null>(null)
  const [meetupSearchQuery, setMeetupSearchQuery] = useState('')
  const [meetupSearchResults, setMeetupSearchResults] = useState<Array<{ name: string; address: string; lat: number; lng: number }>>([])
  const [isSearchingMeetupLocation, setIsSearchingMeetupLocation] = useState(false)
  const [showMeetupSearchDropdown, setShowMeetupSearchDropdown] = useState(false)
  const [meetupDate, setMeetupDate] = useState('')
  const [meetupTime, setMeetupTime] = useState('')
  const [midpointLabel, setMidpointLabel] = useState('')
  const [loadingMidpoint, setLoadingMidpoint] = useState(false)
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null)
  const [showMorePickupDates, setShowMorePickupDates] = useState(false)
  const isEditMode = !!editTrade
  const cardBg = useColorModeValue('white', 'gray.800')
  const borderColor = useColorModeValue('gray.200', 'gray.700')
  const targetCardBg = useColorModeValue('blue.50', 'blue.900')
  const targetCardBorderColor = useColorModeValue('blue.200', 'blue.700')
  const targetLabelColor = useColorModeValue('blue.700', 'blue.200')
  const selectedBg = '#E1F5EE'
  const selectedBorder = '#1D9E75'
  const selectedTextColor = '#1D9E75'
  const mutedTextColor = useColorModeValue('gray.600', 'gray.400')
  const isMobile = useBreakpointValue({ base: true, md: false }) ?? false
  const useTwoColumnLayout = useBreakpointValue({ base: false, md: false, lg: true }) ?? false
  const prefersReducedMotion = useReducedMotion()

  const handleSheetDragEnd = (_event: MouseEvent | TouchEvent | PointerEvent, info: PanInfo) => {
    if (!isMobile) return
    if (info.offset.y > 80 || info.velocity.y > 500) {
      onClose()
    }
  }

  const mobileSheetMotionProps = isMobile ? ({
    as: motion.div,
    initial: { y: '100%', opacity: 1 },
    animate: { y: 0, opacity: 1 },
    exit: { y: '100%', opacity: 1 },
    transition: { duration: motionDurations.page, ease: motionEasings.easeOut },
    drag: 'y',
    dragControls: sheetDragControls,
    dragListener: false,
    dragConstraints: { top: 0 },
    dragElastic: { top: 0, bottom: 0.25 },
    onDragEnd: handleSheetDragEnd,
  } as any) : {}

  const selectedProducts = useMemo(() => userProducts.filter(p => selectedOfferIds.includes(p.id)), [userProducts, selectedOfferIds])
  const visibleProducts = useMemo(() => {
    const hidden = new Set(['traded', 'sold', 'locked', 'suspended', 'deleted'])
    return userProducts
      .filter(p => p.title.toLowerCase().includes(searchTerm) && !hidden.has(p.status))
      .sort((a, b) => {
        const aOff = a.status !== 'available' || committedProductIds.has(a.id)
        const bOff = b.status !== 'available' || committedProductIds.has(b.id)
        return aOff === bOff ? 0 : aOff ? 1 : -1
      })
  }, [userProducts, searchTerm, committedProductIds])
  const selectedOfferIdSet = useMemo(() => new Set(selectedOfferIds), [selectedOfferIds])
  const visibleSellerProducts = useMemo(() => {
    const hidden = new Set(['traded', 'sold', 'locked', 'suspended', 'deleted'])
    return sellerProducts
      .filter(p => p.title.toLowerCase().includes(targetSearchTerm) && !hidden.has(p.status))
      .sort((a, b) => {
        const aOff = a.status !== 'available'
        const bOff = b.status !== 'available'
        return aOff === bOff ? 0 : aOff ? 1 : -1
      })
  }, [sellerProducts, targetSearchTerm])

  const selectedTargetProducts = useMemo(() => {
    if (!targetProduct) return []
    return [
      targetProduct,
      ...sellerProducts.filter(p => additionalTargetIds.includes(p.id)),
    ]
  }, [additionalTargetIds, sellerProducts, targetProduct])

  const selectedTargetLocationKeys = useMemo(
    () => new Set(selectedTargetProducts.map(getProductLocationKey).filter(key => key && key !== 'none')),
    [selectedTargetProducts]
  )

  const selectedTargetsHaveDifferentLocations = selectedTargetLocationKeys.size > 1
  const selectedTargetsNeedLocationPlan = selectedTargetProducts.length > 1 && selectedTargetsHaveDifferentLocations
  const resolveProductTradeValue = (product: Product): number | null => {
    const askingPrice = Number(product.price)
    if (Number.isFinite(askingPrice) && askingPrice > 0) return askingPrice

    const min = Number(product.estimated_value_min)
    const max = Number(product.estimated_value_max)
    if (Number.isFinite(min) && min > 0 && Number.isFinite(max) && max > 0) return Math.round((min + max) / 2)
    if (Number.isFinite(min) && min > 0) return min
    if (Number.isFinite(max) && max > 0) return max
    return null
  }
  const summarizeTradeValue = (products: Product[]) => {
    if (products.length === 0) return { total: null as number | null, unavailable: true }
    const values = products.map(resolveProductTradeValue)
    const unavailable = values.some(value => value === null)
    return {
      total: unavailable ? null : values.reduce<number>((sum, value) => sum + (value ?? 0), 0),
      unavailable,
    }
  }
  const requestedValueSummary = useMemo(() => summarizeTradeValue(selectedTargetProducts), [selectedTargetProducts])
  const offeredValueSummary = useMemo(() => summarizeTradeValue(selectedProducts), [selectedProducts])
  const valueDifference = requestedValueSummary.total !== null && offeredValueSummary.total !== null
    ? offeredValueSummary.total - requestedValueSummary.total
    : null
  const formatPesoValue = (value: number | null) => (
    value === null ? 'Estimate unavailable' : `₱${Math.round(value).toLocaleString()} total`
  )
  const formatPesoDifference = (value: number | null) => (
    value === null ? 'Estimate unavailable' : `₱${Math.abs(Math.round(value)).toLocaleString()}`
  )
  const fairnessHint = (() => {
    if (valueDifference === null || requestedValueSummary.total === null || offeredValueSummary.total === null) {
      return 'This is only a guide to help you judge fairness.'
    }
    const largerValue = Math.max(requestedValueSummary.total, offeredValueSummary.total, 1)
    const closeThreshold = Math.max(500, largerValue * 0.15)
    if (Math.abs(valueDifference) <= closeThreshold) return 'Looks like a balanced trade.'
    if (valueDifference < 0) return 'You may need to offer more items or a better match.'
    return 'You may be offering more value than requested.'
  })()
  const fmtTime = (t: string) => {
    const [h, m] = t.split(':').map(Number)
    const ampm = h >= 12 ? 'PM' : 'AM'
    const hour = h % 12 || 12
    return m === 0 ? `${hour}:00 ${ampm}` : `${hour}:${String(m).padStart(2, '0')} ${ampm}`
  }

  const collectionSetup = useMemo<CollectionSetup>(() => {
    const raw = (targetProduct as any)?.collection_setup
    if (!raw) {
      return {
        methods: ['pickup', 'meetup'],
        pickup: { days: [], time_start: '', time_end: '' },
        meetup: { locations: [], days: [], time_start: '', time_end: '' },
      }
    }
    try {
      return typeof raw === 'string' ? JSON.parse(raw) : raw
    } catch {
      return {
        methods: ['pickup', 'meetup'],
        pickup: { days: [], time_start: '', time_end: '' },
        meetup: { locations: [], days: [], time_start: '', time_end: '' },
      }
    }
  }, [targetProduct])
  const enabledCollectionMethods = collectionSetup.methods?.length ? collectionSetup.methods : ['pickup', 'meetup']
  const pickupEnabled = enabledCollectionMethods.includes('pickup')
  const meetupEnabled = enabledCollectionMethods.includes('meetup')
  const dayLabels: Record<string, string> = {
    weekdays: 'Weekdays',
    weekends: 'Weekends',
    monday: 'Mon',
    tuesday: 'Tue',
    wednesday: 'Wed',
    thursday: 'Thu',
    friday: 'Fri',
    saturday: 'Sat',
    sunday: 'Sun',
  }
  const formatCollectionDays = (days?: string[]) => (days && days.length > 0 ? days.map(day => dayLabels[day] || day).join(', ') : 'Any day')
  const formatCollectionWindow = (start?: string, end?: string) => start && end ? `${fmtTime(start)} - ${fmtTime(end)}` : 'Flexible time'
  const preferredMeetupLocationPoints: MeetupPoint[] = ((collectionSetup.meetup as any)?.location_points || [])
    .map((point: any) => ({
      name: String(point.name || '').trim(),
      address: String(point.address || '').trim(),
      lat: Number(point.lat),
      lng: Number(point.lng),
    }))
    .filter((point: any) => point.name && point.address && Number.isFinite(point.lat) && Number.isFinite(point.lng))
    .slice(0, 3)
  const preferredMeetupLocations = preferredMeetupLocationPoints.length
    ? preferredMeetupLocationPoints.map((point) => `${point.name} - ${point.address}`)
    : (collectionSetup.meetup?.locations || []).map(location => location.trim()).filter(Boolean)

  // For meetup: pick the first offered product that has location data
  const myProductForMeetup = useMemo(
    () => selectedProducts.find(p => getProductRawLocation(p)) ?? null,
    [selectedProducts]
  )

  // Extract coords from a product (prefers pickup coords, falls back to general coords)
  const getProductCoords = (p: Partial<Product> | null): { lat: number; lng: number } | null => {
    if (!p) return null
    const lat = (p as any).pickup_latitude ?? (p as any).latitude
    const lng = (p as any).pickup_longitude ?? (p as any).longitude
    return lat != null && lng != null ? { lat: Number(lat), lng: Number(lng) } : null
  }
  const selectedTargetPickupOptions = useMemo(() => {
    const seen = new Set<string>()
    return selectedTargetProducts
      .map((product) => ({
        product,
        key: getProductLocationKey(product),
        label: getProductRawLocation(product) || getProductLocationLabel(product),
        coords: getProductCoords(product),
      }))
      .filter((option) => option.label && option.key !== 'none')
      .filter((option) => {
        if (seen.has(option.key)) return false
        seen.add(option.key)
        return true
      })
  }, [selectedTargetProducts])
  const selectedPickupProduct = useMemo(() => {
    if (!selectedTargetsNeedLocationPlan) return targetProduct
    return selectedTargetPickupOptions.find(option => option.product.id === pickupLocationProductId)?.product || null
  }, [pickupLocationProductId, selectedTargetPickupOptions, selectedTargetsNeedLocationPlan, targetProduct])
  const selectedPickupCoords = getProductCoords(selectedPickupProduct)
  const userCoords = user?.latitude != null && user?.longitude != null
    ? { lat: Number(user.latitude), lng: Number(user.longitude) }
    : null
  const pickupDistanceLabel = selectedPickupCoords && userCoords
    ? formatDistance(distanceMeters(userCoords, selectedPickupCoords))
    : 'Distance unavailable'

  const searchMeetupLocations = async (query: string) => {
    if (query.trim().length < 2) {
      setMeetupSearchResults([])
      setShowMeetupSearchDropdown(false)
      return
    }
    setIsSearchingMeetupLocation(true)
    try {
      const response = await fetch(buildPhilippinesSearchUrl(query, 5))
      const results = await response.json()
      const formatted = (Array.isArray(results) ? results : [])
        .map((r: any) => ({
          name: r.name || String(r.display_name || '').split(',')[0],
          address: r.display_name,
          lat: parseFloat(r.lat),
          lng: parseFloat(r.lon),
          countryCode: String(r.address?.country_code || '').toLowerCase(),
        }))
        .filter((r: any) => r.address && r.countryCode === 'ph' && isInPhilippines(r.lat, r.lng))
        .map(({ name, address, lat, lng }: any) => ({ name, address, lat, lng }))
      setMeetupSearchResults(formatted)
      setShowMeetupSearchDropdown(true)
    } catch {
      setMeetupSearchResults([])
    } finally {
      setIsSearchingMeetupLocation(false)
    }
  }

  // Midpoint between offered product and target product (only when both have coords)
  const meetupMidpointCoords = useMemo(() => {
    const mine = getProductCoords(myProductForMeetup)
    const theirs = getProductCoords(targetProduct)
    if (!mine || !theirs) return null
    return { lat: (mine.lat + theirs.lat) / 2, lng: (mine.lng + theirs.lng) / 2 }
  }, [myProductForMeetup, targetProduct])

  // Resolved human-readable meetup address for the selected choice
  const resolvedMeetupAddress = useMemo(() => {
    if (meetupChoice === 'my_product') return getProductRawLocation(myProductForMeetup)
    if (meetupChoice === 'their_product') return getProductRawLocation(targetProduct)
    if (meetupChoice === 'midpoint') return midpointLabel || null
    if (meetupChoice === 'custom') return customMeetupPoint ? `${customMeetupPoint.name} - ${customMeetupPoint.address}` : customMeetupAddress.trim() || null
    return null
  }, [meetupChoice, myProductForMeetup, targetProduct, midpointLabel, customMeetupAddress, customMeetupPoint])

  const resolvedMeetupCoords = useMemo(() => {
    if (meetupChoice === 'my_product') return getProductCoords(myProductForMeetup)
    if (meetupChoice === 'their_product') return getProductCoords(targetProduct)
    if (meetupChoice === 'midpoint') return meetupMidpointCoords
    if (meetupChoice === 'custom') return customMeetupPoint ? { lat: customMeetupPoint.lat, lng: customMeetupPoint.lng } : null
    return null
  }, [meetupChoice, meetupMidpointCoords, myProductForMeetup, targetProduct, customMeetupPoint])

  // OSM map link for selected meetup point
  const meetupMapUrl = useMemo(() => {
    if (meetupChoice === 'my_product') {
      const c = getProductCoords(myProductForMeetup)
      return c ? `https://www.openstreetmap.org/?mlat=${c.lat}&mlon=${c.lng}&zoom=15` : null
    }
    if (meetupChoice === 'their_product') {
      const c = getProductCoords(targetProduct)
      return c ? `https://www.openstreetmap.org/?mlat=${c.lat}&mlon=${c.lng}&zoom=15` : null
    }
    if (meetupChoice === 'midpoint' && meetupMidpointCoords) {
      return `https://www.openstreetmap.org/?mlat=${meetupMidpointCoords.lat}&mlon=${meetupMidpointCoords.lng}&zoom=14`
    }
    if (meetupChoice === 'custom' && customMeetupPoint) {
      return `https://www.openstreetmap.org/?mlat=${customMeetupPoint.lat}&mlon=${customMeetupPoint.lng}&zoom=15`
    }
    return null
  }, [meetupChoice, myProductForMeetup, targetProduct, meetupMidpointCoords, customMeetupPoint])

  // Parse seller's availability slots from target product
  const sellerAvailabilitySlots = useMemo<AvailabilitySlot[]>(() => {
    if (!targetProduct) return []
    const raw = (targetProduct as any).availability_slots
    if (!raw) return []
    try {
      const slots: AvailabilitySlot[] = typeof raw === 'string' ? JSON.parse(raw) : raw
      const today = new Date().toISOString().split('T')[0]
      return Array.isArray(slots) ? slots.filter(s => s.date >= today) : []
    } catch {
      return []
    }
  }, [targetProduct])

  const sellerAvailabilityType = (targetProduct as any)?.availability_type as 'flexible' | 'strict' | undefined
  const currentAvailabilitySlots = useMemo(
    () => sellerAvailabilitySlots.filter(slot => {
      const method = (slot as any).method
      return !method || !tradeOption || method === tradeOption
    }).sort((a, b) => `${a.date}T${a.start_time}`.localeCompare(`${b.date}T${b.start_time}`)),
    [sellerAvailabilitySlots, tradeOption]
  )

  const formatCompactSlotTime = (time: string) => {
    const [hour, minute] = time.split(':').map(Number)
    const ampm = hour >= 12 ? 'PM' : 'AM'
    const displayHour = hour % 12 || 12
    return minute === 0 ? `${displayHour}${ampm}` : `${displayHour}:${String(minute).padStart(2, '0')}${ampm}`
  }

  const formatSlotDate = (date: string) => {
    const d = new Date(`${date}T00:00:00`)
    return d.toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' })
  }

  const selectAvailabilitySlot = (slot: AvailabilitySlot | null) => {
    if (!slot) return
    setSelectedSlotId(slot.id)
    setMeetupDate(slot.date)
    setMeetupTime(slot.start_time)
  }

  const pickupSlotsByDate = useMemo(() => {
    const groups = new Map<string, AvailabilitySlot[]>()
    currentAvailabilitySlots.forEach(slot => {
      const dateSlots = groups.get(slot.date) || []
      dateSlots.push(slot)
      groups.set(slot.date, dateSlots)
    })
    return Array.from(groups.entries()).map(([date, slots]) => ({
      date,
      slots: slots.sort((a, b) => a.start_time.localeCompare(b.start_time)),
    }))
  }, [currentAvailabilitySlots])

  const visiblePickupDateGroups = showMorePickupDates ? pickupSlotsByDate : pickupSlotsByDate.slice(0, 5)
  const pickupSlotsForSelectedDate = useMemo(
    () => pickupSlotsByDate.find(group => group.date === meetupDate)?.slots || [],
    [pickupSlotsByDate, meetupDate]
  )

  const hasFixedLocation = useMemo(() => {
    return selectedTargetProducts.some((product) => {
      const locationType = product.location_type
      const safeLocation = getProductRawLocation(product)
      if ((locationType === 'current_location' || locationType === 'pickup_location') && safeLocation) return true
      if (safeLocation) return true
      return false
    })
  }, [selectedTargetProducts])

  const isTargetLoading = !!targetProductId && !targetProduct

  // Fetch target product details
  useEffect(() => {
    if (!isOpen || !targetProductId) {
      setTargetProduct(null)
      return
    }
    ; (async () => {
      try {
        const res = await api.get(`/api/products/${targetProductId}`)
        const product = res.data?.data?.product || res.data?.data
        setTargetProduct(product)
      } catch (_) {
        setTargetProduct(null)
      }
    })()
  }, [isOpen, targetProductId])

  useEffect(() => {
    if (!isOpen) return
    const existingOfferIds = (editTrade?.items || [])
      .filter((item) => (item.offered_by || '').toLowerCase() === 'buyer')
      .map((item) => Number(item.product_id))
      .filter((id) => Number.isFinite(id) && id > 0)
    setSelectedOfferIds(existingOfferIds)
    setSearchTerm('')
    setTradeMessage(editTrade?.message || '')
    setCashAmount(editTrade?.offered_cash_amount ? String(editTrade.offered_cash_amount) : '')
    setCashError('')
    setTradeOption((editTrade?.meeting_type || editTrade?.trade_option || null) as TradeOption | 'pickup' | null)
    setHasPendingOfferOnTarget(false)
    setDetectedCoords(null)
    setDetectedLocationLabel('')
    setProfileLocationLabel('')
    setManualAddress('')
    setDetectingLocation(false)
    setCommittedProductIds(new Set())
    setAdditionalTargetIds([])
    setSellerProducts([])
    setTargetSearchTerm('')
    setPickupLocationProductId(null)
    setScheduleAgreed(false)
    setMobileStep(0)
    setSelectedSlotId(null)
    setShowMorePickupDates(false)
    if (user && targetProductId) {
      ; (async () => {
        try {
          setLoadingPendingCheck(true)
          const [tradeRes, productRes] = await Promise.all([
            api.get(`/api/trades?limit=1000`),
            api.get(`/api/products/user/${user.id}?page=1&limit=100`),
          ])

          const trades = Array.isArray(tradeRes.data?.data) ? tradeRes.data.data : []
          const activeStatuses = new Set(['pending', 'pending_multiway', 'accepted_by_one', 'countered', 'accepted', 'active', 'ongoing', 'awaiting_confirmation', 'multiway_active'])
          const hasPending = trades.some((trade: any) =>
            trade.buyer_id === user.id &&
            trade.target_product_id === targetProductId &&
            trade.id !== editTrade?.id &&
            activeStatuses.has(trade.status)
          )
          const committedIds = new Set<number>()
          trades.forEach((trade: any) => {
            if (trade.id === editTrade?.id || !activeStatuses.has(trade.status)) return
            const targetId = Number(trade.target_product_id)
            if (Number.isFinite(targetId) && targetId > 0) committedIds.add(targetId)
            ;(trade.items || []).forEach((item: any) => {
              const productId = Number(item.product_id)
              if (Number.isFinite(productId) && productId > 0) committedIds.add(productId)
            })
          })
          setHasPendingOfferOnTarget(hasPending)
          setCommittedProductIds(committedIds)

          const data = productRes.data?.data
          const list: Product[] = Array.isArray(data?.data) ? data.data : []
          setUserProducts(list)
        } catch (_) {
          setUserProducts([])
          setCommittedProductIds(new Set())
        } finally {
          setLoadingPendingCheck(false)
        }
      })()
    } else {
      setUserProducts([])
      setCommittedProductIds(new Set())
    }
  }, [isOpen, user, targetProductId, editTrade])

  useEffect(() => {
    if (!isOpen || editTrade || !targetProduct) return
    if (pickupEnabled && !meetupEnabled) setTradeOption('pickup')
    if (!pickupEnabled && meetupEnabled) setTradeOption('meetup')
  }, [editTrade, isOpen, meetupEnabled, pickupEnabled, targetProduct])

  useEffect(() => {
    if (!selectedTargetsNeedLocationPlan) {
      setPickupLocationProductId(null)
    }
  }, [selectedTargetsNeedLocationPlan])

  useEffect(() => {
    if (!selectedTargetsNeedLocationPlan || selectedTargetPickupOptions.length === 0) return
    const stillValid = selectedTargetPickupOptions.some(option => option.product.id === pickupLocationProductId)
    if (!stillValid) {
      setPickupLocationProductId(selectedTargetPickupOptions[0].product.id)
    }
  }, [pickupLocationProductId, selectedTargetPickupOptions, selectedTargetsNeedLocationPlan])

  useEffect(() => {
    if (!isOpen || !user?.latitude || !user?.longitude) return

    let cancelled = false
    ;(async () => {
      const address = await reverseGeocodeToAddress(user.latitude as number, user.longitude as number)
      if (!cancelled) {
        setProfileLocationLabel(address)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [isOpen, user?.latitude, user?.longitude])

  useEffect(() => {
    setSelectedSlotId(null)
    setShowMorePickupDates(false)
    if (tradeOption !== 'meetup') {
      setMeetupChoice(null)
      setCustomMeetupAddress('')
      setCustomMeetupPoint(null)
      setMeetupSearchQuery('')
      setMeetupSearchResults([])
      setShowMeetupSearchDropdown(false)
      setMeetupDate('')
      setMeetupTime('')
      setMidpointLabel('')
    }
  }, [tradeOption])

  // Reverse-geocode the midpoint when the user selects that option
  useEffect(() => {
    if (meetupChoice === 'midpoint' && meetupMidpointCoords && !midpointLabel) {
      setLoadingMidpoint(true)
      reverseGeocodeToAddress(meetupMidpointCoords.lat, meetupMidpointCoords.lng)
        .then(label => { setMidpointLabel(label); setLoadingMidpoint(false) })
        .catch(() => setLoadingMidpoint(false))
    }
  }, [meetupChoice, meetupMidpointCoords, midpointLabel])

  // Fetch the other trader's products so users can request one or more items.
  useEffect(() => {
    if (!targetProduct?.seller_id || !isOpen) {
      setSellerProducts([])
      return
    }
    ;(async () => {
      setLoadingSellerProducts(true)
      try {
        const res = await api.get(`/api/products/user/${targetProduct.seller_id}?page=1&limit=100`)
        const data = res.data?.data
        const list: Product[] = Array.isArray(data?.data) ? data.data : []
        setSellerProducts(list.filter(p => p.id !== targetProductId))
      } catch (_) {
        setSellerProducts([])
      } finally {
        setLoadingSellerProducts(false)
      }
    })()
  }, [targetProduct?.seller_id, isOpen, targetProductId])

  const toggleAdditionalTarget = (productId: number) => {
    setAdditionalTargetIds(prev =>
      prev.includes(productId) ? prev.filter(id => id !== productId) : [...prev, productId]
    )
  }

  const getTargetUnavailableReason = (product: Product) => {
    if (product.status !== 'available') return product.status === 'locked' ? 'Locked' : 'Unavailable'
    return ''
  }

  const getUnavailableReason = (product: Product) => {
    if (selectedOfferIdSet.has(product.id)) return ''
    if (committedProductIds.has(product.id)) return 'Already offered'
    if (product.status !== 'available') return 'Locked'
    return ''
  }

  const toggleOfferSelection = (product: Product) => {
    const unavailableReason = getUnavailableReason(product)
    if (unavailableReason) {
      toast({
        id: `trademodal-product-disabled-${product.id}`,
        title: unavailableReason,
        description: unavailableReason === 'Already offered'
          ? 'Cancel the related sent offer before using this item again.'
          : 'This item cannot be offered right now.',
        status: 'info',
        duration: 2500,
        isClosable: true,
      })
      return
    }

    const id = product.id
    setSelectedOfferIds(prev => {
      if (prev.includes(id)) {
        return prev.filter(x => x !== id)
      }
      
      // Check limit
      const limit = targetProduct?.max_items_per_offer || 0
      if (limit > 0 && prev.length >= limit) {
        toast({
          id: 'trademodal-selection-limit',
          title: 'Selection Limit Reached',
          description: `You can only select up to ${limit} items for this trade.`,
          status: 'warning',
          duration: 3000,
          isClosable: true,
        })
        return prev
      }
      
      return [...prev, id]
    })
  }

  const normalizeCashAmount = (value: string) => {
    const cleaned = value.replace(/[^\d]/g, '')
    if (!cleaned) return ''
    return String(Number(cleaned))
  }

  const handleCashAmountChange = (value: string) => {
    if (/[.eE+-]/.test(value)) {
      setCashAmount(value)
      setCashError('Enter a clean whole PHP amount')
      return
    }
    const normalized = normalizeCashAmount(value)
    setCashAmount(normalized)
    if (!normalized) {
      setCashError('')
      return
    }
    const amount = Number(normalized)
    setCashError(amount > 0 ? '' : 'Offer money must be greater than 0')
  }

  const getValidCashAmount = () => {
    if (!cashAmount.trim()) return undefined
    const normalized = normalizeCashAmount(cashAmount)
    const amount = Number(normalized)
    if (!normalized || !Number.isInteger(amount) || amount <= 0) {
      return null
    }
    return amount
  }

  // Resolved delivery address for payload submission
  const resolvedDeliveryAddress = (): string | undefined => {
    if (detectedLocationLabel.trim()) return detectedLocationLabel.trim()
    if (detectedCoords) return formatCoordinates(detectedCoords.lat, detectedCoords.lng)
    if (profileLocationLabel.trim()) return profileLocationLabel.trim()
    if (user?.latitude && user?.longitude) return formatCoordinates(user.latitude, user.longitude)
    if (manualAddress.trim()) return manualAddress.trim()
    return undefined
  }

  const hasDeliveryLocation = !!(
    (user?.latitude && user?.longitude) || detectedCoords || manualAddress.trim()
  )

  const handleDetectLocation = () => {
    if (!navigator.geolocation) {
      toast({
        id: "trademodal-geolocation-not-supported", title: 'Geolocation not supported', description: 'Your browser does not support location detection.', status: 'error' })
      return
    }
    setDetectingLocation(true)
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = position.coords.latitude
        const lng = position.coords.longitude
        setDetectedCoords({ lat, lng })
        const address = await reverseGeocodeToAddress(lat, lng)
        setDetectedLocationLabel(address)
        setDetectingLocation(false)
        toast({
        id: "trademodal-location-detected", title: 'Location detected!', description: address, status: 'success', duration: 2500 })
      },
      (error) => {
        setDetectingLocation(false)
        const messages: Record<number, string> = {
          1: 'Location permission denied. Please enter your address manually.',
          2: 'Unable to determine your position. Please enter your address manually.',
          3: 'Location request timed out. Please enter your address manually.',
        }
        toast({
        id: "trademodal-location-error", title: 'Location error', description: messages[error.code] || 'Could not detect location.', status: 'warning', duration: 4000 })
      },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  const submitTrade = async () => {
    if (!targetProductId || selectedOfferIds.length === 0) {
      toast({
        id: "trademodal-select-items", title: 'Select items', description: 'Please select at least one of your items to offer.', status: 'warning' })
      return
    }

    if (!tradeOption) {
      toast({
        id: "trademodal-select-option", title: 'Select method', description: 'Please select Meetup or Pickup.', status: 'warning' })
      return
    }

    if (tradeOption === 'pickup' && selectedTargetsNeedLocationPlan && !selectedPickupProduct) {
      toast({
        id: "trademodal-pickup-location-choice",
        title: 'Choose pickup location',
        description: 'These items have different pickup locations. Please choose one location for this trade.',
        status: 'warning',
        duration: 3500,
      })
      return
    }
    if (selectedTargetProducts.length > 0 && !scheduleAgreed) {
      toast({
        id: 'trademodal-schedule-ack',
        title: 'Confirm location & schedule',
        description: selectedTargetsNeedLocationPlan
          ? 'These items have different pickup locations. Please choose one location for this trade, then confirm the selected plan.'
          : tradeOption === 'pickup'
          ? 'Please confirm you agree to go to the pickup location at the selected time.'
          : 'Please check the box confirming you agree with the location and preferred schedule.',
        status: 'warning',
        duration: 3500,
      })
      return
    }

    // Layer 2 validation: Check for pending offer before submission
    if (hasPendingOfferOnTarget) {
      toast({
        id: "trademodal-pending-offer-already-exists",
        title: 'Pending Offer Already Exists',
        description: 'You already have a pending offer on this product. Please wait for the trader to respond to your existing offer before sending another one.',
        status: 'warning',
        duration: 4000,
        isClosable: true
      })
      return
    }

    const offeredCashAmount = getValidCashAmount()
    if (offeredCashAmount === null || cashError) {
      setCashError('Enter a clean whole PHP amount greater than 0')
      toast({
        id: "trademodal-invalid-cash",
        title: 'Invalid offer money',
        description: 'Enter a clean whole PHP amount greater than 0.',
        status: 'warning',
      })
      return
    }

    try {
      setSubmittingTrade(true)

      const pickupProduct = selectedPickupProduct || targetProduct
      const pickupLocation = getProductRawLocation(pickupProduct) || ''
      const proposedMeetupLocation = tradeOption === 'pickup'
        ? pickupLocation.trim()
        : (resolvedMeetupAddress || '').trim()
      const proposedMeetupCoords = tradeOption === 'pickup' ? getProductCoords(pickupProduct) : resolvedMeetupCoords
      const proposedMeetupDate = meetupDate.trim()
      const proposedMeetupTime = meetupTime.trim()
      if (sellerAvailabilityType === 'strict' && currentAvailabilitySlots.length > 0 && !selectedSlotId) {
        toast({
          id: "trademodal-slot-required",
          title: 'Pick an available slot',
          description: "This seller uses a fixed schedule. Choose one of the available slots before sending the offer.",
          status: 'warning',
        })
        return
      }
      if (!proposedMeetupLocation || !proposedMeetupDate || !proposedMeetupTime) {
        toast({
          id: "trademodal-logistics-required",
          title: 'Collection details required',
          description: 'Choose a collection location, date, and time from the owner setup.',
          status: 'warning',
        })
        return
      }

      // Append meetup preference and proposed time to message so the other trader can see it
      let finalMessage = tradeMessage
      if (tradeOption === 'meetup' && (resolvedMeetupAddress || (meetupDate && meetupTime))) {
        const parts: string[] = []
        if (resolvedMeetupAddress) {
          const choiceLabel =
            meetupChoice === 'my_product' ? 'Near my item' :
            meetupChoice === 'their_product' ? 'Near their item' :
            meetupChoice === 'midpoint' ? 'Suggested midpoint' : 'Custom location'
          parts.push(`📍 Preferred meetup: ${choiceLabel} — ${resolvedMeetupAddress}`)
        }
        if (meetupDate && meetupTime) {
          try {
            const dateLabel = new Date(`${meetupDate}T${meetupTime}`).toLocaleString('en-PH', {
              weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
            })
            parts.push(`🗓️ Proposed time: ${dateLabel}`)
          } catch (_) {
            parts.push(`🗓️ Proposed time: ${meetupDate} at ${meetupTime}`)
          }
        }
        if (parts.length > 0) {
          finalMessage = [tradeMessage, ...parts].filter(Boolean).join('\n')
        }
      }

      const payload: TradeCreate = {
        target_product_id: targetProductId,
        offered_product_ids: selectedOfferIds,
        message: finalMessage,
        offered_cash_amount: offeredCashAmount || undefined,
        trade_option: 'meetup',
        meeting_type: tradeOption === 'pickup' ? 'pickup' : 'meetup',
        ...(additionalTargetIds.length > 0 && {
          additional_target_product_ids: additionalTargetIds,
        }),
        ...(proposedMeetupLocation && { meetup_location: proposedMeetupLocation }),
        ...(proposedMeetupLocation && { meetup_label: proposedMeetupLocation }),
        ...(proposedMeetupDate && { meetup_date: proposedMeetupDate }),
        ...(proposedMeetupTime && { meetup_time: proposedMeetupTime }),
        ...(proposedMeetupCoords && { meetup_lat: proposedMeetupCoords.lat, meetup_lng: proposedMeetupCoords.lng }),
        ...(selectedSlotId && { selected_availability_slot_id: selectedSlotId }),
      }
      if (isEditMode && editTrade?.id) {
        await updateTrade(editTrade.id, {
          action: 'edit_offer',
          offered_product_ids: selectedOfferIds,
          message: finalMessage,
          offered_cash_amount: offeredCashAmount || undefined,
          trade_option: 'meetup',
          meeting_type: tradeOption === 'pickup' ? 'pickup' : 'meetup',
          payment_method: editTrade.payment_method,
          ...(proposedMeetupLocation && { meetup_location: proposedMeetupLocation }),
          ...(proposedMeetupLocation && { meetup_label: proposedMeetupLocation }),
          ...(proposedMeetupDate && { meetup_date: proposedMeetupDate }),
          ...(proposedMeetupTime && { meetup_time: proposedMeetupTime }),
          ...(proposedMeetupCoords && { meetup_lat: proposedMeetupCoords.lat, meetup_lng: proposedMeetupCoords.lng }),
          ...(selectedSlotId && { selected_availability_slot_id: selectedSlotId }),
        })
      } else {
        await api.post('/api/trades', payload)
      }

      // Invalidate dashboard cache so sent offers show immediately
      invalidateOffers()
      invalidateDashboard()
      await queryClient.refetchQueries({ queryKey: DASHBOARD_QUERY_KEYS.sentOffers })

      showNotification(isEditMode ? 'Trade Offer Updated' : 'Trade Offer Sent', 'success')
      setSelectedOfferIds([])
      setTradeMessage('')
      setCashAmount('')
      setTradeOption(null)
      setDetectedCoords(null)
      setManualAddress('')
      setAdditionalTargetIds([])
      setSellerProducts([])
      setTargetSearchTerm('')
      onClose()
    } catch (e: any) {
      const errorMessage = e?.response?.data?.error || (isEditMode ? 'Failed to update trade' : 'Failed to send trade')
      toast({
        id: "trademodal-failed", title: 'Failed', description: errorMessage, status: 'error' })
    } finally {
      setSubmittingTrade(false)
    }
  }

  const strictSlotSatisfied = sellerAvailabilityType !== 'strict' || currentAvailabilitySlots.length === 0 || !!selectedSlotId
  const pickupLocationChoiceSatisfied = tradeOption !== 'pickup' || !selectedTargetsNeedLocationPlan || !!selectedPickupProduct
  const canConfirm = selectedOfferIds.length > 0 && !!tradeOption && !!meetupDate && !!meetupTime && strictSlotSatisfied && (tradeOption === 'pickup' || !!resolvedMeetupAddress) && pickupLocationChoiceSatisfied && (selectedTargetProducts.length === 0 || scheduleAgreed)
  const mobileSteps = ['Trading For', 'My Offered Items', 'Trade Details', 'Review']

  const selectedSummary = selectedProducts.length > 0 ? (
    <Box bg={selectedBg} borderWidth="1px" borderColor="green.200" borderRadius="md" p={2}>
      <HStack justify="space-between" mb={selectedProducts.length > 1 ? 2 : 0}>
        <Text fontSize="11px" fontWeight="700" color={selectedTextColor}>
          Selected: {selectedOfferIds.length} item{selectedOfferIds.length === 1 ? '' : 's'}
          {targetProduct?.max_items_per_offer ? ` / ${targetProduct.max_items_per_offer}` : ''}
        </Text>
        {selectedOfferIds.length > 1 && <Badge colorScheme="green" variant="subtle">Bundle</Badge>}
      </HStack>
      {selectedProducts.length > 0 && (
        <HStack spacing={1.5} overflowX="auto" pb={1} sx={{ scrollbarWidth: 'thin' }}>
          {selectedProducts.map((product) => (
            <HStack key={product.id} flex="0 0 auto" maxW="170px" bg="white" borderRadius="md" borderWidth="1px" borderColor="green.100" px={2} py={1.5} spacing={2}>
              <Image src={getFirstImage(product.image_urls)} alt={product.title} w="28px" h="28px" objectFit="cover" rounded="md" loading="lazy" />
              <Text fontSize="10px" fontWeight="600" color="gray.700" noOfLines={1}>{product.title}</Text>
              <Icon as={FaTimes} boxSize={2.5} color="green.600" cursor="pointer" onClick={() => toggleOfferSelection(product)} />
            </HStack>
          ))}
        </HStack>
      )}
    </Box>
  ) : null

  const targetSection = (
    <VStack spacing={3} align="stretch" h="full" minH={0}>
      {isTargetLoading ? (
        <Card variant="outline" borderColor={borderColor}>
          <CardBody p={3}>
            <HStack spacing={2} align="center">
              <Spinner size="sm" />
              <Text fontSize="11px" color={mutedTextColor}>Loading trade details...</Text>
            </HStack>
          </CardBody>
        </Card>
      ) : targetProduct ? (
        <Card variant="outline" bg={targetCardBg} borderColor={targetCardBorderColor} flexShrink={0}>
          <CardBody p={3}>
            <VStack spacing={2.5} align="stretch">
              <HStack justify="space-between" align="center">
                <Text fontSize="10px" fontWeight="bold" color={targetLabelColor} textTransform="uppercase" letterSpacing="0.5px">
                  Trading For: {additionalTargetIds.length + 1} Item{additionalTargetIds.length > 0 ? 's' : ''}
                </Text>
              </HStack>
              <HStack spacing={3} align="start">
                <Image src={getFirstImage(targetProduct.image_urls)} alt={targetProduct.title} w={{ base: '56px', md: '64px' }} h={{ base: '56px', md: '64px' }} objectFit="cover" rounded="md" loading="lazy" flexShrink={0} />
                <VStack spacing={1} align="start" flex={1} minW={0}>
                  <Text fontWeight="700" fontSize="13px" wordBreak="break-word" noOfLines={2}>{targetProduct.title}</Text>
                  <Text fontSize="10px" color="gray.500" noOfLines={2} wordBreak="break-word">{targetProduct.description}</Text>
                  <HStack spacing={1} color="blue.700" align="start">
                    <Icon as={FaMapMarkerAlt} boxSize={3} mt="1px" flexShrink={0} />
                    <Text fontSize="10px" fontWeight="600" noOfLines={2}>{getProductLocationLabel(targetProduct)}</Text>
                  </HStack>
                  {targetProduct.bidding_type && targetProduct.bidding_type !== 'none' && <Badge colorScheme={targetProduct.bidding_type === 'blind' ? 'orange' : 'green'} fontSize="9px">{targetProduct.bidding_type === 'blind' ? 'Blind Bidding' : 'Open Bidding'}</Badge>}
                </VStack>
              </HStack>
            </VStack>
          </CardBody>
        </Card>
      ) : null}

      <VStack spacing={2} align="stretch" minH={0}>
          <Box>
            <HStack justify="space-between" align="center">
              <Text fontSize="11px" color="blue.600" fontWeight="700">Requested items: {additionalTargetIds.length + 1} selected</Text>
              {additionalTargetIds.length > 0 && <Badge colorScheme="blue" variant="subtle">Bundle request</Badge>}
            </HStack>
            <Text fontSize="10px" color={mutedTextColor} mt={0.5}>You can select more than one item for a bundle trade.</Text>
          </Box>
          {additionalTargetIds.length > 0 && (
            <Box bg="blue.50" borderWidth="1px" borderColor="blue.100" borderRadius="md" px={2.5} py={2}>
              <Text fontSize="10px" color="blue.700" fontWeight="700">You’re requesting multiple items from this trader.</Text>
            </Box>
          )}
          {additionalTargetIds.length > 0 && (
            <HStack spacing={1.5} overflowX="auto" pb={1} sx={{ scrollbarWidth: 'thin' }}>
              {sellerProducts.filter(p => additionalTargetIds.includes(p.id)).map(p => (
                <HStack key={p.id} flex="0 0 auto" bg="blue.100" borderRadius="md" px={2} py={1.5} spacing={2} maxW="180px">
                  <Image src={getFirstImage(p.image_urls)} alt={p.title} w="28px" h="28px" objectFit="cover" rounded="md" loading="lazy" />
                  <VStack spacing={0} align="start" minW={0}>
                    <Text fontSize="10px" fontWeight="700" noOfLines={1}>{p.title}</Text>
                    <Text fontSize="9px" color="blue.700" noOfLines={1}>{getProductLocationLabel(p)}</Text>
                  </VStack>
                  <Icon as={FaTimes} boxSize={2.5} cursor="pointer" color="blue.600" onClick={() => toggleAdditionalTarget(p.id)} />
                </HStack>
              ))}
            </HStack>
          )}
          {selectedTargetsNeedLocationPlan && (
            <Alert status="warning" borderRadius="md" py={2} px={2.5}>
              <AlertIcon boxSize="14px" />
              <Box minW={0}>
                <Text fontSize="10px" fontWeight="700" color="orange.900">Selected items are in different locations</Text>
                <Text fontSize="9px" color="orange.800" noOfLines={1}>You will pick up each item at its respective location.</Text>
              </Box>
            </Alert>
          )}
          <Input placeholder="Search trader's items..." value={targetSearchTerm} onChange={(e) => setTargetSearchTerm(e.target.value.toLowerCase())} size="sm" fontSize="12px" bg="white" />
          {loadingSellerProducts ? (
            <HStack justify="center" py={3}><Spinner size="sm" /></HStack>
          ) : visibleSellerProducts.length === 0 ? (
            <Text fontSize="10px" color={mutedTextColor} textAlign="center" py={3}>No other available items from this trader.</Text>
          ) : (
            <Box maxH={{ base: '38vh', md: '240px', lg: '28vh' }} overflowY="auto" pr={1} minH={0}>
              <Grid templateColumns={{ base: '1fr', sm: 'repeat(2, 1fr)', md: 'repeat(2, 1fr)' }} gap={2}>
                {visibleSellerProducts.map(p => {
                  const isSelected = additionalTargetIds.includes(p.id)
                  const unavailReason = getTargetUnavailableReason(p)
                  const isDisabled = Boolean(unavailReason)
                  return (
                    <HStack key={p.id} minH="52px" borderWidth={isSelected ? '2px' : '1px'} borderColor={isSelected ? 'blue.500' : borderColor} rounded="md" onClick={() => !isDisabled && toggleAdditionalTarget(p.id)} cursor={isDisabled ? 'not-allowed' : 'pointer'} bg={isSelected ? 'blue.50' : 'white'} opacity={isDisabled ? 0.48 : 1} spacing={2} p={1.5}>
                      <Image src={getFirstImage(p.image_urls)} alt={p.title} w="40px" h="40px" objectFit="cover" rounded="md" loading="lazy" filter={isDisabled ? 'grayscale(1)' : undefined} />
                      <Box minW={0} flex={1}>
                        <Text fontSize="11px" noOfLines={1} fontWeight={isSelected ? '700' : '600'} color={isSelected ? 'blue.600' : 'inherit'}>{p.title}</Text>
                        <Text fontSize="9px" noOfLines={1} color="gray.500">{isDisabled ? unavailReason : getProductLocationLabel(p)}</Text>
                      </Box>
                    </HStack>
                  )
                })}
              </Grid>
            </Box>
          )}
        </VStack>
    </VStack>
  )

  const offerSection = (
    <VStack spacing={3} align="stretch" minH={0} h="full">
      <VStack align="start" spacing={1} w="full" flexShrink={0}>
        <HStack justify="space-between" w="full" align="center">
          <Text fontWeight="700" fontSize="11px" textTransform="uppercase" color={mutedTextColor} letterSpacing="0.5px">My Offered Items</Text>
          {targetProduct?.max_items_per_offer ? <Badge colorScheme="brand" variant="subtle" fontSize="10px">Max {targetProduct.max_items_per_offer}</Badge> : null}
        </HStack>
        {selectedSummary}
        {selectedOfferIds.length > 1 && <Text fontSize="10px" color={mutedTextColor}>The other trader accepts or declines the whole bundle.</Text>}
      </VStack>
      <Input placeholder="Search your items..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value.toLowerCase())} size="sm" fontSize="12px" />
      <Box maxH={{ base: '44vh', md: '34vh', lg: '32vh' }} minH={{ base: '160px', md: '180px' }} overflowY="auto" pr={1}>
        {visibleProducts.length === 0 ? (
          <Flex direction="column" align="center" justify="center" minH="160px" gap={2} p={4} bg="gray.50" borderRadius="md" borderWidth="1px" borderColor={borderColor}>
            <Icon as={FaBoxOpen} boxSize={8} color="gray.400" />
            <Text fontWeight="600" fontSize="12px" color="gray.700">No items available to trade</Text>
            <Button size="sm" colorScheme="brand" minH="40px" onClick={() => { onClose(); navigate('/dashboard?tab=my-items') }}>Add Item</Button>
          </Flex>
        ) : (
          <Grid templateColumns={{ base: '1fr', sm: 'repeat(2, 1fr)', lg: 'repeat(2, 1fr)' }} gap={2}>
            {visibleProducts.map((p) => {
              const isSelected = selectedOfferIds.includes(p.id)
              const unavailableReason = getUnavailableReason(p)
              const isDisabled = Boolean(unavailableReason)
              return (
                <HStack key={p.id} minH="58px" borderWidth={isSelected ? '2px' : '1px'} borderColor={isSelected ? selectedBorder : borderColor} rounded="md" onClick={() => toggleOfferSelection(p)} cursor={isDisabled ? 'not-allowed' : 'pointer'} bg={isSelected ? selectedBg : 'white'} opacity={isDisabled ? 0.48 : 1} spacing={2} p={1.5}>
                  <Image src={getFirstImage(p.image_urls)} alt={p.title} w="44px" h="44px" objectFit="cover" rounded="md" loading="lazy" filter={isDisabled ? 'grayscale(1)' : undefined} />
                  <Box minW={0} flex={1}>
                    <Text fontSize="12px" noOfLines={1} wordBreak="break-word" fontWeight={isSelected ? '700' : '600'} color={isSelected ? selectedTextColor : 'inherit'}>{p.title}</Text>
                    <Text fontSize="10px" noOfLines={1} color={isDisabled ? 'gray.700' : 'gray.500'} fontWeight={isDisabled ? '700' : '500'}>{isDisabled ? unavailableReason : p.status}</Text>
                  </Box>
                </HStack>
              )
            })}
          </Grid>
        )}
      </Box>
    </VStack>
  )

  const messageAndMoney = (
    <VStack spacing={3} align="stretch">
      <FormControl><FormLabel fontSize="11px" fontWeight="bold" textTransform="uppercase" color={mutedTextColor} letterSpacing="0.5px" mb={1}>Message (optional)</FormLabel><Input placeholder="Add a note for the trader" value={tradeMessage} onChange={(e) => setTradeMessage(e.target.value)} fontSize="12px" minH="40px" /></FormControl>
      <FormControl><FormLabel fontSize="11px" fontWeight="bold" textTransform="uppercase" color={mutedTextColor} letterSpacing="0.5px" mb={1}>Offer Money (optional, PHP)</FormLabel><Input type="text" inputMode="numeric" placeholder="e.g. 500" value={cashAmount} onChange={(e) => handleCashAmountChange(e.target.value)} fontSize="12px" minH="40px" isInvalid={Boolean(cashError)} />{cashError && <Text fontSize="10px" color="red.500" mt={1}>{cashError}</Text>}</FormControl>
    </VStack>
  )

  const tradeMethodSection = (
    <FormControl isRequired>
      <FormLabel fontSize="11px" fontWeight="bold" textTransform="uppercase" color={mutedTextColor} letterSpacing="0.5px" mb={2}>How will you meet?</FormLabel>
      {/* First-time onboarding hint — shown once per user */}
      {showTradeHint && (
        <Box mb={3} p={3} bg="brand.50" borderRadius="xl" borderWidth="1px" borderColor="brand.200" position="relative">
          <CloseButton size="sm" position="absolute" top={1} right={1} onClick={dismissTradeHint} aria-label="Dismiss hint" />
          <Text fontSize="sm" fontWeight="800" color="brand.700" mb={1.5}>How trades work</Text>
          <VStack align="start" spacing={1.5}>
            <Text fontSize="sm" color="brand.800">📍 <Text as="span" fontWeight="700">Pickup</Text> → You go to the seller</Text>
            <Text fontSize="sm" color="brand.800">🤝 <Text as="span" fontWeight="700">Meetup</Text> → You both meet at a chosen place</Text>
          </VStack>
        </Box>
      )}
      {isTargetLoading ? <Box p={2.5} bg="gray.50" borderWidth="1px" borderColor={borderColor} borderRadius="md" mb={3}><HStack spacing={2}><Spinner size="sm" /><Text fontSize="10px" color={mutedTextColor}>Loading trade methods...</Text></HStack></Box> : (
        <>
          {/* Contextual helper text based on what methods the owner allows */}
          <Box mb={2}>
            {pickupEnabled && !meetupEnabled ? (
              <Text fontSize="xs" color="orange.700" fontWeight="500" px={1}>
                This item is available for pickup only. You will go to the seller's selected location.
              </Text>
            ) : !pickupEnabled && meetupEnabled ? (
              <Text fontSize="xs" color="teal.700" fontWeight="500" px={1}>
                This item is available for meetup only. You and the seller will agree on a meeting place.
              </Text>
            ) : (
              <Text fontSize="xs" color="gray.500" px={1}>
                Choose how you want to trade this item.
              </Text>
            )}
          </Box>

          <HStack spacing={2} mb={3} align="stretch">
            {pickupEnabled && (
              <Tooltip
                label={!hasFixedLocation ? 'Pickup location not set by seller' : "The seller sets the location. You'll go there to pick up the item."}
                hasArrow
                placement="top"
                fontSize="xs"
                borderRadius="md"
                maxW="200px"
              >
                <Button
                  flex={1}
                  size="sm"
                  minH="44px"
                  variant={tradeOption === 'pickup' ? 'solid' : 'outline'}
                  bg={tradeOption === 'pickup' ? '#E67E22' : 'transparent'}
                  color={tradeOption === 'pickup' ? 'white' : 'inherit'}
                  borderColor={tradeOption === 'pickup' ? '#E67E22' : borderColor}
                  _hover={{ bg: tradeOption === 'pickup' ? '#D35400' : undefined }}
                  onClick={() => { setTradeOption('pickup'); dismissTradeHint() }}
                  leftIcon={<Icon as={FaMapMarkerAlt} boxSize={4} />}
                  rightIcon={<Icon as={FaInfoCircle} boxSize={3} opacity={0.55} />}
                  fontSize="sm"
                  fontWeight="700"
                  isDisabled={!hasFixedLocation}
                  title={!hasFixedLocation ? 'Pickup unavailable - trader has no fixed location' : undefined}
                >
                  Pickup
                </Button>
              </Tooltip>
            )}
            {meetupEnabled && (
              <Tooltip
                label="You and the seller will agree on a place before meeting."
                hasArrow
                placement="top"
                fontSize="xs"
                borderRadius="md"
                maxW="200px"
              >
                <Button
                  flex={1}
                  size="sm"
                  minH="44px"
                  variant={tradeOption === 'meetup' ? 'solid' : 'outline'}
                  bg={tradeOption === 'meetup' ? selectedBorder : 'transparent'}
                  color={tradeOption === 'meetup' ? 'white' : 'inherit'}
                  borderColor={tradeOption === 'meetup' ? selectedBorder : borderColor}
                  _hover={{ bg: tradeOption === 'meetup' ? '#158A63' : undefined }}
                  onClick={() => { setTradeOption('meetup'); dismissTradeHint() }}
                  leftIcon={<Icon as={FaHandshake} boxSize={4} />}
                  rightIcon={<Icon as={FaInfoCircle} boxSize={3} opacity={0.55} />}
                  fontSize="sm"
                  fontWeight="700"
                >
                  Meetup
                </Button>
              </Tooltip>
            )}
          </HStack>

          {/* Confirmation line after selection */}
          {tradeOption === 'pickup' && (
            <Box px={3} py={2.5} bg="orange.50" borderRadius="lg" borderWidth="1px" borderColor="orange.100" mb={3}>
              <Text fontSize="sm" color="orange.700" fontWeight="600">📍 You'll head to the pickup location</Text>
            </Box>
          )}
          {tradeOption === 'meetup' && (
            <Box px={3} py={2.5} bg="teal.50" borderRadius="lg" borderWidth="1px" borderColor="teal.100" mb={3}>
              <Text fontSize="sm" color="teal.700" fontWeight="600">🤝 You'll decide on a meeting place together</Text>
            </Box>
          )}
          <Box p={2.5} bg="gray.50" borderWidth="1px" borderColor="gray.200" borderRadius="md" mb={3}>
            <Text fontSize="10px" fontWeight="800" color="gray.600" textTransform="uppercase" mb={1.5}>Owner Collection Setup</Text>
            <VStack align="stretch" spacing={1}>
              {pickupEnabled && (
                <Text fontSize="10px" color="gray.700">
                  <Text as="span" fontWeight="700">Pickup:</Text> {formatCollectionDays(collectionSetup.pickup?.days)} · {formatCollectionWindow(collectionSetup.pickup?.time_start, collectionSetup.pickup?.time_end)}
                </Text>
              )}
              {meetupEnabled && (
                <Text fontSize="10px" color="gray.700">
                  <Text as="span" fontWeight="700">Meetup:</Text> {preferredMeetupLocations.length > 0 ? preferredMeetupLocations.join(', ') : 'No preferred spots'} · {formatCollectionDays(collectionSetup.meetup?.days)} · {formatCollectionWindow(collectionSetup.meetup?.time_start, collectionSetup.meetup?.time_end)}
                </Text>
              )}
            </VStack>
          </Box>
          {tradeOption === 'meetup' && (
            <VStack spacing={2.5} align="stretch" mb={3}>
              {/* Header */}
              <Box p={2.5} bg="blue.50" borderWidth="1px" borderColor="blue.200" borderRadius="md">
                <HStack spacing={2} mb={0.5}>
                  <Icon as={FaHandshake} color="blue.600" boxSize={3} />
                  <Text fontSize="11px" fontWeight="700" color="blue.900">Meetup Location</Text>
                </HStack>
                <Text fontSize="10px" color="blue.700">Choose one of the owner's pinned locations, or suggest a new map location for approval.</Text>
              </Box>

              {/* Location option cards */}
              <VStack spacing={1.5} align="stretch">
                {preferredMeetupLocationPoints.map((point) => {
                  const label = `${point.name} - ${point.address}`
                  const selected = meetupChoice === 'custom' && customMeetupAddress === label
                  return (
                    <Box
                      key={`owner-meetup-${point.lat}-${point.lng}`}
                      p={2.5}
                      bg={selected ? 'teal.50' : 'white'}
                      borderWidth={selected ? '2px' : '1px'}
                      borderColor={selected ? 'teal.400' : borderColor}
                      borderRadius="md"
                      cursor="pointer"
                      onClick={() => { setMeetupChoice('custom'); setCustomMeetupAddress(label); setCustomMeetupPoint(point) }}
                      role="button"
                    >
                      <HStack spacing={2} align="center">
                        <Icon as={FaMapMarkerAlt} color="teal.500" boxSize={3} flexShrink={0} />
                        <VStack spacing={0} align="start" flex={1} minW={0}>
                          <Text fontSize="10px" fontWeight="700" color="gray.800" noOfLines={1}>{point.name}</Text>
                          <Text fontSize="9px" color="gray.500" noOfLines={1}>{point.address}</Text>
                        </VStack>
                        {selected && <Icon as={FaCheckCircle} color="teal.500" boxSize={3} flexShrink={0} />}
                      </HStack>
                    </Box>
                  )
                })}
                {!preferredMeetupLocationPoints.length && preferredMeetupLocations.map((location) => (
                  <HStack
                    key={`owner-meetup-${location}`}
                    p={2.5} bg={meetupChoice === 'custom' && customMeetupAddress === location ? 'teal.50' : 'white'}
                    borderWidth={meetupChoice === 'custom' && customMeetupAddress === location ? '2px' : '1px'}
                    borderColor={meetupChoice === 'custom' && customMeetupAddress === location ? 'teal.400' : borderColor}
                    borderRadius="md" spacing={2} align="center" cursor="pointer" w="full"
                    onClick={() => { setMeetupChoice('custom'); setCustomMeetupAddress(location); setCustomMeetupPoint(null) }} role="button"
                  >
                    <Icon as={FaMapMarkerAlt} color="teal.500" boxSize={3} flexShrink={0} />
                    <VStack spacing={0} align="start" flex={1} minW={0}>
                      <Text fontSize="10px" fontWeight="700" color="gray.800">Owner preferred location</Text>
                      <Text fontSize="9px" color="gray.500" noOfLines={1}>{location}</Text>
                    </VStack>
                    {meetupChoice === 'custom' && customMeetupAddress === location && <Icon as={FaCheckCircle} color="teal.500" boxSize={3} flexShrink={0} />}
                  </HStack>
                ))}

                <Box
                  p={2.5} bg={meetupChoice === 'custom' && customMeetupPoint && !preferredMeetupLocations.includes(customMeetupAddress) ? 'orange.50' : 'white'}
                  borderWidth={meetupChoice === 'custom' && customMeetupPoint && !preferredMeetupLocations.includes(customMeetupAddress) ? '2px' : '1px'}
                  borderColor={meetupChoice === 'custom' && customMeetupPoint && !preferredMeetupLocations.includes(customMeetupAddress) ? 'orange.400' : borderColor}
                  borderRadius="md"
                >
                  <HStack spacing={2} align="center" mb={2}>
                    <Icon as={FaLocationArrow} color="orange.500" boxSize={3} flexShrink={0} />
                    <VStack spacing={0} align="start" flex={1} minW={0}>
                      <Text fontSize="10px" fontWeight="700" color="gray.800">Suggest a new map location</Text>
                      <Text fontSize="9px" color="gray.500">Requires owner approval before the trade moves forward</Text>
                    </VStack>
                  </HStack>
                  <Box position="relative">
                    <Input
                      placeholder="Search public place or landmark"
                      value={meetupSearchQuery}
                      onChange={(e) => { setMeetupSearchQuery(e.target.value); void searchMeetupLocations(e.target.value) }}
                      onFocus={() => meetupSearchQuery && setShowMeetupSearchDropdown(true)}
                      fontSize="11px" size="sm" bg="white"
                    />
                    {isSearchingMeetupLocation && <Spinner size="xs" position="absolute" right={3} top="10px" color="orange.500" />}
                    {showMeetupSearchDropdown && meetupSearchResults.length > 0 && (
                      <Box position="absolute" top="100%" left={0} right={0} bg="white" border="1px" borderColor="gray.200" borderRadius="md" shadow="lg" zIndex={20} maxH="180px" overflowY="auto" mt={1}>
                        {meetupSearchResults.map((result, idx) => (
                          <Box key={`${result.lat}-${result.lng}-${idx}`} p={2} cursor="pointer" _hover={{ bg: 'orange.50' }} borderBottom={idx < meetupSearchResults.length - 1 ? '1px' : 'none'} borderColor="gray.100" onClick={() => {
                            setMeetupChoice('custom')
                            setCustomMeetupPoint(result)
                            setCustomMeetupAddress(`${result.name} - ${result.address}`)
                            setMeetupSearchQuery('')
                            setMeetupSearchResults([])
                            setShowMeetupSearchDropdown(false)
                          }}>
                            <Text fontSize="11px" fontWeight="700" color="gray.800" noOfLines={1}>{result.name}</Text>
                            <Text fontSize="9px" color="gray.500" noOfLines={1}>{result.address}</Text>
                          </Box>
                        ))}
                      </Box>
                    )}
                  </Box>
                  {customMeetupPoint && meetupChoice === 'custom' && (
                    <Text fontSize="9px" color="orange.700" mt={2} fontWeight="700" noOfLines={2}>
                      Suggested: {customMeetupPoint.name} - {customMeetupPoint.address}
                    </Text>
                  )}
                </Box>
              </VStack>
              {/* View on map link (when coords are available for the selected choice) */}
              {meetupMapUrl && (
                <HStack>
                  <Button
                    as="a" href={meetupMapUrl} target="_blank" rel="noopener noreferrer"
                    size="xs" variant="outline" colorScheme="blue"
                    leftIcon={<Icon as={FaExternalLinkAlt} boxSize={2.5} />}
                    fontSize="10px"
                  >
                    View on map
                  </Button>
                </HStack>
              )}

              <Divider />

              {/* Date and time proposal — slot-aware */}
              <HStack justify="space-between" align="center">
                <Text fontSize="11px" fontWeight="700" color={mutedTextColor} textTransform="uppercase" letterSpacing="0.5px">
                  Meetup Date &amp; Time
                </Text>
                {currentAvailabilitySlots.length > 0 && (
                  <Badge colorScheme={sellerAvailabilityType === 'strict' ? 'orange' : 'teal'} fontSize="8px">
                    <Icon as={sellerAvailabilityType === 'strict' ? FaLock : FaClock} boxSize={2} mr={1} />
                    {sellerAvailabilityType === 'strict' ? 'Strict' : 'Flexible'}
                  </Badge>
                )}
              </HStack>

              {currentAvailabilitySlots.length > 0 && (
                <>
                  <Text fontSize="9px" color="teal.700" fontWeight="semibold">
                    Seller's available slots — pick one:
                  </Text>
                  <VStack align="stretch" spacing={1}>
                    {currentAvailabilitySlots.map(slot => {
                      const fmt = (t: string) => {
                        const [h, m] = t.split(':').map(Number)
                        const ampm = h >= 12 ? 'PM' : 'AM'
                        const hour = h % 12 || 12
                        return m === 0 ? `${hour}${ampm}` : `${hour}:${String(m).padStart(2, '0')}${ampm}`
                      }
                      const d = new Date(`${slot.date}T00:00:00`)
                      const dateStr = d.toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric' })
                      const isSelected = selectedSlotId === slot.id
                      return (
                        <HStack
                          key={slot.id}
                          p={1.5}
                          borderRadius="md"
                          borderWidth="1.5px"
                          borderColor={isSelected ? 'teal.400' : 'gray.200'}
                          bg={isSelected ? 'teal.50' : 'white'}
                          cursor="pointer"
                          spacing={2}
                          onClick={() => {
                            setSelectedSlotId(slot.id)
                            setMeetupDate(slot.date)
                            setMeetupTime(slot.start_time)
                          }}
                        >
                          <Icon as={FaClock} color={isSelected ? 'teal.500' : 'gray.400'} boxSize={3} />
                          <Text fontSize="11px" color={isSelected ? 'teal.800' : 'gray.700'} fontWeight={isSelected ? 'semibold' : 'normal'}>
                            {dateStr} · {fmt(slot.start_time)}–{fmt(slot.end_time)}
                          </Text>
                          {isSelected && <Icon as={FaCheckCircle} color="teal.500" boxSize={3} ml="auto" />}
                        </HStack>
                      )
                    })}
                  </VStack>
                </>
              )}

              {/* Custom time input — hidden for strict schedule, optional for flexible */}
              {(sellerAvailabilityType !== 'strict' || currentAvailabilitySlots.length === 0) && (
                <>
                  {currentAvailabilitySlots.length > 0 && (
                    <Text fontSize="9px" color="gray.500">Or propose a different time:</Text>
                  )}
                  <HStack spacing={2}>
                    <Input
                      type="date" value={meetupDate}
                      onChange={(e) => { setMeetupDate(e.target.value); setSelectedSlotId(null) }}
                      fontSize="11px" size="sm" flex={1}
                      min={new Date().toISOString().split('T')[0]}
                    />
                    <Input
                      type="time" value={meetupTime}
                      onChange={(e) => { setMeetupTime(e.target.value); setSelectedSlotId(null) }}
                      fontSize="11px" size="sm" flex={1}
                    />
                  </HStack>
                </>
              )}

              {sellerAvailabilityType === 'strict' && currentAvailabilitySlots.length > 0 && !selectedSlotId && (
                <Text fontSize="9px" color="orange.600">
                  This seller has a strict schedule — please select one of the slots above.
                </Text>
              )}
              {(!currentAvailabilitySlots.length && sellerAvailabilityType !== 'strict') && (
                <Text fontSize="9px" color="gray.500">
                  Date and time are optional. The other trader can accept or suggest changes after the offer is accepted.
                </Text>
              )}
            </VStack>
          )}
          {tradeOption === 'pickup' && (
            <VStack spacing={2.5} align="stretch" mb={3}>
              <Box p={3} bg="orange.50" borderWidth="1px" borderColor="orange.100" borderRadius="lg">
                <HStack justify="space-between" align="center" mb={2}>
                  <Box minW={0}>
                    <Text fontSize="11px" fontWeight="800" color="orange.900">Pickup time</Text>
                    <Text fontSize="9px" color="orange.700" noOfLines={1}>
                      {formatCollectionDays(collectionSetup.pickup?.days)} - {formatCollectionWindow(collectionSetup.pickup?.time_start, collectionSetup.pickup?.time_end)}
                    </Text>
                  </Box>
                  {currentAvailabilitySlots.length > 0 && (
                    <Badge colorScheme={sellerAvailabilityType === 'strict' ? 'orange' : 'teal'} fontSize="8px">
                      <Icon as={sellerAvailabilityType === 'strict' ? FaLock : FaClock} boxSize={2} mr={1} />
                      {sellerAvailabilityType === 'strict' ? 'Fixed' : 'Flexible'}
                    </Badge>
                  )}
                </HStack>

                {currentAvailabilitySlots.length > 0 && (
                  <VStack align="stretch" spacing={2.5} mb={sellerAvailabilityType === 'strict' ? 0 : 2}>
                    <HStack spacing={2}>
                      <Button size="xs" colorScheme="orange" variant={selectedSlotId === currentAvailabilitySlots[0]?.id ? 'solid' : 'outline'} leftIcon={<Icon as={FaClock} boxSize={2.5} />} onClick={() => selectAvailabilitySlot(currentAvailabilitySlots[0] || null)} flex={1} minH="32px">
                        Earliest
                      </Button>
                      <Button size="xs" variant="outline" colorScheme="teal" leftIcon={<Icon as={FaCheckCircle} boxSize={2.5} />} onClick={() => selectAvailabilitySlot(currentAvailabilitySlots[0] || null)} flex={1} minH="32px">
                        Pick for me
                      </Button>
                    </HStack>

                    <Box>
                      <Text fontSize="9px" color="gray.500" fontWeight="800" textTransform="uppercase" mb={1}>Date</Text>
                      <HStack spacing={1.5} overflowX="auto" pb={1} sx={{ scrollbarWidth: 'none', '&::-webkit-scrollbar': { display: 'none' } }}>
                        {visiblePickupDateGroups.map(group => {
                          const firstSlot = group.slots[0]
                          const isSelectedDate = meetupDate === group.date
                          const timeRange = firstSlot ? `${formatCompactSlotTime(firstSlot.start_time)}-${formatCompactSlotTime(firstSlot.end_time)}` : 'Time set'
                          return (
                            <Button key={group.date} size="sm" minW="132px" h="48px" px={2.5} whiteSpace="normal" variant={isSelectedDate ? 'solid' : 'outline'} colorScheme="orange" bg={isSelectedDate ? 'orange.500' : 'white'} justifyContent="flex-start" onClick={() => { setMeetupDate(group.date); selectAvailabilitySlot(firstSlot || null) }}>
                              <VStack align="start" spacing={0} w="full">
                                <Text fontSize="10px" fontWeight="800" noOfLines={1}>{formatSlotDate(group.date)}</Text>
                                <Text fontSize="9px" opacity={0.85} noOfLines={1}>{timeRange}</Text>
                              </VStack>
                            </Button>
                          )
                        })}
                        {!showMorePickupDates && pickupSlotsByDate.length > 5 && (
                          <Button size="sm" minW="92px" h="48px" variant="ghost" colorScheme="orange" onClick={() => setShowMorePickupDates(true)}>
                            + More
                          </Button>
                        )}
                      </HStack>
                    </Box>

                    {pickupSlotsForSelectedDate.length > 0 && (
                      <Box>
                        <Text fontSize="9px" color="gray.500" fontWeight="800" textTransform="uppercase" mb={1}>Time</Text>
                        <HStack spacing={1.5} overflowX="auto" pb={1} sx={{ scrollbarWidth: 'none', '&::-webkit-scrollbar': { display: 'none' } }}>
                          {pickupSlotsForSelectedDate.map(slot => {
                            const isSelected = selectedSlotId === slot.id
                            return (
                              <Button key={slot.id} size="xs" minW="104px" h="34px" variant={isSelected ? 'solid' : 'outline'} colorScheme="orange" bg={isSelected ? 'orange.500' : 'white'} onClick={() => selectAvailabilitySlot(slot)}>
                                {formatCompactSlotTime(slot.start_time)}-{formatCompactSlotTime(slot.end_time)}
                              </Button>
                            )
                          })}
                        </HStack>
                      </Box>
                    )}
                  </VStack>
                )}

                {(sellerAvailabilityType !== 'strict' || currentAvailabilitySlots.length === 0) && (
                  <HStack spacing={2} mt={currentAvailabilitySlots.length > 0 ? 2 : 0}>
                    <Input type="date" value={meetupDate} onChange={(e) => { setMeetupDate(e.target.value); setSelectedSlotId(null) }} fontSize="11px" size="sm" bg="white" min={new Date().toISOString().split('T')[0]} />
                    <Input type="time" value={meetupTime} onChange={(e) => { setMeetupTime(e.target.value); setSelectedSlotId(null) }} fontSize="11px" size="sm" bg="white" />
                  </HStack>
                )}
                {sellerAvailabilityType === 'strict' && currentAvailabilitySlots.length > 0 && !selectedSlotId && (
                  <Text fontSize="9px" color="orange.700" mt={1}>
                    Pick one available pickup date and time.
                  </Text>
                )}
              </Box>
            </VStack>
          )}
          {!hasFixedLocation && <Box p={2.5} bg="yellow.50" borderWidth="1px" borderColor="yellow.200" borderRadius="md" mb={3}><Text fontSize="10px" color="yellow.800">Pickup location not available. The seller needs to set a location for this item.</Text></Box>}
        </>
      )}
    </FormControl>
  )

  // Helper: format a time string "HH:MM" → "3:00 PM"
  const selectedPickupLocationLabel = selectedPickupProduct ? getProductRawLocation(selectedPickupProduct) : null
  const locationSection = selectedTargetProducts.length > 0 ? (
    <Box borderWidth="1px" borderColor={selectedTargetsNeedLocationPlan ? 'orange.200' : 'gray.200'} borderRadius="lg" overflow="hidden">
      <HStack px={3} py={2} bg="gray.50" borderBottomWidth="1px" borderBottomColor="gray.200" spacing={2}>
        <Icon as={FaMapMarkerAlt} color="gray.500" boxSize={3.5} />
        <Text fontSize="11px" fontWeight="800" textTransform="uppercase" color={mutedTextColor} letterSpacing="0.5px">Location Details</Text>
        {selectedTargetsNeedLocationPlan && (
          <Badge colorScheme="orange" variant="subtle" fontSize="9px" ml="auto">Multiple locations</Badge>
        )}
      </HStack>

      <VStack spacing={0} align="stretch">
        <VStack spacing={1.5} align="stretch" p={3} borderBottomWidth="1px" borderBottomColor="gray.100">
          {selectedTargetProducts.map((prod) => {
            const displayLabel = getProductLocationLabel(prod)
            return (
              <HStack key={prod.id} spacing={2} p={2} bg="blue.50" borderRadius="md" borderLeft="3px solid" borderLeftColor="blue.400" align="start">
                <Icon as={FaMapMarkerAlt} color="blue.500" boxSize={3} mt="1px" flexShrink={0} />
                <Box minW={0} flex={1}>
                  <Text fontSize="10px" fontWeight="800" color="blue.900" noOfLines={1}>{prod.title}</Text>
                  <Text fontSize="11px" fontWeight="600" color="blue.900" noOfLines={2}>{displayLabel || 'To Be Decided'}</Text>
                </Box>
              </HStack>
            )
          })}
        </VStack>

        {selectedTargetsNeedLocationPlan && (
          <Box px={3} py={2.5} bg="orange.50" borderBottomWidth="1px" borderBottomColor="orange.100">
            <Text fontSize="10px" fontWeight="700" color="orange.800" mb={2}>
              These items have different pickup locations. Please choose one location for this trade.
            </Text>
            {tradeOption === 'pickup' ? (
              <RadioGroup
                value={pickupLocationProductId ? String(pickupLocationProductId) : ''}
                onChange={(value) => setPickupLocationProductId(Number(value))}
              >
                <VStack align="stretch" spacing={1.5}>
                  {selectedTargetPickupOptions.map((option) => (
                    <Radio key={option.product.id} size="sm" value={String(option.product.id)} colorScheme="orange">
                      <Text fontSize="11px">{option.product.title}: {option.label}</Text>
                    </Radio>
                  ))}
                </VStack>
              </RadioGroup>
            ) : (
              <Text fontSize="10px" color="orange.800">
                Use the meetup options above to choose one shared or custom location for the trade.
              </Text>
            )}
          </Box>
        )}

        {tradeOption === 'pickup' && selectedPickupCoords && (
          <Box borderBottomWidth="1px" borderBottomColor="gray.100">
            <Box h="120px">
              <Box
                as="iframe"
                title="Pickup location map"
                src={`https://www.openstreetmap.org/export/embed.html?bbox=${selectedPickupCoords.lng - 0.02},${selectedPickupCoords.lat - 0.015},${selectedPickupCoords.lng + 0.02},${selectedPickupCoords.lat + 0.015}&layer=mapnik&marker=${selectedPickupCoords.lat},${selectedPickupCoords.lng}`}
                width="100%"
                height="100%"
                style={{ border: 'none', pointerEvents: 'none' }}
                loading="lazy"
              />
            </Box>
            <HStack px={3} py={2} justify="space-between" spacing={2}>
              <Box minW={0}>
                <Text fontSize="10px" fontWeight="800" color="orange.800">Selected pickup location</Text>
                <Text fontSize="9px" color="gray.600" noOfLines={1}>{selectedPickupLocationLabel}</Text>
              </Box>
              <Badge colorScheme="orange" flexShrink={0}>{pickupDistanceLabel}</Badge>
            </HStack>
          </Box>
        )}

        {tradeOption === 'meetup' && resolvedMeetupAddress && (
          <HStack px={3} py={2.5} bg="teal.50" borderBottomWidth="1px" borderBottomColor="teal.100" align="start" spacing={2}>
            <Icon as={FaHandshake} color="teal.600" boxSize={3.5} mt="1px" />
            <Box minW={0} flex={1}>
              <Text fontSize="10px" fontWeight="800" color="teal.800">Selected meetup location</Text>
              <Text fontSize="11px" color="teal.900" noOfLines={2}>{resolvedMeetupAddress}</Text>
            </Box>
            {meetupMapUrl && (
              <Button as="a" href={meetupMapUrl} target="_blank" rel="noopener noreferrer" size="xs" variant="outline" colorScheme="teal" leftIcon={<Icon as={FaExternalLinkAlt} boxSize={2.5} />} fontSize="10px">
                Map
              </Button>
            )}
          </HStack>
        )}

        <Box px={3} py={2.5} bg={scheduleAgreed ? 'green.50' : 'gray.50'}>
          <Checkbox
            size="md"
            colorScheme="green"
            isChecked={scheduleAgreed}
            onChange={(e) => setScheduleAgreed(e.target.checked)}
          >
            <Text fontSize="11px" color="gray.800" fontWeight="600">
              {selectedTargetsNeedLocationPlan
                ? 'I reviewed the selected location and collection time for this trade.'
                : tradeOption === 'pickup'
                ? 'I agree to go to the pickup location at the selected time.'
                : 'I reviewed the meetup location and selected time.'}
            </Text>
          </Checkbox>
          <Text fontSize="9px" color="gray.500" mt={1} pl={6}>
            The selected date and time above will be included with your offer.
          </Text>
        </Box>
      </VStack>
    </Box>
  ) : null

  const detailsSection = (
    <VStack spacing={3} align="stretch">
      {tradeMethodSection}
      {isMobile ? <><Accordion allowMultiple defaultIndex={[]}><AccordionItem borderColor={borderColor}><AccordionButton px={0} minH="44px"><Box flex="1" textAlign="left" fontSize="12px" fontWeight="700">Message</Box><AccordionIcon /></AccordionButton><AccordionPanel px={0} pb={3}><FormControl><Input placeholder="Add a note for the trader" value={tradeMessage} onChange={(e) => setTradeMessage(e.target.value)} fontSize="12px" minH="40px" /></FormControl></AccordionPanel></AccordionItem><AccordionItem borderColor={borderColor}><AccordionButton px={0} minH="44px"><Box flex="1" textAlign="left" fontSize="12px" fontWeight="700">Offer Money</Box><AccordionIcon /></AccordionButton><AccordionPanel px={0} pb={3}><FormControl><Input type="text" inputMode="numeric" placeholder="e.g. 500" value={cashAmount} onChange={(e) => handleCashAmountChange(e.target.value)} fontSize="12px" minH="40px" isInvalid={Boolean(cashError)} />{cashError && <Text fontSize="10px" color="red.500" mt={1}>{cashError}</Text>}</FormControl></AccordionPanel></AccordionItem></Accordion>{locationSection}</> : <>{messageAndMoney}{locationSection}</>}
    </VStack>
  )

  const tradeValueEstimateSummary = (
    <Box borderWidth="1px" borderColor={borderColor} borderRadius="md" bg="gray.50" px={3} py={2.5} mb={2.5}>
      <VStack align="stretch" spacing={1.5}>
        <Text fontSize="11px" fontWeight="800" color="gray.800">Estimated trade value</Text>
        <HStack justify="space-between" align="center">
          <Text fontSize="10px" color={mutedTextColor}>Requested items</Text>
          <Text fontSize="10px" fontWeight="700" color="gray.800">{formatPesoValue(requestedValueSummary.total)}</Text>
        </HStack>
        <HStack justify="space-between" align="center">
          <Text fontSize="10px" color={mutedTextColor}>Your offered items</Text>
          <Text fontSize="10px" fontWeight="700" color="gray.800">{formatPesoValue(offeredValueSummary.total)}</Text>
        </HStack>
        <HStack justify="space-between" align="center">
          <Text fontSize="10px" color={mutedTextColor}>Difference</Text>
          <Text fontSize="10px" fontWeight="700" color="gray.800">{formatPesoDifference(valueDifference)}</Text>
        </HStack>
        <Text fontSize="10px" color={valueDifference === null ? mutedTextColor : selectedTextColor} fontWeight="600" pt={0.5}>
          {fairnessHint}
        </Text>
      </VStack>
    </Box>
  )

  const actionButtons = (
    <HStack justify="flex-end" spacing={3} pt={isMobile ? 0 : 1}>
      {isMobile && mobileStep > 0 && <Button variant="outline" onClick={() => setMobileStep(step => Math.max(0, step - 1))} fontSize="12px" minH="42px" flex={1}>Back</Button>}
      {!isMobile && <Button variant="ghost" onClick={onClose} fontSize="12px" minH="42px">Cancel</Button>}
      {isMobile && mobileStep < mobileSteps.length - 1 ? <Button bg={selectedBorder} color="white" onClick={() => setMobileStep(step => Math.min(mobileSteps.length - 1, step + 1))} fontSize="12px" fontWeight="700" minH="42px" flex={1.4} _hover={{ bg: '#158A63' }}>Next</Button> : <Button bg={selectedBorder} color="white" isLoading={submittingTrade} onClick={submitTrade} isDisabled={!canConfirm} fontSize="12px" fontWeight="700" minH="42px" flex={isMobile ? 1.4 : 1} _hover={{ bg: '#158A63' }} _active={{ bg: '#0F5A42' }}>{isEditMode ? 'Save Changes' : 'Confirm'}</Button>}
    </HStack>
  )

  const reviewSection = (
    <VStack spacing={3} align="stretch">
      {targetProduct && <Box p={3} borderWidth="1px" borderColor={targetCardBorderColor} bg={targetCardBg} borderRadius="md"><Text fontSize="10px" fontWeight="700" color={targetLabelColor} textTransform="uppercase" mb={2}>Trading For</Text><Text fontSize="13px" fontWeight="700" noOfLines={2}>{targetProduct.title}</Text>{additionalTargetIds.length > 0 && <Text fontSize="10px" color="blue.700" mt={1}>+ {additionalTargetIds.length} more requested item{additionalTargetIds.length > 1 ? 's' : ''}</Text>}</Box>}
      {selectedSummary || <Text fontSize="12px" color={mutedTextColor}>No offered items selected yet.</Text>}
      <Box p={3} borderWidth="1px" borderColor={borderColor} borderRadius="md"><VStack spacing={1.5} align="stretch"><HStack justify="space-between"><Text fontSize="11px" color={mutedTextColor}>Method</Text><Text fontSize="11px" fontWeight="700" textTransform="capitalize">{tradeOption || 'Not selected'}</Text></HStack><HStack justify="space-between"><Text fontSize="11px" color={mutedTextColor}>Money</Text><Text fontSize="11px" fontWeight="700">{cashAmount ? `PHP ${cashAmount}` : 'None'}</Text></HStack><HStack justify="space-between" align="start"><Text fontSize="11px" color={mutedTextColor}>Message</Text><Text fontSize="11px" fontWeight="600" maxW="65%" textAlign="right" noOfLines={2}>{tradeMessage || 'None'}</Text></HStack></VStack></Box>
      <Box p={3} borderWidth="1px" borderColor={borderColor} borderRadius="md" bg="gray.50">
        <VStack spacing={1.5} align="stretch">
          <HStack justify="space-between" align="start">
            <Text fontSize="11px" color={mutedTextColor}>Location</Text>
            <Text fontSize="11px" fontWeight="700" maxW="65%" textAlign="right" noOfLines={2}>
              {tradeOption === 'pickup' ? selectedPickupLocationLabel || 'To Be Decided' : resolvedMeetupAddress || 'Not selected'}
            </Text>
          </HStack>
          <HStack justify="space-between">
            <Text fontSize="11px" color={mutedTextColor}>Collection time</Text>
            <Text fontSize="11px" fontWeight="700">{meetupDate && meetupTime ? `${meetupDate} ${meetupTime}` : 'Not selected'}</Text>
          </HStack>
        </VStack>
      </Box>
    </VStack>
  )

  return (
    <Modal isOpen={isOpen} onClose={onClose} isCentered={!isMobile} size={isMobile ? 'full' : '6xl'} scrollBehavior="inside" motionPreset={isMobile ? 'slideInBottom' : 'scale'}>
      <ModalOverlay />
      <ModalContent
        {...mobileSheetMotionProps}
        display="flex"
        flexDirection="column"
        w={{ base: '100vw', md: 'calc(100vw - 32px)' }}
        maxW={{ base: '100vw', md: '900px', lg: '980px' }}
        h={{ base: '90vh', md: 'min(90vh, 760px)' }}
        maxH="90vh"
        my={{ base: 0, md: 4 }}
        mt={{ base: 'auto', md: 4 }}
        mb={{ base: 0, md: 4 }}
        borderTopRadius={{ base: '18px', md: 'md' }}
        borderBottomRadius={{ base: 0, md: 'md' }}
        overflow="hidden"
      >
        {isMobile && (
          <Box
            display="flex"
            justifyContent="center"
            pt={3}
            pb={1}
            flexShrink={0}
            cursor="grab"
            style={{ touchAction: 'none' }}
            onPointerDown={(event) => sheetDragControls.start(event)}
          >
            <Box w="44px" h="5px" bg="gray.300" borderRadius="full" />
          </Box>
        )}
        <ModalHeader flexShrink={0} fontSize="lg" fontWeight="semibold" pb={isMobile ? 2 : 3}>
          {user ? (isEditMode ? 'Edit Your Offer' : 'Propose a Trade') : 'Sign in to Continue'}
        </ModalHeader>
        <ModalBody p={0} flex="1" minH={0} overflow="hidden">
          {user ? (
            <VStack spacing={0} align="stretch" h="full" minH={0}>
              {isMobile && (
                <Box px={4} pb={2} flexShrink={0}>
                  <HStack justify="space-between" mb={2}>
                    {mobileSteps.map((label, index) => (
                      <Text key={label} fontSize="9px" fontWeight={mobileStep === index ? '800' : '600'} color={mobileStep === index ? selectedTextColor : mutedTextColor} noOfLines={1}>
                        {index + 1}. {label}
                      </Text>
                    ))}
                  </HStack>
                  <Progress value={((mobileStep + 1) / mobileSteps.length) * 100} size="xs" colorScheme="green" borderRadius="full" />
                </Box>
              )}

              <Box flex="1" minH={0} overflowY="auto" px={{ base: 4, md: 5 }} pt={2} pb={4}>
                {isMobile ? (
                  <AnimatePresence mode="wait" initial={false}>
                    <motion.div
                      key={mobileStep}
                      initial={prefersReducedMotion ? false : { opacity: 0, x: 16 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={prefersReducedMotion ? undefined : { opacity: 0, x: -16 }}
                      transition={{ duration: motionDurations.uiSlow, ease: motionEasings.easeOut }}
                      style={{ willChange: 'transform, opacity' }}
                    >
                      {mobileStep === 0 && targetSection}
                      {mobileStep === 1 && offerSection}
                      {mobileStep === 2 && detailsSection}
                      {mobileStep === 3 && reviewSection}
                    </motion.div>
                  </AnimatePresence>
                ) : (
                  <Grid
                    templateColumns={useTwoColumnLayout ? 'minmax(0, 1fr) minmax(300px, 380px)' : '1fr'}
                    gap={4}
                    alignItems="start"
                    w="full"
                    minW={0}
                  >
                    <VStack spacing={3} align="stretch" minW={0}>
                      {targetSection}
                      {offerSection}
                    </VStack>
                    <Box minW={0}>{detailsSection}</Box>
                  </Grid>
                )}
              </Box>
            </VStack>
          ) : (
            <VStack spacing={4} p={5}>
              <Text color="gray.600" fontSize="12px">You need to be signed in to trade or purchase items.</Text>
              <HStack spacing={3} w="full">
                <Button onClick={onClose} as="a" href="/login" colorScheme="brand" flex={1} size="sm">Sign In</Button>
                <Button onClick={onClose} as="a" href="/register" variant="outline" flex={1} size="sm">Sign Up</Button>
              </HStack>
            </VStack>
          )}
        </ModalBody>

        {user && (
          <Box flexShrink={0} bg={cardBg} borderTopWidth="1px" borderColor={borderColor} px={{ base: 3, md: 5 }} py={3} boxShadow={{ base: '0 -8px 20px rgba(0,0,0,0.08)', md: 'none' }}>
            {tradeValueEstimateSummary}
            {actionButtons}
          </Box>
        )}
      </ModalContent>
    </Modal>
  )
}

export default TradeModal
