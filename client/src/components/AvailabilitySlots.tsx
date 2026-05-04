import React from 'react'
import { Box, Badge, HStack, Text, VStack, Icon } from '@chakra-ui/react'
import { FaClock, FaLock } from 'react-icons/fa'
import { AvailabilitySlot } from '../types'

interface Props {
  slots: AvailabilitySlot[]
  availabilityType?: 'flexible' | 'strict'
  compact?: boolean
}

function formatSlot(slot: AvailabilitySlot): string {
  const dayLabels: Record<string, string> = {
    monday: 'Mon',
    tuesday: 'Tue',
    wednesday: 'Wed',
    thursday: 'Thu',
    friday: 'Fri',
    saturday: 'Sat',
    sunday: 'Sun',
  }
  const date = new Date(`${slot.date}T00:00:00`)
  const recurringDays = slot.mode === 'recurring' && Array.isArray(slot.weekdays)
    ? slot.weekdays.map(day => dayLabels[day] || day).join(', ')
    : ''
  const dateStr = recurringDays || date.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', weekday: 'short' })
  const fmt = (t: string) => {
    const [h, m] = t.split(':').map(Number)
    const ampm = h >= 12 ? 'PM' : 'AM'
    const hour = h % 12 || 12
    return m === 0 ? `${hour}${ampm}` : `${hour}:${String(m).padStart(2, '0')}${ampm}`
  }
  return `${dateStr}, ${fmt(slot.start_time)}–${fmt(slot.end_time)}`
}

const parseLocalDateTime = (date: string, time: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null
  const [year, month, day] = date.split('-').map(Number)
  const [hour, minute] = time.split(':').map(Number)
  const parsed = new Date(year, month - 1, day, hour, minute, 0, 0)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

const isSlotStillOpen = (slot: AvailabilitySlot, now = new Date()) => {
  const end = parseLocalDateTime(slot.date, slot.end_time || slot.start_time)
  return end ? end > now : false
}

const AvailabilitySlots: React.FC<Props> = ({ slots, availabilityType, compact }) => {
  if (!slots || slots.length === 0) return null

  const upcoming = slots.filter(s => isSlotStillOpen(s)).slice(0, compact ? 2 : slots.length)

  if (upcoming.length === 0) return null

  if (compact) {
    return (
      <HStack spacing={1} flexWrap="wrap">
        <Icon as={FaClock} color="teal.500" boxSize={3} />
        <Text fontSize="10px" color="teal.700" fontWeight="semibold" noOfLines={1}>
          {formatSlot(upcoming[0])}
        </Text>
        {upcoming.length > 1 && (
          <Badge colorScheme="teal" fontSize="8px">+{upcoming.length - 1}</Badge>
        )}
        {availabilityType === 'strict' && (
          <Icon as={FaLock} color="orange.400" boxSize={2.5} />
        )}
      </HStack>
    )
  }

  return (
    <Box>
      <HStack mb={2} spacing={2}>
        <Icon as={FaClock} color="teal.500" boxSize={3.5} />
        <Text fontSize="xs" fontWeight="bold" color="teal.700" textTransform="uppercase" letterSpacing="0.5px">
          Availability Schedule
        </Text>
        <Badge colorScheme={availabilityType === 'strict' ? 'orange' : 'teal'} fontSize="9px">
          {availabilityType === 'strict' ? 'Strict' : 'Flexible'}
        </Badge>
      </HStack>
      <VStack align="stretch" spacing={1.5}>
        {upcoming.map(slot => (
          <HStack key={slot.id} spacing={2} p={2} bg="teal.50" borderRadius="md" borderLeft="3px solid" borderLeftColor="teal.400">
            <Icon as={FaClock} color="teal.500" boxSize={3} flexShrink={0} />
            <Text fontSize="xs" color="teal.800" fontWeight="medium">{formatSlot(slot)}</Text>
          </HStack>
        ))}
      </VStack>
      {availabilityType === 'strict' && (
        <Text fontSize="9px" color="orange.600" mt={1.5}>
          <Icon as={FaLock} boxSize={2.5} mr={1} />
          Strict: meetup must be within these slots.
        </Text>
      )}
    </Box>
  )
}

export default AvailabilitySlots
export { formatSlot }
