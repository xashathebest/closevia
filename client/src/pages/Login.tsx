import React, { useState, useEffect, useCallback } from 'react'
import { Link as RouterLink, useLocation, useNavigate } from 'react-router-dom'
import {
  Box,
  VStack,
  HStack,
  Heading,
  FormControl,
  FormLabel,
  Input,
  Button,
  Text,
  Link,
  Alert,
  AlertIcon,
  InputGroup,
  InputRightElement,
  InputLeftElement,
  IconButton,
  useToast,
  Image,
  Flex,
  Center,
  Divider,
  Checkbox,
  Icon,
} from '@chakra-ui/react'
import { ViewIcon, ViewOffIcon } from '@chakra-ui/icons'
import { FaGoogle, FaShieldAlt, FaMapMarkerAlt, FaUserCheck } from 'react-icons/fa'
import { MdEmail, MdLock } from 'react-icons/md'
import { motion } from 'framer-motion'
import { useAuth } from '../contexts/AuthContext'
import { auth } from '../config/firebase'
import { clearStoredAuth, getStoredUser } from '../utils/authStorage'
import { signInWithPopup, GoogleAuthProvider, User as FirebaseUser } from 'firebase/auth'

const MotionBox = motion(Box as any) as any

const valuePoints = [
  { icon: FaShieldAlt, label: 'Safe student trades' },
  { icon: FaMapMarkerAlt, label: 'Meetups near you' },
  { icon: FaUserCheck, label: 'Verified users' },
]

const Login: React.FC = () => {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [rememberMe, setRememberMe] = useState(false)
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [error, setError] = useState('')
  const [googleLoginSuccess, setGoogleLoginSuccess] = useState(false)
  const [isLoggingIn, setIsLoggingIn] = useState(false)

  const { login, googleLogin, user, isAuthenticated, loading: authLoading } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const toast = useToast()
  const sessionExpired = new URLSearchParams(location.search).get('expired') === 'true'

  const completeGoogleLogin = useCallback(async (firebaseUser: FirebaseUser) => {
    const idToken = await firebaseUser.getIdToken()

    await googleLogin(idToken, {
      uid: firebaseUser.uid,
      email: firebaseUser.email,
      displayName: firebaseUser.displayName,
      photoURL: firebaseUser.photoURL,
    })

    toast({
      id: 'login-login-successful-2',
      title: 'Login successful!',
      description: `Welcome, ${firebaseUser.displayName || firebaseUser.email}`,
      status: 'success',
      duration: 3000,
      isClosable: true,
      position: 'top',
    })

    setGoogleLoginSuccess(true)
  }, [googleLogin, toast])

  useEffect(() => {
    if (googleLoginSuccess && isAuthenticated && !isLoggingIn) {
      navigate(user?.role === 'admin' ? '/admin' : '/dashboard')
    }
  }, [googleLoginSuccess, isAuthenticated, isLoggingIn, navigate, user])

  useEffect(() => {
    const isOnLoginPage = window.location.pathname === '/login'
    if (!isOnLoginPage) return
    if (isAuthenticated && !isLoggingIn && !authLoading) {
      navigate(user?.role === 'admin' ? '/admin' : '/dashboard', { replace: true })
    }
  }, [isAuthenticated, isLoggingIn, authLoading, navigate, user])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!email || !password) {
      setError('Please fill in all fields')
      return
    }

    try {
      setLoading(true)
      setIsLoggingIn(true)
      setError('')

      await login(email, password)

      toast({
        id: 'login-login-successful',
        title: 'Login successful!',
        description: 'Welcome back to Clovia',
        status: 'success',
        duration: 3000,
        isClosable: true,
        position: 'top',
      })

      const storedUser = getStoredUser()
      const parsedUser = storedUser ? JSON.parse(storedUser) : null
      const redirectPath = parsedUser?.role === 'admin' ? '/admin' : '/dashboard'
      navigate(redirectPath, { replace: true })
    } catch (error: any) {
      setError(error.message || 'Login failed')
    } finally {
      setLoading(false)
      setIsLoggingIn(false)
    }
  }

  const handleGoogleLogin = async () => {
    try {
      setGoogleLoading(true)
      setIsLoggingIn(true)
      setError('')

      clearStoredAuth()

      if (!auth) {
        setError('Firebase is not properly configured. Please check your environment variables.')
        setGoogleLoading(false)
        setIsLoggingIn(false)
        return
      }

      const googleProvider = new GoogleAuthProvider()

      try {
        ;(auth as any).languageCode = 'en'
      } catch (e) {
        // ignore
      }

      const result = await signInWithPopup(auth, googleProvider)
      await completeGoogleLogin(result.user)
    } catch (error: any) {
      if (error.code === 'auth/popup-closed-by-user') {
        setError('Login popup was closed. Please try again.')
      } else if (error.code === 'auth/popup-blocked') {
        setError('Login popup was blocked. Please check your browser settings.')
      } else {
        setError(error.message || 'Google login failed. Please try again.')
      }
    } finally {
      setGoogleLoading(false)
      setIsLoggingIn(false)
    }
  }

  return (
    <Box minH="100vh" w="100%" display="flex" overflow="hidden">

      {/* ── LEFT: Hero image panel (lg+) ── */}
      <Box
        display={{ base: 'none', lg: 'flex' }}
        flex="0 0 55%"
        position="relative"
        overflow="hidden"
        flexDirection="column"
        justifyContent="flex-end"
        minH="100vh"
      >
        {/* Photo */}
        <Image
          src="/barter.jpg"
          position="absolute"
          top={0} left={0} right={0} bottom={0}
          w="100%" h="100%"
          objectFit="cover"
          objectPosition="center"
          draggable={false}
        />

        {/* Dark gradient overlay for readability */}
        <Box
          position="absolute"
          inset={0}
          bg="linear-gradient(170deg, rgba(0,0,0,0.14) 0%, rgba(0,0,0,0.62) 55%, rgba(0,0,0,0.88) 100%)"
        />

        {/* Hero content */}
        <Box position="relative" zIndex={1} px={12} pb={14}>
          {/* Mini logo */}
          <Box
            w="38px" h="38px"
            borderRadius="10px"
            overflow="hidden"
            mb={8}
            boxShadow="0 2px 10px rgba(0,0,0,0.25)"
          >
            <Image src="/icons/CloviaLogo.svg" w="100%" h="100%" objectFit="contain" draggable={false} />
          </Box>

          <Heading
            fontSize="40px"
            fontWeight="800"
            color="white"
            letterSpacing="-1px"
            lineHeight="1.15"
            mb={3}
          >
            Trade smarter,<br />live better.
          </Heading>

          <Text fontSize="15.5px" color="white" mb={9} fontWeight="400" lineHeight="1.5" opacity={0.92}>
            Clovia — the community marketplace for bartering.
          </Text>

          {/* Value points */}
          <VStack align="start" spacing={3.5}>
            {valuePoints.map(({ icon, label }) => (
              <HStack key={label} spacing={3}>
                <Box
                  w="30px" h="30px"
                  borderRadius="8px"
                  bg="whiteAlpha.200"
                  backdropFilter="blur(4px)"
                  display="flex"
                  alignItems="center"
                  justifyContent="center"
                  flexShrink={0}
                >
                  <Icon as={icon} boxSize="13px" color="white" />
                </Box>
                <Text fontSize="14px" color="white" fontWeight="500">
                  {label}
                </Text>
              </HStack>
            ))}
          </VStack>
        </Box>
      </Box>

      {/* ── RIGHT: Form panel ── */}
      <Box
        flex="1"
        display="flex"
        flexDirection="column"
        alignItems={{ base: 'center', lg: 'flex-start' }}
        justifyContent="center"
        position="relative"
        bg="#FFFDF1"
        pl={{ base: 5, md: 8, lg: '7%' }}
        pr={{ base: 5, md: 8, lg: '4%' }}
        py={{ base: 10, md: 12 }}
        overflow="auto"
        minH="100vh"
      >
        {/* Mobile watermark */}
        <Box
          display={{ base: 'block', lg: 'none' }}
          position="fixed"
          top="50%" left="50%"
          transform="translate(-50%, -50%)"
          w="340px" h="340px"
          opacity={0.04}
          pointerEvents="none"
          zIndex={0}
          filter="blur(3px)"
        >
          <Image src="/icons/CloviaLogo.svg" w="100%" h="100%" objectFit="contain" draggable={false} />
        </Box>

        {/* Mobile top brand section */}
        <MotionBox
          display={{ base: 'flex', lg: 'none' }}
          flexDirection="column"
          alignItems="center"
          mb={6}
          zIndex={1}
          initial={{ opacity: 0, y: -14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45 }}
        >
          <Box
            w="52px" h="52px"
            borderRadius="14px"
            overflow="hidden"
            boxShadow="0 4px 18px rgba(21,134,146,0.22)"
            mb={2.5}
          >
            <Image src="/icons/CloviaLogo.svg" w="100%" h="100%" objectFit="contain" draggable={false} />
          </Box>
          <Text fontSize="13px" color="gray.500" fontWeight="500" letterSpacing="0.1px">
            Start trading smarter today
          </Text>
        </MotionBox>

        {/* Card wrapper — holds peeking logo + card body */}
        <MotionBox
          w="full"
          maxW="420px"
          position="relative"
          zIndex={1}
          initial={{ opacity: 0, y: 28 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, delay: 0.08 }}
        >
          {/* Floating logo — peeks above card on desktop */}
          <Box
            display={{ base: 'none', lg: 'flex' }}
            position="absolute"
            top="-34px"
            left="50%"
            transform="translateX(-50%)"
            zIndex={2}
            alignItems="center"
            justifyContent="center"
          >
            <Box
              w="68px" h="68px"
              borderRadius="18px"
              overflow="hidden"
              boxShadow="0 6px 24px rgba(21,134,146,0.30), 0 0 0 3px white, 0 0 0 4px rgba(21,134,146,0.10)"
              sx={{
                animation: 'logoFloat 3.2s ease-in-out infinite',
                '@keyframes logoFloat': {
                  '0%, 100%': { transform: 'translateY(0px)' },
                  '50%': { transform: 'translateY(-5px)' },
                },
              }}
            >
              <Image src="/icons/CloviaLogo.svg" w="100%" h="100%" objectFit="contain" draggable={false} />
            </Box>
          </Box>

          {/* Card body */}
          <Box
            bg="white"
            borderRadius="22px"
            boxShadow={{
              base: '0 4px 24px rgba(0,0,0,0.07)',
              lg: '0 8px 48px rgba(0,0,0,0.10), 0 1px 6px rgba(0,0,0,0.04)',
            }}
            border="1px solid"
            borderColor="rgba(0,0,0,0.06)"
            pt={{ base: 7, lg: 14 }}
            pb={{ base: 7, lg: 9 }}
            px={{ base: 6, lg: 9 }}
          >
            <VStack spacing={0} w="full" align="stretch">

              {/* Header */}
              <VStack spacing={1} align="center" mb={6}>
                <Heading
                  fontSize={{ base: '22px', lg: '26px' }}
                  fontWeight="800"
                  color="gray.900"
                  letterSpacing="-0.5px"
                  lineHeight="1.2"
                >
                  Welcome back
                </Heading>
                <Text fontSize="13.5px" color="gray.400" textAlign="center" fontWeight="400">
                  Sign in to your account
                </Text>
              </VStack>

              {/* Error */}
              {error && (
                <Alert status="error" borderRadius="10px" fontSize="sm" mb={4} py={2.5}>
                  <AlertIcon boxSize={4} />
                  <Text fontSize="sm">{error}</Text>
                </Alert>
              )}
              {sessionExpired && !error && (
                <Alert status="info" borderRadius="10px" fontSize="sm" mb={4} py={2.5}>
                  <AlertIcon boxSize={4} />
                  <Text fontSize="sm">Session expired. Please log in again.</Text>
                </Alert>
              )}

              {/* Form */}
              <form onSubmit={handleSubmit}>
                <VStack spacing={4} w="full" align="stretch">

                  {/* Email */}
                  <MotionBox
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.35, delay: 0.2 }}
                  >
                    <FormControl isRequired>
                      <FormLabel
                        fontSize="11.5px"
                        fontWeight="700"
                        color="gray.500"
                        mb={1.5}
                        textTransform="uppercase"
                        letterSpacing="0.6px"
                      >
                        Email
                      </FormLabel>
                      <InputGroup>
                        <InputLeftElement h="44px" pl={1} pointerEvents="none">
                          <Icon as={MdEmail} boxSize="17px" color="gray.400" />
                        </InputLeftElement>
                        <Input
                          type="email"
                          value={email}
                          onChange={(e) => setEmail(e.target.value)}
                          placeholder="you@example.com"
                          pl="38px"
                          h="44px"
                          bg="gray.50"
                          border="1.5px solid"
                          borderColor="gray.200"
                          borderRadius="10px"
                          fontSize="sm"
                          color="gray.800"
                          _placeholder={{ color: 'gray.400' }}
                          _focus={{
                            bg: 'white',
                            borderColor: '#2D876D',
                            boxShadow: '0 0 0 3px rgba(45,135,109,0.10)',
                          }}
                          _hover={{ borderColor: 'gray.300' }}
                          transition="all 0.15s"
                        />
                      </InputGroup>
                    </FormControl>
                  </MotionBox>

                  {/* Password */}
                  <MotionBox
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ duration: 0.35, delay: 0.28 }}
                  >
                    <FormControl isRequired>
                      <Flex justify="space-between" align="center" mb={1.5}>
                        <FormLabel
                          fontSize="11.5px"
                          fontWeight="700"
                          color="gray.500"
                          mb={0}
                          textTransform="uppercase"
                          letterSpacing="0.6px"
                        >
                          Password
                        </FormLabel>
                        <Link
                          as={RouterLink}
                          to="/forgot-password"
                          fontSize="12px"
                          color="#2D876D"
                          fontWeight="500"
                          _hover={{ color: '#1f5c47', textDecoration: 'none' }}
                        >
                          Forgot password?
                        </Link>
                      </Flex>
                      <InputGroup>
                        <InputLeftElement h="44px" pl={1} pointerEvents="none">
                          <Icon as={MdLock} boxSize="17px" color="gray.400" />
                        </InputLeftElement>
                        <Input
                          type={showPassword ? 'text' : 'password'}
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          placeholder="••••••••"
                          pl="38px"
                          h="44px"
                          bg="gray.50"
                          border="1.5px solid"
                          borderColor="gray.200"
                          borderRadius="10px"
                          fontSize="sm"
                          color="gray.800"
                          sx={{
                            '&::-ms-reveal, &::-ms-clear': { display: 'none' },
                            '&::-webkit-credentials-auto-fill-button': { display: 'none' },
                          }}
                          _placeholder={{ color: 'gray.400' }}
                          _focus={{
                            bg: 'white',
                            borderColor: '#2D876D',
                            boxShadow: '0 0 0 3px rgba(45,135,109,0.10)',
                          }}
                          _hover={{ borderColor: 'gray.300' }}
                          transition="all 0.15s"
                        />
                        <InputRightElement h="44px" pr={1}>
                          <IconButton
                            aria-label={showPassword ? 'Hide password' : 'Show password'}
                            icon={showPassword ? <ViewOffIcon /> : <ViewIcon />}
                            variant="ghost"
                            size="sm"
                            onClick={() => setShowPassword(!showPassword)}
                            color="gray.400"
                            _hover={{ color: 'gray.600', bg: 'transparent' }}
                          />
                        </InputRightElement>
                      </InputGroup>
                    </FormControl>
                  </MotionBox>

                  {/* Remember me */}
                  <MotionBox
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.3, delay: 0.34 }}
                  >
                    <Checkbox
                      isChecked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                      colorScheme="green"
                      size="sm"
                      mt={-1}
                    >
                      <Text fontSize="13px" color="gray.600">Remember me</Text>
                    </Checkbox>
                  </MotionBox>

                  {/* Sign in button */}
                  <MotionBox
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.35, delay: 0.40 }}
                    mt={1}
                  >
                    <Button
                      type="submit"
                      w="full"
                      h="46px"
                      bg="#2D876D"
                      color="white"
                      fontWeight="700"
                      fontSize="sm"
                      letterSpacing="0.2px"
                      borderRadius="10px"
                      isLoading={loading}
                      loadingText="Signing in..."
                      _hover={{
                        bg: '#256b57',
                        transform: 'translateY(-1px)',
                        boxShadow: '0 10px 28px rgba(45,135,109,0.30)',
                      }}
                      _active={{
                        transform: 'scale(0.98)',
                        boxShadow: 'none',
                        bg: '#1f5c47',
                      }}
                      transition="all 0.2s"
                    >
                      Sign in
                    </Button>
                  </MotionBox>

                </VStack>
              </form>

              {/* Divider */}
              <HStack w="full" spacing={3} my={5}>
                <Divider borderColor="gray.200" />
                <Text
                  fontSize="11px"
                  color="gray.400"
                  whiteSpace="nowrap"
                  letterSpacing="0.6px"
                  textTransform="uppercase"
                  px={1}
                >
                  or
                </Text>
                <Divider borderColor="gray.200" />
              </HStack>

              {/* Google */}
              <Button
                w="full"
                h="44px"
                variant="outline"
                border="1.5px solid"
                borderColor="gray.200"
                leftIcon={<FaGoogle size={14} />}
                onClick={handleGoogleLogin}
                isLoading={googleLoading}
                loadingText="Signing in..."
                fontWeight="600"
                fontSize="sm"
                color="gray.600"
                borderRadius="10px"
                bg="white"
                _hover={{
                  bg: 'gray.50',
                  borderColor: '#2D876D',
                  color: 'gray.800',
                }}
                _active={{ transform: 'scale(0.98)', bg: 'gray.100' }}
                transition="all 0.15s"
              >
                Continue with Google
              </Button>

              {/* Sign up */}
              <Center mt={5}>
                <Text fontSize="13px" color="gray.500">
                  Don't have an account?{' '}
                  <Link
                    as={RouterLink}
                    to="/register"
                    color="#2D876D"
                    fontWeight="600"
                    _hover={{ textDecoration: 'underline', color: '#1f5c47' }}
                  >
                    Sign up
                  </Link>
                </Text>
              </Center>

            </VStack>
          </Box>
        </MotionBox>
      </Box>
    </Box>
  )
}

export default Login
