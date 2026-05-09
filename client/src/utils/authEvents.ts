import { clearStoredAuth, hasStoredAuthenticatedSession, setStoredAuthenticatedSession } from './authStorage'

const AUTH_INVALID_EVENT = 'clovia:auth-invalid'

let authInvalid = false

export const isAuthInvalid = (): boolean => authInvalid

export const resetAuthInvalid = (): void => {
  authInvalid = false
}

const redirectToExpiredLogin = (): void => {
  if (typeof window === 'undefined') return
  const { pathname, search } = window.location
  if (pathname === '/login' && new URLSearchParams(search).get('expired') === 'true') return
  window.location.replace('/login?expired=true')
}

export const markAuthInvalid = (reason = 'expired'): boolean => {
  if (authInvalid) return false
  authInvalid = true
  setStoredAuthenticatedSession(false)
  clearStoredAuth()
  window.dispatchEvent(new CustomEvent(AUTH_INVALID_EVENT, { detail: { reason } }))
  if (reason === 'expired' || reason === 'unauthorized' || reason === 'refresh_failed') {
    redirectToExpiredLogin()
  }
  return true
}

export const markAuthInvalidIfAuthenticated = (reason = 'expired'): boolean => {
  if (!hasStoredAuthenticatedSession()) return false
  return markAuthInvalid(reason)
}

export const onAuthInvalid = (handler: (reason?: string) => void): (() => void) => {
  const listener = (event: Event) => {
    const detail = event instanceof CustomEvent ? event.detail : undefined
    handler(detail?.reason)
  }
  window.addEventListener(AUTH_INVALID_EVENT, listener)
  return () => window.removeEventListener(AUTH_INVALID_EVENT, listener)
}
