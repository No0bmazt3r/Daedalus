import { useEffect, useRef } from 'react'
import { subscribe, type LiveTopic } from '../lib/liveEvents'

/**
 * Re-run `refresh` whenever the backend says one of `topics` changed.
 *
 * The callback is read through a ref, so a caller can pass an inline function
 * without resubscribing on every render; only a change of topics does that.
 */
export function useLiveRefresh(topics: LiveTopic[], refresh: () => void) {
  const ref = useRef(refresh)
  useEffect(() => {
    ref.current = refresh
  })
  const key = topics.join(',')
  useEffect(
    () => subscribe(key.split(',') as LiveTopic[], () => ref.current()),
    [key],
  )
}
