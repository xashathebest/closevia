import React, { useState } from 'react'
import { Box, useToast } from '@chakra-ui/react'
import ProductUploadStep1 from './ProductUploadStep1'
import ProductUploadStep2 from './ProductUploadStep2'
import ProductUploadStep3 from './ProductUploadStep3'
import { useNavigate } from 'react-router-dom'
import { api } from '../services/api'

type UploadStep = 1 | 2 | 3

interface ProductData {
  images: File[]
  video?: File
  title: string
  description: string
  price: number
  category: string
  condition: string
  location: string
  allowBuying: boolean
  barterOnly: boolean
  wants: string
  wanted_categories: string[]
  show_estimated_value: boolean
  aiAnalysis?: {
    success: boolean
    provider: string
    retried: boolean
    time_ms: number
    data?: {
      title?: string
      description?: string
      condition?: string
      category?: string
      tags?: string[]
      estimated_value_min?: number
      estimated_value_max?: number
      authenticity_risks?: string[]
    }
  }
}

interface ProductUploadFlowProps {
  onSuccess?: (productId: number) => void
}

const ProductUploadFlow: React.FC<ProductUploadFlowProps> = ({ onSuccess }) => {
  const [currentStep, setCurrentStep] = useState<UploadStep>(1)
  const [isLoading, setIsLoading] = useState(false)
  const [productData, setProductData] = useState<ProductData>({
    images: [],
    title: '',
    description: '',
    price: 0,
    category: 'General',
    condition: 'Used',
    location: '',
    allowBuying: true,
    barterOnly: false,
    wants: '',
    wanted_categories: [],
    show_estimated_value: true,
  })

  const navigate = useNavigate()
  const toast = useToast()

  // Analyze product images with AI
  const analyzeProductImages = async (images: File[]) => {
    if (images.length === 0) return

    try {
      const formData = new FormData()
      images.slice(0, 3).forEach((image) => {
        formData.append('images', image)
      })

      const response = await api.post('/api/ai/analyze-product', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      })

      if (response.data.success) {
        return response.data
      }
    } catch (error) {
    }
    return null
  }

  // Step 1: Handle image/video upload
  const handleStep1Next = async (images: File[], video?: File) => {
    setProductData((prev) => ({
      ...prev,
      images,
      video,
    }))

    // Analyze images with AI in background
    const aiAnalysis = await analyzeProductImages(images)
    if (aiAnalysis?.success && aiAnalysis.data) {
      setProductData((prev) => ({
        ...prev,
        aiAnalysis,
        // Pre-fill with AI suggestions
        title: aiAnalysis.data.title || prev.title,
        description: aiAnalysis.data.description || prev.description,
        category: aiAnalysis.data.category || prev.category,
        condition: aiAnalysis.data.condition || prev.condition,
      }))

      toast({
        id: "productuploadflow-ai-analysis-complete",
        description: `Results from ${aiAnalysis.provider} (${aiAnalysis.time_ms}ms)${aiAnalysis.retried ? ' - Used backup AI' : ''}`,
        status: 'success',
        duration: 3,
        isClosable: true,
      })
    }

    setCurrentStep(2)
  }

  // Step 2: Handle details
  const handleStep2Next = (details: any) => {
    setProductData((prev) => ({
      ...prev,
      title: details.title,
      description: details.description,
      price: details.price,
      category: details.category,
      condition: details.condition,
      location: details.location,
      allowBuying: details.allowBuying,
      barterOnly: details.barterOnly,
      wants: details.wants,
      wanted_categories: details.wanted_categories,
    }))
    setCurrentStep(3)
  }

  // Step 3: Submit the product
  const handleStep3Submit = async () => {
    setIsLoading(true)
    try {
      // Create FormData for multipart upload
      const formData = new FormData()

      // Add images
      productData.images.forEach((image) => {
        formData.append('images', image)
      })

      // Add video if exists
      if (productData.video) {
        formData.append('video', productData.video)
      }

      // Add product details
      formData.append('title', productData.title)
      formData.append('description', productData.description)
      formData.append('price', productData.price.toString())
      formData.append('category', productData.category)
      formData.append('condition', productData.condition)
      formData.append('location', productData.location)
      formData.append('allow_buying', productData.allowBuying.toString())
      formData.append('barter_only', productData.barterOnly.toString())
      formData.append('wants', productData.wants)
      formData.append('wanted_categories', JSON.stringify(productData.wanted_categories))
      formData.append('show_estimated_value', productData.show_estimated_value ? 'true' : 'false')
      
      if (productData.aiAnalysis?.data?.estimated_value_min !== undefined) {
        formData.append('estimated_value_min', productData.aiAnalysis.data.estimated_value_min.toString())
      }
      if (productData.aiAnalysis?.data?.estimated_value_max !== undefined) {
        formData.append('estimated_value_max', productData.aiAnalysis.data.estimated_value_max.toString())
      }

      // Call API to create product
      const response = await api.post('/api/products', formData, {
        headers: {
          'Content-Type': 'multipart/form-data',
        },
      })

      toast({
        id: "productuploadflow-product-posted-successfully",
        title: '✓ Product posted successfully!',
        description: 'Your listing is now live',
        status: 'success',
        duration: 4,
        isClosable: true,
      })

      // Call success callback or navigate
      if (onSuccess && response.data.id) {
        onSuccess(response.data.id)
      } else {
        navigate('/products')
      }
    } catch (error: any) {
      console.error('Upload error:', error)
      toast({
        id: "productuploadflow-failed-to-post-product",
        title: 'Failed to post product',
        description: error?.response?.data?.message || 'Please try again',
        status: 'error',
        duration: 4,
        isClosable: true,
      })
    } finally {
      setIsLoading(false)
    }
  }

  // Navigation handlers
  const handleBack = () => {
    if (currentStep > 1) {
      setCurrentStep((prev) => (prev - 1) as UploadStep)
    } else {
      navigate(-1) // Go back to previous page
    }
  }

  return (
    <Box w="full" minH="100vh" bg="gray.50">
      {currentStep === 1 && (
        <ProductUploadStep1
          onNext={handleStep1Next}
          onBack={handleBack}
          isLoading={isLoading}
        />
      )}

      {currentStep === 2 && (
        <ProductUploadStep2
          onNext={handleStep2Next}
          onBack={() => setCurrentStep(1)}
          initialData={{
            title: productData.title,
            description: productData.description,
            price: productData.price,
            category: productData.category,
            condition: productData.condition,
            location: productData.location,
            allowBuying: productData.allowBuying,
            barterOnly: productData.barterOnly,
            wants: productData.wants,
            wanted_categories: productData.wanted_categories,
          }}
          aiAnalysis={productData.aiAnalysis}
          isLoading={isLoading}
        />
      )}

      {currentStep === 3 && (
        <ProductUploadStep3
          product={{
            images: productData.images.map((img) => URL.createObjectURL(img)),
            video: productData.video ? URL.createObjectURL(productData.video) : undefined,
            title: productData.title,
            description: productData.description,
            price: productData.price,
            category: productData.category,
            condition: productData.condition,
            location: productData.location,
            allowBuying: productData.allowBuying,
            barterOnly: productData.barterOnly,
            wants: productData.wants,
            wanted_categories: productData.wanted_categories,
            estimated_value_min: productData.aiAnalysis?.data?.estimated_value_min,
            estimated_value_max: productData.aiAnalysis?.data?.estimated_value_max,
            show_estimated_value: productData.show_estimated_value,
            isAnalyzing: isLoading,
          }}
          onToggleEstimateVisibility={(show) => setProductData((prev) => ({ ...prev, show_estimated_value: show }))}
          onSubmit={handleStep3Submit}
          onBack={() => setCurrentStep(2)}
          isLoading={isLoading}
        />
      )}
    </Box>
  )
}

export default ProductUploadFlow
