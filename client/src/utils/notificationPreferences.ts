export type NotificationPreferenceKey =
  | 'trade_matches'
  | 'multiway_trades'
  | 'offers_received'
  | 'offers_accepted'
  | 'offers_rejected'
  | 'trade_updates'
  | 'meetup_updates'
  | 'chat_messages'
  | 'review_reminders'
  | 'account_security'
  | 'system_announcements'

export type NotificationPreferences = Record<NotificationPreferenceKey, boolean>

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = {
  trade_matches: true,
  multiway_trades: true,
  offers_received: true,
  offers_accepted: true,
  offers_rejected: true,
  trade_updates: true,
  meetup_updates: true,
  chat_messages: true,
  review_reminders: true,
  account_security: true,
  system_announcements: true,
}

export const parseNotificationPreferences = (value: unknown): NotificationPreferences => {
  let parsed = value
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value)
    } catch {
      parsed = {}
    }
  }

  const source = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
  return (Object.keys(DEFAULT_NOTIFICATION_PREFERENCES) as NotificationPreferenceKey[]).reduce((acc, key) => {
    acc[key] = typeof source[key] === 'boolean' ? source[key] as boolean : DEFAULT_NOTIFICATION_PREFERENCES[key]
    return acc
  }, { ...DEFAULT_NOTIFICATION_PREFERENCES })
}

export const getNotificationPreferenceKey = (notification: { type?: string; message?: string; participant_count?: number | string; notification_type?: string }): NotificationPreferenceKey => {
  const type = notification.notification_type || notification.type || ''
  const message = (notification.message || '').toLowerCase()

  if (type === 'trade_loop') {
    return Number(notification.participant_count || 0) === 2 ? 'trade_matches' : 'multiway_trades'
  }
  if (type === 'trade_offer' || type === 'offer_received') return 'offers_received'
  if (type === 'chat_message' || type === 'trade_message') return 'chat_messages'
  if (type === 'account' || type === 'security') return 'account_security'
  if (type === 'system' || type === 'announcement') return 'system_announcements'
  if (type === 'meetup_update' || message.includes('meetup') || message.includes('meet-up')) return 'meetup_updates'
  if (message.includes('review')) return 'review_reminders'
  if (message.includes('accepted')) return 'offers_accepted'
  if (message.includes('declined') || message.includes('rejected')) return 'offers_rejected'
  if (type === 'trade_update' || type === 'delivery_update') return 'trade_updates'

  return 'system_announcements'
}

export const isNotificationAllowed = (
  preferencesValue: unknown,
  notification: { type?: string; message?: string; participant_count?: number | string; notification_type?: string }
) => {
  const preferences = parseNotificationPreferences(preferencesValue)
  const key = getNotificationPreferenceKey(notification)
  return key === 'account_security' || preferences[key]
}
