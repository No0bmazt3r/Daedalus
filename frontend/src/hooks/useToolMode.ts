import { useEffect, useState } from 'react'
import { fetchToolMode, TOOL_MODE_CHANGED_EVENT, type ToolMode } from '../lib/toolsClient'

/**
 * Settings → Agent Tools' Simple/Advanced switch. Null until read, and on a
 * failed read — callers treat null as Simple, the backend's own fail-closed default.
 */
export function useToolMode(): ToolMode | null {
  const [mode, setMode] = useState<ToolMode | null>(null)
  useEffect(() => {
    let cancelled = false
    fetchToolMode().then((m) => { if (!cancelled) setMode(m) }).catch(() => undefined)
    const onChanged = (e: Event) => setMode((e as CustomEvent<ToolMode>).detail)
    window.addEventListener(TOOL_MODE_CHANGED_EVENT, onChanged)
    return () => {
      cancelled = true
      window.removeEventListener(TOOL_MODE_CHANGED_EVENT, onChanged)
    }
  }, [])
  return mode
}
