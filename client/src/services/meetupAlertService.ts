/// <reference types="node" />
import { api } from './api'
import { useNotification } from '../contexts/NotificationContext'

const logMeetupDebug = (...args: unknown[]) => {
  if (import.meta.env.DEV) console.log(...args)
}

/**
 * MeetupAlertService - Handles automated user alerts for meetup events
 * Sends notifications at strategic times to keep users engaged and informed
 */

export enum AlertType {
  MEETUP_SCHEDULED = 'meetup_scheduled',
  APPROACHING_TIME = 'approaching_time',
  ONE_HOUR_BEFORE = 'one_hour_before',
  THIRTY_MINS_BEFORE = 'thirty_mins_before',
  USER_HEADING_OUT = 'user_heading_out',
  USER_ARRIVED = 'user_arrived',
  AWAITING_OTHER_USER = 'awaiting_other_user',
  BOTH_ARRIVED = 'both_arrived',
  COMPLETION_REQUIRED = 'completion_required',
  NO_SHOW_WARNING = 'no_show_warning',
  TRADE_COMPLETED = 'trade_completed',
}

interface AlertConfig {
  type: AlertType
  title: string
  message: string
  action?: () => void
  actionLabel?: string
  timeout?: number // in seconds before alert auto-closes
  icon?: string
}

interface ScheduledAlert {
  tradeId: number
  scheduleTime: Date
  alertConfig: AlertConfig
  executed: boolean
  timerId?: NodeJS.Timeout
}

class MeetupAlertService {
  private scheduledAlerts: Map<string, ScheduledAlert> = new Map()
  private showNotification: ((msg: string, type?: string) => void) | null = null
  private lastShownAlertsRef: Map<string, number> = new Map()  // Track last time each alert was shown
  private readonly ALERT_DEDUP_WINDOW = 1000  // Min 1 second between same alerts

  /**
   * Initialize the alert service with notification context
   */
  initialize(showNotification: (msg: string, type?: string) => void) {
    this.showNotification = showNotification
  }

  /**
   * Create an alert configuration for a specific event
   */
  private getAlertConfig(type: AlertType, tradeId: number): AlertConfig {
    const configs: Record<AlertType, AlertConfig> = {
      [AlertType.MEETUP_SCHEDULED]: {
        type,
        title: '✅ Meetup Scheduled!',
        message: 'Your meetup has been confirmed. Check your chat for details.',
        actionLabel: 'View Details',
        timeout: 5,
      },
      [AlertType.APPROACHING_TIME]: {
        type,
        title: '⏰ Time is Approaching!',
        message: 'Your scheduled meetup is coming up soon. Get ready!',
        actionLabel: 'View Meetup',
        timeout: 8,
      },
      [AlertType.ONE_HOUR_BEFORE]: {
        type,
        title: '🕐 One Hour Until Meetup',
        message: 'Your meetup is in 1 hour. Plan your travel time now.',
        actionLabel: 'Get Directions',
        timeout: 10,
      },
      [AlertType.THIRTY_MINS_BEFORE]: {
        type,
        title: '⏱️ 30 Minutes Until Meetup',
        message: 'Leave soon to arrive on time!',
        actionLabel: 'I\'m Heading Out',
        timeout: 5,
      },
      [AlertType.USER_HEADING_OUT]: {
        type,
        title: '🚗 You\'re Heading Out',
        message: 'Your status has been updated. Other user will be notified.',
        actionLabel: 'Cancel',
        timeout: 3,
      },
      [AlertType.USER_ARRIVED]: {
        type,
        title: '📍 You\'ve Arrived!',
        message: 'Your arrival has been confirmed. Waiting for the other user...',
        actionLabel: 'View Chat',
        timeout: 5,
      },
      [AlertType.AWAITING_OTHER_USER]: {
        type,
        title: '⏳ Waiting for Other User',
        message: 'You\'ve arrived. Waiting for your trading partner.',
        actionLabel: 'Contact Them',
        timeout: 7,
      },
      [AlertType.BOTH_ARRIVED]: {
        type,
        title: '✨ Both Arrived!',
        message: 'You and your trading partner have arrived. Start the exchange!',
        actionLabel: 'View Chat',
        timeout: 5,
      },
      [AlertType.COMPLETION_REQUIRED]: {
        type,
        title: '💯 Confirm Exchange',
        message: 'Confirm that the trade has been completed successfully.',
        actionLabel: 'Confirm Completion',
        timeout: 10,
      },
      [AlertType.NO_SHOW_WARNING]: {
        type,
        title: '⚠️ No-Show Report',
        message: 'If the other user did not appear, you can report them now.',
        actionLabel: 'Report No-Show',
        timeout: 15,
      },
      [AlertType.TRADE_COMPLETED]: {
        type,
        title: '🎉 Trade Completed!',
        message: 'Congratulations! Your trade has been successfully completed.',
        actionLabel: 'Leave Feedback',
        timeout: 7,
      },
    }

    return configs[type]
  }

  /**
   * Schedule an alert to be shown at a specific time
   */
  scheduleAlert(tradeId: number, alertType: AlertType, scheduleTime: Date): void {
    const key = `${tradeId}-${alertType}`

    if (this.scheduledAlerts.has(key)) {
      const existing = this.scheduledAlerts.get(key)
      if (existing?.timerId) {
        clearTimeout(existing.timerId)
      }
    }

    const alertConfig = this.getAlertConfig(alertType, tradeId)
    const now = new Date()
    const delayMs = Math.max(0, scheduleTime.getTime() - now.getTime())

    const timerId = setTimeout(() => {
      this.showAlert(alertConfig)
      const alert = this.scheduledAlerts.get(key)
      if (alert) {
        alert.executed = true
      }
    }, delayMs)

    this.scheduledAlerts.set(key, {
      tradeId,
      scheduleTime,
      alertConfig,
      executed: false,
      timerId,
    })

    logMeetupDebug(
      `📅 [Alert Scheduled] ${alertType} for trade ${tradeId} at ${scheduleTime.toLocaleTimeString()}`
    )
  }

  /**
   * Cancel a scheduled alert
   */
  cancelAlert(tradeId: number, alertType: AlertType): void {
    const key = `${tradeId}-${alertType}`
    const alert = this.scheduledAlerts.get(key)

    if (alert?.timerId) {
      clearTimeout(alert.timerId)
      logMeetupDebug(`❌ [Alert Cancelled] ${alertType} for trade ${tradeId}`)
    }

    this.scheduledAlerts.delete(key)
  }

  /**
   * Cancel all scheduled alerts for a trade
   */
  cancelAllAlertsForTrade(tradeId: number): void {
    const keysToDelete: string[] = []

    this.scheduledAlerts.forEach((alert, key) => {
      if (alert.tradeId === tradeId && alert.timerId) {
        clearTimeout(alert.timerId)
        keysToDelete.push(key)
      }
    })

    keysToDelete.forEach(key => this.scheduledAlerts.delete(key))
    logMeetupDebug(`❌ [All Alerts Cancelled] for trade ${tradeId}`)
  }

  /**
   * Show an alert immediately
   */
  showAlert(alertConfig: AlertConfig): void {
    if (!this.showNotification) {
      console.warn('Notification service not initialized')
      return
    }

    // Check if we've shown this exact alert recently
    const alertKey = `${alertConfig.type}`
    const lastShownTime = this.lastShownAlertsRef.get(alertKey)
    const now = Date.now()
    
    if (lastShownTime && (now - lastShownTime) < this.ALERT_DEDUP_WINDOW) {
      // Skip duplicate alert
      return
    }
    
    // Record that we're showing this alert
    this.lastShownAlertsRef.set(alertKey, now)

    const message = `${alertConfig.title} - ${alertConfig.message}`
    this.showNotification(message, 'info')

    // Also send as browser notification if available
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification(alertConfig.title, {
        body: alertConfig.message,
        icon: alertConfig.icon || '🔔',
        tag: `meetup-alert-${alertConfig.type}`,
        requireInteraction: false,
      })
    }
  }

  /**
   * Setup standard alert schedule for a meetup
   * Called when meetup is confirmed with a scheduled time
   */
  setupMeetupAlertSchedule(tradeId: number, meetupTime: Date): void {
    const now = new Date()

    // 1-5 minutes before
    const fiveMinsBefore = new Date(meetupTime.getTime() - 5 * 60000)
    if (fiveMinsBefore > now) {
      this.scheduleAlert(tradeId, AlertType.THIRTY_MINS_BEFORE, fiveMinsBefore)
    }

    // 30 minutes before
    const thirtyMinsBefore = new Date(meetupTime.getTime() - 30 * 60000)
    if (thirtyMinsBefore > now) {
      this.scheduleAlert(tradeId, AlertType.THIRTY_MINS_BEFORE, thirtyMinsBefore)
    }

    // 1 hour before
    const oneHourBefore = new Date(meetupTime.getTime() - 60 * 60000)
    if (oneHourBefore > now) {
      this.scheduleAlert(tradeId, AlertType.ONE_HOUR_BEFORE, oneHourBefore)
    }

    logMeetupDebug(`📅 [Meetup Alerts Setup] for trade ${tradeId} at ${meetupTime.toLocaleTimeString()}`)
  }

  /**
   * Get all scheduled alerts
   */
  getScheduledAlerts(): ScheduledAlert[] {
    return Array.from(this.scheduledAlerts.values())
  }

  /**
   * Get scheduled alerts for a specific trade
   */
  getTradeAlerts(tradeId: number): ScheduledAlert[] {
    return Array.from(this.scheduledAlerts.values()).filter(alert => alert.tradeId === tradeId)
  }

  /**
   * Request browser notification permission
   */
  static async requestNotificationPermission(): Promise<boolean> {
    if (!('Notification' in window)) {
      logMeetupDebug('Browser does not support notifications')
      return false
    }

    if (Notification.permission === 'granted') {
      return true
    }

    if (Notification.permission === 'denied') {
      logMeetupDebug('Notification permission was denied')
      return false
    }

    const permission = await Notification.requestPermission()
    return permission === 'granted'
  }

  /**
   * Send a test alert to verify system is working
   */
  async sendTestAlert(title: string = '🧪 Test Alert'): Promise<void> {
    const testConfig: AlertConfig = {
      type: AlertType.MEETUP_SCHEDULED,
      title,
      message: 'This is a test notification to verify the alert system is working.',
      timeout: 5,
    }

    this.showAlert(testConfig)
    logMeetupDebug('✅ Test alert sent')
  }

  /**
   * Clear all scheduled alerts
   */
  clearAllAlerts(): void {
    this.scheduledAlerts.forEach((alert) => {
      if (alert.timerId) {
        clearTimeout(alert.timerId)
      }
    })
    this.scheduledAlerts.clear()
    logMeetupDebug('🗑️ All alerts cleared')
  }

  /**
   * Get alert statistics
   */
  getAlertStats(): {
    total: number
    executed: number
    pending: number
    byTrade: Record<number, number>
  } {
    const alerts = Array.from(this.scheduledAlerts.values())
    const executed = alerts.filter(a => a.executed).length
    const pending = alerts.filter(a => !a.executed).length

    const byTrade: Record<number, number> = {}
    alerts.forEach(alert => {
      byTrade[alert.tradeId] = (byTrade[alert.tradeId] || 0) + 1
    })

    return {
      total: alerts.length,
      executed,
      pending,
      byTrade,
    }
  }
}

// Singleton instance
const meetupAlertService = new MeetupAlertService()

export default meetupAlertService

