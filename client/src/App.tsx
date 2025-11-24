import React, { Suspense, lazy } from 'react'
import { ChakraProvider, Box, Spinner, Center, Button, VStack, Text, useColorMode } from '@chakra-ui/react'
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import { theme } from './theme'
import Sidebar from './components/Sidebar'
import LandingPage from './pages/Landingpage'
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
import UserProfile from './pages/UserProfile'
import ProductsList from './pages/ProductsList'
import SavedProducts from './pages/SavedProducts'
import AdminDashboard from './pages/AdminDashboard'
import Premium from './pages/premium'
import DeliveryOption from './delivery_option/delivery'
import RiderOption from './delivery_option/rider'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { ProductProvider } from './contexts/ProductContext'
import { RealtimeProvider } from './contexts/RealtimeContext'
import ProtectedRoute from './components/ProtectedRoute'
import AdminRoute from './components/AdminRoute'
import PrivateRoute from './components/PrivateRoute'
import { MobileNavProvider } from './contexts/MobileNavContext'

// Theme applier component - loads and applies saved theme preference
const ThemeApplier: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { colorMode, setColorMode } = useColorMode()
  
  React.useEffect(() => {
    try {
      const saved = localStorage.getItem('user_settings')
      if (saved) {
        const parsed = JSON.parse(saved)
        if (parsed.darkMode !== undefined) {
          const targetMode = parsed.darkMode ? 'dark' : 'light'
          if (colorMode !== targetMode) {
            setColorMode(targetMode)
          }
        }
      }
    } catch (e) {
      // ignore
    }
  }, [])
  
  return <>{children}</>
}
// Lazy load delivery option components with error handling
const RiderQueue = lazy(() => import('./delivery_option/riderqueue').catch(() => ({ default: () => <Box p={4}><Text>Failed to load Rider Queue</Text></Box> })))
const BatchPreview = lazy(() => import('./delivery_option/BatchPreview').catch(() => ({ default: () => <Box p={4}><Text>Failed to load Batch Preview</Text></Box> })))
const BatchStatus = lazy(() => import('./delivery_option/BatchStatus').catch(() => ({ default: () => <Box p={4}><Text>Failed to load Batch Status</Text></Box> })))
const RemittanceLedger = lazy(() => import('./delivery_option/RemittanceLedger').catch(() => ({ default: () => <Box p={4}><Text>Failed to load Remittance Ledger</Text></Box> })))
const TaskStepper = lazy(() => import('./delivery_option/TaskStepper').catch(() => ({ default: () => <Box p={4}><Text>Failed to load Task Stepper</Text></Box> })))

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
    <Routes>
      {/* Landing page route - no sidebar or app layout */}
      <Route path="/" element={<LandingPage />} />
      
      {/* Rider routes - no sidebar */}
      <Route path="/rider" element={<RiderOption />} />
      <Route path="/rider-queue" element={<Suspense fallback={<Center h="100vh"><Spinner /></Center>}><RiderQueue /></Suspense>} />
      <Route path="/batch-preview/:batchId" element={<Suspense fallback={<Center h="100vh"><Spinner /></Center>}><BatchPreview /></Suspense>} />
      <Route path="/batch-status/:batchId" element={<Suspense fallback={<Center h="100vh"><Spinner /></Center>}><BatchStatus /></Suspense>} />
      <Route path="/remittance-ledger" element={<Suspense fallback={<Center h="100vh"><Spinner /></Center>}><RemittanceLedger /></Suspense>} />
      <Route path="/task-stepper/:batchId" element={<Suspense fallback={<Center h="100vh"><Spinner /></Center>}><TaskStepper /></Suspense>} />
      <Route path="/delivery" element={<DeliveryOption />} />
      
      {/* App routes with sidebar and layout */}
      <Route path="/*" element={
        <Box minH="100vh" bg="gray.50">
          <Sidebar />
          <Box as="main" ml={{ base: 0, lg: '70px' }}>
            <Routes>
              <Route path="/home" element={<Home />} />
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />
              <Route path="/products/:id" element={<ProductDetail />} />
              <Route path="/products" element={<ProductsList />} />
              <Route path="/dashboard" element={<Dashboard key="dashboard-route" />} />
              <Route path="/add-product" element={<ProtectedRoute><AddProduct /></ProtectedRoute>} />
              <Route path="/edit-product/:id" element={<ProtectedRoute><EditProduct /></ProtectedRoute>} />
              <Route path="/notifications" element={<ProtectedRoute><Notifications /></ProtectedRoute>} />
              <Route path="/profile" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
              <Route path="/users/:id" element={<UserProfile />} />
              <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
              <Route path="/trades" element={<ProtectedRoute><Trades /></ProtectedRoute>} />
              <Route path="/offers" element={<ProtectedRoute><Offers /></ProtectedRoute>} />
              <Route path="/saved-products" element={<PrivateRoute><SavedProducts /></PrivateRoute>} />
              <Route path="/admin" element={<AdminRoute><AdminDashboard /></AdminRoute>} />
              <Route path="/premium" element={<ProtectedRoute><Premium /></ProtectedRoute>} />

              <Route path="*" element={<Home />} />
            </Routes>
          </Box>
        </Box>
      } />
    </Routes>
  )
}

function App() {
  return (
    <ChakraProvider theme={theme}>
      <ThemeApplier>
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
      </ThemeApplier>
    </ChakraProvider>
  )
}

export default App
