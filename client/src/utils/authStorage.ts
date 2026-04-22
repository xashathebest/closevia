const TOKEN_KEY = 'clovia_token'
const USER_KEY = 'clovia_user'

export const getStoredToken = (): string | null => {
  const sessionToken = sessionStorage.getItem(TOKEN_KEY)
  if (sessionToken) return sessionToken

  const legacyToken = localStorage.getItem(TOKEN_KEY)
  if (legacyToken) {
    sessionStorage.setItem(TOKEN_KEY, legacyToken)
    localStorage.removeItem(TOKEN_KEY)
    return legacyToken
  }

  return null
}

export const setStoredToken = (token: string | null): void => {
  if (token) {
    sessionStorage.setItem(TOKEN_KEY, token)
  } else {
    sessionStorage.removeItem(TOKEN_KEY)
  }
  localStorage.removeItem(TOKEN_KEY)
}

export const getStoredUser = (): string | null => {
  const sessionUser = sessionStorage.getItem(USER_KEY)
  if (sessionUser) return sessionUser

  const legacyUser = localStorage.getItem(USER_KEY)
  if (!legacyUser) return null

  // Older builds stored user data without guaranteeing a usable token in this
  // browser tab. Only migrate it when this session also has auth material.
  if (getStoredToken()) {
    sessionStorage.setItem(USER_KEY, legacyUser)
    localStorage.removeItem(USER_KEY)
    return legacyUser
  }

  localStorage.removeItem(USER_KEY)
  return null
}

export const setStoredUser = (value: string | null): void => {
  if (value) {
    sessionStorage.setItem(USER_KEY, value)
  } else {
    sessionStorage.removeItem(USER_KEY)
  }
  localStorage.removeItem(USER_KEY)
}

export const clearStoredAuth = (): void => {
  setStoredToken(null)
  setStoredUser(null)
  localStorage.removeItem(TOKEN_KEY)
  localStorage.removeItem(USER_KEY)
}
