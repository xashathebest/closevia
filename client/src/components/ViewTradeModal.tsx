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
import { FaMapMarkerAlt, FaCheckCircle, FaClock, FaCalendarAlt, FaHandshake, FaPaperPlane, FaTruck, FaStar, FaStore, FaExclamationTriangle, FaCheck, FaTimesCircle, FaLightbulb, FaInfoCircle } from 'react-icons/fa'
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
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'

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
            <Box key={step.id} flex={1} display="flex" flexDirection="column" alignItems="center" position="relative" zIndex={index + 1}>
              {/* Step Circle */}
              <Box
                w="36px"
                h="36px"
                borderRadius="full"
                bg={stepBg}
                color="white"
                display="flex"
                alignItems="center"
                justifyContent="center"
                transition="all 0.3s cubic-bezier(0.4, 0, 0.2, 1)"
                boxShadow={status === 'active' ? `0 0 0 3px ${activeRingColor}` : 'none'}
                flexShrink={0}
              >
                <Icon as={step.icon} boxSize="4" />
              </Box>

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
            </Box>
          )
        })}

        {/* Connecting Lines - Centered */}
        <Box position="absolute" top="50%" transform="translateY(-50%)" left="0" right="0" h="1.5px" display="flex" pointerEvents="none" zIndex={0}>
          {steps.map((step, index) => {
            if (index === steps.length - 1) return null

            const status = getStepStatus(index)
            const lineColor = status === 'completed' ? completedBg : lineInactiveColor

            return (
              <Box
                key={`line-${index}`}
                flex={1}
                h="1.5px"
                bg={lineColor}
                transition="background-color 0.6s cubic-bezier(0.4, 0, 0.2, 1)"
                mx={0}
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

            <Box p={3} bg="blue.50" borderRadius="md" borderLeftWidth="4px" borderLeftColor="blue.400">
              <HStack spacing={2}>
                <Icon as={FaInfoCircle} color="blue.500" />
                <Text fontSize="xs" color="blue.700" fontWeight="medium">
                  {getStatusGuidance()}
                </Text>
              </HStack>
            </Box>
          </VStack>
        </CardBody>
      </Card>

      {/* Buyout Transaction Summary (New) */}
      <Card variant="outline" borderColor="blue.200" bg="blue.50">
        <CardBody p={3}>
           <VStack align="stretch" spacing={2}>
             <Text fontWeight="bold" fontSize="xs" color="blue.800" textTransform="uppercase">Transaction Summary</Text>
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
  const meetupInfoBg = useColorModeValue('blue.50', 'blue.900')

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
            <Box borderWidth="2px" borderColor="blue.200" bg={meetupInfoBg} p={4} borderRadius="md">
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
            <Box p={4} bg="blue.50" borderRadius="lg" borderWidth="2px" borderColor="blue.300" textAlign="center">
              <Icon as={FaCheckCircle} boxSize={6} color="blue.500" mb={2} mx="auto" display="block" />
              <Text fontWeight="semibold" color="blue.700" mb={1}>
                Your review has been submitted ✅
              </Text>
              <Text fontSize="sm" color="blue.600">
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

  // Force map to reinitialize when modal opens or tab changes to Coordination/Map
  useEffect(() => {
    if (isOpen) {
      setMapInitKey(prev => prev + 1)
    }
  }, [isOpen, tabIndex])

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
  const cardBg = useColorModeValue('white', 'gray.800')
  const borderColor = useColorModeValue('gray.200', 'gray.700')
  const locationTextColor = useColorModeValue('gray.800', 'gray.100')
  const partnerTextColor = useColorModeValue('gray.700', 'gray.200')
  const partnerBg = useColorModeValue('orange.50', 'orange.900')
  const nearestBg = useColorModeValue('blue.50', 'blue.950')
  const partnerIconBg = useColorModeValue('orange.100', 'orange.800')
  const defaultIconBg = useColorModeValue('gray.100', 'gray.700')
  const meetupInfoBg = useColorModeValue('blue.50', 'blue.900')
  const meetupInfoTextColor = useColorModeValue('blue.700', 'blue.200')

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

  // Pickup trade: location is locked to the seller's pickup_address.
  // The target product's pickup address is surfaced at the trade level
  // (target_product_pickup_address). Fall back to a seller trade_item only
  // if older payloads still carry it there.
  const isPickupTrade = trade?.meeting_type === 'pickup'
  const pickupAddress =
    trade?.target_product_pickup_address ||
    (trade?.items || []).find((it) => it.offered_by === 'seller')?.product_pickup_address ||
    ''
  const pickupAddressRevealed = !!trade && !['pending', 'pending_multiway', 'countered'].includes(trade.status)
  const maskToNeighborhood = (addr: string): string => {
    if (!addr) return ''
    const parts = addr.split(',').map((s) => s.trim()).filter(Boolean)
    if (parts.length <= 1) return "Seller's neighborhood"
    return parts.slice(1).join(', ')
  }
  const pickupDisplayAddress = pickupAddressRevealed ? pickupAddress : maskToNeighborhood(pickupAddress)

  // Auto-select the pickup address for pickup trades so the existing
  // date/time confirm flow still works without the meetup location picker.
  // If the seller hasn't set a pickup_address and has no home_address,
  // use a descriptive placeholder so the Confirm button can still enable —
  // the parties will coordinate the exact spot via chat.
  const effectivePickupLocation = pickupAddress || "Seller's pickup location (coordinate via chat)"
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
      const requested = await getProduct(trade.target_product_id)
      setRequestedProduct(requested)

      // Only show items offered by the buyer (offered_by === 'buyer') in the "offered" column.
      // Some trades may store seller counter-offer items with offered_by === 'seller' G�� keep them separate.
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

    let agreeLocation: string | null = null
    let agreeDate: string | null = null
    let agreeTime: string | null = null

    if (isUserBuyer) {
      agreeLocation = sellerMeetupLocation
      agreeDate = sellerMeetupDate
      agreeTime = sellerMeetupTime
    } else {
      agreeLocation = buyerMeetupLocation
      agreeDate = buyerMeetupDate
      agreeTime = buyerMeetupTime
    }

    if (!agreeLocation || !agreeTime) {
      toast({
        title: 'Missing Selection',
        description: 'Cannot accept - missing location or time.',
        status: 'warning',
        duration: 3000,
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
      await api.put(`/api/trades/${trade.id}`, {
        action: 'confirm_meetup_done',
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
                <Tab px={5} fontWeight="600">
                  {trade?.trade_option === 'delivery' ? 'Buyout Delivery' : trade?.meeting_type === 'pickup' ? 'Pickup' : 'Meetup'}
                </Tab>
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
                    {/* Trade Option Display - Locked for Ongoing Trades */}
                    {trade?.trade_option && (
                      <Card
                        variant="unstyled"
                        borderRadius="2xl"
                        borderWidth="0"
                        shadow="sm"
                        bg={trade.trade_option === 'meetup' ? (trade?.meeting_type === 'pickup' ? 'orange.50' : 'blue.50') : 'green.50'}
                      >
                        <CardBody p={4}>
                          <HStack spacing={3} align="center" justify="space-between">
                            <HStack spacing={3} align="center">
                              <Box
                                p={2}
                                borderRadius="full"
                                bg={trade.trade_option === 'meetup' ? (trade?.meeting_type === 'pickup' ? 'orange.500' : 'blue.500') : 'green.500'}
                                color="white"
                              >
                                <Icon
                                  as={trade.trade_option === 'meetup' ? (trade?.meeting_type === 'pickup' ? FaMapMarkerAlt : FaHandshake) : FaTruck}
                                  boxSize={5}
                                />
                              </Box>
                              <VStack align="start" spacing={1}>
                                <Text fontWeight="600" fontSize="md" color={trade.trade_option === 'meetup' ? (trade?.meeting_type === 'pickup' ? 'orange.700' : 'blue.700') : 'green.700'}>
                                  Trade Option: {trade.trade_option === 'meetup' ? (trade?.meeting_type === 'pickup' ? 'Pickup' : 'Meetup') : 'Delivery'}
                                </Text>
                                {trade.trade_option === 'meetup' ? (
                                  trade?.meeting_type === 'pickup' ? (
                                    <Text fontSize="sm" color="gray.600">
                                      Pickup at seller's set location
                                    </Text>
                                  ) : (
                                    <Text fontSize="sm" color="gray.600">
                                      Exchange items at a mutually agreed meetup location
                                    </Text>
                                  )
                                ) : (
                                  <VStack align="start" spacing={0}>
                                    <Text fontSize="sm" color="gray.600">
                                      Items will be delivered to addresses
                                    </Text>
                                    {trade.delivery_address && (
                                      <Text fontSize="xs" color="gray.600" mt={1} fontStyle="italic">
                                        Address: {trade.delivery_address}
                                      </Text>
                                    )}
                                  </VStack>
                                )}
                              </VStack>
                            </HStack>
                            <Badge
                              colorScheme={trade.trade_option === 'meetup' ? (trade?.meeting_type === 'pickup' ? 'orange' : 'blue') : 'green'}
                              variant="solid"
                              fontSize="sm"
                              px={3}
                              py={1}
                            >
                              {trade.trade_option === 'meetup' ? (trade?.meeting_type === 'pickup' ? '📍 Pickup' : '🤝 Meetup') : '🚚 Delivery'}
                            </Badge>
                          </HStack>
                          {(trade.status === 'accepted' || trade.status === 'active') && (
                            <Box mt={3} pt={3} borderTopWidth="1px" borderColor="gray.200">
                              <Text fontSize="xs" color="gray.500" fontStyle="italic">
                                🔒 Trade option is locked - no further changes allowed
                              </Text>
                            </Box>
                          )}
                        </CardBody>
                      </Card>
                    )}


                    {/* Meetup Status (for meetup trades) */}
                    {trade?.trade_option === 'meetup' && (
                      <Box p={4} bg={meetupInfoBg} borderRadius="md" borderWidth="1px" borderColor="blue.200">
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
                        {/* Requested Product (What you're giving) */}
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
                                  ({isUserSeller ? "Your Item" : (isUserBuyer ? tradingPartner + "'s Item" : "Seller's Item")})
                                </Text>
                              </HStack>
                              {requestedProduct ? (
                                <>
                                  <Box w="full" bg="gray.50" borderRadius="md" overflow="hidden" aspectRatio="1" display="flex" alignItems="center" justifyContent="center">
                                    <OptimizedImage
                                      src={getFirstImage(requestedProduct.image_urls)}
                                      alt={requestedProduct.title}
                                      displayWidth="full"
                                      displayHeight="100%"
                                      objectFit="contain"
                                      borderRadius="md"
                                      fallbackSrc="/no-image.svg"
                                      width={400}
                                    />
                                  </Box>
                                  <Box flex={1}>
                                    <Text fontWeight="600" fontSize="sm" color="gray.800" noOfLines={2}>
                                      {requestedProduct.title}
                                    </Text>
                                    <Badge bg="yellow.100" color="yellow.700" borderRadius="md" px={2} py={0.5} fontSize="10px" fontWeight="600" mt={2} mb={1}>
                                      ₱{Number(requestedProduct.price || requestedProduct.estimated_value_min || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                    </Badge>
                                    <Text fontSize="xs" fontWeight="500" color="gray.500" noOfLines={3} mt={1}>
                                      {requestedProduct.description}
                                    </Text>
                                  </Box>
                                </>
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
                                  ({isUserBuyer ? "Your Item" : (isUserSeller ? tradingPartner + "'s Items" : "Buyer's Items")})
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
                <TabPanel px={[0, 2]} overflow="hidden" minH={0} flex={1} display="flex" flexDirection="column">
                  <VStack spacing={3} align="stretch" h="full" minH={0} display="flex" flexDirection="column">
                    {/* Messages Area */}
                    <Box
                      flex={1}
                      overflowY="auto"
                      p={[2, 3, 4]}
                      bg="gray.50"
                      borderRadius="md"
                      borderWidth="1px"
                      borderColor={borderColor}
                    >
                      {loadingMessages ? (
                        <Flex justify="center" align="center" h="full">
                          <Spinner />
                        </Flex>
                      ) : messages.length === 0 ? (
                        <Flex justify="center" align="center" h="full" direction="column">
                          <Icon as={FaPaperPlane} boxSize={8} color="gray.400" mb={2} />
                          <Text color="gray.500">No messages yet. Start the conversation!</Text>
                        </Flex>
                      ) : (
                        <VStack spacing={3} align="stretch">
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
                                align="flex-start"
                                spacing={2}
                              >
                                {!isOwnMessage && (
                                  <Avatar
                                    name={msg.sender_name || 'User'}
                                    src={senderAvatarSrc}
                                    size="sm"
                                    bg="brand.500"
                                    color="white"
                                  />
                                )}
                                <Box
                                  maxW="70%"
                                  p={3}
                                  borderRadius="lg"
                                  bg={isOwnMessage ? 'brand.500' : 'white'}
                                  color={isOwnMessage ? 'white' : 'gray.800'}
                                  borderWidth={isOwnMessage ? 0 : '1px'}
                                  borderColor={borderColor}
                                >
                                  {isPhotoMessage ? (
                                    <Image
                                      src={getImageUrl(photoUrl)}
                                      alt="Shared photo"
                                      borderRadius="md"
                                      maxH="220px"
                                      objectFit="cover"
                                    />
                                  ) : (
                                    <Text fontSize="sm">{msg.content}</Text>
                                  )}
                                  <Text
                                    fontSize="xs"
                                    color={isOwnMessage ? 'brand.100' : 'gray.500'}
                                    mt={1}
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
                                    size="sm"
                                    bg="brand.500"
                                    color="white"
                                  />
                                )}
                              </HStack>
                            )
                          })}
                          <div ref={messagesEndRef} />
                        </VStack>
                      )}
                    </Box>

                    {/* Message Input */}
                    {chatPhotoPreview && (
                      <HStack spacing={2} mb={2} align="center">
                        <Image src={chatPhotoPreview} alt="Photo preview" maxH="60px" borderRadius="md" />
                        <Button size="xs" variant="ghost" onClick={clearChatPhoto}>Remove</Button>
                      </HStack>
                    )}
                    <HStack spacing={2}>
                      <InputGroup>
                        <Textarea
                          value={newMessage}
                          onChange={(e) => setNewMessage(e.target.value)}
                          placeholder="Type your message..."
                          resize="none"
                          rows={2}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault()
                              sendMessage()
                            }
                          }}
                          isDisabled={sendingMessage || uploadingChatPhoto}
                        />
                      </InputGroup>
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
                        variant="outline"
                        onClick={() => chatPhotoInputRef.current?.click()}
                        isDisabled={sendingMessage || uploadingChatPhoto}
                      />
                      <Button
                        colorScheme="brand"
                        onClick={sendMessage}
                        isLoading={sendingMessage || uploadingChatPhoto}
                        leftIcon={<FaPaperPlane />}
                        isDisabled={!newMessage.trim() && !chatPhotoFile}
                      >
                        Send
                      </Button>
                    </HStack>
                  </VStack>
                </TabPanel>

                {/* Meetup/Delivery Tab */}
                <TabPanel px={[0, 2]} flex={1} overflowY="auto" display="flex" flexDirection="column">
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
                    <VStack spacing={6} align="stretch">

                      {!meetupAgreed && (
                        <Box
                          p={3}
                          bg={meetupInfoBg}
                          borderLeft="4px"
                          borderColor="brand.500"
                          borderRadius="md"
                        >
                          <Text fontSize="sm" color={meetupInfoTextColor} fontWeight="medium">
                            {trade?.meeting_type === 'pickup'
                              ? 'Current Stage: Waiting for both parties to confirm pickup schedule'
                              : 'Current Stage: Waiting for both parties to confirm location'}
                          </Text>
                        </Box>
                      )}

                      {meetupAgreed && meetupSelectionMatches && (
                        <Card bg="green.50" borderWidth="2px" borderColor="green.200">
                          <CardBody>
                            <VStack spacing={3} align="stretch">
                              <HStack>
                                <Icon as={FaCheckCircle} color="green.500" boxSize={5} />
                                <Text fontWeight="semibold" fontSize="md" color="green.700">
                                  {trade?.meeting_type === 'pickup' ? 'Pickup Confirmed' : 'Meetup Confirmed'}
                                </Text>
                              </HStack>

                              <VStack spacing={2} align="start" fontSize="sm">
                                <HStack spacing={2} w="full">
                                  <Icon as={FaMapMarkerAlt} boxSize={4} color="green.600" />
                                  <VStack align="start" spacing={0} flex={1}>
                                    <Text fontWeight="semibold" color="green.900">Location</Text>
                                    <Text color="green.800">{buyerMeetupLocation}</Text>
                                  </VStack>
                                </HStack>

                                {buyerMeetupDate && (
                                  <HStack spacing={2} w="full">
                                    <Icon as={FaCalendarAlt} boxSize={4} color="green.600" />
                                    <VStack align="start" spacing={0} flex={1}>
                                      <Text fontWeight="semibold" color="green.900">Date</Text>
                                      <Text color="green.800">{new Date(buyerMeetupDate).toLocaleDateString()}</Text>
                                    </VStack>
                                  </HStack>
                                )}

                                {buyerMeetupTime && (
                                  <HStack spacing={2} w="full">
                                    <Icon as={FaClock} boxSize={4} color="green.600" />
                                    <VStack align="start" spacing={0} flex={1}>
                                      <Text fontWeight="semibold" color="green.900">Time</Text>
                                      <Text color="green.800">{formatTimePH(buyerMeetupTime)}</Text>
                                    </VStack>
                                  </HStack>
                                )}
                              </VStack>

                              <Text fontSize="xs" color="green.700" fontStyle="italic">
                                Please arrive on time. Review the Meetup Policy for important information about no-shows and strikes.
                              </Text>
                            </VStack>
                          </CardBody>
                        </Card>
                      )}

                      {/* Meetup Location Selection */}
                      {isPickupTrade ? (
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
                                      🔒 Exact address is revealed to the buyer once the seller accepts the offer.
                                    </Text>
                                  )}
                                  <Text fontSize="xs" color="gray.600">
                                    This is the seller's set pickup location. The buyer comes to the seller — the location can't be changed. Pick a date and time below to continue.
                                  </Text>
                                </>
                              ) : (
                                <Text fontSize="sm" color="red.600">
                                  The seller hasn't set a pickup address on this product. Please message them to coordinate.
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
                          <Box h={["150px", "180px", "200px"]} mb={3} borderRadius="md" overflow="hidden" borderWidth="1px" borderColor={borderColor}>
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

                          <SimpleGrid columns={[1, 2]} spacing={[1, 1.5]} maxH={["280px", "350px"]} overflowY="auto" pr={2} css={{
                            '&::-webkit-scrollbar': {
                              width: '4px',
                            },
                            '&::-webkit-scrollbar-track': {
                              width: '6px',
                            },
                            '&::-webkit-scrollbar-thumb': {
                              background: 'brand.500',
                              borderRadius: '24px',
                            },
                          }}>
                            {suggestedLocations.map((location, index) => {
                              const isSelected = selectedLocation === location.name
                              const isPartner = location.isPartner
                              const isNearest = location.name === nearestLocationName // Dynamic nearest
                              // textColor is hoisted below as locationTextColor

                              // Check if location selection should be locked
                              // Lock ONLY if both parties have confirmed (can only negotiate by resetting)
                              const bothParitiesConfirmed = buyerMeetupConfirmed && sellerMeetupConfirmed
                              const isLocked = bothParitiesConfirmed && trade.meetup_location !== undefined

                              return (
                                <Card
                                  key={`location-${location.name}`}
                                  variant="outline"
                                  cursor={isLocked ? (isSelected ? "default" : "not-allowed") : "pointer"}
                                  opacity={isLocked && !isSelected ? 0.5 : 1}
                                  borderWidth={isPartner ? '2px' : isSelected ? '2px' : '1px'}
                                  borderColor={isPartner ? 'orange.400' : isSelected ? 'brand.500' : isNearest ? 'blue.300' : borderColor}
                                  bg={isSelected ? 'brand.50' : isPartner ? partnerBg : isNearest ? nearestBg : 'white'}
                                  onClick={() => {
                                    if (!isLocked) {
                                      setSelectedLocation(location.name)
                                    } else if (!isSelected) {
                                      toast({
                                        id: "location-locked",
                                        title: 'Location Locked',
                                        description: `Both parties confirmed different locations. Click "Change My Selection" to modify your choice, or message them to negotiate.`,
                                        status: 'warning',
                                        duration: 3000,
                                        isClosable: true,
                                      })
                                    }
                                  }}
                                  transition="all 0.2s cubic-bezier(0.4, 0, 0.2, 1)"
                                  _hover={{
                                    borderColor: isLocked ? undefined : (isPartner ? 'orange.500' : isSelected ? 'brand.600' : 'brand.400'),
                                    shadow: isLocked ? undefined : 'md',
                                    transform: isLocked ? undefined : 'translateY(-2px)',
                                  }}
                                >
                                  <CardBody p={[1.5, 2]}>
                                    <VStack spacing={0.5} align="stretch">
                                      {/* Location Icon & Info */}
                                      <HStack spacing={1.5} flex={1}>
                                        <Box
                                          p={1}
                                          bg={isPartner ? partnerIconBg : defaultIconBg}
                                          borderRadius="sm"
                                          display="flex"
                                          alignItems="center"
                                          justifyContent="center"
                                          flexShrink={0}
                                        >
                                          <Icon
                                            as={isPartner ? FaStore : FaMapMarkerAlt}
                                            color={isPartner ? 'orange.500' : isSelected ? 'brand.500' : isNearest ? 'blue.500' : 'gray.500'}
                                            boxSize={isPartner ? 4 : 3.5}
                                          />
                                        </Box>

                                        <VStack align="start" spacing={0.25} flex={1} minW={0}>
                                          <HStack spacing={0.5} flexWrap="wrap">
                                            <Text fontWeight="semibold" fontSize={["10px", "xs"]} color={locationTextColor} noOfLines={1}>
                                              {location.name}
                                            </Text>
                                            {isPartner && (
                                              <Badge colorScheme="orange" fontSize="2xs" px={0.5} py={0}>
                                                G��
                                              </Badge>
                                            )}
                                          </HStack>
                                          <Text fontSize={["2xs", "2xs"]} color="gray.600" noOfLines={1}>
                                            {location.address}
                                          </Text>
                                          <Badge
                                            colorScheme={
                                              location.type === 'cafe'
                                                ? 'orange'
                                                : location.type === 'mall'
                                                  ? 'blue'
                                                  : 'green'
                                            }
                                            variant="subtle"
                                            fontSize="2xs"
                                            px={0.5}
                                            py={0}
                                            w="fit-content"
                                          >
                                            {location.type}
                                          </Badge>
                                        </VStack>
                                      </HStack>

                                      {/* Selection Indicator */}
                                      {isSelected && (
                                        <HStack justify="center" flexShrink={0}>
                                          <Icon as={FaCheckCircle} color="brand.500" boxSize={4} />
                                        </HStack>
                                      )}
                                    </VStack>
                                  </CardBody>
                                </Card>
                              )
                            })}
                          </SimpleGrid>
                        </Box>
                      )}

                      {/* 1. SMART SUGGESTIONS PANEL - AT TOP */}
                      {showSuggestionsPanel && (
                        <Box
                          p={3}
                          bg="blue.50"
                          borderRadius="md"
                          borderLeft="4px"
                          borderColor="blue.400"
                          mb={4}
                        >
                          <HStack justify="space-between" mb={2}>
                            <Text fontSize="sm" fontWeight="medium" color="blue.700">
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
                      <Box>
                        <HStack justify="space-between" mb={2}>
                          <VStack align="start" spacing={0}>
                            <Text fontWeight="semibold" fontSize="md">
                              {isPickupTrade
                                ? (isUserBuyer ? 'Propose Pickup Time' : "Review Buyer's Pickup Proposal")
                                : 'Schedule a Meetup'}
                            </Text>
                            <Text fontSize="sm" color="gray.600">
                              {isPickupTrade
                                ? (isUserBuyer
                                  ? 'You set the pickup date and time. The seller can accept or propose a reschedule.'
                                  : 'The buyer picks a date and time. You can accept it or propose a reschedule.')
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
                          // Pickup trade: seller must wait for the buyer to propose a
                          // date/time before they can respond.
                          <Box
                            p={4}
                            bg="blue.50"
                            borderRadius="md"
                            borderWidth="1px"
                            borderColor="blue.200"
                          >
                            <VStack spacing={1} align="start">
                              <Text fontWeight="semibold" color="blue.800">
                                ⏳ Waiting for the buyer to propose a pickup time
                              </Text>
                              <Text fontSize="sm" color="blue.700">
                                The buyer chooses when to come by. You'll be able to accept their proposal or suggest a different time once it's submitted.
                              </Text>
                            </VStack>
                          </Box>
                        ) : (isUserBuyer && buyerMeetupConfirmed) || (isUserSeller && sellerMeetupConfirmed) ? (
                          // LOCKED STATE - Compact Display
                          <Box
                            p={4}
                            bg="green.50"
                            borderRadius="md"
                            borderWidth="2px"
                            borderColor="green.300"
                          >
                            <VStack spacing={3} align="stretch">
                              <Text fontWeight="semibold" fontSize="md" color="green.700">
                                ✅ Your Selection Locked
                              </Text>

                              <VStack spacing={2} align="start" fontSize="sm">
                                <HStack spacing={2}>
                                  <Text fontWeight="medium" color="gray.700" minW="70px">Location:</Text>
                                  <Text color="gray.600">{isUserBuyer ? buyerMeetupLocation : sellerMeetupLocation}</Text>
                                </HStack>
                                <HStack spacing={2}>
                                  <Text fontWeight="medium" color="gray.700" minW="70px">Date:</Text>
                                  <Text color="gray.600">{formatDateLabel((isUserBuyer ? buyerMeetupDate : sellerMeetupDate)!)}</Text>
                                </HStack>
                                <HStack spacing={2}>
                                  <Text fontWeight="medium" color="gray.700" minW="70px">Time:</Text>
                                  <Text color="gray.600">{formatTimePH((isUserBuyer ? buyerMeetupTime : sellerMeetupTime)!)}</Text>
                                </HStack>
                              </VStack>
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
                              <HStack spacing={2} flexWrap="wrap">
                                {getNext7Days().map((dateStr) => (
                                  <Button
                                    key={dateStr}
                                    size="sm"
                                    variant={selectedDate === dateStr ? 'solid' : 'outline'}
                                    colorScheme={selectedDate === dateStr ? 'brand' : 'gray'}
                                    onClick={() => {
                                      setSelectedDate(dateStr)
                                      setSelectedTime(null) // Clear time when date changes
                                      setValidationError(null)
                                    }}
                                    fontWeight="medium"
                                    px={3}
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
                                  <Text fontSize="xs" color="gray.600">
                                    Available times (30-minute intervals):
                                  </Text>
                                  <SimpleGrid columns={[3, 4, 5]} spacing={2} w="full">
                                    {generateTimeSlots(selectedDate).map((time) => (
                                      <Button
                                        key={time}
                                        size="sm"
                                        variant={selectedTime === time ? 'solid' : 'outline'}
                                        colorScheme={selectedTime === time ? 'brand' : 'gray'}
                                        onClick={() => {
                                          setSelectedTime(time)
                                          setValidationError(null)
                                        }}
                                        fontWeight="medium"
                                        fontSize="xs"
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
                              w="full"
                              fontWeight="semibold"
                              mt={3}
                              _hover={{ transform: 'translateY(-2px)', shadow: 'lg' }}
                              transition="all 0.2s"
                            >
                              G�� Confirm Meetup
                            </Button>
                          </VStack>
                        )}
                      </Box>

                      <>
                        <Box mt={4}>
                          {/* Smart Suggestions Panel */}
                          {showSuggestionsPanel && (
                            <Box
                              p={3}
                              bg="blue.50"
                              borderRadius="md"
                              borderLeft="4px"
                              borderColor="blue.400"
                              mb={4}
                            >
                              <HStack justify="space-between" mb={2}>
                                <Text fontSize="sm" fontWeight="medium" color="blue.700">
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

                        <Divider />
                        <Box
                          p={[2, 3]}
                          bg={meetupInfoBg}
                          borderRadius="lg"
                          borderWidth="1px"
                          borderColor="blue.200"
                        >
                          <VStack spacing={[2, 3]} align="stretch">
                            {/* Header */}
                            <HStack justify="center" spacing={2} py={[1, 2]}>
                              <Icon as={FaHandshake} color="blue.500" boxSize={4} />
                              <Text fontWeight="bold" fontSize={["sm", "md"]} color="blue.700">
                                {trade?.meeting_type === 'pickup' ? 'Pickup Agreement' : 'Meetup Agreement'}
                              </Text>
                            </HStack>

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
                                // MATCH - Success!
                                <VStack spacing={[2, 3]} align="stretch">
                                  <Box
                                    p={[2, 3]}
                                    bg="green.100"
                                    borderRadius="md"
                                    borderWidth="2px"
                                    borderColor="green.400"
                                    textAlign="center"
                                  >
                                    <Icon as={FaCheckCircle} color="green.500" boxSize={6} mb={1} />
                                    <Text fontWeight="bold" color="green.700" fontSize={["sm", "md"]}>
                                      You Both Agreed!
                                    </Text>
                                    <Text fontSize={["xs", "sm"]} color="green.600" mt={0.5}>
                                      {buyerMeetupLocation}
                                    </Text>
                                    <Text fontSize={["xs", "sm"]} color="green.600">
                                      {formatTimePH(buyerMeetupTime)}
                                    </Text>
                                    <Text fontSize="xs" color="green.500" mt={1}>
                                      Meetup agreed. Proceed to confirm you met.
                                    </Text>
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

                                      <Button
                                        colorScheme="green"
                                        size={["sm", "md"]}
                                        onClick={confirmMeetupDone}
                                        isLoading={confirmingMeetupDone}
                                        leftIcon={<FaCheckCircle />}
                                        w="full"
                                        isDisabled={userMetConfirmed}
                                      >
                                        {userMetConfirmed ? 'Confirmed G��' : 'Confirm You Met'}
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
                              ) : (
                                // NO MATCH - Need to coordinate
                                <VStack spacing={[2, 2.5]}>
                                  <Box
                                    p={[2, 3]}
                                    bg="orange.100"
                                    borderRadius="md"
                                    borderWidth="2px"
                                    borderColor="orange.400"
                                    textAlign="center"
                                    w="full"
                                  >
                                    <Icon as={FaExclamationTriangle} color="orange.500" boxSize={5} mb={1} />
                                    <Text fontWeight="bold" color="orange.700" fontSize={["xs", "sm"]}>
                                      Different Selections
                                    </Text>
                                    <Text fontSize="xs" color="orange.600" mt={0.5}>
                                      You and {tradingPartner} picked different options.
                                    </Text>
                                  </Box>

                                  {/* Show both selections side by side */}
                                  <SimpleGrid columns={2} spacing={[2, 2]} w="full">
                                    <Box p={[2, 2.5]} bg="white" borderRadius="md" borderWidth="1px" borderColor="gray.200">
                                      <Text fontSize="xs" fontWeight="bold" color="gray.500" mb={0.5}>
                                        {isUserBuyer ? 'You picked:' : `${trade.buyer_name} picked:`}
                                      </Text>
                                      <Text fontSize={["xs", "sm"]} fontWeight="medium" color="gray.700">
                                        {buyerMeetupLocation}
                                      </Text>
                                      <Text fontSize="xs" color="gray.500">
                                        {formatTimePH(buyerMeetupTime)}
                                      </Text>
                                    </Box>
                                    <Box p={[2, 2.5]} bg="white" borderRadius="md" borderWidth="1px" borderColor="gray.200">
                                      <Text fontSize="xs" fontWeight="bold" color="gray.500" mb={0.5}>
                                        {isUserSeller ? 'You picked:' : `${trade.seller_name} picked:`}
                                      </Text>
                                      <Text fontSize={["xs", "sm"]} fontWeight="medium" color="gray.700">
                                        {sellerMeetupLocation}
                                      </Text>
                                      <Text fontSize="xs" color="gray.500">
                                        {formatTimePH(sellerMeetupTime)}
                                      </Text>
                                    </Box>
                                  </SimpleGrid>

                                  <Text fontSize="xs" color="gray.600" textAlign="center">
                                    Chat with {tradingPartner} and agree on one option, then both resubmit.
                                  </Text>
                                </VStack>
                              )
                            ) : (
                              // One submitted, waiting for the other
                              <VStack spacing={[2, 2.5]} align="stretch">
                                <Box
                                  p={[2, 2.5]}
                                  bg="blue.100"
                                  borderRadius="md"
                                  borderWidth="2px"
                                  borderColor="blue.400"
                                  textAlign="center"
                                >
                                  <Text fontWeight="medium" color="blue.700" fontSize={["xs", "sm"]}>
                                    ⏳ Waiting for Agreement
                                  </Text>
                                  <Text fontSize="xs" color="blue.600" mt={0.5}>
                                    {buyerMeetupConfirmed && !sellerMeetupConfirmed
                                      ? `${trade.buyer_name} proposed:`
                                      : `${trade.seller_name} proposed:`}
                                  </Text>
                                </Box>

                                {/* Show proposed schedule */}
                                {buyerMeetupConfirmed && !sellerMeetupConfirmed && isUserSeller && (
                                  <Box p={[2, 2.5]} bg="white" borderRadius="md" borderWidth="1px" borderColor="gray.200">
                                    <Text fontSize="xs" fontWeight="bold" color="gray.500" mb={1}>
                                      Proposed Schedule:
                                    </Text>
                                    <Text fontSize={["xs", "sm"]} fontWeight="medium" color="gray.700">
                                      =��� {buyerMeetupLocation}
                                    </Text>
                                    <Text fontSize={["xs", "sm"]} color="gray.600">
                                      =��� {formatTimePH(buyerMeetupTime)}
                                    </Text>
                                  </Box>
                                )}

                                {sellerMeetupConfirmed && !buyerMeetupConfirmed && isUserBuyer && (
                                  <Box p={[2, 2.5]} bg="white" borderRadius="md" borderWidth="1px" borderColor="gray.200">
                                    <Text fontSize="xs" fontWeight="bold" color="gray.500" mb={1}>
                                      Proposed Schedule:
                                    </Text>
                                    <Text fontSize={["xs", "sm"]} fontWeight="medium" color="gray.700">
                                      =��� {sellerMeetupLocation}
                                    </Text>
                                    <Text fontSize={["xs", "sm"]} color="gray.600">
                                      =��� {formatTimePH(sellerMeetupTime)}
                                    </Text>
                                  </Box>
                                )}

                                {/* Action buttons */}
                                {(buyerMeetupConfirmed && !sellerMeetupConfirmed && isUserSeller) ||
                                  (sellerMeetupConfirmed && !buyerMeetupConfirmed && isUserBuyer) ? (
                                  <VStack spacing={2} w="full" align="stretch">
                                    <HStack spacing={2} w="full" align="stretch">
                                      <Button
                                        colorScheme="green"
                                        size={["sm", "md"]}
                                        onClick={handleAgreeToSchedule}
                                        isLoading={agreeingToSchedule}
                                        flex={1}
                                      >
                                        Accept This Time
                                      </Button>
                                      <Button
                                        variant="outline"
                                        colorScheme="gray"
                                        size={["sm", "md"]}
                                        onClick={() => {
                                          setShowSuggestionsPanel(true)
                                        }}
                                        leftIcon={<FaLightbulb />}
                                        flex={0.8}
                                      >
                                        Suggest Different
                                      </Button>
                                    </HStack>
                                    {/* Review and complete once both parties agree */}
                                    <Button
                                      colorScheme={meetupAgreed ? "green" : "gray"}
                                      variant={meetupAgreed ? "solid" : "outline"}
                                      size={["sm", "md"]}
                                      onClick={handleInstantComplete}
                                      leftIcon={<FaStar />}
                                      w="full"
                                      isDisabled={!meetupAgreed || completingTrade}
                                      isLoading={completingTrade}
                                      loadingText="Completing..."
                                      _disabled={{ opacity: 0.5, cursor: 'not-allowed' }}
                                    >
                                      {meetupAgreed ? 'Leave a Review and Complete Trade' : 'Review after agreement'}
                                    </Button>
                                  </VStack>
                                ) : (
                                  <VStack spacing={2} w="full">
                                    <Text fontSize="xs" color="gray.600" textAlign="center">
                                      Waiting for {isUserBuyer ? trade.seller_name : trade.buyer_name} to respond.
                                    </Text>
                                    {/* Review and complete once both parties agree */}
                                    <Button
                                      colorScheme={meetupAgreed ? "green" : "gray"}
                                      variant={meetupAgreed ? "solid" : "outline"}
                                      size={["sm", "md"]}
                                      onClick={handleInstantComplete}
                                      leftIcon={<FaStar />}
                                      w="full"
                                      isDisabled={!meetupAgreed || completingTrade}
                                      isLoading={completingTrade}
                                      loadingText="Completing..."
                                      _disabled={{ opacity: 0.5, cursor: 'not-allowed' }}
                                    >
                                      {meetupAgreed ? 'Leave a Review and Complete Trade' : 'Review after agreement'}
                                    </Button>
                                  </VStack>
                                )}
                              </VStack>
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
