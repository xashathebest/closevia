import { IconType } from 'react-icons'
import { FaBagShopping, FaBook, FaMobileScreen, FaLaptop, FaShirt, FaGem, FaHouse, FaBox, FaStar, FaCar, FaBaseball, FaBlender } from 'react-icons/fa6'
import { MdLocalOffer, MdCategory, MdLocalFlorist, MdBuild, MdWeekend, MdChildCare, MdBrush, MdSpa } from 'react-icons/md'

export interface CategoryConfig {
  /** Exact value stored in the database / sent to the API */
  value: string
  /** Display label (may differ from value) */
  label: string
  icon: IconType
  color: string
  lightColor: string
  accentColor: string
}

/**
 * Single source of truth for product categories.
 * Used by both the AddProduct form and the Home page filter pills.
 * `value` must match exactly what is stored in the products.category column.
 */
export const PRODUCT_CATEGORIES: CategoryConfig[] = [
  { value: 'Electronics',     label: 'Electronics',     icon: FaLaptop,     color: 'blue.500',    lightColor: 'blue.50',    accentColor: 'blue.600' },
  { value: 'Mobile Phones',   label: 'Phones',          icon: FaMobileScreen, color: 'cyan.500',  lightColor: 'cyan.50',    accentColor: 'cyan.600' },
  { value: 'Home Appliances', label: 'Appliances',      icon: FaBlender,    color: 'green.500',   lightColor: 'green.50',   accentColor: 'green.600' },
  { value: 'Furniture',       label: 'Furniture',       icon: MdWeekend,    color: 'teal.500',    lightColor: 'teal.50',    accentColor: 'teal.600' },
  { value: 'Plants',          label: 'Plants',          icon: MdLocalFlorist, color: 'green.600', lightColor: 'green.50',   accentColor: 'green.700' },
  { value: 'Fashion',         label: 'Fashion',         icon: FaShirt,      color: 'pink.500',    lightColor: 'pink.50',    accentColor: 'pink.600' },
  { value: 'Beauty & Personal Care', label: 'Beauty',   icon: MdSpa,        color: 'rose.500',    lightColor: 'rose.50',    accentColor: 'rose.600' },
  { value: 'Collectibles',    label: 'Collectibles',    icon: FaGem,        color: 'yellow.500',  lightColor: 'yellow.50',  accentColor: 'yellow.600' },
  { value: 'Sports',          label: 'Sports',          icon: FaBaseball,   color: 'orange.500',  lightColor: 'orange.50',  accentColor: 'orange.600' },
  { value: 'Toys',            label: 'Toys',            icon: FaBox,        color: 'teal.500',    lightColor: 'teal.50',    accentColor: 'teal.600' },
  { value: 'Accessories',      label: 'Accessories',     icon: FaBagShopping, color: 'purple.500', lightColor: 'purple.50',  accentColor: 'purple.600' },
  { value: 'Books',           label: 'Books',           icon: FaBook,       color: 'purple.500',  lightColor: 'purple.50',  accentColor: 'purple.600' },
  { value: 'Arts & Crafts',    label: 'Arts & Crafts',   icon: MdBrush,      color: 'orange.600',  lightColor: 'orange.50',  accentColor: 'orange.700' },
  { value: 'Automotive',      label: 'Automotive',      icon: FaCar,        color: 'red.500',     lightColor: 'red.50',     accentColor: 'red.600' },
  { value: 'Parts & Accessories', label: 'Parts',       icon: MdBuild,      color: 'gray.500',    lightColor: 'gray.50',    accentColor: 'gray.600' },
  { value: 'Other',           label: 'Other',           icon: MdCategory,   color: 'gray.400',    lightColor: 'gray.50',    accentColor: 'gray.500' },
]

/** The "All" pill used only on the Home page filter bar */
export const ALL_CATEGORY: CategoryConfig = {
  value: 'All',
  label: 'All',
  icon: MdLocalOffer,
  color: 'brand.500',
  lightColor: 'brand.50',
  accentColor: 'brand.600',
}

/** Categories array with the "All" option prepended (for Home page pills) */
export const FILTER_CATEGORIES: CategoryConfig[] = [ALL_CATEGORY, ...PRODUCT_CATEGORIES]

/** Just the category values for validation */
export const CATEGORY_VALUES = PRODUCT_CATEGORIES.map(c => c.value)

export const normalizeWantedCategories = (value: unknown): string[] => {
  let raw: unknown = value
  if (typeof raw === 'string') {
    const trimmed = raw.trim()
    if (!trimmed) return []
    try {
      raw = JSON.parse(trimmed)
    } catch {
      raw = trimmed.split(',')
    }
  }

  if (!Array.isArray(raw)) return []

  const seen = new Set<string>()
  return raw
    .map(item => String(item).trim())
    .filter(item => {
      if (!item) return false
      const key = item.toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, 3)
}

export const getCategoryLabel = (value: string): string => (
  PRODUCT_CATEGORIES.find(category => category.value === value || category.label === value)?.label || value
)
