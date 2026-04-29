import React, { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Modal,
  ModalOverlay,
  ModalContent,
  ModalHeader,
  ModalCloseButton,
  ModalBody,
  ModalFooter,
  VStack,
  HStack,
  Box,
  Text,
  Button,
  Badge,
  Avatar,
  Divider,
  useToast,
  Spinner,
  Textarea,
  Icon,
  IconButton,
  Flex,
  SimpleGrid,
  Image,
  Card,
  CardBody,
  useColorModeValue,
  Tabs,
  TabList,
  TabPanels,
  Tab,
  TabPanel,
  Progress,
  Input,
  InputGroup,
  InputLeftElement,
  FormControl,
  FormLabel,
  Grid,
  AlertDialog,
  AlertDialogOverlay,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogBody,
  AlertDialogFooter,
  Center,
} from '@chakra-ui/react'
import VerifiedAvatar from './VerifiedAvatar'
import OptimizedImage from './OptimizedImage'
import { FaMapMarkerAlt, FaCheckCircle, FaClock, FaCalendarAlt, FaHandshake, FaPaperPlane, FaTruck, FaStar, FaStore, FaExclamationTriangle, FaCheck, FaTimesCircle, FaLightbulb, FaInfoCircle, FaLock } from 'react-icons/fa'
import {
  FiMapPin,
  FiPhone,
  FiTruck,
  FiDollarSign,
  FiUpload,
  FiCamera,
  FiCheck,
  FiClock,
  FiPackage,
} from 'react-icons/fi'
import { Circle, MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from 'react-leaflet'
import { motion, useReducedMotion } from 'framer-motion'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { motionDurations, motionEasings } from '../utils/motion'

const MotionBox = motion(Box)

// Fix generic leaflet icon
delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
})

const MapUpdater = ({ lat, lng }: { lat: number; lng: number }) => {
  const map = useMap()
  useEffect(() => {
    const timers = [
      setTimeout(() => {
        map.invalidateSize()
        map.setView([lat, lng], 16, { animate: true })
      }, 350),
      setTimeout(() => {
        map.invalidateSize()
        map.setView([lat, lng], 16, { animate: true })
      }, 700),
    ]
    return () => timers.forEach(t => clearTimeout(t))
  }, [lat, lng, map])
  return null
}

const ModalMapFix = () => {
  const map = useMap()
  useEffect(() => {
    // Delays must exceed Chakra modal open animation (~300ms) so the container
    // has its final dimensions before Leaflet measures it.
    const timers = [
      setTimeout(() => map.invalidateSize(), 350),
      setTimeout(() => map.invalidateSize(), 600),
      setTimeout(() => map.invalidateSize(), 1000),
    ]
    return () => timers.forEach(t => clearTimeout(t))
  }, [map])
  return null
}

const FitBounds: React.FC<{ points: Array<[number, number]> }> = ({ points }) => {
  const map = useMap()
  useEffect(() => {
    if (points.length === 0) return
    const bounds = L.latLngBounds(points.map(([lat, lng]) => L.latLng(lat, lng)))
    map.fitBounds(bounds, { padding: [36, 36], maxZoom: 17 })
  }, [map, points])
  return null
}

const MEETUP_CONFIRM_RADIUS_M = 10
const MAX_GPS_ACCURACY_M = 10
const MEETUP_GRACE_PERIOD_MINUTES = 10

const calculateDistanceMeters = (lat1: number, lng1: number, lat2: number, lng2: number) => {
  const toRad = (value: number) => value * Math.PI / 180
  const earthRadiusM = 6371000
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2)
  return earthRadiusM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

const getDistanceStatusMessage = (distanceM: number, pointLabel: string) => {
  if (distanceM <= MEETUP_CONFIRM_RADIUS_M) return "You're at the location. You can now confirm."
  if (distanceM <= 15) return 'Walk a little more to confirm.'
  if (distanceM <= 50) return "You're almost there."
  return `You are ${Math.round(distanceM)}m away from the ${pointLabel}.`
}

const parseLatLngString = (value?: string | null): { lat: number; lng: number } | null => {
  if (!value) return null
  const parts = value.split(',').map(Number)
  if (parts.length !== 2 || !Number.isFinite(parts[0]) || !Number.isFinite(parts[1])) return null
  return { lat: parts[0], lng: parts[1] }
}

const approximatePoint = (point: { lat: number; lng: number } | null, offset = 0) => {
  if (!point) return null
  return {
    lat: Math.round((point.lat + offset) * 1000) / 1000,
    lng: Math.round((point.lng - offset) * 1000) / 1000,
  }
}

const formatTrackingDistance = (meters: number | null) => {
  if (meters === null) return 'Calculating distance...'
  if (meters < 1000) return `${Math.round(meters)} m`
  return `${(meters / 1000).toFixed(1)} km`
}

const estimateTravelWindow = (meters: number | null, durationSeconds?: number | null) => {
  if (durationSeconds && durationSeconds > 0) {
    const minutes = Math.max(1, Math.round(durationSeconds / 60))
    return `${minutes} min`
  }
  if (meters === null) return 'Calculating ETA...'
  const minutes = Math.max(2, Math.round(meters / 67))
  return `${Math.max(1, minutes - 4)}-${minutes + 6} mins`
}

const parseTradeDateTime = (value?: string | null): Date | null => {
  if (!value) return null
  const trimmed = value.trim()
  if (!trimmed) return null
  const normalized = trimmed.includes('T') ? trimmed : trimmed.includes(' ') ? trimmed.replace(' ', 'T') : trimmed
  const parsed = new Date(normalized)
  if (!Number.isNaN(parsed.getTime())) return parsed
  return null
}

const formatArrivalCountdown = (deadline: Date | null, nowMs: number, mode: 'Pickup' | 'Meetup') => {
  if (!deadline) return `${mode} time not set`
  const diffMinutes = Math.round((deadline.getTime() - nowMs) / 60000)
  if (diffMinutes > 0) return `${mode} in ${diffMinutes} minute${diffMinutes === 1 ? '' : 's'}`
  const lateMinutes = Math.abs(diffMinutes)
  if (lateMinutes === 0) return `${mode} time is now`
  return `You are ${lateMinutes} minute${lateMinutes === 1 ? '' : 's'} late`
}

import { Trade, Product, TradeOption, Delivery } from '../types'
import { api } from '../services/api'
import { useAuth } from '../contexts/AuthContext'
import { useProducts } from '../contexts/ProductContext'
import { getFirstImage, getImageUrl } from '../utils/imageUtils'

interface TradeMessage {
  id: number
  trade_id: number
  sender_id: number
  content: string
  created_at: string
  sender_name?: string
}

const linkBlockPattern = /(https?:\/\/|www\.|facebook\.com|fb\.com|m\.me|instagram\.com|t\.me|telegram\.me|wa\.me|whatsapp\.com)/i
const isBlockedMessage = (value: string): boolean => {
  const trimmed = value.trim()
  if (!trimmed) return false
  if (/^photo:/i.test(trimmed)) return true
  return linkBlockPattern.test(trimmed)
}

interface ViewTradeModalProps {
  trade: Trade | null
  isOpen: boolean
  onClose: () => void
  onStatusUpdate: () => void
  onTradeUpdate?: (updatedTrade: Trade) => void
}

// Dynamic pricing calculation based on distance
const calculateDeliveryFee = (distance: number, type: 'standard' | 'express'): number => {
  const baseFee = type === 'express' ? 60 : 30
  const perKmRate = 10
  const total = baseFee + (distance * perKmRate)
  return Math.round(total * 100) / 100
}

const formatTimePH = (time?: string | null): string => {
  if (!time) return ''

  const parts = time.split(':')
  if (parts.length < 2) return time

  const hour24 = Number.parseInt(parts[0], 10)
  const minute = parts[1]
  if (Number.isNaN(hour24)) return time

  const suffix = hour24 >= 12 ? 'PM' : 'AM'
  const hour12 = ((hour24 + 11) % 12) + 1

  if (minute === '00') return `${hour12} ${suffix}`
  return `${hour12}:${minute} ${suffix}`
}

const normalizeTimeValue = (value: string): string => {
  const trimmed = value.trim()
  const match = trimmed.match(/^(\d{2}:\d{2})/)
  return match ? match[1] : trimmed
}

const splitMeetupDateTime = (value?: string | null): { date: string | null; time: string | null } => {
  if (!value) return { date: null, time: null }
  const trimmed = value.trim()
  if (!trimmed) return { date: null, time: null }

  if (trimmed.includes('T')) {
    const [datePart, timePart] = trimmed.split('T')
    return {
      date: datePart || null,
      time: timePart ? normalizeTimeValue(timePart) : null,
    }
  }

  if (trimmed.includes(' ')) {
    const [datePart, timePart] = trimmed.split(' ')
    return {
      date: datePart || null,
      time: timePart ? normalizeTimeValue(timePart) : null,
    }
  }

  return { date: null, time: normalizeTimeValue(trimmed) }
}

const buildMeetupKey = (location: string | null, date: string | null, time: string | null): string | null => {
  if (!location || !time) return null
  const normalizedLocation = location.trim().toLowerCase()
  const normalizedDate = (date || '').trim()
  const normalizedTime = time.trim()
  return `${normalizedLocation}|${normalizedDate}|${normalizedTime}`
}

// Calculate estimated distance between two coordinates (Haversine formula)
const calculateDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371 // Earth's radius in kilometers
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

interface MeetupLocation {
  name: string
  address: string
  type: 'cafe' | 'mall' | 'public' | 'other'
  lat?: number
  lng?: number
  isPartner?: boolean
}

interface DeliveryState {
  deliveryType: 'standard' | 'express'
  paymentMethod: 'online' | 'cod' | 'wallet'
  paymentConfirmed: boolean
  buyerConfirmedReceipt: boolean
  sellerConfirmedDelivery: boolean
  buyerConfirmedDeliveryType: boolean  // Buyer confirmed delivery type selection
  sellerConfirmedDeliveryType: boolean  // Seller confirmed delivery type selection
  buyerDeliveryType: 'standard' | 'express' | null  // Buyer's selected delivery type
  sellerDeliveryType: 'standard' | 'express' | null  // Seller's selected delivery type
  deliveryInstructions: string
  distance?: number // Add distance for dynamic pricing
}

type TradeProgressStage = 'meetup_confirmed' | 'trade_in_progress' | 'completed'

const PROGRESS_STEPS = [
  { id: 'meetup_confirmed', label: 'Location Confirmed', icon: FaMapMarkerAlt, description: 'Location, date and time confirmed by both parties' },
  { id: 'trade_in_progress', label: 'Trade in Progress', icon: FaClock, description: 'Exchange is happening' },
  { id: 'completed', label: 'Trade Completed', icon: FaCheckCircle, description: 'Trade finished and rated' },
]

interface TradeProgressIndicatorProps {
  trade: Trade | null
}

const TradeProgressIndicator: React.FC<TradeProgressIndicatorProps> = ({ trade }) => {
  const prefersReducedMotion = useReducedMotion()
  const completedBg = useColorModeValue('green.500', 'green.600')
  const activeBg = useColorModeValue('brand.500', 'brand.600')
  const inactiveBg = useColorModeValue('gray.300', 'gray.600')
  const textColor = useColorModeValue('gray.800', 'gray.100')
  const descriptionColor = useColorModeValue('gray.600', 'gray.400')
  const activeRingColor = useColorModeValue('brand.50', 'brand.950')
  const lineInactiveColor = useColorModeValue('gray.200', 'gray.700')

  const steps = useMemo(() => {
    if (trade?.trade_option !== 'delivery') return PROGRESS_STEPS

    // Delivery trades should not display meetup terminology.
    return PROGRESS_STEPS.map((s) => {
      if (s.id !== 'meetup_confirmed') return s
      return {
        ...s,
        label: 'Delivery Confirmed',
        icon: FaTruck,
        description: 'Delivery option confirmed for both parties',
      }
    })
  }, [trade?.trade_option])

  const getTradeProgressStage = (): TradeProgressStage => {
    if (trade?.status === 'completed') return 'completed'

    // For delivery trades, mark as trade_in_progress when active
    if (trade?.trade_option === 'delivery' && trade?.status === 'active') {
      return 'trade_in_progress'
    }

    // For meetup trades, only mark as trade_in_progress if BOTH parties confirmed meetup
    const bothConfirmed = (trade as any)?.meetup_confirmed ||
      ((trade as any)?.buyer_meetup_confirmed && (trade as any)?.seller_meetup_confirmed)

    if (bothConfirmed && trade?.status === 'active') {
      return 'trade_in_progress'
    }

    // Default to meetup_confirmed (but this is just the stage name, not actual status)
    // The stepper will show this as inactive/pending until both confirm
    return 'meetup_confirmed'
  }

  const currentStage = getTradeProgressStage()
  const currentStepIndex = steps.findIndex(s => s.id === currentStage)

  // Fix: Only mark steps as 'active' if they are truly reached
  const getStepStatus = (stepIndex: number): 'completed' | 'active' | 'inactive' => {
    // Step 0 logic depends on trade type
    if (stepIndex === 0) {
      if (trade?.trade_option === 'delivery') {
        // For delivery trades, step 0 represents confirming delivery method.
        // Mark it active on acceptance, and completed once trade is active.
        if (trade?.status === 'active' || trade?.status === 'completed') return 'completed'
        return trade?.status === 'accepted' ? 'active' : 'inactive'
      } else {
        // For meetup trades, step 0 is active when both parties confirm meetup
        const bothConfirmed = trade?.meetup_confirmed || (trade?.buyer_meetup_confirmed && trade?.seller_meetup_confirmed)
        if (!bothConfirmed) return 'inactive'
        return trade?.status === 'active' || trade?.status === 'completed' ? 'completed' : 'active'
      }
    }

    // Other steps follow normal progression
    if (stepIndex < currentStepIndex) return 'completed'
    if (stepIndex === currentStepIndex) return 'active'
    return 'inactive'
  }

  const getStepBg = (status: 'completed' | 'active' | 'inactive') => {
    switch (status) {
      case 'completed': return completedBg
      case 'active': return activeBg
      case 'inactive': return inactiveBg
    }
  }

  return (
    <VStack spacing={3} w="full" align="stretch">
      {/* Steps - Horizontal Layout */}
      <HStack spacing={0} w="full" align="center" justify="space-between" position="relative">
        {steps.map((step, index) => {
          const status = getStepStatus(index)
          const stepBg = getStepBg(status)

          return (
            <MotionBox key={step.id} flex={1} display="flex" flexDirection="column" alignItems="center" position="relative" zIndex={index + 1} layout>
              {/* Step Circle */}
              <MotionBox
                w="36px"
                h="36px"
                borderRadius="full"
                bg={stepBg}
                color="white"
                display="flex"
                alignItems="center"
                justifyContent="center"
                boxShadow={status === 'active' ? `0 0 0 3px ${activeRingColor}` : 'none'}
                flexShrink={0}
                animate={prefersReducedMotion ? undefined : {
                  scale: status === 'active' ? [1, 1.06, 1] : 1,
                  opacity: status === 'inactive' ? 0.72 : 1,
                }}
                transition={{ duration: 0.36, ease: motionEasings.easeOut }}
              >
                <Icon as={step.icon} boxSize="4" />
              </MotionBox>

              {/* Step Label */}
              <Text
                mt={3}
                fontSize="xs"
                fontWeight={status === 'active' ? 'semibold' : 'medium'}
                color={status === 'completed' ? 'green.600' : status === 'active' ? 'brand.600' : descriptionColor}
                textAlign="center"
                maxW="70px"
                transition="all 0.2s"
                noOfLines={2}
              >
                {step.label}
              </Text>
            </MotionBox>
          )
        })}

        {/* Connecting Lines - Centered */}
        <Box position="absolute" top="50%" transform="translateY(-50%)" left="0" right="0" h="1.5px" display="flex" pointerEvents="none" zIndex={0}>
          {steps.map((step, index) => {
            if (index === steps.length - 1) return null

            const status = getStepStatus(index)
            const lineColor = status === 'completed' ? completedBg : lineInactiveColor

            return (
              <MotionBox
                key={`line-${index}`}
                flex={1}
                h="1.5px"
                bg={lineColor}
                initial={false}
                animate={{ opacity: status === 'completed' ? 1 : 0.55, scaleX: status === 'completed' ? 1 : 0.96 }}
                transition={{ duration: motionDurations.uiSlow, ease: motionEasings.easeInOut }}
                mx={0}
                transformOrigin="left center"
              />
            )
          })}
        </Box>
      </HStack>

      {/* Current Stage Description */}
      <Text fontSize="sm" color={descriptionColor} fontWeight="medium" textAlign="center" mt={1}>
        {steps[currentStepIndex]?.description}
      </Text>
    </VStack>
  )
}

interface DeliveryTabProps {
  deliveryState: DeliveryState
  setDeliveryState: React.Dispatch<React.SetStateAction<DeliveryState>>
  deliveryOptions: Record<string, { time: string; fee: number; icon: string; description: string }>
  requestedProduct: Product | null
  trade: Trade | null
  distance: number
  isUserSeller: boolean
  isUserBuyer: boolean
  handleInstantComplete: () => Promise<void>
  completingTrade: boolean
  handleConfirmPayment: () => Promise<void>
  handleConfirmDelivery: () => Promise<void>
  saveDeliveryState: (updates: Partial<DeliveryState>) => Promise<void>
  confirmDeliveryType: () => Promise<void>
  confirmingPayment: boolean
  confirmingDeliveryType: boolean
  syncingOnlinePayment: boolean
  linkedDelivery: Delivery | null
  linkedDeliveries: Delivery[]
}

const DeliveryTab: React.FC<DeliveryTabProps> = ({
  deliveryState,
  setDeliveryState,
  deliveryOptions,
  requestedProduct,
  trade,
  distance,
  isUserSeller,
  isUserBuyer,
  handleConfirmPayment,
  handleConfirmDelivery,
  saveDeliveryState,
  confirmDeliveryType,
  handleInstantComplete,
  completingTrade,
  confirmingPayment,
  confirmingDeliveryType,
  syncingOnlinePayment,
  linkedDelivery,
  linkedDeliveries,
}) => {
  const bothConfirmed = deliveryState.buyerConfirmedReceipt && deliveryState.sellerConfirmedDelivery
  const allLegsDelivered = linkedDeliveries.length > 0
    ? linkedDeliveries.every(d => d.status === 'delivered')
    : linkedDelivery?.status === 'delivered'
  const deliveryCompleted = allLegsDelivered
  const deliveryFee = deliveryOptions[deliveryState.deliveryType].fee
  const isBuyout = trade && (trade.offered_cash_amount || 0) > 0 && 
                  (!trade.items || !trade.items.some(item => item.offered_by === 'buyer'));

  const deliverySteps = isBuyout ? [
    { status: 'claimed', label: 'Rider Claimed' },
    { status: 'buyer_cash', label: 'Cash Collection' },
    { status: 'seller_pickup', label: 'Item Acquisition' },
    { status: 'delivered', label: 'Final Delivery' },
  ] : [
    { status: 'pending', label: 'Pending' },
    { status: 'claimed', label: 'Claimed' },
    { status: 'picked_up', label: 'Picked Up' },
    { status: 'in_transit', label: 'In Transit' },
    { status: 'delivered', label: 'Delivered' },
  ] as const

  let deliveryStatus: string = linkedDelivery?.status || (deliveryCompleted ? 'delivered' : 'pending');
  
  // Custom status mapping for buyout
  if (isBuyout && linkedDelivery && linkedDelivery.stops && linkedDelivery.stops.length > 0) {
    const stops = linkedDelivery.stops;
    const paymentStop = stops.find(s => s.stop_type === 'buyer_payment');
    const pickupStop = stops.find(s => s.stop_type === 'pickup');
    const deliveryStop = stops.find(s => s.stop_type === 'delivery');

    // Determine progress based on the furthest completed or arrived stop
    if (deliveryStop?.status === 'completed') {
      deliveryStatus = 'delivered';
    } else if (deliveryStop?.status === 'arrived') {
      deliveryStatus = 'delivered'; 
    } else if (pickupStop?.status === 'completed') {
      deliveryStatus = 'seller_pickup';
    } else if (pickupStop?.status === 'arrived' || pickupStop?.status === 'fee_collected') {
      deliveryStatus = 'seller_pickup';
    } else if (paymentStop?.status === 'completed') {
       deliveryStatus = 'buyer_cash';
    } else if (paymentStop?.status === 'arrived' || paymentStop?.status === 'fee_collected') {
      deliveryStatus = 'buyer_cash';
    } else if (linkedDelivery.status === 'claimed') {
      deliveryStatus = 'claimed';
    }
  }

  const deliveryStepIndexRaw = deliverySteps.findIndex(s => s.status === deliveryStatus)
  const deliveryStepIndex = deliveryStepIndexRaw >= 0 ? deliveryStepIndexRaw : (deliveryCompleted ? deliverySteps.length - 1 : 0)
  const deliveryProgress = ((deliveryStepIndex + 1) / deliverySteps.length) * 100
  
  const deliveryStatusColorScheme =
    deliveryStatus === 'delivered'
      ? 'green'
      : (deliveryStatus === 'seller_pickup' || deliveryStatus === 'in_transit')
        ? 'orange'
        : (deliveryStatus === 'buyer_cash' || deliveryStatus === 'picked_up')
          ? 'purple'
          : deliveryStatus === 'claimed'
            ? 'blue'
            : 'gray'

  // Auto-confirm COD payment when delivery type is selected
  useEffect(() => {
    if (deliveryState.deliveryType && !deliveryState.paymentConfirmed && !confirmingPayment) {
      handleConfirmPayment()
    }
  }, [deliveryState.deliveryType])

  const productPrice = trade?.offered_cash_amount || 0
  const legFee = linkedDelivery?.total_cost ? (linkedDelivery.total_cost * 0.5) : deliveryFee

  // Dynamic guidance based on status
  const getStatusGuidance = () => {
    if (!linkedDelivery || linkedDelivery.status === 'pending') {
      return "Waiting for a rider to claim this delivery."
    }
    switch (deliveryStatus) {
      case 'claimed': 
        return "Rider is heading to the Buyer to collect the product payment and initial delivery fee."
      case 'buyer_cash': 
        return "Payment collected! Rider is now heading to the Seller to pay for and pick up the item."
      case 'seller_pickup': 
        return "Item acquired! Rider is now heading back to the Buyer for final delivery."
      case 'delivered': 
        return "Delivery complete! Please confirm receipt and leave a review."
      default: 
        return "Rider is actively handling your delivery."
    }
  }

  return (
    <VStack spacing={4} align="stretch">
      {/* Delivery tracking (same layout as Overview tab) */}
      <Card variant="outline" borderWidth="1px" borderColor="gray.200">
        <CardBody p={4}>
          <VStack spacing={3} align="stretch">
            <HStack spacing={3} align="center">
              <Icon as={FaTruck} color="green.600" />
              <Text fontWeight="600" fontSize="sm">Buyout Delivery Tracking</Text>
              <Badge ml="auto" colorScheme={deliveryStatusColorScheme} fontSize="xs">
                {deliveryStatus.replace(/_/g, ' ').toUpperCase()}
              </Badge>
            </HStack>

            <Progress value={deliveryProgress} size="sm" borderRadius="full" colorScheme={deliveryStatusColorScheme} />

            <Text fontSize="2xs" color="gray.600">
              Buyout delivery (round trip)
            </Text>

            <HStack justify="space-between" align="start" spacing={2}>
              {deliverySteps.map((step, idx) => {
                const isActive = idx <= deliveryStepIndex
                return (
                  <VStack key={step.status} spacing={1} flex={1} minW={0}>
                    <Box
                      w="10px"
                      h="10px"
                      borderRadius="full"
                      bg={isActive ? `${deliveryStatusColorScheme}.500` : 'gray.300'}
                    />
                    <Text fontSize="2xs" color={isActive ? 'gray.700' : 'gray.500'} textAlign="center" noOfLines={1}>
                      {step.label}
                    </Text>
                  </VStack>
                )
              })}
            </HStack>


            {linkedDelivery?.rider_name ? (
              <Text fontSize="xs" color="gray.600">
                Rider: <Text as="span" fontWeight="semibold">{linkedDelivery.rider_name}</Text>
              </Text>
            ) : (
              <Text fontSize="xs" color="gray.600">Waiting for a rider to claim this delivery.</Text>
            )}

            <Box p={3} bg="gray.50" borderRadius="md" borderLeftWidth="4px" borderLeftColor="gray.300">
              <HStack spacing={2}>
                <Icon as={FaInfoCircle} color="gray.400" />
                <Text fontSize="xs" color="gray.600" fontWeight="medium">
                  {getStatusGuidance()}
                </Text>
              </HStack>
            </Box>
          </VStack>
        </CardBody>
      </Card>

      {/* Buyout Transaction Summary (New) */}
      <Card variant="outline" borderColor="gray.200" bg="gray.50">
        <CardBody p={3}>
           <VStack align="stretch" spacing={2}>
             <Text fontWeight="bold" fontSize="xs" color="gray.700" textTransform="uppercase">Transaction Summary</Text>
             <Divider borderColor="blue.200" />
             {isUserBuyer ? (
               <VStack align="stretch" spacing={1}>
                 <HStack justify="space-between">
                   <Text fontSize="xs" color="gray.600">Prepare for Rider:</Text>
                   <Text fontSize="sm" fontWeight="bold" color="green.600">₱{(productPrice + legFee).toLocaleString()}</Text>
                 </HStack>
                 <Text fontSize="2xs" color="gray.500">
                   (₱{productPrice.toLocaleString()} product + ₱{legFee.toLocaleString()} initial fee)
                 </Text>
               </VStack>
             ) : (
               <VStack align="stretch" spacing={1}>
                 <HStack justify="space-between">
                   <Text fontSize="xs" color="gray.600">You will receive:</Text>
                   <Text fontSize="sm" fontWeight="bold" color="green.600">₱{productPrice.toLocaleString()}</Text>
                 </HStack>
                 <HStack justify="space-between">
                   <Text fontSize="xs" color="gray.600">You will pay fee:</Text>
                   <Text fontSize="sm" fontWeight="bold" color="red.600">- ₱{legFee.toLocaleString()}</Text>
                 </HStack>
               </VStack>
             )}
           </VStack>
        </CardBody>
      </Card>


      <Card variant="outline" borderColor="green.200">
        <CardBody py={[2, 3]} px={[3, 4]}>
          <HStack justify="space-between" align={["start", "center"]} spacing={2} flexDir={["column", "row"]}>
            <HStack spacing={2} align="start">
              <Text fontSize={['lg', '2xl']}>🚚</Text>
              <VStack align="start" spacing={0}>
                <Text fontSize="sm" fontWeight="semibold">Delivery Fee (Cash on Delivery)</Text>
                <Text fontSize="xs" color="gray.500">Total split between Buyer and Seller</Text>
              </VStack>
            </HStack>
            <Text fontSize="sm" fontWeight="bold" color="green.600">
              ₱{legFee.toFixed(2)} <Text as="span" fontSize="2xs" color="gray.500" fontWeight="normal">per leg</Text>
            </Text>
          </HStack>
        </CardBody>
      </Card>

      <Card borderWidth="2px" borderColor={bothConfirmed ? 'green.400' : 'gray.200'} bg={bothConfirmed ? 'green.50' : 'white'}>
        <CardBody>
          <VStack spacing={4} align="stretch">
            <Text fontWeight="semibold" fontSize="sm">Completion</Text>

            {!deliveryState.paymentConfirmed && (
              <Box p={3} bg="yellow.50" borderRadius="md" borderLeftWidth="4px" borderLeftColor="yellow.400">
                <Text fontSize="sm" color="yellow.700">Complete payment to continue.</Text>
              </Box>
            )}

            {deliveryCompleted && ((isUserBuyer && !deliveryState.buyerConfirmedReceipt) || (isUserSeller && !deliveryState.sellerConfirmedDelivery)) && (
              <Button colorScheme="blue" onClick={handleConfirmDelivery} leftIcon={<FiCheck />}>
                {isUserBuyer ? 'Confirm Receipt' : 'Confirm Hand-off'}
              </Button>
            )}

            {(deliveryCompleted || (!linkedDelivery && ((deliveryState.paymentConfirmed && deliveryState.deliveryInstructions) || bothConfirmed))) && (
              <Button
                colorScheme="green"
                size="lg"
                onClick={handleInstantComplete}
                isLoading={completingTrade}
                loadingText="Completing..."
                leftIcon={<FaCheckCircle />}
                w="full"
                transition="all 0.2s"
                _hover={{ transform: 'translateY(-2px)', shadow: 'lg' }}
              >
                Leave a Review and Complete Trade
              </Button>
            )}
          </VStack>
        </CardBody>
      </Card>
    </VStack>
  )
}

interface ReviewTabProps {
  trade: Trade | null
  isUserBuyer: boolean
  isUserSeller: boolean
  user: any
  onStatusUpdate: () => void
}

const ReviewTab: React.FC<ReviewTabProps> = ({
  trade,
  isUserBuyer,
  isUserSeller,
  user,
  onStatusUpdate,
}) => {
  const toast = useToast()
  const [rating, setRating] = useState(5)
  const [feedback, setFeedback] = useState('')
  const [proofImage, setProofImage] = useState<string | null>(null)
  const [proofFile, setProofFile] = useState<File | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [completionStatus, setCompletionStatus] = useState<any>(null)
  const [loadingStatus, setLoadingStatus] = useState(false)

  const cardBg = useColorModeValue('white', 'gray.800')
  const borderColor = useColorModeValue('gray.200', 'gray.700')
  const meetupInfoBg = useColorModeValue('gray.50', 'gray.800')

  const tradeOption = (trade?.trade_option || 'meetup') as TradeOption
  const proofRequired = tradeOption === 'meetup' || tradeOption === 'delivery'

  useEffect(() => {
    if (!trade) return

    const fetchStatus = async () => {
      try {
        setLoadingStatus(true)
        const response = await api.get(`/api/trades/${trade.id}`)
        const tradeData = response.data?.data
        setCompletionStatus({
          buyer_completed: !!tradeData?.buyer_completed,
          seller_completed: !!tradeData?.seller_completed,
          buyer_rating: tradeData?.buyer_rating,
          seller_rating: tradeData?.seller_rating,
          buyer_feedback: tradeData?.buyer_feedback,
          seller_feedback: tradeData?.seller_feedback,
        })
      } catch (error) {
        console.error('Failed to fetch completion status:', error)
        // Set empty completion status on error
        setCompletionStatus({
          buyer_completed: false,
          seller_completed: false,
          buyer_rating: 0,
          seller_rating: 0,
          buyer_feedback: '',
          seller_feedback: '',
        })
      } finally {
        setLoadingStatus(false)
      }
    }

    fetchStatus()
  }, [trade])

  const handleProofUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.[0]) {
      const file = e.target.files[0]
      setProofFile(file)
      const reader = new FileReader()
      reader.onloadend = () => {
        setProofImage(reader.result as string)
      }
      reader.readAsDataURL(file)
    }
  }

  const submitReview = async () => {
    if (!trade || !rating || !feedback.trim()) {
      toast({
        id: "viewtrademodal-missing-information",
        title: 'Missing information',
        description: 'Please provide a rating and feedback.',
        status: 'warning',
      })
      return
    }

    if (proofRequired && !proofFile) {
      toast({
        id: 'viewtrademodal-proof-required',
        title: 'Proof image required',
        description: 'Please upload a proof image before submitting your review.',
        status: 'warning',
      })
      return
    }

    try {
      setSubmitting(true)

      // Upload proof image first if provided
      let uploadedProofUrl: string | undefined
      if (proofFile) {
        const formData = new FormData()
        formData.append('image', proofFile)
        formData.append('type', 'trade_proof')
        const uploadRes = await api.post('/api/upload', formData)

        // Validate upload succeeded and has URL
        if (!uploadRes.data?.success) {
          throw new Error(uploadRes.data?.error || 'Upload failed: invalid response')
        }

        // Extract URL (try both possible response structures for backwards compatibility)
        uploadedProofUrl = uploadRes.data?.data?.url

        if (!uploadedProofUrl) {
          throw new Error(uploadRes.data?.error || 'Upload succeeded but no image URL was returned. Please try again.')
        }
      }

      await api.put(`/api/trades/${trade.id}/complete`, {
        rating,
        feedback: feedback.trim(),
        transaction_proof_url: uploadedProofUrl || '',
        is_camera_photo: !!uploadedProofUrl,
      })

      toast({
        id: "viewtrademodal-review-submitted",
        title: 'Review submitted',
        description: 'Your review has been submitted ✅',
        status: 'success',
      })

      // Reset form
      setRating(5)
      setFeedback('')
      setProofImage(null)
      setProofFile(null)

      // Refresh completion status by fetching updated trade data
      try {
        const response = await api.get(`/api/trades/${trade.id}/completion-status`)
        const tradeData = response.data?.data
        setCompletionStatus({
          buyer_completed: !!tradeData?.buyer_completed,
          seller_completed: !!tradeData?.seller_completed,
          buyer_rating: tradeData?.buyer_rating,
          seller_rating: tradeData?.seller_rating,
          buyer_feedback: tradeData?.buyer_feedback,
          seller_feedback: tradeData?.seller_feedback,
        })
      } catch (error) {
        console.error('Failed to refresh completion status:', error)
      }
      onStatusUpdate()
    } catch (error: any) {
      console.error('Review submission error:', error)
      toast({
        id: "viewtrademodal-error",
        title: 'Error',
        description: error?.message || error?.response?.data?.error || 'Failed to submit review',
        status: 'error',
      })
    } finally {
      setSubmitting(false)
    }
  }

  // Determine if this is a buyout (no items, only cash) vs regular trade
  const isBuyout = useMemo(() => {
    return (!trade?.items || trade.items.length === 0) &&
      (trade?.offered_cash_amount && trade.offered_cash_amount > 0)
  }, [trade])

  // Get role labels based on transaction type
  const buyerLabel = isBuyout ? 'Buyer' : 'Trader 1'
  const sellerLabel = isBuyout ? 'Seller' : 'Trader 2'

  const userHasCompleted = isUserBuyer ? completionStatus?.buyer_completed : completionStatus?.seller_completed
  const otherPartyCompleted = isUserBuyer ? completionStatus?.seller_completed : completionStatus?.buyer_completed

  if (loadingStatus) {
    return <Spinner />
  }

  return (
    <VStack spacing={5} align="stretch">
      {loadingStatus ? (
        <Center py={10}>
          <Spinner />
        </Center>
      ) : (
        <>
          {/* Review Status Cards - Compact Layout */}
          {completionStatus && (
            <SimpleGrid columns={2} spacing={3}>
              <Box p={3} bg={completionStatus.buyer_completed ? 'green.50' : 'gray.50'} borderRadius="md" borderWidth="1px" borderColor={borderColor}>
                <VStack spacing={2}>
                  <HStack justify="space-between" w="full">
                    <Text fontWeight="semibold" fontSize="sm">{buyerLabel} Review</Text>
                    <Icon
                      as={completionStatus.buyer_completed ? FaCheck : FaClock}
                      color={completionStatus.buyer_completed ? 'green.500' : 'gray.400'}
                      boxSize={4}
                    />
                  </HStack>
                  {completionStatus.buyer_rating && (
                    <HStack spacing={1} w="full" justify="space-between">
                      <HStack spacing={0.5}>
                        {[1, 2, 3, 4, 5].map((star) => (
                          <Icon
                            key={`buyer-star-${star}`}
                            as={FaStar}
                            color={star <= completionStatus.buyer_rating ? 'yellow.400' : 'gray.300'}
                            boxSize={3}
                          />
                        ))}
                      </HStack>
                      <Text fontSize="xs" color="gray.600" fontWeight="semibold">
                        {completionStatus.buyer_rating}/5
                      </Text>
                    </HStack>
                  )}
                  {completionStatus.buyer_feedback && (
                    <Text fontSize="xs" color="gray.600" noOfLines={1} fontStyle="italic" w="full">
                      "{completionStatus.buyer_feedback}"
                    </Text>
                  )}
                </VStack>
              </Box>

              <Box p={3} bg={completionStatus.seller_completed ? 'green.50' : 'gray.50'} borderRadius="md" borderWidth="1px" borderColor={borderColor}>
                <VStack spacing={2}>
                  <HStack justify="space-between" w="full">
                    <Text fontWeight="semibold" fontSize="sm">{sellerLabel} Review</Text>
                    <Icon
                      as={completionStatus.seller_completed ? FaCheck : FaClock}
                      color={completionStatus.seller_completed ? 'green.500' : 'gray.400'}
                      boxSize={4}
                    />
                  </HStack>
                  {completionStatus.seller_rating && (
                    <HStack spacing={1} w="full" justify="space-between">
                      <HStack spacing={0.5}>
                        {[1, 2, 3, 4, 5].map((star) => (
                          <Icon
                            key={`seller-star-${star}`}
                            as={FaStar}
                            color={star <= completionStatus.seller_rating ? 'yellow.400' : 'gray.300'}
                            boxSize={3}
                          />
                        ))}
                      </HStack>
                      <Text fontSize="xs" color="gray.600" fontWeight="semibold">
                        {completionStatus.seller_rating}/5
                      </Text>
                    </HStack>
                  )}
                  {completionStatus.seller_feedback && (
                    <Text fontSize="xs" color="gray.600" noOfLines={1} fontStyle="italic" w="full">
                      "{completionStatus.seller_feedback}"
                    </Text>
                  )}
                </VStack>
              </Box>
            </SimpleGrid>
          )}

          {/* Review Form - Only show if current user hasn't completed */}
          {!userHasCompleted && (
            <Box borderWidth="1px" borderColor="gray.200" bg={meetupInfoBg} p={4} borderRadius="md">
              <VStack spacing={4} align="stretch">
                <Text fontWeight="semibold" fontSize="sm">
                  Your Review
                </Text>

                {/* Rating */}
                <FormControl isRequired>
                  <FormLabel fontSize="xs" fontWeight="semibold">Rating</FormLabel>
                  <HStack spacing={2}>
                    {[1, 2, 3, 4, 5].map((star) => (
                      <Icon
                        key={star}
                        as={FaStar}
                        color={star <= rating ? 'yellow.400' : 'gray.300'}
                        cursor="pointer"
                        onClick={() => setRating(star)}
                        boxSize={6}
                        transition="all 0.1s"
                        _hover={{ transform: 'scale(1.1)' }}
                      />
                    ))}
                    <Text fontSize="xs" fontWeight="semibold" ml={2}>
                      {rating}/5
                    </Text>
                  </HStack>
                </FormControl>

                {/* Feedback */}
                <FormControl isRequired>
                  <FormLabel fontSize="xs" fontWeight="semibold">Feedback</FormLabel>
                  <Textarea
                    autoFocus
                    value={feedback}
                    onChange={(e) => setFeedback(e.target.value)}
                    placeholder="Share your experience with this trade..."
                    rows={3}
                    fontSize="sm"
                    borderColor={borderColor}
                    _focus={{ borderColor: 'brand.500', boxShadow: '0 0 0 1px var(--chakra-colors-brand-500)' }}
                  />
                  <Text fontSize="xs" color="gray.500" mt={1}>
                    {feedback.length} characters
                  </Text>
                </FormControl>

                {/* Proof Image */}
                <FormControl>
                  <FormLabel fontSize="xs" fontWeight="semibold">
                    Proof Image {proofRequired ? '(Required)' : '(Optional)'}
                  </FormLabel>
                  {proofImage ? (
                    <VStack spacing={2} align="stretch">
                      <Box position="relative" w="full" maxW="250px" bg="gray.50" borderRadius="md" overflow="hidden" aspectRatio="4/3" display="flex" alignItems="center" justifyContent="center">
                        <Image
                          src={proofImage}
                          alt="Proof"
                          w="100%"
                          h="100%"
                          objectFit="contain"
                          borderRadius="md"
                        />
                        <Icon
                          as={FiCheck}
                          position="absolute"
                          top={2}
                          right={2}
                          color="green.500"
                          boxSize={6}
                          bg="white"
                          borderRadius="full"
                          p={1}
                          boxShadow="md"
                        />
                      </Box>
                      <Button
                        size="xs"
                        variant="outline"
                        colorScheme="blue"
                        onClick={() => document.getElementById('proof-upload-review')?.click()}
                      >
                        Change Image
                      </Button>
                    </VStack>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      colorScheme="blue"
                      onClick={() => document.getElementById('proof-upload-review')?.click()}
                      leftIcon={<FiUpload />}
                      w="full"
                    >
                      Upload Proof Image
                    </Button>
                  )}
                  <Input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    display="none"
                    id="proof-upload-review"
                    onChange={handleProofUpload}
                  />
                </FormControl>

                {/* Submit Button */}
                <Button
                  colorScheme="green"
                  size="md"
                  onClick={submitReview}
                  isLoading={submitting}
                  w="full"
                  transition="all 0.2s"
                  _hover={{ transform: 'translateY(-2px)', shadow: 'lg' }}
                >
                  Leave a Review and Complete Trade
                </Button>
              </VStack>
            </Box>
          )}

          {/* Both Completed Message */}
          {completionStatus?.buyer_completed && completionStatus?.seller_completed && (
            <Box p={3} bg="green.50" borderRadius="md" borderWidth="2px" borderColor="green.300" textAlign="center">
              <Icon as={FiCheck} boxSize={6} color="green.500" mb={2} mx="auto" display="block" />
              <Text fontWeight="bold" color="green.700" mb={1} fontSize="sm">
                Trade Completed Successfully! 🎉
              </Text>
              <Text fontSize="xs" color="green.600">
                Both parties have submitted their reviews. Thank you for using Clovia!
              </Text>
            </Box>
          )}

          {/* One Party Completed Message */}
          {userHasCompleted && !otherPartyCompleted && (
            <Box p={4} bg="gray.50" borderRadius="lg" borderWidth="1px" borderColor="gray.200" textAlign="center">
              <Icon as={FaCheckCircle} boxSize={6} color="green.500" mb={2} mx="auto" display="block" />
              <Text fontWeight="semibold" color="gray.700" mb={1}>
                Your review has been submitted ✅
              </Text>
              <Text fontSize="sm" color="gray.600">
                Waiting for the other party to complete their review...
              </Text>
            </Box>
          )}
        </>
      )}
    </VStack>
  )
}

const ViewTradeModal: React.FC<ViewTradeModalProps> = ({
  trade,
  isOpen,
  onClose,
  onStatusUpdate,
  onTradeUpdate,
}) => {
  const { user } = useAuth()
  const { getProduct } = useProducts()
  const toast = useToast()
  const navigate = useNavigate()
  const [messages, setMessages] = useState<TradeMessage[]>([])
  const [newMessage, setNewMessage] = useState('')
  const [sendingMessage, setSendingMessage] = useState(false)
  const [loadingMessages, setLoadingMessages] = useState(false)
  const [chatPhotoFile, setChatPhotoFile] = useState<File | null>(null)
  const [chatPhotoPreview, setChatPhotoPreview] = useState<string | null>(null)
  const [uploadingChatPhoto, setUploadingChatPhoto] = useState(false)
  const chatPhotoInputRef = useRef<HTMLInputElement>(null)
  const [requestedProduct, setRequestedProduct] = useState<Product | null>(null)
  const [additionalRequestedProducts, setAdditionalRequestedProducts] = useState<Product[]>([])
  const [offeredProducts, setOfferedProducts] = useState<Product[]>([])
  const [loadingProducts, setLoadingProducts] = useState(false)
  const [selectedLocation, setSelectedLocation] = useState<string | null>(null)
  const [searchedLocations, setSearchedLocations] = useState<MeetupLocation[]>([])
  const [placeQuery, setPlaceQuery] = useState('')
  const [placeResults, setPlaceResults] = useState<Array<{ name: string; address: string; latitude: number; longitude: number }>>([])
  const [placeSearching, setPlaceSearching] = useState(false)
  const [selectedTime, setSelectedTime] = useState<string | null>(null)
  const [selectedDate, setSelectedDate] = useState<string | null>(null) // New: date for 7-day window
  const [validationError, setValidationError] = useState<string | null>(null) // New: validation message
  const [confirmingMeetup, setConfirmingMeetup] = useState(false)
  const [resettingMeetup, setResettingMeetup] = useState(false)
  const [confirmingPayment, setConfirmingPayment] = useState(false)
  const [syncingOnlinePayment, setSyncingOnlinePayment] = useState(false)
  const [buyerMeetupConfirmed, setBuyerMeetupConfirmed] = useState(false)
  const [sellerMeetupConfirmed, setSellerMeetupConfirmed] = useState(false)
  const [buyerMetConfirmed, setBuyerMetConfirmed] = useState(false)
  const [sellerMetConfirmed, setSellerMetConfirmed] = useState(false)
  // Track each party's meetup selections
  const [buyerMeetupLocation, setBuyerMeetupLocation] = useState<string | null>(null)
  const [buyerMeetupDate, setBuyerMeetupDate] = useState<string | null>(null)
  const [buyerMeetupTime, setBuyerMeetupTime] = useState<string | null>(null)
  const [sellerMeetupLocation, setSellerMeetupLocation] = useState<string | null>(null)
  const [sellerMeetupDate, setSellerMeetupDate] = useState<string | null>(null)
  const [sellerMeetupTime, setSellerMeetupTime] = useState<string | null>(null)
  const [meetupPoint, setMeetupPoint] = useState<{ lat: number; lng: number } | null>(null)
  const [userGeoPoint, setUserGeoPoint] = useState<{ lat: number; lng: number; accuracy: number } | null>(null)
  const [geoChecking, setGeoChecking] = useState(false)
  const [geoMessage, setGeoMessage] = useState<string | null>(null)
  const [geoPermissionDenied, setGeoPermissionDenied] = useState(false)
  const [pickupRouteCoords, setPickupRouteCoords] = useState<Array<[number, number]>>([])
  const [pickupRouteMetrics, setPickupRouteMetrics] = useState<{ distanceM: number; durationS: number } | null>(null)
  const [pickupRouteLoading, setPickupRouteLoading] = useState(false)
  const [trackingSheetSnap, setTrackingSheetSnap] = useState<'collapsed' | 'half' | 'full'>('half')
  const [arrivalClockNow, setArrivalClockNow] = useState(() => Date.now())
  const [confirmingMeetupDone, setConfirmingMeetupDone] = useState(false)
  const [isReviewModalOpen, setIsReviewModalOpen] = useState(false)
  const [showCancelDialog, setShowCancelDialog] = useState(false) // New: cancel trade confirmation
  const [cancelingTrade, setCancelingTrade] = useState(false) // New: cancel trade loading state
  const [completingTrade, setCompletingTrade] = useState(false) // Instant complete loading state
  const cancelDialogRef = useRef<HTMLButtonElement>(null) // New: for AlertDialog focus

  // ============ Meetup Dispute & Agreement System ============
  const [meetupInDispute, setMeetupInDispute] = useState(false) // Track if meetup is in dispute
  const [meetupDisputeReason, setMeetupDisputeReason] = useState<'time' | 'date' | 'unresponsive' | 'conflict' | null>(null)
  const [disputeNotes, setDisputeNotes] = useState('') // Additional notes from disputing party
  const [showDisputeDialog, setShowDisputeDialog] = useState(false) // Show dispute creation dialog
  const [showSuggestionsPanel, setShowSuggestionsPanel] = useState(false) // Show smart suggestions
  const [showAgreedConfirmation, setShowAgreedConfirmation] = useState(false) // Show confirmation after agreement
  const [agreeingToSchedule, setAgreeingToSchedule] = useState(false) // Loading state for agreement button
  // ============ END: Dispute & Agreement State ============

  const [deliveryState, setDeliveryState] = useState<DeliveryState>({
    deliveryType: 'standard',
    paymentMethod: 'cod',
    paymentConfirmed: false,
    buyerConfirmedReceipt: false,
    sellerConfirmedDelivery: false,
    buyerConfirmedDeliveryType: false,
    sellerConfirmedDeliveryType: false,
    buyerDeliveryType: null,
    sellerDeliveryType: null,
    deliveryInstructions: '',
  })
  const [linkedDelivery, setLinkedDelivery] = useState<Delivery | null>(null)
  const [linkedDeliveries, setLinkedDeliveries] = useState<Delivery[]>([])
  const [userAvatarById, setUserAvatarById] = useState<Record<number, string>>({})
  const fetchedAvatarUserIdsRef = useRef<Set<number>>(new Set())
  const [mapInitKey, setMapInitKey] = useState(0)  // Force map re-render
  const [tabIndex, setTabIndex] = useState(0) // Track current tab index to fix map render issues
  const pickupWatchIdRef = useRef<number | null>(null)

  // Force map to reinitialize when modal opens or tab changes to Coordination/Map
  useEffect(() => {
    if (isOpen) {
      setMapInitKey(prev => prev + 1)
    }
  }, [isOpen, tabIndex])

  useEffect(() => {
    const lat = Number((trade as any)?.meetup_lat)
    const lng = Number((trade as any)?.meetup_lng)
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      setMeetupPoint({ lat, lng })
    } else {
      setMeetupPoint(null)
    }
    setUserGeoPoint(null)
    setGeoMessage(null)
    setGeoPermissionDenied(false)
    setPickupRouteCoords([])
  }, [trade?.id, (trade as any)?.meetup_lat, (trade as any)?.meetup_lng])

  useEffect(() => {
    if (!isOpen) return
    const timer = window.setInterval(() => setArrivalClockNow(Date.now()), 30000)
    return () => window.clearInterval(timer)
  }, [isOpen])

  // Auto-confirm COD payment when delivery type is selected
  useEffect(() => {
    if (deliveryState.deliveryType && !deliveryState.paymentConfirmed) {
      setDeliveryState(prev => ({
        ...prev,
        paymentConfirmed: true,
        paymentMethod: 'cod',
      }))
    }
  }, [deliveryState.deliveryType, deliveryState.paymentConfirmed])

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesPollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const previousMessageCountRef = useRef(0)  // Track message count to detect new messages
  const messagesRequestSeqRef = useRef(0)
  const shownMessageNotificationsRef = useRef<Set<string>>(new Set())  // Track which message IDs have shown notifications

  const meetupDistanceM = useMemo(() => {
    if (!meetupPoint || !userGeoPoint) return null
    return calculateDistanceMeters(userGeoPoint.lat, userGeoPoint.lng, meetupPoint.lat, meetupPoint.lng)
  }, [meetupPoint, userGeoPoint])

  const meetupLocationVerified = !!userGeoPoint && !!meetupPoint && userGeoPoint.accuracy <= MAX_GPS_ACCURACY_M && meetupDistanceM !== null && meetupDistanceM <= MEETUP_CONFIRM_RADIUS_M
  const meetupDisplayLabel = (trade as any)?.meetup_label || trade?.meetup_location || buyerMeetupLocation || sellerMeetupLocation || 'Agreed meetup point'
  const resolveMeetupPointFromLabel = async () => {
    if (meetupPoint) return meetupPoint
    if (trade?.meeting_type === 'pickup') {
      setGeoMessage('This pickup location has no map pin yet. Ask the product owner to update the location before confirmation.')
      return null
    }
    const label = meetupDisplayLabel === 'Agreed meetup point' ? '' : meetupDisplayLabel.trim()
    if (!label) {
      setGeoMessage('Meetup location has not been set yet.')
      return null
    }
    try {
      const response = await api.get('/api/places/search', { params: { q: label } })
      const places = response.data?.data || []
      const first = Array.isArray(places) ? places[0] : null
      const lat = Number(first?.latitude)
      const lng = Number(first?.longitude)
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        const point = { lat, lng }
        setMeetupPoint(point)
        return point
      }
    } catch (error) {
      console.warn('Failed to resolve meetup point from label:', error)
    }
    setGeoMessage('Meetup location is missing. You cannot confirm until a mapped meetup point is set.')
    return null
  }

  const checkMeetupLocation = async (): Promise<{ lat: number; lng: number; accuracy: number } | null> => {
    const activeMeetupPoint = meetupPoint || await resolveMeetupPointFromLabel()
    if (!activeMeetupPoint) {
      return null
    }
    if (!navigator.geolocation) {
      setGeoMessage('Location access is required to confirm meetup.')
      return null
    }

    setGeoChecking(true)
    setGeoMessage(null)
    setGeoPermissionDenied(false)
    try {
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 12000,
          maximumAge: 0,
        })
      })
      const point = {
        lat: position.coords.latitude,
        lng: position.coords.longitude,
        accuracy: position.coords.accuracy,
      }
      setUserGeoPoint(point)
      const distance = calculateDistanceMeters(point.lat, point.lng, activeMeetupPoint.lat, activeMeetupPoint.lng)
      const pointLabel = trade?.meeting_type === 'pickup' ? 'pickup point' : 'meetup point'
      if (point.accuracy > MAX_GPS_ACCURACY_M) {
        setGeoMessage('Waiting for a more accurate location...')
      } else if (distance > MEETUP_CONFIRM_RADIUS_M) {
        setGeoMessage(getDistanceStatusMessage(distance, pointLabel))
      } else {
        setGeoMessage("You're at the location. You can now confirm.")
      }
      return point
    } catch (error: any) {
      if (error?.code === 1) {
        setGeoPermissionDenied(true)
      }
      setGeoMessage(trade?.meeting_type === 'pickup' ? 'Location access is required to confirm pickup arrival.' : 'Location access is required to confirm meetup.')
      return null
    } finally {
      setGeoChecking(false)
    }
  }

  const openGoogleMapsDirections = async () => {
    const activeMeetupPoint = meetupPoint || await resolveMeetupPointFromLabel()
    if (!activeMeetupPoint) {
      return
    }
    const point = userGeoPoint || await checkMeetupLocation()
    const url = point
      ? `https://www.google.com/maps/dir/?api=1&origin=${point.lat},${point.lng}&destination=${activeMeetupPoint.lat},${activeMeetupPoint.lng}&travelmode=walking`
      : `https://www.google.com/maps/search/?api=1&query=${activeMeetupPoint.lat},${activeMeetupPoint.lng}`
    window.open(url, '_blank', 'noopener,noreferrer')
  }
  const cardBg = useColorModeValue('white', 'gray.800')
  const borderColor = useColorModeValue('gray.200', 'gray.700')
  const locationTextColor = useColorModeValue('gray.800', 'gray.100')
  const partnerTextColor = useColorModeValue('gray.700', 'gray.200')
  const partnerBg = useColorModeValue('orange.50', 'orange.900')
  const nearestBg = useColorModeValue('blue.50', 'blue.950')
  const partnerIconBg = useColorModeValue('orange.100', 'orange.800')
  const defaultIconBg = useColorModeValue('gray.100', 'gray.700')
  const meetupInfoBg = useColorModeValue('gray.50', 'gray.800')
  const meetupInfoTextColor = useColorModeValue('gray.600', 'gray.300')

  // Be tolerant of ID type mismatches (some auth payloads/localStorage can produce string IDs)
  const currentUserId = user?.id != null ? Number(user.id) : null
  const buyerId = trade?.buyer_id != null ? Number(trade.buyer_id) : null
  const sellerId = trade?.seller_id != null ? Number(trade.seller_id) : null

  const isUserBuyer = !!(trade && currentUserId != null && buyerId != null && buyerId === currentUserId)
  const isUserSeller = !!(trade && currentUserId != null && sellerId != null && sellerId === currentUserId)

  const buyerMeetupKey = buildMeetupKey(buyerMeetupLocation, buyerMeetupDate, buyerMeetupTime)
  const sellerMeetupKey = buildMeetupKey(sellerMeetupLocation, sellerMeetupDate, sellerMeetupTime)
  const meetupSelectionMatches = !!buyerMeetupKey && buyerMeetupKey === sellerMeetupKey
  const meetupAgreed = buyerMeetupConfirmed && sellerMeetupConfirmed && meetupSelectionMatches
  const isMeetupActive = meetupAgreed && trade?.status === 'active'
  const bothMetConfirmed = buyerMetConfirmed && sellerMetConfirmed
  const userMetConfirmed = (isUserBuyer && buyerMetConfirmed) || (isUserSeller && sellerMetConfirmed)
  const currentUserMeetupConfirmed = (isUserBuyer && buyerMeetupConfirmed) || (isUserSeller && sellerMeetupConfirmed)
  const agreedArrivalDeadline = useMemo(() => (
    parseTradeDateTime((trade as any)?.agreed_arrival_deadline)
    || parseTradeDateTime(trade?.meetup_time)
    || parseTradeDateTime(buyerMeetupTime)
    || parseTradeDateTime(sellerMeetupTime)
  ), [
    (trade as any)?.agreed_arrival_deadline,
    trade?.meetup_time,
    buyerMeetupTime,
    sellerMeetupTime,
  ])
  const gracePeriodMinutes = Number((trade as any)?.grace_period_minutes || MEETUP_GRACE_PERIOD_MINUTES)
  const arrivalGraceDeadlineMs = agreedArrivalDeadline
    ? agreedArrivalDeadline.getTime() + gracePeriodMinutes * 60000
    : null
  const userIsPastGrace = arrivalGraceDeadlineMs !== null && arrivalClockNow > arrivalGraceDeadlineMs
  const userWasLate = isUserBuyer ? !!(trade as any)?.buyer_was_late : !!(trade as any)?.seller_was_late
  const userArrivedAt = isUserBuyer ? (trade as any)?.buyer_arrived_at : (trade as any)?.seller_arrived_at

  useEffect(() => {
    if (!isOpen || !meetupAgreed || bothMetConfirmed || userMetConfirmed) return
    void checkMeetupLocation()
  }, [isOpen, meetupAgreed, bothMetConfirmed, userMetConfirmed, meetupPoint?.lat, meetupPoint?.lng])

  const incomingMeetupProposal = useMemo(() => {
    if (meetupAgreed) return null
    // Seller always sees buyer's proposal (from trade creation or separate confirm_meetup action)
    if (isUserSeller) {
      const location = buyerMeetupLocation || trade?.meetup_location || null
      if (location) {
        const date = buyerMeetupLocation ? buyerMeetupDate : splitMeetupDateTime(trade?.meetup_time ?? null).date
        const time = buyerMeetupLocation ? buyerMeetupTime : splitMeetupDateTime(trade?.meetup_time ?? null).time
        return {
          location,
          date,
          time,
          proposer: trade?.buyer_name || 'Trader',
        }
      }
    }
    // Buyer sees seller's counter-proposal (when seller has confirmed a different location)
    if (isUserBuyer && sellerMeetupConfirmed && sellerMeetupLocation) {
      return {
        location: sellerMeetupLocation,
        date: sellerMeetupDate,
        time: sellerMeetupTime,
        proposer: trade?.seller_name || 'Trader',
      }
    }
    return null
  }, [
    meetupAgreed,
    isUserSeller,
    buyerMeetupLocation,
    buyerMeetupDate,
    buyerMeetupTime,
    trade?.meetup_location,
    trade?.meetup_time,
    trade?.buyer_name,
    isUserBuyer,
    sellerMeetupConfirmed,
    sellerMeetupLocation,
    sellerMeetupDate,
    sellerMeetupTime,
    trade?.seller_name,
  ])
  const hasMeetupProposal = !!incomingMeetupProposal
  const showMeetupEditor = !currentUserMeetupConfirmed && (!hasMeetupProposal || showSuggestionsPanel)

  // The current user's own proposal (for showing "You proposed this meetup")
  const myMeetupProposal = useMemo(() => {
    if (meetupAgreed) return null
    if (isUserBuyer && (buyerMeetupConfirmed || trade?.meetup_location) && (buyerMeetupLocation || trade?.meetup_location)) {
      const location = buyerMeetupLocation || trade?.meetup_location!
      const date = buyerMeetupLocation ? buyerMeetupDate : splitMeetupDateTime(trade?.meetup_time ?? null).date
      const time = buyerMeetupLocation ? buyerMeetupTime : splitMeetupDateTime(trade?.meetup_time ?? null).time
      return { location, date, time }
    }
    if (isUserSeller && sellerMeetupConfirmed && sellerMeetupLocation) {
      return { location: sellerMeetupLocation, date: sellerMeetupDate, time: sellerMeetupTime }
    }
    return null
  }, [
    meetupAgreed,
    isUserBuyer,
    buyerMeetupConfirmed,
    buyerMeetupLocation,
    buyerMeetupDate,
    buyerMeetupTime,
    trade?.meetup_location,
    trade?.meetup_time,
    isUserSeller,
    sellerMeetupConfirmed,
    sellerMeetupLocation,
    sellerMeetupDate,
    sellerMeetupTime,
  ])

  // Pickup trade: location is locked to the seller's pickup_address.
  // The target product's pickup address is surfaced at the trade level
  // (target_product_pickup_address). Fall back to a seller trade_item only
  // if older payloads still carry it there.
  const isPickupTrade = trade?.meeting_type === 'pickup'
  const pickupLat = Number((trade as any)?.target_product_pickup_latitude ?? requestedProduct?.pickup_latitude)
  const pickupLng = Number((trade as any)?.target_product_pickup_longitude ?? requestedProduct?.pickup_longitude)
  const pickupPoint = isPickupTrade && Number.isFinite(pickupLat) && Number.isFinite(pickupLng)
    ? { lat: pickupLat, lng: pickupLng }
    : null
  const pickupAddress =
    trade?.target_product_pickup_address ||
    (trade?.items || []).find((it) => it.offered_by === 'seller')?.product_pickup_address ||
    requestedProduct?.pickup_address ||
    ''
  const pickupAddressRevealed = !!trade && !['pending', 'pending_multiway', 'countered'].includes(trade.status)
  const maskToNeighborhood = (addr: string): string => {
    if (!addr) return ''
    const parts = addr.split(',').map((s) => s.trim()).filter(Boolean)
    if (parts.length <= 1) return "Pickup neighborhood"
    return parts.slice(1).join(', ')
  }
  const pickupDisplayAddress = pickupAddressRevealed ? pickupAddress : maskToNeighborhood(pickupAddress)
  const pickupMapMissing = isPickupTrade && !pickupPoint

  useEffect(() => {
    if (!isPickupTrade) return
    if (pickupPoint) {
      setMeetupPoint(pickupPoint)
      setGeoMessage(null)
    } else {
      setMeetupPoint(null)
      setGeoMessage('This pickup location has no map pin yet. Ask the product owner to update the location before confirmation.')
    }
  }, [isPickupTrade, pickupPoint?.lat, pickupPoint?.lng])

  const pickupTrackingActive = isOpen && isPickupTrade && isUserBuyer && meetupAgreed && !bothMetConfirmed && !buyerMetConfirmed && !!pickupPoint && trade?.status !== 'cancelled'

  useEffect(() => {
    if (!isOpen || !isPickupTrade || !meetupAgreed || !pickupPoint || userGeoPoint) return
    void checkMeetupLocation()
  }, [isOpen, isPickupTrade, meetupAgreed, pickupPoint?.lat, pickupPoint?.lng, userGeoPoint?.lat, userGeoPoint?.lng])

  useEffect(() => {
    if (!pickupTrackingActive) {
      if (pickupWatchIdRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(pickupWatchIdRef.current)
        pickupWatchIdRef.current = null
      }
      return
    }

    if (!navigator.geolocation) {
      setGeoMessage('Location services are not available on this device.')
      return
    }

    setGeoChecking(true)
    setGeoPermissionDenied(false)
    pickupWatchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        const point = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
        }
        setUserGeoPoint(point)
        setGeoChecking(false)
        const distance = pickupPoint
          ? calculateDistanceMeters(point.lat, point.lng, pickupPoint.lat, pickupPoint.lng)
          : null
        if (point.accuracy > MAX_GPS_ACCURACY_M) {
          setGeoMessage('Waiting for a more accurate location...')
        } else if (distance !== null && distance <= MEETUP_CONFIRM_RADIUS_M) {
          setGeoMessage("You're at the location. You can now confirm.")
        } else if (distance !== null) {
          setGeoMessage(getDistanceStatusMessage(distance, 'pickup point'))
        }
      },
      (error) => {
        setGeoChecking(false)
        if (error.code === 1) setGeoPermissionDenied(true)
        setGeoMessage('Location access is required to confirm pickup arrival.')
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    )

    return () => {
      if (pickupWatchIdRef.current !== null) {
        navigator.geolocation.clearWatch(pickupWatchIdRef.current)
        pickupWatchIdRef.current = null
      }
    }
  }, [pickupTrackingActive, pickupPoint?.lat, pickupPoint?.lng])

  useEffect(() => {
    if (!isPickupTrade || !pickupPoint || !userGeoPoint) {
      setPickupRouteCoords([])
      setPickupRouteMetrics(null)
      setPickupRouteLoading(false)
      return
    }

    let cancelled = false
    const fallbackRoute: Array<[number, number]> = [[userGeoPoint.lat, userGeoPoint.lng], [pickupPoint.lat, pickupPoint.lng]]
    const fetchRoute = async () => {
      setPickupRouteLoading(true)
      try {
        const url = `https://router.project-osrm.org/route/v1/driving/${userGeoPoint.lng},${userGeoPoint.lat};${pickupPoint.lng},${pickupPoint.lat}?overview=full&geometries=geojson`
        const res = await fetch(url)
        const data = await res.json()
        const routeData = data?.routes?.[0]
        const coords = data?.routes?.[0]?.geometry?.coordinates || []
        const route = coords.map((c: number[]) => [c[1], c[0]] as [number, number])
        if (!cancelled) {
          setPickupRouteCoords(route.length > 1 ? route : fallbackRoute)
          const distanceM = Number(routeData?.distance)
          const durationS = Number(routeData?.duration)
          setPickupRouteMetrics(Number.isFinite(distanceM) && Number.isFinite(durationS) ? { distanceM, durationS } : null)
        }
      } catch {
        if (!cancelled) {
          setPickupRouteCoords(fallbackRoute)
          setPickupRouteMetrics(null)
        }
      } finally {
        if (!cancelled) setPickupRouteLoading(false)
      }
    }

    fetchRoute()
    return () => {
      cancelled = true
    }
  }, [isPickupTrade, pickupPoint?.lat, pickupPoint?.lng, userGeoPoint?.lat, userGeoPoint?.lng])

  // Auto-select the pickup address for pickup trades so the existing
  // date/time confirm flow still works without the meetup location picker.
  // If the seller hasn't set a pickup_address and has no home_address,
  // use a descriptive placeholder so the Confirm button can still enable —
  // the parties will coordinate the exact spot via chat.
  const effectivePickupLocation = pickupAddress || "Pickup location (coordinate via chat)"
  useEffect(() => {
    if (isPickupTrade && selectedLocation !== effectivePickupLocation) {
      setSelectedLocation(effectivePickupLocation)
    }
  }, [isPickupTrade, effectivePickupLocation, selectedLocation])

  // Auto-sync online payment status in dev/localhost where webhooks may not arrive.
  useEffect(() => {
    if (!isOpen) return
    if (!trade?.id) return
    if (!isUserBuyer) return
    if (deliveryState.paymentMethod !== 'online') return
    if (deliveryState.paymentConfirmed) return

    let cancelled = false

      ; (async () => {
        try {
          setSyncingOnlinePayment(true)

          const key = `xendit_external_id_trade_${trade.id}`
          const externalId = sessionStorage.getItem(key) || undefined

          for (let i = 0; i < 8 && !cancelled; i++) {
            let r
            try {
              r = await api.post(`/api/payments/trade/${trade.id}/sync`, externalId ? { external_id: externalId } : {})
            } catch (err: any) {
              if (err?.response?.status === 405) {
                r = await api.get(`/api/payments/trade/${trade.id}/sync`, {
                  params: externalId ? { external_id: externalId } : {},
                })
              } else {
                throw err
              }
            }
            if (r.data?.data?.paid) {
              const tradeRes = await api.get(`/api/trades/${trade.id}`)
              const updatedTrade: Trade | undefined = tradeRes.data?.data

              if (updatedTrade) {
                onTradeUpdate?.(updatedTrade)
                setDeliveryState(prev => ({
                  ...prev,
                  paymentConfirmed: !!updatedTrade.payment_confirmed,
                  paymentMethod: (updatedTrade.payment_method as any) || prev.paymentMethod,
                }))
              } else {
                setDeliveryState(prev => ({
                  ...prev,
                  paymentConfirmed: true,
                }))
              }

              onStatusUpdate()
              sessionStorage.removeItem(key)
              return
            }

            await new Promise(res => setTimeout(res, 1500))
          }
        } catch (_) {
          // Silent: user remains locked until webhook/sync succeeds.
        } finally {
          if (!cancelled) setSyncingOnlinePayment(false)
        }
      })()

    return () => {
      cancelled = true
    }
  }, [
    isOpen,
    trade?.id,
    isUserBuyer,
    deliveryState.paymentMethod,
    deliveryState.paymentConfirmed,
    onStatusUpdate,
    onTradeUpdate,
  ])

  // Calculate distance between buyer and seller if both have locations
  const distance = useMemo(() => {
    if (!trade?.buyer_location || !trade?.seller_location) return 10 // Default distance

    const buyerCoords = trade.buyer_location.split(',').map(Number)
    const sellerCoords = trade.seller_location.split(',').map(Number)

    if (buyerCoords.length === 2 && sellerCoords.length === 2) {
      return calculateDistance(buyerCoords[0], buyerCoords[1], sellerCoords[0], sellerCoords[1])
    }
    return 10 // Default fallback
  }, [trade?.buyer_location, trade?.seller_location])

  // Dynamic delivery options based on calculated distance
  const deliveryOptions = useMemo(() => ({
    standard: {
      time: distance < 10 ? '2-3 business days' : distance < 25 ? '3-4 business days' : '4-6 business days',
      fee: calculateDeliveryFee(distance, 'standard'),
      icon: '🚚',
      description: `${distance < 5 ? 'Local area' : distance < 15 ? 'Within city' : 'Inter-city'} delivery`
    },
    express: {
      time: distance < 10 ? 'Same day' : distance < 25 ? '1-2 business days' : '2-3 business days',
      fee: calculateDeliveryFee(distance, 'express'),
      icon: '⚡',
      description: `Fast ${distance < 5 ? 'local' : distance < 15 ? 'city-wide' : 'regional'} delivery`
    }
  }), [distance])

  const tradingPartner = isUserBuyer
    ? trade?.seller_name || `User #${trade?.seller_id}`
    : trade?.buyer_name || `User #${trade?.buyer_id}`

  const buyerApproxPoint = approximatePoint(parseLatLngString(trade?.buyer_location), 0.0004)
  const sellerApproxPoint = approximatePoint(parseLatLngString(trade?.seller_location), -0.0004)
  const currentExactPoint = userGeoPoint ? { lat: userGeoPoint.lat, lng: userGeoPoint.lng } : null
  const currentApproxPoint = approximatePoint(currentExactPoint)
  const trackingCurrentPoint = isPickupTrade ? currentExactPoint : currentApproxPoint
  const meetupTrackingPoint = isPickupTrade ? pickupPoint : meetupPoint
  const trackingCenter = meetupTrackingPoint || currentApproxPoint || buyerApproxPoint || sellerApproxPoint || { lat: 6.9214, lng: 122.0790 }
  const trackingRoute = (pickupRouteCoords.length > 1 && isPickupTrade)
    ? pickupRouteCoords
    : trackingCurrentPoint && meetupTrackingPoint
      ? [[trackingCurrentPoint.lat, trackingCurrentPoint.lng], [meetupTrackingPoint.lat, meetupTrackingPoint.lng]] as Array<[number, number]>
      : []
  const trackingMapPoints = [
    ...(meetupTrackingPoint ? [[meetupTrackingPoint.lat, meetupTrackingPoint.lng] as [number, number]] : []),
    ...(trackingCurrentPoint ? [[trackingCurrentPoint.lat, trackingCurrentPoint.lng] as [number, number]] : []),
    ...(buyerApproxPoint ? [[buyerApproxPoint.lat, buyerApproxPoint.lng] as [number, number]] : []),
    ...(sellerApproxPoint ? [[sellerApproxPoint.lat, sellerApproxPoint.lng] as [number, number]] : []),
  ]
  const trackingDistanceM = isPickupTrade ? (pickupRouteMetrics?.distanceM ?? meetupDistanceM) : meetupDistanceM
  const trackingEtaLabel = pickupRouteLoading ? 'Calculating ETA...' : estimateTravelWindow(trackingDistanceM, isPickupTrade ? pickupRouteMetrics?.durationS : null)
  const trackingDistanceLabel = pickupRouteLoading ? 'Calculating distance...' : formatTrackingDistance(trackingDistanceM)
  const trackingSheetHeight = trackingSheetSnap === 'full'
    ? '76%'
    : trackingSheetSnap === 'half'
      ? '46%'
      : '124px'

  const resolveAvatarSrc = (raw?: string | null): string | undefined => {
    if (!raw) return undefined
    // Normalize relative paths to backend URL; keep full URLs as-is.
    return getImageUrl(raw)
  }

  // Fetch buyer/seller public profile to get profile pictures for avatars.
  useEffect(() => {
    if (!isOpen) return
    if (!trade?.buyer_id || !trade?.seller_id) return

    let cancelled = false

    const fetchAvatarForUser = async (id: number) => {
      if (!id) return
      if (fetchedAvatarUserIdsRef.current.has(id)) return
      fetchedAvatarUserIdsRef.current.add(id)

      try {
        const res = await api.get(`/api/users/${id}`)
        const payload = res.data?.data || res.data
        const apiUser = (payload?.user || payload) as any
        const rawPic = apiUser?.profile_picture || apiUser?.avatar_url || apiUser?.org_logo_url || apiUser?.logo_url
        if (!rawPic) return

        if (!cancelled) {
          setUserAvatarById(prev => ({ ...prev, [id]: rawPic }))
        }
      } catch (_) {
        // Best-effort: keep initials fallback.
      }
    }

    fetchAvatarForUser(Number(trade.buyer_id))
    fetchAvatarForUser(Number(trade.seller_id))

    return () => {
      cancelled = true
    }
  }, [isOpen, trade?.buyer_id, trade?.seller_id])

  // Debounced place search (Google Places / Nominatim via backend)
  useEffect(() => {
    const q = placeQuery.trim()
    if (q.length < 2) {
      setPlaceResults([])
      setPlaceSearching(false)
      return
    }
    setPlaceSearching(true)
    let cancelled = false
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q })
        if (user?.latitude && user?.longitude) {
          params.set('lat', String(user.latitude))
          params.set('lng', String(user.longitude))
        }
        const res = await api.get(`/api/places/search?${params.toString()}`)
        if (!cancelled) {
          setPlaceResults(res.data?.results || [])
        }
      } catch {
        if (!cancelled) setPlaceResults([])
      } finally {
        if (!cancelled) setPlaceSearching(false)
      }
    }, 350)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [placeQuery, user?.latitude, user?.longitude])

  const defaultLocations: MeetupLocation[] = [
    { name: 'Meet n Eat', address: 'Gov. Camins Ave, Zamboanga City', type: 'cafe', lat: 6.9150, lng: 122.0630, isPartner: true },
    { name: 'WMSU', address: 'Normal Road, Zamboanga City', type: 'public', lat: 6.9142, lng: 122.0620 },
    { name: 'SM Mindpro', address: 'La Purisima St, Zamboanga City', type: 'mall', lat: 6.9080, lng: 122.0745 },
    { name: 'KCC de Zamboanga', address: 'Gov. Camins Ave, Zamboanga City', type: 'mall', lat: 6.9214, lng: 122.0790 },
    { name: 'Amethyst Eatery', address: 'Johnston Road, Zamboanga City', type: 'cafe', lat: 6.9125, lng: 122.0720, isPartner: true },
    { name: 'Paseo del Mar', address: 'Valderosa St, Zamboanga City', type: 'public', lat: 6.9030, lng: 122.0780 },
  ]
  const suggestedLocations: MeetupLocation[] = useMemo(
    () => [...searchedLocations, ...defaultLocations],
    [searchedLocations],
  )

  // Helper compute distance in km using Haversine
  const getDistance = (lat1?: number, lon1?: number, lat2?: number, lon2?: number) => {
    if (!lat1 || !lon1 || !lat2 || !lon2) return Infinity;
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  // Find nearest location based on user coordinates
  const nearestLocationName = useMemo(() => {
    if (!user?.latitude || !user?.longitude) return 'WMSU'; // Fallback
    let nearest = '';
    let minDistance = Infinity;
    for (const loc of suggestedLocations) {
      const dist = getDistance(user.latitude, user.longitude, loc.lat, loc.lng);
      if (dist < minDistance) {
        minDistance = dist;
        nearest = loc.name;
      }
    }
    return nearest;
  }, [user?.latitude, user?.longitude])

  // Save delivery state to backend
  const saveDeliveryState = async (updates: Partial<DeliveryState>) => {
    if (!trade) return

    try {
      const payload: any = { action: 'update_delivery_state' }

      if (updates.deliveryType) payload.delivery_type = updates.deliveryType
      if (updates.paymentMethod) payload.payment_method = updates.paymentMethod
      if (updates.paymentConfirmed !== undefined) payload.payment_confirmed = updates.paymentConfirmed
      if (updates.buyerConfirmedReceipt !== undefined) payload.buyer_confirmed_receipt = updates.buyerConfirmedReceipt
      if (updates.sellerConfirmedDelivery !== undefined) payload.seller_confirmed_delivery = updates.sellerConfirmedDelivery
      if (updates.deliveryInstructions !== undefined) payload.delivery_instructions = updates.deliveryInstructions

      const response = await api.put(`/api/trades/${trade.id}`, payload)

      // Update local trade state with the new delivery data
      if (trade && onTradeUpdate) {
        const updatedFields = Object.keys(updates).reduce((acc, key) => {
          const value = updates[key as keyof DeliveryState]
          if (value !== undefined) {
            // Map frontend field names to backend field names
            switch (key) {
              case 'deliveryType':
                acc.delivery_type = value as 'standard' | 'express' | 'meetup'
                break
              case 'paymentMethod':
                acc.payment_method = value as 'online' | 'cod' | 'wallet'
                break
              case 'paymentConfirmed':
                acc.payment_confirmed = value as boolean
                break
              case 'buyerConfirmedReceipt':
                acc.buyer_confirmed_receipt = value as boolean
                break
              case 'sellerConfirmedDelivery':
                acc.seller_confirmed_delivery = value as boolean
                break
              case 'deliveryInstructions':
                acc.delivery_instructions = value as string
                break
            }
          }
          return acc
        }, {} as any)

        const updatedTrade: Trade = {
          ...trade,
          ...updatedFields,
          updated_at: new Date().toISOString() // Force re-render
        }

        onTradeUpdate(updatedTrade)
      }

      // Call onStatusUpdate to refresh any parent state
      onStatusUpdate()
    } catch (error: any) {
      console.error('Failed to save delivery state:', error)
      if (error?.response?.data) {
      }
      toast({
        id: "viewtrademodal-error-2",
        title: 'Error',
        description: error?.response?.data?.error || 'Failed to save delivery state',
        status: 'error',
        duration: 4000,
        isClosable: true,
      })
    }
  }

  const [confirmingDeliveryType, setConfirmingDeliveryType] = useState(false)

  const confirmDeliveryType = async () => {
    if (!trade || confirmingDeliveryType || !deliveryState.deliveryType) return

    try {
      setConfirmingDeliveryType(true)
      await api.put(`/api/trades/${trade.id}`, {
        action: 'confirm_delivery_type',
        delivery_type: deliveryState.deliveryType,
      })

      // Update local state
      if (isUserBuyer) {
        setDeliveryState(prev => ({
          ...prev,
          buyerConfirmedDeliveryType: true,
          buyerDeliveryType: deliveryState.deliveryType,
        }))
      } else if (isUserSeller) {
        setDeliveryState(prev => ({
          ...prev,
          sellerConfirmedDeliveryType: true,
          sellerDeliveryType: deliveryState.deliveryType,
        }))
      }

      toast({
        id: 'viewtrademodal-delivery-type-confirmed',
        title: 'Delivery option confirmed',
        description: 'Waiting for the other party to confirm their delivery option...',
        status: 'success',
        duration: 3000,
      })

      onStatusUpdate()
    } catch (error: any) {
      toast({
        id: 'viewtrademodal-delivery-type-error',
        title: 'Error',
        description: error?.response?.data?.error || 'Failed to confirm delivery type',
        status: 'error',
        duration: 3000,
      })
    } finally {
      setConfirmingDeliveryType(false)
    }
  }

  // Polling to keep delivery and trade status in sync while modal is open
  useEffect(() => {
    if (!isOpen || !trade?.id) return

    const pollInterval = setInterval(() => {
      onStatusUpdate()
    }, 6000) // Poll every 6 seconds

    return () => clearInterval(pollInterval)
  }, [isOpen, trade?.id, onStatusUpdate])

  // Load delivery state from trade data when trade changes
  useEffect(() => {
    if (trade && trade.trade_option === 'delivery') {
      setDeliveryState(prev => ({
        ...prev,
        deliveryType: (trade.delivery_type as any) || 'standard',
        paymentMethod: (trade.payment_method as any) || 'online',
        paymentConfirmed: trade.payment_confirmed || false,
        buyerConfirmedReceipt: trade.buyer_confirmed_receipt || false,
        sellerConfirmedDelivery: trade.seller_confirmed_delivery || false,
        buyerConfirmedDeliveryType: (trade as any)?.buyer_confirmed_delivery_type || false,
        sellerConfirmedDeliveryType: (trade as any)?.seller_confirmed_delivery_type || false,
        buyerDeliveryType: (trade as any)?.buyer_delivery_type as any || null,
        sellerDeliveryType: (trade as any)?.seller_delivery_type as any || null,
        deliveryInstructions: (trade as any).delivery_instructions || '',
      }))
    }
  }, [trade?.id, trade?.trade_option, trade?.updated_at])

  // Fetch trade messages
  useEffect(() => {
    // Always stop polling when the modal is closed
    if (!isOpen) {
      if (messagesPollRef.current) {
        clearInterval(messagesPollRef.current)
        messagesPollRef.current = null
      }

      previousMessageCountRef.current = 0
      setMessages([])
      setNewMessage('')
      shownMessageNotificationsRef.current.clear()
      return
    }

    // Keep current UI as-is until we have a stable trade id
    if (!trade?.id) return

    // Reset message count tracker when opening a new trade id
    previousMessageCountRef.current = 0
    shownMessageNotificationsRef.current.clear()

    fetchMessages({ showLoading: true })
    fetchProducts()
    fetchMeetupStatus()

    // Ensure we never stack multiple polling intervals
    if (messagesPollRef.current) {
      clearInterval(messagesPollRef.current)
      messagesPollRef.current = null
    }

    // Poll for new messages every 3 seconds without flashing a loader
    messagesPollRef.current = setInterval(() => fetchMessages({ showLoading: false }), 3000)
    return () => {
      if (messagesPollRef.current) {
        clearInterval(messagesPollRef.current)
        messagesPollRef.current = null
      }
    }
  }, [isOpen, trade?.id])

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  // Fetch linked delivery for delivery trades and poll for updates
  useEffect(() => {
    if (!trade || trade.trade_option !== 'delivery' || !isOpen) {
      setLinkedDelivery(null)
      setLinkedDeliveries([])
      return
    }
    // Only fetch when trade is active or later
    if (!['active', 'accepted', 'awaiting_confirmation', 'completed', 'auto_completed'].includes(trade.status)) {
      return
    }

    const fetchLinkedDelivery = async () => {
      try {
        let deliveries: Delivery[] = []
        try {
          const response = await api.get(`/api/trades/${trade.id}/deliveries`)
          const data = response.data?.data
          deliveries = Array.isArray(data) ? data : []
        } catch (e) {
          // Fallback handled below
        }

        // Fallback: older endpoint (also triggers backend auto-create for missing deliveries)
        if (!deliveries || deliveries.length === 0) {
          try {
            const r = await api.get(`/api/trades/${trade.id}/delivery`)
            const single: Delivery | null = r.data?.data && (r.data.data as any).id ? (r.data.data as Delivery) : null
            if (single) {
              setLinkedDelivery(single)
              setLinkedDeliveries([single])
              return
            }
          } catch (_) {
            // Ignore; we'll clear state below.
          }

          setLinkedDelivery(null)
          setLinkedDeliveries([])
          return
        }

        setLinkedDeliveries(deliveries)
        const active = deliveries.find(d => d.status !== 'delivered') || deliveries[deliveries.length - 1] || null
        setLinkedDelivery(active && (active as any).id ? active : null)
      } catch (e) {
        setLinkedDelivery(null)
        setLinkedDeliveries([])
      }
    }

    fetchLinkedDelivery()
    // Poll every 10 seconds while delivery is in progress
    const interval = setInterval(fetchLinkedDelivery, 10000)
    return () => clearInterval(interval)
  }, [trade?.id, trade?.status, trade?.trade_option, isOpen])

  const fetchMessages = async (options?: { showLoading?: boolean }) => {
    // Avoid spinner flicker on refresh when we already have messages.
    const showLoading = !!options?.showLoading && messages.length === 0
    if (!trade) return

    const requestSeq = ++messagesRequestSeqRef.current

    try {
      if (showLoading) setLoadingMessages(true)

      const response = await Promise.race([
        api.get(`/api/trades/${trade.id}/messages`),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Request timeout')), 10000)
        )
      ]) as any

      const data = response.data?.data || []
      const safeMessages = Array.isArray(data) ? data : []
      safeMessages.sort((a: any, b: any) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())

      // Ignore stale/out-of-order responses (common on mobile networks)
      if (requestSeq !== messagesRequestSeqRef.current) return

      // Check if there are new messages from the other user
      const previousCount = previousMessageCountRef.current
      const newMessageCount = safeMessages.length

      // Only show notification if this is NOT the initial load and there are actually new messages
      if (previousCount > 0 && newMessageCount > previousCount) {
        // Get the new messages (only the ones we haven't seen yet)
        const newMessages = safeMessages.slice(previousCount)
        // Check if any new message is from the other user (not the current user)
        const otherUserMessages = newMessages.filter((msg: any) => Number(msg.sender_id) !== currentUserId)

        if (otherUserMessages.length > 0) {
          const latestMessage = otherUserMessages[otherUserMessages.length - 1]
          const senderName = latestMessage.sender_name || 'User'
          const messageId = String(latestMessage.id || `msg-${Date.now()}`)

          // Only show notification if we haven't already shown one for this message
          if (!shownMessageNotificationsRef.current.has(messageId)) {
            shownMessageNotificationsRef.current.add(messageId)

            // Show notification for new message from other user at the top
            const toastId = `new-message-${messageId}`
            toast({
              id: toastId,
              title: `New message from ${senderName}`,
              description: latestMessage.content.substring(0, 60) + (latestMessage.content.length > 60 ? '...' : ''),
              status: 'info',
              duration: 3000,
              isClosable: true,
              position: 'top' as const,
            })
          }
        }
      }

      // Never allow the tracker to move backwards (prevents duplicate toasts)
      previousMessageCountRef.current = Math.max(previousCount, newMessageCount)
      setMessages(safeMessages)
    } catch (error: any) {
      console.error('Failed to fetch messages:', error)
    } finally {
      // Only the most recent request is allowed to clear the loading state.
      if (showLoading && requestSeq === messagesRequestSeqRef.current) setLoadingMessages(false)
    }
  }

  const fetchProducts = async () => {
    if (!trade) return

    try {
      setLoadingProducts(true)
      const sellerSideItems = (trade.items || []).filter((item: any) => {
        const ob = (item?.offered_by ?? item?.offeredBy ?? '').toLowerCase()
        return ob === 'seller' || ob === 'from_seller'
      })
      const requestedIds = Array.from(new Set([
        Number(trade.target_product_id || 0),
        ...sellerSideItems.map((item: any) => Number(item.product_id)).filter((pid: number) => Number.isFinite(pid) && pid > 0),
      ].filter((pid) => pid > 0)))
      const requestedResults = await Promise.all(requestedIds.map((pid: number) => getProduct(pid)))
      const requestedResolved = requestedResults.filter(Boolean) as Product[]
      setRequestedProduct(requestedResolved[0] || null)
      setAdditionalRequestedProducts(requestedResolved.slice(1))

      // Only show items offered by the buyer (offered_by === 'buyer') in the "offered" column.
      // Some trades may store seller counter-offer items with offered_by === 'seller' — keep them separate.
      const buyerItems = (trade.items || []).filter((item: any) => {
        const ob = (item?.offered_by ?? item?.offeredBy ?? '').toLowerCase()
        return !ob || ob === 'buyer' || ob === 'from_buyer' || ob === 'sender'
      })
      const offeredIds = buyerItems.map((item: any) => item.product_id).filter(Boolean)
      const offeredResults = await Promise.all(offeredIds.map((pid: number) => getProduct(pid)))
      setOfferedProducts(offeredResults.filter(Boolean) as Product[])

    } catch (error) {
      console.error('Failed to fetch products:', error)
    } finally {
      setLoadingProducts(false)
    }
  }

  const fetchMeetupStatus = async () => {
    if (!trade) return

    try {
      const response = await api.get(`/api/trades/${trade.id}`)
      const tradeData = response.data?.data

      // Keep the modal header/status badge consistent with the latest backend state.
      // This prevents UI mismatches like "WAITING FOR MEETUP" while showing "You Both Agreed!".
      if (tradeData && onTradeUpdate) {
        onTradeUpdate(tradeData)
      }

      // Set confirmation status based on backend data
      setBuyerMeetupConfirmed(!!(tradeData?.buyer_meetup_confirmed || tradeData?.meetup_confirmed_by_buyer))
      setSellerMeetupConfirmed(!!(tradeData?.seller_meetup_confirmed || tradeData?.meetup_confirmed_by_seller))

      // Set each party's meetup selections
      setBuyerMeetupLocation(tradeData?.buyer_meetup_location || null)
      const buyerSelection = splitMeetupDateTime(tradeData?.buyer_meetup_time)
      setBuyerMeetupDate(buyerSelection.date)
      setBuyerMeetupTime(buyerSelection.time)
      setSellerMeetupLocation(tradeData?.seller_meetup_location || null)
      const sellerSelection = splitMeetupDateTime(tradeData?.seller_meetup_time)
      setSellerMeetupDate(sellerSelection.date)
      setSellerMeetupTime(sellerSelection.time)

      // Set met confirmation status
      setBuyerMetConfirmed(!!tradeData?.buyer_met)
      setSellerMetConfirmed(!!tradeData?.seller_met)
      const latestMeetupLat = Number(tradeData?.meetup_lat)
      const latestMeetupLng = Number(tradeData?.meetup_lng)
      if (Number.isFinite(latestMeetupLat) && Number.isFinite(latestMeetupLng)) {
        setMeetupPoint({ lat: latestMeetupLat, lng: latestMeetupLng })
      }

      // Also set selected location/time if it exists (for display)
      if (tradeData?.meetup_location) {
        setSelectedLocation(tradeData.meetup_location)
      }
      if (tradeData?.meetup_time) {
        const selectedSelection = splitMeetupDateTime(tradeData.meetup_time)
        if (selectedSelection.date) setSelectedDate(selectedSelection.date)
        if (selectedSelection.time) setSelectedTime(selectedSelection.time)
      }
    } catch (error) {
      console.error('Failed to fetch meetup status:', error)
    }
  }

  const sendMessage = async () => {
    if (!trade || sendingMessage) return
    const trimmed = newMessage.trim()
    const hasText = trimmed.length > 0
    const hasPhoto = !!chatPhotoFile
    if (!hasText && !hasPhoto) return

    if (hasText && isBlockedMessage(trimmed)) {
      toast({
        id: "viewtrademodal-link-block",
        title: 'Links are not allowed',
        description: 'Please remove links. You can send photos instead.',
        status: 'warning',
      })
      return
    }

    try {
      setSendingMessage(true)
      if (hasText) {
        await api.post(`/api/trades/${trade.id}/messages`, {
          content: trimmed,
        })
        setNewMessage('')
      }

      if (hasPhoto) {
        const uploadedUrl = await uploadChatPhoto()
        if (uploadedUrl) {
          await api.post(`/api/trades/${trade.id}/messages`, {
            content: `photo:${uploadedUrl}`,
          })
          clearChatPhoto()
        }
      }

      await fetchMessages({ showLoading: false })
    } catch (error: any) {
      toast({
        id: "viewtrademodal-error-3",
        title: 'Error',
        description: error?.response?.data?.error || 'Failed to send message',
        status: 'error',
      })
    } finally {
      setSendingMessage(false)
    }
  }

  const handleChatPhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!file.type.startsWith('image/')) {
      toast({ id: 'viewtrade-photo-type', title: 'Photo only', description: 'Please select an image file.', status: 'warning' })
      e.target.value = ''
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      toast({ id: 'viewtrade-photo-size', title: 'File too large', description: 'Photo must be under 10MB.', status: 'warning' })
      e.target.value = ''
      return
    }
    if (chatPhotoPreview) {
      URL.revokeObjectURL(chatPhotoPreview)
    }
    setChatPhotoFile(file)
    setChatPhotoPreview(URL.createObjectURL(file))
    e.target.value = ''
  }

  const clearChatPhoto = () => {
    if (chatPhotoPreview) {
      URL.revokeObjectURL(chatPhotoPreview)
    }
    setChatPhotoPreview(null)
    setChatPhotoFile(null)
  }

  const uploadChatPhoto = async (): Promise<string | null> => {
    if (!chatPhotoFile) return null
    setUploadingChatPhoto(true)
    try {
      const formData = new FormData()
      formData.append('image', chatPhotoFile)
      const uploadRes = await api.post('/api/upload', formData)
      const uploadedUrl = uploadRes.data?.data?.url
      if (!uploadedUrl) throw new Error('No image URL returned')
      return uploadedUrl
    } catch (error: any) {
      toast({
        id: 'viewtrade-photo-upload',
        title: 'Photo upload failed',
        description: error?.response?.data?.error || 'Please try again.',
        status: 'error',
      })
      return null
    } finally {
      setUploadingChatPhoto(false)
    }
  }

  // ============ NEW: Helper functions for date/time validation & generation ============

  /**
   * Generate array of next 7 days starting from today (YYYY-MM-DD format)
   */
  const getNext7Days = (): string[] => {
    const days: string[] = []
    for (let i = 0; i < 7; i++) {
      const date = new Date()
      date.setDate(date.getDate() + i)
      const year = date.getFullYear()
      const month = String(date.getMonth() + 1).padStart(2, '0')
      const day = String(date.getDate()).padStart(2, '0')
      days.push(`${year}-${month}-${day}`)
    }
    return days
  }

  /**
   * Get formatted day label (Today, Tomorrow, Mon 15, Tue 16, etc.)
   */
  const formatDateLabel = (dateStr: string): string => {
    const date = new Date(dateStr + 'T00:00:00')
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const tomorrow = new Date(today)
    tomorrow.setDate(tomorrow.getDate() + 1)

    if (date.getTime() === today.getTime()) return 'Today'
    if (date.getTime() === tomorrow.getTime()) return 'Tomorrow'

    const options = { weekday: 'short', month: 'short', day: 'numeric' } as const
    return date.toLocaleDateString('en-US', options)
  }

  /**
   * Generate available time slots (30-min intervals)
   * For today, filter out past times
   * Slots: 09:00, 09:30, 10:00, ... 18:00
   */
  const generateTimeSlots = (dateStr: string | null): string[] => {
    if (!dateStr) return []

    const now = new Date()
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    const selectedDateObj = new Date(dateStr + 'T00:00:00')
    const isToday = selectedDateObj.getTime() === today.getTime()

    const slots: string[] = []
    const startHour = 9 // 09:00
    const endHour = 18 // 18:00

    for (let hour = startHour; hour <= endHour; hour++) {
      for (const minute of [0, 30]) {
        const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`

        // For today, skip past times
        if (isToday) {
          const [hourPart, minPart] = timeStr.split(':').map(Number)
          const slotDate = new Date()
          slotDate.setHours(hourPart, minPart, 0, 0)
          if (slotDate <= now) continue // Skip past times
        }

        slots.push(timeStr)
      }
    }

    return slots
  }

  /**
   * Validate selected date and time
   * Returns error message or null if valid
   */
  const validateDateTimeSelection = (date: string | null, time: string | null): string | null => {
    if (!date) return 'Please select a date'
    if (!time) return 'Please select a time'

    // Check if date is within next 7 days
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const selectedDate = new Date(date + 'T00:00:00')
    const maxDate = new Date(today)
    maxDate.setDate(maxDate.getDate() + 6) // 7 days starting from today (0-6)

    if (selectedDate < today) return 'Cannot select a past date'
    if (selectedDate > maxDate) return 'Meetup must be scheduled within 7 days'

    // Check if time is not in the past for today
    if (selectedDate.getTime() === today.getTime()) {
      const [hour, minute] = time.split(':').map(Number)
      const now = new Date()
      const selectedDateTime = new Date()
      selectedDateTime.setHours(hour, minute, 0, 0)

      if (selectedDateTime <= now) {
        return 'Cannot select a past time'
      }
    }

    return null
  }

  /**
   * Generate smart suggestions for alternative times (memoized for performance)
   */
  const generateSmartSuggestions = useMemo(() => {
    return (): Array<{ date: string; time: string; label: string }> => {
      const suggestions: Array<{ date: string; time: string; label: string }> = []
      const next7days = getNext7Days()

      // PRIORITIZE TODAY FIRST - Morning/Afternoon slots
      if (next7days[0]) {
        suggestions.push({
          date: next7days[0],
          time: '11:00',
          label: '=��� Today, 11:00 AM'
        })
        suggestions.push({
          date: next7days[0],
          time: '15:00',
          label: '=��� Today, 3:00 PM'
        })
      }

      // Suggest tomorrow morning
      if (next7days[1]) {
        suggestions.push({
          date: next7days[1],
          time: '09:00',
          label: '=��� Tomorrow, 9:00 AM'
        })
      }

      // Suggest afternoon slots
      if (next7days[2]) {
        suggestions.push({
          date: next7days[2],
          time: '14:00',
          label: '=��� Day after tomorrow, 2:00 PM'
        })
      }

      // Suggest evening slots
      if (next7days[3]) {
        suggestions.push({
          date: next7days[3],
          time: '17:00',
          label: '=��� In 3 days, 5:00 PM'
        })
      }

      // Suggest weekend if available
      if (next7days[6]) {
        suggestions.push({
          date: next7days[6],
          time: '10:00',
          label: '=��� Weekend, 10:00 AM'
        })
      }

      return suggestions
    }
  }, [])

  /**
   * Handle agreement to other party's schedule
   */
  const handleAgreeToSchedule = async () => {
    if (!trade) return

    // Use incomingMeetupProposal data (which includes the trade.meetup_location fallback)
    const agreeLocation = incomingMeetupProposal?.location ?? null
    const agreeDate = incomingMeetupProposal?.date ?? null
    const agreeTime = incomingMeetupProposal?.time ?? null

    if (!agreeLocation) {
      toast({
        title: 'Missing Location',
        description: 'No meetup location found to accept.',
        status: 'warning',
        duration: 3000,
      })
      return
    }

    if (!agreeTime) {
      toast({
        title: 'No Time Set',
        description: 'This proposal has no time. Use "Suggest Changes" to add a date and time.',
        status: 'info',
        duration: 4000,
      })
      return
    }

    try {
      setAgreeingToSchedule(true)

      // Call API directly to confirm agreement
      await api.put(`/api/trades/${trade.id}`, {
        action: 'confirm_meetup',
        meetup_location: agreeLocation,
        meetup_date: agreeDate,
        meetup_time: agreeTime,
        ...(isPickupTrade && pickupPoint ? { meetup_lat: pickupPoint.lat, meetup_lng: pickupPoint.lng } : {}),
      })

      // Update local state
      if (isUserBuyer) {
        setBuyerMeetupConfirmed(true)
        setBuyerMeetupLocation(agreeLocation)
        setBuyerMeetupDate(agreeDate)
        setBuyerMeetupTime(agreeTime)
      } else {
        setSellerMeetupConfirmed(true)
        setSellerMeetupLocation(agreeLocation)
        setSellerMeetupDate(agreeDate)
        setSellerMeetupTime(agreeTime)
      }

      toast({
        title: 'G�� Schedule Accepted!',
        description: 'You have agreed to the proposed date and time.',
        status: 'success',
        duration: 3000,
      })

      // Refresh meetup status
      await fetchMeetupStatus()
      onStatusUpdate()
    } catch (error: any) {
      toast({
        title: 'Error',
        description: error?.response?.data?.error || 'Failed to accept schedule',
        status: 'error',
        duration: 3000,
      })
    } finally {
      setAgreeingToSchedule(false)
    }
  }

  /**
   * Handle dispute creation
   */
  const handleRaiseDispute = async () => {
    if (!meetupDisputeReason) {
      toast({
        title: 'Please select a reason',
        status: 'warning',
        position: 'top'
      })
      return
    }

    setMeetupInDispute(true)
    setShowDisputeDialog(false)
    setMeetupDisputeReason(null)
    setDisputeNotes('')

    toast({
      title: 'G��n+� Meetup marked as in dispute',
      description: 'The other party has been notified. You can propose alternative times or discuss the issue.',
      status: 'info',
      position: 'top',
      duration: 3000
    })
  }

  /**
   * Get current meetup state for display
   */
  const getMeetupState = (): 'proposed' | 'dispute' | 'finalized' | 'none' => {
    if (meetupInDispute) return 'dispute'
    if (meetupAgreed) return 'finalized'
    if (buyerMeetupConfirmed || sellerMeetupConfirmed) return 'proposed'
    return 'none'
  }

  // ============ END: Helper functions for date/time validation & generation ============

  const confirmMeetup = async () => {
    if (!trade || !selectedLocation || !selectedTime || !selectedDate || confirmingMeetup) return

    // Validate date and time
    const error = validateDateTimeSelection(selectedDate, selectedTime)
    if (error) {
      setValidationError(error)
      toast({
        id: "viewtrademodal-validation-error",
        title: 'Invalid Selection',
        description: error,
        status: 'warning',
        duration: 3000,
      })
      return
    }

    try {
      setConfirmingMeetup(true)
      setValidationError(null)
      await api.put(`/api/trades/${trade.id}`, {
        action: 'confirm_meetup',
        meetup_location: selectedLocation,
        meetup_time: selectedTime,
        meetup_date: selectedDate,
        ...(isPickupTrade && pickupPoint ? { meetup_lat: pickupPoint.lat, meetup_lng: pickupPoint.lng } : {}),
      })

      // Update local state based on current user role
      if (isUserBuyer) {
        setBuyerMeetupConfirmed(true)
        setBuyerMeetupLocation(selectedLocation)
        setBuyerMeetupDate(selectedDate)
        setBuyerMeetupTime(selectedTime)
      } else if (isUserSeller) {
        setSellerMeetupConfirmed(true)
        setSellerMeetupLocation(selectedLocation)
        setSellerMeetupDate(selectedDate)
        setSellerMeetupTime(selectedTime)
      }

      // Check if selections match the other party
      const otherPartyLocation = isUserBuyer ? sellerMeetupLocation : buyerMeetupLocation
      const otherPartyDate = isUserBuyer ? sellerMeetupDate : buyerMeetupDate
      const otherPartyTime = isUserBuyer ? sellerMeetupTime : buyerMeetupTime
      const otherPartyConfirmed = isUserBuyer ? sellerMeetupConfirmed : buyerMeetupConfirmed

      if (otherPartyConfirmed && otherPartyLocation && otherPartyTime) {
        const currentKey = buildMeetupKey(selectedLocation, selectedDate, selectedTime)
        const otherKey = buildMeetupKey(otherPartyLocation, otherPartyDate, otherPartyTime)
        if (currentKey && otherKey && currentKey === otherKey) {
          toast({
            id: "viewtrademodal-meetup-agreed",
            title: 'Meetup Agreed!',
            description: 'Both parties have agreed on the same location and time. The trade can now proceed!',
            status: 'success',
            duration: 5000,
          })
        } else {
          toast({
            id: "viewtrademodal-meetup-mismatch",
            title: 'Selection Mismatch',
            description: 'Your selection differs from the other party. Please coordinate to agree on the same location and time.',
            status: 'warning',
            duration: 5000,
          })
        }
      } else {
        toast({
          id: "viewtrademodal-meetup-location-confirmed",
          title: 'Meetup selection submitted',
          description: 'Waiting for the other party to select their preferred location and time...',
          status: 'info',
        })
      }

      // Refresh trade data to get updated status
      await fetchMeetupStatus()
      onStatusUpdate()
    } catch (error: any) {
      toast({
        id: "viewtrademodal-error-4",
        title: 'Error',
        description: error?.response?.data?.error || 'Failed to confirm meetup',
        status: 'error',
      })
      // Refresh trade data to ensure UI reflects actual backend state
      await fetchMeetupStatus()
    } finally {
      setConfirmingMeetup(false)
    }
  }

  const resetMeetupSelection = async () => {
    if (!trade) return

    try {
      setResettingMeetup(true)

      // Call backend to reset
      await api.put(`/api/trades/${trade.id}`, {
        action: 'reset_meetup_selection',
      })

      // Clear local state immediately so UI is responsive
      if (isUserBuyer) {
        setBuyerMeetupConfirmed(false)
      } else {
        setSellerMeetupConfirmed(false)
      }

      // Clear selected location and time to allow new selection
      setSelectedLocation(null)
      setSelectedTime(null)
      setSelectedDate(null)

      toast({
        id: 'viewtrademodal-reset-selection',
        title: 'Selection Reset',
        description: 'Your meetup selection has been cleared. You can now select new options.',
        status: 'info',
        duration: 3000,
      })

      // Refresh meetup status
      await fetchMeetupStatus()
    } catch (error: any) {
      console.error('Failed to reset meetup selection:', error)
      toast({
        id: 'viewtrademodal-reset-error',
        title: 'Error',
        description: error?.response?.data?.error || 'Failed to reset selection',
        status: 'error',
      })
    } finally {
      setResettingMeetup(false)
    }
  }

  const confirmMeetupDone = async () => {
    if (!trade || confirmingMeetupDone) return

    try {
      setConfirmingMeetupDone(true)
      const isPickupOwnerConfirming = isPickupTrade && isUserSeller
      let point: { lat: number; lng: number; accuracy: number } | null = null

      if (!isPickupOwnerConfirming) {
        point = await checkMeetupLocation()
        if (!point) return
        const distance = meetupPoint ? calculateDistanceMeters(point.lat, point.lng, meetupPoint.lat, meetupPoint.lng) : Number.POSITIVE_INFINITY
        if (!meetupPoint || point.accuracy > MAX_GPS_ACCURACY_M || distance > MEETUP_CONFIRM_RADIUS_M) {
          return
        }
      }
      await api.put(`/api/trades/${trade.id}`, {
        action: 'confirm_meetup_done',
        ...(point ? {
          user_lat: point.lat,
          user_lng: point.lng,
          location_accuracy_m: point.accuracy,
        } : {}),
      })

      if (isUserBuyer) {
        setBuyerMetConfirmed(true)
      } else if (isUserSeller) {
        setSellerMetConfirmed(true)
      }

      toast({
        id: 'viewtrademodal-meetup-done-confirmed',
        title: 'Confirmed',
        description: 'Waiting for the other party to confirm they met too.',
        status: 'success',
        duration: 3000,
      })

      await fetchMeetupStatus()
      onStatusUpdate()
    } catch (error: any) {
      toast({
        id: 'viewtrademodal-meetup-done-failed',
        title: 'Error',
        description: error?.response?.data?.error || 'Failed to confirm meetup completion',
        status: 'error',
      })
    } finally {
      setConfirmingMeetupDone(false)
    }
  }

  // ============ NEW: Cancel trade functionality ============
  const handleCancelTrade = async () => {
    if (!trade || cancelingTrade) return

    try {
      setCancelingTrade(true)
      await api.put(`/api/trades/${trade.id}`, {
        action: 'cancel',
        cancellation_reason: 'Trade cancelled by user',
      })

      toast({
        id: 'viewtrademodal-trade-cancelled',
        title: 'Trade Cancelled',
        description: 'This trade has been cancelled. Your trust score may be affected.',
        status: 'info',
        duration: 3000,
      })

      // Refresh trade data and close modal
      await fetchMeetupStatus()
      onStatusUpdate()
      setTimeout(() => {
        onClose()
      }, 1500)
    } catch (error: any) {
      toast({
        id: 'viewtrademodal-cancel-failed',
        title: 'Error',
        description: error?.response?.data?.error || 'Failed to cancel trade',
        status: 'error',
        duration: 3000,
      })
    } finally {
      setCancelingTrade(false)
      setShowCancelDialog(false)
    }
  }
  // ============ END: Cancel trade functionality ============

  // ============ Review and complete ============
  const handleInstantComplete = async () => {
    if (!trade || completingTrade) return
    setIsReviewModalOpen(true)
  }
  // ============ END: Review and complete ============


  if (!trade) return null

  const waitingLabel = trade.trade_option === 'delivery'
    ? 'Waiting for Delivery'
    : trade.meeting_type === 'pickup'
      ? 'Waiting for Pickup Schedule'
      : 'Waiting for Meetup'


  const isDeliveryTrade = trade.trade_option === 'delivery'

  // Determine if user can review (to disable dispute/cancel buttons when they can)
  const allLegsDelivered = linkedDeliveries.length > 0
    ? linkedDeliveries.every(d => d.status === 'delivered')
    : linkedDelivery?.status === 'delivered'
  const deliveryCompleted = !!allLegsDelivered
  const deliveryBothConfirmed = deliveryState.buyerConfirmedReceipt && deliveryState.sellerConfirmedDelivery

  const canUserReview: boolean = !!(isDeliveryTrade
    ? (deliveryCompleted || (!linkedDelivery && ((deliveryState.paymentConfirmed && deliveryState.deliveryInstructions) || deliveryBothConfirmed)))
    : meetupAgreed)

  const handleConfirmPayment = async () => {
    try {
      setConfirmingPayment(true)

      // Confirm COD payment
      await api.put(`/api/trades/${trade?.id}`, {
        action: 'update_delivery_state',
        payment_confirmed: true,
        payment_method: 'cod',
      })

      setDeliveryState(prev => ({
        ...prev,
        paymentConfirmed: true,
        paymentMethod: 'cod',
      }))

      // Update local trade state
      if (trade && onTradeUpdate) {
        const updatedTrade: Trade = {
          ...trade,
          payment_confirmed: true,
          payment_method: 'cod',
        }
        onTradeUpdate(updatedTrade)
      }

      // Call onStatusUpdate to refresh parent state
      onStatusUpdate()

      toast({
        id: "viewtrademodal-payment-confirmed",
        title: 'Ready for handoff',
        description: 'Ready to receive the item. Have your money ready!',
        status: 'success',
        duration: 2000,
      })
    } catch (error: any) {
      toast({
        id: "viewtrademodal-payment-failed",
        title: 'Confirmation failed',
        description: error?.response?.data?.error || 'Please try again',
        status: 'error',
        duration: 4000,
      })
    } finally {
      setConfirmingPayment(false)
    }
  }

  const handleConfirmDelivery = async () => {
    try {
      const confirmationPayload: any = {
        action: 'update_delivery_state',
      }

      if (isUserBuyer) {
        confirmationPayload.buyer_confirmed_receipt = true
        setDeliveryState(prev => ({
          ...prev,
          buyerConfirmedReceipt: true,
        }))
      } else {
        confirmationPayload.seller_confirmed_delivery = true
        setDeliveryState(prev => ({
          ...prev,
          sellerConfirmedDelivery: true,
        }))
      }

      // Save confirmation to backend
      await api.put(`/api/trades/${trade?.id}`, confirmationPayload)

      // Update local trade state
      if (trade && onTradeUpdate) {
        const updatedTrade: Trade = {
          ...trade,
          ...(isUserBuyer ? { buyer_confirmed_receipt: true } : { seller_confirmed_delivery: true }),
        }
        onTradeUpdate(updatedTrade)
      }

      // Call onStatusUpdate to refresh parent state
      onStatusUpdate()

      toast({
        id: "viewtrademodal-delivery-confirmed",
        title: 'Delivery confirmed',
        description: 'Thank you for confirming',
        status: 'success',
        duration: 2000,
      })

      // Check if both parties have confirmed (need to get fresh state)
      try {
        const response = await api.get(`/api/trades/${trade?.id}`)
        const freshTrade = response.data?.data
        if (freshTrade?.buyer_confirmed_receipt && freshTrade?.seller_confirmed_delivery) {
          // Both confirmed, complete the trade
          await api.put(`/api/trades/${freshTrade.id}`, {
            action: 'complete',
          })
          onStatusUpdate()
        }
      } catch (error) {
        console.error('Failed to check trade status:', error)
      }
    } catch (error: any) {
      toast({
        id: "viewtrademodal-delivery-confirmation-failed",
        title: 'Delivery confirmation failed',
        description: error?.response?.data?.error || 'Please try again',
        status: 'error',
        duration: 3000,
      })
    }
  }

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} size={["sm", "md", "lg", "6xl"]} isCentered scrollBehavior="inside">
        <ModalOverlay bg="blackAlpha.400" backdropFilter="blur(8px)" />
        <ModalContent
          bg="white"
          borderRadius="3xl"
          boxShadow="2xl"
          maxH="90vh"
          mx={[2, 4]}
          display="flex"
          flexDirection="column"
          overflow="hidden"
        >
          <ModalHeader pt={6} pb={5} px={6}>
            <HStack spacing={2} w="full" justify="space-between">
              <HStack spacing={3}>
                <Icon as={FaHandshake} color="brand.500" boxSize={6} />
                <Text fontSize="2xl" fontWeight="600" color="gray.800" letterSpacing="tight">Trade Details</Text>
                <Badge
                  colorScheme={
                    trade.status === 'active'
                      ? 'green'
                      : trade.status === 'completed'
                        ? 'blue'
                        : trade.status === 'accepted'
                          ? 'orange'
                          : 'yellow'
                  }
                  variant="subtle"
                  fontSize={["xs", "sm"]}
                >
                  {trade.status === 'active'
                    ? 'In Progress'
                    : trade.status === 'completed'
                      ? 'Completed'
                      : trade.status === 'accepted'
                        ? waitingLabel
                        : 'Pending'}
                </Badge>
              </HStack>

              {/* Action Buttons - Top Right Corner */}
              <HStack spacing={1}>
                <ModalCloseButton position="static" mt={0} />
              </HStack>
            </HStack>
          </ModalHeader>

          <ModalBody
            overflow="hidden"
            flex={1}
            p={[3, 4, 6]}
            display="flex"
            flexDirection="column"
            minH={{ base: '50vh', lg: '65vh' }}
          >
            <Tabs
              colorScheme="brand"
              index={tabIndex}
              onChange={(i) => setTabIndex(i)}
              display="flex"
              flexDirection="column"
              flex={1}
              overflow="hidden"
            >
              <TabList px={6} pt={2} pb={4} mb={0} fontSize="md">
                <Tab px={5} fontWeight="600">Overview</Tab>
                <Tab px={5} fontWeight="600">
                  Chat
                  {messages.length > 0 && (
                    <Badge ml={2} colorScheme="blue" borderRadius="full" fontSize="xs">
                      {messages.length}
                    </Badge>
                  )}
                </Tab>
                <Tab px={5} fontWeight="600">{trade?.meeting_type === 'pickup' ? 'Pickup' : 'Tracking'}</Tab>
              </TabList>

              <TabPanels
                flex={1}
                overflow="hidden"
                display="flex"
                flexDirection="column"
              >
                {/* Overview Tab */}
                <TabPanel px={[0, 2]} flex={1} overflowY="auto" display="flex" flexDirection="column">
                  <VStack spacing={[4, 6]} align="stretch">
                    {(trade?.status === 'active' || trade?.status === 'accepted') && (
                      <Card variant="outline" bg="white" borderRadius="2xl" shadow="sm">
                        <CardBody p={4}>
                          <HStack justify="space-between" align="center">
                            <Box>
                              <Text fontWeight="600" fontSize="sm" color="gray.800">Trade Management Actions</Text>
                              <Text fontSize="xs" color="gray.500">Need to cancel or report a problem?</Text>
                            </Box>
                            <HStack spacing={2}>
                              {(trade?.status === 'accepted' || (trade?.trade_option === 'meetup' && trade?.meetup_status === 'accepted')) && (
                                <Button
                                  size="sm"
                                  colorScheme="orange"
                                  onClick={() => setShowDisputeDialog(true)}
                                  leftIcon={<Icon as={FaExclamationTriangle} boxSize={3} />}
                                  borderRadius="full"
                                  px={4}
                                  isDisabled={canUserReview}
                                >
                                  Dispute
                                </Button>
                              )}
                              <Button
                                size="sm"
                                colorScheme="red"
                                variant="outline"
                                onClick={() => setShowCancelDialog(true)}
                                leftIcon={<Icon as={FaTimesCircle} boxSize={3} />}
                                borderRadius="full"
                                px={4}
                                isDisabled={cancelingTrade || canUserReview}
                              >
                                Cancel Trade
                              </Button>
                            </HStack>
                          </HStack>
                        </CardBody>
                      </Card>
                    )}
                    {/* Trade Option Display — read-only info card */}
                    {trade?.trade_option && (() => {
                      const isMeetup = trade.trade_option === 'meetup'
                      const isPickup = isMeetup && trade?.meeting_type === 'pickup'
                      const iconAs = isMeetup ? (isPickup ? FaMapMarkerAlt : FaHandshake) : FaTruck
                      const iconBg = isMeetup ? (isPickup ? 'orange.100' : 'blue.100') : 'green.100'
                      const iconColor = isMeetup ? (isPickup ? 'orange.600' : 'blue.600') : 'green.600'
                      const badgeScheme = isMeetup ? (isPickup ? 'orange' : 'blue') : 'green'
                      const label = isMeetup ? (isPickup ? 'Pickup' : 'Meetup') : 'Delivery'
                      const description = isMeetup
                        ? (isPickup ? 'Pickup at the other trader\'s set location' : 'Exchange items at a mutually agreed meetup location')
                        : 'Items will be delivered to addresses'
                      const isLocked = trade.status === 'accepted' || trade.status === 'active'
                      return (
                        <Box
                          borderRadius="xl"
                          borderWidth="1px"
                          borderColor="gray.200"
                          bg="white"
                          overflow="hidden"
                          cursor="default"
                        >
                          <HStack spacing={3} px={4} py={3} align="center">
                            <Box p={2.5} borderRadius="lg" bg={iconBg} flexShrink={0}>
                              <Icon as={iconAs} boxSize={4} color={iconColor} />
                            </Box>
                            <Box flex={1} minW={0}>
                              <Text fontSize="10px" fontWeight="700" color="gray.400" textTransform="uppercase" letterSpacing="0.6px">
                                Trade Option
                              </Text>
                              <HStack spacing={2} mt={0.5} flexWrap="wrap">
                                <Text fontWeight="600" fontSize="sm" color="gray.800">
                                  {label}
                                </Text>
                                <Badge colorScheme={badgeScheme} variant="subtle" fontSize="10px" px={2} py={0.5} borderRadius="full">
                                  Selected
                                </Badge>
                              </HStack>
                              <Text fontSize="xs" color="gray.500" mt={0.5} noOfLines={2}>
                                {description}
                                {!isMeetup && trade.delivery_address && ` — ${trade.delivery_address}`}
                              </Text>
                            </Box>
                          </HStack>
                          {isLocked && (
                            <HStack spacing={2} px={4} py={2} bg="gray.50" borderTopWidth="1px" borderTopColor="gray.100">
                              <Icon as={FaLock} boxSize="10px" color="gray.400" flexShrink={0} />
                              <Text fontSize="11px" color="gray.400">
                                Locked after acceptance – no further changes allowed
                              </Text>
                            </HStack>
                          )}
                        </Box>
                      )
                    })()}


                    {/* Meetup Status (for meetup trades) */}
                    {trade?.trade_option === 'meetup' && (
                      <Box p={4} bg={meetupInfoBg} borderRadius="md" borderWidth="1px" borderColor="gray.200">
                        <HStack justify="space-between">
                          <HStack>
                            <Text fontSize="sm" fontWeight="medium" color="gray.600">
                              Meetup Status:
                            </Text>
                            {getMeetupState() === 'proposed' && (
                              <Badge colorScheme="blue" fontSize="xs" px={2} py={1}>
                                📅 Proposed Schedule
                              </Badge>
                            )}
                            {getMeetupState() === 'dispute' && (
                              <Badge colorScheme="orange" fontSize="xs" px={2} py={1}>
                                ⚠️ In Dispute
                              </Badge>
                            )}
                            {getMeetupState() === 'finalized' && (
                              <Badge colorScheme="green" fontSize="xs" px={2} py={1}>
                                ✅ Finalized
                              </Badge>
                            )}
                            {getMeetupState() === 'none' && (
                              <Badge colorScheme="gray" fontSize="xs" px={2} py={1}>
                                ⏳ Pending
                              </Badge>
                            )}
                          </HStack>
                        </HStack>
                      </Box>
                    )}

                    {/* Trade Progress Indicator (meetup only) */}
                    {!isDeliveryTrade && <TradeProgressIndicator trade={trade} />}

                    {/* Caution Warning */}
                    {trade.trade_option === 'meetup' ? (
                      <Box
                        p={5}
                        bg="orange.50"
                        borderRadius="2xl"
                        borderWidth="0"
                        shadow="sm"
                      >
                        <HStack spacing={3} align="start">
                          <Icon as={FaExclamationTriangle} color="orange.500" boxSize={5} mt={0.5} />
                          <VStack align="start" spacing={1}>
                            <Text fontWeight="semibold" fontSize="sm" color="orange.700">
                              Meetup Policy Reminder
                            </Text>
                            <Text fontSize="xs" color="orange.600">
                              • Arriving late or not showing up (no-show) may result in strikes on your account.
                            </Text>
                            <Text fontSize="xs" color="orange.600">
                              • Multiple violations can lead to account suspension or permanent ban.
                            </Text>
                            <Text fontSize="xs" color="orange.600">
                              • Always communicate with your trading partner if you have delays.
                            </Text>
                          </VStack>
                        </HStack>
                      </Box>
                    ) : (
                      <Box
                        p={5}
                        bg="orange.50"
                        borderRadius="2xl"
                        borderWidth="0"
                        shadow="sm"
                      >
                        <HStack spacing={3} align="start">
                          <Icon as={FaExclamationTriangle} color="orange.500" boxSize={5} mt={0.5} />
                          <VStack align="start" spacing={1}>
                            <Text fontWeight="semibold" fontSize="sm" color="orange.700">
                              Delivery Policy Reminder
                            </Text>
                            <Text fontSize="xs" color="orange.600">
                              • Sending wrong items or failing to deliver (no-show) may result in strikes.
                            </Text>
                            <Text fontSize="xs" color="orange.600">
                              • Multiple violations can lead to account suspension or permanent ban.
                            </Text>
                            <Text fontSize="xs" color="orange.600">
                              • Ensure items match the trade description before sending.
                            </Text>
                          </VStack>
                        </HStack>
                      </Box>
                    )}

                    <Divider />

                    {/* Trade Partner Info */}
                    <Box
                      p={5}
                      bg="gray.50"
                      borderRadius="2xl"
                      borderWidth="0"
                      shadow="sm"
                      cursor="pointer"
                      _hover={{ bg: 'gray.100' }}
                      onClick={() => navigate(`/users/${isUserBuyer ? trade?.seller_id : trade?.buyer_id}`)}
                    >
                      <HStack spacing={4}>
                        <VerifiedAvatar
                          name={tradingPartner}
                          src={resolveAvatarSrc(userAvatarById[Number(isUserBuyer ? trade?.seller_id : trade?.buyer_id)])}
                          size="md"
                          bg={isUserBuyer ? 'green.500' : 'blue.500'}
                          color="white"
                          isVerified={false}
                        />
                        <Box flex={1}>
                          <Text fontWeight="semibold" _hover={{ textDecoration: 'underline' }}>
                            {tradingPartner}
                          </Text>
                          <Text fontSize="sm" color="gray.600">
                            Trading Partner
                          </Text>
                        </Box>
                        <Text fontSize="xs" color="gray.500">
                          Accepted {new Date((trade as any).created_at).toLocaleDateString()}
                        </Text>
                      </HStack>
                    </Box>

                    <Divider />

                    {/* Products Overview */}
                    <Box>
                      <Text fontWeight="600" fontSize="sm" textTransform="uppercase" letterSpacing="widest" color="gray.500" mb={4}>
                        Trade Items
                      </Text>
                    </Box>

                    {loadingProducts ? (
                      <Spinner />
                    ) : (
                      <SimpleGrid columns={{ base: 1, md: 2 }} spacing={4} w="full">
                        {/* Requested Products (What the seller is giving — primary + any additional from multi-target mode) */}
                        <Card variant="unstyled" borderRadius="2xl" borderWidth="0" shadow="sm" bg="white" h="full">
                          <CardBody display="flex" flexDirection="column" p={5}>
                            <VStack spacing={3} align="stretch" h="full">
                              <HStack>
                                <Badge colorScheme={
                                  trade.status === 'expired' ? 'gray'
                                    : trade.status === 'accepted' || trade.status === 'active' || trade.status === 'completed' || trade.status === 'auto_completed' ? 'green' : 'blue'}>
                                  {trade.status === 'expired' ? 'Expired'
                                    : trade.status === 'accepted' || trade.status === 'active' ? 'Trading'
                                      : trade.status === 'completed' || trade.status === 'auto_completed' ? 'Traded'
                                        : 'Requested'}
                                </Badge>
                                <Text fontSize="sm" color="gray.600">
                                  ({isUserSeller
                                    ? (additionalRequestedProducts.length > 0 ? "Your Items" : "Your Item")
                                    : (isUserBuyer
                                      ? (additionalRequestedProducts.length > 0 ? tradingPartner + "'s Items" : tradingPartner + "'s Item")
                                      : (additionalRequestedProducts.length > 0 ? "Trader's Items" : "Trader's Item"))})
                                </Text>
                              </HStack>
                              {requestedProduct ? (
                                <SimpleGrid columns={additionalRequestedProducts.length > 0 ? 2 : 1} spacing={3} w="full" flex={1}>
                                  {[requestedProduct, ...additionalRequestedProducts].map((product) => (
                                    <VStack key={`requested-${product.id}`} spacing={2} align="stretch" h="full">
                                      <Box w="full" bg="gray.50" borderRadius="md" overflow="hidden" aspectRatio="1" display="flex" alignItems="center" justifyContent="center" flex={1}>
                                        <OptimizedImage
                                          src={getFirstImage(product.image_urls)}
                                          alt={product.title}
                                          displayWidth="full"
                                          displayHeight="100%"
                                          objectFit="contain"
                                          borderRadius="md"
                                          fallbackSrc="/no-image.svg"
                                          width={additionalRequestedProducts.length > 0 ? 300 : 400}
                                        />
                                      </Box>
                                      <Box>
                                        <Text fontWeight="600" fontSize="sm" color="gray.800" noOfLines={2}>
                                          {product.title}
                                        </Text>
                                        <Badge bg="yellow.100" color="yellow.700" borderRadius="md" px={2} py={0.5} fontSize="10px" fontWeight="600" mt={2} mb={1}>
                                          ₱{Number(product.price || product.estimated_value_min || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                        </Badge>
                                        {additionalRequestedProducts.length === 0 && (
                                          <Text fontSize="xs" fontWeight="500" color="gray.500" noOfLines={3} mt={1}>
                                            {product.description}
                                          </Text>
                                        )}
                                      </Box>
                                    </VStack>
                                  ))}
                                </SimpleGrid>
                              ) : (
                                <Text color="gray.500">Loading...</Text>
                              )}
                            </VStack>
                          </CardBody>
                        </Card>

                        {/* Offered Products (What you're receiving) */}
                        <Card variant="unstyled" borderRadius="2xl" borderWidth="0" shadow="sm" bg="white" h="full">
                          <CardBody display="flex" flexDirection="column" p={5}>
                            <VStack spacing={3} align="stretch" h="full">
                              <HStack>
                                <Badge colorScheme={
                                  trade.status === 'expired' ? 'gray'
                                    : trade.status === 'accepted' || trade.status === 'active' || trade.status === 'completed' || trade.status === 'auto_completed' ? 'green' : 'green'}>
                                  {trade.status === 'expired' ? 'Expired'
                                    : trade.status === 'accepted' || trade.status === 'active' ? 'Trading'
                                      : trade.status === 'completed' || trade.status === 'auto_completed' ? 'Traded'
                                        : 'Offered'}
                                </Badge>
                                <Text fontSize="sm" color="gray.600">
                                  ({isUserBuyer ? "Your Item" : (isUserSeller ? tradingPartner + "'s Items" : "Trader's Items")})
                                </Text>
                              </HStack>
                              {offeredProducts.length > 0 ? (
                                <SimpleGrid columns={offeredProducts.length > 1 ? 2 : 1} spacing={3} w="full" flex={1}>
                                  {offeredProducts.map((product) => (
                                    <VStack key={`offered-${product.id}`} spacing={2} align="stretch" h="full">
                                      <Box w="full" bg="gray.50" borderRadius="md" overflow="hidden" aspectRatio="1" display="flex" alignItems="center" justifyContent="center" flex={1}>
                                        <OptimizedImage
                                          src={getFirstImage(product.image_urls)}
                                          alt={product.title}
                                          displayWidth="full"
                                          displayHeight="100%"
                                          objectFit="contain"
                                          borderRadius="md"
                                          fallbackSrc="/no-image.svg"
                                          width={300}
                                        />
                                      </Box>
                                      <Box>
                                        <Text fontSize="xs" fontWeight="600" color="gray.800" noOfLines={2}>
                                          {product.title}
                                        </Text>
                                        <Badge bg="yellow.100" color="yellow.700" borderRadius="md" px={2} py={0.5} fontSize="9px" fontWeight="600" mt={1}>
                                          ₱{Number(product.price || product.estimated_value_min || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                        </Badge>
                                      </Box>
                                    </VStack>
                                  ))}
                                </SimpleGrid>
                              ) : (
                                <Text color="gray.500">Loading...</Text>
                              )}
                            </VStack>
                          </CardBody>
                        </Card>
                      </SimpleGrid>
                    )}

                    {/* Delivery Information - Show for delivery trades after payment confirmed */}
                    {trade?.trade_option === 'delivery' && deliveryState.paymentConfirmed && (
                      <>
                        <Divider />
                        <Box>
                          <Text fontWeight="semibold" mb={4} fontSize="md">
                            Delivery Information
                          </Text>
                          <VStack spacing={3} align="stretch">
                            {(() => {
                              // Deliveries are returned ordered by creation time.
                              const activeLeg = linkedDelivery
                              const orderedLegs = Array.isArray(linkedDeliveries) ? linkedDeliveries : []
                              const leg1 = orderedLegs[0] || activeLeg || null
                              const leg1Pickup = leg1?.pickup_address || ''
                              const leg1Drop = leg1?.delivery_address || trade?.delivery_address || ''

                              const renderAddressPair = (opts: {
                                senderTitle: string
                                receiverTitle: string
                                senderAddress: string
                                receiverAddress: string
                                showSenderNote?: boolean
                                senderNote?: string
                                showReceiverNote?: boolean
                                receiverNote?: string
                              }) => (
                                <>
                                  <Card variant="outline" borderColor="blue.300">
                                    <CardBody p={4}>
                                      <HStack spacing={3} mb={2}>
                                        <Icon as={FaMapMarkerAlt} color="blue.500" boxSize={5} />
                                        <Text fontWeight="semibold" fontSize="sm">{opts.senderTitle}</Text>
                                      </HStack>
                                      <Text fontSize="sm" color="gray.700" ml={8}>
                                        {opts.senderAddress || 'Waiting for delivery to be created...'}
                                      </Text>
                                      {opts.showSenderNote && opts.senderNote && (
                                        <Text fontSize="xs" color="gray.500" mt={2} ml={8}>
                                          {opts.senderNote}
                                        </Text>
                                      )}
                                    </CardBody>
                                  </Card>

                                  <Card variant="outline" borderColor="green.300">
                                    <CardBody p={4}>
                                      <HStack spacing={3} mb={2}>
                                        <Icon as={FaMapMarkerAlt} color="green.500" boxSize={5} />
                                        <Text fontWeight="semibold" fontSize="sm">{opts.receiverTitle}</Text>
                                      </HStack>
                                      <Text fontSize="sm" color="gray.700" ml={8}>
                                        {opts.receiverAddress || 'Waiting for delivery to be created...'}
                                      </Text>
                                      {opts.showReceiverNote && opts.receiverNote && (
                                        <Text fontSize="xs" color="gray.500" mt={2} ml={8}>
                                          {opts.receiverNote}
                                        </Text>
                                      )}
                                    </CardBody>
                                  </Card>
                                </>
                              )

                              return (
                                <>
                                  {renderAddressPair({
                                    senderTitle: 'Pickup Location (Seller)',
                                    receiverTitle: 'Drop-off Location (Buyer)',
                                    senderAddress: leg1Pickup,
                                    receiverAddress: leg1Drop,
                                    showSenderNote: isUserSeller,
                                    senderNote: '(Your pickup address)',
                                    showReceiverNote: isUserBuyer,
                                    receiverNote: '(Your delivery address)',
                                  })}

                                  {/* Delivery Instructions */}
                                  {deliveryState.deliveryInstructions && (
                                    <Card variant="outline" borderColor="purple.300">
                                      <CardBody p={4}>
                                        <HStack spacing={3} mb={2}>
                                          <Icon as={FiMapPin} color="purple.500" boxSize={5} />
                                          <Text fontWeight="semibold" fontSize="sm">Special Instructions</Text>
                                        </HStack>
                                        <Text fontSize="sm" color="gray.700" ml={8} fontStyle="italic">
                                          "{deliveryState.deliveryInstructions}"
                                        </Text>
                                      </CardBody>
                                    </Card>
                                  )}

                                  {/* Assigned Rider */}
                                  <Card variant="outline" borderColor="orange.300" bg="orange.50">
                                    <CardBody p={4}>
                                      <HStack spacing={3} mb={2}>
                                        <Avatar
                                          name={linkedDelivery?.rider_name || 'Rider'}
                                          size="sm"
                                          bg="orange.500"
                                          color="white"
                                        />
                                        <Box flex={1} minW={0}>
                                          <Text fontWeight="semibold" fontSize="sm">Assigned Rider</Text>
                                          <Text fontSize="sm" color="gray.700" noOfLines={1}>
                                            {linkedDelivery?.rider_name || 'Waiting for a rider to claim this delivery'}
                                          </Text>
                                        </Box>
                                        {linkedDelivery?.rider_rating != null && (
                                          <HStack spacing={1} flexShrink={0}>
                                            <Icon as={FaStar} color="yellow.400" boxSize={3} />
                                            <Text fontSize="xs" color="gray.600">{linkedDelivery.rider_rating.toFixed(1)}</Text>
                                          </HStack>
                                        )}
                                      </HStack>

                                      {linkedDelivery?.rider_vehicle && (
                                        <HStack spacing={2} ml={8} mt={2}>
                                          <Icon as={FiTruck} color="orange.500" boxSize={4} />
                                          <Text fontSize="sm" color="gray.700" noOfLines={1}>{linkedDelivery.rider_vehicle}</Text>
                                        </HStack>
                                      )}

                                      {linkedDelivery?.rider_phone && (
                                        <HStack spacing={2} ml={8} mt={2}>
                                          <Icon as={FiPhone} color="orange.500" boxSize={4} />
                                          <Text fontSize="sm" color="gray.700">{linkedDelivery.rider_phone}</Text>
                                        </HStack>
                                      )}
                                    </CardBody>
                                  </Card>
                                </>
                              )
                            })()}
                          </VStack>
                        </Box>
                      </>
                    )}
                  </VStack>
                </TabPanel>


                {/* Chat Tab */}
                <TabPanel p={0} overflow="hidden" minH={0} flex={1} display="flex" flexDirection="column">
                  {/* Messages area — transparent, fills all space */}
                  <Box
                    flex={1}
                    overflowY="auto"
                    px={[3, 4]}
                    py={3}
                    display="flex"
                    flexDirection="column"
                  >
                    {loadingMessages ? (
                      <Flex justify="center" align="center" flex={1}>
                        <Spinner color="brand.500" />
                      </Flex>
                    ) : messages.length === 0 ? (
                      <Flex justify="center" align="center" flex={1} direction="column" gap={2}>
                        <Box
                          p={4}
                          borderRadius="full"
                          bg="gray.100"
                        >
                          <Icon as={FaPaperPlane} boxSize={7} color="gray.400" />
                        </Box>
                        <Text fontWeight="600" color="gray.600" fontSize="sm">No messages yet</Text>
                        <Text color="gray.400" fontSize="xs">Start the conversation below</Text>
                      </Flex>
                    ) : (
                      <VStack spacing={2} align="stretch" pb={2}>
                        {messages.map((msg) => {
                          const isOwnMessage = msg.sender_id === user?.id
                          const senderAvatarSrc = isOwnMessage
                            ? resolveAvatarSrc((user as any)?.profile_picture)
                            : resolveAvatarSrc(userAvatarById[Number(msg.sender_id)])
                          const isPhotoMessage = typeof msg.content === 'string' && msg.content.startsWith('photo:')
                          const photoUrl = isPhotoMessage ? msg.content.slice('photo:'.length).trim() : ''
                          return (
                            <HStack
                              key={`msg-${msg.id}`}
                              justify={isOwnMessage ? 'flex-end' : 'flex-start'}
                              align="flex-end"
                              spacing={2}
                            >
                              {!isOwnMessage && (
                                <Avatar
                                  name={msg.sender_name || 'User'}
                                  src={senderAvatarSrc}
                                  size="xs"
                                  bg="brand.500"
                                  color="white"
                                  flexShrink={0}
                                />
                              )}
                              <Box
                                maxW="72%"
                                px={3}
                                py={2}
                                borderRadius={isOwnMessage ? '18px 18px 4px 18px' : '18px 18px 18px 4px'}
                                bg={isOwnMessage ? 'brand.500' : 'gray.100'}
                                color={isOwnMessage ? 'white' : 'gray.800'}
                              >
                                {isPhotoMessage ? (
                                  <Image
                                    src={getImageUrl(photoUrl)}
                                    alt="Shared photo"
                                    borderRadius="md"
                                    maxH="200px"
                                    objectFit="cover"
                                  />
                                ) : (
                                  <Text fontSize="sm" lineHeight="1.4">{msg.content}</Text>
                                )}
                                <Text
                                  fontSize="10px"
                                  color={isOwnMessage ? 'whiteAlpha.700' : 'gray.400'}
                                  mt={0.5}
                                  textAlign={isOwnMessage ? 'right' : 'left'}
                                >
                                  {new Date(msg.created_at).toLocaleTimeString([], {
                                    hour: '2-digit',
                                    minute: '2-digit',
                                  })}
                                </Text>
                              </Box>
                              {isOwnMessage && (
                                <Avatar
                                  name={user?.name || 'You'}
                                  src={senderAvatarSrc}
                                  size="xs"
                                  bg="brand.500"
                                  color="white"
                                  flexShrink={0}
                                />
                              )}
                            </HStack>
                          )
                        })}
                        <div ref={messagesEndRef} />
                      </VStack>
                    )}
                  </Box>

                  {/* Input pinned to bottom */}
                  <Box flexShrink={0} borderTopWidth="1px" borderColor="gray.100">
                    {chatPhotoPreview && (
                      <HStack spacing={2} px={[3, 4]} pt={2} align="center">
                        <Image src={chatPhotoPreview} alt="Photo preview" maxH="52px" borderRadius="md" />
                        <Button size="xs" variant="ghost" colorScheme="red" onClick={clearChatPhoto}>Remove</Button>
                      </HStack>
                    )}
                    <HStack spacing={2} px={[3, 4]} py={3}>
                      <input
                        ref={chatPhotoInputRef}
                        type="file"
                        accept="image/*"
                        onChange={handleChatPhotoSelect}
                        style={{ display: 'none' }}
                      />
                      <IconButton
                        aria-label="Attach photo"
                        icon={<FiCamera />}
                        variant="ghost"
                        size="sm"
                        color="gray.500"
                        onClick={() => chatPhotoInputRef.current?.click()}
                        isDisabled={sendingMessage || uploadingChatPhoto}
                        flexShrink={0}
                      />
                      <InputGroup flex={1}>
                        <Textarea
                          value={newMessage}
                          onChange={(e) => setNewMessage(e.target.value)}
                          placeholder="Type a message…"
                          resize="none"
                          rows={1}
                          borderRadius="full"
                          bg="gray.50"
                          border="1px solid"
                          borderColor="gray.200"
                          _focus={{ bg: 'white', borderColor: 'brand.400', boxShadow: 'none' }}
                          fontSize="sm"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault()
                              sendMessage()
                            }
                          }}
                          isDisabled={sendingMessage || uploadingChatPhoto}
                        />
                      </InputGroup>
                      <IconButton
                        aria-label="Send message"
                        icon={<FaPaperPlane />}
                        colorScheme="brand"
                        borderRadius="full"
                        size="sm"
                        onClick={sendMessage}
                        isLoading={sendingMessage || uploadingChatPhoto}
                        isDisabled={!newMessage.trim() && !chatPhotoFile}
                        flexShrink={0}
                      />
                    </HStack>
                  </Box>
                </TabPanel>

                {/* Tracking/Delivery Tab */}
                <TabPanel p={0} flex={1} overflow="hidden" display="flex" flexDirection="column">
                  {trade?.trade_option === 'delivery' ? (
                    <DeliveryTab
                      deliveryState={deliveryState}
                      setDeliveryState={setDeliveryState}
                      deliveryOptions={deliveryOptions}
                      requestedProduct={requestedProduct}
                      trade={trade}
                      distance={distance}
                      isUserSeller={isUserSeller ?? false}
                      isUserBuyer={isUserBuyer ?? false}
                      handleConfirmPayment={handleConfirmPayment}
                      handleConfirmDelivery={handleConfirmDelivery}
                      saveDeliveryState={saveDeliveryState}
                      confirmDeliveryType={confirmDeliveryType}
                      handleInstantComplete={handleInstantComplete}
                      completingTrade={completingTrade}
                      confirmingPayment={confirmingPayment}
                      confirmingDeliveryType={confirmingDeliveryType}
                      syncingOnlinePayment={syncingOnlinePayment}
                      linkedDelivery={linkedDelivery}
                      linkedDeliveries={linkedDeliveries}
                    />
                  ) : (
                    <Box position="relative" flex={1} minH={{ base: '68vh', md: '72vh' }} overflow="hidden" bg="gray.100" borderRadius={{ base: 'xl', md: '2xl' }}>
                      <Box position="absolute" inset={0}>
                        <MapContainer
                          key={`tracking-${mapInitKey}`}
                          center={[trackingCenter.lat, trackingCenter.lng]}
                          zoom={16}
                          style={{ height: '100%', width: '100%' }}
                          scrollWheelZoom
                        >
                          <ModalMapFix />
                          {trackingMapPoints.length > 1 && <FitBounds points={trackingMapPoints} />}
                          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                          {meetupTrackingPoint && (
                            <>
                              <Circle
                                center={[meetupTrackingPoint.lat, meetupTrackingPoint.lng]}
                                radius={MEETUP_CONFIRM_RADIUS_M}
                                pathOptions={{ color: '#16A34A', fillColor: '#BBF7D0', fillOpacity: 0.28, weight: 3 }}
                              />
                              <Marker position={[meetupTrackingPoint.lat, meetupTrackingPoint.lng]}>
                                <Popup>{isPickupTrade ? 'Pickup point' : 'Meetup point'}</Popup>
                              </Marker>
                            </>
                          )}
                          {trackingRoute.length > 1 && (
                            <Polyline positions={trackingRoute} pathOptions={{ color: '#2563EB', weight: 5, opacity: 0.82 }} />
                          )}
                          {trackingCurrentPoint && (
                            <Circle
                              center={[trackingCurrentPoint.lat, trackingCurrentPoint.lng]}
                              radius={70}
                              pathOptions={{ color: '#2563EB', fillColor: '#DBEAFE', fillOpacity: 0.34, weight: 2 }}
                            >
                              <Popup>{isPickupTrade ? 'Your current location' : 'Your approximate location'}</Popup>
                            </Circle>
                          )}
                          {buyerApproxPoint && (
                            <Circle
                              center={[buyerApproxPoint.lat, buyerApproxPoint.lng]}
                              radius={90}
                              pathOptions={{ color: '#7C3AED', fillColor: '#EDE9FE', fillOpacity: 0.28, weight: 2 }}
                            >
                              <Popup>User A approximate location</Popup>
                            </Circle>
                          )}
                          {sellerApproxPoint && (
                            <Circle
                              center={[sellerApproxPoint.lat, sellerApproxPoint.lng]}
                              radius={90}
                              pathOptions={{ color: '#EA580C', fillColor: '#FFEDD5', fillOpacity: 0.28, weight: 2 }}
                            >
                              <Popup>User B approximate location</Popup>
                            </Circle>
                          )}
                        </MapContainer>
                      </Box>

                      <Box position="absolute" top={3} left={3} right={3} zIndex={500} pointerEvents="none">
                        <HStack justify="space-between" align="start" spacing={3}>
                          <Box bg="whiteAlpha.950" borderRadius="xl" px={3} py={2} shadow="lg" maxW="70%">
                            <Text fontSize="xs" fontWeight="900" color="gray.500" textTransform="uppercase">
                              {isPickupTrade ? 'Pickup tracking' : 'Meetup tracking'}
                            </Text>
                            <Text fontSize="sm" fontWeight="800" color="gray.800" noOfLines={1}>{meetupDisplayLabel}</Text>
                            <Text fontSize="xs" color="gray.600">
                              {isPickupTrade && !userGeoPoint ? 'Enable location to view ETA and route.' : isPickupTrade ? 'Live route to pickup point' : 'Approximate locations only'}
                            </Text>
                          </Box>
                          <VStack spacing={2} align="stretch" pointerEvents="auto">
                            <HStack bg="whiteAlpha.950" borderRadius="full" px={3} py={2} shadow="lg" spacing={3}>
                              <Text fontSize="xs" fontWeight="800" color="gray.800">{trackingEtaLabel}</Text>
                              <Text fontSize="xs" color="gray.500">{trackingDistanceLabel}</Text>
                            </HStack>
                            <Button size="xs" colorScheme="green" borderRadius="full" onClick={openGoogleMapsDirections} isDisabled={!meetupTrackingPoint}>
                              Open in Google Maps
                            </Button>
                          </VStack>
                        </HStack>
                      </Box>

                      <MotionBox
                        position="absolute"
                        left={0}
                        right={0}
                        bottom={0}
                        zIndex={600}
                        h={trackingSheetHeight}
                        bg={useColorModeValue('white', 'gray.900')}
                        borderTopRadius="2xl"
                        shadow="2xl"
                        display="flex"
                        flexDirection="column"
                        drag="y"
                        dragConstraints={{ top: 0, bottom: 0 }}
                        dragElastic={0.08}
                        onDragEnd={(_, info) => {
                          if (info.offset.y > 80) setTrackingSheetSnap('collapsed')
                          else if (info.offset.y < -80) setTrackingSheetSnap('full')
                          else setTrackingSheetSnap('half')
                        }}
                        transition={{ duration: 0.18, ease: 'easeOut' }}
                      >
                        <VStack spacing={2} align="stretch" px={4} pt={2} pb={3} borderBottomWidth="1px" borderColor="gray.100" flexShrink={0}>
                          <Box w="44px" h="5px" bg="gray.300" borderRadius="full" mx="auto" />
                          <HStack justify="space-between" align="center">
                            <Box minW={0}>
                              <Text fontWeight="900" color="gray.800" fontSize="sm">
                                {bothMetConfirmed
                                  ? (isPickupTrade ? 'Pickup completed' : 'Meetup completed')
                                  : userMetConfirmed
                                    ? 'Waiting for partner'
                                    : meetupLocationVerified
                                      ? (isPickupTrade ? 'Ready to confirm pickup' : 'Ready to confirm')
                                      : isPickupTrade
                                        ? 'Head to the pickup location'
                                        : 'Head to the meetup point'}
                              </Text>
                              <Text fontSize="xs" color="gray.500" noOfLines={1}>
                                {geoMessage || (isPickupTrade && !userGeoPoint ? 'Enable location to view ETA and route.' : 'Confirm unlocks near the pickup location.')}
                              </Text>
                            </Box>
                            <HStack spacing={1}>
                              {(['collapsed', 'half', 'full'] as const).map(snap => (
                                <Button
                                  key={snap}
                                  size="xs"
                                  variant={trackingSheetSnap === snap ? 'solid' : 'ghost'}
                                  colorScheme="brand"
                                  onClick={() => setTrackingSheetSnap(snap)}
                                  borderRadius="full"
                                >
                                  {snap === 'collapsed' ? 'Min' : snap === 'half' ? 'Half' : 'Full'}
                                </Button>
                              ))}
                            </HStack>
                          </HStack>
                        </VStack>

                        <Box overflowY="auto" px={{ base: 3, md: 5 }} py={4} flex={1}>
                          <VStack spacing={6} align="stretch">

                      {/* ── 1. MY PROPOSAL CARD (proposer's waiting view) ── */}
                      {!meetupAgreed && myMeetupProposal && !incomingMeetupProposal && (
                        <Card variant="outline" borderColor="gray.200" bg={useColorModeValue('gray.50', 'gray.800')}>
                          <CardBody p={[3, 4]}>
                            <VStack spacing={3} align="stretch">
                              <HStack spacing={2} align="center">
                                <Icon as={FaHandshake} color="brand.500" boxSize={4} />
                                <Text fontWeight="700" color={useColorModeValue('gray.800', 'gray.100')}>
                                  Your Proposed Meetup
                                </Text>
                                <Badge colorScheme="gray" variant="subtle" borderRadius="full" ml="auto">
                                  Waiting for response
                                </Badge>
                              </HStack>
                              <Box p={2.5} bg={useColorModeValue('gray.100', 'gray.700')} borderRadius="md" borderLeft="3px solid" borderColor="gray.300">
                                <Text fontSize="sm" color={useColorModeValue('gray.700', 'gray.300')}>
                                  You proposed this meetup. Waiting for {tradingPartner} to confirm.
                                </Text>
                              </Box>
                              <SimpleGrid columns={[1, 3]} spacing={2}>
                                <HStack align="start" spacing={2}>
                                  <Icon as={FaMapMarkerAlt} color="blue.500" boxSize={4} mt={0.5} />
                                  <Box minW={0}>
                                    <Text fontSize="xs" fontWeight="700" color="gray.500" textTransform="uppercase">Location</Text>
                                    <Text fontSize="sm" fontWeight="600" color={useColorModeValue('gray.800', 'gray.100')} noOfLines={2}>
                                      {myMeetupProposal.location}
                                    </Text>
                                  </Box>
                                </HStack>
                                <HStack align="start" spacing={2}>
                                  <Icon as={FaCalendarAlt} color="blue.500" boxSize={4} mt={0.5} />
                                  <Box>
                                    <Text fontSize="xs" fontWeight="700" color="gray.500" textTransform="uppercase">Date</Text>
                                    <Text fontSize="sm" fontWeight="600" color={useColorModeValue('gray.800', 'gray.100')}>
                                      {myMeetupProposal.date ? formatDateLabel(myMeetupProposal.date) : 'Date not set'}
                                    </Text>
                                  </Box>
                                </HStack>
                                <HStack align="start" spacing={2}>
                                  <Icon as={FaClock} color="blue.500" boxSize={4} mt={0.5} />
                                  <Box>
                                    <Text fontSize="xs" fontWeight="700" color="gray.500" textTransform="uppercase">Time</Text>
                                    <Text fontSize="sm" fontWeight="600" color={useColorModeValue('gray.800', 'gray.100')}>
                                      {myMeetupProposal.time ? formatTimePH(myMeetupProposal.time) : 'Time not set'}
                                    </Text>
                                  </Box>
                                </HStack>
                              </SimpleGrid>
                              <Button
                                size="sm"
                                variant="outline"
                                colorScheme="brand"
                                w="full"
                                mt={1}
                                onClick={resetMeetupSelection}
                                isLoading={resettingMeetup}
                                loadingText="Resetting…"
                                borderRadius="lg"
                              >
                                Change Proposal
                              </Button>
                            </VStack>
                          </CardBody>
                        </Card>
                      )}

                      {/* ── 2. INCOMING PROPOSAL CARD (receiver's action view) ── */}
                      {!meetupAgreed && incomingMeetupProposal && (
                        <Card variant="outline" borderColor="brand.200" bg={useColorModeValue('brand.50', 'gray.800')}>
                          <CardBody p={[3, 4]}>
                            <VStack spacing={3} align="stretch">
                              <HStack justify="space-between" align="start" spacing={3}>
                                <HStack spacing={2}>
                                  <Icon as={FaHandshake} color="brand.500" boxSize={4} />
                                  <Text fontWeight="700" color={useColorModeValue('gray.800', 'white')}>
                                    Proposed Meetup
                                  </Text>
                                </HStack>
                                <Badge colorScheme="purple" variant="subtle" borderRadius="full">
                                  {incomingMeetupProposal.proposer}
                                </Badge>
                              </HStack>

                              {/* User-specific context message */}
                              {!currentUserMeetupConfirmed ? (
                                <Box p={2.5} bg={useColorModeValue('orange.50', 'orange.900')} borderRadius="md" borderLeft="3px solid" borderColor="orange.400">
                                  <Text fontSize="sm" color={useColorModeValue('orange.800', 'orange.200')}>
                                    {incomingMeetupProposal.proposer} proposed this meetup. You can accept it or suggest changes.
                                  </Text>
                                </Box>
                              ) : (
                                <Box p={2.5} bg={useColorModeValue('gray.50', 'gray.700')} borderRadius="md" borderLeft="3px solid" borderColor="gray.300">
                                  <Text fontSize="sm" color={useColorModeValue('gray.600', 'gray.400')}>
                                    You already confirmed this meetup. Waiting for {tradingPartner} to respond.
                                  </Text>
                                </Box>
                              )}

                              <SimpleGrid columns={[1, 3]} spacing={2}>
                                <HStack align="start" spacing={2}>
                                  <Icon as={FaMapMarkerAlt} color="brand.500" boxSize={4} mt={0.5} />
                                  <Box minW={0}>
                                    <Text fontSize="xs" fontWeight="700" color="gray.500" textTransform="uppercase">Location</Text>
                                    <Text fontSize="sm" fontWeight="600" color={useColorModeValue('gray.800', 'gray.100')} noOfLines={2}>
                                      {incomingMeetupProposal.location}
                                    </Text>
                                  </Box>
                                </HStack>
                                <HStack align="start" spacing={2}>
                                  <Icon as={FaCalendarAlt} color="brand.500" boxSize={4} mt={0.5} />
                                  <Box>
                                    <Text fontSize="xs" fontWeight="700" color="gray.500" textTransform="uppercase">Date</Text>
                                    <Text fontSize="sm" fontWeight="600" color={useColorModeValue('gray.800', 'gray.100')}>
                                      {incomingMeetupProposal.date ? formatDateLabel(incomingMeetupProposal.date) : 'Date not set'}
                                    </Text>
                                  </Box>
                                </HStack>
                                <HStack align="start" spacing={2}>
                                  <Icon as={FaClock} color="brand.500" boxSize={4} mt={0.5} />
                                  <Box>
                                    <Text fontSize="xs" fontWeight="700" color="gray.500" textTransform="uppercase">Time</Text>
                                    <Text fontSize="sm" fontWeight="600" color={useColorModeValue('gray.800', 'gray.100')}>
                                      {incomingMeetupProposal.time ? formatTimePH(incomingMeetupProposal.time) : 'Time not set'}
                                    </Text>
                                  </Box>
                                </HStack>
                              </SimpleGrid>

                              {!currentUserMeetupConfirmed && (
                                <HStack spacing={2} align="stretch" flexDirection={["column", "row"]}>
                                  <Button
                                    colorScheme="green"
                                    leftIcon={<FaCheckCircle />}
                                    onClick={handleAgreeToSchedule}
                                    isLoading={agreeingToSchedule}
                                    isDisabled={!incomingMeetupProposal.time || agreeingToSchedule}
                                    title={!incomingMeetupProposal.time ? 'No time set — use Suggest Changes to add a time' : ''}
                                    flex={1}
                                  >
                                    Accept Meetup
                                  </Button>
                                  <Button
                                    variant="outline"
                                    leftIcon={<FaLightbulb />}
                                    onClick={() => {
                                      const opening = !showSuggestionsPanel
                                      setShowSuggestionsPanel(opening)
                                      setValidationError(null)
                                      if (opening) {
                                        if (incomingMeetupProposal.location && !selectedLocation) setSelectedLocation(incomingMeetupProposal.location)
                                        if (incomingMeetupProposal.date && !selectedDate) setSelectedDate(incomingMeetupProposal.date)
                                        if (incomingMeetupProposal.time && !selectedTime) setSelectedTime(incomingMeetupProposal.time)
                                      }
                                    }}
                                    flex={1}
                                  >
                                    {showSuggestionsPanel ? 'Hide Changes' : 'Suggest Changes'}
                                  </Button>
                                </HStack>
                              )}
                            </VStack>
                          </CardBody>
                        </Card>
                      )}

                      {/* ── 3. CONFIRMED MEETUP CARD ── */}
                      {meetupAgreed && meetupSelectionMatches && !isPickupTrade && (
                        <Card bg={useColorModeValue('green.50', 'green.900')} borderWidth="2px" borderColor={useColorModeValue('green.300', 'green.600')}>
                          <CardBody p={[3, 4]}>
                            <VStack spacing={3} align="stretch">
                              <HStack spacing={2}>
                                <Icon as={FaCheckCircle} color="green.500" boxSize={5} />
                                <Text fontWeight="bold" fontSize="md" color={useColorModeValue('green.700', 'green.300')}>
                                  {trade?.meeting_type === 'pickup' ? 'Pickup Confirmed!' : 'Meetup Confirmed!'}
                                </Text>
                              </HStack>
                              <Text fontSize="sm" color={useColorModeValue('green.700', 'green.300')}>
                                Both traders agreed. See you there!
                              </Text>
                              <SimpleGrid columns={[1, 3]} spacing={2}>
                                <HStack align="start" spacing={2}>
                                  <Icon as={FaMapMarkerAlt} color="green.600" boxSize={4} mt={0.5} />
                                  <Box minW={0}>
                                    <Text fontSize="xs" fontWeight="700" color={useColorModeValue('green.600', 'green.400')} textTransform="uppercase">Location</Text>
                                    <Text fontSize="sm" fontWeight="600" color={useColorModeValue('green.900', 'green.100')} noOfLines={2}>
                                      {buyerMeetupLocation}
                                    </Text>
                                  </Box>
                                </HStack>
                                {buyerMeetupDate && (
                                  <HStack align="start" spacing={2}>
                                    <Icon as={FaCalendarAlt} color="green.600" boxSize={4} mt={0.5} />
                                    <Box>
                                      <Text fontSize="xs" fontWeight="700" color={useColorModeValue('green.600', 'green.400')} textTransform="uppercase">Date</Text>
                                      <Text fontSize="sm" fontWeight="600" color={useColorModeValue('green.900', 'green.100')}>
                                        {formatDateLabel(buyerMeetupDate)}
                                      </Text>
                                    </Box>
                                  </HStack>
                                )}
                                {buyerMeetupTime && (
                                  <HStack align="start" spacing={2}>
                                    <Icon as={FaClock} color="green.600" boxSize={4} mt={0.5} />
                                    <Box>
                                      <Text fontSize="xs" fontWeight="700" color={useColorModeValue('green.600', 'green.400')} textTransform="uppercase">Time</Text>
                                      <Text fontSize="sm" fontWeight="600" color={useColorModeValue('green.900', 'green.100')}>
                                        {formatTimePH(buyerMeetupTime)}
                                      </Text>
                                    </Box>
                                  </HStack>
                                )}
                              </SimpleGrid>
                              <Text fontSize="xs" color={useColorModeValue('green.700', 'green.400')} fontStyle="italic">
                                Please arrive on time. Review the Meetup Policy for no-shows and strikes.
                              </Text>
                            </VStack>
                          </CardBody>
                        </Card>
                      )}

                      {/* Meetup Location Selection */}
                      {showMeetupEditor && (isPickupTrade ? (
                        // Pickup trade: location is locked to the seller's pickup_address.
                        // Before the trade is accepted we mask to the neighborhood only; the
                        // full address reveals once the trade moves to active.
                        <Card variant="outline" borderColor="orange.300" bg="orange.50">
                          <CardBody p={4}>
                            <VStack align="stretch" spacing={3}>
                              <HStack spacing={2}>
                                <Icon as={FaMapMarkerAlt} color="orange.500" boxSize={5} />
                                <Text fontWeight="700" color="orange.800">Pickup Location</Text>
                                <Badge colorScheme="orange" variant="subtle">Locked</Badge>
                              </HStack>
                              {pickupAddress ? (
                                <>
                                  <Text fontSize="md" fontWeight="600" color="orange.900">
                                    {pickupDisplayAddress}
                                  </Text>
                                  {!pickupAddressRevealed && (
                                    <Text fontSize="xs" color="orange.700" fontStyle="italic">
                                      🔒 Exact address is revealed once the offer is accepted.
                                    </Text>
                                  )}
                                  <Text fontSize="xs" color="gray.600">
                                    This is the other trader's set pickup location. You will coordinate around this pickup spot, and the location can't be changed. Pick a date and time below to continue.
                                  </Text>
                                </>
                              ) : (
                                <Text fontSize="sm" color="red.600">
                                  The other trader hasn't set a pickup address on this product. Please message them to coordinate.
                                </Text>
                              )}
                            </VStack>
                          </CardBody>
                        </Card>
                      ) : (isUserBuyer && buyerMeetupConfirmed) || (isUserSeller && sellerMeetupConfirmed) ? (
                        // Locked location - just show summary in the date/time display
                        null
                      ) : (
                        <Box>
                          <Text fontWeight="semibold" mb={1} fontSize="md">
                            Suggested Meetup Locations
                          </Text>
                          <Text fontSize="sm" color="gray.600" mb={3}>
                            Select a safe, public location. Both parties must confirm to proceed.
                          </Text>

                          {/* Place search (Google Maps) */}
                          <Box mb={4} position="relative" zIndex={1500}>
                            <InputGroup size="sm">
                              <InputLeftElement pointerEvents="none">
                                <Icon as={FaMapMarkerAlt} color="gray.400" />
                              </InputLeftElement>
                              <Input
                                placeholder='Search any place in PH (e.g. "claret jollibee")'
                                value={placeQuery}
                                onChange={(e) => setPlaceQuery(e.target.value)}
                                pr={placeSearching ? '2rem' : undefined}
                              />
                              {placeSearching && (
                                <Box position="absolute" right={2} top="50%" transform="translateY(-50%)" zIndex={2}>
                                  <Spinner size="xs" />
                                </Box>
                              )}
                            </InputGroup>
                            {placeResults.length > 0 && (
                              <Box
                                position="absolute"
                                top="100%"
                                left={0}
                                right={0}
                                zIndex={1500}
                                bg="white"
                                borderWidth="1px"
                                borderColor={borderColor}
                                borderRadius="md"
                                boxShadow="lg"
                                maxH="240px"
                                overflowY="auto"
                                mt={1}
                              >
                                {placeResults.map((r, idx) => (
                                  <Box
                                    key={`${r.name}-${idx}`}
                                    px={3}
                                    py={2}
                                    cursor="pointer"
                                    _hover={{ bg: 'brand.50' }}
                                    borderBottomWidth={idx < placeResults.length - 1 ? '1px' : 0}
                                    borderColor="gray.100"
                                    onClick={() => {
                                      const loc: MeetupLocation = {
                                        name: r.name,
                                        address: r.address,
                                        type: 'other',
                                        lat: r.latitude,
                                        lng: r.longitude,
                                      }
                                      setSearchedLocations((prev) => {
                                        if (prev.find((p) => p.name === loc.name)) return prev
                                        return [loc, ...prev].slice(0, 5)
                                      })
                                      setSelectedLocation(loc.name)
                                      setPlaceResults([])
                                      setPlaceQuery('')
                                    }}
                                  >
                                    <Text fontSize="sm" fontWeight="medium" noOfLines={1}>
                                      {r.name}
                                    </Text>
                                    <Text fontSize="xs" color="gray.500" noOfLines={1}>
                                      {r.address}
                                    </Text>
                                  </Box>
                                ))}
                              </Box>
                            )}
                          </Box>

                          {/* Locations Grid */}
                          <Box h={["220px", "270px", "300px"]} mb={4} borderRadius="xl" overflow="hidden" shadow="md">
                            <MapContainer
                              key={mapInitKey}
                              center={[6.9214, 122.0790]}
                              zoom={14}
                              style={{ height: '100%', width: '100%' }}
                              // @ts-ignore
                              attributionControl={false}
                            >
                              <ModalMapFix />
                              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                              {selectedLocation && suggestedLocations.find(l => l.name === selectedLocation)?.lat && (
                                <MapUpdater
                                  lat={suggestedLocations.find(l => l.name === selectedLocation)!.lat!}
                                  lng={suggestedLocations.find(l => l.name === selectedLocation)!.lng!}
                                />
                              )}
                              {suggestedLocations.filter(loc => loc.lat && loc.lng).map((loc, idx) => (
                                <Marker
                                  key={idx}
                                  position={[loc.lat!, loc.lng!]}
                                  eventHandlers={{ click: () => setSelectedLocation(loc.name) }}
                                >
                                  <Popup>
                                    <b>{loc.name}</b><br />{loc.address}
                                  </Popup>
                                </Marker>
                              ))}
                            </MapContainer>
                          </Box>

                          <HStack
                            spacing={2}
                            overflowX="auto"
                            pb={2}
                            alignItems="stretch"
                            css={{
                              '&::-webkit-scrollbar': { height: '3px' },
                              '&::-webkit-scrollbar-thumb': { background: 'rgba(0,0,0,0.12)', borderRadius: '24px' },
                            }}
                          >
                            {suggestedLocations.map((location, index) => {
                              const isSelected = selectedLocation === location.name
                              const isPartner = location.isPartner
                              const isNearest = location.name === nearestLocationName

                              const bothParitiesConfirmed = buyerMeetupConfirmed && sellerMeetupConfirmed
                              const isLocked = bothParitiesConfirmed && trade.meetup_location !== undefined

                              return (
                                <Box
                                  key={`location-${location.name}`}
                                  flexShrink={0}
                                  cursor={isLocked ? (isSelected ? 'default' : 'not-allowed') : 'pointer'}
                                  opacity={isLocked && !isSelected ? 0.5 : 1}
                                  borderWidth={isSelected ? '2px' : '1.5px'}
                                  borderColor={isPartner ? 'orange.400' : isSelected ? 'brand.500' : isNearest ? 'blue.300' : 'gray.200'}
                                  bg={isSelected ? 'brand.50' : isPartner ? partnerBg : isNearest ? nearestBg : 'white'}
                                  borderRadius="xl"
                                  px={3}
                                  py={2.5}
                                  minW="150px"
                                  maxW="210px"
                                  shadow="sm"
                                  onClick={() => {
                                    if (!isLocked) {
                                      setSelectedLocation(location.name)
                                    } else if (!isSelected) {
                                      toast({
                                        id: 'location-locked',
                                        title: 'Location Locked',
                                        description: `Both parties confirmed different locations. Click "Change My Selection" to modify your choice, or message them to negotiate.`,
                                        status: 'warning',
                                        duration: 3000,
                                        isClosable: true,
                                      })
                                    }
                                  }}
                                  transition="all 0.2s ease"
                                  _hover={{
                                    borderColor: isLocked ? undefined : (isPartner ? 'orange.500' : 'brand.400'),
                                    shadow: isLocked ? undefined : 'md',
                                  }}
                                >
                                  <VStack spacing={1} align="start">
                                    <HStack spacing={1.5}>
                                      <Icon
                                        as={isPartner ? FaStore : FaMapMarkerAlt}
                                        color={isPartner ? 'orange.500' : isSelected ? 'brand.500' : isNearest ? 'blue.500' : 'gray.400'}
                                        boxSize={3.5}
                                        flexShrink={0}
                                      />
                                      <Text fontWeight="semibold" fontSize="xs" noOfLines={1} color={locationTextColor}>
                                        {location.name}
                                      </Text>
                                    </HStack>
                                    <Text fontSize="2xs" color="gray.500" noOfLines={1} pl="22px">
                                      {location.address}
                                    </Text>
                                    <HStack spacing={1} pl="22px">
                                      <Badge
                                        colorScheme={location.type === 'cafe' ? 'orange' : location.type === 'mall' ? 'blue' : 'green'}
                                        variant="subtle"
                                        fontSize="2xs"
                                        px={1.5}
                                        py={0}
                                        borderRadius="full"
                                      >
                                        {location.type}
                                      </Badge>
                                      {isSelected && (
                                        <Icon as={FaCheckCircle} color="brand.500" boxSize={3} />
                                      )}
                                    </HStack>
                                  </VStack>
                                </Box>
                              )
                            })}
                          </HStack>
                        </Box>
                      ))}

                      {/* 1. SMART SUGGESTIONS PANEL - AT TOP */}
                      {showMeetupEditor && showSuggestionsPanel && (
                        <Box
                          p={3}
                          bg="gray.50"
                          borderRadius="md"
                          borderLeft="4px"
                          borderColor="gray.300"
                          mb={4}
                        >
                          <HStack justify="space-between" mb={2}>
                            <Text fontSize="sm" fontWeight="medium" color="gray.600">
                              =��� Suggested Alternative Times
                            </Text>
                            <Button
                              size="xs"
                              variant="ghost"
                              onClick={() => setShowSuggestionsPanel(false)}
                            >
                              G��
                            </Button>
                          </HStack>
                          <VStack align="stretch" spacing={2}>
                            {generateSmartSuggestions().map((suggestion, idx) => (
                              <Button
                                key={idx}
                                size="sm"
                                variant="outline"
                                colorScheme="blue"
                                justifyContent="flex-start"
                                onClick={() => {
                                  setSelectedDate(suggestion.date)
                                  setSelectedTime(suggestion.time)
                                  setShowSuggestionsPanel(false)
                                  // Scroll to time picker section
                                  setTimeout(() => {
                                    const pickerElement = document.querySelector('[data-meetup-picker]')
                                    if (pickerElement) {
                                      pickerElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
                                    }
                                  }, 100)
                                }}
                              >
                                {suggestion.label}
                              </Button>
                            ))}
                          </VStack>
                        </Box>
                      )}

                      {/* 2. LOCATION + TIME SELECTION */}
                      {showMeetupEditor && (
                      <Box>
                        {/* Product location context — shown when suggesting changes and multiple locations exist */}
                        {hasMeetupProposal && (trade?.items || []).filter(it => it.product_pickup_address).length >= 2 && (
                          <Box mb={3} p={2.5} bg={useColorModeValue('gray.50', 'gray.700')} borderRadius="md" borderWidth="1px" borderColor={borderColor}>
                            <Text fontSize="xs" fontWeight="700" color="gray.500" textTransform="uppercase" mb={1.5}>
                              Product Locations Involved
                            </Text>
                            <VStack align="stretch" spacing={1}>
                              {(trade?.items || []).filter(it => it.product_pickup_address).map((it) => (
                                <HStack key={it.id} spacing={2}>
                                  <Icon as={FaMapMarkerAlt} color="gray.400" boxSize={3} flexShrink={0} />
                                  <Text fontSize="xs" color="gray.600" noOfLines={1}>
                                    {it.product_title || `Product #${it.product_id}`} — {it.product_pickup_address}
                                  </Text>
                                </HStack>
                              ))}
                            </VStack>
                          </Box>
                        )}
                        <HStack justify="space-between" mb={2}>
                          <VStack align="start" spacing={0}>
                            <Text fontWeight="semibold" fontSize="md">
                              {isPickupTrade
                                ? (isUserBuyer ? 'Propose Pickup Time' : "Review Pickup Proposal")
                                : hasMeetupProposal ? 'Suggest a Different Meetup' : 'Schedule a Meetup'}
                            </Text>
                            <Text fontSize="sm" color="gray.600">
                              {isPickupTrade
                                ? (isUserBuyer
                                  ? 'You set the pickup date and time. The other trader can accept or propose a reschedule.'
                                  : 'The other trader picks a date and time. You can accept it or propose a reschedule.')
                                : hasMeetupProposal
                                  ? 'Adjust the location, date, or time and submit as a counter-proposal.'
                                  : 'Pick a date within the next 7 days and a time that works for both of you.'}
                            </Text>
                          </VStack>
                          {(selectedDate || selectedTime) && (
                            <Button
                              size="sm"
                              variant="ghost"
                              colorScheme="blue"
                              onClick={() => {
                                setSelectedDate(null)
                                setSelectedTime(null)
                                setValidationError(null)
                              }}
                            >
                              =��� Change
                            </Button>
                          )}
                        </HStack>

                        {isPickupTrade && isUserSeller && !buyerMeetupConfirmed && !sellerMeetupConfirmed ? (
                          // Pickup trade: one trader must wait for the other to propose a
                          // date/time before they can respond.
                          <Box
                            p={4}
                            bg="gray.50"
                            borderRadius="md"
                            borderWidth="1px"
                            borderColor="gray.200"
                          >
                            <VStack spacing={1} align="start">
                              <Text fontWeight="semibold" color="gray.700">
                                ⏳ Waiting for the other trader to propose a pickup time
                              </Text>
                              <Text fontSize="sm" color="gray.600">
                                The other trader chooses when to come by. You'll be able to accept their proposal or suggest a different time once it's submitted.
                              </Text>
                            </VStack>
                          </Box>
                        ) : (isUserBuyer && buyerMeetupConfirmed) || (isUserSeller && sellerMeetupConfirmed) ? (
                          // LOCKED STATE - Compact Display
                          <Box
                            p={4}
                            bg="white"
                            borderRadius="xl"
                            borderWidth="1.5px"
                            borderColor="green.300"
                            shadow="sm"
                          >
                            <HStack spacing={3} mb={3}>
                              <Box p={2} bg="green.100" borderRadius="full">
                                <Icon as={FaCheckCircle} color="green.500" boxSize={4} />
                              </Box>
                              <VStack align="start" spacing={0}>
                                <Text fontWeight="bold" fontSize="sm" color="green.700">Your Selection Locked</Text>
                                <Text fontSize="xs" color="gray.500">Waiting for the other party</Text>
                              </VStack>
                            </HStack>
                            <VStack spacing={2} align="stretch">
                              <HStack spacing={2} p={2} bg="gray.50" borderRadius="lg">
                                <Icon as={FaMapMarkerAlt} color="brand.400" boxSize={3.5} flexShrink={0} />
                                <Text fontSize="sm" color="gray.700" fontWeight="medium" noOfLines={1}>{isUserBuyer ? buyerMeetupLocation : sellerMeetupLocation}</Text>
                              </HStack>
                              <HStack spacing={3}>
                                <HStack spacing={1.5} flex={1} p={2} bg="gray.50" borderRadius="lg">
                                  <Icon as={FaCalendarAlt} color="blue.400" boxSize={3} flexShrink={0} />
                                  <Text fontSize="xs" color="gray.600">{formatDateLabel((isUserBuyer ? buyerMeetupDate : sellerMeetupDate)!)}</Text>
                                </HStack>
                                <HStack spacing={1.5} flex={1} p={2} bg="gray.50" borderRadius="lg">
                                  <Icon as={FaClock} color="purple.400" boxSize={3} flexShrink={0} />
                                  <Text fontSize="xs" color="gray.600">{formatTimePH((isUserBuyer ? buyerMeetupTime : sellerMeetupTime)!)}</Text>
                                </HStack>
                              </HStack>
                            </VStack>
                          </Box>
                        ) : (
                          // UNLOCKED STATE - Full Selection Interface
                          <VStack spacing={4} align="stretch" data-meetup-picker>
                            {/* Validation Error Message */}
                            {validationError && (
                              <Box
                                p={3}
                                bg="red.50"
                                borderRadius="md"
                                borderLeft="4px"
                                borderColor="red.500"
                              >
                                <Text fontSize="sm" color="red.700">
                                  {validationError}
                                </Text>
                              </Box>
                            )}

                            {/* Date Selection - Next 7 Days */}
                            <Box>
                              <Text fontSize="sm" fontWeight="medium" mb={2}>
                                Select Date
                              </Text>
                              <HStack
                                spacing={2}
                                overflowX="auto"
                                flexWrap="nowrap"
                                pb={1}
                                css={{
                                  '&::-webkit-scrollbar': { height: '3px' },
                                  '&::-webkit-scrollbar-thumb': { background: 'rgba(0,0,0,0.12)', borderRadius: '24px' },
                                }}
                              >
                                {getNext7Days().map((dateStr) => (
                                  <Button
                                    key={dateStr}
                                    size="sm"
                                    flexShrink={0}
                                    variant={selectedDate === dateStr ? 'solid' : 'outline'}
                                    colorScheme={selectedDate === dateStr ? 'brand' : 'gray'}
                                    onClick={() => {
                                      setSelectedDate(dateStr)
                                      setSelectedTime(null)
                                      setValidationError(null)
                                    }}
                                    fontWeight="medium"
                                    px={3}
                                    borderRadius="full"
                                  >
                                    {formatDateLabel(dateStr)}
                                  </Button>
                                ))}
                              </HStack>
                            </Box>

                            {/* Time Selection - Dynamic slots based on selected date */}
                            <Box>
                              <Text fontSize="sm" fontWeight="medium" mb={2}>
                                Select Time
                              </Text>
                              {selectedDate ? (
                                <VStack align="start" spacing={2}>
                                  <SimpleGrid columns={[3, 4, 5]} spacing={1.5} w="full">
                                    {generateTimeSlots(selectedDate).map((time) => (
                                      <Button
                                        key={time}
                                        size="xs"
                                        variant={selectedTime === time ? 'solid' : 'outline'}
                                        colorScheme={selectedTime === time ? 'brand' : 'gray'}
                                        onClick={() => {
                                          setSelectedTime(time)
                                          setValidationError(null)
                                        }}
                                        fontWeight="medium"
                                        fontSize="xs"
                                        borderRadius="full"
                                        px={2}
                                      >
                                        {formatTimePH(time)}
                                      </Button>
                                    ))}
                                  </SimpleGrid>
                                  {generateTimeSlots(selectedDate).length === 0 && (
                                    <Text fontSize="xs" color="orange.600">
                                      No available times remaining today. Please select tomorrow or a later date.
                                    </Text>
                                  )}
                                </VStack>
                              ) : (
                                <Text fontSize="sm" color="gray.500">
                                  Select a date first to see available times
                                </Text>
                              )}
                            </Box>

                            {/* Confirm Button - Always visible below time selection */}
                            <Button
                              colorScheme="green"
                              size="lg"
                              onClick={confirmMeetup}
                              isLoading={confirmingMeetup}
                              isDisabled={!selectedLocation || !selectedDate || !selectedTime}
                              leftIcon={<FaCheckCircle />}
                              w="full"
                              fontWeight="semibold"
                              mt={3}
                              _hover={{ transform: 'translateY(-2px)', shadow: 'lg' }}
                              transition="all 0.2s"
                            >
                              Confirm Meetup
                            </Button>
                          </VStack>
                        )}
                      </Box>
                      )}

                      <>
                        <Box mt={4}>
                          {/* Smart Suggestions Panel */}
                          {showMeetupEditor && showSuggestionsPanel && (
                            <Box
                              p={3}
                              bg="gray.50"
                              borderRadius="md"
                              borderLeft="4px"
                              borderColor="gray.300"
                              mb={4}
                            >
                              <HStack justify="space-between" mb={2}>
                                <Text fontSize="sm" fontWeight="medium" color="gray.600">
                                  =��� Suggested Alternative Times
                                </Text>
                                <Button
                                  size="xs"
                                  variant="ghost"
                                  onClick={() => setShowSuggestionsPanel(false)}
                                >
                                  G��
                                </Button>
                              </HStack>
                              <VStack align="stretch" spacing={2}>
                                {generateSmartSuggestions().map((suggestion, idx) => (
                                  <Button
                                    key={idx}
                                    size="sm"
                                    variant="outline"
                                    colorScheme="blue"
                                    justifyContent="flex-start"
                                    onClick={() => {
                                      setSelectedDate(suggestion.date)
                                      setSelectedTime(suggestion.time)
                                      setShowSuggestionsPanel(false)
                                      // Scroll to time picker section
                                      setTimeout(() => {
                                        const pickerElement = document.querySelector('[data-meetup-picker]')
                                        if (pickerElement) {
                                          pickerElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
                                        }
                                      }, 100)
                                    }}
                                  >
                                    {suggestion.label}
                                  </Button>
                                ))}
                              </VStack>
                            </Box>
                          )}

                          {/* Dispute Dialog */}
                          <AlertDialog
                            isOpen={showDisputeDialog}
                            onClose={() => setShowDisputeDialog(false)}
                            leastDestructiveRef={cancelDialogRef}
                            isCentered
                          >
                            <AlertDialogOverlay>
                              <AlertDialogContent>
                                <AlertDialogHeader fontSize="lg" fontWeight="bold">
                                  Report Meetup Issue
                                </AlertDialogHeader>
                                <AlertDialogBody>
                                  <VStack spacing={4} align="stretch">
                                    <Text fontSize="sm" color="gray.600">
                                      What's the problem with the scheduled time?
                                    </Text>
                                    <VStack spacing={2}>
                                      <Button
                                        variant={meetupDisputeReason === 'time' ? 'solid' : 'outline'}
                                        colorScheme="orange"
                                        justifyContent="flex-start"
                                        onClick={() => setMeetupDisputeReason('time')}
                                      >
                                        GŦ The time doesn't work for me
                                      </Button>
                                      <Button
                                        variant={meetupDisputeReason === 'date' ? 'solid' : 'outline'}
                                        colorScheme="orange"
                                        justifyContent="flex-start"
                                        onClick={() => setMeetupDisputeReason('date')}
                                      >
                                        =��� The date is inconvenient
                                      </Button>
                                      <Button
                                        variant={meetupDisputeReason === 'unresponsive' ? 'solid' : 'outline'}
                                        colorScheme="orange"
                                        justifyContent="flex-start"
                                        onClick={() => setMeetupDisputeReason('unresponsive')}
                                      >
                                        =��� Other person is unresponsive
                                      </Button>
                                      <Button
                                        variant={meetupDisputeReason === 'conflict' ? 'solid' : 'outline'}
                                        colorScheme="orange"
                                        justifyContent="flex-start"
                                        onClick={() => setMeetupDisputeReason('conflict')}
                                      >
                                        G�� Schedule conflict
                                      </Button>
                                    </VStack>
                                    <FormControl>
                                      <FormLabel fontSize="sm">Additional notes (optional)</FormLabel>
                                      <Textarea
                                        placeholder="Explain your concern..."
                                        value={disputeNotes}
                                        onChange={(e) => setDisputeNotes(e.target.value)}
                                        size="sm"
                                        minH="80px"
                                      />
                                    </FormControl>
                                  </VStack>
                                </AlertDialogBody>
                                <AlertDialogFooter>
                                  <Button
                                    ref={cancelDialogRef}
                                    onClick={() => setShowDisputeDialog(false)}
                                  >
                                    Cancel
                                  </Button>
                                  <Button
                                    colorScheme="orange"
                                    onClick={handleRaiseDispute}
                                    ml={3}
                                  >
                                    Report Issue
                                  </Button>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialogOverlay>
                          </AlertDialog>
                        </Box>

                        {!isPickupTrade && <Divider />}
                        <Box
                          p={isPickupTrade ? 0 : [2, 3]}
                          bg={isPickupTrade ? 'transparent' : meetupInfoBg}
                          borderRadius="lg"
                          borderWidth={isPickupTrade ? 0 : '1px'}
                          borderColor="gray.200"
                        >
                          <VStack spacing={[2, 3]} align="stretch">
                            {/* Header */}
                            {!isPickupTrade && <HStack justify="center" spacing={2} py={[1, 2]}>
                              <Icon as={FaHandshake} color="brand.500" boxSize={4} />
                              <Text fontWeight="bold" fontSize={["sm", "md"]} color="gray.700">
                                Meetup Agreement
                              </Text>
                            </HStack>}

                            {/* Simple Status Display */}
                            {!buyerMeetupConfirmed && !sellerMeetupConfirmed ? (
                              // Neither has submitted
                              <VStack spacing={[2, 2.5]} align="stretch">
                                <Box textAlign="center" py={1}>
                                  <Text fontSize={["xs", "sm"]} color="gray.600">
                                    Use the Confirm button above to submit your selections.
                                  </Text>
                                </Box>
                              </VStack>
                            ) : buyerMeetupConfirmed && sellerMeetupConfirmed ? (
                              // Both submitted - check if they match
                              meetupSelectionMatches ? (
                                isPickupTrade ? (() => {
                                  const pickupDistanceLabel = trackingDistanceLabel
                                  const pickupEtaLabel = trackingEtaLabel
                                  const pickupLocationLabel = pickupDisplayAddress || buyerMeetupLocation || 'Pickup location'
                                  const pickupCountdownLabel = formatArrivalCountdown(agreedArrivalDeadline, arrivalClockNow, 'Pickup')
                                  const pickupTrustWarning = isUserBuyer && (userWasLate || userIsPastGrace) && !buyerMetConfirmed
                                    ? 'Please confirm when you arrive. Very late pickups may affect trust status.'
                                    : null
                                  const pickupWithinRadius = meetupLocationVerified
                                  const pickupStage = bothMetConfirmed
                                    ? 5
                                    : sellerMetConfirmed
                                      ? 5
                                      : buyerMetConfirmed
                                        ? (isUserBuyer ? 3 : 4)
                                        : meetupAgreed
                                          ? 2
                                          : 1
                                  const pickupStageLabel = pickupStage === 5
                                    ? 'Pickup completed'
                                    : pickupStage === 4
                                      ? 'Waiting for the other trader'
                                      : pickupStage === 3
                                        ? 'Arrival confirmed'
                                        : pickupStage === 2
                                          ? 'On the way to pickup'
                                          : 'Pickup agreed'
                                  const pickupStatusText = bothMetConfirmed || sellerMetConfirmed
                                    ? 'Pickup completed'
                                    : buyerMetConfirmed
                                      ? 'Arrival is confirmed. Please confirm once you have met.'
                                      : pickupMapMissing
                                        ? 'This pickup location has no map pin yet. Ask the product owner to update the location before confirmation.'
                                        : isUserBuyer
                                          ? (geoMessage || 'You can confirm once you arrive at the pickup location.')
                                          : 'Waiting for the other trader to arrive first.'
                                  const pickupConfirmDisabled = isUserBuyer
                                    ? buyerMetConfirmed || pickupMapMissing || geoPermissionDenied || !pickupWithinRadius
                                    : sellerMetConfirmed || !buyerMetConfirmed
                                  const pickupConfirmReason = isUserBuyer
                                    ? buyerMetConfirmed
                                      ? 'Arrival already confirmed.'
                                      : pickupMapMissing
                                        ? 'Pickup map pin is missing.'
                                        : geoPermissionDenied || !userGeoPoint
                                          ? 'Enable location to view ETA and route.'
                                          : !pickupWithinRadius
                                            ? 'Confirm unlocks near the pickup location.'
                                            : ''
                                    : !buyerMetConfirmed
                                      ? 'Waiting for buyer arrival confirmation.'
                                      : sellerMetConfirmed
                                        ? 'Pickup already confirmed.'
                                        : ''
                                  const showHalfDetails = trackingSheetSnap !== 'collapsed'
                                  const showFullDetails = trackingSheetSnap === 'full'
                                  return (
                                    <VStack spacing={3} align="stretch">
                                      <Box p={3} bg="white" borderRadius="xl" borderWidth="1px" borderColor="green.200" shadow="sm">
                                        <HStack justify="space-between" align="start" spacing={3}>
                                          <VStack align="start" spacing={1} flex={1}>
                                            <HStack spacing={2} flexWrap="wrap">
                                              <Badge colorScheme="green" borderRadius="full" px={2}>Agreed</Badge>
                                            </HStack>
                                            <Text fontWeight="800" color="gray.800" fontSize="sm">You're all set</Text>
                                            <Text fontSize="xs" color="gray.600" noOfLines={2}>{pickupLocationLabel}</Text>
                                          </VStack>
                                          <Button size="xs" variant="ghost" colorScheme="green" onClick={openGoogleMapsDirections} isDisabled={!pickupPoint}>
                                            Open in Google Maps
                                          </Button>
                                        </HStack>
                                        <HStack spacing={2} mt={3} flexWrap="wrap">
                                          <Badge colorScheme={pickupWithinRadius ? 'green' : 'orange'} borderRadius="full" px={2} py={1}>{pickupDistanceLabel}</Badge>
                                          <Badge colorScheme="teal" borderRadius="full" px={2} py={1}>{pickupEtaLabel}</Badge>
                                          <Badge colorScheme={(isUserBuyer && userIsPastGrace) || userWasLate ? 'red' : 'green'} borderRadius="full" px={2} py={1}>{pickupCountdownLabel}</Badge>
                                        </HStack>
                                        {!userGeoPoint && (
                                          <Text fontSize="xs" color="gray.600" mt={2}>Enable location to view ETA and route.</Text>
                                        )}
                                      </Box>

                                      {showHalfDetails && (
                                      <SimpleGrid columns={[1, 2]} spacing={2}>
                                        <Box p={2.5} bg="gray.50" borderRadius="lg" borderWidth="1px" borderColor="gray.200">
                                          <Text fontSize="2xs" fontWeight="900" color="gray.500" textTransform="uppercase">Date</Text>
                                          <Text fontSize="sm" fontWeight="700" color="gray.800">{buyerMeetupDate ? formatDateLabel(buyerMeetupDate) : 'Date not set'}</Text>
                                        </Box>
                                        <Box p={2.5} bg="gray.50" borderRadius="lg" borderWidth="1px" borderColor="gray.200">
                                          <Text fontSize="2xs" fontWeight="900" color="gray.500" textTransform="uppercase">Time</Text>
                                          <Text fontSize="sm" fontWeight="700" color="gray.800">{buyerMeetupTime ? formatTimePH(buyerMeetupTime) : 'Time not set'}</Text>
                                        </Box>
                                      </SimpleGrid>
                                      )}

                                      {showHalfDetails && (
                                      <Box p={3} bg={pickupWithinRadius || buyerMetConfirmed ? 'green.50' : 'gray.50'} borderRadius="xl" borderWidth="1px" borderColor={pickupWithinRadius || buyerMetConfirmed ? 'green.200' : 'gray.200'}>
                                        <VStack spacing={2} align="stretch">
                                          <Text fontSize="2xs" fontWeight="900" color="gray.500" textTransform="uppercase">Arrival Status</Text>
                                          <HStack justify="space-between" align="center">
                                            <Text fontSize="xs" fontWeight="800" color="gray.700">Stage {pickupStage} of 5</Text>
                                            {buyerMetConfirmed && <Badge colorScheme="green" borderRadius="full">User B confirmed</Badge>}
                                          </HStack>
                                          <Progress value={(pickupStage / 5) * 100} colorScheme="green" borderRadius="full" size="sm" />
                                          <Text fontSize="xs" fontWeight="800" color="gray.600">{pickupStageLabel}</Text>
                                          <HStack spacing={2} flexWrap="wrap">
                                            <Badge colorScheme={(isUserBuyer && userIsPastGrace) || userWasLate ? 'red' : 'green'} borderRadius="full">{pickupCountdownLabel}</Badge>
                                            <Badge colorScheme={pickupWithinRadius ? 'green' : 'orange'} borderRadius="full">Unlocks within {MEETUP_CONFIRM_RADIUS_M}m</Badge>
                                            {userGeoPoint && (
                                              <Badge colorScheme={userGeoPoint.accuracy <= MAX_GPS_ACCURACY_M ? 'green' : 'orange'} borderRadius="full">
                                                GPS +/-{Math.round(userGeoPoint.accuracy)}m
                                              </Badge>
                                            )}
                                          </HStack>
                                          <Text fontSize="sm" fontWeight="700" color={pickupWithinRadius || buyerMetConfirmed ? 'green.700' : 'gray.700'}>{pickupStatusText}</Text>
                                          {isUserBuyer && meetupDistanceM !== null && !pickupWithinRadius && (
                                            <Text fontSize="xs" color="gray.600">You can confirm once you arrive at the pickup location.</Text>
                                          )}
                                          {pickupConfirmDisabled && pickupConfirmReason && (
                                            <Text fontSize="xs" color="gray.600">{pickupConfirmReason}</Text>
                                          )}
                                          {geoPermissionDenied && (
                                            <Button size="sm" variant="outline" colorScheme="green" onClick={checkMeetupLocation} isLoading={geoChecking}>
                                              Retry location access
                                            </Button>
                                          )}
                                          {pickupTrustWarning && (
                                            <Text fontSize="xs" color="red.600" fontWeight="700">{pickupTrustWarning}</Text>
                                          )}
                                          {showFullDetails && (
                                            <Text fontSize="2xs" color="gray.500">Your live location is only used to confirm arrival. Please try to arrive on time so the trade stays smooth for both of you.</Text>
                                          )}
                                        </VStack>
                                      </Box>
                                      )}

                                      {showHalfDetails && (!bothMetConfirmed && !sellerMetConfirmed ? (
                                        <Box position="sticky" bottom={0} bg={meetupInfoBg} pt={2} pb={1} zIndex={2}>
                                          <Button
                                            colorScheme="green"
                                            size="lg"
                                            onClick={confirmMeetupDone}
                                            isLoading={confirmingMeetupDone || (isUserBuyer && geoChecking)}
                                            leftIcon={<FaCheckCircle />}
                                            w="full"
                                            minH="52px"
                                            borderRadius="xl"
                                            isDisabled={pickupConfirmDisabled}
                                          >
                                            {isUserBuyer
                                              ? (buyerMetConfirmed ? 'Arrival Confirmed' : 'Confirm Pickup')
                                              : (sellerMetConfirmed ? 'Confirmed' : 'Confirm Pickup')}
                                          </Button>
                                        </Box>
                                      ) : (
                                        <Button
                                          colorScheme="green"
                                          size={["sm", "md"]}
                                          onClick={handleInstantComplete}
                                          isLoading={completingTrade}
                                          loadingText="Completing..."
                                          leftIcon={<FaCheckCircle />}
                                          w="full"
                                        >
                                          Leave a Review and Complete Trade
                                        </Button>
                                      ))}
                                    </VStack>
                                  )
                                })() : (
                                // MATCH - Success!
                                <VStack spacing={[2, 3]} align="stretch">
                                  <Box
                                    p={[3, 4]}
                                    bg="white"
                                    borderRadius="xl"
                                    borderWidth="1.5px"
                                    borderColor="green.400"
                                    shadow="sm"
                                  >
                                    <HStack spacing={3} mb={3}>
                                      <Box p={2.5} bg="green.100" borderRadius="full">
                                        <Icon as={FaCheckCircle} color="green.500" boxSize={5} />
                                      </Box>
                                      <VStack align="start" spacing={0}>
                                        <Text fontWeight="bold" color="green.700" fontSize={["sm", "md"]}>
                                          You Both Agreed!
                                        </Text>
                                        <Text fontSize="xs" color="green.500">Meetup confirmed — proceed below</Text>
                                      </VStack>
                                    </HStack>
                                    <VStack spacing={2} align="stretch">
                                      <HStack spacing={2} p={2} bg="gray.50" borderRadius="lg">
                                        <Icon as={FaMapMarkerAlt} color="brand.400" boxSize={3.5} flexShrink={0} />
                                        <Text fontSize="sm" color="gray.700" fontWeight="medium" noOfLines={1}>{buyerMeetupLocation}</Text>
                                      </HStack>
                                      <HStack spacing={3}>
                                        <HStack spacing={1.5} flex={1} p={2} bg="gray.50" borderRadius="lg">
                                          <Icon as={FaCalendarAlt} color="blue.400" boxSize={3} flexShrink={0} />
                                          <Text fontSize="xs" color="gray.600">{formatDateLabel(buyerMeetupDate!)}</Text>
                                        </HStack>
                                        <HStack spacing={1.5} flex={1} p={2} bg="gray.50" borderRadius="lg">
                                          <Icon as={FaClock} color="purple.400" boxSize={3} flexShrink={0} />
                                          <Text fontSize="xs" color="gray.600">{formatTimePH(buyerMeetupTime)}</Text>
                                        </HStack>
                                      </HStack>
                                    </VStack>
                                  </Box>

                                  {!bothMetConfirmed ? (
                                    <VStack align="stretch" spacing={[2, 2.5]}>
                                      <Box
                                        p={[2, 2.5]}
                                        bg={meetupInfoBg}
                                        borderLeft="4px"
                                        borderColor="brand.500"
                                        borderRadius="md"
                                      >
                                        <Text fontSize={["xs", "sm"]} color={meetupInfoTextColor} fontWeight="medium">
                                          Current Stage: Confirm you met at {buyerMeetupLocation} at {formatTimePH(buyerMeetupTime)}
                                        </Text>
                                      </Box>

                                      <Box p={3} bg="gray.50" borderWidth="1px" borderColor="gray.200" borderRadius="md">
                                        <HStack justify="space-between" align="start" mb={2}>
                                          <VStack align="start" spacing={0}>
                                            <Text fontSize="xs" fontWeight="700" color="gray.700">Meetup Location</Text>
                                            <Text fontSize="xs" color="gray.600">You are heading to the agreed meetup point.</Text>
                                            <Text fontSize="xs" color="gray.600">Both users must meet at this same location.</Text>
                                            <Text fontSize="xs" color="gray.800" fontWeight="700" noOfLines={1}>{meetupDisplayLabel}</Text>
                                            <Text fontSize="xs" color={meetupLocationVerified ? 'green.600' : 'orange.600'}>
                                              {geoMessage || (meetupPoint ? 'Check your GPS location before confirming.' : 'Meetup location has not been set yet.')}
                                            </Text>
                                            {meetupDistanceM !== null && (
                                              <Text fontSize="2xs" color="gray.500">
                                                Distance: {Math.round(meetupDistanceM)}m · Accuracy: ±{Math.round(userGeoPoint?.accuracy || 0)}m
                                              </Text>
                                            )}
                                          </VStack>
                                          <VStack spacing={1} align="stretch">
                                            <Button size="xs" variant="outline" colorScheme="blue" onClick={checkMeetupLocation} isLoading={geoChecking}>
                                              Check Location
                                            </Button>
                                            <Button size="xs" colorScheme="green" onClick={openGoogleMapsDirections}>
                                              Open in Google Maps
                                            </Button>
                                          </VStack>
                                        </HStack>
                                        {meetupPoint && (
                                          <Box h="190px" borderRadius="md" overflow="hidden" borderWidth="1px" borderColor="gray.200">
                                            <MapContainer center={[meetupPoint.lat, meetupPoint.lng]} zoom={17} style={{ height: '100%', width: '100%' }} scrollWheelZoom={false}>
                                              <ModalMapFix />
                                              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                                              <Circle center={[meetupPoint.lat, meetupPoint.lng]} radius={MEETUP_CONFIRM_RADIUS_M} pathOptions={{ color: '#16A34A', fillColor: '#BBF7D0', fillOpacity: 0.25 }} />
                                              {userGeoPoint && (
                                                <Polyline positions={[[userGeoPoint.lat, userGeoPoint.lng], [meetupPoint.lat, meetupPoint.lng]]} pathOptions={{ color: '#2563EB', weight: 4, opacity: 0.8 }} />
                                              )}
                                              <Marker position={[meetupPoint.lat, meetupPoint.lng]}>
                                                <Popup>Meetup point</Popup>
                                              </Marker>
                                              {userGeoPoint && (
                                                <Marker position={[userGeoPoint.lat, userGeoPoint.lng]}>
                                                  <Popup>Your current location</Popup>
                                                </Marker>
                                              )}
                                            </MapContainer>
                                          </Box>
                                        )}
                                        {!userGeoPoint && meetupPoint && (
                                          <Text fontSize="xs" color="gray.500" mt={2}>
                                            Allow location access to see your route.
                                          </Text>
                                        )}
                                        <Box mt={3} p={3} bg="white" borderRadius="lg" borderWidth="1px" borderColor="gray.200">
                                          <VStack spacing={2} align="stretch">
                                            <Text fontSize="2xs" fontWeight="900" color="gray.500" textTransform="uppercase">Arrival Status</Text>
                                            <HStack spacing={2} flexWrap="wrap">
                                              <Badge colorScheme={userIsPastGrace || userWasLate ? 'red' : 'green'} borderRadius="full">
                                                {formatArrivalCountdown(agreedArrivalDeadline, arrivalClockNow, 'Meetup')}
                                              </Badge>
                                              <Badge colorScheme={meetupLocationVerified ? 'green' : 'orange'} borderRadius="full">
                                                Unlocks within {MEETUP_CONFIRM_RADIUS_M}m
                                              </Badge>
                                              {userGeoPoint && (
                                                <Badge colorScheme={userGeoPoint.accuracy <= MAX_GPS_ACCURACY_M ? 'green' : 'orange'} borderRadius="full">
                                                  GPS +/-{Math.round(userGeoPoint.accuracy)}m
                                                </Badge>
                                              )}
                                            </HStack>
                                            <Text fontSize="xs" color={meetupLocationVerified ? 'green.700' : 'gray.700'} fontWeight="700">
                                              {userGeoPoint?.accuracy && userGeoPoint.accuracy > MAX_GPS_ACCURACY_M
                                                ? 'Waiting for a more accurate location...'
                                                : meetupDistanceM !== null
                                                  ? getDistanceStatusMessage(meetupDistanceM, 'meetup point')
                                                  : 'Check your GPS location before confirming.'}
                                            </Text>
                                            {userArrivedAt && (
                                              <Text fontSize="2xs" color="gray.500">
                                                Arrival confirmed {new Date(userArrivedAt).toLocaleString()}
                                              </Text>
                                            )}
                                            {(userWasLate || (userIsPastGrace && !userMetConfirmed)) && (
                                              <Text fontSize="xs" color="red.600" fontWeight="700">
                                                Late arrival may reduce trust score for the late user only.
                                              </Text>
                                            )}
                                          </VStack>
                                        </Box>
                                      </Box>

                                      <Button
                                        colorScheme="green"
                                        size={["sm", "md"]}
                                        onClick={confirmMeetupDone}
                                        isLoading={confirmingMeetupDone || geoChecking}
                                        leftIcon={<FaCheckCircle />}
                                        w="full"
                                        isDisabled={userMetConfirmed || !meetupLocationVerified}
                                      >
                                        {userMetConfirmed ? 'Confirmed' : 'Confirm You Met'}
                                      </Button>

                                      {userMetConfirmed && (
                                        <Text fontSize="xs" color="gray.600" textAlign="center">
                                          Waiting for the other party to confirm.
                                        </Text>
                                      )}
                                    </VStack>
                                  ) : (
                                    <Button
                                      colorScheme="green"
                                      size={["sm", "md"]}
                                      onClick={handleInstantComplete}
                                      isLoading={completingTrade}
                                      loadingText="Completing..."
                                      leftIcon={<FaCheckCircle />}
                                      w="full"
                                      transition="all 0.2s"
                                      _hover={{ transform: 'translateY(-2px)', shadow: 'lg' }}
                                    >
                                      Leave a Review and Complete Trade
                                    </Button>
                                  )}
                                </VStack>
                              )) : (
                                // NO MATCH - Need to coordinate
                                <VStack spacing={[2, 2.5]}>
                                  <Box
                                    p={[3, 4]}
                                    bg="white"
                                    borderRadius="xl"
                                    borderWidth="1.5px"
                                    borderColor="orange.300"
                                    shadow="sm"
                                    w="full"
                                  >
                                    <HStack spacing={3} mb={3}>
                                      <Box p={2} bg="orange.100" borderRadius="full">
                                        <Icon as={FaExclamationTriangle} color="orange.500" boxSize={4} />
                                      </Box>
                                      <VStack align="start" spacing={0}>
                                        <Text fontWeight="bold" color="orange.700" fontSize={["xs", "sm"]}>
                                          Different Selections
                                        </Text>
                                        <Text fontSize="xs" color="gray.500">
                                          Chat to agree, then both resubmit
                                        </Text>
                                      </VStack>
                                    </HStack>

                                    {/* Show both selections */}
                                    <VStack spacing={2} align="stretch">
                                      <Box p={2.5} bg="gray.50" borderRadius="lg" borderLeftWidth="3px" borderColor={isUserBuyer ? 'brand.400' : 'gray.300'}>
                                        <Text fontSize="2xs" fontWeight="bold" color="gray.400" textTransform="uppercase" mb={0.5}>
                                          {isUserBuyer ? 'Your pick' : `${trade.buyer_name}'s pick`}
                                        </Text>
                                        <Text fontSize="sm" fontWeight="medium" color="gray.700" noOfLines={1}>{buyerMeetupLocation}</Text>
                                        <Text fontSize="xs" color="gray.500">{formatTimePH(buyerMeetupTime)}</Text>
                                      </Box>
                                      <Box p={2.5} bg="gray.50" borderRadius="lg" borderLeftWidth="3px" borderColor={isUserSeller ? 'brand.400' : 'gray.300'}>
                                        <Text fontSize="2xs" fontWeight="bold" color="gray.400" textTransform="uppercase" mb={0.5}>
                                          {isUserSeller ? 'Your pick' : `${trade.seller_name}'s pick`}
                                        </Text>
                                        <Text fontSize="sm" fontWeight="medium" color="gray.700" noOfLines={1}>{sellerMeetupLocation}</Text>
                                        <Text fontSize="xs" color="gray.500">{formatTimePH(sellerMeetupTime)}</Text>
                                      </Box>
                                    </VStack>
                                  </Box>
                                </VStack>
                              )
                            ) : (
                              // One submitted — the proposal card above already shows this; nothing extra needed here
                              null
                            )}
                          </VStack>
                        </Box>
                      </>

                      {/* Change Selection Button - Only show when mismatch */}
                      {buyerMeetupConfirmed && sellerMeetupConfirmed &&
                        !meetupSelectionMatches && (
                          <Button
                            colorScheme="orange"
                            variant="outline"
                            size="md"
                            onClick={resetMeetupSelection}
                            isLoading={resettingMeetup}
                            leftIcon={<Icon as={FaExclamationTriangle} />}
                            w="full"
                          >
                            Change My Selection
                          </Button>
                        )}
                          </VStack>
                        </Box>
                      </MotionBox>
                    </Box>
                  )}
                </TabPanel>
              </TabPanels>
            </Tabs>
          </ModalBody>
        </ModalContent>
      </Modal>



      {/* Cancel Trade Confirmation Dialog */}
      <AlertDialog
        isOpen={showCancelDialog}
        leastDestructiveRef={cancelDialogRef}
        onClose={() => setShowCancelDialog(false)}
        isCentered
      >
        <AlertDialogOverlay>
          <AlertDialogContent bg={cardBg} borderRadius={["md", "lg"]}>
            <AlertDialogHeader fontSize="lg" fontWeight="600">
              <HStack spacing={2}>
                <Icon as={FaExclamationTriangle} color="red.500" boxSize={5} />
                <Text>Cancel This Trade?</Text>
              </HStack>
            </AlertDialogHeader>

            <AlertDialogBody>
              <VStack spacing={3} align="start">
                <Text>
                  Are you sure you want to cancel this trade?
                </Text>
                <Box
                  p={3}
                  bg="red.50"
                  borderRadius="md"
                  borderLeft="4px"
                  borderColor="red.500"
                >
                  <Text fontSize="sm" fontWeight="medium" color="red.800">
                    G��n+� Warning: Cancelling this trade will negatively affect your trust score.
                  </Text>
                </Box>
                <Text fontSize="sm" color="gray.600">
                  Product: <Text as="span" fontWeight="600">{requestedProduct?.title || 'Unknown Product'}</Text>
                </Text>
                <Text fontSize="sm" color="gray.600">
                  With: <Text as="span" fontWeight="600">{tradingPartner}</Text>
                </Text>
              </VStack>
            </AlertDialogBody>

            <AlertDialogFooter pt={4}>
              <HStack spacing={2} w="full">
                <Button
                  ref={cancelDialogRef}
                  onClick={() => setShowCancelDialog(false)}
                  variant="ghost"
                  flex={1}
                >
                  Keep Trade Active
                </Button>
                <Button
                  colorScheme="red"
                  onClick={handleCancelTrade}
                  isLoading={cancelingTrade}
                  flex={1}
                >
                  Yes, Cancel Trade
                </Button>
              </HStack>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialogOverlay>
      </AlertDialog>



      {/* Review Modal */}
      <Modal isOpen={isReviewModalOpen} onClose={() => setIsReviewModalOpen(false)} size={["xs", "sm", "md"]} isCentered scrollBehavior="inside">
        <ModalOverlay bg="blackAlpha.600" backdropFilter="blur(4px)" />
        <ModalContent bg={cardBg} borderRadius={["md", "lg", "xl"]} boxShadow="xl" maxW={["90vw", "500px"]} mx={[2, 4]}>
          <ModalHeader>
            <HStack spacing={2} fontSize={["sm", "md"]}>
              <Icon as={FaStar} color="yellow.400" />
              <Text>Trade Review & Completion</Text>
            </HStack>
          </ModalHeader>
          <ModalCloseButton />
          <ModalBody py={[4, 6]} px={[3, 6]}>
            <ReviewTab
              trade={trade}
              isUserBuyer={isUserBuyer ?? false}
              isUserSeller={isUserSeller ?? false}
              user={user}
              onStatusUpdate={() => {
                onStatusUpdate()
                // Keep modal open so user can see completion status
              }}
            />
          </ModalBody>
        </ModalContent>
      </Modal>
    </>
  )
}

export default ViewTradeModal
