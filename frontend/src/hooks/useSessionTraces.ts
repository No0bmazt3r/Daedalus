import { useEffect, useState } from 'react'
import { fetchTraces, type TraceSummary } from '../lib/threadClient'
import { useLiveRefresh } from './useLiveRefresh'

/**
 * The trace summary of every answer in one chat, keyed by `query_id` — what the
 * strip under each reply reads. One request per chat rather than one per
 * message, re-read whenever `version` changes (the caller passes the count of
 * stored answers, so a new turn brings its own strip with it) or when the
 * backend says the Thread changed — new Settings refile every strip.
 *
 * A failure leaves the map empty: the strip is an affordance, and a chat must
 * read normally when the audit store is unavailable.
 */
export function useSessionTraces(sessionId: string | null, version: number): Record<string, TraceSummary> {
  const [state, setState] = useState<{ key: string; map: Record<string, TraceSummary> } | null>(null)
  const [tick, setTick] = useState(0)
  useLiveRefresh(['trace'], () => setTick((n) => n + 1))
  const key = `${sessionId}:${version}:${tick}`

  useEffect(() => {
    if (!sessionId) return
    let live = true
    void fetchTraces({ session_id: sessionId, limit: 500 })
      .then((page) => {
        if (live) setState({ key, map: Object.fromEntries(page.items.map((t) => [t.query_id, t])) })
      })
      .catch(() => undefined)
    return () => { live = false }
  }, [sessionId, key])

  // A stale map from the previous chat would show strips on the wrong turns;
  // the previous version of this chat's map is fine to keep while re-reading.
  return state && state.key.startsWith(`${sessionId}:`) ? state.map : {}
}
