import React, { useState, useEffect } from 'react'
import { Badge, Tooltip, Spinner, HStack, Icon } from '@chakra-ui/react'
import { FaMapMarkerAlt } from 'react-icons/fa'
import { api } from '../services/api'
import { DistanceResult } from '../types'

interface ProximityBadgeProps {
  type: 'user' | 'product'
  targetId: number
  showIcon?: boolean
}

const ProximityBadge: React.FC<ProximityBadgeProps> = ({ type, targetId, showIcon = true }) => {
  const [distance, setDistance] = useState<DistanceResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const fetchDistance = async () => {
      try {
        setLoading(true)
        const response = await api.get('/api/ai/proximity', {
          params: { type, target_id: targetId }
        })
        if (response.data.success) {
          setDistance(response.data.data)
        }
      } catch (err: any) {
        setError(err?.response?.data?.error || 'Location not available')
      } finally {
        setLoading(false)
      }
    }

    if (targetId) {
      fetchDistance()
    }
  }, [type, targetId])

  if (loading) {
    return (
      <Badge colorScheme="gray" variant="subtle">
        <Spinner size="xs" mr={1} />
        Calculating...
      </Badge>
    )
  }

  if (error || !distance) {
    return null // Don't show anything if there's an error
  }

  const formatDistance = () => {
    if (distance.distance_km < 1) {
      return `${Math.round(distance.distance_m)}m away`
    } else if (distance.distance_km < 10) {
      return `${distance.distance_km.toFixed(1)}km away`
    } else {
      return `${Math.round(distance.distance_km)}km away`
    }
  }

  const getColorScheme = () => {
    if (distance.distance_km < 5) return 'green'
    if (distance.distance_km < 20) return 'blue'
    if (distance.distance_km < 50) return 'orange'
    return 'gray'
  }

  return (
    <Tooltip label={`Distance: ${distance.distance_km.toFixed(2)} km (${distance.distance_miles.toFixed(2)} miles)`}>
      <Badge colorScheme={getColorScheme()} variant="subtle" fontSize="xs">
        <HStack spacing={1}>
          {showIcon && <Icon as={FaMapMarkerAlt} />}
          <span>{formatDistance()}</span>
        </HStack>
      </Badge>
    </Tooltip>
  )
}

export default ProximityBadge



