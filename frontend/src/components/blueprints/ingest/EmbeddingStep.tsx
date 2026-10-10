import { useCallback, useEffect, useState } from 'react'
import { TabError } from '../../errors/TabError'
import { toFailure, type LoadFailure } from '../../errors/ErrorPage'
import { useLiveRefresh } from '../../../hooks/useLiveRefresh'
import { RotateCcw, AlertTriangle, Check, Cpu, Hammer, ArrowUpRight } from 'lucide-react'
import { fetchEmbeddingConfig, setEmbeddingModel, type EmbeddingConfig } from '../../../lib/embeddingsClient'
import { Skeleton } from '../../ui/skeleton'
import { ThemeSelect } from '../../ui/theme-select'

/**
 * Which model will embed, and whether it can — a readiness gate, not a manager.
 *
 * This step used to list every embedding model with its own Pull buttons, which
 * was a second model console sitting inside the corpus panel. The Forge already
 * is the model console: it owns pulling, quantization, hardware fit and the
 * embedding pane, and two surfaces doing the same job drift until one of them is
 * subtly wrong about what is installed.
 *
 * So this reports and hands off. What belongs *here* is the question the
 * pipeline needs answered — "can the run embed, and with what" — and the
 * consequence of the answer, which is specific to ingestion: the model is
 * stamped onto the index it builds, and changing it later invalidates every
 * vector. What belongs in the Forge is everything about the model as a model.
 *
 * The handoff opens the Forge rather than linking to it in prose, because a
 * sentence telling somebody where to go is a worse version of a button that
 * takes them there.
 */
export function EmbeddingStep({ onOpenForge }: { onOpenForge?: () => void }) {
  const [config, setConfig] = useState<EmbeddingConfig | null>(null)
  // `loadError`: this step cannot be shown at all. `error`: choosing a model failed.
  const [loadError, setLoadError] = useState<LoadFailure | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    fetchEmbeddingConfig()
      .then((c) => { setConfig(c); setLoadError(null) })
      .catch((e: unknown) => setLoadError(toFailure(e)))
  }, [])
  useEffect(() => { load() }, [load])
  useLiveRefresh(['models', 'embeddings'], load)

  if (loadError && !config) {
    return (
      <TabError
        code={loadError.status}
        detail={loadError.message}
        what="The embedding model settings could not be read from the backend."
        onRetry={load}
      />
    )
  }
  // The explanation is fixed text: shown now, the model card once it loads.
  if (!config) {
    return (
      <div className="space-y-3">
        <Intro />
        <Skeleton className="h-24 w-full" />
      </div>
    )
  }

  // Choosing is still an explicit click, so nothing is defaulted behind your back.
  const choose = async (tag: string) => {
    setError(null)
    try {
      setConfig(await setEmbeddingModel({ provider: 'local', model: tag }))
    } catch (e) {
      setError((e as Error).message)
    }
  }
  const installedModels = config.local_models.filter((m) => m.installed)

  const chosen = (config.model || '').trim()
  const selected = config.local_models.find((m) => m.tag === chosen)
  const installed = !!selected?.installed
  // Three distinct blockers, reported as three distinct sentences below. "No
  // model chosen" is the first one and used to be invisible, because the config
  // shipped with a model already named.
  const blocked = !chosen || !config.ollama_available || !installed

  return (
    <div className="space-y-3">
      <Intro />

      <div
        className={`rounded-lg border p-3 ${
          blocked ? 'border-amber-400/40 bg-amber-400/10' : 'theme-accent-border theme-surface-strong'
        }`}
      >
        <div className="flex items-start gap-2">
          {blocked ? (
            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-400" />
          ) : (
            <Check size={14} className="mt-0.5 shrink-0 theme-accent" />
          )}
          <div className="min-w-0 flex-1">
            {!chosen ? (
              <>
                <p className="text-xs theme-text">No embedding model selected</p>
                <p className="mt-0.5 text-[10px] leading-relaxed theme-text-muted">
                  Nothing is chosen, and nothing is assumed. The model is stamped onto the index
                  it builds and changing it afterwards invalidates every vector, so this is picked
                  rather than defaulted. The run won't start until you choose one.
                </p>
              </>
            ) : (
              <>
                <p className="text-xs theme-text">
                  {selected?.label ?? chosen}
                  <span className="ml-1.5 text-[10px] theme-text-muted">
                    <code>{chosen}</code>
                  </span>
                </p>
                <p className="mt-0.5 text-[10px] theme-text-muted">
                  {config.dimensions
                    ? `${config.dimensions}d (${config.dimensions_source})`
                    : 'width unknown'}
                  {' · '}
                  {!config.ollama_available
                    ? 'Ollama unreachable'
                    : installed
                      ? 'pulled and ready'
                      : 'not pulled yet. The run will chunk, then fail at every embed step'}
                  {!config.production_safe && ' · cloud baseline, not production-safe'}
                </p>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Any installed embedder can be picked or swapped here. Swapping is safe:
          each model owns its own collection, so the old index is kept. */}
      {installedModels.length > 0 && (
        <div>
          <ThemeSelect
            size="sm"
            label="Embedding model"
            value={installed ? chosen : ''}
            onChange={(tag) => { if (tag && tag !== chosen) void choose(tag) }}
            options={[
              ...(installed ? [] : [{ value: '', label: 'Choose an installed model…' }]),
              ...installedModels.map((m) => ({ value: m.tag, label: `${m.label} (${m.tag})` })),
            ]}
          />
          <p className="mt-1 text-[10px] leading-relaxed theme-text-muted">
            Switching builds a separate index for the new model. The old one is kept, so switching
            back costs nothing.
          </p>
          {error && <p className="mt-1 text-[10px] text-rose-400">{error}</p>}
        </div>
      )}

      <dl className="grid gap-2 @2xl:grid-cols-2">
        {([
          ['Index it builds', config.collection || 'none until a model is chosen'],
          ['Index state', config.index_detail],
        ] as const).map(([k, v]) => (
          <div key={k} className="rounded-lg border theme-border theme-card p-2.5">
            <dt className="text-[10px] uppercase tracking-wider theme-text-muted">{k}</dt>
            <dd className="mt-0.5 break-words text-[11px] leading-relaxed theme-text">{v}</dd>
          </div>
        ))}
      </dl>

      {/* The handoff. One place manages models, and it is not this one. */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border theme-border theme-card p-2.5">
        <Cpu size={13} className="shrink-0 theme-text-muted" />
        <p className="min-w-0 flex-1 text-[11px] leading-relaxed theme-text-muted">
          Pulling a new model or checking what it costs on this hardware happens in the Forge.
          Pick between the ones already installed above.
        </p>
        {onOpenForge && (
          <button
            onClick={onOpenForge}
            className="flex shrink-0 items-center gap-1.5 rounded-md border theme-accent-border px-2.5 py-1 text-[11px] theme-accent transition-colors hover:theme-surface-strong"
          >
            <Hammer size={11} /> Open the Forge
            <ArrowUpRight size={11} />
          </button>
        )}
      </div>

      <button
        onClick={load}
        className="flex items-center gap-1.5 rounded-md border theme-border px-2 py-1 text-[11px] theme-text-muted transition-colors hover:theme-text"
      >
        <RotateCcw size={11} /> Re-check
      </button>
    </div>
  )
}

// ── step 4 ───────────────────────────────────────────────────────────────────

function Intro() {
  return (
    <p className="text-[11px] leading-relaxed theme-text-muted">
        The model that turns chunks into vectors. Not the chat model, and the one choice in this
        flow that cannot be changed cheaply afterwards: it is stamped onto the index it builds, and
        vectors from two different models can't be compared, so changing it later means re-embedding
        everything.
    </p>
  )
}
