import React, { useMemo, useState } from 'react'
import { Box, Button, HStack, Text, VStack, useColorModeValue } from '@chakra-ui/react'
import { motion } from 'framer-motion'
import { Circle, MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from 'react-leaflet'
import L from 'leaflet'

type TrackingPoint = {
  lat: number
  lng: number
  label?: string
}

export type TrackingSheetSnap = 'collapsed' | 'half' | 'full'

type TransactionTrackingLayoutProps = {
  title: string
  subtitle?: string
  destination?: TrackingPoint | null
  currentLocation?: TrackingPoint | null
  route?: Array<[number, number]>
  distanceLabel?: string
  etaLabel?: string
  fallbackMessage?: string
  radiusMeters?: number
  minContent: React.ReactNode
  halfContent?: React.ReactNode
  fullContent?: React.ReactNode
  actions?: React.ReactNode
  onOpenExternal?: () => void
  externalDisabled?: boolean
  initialSnap?: TrackingSheetSnap
  height?: any
}

const MotionBox = motion(Box)

const FitBounds: React.FC<{ points: Array<[number, number]> }> = ({ points }) => {
  const map = useMap()
  React.useEffect(() => {
    if (points.length === 0) return
    const bounds = L.latLngBounds(points.map(([lat, lng]) => L.latLng(lat, lng)))
    map.fitBounds(bounds, { padding: [36, 36], maxZoom: 17 })
  }, [map, points])
  return null
}

const TransactionTrackingLayout: React.FC<TransactionTrackingLayoutProps> = ({
  title,
  subtitle,
  destination,
  currentLocation,
  route = [],
  distanceLabel = 'Calculating distance...',
  etaLabel = 'Calculating ETA...',
  fallbackMessage,
  radiusMeters,
  minContent,
  halfContent,
  fullContent,
  actions,
  onOpenExternal,
  externalDisabled,
  initialSnap = 'half',
  height = { base: '68vh', md: '72vh' },
}) => {
  const [snap, setSnap] = useState<TrackingSheetSnap>(initialSnap)
  const sheetBg = useColorModeValue('white', 'gray.900')
  const headerBg = useColorModeValue('whiteAlpha.950', 'gray.900')
  const muted = useColorModeValue('gray.600', 'gray.300')
  const center = destination || currentLocation || { lat: 6.9214, lng: 122.0790 }
  const mapPoints = useMemo(() => [
    ...(destination ? [[destination.lat, destination.lng] as [number, number]] : []),
    ...(currentLocation ? [[currentLocation.lat, currentLocation.lng] as [number, number]] : []),
    ...route,
  ], [currentLocation, destination, route])
  const sheetHeight = snap === 'full' ? '76%' : snap === 'half' ? '46%' : '124px'
  const showHalf = snap !== 'collapsed'
  const showFull = snap === 'full'

  return (
    <Box position="relative" minH={height} overflow="hidden" bg="gray.100" borderRadius={{ base: 'xl', md: '2xl' }}>
      <Box position="absolute" inset={0}>
        {destination || currentLocation ? (
          <MapContainer center={[center.lat, center.lng]} zoom={16} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
            {mapPoints.length > 1 && <FitBounds points={mapPoints} />}
            <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
            {destination && (
              <>
                {radiusMeters && (
                  <Circle
                    center={[destination.lat, destination.lng]}
                    radius={radiusMeters}
                    pathOptions={{ color: '#16A34A', fillColor: '#BBF7D0', fillOpacity: 0.28, weight: 3 }}
                  />
                )}
                <Marker position={[destination.lat, destination.lng]}>
                  <Popup>{destination.label || 'Destination'}</Popup>
                </Marker>
              </>
            )}
            {route.length > 1 && <Polyline positions={route} pathOptions={{ color: '#2563EB', weight: 5, opacity: 0.82 }} />}
            {currentLocation && (
              <Circle
                center={[currentLocation.lat, currentLocation.lng]}
                radius={70}
                pathOptions={{ color: '#2563EB', fillColor: '#DBEAFE', fillOpacity: 0.34, weight: 2 }}
              >
                <Popup>{currentLocation.label || 'Current location'}</Popup>
              </Circle>
            )}
          </MapContainer>
        ) : (
          <VStack h="full" justify="center" px={6} textAlign="center" bg="gray.50">
            <Text fontWeight="800" color="gray.700">Map unavailable</Text>
            <Text fontSize="sm" color="gray.500">{fallbackMessage || 'A mapped location is needed to show tracking.'}</Text>
          </VStack>
        )}
      </Box>

      <Box position="absolute" top={3} left={3} right={3} zIndex={500} pointerEvents="none">
        <HStack justify="space-between" align="start" spacing={3}>
          <Box bg={headerBg} borderRadius="xl" px={3} py={2} shadow="lg" maxW="70%">
            <Text fontSize="xs" fontWeight="900" color="gray.500" textTransform="uppercase">{title}</Text>
            {subtitle && <Text fontSize="xs" color={muted} noOfLines={2}>{subtitle}</Text>}
          </Box>
          <VStack spacing={2} align="stretch" pointerEvents="auto">
            <HStack bg={headerBg} borderRadius="full" px={3} py={2} shadow="lg" spacing={3}>
              <Text fontSize="xs" fontWeight="800" color="gray.800">{etaLabel}</Text>
              <Text fontSize="xs" color="gray.500">{distanceLabel}</Text>
            </HStack>
            {onOpenExternal && (
              <Button size="xs" colorScheme="green" borderRadius="full" onClick={onOpenExternal} isDisabled={externalDisabled}>
                Open in Google Maps
              </Button>
            )}
          </VStack>
        </HStack>
      </Box>

      <MotionBox
        position="absolute"
        left={0}
        right={0}
        bottom={0}
        zIndex={600}
        h={sheetHeight}
        bg={sheetBg}
        borderTopRadius="2xl"
        shadow="2xl"
        display="flex"
        flexDirection="column"
        drag="y"
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={0.08}
        onDragEnd={(_, info) => {
          if (info.offset.y > 80) setSnap('collapsed')
          else if (info.offset.y < -80) setSnap('full')
          else setSnap('half')
        }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
      >
        <VStack spacing={2} align="stretch" px={4} pt={2} pb={3} borderBottomWidth="1px" borderColor="gray.100" flexShrink={0}>
          <Box w="44px" h="5px" bg="gray.300" borderRadius="full" mx="auto" />
          <HStack justify="space-between" align="center">
            <Box minW={0} flex={1}>{minContent}</Box>
            <HStack spacing={1}>
              {(['collapsed', 'half', 'full'] as const).map(nextSnap => (
                <Button
                  key={nextSnap}
                  size="xs"
                  variant={snap === nextSnap ? 'solid' : 'ghost'}
                  colorScheme="brand"
                  onClick={() => setSnap(nextSnap)}
                  borderRadius="full"
                >
                  {nextSnap === 'collapsed' ? 'Min' : nextSnap === 'half' ? 'Half' : 'Full'}
                </Button>
              ))}
            </HStack>
          </HStack>
        </VStack>

        <Box overflowY="auto" px={{ base: 3, md: 5 }} py={4} flex={1}>
          <VStack spacing={3} align="stretch">
            {fallbackMessage && <Text fontSize="xs" color="gray.600">{fallbackMessage}</Text>}
            {showHalf && halfContent}
            {showFull && fullContent}
            {showHalf && actions}
          </VStack>
        </Box>
      </MotionBox>
    </Box>
  )
}

export default TransactionTrackingLayout
