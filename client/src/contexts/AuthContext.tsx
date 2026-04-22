import React, { createContext, useContext, useState, useEffect, ReactNode, useRef } from 'react'
import { User } from '../types'
import { api, API_BASE_URL } from '../services/api'
import { normalizeImageUrl } from '../utils/imageUtils'
import { clearStoredAuth, getStoredToken, getStoredUser, setStoredToken, setStoredUser } from '../utils/authStorage'

interface AuthContextType {
  user: User | null
  token: string | null
  isAuthenticated: boolean
  login: (email: string, password: string) => Promise<void>
  googleLogin: (firebaseToken: string, userData: any) => Promise<void>
  register: (payload: { name: string; email: string; phone?: string; password: string; is_organization?: boolean; org_name?: string; department?: string; org_logo_url?: string; bio?: string; organization_type?: string }) => Promise<{ requiresVerification: boolean; email: string; token?: string }>
  logout: () => void
  updateProfile: (payload: { name?: string; email?: string; profile_picture?: string; phone?: string; phone_verified?: boolean }) => Promise<void>
  refreshUser: () => Promise<void>
  restoreAuthentication: () => Promise<void>
  completeLogin: (token: string, user?: User) => Promise<void>
  loading: boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}

interface AuthProviderProps {
  children: ReactNode
}

// Helper to safely read cached user from storage
const getCachedUser = (): User | null => {
  try {
    const raw = getStoredUser()
    if (raw) {
      const cached = JSON.parse(raw)
      if (typeof cached?.profile_picture === 'string') {
        cached.profile_picture = normalizeImageUrl(cached.profile_picture)
      }
      return cached
    }
  } catch (e) { /* corrupted data */ }
  return null
}

const getPersistableUser = (user: User): Record<string, unknown> => {
  const source = user as any
  return {
    id: source.id,
    slug: source.slug,
    name: source.name,
    email: source.email,
    role: source.role,
    verified: source.verified,
    is_organization: source.is_organization,
    org_verified: source.org_verified,
    org_name: source.org_name,
    profile_picture: source.profile_picture,
    language_preference: source.language_preference,
    background_image: source.background_image,
    background_position: source.background_position,
    home_latitude: source.home_latitude,
    home_longitude: source.home_longitude,
    home_address: source.home_address,
    is_premium: source.is_premium,
    premium_tier: source.premium_tier,
    notification_preferences: source.notification_preferences,
    email_notifications_enabled: source.email_notifications_enabled,
    push_notifications_enabled: source.push_notifications_enabled,
    activity_status: source.activity_status,
  }
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  // Synchronously initialize from localStorage so auth survives refresh
  const [user, setUserState] = useState<User | null>(() => getCachedUser())
  const [token, setTokenState] = useState<string | null>(() => getStoredToken())
  const [loading, setLoading] = useState(true)
  const [authInitialized, setAuthInitialized] = useState(false)
  const initOnceRef = useRef(false)
  const lastNetworkErrorRef = useRef<number>(0)
  const restoringRef = useRef(false)

  // Wrappers that keep localStorage in sync with React state
  const setToken = (newToken: string | null) => {
    setTokenState(newToken)
    setStoredToken(newToken)
  }

  const setUser = (newUser: User | null | ((prev: User | null) => User | null)) => {
    setUserState(prev => {
      const resolved = typeof newUser === 'function' ? newUser(prev) : newUser
      if (resolved) {
        setStoredUser(JSON.stringify(getPersistableUser(resolved)))
      } else {
        setStoredUser(null)
      }
      return resolved
    })
  }

  // Set auth header immediately if token exists (before any useEffect fires)
  if (token) {
    api.defaults.headers.common['Authorization'] = `Bearer ${token}`
  }

  const normalizeProfilePicture = (pic?: string) => {
    if (!pic || typeof pic !== 'string') return pic
    const cleaned = pic.replace(/[?&]t=\d+/g, '')
    const normalized = normalizeImageUrl(cleaned)
    return normalized.startsWith('/') ? `${API_BASE_URL}${normalized}` : normalized
  }

  const normalizeUser = (data: any) => {
    if (!data) return data
    const normalized = { ...data }
    if (typeof normalized.profile_picture === 'string') {
      normalized.profile_picture = normalizeProfilePicture(normalized.profile_picture)
    }
    return normalized
  }

  // Computed authentication state
  const isAuthenticated = !!user

  useEffect(() => {
    // Prevent double execution in React StrictMode (dev)
    if (initOnceRef.current) return
    initOnceRef.current = true

    // Initialize auth synchronously from localStorage first
    const initializeAuth = async () => {
      try {
        // Development mode: skip authentication for faster development
        const skipAuth = localStorage.getItem('skip_auth') === 'true'
        if (skipAuth) {
          setAuthInitialized(true)
          setLoading(false)
          return
        }

        // Check if user is logged in on app start
        const storedToken = getStoredToken()

        if (storedToken) {
          api.defaults.headers.common['Authorization'] = `Bearer ${storedToken}`
        }
        await fetchUserProfile(storedToken || undefined)
      } catch {
      } finally {
        setAuthInitialized(true)
        setLoading(false)
      }
    }

    initializeAuth()
  }, [])

  const fetchUserProfile = async (currentToken?: string) => {
    try {
      // Add timeout to prevent infinite loading (generous for mobile connections)
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 15000) // 15 second timeout

      const response = await api.get('/api/users/profile', {
        signal: controller.signal
      })

      clearTimeout(timeoutId)

      const rawData = response.data.data
      const userData = normalizeUser(rawData?.user || rawData)
      setUser(userData)

      // If token was passed, ensure it's set in state
      if (currentToken && !token) {
        setToken(currentToken)
      }
    } catch (error: any) {
      // Ignore canceled requests (happens during navigation or component unmount)
      if (error.name === 'CanceledError' || error.code === 'ERR_CANCELED') {
        return
      }

      // Only clear auth if it's a genuine 401 (unauthorized) error
      if (error.response?.status === 401) {
        setToken(null)
        setUser(null)
        delete api.defaults.headers.common['Authorization']
      } else if (error.response?.status === 404) {
        // User not found in database - clear auth
        setToken(null)
        setUser(null)
        delete api.defaults.headers.common['Authorization']
      } else {
        // For network errors, timeouts, or server errors (5xx):
        // Keep the token AND user from cache so the user stays logged in
      }

      // If it's a network error or timeout, show a more specific message
      if (error.name === 'AbortError') {
      } else if (error.code === 'NETWORK_ERROR' || !error.response) {
        const now = Date.now()
        if (now - lastNetworkErrorRef.current > 5000) {
          lastNetworkErrorRef.current = now
        }
      } else if (error.response?.status === 401) {
      }
    }
  }

  // Exposed helper to allow components to refresh user data after updates
  const refreshUser = async () => {
    // Don't change loading state - just refresh user data silently
    await fetchUserProfile(token || undefined)
  }

  // Helper to check and restore authentication from stored token
  const restoreAuthentication = async () => {
    if (restoringRef.current) return
    restoringRef.current = true
    try {
      const storedToken = getStoredToken()
      if (storedToken) {
        // Ensure axios is using the stored token
        if (storedToken !== token) {
          setToken(storedToken)
        }
        api.defaults.headers.common['Authorization'] = `Bearer ${storedToken}`
      }

      // If user is missing, fetch profile to populate it
      if (!user) {
        await fetchUserProfile(storedToken || undefined)
      }
    } finally {
      restoringRef.current = false
    }
  }

  const login = async (email: string, password: string) => {
    try {
      const response = await api.post('/api/auth/login', { email, password })
      const { token: newToken, user: userData } = response.data.data

      // Use centralized completeLogin to handle state and persistence
      const normalizedUser = await completeLogin(newToken, userData)

      return normalizedUser
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Login failed')
    }
  }

  const completeLogin = async (newToken: string, userData?: User) => {
    // 1. Set authorization header for current and future requests
    api.defaults.headers.common['Authorization'] = `Bearer ${newToken}`
    
    // 2. Update token state (triggers localStorage update via wrapper)
    setToken(newToken)
    
    // 3. Update user state if provided, otherwise fetch it
    let finalUser = userData ? normalizeUser(userData) : null
    
    if (finalUser) {
      setUser(finalUser)
    }
    
    // 4. Always ensure we have the latest profile from server
    // (This also handles the case where userData wasn't provided)
    await fetchUserProfile(newToken)
    
    // Get the updated user from state or freshly fetched
    // Note: setUser is async-ish via state update, so we return what we just fetched/normalized
    return finalUser
  }

  const googleLogin = async (firebaseToken: string, userData: any) => {
    try {
      const response = await api.post('/api/auth/google', {
        idToken: firebaseToken,
        uid: userData.uid,
        email: userData.email,
        displayName: userData.displayName,
        photoURL: userData.photoURL,
      })
      const { token: newToken, user: userDataResponse } = response.data.data

      // Use centralized completeLogin to handle state and persistence
      const normalizedUser = await completeLogin(newToken, userDataResponse)
      
      return normalizedUser
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Google login failed')
    }
  }

  const updateProfile = async (payload: { name?: string; email?: string; profile_picture?: string; phone?: string; phone_verified?: boolean }) => {
    try {
      // Only call backend for fields the server accepts (name/email)
      const serverPayload: any = {}
      if (payload.name !== undefined) serverPayload.name = payload.name
      if (payload.email !== undefined) serverPayload.email = payload.email
      if (payload.profile_picture !== undefined) serverPayload.profile_picture = payload.profile_picture
      if (payload.phone !== undefined) serverPayload.phone = payload.phone
      if (payload.phone_verified !== undefined) serverPayload.phone_verified = payload.phone_verified

      if (Object.keys(serverPayload).length > 0) {
        await api.put('/api/users/profile', serverPayload)
      }

      // Update local user state but only overwrite fields that are defined
      setUser((prev) => {
        const updated = prev ? { ...(prev as any) } as User : {} as User
        if (payload.name !== undefined) updated.name = payload.name as string
        if (payload.email !== undefined) updated.email = payload.email as string
        if (payload.phone !== undefined) updated.phone = payload.phone as string
        if (payload.phone_verified !== undefined) (updated as any).phone_verified = payload.phone_verified as boolean
        if (payload.profile_picture !== undefined) {
          // Normalize stored profile picture URL if backend returned a relative path
          updated.profile_picture = normalizeProfilePicture(payload.profile_picture as string) as string
        }
        // If there was no previous user, and we have at least one field, return it
        if (!prev) {
          return updated
        }
        return updated
      })
    } catch (error: any) {
      // bubble up error to caller
      throw error
    }
  }

  const register = async (payload: { name: string; email: string; phone?: string; password: string; is_organization?: boolean; org_name?: string; department?: string; org_logo_url?: string; bio?: string; organization_type?: string }): Promise<{ requiresVerification: boolean; email: string; token?: string }> => {
    try {
      const response = await api.post('/api/auth/register', payload)

      const responseData = response.data.data
      const requiresVerification = !!(responseData?.requires_verification)

      if (requiresVerification) {
        return { requiresVerification: true, email: payload.email }
      }

      // Verification disabled — token returned directly; store it and log the user in
      const { token: newToken, user: userData } = responseData

      // Use centralized completeLogin to handle state and persistence
      await completeLogin(newToken, userData)

      return { requiresVerification: false, email: payload.email, token: newToken }
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Registration failed')
    }
  }

  const logout = () => {
    void api.post('/api/auth/logout').catch(() => undefined)
    delete api.defaults.headers.common['Authorization']
    clearStoredAuth()
    setTokenState(null)
    setUserState(null)
  }

  const value: AuthContextType = {
    user,
    token,
    isAuthenticated,
    login,
    googleLogin,
    register,
    logout,
    updateProfile,
    refreshUser,
    restoreAuthentication,
    completeLogin,
    loading,
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}
