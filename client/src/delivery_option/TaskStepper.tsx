import React, { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Box,
  VStack,
  HStack,
  Heading,
  Text,
  Button,
  Card,
  CardBody,
  Icon,
  Badge,
  Divider,
  Textarea,
  useToast,
  Progress,
  Tabs,
  TabList,
  Tab,
  TabPanels,
  TabPanel,
  Spinner,
  Center,
  Image,
  IconButton,
} from '@chakra-ui/react'
import { CheckCircleIcon, WarningIcon, CloseIcon } from '@chakra-ui/icons'
import { FaMapMarkerAlt, FaCamera, FaSync, FaRedo } from 'react-icons/fa'
import { MapContainer, TileLayer, Marker, Polyline, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import L from 'leaflet'
import { api } from '../services/api'
import { Delivery, DeliveryStop, Trade } from '../types'

// Fix generic leaflet icon URLs (guarded to avoid runtime import issues)
if (L?.Icon?.Default) {
  delete (L.Icon.Default.prototype as any)._getIconUrl
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
    iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
  })
}

// The status progression for a delivery
const STATUS_PROGRESSION: Array<Delivery['status']> = ['claimed', 'picked_up', 'in_transit', 'delivered']

interface Task {
  id: string
  stopId?: number
  stopType?: string
  type: 'pickup' | 'delivery'
  status: 'pending' | 'in-progress' | 'completed'
  recipientName: string
  address: string
  contact: string
  itemCount: number
  notes: string
  timestamp?: string
}

const FitBounds: React.FC<{ points: Array<[number, number]> }> = ({ points }) => {
  const map = useMap()
  useEffect(() => {
    if (points.length === 0) return
    const bounds = L.latLngBounds(points.map(([lat, lng]) => L.latLng(lat, lng)))
    map.fitBounds(bounds, { padding: [30, 30] })
  }, [map, points])
  return null
}

const TaskStepper: React.FC = () => {
  const { batchId } = useParams() // This is actually the delivery ID
  const navigate = useNavigate()
  const toast = useToast()

  const [delivery, setDelivery] = useState<Delivery | null>(null)
  const [stops, setStops] = useState<DeliveryStop[]>([])
  const [trade, setTrade] = useState<Trade | null>(null)
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState(false)
  const [photoCaptured, setPhotoCaptured] = useState(false)
  const [deliveryNotes, setDeliveryNotes] = useState('')
  // Phase 3 - Task 15 & 16: Store photo data for backend submission
  const [capturedPhotoUrl, setCapturedPhotoUrl] = useState('')
  // Task 16: Real camera capture states
  const [photoPreview, setPhotoPreview] = useState<string | null>(null)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number } | null>(null)
  const [routeCoords, setRouteCoords] = useState<Array<[number, number]>>([])
  const [routeSteps, setRouteSteps] = useState<Array<{ instruction: string; distance: number; duration: number }>>([])
  const [routeLoading, setRouteLoading] = useState(false)
  const [routeError, setRouteError] = useState<string | null>(null)
  const [showAllSteps, setShowAllSteps] = useState(false)
  const [stepPoints, setStepPoints] = useState<Array<{ lat: number; lng: number; instruction: string }>>([])
  const [activeStepIndex, setActiveStepIndex] = useState(0)

  // Fetch delivery data from API
  const fetchStops = async (deliveryId: string) => {
    try {
      const res = await api.get(`/api/deliveries/${deliveryId}/stops`)
      setStops(res.data?.data || [])
    } catch {
      setStops([])
    }
  }

  const fetchTrade = async (tradeId?: number) => {
    if (!tradeId) {
      setTrade(null)
      return
    }
    try {
      const res = await api.get(`/api/trades/${tradeId}`)
      setTrade(res.data?.data || null)
    } catch {
      setTrade(null)
    }
  }

  const fetchDelivery = async () => {
    if (!batchId) return
    try {
      const response = await api.get(`/api/deliveries/${batchId}`)
      const deliveryData = response.data?.data || null
      setDelivery(deliveryData)
      await Promise.all([
        fetchStops(batchId),
        fetchTrade(deliveryData?.trade_id),
      ])
    } catch (error) {
      console.error('Failed to fetch delivery:', error)
      toast({
        id: "taskstepper-error",
        title: 'Error',
        description: 'Failed to load delivery details',
        status: 'error',
        duration: 3000,
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchDelivery()
  }, [batchId])

  useEffect(() => {
    if (!navigator.geolocation) {
      setRouteError('Location services are not available in this browser.')
      return
    }

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setUserLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude })
        setRouteError(null)
      },
      () => {
        setRouteError('Unable to read your current location.')
      },
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
    )

    return () => navigator.geolocation.clearWatch(watchId)
  }, [])

  // Detect if this is a buyout delivery (only cash-for-product, no buyer items)
  const isBuyoutDelivery = trade && (trade.offered_cash_amount || 0) > 0 && 
                          (!trade.items || !trade.items.some(i => i.offered_by === 'buyer'))

  // Build task steps from delivery stops when available
  const buildTasks = (): Task[] => {
    if (!delivery) return []

    if (stops.length > 0) {
      const ordered = [...stops].sort((a, b) => a.stop_number - b.stop_number)
      const firstIncompleteIndex = ordered.findIndex((s) => s.status !== 'completed')

      const labelForStop = (stopType?: string) => {
        switch (stopType) {
          case 'buyer_payment':
            return 'Collect Product Payment & Initial Fee'
          case 'pickup':
            return isBuyoutDelivery 
              ? 'Hand over Payment, Collect Item & Second Fee' 
              : 'Pick up Item(s) at Seller'
          case 'delivery':
            return isBuyoutDelivery 
              ? 'Deliver Final Product to Buyer'
              : 'Deliver Item(s) to Buyer'
          default:
            return 'Stop'
        }
      }

      return ordered.map((stop, index) => {
        const isCompleted = stop.status === 'completed'
        const isActive = !isCompleted && index === (firstIncompleteIndex === -1 ? 0 : firstIncompleteIndex)
        return {
          id: `stop-${stop.id}`,
          stopId: stop.id,
          stopType: stop.stop_type,
          type: stop.stop_type === 'delivery' ? 'delivery' : 'pickup',
          status: isCompleted ? 'completed' : isActive ? 'in-progress' : 'pending',
          recipientName: stop.contact_name || labelForStop(stop.stop_type),
          address: stop.address,
          contact: stop.contact_phone || '',
          itemCount: delivery.item_count,
          notes: delivery.special_instructions || '',
          timestamp: stop.completed_at
            ? new Date(stop.completed_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : '',
        }
      })
    }

    const tasks: Task[] = [
      {
        id: 'pickup',
        type: 'pickup',
        status: delivery.picked_up_at ? 'completed'
          : delivery.status === 'claimed' ? 'in-progress'
          : 'pending',
        recipientName: delivery.user_name || 'Seller',
        address: delivery.pickup_address,
        contact: '',
        itemCount: delivery.item_count,
        notes: delivery.special_instructions || '',
        timestamp: delivery.picked_up_at
          ? new Date(delivery.picked_up_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : '',
      },
      {
        id: 'deliver',
        type: 'delivery',
        status: delivery.delivered_at ? 'completed'
          : delivery.status === 'in_transit' ? 'in-progress'
          : 'pending',
        recipientName: 'Buyer',
        address: delivery.delivery_address,
        contact: '',
        itemCount: delivery.item_count,
        notes: delivery.special_instructions || '',
        timestamp: delivery.delivered_at
          ? new Date(delivery.delivered_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          : '',
      },
    ]

    return tasks
  }

  const tasks = buildTasks()
  const currentTaskIndex = tasks.findIndex(t => t.status === 'in-progress')
  const activeIndex = currentTaskIndex >= 0 ? currentTaskIndex : tasks.findIndex(t => t.status === 'pending')
  const currentTask = activeIndex >= 0 ? tasks[activeIndex] : null
  const currentStop = currentTask?.stopId
    ? stops.find((s) => s.id === currentTask.stopId) || null
    : null
  const completedCount = tasks.filter(t => t.status === 'completed').length
  const totalTasks = tasks.length
  const allDone = delivery?.status === 'delivered'

  const getTaskTitle = (task: Task) => {
    switch (task.stopType) {
      case 'buyer_payment':
        return 'Collect Product Payment & Initial Fee'
      case 'pickup':
        return isBuyoutDelivery 
          ? 'Hand over Payment, Collect Item & Second Fee' 
          : 'Pick up Item(s) at Seller'
      case 'delivery':
        return isBuyoutDelivery 
          ? 'Deliver Final Product to Buyer'
          : 'Deliver Item(s) to Buyer'
      default:
        return task.type === 'pickup' ? 'Pickup' : 'Delivery'
    }
  }

  const productCash = trade?.offered_cash_amount || 0
  const totalDeliveryCost = delivery?.total_cost || 0
  const leg1Fee = totalDeliveryCost * 0.5
  const leg2Fee = totalDeliveryCost * 0.5
  const buyerTotal = productCash + leg1Fee

  const destinationLat = currentStop?.latitude
    ?? (currentTask?.type === 'pickup' ? delivery?.pickup_latitude : delivery?.delivery_latitude)
  const destinationLng = currentStop?.longitude
    ?? (currentTask?.type === 'pickup' ? delivery?.pickup_longitude : delivery?.delivery_longitude)
  const destinationAddress = currentTask?.address || ''
  const etaMinutes = routeSteps.length > 0
    ? Math.max(1, Math.round(routeSteps.reduce((sum, step) => sum + step.duration, 0) / 60))
    : null

  useEffect(() => {
    const lat = destinationLat
    const lng = destinationLng
    if (!userLocation || lat == null || lng == null) {
      setRouteCoords([])
      setRouteSteps([])
      return
    }

    const fetchRoute = async () => {
      setRouteLoading(true)
      setRouteError(null)
      try {
        const url = `https://router.project-osrm.org/route/v1/driving/${userLocation.lng},${userLocation.lat};${lng},${lat}?overview=full&geometries=geojson&steps=true`
        const res = await fetch(url)
        const data = await res.json()
        const route = data?.routes?.[0]
        if (!route) throw new Error('No route found')

        const coords = route.geometry?.coordinates || []
        const latLngs: Array<[number, number]> = coords.map((c: number[]) => [c[1], c[0]])
        setRouteCoords(latLngs)

        const leg = route.legs?.[0]
        const steps = (leg?.steps || []).map((step: any) => {
          const maneuver = step.maneuver || {}
          const base = maneuver.instruction || [maneuver.type, maneuver.modifier].filter(Boolean).join(' ')
          const name = step.name || ''
          const instruction = name ? `${base} onto ${name}` : base
          return {
            instruction: instruction || 'Continue',
            distance: step.distance || 0,
            duration: step.duration || 0,
            lat: maneuver.location?.[1],
            lng: maneuver.location?.[0],
          }
        })
        setRouteSteps(steps)
        setStepPoints(steps
          .filter((s: any) => typeof s.lat === 'number' && typeof s.lng === 'number')
          .map((s: any) => ({ lat: s.lat, lng: s.lng, instruction: s.instruction })))
        setActiveStepIndex(0)
      } catch (err: any) {
        setRouteError('Unable to load route right now.')
        setRouteCoords([])
        setRouteSteps([])
        setStepPoints([])
        setActiveStepIndex(0)
      } finally {
        setRouteLoading(false)
      }
    }

    fetchRoute()
  }, [userLocation, destinationLat, destinationLng])

  useEffect(() => {
    if (!userLocation || stepPoints.length === 0) return

    const toRad = (v: number) => (v * Math.PI) / 180
    const distanceMeters = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
      const R = 6371000
      const dLat = toRad(b.lat - a.lat)
      const dLng = toRad(b.lng - a.lng)
      const lat1 = toRad(a.lat)
      const lat2 = toRad(b.lat)
      const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
      return 2 * R * Math.asin(Math.sqrt(h))
    }

    const current = stepPoints[activeStepIndex]
    if (!current) return
    const dist = distanceMeters(userLocation, { lat: current.lat, lng: current.lng })
    if (dist < 25 && activeStepIndex < stepPoints.length - 1) {
      setActiveStepIndex((prev) => Math.min(prev + 1, stepPoints.length - 1))
    }
  }, [userLocation, stepPoints, activeStepIndex])

  // Get the next status in the progression
  const getNextStatus = (): Delivery['status'] | null => {
    if (!delivery) return null
    const currentIdx = STATUS_PROGRESSION.indexOf(delivery.status as any)
    if (currentIdx < 0 || currentIdx >= STATUS_PROGRESSION.length - 1) return null
    return STATUS_PROGRESSION[currentIdx + 1]
  }

  const getStopAction = (stop: DeliveryStop | null) => {
    if (!stop) return null
    if (stop.status === 'completed') return null

    if (stop.status === 'pending') {
      return { action: 'arrived', label: 'Arrived at Stop' }
    }

    if (stop.status === 'arrived' || stop.status === 'qr_scanned') {
      if (stop.stop_type === 'buyer_payment') {
        return { action: 'collect_fee', label: 'Collect From Buyer' }
      }
      if (stop.stop_type === 'pickup') {
        return { action: 'collect_fee', label: 'Confirm Handover & Collection' }
      }
      return { action: 'collect_fee', label: 'Confirm Final Drop-off' }
    }

    if (stop.status === 'fee_collected') {
      return { action: 'complete', label: stop.stop_type === 'delivery' ? 'Complete Delivery' : 'Complete Stop' }
    }

    return null
  }


  // Task 16: Open camera for photo capture
  const handleCapturePhoto = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click()
    }
  }

  // Task 16: Handle file selection from camera
  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    // Validate file type
    if (!file.type.startsWith('image/')) {
      toast({
        id: "taskstepper-invalid-file",
        title: 'Image files only',
        description: 'Please take or select a photo (not a video or document).',
        status: 'warning',
        duration: 3000,
      })
      return
    }

    // Validate file size (max 10MB)
    if (file.size > 10 * 1024 * 1024) {
      toast({
        id: "taskstepper-file-too-large",
        title: 'Photo is a bit too big',
        description: 'Please use a photo smaller than 10MB.',
        status: 'warning',
        duration: 3000,
      })
      return
    }

    // Create preview
    const previewUrl = URL.createObjectURL(file)
    setPhotoPreview(previewUrl)

    // Upload the photo
    setUploadingPhoto(true)
    try {
      const formData = new FormData()
      formData.append('image', file)
      formData.append('type', 'delivery_proof')

      const response = await api.post('/api/upload', formData)

      const uploadedUrl = response.data?.data?.url
      if (uploadedUrl) {
        setCapturedPhotoUrl(uploadedUrl)
        setPhotoCaptured(true)
        toast({
          id: "taskstepper-photo-uploaded",
          title: 'Photo Uploaded',
          description: 'Delivery proof captured successfully',
          status: 'success',
          duration: 2000,
        })
      } else {
        throw new Error('No URL returned from upload')
      }
    } catch (error: any) {
      console.error('Photo upload failed:', error)
      // Clear preview on error
      setPhotoPreview(null)
      URL.revokeObjectURL(previewUrl)
      toast({
        id: "taskstepper-upload-failed",
        title: "Photo didn't upload",
        description: error?.response?.data?.error || "Something went wrong. Give it a moment and try again.",
        status: 'error',
        duration: 3000,
      })
    } finally {
      setUploadingPhoto(false)
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  // Task 16: Remove captured photo
  const handleRemovePhoto = () => {
    if (photoPreview) {
      URL.revokeObjectURL(photoPreview)
    }
    setPhotoPreview(null)
    setCapturedPhotoUrl('')
    setPhotoCaptured(false)
  }

  const handleCompleteTask = async () => {
    if (!delivery) return

    const currentStop = currentTask?.stopId
      ? stops.find((s) => s.id === currentTask.stopId) || null
      : null
    const stopAction = getStopAction(currentStop)

    if (currentStop && stopAction) {
      if (stopAction.action === 'complete' && currentStop.stop_type === 'delivery' && !photoCaptured && !capturedPhotoUrl) {
        toast({
          id: "taskstepper-missing-photo",
          title: 'One more step — snap a photo',
          description: 'A delivery proof photo is needed to mark this as complete.',
          status: 'warning',
          duration: 3000,
        })
        return
      }

      setUpdating(true)
      try {
        const payload: Record<string, any> = { action: stopAction.action }
        if (stopAction.action === 'complete' && photoCaptured && capturedPhotoUrl) {
          payload.photo_url = capturedPhotoUrl
        }

        await api.post(`/api/deliveries/stops/${currentStop.id}/update`, payload)

        toast({
          id: "taskstepper-stop-updated",
          title: 'Stop Updated',
          status: 'success',
          duration: 2000,
        })

        setPhotoCaptured(false)
        setCapturedPhotoUrl('')
        setDeliveryNotes('')
        if (photoPreview) {
          URL.revokeObjectURL(photoPreview)
          setPhotoPreview(null)
        }

        await fetchDelivery()

        if (currentStop.stop_type === 'delivery' && stopAction.action === 'complete') {
          setTimeout(() => navigate('/rider'), 2000)
        }
      } catch (error: any) {
        const errMsg = error?.response?.data?.error || 'Failed to update stop'
        const needsQr = /scan\s*qr/i.test(String(errMsg))
        if (needsQr && currentStop && stopAction?.action === 'collect_fee') {
          try {
            await api.post(`/api/deliveries/stops/${currentStop.id}/update`, {
              action: 'scan_qr',
              qr_code: currentStop.item_qr_code || '',
            })
            await api.post(`/api/deliveries/stops/${currentStop.id}/update`, {
              action: 'collect_fee',
            })
            toast({
              id: "taskstepper-stop-updated",
              title: 'Stop Updated',
              status: 'success',
              duration: 2000,
            })
            await fetchDelivery()
            return
          } catch (retryError: any) {
            // Fall through to show the original error message.
          }
        }

        toast({
          id: "taskstepper-stop-error",
          title: 'Error',
          description: errMsg,
          status: 'error',
          duration: 3000,
        })
      } finally {
        setUpdating(false)
      }
      return
    }

    const nextStatus = getNextStatus()
    if (!nextStatus) {
      toast({
        id: "taskstepper-already-completed", title: 'Already completed', status: 'info', duration: 2000 })
      return
    }

    // For the final delivery step, require photo proof (Task 16)
    if (nextStatus === 'delivered' && !photoCaptured && !capturedPhotoUrl) {
      toast({
        id: "taskstepper-missing-photo",
        title: 'Photo Required',
        description: 'Please capture a photo proof to complete delivery',
        status: 'warning',
        duration: 3000,
      })
      return
    }

    setUpdating(true)
    try {
      // Build update payload with photo data
      const payload: Record<string, any> = { status: nextStatus }

      // Include photo URL if captured (required for delivery step)
      if (photoCaptured && capturedPhotoUrl) {
        payload.photo_url = capturedPhotoUrl
      }

      await api.put(`/api/deliveries/${delivery.id}/status`, payload)

      toast({
        id: "taskstepper-toast-6",
        title: nextStatus === 'delivered' ? 'Delivery Complete!' : 'Status Updated',
        description: nextStatus === 'delivered'
          ? 'All items delivered. The trade can now be completed.'
          : `Status updated to: ${nextStatus.replace(/_/g, ' ')}`,
        status: 'success',
        duration: 3000,
      })

      // Reset verification state
      setPhotoCaptured(false)
      setCapturedPhotoUrl('')
      setDeliveryNotes('')
      // Clear photo preview
      if (photoPreview) {
        URL.revokeObjectURL(photoPreview)
        setPhotoPreview(null)
      }

      // Refresh delivery data
      await fetchDelivery()

      if (nextStatus === 'delivered') {
        // Give a moment for the user to see success, then navigate
        setTimeout(() => navigate('/rider'), 2000)
      }
    } catch (error: any) {
      const errMsg = error?.response?.data?.error || 'Failed to update delivery status'
      toast({
        id: "taskstepper-error-2",
        title: 'Error',
        description: errMsg,
        status: 'error',
        duration: 3000,
      })
    } finally {
      setUpdating(false)
    }
  }

  // Get the label for the complete button based on current status
  const getButtonLabel = (): string => {
    const currentStop = currentTask?.stopId
      ? stops.find((s) => s.id === currentTask.stopId) || null
      : null
    const stopAction = getStopAction(currentStop)
    if (stopAction) return stopAction.label
    const nextStatus = getNextStatus()
    switch (nextStatus) {
      case 'picked_up': return 'Confirm Pickup'
      case 'in_transit': return 'Start Delivery'
      case 'delivered': return 'Confirm Delivered'
      default: return 'Complete'
    }
  }

  if (loading) {
    return (
      <Center minH="100vh" bg="#FFFDF1">
        <VStack spacing={3}>
          <Spinner size="lg" color="brand.500" />
          <Text color="gray.500">Loading delivery...</Text>
        </VStack>
      </Center>
    )
  }

  if (!delivery) {
    return (
      <Center minH="100vh" bg="#FFFDF1">
        <VStack spacing={3}>
          <Text color="gray.500">Delivery not found</Text>
          <Button colorScheme="brand" onClick={() => navigate('/rider')}>
            Back to Jobs
          </Button>
        </VStack>
      </Center>
    )
  }

  return (
    <Box minH="100vh" bg="#FFFDF1" py={6} px={4}>
      <VStack spacing={6} maxW="md" mx="auto">
        {/* Progress Bar */}
        <VStack spacing={2} w="full">
          <HStack justify="space-between" w="full">
            <Heading size="sm" color="gray.800">
              Delivery #{delivery.id}
            </Heading>
            <HStack spacing={2}>
              {etaMinutes != null && !allDone && (
                <Badge colorScheme="purple" fontSize="sm">
                  ETA ~{etaMinutes} min
                </Badge>
              )}
              <Badge colorScheme={allDone ? 'green' : 'blue'} fontSize="sm">
                {delivery.status.replace(/_/g, ' ').toUpperCase()}
              </Badge>
            </HStack>
          </HStack>
          <Progress
            value={(completedCount / totalTasks) * 100}
            colorScheme="green"
            w="full"
            borderRadius="full"
            h="8px"
          />
          <Text fontSize="xs" color="gray.500">
            {completedCount}/{totalTasks} steps completed
          </Text>
        </VStack>

        {!allDone && routeSteps.length > 0 && (
          <Box w="full" p={3} bg="blue.50" borderRadius="md" borderWidth="1px" borderColor="blue.200">
            <Text fontSize="xs" color="blue.700" fontWeight="bold">
              Next step
            </Text>
            <Text fontSize="sm" color="blue.900">
              {routeSteps[Math.min(activeStepIndex, routeSteps.length - 1)]?.instruction}
            </Text>
          </Box>
        )}

        {/* Task Stepper Timeline */}
        <Card bg="white" w="full" border="1px" borderColor="gray.200">
          <CardBody p={4}>
            <VStack spacing={0} align="stretch">
              {tasks.map((task, index) => (
                <VStack key={task.id} spacing={0} align="stretch" pb={index < tasks.length - 1 ? 4 : 0}>
                  <HStack
                    spacing={3}
                    p={2}
                    bg={index === activeIndex ? 'brand.50' : 'transparent'}
                    borderRadius="md"
                    opacity={task.status !== 'pending' || index === activeIndex ? 1 : 0.5}
                  >
                    <Box
                      w="8"
                      h="8"
                      borderRadius="full"
                      display="flex"
                      alignItems="center"
                      justifyContent="center"
                      bg={
                        task.status === 'completed' ? 'green.100' :
                        task.status === 'in-progress' ? 'blue.100' :
                        'gray.100'
                      }
                      flexShrink={0}
                    >
                      <Icon
                        as={task.status === 'completed' ? CheckCircleIcon : WarningIcon}
                        color={
                          task.status === 'completed' ? 'green.600' :
                          task.status === 'in-progress' ? 'blue.600' :
                          'gray.400'
                        }
                        boxSize={5}
                      />
                    </Box>

                    <VStack align="start" spacing={0} flex={1}>
                      <Text fontWeight="bold" fontSize="sm" color="gray.800">
                        {getTaskTitle(task)}
                      </Text>
                      <Text fontSize="xs" color="gray.600" noOfLines={1}>
                        {task.address}
                      </Text>
                    </VStack>

                    {task.timestamp && (
                      <Badge colorScheme="green" fontSize="xs">
                        {task.timestamp}
                      </Badge>
                    )}
                  </HStack>

                  {index < tasks.length - 1 && (
                    <Box h="20px" w="0.5" bg="gray.300" ml="4" my={2} />
                  )}
                </VStack>
              ))}
            </VStack>
          </CardBody>
        </Card>

        {/* Current Task Details */}
        {currentTask && !allDone && (
          <Card bg="white" w="full" border="2px" borderColor="blue.400">
            <CardBody>
              <VStack spacing={4} align="stretch">
                <HStack justify="space-between">
                  <VStack align="start" spacing={0}>
                    <Badge colorScheme="blue" fontSize="sm">
                      Current Step
                    </Badge>
                    <Text fontWeight="bold" fontSize="lg" color="gray.800">
                      {getTaskTitle(currentTask)}
                    </Text>
                  </VStack>
                </HStack>

                <Divider />

                {/* Details */}
                <VStack spacing={2} align="stretch" bg="gray.50" p={3} borderRadius="md">
                  <HStack justify="space-between">
                    <Text fontSize="sm" color="gray.600">Person:</Text>
                    <Text fontWeight="bold" fontSize="sm" color="gray.800">
                      {currentTask.recipientName}
                    </Text>
                  </HStack>
                  <HStack justify="space-between" align="start">
                    <Text fontSize="sm" color="gray.600">Address:</Text>
                    <Text fontWeight="bold" fontSize="sm" color="gray.800" textAlign="right" maxW="60%">
                      {currentTask.address}
                    </Text>
                  </HStack>
                  <HStack justify="space-between">
                    <Text fontSize="sm" color="gray.600">Items:</Text>
                    <Badge colorScheme="purple">{currentTask.itemCount}</Badge>
                  </HStack>
                  {currentTask.notes && (
                    <HStack justify="space-between">
                      <Text fontSize="sm" color="gray.600">Notes:</Text>
                      <Text fontSize="sm" color="gray.700" fontStyle="italic">
                        "{currentTask.notes}"
                      </Text>
                    </HStack>
                  )}
                    {currentTask.stopType === 'buyer_payment' && (
                    <HStack justify="space-between">
                      <VStack align="start" spacing={1}>
                        <Text fontSize="sm" color="gray.600">Collect from Buyer:</Text>
                        <Text fontSize="2xs" color="blue.600">Initial Fee + Product Payment</Text>
                      </VStack>
                      <Text fontWeight="bold" fontSize="md" color="green.600">
                        ₱{buyerTotal.toLocaleString()}
                      </Text>
                    </HStack>
                  )}
                  {currentTask.stopType === 'pickup' && (
                    <VStack align="stretch" spacing={2}>
                      <HStack justify="space-between">
                        <VStack align="start" spacing={0}>
                          <Text fontSize="sm" color="red.600">Hand over Cash:</Text>
                          <Text fontSize="2xs" color="gray.500">(To the seller)</Text>
                        </VStack>
                        <Text fontWeight="bold" fontSize="md" color="red.600">
                          - ₱{productCash.toLocaleString()}
                        </Text>
                      </HStack>
                      <HStack justify="space-between">
                        <VStack align="start" spacing={0}>
                          <Text fontSize="sm" color="gray.600">Collect Second Fee:</Text>
                          <Text fontSize="2xs" color="blue.600">(From the seller)</Text>
                        </VStack>
                        <Text fontWeight="bold" fontSize="md" color="green.600">
                          + ₱{leg2Fee.toLocaleString()}
                        </Text>
                      </HStack>
                    </VStack>
                  )}
                </VStack>

                {/* Map Guidance */}
                <VStack spacing={2} align="stretch">
                  {destinationLat != null && destinationLng != null ? (
                    <Box borderRadius="md" overflow="hidden" borderWidth="1px" borderColor="gray.200">
                      <MapContainer
                        center={[destinationLat, destinationLng]}
                        zoom={15}
                        style={{ height: '240px', width: '100%' }}
                        scrollWheelZoom={false}
                      >
                        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                        {routeCoords.length > 0 && (
                          <Polyline positions={routeCoords} color="#2F855A" weight={4} />
                        )}
                        {userLocation && (
                          <Marker position={[userLocation.lat, userLocation.lng]} />
                        )}
                        <Marker position={[destinationLat, destinationLng]} />
                        <FitBounds
                          points={[
                            ...(routeCoords || []),
                            userLocation ? [userLocation.lat, userLocation.lng] : null,
                            [destinationLat, destinationLng],
                          ].filter(Boolean) as Array<[number, number]>}
                        />
                      </MapContainer>
                    </Box>
                  ) : (
                    <Box p={3} bg="gray.50" borderRadius="md" borderWidth="1px" borderColor="gray.200">
                      <Text fontSize="sm" color="gray.600">Map preview unavailable for this stop.</Text>
                    </Box>
                  )}

                  {routeLoading && (
                    <HStack spacing={2} align="center">
                      <Spinner size="sm" />
                      <Text fontSize="sm" color="gray.600">Loading route…</Text>
                    </HStack>
                  )}

                  {routeError && (
                    <Text fontSize="sm" color="red.600">{routeError}</Text>
                  )}

                  {etaMinutes != null && (
                    <HStack justify="space-between">
                      <Text fontSize="xs" color="gray.600">
                        ETA: ~{etaMinutes} min
                      </Text>
                      <Text fontSize="xs" color="gray.500">
                        {routeSteps.length} steps
                      </Text>
                    </HStack>
                  )}

                  {routeSteps.length > 0 && (
                    <VStack spacing={2} align="stretch">
                      <VStack spacing={2} align="stretch" maxH={showAllSteps ? '280px' : '180px'} overflowY="auto">
                        {(showAllSteps ? routeSteps : routeSteps.slice(0, 10)).map((step, idx) => (
                          <HStack key={`step-${idx}`} justify="space-between" align="start">
                            <Text fontSize="xs" color="gray.700" flex={1}>
                              {idx + 1}. {step.instruction}
                            </Text>
                            <Text fontSize="xs" color="gray.500" flexShrink={0}>
                              {Math.round(step.distance)}m
                            </Text>
                          </HStack>
                        ))}
                      </VStack>
                      {routeSteps.length > 10 && (
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() => setShowAllSteps((prev) => !prev)}
                        >
                          {showAllSteps ? 'Hide steps' : 'Show all steps'}
                        </Button>
                      )}
                    </VStack>
                  )}

                  {destinationAddress && (
                    <Text fontSize="xs" color="gray.500">
                      Destination: {destinationAddress}
                    </Text>
                  )}
                </VStack>

                <Divider />

                {/* Verification Tabs - only for delivery step */}
                {currentTask.type === 'delivery' && (
                  <Tabs variant="soft-rounded" colorScheme="brand" size="sm">
                    <TabList>
                      <Tab>Photo</Tab>
                    </TabList>
                    <TabPanels>
                      <TabPanel>
                        <VStack spacing={3} align="stretch">
                          {/* Hidden file input for camera capture */}
                          <input
                            type="file"
                            accept="image/*"
                            capture="environment"
                            ref={fileInputRef}
                            onChange={handleFileChange}
                            style={{ display: 'none' }}
                          />

                          {/* Photo preview or capture button */}
                          {photoPreview ? (
                            <Box position="relative">
                              <Image
                                src={photoPreview}
                                alt="Delivery proof"
                                borderRadius="md"
                                maxH="200px"
                                w="full"
                                objectFit="cover"
                                border="2px"
                                borderColor={photoCaptured ? 'green.400' : 'gray.200'}
                              />
                              {uploadingPhoto && (
                                <Center
                                  position="absolute"
                                  top={0}
                                  left={0}
                                  right={0}
                                  bottom={0}
                                  bg="blackAlpha.600"
                                  borderRadius="md"
                                >
                                  <VStack>
                                    <Spinner color="white" size="lg" />
                                    <Text color="white" fontSize="sm">Uploading...</Text>
                                  </VStack>
                                </Center>
                              )}
                              {photoCaptured && (
                                <Badge
                                  position="absolute"
                                  top={2}
                                  left={2}
                                  colorScheme="green"
                                  fontSize="xs"
                                >
                                  <Icon as={CheckCircleIcon} mr={1} />
                                  Uploaded
                                </Badge>
                              )}
                              <IconButton
                                aria-label="Remove photo"
                                icon={<CloseIcon />}
                                size="sm"
                                colorScheme="red"
                                position="absolute"
                                top={2}
                                right={2}
                                onClick={handleRemovePhoto}
                                isDisabled={uploadingPhoto}
                              />
                            </Box>
                          ) : (
                            <Button
                              colorScheme="brand"
                              leftIcon={<Icon as={FaCamera} />}
                              onClick={handleCapturePhoto}
                              w="full"
                              size="lg"
                              isLoading={uploadingPhoto}
                              loadingText="Opening camera..."
                            >
                              Open Camera
                            </Button>
                          )}

                          {/* Retake button when photo exists */}
                          {photoPreview && !uploadingPhoto && (
                            <Button
                              colorScheme="brand"
                              variant="outline"
                              leftIcon={<Icon as={FaRedo} />}
                              onClick={handleCapturePhoto}
                              w="full"
                              size="sm"
                            >
                              Retake Photo
                            </Button>
                          )}

                          <Text fontSize="xs" color="gray.600" textAlign="center">
                            {photoCaptured
                              ? 'Photo proof captured and saved'
                              : 'Take a clear photo of the delivered items as proof'}
                          </Text>
                        </VStack>
                      </TabPanel>
                    </TabPanels>
                  </Tabs>
                )}

                <Divider />

                {/* Complete Button */}
                <Button
                  w="full"
                  colorScheme="green"
                  size="lg"
                  onClick={handleCompleteTask}
                  isLoading={updating}
                  loadingText="Updating..."
                  isDisabled={(() => {
                    const currentStop = currentTask?.stopId
                      ? stops.find((s) => s.id === currentTask.stopId) || null
                      : null
                    const stopAction = getStopAction(currentStop)
                    if (stopAction && stopAction.action === 'complete' && currentStop?.stop_type === 'delivery') {
                      return !photoCaptured
                    }
                    return currentTask.type === 'delivery' && getNextStatus() === 'delivered' && !photoCaptured
                  })()}
                >
                  {getButtonLabel()}
                </Button>
              </VStack>
            </CardBody>
          </Card>
        )}

        {/* All Done */}
        {allDone && (
          <Card bg="green.50" w="full" border="2px" borderColor="green.400">
            <CardBody>
              <VStack spacing={3}>
                <Icon as={CheckCircleIcon} color="green.500" boxSize={10} />
                <Text fontWeight="bold" fontSize="lg" color="green.700">
                  Delivery Complete!
                </Text>
                <Text fontSize="sm" color="gray.600" textAlign="center">
                  All items have been delivered. The trade participants can now review and complete the trade.
                </Text>
              </VStack>
            </CardBody>
          </Card>
        )}

        {/* Navigation Buttons */}
        <HStack spacing={2} w="full">
          <Button
            flex={1}
            size="sm"
            variant="outline"
            colorScheme="brand"
            onClick={() => navigate('/rider')}
          >
            Back to Jobs
          </Button>
          <Button
            flex={1}
            size="sm"
            variant="outline"
            colorScheme="brand"
            onClick={() => navigate('/remittance-ledger')}
          >
            Remittance
          </Button>
        </HStack>
      </VStack>
    </Box>
  )
}

export default TaskStepper
