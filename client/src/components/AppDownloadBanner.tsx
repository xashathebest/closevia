import React from 'react'
import { Box, Button, HStack, VStack, Text, CloseButton, Icon } from '@chakra-ui/react'
import { FiDownload, FiSmartphone } from 'react-icons/fi'
import {
  isAppInstalled,
  isRunningStandalone,
  markInstallDismissed,
  wasInstallDismissed,
} from '../serviceWorkerRegistration'

interface AppDownloadBannerProps {
  position?: 'top' | 'bottom'
  variant?: 'banner' | 'card'
}

const AppDownloadBanner: React.FC<AppDownloadBannerProps> = ({
  position = 'top',
  variant = 'banner',
}) => {
  const [dismissed, setDismissed] = React.useState(false)
  const [isAndroid, setIsAndroid] = React.useState(false)

  React.useEffect(() => {
    if (isAppInstalled() || isRunningStandalone() || wasInstallDismissed()) {
      setDismissed(true)
      return
    }

    const isDismissed = localStorage.getItem('app-download-banner-dismissed')
    if (isDismissed) {
      setDismissed(true)
      return
    }

    // Detect Android
    const userAgent = navigator.userAgent.toLowerCase()
    setIsAndroid(/android/.test(userAgent))

    const hideAfterInstall = () => setDismissed(true)
    window.addEventListener('clovia:pwa-installed', hideAfterInstall)

    return () => {
      window.removeEventListener('clovia:pwa-installed', hideAfterInstall)
    }
  }, [])

  const handleDismiss = () => {
    setDismissed(true)
    localStorage.setItem('app-download-banner-dismissed', 'true')
    markInstallDismissed()
  }

  const handleDownloadAPK = () => {
    window.location.href = '/clovia.apk'
  }

  if (dismissed || isAppInstalled() || !isAndroid) {
    return null
  }

  const positionProps = position === 'top' 
    ? { top: 0, left: 0, right: 0 }
    : { bottom: 4, left: 4, right: 4 }

  if (variant === 'card') {
    return (
      <Box
        position={position === 'bottom' ? 'fixed' : 'relative'}
        {...positionProps}
        bg="linear-gradient(135deg, #319795 0%, #2c7a7b 100%)"
        borderRadius={position === 'top' ? '0' : '12px'}
        p={4}
        mb={position === 'bottom' ? 0 : 4}
        color="white"
        boxShadow="lg"
        zIndex={40}
        display={{ base: 'block', md: 'none' }}
      >
        <HStack justify="space-between" align="flex-start" spacing={4}>
          <VStack align="start" spacing={2} flex={1}>
            <HStack spacing={2}>
              <Icon as={FiSmartphone} boxSize={5} />
              <Text fontWeight="bold" fontSize="lg">
                Get the Real App
              </Text>
            </HStack>
            <Text fontSize="sm" opacity={0.9}>
              {isAndroid 
                ? 'Download the Android APK for the most reliable app install.'
                : 'The Android APK is the supported app download right now.'}
            </Text>
          </VStack>
          <CloseButton 
            onClick={handleDismiss}
            size="lg"
            _hover={{ bg: 'rgba(255,255,255,0.2)' }}
            flexShrink={0}
          />
        </HStack>
        
        <HStack spacing={3} mt={4}>
          <Button
            size="sm"
            bg="white"
            color="teal.600"
            fontWeight="bold"
            leftIcon={<FiDownload />}
            onClick={handleDownloadAPK}
            _hover={{ bg: 'gray.100' }}
          >
            Download APK (2 MB)
          </Button>
          <Button
            size="sm"
            variant="outline"
            borderColor="white"
            color="white"
            _hover={{ bg: 'rgba(255,255,255,0.1)' }}
            onClick={handleDismiss}
          >
            Maybe Later
          </Button>
        </HStack>
      </Box>
    )
  }

  // Default banner variant
  return (
    <Box
      bg="linear-gradient(135deg, #319795 0%, #2c7a7b 100%)"
      color="white"
      p={3}
      borderRadius="8px"
      mb={4}
      position="relative"
      display={{ base: 'block', md: 'none' }}
    >
      <HStack justify="space-between" align="center" spacing={4}>
        <HStack spacing={2} flex={1}>
          <Icon as={FiSmartphone} />
          <VStack align="start" spacing={0}>
            <Text fontWeight="bold" fontSize="sm">Download CloviaPH</Text>
            <Text fontSize="xs" opacity={0.85}>
              {isAndroid 
                ? 'Android APK - direct install'
                : 'Android APK download'}
            </Text>
          </VStack>
        </HStack>

        <HStack spacing={2} flexShrink={0}>
          <Button
            size="xs"
            bg="white"
            color="teal.600"
            fontWeight="bold"
            leftIcon={<FiDownload />}
            onClick={handleDownloadAPK}
            _hover={{ bg: 'gray.100' }}
          >
            APK
          </Button>
          <CloseButton 
            size="sm"
            onClick={handleDismiss}
            _hover={{ bg: 'rgba(255,255,255,0.2)' }}
          />
        </HStack>
      </HStack>
    </Box>
  )
}

export default AppDownloadBanner
