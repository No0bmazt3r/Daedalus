import { useEffect, useState } from 'react'
import {
  Download, Check, AlertTriangle, CloudOff, Cloud, X, RefreshCw,
} from 'lucide-react'
import {
  fetchEmbeddingConfig, setEmbeddingModel, pullEmbeddingModel,
  type EmbeddingConfig, type EmbeddingModel,
} from '../../lib/embeddingsClient'
import { Skeleton } from '../ui/skeleton'

/**
 * Forge → Added Models → Embedding models.
 *
 * Which model turns chunks into vectors — `architecture/04` Step 5.
 *
 * ## Why this is in the Forge and not in Settings
 *
 * It lived beside the retrieval-track switch first, on the reasoning that the
 * choice is inseparable from the index it produced. That is true and it is still
 * the wrong home: the Forge is the model console, and this is a model. Splitting
 * "models you pull" across two windows by what the model is *for* means neither
 * window answers "what is on this machine".
 *
 * So the Forge owns the whole lifecycle — discover, pull, select, delete — and
 * Settings → Knowledge Base keeps only what is genuinely a corpus fact: whether
 * the index matches the selected model.
 *
 * ## Inventory and choice, not discovery
 *
 * Finding and pulling one happens in Models → Embeddings, the same way it does
 * for answering models: that tab is *what could run here*, this pane is *what is
 * here now* and which one is in use. Listing the whole catalogue in both places
 * would make neither the answer to "what do I actually have".
 *
 * ## Its own pane, not a tier inside Local models
 *
 * An embedding model is not a small answering model. It never appears in the
 * composer's picker, is never benchmarked for tokens/sec, and has no fit
 * verdict — the scorer weighs quality, speed and context pressure for something
 * that generates text. Filing it beside the SLM and LLM tiers would say the
 * opposite of all three.
 *
 * ## This is not the chat model
 *
 * The panel says so on screen, because it is the mistake everything else here
 * is downstream of. `nomic-embed-text` embeds the corpus once, offline, at
 * ingest. Qwen3 answers questions at query time and never sees a vector.
 * Changing the chat model — including mid-conversation, which this project
 * allows — does nothing to the index.
 *
 * ## Changing *this* model is a one-way door
 *
 * An embedding is only comparable to embeddings from the same model. Different
 * model, different vector space, and cosine similarity across two spaces is not
 * a worse ranking — it is a meaningless one. So a change means re-embedding
 * every chunk, and the panel states that before the change rather than after.
 *
 * `index_state` is the mechanism: the config records which model actually built
 * the current index, so a mismatch shows as `stale` instead of as silently
 * wrong search results.
 *
 *
 * ## Cloud is quarantined, not offered as an equal
 *
 * Rule 1 permits cloud models as offline evaluation baselines. For embeddings
 * the exposure is worse than for a chat turn, and the panel explains why rather
 * than just disabling the control: embedding the corpus in the cloud sends every
 * document out, and every later query has to be embedded by the same model to
 * be comparable — so every question goes out too. A cloud selection therefore
 * writes a separate collection and cannot serve the local system.
 */

function bytes(n: number | null): string {
  if (!n) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  let v = n, u = 0
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u++ }
  return `${v.toFixed(u === 0 ? 0 : 1)} ${units[u]}`
}

function IndexState({ config }: { config: EmbeddingConfig }) {
  const tone =
    config.index_state === 'stale'
      ? 'border-rose-400/40 bg-rose-400/10'
      : config.index_state === 'current'
        ? 'border-emerald-400/40 bg-emerald-400/10'
        : 'theme-border'
  const Icon = config.index_state === 'stale' ? AlertTriangle : Check
  const tint =
    config.index_state === 'stale'
      ? 'text-rose-400'
      : config.index_state === 'current'
        ? 'text-emerald-400'
        : 'theme-text-muted'

  return (
    <div className={`flex items-start gap-2 rounded-lg border p-2.5 ${tone}`}>
      <Icon size={13} className={`mt-0.5 shrink-0 ${tint}`} />
      <p className="text-[11px] leading-relaxed theme-text">
        <span className="theme-text-muted">index {config.index_state} — </span>
        {config.index_detail}
      </p>
    </div>
  )
}

function ModelRow({
  model, selected, onSelect, onPull, pulling, progress,
}: {
  model: EmbeddingModel
  selected: boolean
  onSelect: () => void
  onPull: () => void
  pulling: boolean
  progress: string | null
}) {
  // A chunk longer than the window is truncated without error, so the panel
  // flags the narrow ones against M2's 300-500 token chunks rather than leaving
  // the reader to compare two numbers in different places.
  const tooNarrow = (model.max_tokens ?? 0) > 0 && (model.max_tokens as number) < 512

  return (
    <div
      className={`rounded-lg border p-2.5 transition-colors ${
        selected ? 'theme-accent-border theme-surface-strong' : 'theme-border'
      }`}
    >
      <div className="flex items-center gap-2">
        <button onClick={onSelect} className="flex min-w-0 flex-1 items-center gap-2 text-left">
          <span className="truncate text-xs theme-text">{model.label}</span>
          {model.recommended && (
            <span className="shrink-0 rounded border theme-accent-border px-1.5 py-0.5 text-[9px] theme-accent">
              recommended
            </span>
          )}
          {selected && <Check size={13} className="shrink-0 theme-accent" />}
        </button>
        {model.installed ? (
          <span className="shrink-0 text-[10px] text-emerald-400">installed</span>
        ) : (
          <button
            onClick={onPull}
            disabled={pulling}
            className="inline-flex shrink-0 items-center gap-1 rounded border theme-border px-2 py-1 text-[10px] theme-text-muted transition-colors hover:theme-text disabled:opacity-50"
          >
            {pulling ? <RefreshCw size={10} className="animate-spin" /> : <Download size={10} />}
            {pulling ? (progress ?? 'pulling…') : 'pull'}
          </button>
        )}
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[10px] theme-text-muted">
        <code>{model.tag}</code>
        <span>{model.dimensions ? `${model.dimensions}d` : '—'}</span>
        <span className={tooNarrow ? 'text-amber-400' : ''}>
          {model.max_tokens ? `${model.max_tokens} tok` : '—'}
          {tooNarrow && ' ⚠ narrower than a chunk'}
        </span>
        <span>{bytes(model.size_bytes)}</span>
      </div>
      <p className="mt-1 text-[10px] leading-relaxed theme-text-muted">{model.note}</p>
    </div>
  )
}

export function EmbeddingModelsPane() {
  const [config, setConfig] = useState<EmbeddingConfig | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pullingTag, setPullingTag] = useState<string | null>(null)
  const [progress, setProgress] = useState<string | null>(null)
  const [showCloud, setShowCloud] = useState(false)

  const load = () => fetchEmbeddingConfig().then(setConfig).catch((e: Error) => setError(e.message))
  useEffect(() => { load() }, [])

  const installed = (config?.local_models ?? []).filter((m) => m.installed)

  const select = async (provider: 'local' | 'cloud', model: string, endpointId?: string) => {
    setError(null)
    try {
      setConfig(await setEmbeddingModel({ provider, model, endpoint_id: endpointId ?? null }))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const pull = (tag: string) => {
    setPullingTag(tag)
    setProgress(null)
    setError(null)
    const stream = pullEmbeddingModel(tag, (e) => {
      if (e.error) setError(e.error)
      else if (e.total && e.completed) {
        setProgress(`${Math.round((e.completed / e.total) * 100)}%`)
      } else if (e.status) setProgress(e.status)
    })
    stream.done
      .catch((e: Error) => setError(e.message))
      .finally(() => {
        setPullingTag(null)
        setProgress(null)
        load()
      })
  }

  if (!config) return <Skeleton className="h-64 w-full" />

  return (
    <div className="space-y-4">
      <header>
        <h3 className="text-sm theme-text">Embedding model</h3>
        <p className="mt-1 text-xs leading-relaxed theme-text-muted">
          Turns document chunks into vectors, once, at ingest.{' '}
          <span className="theme-text">This is not the chat model</span> — changing which model
          answers questions, even mid-conversation, does not touch the index.
        </p>
        <p className="mt-1.5 text-[11px] leading-relaxed theme-text-muted">
          Used by Track 1 only — Track 2 has no embedding model at all. Never offered to the
          assistant, and not scored for fit or speed: those measure a model that generates text.
        </p>
      </header>

      <IndexState config={config} />

      {!config.ollama_available && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-400/40 bg-amber-400/10 p-2.5 text-[11px] theme-text">
          <AlertTriangle size={13} className="shrink-0 text-amber-400" />
          Ollama is not reachable, so nothing can be pulled. Installed models cannot be detected either.
        </div>
      )}

      {installed.length === 0 ? (
        <p className="rounded-xl border border-dashed theme-border px-3 py-6 text-center text-xs theme-text-muted">
          No embedding model installed. Pull one from{' '}
          <span className="theme-text">Models → Embeddings</span> — Track 1 cannot ingest without
          one, and Track 2 does not need one at all.
        </p>
      ) : (
        <div className="space-y-2">
          {installed.map((m) => (
            <ModelRow
              key={m.tag}
              model={m}
              selected={config.provider === 'local' && config.model.split(':')[0] === m.tag}
              onSelect={() => select('local', m.tag)}
              onPull={() => pull(m.tag)}
              pulling={pullingTag === m.tag}
              progress={progress}
            />
          ))}
          {/* The selection may name something that is not installed — a choice
              recorded before pulling, or a model deleted afterwards. Saying so
              beats a list that silently does not contain the selected row. */}
          {config.provider === 'local' &&
            !installed.some((m) => m.tag === config.model.split(':')[0]) && (
              <p className="rounded-xl border status-warn-border status-warn-bg px-3 py-2 text-[11px] theme-text">
                <code>{config.model}</code> is selected but not installed. Pull it from Models →
                Embeddings, or choose one above.
              </p>
            )}
        </div>
      )}

      {/* Cloud sits behind a disclosure, below the local list and after the
          explanation. It is a baseline, not an alternative, and presenting it as
          a peer of the local models would be the wrong shape for Rule 1. */}
      <div className="rounded-lg border theme-border">
        <button
          onClick={() => setShowCloud((v) => !v)}
          className="flex w-full items-center gap-2 p-2.5 text-left"
        >
          {config.provider === 'cloud' ? (
            <Cloud size={13} className="shrink-0 text-amber-400" />
          ) : (
            <CloudOff size={13} className="shrink-0 theme-text-muted" />
          )}
          <span className="text-xs theme-text">Cloud embedding baseline</span>
          <span className="ml-auto text-[10px] theme-text-muted">
            {showCloud ? 'hide' : 'show'}
          </span>
        </button>

        {showCloud && (
          <div className="space-y-2 border-t theme-border p-2.5">
            <p className="text-[11px] leading-relaxed theme-text-muted">
              Rule 1 allows cloud models as <span className="theme-text">offline evaluation
              baselines only</span>, and embeddings are a bigger exposure than a chat turn:
              embedding the corpus sends <span className="theme-text">every document</span> to a
              third party, and every later query must be embedded by the same model to be
              comparable — so every question goes out too. There is no one-off cloud embedding.
            </p>
            <p className="text-[11px] leading-relaxed theme-text-muted">
              A cloud selection writes a separate collection (
              <code className="theme-text">daedalus_knowledge_cloud_baseline</code>) and cannot
              serve the local system — the runtime refuses it.
            </p>

            {config.cloud_baselines.length === 0 ? (
              <p className="rounded border border-dashed theme-border p-2.5 text-[11px] theme-text-muted">
                No benchmark endpoints configured. Add one in Settings → Add Models first; the same
                credentials are reused rather than stored twice.
              </p>
            ) : (
              <div className="space-y-1.5">
                {config.cloud_baselines.map((b) => (
                  <div
                    key={b.id}
                    className={`flex items-center gap-2 rounded border p-2 ${
                      config.endpoint_id === b.id ? 'border-amber-400/50 bg-amber-400/10' : 'theme-border'
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate text-[11px] theme-text">{b.label}</span>
                    <span className="shrink-0 text-[10px] theme-text-muted">{b.provider}</span>
                    <button
                      onClick={() => select('cloud', 'text-embedding-3-large', b.id)}
                      disabled={!b.has_key || !b.enabled}
                      className="shrink-0 rounded border theme-border px-2 py-1 text-[10px] theme-text-muted hover:theme-text disabled:opacity-40"
                    >
                      use as baseline
                    </button>
                  </div>
                ))}
              </div>
            )}

            {config.provider === 'cloud' && (
              <button
                onClick={() => select('local', 'nomic-embed-text')}
                className="inline-flex items-center gap-1.5 rounded border theme-accent-border px-2.5 py-1.5 text-[11px] theme-accent"
              >
                <X size={11} /> Return to a local model
              </button>
            )}
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-rose-400/40 bg-rose-400/10 p-2.5 text-[11px] theme-text">
          <AlertTriangle size={13} className="shrink-0 text-rose-400" /> {error}
        </div>
      )}
    </div>
  )
}
