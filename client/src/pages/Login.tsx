import React, { useState } from 'react'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import {
  Box,
  Container,
  VStack,
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
} from '@chakra-ui/react'
import { ViewIcon, ViewOffIcon } from '@chakra-ui/icons'
import { useAuth } from '../contexts/AuthContext'

const Login: React.FC = () => {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  
  const { login } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!email || !password) {
      setError('Please fill in all fields')
      return
    }

    try {
      setLoading(true)
      setError('')
      await login(email, password)
      
      toast({
        title: 'Login successful!',
        description: 'Welcome back to Clovia',
        status: 'success',
        duration: 3000,
        isClosable: true,
      })
      
      navigate('/dashboard')
    } catch (error: any) {
      setError(error.message || 'Login failed')
    } finally {
      setLoading(false)
    }
  }
    
  return (
    <Box bg="#FFFDF1" minH="100vh" pt={0} ml={-7} >
      <Container maxW="container.lg" px={0} minH="100vh">
        <Flex direction={{ base: 'column', md: 'row' }} gap={6} align="stretch" h="100vh">
          <Box
            flex={{ base: '1', md: '1.4' }}
            display={{ base: 'none', md: 'flex' }} // hide image on mobile, show on md+
            alignItems="flex-start"
            justifyContent="flex-start"
            ml={{ base: 0, md: '-80px' }}
            h={{ base: 'auto', md: '100vh' }}                  
            overflow="hidden"
          >
            <Image
              src="/barter.jpg"
              alt="Barter"
              objectFit="cover"
              objectPosition="center"
              w={{ base: '100%', md: 'calc(100% + 80px)' }}      
              h={{ base: '200px', md: '99.8vh' }}               
              position="relative"
              top={0}                                      
              borderTopRightRadius="2xl"                          
              borderBottomRightRadius="2xl"                   
              draggable={false}
            />
          </Box>
 
          <Box flex={{ base: '1', md: '1' }} display="flex" alignItems="center" justifyContent="center" px={{ base: 4, md: 6 }}>
             <Box
               p={8}
               rounded="2xl"
               w="full"
               borderTopLeftRadius={0}                          
               borderBottomLeftRadius={0}                        
               borderTopRightRadius={{ base: 0, md: '2xl' }} 
               ml={10}     
             >
              <Box textAlign="center" mb={4}>
                <Heading size="xl" color="brand.500" mb={2}>
                  Welcome Back
                </Heading>
                <Text color="gray.600">
                  Sign in to your Clovia account
                </Text>
              </Box>

              <form onSubmit={handleSubmit}>
                <VStack spacing={6}>
                  {error && (
                    <Alert status="error">
                      <AlertIcon />
                      {error}
                    </Alert>
                  )}

                  <FormControl isRequired>
                    <FormLabel>Email</FormLabel>
                    <Input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="Enter your email"
                      size="lg"
                    />
                  </FormControl>

                  <FormControl isRequired>
                    <FormLabel>Password</FormLabel>
                    <InputGroup size="lg">
                      <Input
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="Enter your password"
                      />
                      <InputRightElement>
                        <IconButton
                          aria-label={showPassword ? 'Hide password' : 'Show password'}
                          icon={showPassword ? <ViewOffIcon /> : <ViewIcon />}
                          variant="ghost"
                          onClick={() => setShowPassword(!showPassword)}
                        />
                      </InputRightElement>
                    </InputGroup>
                  </FormControl>

                  <Button
                    type="submit"
                    colorScheme="brand"
                    size="lg"
                    w="full"
                    isLoading={loading}
                    loadingText="Signing in..."
                  >
                    Sign In
                  </Button>

                  <Text textAlign="center">
                    Don't have an account?{' '}
                    <Link as={RouterLink} to="/register" color="brand.500">
                      Sign up here
                    </Link>
                  </Text>
                </VStack>
              </form>
            </Box>
          </Box>
        </Flex>
      </Container>
    </Box>
  )
}

export default Login
