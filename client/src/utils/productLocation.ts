import type { Product } from '../types'

const PRIVATE_HOME_LABELS = new Set([
  'private saved home location',
  'saved home location',
  'home location',
])

const looksLikeCoordinates = (value: string) => /^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(value.trim())

const cleanLocationText = (value?: string) => {
  const text = String(value || '').trim()
  if (!text) return ''
  if (PRIVATE_HOME_LABELS.has(text.toLowerCase())) return ''
  if (looksLikeCoordinates(text)) return ''
  return text
}

// Drop the first comma-delimited segment when there are 3+ parts (removes street number/name)
// so we show barangay/area level rather than an exact street address.
const toAreaLabel = (text: string): string => {
  const parts = text.split(',').map(s => s.trim()).filter(Boolean)
  if (parts.length <= 2) return text
  return parts.slice(1).join(', ')
}

export const getProductLocationLabel = (product: Partial<Product> | null | undefined): string => {
  if (!product) return ''

  const pickupAddress = cleanLocationText(product.pickup_address)
  const location = cleanLocationText(product.location)
  const area = location || pickupAddress
  if (!area) return ''

  return `Near ${toAreaLabel(area)}`
}

export const getProductRawLocation = (product: Partial<Product> | null | undefined): string | null => {
  if (!product) return null
  const pickupAddress = cleanLocationText(product.pickup_address)
  const location = cleanLocationText(product.location)
  return location || pickupAddress || null
}

export const getProductLocationKey = (product: Partial<Product> | null | undefined): string => {
  return getProductLocationLabel(product).toLowerCase().replace(/\s+/g, ' ').trim()
}
