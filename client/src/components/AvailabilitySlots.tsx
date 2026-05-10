import React from 'react'
import { Box, Badge, HStack, Text, VStack, Icon } from '@chakra-ui/react'
import { FaClock, FaLock, FaMoon } from 'react-icons/fa'
import { AvailabilitySlot } from '../types'
import { formatSlotDisplay, isSlotOpen } from '../utils/availabilityUtils'

interface Props {
  slots: AvailabilitySlot[]
  availabilityType?: 'flexible' | 'strict'
  compact?: boolean
}

const AvailabilitySlots: React.FC<Props> = ({ slots, availabilityType, compact }) => {
  if (!slots || slots.length === 0) return null

  const upcoming = slots.filter(s => isSlotOpen(s)).slice(0, compact ? 2 : slots.length)
  if (upcoming.length === 0) return null

  if (compact) {
    const first = formatSlotDisplay(upcoming[0])
    return (
      <HStack spacing={1} flexWrap="wrap">
        <Icon as={FaClock} color="teal.500" boxSize={3} />
        <Text fontSize="10px" color="teal.700" fontWeight="semibold" noOfLines={1}>
          {first.label}
        </Text>
        {first.overnight && (
          <Icon as={FaMoon} color="purple.400" boxSize={2.5} title="Ends next day" />
        )}
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
        {upcoming.map(slot => {
          const display = formatSlotDisplay(slot)
          return (
            <HStack
              key={slot.id}
              spacing={2}
              p={2}
              bg="teal.50"
              borderRadius="md"
              borderLeft="3px solid"
              borderLeftColor="teal.400"
              align="start"
            >
              <Icon as={FaClock} color="teal.500" boxSize={3} flexShrink={0} mt="1px" />
              <Box flex={1} minW={0}>
                <Text fontSize="xs" color="teal.800" fontWeight="medium">
                  {display.dateLabel}, {display.timeRange}
                </Text>
                {display.overnight && (
                  <HStack spacing={1} mt={0.5}>
                    <Icon as={FaMoon} color="purple.500" boxSize={2.5} />
                    <Text fontSize="9px" color="purple.600" fontWeight="600">
                      Ends next day
                    </Text>
                  </HStack>
                )}
              </Box>
            </HStack>
          )
        })}
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

// Keep named export for any callers that imported formatSlot directly.
export const formatSlot = (slot: AvailabilitySlot): string =>
  formatSlotDisplay(slot).label
