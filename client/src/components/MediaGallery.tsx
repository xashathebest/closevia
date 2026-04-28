import React, { useState, useEffect, useCallback } from 'react'
import {
  Box,
  HStack,
  Image,
  Badge,
  Center,
  Icon,
  IconButton,
  Button,
  Modal,
  ModalOverlay,
  ModalContent,
  ModalBody,
  ModalCloseButton,
  Text,
} from '@chakra-ui/react'
import { ChevronLeftIcon, ChevronRightIcon } from '@chakra-ui/icons'
import { FiPlay, FiStar } from 'react-icons/fi'
import useEmblaCarousel from 'embla-carousel-react'
import { getImageUrl, getFirstImage } from '../utils/imageUtils'

interface MediaItem {
  type: 'image' | 'video'
  url: string
  originalIndex: number
}

interface MediaGalleryProps {
  imageUrls: string[]
  videoUrl?: string
  productTitle: string
  productStatus: 'available' | 'sold' | 'traded' | 'locked' | 'suspended' | 'deleted'
  isPremium: boolean
  wishlistCount?: number
  condition?: string
  category?: string
  listedDate?: string
  isOwner: boolean
  onSetCover?: (imageIndex: number) => void
  isSettingCover?: boolean
  sharedTransitionName?: string
}

const MediaGallery: React.FC<MediaGalleryProps> = ({
  imageUrls,
  videoUrl,
  productTitle,
  productStatus,
  isPremium,
  wishlistCount,
  condition,
  category,
  listedDate,
  isOwner,
  onSetCover,
  isSettingCover,
  sharedTransitionName,
}) => {
  // Deduplicate image URLs
  const seen = new Set<string>()
  const uniqueImages: { url: string; originalIndex: number }[] = []
  imageUrls.forEach((rawUrl, i) => {
    const resolved = getImageUrl(rawUrl)
    if (!seen.has(resolved)) {
      seen.add(resolved)
      uniqueImages.push({ url: resolved, originalIndex: i })
    }
  })

  // Build unified media array: images first, then video
  const mediaItems: MediaItem[] = [
    ...uniqueImages.map((img) => ({
      type: 'image' as const,
      url: img.url,
      originalIndex: img.originalIndex,
    })),
    ...(videoUrl
      ? [{ type: 'video' as const, url: videoUrl, originalIndex: -1 }]
      : []),
  ]

  const [selectedIndex, setSelectedIndex] = useState(0)
  const [isZoomOpen, setIsZoomOpen] = useState(false)
  const [zoomIndex, setZoomIndex] = useState(0)

  const [emblaRef, emblaApi] = useEmblaCarousel({ loop: false, startIndex: 0 })

  // Sync selected index with embla
  useEffect(() => {
    if (!emblaApi) return
    const onSelect = () => setSelectedIndex(emblaApi.selectedScrollSnap())
    emblaApi.on('select', onSelect)
    return () => { emblaApi.off('select', onSelect) }
  }, [emblaApi])

  const scrollTo = useCallback(
    (index: number) => {
      if (emblaApi) emblaApi.scrollTo(index)
    },
    [emblaApi]
  )

  // Zoom modal — images only
  const imageOnlyItems = mediaItems.filter((m) => m.type === 'image')

  const openZoom = (mediaIndex: number) => {
    const item = mediaItems[mediaIndex]
    if (item.type !== 'image') return
    const imgIdx = imageOnlyItems.findIndex((m) => m.url === item.url)
    setZoomIndex(imgIdx >= 0 ? imgIdx : 0)
    setIsZoomOpen(true)
  }

  const nextZoomImage = () => {
    setZoomIndex((prev) => (prev + 1) % imageOnlyItems.length)
  }

  const prevZoomImage = () => {
    setZoomIndex(
      (prev) => (prev - 1 + imageOnlyItems.length) % imageOnlyItems.length
    )
  }

  const currentMedia = mediaItems[selectedIndex]

  return (
    <>
      {/* Main Viewer */}
      <Box position="relative" rounded="md" overflow="hidden" bg="gray.100">
        <Box ref={emblaRef} overflow="hidden">
          <Box display="flex">
            {mediaItems.map((item, index) => (
              <Box
                key={index}
                flex="0 0 100%"
                minW="0"
                h={{ base: '320px', md: '420px' }}
                position="relative"
              >
                {item.type === 'image' ? (
                  <Image
                    src={item.url}
                    alt={`${productTitle} ${index + 1}`}
                    w="full"
                    h="full"
                    objectFit="contain"
                    fallbackSrc="/placeholder.svg"
                    cursor="zoom-in"
                    onClick={() => openZoom(index)}
                    style={{ viewTransitionName: index === 0 ? sharedTransitionName : undefined }}
                  />
                ) : (
                  <Box w="full" h="full" bg="black">
                    <video
                      src={item.url}
                      controls
                      playsInline
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'contain',
                      }}
                    />
                  </Box>
                )}
              </Box>
            ))}
          </Box>
        </Box>

        {/* Top overlay chips */}
        <HStack
          position="absolute"
          top={{ base: 2, md: 3 }}
          left={{ base: 2, md: 3 }}
          right={{ base: 2, md: 3 }}
          spacing={{ base: 1.5, md: 2 }}
          zIndex={1}
          flexWrap="wrap"
          align="flex-start"
          p={0}
        >
          {isPremium && (
            <Badge display={{ base: 'none', md: 'inline-flex' }} colorScheme="orange" variant="subtle" px={{ base: 2, md: 2.5 }} py={{ base: 0.5, md: 1 }} fontSize={{ base: '2xs', md: 'xs' }} borderRadius="full" fontWeight="700">
              Premium
            </Badge>
          )}
          {typeof wishlistCount === 'number' && (
            <Badge display={{ base: 'none', md: 'inline-flex' }} colorScheme="brand" variant="subtle" px={{ base: 2, md: 2.5 }} py={{ base: 0.5, md: 1 }} fontSize={{ base: '2xs', md: 'xs' }} borderRadius="full" fontWeight="600">
              {wishlistCount} Saved
            </Badge>
          )}
          {condition && (
            <Badge colorScheme="blue" variant="subtle" px={{ base: 2, md: 2.5 }} py={{ base: 0.5, md: 1 }} fontSize={{ base: '2xs', md: 'xs' }} borderRadius="full" fontWeight="600">
              {condition}
            </Badge>
          )}
          {category && (
            <Badge colorScheme="purple" variant="subtle" px={{ base: 2, md: 2.5 }} py={{ base: 0.5, md: 1 }} fontSize={{ base: '2xs', md: 'xs' }} borderRadius="full" fontWeight="600">
              {category}
            </Badge>
          )}
          {listedDate && (
            <Badge display={{ base: 'none', md: 'inline-flex' }} colorScheme="gray" variant="subtle" px={{ base: 2, md: 2.5 }} py={{ base: 0.5, md: 1 }} fontSize={{ base: '2xs', md: 'xs' }} borderRadius="full" fontWeight="600">
              Listed {listedDate}
            </Badge>
          )}
          {productStatus !== 'available' && (
            <Badge
              colorScheme={productStatus === 'locked' ? 'orange' : 'red'}
              px={{ base: 2, md: 2.5 }}
              py={{ base: 0.5, md: 1 }}
              fontSize={{ base: '2xs', md: 'xs' }}
              borderRadius="full"
            >
              {productStatus}
            </Badge>
          )}
        </HStack>

        {/* Set as Cover */}
        {isOwner &&
          currentMedia?.type === 'image' &&
          currentMedia.originalIndex > 0 && (
            <Button
              size="xs"
              leftIcon={<FiStar />}
              onClick={() => onSetCover?.(currentMedia.originalIndex)}
              isLoading={isSettingCover}
              position="absolute"
              bottom={3}
              right={3}
              zIndex={1}
              bg="blackAlpha.700"
              color="white"
              _hover={{ bg: 'blackAlpha.800' }}
            >
              Set as cover
            </Button>
          )}

        {/* Slide counter */}
        {mediaItems.length > 1 && (
          <Badge
            position="absolute"
            bottom={3}
            left={3}
            zIndex={1}
            bg="blackAlpha.600"
            color="white"
            fontSize="xs"
            px={2}
            py={0.5}
            borderRadius="full"
          >
            {selectedIndex + 1} / {mediaItems.length}
          </Badge>
        )}
      </Box>

      {/* Thumbnail Strip */}
      {mediaItems.length > 1 && (
        <HStack spacing={3} overflowX="auto" py={1}>
          {mediaItems.map((item, index) => (
            <Box
              key={index}
              as="button"
              w="96px"
              h="96px"
              flexShrink={0}
              p={1}
              border="2px solid"
              borderColor={
                selectedIndex === index ? 'brand.500' : 'gray.200'
              }
              rounded="md"
              onClick={() => scrollTo(index)}
              position="relative"
              overflow="hidden"
              transition="border-color 0.15s"
              _hover={{ borderColor: selectedIndex === index ? 'brand.500' : 'gray.400' }}
            >
              {item.type === 'image' ? (
                <Image
                  src={item.url}
                  alt={`Thumbnail ${index + 1}`}
                  w="full"
                  h="full"
                  objectFit="cover"
                  fallbackSrc="/placeholder.svg"
                  borderRadius="sm"
                />
              ) : (
                <Center
                  w="full"
                  h="full"
                  bg="gray.700"
                  borderRadius="sm"
                >
                  <Icon as={FiPlay} color="white" boxSize={6} />
                </Center>
              )}
              {/* Video play icon overlay on thumbnail */}
              {item.type === 'video' && null}
            </Box>
          ))}
        </HStack>
      )}

      {/* Zoom Modal (images only) */}
      <Modal
        isOpen={isZoomOpen}
        onClose={() => setIsZoomOpen(false)}
        size="full"
        scrollBehavior="inside"
      >
        <ModalOverlay bg="blackAlpha.900" />
        <ModalContent bg="transparent" shadow="none" m={0}>
          <ModalCloseButton color="white" size="lg" zIndex={2} />
          <ModalBody
            display="flex"
            alignItems="center"
            justifyContent="center"
            p={0}
            position="relative"
          >
            {imageOnlyItems.length > 0 && (
              <Box
                maxW="90vw"
                maxH="90vh"
                display="flex"
                alignItems="center"
                justifyContent="center"
                position="relative"
              >
                <Image
                  src={imageOnlyItems[zoomIndex]?.url}
                  alt={`${productTitle} - Zoomed ${zoomIndex + 1}`}
                  maxW="full"
                  maxH="90vh"
                  objectFit="contain"
                />
                {imageOnlyItems.length > 1 && (
                  <>
                    <IconButton
                      aria-label="Previous image"
                      icon={<ChevronLeftIcon boxSize={8} />}
                      position="absolute"
                      left={{ base: '-4', md: '-12' }}
                      colorScheme="whiteAlpha"
                      color="white"
                      variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation()
                        prevZoomImage()
                      }}
                      _hover={{ bg: 'whiteAlpha.200' }}
                    />
                    <IconButton
                      aria-label="Next image"
                      icon={<ChevronRightIcon boxSize={8} />}
                      position="absolute"
                      right={{ base: '-4', md: '-12' }}
                      colorScheme="whiteAlpha"
                      color="white"
                      variant="ghost"
                      onClick={(e) => {
                        e.stopPropagation()
                        nextZoomImage()
                      }}
                      _hover={{ bg: 'whiteAlpha.200' }}
                    />
                    <Text
                      position="absolute"
                      bottom="-8"
                      color="white"
                      fontWeight="bold"
                    >
                      {zoomIndex + 1} / {imageOnlyItems.length}
                    </Text>
                  </>
                )}
              </Box>
            )}
          </ModalBody>
        </ModalContent>
      </Modal>
    </>
  )
}

export default MediaGallery
