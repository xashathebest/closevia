import React, { useState, useEffect } from 'react'
import { Badge, Tooltip, HStack, Icon, Spinner } from '@chakra-ui/react'
import { FaClock } from 'react-icons/fa'
import { api } from '../services/api'
import { ResponseMetrics } from '../types'

interface ResponseMetricsBadgeProps {
  userId: number
  showDetails?: boolean
}

const ResponseMetricsBadge: React.FC<ResponseMetricsBadgeProps> = ({ userId, showDetails = false }) => {
  const [metrics, setMetrics] = useState<ResponseMetrics | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchMetrics = async () => {
      try {
        setLoading(true)
        const response = await api.get('/api/ai/response-metrics', {
          params: { user_id: userId }
        })
        if (response.data.success) {
          setMetrics(response.data.data)
        }
      } catch (err) {
        // Silently fail - metrics are optional
      } finally {
        setLoading(false)
      }
    }

    if (userId) {
      fetchMetrics()
    }
  }, [userId])

  if (loading || !metrics) {
    return null
  }

  const getColorScheme = () => {
    switch (metrics.rating) {
      case 'excellent': return 'green'
      case 'good': return 'blue'
      case 'average': return 'orange'
      case 'poor': return 'red'
      default: return 'gray'
    }
  }

  const formatResponseTime = () => {
    if (metrics.average_response_time_hours < 1) {
      return `${Math.round(metrics.average_response_time_mins)}m`
    } else if (metrics.average_response_time_hours < 24) {
      return `${Math.round(metrics.average_response_time_hours)}h`
    } else {
      return `${Math.round(metrics.average_response_time_hours / 24)}d`
    }
  }

  const tooltipText = showDetails
    ? `Response Rate: ${(metrics.response_rate * 100).toFixed(0)}% | Avg Response: ${formatResponseTime()} | Rating: ${metrics.rating}`
    : `${metrics.rating} responder • ${formatResponseTime()} avg response`

  return (
    <Tooltip label={tooltipText}>
      <Badge colorScheme={getColorScheme()} variant="subtle" fontSize="xs" textTransform="capitalize">
        <HStack spacing={1}>
          <Icon as={FaClock} />
          <span>{metrics.rating} responder</span>
        </HStack>
      </Badge>
    </Tooltip>
  )
}

export default ResponseMetricsBadge



