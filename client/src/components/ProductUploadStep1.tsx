import React, { useState, useRef, useCallback } from 'react'
import {
  Box,
  VStack,
  HStack,
  Text,
  Button,
  Badge,
  Icon,
  Flex,
  Progress,
  useToast,
  Spinner,
  Center,
  AspectRatio,
  Image,
  IconButton,
  Input,
  Divider,
  useBreakpointValue,
} from '@chakra-ui/react'
import { CloseIcon, AddIcon } from '@chakra-ui/icons'
import { MdVideocam, MdImage } from 'react-icons/md'

interface UploadedImage {
  id: string
  file: File
  preview: string
  isAnalyzed?: boolean
  isPrimary?: boolean
}

interface ProductUploadStep1Props {
  onNext: (images: File[], video?: File) => void
  onBack?: () => void
  isLoading?: boolean
}

const ProductUploadStep1: React.FC<ProductUploadStep1Props> = ({
  onNext,
  onBack,
  isLoading = false,
}) => {
  const [images, setImages] = useState<UploadedImage[]>([])
  const [video, setVideo] = useState<{ file: File; preview: string } | null>(null)
  const [dragActive, setDragActive] = useState(false)
  const [uploading, setUploading] = useState(false)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const videoInputRef = useRef<HTMLInputElement>(null)
  const toast = useToast()

  const isMobile = useBreakpointValue({ base: true, md: false })

  // Image upload handlers
  const handleImageDrag = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true)
    } else if (e.type === 'dragleave') {
      setDragActive(false)
    }
  }

  const processImages = (files: FileList | null) => {
    if (!files) return

    const newImages: UploadedImage[] = []

    Array.from(files).forEach((file, index) => {
      // Validate file
      if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
        toast({
        id: "productuploadstep1-invalid-file-type",
          title: 'Images only, please',
          description: 'Use a JPEG, PNG, or WebP file.',
          status: 'warning',
          duration: 3,
          isClosable: true,
        })
        return
      }

      if (file.size > 5 * 1024 * 1024) {
        toast({
        id: "productuploadstep1-file-too-large",
          title: 'File too large',
          description: 'Maximum file size is 5MB',
          status: 'error',
          duration: 3,
          isClosable: true,
        })
        return
      }

      // Check total count
      if (images.length + newImages.length >= 8) {
        toast({
        id: "productuploadstep1-maximum-images-exceeded",
          title: 'Maximum images exceeded',
          description: 'You can upload up to 8 images',
          status: 'warning',
          duration: 3,
          isClosable: true,
        })
        return
      }

      // Create preview
      const reader = new FileReader()
      reader.onload = (e) => {
        const id = `img-${Date.now()}-${index}`
        newImages.push({
          id,
          file,
          preview: e.target?.result as string,
          isPrimary: images.length + newImages.length === 1,
          isAnalyzed: false,
        })

        if (newImages.length === Array.from(files).length) {
          setImages((prev) => [...prev, ...newImages])
        }
      }
      reader.readAsDataURL(file)
    })
  }

  const handleImageDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
    processImages(e.dataTransfer.files)
  }

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    processImages(e.currentTarget.files)
  }

  const removeImage = (id: string) => {
    setImages((prev) => {
      const filtered = prev.filter((img) => img.id !== id)
      // Set first as primary if removed
      return filtered.length > 0
        ? filtered.map((img, idx) => ({ ...img, isPrimary: idx === 0 }))
        : filtered
    })
  }

  const setPrimaryImage = (id: string) => {
    setImages((prev) =>
      prev.map((img) => ({
        ...img,
        isPrimary: img.id === id,
      }))
    )
  }

  // Video upload handlers
  const handleVideoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.currentTarget.files?.[0]
    if (!file) return

    if (!['video/mp4', 'video/quicktime'].includes(file.type)) {
      toast({
        id: "productuploadstep1-invalid-file-type-2",
        title: 'Videos only here',
        description: 'Please use an MP4 or MOV file.',
        status: 'warning',
        duration: 3,
        isClosable: true,
      })
      return
    }

    if (file.size > 50 * 1024 * 1024) {
      toast({
        id: "productuploadstep1-file-too-large-2",
        title: 'File too large',
        description: 'Maximum video size is 50MB',
        status: 'error',
        duration: 3,
        isClosable: true,
      })
      return
    }

    const reader = new FileReader()
    reader.onload = (e) => {
      setVideo({
        file,
        preview: e.target?.result as string,
      })
    }
    reader.readAsDataURL(file)
  }

  const handleNext = () => {
    if (images.length === 0) {
      toast({
        id: "productuploadstep1-at-least-1-image-required",
        title: 'At least 1 image required',
        description: 'Please upload at least one product image',
        status: 'error',
        duration: 3,
        isClosable: true,
      })
      return
    }

    onNext(
      images.map((img) => img.file),
      video?.file
    )
  }

  return (
    <Box w="full" minH="100vh" bg="gray.50" pb={24}>
      {/* Progress Indicator */}
      <Box bg="white" borderBottomWidth="1px" borderColor="gray.200" position="sticky" top={0} zIndex={10}>
        <VStack spacing={0} maxW="container.md" mx="auto" p={{ base: 4, md: 6 }}>
          <HStack w="full" justify="space-between" mb={4}>
            <Text fontSize="xs" fontWeight="600" color="gray.500">
              Step 1 of 3
            </Text>
            <Text fontSize="xs" color="gray.400">
              Upload Media
            </Text>
          </HStack>

          {/* Step indicator dots */}
          <HStack w="full" spacing={2}>
            {['Upload Media', 'Details & Preferences', 'Review & Post'].map((step, idx) => (
              <Flex key={step} align="center" flex={1}>
                <Box
                  flex={1}
                  h="2px"
                  bg={idx === 0 ? 'brand.500' : idx < 0 ? 'brand.500' : 'gray.200'}
                  transition="all 0.3s ease"
                />
                <Box
                  w="8"
                  h="8"
                  rounded="full"
                  display="flex"
                  alignItems="center"
                  justifyContent="center"
                  bg={idx === 0 ? 'brand.500' : idx < 0 ? 'brand.500' : 'gray.200'}
                  color={idx === 0 ? 'white' : 'gray.500'}
                  fontWeight="bold"
                  fontSize="xs"
                  transition="all 0.3s ease"
                  ml={-1}
                  mr={-1}
                >
                  {idx + 1}
                </Box>
              </Flex>
            ))}
          </HStack>

          <Progress
            value={33}
            size="sm"
            w="full"
            mt={2}
            colorScheme="brand"
            rounded="full"
            hasStripe
          />
        </VStack>
      </Box>

      {/* Main Content */}
      <VStack spacing={6} maxW="container.md" mx="auto" p={{ base: 4, md: 6 }} align="stretch">
        {/* Image Upload Section */}
        <VStack spacing={4} align="stretch">
          <VStack spacing={1} align="start">
            <Text fontSize={{ base: 'md', md: 'lg' }} fontWeight="600" color="gray.900">
              Product Images
            </Text>
            <Text fontSize={{ base: 'sm', md: 'sm' }} color="gray.600">
              Upload clear, well-lit photos from multiple angles
            </Text>
          </VStack>

          {/* Upload Area */}
          <Box
            borderWidth="2px"
            borderStyle="dashed"
            borderColor={dragActive ? 'brand.500' : 'gray.300'}
            rounded="lg"
            p={{ base: 6, md: 8 }}
            transition="all 0.3s ease"
            bg={dragActive ? 'brand.50' : 'white'}
            cursor="pointer"
            onDragEnter={handleImageDrag}
            onDragLeave={handleImageDrag}
            onDragOver={handleImageDrag}
            onDrop={handleImageDrop}
            onClick={() => imageInputRef.current?.click()}
            _hover={{
              borderColor: 'brand.500',
              bg: 'brand.50',
            }}
          >
            <Input
              ref={imageInputRef}
              type="file"
              multiple
              accept="image/jpeg,image/png,image/webp"
              onChange={handleImageSelect}
              display="none"
            />

            <Center flexDirection="column" gap={3}>
              <Icon
                as={MdImage}
                w={12}
                h={12}
                color={dragActive ? 'brand.500' : 'gray.400'}
                transition="all 0.2s ease"
              />

              <VStack spacing={1}>
                <Text fontWeight="600" color="gray.800" textAlign="center">
                  Click to upload or drag & drop
                </Text>
                <Text fontSize="sm" color="gray.500" textAlign="center">
                  JPEG, PNG or WebP • max 5MB each • up to 8 images
                </Text>
              </VStack>

              {uploading && <Spinner size="sm" color="brand.500" mt={2} />}
            </Center>
          </Box>

          {/* Image Count */}
          <HStack justify="space-between" fontSize="sm">
            <Text color="gray.600">
              <Text as="span" fontWeight="600" color="brand.500">
                {images.length}
              </Text>
              /8 images uploaded
            </Text>
            {images.length < 8 && (
              <Button
                variant="ghost"
                size="sm"
                colorScheme="brand"
                leftIcon={<AddIcon />}
                onClick={() => imageInputRef.current?.click()}
              >
                Add More
              </Button>
            )}
          </HStack>

          {/* Thumbnails */}
          {images.length > 0 && (
            <Box
              overflowX="auto"
              pb={2}
              sx={{
                '&::-webkit-scrollbar': {
                  height: '4px',
                },
                '&::-webkit-scrollbar-track': {
                  bg: 'gray.100',
                  rounded: 'full',
                },
                '&::-webkit-scrollbar-thumb': {
                  bg: 'gray.400',
                  rounded: 'full',
                },
              }}
            >
              <HStack spacing={3} minW="min-content">
                {images.map((img, idx) => (
                  <Box key={img.id} position="relative" minW="20" onClick={() => setPrimaryImage(img.id)}>
                    <AspectRatio
                      ratio={1}
                      w="20"
                      rounded="md"
                      overflow="hidden"
                      border={img.isPrimary ? '3px solid' : '1px solid'}
                      borderColor={img.isPrimary ? 'brand.500' : 'gray.200'}
                      cursor="pointer"
                      transition="all 0.2s ease"
                      _hover={{
                        borderColor: 'brand.500',
                        opacity: 0.8,
                      }}
                    >
                      <Image src={img.preview} alt={`Product ${idx + 1}`} objectFit="cover" />
                    </AspectRatio>

                    {/* Primary badge */}
                    {img.isPrimary && (
                      <Badge
                        position="absolute"
                        top={1}
                        left={1}
                        bg="brand.500"
                        color="white"
                        fontSize="xs"
                        rounded="sm"
                      >
                        Primary
                      </Badge>
                    )}

                    {/* AI analyzed badge (when applicable) */}
                    {img.isAnalyzed && (
                      <Badge
                        position="absolute"
                        bottom={1}
                        left={1}
                        bg="green.500"
                        color="white"
                        fontSize="xs"
                        rounded="sm"
                      >
                        ✓ Analyzed
                      </Badge>
                    )}

                    {/* Remove button */}
                    <IconButton
                      aria-label="Remove image"
                      icon={<CloseIcon />}
                      position="absolute"
                      top={1}
                      right={1}
                      size="xs"
                      rounded="full"
                      bg="blackAlpha.700"
                      color="white"
                      _hover={{ bg: 'blackAlpha.900' }}
                      onClick={(e) => {
                        e.stopPropagation()
                        removeImage(img.id)
                      }}
                    />
                  </Box>
                ))}
              </HStack>
            </Box>
          )}
        </VStack>

        <Divider />

        {/* Video Upload Section */}
        <VStack spacing={4} align="stretch" bg="blue.50" p={4} rounded="lg" borderWidth="1px" borderColor="blue.100">
          <HStack>
            <Icon as={MdVideocam} w={5} h={5} color="blue.500" />
            <VStack spacing={0} align="start" flex={1}>
              <Text fontSize="sm" fontWeight="600" color="gray.900">
                Product Video (Optional)
              </Text>
              <Text fontSize="xs" color="gray.600">
                5–15 second video • MP4/MOV • max 50MB
              </Text>
            </VStack>
          </HStack>

          {!video ? (
            <Button
              leftIcon={<MdImage />}
              colorScheme="blue"
              variant="outline"
              size="sm"
              w="full"
              onClick={() => videoInputRef.current?.click()}
            >
              Upload Video
            </Button>
          ) : (
            <HStack spacing={3} bg="white" p={3} rounded="md" borderWidth="1px" borderColor="gray.200">
              <AspectRatio ratio={16 / 9} w="24" h="fit-content" rounded="sm" overflow="hidden">
                <Box position="relative" bg="gray.900">
                  <video src={video.preview} style={{ width: '100%', height: '100%' }} />
                  <Center position="absolute" inset={0} bg="blackAlpha.400">
                    {/* Video preview */}
                  </Center>
                </Box>
              </AspectRatio>

              <VStack align="start" flex={1} spacing={2}>
                <Text fontSize="sm" fontWeight="500" noOfLines={1}>
                  {video.file.name}
                </Text>
                <Text fontSize="xs" color="gray.500">
                  {(video.file.size / 1024 / 1024).toFixed(2)} MB
                </Text>
                <Button
                  size="xs"
                  colorScheme="red"
                  variant="ghost"
                  onClick={() => {
                    setVideo(null)
                    videoInputRef.current!.value = ''
                  }}
                >
                  Remove
                </Button>
              </VStack>
            </HStack>
          )}

          <Input
            ref={videoInputRef}
            type="file"
            accept="video/mp4,video/quicktime"
            onChange={handleVideoSelect}
            display="none"
          />
        </VStack>
      </VStack>

      {/* Bottom Navigation - Fixed */}
      <Box
        position="fixed"
        bottom={0}
        left={0}
        right={0}
        bg="white"
        borderTopWidth="1px"
        borderColor="gray.200"
        p={4}
        maxW="container.md"
        mx="auto"
        w="full"
      >
        <HStack spacing={3}>
          <Button
            variant="ghost"
            leftIcon={<CloseIcon />}
            w="full"
            onClick={onBack}
            isDisabled={isLoading}
          >
            Back
          </Button>

          <Button
            colorScheme="brand"
            w="full"
            onClick={handleNext}
            isLoading={isLoading}
            rightIcon={<AddIcon />}
          >
            Next
          </Button>
        </HStack>
      </Box>
    </Box>
  )
}

export default ProductUploadStep1
