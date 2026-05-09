import axios, { AxiosError, AxiosRequestConfig } from 'axios'
import { isAuthInvalid, markAuthInvalidIfAuthenticated } from '../utils/authEvents'
import { hasStoredAuthenticatedSession } from '../utils/authStorage'

function normalizeLoopbackBaseUrl(raw: string): string {
  try {
    const u = new URL(raw)
    // Keep `localhost` as-is in the browser so dev cookies stay on the same
    // site (`localhost` <-> `localhost`). Rewriting to `127.0.0.1` breaks
    // cookie-backed auth because the browser treats them as different hosts.
    if (u.hostname === '::1') {
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
  '/api/push',
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

const SLOW_API_THRESHOLD_MS = 500
const OLD_LOCATION_ACCURACY_ERROR = 'Location accuracy is too low. Please move to an open area and try again.'
const LOCATION_DISTANCE_ERROR = 'Move closer to the pickup/meetup location.'

const normalizeApiErrorMessage = (value: unknown): string | null => {
  if (typeof value !== 'string') return null
  return value.trim() === OLD_LOCATION_ACCURACY_ERROR ? LOCATION_DISTANCE_ERROR : value
}

// Request interceptor to add auth token and log
api.interceptors.request.use(
  (config) => {
    const method = String(config.method || 'get').toLowerCase()
    const isUnsafeApiRequest = !safeMethods.has(method) && String(config.url || '').startsWith('/api/')
    if (isAuthInvalid() && !isAuthRecoveryApiUrl(config.url) && (isProtectedApiUrl(config.url) || isUnsafeApiRequest)) {
      return Promise.reject(new axios.CanceledError('Authentication is invalid'))
    }

    config.headers = config.headers || {}

    // Ensure Content-Type is set for JSON payloads, but do not override for FormData
    if (config.data && !(config.data instanceof FormData)) {
      config.headers = config.headers || {}
      if (!config.headers['Content-Type']) {
        config.headers['Content-Type'] = 'application/json'
      }
    }

    // Stamp start time for response-duration tracking
    if (import.meta.env.DEV) {
      (config as any)._t0 = Date.now()
    }

    if (DEBUG_API) {
      try {
        const method = (config.method || 'get').toUpperCase()
        const url = `${config.baseURL || ''}${config.url || ''}`
        const authHeader = (config.headers['Authorization'] || config.headers['authorization']) as string | undefined
        // eslint-disable-next-line no-console
        console.groupCollapsed(`[API REQUEST] ${method} ${url}`)
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
    if (import.meta.env.DEV) {
      try {
        const cfg = response.config as any
        const elapsed = cfg._t0 ? Date.now() - cfg._t0 : null
        const method = (cfg.method || 'get').toUpperCase()
        const url = cfg.url || ''
        if (elapsed !== null && elapsed >= SLOW_API_THRESHOLD_MS) {
          // eslint-disable-next-line no-console
          console.warn(`[SLOW API] ${method} ${url} → ${response.status} (${elapsed}ms)`)
        }
        if (DEBUG_API) {
          const fullUrl = `${cfg.baseURL || ''}${url}`
          const label = elapsed !== null ? `${elapsed}ms` : '?ms'
          // eslint-disable-next-line no-console
          console.groupCollapsed(`[API RESPONSE] ${method} ${fullUrl} -> ${response.status} (${label})`)
          // eslint-disable-next-line no-console
          console.groupEnd()
        }
      } catch { }
    }
    return response
  },
  async (error: AxiosError) => {
    const cfg = error.config as (AxiosRequestConfig & { _retry?: boolean }) | undefined
    const status = error.response?.status
    const requestId = error.response?.headers?.['x-request-id'] || error.response?.headers?.['X-Request-ID']
    const url = cfg?.url || ''
    const method = String(cfg?.method || 'get').toLowerCase()
    const isUnsafeApiRequest = !safeMethods.has(method) && String(url).startsWith('/api/')

    // Detect review submissions so we don't hard-redirect on 401; the UI can prompt login
    const isReviewEndpoint = typeof url === 'string' && /\/api\/users\/\d+\/reviews/i.test(url)

    if (import.meta.env.DEV) {
      try {
        const elapsed = (cfg as any)?._t0 ? Date.now() - (cfg as any)._t0 : null
        const m = (cfg?.method || 'get').toUpperCase()
        const u = cfg?.url || ''
        if (elapsed !== null && elapsed >= SLOW_API_THRESHOLD_MS) {
          // eslint-disable-next-line no-console
          console.warn(`[SLOW API] ${m} ${u} → ${status ?? 'ERR'} (${elapsed}ms)`)
        }
        if (DEBUG_API) {
          const fullUrl = `${cfg?.baseURL || ''}${u}`
          const label = elapsed !== null ? `${elapsed}ms` : '?ms'
          // eslint-disable-next-line no-console
          console.groupCollapsed(`[API ERROR] ${m} ${fullUrl} -> ${status} (${label})`)
          // eslint-disable-next-line no-console
          console.groupEnd()
        }
      } catch { }
    }
    ;(error as any).requestId = requestId
    const responseData = error.response?.data as any
    if (responseData && typeof responseData === 'object') {
      const normalizedError = normalizeApiErrorMessage(responseData.error)
      if (normalizedError) responseData.error = normalizedError
      const normalizedMessage = normalizeApiErrorMessage(responseData.message)
      if (normalizedMessage) responseData.message = normalizedMessage
    }
    if (requestId && (status ?? 0) >= 400) {
      // eslint-disable-next-line no-console
      console.warn(`[API ERROR] request_id=${requestId} status=${status ?? 'ERR'} url=${url}`)
    }

    if (status === 401) {
      const shouldInvalidateAuthenticatedSession = !isAuthRecoveryApiUrl(url) && hasStoredAuthenticatedSession()

      if (shouldInvalidateAuthenticatedSession) {
        markAuthInvalidIfAuthenticated(typeof url === 'string' && url.includes('/api/auth/refresh-session') ? 'refresh_failed' : 'unauthorized')
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
