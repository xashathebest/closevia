import React from 'react'
import { Box, Center, Spinner } from '@chakra-ui/react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import UserProfile from './UserProfile'

/**
 * Unified profile page for the logged-in user.
 *
 * This now reuses the same responsive layout as the public desktop profile
 * (`UserProfile`) so mobile and desktop stay in sync.
 */
const Profile: React.FC = () => {
  const { user, loading } = useAuth()
  const navigate = useNavigate()

  React.useEffect(() => {
    if (!loading && !user) {
      navigate('/login')
    }
  }, [loading, user, navigate])

  if (loading || !user) {
    return (
      <Box bg="#FFFDF1" minH="100vh" w="100%">
        <Center h="50vh">
          <Spinner size="xl" color="brand.500" />
        </Center>
      </Box>
    )
  }

  // Guard against undefined user.id
  if (!user.id) {
    return (
      <Box bg="#FFFDF1" minH="100vh" w="100%">
        <Center h="50vh">
          <Box textAlign="center">
            <Box fontSize="lg" fontWeight="bold" mb={2}>Error Loading Profile</Box>
            <Box fontSize="sm" color="gray.600">User ID is not available. Please try logging in again.</Box>
          </Box>
        </Center>
      </Box>
    )
  }

  return <UserProfile userId={user.id} />
}

export default Profile
