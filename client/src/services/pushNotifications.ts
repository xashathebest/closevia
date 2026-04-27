import { api } from './api'

type PushPublicKeyResponse = {
  enabled?: boolean
  public_key?: string
}

export type PushSubscriptionResult = {
  ok: boolean
  reason?: 'unsupported' | 'not_configured' | 'denied' | 'default' | 'service_worker_unavailable' | 'failed'
  permission?: NotificationPermission
}

export const isPushSupported = (): boolean =>
  typeof window !== 'undefined' &&
  'Notification' in window &&
  'serviceWorker' in navigator &&
  'PushManager' in window

export const getPushPermissionState = (): NotificationPermission | 'unsupported' => {
  if (!isPushSupported()) return 'unsupported'
  return Notification.permission
}

export const isIosBrowser = (): boolean => {
  if (typeof navigator === 'undefined') return false
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

const urlBase64ToUint8Array = (base64String: string): Uint8Array => {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; i += 1) {
    outputArray[i] = rawData.charCodeAt(i)
  }
  return outputArray
}

const getPublicKey = async (): Promise<string | null> => {
  const res = await api.get('/api/push/public-key')
  const data = res.data?.data as PushPublicKeyResponse | undefined
  if (!data?.enabled || !data.public_key) return null
  return data.public_key
}

export const getCurrentPushSubscription = async (): Promise<PushSubscription | null> => {
  if (!isPushSupported()) return null
  const registration = await navigator.serviceWorker.ready
  return registration.pushManager.getSubscription()
}

export const subscribeToPushNotifications = async (): Promise<PushSubscriptionResult> => {
  if (!isPushSupported()) return { ok: false, reason: 'unsupported' }

  const publicKey = await getPublicKey()
  if (!publicKey) return { ok: false, reason: 'not_configured' }

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    return { ok: false, reason: permission === 'denied' ? 'denied' : 'default', permission }
  }

  const registration = await navigator.serviceWorker.ready
  if (!registration?.pushManager) {
    return { ok: false, reason: 'service_worker_unavailable', permission }
  }

  let subscription = await registration.pushManager.getSubscription()
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey),
    })
  }

  await api.post('/api/push/subscribe', subscription.toJSON())
  return { ok: true, permission }
}

export const unsubscribeFromPushNotifications = async (): Promise<void> => {
  if (!isPushSupported()) return
  const subscription = await getCurrentPushSubscription()
  if (subscription) {
    await api.post('/api/push/unsubscribe', { endpoint: subscription.endpoint })
    await subscription.unsubscribe()
    return
  }
  await api.post('/api/push/unsubscribe', {})
}
