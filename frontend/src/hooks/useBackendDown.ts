import { useEffect, useState } from 'react'

const UP_EVERY_MS = 10_000
const DOWN_EVERY_MS = 3_000
const TIMEOUT_MS = 4_000
// Two misses in a row before calling it down: a dev reload takes a second or
// two, and the full-page 503 should not flash for that.
const MISSES_TO_DOWN = 2

/** Why the backend is down, or null while it answers `/api/health`. */
export function useBackendDown(): string | null {
  const [down, setDown] = useState<string | null>(null)

  useEffect(() => {
    let misses = 0
    let timer = 0
    let stopped = false

    const check = async () => {
      let reason: string | null = null
      try {
        const res = await fetch('/api/health', { signal: AbortSignal.timeout(TIMEOUT_MS) })
        // A 5xx here is usually the dev server's proxy failing to reach a
        // stopped backend, or the backend itself failing.
        if (res.status >= 500) reason = `the backend is not responding (HTTP ${res.status})`
      } catch (e) {
        reason = e instanceof Error && e.name === 'TimeoutError'
          ? 'the backend did not answer in time'
          : 'could not reach the backend'
      }
      if (stopped) return
      misses = reason ? misses + 1 : 0
      const isDown = misses >= MISSES_TO_DOWN
      setDown(isDown ? reason : null)
      timer = window.setTimeout(check, reason ? DOWN_EVERY_MS : UP_EVERY_MS)
    }

    void check()
    return () => {
      stopped = true
      window.clearTimeout(timer)
    }
  }, [])

  return down
}
