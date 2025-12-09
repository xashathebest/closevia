import axios, { AxiosError, AxiosRequestConfig } from 'axios'

export const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000'
const DEBUG_API = localStorage.getItem('debug_api') === 'true'

export const api = axios.create({
  baseURL: API_BASE_URL,
})

// Request interceptor to add auth token and log
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('clovia_token')
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
        // Only log header presence, not full token
        const authHeader = (config.headers['Authorization'] || config.headers['authorization']) as string | undefined
        // eslint-disable-next-line no-console
        console.groupCollapsed(`[API REQUEST] ${method} ${url}`)
        // eslint-disable-next-line no-console
        console.log('Token present:', !!token)
        // eslint-disable-next-line no-console
        console.log('Authorization header set:', !!authHeader, authHeader ? `${authHeader.slice(0, 20)}…` : '')
        // eslint-disable-next-line no-console
        console.log('Params:', config.params)
        // eslint-disable-next-line no-console
        console.log('Data:', config.data)
        // eslint-disable-next-line no-console
        console.groupEnd()
      } catch {}
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
        console.log('Data:', response.data)
        // eslint-disable-next-line no-console
        console.groupEnd()
      } catch {}
    }
    return response
  },
  async (error: AxiosError) => {
    const cfg = error.config as (AxiosRequestConfig & { _retry?: boolean }) | undefined
    const status = error.response?.status

    if (DEBUG_API) {
      try {
        const method = (cfg?.method || 'get').toUpperCase()
        const url = `${cfg?.baseURL || ''}${cfg?.url || ''}`
        // eslint-disable-next-line no-console
        console.groupCollapsed(`[API ERROR] ${method} ${url} -> ${status}`)
        // eslint-disable-next-line no-console
        console.log('Response data:', error.response?.data)
        // eslint-disable-next-line no-console
        console.log('Headers on request:', cfg?.headers)
        // eslint-disable-next-line no-console
        console.groupEnd()
      } catch {}
    }

    // Simple one-time retry on 401 if token exists but header was missing/not set
    if (status === 401 && cfg && !cfg._retry) {
      const token = localStorage.getItem('clovia_token')
      if (token) {
        cfg._retry = true
        cfg.headers = cfg.headers || {}
        cfg.headers['Authorization'] = `Bearer ${token}`
        return api(cfg)
      }
    }

    // On 401, clear token and redirect to login
    if (status === 401) {
      localStorage.removeItem('clovia_token')
      // Avoid infinite redirect loops in debug
      if (window.location.pathname !== '/login') {
        window.location.href = '/login'
      }
    }

    return Promise.reject(error)
  }
)
