import React, { useEffect, useState } from 'react'
import {
  Avatar,
  Badge,
  Box,
  Button,
  Container,
  Grid,
  GridItem,
  Heading,
  HStack,
  Input,
  Spinner,
  Text,
  VStack,
} from '@chakra-ui/react'
import { Link as RouterLink } from 'react-router-dom'
import { api } from '../services/api'
import { getImageUrl } from '../utils/imageUtils'
import FloatingTab from '../components/FloatingTab'

const Organizations: React.FC = () => {
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState<any[]>([])

  const fetchOrganizations = async (q = '') => {
    setLoading(true)
    try {
      const res = await api.get('/api/organizations', {
        params: {
          q,
          limit: 50,
        },
      })
      setItems(Array.isArray(res.data?.data) ? res.data.data : [])
    } catch {
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchOrganizations()
  }, [])

  return (
    <Box bg="#FFFDF1" minH="100vh" pb={{ base: '120px', md: 0 }}>
      <Container maxW={{ base: 'full', md: '6xl' }} px={{ base: 4, md: 6 }} py={{ base: 6, md: 10 }}>
        <VStack align="stretch" spacing={6}>
        <VStack align="start" spacing={1}>
          <Heading size={{ base: 'lg', md: 'xl' }} fontWeight="800" letterSpacing="tight" color="gray.800">Discover Organizations</Heading>
          <Text color="gray.500" fontSize={{ base: 'sm', md: 'md' }} fontWeight="600">Join topic-focused communities and network with approved members.</Text>
        </VStack>

        {/* Search and Create - Responsive Layout */}
        <VStack spacing={3} align="stretch" display={{ base: 'flex', md: 'none' }}>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                fetchOrganizations(query.trim())
              }
            }}
            placeholder="Search organizations..."
            bg="white"
            borderWidth="0"
            shadow="sm"
            borderRadius="2xl"
            h="44px"
            _focus={{ shadow: 'md' }}
          />
          <HStack spacing={2} w="full">
            <Button 
              bg="brand.500" 
              color="white"
              onClick={() => fetchOrganizations(query.trim())} 
              flex={1} 
              h="44px"
              borderRadius="xl"
              fontWeight="800"
              shadow="sm"
              _hover={{ transform: 'translateY(-2px)', shadow: 'md', bg: 'brand.600' }}
              _active={{ transform: 'scale(0.98)' }}
              transition="all 0.2s"
            >
              Search
            </Button>
            <Button 
              as={RouterLink} 
              to="/organizations/new" 
              variant="outline" 
              flex={1} 
              h="44px"
              borderRadius="xl"
              fontWeight="800"
              borderColor="gray.200"
              _hover={{ transform: 'translateY(-2px)', shadow: 'sm', bg: 'white' }}
              _active={{ transform: 'scale(0.98)' }}
              transition="all 0.2s"
            >
              Create
            </Button>
          </HStack>
        </VStack>

        {/* Desktop Search Layout */}
        <HStack spacing={3} display={{ base: 'none', md: 'flex' }}>
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                fetchOrganizations(query.trim())
              }
            }}
            placeholder="Search organizations by name, slug, or category"
            bg="white"
            borderWidth="0"
            shadow="sm"
            borderRadius="2xl"
            h="48px"
            _focus={{ shadow: 'md' }}
          />
          <Button 
            bg="brand.500"
            color="white"
            onClick={() => fetchOrganizations(query.trim())}
            h="48px"
            px={8}
            borderRadius="xl"
            fontWeight="800"
            shadow="sm"
            _hover={{ transform: 'translateY(-2px)', shadow: 'md', bg: 'brand.600' }}
            transition="all 0.2s"
          >
            Search
          </Button>
          <Button 
            as={RouterLink} 
            to="/organizations/new" 
            variant="outline"
            h="48px"
            px={8}
            borderRadius="xl"
            fontWeight="800"
            borderColor="gray.200"
            bg="white"
            _hover={{ transform: 'translateY(-2px)', shadow: 'sm' }}
            transition="all 0.2s"
          >
            Create
          </Button>
        </HStack>

        {loading ? <Spinner size="md" color="brand.500" mt={4} /> : null}
        {!loading && items.length === 0 ? <Text color="gray.500" fontSize={{ base: 'sm', md: 'md' }} fontWeight="500">No organizations found based on your search.</Text> : null}

        <Grid
          templateColumns={{ base: 'minmax(0, 1fr)', md: 'repeat(2, minmax(0, 1fr))' }}
          gap={{ base: 4, md: 6 }}
          pt={2}
          justifyItems="center"
        >
          {items.map((org) => (
            <GridItem key={org.id} w="full" maxW={{ base: '420px', md: 'none' }}>
              <Box 
                bg="white" 
                borderWidth="0" 
                shadow="md"
                borderRadius={{ base: '2xl', md: '3xl' }} 
                p={{ base: 4, md: 5 }}
                position="relative"
                overflow="hidden"
                _hover={{ shadow: 'lg', transform: 'translateY(-2px)' }}
                transition="all 0.3s cubic-bezier(.08,.52,.52,1)"
              >
                <HStack align="start" spacing={4}>
                  <Avatar size={{ base: 'md', md: 'lg' }} src={org.logo_url ? getImageUrl(org.logo_url) : undefined} name={org.name} shadow="sm" />
                  <VStack align="start" spacing={1.5} flex={1} minW={0}>
                    <HStack spacing={2} wrap="wrap" w="full" justify="space-between">
                      <Heading size={{ base: 'sm', md: 'md' }} fontWeight="800" color="gray.800" noOfLines={1} letterSpacing="tight">{org.name}</Heading>
                      <Badge bg="brand.50" color="brand.600" px={2} py={0.5} borderRadius="full" fontSize="10px" fontWeight="700" letterSpacing="wider" textTransform="uppercase">{org.category || 'Community'}</Badge>
                    </HStack>
                    <Text fontSize="xs" fontWeight="700" color="brand.500">@{org.slug}</Text>
                    <Text fontSize={{ base: 'xs', md: 'sm' }} color="gray.600" noOfLines={2} lineHeight="tall">{org.description || 'No description available for this organization.'}</Text>
                    
                    <HStack justify="space-between" w="full" pt={2} align="center">
                      <Text fontSize="10px" fontWeight="700" color="gray.400" textTransform="uppercase" letterSpacing="wider">Members: <Text as="span" color="gray.700">{org.member_count || 0}</Text></Text>
                      <Button 
                        as={RouterLink} 
                        to={`/org/${org.slug}`} 
                        size="sm" 
                        colorScheme="brand" 
                        variant="ghost" 
                        borderRadius="xl"
                        fontWeight="700"
                        _hover={{ bg: 'brand.50' }}
                      >
                        View Profile
                      </Button>
                    </HStack>
                  </VStack>
                </HStack>
              </Box>
            </GridItem>
          ))}
        </Grid>
        </VStack>
      </Container>

      {/* Mobile Bottom Navigation */}
      <FloatingTab />
    </Box>
  )
}

export default Organizations
