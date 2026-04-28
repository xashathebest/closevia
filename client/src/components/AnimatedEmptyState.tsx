import React from 'react'
import { Box, Button, Flex, Heading, Icon, Text, VStack } from '@chakra-ui/react'
import { IconType } from 'react-icons'
import { motion, useReducedMotion } from 'framer-motion'
import { motionDurations, motionEasings } from '../utils/motion'

const MotionBox = motion(Box)

interface AnimatedEmptyStateProps {
  icon: IconType
  title: string
  description?: string
  actionLabel?: string
  onAction?: () => void
  colorScheme?: 'brand' | 'blue' | 'green' | 'red' | 'orange' | 'purple' | 'gray'
}

const AnimatedEmptyState: React.FC<AnimatedEmptyStateProps> = ({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  colorScheme = 'brand',
}) => {
  const prefersReducedMotion = useReducedMotion()

  return (
    <MotionBox
      py={14}
      px={4}
      textAlign="center"
      initial={prefersReducedMotion ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: motionDurations.uiSlow, ease: motionEasings.easeOut }}
    >
      <VStack spacing={4}>
        <MotionBox
          animate={prefersReducedMotion ? undefined : { y: [0, -3, 0] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
        >
          <Flex
            w="80px"
            h="80px"
            bg={`${colorScheme}.50`}
            color={`${colorScheme}.300`}
            borderRadius="full"
            align="center"
            justify="center"
            boxShadow="0 10px 30px rgba(0,0,0,0.06)"
          >
            <Icon as={icon} boxSize={8} />
          </Flex>
        </MotionBox>
        <VStack spacing={1.5}>
          <Heading size="md" color="gray.600">
            {title}
          </Heading>
          {description && (
            <Text color="gray.500" maxW="340px">
              {description}
            </Text>
          )}
        </VStack>
        {actionLabel && onAction && (
          <Button colorScheme={colorScheme === 'brand' ? 'brand' : colorScheme} onClick={onAction} borderRadius="full" mt={1}>
            {actionLabel}
          </Button>
        )}
      </VStack>
    </MotionBox>
  )
}

export default AnimatedEmptyState
