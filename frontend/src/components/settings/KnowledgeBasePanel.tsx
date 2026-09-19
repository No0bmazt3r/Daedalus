import { useEffect, useState } from 'react'
import { Network, Boxes, Check, AlertCircle, Lock } from 'lucide-react'
import {
  fetchRagConfig, setRagTrack, type RagConfig, type RagTrack, type TrackStatus,
} from '../../lib/blueprintsClient'
import { Skeleton } from '../ui/skeleton'

/**
 * Settings → Knowledge Base — which retrieval track answers a knowledge query.
 *
 * `PROJECT.md` §5's dual-track comparison is the project's headline research
 * contribution, and a comparison needs a switch you can actually throw. This is
 * it.
 *
 * ## What the switch changes, and what it must not
 *
 * Both tracks share Zones 1/2/4 and every deterministic sensor tool, and
 * diverge **only** on Path B — troubleshooting, SOP and domain-knowledge
 * queries. A live-reading question answers identically either way, because a
 * number still comes from a tool (Rule 3) and never from retrieval.
 *
 * Everything the comparison protocol holds constant — model, quantization,
 * temperature, corpus, query set, machine — is deliberately not settable here.
 * A switch that also changed the model would make the arms differ in two ways
 * and measure neither.
 *
 * ## Readiness is reported, never enforced
 *
 * A track can be selected before it can answer. That is on purpose: while Track
 * 1 waits on M2 you still want to demonstrate Track 2, and a switch that
 * refused the only built track would be unusable in exactly the window it is
 * most useful. So the panel states what each track can do and lets the choice
 * stand.
 *
 * ## The freeze
 *
 * §5: build both, **freeze both**, run the evaluation once without further
 * tuning. Tweaking a track after seeing its results invalidates the comparison,
 * and the failure mode is not malice — it is a plausible small change made
 * three days before a deadline. When `frozen` is set the API refuses writes and
 * this panel goes read-only; unfreezing is a hand edit of
 * `config/rag_config.json`, which is a commit somebody can see.
 */

const ICONS: Record<RagTrack, typeof Network> = { vector: Boxes, graph: Network }

const BLURB: Record<RagTrack, string> = {
  vector:
    'Chunks the corpus, embeds it, and retrieves the top-k most similar chunks. ' +
    'Retrieval is arithmetic, so it returns something regardless of how capable the model is — ' +
    'but the index is pinned to one embedding model, and changing that means re-ingesting everything.',
  graph:
    'Walks a hand-authored knowledge graph over multiple hops, checking between steps whether it has ' +
    'enough. No embedding model at all — entry points come from authored aliases. In exchange the ' +
    'model drives retrieval, so a model too small to tool-call reliably finds no path at all.',
}

function TrackCard({
  track, selected, disabled, onSelect,
}: {
  track: TrackStatus
  selected: boolean
  disabled: boolean
  onSelect: () => void
}) {
  const Icon = ICONS[track.id]
  return (
    <button
      onClick={onSelect}
      disabled={disabled}
      className={`w-full rounded-lg border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
        selected ? 'theme-accent-border theme-surface-strong' : 'theme-border hover:theme-surface'
      }`}
    >
      <div className="flex items-center gap-2">
        <Icon size={15} className={selected ? 'theme-accent' : 'theme-text-muted'} />
        <span className="text-sm theme-text">{track.label}</span>
        <span className="rounded border theme-border px-1.5 py-0.5 text-[10px] theme-text-muted">
          {track.role}
        </span>
        {selected && <Check size={14} className="ml-auto theme-accent" />}
      </div>

      <p className="mt-2 text-[11px] leading-relaxed theme-text-muted">{BLURB[track.id]}</p>

      <div className="mt-2 flex items-center gap-1.5">
        <span
          className={`h-1.5 w-1.5 rounded-full ${track.ready ? 'bg-emerald-400' : 'bg-amber-400'}`}
        />
        <span className="text-[10px] theme-text-muted">
          {track.ready ? 'ready' : `not ready${track.blocked_by ? ` — needs ${track.blocked_by}` : ''}`}
          {' · '}{track.detail}
        </span>
      </div>
    </button>
  )
}

export function KnowledgeBasePanel() {
  const [config, setConfig] = useState<RagConfig | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetchRagConfig().then(setConfig).catch((e: Error) => setError(e.message))
  }, [])

  const choose = async (track: RagTrack) => {
    if (!config || config.track === track || config.frozen) return
    setSaving(true)
    setError(null)
    try {
      setConfig(await setRagTrack(track))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (error && !config) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-rose-400/40 bg-rose-400/10 p-3 text-xs theme-text">
        <AlertCircle size={14} className="shrink-0 text-rose-400" /> {error}
      </div>
    )
  }
  if (!config) return <Skeleton className="h-52 w-full" />

  return (
    <div className="space-y-4">
      <header>
        <h3 className="text-sm theme-text">Retrieval track</h3>
        <p className="mt-1 text-xs leading-relaxed theme-text-muted">
          Which strategy answers a troubleshooting or SOP question. Sensor readings are unaffected —
          a number always comes from a tool, never from retrieval.
        </p>
      </header>

      {config.frozen && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-400/40 bg-amber-400/10 p-3">
          <Lock size={13} className="mt-0.5 shrink-0 text-amber-400" />
          <p className="text-[11px] leading-relaxed theme-text">
            The comparison is frozen. Changing a track after seeing its results invalidates the
            evaluation, so this is read-only — edit <code>config/rag_config.json</code> by hand to
            change it.
          </p>
        </div>
      )}

      <div className="space-y-2">
        {config.tracks.map((t) => (
          <TrackCard
            key={t.id}
            track={t}
            selected={config.track === t.id}
            disabled={saving || config.frozen}
            onSelect={() => choose(t.id)}
          />
        ))}
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-rose-400/40 bg-rose-400/10 p-2.5 text-[11px] theme-text">
          <AlertCircle size={13} className="shrink-0 text-rose-400" /> {error}
        </div>
      )}

      <p className="text-[11px] leading-relaxed theme-text-muted">
        Committed to <code className="theme-text">config/rag_config.json</code>, read on every
        knowledge query and recorded per query in <code className="theme-text">rag_logs.track</code>,
        so a result can always be traced to the track that produced it. Each query's walk is visible
        in Labyrinth Blueprints → Replay.
      </p>
    </div>
  )
}
