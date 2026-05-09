import React, { Suspense, lazy } from 'react'
import { ChakraProvider, Box, Center, Button, VStack, Text, useColorMode, Skeleton, SkeletonCircle } from '@chakra-ui/react'
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
import GlobalPopup from './components/GlobalPopup';
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
import PullToRefresh from './components/PullToRefresh'
import ConnectionStatus from './components/ConnectionStatus'
import { API_BASE_URL } from './services/api'

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
const RouteFallback: React.FC = () => (
  <Box minH="100vh" px={{ base: 4, md: 8 }} py={6}>
    <VStack align="stretch" spacing={4} maxW="960px" mx="auto">
      <Skeleton height="34px" width="45%" borderRadius="md" />
      <Skeleton height="16px" width="70%" borderRadius="md" />
      <Box display="grid" gridTemplateColumns={{ base: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)' }} gap={3}>
        {Array.from({ length: 8 }).map((_, index) => (
          <Box key={index} bg="white" borderWidth="1px" borderColor="gray.100" borderRadius="lg" overflow="hidden" p={2}>
            <Skeleton height="120px" borderRadius="md" mb={2} />
            <Skeleton height="14px" width="80%" borderRadius="md" mb={2} />
            <Skeleton height="12px" width="55%" borderRadius="md" />
          </Box>
        ))}
      </Box>
    </VStack>
  </Box>
)

const lazyWithFallback = (importer: () => Promise<{ default: React.ComponentType<any> }>, label: string) =>
  lazy(() =>
    importer().catch(() => ({
      default: () => <Box p={4}><Text>{`Failed to load ${label}`}</Text></Box>,
    }))
  )

// Lazy load delivery option components with error handling
const Dashboard = lazyWithFallback(() => import('./pages/Dashboard'), 'Dashboard')
const ProductDetail = lazyWithFallback(() => import('./pages/ProductDetail'), 'Product Detail')
const AddProduct = lazyWithFallback(() => import('./pages/AddProduct'), 'Add Product')
const EditProduct = lazyWithFallback(() => import('./pages/EditProduct'), 'Edit Product')
const Notifications = lazyWithFallback(() => import('./pages/Notifications'), 'Notifications')
const Settings = lazyWithFallback(() => import('./pages/Settings'), 'Settings')
const Offers = lazyWithFallback(() => import('./pages/Offers'), 'Offers')
const Profile = lazyWithFallback(() => import('./pages/Profile'), 'Profile')
const UserProfile = lazyWithFallback(() => import('./pages/UserProfile'), 'User Profile')
const CreateOrganization = lazyWithFallback(() => import('./pages/CreateOrganization'), 'Create Organization')
const OrganizationProfile = lazyWithFallback(() => import('./pages/OrganizationProfile'), 'Organization Profile')
const Organizations = lazyWithFallback(() => import('./pages/Organizations'), 'Organizations')
const ProductsList = lazyWithFallback(() => import('./pages/ProductsList'), 'Products List')
const SavedProducts = lazyWithFallback(() => import('./pages/SavedProducts'), 'Saved Products')
const Premium = lazyWithFallback(() => import('./pages/premium'), 'Premium')
const DeliveryOption = lazyWithFallback(() => import('./delivery_option/delivery'), 'Delivery')
const RiderHome = lazyWithFallback(() => import('./delivery_option/RiderHome'), 'Rider Home')
const RiderApplication = lazyWithFallback(() => import('./delivery_option/rider'), 'Rider Application')
const BatchPreview = lazyWithFallback(() => import('./delivery_option/BatchPreview'), 'Batch Preview')
const BatchStatus = lazyWithFallback(() => import('./delivery_option/BatchStatus'), 'Batch Status')
const RemittanceLedger = lazyWithFallback(() => import('./delivery_option/RemittanceLedger'), 'Remittance Ledger')
const TaskStepper = lazyWithFallback(() => import('./delivery_option/TaskStepper'), 'Task Stepper')
const AdminDashboard = lazyWithFallback(() => import('./pages/AdminDashboard'), 'Admin Dashboard')

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
        <SkeletonCircle size="56px" />
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

const backendHealthUrl = () => `${API_BASE_URL || ''}/health`

const AppLoader: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [ready, setReady] = React.useState(false)
  const [showWakeScreen, setShowWakeScreen] = React.useState(false)
  const [elapsedMs, setElapsedMs] = React.useState(0)

  React.useEffect(() => {
    let cancelled = false
    let elapsedTimer: number | null = null
    const startedAt = Date.now()
    const deadline = startedAt + 25000
    const wakeTimer = window.setTimeout(() => {
      if (!cancelled) setShowWakeScreen(true)
    }, 900)

    elapsedTimer = window.setInterval(() => {
      if (!cancelled) setElapsedMs(Date.now() - startedAt)
    }, 250)

    const sleep = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms))

    const pingHealth = async () => {
      while (!cancelled && Date.now() < deadline) {
        const controller = new AbortController()
        const timeout = window.setTimeout(() => controller.abort(), 8000)
        const requestStarted = Date.now()
        try {
          const response = await fetch(backendHealthUrl(), {
            method: 'GET',
            cache: 'no-store',
            signal: controller.signal,
          })
          const responseMs = Date.now() - requestStarted
          if (response.ok) {
            try {
              const body = await response.clone().json()
              console.info('[AppLoader] /health ready', {
                response_ms: responseMs,
                utc: body?.wake_status?.utc,
                philippine_time: body?.wake_status?.philippine_time,
                timezone: body?.timezone,
              })
            } catch {
              console.info('[AppLoader] /health ready', { response_ms: responseMs })
            }
            if (!cancelled) {
              setReady(true)
              setShowWakeScreen(false)
            }
            return
          }
        } catch {
          // Backend may be waking. Retry until the safe fallback deadline.
        } finally {
          window.clearTimeout(timeout)
        }
        await sleep(1500)
      }

      if (!cancelled) {
        console.warn('[AppLoader] /health did not respond before fallback timeout; allowing app to render.')
        setReady(true)
        setShowWakeScreen(false)
      }
    }

    void pingHealth()

    return () => {
      cancelled = true
      window.clearTimeout(wakeTimer)
      if (elapsedTimer) window.clearInterval(elapsedTimer)
    }
  }, [])

  if (!ready && showWakeScreen) {
    return (
      <Box minH="100vh" bg="gray.50" display="flex" alignItems="center" justifyContent="center" px={6}>
        <VStack spacing={4} textAlign="center" maxW="360px">
          <SkeletonCircle size="64px" />
          <VStack spacing={1}>
            <Text fontSize="lg" fontWeight="800" color="gray.800">Waking up CloviaPH...</Text>
            <Text fontSize="sm" color="gray.500">
              The backend is starting. This usually takes a few seconds after inactivity.
            </Text>
          </VStack>
          <Text fontSize="xs" color="gray.400">/health waiting {Math.ceil(elapsedMs / 1000)}s</Text>
        </VStack>
      </Box>
    )
  }

  if (!ready) return null
  return <>{children}</>
}

// Main app content component that uses the auth context
const AppContent: React.FC = () => {
  const { user, loading } = useAuth()

  return (
    <>
      {loading && !user ? <LoadingOverlay /> : null}
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
            <Suspense fallback={<RouteFallback />}><RiderHome /></Suspense>
          </PageTransition>
        } />
        <Route path="/rider-application" element={
          <PageTransition>
            <Suspense fallback={<RouteFallback />}><RiderApplication /></Suspense>
          </PageTransition>
        } />
        <Route path="/batch-preview/:batchId" element={
          <PageTransition>
            <Suspense fallback={<RouteFallback />}><BatchPreview /></Suspense>
          </PageTransition>
        } />
        <Route path="/batch-status/:batchId" element={
          <PageTransition>
            <Suspense fallback={<RouteFallback />}><BatchStatus /></Suspense>
          </PageTransition>
        } />
        <Route path="/remittance-ledger" element={
          <PageTransition>
            <Suspense fallback={<RouteFallback />}><RemittanceLedger /></Suspense>
          </PageTransition>
        } />
        <Route path="/task-stepper/:batchId" element={
          <PageTransition>
            <Suspense fallback={<RouteFallback />}><TaskStepper /></Suspense>
          </PageTransition>
        } />
        <Route path="/delivery" element={
          <PageTransition>
            <Suspense fallback={<RouteFallback />}><DeliveryOption /></Suspense>
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
                    <Suspense fallback={<RouteFallback />}><ProductDetail /></Suspense>
                  </PageTransition>
                } />
                <Route path="/products" element={
                  <PageTransition>
                    <Suspense fallback={<RouteFallback />}><ProductsList /></Suspense>
                  </PageTransition>
                } />
                <Route path="/dashboard" element={
                  <PageTransition>
                    <Suspense fallback={<RouteFallback />}><Dashboard key="dashboard-route" /></Suspense>
                  </PageTransition>
                } />
                <Route path="/add-product" element={
                  <PageTransition>
                    <ProtectedRoute><Suspense fallback={<RouteFallback />}><AddProduct /></Suspense></ProtectedRoute>
                  </PageTransition>
                } />
                <Route path="/edit-product/:id" element={
                  <PageTransition>
                    <ProtectedRoute><Suspense fallback={<RouteFallback />}><EditProduct /></Suspense></ProtectedRoute>
                  </PageTransition>
                } />
                <Route path="/notifications" element={
                  <PageTransition>
                    <ProtectedRoute><Suspense fallback={<RouteFallback />}><Notifications /></Suspense></ProtectedRoute>
                  </PageTransition>
                } />
                <Route path="/profile" element={
                  <PageTransition>
                    <ProtectedRoute><Suspense fallback={<RouteFallback />}><Profile /></Suspense></ProtectedRoute>
                  </PageTransition>
                } />
                <Route path="/UserProfile" element={
                  <PageTransition>
                    <ProtectedRoute><Suspense fallback={<RouteFallback />}><UserProfile /></Suspense></ProtectedRoute>
                  </PageTransition>
                } />
                <Route path="/users/:id" element={
                  <PageTransition>
                    <Suspense fallback={<RouteFallback />}><UserProfile /></Suspense>
                  </PageTransition>
                } />
                <Route path="/organizations/new" element={
                  <PageTransition>
                    <ProtectedRoute><Suspense fallback={<RouteFallback />}><CreateOrganization /></Suspense></ProtectedRoute>
                  </PageTransition>
                } />
                <Route path="/organizations" element={
                  <PageTransition>
                    <Suspense fallback={<RouteFallback />}><Organizations /></Suspense>
                  </PageTransition>
                } />
                <Route path="/org/:handle" element={
                  <PageTransition>
                    <Suspense fallback={<RouteFallback />}><OrganizationProfile /></Suspense>
                  </PageTransition>
                } />
                <Route path="/settings" element={
                  <PageTransition>
                    <ProtectedRoute><Suspense fallback={<RouteFallback />}><Settings /></Suspense></ProtectedRoute>
                  </PageTransition>
                } />
                <Route path="/trades" element={
                  <Navigate to="/offers?tab=inbox" replace />
                } />
                <Route path="/offers" element={
                  <PageTransition>
                    <ProtectedRoute><Suspense fallback={<RouteFallback />}><Offers /></Suspense></ProtectedRoute>
                  </PageTransition>
                } />
                <Route path="/saved-products" element={
                  <PageTransition>
                    <PrivateRoute><Suspense fallback={<RouteFallback />}><SavedProducts /></Suspense></PrivateRoute>
                  </PageTransition>
                } />
                <Route path="/admin" element={
                  <PageTransition>
                    <Suspense fallback={<RouteFallback />}>
                      <AdminRoute><AdminDashboard /></AdminRoute>
                    </Suspense>
                  </PageTransition>
                } />
                <Route path="/premium" element={
                  <PageTransition>
                    <ProtectedRoute><Suspense fallback={<RouteFallback />}><Premium /></Suspense></ProtectedRoute>
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
    </>
  )
}

function App() {
  return (
    <ChakraProvider theme={theme} toastOptions={{ defaultOptions: { position: 'top', duration: 4000, isClosable: true } }}>
      <ThemeApplier>
        <AppLoader>
          <AuthProvider>
            <ProductProvider>
              <MobileNavProvider>
                <NotificationProvider>
                  <RealtimeProvider>
                    <Router future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
                      <ErrorBoundary>
                        <SessionTimeoutManager />
                        <ConnectionStatus />
                        <PullToRefresh>
                          <AppContent />
                        </PullToRefresh>
                      </ErrorBoundary>
                      <GlobalPopup />
                      <ToastNotification />
                    </Router>
                  </RealtimeProvider>
                </NotificationProvider>
              </MobileNavProvider>
            </ProductProvider>
          </AuthProvider>
        </AppLoader>
      </ThemeApplier>
    </ChakraProvider>
  )
}

export default App
