export const motionDurations = {
  ui: 0.18,
  uiSlow: 0.24,
  page: 0.3,
  pageSlow: 0.34,
}

export const motionEasings = {
  easeOut: [0.16, 1, 0.3, 1] as const,
  easeInOut: [0.4, 0, 0.2, 1] as const,
}

export const uiTap = {
  scale: 0.97,
  transition: {
    duration: motionDurations.ui,
    ease: motionEasings.easeOut,
  },
}

export const cardReveal = {
  hidden: { opacity: 0, y: 10 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: motionDurations.uiSlow,
      ease: motionEasings.easeOut,
    },
  },
}

export const softFade = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      duration: motionDurations.uiSlow,
      ease: motionEasings.easeOut,
    },
  },
  exit: {
    opacity: 0,
    transition: {
      duration: motionDurations.ui,
      ease: motionEasings.easeInOut,
    },
  },
}

// Directional slide variants for multi-step forms (ProductUploadFlow, etc.)
export const stepTransition = {
  forward: {
    initial: { opacity: 0, x: 28, scale: 0.99 },
    animate: { opacity: 1, x: 0, scale: 1 },
    exit:    { opacity: 0, x: -16, scale: 0.99 },
  },
  back: {
    initial: { opacity: 0, x: -28, scale: 0.99 },
    animate: { opacity: 1, x: 0, scale: 1 },
    exit:    { opacity: 0, x: 16, scale: 0.99 },
  },
} as const

// Stronger tap feedback for primary CTAs (Trade, Accept, Send Offer, Buyout)
export const tapGlow = {
  scale: 0.95,
  transition: {
    duration: motionDurations.ui,
    ease: motionEasings.easeOut,
  },
}

// Stagger container for list entrances (notifications, offer cards)
export const staggerContainer = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.045 } },
}

export const staggerItem = {
  hidden: { opacity: 0, y: 7, scale: 0.98 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: motionDurations.uiSlow, ease: motionEasings.easeOut },
  },
}

export const productImageTransitionName = (productId: number | string | undefined | null) => (
  productId ? `product-image-${String(productId).replace(/[^a-zA-Z0-9_-]/g, '')}` : undefined
)

export const runViewTransition = (callback: () => void) => {
  const doc = document as Document & { startViewTransition?: (callback: () => void) => void }
  if (typeof doc.startViewTransition === 'function' && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    doc.startViewTransition(callback)
    return
  }
  callback()
}
