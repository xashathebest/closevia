const AUTH_INVALID_EVENT = 'clovia:auth-invalid'

let authInvalid = false

export const isAuthInvalid = (): boolean => authInvalid

export const resetAuthInvalid = (): void => {
  authInvalid = false
}

export const markAuthInvalid = (reason = 'expired'): boolean => {
  if (authInvalid) return false
  authInvalid = true
  window.dispatchEvent(new CustomEvent(AUTH_INVALID_EVENT, { detail: { reason } }))
  return true
}

export const onAuthInvalid = (handler: (reason?: string) => void): (() => void) => {
  const listener = (event: Event) => {
    const detail = event instanceof CustomEvent ? event.detail : undefined
    handler(detail?.reason)
  }
  window.addEventListener(AUTH_INVALID_EVENT, listener)
  return () => window.removeEventListener(AUTH_INVALID_EVENT, listener)
}
