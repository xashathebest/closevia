import React, { useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Box,
  VStack,
  HStack,
  Heading,
  Text,
  Button,
  Container,
  Flex,
  Icon,
  Image,
  useColorModeValue,
  Link as ChakraLink,
} from '@chakra-ui/react'
import { ArrowRightIcon } from '@chakra-ui/icons'
import { FaLeaf, FaRecycle, FaGlobe } from 'react-icons/fa6'
import AboutUsSection from '../components/AboutUsSection'
import SolutionsSection from '../components/SolutionsSection'
import ImpactSection from '../components/ImpactSection'
import TeamSection from '../components/TeamSection'
import TestimonialsSection from '../components/TestimonialsSection'
import GetInvolvedSection from '../components/GetInvolvedSection'

const Company: React.FC = () => {
  const navigate = useNavigate()
  const [isScrolled, setIsScrolled] = useState(false)
  const [isDarkSection, setIsDarkSection] = useState(false)
  
  // Create refs for each section
  const aboutRef = useRef<HTMLDivElement>(null)
  const solutionsRef = useRef<HTMLDivElement>(null)
  const impactRef = useRef<HTMLDivElement>(null)
  const teamRef = useRef<HTMLDivElement>(null)
  const testimonialsRef = useRef<HTMLDivElement>(null)
  const getInvolvedRef = useRef<HTMLDivElement>(null)

  const scrollToSection = (ref: React.RefObject<HTMLDivElement>) => {
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 50)
      
      // Check if currently viewing a dark section
      const sections = [
        { ref: aboutRef, isDark: false },
        { ref: solutionsRef, isDark: true },
        { ref: impactRef, isDark: true },
        { ref: teamRef, isDark: true },
        { ref: testimonialsRef, isDark: true },
        { ref: getInvolvedRef, isDark: true },
      ]
      
      const scrollTop = window.scrollY
      const viewportHeight = window.innerHeight
      const midpoint = scrollTop + viewportHeight / 2
      
      for (const section of sections) {
        if (section.ref.current) {
          const rect = section.ref.current.getBoundingClientRect()
          const sectionTop = scrollTop + rect.top
          const sectionBottom = sectionTop + rect.height
          
          if (midpoint >= sectionTop && midpoint <= sectionBottom) {
            setIsDarkSection(section.isDark)
            break
          }
        }
      }
    }

    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  const navBg = useColorModeValue(
    isScrolled 
      ? 'rgba(255, 253, 241, 0.7)' 
      : 'rgba(255, 253, 241, 0.3)',
    'rgba(30, 30, 30, 0.5)'
  )

  return (
    <Box minH="100vh" bg="black" overflow="hidden">
      {/* Background Video */}
      <Box
        position="fixed"
        top={0}
        left={0}
        w="100%"
        h="100%"
        zIndex={0}
        overflow="hidden"
      >
        <video
          autoPlay
          loop
          muted
          playsInline
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            position: 'absolute',
          }}
        >
          <source src="/vid1.mp4" type="video/mp4" />
          Your browser does not support the video tag.
        </video>

        {/* Dark-to-Transparent Gradient Overlay */}
        <Box
          position="absolute"
          top={0}
          left={0}
          w="100%"
          h="100%"
          background="linear-gradient(135deg, rgba(0, 0, 0, 0.6) 0%, rgba(0, 0, 0, 0.3) 50%, rgba(0, 0, 0, 0.5) 100%)"
          zIndex={1}
        />
      </Box>

      {/* Glassmorphic Navigation Bar - desktop: wider max and padding */}
      <Box
        position="fixed"
        top={0}
        left={0}
        right={0}
        zIndex={100}
        backdropFilter="blur(10px)"
        bg={navBg}
        borderBottomWidth="1px"
        borderBottomColor={useColorModeValue(
          'rgba(255, 253, 241, 0.2)',
          'rgba(255, 255, 255, 0.1)'
        )}
        transition="all 0.3s ease"
        mx="auto"
        maxW={{ base: '100%', md: '6xl', xl: '7xl', '2xl': '1600px' }}
        display={{ base: 'block', md: 'block' }}
        mt={{ base: 0, md: 4 }}
        borderRadius={{ base: '0', md: 'lg' }}
      >
        <Container maxW={{ base: '100%', md: '6xl', xl: '7xl', '2xl': '1600px' }} px={{ base: 3, md: 8, lg: 10, xl: 12 }}>
          <Flex
            py={{ base: 3, md: 4, lg: 4 }}
            justify="space-between"
            align="center"
            h={{ base: '50px', md: '60px', lg: '64px' }}
          >
            {/* Logo Section */}
            <HStack spacing={2} cursor="pointer" onClick={() => navigate('/')} flex={1}>
              <Image
                src="/icons/CloviaLogo.svg"
                alt="Logo"
                h={{ base: '32px', md: '40px', lg: '44px' }}
                objectFit="contain"
              />
              {/* ECODE Logo - Mobile Only */}
              <Image
                src="/icons/CloviaLogo.svg"
                alt="ECODE Logo"
                h={{ base: '28px', md: '0' }}
                objectFit="contain"
                display={{ base: 'block', md: 'none' }}
                ml="auto"
              />
            </HStack>

            {/* Nav Links - desktop: more spacing */}
            <HStack spacing={{ base: 2, sm: 3, md: 6, lg: 8, xl: 10 }} align="center">
              <ChakraLink
                fontSize={{ base: 'xs', sm: 'sm' }}
                fontWeight="500"
                color={isDarkSection ? 'gray.300' : 'gray.100'}
                cursor="pointer"
                onClick={() => scrollToSection(aboutRef)}
                display={{ base: 'none', sm: 'block' }}
                transition="all 0.3s ease"
                _hover={{
                  color: 'green.200',
                  transition: 'all 0.2s ease',
                }}
              >
                About
              </ChakraLink>
              <ChakraLink
                fontSize={{ base: 'xs', sm: 'sm' }}
                fontWeight="500"
                color={isDarkSection ? 'gray.300' : 'gray.100'}
                cursor="pointer"
                onClick={() => scrollToSection(solutionsRef)}
                display={{ base: 'none', sm: 'block' }}
                transition="all 0.3s ease"
                _hover={{
                  color: 'green.200',
                  transition: 'all 0.2s ease',
                }}
              >
                Solutions
              </ChakraLink>
              <ChakraLink
                fontSize={{ base: 'xs', sm: 'sm' }}
                fontWeight="500"
                color={isDarkSection ? 'gray.300' : 'gray.100'}
                cursor="pointer"
                onClick={() => scrollToSection(impactRef)}
                display={{ base: 'none', md: 'block' }}
                transition="all 0.3s ease"
                _hover={{
                  color: 'green.200',
                  transition: 'all 0.2s ease',
                }}
              >
                Impact
              </ChakraLink>
              <ChakraLink
                fontSize={{ base: 'xs', sm: 'sm' }}
                fontWeight="500"
                color={isDarkSection ? 'gray.300' : 'gray.100'}
                cursor="pointer"
                onClick={() => scrollToSection(teamRef)}
                display={{ base: 'none', md: 'block' }}
                transition="all 0.3s ease"
                _hover={{
                  color: 'green.200',
                  transition: 'all 0.2s ease',
                }}
              >
                Team
              </ChakraLink>
              <Button
                size={{ base: 'xs', md: 'sm' }}
                bg={isDarkSection ? 'rgba(74, 222, 128, 0.3)' : 'rgba(74, 222, 128, 0.2)'}
                color="green.200"
                border="1px solid rgba(74, 222, 128, 0.3)"
                _hover={{
                  bg: 'rgba(74, 222, 128, 0.4)',
                  color: 'green.100',
                }}
                transition="all 0.3s ease"
                fontWeight="600"
                px={{ base: 3, md: 4 }}
                onClick={() => navigate('/register')}
              >
                Try Clovia
              </Button>
            </HStack>
          </Flex>
        </Container>
      </Box>

      {/* Hero Section - desktop: larger container and typography */}
      <Flex
        w="100%"
        h="100vh"
        align="center"
        justify="center"
        position="relative"
        zIndex={2}
        pt={{ base: 16, md: 20 }}
      >
        <Container maxW={{ base: '2xl', md: '3xl', lg: '4xl', xl: '5xl' }} centerContent px={{ base: 4, md: 6, lg: 8 }}>
          <VStack spacing={{ base: 6, md: 8, lg: 10 }} textAlign="center" align="center">
            {/* Main Heading */}
            <VStack spacing={{ base: 4, md: 6 }}>
              <Heading
                as="h1"
                size="2xl"
                color="white"
                fontWeight="900"
                lineHeight="1.2"
                fontSize={{ base: '3xl', md: '5xl', lg: '6xl', xl: '7xl' }}
                textShadow="0 2px 10px rgba(0, 0, 0, 0.3)"
              >
                Sustainable Solutions, 
                <br />
                <Text
                  as="span"
                  color="green.300"
                  display="inline"
                  fontWeight="900"
                  fontSize={{ base: '3xl', md: '5xl', lg: '6xl', xl: '7xl' }}
                  fontFamily="'Courier New', monospace"
                  letterSpacing="0.1em"
                  textShadow="0 0 20px rgba(74, 222, 128, 0.8), 0 0 40px rgba(74, 222, 128, 0.5), 0 0 60px rgba(74, 222, 128, 0.3)"
                  position="relative"
                  _before={{
                    content: '"Simplified"',
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    zIndex: -1,
                    color: 'emerald.400',
                    textShadow: '-2px -2px 10px rgba(16, 185, 129, 0.6)',
                    opacity: 0.5,
                  }}
                >
                  Simplified
                </Text>
              </Heading>

              <Text
                fontSize={{ base: 'lg', md: 'xl', lg: '2xl' }}
                color="gray.100"
                maxW={{ base: 'xl', md: '2xl', lg: '3xl' }}
                textShadow="0 1px 5px rgba(0, 0, 0, 0.2)"
                fontWeight="500"
              >
                Create a sustainable future. Innovate, collaborate, and implement eco-friendly solutions that protect nature and empower your community.
              </Text>
            </VStack>

            {/* Feature Pills */}
            <HStack
              spacing={4}
              justify="center"
              flexWrap="wrap"
              mt={4}
            >
              <Box
                px={4}
                py={2}
                bg="rgba(255, 255, 255, 0.1)"
                backdropFilter="blur(10px)"
                borderRadius="full"
                border="1px solid rgba(255, 255, 255, 0.2)"
                display="flex"
                alignItems="center"
                gap={2}
              >
                <Icon as={FaLeaf} color="green.300" boxSize={4} />
                <Text fontSize="sm" color="gray.100" fontWeight="500">
                  Sustainable
                </Text>
              </Box>
              <Box
                px={4}
                py={2}
                bg="rgba(255, 255, 255, 0.1)"
                backdropFilter="blur(10px)"
                borderRadius="full"
                border="1px solid rgba(255, 255, 255, 0.2)"
                display="flex"
                alignItems="center"
                gap={2}
              >
                <Icon as={FaRecycle} color="emerald.300" boxSize={4} />
                <Text fontSize="sm" color="gray.100" fontWeight="500">
                  Zero Waste
                </Text>
              </Box>
              <Box
                px={4}
                py={2}
                bg="rgba(255, 255, 255, 0.1)"
                backdropFilter="blur(10px)"
                borderRadius="full"
                border="1px solid rgba(255, 255, 255, 0.2)"
                display="flex"
                alignItems="center"
                gap={2}
              >
                <Icon as={FaGlobe} color="teal.300" boxSize={4} />
                <Text fontSize="sm" color="gray.100" fontWeight="500">
                  Community
                </Text>
              </Box>
            </HStack>

            {/* CTA Buttons */}
            <HStack spacing={{ base: 2, md: 4 }} pt={4} flexWrap="wrap" justify="center">
              <Button
                size={{ base: 'md', md: 'lg' }}
                bgGradient="linear(to-r, green.400, emerald.500)"
                color="white"
                rightIcon={<ArrowRightIcon />}
                _hover={{
                  bgGradient: 'linear(to-r, green.500, emerald.600)',
                  transform: 'translateY(-4px)',
                  boxShadow: '0 12px 24px rgba(74, 222, 128, 0.4)',
                }}
                transition="all 0.3s ease"
                fontWeight="700"
                px={{ base: 5, md: 8 }}
                fontSize={{ base: 'sm', md: 'md' }}
                onClick={() => navigate('/register')}
              >
                Try our App
              </Button>
              <Button
                size={{ base: 'md', md: 'lg' }}
                variant="outline"
                bg="rgba(255, 255, 255, 0.1)"
                color="white"
                borderColor="rgba(255, 255, 255, 0.3)"
                backdropFilter="blur(10px)"
                _hover={{
                  bg: 'rgba(255, 255, 255, 0.2)',
                  borderColor: 'rgba(255, 255, 255, 0.5)',
                  transform: 'translateY(-4px)',
                }}
                transition="all 0.3s ease"
                fontWeight="700"
                px={{ base: 5, md: 8 }}
                fontSize={{ base: 'sm', md: 'md' }}
                onClick={() => scrollToSection(aboutRef)}
              >
                Learn More
              </Button>
            </HStack>

            {/* Scroll Indicator */}
            <VStack
              spacing={2}
              pt={8}
              opacity={0.7}
              animation="bounce 2s infinite"
              sx={{
                '@keyframes bounce': {
                  '0%, 100%': { transform: 'translateY(0)' },
                  '50%': { transform: 'translateY(10px)' },
                },
              }}
            >
              <Text fontSize="xs" color="gray.200" fontWeight="600">
                Scroll to explore
              </Text>
              <Box
                as="svg"
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                color="gray.200"
              >
                <polyline points="6 9 12 15 18 9"></polyline>
              </Box>
            </VStack>
          </VStack>
        </Container>
      </Flex>

      {/* About Us Section */}
      <Box ref={aboutRef}>
        <AboutUsSection />
      </Box>

      {/* Solutions Section */}
      <Box ref={solutionsRef}>
        <SolutionsSection />
      </Box>

      {/* Impact Section */}
      <Box ref={impactRef}>
        <ImpactSection />
      </Box>

      {/* Team Section */}
      <Box ref={teamRef}>
        <TeamSection />
      </Box>

      {/* Testimonials Section */}
      <Box ref={testimonialsRef}>
        <TestimonialsSection />
      </Box>

      {/* Get Involved Section */}
      <Box ref={getInvolvedRef}>
        <GetInvolvedSection />
      </Box>

      {/* Footer */}
      <Box
        bg="rgba(0, 0, 0, 0.9)"
        borderTopWidth="1px"
        borderTopColor="rgba(74, 222, 128, 0.1)"
        position="relative"
        zIndex={2}
      >
        <Container maxW="4xl" py={8}>
          <Flex
            justify="space-between"
            align="center"
            flexWrap="wrap"
            gap={4}
          >
            <Text color="gray.400" fontSize="sm">
              © 2025 Closevia. Building a sustainable future.
            </Text>
            <HStack spacing={6}>
              <ChakraLink
                color="gray.400"
                fontSize="sm"
                _hover={{ color: 'green.300' }}
              >
                Privacy
              </ChakraLink>
              <ChakraLink
                color="gray.400"
                fontSize="sm"
                _hover={{ color: 'green.300' }}
              >
                Terms
              </ChakraLink>
              <ChakraLink
                color="gray.400"
                fontSize="sm"
                _hover={{ color: 'green.300' }}
              >
                Contact
              </ChakraLink>
            </HStack>
          </Flex>
        </Container>
      </Box>
    </Box>
  )
}

export default Company
