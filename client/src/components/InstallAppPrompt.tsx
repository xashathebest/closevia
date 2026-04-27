import React from 'react'
import { Box, Button, HStack, Text, VStack, Icon } from '@chakra-ui/react'
import { FiDownload, FiSmartphone } from 'react-icons/fi'
import {
  isAppInstalled,
  isRunningStandalone,
  markInstallDismissed,
  wasInstallDismissed,
} from '../serviceWorkerRegistration'

interface InstallAppPromptProps {
  variant?: 'floating' | 'mobile-menu' | 'profile-menu'
  onInstalled?: () => void
}

const InstallAppPrompt: React.FC<InstallAppPromptProps> = ({
  variant = 'floating',
  onInstalled,
}) => {
  const [visible, setVisible] = React.useState(false)
  const [isAndroid, setIsAndroid] = React.useState(false)

  React.useEffect(() => {
    if (isAppInstalled() || isRunningStandalone() || wasInstallDismissed()) {
      setVisible(false)
      return
    }

    // Detect Android
    const userAgent = navigator.userAgent.toLowerCase()
    setIsAndroid(/android/.test(userAgent))

    const hideAfterInstall = () => setVisible(false)
    window.addEventListener('clovia:pwa-installed', hideAfterInstall)

    setVisible(/android/.test(userAgent))

    return () => {
      window.removeEventListener('clovia:pwa-installed', hideAfterInstall)
    }
  }, [])

  const handleDownloadAPK = () => {
    window.location.href = '/clovia.apk'
    onInstalled?.()
  }

  const handleDismiss = () => {
    markInstallDismissed()
    setVisible(false)
  }

  if (!visible) {
    return null
  }

  if (variant === 'mobile-menu') {
    return (
      <VStack align="stretch" spacing={2} w="full">
        <Button
          colorScheme="teal"
          variant="ghost"
          justifyContent="flex-start"
          onClick={handleDownloadAPK}
          leftIcon={<FiDownload />}
          minH="48px"
          w="full"
        >
          Download APK (2 MB)
        </Button>
      </VStack>
    )
  }

  if (variant === 'profile-menu') {
    return (
      <VStack align="stretch" spacing={1} w="full">
        <Button
          size="sm"
          w="full"
          variant="ghost"
          justifyContent="flex-start"
          onClick={handleDownloadAPK}
          leftIcon={<FiDownload />}
          whiteSpace="normal"
          h="auto"
          py={2}
          textAlign="left"
        >
          <VStack align="start" spacing={0}>
            <Text fontSize="sm" fontWeight="medium">Download APK</Text>
            <Text fontSize="xs" color="gray.500">Native app (2 MB)</Text>
          </VStack>
        </Button>
      </VStack>
    )
  }

  return (
    <Box
      position="fixed"
      left={4}
      right={4}
      bottom={4}
      bg="white"
      border="1px solid"
      borderColor="gray.200"
      borderRadius="12px"
      boxShadow="lg"
      p={4}
      zIndex={1400}
    >
      <VStack align="stretch" spacing={3}>
        <HStack spacing={2}>
          <Icon as={FiSmartphone} boxSize={5} color="teal.600" />
          <VStack align="start" spacing={0} flex={1}>
            <Text fontSize="sm" fontWeight="bold" color="gray.800">
              Get the Clovia App
            </Text>
            <Text fontSize="xs" color="gray.500">
              {isAndroid ? 'Download now for the best experience' : 'Install as app for full-screen'}
            </Text>
          </VStack>
          <Button size="xs" variant="ghost" onClick={handleDismiss}>
            Later
          </Button>
        </HStack>

        <HStack spacing={2}>
          <Button
            size="sm"
            colorScheme="teal"
            leftIcon={<FiDownload />}
            onClick={handleDownloadAPK}
            flex={1}
          >
            APK (2 MB)
          </Button>
        </HStack>
      </VStack>
    </Box>
  )
}

export default InstallAppPrompt
