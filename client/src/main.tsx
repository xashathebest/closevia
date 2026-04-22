import './devConsoleFilters'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App.tsx'
import '@fontsource/prata/400.css'
import './index.css'
import { initializeInstallPrompt, registerServiceWorker } from './serviceWorkerRegistration'
import { isAuthInvalid } from './utils/authEvents'

// Load and apply font size immediately before React renders
// This ensures the font size is applied on page load without flashing
try {
  const saved = localStorage.getItem('user_settings')
  if (saved) {
    const parsed = JSON.parse(saved)
    if (parsed.fontSize) {
      const fontSize = parsed.fontSize
      const root = document.documentElement
      switch (fontSize) {
        case 'small':
          root.style.fontSize = '14px'
          break
        case 'large':
          root.style.fontSize = '18px'
          break
        case 'extra-large':
          root.style.fontSize = '20px'
          break
        default:
          root.style.fontSize = '16px' // medium
      }
    }
  }
} catch (e) {
  // ignore if localStorage is not available
}

// Configure React Query client for optimal caching
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Cache data for 5 minutes (data stays fresh)
      staleTime: 1000 * 60 * 5, // 5 minutes
      // Keep cached data for 24 hours
      gcTime: 1000 * 60 * 60 * 24, // 24 hours
      // Don't refetch on window focus to prevent unnecessary requests
      refetchOnWindowFocus: false,
      // Don't refetch on reconnect
      refetchOnReconnect: false,
      // Retry transient failures, but never retry auth expiry/cancelled auth requests.
      retry: (failureCount, error: any) => {
        if (isAuthInvalid()) return false
        if (error?.response?.status === 401 || error?.code === 'ERR_CANCELED') return false
        return failureCount < 2
      },
      // Don't refetch on mount if data is fresh
      refetchOnMount: false,
      // Keep previous data while refetching (prevents loading states)
      placeholderData: (previousData: unknown) => previousData,
    },
  },
})

registerServiceWorker()
initializeInstallPrompt()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
)
