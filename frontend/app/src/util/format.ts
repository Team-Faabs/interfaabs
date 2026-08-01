export function formatNs(ns: number | null | undefined): string {
  if (ns === null || ns === undefined) return '—'
  const totalSeconds = ns / 1e9
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds - minutes * 60
  return `${String(minutes).padStart(2, '0')}:${seconds.toFixed(3).padStart(6, '0')}`
}

export function formatClock(epochMs: number): string {
  return new Date(epochMs).toLocaleTimeString(undefined, { hour12: false })
}

export function formatClockMs(epochMs: number): string {
  const date = new Date(epochMs)
  return `${date.toLocaleTimeString(undefined, { hour12: false })}.${String(
    date.getMilliseconds(),
  ).padStart(3, '0')}`
}

export function formatCount(value: number): string {
  return value.toLocaleString()
}

export function formatMm(value: number): string {
  return value.toFixed(0)
}

export function formatDegrees(radians: number): string {
  return `${((radians * 180) / Math.PI).toFixed(1)}°`
}

export function formatSpeed(xMmPerS: number, yMmPerS: number): string {
  return `${(Math.hypot(xMmPerS, yMmPerS) / 1000).toFixed(2)} m/s`
}

export function shortState(value: string): string {
  return value.replace(/^(STATE|TASK)_/, '')
}

export function relativeTime(epochMs: number, now = Date.now()): string {
  const seconds = Math.max(0, (now - epochMs) / 1000)
  if (seconds < 1) return 'just now'
  if (seconds < 60) return `${seconds.toFixed(1)} s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  return `${Math.floor(minutes / 60)} h ago`
}

export function teamTag(team: 'blue' | 'yellow', id: number): string {
  return `${team === 'blue' ? 'B' : 'Y'}${id}`
}
