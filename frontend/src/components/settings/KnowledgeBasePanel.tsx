import { useEffect, useState } from 'react'
import {
  Network, Boxes, Check, AlertCircle, Lock, AlertTriangle, HelpCircle, ArrowUpRight,
  ListOrdered, Route,
} from 'lucide-react'
import {
  fetchRagConfig, setGraphSettings, setRagTrack, setRerank,
  type GraphSettings, type RagConfig, type RagTrack, type RerankerModel, type RerankSettings,
  type TrackStatus,
} from '../../lib/blueprintsClient'
import { Skeleton } from '../ui/skeleton'
import { Switch } from '../ui/switch'
import { ThemeSelect } from '../ui/theme-select'
import { fetchEmbeddingConfig, type EmbeddingConfig } from '../../lib/embeddingsClient'

/**
 * Settings → Retrieval Track · Vector RAG · Graph RAG — which retrieval track answers a
 * knowledge query, and each track's own settings.
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

/**
 * The rag config, read once per panel. Three panels share it — the track
 * switch, Track 1's settings and Track 2's — and each reads its own copy rather
 * than sharing state, because Settings shows one panel at a time and the
 * server is the single source of truth either way.
 */
function useRagConfig() {
  const [config, setConfig] = useState<RagConfig | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    fetchRagConfig().then(setConfig).catch((e: Error) => setError(e.message))
  }, [])
  return { config, setConfig, error, setError }
}

function LoadState({ error }: { error: string | null }) {
  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-rose-400/40 bg-rose-400/10 p-3 text-xs theme-text">
        <AlertCircle size={14} className="shrink-0 text-rose-400" /> {error}
      </div>
    )
  }
  return <Skeleton className="h-52 w-full" />
}

function FrozenNotice() {
  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-400/40 bg-amber-400/10 p-3">
      <Lock size={13} className="mt-0.5 shrink-0 text-amber-400" />
      <p className="text-[11px] leading-relaxed theme-text">
        The comparison is frozen. Changing a track after seeing its results invalidates the
        evaluation, so this is read-only — edit <code>config/rag_config.json</code> by hand to
        change it.
      </p>
    </div>
  )
}

/** Settings → Vector RAG: Track 1's re-ranking, and whether its index can answer. */
export function VectorRagPanel({ onOpenForge }: { onOpenForge?: () => void }) {
  const { config, setConfig, error } = useRagConfig()
  if (!config) return <LoadState error={error} />
  return (
    <div className="space-y-4">
      <header>
        <h3 className="flex items-center gap-1.5 text-sm theme-text">
          <Boxes size={14} className="theme-text-muted" /> Vector RAG
          <span className="rounded border theme-border px-1.5 py-0.5 text-[10px] theme-text-muted">Track 1</span>
        </h3>
        <p className="mt-1 text-xs leading-relaxed theme-text-muted">{BLURB.vector}</p>
      </header>
      {config.frozen && <FrozenNotice />}
      <div className="border-t theme-border pt-4">
        <RerankSection config={config} onChange={setConfig} onOpenForge={onOpenForge} />
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

/** Settings → Graph RAG: Track 2's retrieval mode — the agent loop or the fixed walk. */
export function GraphRagPanel() {
  const { config, setConfig, error } = useRagConfig()
  if (!config) return <LoadState error={error} />
  return (
    <div className="space-y-4">
      <header>
        <h3 className="flex items-center gap-1.5 text-sm theme-text">
          <Network size={14} className="theme-text-muted" /> Graph RAG
          <span className="rounded border theme-border px-1.5 py-0.5 text-[10px] theme-text-muted">Track 2</span>
        </h3>
        <p className="mt-1 text-xs leading-relaxed theme-text-muted">{BLURB.graph}</p>
      </header>
      {config.frozen && <FrozenNotice />}
      <div className="border-t theme-border pt-4">
        <GraphModeSection config={config} onChange={setConfig} />
      </div>
    </div>
  )
}

/** Settings → Retrieval Track: which track answers. Each track's own settings have their own panel. */
export function KnowledgeBasePanel() {
  const { config, setConfig, error, setError } = useRagConfig()
  const [saving, setSaving] = useState(false)

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

  if (!config) return <LoadState error={error} />

  return (
    <div className="space-y-4">
      <header>
        <h3 className="text-sm theme-text">Retrieval track</h3>
        <p className="mt-1 text-xs leading-relaxed theme-text-muted">
          Which strategy answers a troubleshooting or SOP question. Sensor readings are unaffected —
          a number always comes from a tool, never from retrieval.
        </p>
      </header>

      {config.frozen && <FrozenNotice />}

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
        in Labyrinth Blueprints → Replay. The selected track's own settings — re-ranking for Vector
        RAG, the agent loop for Graph RAG — appear as a panel below this one in the settings list.
      </p>
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
const BUDGET_OPTIONS = [3, 6, 10, 20].map((n) => ({ value: String(n), label: `${n} s budget` }))
const STEP_OPTIONS = [1, 2, 3, 4].map((n) => ({ value: String(n), label: `${n} step${n === 1 ? '' : 's'}` }))

/**
 * Track 2's two retrieval modes — the within-track comparison.
 *
 * `agent` lets the committed local model choose each hop and judge when it has
 * enough; `walk` follows the schema's fixed path. Entry points are found the
 * same way in both, so the only difference is who decides where to walk. The
 * budget is a hard wall-clock limit: a model call still running at the deadline
 * is abandoned, and the answer is built from what was gathered.
 *
 * Frozen with the track, for the same reason re-ranking is.
 */
function GraphModeSection({
  config,
  onChange,
}: {
  config: RagConfig
  onChange: (config: RagConfig) => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const graph = config.graph
  const locked = config.frozen || busy
  const agent = graph.mode === 'agent'

  const save = async (patch: Partial<GraphSettings>) => {
    setBusy(true)
    setError(null)
    try {
      onChange(await setGraphSettings(patch))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const withCurrent = (options: { value: string; label: string }[], value: number, label: string) =>
    options.some((o) => o.value === String(value)) ? options : [...options, { value: String(value), label }]

  return (
    <div className="space-y-3">
      <header className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-1.5 text-sm theme-text">
            <Route size={14} className="theme-text-muted" /> Agent loop
            <span className="rounded border theme-border px-1.5 py-0.5 text-[10px] theme-text-muted">Track 2</span>
          </h3>
          <p className="mt-1 text-xs leading-relaxed theme-text-muted">
            On: the local model chooses each hop through the graph and decides when it has enough
            (<code className="theme-text">graph_agent</code>). Off: the fixed path — sensor → threshold →
            condition → procedure → steps (<code className="theme-text">graph_walk</code>). Compare the
            two inside Track 2 by running the same questions in each mode.
          </p>
        </div>
        <Switch
          checked={agent}
          onChange={(next) => void save({ mode: next ? 'agent' : 'walk' })}
          disabled={locked}
          label="Agent loop on or off"
        />
      </header>

      <div className={`flex flex-wrap items-center gap-3 ${locked || !agent ? 'pointer-events-none opacity-50' : ''}`}>
        <ThemeSelect
          value={String(graph.budget_s)}
          onChange={(v) => void save({ budget_s: Number(v) })}
          options={withCurrent(BUDGET_OPTIONS, graph.budget_s, `${graph.budget_s} s budget`)}
          ariaLabel="Time budget"
          size="sm"
          className="w-36"
        />
        <ThemeSelect
          value={String(graph.max_steps)}
          onChange={(v) => void save({ max_steps: Number(v) })}
          options={withCurrent(STEP_OPTIONS, graph.max_steps, `${graph.max_steps} steps`)}
          ariaLabel="Step limit"
          size="sm"
          className="w-32"
        />
      </div>
      <p className="text-[11px] leading-relaxed theme-text-muted">
        The budget is a hard limit on the whole loop, model calls included — past it the answer uses
        what was gathered. With no local model installed the fixed walk runs instead, recorded as such.
      </p>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-rose-400/40 bg-rose-400/10 p-2.5 text-[11px] theme-text">
          <AlertCircle size={13} className="shrink-0 text-rose-400" /> {error}
        </div>
      )}

      <p className="text-[11px] leading-relaxed theme-text-muted">
        Each walk is recorded in <code className="theme-text">rag_logs.traversal_path</code> with its mode,
        why it stopped, and the model's verdict after every hop — replay it in Labyrinth Blueprints.
      </p>
    </div>
  )
}

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
  onOpenForge,
}: {
  config: RagConfig
  onChange: (config: RagConfig) => void
  onOpenForge?: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const rerank = config.rerank
  const selected = config.rerankers.find((m) => m.id === rerank.model)
  const locked = config.frozen || busy

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
          <div className="min-w-0 flex-1 space-y-1.5">
            <p className="text-[11px] leading-relaxed theme-text">
              {selected.label} is selected but not downloaded, so Track 1 is answering in plain vector
              order. Download it in The Forge → Re-rankers.
            </p>
            {onOpenForge && (
              <button
                onClick={onOpenForge}
                className="flex items-center gap-1 rounded-md border theme-border px-2 py-0.5 text-[11px] theme-text hover:theme-surface"
              >
                Open The Forge <ArrowUpRight size={11} />
              </button>
            )}
          </div>
        </div>
      )}

      <div className="space-y-2">
        {config.rerankers.map((m) => (
          <RerankerChoice
            key={m.id}
            model={m}
            selected={m.id === rerank.model}
            disabled={locked || !rerank.enabled}
            onSelect={() => void save({ model: m.id })}
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
        <code className="theme-text">rerank_scores</code>. The weights are downloaded and deleted in The
        Forge → Re-rankers, with every other model on this machine; this panel only chooses.
      </p>
    </div>
  )
}

/**
 * One re-ranker as a choice. Download and delete live in The Forge →
 * Re-rankers, with every other model on this machine; this card
 * only selects, and says when the selection still needs downloading.
 */
function RerankerChoice({
  model, selected, disabled, onSelect,
}: {
  model: RerankerModel
  selected: boolean
  disabled: boolean
  onSelect: () => void
}) {
  return (
    <button
      onClick={onSelect}
      disabled={disabled || selected}
      className={`w-full rounded-lg border p-3 text-left transition-colors disabled:cursor-default ${
        selected ? 'theme-accent-border theme-surface-strong' : 'theme-border hover:theme-surface'
      } ${disabled && !selected ? 'opacity-60' : ''}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="truncate text-sm theme-text">{model.label}</span>
        <span className="shrink-0 rounded border theme-border px-1.5 py-0.5 text-[10px] theme-text-muted">
          {model.languages}
        </span>
        <span className={`shrink-0 text-[10px] ${model.installed ? 'text-emerald-400' : 'theme-text-muted'}`}>
          {model.installed ? 'downloaded' : `not downloaded · ${mb(model.size_bytes)}`}
        </span>
        <span
          className={`shrink-0 text-[10px] ${
            model.fit.verdict === 'safe' ? 'status-ok' : model.fit.verdict === 'marginal' ? 'status-warn' : 'status-bad'
          }`}
          title={model.fit.reasons.join(' · ') || 'Fits this machine'}
        >
          {model.fit.verdict === 'will_not_fit' ? 'will not fit' : model.fit.verdict} ·{' '}
          {model.fit.latency_source === 'measured' ? '' : '~'}
          {model.fit.latency_ms < 1000 ? `${model.fit.latency_ms} ms` : `${(model.fit.latency_ms / 1000).toFixed(1)} s`}
        </span>
        {model.recommended_for.length > 0 && (
          <span className="shrink-0 rounded border theme-accent-border px-1.5 py-px text-[10px] theme-accent">
            Recommended{model.recommended_for.includes('english') ? '' : ' for Malay'}
          </span>
        )}
        {selected && <Check size={14} className="ml-auto shrink-0 theme-accent" />}
      </div>
      <p className="mt-1.5 text-[11px] leading-relaxed theme-text-muted">{model.note}</p>
    </button>
  )
}
