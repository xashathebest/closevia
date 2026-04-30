export const formatDuration = (minutes: number, options?: { long?: boolean }) => {
  const safeMinutes = Math.max(0, Math.round(Number.isFinite(minutes) ? minutes : 0))
  const long = Boolean(options?.long)

  if (safeMinutes >= 1440) {
    let days = Math.floor(safeMinutes / 1440)
    let hours = Math.round((safeMinutes % 1440) / 60)
    if (hours === 24) {
      days += 1
      hours = 0
    }

    const dayLabel = long ? `${days} day${days === 1 ? '' : 's'}` : `${days}d`
    if (hours === 0) return dayLabel
    const hourLabel = long ? `${hours} hour${hours === 1 ? '' : 's'}` : `${hours}h`
    return `${dayLabel} ${hourLabel}`
  }

  if (safeMinutes >= 60) {
    const hours = Math.floor(safeMinutes / 60)
    const mins = safeMinutes % 60
    const hourLabel = long ? `${hours} hour${hours === 1 ? '' : 's'}` : `${hours}h`
    if (mins === 0) return hourLabel
    const minuteLabel = long ? `${mins} minute${mins === 1 ? '' : 's'}` : `${mins}m`
    return `${hourLabel} ${minuteLabel}`
  }

  return long
    ? `${safeMinutes} minute${safeMinutes === 1 ? '' : 's'}`
    : `${safeMinutes}m`
}

export const formatDurationRange = (minMinutes: number, maxMinutes: number, options?: { long?: boolean }) => {
  const min = Math.max(0, Math.round(minMinutes))
  const max = Math.max(min, Math.round(maxMinutes))
  const long = Boolean(options?.long)

  if (min < 60 && max < 60) {
    return long
      ? `${min}-${max} minutes`
      : `${min}-${max} mins`
  }

  return `${formatDuration(min, options)}-${formatDuration(max, options)}`
}
