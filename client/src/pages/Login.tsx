import React, { useState, useEffect, useCallback } from 'react'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
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
  IconButton,
  useToast,
  Image,
  Flex,
  Center,
  Divider,
  Container,
} from '@chakra-ui/react'
import { ViewIcon, ViewOffIcon, ArrowBackIcon } from '@chakra-ui/icons'
import { FaGoogle } from 'react-icons/fa'
import { useAuth } from '../contexts/AuthContext'
import { auth } from '../config/firebase'
import { clearStoredAuth, getStoredUser } from '../utils/authStorage'
import { signInWithPopup, GoogleAuthProvider, User as FirebaseUser } from 'firebase/auth'

const Login: React.FC = () => {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [googleLoading, setGoogleLoading] = useState(false)
  const [error, setError] = useState('')
  const [googleLoginSuccess, setGoogleLoginSuccess] = useState(false)
  const [isLoggingIn, setIsLoggingIn] = useState(false)

  const { login, googleLogin, user, isAuthenticated, loading: authLoading } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()

  const completeGoogleLogin = useCallback(async (firebaseUser: FirebaseUser) => {
    const idToken = await firebaseUser.getIdToken()

    await googleLogin(idToken, {
      uid: firebaseUser.uid,
      email: firebaseUser.email,
      displayName: firebaseUser.displayName,
      photoURL: firebaseUser.photoURL,
    })

    toast({
      id: "login-login-successful-2",
      title: 'Login successful!',
      description: `Welcome, ${firebaseUser.displayName || firebaseUser.email}`,
      status: 'success',
      duration: 3000,
      isClosable: true,
    })

    setGoogleLoginSuccess(true)
  }, [googleLogin, toast])

  // Navigate to appropriate page when user state is updated after Google login
  useEffect(() => {
    if (googleLoginSuccess && isAuthenticated && !isLoggingIn) {
      navigate(user?.role === 'admin' ? '/admin' : '/dashboard')
    }
  }, [googleLoginSuccess, isAuthenticated, isLoggingIn, navigate, user])

  // Redirect authenticated users away from login page.
  // Important: run when auth state becomes ready, not only on mount.
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
        id: "login-login-successful",
        title: 'Login successful!',
        description: 'Welcome back to Clovia',
        status: 'success',
        duration: 3000,
        isClosable: true,
      })

      // Check user role from localStorage since state may not be updated yet
      const storedUser = getStoredUser()
      const parsedUser = storedUser ? JSON.parse(storedUser) : null
      const redirectPath = parsedUser?.role === 'admin' ? '/admin' : '/dashboard'

      // Navigate immediately; if auth state finalizes a moment later,
      // the effect above will still redirect away from /login.
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
      
      // Clear any existing auth state before new login
      clearStoredAuth()

      // Check if Firebase is initialized
      if (!auth) {
        setError('Firebase is not properly configured. Please check your environment variables.')
        setGoogleLoading(false)
        setIsLoggingIn(false)
        return
      }

      // Create Google Auth Provider
      const googleProvider = new GoogleAuthProvider()

      if (!auth) {
        setError('Google login is not available in this environment.')
        setGoogleLoading(false)
        setIsLoggingIn(false)
        return
      }

      // Set language to English
      try {
        // some firebase auth instances allow setting languageCode
        ;(auth as any).languageCode = 'en'
      } catch (e) {
        // ignore if auth object doesn't support languageCode
      }

      const result = await signInWithPopup(auth, googleProvider)
      await completeGoogleLogin(result.user)
    } catch (error: any) {
      // Handle specific error codes
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
    <Box 
      bg={{ base: '#E8F5E9', md: '#FFFDF1' }} 
      w="100%" 
      minH="100vh"
      display="flex"
      flexDirection={{ base: 'column', md: 'row' }}
      overflow="hidden"
    >
      {/* Image on the left - fixed height (desktop only) */}
      <Box
        flex={{ base: '0', md: '1.2' }}
        display={{ base: 'none', md: 'flex' }}
        alignItems="center"
        justifyContent="center"
        h="100vh"
        maxH="100vh"
        overflow="hidden"
      >
        <Image
          src="/barter.jpg"
          alt="Barter"
          objectFit="cover"
          objectPosition="center"
          w="100%"
          h="100%"
          draggable={false}
          borderTopRightRadius="3xl"
          borderBottomRightRadius="3xl"
        />
      </Box>
 
      {/* Form on the right - centered vertically */}
      <Flex
        flex={{ base: '1', md: '0.8' }}
        alignItems={{ base: 'flex-start', md: 'center' }}
        justifyContent="center"
        px={{ base: 4, md: 20 }}
        py={{ base: 8, md: 0 }}
        bg={{ base: '#E8F5E9', md: '#FFFDF1' }}
        position="relative"
        minH={{ base: '100vh', md: '100vh' }}
        w="100%"
        overflow="auto"
      >
        {/* Back Button - Mobile Only */}
        <IconButton
          aria-label="Go back"
          icon={<ArrowBackIcon />}
          position="absolute"
          top={4}
          left={4}
          display={{ base: 'flex', md: 'none' }}
          variant="ghost"
          colorScheme="teal"
          onClick={() => navigate(-1)}
          size="md"
          zIndex={10}
        />
        
        {/* Login Form Container - Card Style */}
        <Container maxW="container.sm" position="relative" p={0}>
          <VStack spacing={6} w="full">
            {/* Decorative Header - Mobile Optimized */}
            <Box 
              w="full" 
              textAlign="center" 
              pt={{ base: 12, md: 0 }}
              mb={{ base: 4, md: 2 }}
            >
              {/* Nature Illustration - SVG Plants */}
              <Flex justify="center" mb={6} h="120px">
                <svg width="100%" height="120" viewBox="0 0 200 120" fill="none" style={{ maxWidth: '200px' }}>
                  {/* Left plant */}
                  <g>
                    <path d="M 40 100 Q 30 80 35 60 Q 40 40 45 20" stroke="#4CAF50" strokeWidth="3" fill="none" strokeLinecap="round"/>
                    <ellipse cx="30" cy="70" rx="8" ry="15" fill="#66BB6A" transform="rotate(-40 30 70)"/>
                    <ellipse cx="45" cy="50" rx="8" ry="15" fill="#81C784" transform="rotate(-20 45 50)"/>
                    <ellipse cx="50" cy="30" rx="8" ry="15" fill="#66BB6A" transform="rotate(0 50 30)"/>
                    <circle cx="40" cy="95" r="4" fill="#2D876D"/>
                  </g>
                  {/* Center plant - Main */}
                  <g>
                    <path d="M 100 100 L 100 20" stroke="#2D876D" strokeWidth="4" fill="none"/>
                    <ellipse cx="75" cy="60" rx="12" ry="20" fill="#4CAF50" transform="rotate(-45 75 60)"/>
                    <ellipse cx="125" cy="65" rx="12" ry="20" fill="#4CAF50" transform="rotate(45 125 65)"/>
                    <ellipse cx="70" cy="40" rx="12" ry="20" fill="#66BB6A" transform="rotate(-50 70 40)"/>
                    <ellipse cx="130" cy="35" rx="12" ry="20" fill="#66BB6A" transform="rotate(50 130 35)"/>
                    <ellipse cx="85" cy="25" rx="10" ry="18" fill="#81C784" transform="rotate(-35 85 25)"/>
                    <ellipse cx="115" cy="25" rx="10" ry="18" fill="#81C784" transform="rotate(35 115 25)"/>
                    <circle cx="100" cy="95" r="5" fill="#2D876D"/>
                  </g>
                  {/* Right plant */}
                  <g>
                    <path d="M 160 100 Q 170 80 165 60 Q 160 40 155 20" stroke="#4CAF50" strokeWidth="3" fill="none" strokeLinecap="round"/>
                    <ellipse cx="170" cy="70" rx="8" ry="15" fill="#66BB6A" transform="rotate(40 170 70)"/>
                    <ellipse cx="155" cy="50" rx="8" ry="15" fill="#81C784" transform="rotate(20 155 50)"/>
                    <ellipse cx="150" cy="30" rx="8" ry="15" fill="#66BB6A" transform="rotate(0 150 30)"/>
                    <circle cx="160" cy="95" r="4" fill="#2D876D"/>
                  </g>
                  {/* Decorative flowers */}
                  <circle cx="55" cy="35" r="3" fill="#FFD54F"/>
                  <circle cx="145" cy="40" r="3" fill="#FFD54F"/>
                  <circle cx="75" cy="15" r="2.5" fill="#FFEB3B"/>
                </svg>
              </Flex>
              
              <Heading 
                size="lg" 
                color="#2D876D" 
                mb={2}
                fontSize={{ base: '28px', md: '32px' }}
                fontWeight="700"
                letterSpacing="-0.5px"
              >
                Welcome Back
              </Heading>
              <Text 
                color="#555"
                fontSize={{ base: '14px', md: '16px' }}
                fontWeight="500"
              >
                Sign in to your Clovia account
              </Text>
            </Box>

            {/* Form Card */}
            <Box
              w="full"
              bg="white"
              borderRadius={{ base: '24px', md: '16px' }}
              p={{ base: 6, md: 8 }}
              boxShadow={{ base: 'none', md: '0 4px 20px rgba(0, 0, 0, 0.08)' }}
              border={{ base: 'none', md: '1px solid' }}
              borderColor={{ base: 'transparent', md: 'gray.100' }}
            >
              <form onSubmit={handleSubmit}>
                <VStack spacing={5} w="full">
                  {/* Error Alert */}
                  {error && (
                    <Alert status="error" borderRadius="12px" bg="#FFEBEE">
                      <AlertIcon color="#C62828" />
                      <Text color="#B71C1C" fontSize="sm">
                        {error}
                      </Text>
                    </Alert>
                  )}

                  {/* Email Field */}
                  <FormControl isRequired>
                    <FormLabel fontSize={{ base: '13px', md: '14px' }} fontWeight="600" color="#333" mb="8px">Email</FormLabel>
                    <Input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="Enter your email"
                      size={{ base: 'lg', md: 'lg' }}
                      bg="#F5F5F5"
                      borderColor="#E0E0E0"
                      borderWidth="1px"
                      height={{ base: '48px', md: '44px' }}
                      fontSize={{ base: '15px', md: '16px' }}
                      _focus={{
                        borderColor: '#2D876D',
                        boxShadow: '0 0 0 3px rgba(45, 135, 109, 0.1)',
                        bg: 'white',
                      }}
                      _hover={{
                        borderColor: '#E8E8E8',
                      }}
                      transition="all 0.2s"
                    />
                  </FormControl>

                  {/* Password Field */}
                  <FormControl isRequired>
                    <FormLabel fontSize={{ base: '13px', md: '14px' }} fontWeight="600" color="#333" mb="8px">Password</FormLabel>
                    <InputGroup size={{ base: 'lg', md: 'lg' }}>
                      <Input
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Enter your password"
                        bg="#F5F5F5"
                        borderColor="#E0E0E0"
                        borderWidth="1px"
                        height={{ base: '48px', md: '44px' }}
                        fontSize={{ base: '15px', md: '16px' }}
                        sx={{
                          '&::-ms-reveal, &::-ms-clear': { display: 'none' },
                          '&::-webkit-credentials-auto-fill-button': { display: 'none' },
                        }}
                        _focus={{
                          borderColor: '#2D876D',
                          boxShadow: '0 0 0 3px rgba(45, 135, 109, 0.1)',
                          bg: 'white',
                        }}
                        _hover={{
                          borderColor: '#E8E8E8',
                        }}
                        transition="all 0.2s"
                      />
                      <InputRightElement h={{ base: '48px', md: '44px' }} pr={2}>
                        <IconButton
                          aria-label={showPassword ? 'Hide password' : 'Show password'}
                          icon={showPassword ? <ViewOffIcon /> : <ViewIcon />}
                          variant="ghost"
                          size="sm"
                          onClick={() => setShowPassword(!showPassword)}
                          color="#666"
                          _hover={{ color: '#2D876D', bg: 'transparent' }}
                        />
                      </InputRightElement>
                    </InputGroup>
                  </FormControl>
                  
                  <Box w="full" textAlign="right" mt={-3}>
                    <Link
                      as={RouterLink}
                      to="/forgot-password"
                      fontSize="xs"
                      color="#666"
                      fontWeight="600"
                      _hover={{ color: '#2D876D', textDecoration: 'underline' }}
                    >
                      Forgot password?
                    </Link>
                  </Box>

                  {/* Sign In Button */}
                  <Button
                    type="submit"
                    bg="#2D876D"
                    color="white"
                    size={{ base: 'lg', md: 'lg' }}
                    w="full"
                    isLoading={loading}
                    loadingText="Signing in..."
                    fontSize={{ base: '16px', md: '15px' }}
                    fontWeight="600"
                    height={{ base: '48px', md: '44px' }}
                    borderRadius={{ base: '12px', md: '10px' }}
                    mt={2}
                    _hover={{
                      bg: '#25704d',
                      transform: 'translateY(-2px)',
                      boxShadow: '0 8px 16px rgba(45, 135, 109, 0.3)',
                    }}
                    _active={{
                      transform: 'translateY(0)',
                    }}
                    transition="all 0.3s ease"
                  >
                    Sign In
                  </Button>

                  {/* Divider */}
                  <HStack w="full" spacing={3} my={2}>
                    <Divider borderColor="#DDD" />
                    <Text fontSize="xs" color="#888" whiteSpace="nowrap" fontWeight="500">
                      Or
                    </Text>
                    <Divider borderColor="#DDD" />
                  </HStack>

              {/* Google Login Button */}
                  <Button
                    w="full"
                    variant="outline"
                    borderColor="#DDD"
                    borderWidth="1px"
                    leftIcon={<FaGoogle size={18} />}
                    onClick={handleGoogleLogin}
                    isLoading={googleLoading}
                    loadingText="Signing in..."
                    size={{ base: 'lg', md: 'lg' }}
                    fontSize={{ base: '16px', md: '15px' }}
                    fontWeight="600"
                    color="#333"
                    height={{ base: '48px', md: '44px' }}
                    borderRadius={{ base: '12px', md: '10px' }}
                    bg="white"
                    _hover={{
                      bg: '#F9F9F9',
                      borderColor: '#BBB',
                    }}
                    _active={{
                      bg: '#F0F0F0',
                    }}
                    transition="all 0.2s"
                  >
                    Continue with Google
                  </Button>

                  {/* Sign Up Link */}
                  <Box textAlign="center" w="full" pt={2}>
                    <Text 
                      fontSize={{ base: '14px', md: '15px' }}
                      color="#666"
                    >
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
                  </Box>
                </VStack>
              </form>
            </Box>
          </VStack>
        </Container>
      </Flex>
    </Box>
  )
}

export default Login
