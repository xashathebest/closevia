import React from 'react'
import { Link as RouterLink, useLocation } from 'react-router-dom'
import {
  Box,
  VStack,
  IconButton,
  Tooltip,
  useColorModeValue,
  useColorMode,
  Image,
  Drawer,
  DrawerOverlay,
  DrawerContent,
  DrawerCloseButton,
  DrawerBody,
  DrawerHeader,
  Button,
} from '@chakra-ui/react'
import {
  ViewIcon,
  AddIcon,
  BellIcon,
  InfoIcon,
  SettingsIcon,
  RepeatIcon,
  StarIcon,
} from '@chakra-ui/icons'
import { useMobileNav } from '../contexts/MobileNavContext'
import { Badge as CBadge } from '@chakra-ui/react'
import { useRealtime } from '../contexts/RealtimeContext'
import { useAuth } from '../contexts/AuthContext'
import { FaUserCircle } from 'react-icons/fa'

const Sidebar: React.FC = () => {
  const location = useLocation()
  const { colorMode } = useColorMode()
  const logo = colorMode === 'dark' ? '/logo1.svg' : '/logo.svg'
  const bgColor = useColorModeValue('white', 'gray.800')
  const borderColor = useColorModeValue('gray.200', 'gray.700')
  const iconColor = useColorModeValue('gray.600', 'gray.300')
  const activeIconColor = useColorModeValue('brand.500', 'brand.300')
  const { isOpen, onOpen, onClose } = useMobileNav()
  const { offerCount, notificationCount } = useRealtime()
  const { user } = useAuth()

  // Separate items for desktop vs mobile to keep desktop unchanged
  const desktopNavItems = [
    { icon: InfoIcon, label: 'Home', path: '/' },
    { icon: ViewIcon, label: 'Dashboard', path: '/dashboard' },
    { icon: AddIcon, label: 'Add Product', path: '/add-product' },
    { icon: RepeatIcon, label: 'Offers', path: '/offers' },
    { icon: BellIcon, label: 'Notifications', path: '/notifications' },
    // Add admin link only for admin users
    ...(user?.role === 'admin' ? [{ icon: StarIcon, label: 'Admin', path: '/admin' }] : []),
    // Settings intentionally excluded here so we can render it at the bottom
  ]

  const mobileNavItems = [
    { icon: InfoIcon, label: 'Home', path: '/' },
    { icon: ViewIcon, label: 'Dashboard', path: '/dashboard' },
    { icon: AddIcon, label: 'Add Product', path: '/add-product' },
    { icon: RepeatIcon, label: 'Offers', path: '/offers' },
    { icon: BellIcon, label: 'Notifications', path: '/notifications' },
    // Add admin link only for admin users
    ...(user?.role === 'admin' ? [{ icon: StarIcon, label: 'Admin', path: '/admin' }] : []),
    { icon: SettingsIcon, label: 'Settings', path: '/settings' },
    { icon: FaUserCircle, label: 'Profile', path: '/profile' },
  ]
  
  return (
    <>
      {/* Drawer for mobile */}
      <Drawer isOpen={isOpen} placement="left" onClose={onClose}>
        <DrawerOverlay />
        <DrawerContent>
          <DrawerCloseButton />
          <DrawerHeader display="flex" alignItems="center" gap={3}>
            <Image
              src={logo}
              alt="Clovia"
              w="35px"
              h="35px"
              objectFit="contain"
              cursor="pointer"
              onClick={() => {
                window.location.href = '/'
                onClose()
              }}
            />
            <Box fontWeight="bold">Clovia</Box>
          </DrawerHeader>

          <DrawerBody>
            <VStack spacing={4} align="stretch" mt={4}>
              <Box p={2}>
                {/* Logo removed from here (now in DrawerHeader) */}
              </Box>

              {mobileNavItems.map((item) => {
                const Icon = item.icon
                const needsSoftBg = item.label === 'Add Product' || item.label === 'Notifications' || item.label === 'Settings'
                return (
                  <Button
                    key={item.path}
                    as={RouterLink}
                    to={item.path}
                    leftIcon={<Icon />}
                    variant="ghost"
                    justifyContent="flex-start"
                    onClick={onClose}
                    bg={needsSoftBg ? '#FFFFFF' : 'transparent'}
                    _hover={{ bg: needsSoftBg ? '#FFFFFF' : 'gray.100' }}
                  >
                    {item.label}
                  </Button>
                )
              })}
            </VStack>
          </DrawerBody>
        </DrawerContent>
      </Drawer>

      {/* Desktop sidebar - hidden on small screens */}
      <Box
        position="fixed"
        left={0}
        top={0}
        h="100vh"
        w="70px"
        bg={bgColor}
        borderRight="1px"
        borderColor={borderColor}
        zIndex={1000}
        py={4}
        display={{ base: 'none', lg: 'block' }} // hide on small screens
      >
        {/* make sidebar a column with space-between: logo+nav on top, settings at bottom */}
        <Box h="100%" display="flex" flexDirection="column" justifyContent="space-between" alignItems="center">
          <VStack spacing={5} align="center" mt={2}>
            {/* Logo/Brand */}
            <Box mb={2} p={2}>
              <Image
                src={logo}
                alt="Clovia"
                w="35px"
                h="35px"
                objectFit="contain"
                cursor="pointer"
                onClick={() => (window.location.href = '/')}
                _hover={{ opacity: 0.8 }}
                transition="opacity 0.2s"
              />
            </Box>

            {/* Navigation Items (exclude Settings) */}
            {desktopNavItems.map((item) => {
              const isActive = location.pathname === item.path
              const Icon = item.icon
              return (
                <Tooltip key={item.path} label={item.label} placement="right" hasArrow>
                  <Box position="relative" display="inline-block">
                    <IconButton
                      as={RouterLink}
                      to={item.path}
                      aria-label={item.label}
                      icon={<Icon />}
                      variant="ghost"
                      size="lg"
                      color={isActive ? activeIconColor : iconColor}
                      bg={isActive ? 'brand.50' : 'transparent'}
                      _hover={{
                        bg: isActive ? 'brand.100' : 'gray.100',
                        color: isActive ? activeIconColor : 'gray.700',
                      }}
                      _active={{
                        bg: isActive ? 'brand.200' : 'gray.200',
                      }}
                      borderRadius="xl"
                      transition="all 0.2s"
                    />
                    {(item.label === 'Offers' && offerCount > 0) && (
                      <CBadge position="absolute" right={0} top={0} transform="translate(30%, -30%)" colorScheme="purple" borderRadius="full">{offerCount}</CBadge>
                    )}
                    {(item.label === 'Notifications' && notificationCount > 0) && (
                      <CBadge position="absolute" right={0} top={0} transform="translate(30%, -30%)" colorScheme="red" borderRadius="full">{notificationCount}</CBadge>
                    )}
                  </Box>
                </Tooltip>
              )
            })}
          </VStack>

          {/* Settings at the bottom */}
          <Box mb={4}>
            <Tooltip label="Settings" placement="right" hasArrow>
              <IconButton
                as={RouterLink}
                to="/settings"
                aria-label="Settings"
                icon={<SettingsIcon />}
                variant="ghost"
                size="lg"
                color={location.pathname === '/settings' ? activeIconColor : iconColor}
                bg={location.pathname === '/settings' ? 'brand.50' : 'transparent'}
                _hover={{ bg: location.pathname === '/settings' ? 'brand.100' : 'gray.100' }}
                borderRadius="xl"
                transition="all 0.2s"
              />
            </Tooltip>
          </Box>
        </Box>
      </Box>
    </>
  )
}

export default Sidebar