import axios, { AxiosError, AxiosRequestConfig } from 'axios'
import { isAuthInvalid, markAuthInvalid } from '../utils/authEvents'
import { clearStoredAuth, getStoredToken } from '../utils/authStorage'

function normalizeLoopbackBaseUrl(raw: string): string {
  try {
    const u = new URL(raw)
    // On some Windows setups, `localhost` resolves to IPv6 `::1`,
    // but the backend may only be listening on IPv4.
    if (u.hostname === 'localhost' || u.hostname === '::1') {
      u.hostname = '127.0.0.1'
    }
    return u.toString().replace(/\/$/, '')
  } catch {
    return raw.replace(/\/$/, '')
  }
}

// Use environment variable for API URL, default to localhost for development
const ENV_API_URL = import.meta.env.VITE_API_URL

export const API_BASE_URL = (ENV_API_URL ? normalizeLoopbackBaseUrl(ENV_API_URL) : '') || (
  import.meta.env.PROD
    ? 'https://clovia-backend.onrender.com'  // Update with your actual Render backend URL
    // In development, use relative baseURL so Vite can proxy `/api`.
    : ''
)

const DEBUG_API = import.meta.env.DEV && localStorage.getItem('debug_api') === 'true'

const protectedApiPrefixes = [
  '/api/auth/refresh-session',
  '/api/users/profile',
  '/api/notifications',
  '/api/chat/stream',
  '/api/trades',
  '/api/dashboard',
  '/api/orders',
  '/api/payments',
  '/api/admin',
  '/api/products/user',
]

const authRecoveryApiPrefixes = [
  '/api/auth/login',
  '/api/auth/google',
  '/api/auth/register',
  '/api/auth/logout',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  '/api/auth/verify-email',
  '/api/auth/resend-verification',
]

const safeMethods = new Set(['get', 'head', 'options'])

const isProtectedApiUrl = (url?: string): boolean => {
  if (!url) return false
  try {
    const parsed = new URL(url, window.location.origin)
    return protectedApiPrefixes.some(prefix => parsed.pathname.startsWith(prefix))
  } catch {
    return protectedApiPrefixes.some(prefix => url.startsWith(prefix))
  }
}

const isAuthRecoveryApiUrl = (url?: string): boolean => {
  if (!url) return false
  try {
    const parsed = new URL(url, window.location.origin)
    return authRecoveryApiPrefixes.some(prefix => parsed.pathname.startsWith(prefix))
  } catch {
    return authRecoveryApiPrefixes.some(prefix => url.startsWith(prefix))
  }
}

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 60000, // Increased from 30s to 60s for slower networks
  withCredentials: true,
})

// Request interceptor to add auth token and log
api.interceptors.request.use(
  (config) => {
    const method = String(config.method || 'get').toLowerCase()
    const isUnsafeApiRequest = !safeMethods.has(method) && String(config.url || '').startsWith('/api/')
    if (isAuthInvalid() && !isAuthRecoveryApiUrl(config.url) && (isProtectedApiUrl(config.url) || isUnsafeApiRequest)) {
      return Promise.reject(new axios.CanceledError('Authentication is invalid'))
    }

    const token = getStoredToken()
    // Ensure headers object exists
    config.headers = config.headers || {}
    if (token) {
      // Do not override if explicitly set by caller
      if (!config.headers['Authorization']) {
        config.headers['Authorization'] = `Bearer ${token}`
      }
    }

    // Ensure Content-Type is set for JSON payloads, but do not override for FormData
    if (config.data && !(config.data instanceof FormData)) {
      config.headers = config.headers || {}
      if (!config.headers['Content-Type']) {
        config.headers['Content-Type'] = 'application/json'
      }
    }

    if (DEBUG_API) {
      try {
        const method = (config.method || 'get').toUpperCase()
        const url = `${config.baseURL || ''}${config.url || ''}`
        const authHeader = (config.headers['Authorization'] || config.headers['authorization']) as string | undefined
        // eslint-disable-next-line no-console
        console.groupCollapsed(`[API REQUEST] ${method} ${url}`)
        // eslint-disable-next-line no-console
        console.log('Token present:', !!token)
        // eslint-disable-next-line no-console
        console.log('Authorization header set:', !!authHeader)
        // eslint-disable-next-line no-console
        console.log('Has params:', !!config.params)
        // eslint-disable-next-line no-console
        console.log('Has body:', !!config.data)
        // eslint-disable-next-line no-console
        console.groupEnd()
      } catch { }
    }

    return config
  },
  (error) => Promise.reject(error)
)

// Response interceptor to log and handle auth
api.interceptors.response.use(
  (response) => {
    if (DEBUG_API) {
      try {
        const cfg = response.config
        const method = (cfg.method || 'get').toUpperCase()
        const url = `${cfg.baseURL || ''}${cfg.url || ''}`
        // eslint-disable-next-line no-console
        console.groupCollapsed(`[API RESPONSE] ${method} ${url} -> ${response.status}`)
        // eslint-disable-next-line no-console
        console.groupEnd()
      } catch { }
    }
    return response
  },
  async (error: AxiosError) => {
    const cfg = error.config as (AxiosRequestConfig & { _retry?: boolean }) | undefined
    const status = error.response?.status
    const url = cfg?.url || ''

    // Detect review submissions so we don't hard-redirect on 401; the UI can prompt login
    const isReviewEndpoint = typeof url === 'string' && /\/api\/users\/\d+\/reviews/i.test(url)

    if (DEBUG_API) {
      try {
        const method = (cfg?.method || 'get').toUpperCase()
        const url = `${cfg?.baseURL || ''}${cfg?.url || ''}`
        // eslint-disable-next-line no-console
        console.groupCollapsed(`[API ERROR] ${method} ${url} -> ${status}`)
        // eslint-disable-next-line no-console
        console.groupEnd()
      } catch { }
    }

    // Simple one-time retry on 401 if token exists but header was missing/not set
    if (status === 401 && cfg && !cfg._retry && !isAuthInvalid()) {
      const token = getStoredToken()
      const authHeader = cfg.headers?.['Authorization'] || cfg.headers?.['authorization']
      if (token && !authHeader) {
        cfg._retry = true
        cfg.headers = cfg.headers || {}
        cfg.headers['Authorization'] = `Bearer ${token}`
        return api(cfg)
      }
    }

    // On 401 after retry failed, let route guards and component-level handlers decide UX.
    // Do NOT hard-redirect here, because some pages are intentionally browsable by guests.
    if (status === 401) {
      if (!isReviewEndpoint) {
        clearStoredAuth()
        delete api.defaults.headers.common['Authorization']
        markAuthInvalid(typeof url === 'string' && url.includes('/api/auth/refresh-session') ? 'refresh_failed' : 'unauthorized')
      }
      if (isReviewEndpoint) {
        return Promise.reject(error)
      }
    }

    return Promise.reject(error)
  }
)

export const tradeService = {
  getTradeLoops: async () => {
    const response = await api.get('/api/trades/loops')
    return response.data
  }
}
