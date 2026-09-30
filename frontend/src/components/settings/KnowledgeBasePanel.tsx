import { useEffect, useRef, useState } from 'react'
import {
  Network, Boxes, Check, AlertCircle, Lock, AlertTriangle, HelpCircle, ArrowUpRight,
  Download, Trash2, Loader2, ListOrdered,
} from 'lucide-react'
import {
  deleteReranker, downloadReranker, fetchRagConfig, setRagTrack, setRerank,
  type RagConfig, type RagTrack, type RerankerModel, type RerankSettings, type TrackStatus,
} from '../../lib/blueprintsClient'
import { Skeleton } from '../ui/skeleton'
import { Switch } from '../ui/switch'
import { ThemeSelect } from '../ui/theme-select'
import { fetchEmbeddingConfig, type EmbeddingConfig } from '../../lib/embeddingsClient'

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

      <div className="border-t theme-border pt-4">
        <RerankSection config={config} onChange={setConfig} />
      </div>

      {/* The index, not the model. Choosing and pulling an embedding model is
          the Forge's job — it is a model, and the Forge is the model console.
          What belongs here is the corpus fact: whether the vectors currently
          stored were produced by the model that is currently selected. */}
      <div className="border-t theme-border pt-4">
        <IndexSummary />
      </div>
    </div>
  )
}

/**
 * Whether the index matches the selected embedding model.
 *
 * Read-only on purpose. A `stale` index is not fixed by changing a setting here
 * — it is fixed by re-ingesting, so offering a control would imply otherwise.
 *
 * It is worth stating at all because the failure is invisible from the results:
 * an index built by one model and queried through another still returns rows,
 * ranked by comparing vectors from two different spaces. That is not a worse
 * ranking, it is a meaningless one, and nothing in the answer says so. The query
 * path refuses such an index outright; this is where a reader finds out why.
 */
function IndexSummary() {
  const [config, setConfig] = useState<EmbeddingConfig | null>(null)

  useEffect(() => {
    fetchEmbeddingConfig().then(setConfig).catch(() => setConfig(null))
  }, [])

  if (!config) return <Skeleton className="h-20 w-full" />

  const stale = config.index_state === 'stale'
  // Chroma being unreachable is not a verdict on the index, so it is neither
  // red nor an all-clear: amber for a question that could not be asked.
  const unread = config.index_state === 'unknown'
  const Icon = stale ? AlertTriangle : unread ? HelpCircle : Check

  return (
    <div className="space-y-2">
      <h3 className="text-sm theme-text">Vector index</h3>
      <div
        className={`flex items-start gap-2 rounded-lg border p-2.5 ${
          stale
            ? 'border-rose-400/40 bg-rose-400/10'
            : unread
              ? 'border-amber-400/40 bg-amber-400/10'
              : 'theme-border'
        }`}
      >
        <Icon
          size={13}
          className={`mt-0.5 shrink-0 ${
            stale ? 'text-rose-400' : unread ? 'text-amber-400' : 'theme-text-muted'
          }`}
        />
        <div className="min-w-0 space-y-1">
          <p className="text-[11px] leading-relaxed theme-text">
            <span className="theme-text-muted">index {config.index_state} — </span>
            {config.index_detail}
          </p>
          <p className="text-[10px] theme-text-muted">
            embedding model: <code className="theme-text">{config.model}</code>
            {config.dimensions ? ` · ${config.dimensions}d` : ''}
            {/* A declared width is a claim about the tag; a verified one is what
                a probe actually received. Worth a word, since only the second
                is the width the store will hold. */}
            {config.dimensions ? ` (${config.dimensions_source})` : ''}
            {!config.production_safe && (
              <span className="text-amber-400"> · cloud baseline, not production-safe</span>
            )}
          </p>
        </div>
      </div>
      <p className="flex items-center gap-1 text-[11px] theme-text-muted">
        <ArrowUpRight size={11} />
        Pull an embedding model in The Forge → Embedding models; choose which one builds the index in The Forge → Installed.
      </p>
    </div>
  )
}

const CANDIDATE_OPTIONS = [10, 20, 30, 50].map((n) => ({ value: String(n), label: `${n} candidates` }))

function mb(bytes: number) {
  return `${Math.round(bytes / 1_000_000)} MB`
}

/**
 * Track 1's second stage: a cross-encoder re-scores the chunks Chroma returns.
 *
 * Vector search compares two embeddings made separately — the question's and
 * the chunk's — so it confuses "about the same topic" with "answers this". A
 * cross-encoder reads the pair together and scores relevance directly: too
 * slow for a whole corpus, fast enough for twenty candidates.
 *
 * Frozen with the track, because it changes what Track 1 retrieves: switching
 * it on after seeing the results is the tuning §5 forbids.
 */
function RerankSection({
  config,
  onChange,
}: {
  config: RagConfig
  onChange: (config: RagConfig) => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const rerank = config.rerank
  const selected = config.rerankers.find((m) => m.id === rerank.model)
  const downloading = config.rerankers.some((m) => m.download?.status === 'downloading')
  const locked = config.frozen || busy

  // While a download runs, re-read until it lands. The backend does the work
  // on its own thread; this only watches.
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    onChangeRef.current = onChange
  })
  useEffect(() => {
    if (!downloading) return
    const timer = window.setInterval(() => {
      fetchRagConfig().then((c) => onChangeRef.current(c)).catch(() => undefined)
    }, 1000)
    return () => window.clearInterval(timer)
  }, [downloading])

  const save = async (patch: Partial<RerankSettings>) => {
    setBusy(true)
    setError(null)
    try {
      onChange(await setRerank(patch))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const act = async (fn: () => Promise<unknown>) => {
    setError(null)
    try {
      await fn()
      onChange(await fetchRagConfig())
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div className="space-y-3">
      <header className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-1.5 text-sm theme-text">
            <ListOrdered size={14} className="theme-text-muted" /> Re-ranking
            <span className="rounded border theme-border px-1.5 py-0.5 text-[10px] theme-text-muted">Track 1</span>
          </h3>
          <p className="mt-1 text-xs leading-relaxed theme-text-muted">
            Vector search fetches the {rerank.candidates} nearest chunks; a cross-encoder then reads the
            question and each chunk together and keeps the ones that actually answer it. Runs on this
            machine's CPU, typically well under a second.
          </p>
        </div>
        <Switch
          checked={rerank.enabled}
          onChange={(next) => void save({ enabled: next })}
          disabled={locked}
          label="Re-ranking on or off"
        />
      </header>

      {!config.rerank_runtime.available && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-400/40 bg-amber-400/10 p-2.5">
          <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-400" />
          <p className="text-[11px] leading-relaxed theme-text">{config.rerank_runtime.detail}</p>
        </div>
      )}

      {rerank.enabled && selected && !selected.installed && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-400/40 bg-amber-400/10 p-2.5">
          <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-400" />
          <p className="text-[11px] leading-relaxed theme-text">
            {selected.label} is selected but not downloaded, so Track 1 is answering in plain vector
            order. Download it below.
          </p>
        </div>
      )}

      <div className="space-y-2">
        {config.rerankers.map((m) => (
          <RerankerCard
            key={m.id}
            model={m}
            selected={m.id === rerank.model}
            disabled={locked || !rerank.enabled}
            onSelect={() => void save({ model: m.id })}
            onDownload={() => void act(() => downloadReranker(m.id))}
            onDelete={() => void act(() => deleteReranker(m.id))}
          />
        ))}
      </div>

      <div className="flex items-center gap-3">
        <ThemeSelect
          value={String(rerank.candidates)}
          onChange={(v) => void save({ candidates: Number(v) })}
          options={
            CANDIDATE_OPTIONS.some((o) => o.value === String(rerank.candidates))
              ? CANDIDATE_OPTIONS
              : [...CANDIDATE_OPTIONS, { value: String(rerank.candidates), label: `${rerank.candidates} candidates` }]
          }
          ariaLabel="Candidate pool size"
          size="sm"
          className={`w-44 ${locked || !rerank.enabled ? 'pointer-events-none opacity-50' : ''}`}
        />
        <p className="text-[11px] leading-relaxed theme-text-muted">
          More candidates can recover a chunk vector search ranked low, at a cost in latency.
        </p>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-rose-400/40 bg-rose-400/10 p-2.5 text-[11px] theme-text">
          <AlertCircle size={13} className="shrink-0 text-rose-400" /> {error}
        </div>
      )}

      <p className="text-[11px] leading-relaxed theme-text-muted">
        Recorded per query in <code className="theme-text">rag_logs.rerank_model</code> and{' '}
        <code className="theme-text">rerank_scores</code>. Weights are pinned to a Hugging Face commit and
        stored under <code className="theme-text">data/models/rerankers</code>; after the download nothing
        here uses the network.
      </p>
    </div>
  )
}

function RerankerCard({
  model, selected, disabled, onSelect, onDownload, onDelete,
}: {
  model: RerankerModel
  selected: boolean
  disabled: boolean
  onSelect: () => void
  onDownload: () => void
  onDelete: () => void
}) {
  const job = model.download
  const pct = job && job.total ? Math.min(100, Math.round((job.bytes / job.total) * 100)) : 0
  return (
    <div
      className={`rounded-lg border p-3 transition-colors ${
        selected ? 'theme-accent-border theme-surface-strong' : 'theme-border'
      } ${disabled ? 'opacity-70' : ''}`}
    >
      <div className="flex items-center gap-2">
        <button
          onClick={onSelect}
          disabled={disabled || selected}
          className="flex min-w-0 flex-1 items-center gap-2 text-left disabled:cursor-default"
        >
          <span className="truncate text-sm theme-text">{model.label}</span>
          <span className="shrink-0 rounded border theme-border px-1.5 py-0.5 text-[10px] theme-text-muted">
            {model.languages}
          </span>
          {selected && <Check size={14} className="ml-auto shrink-0 theme-accent" />}
        </button>
        {job?.status === 'downloading' ? (
          <span className="flex shrink-0 items-center gap-1 text-[11px] theme-text-muted">
            <Loader2 size={12} className="animate-spin" /> {pct}%
          </span>
        ) : model.installed ? (
          <button
            onClick={onDelete}
            className="shrink-0 rounded p-1 theme-text-muted hover:theme-text"
            title="Delete the downloaded weights"
            aria-label={`Delete ${model.label}`}
          >
            <Trash2 size={13} />
          </button>
        ) : (
          <button
            onClick={onDownload}
            className="flex shrink-0 items-center gap-1 rounded border theme-border px-2 py-1 text-[11px] theme-text hover:theme-surface"
          >
            <Download size={12} /> {mb(model.size_bytes)}
          </button>
        )}
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed theme-text-muted">{model.note}</p>
      <p className="mt-1 text-[10px] theme-text-muted">
        <code className="theme-text">{model.repo}</code> @ {model.revision.slice(0, 7)}
        {model.installed ? ' · downloaded' : ' · not downloaded'}
        {job?.status === 'error' && <span className="text-rose-400"> · download failed: {job.error}</span>}
      </p>
    </div>
  )
}
