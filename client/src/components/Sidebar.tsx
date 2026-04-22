import React, { useMemo, useCallback, useEffect, useRef, useState } from 'react'
import { Link as RouterLink, useLocation, useNavigate } from 'react-router-dom'
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
  Divider,
  Avatar,
  Center,
  Flex,
  Text,
  Icon,
} from '@chakra-ui/react'
import {
  AddIcon,
  BellIcon,
  SettingsIcon,
  RepeatIcon,
} from '@chakra-ui/icons'
import { useMobileNav } from '../contexts/MobileNavContext'
import { Badge as CBadge } from '@chakra-ui/react'
import { useRealtime } from '../contexts/RealtimeContext'
import { useAuth } from '../contexts/AuthContext'
import { FaHome, FaPlus, FaStar, FaMotorcycle, FaCrown } from 'react-icons/fa'
import { FiGrid, FiHeart, FiLogOut, FiBell, FiSettings, FiUser, FiDownload } from 'react-icons/fi'
import { getImageUrl } from '../utils/imageUtils'
import VerifiedAvatar from './VerifiedAvatar'
import InstallAppPrompt from './InstallAppPrompt'
import { api } from '../services/api'
import { isRunningStandalone } from '../serviceWorkerRegistration'

const Sidebar: React.FC = () => {
  const location = useLocation()
  const navigate = useNavigate()
  const { colorMode } = useColorMode()
  const logo = colorMode === 'dark' ? '/logo1.svg' : '/logo.svg'
  const bgColor = useColorModeValue('white', 'gray.800')
  const borderColor = useColorModeValue('gray.200', 'gray.700')
  const iconColor = useColorModeValue('gray.600', 'gray.300')
  const activeIconColor = useColorModeValue('brand.500', 'brand.300')
  const mobileUserCardBg = useColorModeValue('brand.50', 'gray.700')
  const { isOpen, onOpen, onClose } = useMobileNav()
  const { notificationCount } = useRealtime()
  const { user, token, logout } = useAuth()
  const [riderStatus, setRiderStatus] = useState<{ is_rider: boolean; status?: string } | null>(null)
  const [touchStart, setTouchStart] = useState<number | null>(null)
  const [isStandalone, setIsStandalone] = useState(false)
  // Vertical swipe-to-dismiss for the bottom sheet drawer
  const dragStartYRef = useRef<number | null>(null)
  const dragDeltaRef = useRef<number>(0)
  const [dragOffset, setDragOffset] = useState(0)

  useEffect(() => {
    setIsStandalone(isRunningStandalone())
  }, [])

  useEffect(() => {
    let mounted = true

    const fetchRiderStatus = async () => {
      if (!user || !token) {
        setRiderStatus(null)
        return
      }
      try {
        const res = await api.get('/api/deliveries/rider-status')
        if (mounted && res.data?.success) {
          setRiderStatus(res.data.data)
        }
      } catch {
        if (mounted) {
          setRiderStatus(null)
        }
      }
    }

    fetchRiderStatus()
    return () => {
      mounted = false
    }
  }, [user, token])

  // Handle swipe to open menu
  const handleTouchStart = useCallback((e: TouchEvent) => {
    // Only detect swipe from left edge (first 50px)
    if (e.touches[0].clientX < 50) {
      setTouchStart(e.touches[0].clientX)
    }
  }, [])

  const handleTouchEnd = useCallback((e: TouchEvent) => {
    if (touchStart === null) return

    const touchEnd = e.changedTouches[0].clientX
    const diff = touchEnd - touchStart

    // If swiped right more than 80px, open menu
    if (diff > 80) {
      onOpen()
    }

    setTouchStart(null)
  }, [touchStart, onOpen])

  useEffect(() => {
    document.addEventListener('touchstart', handleTouchStart, false)
    document.addEventListener('touchend', handleTouchEnd, false)

    return () => {
      document.removeEventListener('touchstart', handleTouchStart, false)
      document.removeEventListener('touchend', handleTouchEnd, false)
    }
  }, [handleTouchStart, handleTouchEnd])

  // Intercept the hardware/browser back button while the drawer is open so
  // Android doesn't exit the app. We push a throwaway history entry on open,
  // consume it on close, and close the drawer when popstate fires.
  useEffect(() => {
    if (!isOpen) return

    window.history.pushState({ sidebarOpen: true }, '')
    const handlePopState = () => {
      onClose()
    }
    window.addEventListener('popstate', handlePopState)

    return () => {
      window.removeEventListener('popstate', handlePopState)
      // If the drawer was closed by UI (overlay / menu tap), the throwaway
      // entry is still on the stack — pop it so the user isn't "stuck" on it.
      if (window.history.state && (window.history.state as any).sidebarOpen) {
        window.history.back()
      }
    }
  }, [isOpen, onClose])

  // Vertical swipe-to-dismiss on the bottom sheet
  const handleSheetTouchStart = useCallback((e: React.TouchEvent) => {
    dragStartYRef.current = e.touches[0].clientY
    dragDeltaRef.current = 0
  }, [])

  const handleSheetTouchMove = useCallback((e: React.TouchEvent) => {
    if (dragStartYRef.current === null) return
    const delta = e.touches[0].clientY - dragStartYRef.current
    // Only react to downward drags; clamp so the sheet doesn't jump up
    if (delta > 0) {
      dragDeltaRef.current = delta
      setDragOffset(delta)
    }
  }, [])

  const handleSheetTouchEnd = useCallback(() => {
    if (dragStartYRef.current === null) return
    const delta = dragDeltaRef.current
    dragStartYRef.current = null
    dragDeltaRef.current = 0
    setDragOffset(0)
    if (delta > 100) {
      onClose()
    }
  }, [onClose])

  // Memoize callback handlers to prevent unnecessary re-renders
  const handleLogoClick = useCallback(() => {
    navigate('/landing')
    onClose()
  }, [navigate, onClose])

  const handleCompanyClick = useCallback(() => {
    navigate('/company')
    onClose()
  }, [navigate, onClose])

  const handleLogout = useCallback(async () => {
    onClose()
    await logout()
    navigate('/login')
  }, [onClose, logout, navigate])

  // Memoize desktop navigation items to prevent recalculation
  const desktopNavItems = useMemo(() => {
    const items = [
      { icon: FaHome, label: 'Home', path: '/home' },
    ]
    if (user) {
      if (user?.role === 'admin') {
        items.push({ icon: FaStar, label: 'Admin', path: '/admin' })
      } else {
        items.push(
          { icon: FiGrid, label: 'Dashboard', path: '/dashboard' },
          { icon: FaPlus, label: 'Add Product', path: '/add-product' },
          { icon: FiHeart, label: 'Saved', path: '/saved-products' },
        )
      }
      items.push(
        { icon: FiBell, label: 'Notifications', path: '/notifications' }
      )
    }
    return items
  }, [user])

  // Memoize mobile navigation items to prevent recalculation
  const mobileNavItems = useMemo(() => {
    if (user) {
      const items: { icon: any; label: string; path: string }[] = []
      if (user?.role === 'admin') {
        items.push({ icon: FaStar, label: 'Admin', path: '/admin' })
      }
      items.push(
        { icon: FiGrid, label: 'Organizations', path: '/organizations' },
        {
          icon: FaMotorcycle,
          label: riderStatus?.is_rider && riderStatus?.status === 'approved' ? 'Rider Dashboard' : 'Apply as Rider',
          path: riderStatus?.is_rider && riderStatus?.status === 'approved' ? '/rider-home' : '/rider-application'
        },
        {
          icon: FaCrown,
          label: (user as any)?.is_premium ? 'Premium' : 'Apply as Premium',
          path: '/premium'
        },
        { icon: FiBell, label: 'Notifications', path: '/notifications' },
        { icon: FiSettings, label: 'Settings', path: '/settings' },
      )
      return items
    }
    return [
      { icon: FaHome, label: 'Home', path: '/home' },
      { icon: FiUser, label: 'Login', path: '/login' },
    ]
  }, [user, riderStatus])

  return (
    <>
      {/* Bottom Sheet Drawer for mobile */}
      <Drawer isOpen={isOpen} placement="bottom" onClose={onClose} closeOnOverlayClick={true}>
        <DrawerOverlay bg="blackAlpha.600" backdropFilter="blur(2px)" />
        <DrawerContent
          display="flex"
          flexDirection="column"
          maxH="90vh"
          borderTopRadius="3xl"
          bg="#FAFAFA"
          boxShadow="0 -10px 40px rgba(0,0,0,0.1)"
          sx={{ '& [data-testid="chakra-modal.close-button"]': { display: 'none' } }}
          style={{ transform: dragOffset ? `translateY(${dragOffset}px)` : undefined, transition: dragOffset ? 'none' : 'transform 0.2s' }}
        >
          {/* Swipe Indicator Handle — also the swipe-down grab area */}
          <Center
            pt={3}
            pb={1}
            w="full"
            onTouchStart={handleSheetTouchStart}
            onTouchMove={handleSheetTouchMove}
            onTouchEnd={handleSheetTouchEnd}
            style={{ touchAction: 'none', cursor: 'grab' }}
          >
            <Box w="40px" h="5px" bg="gray.300" borderRadius="full" />
          </Center>

          {/* Clean Header - Logo & Close */}
          <DrawerHeader borderBottom="1px solid" borderColor="gray.100" py={3} px={5}>
            <Flex justify="center" align="center" width="full">
              <Box display="flex" alignItems="center" gap={2}>
                <Image
                  src={logo}
                  alt="Clovia"
                  w="36px"
                  h="36px"
                  objectFit="contain"
                  cursor="pointer"
                  loading="lazy"
                  onClick={handleLogoClick}
                  _hover={{ opacity: 0.8 }}
                />
                <Box fontWeight="bold" fontSize="lg" color="gray.800">Clovia</Box>
              </Box>
            </Flex>
          </DrawerHeader>

          {/* Main Content Area */}
          <DrawerBody flex={1} overflowY="auto" pb={user ? 8 : 8} px={4} mt={2}>
            <VStack spacing={4} align="stretch">

              {/* User Profile Card - Premium layout */}
              {user && (
                <Box
                  as={RouterLink}
                  to="/profile"
                  onClick={onClose}
                  bg="white"
                  p={4}
                  borderRadius="2xl"
                  border="1px solid"
                  borderColor="gray.100"
                  shadow="sm"
                  _hover={{ shadow: 'md', transform: 'translateY(-1px)', textDecoration: 'none' }}
                  transition="all 0.2s"
                  display="block"
                >
                  <Flex align="center" gap={4}>
                    <VerifiedAvatar
                      size="lg"
                      name={user.name || 'User'}
                      src={getImageUrl(user.profile_picture)}
                      isVerified={user?.verification_status === 'verified' || user?.verified || false}
                    />
                    <Box flex={1}>
                      <Text fontWeight="bold" fontSize="md" color="gray.900" noOfLines={1}>{user.name}</Text>
                      <Text fontSize="sm" color="gray.500" noOfLines={1}>{user.email}</Text>
                    </Box>
                  </Flex>
                </Box>
              )}

              {/* Menu Items mapped in a sleek card */}
              <Box bg="white" borderRadius="2xl" overflow="hidden" shadow="sm" border="1px" borderColor="gray.100">
                <VStack spacing={0} align="stretch">
                  {mobileNavItems.map((item: any, index: number) => {
                    const Icon = item.icon
                    const isActive = location.pathname === item.path

                    return (
                      <React.Fragment key={item.path}>
                        {index > 0 && <Divider borderColor="gray.50" />}
                        <Button
                          as={RouterLink}
                          to={item.path}
                          justifyContent="flex-start"
                          onClick={onClose}
                          bg={isActive ? 'brand.50' : 'white'}
                          color={isActive ? 'brand.600' : 'gray.700'}
                          fontWeight={isActive ? '600' : '500'}
                          minH="56px"
                          w="full"
                          variant="ghost"
                          borderRadius="none"
                          px={5}
                          _hover={{ bg: 'gray.50' }}
                          _active={{ bg: 'gray.100' }}
                        >
                          <Flex align="center" w="full" gap={4}>
                            <Icon size={22} color={isActive ? "var(--chakra-colors-brand-500)" : "var(--chakra-colors-gray-400)"} />
                            <Text fontSize="md">{item.label}</Text>
                          </Flex>
                        </Button>
                      </React.Fragment>
                    )
                  })}
                </VStack>
              </Box>

              {/* Extras Card (ECODE + Install) */}
              <Box bg="white" p={2} borderRadius="2xl" overflow="hidden" shadow="sm" border="1px" borderColor="gray.100">
                {!isStandalone && (
                  <Button
                    as="a"
                    href="/clovia.apk"
                    download="clovia.apk"
                    w="full"
                    variant="ghost"
                    minH="52px"
                    justifyContent="flex-start"
                    px={4}
                    color="gray.600"
                    _hover={{ bg: 'gray.50' }}
                  >
                    <Flex align="center" gap={3}>
                      <Icon as={FiDownload} size={18} />
                      <Text fontSize="md" fontWeight="500">Install Clovia (Android)</Text>
                    </Flex>
                  </Button>
                )}
                <InstallAppPrompt variant="mobile-menu" onInstalled={onClose} />
                
                <Flex
                  px={4}
                  py={3}
                  align="center"
                  justify="center"
                  gap={2}
                  cursor="pointer"
                  onClick={handleCompanyClick}
                  _hover={{ bg: 'gray.50', borderRadius: 'xl' }}
                  mt={1}
                >
                  <Image src="/logoimage.png" alt="ECODE" h="20px" objectFit="contain" loading="lazy" />
                  <Text fontSize="xs" fontWeight="bold" color="gray.400" letterSpacing="wider">POWERED BY ECODE</Text>
                </Flex>
              </Box>

              {/* Logout Button */}
              {user && (
                <Button
                  w="full"
                  colorScheme="red"
                  variant="subtle"
                  bg="red.50"
                  color="red.600"
                  leftIcon={<FiLogOut size={20} />}
                  onClick={handleLogout}
                  size="lg"
                  minH="56px"
                  borderRadius="2xl"
                  fontWeight="bold"
                  _hover={{ bg: 'red.100' }}
                  _active={{ bg: 'red.200' }}
                >
                  Log out safely
                </Button>
              )}
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
        borderRight="1px"
        borderColor={borderColor}
        zIndex={1000}
        py={16}
        bg="white"
        display={{ base: 'none', lg: 'block' }} // hide on small screens
      >
        <Box h="100%" display="flex" flexDirection="column" justifyContent="space-between" alignItems="center">
          <VStack spacing={5} align="center" mt={2}>
            {/* Logo/Brand Section */}
            <Box mb={2} p={2} display="flex" flexDirection="column" alignItems="center" gap={2}>
              <Image
                src={logo}
                alt="Clovia"
                w="35px"
                h="35px"
                objectFit="contain"
                cursor="pointer"
                onClick={handleLogoClick}
                _hover={{ opacity: 0.8 }}
                transition="opacity 0.2s"
              />
              {/* <Image
                src="/logoimage.png"
                alt="ECODE"
                h="30px"
                objectFit="contain"
                cursor="pointer"
                _hover={{ opacity: 0.8 }}
                onClick={() => navigate('/company')}
                transition="opacity 0.2s"
              /> */}
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
                      transition="all 0.2s cubic-bezier(0.25, 0.1, 0.25, 1)"
                    />
                    {(item.label === 'Notifications' && notificationCount > 0) && (
                      <CBadge position="absolute" right={0} top={0} transform="translate(30%, -30%)" colorScheme="red" borderRadius="full">{notificationCount}</CBadge>
                    )}
                  </Box>
                </Tooltip>
              )
            })}
          </VStack>

          {/* Settings at the bottom - only when logged in */}
          {user && (
            <VStack spacing={3} mb={4}>
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
            </VStack>
          )}
        </Box>
      </Box>
    </>
  )
}

export default Sidebar
