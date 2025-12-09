import React, { useState } from 'react'
import { Link as RouterLink, useNavigate } from 'react-router-dom'
import {
  Box,
  Container,
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
  SimpleGrid,
} from '@chakra-ui/react'
import { ViewIcon, ViewOffIcon } from '@chakra-ui/icons'
import { useAuth } from '../contexts/AuthContext'

const Register: React.FC = () => {
  const [firstName, setFirstName] = useState('')
  const [middleInitial, setMiddleInitial] = useState('')
  const [lastName, setLastName] = useState('')
  const [phoneNumber, setPhoneNumber] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [isOrganization, setIsOrganization] = useState(false)
  const [orgName, setOrgName] = useState('')
  const [orgLogoUrl, setOrgLogoUrl] = useState('')
  const [department, setDepartment] = useState('')
  const [bio, setBio] = useState('')
  const [error, setError] = useState('')
  
  const { register } = useAuth()
  const navigate = useNavigate()
  const toast = useToast()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!firstName || !lastName || !email || !password || !confirmPassword) {
      setError('Please fill in all required fields')
      return
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters long')
      return
    }

    // Combine name fields for backend
    const fullName = middleInitial 
      ? `${firstName} ${middleInitial} ${lastName}`.trim()
      : `${firstName} ${lastName}`.trim()

    // Enforce WMSU email for non-organization registrations
    if (!isOrganization && !email.toLowerCase().endsWith('@wmsu.edu.ph')) {
      setError('WMSU students must register with their @wmsu.edu.ph email')
      return
    }
    if (!isOrganization && email.toLowerCase().endsWith('@wmsu.edu.ph') && !department) {
      setError('Please select your department/college')
      return
    }

    try {
      setLoading(true)
      setError('')
      await register({
        name: fullName,
        email,
        password,
        is_organization: isOrganization,
        org_name: isOrganization ? orgName : undefined,
        org_logo_url: isOrganization ? orgLogoUrl : undefined,
        department: !isOrganization ? department : undefined,
        bio: bio || undefined,
      })
      
      toast({
        title: 'Registration successful!',
        description: 'Welcome to Clovia',
        status: 'success',
        duration: 3000,
        isClosable: true,
      })
      
      navigate('/dashboard')
    } catch (error: any) {
      setError(error.message || 'Registration failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Box minH="100vh" bg="#FFFDF1" py={8}>
      <Container maxW="container.sm">
        <VStack spacing={8}>
          <Box textAlign="center">
            <Heading size="xl" color="brand.500" mb={2}>
              Join Clovia
            </Heading>
            <Text color="gray.600">
              Create your account to start buying and selling
            </Text>
          </Box>

          <Box w="full" maxW="md">
            <form onSubmit={handleSubmit}>
              <VStack spacing={6}>
                {error && (
                  <Alert status="error">
                    <AlertIcon />
                    {error}
                  </Alert>
                )}

                {/* Name Fields */}
                <SimpleGrid columns={{ base: 1, md: 3 }} spacing={4} w="full">
                  <FormControl isRequired>
                    <FormLabel fontSize="sm" fontWeight="medium">First Name</FormLabel>
                    <Input
                      type="text"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      placeholder="First name"
                      size="lg"
                    />
                  </FormControl>

                  <FormControl>
                    <FormLabel fontSize="sm" fontWeight="medium">Middle Initial</FormLabel>
                    <Input
                      type="text"
                      value={middleInitial}
                      onChange={(e) => setMiddleInitial(e.target.value)}
                      placeholder="M.I."
                      size="lg"
                      maxLength={1}
                    />
                  </FormControl>

                  <FormControl isRequired>
                    <FormLabel fontSize="sm" fontWeight="medium">Last Name</FormLabel>
                    <Input
                      type="text"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      placeholder="Last name"
                      size="lg"
                    />
                  </FormControl>
                </SimpleGrid>

                {/* Phone Number */}
                <FormControl>
                  <FormLabel fontSize="sm" fontWeight="medium">Phone Number</FormLabel>
                  <Input
                    type="tel"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    placeholder="Enter your phone number"
                    size="lg"
                  />
                </FormControl>

                <FormControl isRequired>
                  <FormLabel fontSize="sm" fontWeight="medium">Email</FormLabel>
                  <Input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="Enter your email"
                    size="lg"
                  />
                </FormControl>

                {/* Organization Toggle */}
                <FormControl>
                  <HStack justify="space-between">
                    <FormLabel fontSize="sm" fontWeight="medium" mb={0}>Register as Organization</FormLabel>
                    <Button size="sm" variant={isOrganization ? 'solid' : 'outline'} colorScheme="brand" onClick={() => setIsOrganization(!isOrganization)}>
                      {isOrganization ? 'Organization' : 'Individual'}
                    </Button>
                  </HStack>
                </FormControl>

                {/* Organization Fields */}
                {isOrganization && (
                  <VStack w="full" spacing={4} align="stretch">
                    <FormControl isRequired>
                      <FormLabel fontSize="sm" fontWeight="medium">Organization Name</FormLabel>
                      <Input value={orgName} onChange={(e) => setOrgName(e.target.value)} placeholder="e.g., CCS Student Council" size="lg" />
                    </FormControl>
                    <FormControl>
                      <FormLabel fontSize="sm" fontWeight="medium">Organization Logo URL</FormLabel>
                      <Input value={orgLogoUrl} onChange={(e) => setOrgLogoUrl(e.target.value)} placeholder="https://..." size="lg" />
                    </FormControl>
                  </VStack>
                )}

                {/* WMSU Department for students */}
                {!isOrganization && email.toLowerCase().endsWith('@wmsu.edu.ph') && (
                  <FormControl isRequired>
                    <FormLabel fontSize="sm" fontWeight="medium">Department / College</FormLabel>
                    <Input value={department} onChange={(e) => setDepartment(e.target.value)} placeholder="e.g., CCS, COE, CTE" size="lg" />
                  </FormControl>
                )}

                {/* Bio */}
                <FormControl>
                  <FormLabel fontSize="sm" fontWeight="medium">Short Bio</FormLabel>
                  <Input value={bio} onChange={(e) => setBio(e.target.value)} placeholder="Tell others about you or your org" size="lg" />
                </FormControl>

                <FormControl isRequired>
                  <FormLabel fontSize="sm" fontWeight="medium">Password</FormLabel>
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

                <FormControl isRequired>
                  <FormLabel fontSize="sm" fontWeight="medium">Confirm Password</FormLabel>
                  <InputGroup size="lg">
                    <Input
                      type={showConfirmPassword ? 'text' : 'password'}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Confirm your password"
                    />
                    <InputRightElement>
                      <IconButton
                        aria-label={showConfirmPassword ? 'Hide password' : 'Show password'}
                        icon={showConfirmPassword ? <ViewOffIcon /> : <ViewIcon />}
                        variant="ghost"
                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
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
                  loadingText="Creating account..."
                  mt={4}
                >
                  Create Account
                </Button>

                <Text textAlign="center" fontSize="sm">
                  Already have an account?{' '}
                  <Link as={RouterLink} to="/login" color="brand.500" fontWeight="medium">
                    Sign in here
                  </Link>
                </Text>
              </VStack>
            </form>
          </Box>
        </VStack>
      </Container>
    </Box>
  )
}

export default Register
