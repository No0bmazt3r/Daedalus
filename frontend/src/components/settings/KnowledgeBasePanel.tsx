import { useEffect, useState } from 'react'
import {
  Network, Boxes, Check, AlertCircle, Lock, AlertTriangle, ArrowUpRight,
  ListOrdered, Route,
} from 'lucide-react'
import {
  fetchRagConfig, setGraphSettings, setRagTrack, setRerank,
  type GraphSettings, type RagConfig, type RagTrack, type RerankSettings,
  type TrackStatus,
} from '../../lib/blueprintsClient'
import { Skeleton } from '../ui/skeleton'
import { Switch } from '../ui/switch'
import { ThemeSelect } from '../ui/theme-select'
import { EmbeddingModelsPane } from '../forge/EmbeddingModelsPane'
import type { ForgeTab } from '../forge/ForgeWindow'

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
    'Retrieval is plain math, so it always returns something, however capable the model is. ' +
    'But the index is pinned to one embedding model, and changing that means re-ingesting everything.',
  graph:
    'Walks a hand-authored knowledge graph over multiple hops, checking between steps whether it has ' +
    'enough. It needs no embedding model, because starting points come from hand-written aliases. The catch is that the ' +
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
          {track.ready ? 'ready' : `not ready${track.blocked_by ? `, needs ${track.blocked_by}` : ''}`}
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
        evaluation, so this is read-only. Edit <code>config/rag_config.json</code> by hand to
        change it.
      </p>
    </div>
  )
}

/** Settings → Vector RAG: Track 1's re-ranking, and whether its index can answer. */
export function VectorRagPanel({ onOpenForge }: { onOpenForge?: (tab: ForgeTab) => void }) {
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
        <RerankSection
          config={config}
          onChange={setConfig}
          onOpenForge={onOpenForge ? () => onOpenForge('rerankers') : undefined}
        />
      </div>
      {/* Which model builds Track 1's index, and whether the index matches it.
          Choosing is behaviour and is frozen with the comparison, so it lives
          here; pulling, verifying and deleting are the Forge's. */}
      <div className="border-t theme-border pt-4">
        <EmbeddingModelsPane
          mode="select"
          locked={config.frozen}
          onBrowse={onOpenForge ? () => onOpenForge('embedding') : undefined}
        />
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
          Which strategy answers a troubleshooting or SOP question. Sensor readings aren't affected,
          because numbers always come from a tool, never from retrieval.
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
        in Labyrinth Blueprints → Replay. The selected track's own settings (re-ranking for Vector
        RAG, the agent loop for Graph RAG) appear as a panel below this one in the settings list.
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
            (<code className="theme-text">graph_agent</code>). Off: the fixed path, sensor → threshold →
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
        The budget is a hard limit on the whole loop, model calls included. Once it runs out, the answer uses
        whatever was gathered. With no local model installed the fixed walk runs instead, recorded as such.
      </p>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-rose-400/40 bg-rose-400/10 p-2.5 text-[11px] theme-text">
          <AlertCircle size={13} className="shrink-0 text-rose-400" /> {error}
        </div>
      )}

      <p className="text-[11px] leading-relaxed theme-text-muted">
        Each walk is recorded in <code className="theme-text">rag_logs.traversal_path</code> with its mode,
        why it stopped, and the model's verdict after every hop. You can replay it in Labyrinth Blueprints.
      </p>
    </div>
  )
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

      <RerankerPicker
        config={config}
        disabled={locked || !rerank.enabled}
        onSelect={(id) => void save({ model: id })}
        onOpenForge={onOpenForge}
      />

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

function latency(ms: number) {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`
}

/**
 * Which re-ranker Track 1 uses: one dropdown over the *downloaded* models and a
 * line about the chosen one. The catalogue — every model with its fit verdict,
 * download and benchmark — is the Forge's Re-rankers tab; listing it again here
 * made this panel a second catalogue. The current choice stays in the list even
 * when it is not downloaded, so the dropdown never silently shows another one.
 */
function RerankerPicker({
  config, disabled, onSelect, onOpenForge,
}: {
  config: RagConfig
  disabled: boolean
  onSelect: (id: string) => void
  onOpenForge?: () => void
}) {
  const current = config.rerank.model
  const usable = config.rerankers.filter((m) => m.installed || m.id === current)
  const chosen = config.rerankers.find((m) => m.id === current)
  const best = config.rerankers.find((m) => m.id === config.rerank_fit.recommended.english)
  const options = usable.map((m) => ({
    value: m.id,
    label: `${m.label} · ${m.fit.latency_source === 'measured' ? '' : '~'}${latency(m.fit.latency_ms)}${m.installed ? '' : ' (not downloaded)'}`,
  }))
  const forgeLink = onOpenForge && (
    <button
      onClick={onOpenForge}
      className="inline-flex items-center gap-1 text-[11px] theme-accent hover:underline"
    >
      Manage in The Forge <ArrowUpRight size={11} />
    </button>
  )

  if (!config.rerankers.some((m) => m.installed) && !chosen) {
    return (
      <p className="text-[11px] leading-relaxed theme-text-muted">
        No re-ranker downloaded yet, so Track 1 uses plain vector order. {forgeLink}
      </p>
    )
  }

  const tone = chosen?.fit.verdict === 'safe' ? 'status-ok' : chosen?.fit.verdict === 'marginal' ? 'status-warn' : 'status-bad'
  return (
    <div className="space-y-1.5">
      <div className={disabled ? 'pointer-events-none opacity-60' : ''}>
        <ThemeSelect
          value={current}
          onChange={(id) => id !== current && onSelect(id)}
          options={options}
          ariaLabel="Re-ranker Track 1 uses"
          size="sm"
        />
      </div>
      {chosen && (
        <p className="text-[11px] leading-relaxed theme-text-muted">
          {chosen.languages} ·{' '}
          <span className={tone}>
            {chosen.fit.verdict === 'will_not_fit' ? 'will not fit' : chosen.fit.verdict} on this machine
          </span>
          {chosen.fit.reasons.length > 0 && `: ${chosen.fit.reasons[0]}`}
          {chosen.recommended_for.length > 0 && ' · recommended'}
          {best && best.id !== chosen.id && <> · this machine's recommendation is {best.label}</>}
          . {forgeLink}
        </p>
      )}
    </div>
  )
}
