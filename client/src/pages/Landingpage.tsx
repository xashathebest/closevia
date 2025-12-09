import "@fontsource/prata/400.css";   // regular

import React from 'react'
import {
  Box, Container, VStack, Heading, Text, Button,
  Flex, HStack, Image, IconButton, useDisclosure,
  Drawer, DrawerBody, DrawerHeader, DrawerOverlay,
  DrawerContent, DrawerCloseButton, Link, Stack
} from '@chakra-ui/react'
import { HamburgerIcon } from '@chakra-ui/icons'
import { useNavigate } from 'react-router-dom'
import '@fontsource/prata'

const Navbar = () => {
  const { isOpen, onOpen, onClose } = useDisclosure()

  const NavLink = ({ children }: { children: string }) => (
    <Link
      px={2}
      py={1}
      color="white"
      _hover={{ textDecoration: 'none', color: 'brand.200' }}
      href={`#${children.toLowerCase().replace(/\s+/g, '-')}`}
    >
      {children}
    </Link>
  )

  return (
    <Box position="fixed" top={0} left={0} right={0} zIndex={3}>
      <Flex
        as="nav"
        h="80px"
        align="center"
        justify="space-between"
        padding="0 2rem"
      >
        {/* Left Links - Desktop */}
        <HStack spacing={8} display={{ base: 'none', md: 'flex' }}>
          <NavLink>Home</NavLink>
          <NavLink>How It Works</NavLink>
          <NavLink>Features</NavLink>
        </HStack>

        {/* Center Logo */}
        <Image
          src="/Group 224.png"
          alt="Clovia Logo"
          h="50px"
          objectFit="contain"
          position="absolute"
          left="50%"
          transform="translateX(-40%)" // Move slightly to the right by translating less than center
        />

        {/* Right Links - Desktop */}
        <HStack spacing={8} display={{ base: 'none', md: 'flex' }}>
          <NavLink>Testimonials</NavLink>
          <NavLink>FAQs</NavLink>
          <NavLink>About Us</NavLink>
          <Button
            colorScheme="brand"
            size="md"
            borderRadius="full"
            px={6}
            _hover={{
              transform: 'translateY(-2px)',
              boxShadow: '0 4px 12px rgba(0,0,0,0.2)'
            }}
          >
            Trade Now
          </Button>
        </HStack>

        {/* Mobile Menu Button */}
        <IconButton
          display={{ base: 'flex', md: 'none' }}
          aria-label="Open menu"
          icon={<HamburgerIcon />}
          onClick={onOpen}
          variant="ghost"
          color="white"
        />

        {/* Mobile Drawer */}
        <Drawer isOpen={isOpen} placement="right" onClose={onClose}>
          <DrawerOverlay />
          <DrawerContent>
            <DrawerCloseButton />
            <DrawerHeader>Menu</DrawerHeader>
            <DrawerBody>
              <Stack spacing={4}>
                <Link href="#home">Home</Link>
                <Link href="#how-it-works">How It Works</Link>
                <Link href="#features">Features</Link>
                <Link href="#testimonials">Testimonials</Link>
                <Link href="#faqs">FAQs</Link>
                <Link href="#about-us">About Us</Link>
                <Button colorScheme="brand" w="full">
                  Trade Now
                </Button>
              </Stack>
            </DrawerBody>
          </DrawerContent>
        </Drawer>
      </Flex>
    </Box>
  )
}

const LandingPage: React.FC = () => {
  const navigate = useNavigate()

  const handleGetStarted = () => {
    navigate('/home')
  }

  return (
    <Box
      minH="100vh"
      w="100vw"
      bgImage="/bgphoto.jpg"
      bgSize="cover"
      bgPosition="center"
      bgRepeat="no-repeat"
      position="relative"
      overflow="hidden"
    >
      <Box
        position="absolute"
        top="0"
        left="0"
        right="0"
        bottom="0"
        bg="rgba(0, 0, 0, 0.3)"
        zIndex={1}
      />
      
      <Navbar />
      
      {/* Main content */}
      <Container
        maxW="container.lg"
        px={{ base: 4, md: 6, lg: 8 }}
        position="relative"
        zIndex={2}
        textAlign="center"
        height="100vh"
        display="flex"
        alignItems="center"
      >
        <VStack 
          spacing={{ base: 2, md: 3, lg: 5 }} 
          align="center"
          maxW="800px"
          mx="auto"
          mt={20}
        >
          <Heading 
            as="h1" 
            size={{ base: "xl", md: "1xl", lg: "2xl" }}
            color="white" 
            fontWeight="bold"
            lineHeight="1.2"
            fontFamily="Prata, serif"
            
          >
            Trade what you have, find what you need
            all within your COMMUNITY
          </Heading>
          
          <Text 
            fontSize={{ base: "md", md: "lg", lg: "lg" }}
            color="white" 
            textShadow="1px 1px 4px rgba(0,0,0,0.7)"
            maxW="600px"
            lineHeight="1.6"
            px={{ base: 2, md: 0 }}
          >
            Your one-stop platform for seamless item exchanges. Discover, trade, and connect with others in your community.
          </Text>

          <Image
            src="/Group 9.svg"
            alt="Group 9 Image"
            maxW={{ base: "300px", md: "400px", lg: "1000px" }}
            w="100%"
            objectFit="contain"
            mt={{ base: 4, md: -6 }}
          />
          
          <Button
            size={{ base: "sm", md: "md", lg: "lg" }}
            colorScheme="brand"
            onClick={handleGetStarted}
            px={{ base: 4, md: 6, lg: 8 }}
            py={{ base: 2, md: 3, lg: 10 }}
            fontSize={{ base: "sm", md: "md", lg: "lg" }}
            fontWeight="bold"
            borderRadius="full"
            bg="brand.500"
            color="white"
            position="absolute"
            bottom={{ base: "10%", md: "12%" }}  
            left="50%"
            transform="translateX(-50%)"
            _hover={{
              boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
              bg: 'brand.600'
            }}
            transition="all 0.3s ease"
            minW={{ base: "150px", md: "180px" }}
            h={{ base: "35px", md: "40px", lg: "45px" }}
          >
            Get Started
          </Button>
        </VStack>
      </Container>
    </Box>
  )
}

export default LandingPage