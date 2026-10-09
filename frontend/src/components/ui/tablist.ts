import type { KeyboardEvent } from 'react'

/**
 * Left/right arrows move between tabs, per the WAI-ARIA tabs pattern. Each tab
 * button carries `data-tab={id}` so focus can follow the selection.
 */
export function tabArrowKeys<T extends string>(ids: readonly T[], current: T, select: (id: T) => void) {
  return (e: KeyboardEvent<HTMLElement>) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
    if (!step) return
    const next = ids[(Math.max(ids.indexOf(current), 0) + step + ids.length) % ids.length]
    select(next)
    e.currentTarget.querySelector<HTMLElement>(`[data-tab="${next}"]`)?.focus()
  }
}
