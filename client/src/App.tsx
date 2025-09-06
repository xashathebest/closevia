import React from 'react'
import { ChakraProvider, Box, Spinner, Center, Button, VStack, Text } from '@chakra-ui/react'
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import { theme } from './theme'
import Sidebar from './components/Sidebar'
import Home from './pages/Home'
import Login from './pages/Login'
import Register from './pages/Register'
import Dashboard from './pages/Dashboard'
import ProductDetail from './pages/ProductDetail'
import AddProduct from './pages/AddProduct'
import EditProduct from './pages/EditProduct'
import Notifications from './pages/Notifications'
import Settings from './pages/Settings'
import Trades from './pages/Trades'
import Offers from './pages/Offers'
import Profile from './pages/Profile'
import AdminDashboard from './pages/AdminDashboard'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { ProductProvider } from './contexts/ProductContext'
import { RealtimeProvider } from './contexts/RealtimeContext'
import ProtectedRoute from './components/ProtectedRoute'
import AdminRoute from './components/AdminRoute'
import { MobileNavProvider } from './contexts/MobileNavContext'

// Loading overlay component
const LoadingOverlay: React.FC = () => {
  const { user } = useAuth()
  
  const handleSkip = () => {
    // Enable development mode and reload
    localStorage.setItem('skip_auth', 'true')
    localStorage.removeItem('clovia_token')
    window.location.reload()
  }
  
  return (
    <Box
      position="fixed"
      top="0"
      left="0"
      right="0"
      bottom="0"
      bg="rgba(255, 255, 255, 0.9)"
      zIndex={9999}
      display="flex"
      alignItems="center"
      justifyContent="center"
    >
      <Center flexDirection="column" gap={6}>
        <Spinner size="xl" color="brand.500" thickness="4px" />
        <VStack spacing={2}>
          <Text fontSize="lg" color="gray.700" fontWeight="medium">
            {user ? 'Loading your dashboard...' : 'Loading Clovia...'}
          </Text>
          <Text fontSize="sm" color="gray.500" textAlign="center">
            If this takes too long, the backend might be down
          </Text>
        </VStack>
        <Button
          size="md"
          variant="solid"
          colorScheme="brand"
          onClick={handleSkip}
          px={6}
        >
          Skip Loading & Continue
        </Button>
      </Center>
    </Box>
  )
}

// Main app content component that uses the auth context
const AppContent: React.FC = () => {
  const { loading } = useAuth()

  if (loading) {
    return <LoadingOverlay />
  }

  return (
    <Box minH="100vh" bg="gray.50">
      <Sidebar />
      <Box as="main" ml={{ base: 0, lg: '70px' }}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/products/:id" element={<ProductDetail />} />
          <Route 
            path="/dashboard" 
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/add-product" 
            element={
              <ProtectedRoute>
                <AddProduct />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/edit-product/:id" 
            element={
              <ProtectedRoute>
                <EditProduct />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/notifications" 
            element={
              <ProtectedRoute>
                <Notifications />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/profile" 
            element={
              <ProtectedRoute>
                <Profile />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/settings" 
            element={
              <ProtectedRoute>
                <Settings />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/trades" 
            element={
              <ProtectedRoute>
                <Trades />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/offers" 
            element={
              <ProtectedRoute>
                <Offers />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/admin" 
            element={
              <AdminRoute>
                <AdminDashboard />
              </AdminRoute>
            } 
          />
        </Routes>
      </Box>
    </Box>
  )
}

function App() {
  return (
    <ChakraProvider theme={theme}>
      <AuthProvider>
        <ProductProvider>
          <MobileNavProvider>
            <RealtimeProvider>
              <Router>
                <AppContent />
              </Router>
            </RealtimeProvider>
          </MobileNavProvider>
        </ProductProvider>
      </AuthProvider>
    </ChakraProvider>
  )
}

export default App
