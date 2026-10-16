import { useCallback, useEffect, useState } from 'react'
import { TabError } from '../errors/TabError'
import { toFailure, type LoadFailure } from '../errors/ErrorPage'
import { useConfirm } from '../ui/confirm-dialog'
import { useLiveRefresh } from '../../hooks/useLiveRefresh'
import {
  AlertTriangle, CircleAlert, CircleCheck, CircleSlash, Cpu, Download, Gauge, Loader2, Sparkles, Trash2,
} from 'lucide-react'
import {
  benchmarkReranker, deleteReranker, downloadReranker, fetchRagConfig,
  type RagConfig, type RerankerModel, type RerankVerdict,
} from '../../lib/blueprintsClient'
import { Skeleton } from '../ui/skeleton'
import { BrowseLink, EmptyNote, PaneIntro } from './paneParts'

/**
 * The Forge → Re-rankers.
 *
 * The cross-encoders Track 1 can re-score its candidates with — judged against
 * this machine, downloaded, benchmarked and deleted here, because the Forge is
 * where every model on this machine lives. The catalogue is curated and pinned
 * (`services/reranker.py`), so browsing and managing share one list.
 *
 * Each model gets the Forge's verdict — safe / marginal / will not fit — on the
 * two things a re-ranker spends: memory beside the chat model, and the time to
 * re-score a question's candidates against re-ranking's slice of the 3-second
 * answer. The time is an *estimate* until Benchmark measures it on this machine,
 * and the card says which. The recommendation is the strongest model judged
 * safe, once for English and once for Malay.
 *
 * Two modes, like the embedding models: `browse` (Forge → Re-rankers) is the
 * catalogue with its fit verdicts and Download; `installed` (Forge → Installed →
 * Re-rankers) is what is on disk, with Benchmark and Delete. Each control has
 * one home — a downloaded model in browse shows Manage, not the controls again.
 *
 * *Which* re-ranker Track 1 uses stays in Settings → Vector RAG: that is a
 * retrieval setting, frozen with the comparison. Downloading is not.
 */
function mb(bytes: number) {
  return bytes >= 1_000_000_000 ? `${(bytes / 1_000_000_000).toFixed(1)} GB` : `${Math.round(bytes / 1_000_000)} MB`
}

/** "Apache-2.0 (BAAI weights; …)" → "Apache-2.0"; the whole string stays on hover. */
function brief(text: string) {
  return text.split(' (')[0]
}

function seconds(ms: number) {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`
}

const VERDICT: Record<RerankVerdict, { icon: typeof CircleCheck; tone: string; label: string }> = {
  safe: { icon: CircleCheck, tone: 'status-ok', label: 'safe' },
  marginal: { icon: CircleAlert, tone: 'status-warn', label: 'marginal' },
  will_not_fit: { icon: CircleSlash, tone: 'status-bad', label: 'will not fit' },
}

export function RerankersPane({
  mode = 'browse', onManage, onBrowse,
}: {
  mode?: 'browse' | 'installed'
  /** Browse mode: go to where a downloaded model is managed. */
  onManage?: () => void
  /** Installed mode: go to where one can be downloaded. */
  onBrowse?: () => void
}) {
  const [config, setConfig] = useState<RagConfig | null>(null)
  // `loadError`: the pane cannot be shown at all. `error`: an action failed.
  const [loadError, setLoadError] = useState<LoadFailure | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [benching, setBenching] = useState<string | null>(null)
  const [confirm, confirmDialog] = useConfirm()

  const load = useCallback(
    () => fetchRagConfig().then((c) => { setConfig(c); setLoadError(null) }).catch((e: unknown) => setLoadError(toFailure(e))),
    [],
  )

  useEffect(() => {
    void load()
  }, [load])
  useLiveRefresh(['rag'], () => void load())

  // While a download runs, re-read until it lands. The backend does the work
  // on its own thread; this only watches.
  const downloading = config?.rerankers.some((m) => m.download?.status === 'downloading') ?? false
  useEffect(() => {
    if (!downloading) return
    const timer = window.setInterval(() => {
      fetchRagConfig().then(setConfig).catch(() => undefined)
    }, 1000)
    return () => window.clearInterval(timer)
  }, [downloading])

  const act = async (fn: () => Promise<unknown>) => {
    setError(null)
    try {
      await fn()
      await load()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const bench = async (m: RerankerModel) => {
    setBenching(m.id)
    await act(() => benchmarkReranker(m.id))
    setBenching(null)
  }

  if (!config) {
    return loadError ? (
      <TabError
        code={loadError.status}
        detail={loadError.message}
        what="The re-ranker settings could not be loaded from the backend."
        onRetry={() => void load()}
      />
    ) : <Skeleton className="h-40 w-full" />
  }

  const fit = config.rerank_fit
  const free = fit.machine.available_bytes
  // Recommended first, then strongest; the list reads as an answer, not a catalogue.
  const rows = [...config.rerankers]
    .filter((m) => mode === 'browse' || m.installed)
    .sort((a, b) => b.recommended_for.length - a.recommended_for.length || b.quality - a.quality)

  const budget = `Re-scoring ${fit.candidates} chunks should take under ${seconds(fit.budget_ms)}, `
    + "re-ranking's share of a 3-second answer. Times are estimates until benchmarked here. Weights are "
    + 'pinned to a Hugging Face commit under data/models/rerankers; after the download nothing uses the network.'

  return (
    <div className="space-y-3">
      {confirmDialog}
      <PaneIntro action={mode === 'installed' && onBrowse && <BrowseLink onClick={onBrowse}>Browse re-rankers</BrowseLink>}>
        {mode === 'browse'
          ? 'Cross-encoders that re-score Track 1’s candidates. Pick which one runs in Settings → Vector RAG.'
          : 'Downloaded re-rankers. Benchmark one to replace its estimate with a measurement.'}
      </PaneIntro>

      {/* The machine the verdicts are for — one line; the reasoning is on hover. */}
      <p className="flex flex-wrap items-center gap-x-2 text-[11px] theme-text-muted" title={budget}>
        <Cpu size={12} className="shrink-0" />
        <span className="theme-text">{fit.machine.cpu ?? 'This CPU'}</span>
        <span>· {fit.machine.threads} threads</span>
        {free != null && <span>· {mb(free)} free</span>}
        <span>· budget {seconds(fit.budget_ms)} / {fit.candidates} chunks</span>
      </p>

      {!config.rerank_runtime.available && (
        <div className="flex items-start gap-2 rounded-xl border status-warn-border status-warn-bg p-3 text-xs">
          <AlertTriangle size={14} className="status-warn mt-0.5 shrink-0" />
          <span className="theme-text">{config.rerank_runtime.detail}</span>
        </div>
      )}

      <div className="space-y-2">
        {mode === 'installed' && rows.length === 0 && (
          <EmptyNote>No re-rankers downloaded yet.</EmptyNote>
        )}
        {rows.map((m) => (
          <RerankerRow
            key={m.id}
            model={m}
            mode={mode}
            onManage={onManage}
            inUse={config.rerank.enabled && config.rerank.model === m.id}
            benching={benching === m.id}
            onDownload={() => void act(() => downloadReranker(m.id))}
            onBenchmark={() => void bench(m)}
            onDelete={async () => {
              const ok = await confirm({
                title: `Delete ${m.label}?`,
                body: 'This removes its downloaded weights from this machine. You can download it again later for a fresh install.',
                confirmLabel: 'Delete',
                requireTyped: 'DELETE',
                danger: true,
              })
              if (ok) void act(() => deleteReranker(m.id))
            }}
          />
        ))}
      </div>

      {error && <p className="text-xs text-rose-400">{error}</p>}
    </div>
  )
}

function RerankerRow({
  model, mode, onManage, inUse, benching, onDownload, onBenchmark, onDelete,
}: {
  model: RerankerModel
  mode: 'browse' | 'installed'
  onManage?: () => void
  inUse: boolean
  benching: boolean
  onDownload: () => void
  onBenchmark: () => void
  onDelete: () => void
}) {
  const job = model.download
  const pct = job && job.total ? Math.min(100, Math.round((job.bytes / job.total) * 100)) : 0
  const verdict = VERDICT[model.fit.verdict]
  const measured = model.fit.latency_source === 'measured'
  const why = model.fit.reasons.join(' · ')
  const source = `${model.repo} @ ${model.revision.slice(0, 7)}`
  const button = 'flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-[11px] transition-colors disabled:opacity-50'
  return (
    <div className={`group rounded-xl border px-3 py-2.5 ${inUse ? 'theme-accent-border' : 'theme-border'}`}>
      <div className="flex items-center gap-2">
        <span className="min-w-0 truncate text-sm theme-text" title={`${model.note}\n${source}`}>{model.label}</span>
        {model.recommended_for.map((r) => (
          <span
            key={r}
            className="flex shrink-0 items-center gap-1 text-[10px] theme-accent"
            title={`The strongest re-ranker this machine can run for ${r === 'english' ? 'English' : 'Malay'} questions`}
          >
            <Sparkles size={10} /> {r === 'malay' ? 'Best for Malay' : 'Recommended'}
          </span>
        ))}
        {inUse && (
          <span className="shrink-0 rounded-full theme-surface-strong px-2 py-0.5 text-[10px] theme-text">
            {model.installed ? 'In use' : 'Selected · not downloaded'}
          </span>
        )}
        <span className="ml-auto" />
        {job?.status === 'downloading' ? (
          <span className="flex shrink-0 items-center gap-1 text-[11px] theme-text-muted">
            <Loader2 size={12} className="animate-spin" /> {pct}%
          </span>
        ) : model.installed && mode === 'browse' ? (
          onManage ? (
            <button onClick={onManage} className={`${button} theme-text-muted hover:theme-text`}
              title="Benchmark or delete it under Installed → Re-rankers">
              Manage
            </button>
          ) : (
            <span className="shrink-0 text-[11px] status-ok">Downloaded</span>
          )
        ) : model.installed ? (
          <>
            <button onClick={onBenchmark} disabled={benching} className={`${button} border theme-border theme-text hover:theme-surface`}
              title="Time re-scoring a question's candidates on this machine">
              {benching ? <Loader2 size={12} className="animate-spin" /> : <Gauge size={12} />} Benchmark
            </button>
            <button onClick={onDelete} title="Delete the downloaded weights" aria-label={`Delete ${model.label}`}
              className="shrink-0 rounded p-1 theme-text-muted opacity-60 transition-opacity hover:text-rose-400 hover:opacity-100 group-hover:opacity-100">
              <Trash2 size={13} />
            </button>
          </>
        ) : (
          <button onClick={onDownload} className={`${button} border theme-border theme-text hover:theme-surface`}>
            <Download size={12} /> {mb(model.size_bytes)}
          </button>
        )}
      </div>

      {/* One line of facts. The verdict colours the time it is about; the why is on hover. */}
      <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-[11px] theme-text-muted">
        <span className={`flex items-center gap-1 ${verdict.tone}`} title={why || 'Fits this machine'}>
          <verdict.icon size={11} />
          {measured ? '' : '~'}{seconds(model.fit.latency_ms)}
          <span className="theme-text-muted">{measured ? 'measured' : 'est.'}</span>
          {model.fit.verdict !== 'safe' && <span>· {verdict.label}</span>}
        </span>
        <span>· {mb(model.fit.memory_bytes)}</span>
        <span title={model.languages}>· {brief(model.languages)}</span>
        <span title={model.licence}>· {brief(model.licence)}</span>
        {job?.status === 'error' && <span className="text-rose-400">· download failed: {job.error}</span>}
      </div>
    </div>
  )
}
