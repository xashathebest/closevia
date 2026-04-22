import React from 'react'
import {
  Box, Container, VStack, Heading, Text, Button,
  Flex, HStack, Image, IconButton, useDisclosure,
  Drawer, DrawerBody, DrawerHeader, DrawerOverlay,
  DrawerContent, DrawerCloseButton, Link, Stack,
  SimpleGrid, Icon, Avatar, Badge,
} from '@chakra-ui/react'
import { HamburgerIcon } from '@chakra-ui/icons'
import { useNavigate } from 'react-router-dom'

import { FiArrowRight, FiPhone, FiPlay, FiStar, FiRefreshCw, FiShield, FiArrowUpRight, FiTruck, FiDownload } from 'react-icons/fi'
import { FaHandshake, FaBoxOpen, FaLeaf, FaExchangeAlt } from 'react-icons/fa'

/* ─── color tokens (light yellow theme with more vibrant accents) ─── */
const C = {
  bg: '#FFF9E6',         // light yellow background
  bgSecondary: '#FFF4CC', // slightly darker yellow for cards
  accent: '#319795',     // brand teal accent
  accentLight: '#38b2ac', // lighter teal
  accentDark: '#285e61',  // darker teal
  accent2: '#D97706',     // warm orange for vibrancy
  accent3: '#059669',     // vibrant green
  white: '#FFFFFF',
  textDark: '#1f2937',   // darker text for better contrast
  textMuted: '#6b7280',  // muted gray
  textLight: '#4b5563',  // light gray
  gradient: 'linear-gradient(135deg, #319795 0%, #38b2ac 100%)',
  gradientWarm: 'linear-gradient(135deg, #D97706 0%, #F59E0B 100%)',
}

/* ─── Navbar ─── */
const Navbar = ({ navigate, onGetStarted }: { navigate: ReturnType<typeof useNavigate>; onGetStarted: () => void }) => {
  const { isOpen, onOpen, onClose } = useDisclosure()

  const navItems = ['Home', 'About', 'How It Works', 'Features', 'Contact Us']

  return (
    <Box position="fixed" top={0} left={0} right={0} zIndex={50} bg={C.bg} borderBottom="2px solid" borderColor={C.bgSecondary} backdropFilter="blur(10px)">
      <Flex
        as="nav"
        h={{ base: '64px', md: '72px' }}
        align="center"
        justify="space-between"
        px={{ base: 4, md: 8, lg: 12 }}
        maxW="1400px"
        mx="auto"
        w="100%"
      >
        {/* Logo - Use actual SVG */}
        <HStack spacing={2} cursor="pointer" onClick={() => navigate('/')} _hover={{ opacity: 0.8 }} transition="opacity 0.2s">
          <Image src="/logo.svg" alt="Clovia" h={{ base: '32px', md: '36px' }} w="auto" />
        </HStack>

        {/* Desktop Nav */}
        <HStack spacing={8} display={{ base: 'none', md: 'flex' }}>
          {navItems.map((item) => (
            <Link
              key={item}
              href={`#${item.toLowerCase().replace(/\s+/g, '-')}`}
              color={C.textMuted}
              fontSize="sm"
              fontWeight="500"
              _hover={{ color: C.accent, textDecoration: 'none', _after: { width: '100%' } }}
              transition="color 0.2s"
              position="relative"
              _after={{
                content: '""',
                position: 'absolute',
                bottom: '-4px',
                left: '0',
                width: '0',
                height: '2px',
                bg: C.accent,
                transition: 'width 0.3s ease',
              }}
            >
              {item}
            </Link>
          ))}
        </HStack>

        {/* CTA */}
        <HStack spacing={3}>
          <Button
            display={{ base: 'none', md: 'flex' }}
            bg={C.accent}
            color={C.white}
            size="sm"
            borderRadius="full"
            px={6}
            fontWeight="600"
            _hover={{ bg: C.accentDark, transform: 'translateY(-2px)', boxShadow: 'lg' }}
            transition="all 0.3s"
            onClick={onGetStarted}
            rightIcon={<Icon as={FiArrowUpRight} />}
          >
            Sign Up
          </Button>
          <IconButton
            display={{ base: 'flex', md: 'none' }}
            aria-label="Menu"
            icon={<HamburgerIcon />}
            onClick={onOpen}
            variant="ghost"
            color={C.textDark}
            _hover={{ bg: C.bgSecondary }}
          />
        </HStack>

        {/* Mobile Drawer */}
        <Drawer isOpen={isOpen} placement="right" onClose={onClose}>
          <DrawerOverlay />
          <DrawerContent bg={C.bg}>
            <DrawerCloseButton color={C.textDark} />
            <DrawerHeader>
              <Image src="/logo.svg" alt="Clovia" h="32px" w="auto" />
            </DrawerHeader>
            <DrawerBody>
              <Stack spacing={4}>
                {navItems.map((item) => (
                  <Link
                    key={item}
                    href={`#${item.toLowerCase().replace(/\s+/g, '-')}`}
                    color={C.textMuted}
                    fontWeight="500"
                    _hover={{ color: C.accent }}
                    onClick={onClose}
                  >
                    {item}
                  </Link>
                ))}
                <Button bg={C.accent} color={C.white} w="full" borderRadius="full" onClick={() => { onClose(); onGetStarted() }} fontWeight="600">
                  Sign Up
                </Button>
              </Stack>
            </DrawerBody>
          </DrawerContent>
        </Drawer>
      </Flex>
    </Box>
  )
}


/* ─── Service Card ─── */
const ServiceCard = ({ icon, title, desc, accentColor }: { icon: React.ElementType; title: string; desc: string; accentColor?: string }) => {
  const accent = accentColor || C.accent
  return (
  <VStack
    bg={C.white}
    borderRadius="2xl"
    p={8}
    spacing={4}
    align="start"
    textAlign="start"
    border="2px solid"
    borderColor="transparent"
    position="relative"
    overflow="hidden"
    _hover={{ 
      borderColor: accent, 
      transform: 'translateY(-8px)',
      boxShadow: `0 20px 40px ${accent}26`,
      _before: {
        opacity: 1,
      }
    }}
    transition="all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)"
    _before={{
      content: '""',
      position: 'absolute',
      top: '0',
      left: '0',
      right: '0',
      height: '4px',
      background: accent,
      opacity: 0,
      transition: 'opacity 0.3s',
    }}
  >
    <Flex
      w={16}
      h={16}
      borderRadius="xl"
      bg={`${accent}15`}
      align="center"
      justify="center"
      _groupHover={{ bg: `${accent}25` }}
      transition="all 0.3s"
    >
      <Icon as={icon} boxSize={8} color={accent} />
    </Flex>
    <Text fontSize="lg" color={C.textDark} fontWeight="700">{title}</Text>
    <Text fontSize="sm" color={C.textMuted} lineHeight="1.6">{desc}</Text>
    <HStack color={accent} fontSize="sm" cursor="pointer" _hover={{ gap: 3 }} transition="all 0.2s" spacing={2} pt={2}>
      <Text fontWeight="600">Learn more</Text>
      <Icon as={FiArrowRight} boxSize={4} />
    </HStack>
  </VStack>
  )
}

/* ─── Product Card ─── */
const LandingProductCard = ({ image, name, desc }: { image: string; name: string; desc: string }) => {
  const accentColors = [C.accent, C.accent2, C.accent3]
  const accentColor = accentColors[Math.floor(Math.random() * accentColors.length)]
  return (
  <Box
    borderRadius="2xl"
    overflow="hidden"
    position="relative"
    role="group"
    cursor="pointer"
    border="2px solid"
    borderColor="transparent"
    transition="all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)"
    _hover={{ borderColor: accentColor, boxShadow: `0 20px 40px ${accentColor}26`, transform: 'translateY(-8px)' }}
  >
    <Image
      src={image}
      alt={name}
      w="full"
      h={{ base: '220px', md: '280px' }}
      objectFit="cover"
      transition="transform 0.4s cubic-bezier(0.34, 1.56, 0.64, 1)"
      _groupHover={{ transform: 'scale(1.08)' }}
    />
    {/* Rating badge */}
    <HStack
      position="absolute"
      top={4}
      left={4}
      bg="white"
      borderRadius="full"
      px={3}
      py={2}
      spacing={1}
      boxShadow="0 10px 25px rgba(0, 0, 0, 0.15)"
      backdropFilter="blur(10px)"
    >
      {[...Array(5)].map((_, i) => (
        <Icon key={i} as={FiStar} boxSize={4} color={accentColor} fill={accentColor} />
      ))}
      <Text fontSize="xs" fontWeight="700" ml={1}>5/5</Text>
    </HStack>
    {/* Plus button */}
    <Flex
      position="absolute"
      top={4}
      right={4}
      w={10}
      h={10}
      borderRadius="full"
      bg={accentColor}
      color={C.white}
      align="center"
      justify="center"
      fontWeight="bold"
      fontSize="lg"
      _groupHover={{ transform: 'scale(1.1)' }}
      transition="all 0.3s"
      boxShadow={`0 10px 25px ${accentColor}4d`}
    >
      +
    </Flex>
    {/* Info overlay */}
    <Box
      position="absolute"
      bottom={0}
      left={0}
      right={0}
      bgGradient="linear(to-t, rgba(0,0,0,0.9), rgba(0,0,0,0.4) 60%, transparent)"
      p={6}
      pt={16}
    >
      <Text color={C.white} fontWeight="700" fontSize="lg">{name}</Text>
      <Text fontSize="sm" color="whiteAlpha.90" noOfLines={2}>{desc}</Text>
    </Box>
  </Box>
  )
}

/* ═══════════════════════════════════════════
   LANDING PAGE
   ═══════════════════════════════════════════ */
const LandingPage: React.FC = () => {
  const navigate = useNavigate()
  const handleGetStarted = () => {
    navigate('/login')
  }
  const handleBrowseProducts = () => {
    navigate('/home')
  }

  return (
    <Box
      bg={C.bg}
      color={C.textDark}
      overflowX="hidden"
      minH="100vh"
      sx={{
        scrollBehavior: 'smooth',
        scrollPaddingTop: '80px',
        html: {
          scrollBehavior: 'smooth',
          scrollPaddingTop: '80px',
        },
      }}
    >
      <style>{`html { scroll-behavior: smooth; scroll-padding-top: 80px; }`}</style>
      <Navbar navigate={navigate} onGetStarted={handleGetStarted} />

      {/* ══════════ HERO SECTION ══════════ */}
      <Box
        id="home"
        position="relative"
        minH="100vh"
        pt={{ base: '100px', md: '120px' }}
        pb={{ base: 12, md: 0 }}
        overflow="hidden"
        bg={`linear-gradient(135deg, ${C.bg} 0%, ${C.bgSecondary} 100%)`}
      >
        {/* Animated background elements */}
        <Box
          position="absolute"
          top="5%"
          right="-8%"
          w="500px"
          h="500px"
          borderRadius="full"
          bg={`${C.accent}12`}
          filter="blur(60px)"
          pointerEvents="none"
          animation="float 6s ease-in-out infinite"
        />
        <Box
          position="absolute"
          bottom="-10%"
          left="-5%"
          w="400px"
          h="400px"
          borderRadius="full"
          bg={`${C.accent2}08`}
          filter="blur(50px)"
          pointerEvents="none"
          animation="float 8s ease-in-out infinite reverse"
        />

        <Container maxW="1200px" position="relative" zIndex={1}>
          <Flex
            direction="column"
            align="center"
            textAlign="center"
            minH={{ base: 'auto', md: 'calc(100vh - 120px)' }}
            justify="center"
          >
            <Badge
              bg={`${C.accent2}25`}
              color={C.accent2}
              borderRadius="full"
              px={4}
              py={2}
              mb={6}
              fontSize="xs"
              fontWeight="700"
              textTransform="uppercase"
              letterSpacing="wider"
              border="2px solid"
              borderColor={`${C.accent2}40`}
            >
              �️ Zamboanga First
            </Badge>

            <Heading
              as="h1"
              fontSize={{ base: '2.8xl', md: '4.5xl', lg: '5.5xl' }}
              fontWeight="900"
              lineHeight="1.1"
              mb={8}
              maxW="900px"
              color={C.textDark}
              letterSpacing="-0.02em"
            >
              Trade What You Don't Need.{' '}
              <Text as="span" bgGradient={C.gradientWarm} bgClip="text">
                Help Your Community.
              </Text>
            </Heading>

            <Text
              fontSize={{ base: 'lg', md: 'xl' }}
              color={C.textMuted}
              maxW="650px"
              lineHeight="1.8"
              mb={12}
              fontWeight="500"
            >
              Zamboanga's community trading platform. Textbooks, gadgets, clothes, furniture—whatever you're done with, someone else needs. Meet locally, trade freely.
            </Text>

            <HStack spacing={4} flexWrap="wrap" justify="center" mb={16}>
              <Button
                size="lg"
                bg={C.accent}
                color={C.white}
                borderRadius="full"
                px={9}
                fontWeight="800"
                fontSize="md"
                _hover={{ bg: C.accentDark, transform: 'translateY(-4px)', boxShadow: '0 25px 50px rgba(49, 151, 149, 0.4)' }}
                transition="all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)"
                onClick={handleGetStarted}
                rightIcon={<Icon as={FiArrowRight} boxSize={5} />}
              >
                Join Now
              </Button>
              <Button
                size="lg"
                variant="outline"
                borderColor={C.accent}
                color={C.accent}
                borderRadius="full"
                px={9}
                fontWeight="800"
                fontSize="md"
                _hover={{ bg: C.accent, color: C.white, transform: 'translateY(-4px)', boxShadow: '0 25px 50px rgba(49, 151, 149, 0.3)' }}
                transition="all 0.3s"
                as="a"
                href="/clovia.apk"
                download="clovia.apk"
                rightIcon={<Icon as={FiDownload} boxSize={5} />}
              >
                Download Now
              </Button>
              <Button
                size="lg"
                variant="ghost"
                color={C.accentDark}
                borderRadius="full"
                px={9}
                fontWeight="800"
                fontSize="md"
                _hover={{ bg: `${C.accent}12`, transform: 'translateY(-4px)' }}
                transition="all 0.3s"
                onClick={handleBrowseProducts}
                rightIcon={<Icon as={FiArrowRight} boxSize={5} />}
              >
                Browse Products
              </Button>
            </HStack>

            {/* Quick stats - simplified for one city */}
            <HStack spacing={{ base: 6, md: 12 }} justify="center" pt={8} pb={4} borderTop="2px solid" borderColor={`${C.accent}20`} flexWrap="wrap">
              <VStack spacing={1}>
                <Text fontSize="2.5xl" fontWeight="900" color={C.accent}>100+</Text>
                <Text fontSize="sm" color={C.textMuted} fontWeight="600">Community Members</Text>
              </VStack>
              <VStack spacing={1}>
                <Text fontSize="2.5xl" fontWeight="900" color={C.accent2}>50+</Text>
                <Text fontSize="sm" color={C.textMuted} fontWeight="600">Successful Trades</Text>
              </VStack>
              <VStack spacing={1}>
                <Text fontSize="2.5xl" fontWeight="900" color={C.accent3}>Zamboanga</Text>
                <Text fontSize="sm" color={C.textMuted} fontWeight="600">Local Only</Text>
              </VStack>
            </HStack>
          </Flex>
        </Container>
      </Box>

      {/* ══════════ PROBLEM & SOLUTION SECTION ══════════ */}
      <Box id="how-it-works" bg={C.white} py={{ base: 16, md: 24 }}>
        <Container maxW="1200px">
          <Flex direction={{ base: 'column', lg: 'row' }} gap={12} align="center" mb={20}>
            {/* Left - The Problem */}
            <VStack flex={1} align="start" spacing={6}>
              <VStack align="start" spacing={2}>
                <Badge bg={`${C.accent}15`} color={C.accent} borderRadius="full" px={3} py={1} fontSize="xs" fontWeight="600">THE PROBLEM</Badge>
                <Heading fontSize={{ base: '2.5xl', md: '3.5xl' }} lineHeight="1.2" color={C.textDark} fontWeight="800">
                  Bartering is{' '}<Text as="span" color={C.accent}>Part of Our Culture</Text>
                </Heading>
              </VStack>
              <VStack align="start" spacing={4}>
                <HStack align="start" spacing={4}>
                  <Icon as={FiShield} boxSize={6} color={C.accent} mt={1} flexShrink={0} />
                  <VStack align="start" spacing={1}>
                    <Text fontSize="md" fontWeight="700" color={C.textDark}>Scammers Make It Risky</Text>
                    <Text fontSize="sm" color={C.textMuted}>No verification, no buyer protection, no safe way to trace bad actors.</Text>
                  </VStack>
                </HStack>
                <HStack align="start" spacing={4}>
                  <Icon as={FiPhone} boxSize={6} color={C.accent} mt={1} flexShrink={0} />
                  <VStack align="start" spacing={1}>
                    <Text fontSize="md" fontWeight="700" color={C.textDark}>Scattered Across Platforms</Text>
                    <Text fontSize="sm" color={C.textMuted}>Facebook Marketplace, Carousel—they're generic, slow, lack Zamboanga-specific features.</Text>
                  </VStack>
                </HStack>
                <HStack align="start" spacing={4}>
                  <Icon as={FiRefreshCw} boxSize={6} color={C.accent} mt={1} flexShrink={0} />
                  <VStack align="start" spacing={1}>
                    <Text fontSize="md" fontWeight="700" color={C.textDark}>Ecommerce = More Plastic Waste</Text>
                    <Text fontSize="sm" color={C.textMuted}>Every online order means packaging, shipping, carbon emissions. We keep buying new instead of trading reused.</Text>
                  </VStack>
                </HStack>
              </VStack>
            </VStack>

            {/* Right - The Solution */}
            <VStack flex={1} align="start" spacing={6}>
              <VStack align="start" spacing={2}>
                <Badge bg={`${C.accent2}20`} color={C.accent2} borderRadius="full" px={3} py={1} fontSize="xs" fontWeight="600">CLOVIA SOLVES IT</Badge>
                <Heading fontSize={{ base: '2.5xl', md: '3.5xl' }} lineHeight="1.2" color={C.textDark} fontWeight="800">
                  Safe Trading,{' '}<Text as="span" color={C.accent2}>Built for Zamboanga</Text>
                </Heading>
              </VStack>
              <VStack align="start" spacing={4}>
                <HStack align="start" spacing={4}>
                  <Icon as={FiShield} boxSize={6} color={C.accent2} mt={1} flexShrink={0} />
                  <VStack align="start" spacing={1}>
                    <Text fontSize="md" fontWeight="700" color={C.textDark}>Verified Community</Text>
                    <Text fontSize="sm" color={C.textMuted}>School email verification, rating system, trader profiles. Know who you're dealing with.</Text>
                  </VStack>
                </HStack>
                <HStack align="start" spacing={4}>
                  <Icon as={FaBoxOpen} boxSize={6} color={C.accent2} mt={1} flexShrink={0} />
                  <VStack align="start" spacing={1}>
                    <Text fontSize="md" fontWeight="700" color={C.textDark}>Built for Local Trading</Text>
                    <Text fontSize="sm" color={C.textMuted}>Location-based matching, campus meetup focus, no global nonsense. Trade with people near you.</Text>
                  </VStack>
                </HStack>
                <HStack align="start" spacing={4}>
                  <Icon as={FaHandshake} boxSize={6} color={C.accent2} mt={1} flexShrink={0} />
                  <VStack align="start" spacing={1}>
                    <Text fontSize="md" fontWeight="700" color={C.textDark}>Zero Shipping Emissions</Text>
                    <Text fontSize="sm" color={C.textMuted}>Meet locally = no delivery carbon footprint. No packaging waste. Direct hand-to-hand trades.</Text>
                  </VStack>
                </HStack>
              </VStack>
            </VStack>
          </Flex>

          {/* Impact Section */}
          <Box bg={`linear-gradient(135deg, ${C.accent2}12 0%, ${C.accent3}12 100%)`} border="2px solid" borderColor={`${C.accent2}25`} borderRadius="2xl" p={10}>
            <VStack spacing={8} textAlign="center">
              <VStack spacing={3}>
                <Heading fontSize={{ base: '2xl', md: '3xl' }} fontWeight="800" color={C.textDark}>
                  The Impact: Trading Smarter,{' '}<Text as="span" color={C.accent2}>Not Shopping</Text>
                </Heading>
                <Text fontSize="md" color={C.textMuted} maxW="800px">
                  Every trade on Clovia replaces one potential ecommerce purchase. No manufacturing emissions. No packaging waste. No shipping fuel. Just smart people, reusing smart.
                </Text>
              </VStack>

              <SimpleGrid columns={{ base: 1, sm: 2, md: 4 }} spacing={8} w="full">
                <VStack spacing={3} p={6} bg={C.white} borderRadius="xl" boxShadow="0 5px 15px rgba(0,0,0,0.05)">
                  <Icon as={FaLeaf} boxSize={10} color={C.accent3} />
                  <Text fontSize="sm" fontWeight="700" color={C.textDark}>Plastic Waste Reduced</Text>
                  <Text fontSize="xs" color={C.textMuted}>Every trade avoids packaging from new purchases</Text>
                </VStack>
                <VStack spacing={3} p={6} bg={C.white} borderRadius="xl" boxShadow="0 5px 15px rgba(0,0,0,0.05)">
                  <Icon as={FiTruck} boxSize={10} color={C.accent} />
                  <Text fontSize="sm" fontWeight="700" color={C.textDark}>Zero Delivery Emissions</Text>
                  <Text fontSize="xs" color={C.textMuted}>Local meetups cut transportation carbon</Text>
                </VStack>
                <VStack spacing={3} p={6} bg={C.white} borderRadius="xl" boxShadow="0 5px 15px rgba(0,0,0,0.05)">
                  <Icon as={FiRefreshCw} boxSize={10} color={C.accent2} />
                  <Text fontSize="sm" fontWeight="700" color={C.textDark}>Circular Economy</Text>
                  <Text fontSize="xs" color={C.textMuted}>Items get second life instead of landfills</Text>
                </VStack>
                <VStack spacing={3} p={6} bg={C.white} borderRadius="xl" boxShadow="0 5px 15px rgba(0,0,0,0.05)">
                  <Icon as={FaExchangeAlt} boxSize={10} color={C.accent3} />
                  <Text fontSize="sm" fontWeight="700" color={C.textDark}>Money Stays Local</Text>
                  <Text fontSize="xs" color={C.textMuted}>No logistics markup. Zamboanga keeps the value</Text>
                </VStack>
              </SimpleGrid>
            </VStack>
          </Box>
        </Container>
      </Box>

      {/* ══════════ SERVICES SECTION ══════════ */}
      <Box bg={C.bg} py={{ base: 16, md: 24 }}>
        <Container maxW="1200px">
          <VStack spacing={4} mb={16} textAlign="center">
            <Heading fontSize={{ base: '2xl', md: '4xl' }} fontWeight="800" color={C.textDark} letterSpacing="-0.02em">
              WMSU Students{' '}<Text as="span" bgGradient={C.gradientWarm} bgClip="text">Trading Smart</Text>
            </Heading>
            <Text fontSize="md" color={C.textMuted} maxW="500px" fontWeight="500">
              Here's what's actually happening on campus
            </Text>
          </VStack>

          <Flex
            direction={{ base: 'column', lg: 'row' }}
            gap={8}
            align="stretch"
          >
            {/* Left - Testimonial Card */}
            <Box flex={1} position="relative">
              <Box
                borderRadius="3xl"
                overflow="hidden"
                bg={C.white}
                p={8}
                h="full"
                border="2px solid"
                borderColor="transparent"
                boxShadow="0 10px 30px rgba(0, 0, 0, 0.05)"
                _hover={{ borderColor: C.accent2, boxShadow: `0 20px 40px rgba(217, 119, 6, 0.15)` }}
                transition="all 0.3s"
              >
                {/* Rating */}
                <HStack mb={6} spacing={1}>
                  {[...Array(5)].map((_, i) => (
                    <Icon key={i} as={FiStar} boxSize={5} color={C.accent2} fill={C.accent2} />
                  ))}
                </HStack>

                <Text fontSize="lg" color={C.textDark} lineHeight="1.8" mb={8} fontWeight="500">
                  "Sold my old programming textbook for PHP 400. Buyer got a deal, I got cash. Met locally, no shipping fees. Done in 15 minutes. Best way to declutter and help someone."
                </Text>

                <HStack spacing={4}>
                  <Avatar size="md" name="Kami" bg={C.accent2} color={C.white} />
                  <VStack align="start" spacing={0}>
                    <Text fontSize="md" fontWeight="700" color={C.textDark}>Kami, Zamboanga</Text>
                    <Text fontSize="sm" color={C.textMuted}>Active trader • 8 trades</Text>
                  </VStack>
                </HStack>

                {/* Badges */}
                <HStack position="absolute" top={8} right={8} spacing={2}>
                  <Badge bg={`${C.accent2}15`} color={C.accent2} borderRadius="full" px={3} py={1} fontSize="xs" fontWeight="600">Free Local</Badge>
                </HStack>
              </Box>
            </Box>

            {/* Right - Large image */}
            <Box flex={1.2} borderRadius="3xl" overflow="hidden" minH={{ base: '300px', md: '400px' }} border="2px solid" borderColor={`${C.accent2}20`} boxShadow="0 10px 30px rgba(0, 0, 0, 0.05)">
              <Image
                src="/bgphoto.jpg"
                alt="WMSU campus trading community"
                w="full"
                h="full"
                objectFit="cover"
              />
            </Box>
          </Flex>
        </Container>
      </Box>

      {/* ══════════ ABOUT / EXPERIENCE SECTION ══════════ */}
      <Box id="about" py={{ base: 16, md: 24 }} bg={C.bgSecondary} color={C.textDark}>
        <Container maxW="1200px">
          <Flex direction={{ base: 'column', lg: 'row' }} gap={12} align="center">
            {/* Left - Image with overlay badge */}
            <Box flex={1} position="relative">
              <Image
                src="/barter.jpg"
                alt="WMSU students trading"
                borderRadius="3xl"
                w="full"
                h={{ base: '300px', md: '450px' }}
                objectFit="cover"
                border="2px solid"
                borderColor={`${C.accent2}30`}
                boxShadow="0 20px 40px rgba(217, 119, 6, 0.15)"
              />
              {/* Experience badge  */}
              <Box
                position="absolute"
                bottom={6}
                left={6}
                bg={C.white}
                borderRadius="2xl"
                p={4}
                textAlign="center"
                boxShadow="0 10px 30px rgba(0, 0, 0, 0.15)"
              >
                <Text fontSize="3xl" fontWeight="800" bgGradient={C.gradientWarm} bgClip="text">
                  ✓
                </Text>
                <Text fontSize="xs" color={C.textDark} fontWeight="700">
                  WMSU<br />Verified
                </Text>
              </Box>
            </Box>

            {/* Right - text */}
            <VStack flex={1} align="start" spacing={6}>
              <VStack align="start" spacing={2}>
                <Badge bg={`${C.accent2}20`} color={C.accent2} borderRadius="full" px={3} py={1} fontSize="xs" fontWeight="600">OUR MISSION</Badge>
                <Heading fontSize={{ base: '2.5xl', md: '3.5xl' }} lineHeight="1.2" color={C.textDark} fontWeight="800" letterSpacing="-0.02em">
                  Started at WMSU.{' '}
                  <Text as="span" color={C.accent2}>Built for Zamboanga.</Text>
                </Heading>
              </VStack>
              <Text fontSize="md" color={C.textMuted} lineHeight="1.8" fontWeight="500">
                We spotted the problem: people everywhere throw out good stuff while others struggle to afford things. So we built Clovia—a platform where you trade directly with neighbors you can trust. No middlemen, no shipping costs, no waste.
              </Text>
              <Text fontSize="md" color={C.textMuted} lineHeight="1.8" fontWeight="500">
                Every trade keeps money in Zamboanga. Every swap builds real trust in our community.
              </Text>
              <Button
                bg={C.accent2}
                color={C.white}
                borderRadius="full"
                px={8}
                size="lg"
                fontWeight="700"
                rightIcon={<Icon as={FiArrowRight} boxSize={5} />}
                _hover={{ bg: `rgb(217, 119, 6)`, transform: 'translateY(-3px)', boxShadow: '0 20px 40px rgba(217, 119, 6, 0.3)' }}
                transition="all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)"
                onClick={handleGetStarted}
              >
                Get Started Now
              </Button>
              <Button
                variant="outline"
                borderColor={C.accent}
                color={C.accent}
                borderRadius="full"
                px={8}
                size="lg"
                fontWeight="700"
                rightIcon={<Icon as={FiArrowRight} boxSize={5} />}
                _hover={{ bg: `${C.accent}10`, transform: 'translateY(-3px)' }}
                transition="all 0.3s"
                onClick={handleBrowseProducts}
              >
                Browse Products
              </Button>
            </VStack>
          </Flex>
        </Container>
      </Box>

      <Box id="features" py={{ base: 16, md: 24 }} bg={C.bg}>
        <Container maxW="1200px">
          <VStack spacing={4} mb={16} textAlign="center">
            <Badge bg={`${C.accent2}15`} color={C.accent2} borderRadius="full" px={3} py={1} fontSize="xs" fontWeight="600">LIVE IN ZAMBOANGA</Badge>
            <Heading fontSize={{ base: '2xl', md: '4xl' }} fontWeight="800" color={C.textDark} letterSpacing="-0.02em">
              What People{' '}<Text as="span" bgGradient={C.gradientWarm} bgClip="text">Are Trading Now</Text>
            </Heading>
            <Text fontSize="md" color={C.textMuted} maxW="600px" fontWeight="500">
              Real items from real Zamboanga residents. Available today. Meet locally or arrange delivery.
            </Text>
          </VStack>

          <SimpleGrid columns={{ base: 1, sm: 2, lg: 3 }} spacing={8}>
            <LandingProductCard
              image="/Wireless Earbuds for Students.jpg"
              name="Wireless Earbuds"
              desc="Premium wireless earbuds, perfect for study sessions and commuting."
            />
            <LandingProductCard
              image="/Student Backpack - Water Resistant.webp"
              name="Student Backpack"
              desc="Water-resistant backpack ideal for campus life."
            />
            <LandingProductCard
              image="/Portable Power Bank 20000mAh.webp"
              name="Power Bank 20000mAh"
              desc="Stay charged all day with this portable power bank."
            />
          </SimpleGrid>
        </Container>
      </Box>

      {/* ══════════ STATS / ACHIEVEMENTS SECTION ══════════ */}
      <Box id="contact-us" bg={C.bgSecondary} py={{ base: 16, md: 24 }}>
        <Container maxW="1200px">
          <Flex
            direction={{ base: 'column', md: 'row' }}
            align="center"
            justify="space-between"
            gap={12}
          >
            <VStack align={{ base: 'center', md: 'start' }} spacing={3} flex={1}>
              <Badge bg={`${C.accent2}15`} color={C.accent2} borderRadius="full" px={3} py={1} fontSize="xs" fontWeight="600">GROWTH</Badge>
              <Heading fontSize={{ base: '2.5xl', md: '3.5xl' }} lineHeight="1.2" color={C.textDark} fontWeight="800" letterSpacing="-0.02em">
                Built by WMSU.{' '}<Text as="span" color={C.accent2}>Growing Fast.</Text>
              </Heading>
            </VStack>

            <SimpleGrid columns={{ base: 2, md: 3 }} spacing={10} flex={2}>
              <VStack spacing={2}>
                <Text fontSize="3xl" fontWeight="800" color={C.accent}>100+</Text>
                <Text fontSize="sm" color={C.textMuted} fontWeight="600">Community Members</Text>
              </VStack>
              <VStack spacing={2}>
                <Text fontSize="3xl" fontWeight="800" color={C.accent2}>50+</Text>
                <Text fontSize="sm" color={C.textMuted} fontWeight="600">Successful Trades</Text>
              </VStack>
              <VStack spacing={2}>
                <Text fontSize="3xl" fontWeight="800" color={C.accent3}>1 City</Text>
                <Text fontSize="sm" color={C.textMuted} fontWeight="600">Deep Focus</Text>
              </VStack>
            </SimpleGrid>
          </Flex>
        </Container>
      </Box>

      {/* ══════════ CTA / FOOTER ══════════ */}
      <Box bg={C.bg} py={{ base: 16, md: 24 }} borderTop="2px solid" borderColor={C.bgSecondary}>
        <Container maxW="1200px">
          <VStack spacing={8} textAlign="center" mb={16}>
            <VStack spacing={3}>
              <Badge bg={`${C.accent2}20`} color={C.accent2} borderRadius="full" px={3} py={1} fontSize="xs" fontWeight="600">READY? LET'S GO</Badge>
              <Heading fontSize={{ base: '2.5xl', md: '3.5xl' }} fontWeight="800" color={C.textDark} letterSpacing="-0.02em">
                Start Trading in{' '}<Text as="span" bgGradient={C.gradientWarm} bgClip="text">Zamboanga Today</Text>
              </Heading>
            </VStack>
            <Text fontSize="md" color={C.textMuted} maxW="500px" fontWeight="500">
              We're still building, and we care what you think. Be part of the movement.
              Smart trades. No fees. No shipping hassle. Just people, helping people.
            </Text>
            <HStack spacing={4} flexWrap="wrap" justify="center" pt={4}>
              <Button
                size="lg"
                bg={C.accent}
                color={C.white}
                borderRadius="full"
                px={8}
                fontWeight="700"
                _hover={{ bg: C.accentDark, transform: 'translateY(-3px)', boxShadow: '0 20px 40px rgba(49, 151, 149, 0.3)' }}
                transition="all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)"
                onClick={handleGetStarted}
                rightIcon={<Icon as={FiArrowRight} boxSize={5} />}
              >
                Sign Up Now
              </Button>
              <Button
                size="lg"
                variant="outline"
                borderColor={C.accent2}
                color={C.accent2}
                borderRadius="full"
                borderWidth="2px"
                px={8}
                fontWeight="700"
                _hover={{ borderColor: `rgb(217, 119, 6)`, bg: `${C.accent2}08`, transform: 'translateY(-3px)' }}
                transition="all 0.3s"
                onClick={() => window.open('https://play.google.com/store/apps/details?id=com.cloviagh.clovia', '_blank')}
                rightIcon={<Icon as={FiArrowRight} boxSize={5} />}
              >
                Download App
              </Button>
              <Button
                size="lg"
                variant="ghost"
                color={C.accentDark}
                borderRadius="full"
                px={8}
                fontWeight="700"
                _hover={{ bg: `${C.accent}12`, transform: 'translateY(-3px)' }}
                transition="all 0.3s"
                onClick={handleBrowseProducts}
                rightIcon={<Icon as={FiArrowRight} boxSize={5} />}
              >
                Browse Products
              </Button>
            </HStack>
          </VStack>

          {/* Footer bar */}
          <Flex
            mt={20}
            pt={8}
            borderTop="2px solid"
            borderColor={C.bgSecondary}
            direction={{ base: 'column', md: 'row' }}
            justify="space-between"
            align="center"
            gap={6}
          >
            <HStack spacing={2}>
              <Image src="/logo.svg" alt="Clovia" h="28px" w="auto" />
              <Text fontSize="xs" color={C.textMuted} fontWeight="600">Zamboanga's Student Trading Platform</Text>
            </HStack>
            <Text fontSize="sm" color={C.textMuted} fontWeight="500">
              © 2026 Clovia. All rights reserved.
            </Text>
            <HStack spacing={8}>
              {['Privacy', 'Terms', 'Contact'].map((item) => (
                <Link key={item} fontSize="sm" color={C.textMuted} fontWeight="500" _hover={{ color: C.accent2 }} transition="color 0.2s">
                  {item}
                </Link>
              ))}
            </HStack>
          </Flex>
        </Container>
      </Box>
    </Box>
  )
}

export default LandingPage
