// Relative times for the UI: `2 hours ago`, `yesterday`, `just now`.

const RELATIVE = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60],
]

/** `2 hours ago`, `yesterday`, `just now`. Computed on render, so it moves when the chat does. */
export function timeAgo(iso: string): string {
  const secs = (new Date(iso).getTime() - Date.now()) / 1000
  for (const [unit, size] of UNITS) {
    if (Math.abs(secs) >= size) return RELATIVE.format(Math.round(secs / size), unit)
  }
  return 'just now'
}
