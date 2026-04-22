import React, { Suspense, lazy } from 'react'
import { ChakraProvider, Box, Spinner, Center, Button, VStack, Text, useColorMode } from '@chakra-ui/react'
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { AnimatePresence } from 'framer-motion'
import { theme } from './theme'
import Sidebar from './components/Sidebar'
import PageTransition from './components/PageTransition'
import 'leaflet/dist/leaflet.css'
import LandingPage from './pages/Landingpage'
import Company from './pages/Company'
import Home from './pages/Home'
import Login from './pages/Login'
import Register from './pages/Register'
import VerifyEmail from './pages/VerifyEmail'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'
import Dashboard from './pages/Dashboard'
import ProductDetail from './pages/ProductDetail'
import AddProduct from './pages/AddProduct'
import GlobalPopup from './components/GlobalPopup';
import EditProduct from './pages/EditProduct'
import Notifications from './pages/Notifications'
import Settings from './pages/Settings'
import Trades from './pages/Trades'
import Offers from './pages/Offers'
import Profile from './pages/Profile'
import UserProfile from './pages/UserProfile'
import CreateOrganization from './pages/CreateOrganization'
import OrganizationProfile from './pages/OrganizationProfile'
import Organizations from './pages/Organizations'
import ProductsList from './pages/ProductsList'
import SavedProducts from './pages/SavedProducts'
import Premium from './pages/premium'
import DeliveryOption from './delivery_option/delivery'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import { setStoredToken } from './utils/authStorage'
import { ProductProvider } from './contexts/ProductContext'
import { RealtimeProvider } from './contexts/RealtimeContext'
import ProtectedRoute from './components/ProtectedRoute'
import AdminRoute from './components/AdminRoute'
import PrivateRoute from './components/PrivateRoute'
import { MobileNavProvider } from './contexts/MobileNavContext'
import { NotificationProvider } from './contexts/NotificationContext'
import ErrorBoundary from './components/ErrorBoundary'
import ToastNotification from './components/ToastNotification'
import SessionTimeoutManager from './components/SessionTimeoutManager'

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
const RiderHome = lazy(() => import('./delivery_option/RiderHome').catch(() => ({ default: () => <Box p={4}><Text>Failed to load Rider Home</Text></Box> })))
const RiderApplication = lazy(() => import('./delivery_option/rider').catch(() => ({ default: () => <Box p={4}><Text>Failed to load Rider Application</Text></Box> })))
const BatchPreview = lazy(() => import('./delivery_option/BatchPreview').catch(() => ({ default: () => <Box p={4}><Text>Failed to load Batch Preview</Text></Box> })))
const BatchStatus = lazy(() => import('./delivery_option/BatchStatus').catch(() => ({ default: () => <Box p={4}><Text>Failed to load Batch Status</Text></Box> })))
const RemittanceLedger = lazy(() => import('./delivery_option/RemittanceLedger').catch(() => ({ default: () => <Box p={4}><Text>Failed to load Remittance Ledger</Text></Box> })))
const TaskStepper = lazy(() => import('./delivery_option/TaskStepper').catch(() => ({ default: () => <Box p={4}><Text>Failed to load Task Stepper</Text></Box> })))
const AdminDashboard = lazy(() => import('./pages/AdminDashboard').catch(() => ({ default: () => <Box p={4}><Text>Failed to load Admin Dashboard</Text></Box> })))

// Loading overlay component
const LoadingOverlay: React.FC = () => {
  const { user, loading } = useAuth()

  const handleSkip = () => {
    // Enable development mode and reload
    localStorage.setItem('skip_auth', 'true')
    setStoredToken(null)
    window.location.reload()
  }

  return (
    <Box
      position="fixed"
      top="0"
      left="0"
      right="0"
      bottom="0"
      bg="rgba(255, 255, 255, 0.95)"
      zIndex={9999}
      display="flex"
      alignItems="center"
      justifyContent="center"
      backdropFilter="blur(1px)"
    >
      <Center flexDirection="column" gap={6}>
        <Spinner size="xl" color="brand.500" thickness="4px" />
        <VStack spacing={2}>
          <Text fontSize="lg" color="gray.700" fontWeight="medium">
            {user ? 'Loading your dashboard...' : 'Verifying session...'}
          </Text>
          <Text fontSize="sm" color="gray.500" textAlign="center" maxW="300px">
            {user ? 'Please wait while we load your dashboard' : 'Checking your authentication status'}
          </Text>
        </VStack>
        {!user && (
          <Button
            size="sm"
            variant="ghost"
            colorScheme="brand"
            onClick={handleSkip}
            fontSize="xs"
          >
            Skip & Continue
          </Button>
        )}
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
    <AnimatePresence mode="wait">
      <Routes>
        {/* Landing page route - no sidebar or app layout */}
        <Route path="/" element={
          <PageTransition>
            {localStorage.getItem('has_visited') === 'true' ? <Navigate to="/home" replace /> : <Home />}
          </PageTransition>
        } />
        {/* Always-accessible landing page route (for logo clicks) */}
        <Route path="/landing" element={
          <PageTransition>
            <LandingPage />
          </PageTransition>
        } />
        <Route path="/company" element={
          <PageTransition>
            <Company />
          </PageTransition>
        } />

        {/* Rider routes - no sidebar */}
        <Route path="/rider" element={<Navigate to="/rider-home" replace />} />
        <Route path="/rider-queue" element={<Navigate to="/rider-home" replace />} />
        <Route path="/rider-home" element={
          <PageTransition>
            <Suspense fallback={<Center h="100vh"><Spinner /></Center>}><RiderHome /></Suspense>
          </PageTransition>
        } />
        <Route path="/rider-application" element={
          <PageTransition>
            <Suspense fallback={<Center h="100vh"><Spinner /></Center>}><RiderApplication /></Suspense>
          </PageTransition>
        } />
        <Route path="/batch-preview/:batchId" element={
          <PageTransition>
            <Suspense fallback={<Center h="100vh"><Spinner /></Center>}><BatchPreview /></Suspense>
          </PageTransition>
        } />
        <Route path="/batch-status/:batchId" element={
          <PageTransition>
            <Suspense fallback={<Center h="100vh"><Spinner /></Center>}><BatchStatus /></Suspense>
          </PageTransition>
        } />
        <Route path="/remittance-ledger" element={
          <PageTransition>
            <Suspense fallback={<Center h="100vh"><Spinner /></Center>}><RemittanceLedger /></Suspense>
          </PageTransition>
        } />
        <Route path="/task-stepper/:batchId" element={
          <PageTransition>
            <Suspense fallback={<Center h="100vh"><Spinner /></Center>}><TaskStepper /></Suspense>
          </PageTransition>
        } />
        <Route path="/delivery" element={
          <PageTransition>
            <DeliveryOption />
          </PageTransition>
        } />

        {/* App routes with sidebar and layout */}
        <Route path="/*" element={
          <Box minH="100vh" bg="gray.50">
            <Sidebar />
            <Box as="main" ml={{ base: 0, lg: '70px' }} w="full">
              <Routes>
                <Route path="/home" element={
                  <PageTransition>
                    <Home />
                  </PageTransition>
                } />
                <Route path="/login" element={
                  <PageTransition>
                    <Login />
                  </PageTransition>
                } />
                <Route path="/register" element={
                  <PageTransition>
                    <Register />
                  </PageTransition>
                } />
                <Route path="/verify-email" element={
                  <PageTransition>
                    <VerifyEmail />
                  </PageTransition>
                } />
                <Route path="/forgot-password" element={
                  <PageTransition>
                    <ForgotPassword />
                  </PageTransition>
                } />
                <Route path="/reset-password" element={
                  <PageTransition>
                    <ResetPassword />
                  </PageTransition>
                } />
                <Route path="/products/:id" element={
                  <PageTransition>
                    <ProductDetail />
                  </PageTransition>
                } />
                <Route path="/products" element={
                  <PageTransition>
                    <ProductsList />
                  </PageTransition>
                } />
                <Route path="/dashboard" element={
                  <PageTransition>
                    <Dashboard key="dashboard-route" />
                  </PageTransition>
                } />
                <Route path="/add-product" element={
                  <PageTransition>
                    <ProtectedRoute><AddProduct /></ProtectedRoute>
                  </PageTransition>
                } />
                <Route path="/edit-product/:id" element={
                  <PageTransition>
                    <ProtectedRoute><EditProduct /></ProtectedRoute>
                  </PageTransition>
                } />
                <Route path="/notifications" element={
                  <PageTransition>
                    <ProtectedRoute><Notifications /></ProtectedRoute>
                  </PageTransition>
                } />
                <Route path="/profile" element={
                  <PageTransition>
                    <ProtectedRoute><Profile /></ProtectedRoute>
                  </PageTransition>
                } />
                <Route path="/UserProfile" element={
                  <PageTransition>
                    <ProtectedRoute><UserProfile /></ProtectedRoute>
                  </PageTransition>
                } />
                <Route path="/users/:id" element={
                  <PageTransition>
                    <UserProfile />
                  </PageTransition>
                } />
                <Route path="/organizations/new" element={
                  <PageTransition>
                    <ProtectedRoute><CreateOrganization /></ProtectedRoute>
                  </PageTransition>
                } />
                <Route path="/organizations" element={
                  <PageTransition>
                    <Organizations />
                  </PageTransition>
                } />
                <Route path="/org/:handle" element={
                  <PageTransition>
                    <OrganizationProfile />
                  </PageTransition>
                } />
                <Route path="/settings" element={
                  <PageTransition>
                    <ProtectedRoute><Settings /></ProtectedRoute>
                  </PageTransition>
                } />
                <Route path="/trades" element={
                  <PageTransition>
                    <ProtectedRoute><Trades /></ProtectedRoute>
                  </PageTransition>
                } />
                <Route path="/offers" element={
                  <PageTransition>
                    <ProtectedRoute><Offers /></ProtectedRoute>
                  </PageTransition>
                } />
                <Route path="/saved-products" element={
                  <PageTransition>
                    <PrivateRoute><SavedProducts /></PrivateRoute>
                  </PageTransition>
                } />
                <Route path="/admin" element={
                  <PageTransition>
                    <Suspense fallback={<Center h="100vh"><Spinner /></Center>}>
                      <AdminRoute><AdminDashboard /></AdminRoute>
                    </Suspense>
                  </PageTransition>
                } />
                <Route path="/premium" element={
                  <PageTransition>
                    <ProtectedRoute><Premium /></ProtectedRoute>
                  </PageTransition>
                } />

                <Route path="*" element={
                  <PageTransition>
                    <Home />
                  </PageTransition>
                } />
              </Routes>
            </Box>
          </Box>
        } />
      </Routes>
    </AnimatePresence>
  )
}

function App() {
  return (
    <ChakraProvider theme={theme}>
      <ThemeApplier>
        <AuthProvider>
          <ProductProvider>
            <MobileNavProvider>
              <NotificationProvider>
                <RealtimeProvider>
                  <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                    <ErrorBoundary>
                      <SessionTimeoutManager />
                      <AppContent />
                    </ErrorBoundary>
                    <GlobalPopup />
                    <ToastNotification />
                  </Router>
                </RealtimeProvider>
              </NotificationProvider>
            </MobileNavProvider>
          </ProductProvider>
        </AuthProvider>
      </ThemeApplier>
    </ChakraProvider>
  )
}

export default App
