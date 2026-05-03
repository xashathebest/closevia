import React from 'react'
import { Box, Skeleton, Grid, VStack, HStack } from '@chakra-ui/react'

export const ProductSkeleton: React.FC = () => {
  return (
    <Box
      borderRadius="lg"
      overflow="hidden"
      bg="white"
      boxShadow="sm"
      h="full"
      transition="all 0.2s"
      _hover={{ boxShadow: 'md' }}
    >
      {/* Image skeleton */}
      <Box position="relative" w="full" pt="100%">
        <Skeleton position="absolute" top={0} left={0} w="100%" h="100%" />
      </Box>

      {/* Content skeleton */}
      <VStack p={3} spacing={2} align="stretch">
        {/* Seller info */}
        <HStack spacing={2}>
          <Skeleton borderRadius="full" w={8} h={8} />
          <Skeleton h={4} w="40%" />
        </HStack>

        {/* Title */}
        <VStack spacing={1} align="stretch">
          <Skeleton h={5} w="100%" />
          <Skeleton h={4} w="80%" />
        </VStack>

        {/* Description */}
        <VStack spacing={1} align="stretch">
          <Skeleton h={3} w="100%" />
          <Skeleton h={3} w="90%" />
        </VStack>

        {/* Buttons */}
        <HStack spacing={2} mt="auto" pt={2}>
          <Skeleton h={8} flex={1} />
          <Skeleton h={8} flex={1} />
        </HStack>
      </VStack>
    </Box>
  )
}

interface ProductGridSkeletonProps {
  count?: number
}

export const ProductGridSkeleton: React.FC<ProductGridSkeletonProps> = ({ count = 12 }) => {
  return (
    <Grid
      templateColumns={{
        base: 'repeat(2, 1fr)',
        sm: 'repeat(3, 1fr)',
        lg: 'repeat(4, 1fr)',
        xl: 'repeat(5, 1fr)',
      }}
      gap={{ base: 2, md: 3, lg: 4, xl: 5 }}
      w="full"
    >
      {Array.from({ length: count }).map((_, idx) => (
        <ProductSkeleton key={idx} />
      ))}
    </Grid>
  )
}
