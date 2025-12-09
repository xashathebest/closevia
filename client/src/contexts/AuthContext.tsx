import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { User } from '../types'
import { api, API_BASE_URL } from '../services/api'

interface AuthContextType {
  user: User | null
  token: string | null
  login: (email: string, password: string) => Promise<void>
  register: (payload: { name: string; email: string; password: string; is_organization?: boolean; org_name?: string; department?: string; org_logo_url?: string; bio?: string }) => Promise<void>
  logout: () => void
  updateProfile: (payload: { name?: string; email?: string; profile_picture?: string }) => Promise<void>
  refreshUser: () => Promise<void>
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

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Development mode: skip authentication for faster development
    const skipAuth = localStorage.getItem('skip_auth') === 'true'
    if (skipAuth) {
      console.log('Development mode: skipping authentication')
      setLoading(false)
      return
    }

    // Check if user is logged in on app start
    const storedToken = localStorage.getItem('clovia_token')
    if (storedToken) {
      setToken(storedToken)
      api.defaults.headers.common['Authorization'] = `Bearer ${storedToken}`
      fetchUserProfile()
    } else {
      setLoading(false)
    }

    // More aggressive fallback: force loading to stop after 3 seconds
    const fallbackTimer = setTimeout(() => {
      console.log('Loading timeout - forcing loading state to false')
      setLoading(false)
    }, 3000) // 3 second fallback

    return () => clearTimeout(fallbackTimer)
  }, [])

  const fetchUserProfile = async () => {
    try {
      // Add timeout to prevent infinite loading
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 2000) // 2 second timeout
      
      const response = await api.get('/api/users/profile', {
        signal: controller.signal
      })
      
      clearTimeout(timeoutId)
      // Normalize profile_picture: if backend returned a relative path ("/uploads/.."),
      // prefix it with the API base URL so the browser loads from the backend origin.
      const userData = response.data.data as any
      if (userData && userData.profile_picture && typeof userData.profile_picture === 'string') {
        if (userData.profile_picture.startsWith('/')) {
          userData.profile_picture = `${API_BASE_URL}${userData.profile_picture}`
        }
      }
      setUser(userData)
    } catch (error: any) {
      console.error('Failed to fetch user profile:', error)
      
      // Clear invalid token and user data
      localStorage.removeItem('clovia_token')
      setToken(null)
      setUser(null)
      
      // If it's a network error or timeout, show a more specific message
      if (error.name === 'AbortError') {
        console.log('Request timeout - backend might be down')
      } else if (error.code === 'NETWORK_ERROR' || !error.response) {
        console.log('Network error - backend might be down')
      }
    } finally {
      setLoading(false)
    }
  }

  // Exposed helper to allow components to refresh user data after updates
  const refreshUser = async () => {
    setLoading(true)
    await fetchUserProfile()
  }

  const login = async (email: string, password: string) => {
    try {
      const response = await api.post('/api/auth/login', { email, password })
      const { token: newToken, user: userData } = response.data.data
      
      setToken(newToken)
      setUser(userData)
      localStorage.setItem('clovia_token', newToken)
      api.defaults.headers.common['Authorization'] = `Bearer ${newToken}`
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Login failed')
    }
  }

  const updateProfile = async (payload: { name?: string; email?: string; profile_picture?: string }) => {
    try {
      // Only call backend for fields the server accepts (name/email)
      const serverPayload: any = {}
      if (payload.name !== undefined) serverPayload.name = payload.name
      if (payload.email !== undefined) serverPayload.email = payload.email
      if (payload.profile_picture !== undefined) serverPayload.profile_picture = payload.profile_picture

      if (Object.keys(serverPayload).length > 0) {
        await api.put('/api/users/profile', serverPayload)
      }

      // Update local user state but only overwrite fields that are defined
      setUser((prev) => {
        const updated = prev ? { ...(prev as any) } as User : {} as User
        if (payload.name !== undefined) updated.name = payload.name as string
        if (payload.email !== undefined) updated.email = payload.email as string
        if (payload.profile_picture !== undefined) {
          // Normalize stored profile picture URL if backend returned a relative path
          let pic = payload.profile_picture as string
          if (pic.startsWith('/')) pic = `${API_BASE_URL}${pic}`
          updated.profile_picture = pic
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

  const register = async (payload: { name: string; email: string; password: string; is_organization?: boolean; org_name?: string; department?: string; org_logo_url?: string; bio?: string }) => {
    try {
      const response = await api.post('/api/auth/register', payload)
      const { token: newToken, user: userData } = response.data.data
      
      setToken(newToken)
      setUser(userData)
      localStorage.setItem('clovia_token', newToken)
      api.defaults.headers.common['Authorization'] = `Bearer ${newToken}`
    } catch (error: any) {
      throw new Error(error.response?.data?.error || 'Registration failed')
    }
  }

  const logout = () => {
    setUser(null)
    setToken(null)
    localStorage.removeItem('clovia_token')
    delete api.defaults.headers.common['Authorization']
  }

  const value: AuthContextType = {
    user,
    token,
    login,
    register,
    logout,
    updateProfile,
    refreshUser,
    loading,
  }

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  )
}
