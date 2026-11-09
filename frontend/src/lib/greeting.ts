// The welcome line on an empty chat. Time-aware, with the name from the
// first-run screen; "Operator" when none was given.

export function greeting(name: string | null | undefined, incognito: boolean, now = new Date()): string {
  const who = name?.trim() || 'Operator'
  if (incognito) return `Off the record, ${who}`
  const h = now.getHours()
  if (h >= 5 && h < 12) return `Good morning, ${who}`
  if (h >= 12 && h < 17) return `Good afternoon, ${who}`
  if (h >= 17 && h < 22) return `Good evening, ${who}`
  return `Working late, ${who}`
}
