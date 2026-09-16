import { useCallback, useEffect, useState } from 'react'
import { Check, Loader2, Pin, Sparkles, AlertTriangle, FileJson } from 'lucide-react'
import { activeModel, setActiveModel, type ActiveModel } from '../../lib/forgeClient'

/**
 * Step 6 — the committed choice, written to `config/model_config.json`.
 *
 * `PROJECT.md` §8.1: *"Selected via config/model_config.json — never
 * hardcoded."* This panel is the only thing that writes it.
 *
 * ## Why there are two modes and not one
 *
 * A pinned name is a statement about one machine's hardware. Written on a
 * workstation with 32GB and read on an 8GB laptop, it is still there, still
 * confidently naming a model that will not load — and nothing about the config
 * says it has gone stale.
 *
 * `auto` stores the *policy* instead: run whichever installed model scores
 * highest on whatever machine this is, resolved fresh on every read against
 * live hardware. Move the project, pull something better, and the deployment
 * follows. It is the default for that reason.
 *
 * Auto only ever picks from models actually installed — an estimate says a
 * model would fit, it does not put the weights on the disk.
 */

export function DeploymentPanel({ reloadKey = 0 }: { reloadKey?: number }) {
  const [active, setActive] = useState<ActiveModel | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setActive(await activeModel())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'request failed')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load, reloadKey])

  // Read out as a primitive so the memoization dependency is the tag itself
  // rather than the whole response object — otherwise the callback is rebuilt
  // on every poll, and React Compiler declines to optimize the component.
  const activeTag = active?.tag ?? null

  const choose = useCallback(
    async (mode: 'auto' | 'pinned') => {
      setBusy(true)
      try {
        // Switching to pinned without a target pins whatever auto had resolved
        // to — the button means "keep what I have now", and asking the user to
        // re-pick a model the panel is already showing them would be silly.
        setActive(
          await setActiveModel({
            mode,
            tag: mode === 'pinned' ? activeTag : null,
          }),
        )
        setError(null)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'could not write the config')
      } finally {
        setBusy(false)
      }
    },
    [activeTag],
  )

  if (error && !active) {
    return (
      <div className="flex items-start gap-3 p-4 rounded-xl border border-red-500/30 bg-red-500/10 text-sm">
        <AlertTriangle size={16} className="text-red-400 shrink-0 mt-0.5" />
        <div>
          <div className="font-medium">Couldn't read the deployment config</div>
          <div className="theme-text-muted text-xs mt-1">{error}</div>
        </div>
      </div>
    )
  }

  if (!active) return <div className="text-sm theme-text-muted">Resolving…</div>

  const modes = [
    {
      id: 'auto' as const,
      icon: Sparkles,
      title: 'Automatic',
      body: 'Run whichever installed model scores highest on this machine. Re-resolved on every read, so it follows the hardware.',
    },
    {
      id: 'pinned' as const,
      icon: Pin,
      title: 'Pinned',
      body: 'Run exactly one named model. The choice stands even if a better-fitting one is installed later.',
    },
  ]

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      <p className="text-sm theme-text-muted">
        What the orchestrator runs. Written to{' '}
        <code className="theme-text">config/model_config.json</code> and read by FastAPI —
        never hardcoded.
      </p>

      {/* ── what is resolved right now ── */}
      <div className="p-4 rounded-xl border theme-border bg-black/10">
        <div className="flex items-center gap-2 mb-2">
          {active.resolved ? (
            <Check size={15} className="text-emerald-400 shrink-0" />
          ) : (
            <AlertTriangle size={15} className="text-amber-400 shrink-0" />
          )}
          <span className="text-sm font-medium">
            {active.tag ?? 'Nothing to run'}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded border theme-border theme-text-muted uppercase tracking-wide ml-auto shrink-0">
            {active.mode}
          </span>
        </div>
        <p className="text-xs theme-text-muted">{active.reason}</p>
        {active.row?.measured?.tokens_per_sec ? (
          <p className="text-xs theme-text-muted opacity-75 mt-1.5">
            Measured at {active.row.measured.time_to_first_token_ms}ms to first token,{' '}
            {active.row.measured.tokens_per_sec} tok/s.
          </p>
        ) : active.row ? (
          <p className="text-xs theme-text-muted opacity-75 mt-1.5">
            Not benchmarked — the figures behind this choice are still estimates.
          </p>
        ) : null}
      </div>

      {/* ── mode ── */}
      <div className="grid grid-cols-1 @xl:grid-cols-2 gap-3">
        {modes.map((mode) => {
          const selected = active.mode === mode.id
          return (
            <button
              key={mode.id}
              onClick={() => void choose(mode.id)}
              disabled={busy || (mode.id === 'pinned' && !active.tag)}
              title={
                mode.id === 'pinned' && !active.tag
                  ? 'Nothing is resolved to pin. Install a model first.'
                  : undefined
              }
              className={`text-left p-4 rounded-xl border transition-colors disabled:opacity-40 ${
                selected
                  ? 'theme-border-primary bg-black/20'
                  : 'theme-border bg-black/5 hover:bg-black/15'
              }`}
            >
              <div className="flex items-center gap-2 mb-1.5">
                <mode.icon size={14} className={selected ? 'theme-primary' : 'theme-text-muted'} />
                <span className="text-sm font-medium">{mode.title}</span>
                {busy && <Loader2 size={12} className="animate-spin ml-auto" />}
                {selected && !busy && <Check size={13} className="theme-primary ml-auto" />}
              </div>
              <p className="text-xs theme-text-muted opacity-75">{mode.body}</p>
            </button>
          )
        })}
      </div>

      {error && <p className="text-xs text-amber-400/90">{error}</p>}

      <div className="flex items-start gap-2 text-[11px] theme-text-muted opacity-70">
        <FileJson size={12} className="shrink-0 mt-0.5" />
        <span>
          {active.config.updated_at
            ? `Last written ${active.config.updated_at} by ${active.config.updated_by ?? 'unknown'}.`
            : 'Never written — running on the default policy.'}
          {' '}Considered {active.candidates_considered} installed model
          {active.candidates_considered === 1 ? '' : 's'}.
        </span>
      </div>
    </div>
  )
}
