import React, { useEffect, useState } from 'react'
import { Badge, HStack, Icon, Tooltip } from '@chakra-ui/react'
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
          params: { user_id: userId },
        })
        if (response.data.success) {
          setMetrics(response.data.data)
        }
      } catch {
        // Metrics are optional.
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
      case 'average': return 'gray'
      case 'poor': return 'gray'
      default: return 'gray'
    }
  }

  const getLabel = () => {
    switch (metrics.rating) {
      case 'excellent': return 'Quick responder'
      case 'good': return 'Responsive trader'
      case 'average': return 'Usually responds'
      case 'poor': return 'Response varies'
      default: return 'Response info'
    }
  }

  const formatResponseTime = () => {
    if (metrics.average_response_time_hours < 1) {
      return `${Math.round(metrics.average_response_time_mins)}m`
    }
    if (metrics.average_response_time_hours < 24) {
      return `${Math.round(metrics.average_response_time_hours)}h`
    }
    return `${Math.round(metrics.average_response_time_hours / 24)}d`
  }

  const tooltipText = showDetails
    ? `Response rate: ${(metrics.response_rate * 100).toFixed(0)}% | Avg response: ${formatResponseTime()}`
    : `${getLabel()} - ${formatResponseTime()} avg response`

  return (
    <Tooltip label={tooltipText}>
      <Badge colorScheme={getColorScheme()} variant="subtle" fontSize="xs" textTransform="none">
        <HStack spacing={1}>
          <Icon as={FaClock} />
          <span>{getLabel()}</span>
        </HStack>
      </Badge>
    </Tooltip>
  )
}

export default ResponseMetricsBadge
