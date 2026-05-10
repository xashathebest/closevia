// Availability window utilities for CloviaPH.
// All times are treated as Asia/Manila wall-clock time (UTC+8, no DST).

const MANILA_TZ = 'Asia/Manila'

// Overnight windows longer than this are flagged as likely mistakes.
const UNUSUALLY_LONG_HOURS = 18

// ---------------------------------------------------------------------------
// Manila "now" helpers
// ---------------------------------------------------------------------------

/**
 * Current Manila wall-clock time as zero-padded date+time strings.
 * Avoids any browser-timezone dependency.
 */
export const nowManilaComponents = (): { dateStr: string; timeStr: string } => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: MANILA_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date())

  const y   = parts.find(p => p.type === 'year')!.value
  const mo  = parts.find(p => p.type === 'month')!.value
  const d   = parts.find(p => p.type === 'day')!.value
  let   h   = parts.find(p => p.type === 'hour')!.value
  const min = parts.find(p => p.type === 'minute')!.value
  if (h === '24') h = '00'  // Intl edge: midnight can be "24"
  return { dateStr: `${y}-${mo}-${d}`, timeStr: `${h}:${min}` }
}

/** Today's date in Manila timezone as "YYYY-MM-DD". */
export const todayManilaStr = (): string => nowManilaComponents().dateStr

// ---------------------------------------------------------------------------
// Overnight detection & arithmetic
// ---------------------------------------------------------------------------

/** True when the window crosses midnight (end time string < start time string). */
export const isOvernightSlot = (start: string, end: string): boolean =>
  !!(start && end && end < start)

/** Duration in minutes of a time window; handles overnight by wrapping 24 h. */
export const windowDurationMinutes = (start: string, end: string): number => {
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  const startMins = sh * 60 + sm
  let endMins = eh * 60 + em
  if (endMins <= startMins) endMins += 24 * 60
  return endMins - startMins
}

/** Add exactly one calendar day to a "YYYY-MM-DD" string (UTC-safe). */
export const addOneDay = (dateStr: string): string => {
  const [y, mo, d] = dateStr.split('-').map(Number)
  const next = new Date(Date.UTC(y, mo - 1, d + 1))
  return [
    next.getUTCFullYear(),
    String(next.getUTCMonth() + 1).padStart(2, '0'),
    String(next.getUTCDate()).padStart(2, '0'),
  ].join('-')
}

// ---------------------------------------------------------------------------
// Slot open/closed check (Manila-timezone-aware)
// ---------------------------------------------------------------------------

/**
 * Is the slot window still open right now (Manila time)?
 * Works for both normal and overnight windows.
 */
export const isSlotOpen = (slot: {
  date: string
  start_time: string
  end_time: string
}): boolean => {
  const { dateStr: nowDate, timeStr: nowTime } = nowManilaComponents()
  const endDate = isOvernightSlot(slot.start_time, slot.end_time)
    ? addOneDay(slot.date)
    : slot.date
  // ISO-format string comparison is safe for zero-padded dates/times.
  return `${endDate}T${slot.end_time}` > `${nowDate}T${nowTime}`
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface TimeWindowValidation {
  valid: boolean
  overnight: boolean
  durationMinutes: number
  /** Present when the window is technically overnight but suspiciously long. */
  warning?: string
}

/**
 * Validate a start/end time pair.
 * - Normal window (end > start): valid, overnight = false.
 * - Overnight window (end < start): valid, overnight = true.
 * - Unusually long overnight (> 18 h): valid = false, warning present.
 * - Same time or empty: valid = false.
 */
export const validateTimeWindow = (
  start: string,
  end: string
): TimeWindowValidation => {
  if (!start || !end || start === end) {
    return { valid: false, overnight: false, durationMinutes: 0 }
  }
  const overnight = isOvernightSlot(start, end)
  const durationMinutes = windowDurationMinutes(start, end)
  const hours = durationMinutes / 60

  if (overnight && hours > UNUSUALLY_LONG_HOURS) {
    // e.g. 9:30 PM → 6:00 PM next day (~20.5 h) — likely a typo.
    const [eh, em] = end.split(':').map(Number)
    const amHour = eh % 12 || 12
    const amTime = em === 0
      ? `${amHour}:00 AM`
      : `${amHour}:${String(em).padStart(2, '0')} AM`
    return {
      valid: false,
      overnight: true,
      durationMinutes,
      warning:
        `This availability window is very long (${Math.round(hours)}h). ` +
        `Did you mean ${amTime}?`,
    }
  }

  return { valid: true, overnight, durationMinutes }
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/** Format "HH:MM" → "9:30 PM" (no timezone conversion needed — already Manila). */
export const fmtManilaTime = (hhmm: string): string => {
  const [h, m] = hhmm.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 || 12
  return m === 0
    ? `${hour}:00 ${ampm}`
    : `${hour}:${String(m).padStart(2, '0')} ${ampm}`
}

/**
 * Format a "YYYY-MM-DD" string as a short locale date in Manila timezone.
 * Constructs via UTC midnight to avoid any browser-local-timezone drift.
 */
export const fmtManilaDate = (
  dateStr: string,
  opts: Intl.DateTimeFormatOptions = {}
): string => {
  const [y, mo, d] = dateStr.split('-').map(Number)
  const utcDate = new Date(Date.UTC(y, mo - 1, d))
  return utcDate.toLocaleDateString('en-PH', {
    timeZone: MANILA_TZ,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...opts,
  })
}

export interface SlotDisplay {
  /** Date label, e.g. "Sat, May 9" or "Sat, Sun" for recurring */
  dateLabel: string
  /** Time range string, e.g. "9:30 PM–6:00 AM" or "9:30 PM → Sun, May 10, 6:00 AM" */
  timeRange: string
  /** Whether this window crosses midnight */
  overnight: boolean
  /** Compact one-liner combining date + time range */
  label: string
  /** Badge text when overnight, e.g. "Ends next day" */
  overnightLabel?: string
}

const DAY_LABELS: Record<string, string> = {
  monday: 'Mon', tuesday: 'Tue', wednesday: 'Wed', thursday: 'Thu',
  friday: 'Fri', saturday: 'Sat', sunday: 'Sun',
}

/**
 * Build a rich display object for a slot's time range.
 * Overnight windows show the next-day date for the end time.
 */
export const formatSlotDisplay = (slot: {
  date: string
  start_time: string
  end_time: string
  mode?: string
  weekdays?: string[]
}): SlotDisplay => {
  const overnight = isOvernightSlot(slot.start_time, slot.end_time)
  const startFmt = fmtManilaTime(slot.start_time)
  const endFmt = fmtManilaTime(slot.end_time)

  const dateLabel =
    slot.mode === 'recurring' && Array.isArray(slot.weekdays) && slot.weekdays.length > 0
      ? slot.weekdays.map(day => DAY_LABELS[day] || day).join(', ')
      : fmtManilaDate(slot.date)

  if (overnight) {
    const nextDate = addOneDay(slot.date)
    const nextDateLabel = fmtManilaDate(nextDate)
    const timeRange = `${startFmt} → ${nextDateLabel}, ${endFmt}`
    return {
      dateLabel,
      timeRange,
      overnight: true,
      label: `${dateLabel}, ${timeRange}`,
      overnightLabel: 'Ends next day',
    }
  }

  const timeRange = `${startFmt}–${endFmt}`
  return { dateLabel, timeRange, overnight: false, label: `${dateLabel}, ${timeRange}` }
}
