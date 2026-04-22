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

export const getStoredUser = (): string | null => localStorage.getItem(USER_KEY)

export const setStoredUser = (value: string | null): void => {
  if (value) {
    localStorage.setItem(USER_KEY, value)
  } else {
    localStorage.removeItem(USER_KEY)
  }
}

export const clearStoredAuth = (): void => {
  setStoredToken(null)
  setStoredUser(null)
}
