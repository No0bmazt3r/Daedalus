import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle, CircleAlert, CircleCheck, CircleSlash, Download, Gauge, Loader2, Sparkles, Trash2,
} from 'lucide-react'
import {
  benchmarkReranker, deleteReranker, downloadReranker, fetchRagConfig,
  type RagConfig, type RerankerModel, type RerankVerdict,
} from '../../lib/blueprintsClient'
import { Skeleton } from '../ui/skeleton'
import { PaneIntro } from './paneParts'

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
 * *Which* re-ranker Track 1 uses stays in Settings → Vector RAG: that is a
 * retrieval setting, frozen with the comparison. Downloading is not.
 */
function mb(bytes: number) {
  return bytes >= 1_000_000_000 ? `${(bytes / 1_000_000_000).toFixed(1)} GB` : `${Math.round(bytes / 1_000_000)} MB`
}

function seconds(ms: number) {
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`
}

const VERDICT: Record<RerankVerdict, { icon: typeof CircleCheck; tone: string; label: string }> = {
  safe: { icon: CircleCheck, tone: 'status-ok', label: 'safe' },
  marginal: { icon: CircleAlert, tone: 'status-warn', label: 'marginal' },
  will_not_fit: { icon: CircleSlash, tone: 'status-bad', label: 'will not fit' },
}

export function RerankersPane() {
  const [config, setConfig] = useState<RagConfig | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [benching, setBenching] = useState<string | null>(null)

  const load = useCallback(
    () => fetchRagConfig().then(setConfig).catch((e: Error) => setError(e.message)),
    [],
  )

  useEffect(() => {
    void load()
  }, [load])

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
    return error ? <p className="text-xs text-rose-400">{error}</p> : <Skeleton className="h-40 w-full" />
  }

  const fit = config.rerank_fit
  const free = fit.machine.available_bytes
  // Recommended first, then strongest; the list reads as an answer, not a catalogue.
  const rows = [...config.rerankers].sort(
    (a, b) => b.recommended_for.length - a.recommended_for.length || b.quality - a.quality,
  )

  return (
    <div className="space-y-3">
      <PaneIntro>
        Cross-encoders that re-score Track 1's nearest chunks and keep the ones that actually answer
        the question — judged against this machine. Download one here; choose which Track 1 uses in
        Settings → Vector RAG.
      </PaneIntro>

      <div className="rounded-xl border theme-border p-3 text-[11px] leading-relaxed theme-text-muted">
        Judged for <span className="theme-text">{fit.machine.cpu ?? 'this CPU'}</span>
        {' '}({fit.machine.threads} threads){free != null && <> with <span className="theme-text">{mb(free)}</span> free</>}:
        re-scoring {fit.candidates} chunks should take under{' '}
        <span className="theme-text">{seconds(fit.budget_ms)}</span>, re-ranking's share of a 3-second answer.
        Times are estimates until you press <span className="theme-text">Benchmark</span> on a downloaded model.
      </div>

      {!config.rerank_runtime.available && (
        <div className="flex items-start gap-2 rounded-xl border status-warn-border status-warn-bg p-3 text-xs">
          <AlertTriangle size={14} className="status-warn mt-0.5 shrink-0" />
          <span className="theme-text">{config.rerank_runtime.detail}</span>
        </div>
      )}

      <div className="space-y-2">
        {rows.map((m) => (
          <RerankerRow
            key={m.id}
            model={m}
            inUse={config.rerank.enabled && config.rerank.model === m.id}
            benching={benching === m.id}
            onDownload={() => void act(() => downloadReranker(m.id))}
            onBenchmark={() => void bench(m)}
            onDelete={() => {
              if (!window.confirm(`Delete ${m.label}'s weights from this machine?`)) return
              void act(() => deleteReranker(m.id))
            }}
          />
        ))}
      </div>

      {error && <p className="text-xs text-rose-400">{error}</p>}

      <p className="text-[11px] leading-relaxed theme-text-muted">
        Weights are pinned to a Hugging Face commit and stored under{' '}
        <code className="theme-text">data/models/rerankers</code>; after the download nothing uses the
        network. A benchmark is kept with the weights and replaces the estimate in the verdict.
      </p>
    </div>
  )
}

function RerankerRow({
  model, inUse, benching, onDownload, onBenchmark, onDelete,
}: {
  model: RerankerModel
  inUse: boolean
  benching: boolean
  onDownload: () => void
  onBenchmark: () => void
  onDelete: () => void
}) {
  const job = model.download
  const pct = job && job.total ? Math.min(100, Math.round((job.bytes / job.total) * 100)) : 0
  const verdict = VERDICT[model.fit.verdict]
  const recommended = model.recommended_for
  return (
    <div className={`rounded-xl border p-3 ${recommended.length ? 'theme-accent-border theme-surface-strong' : 'theme-border'}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="truncate text-sm theme-text">{model.label}</span>
        <span className="shrink-0 rounded border theme-border px-1.5 py-0.5 text-[10px] theme-text-muted">
          {model.languages}
        </span>
        <span
          className={`flex shrink-0 items-center gap-1 text-[10px] ${verdict.tone}`}
          title={model.fit.reasons.join(' · ') || 'Fits this machine'}
        >
          <verdict.icon size={11} /> {verdict.label}
        </span>
        {recommended.map((r) => (
          <span
            key={r}
            className="flex shrink-0 items-center gap-1 rounded border theme-accent-border px-1.5 py-0.5 text-[10px] theme-accent"
            title={`The strongest re-ranker this machine can run for ${r === 'english' ? 'English' : 'Malay'} questions`}
          >
            <Sparkles size={10} /> Recommended{r === 'malay' ? ' for Malay' : ''}
          </span>
        ))}
        {inUse && (
          <span className="shrink-0 rounded border theme-border px-1.5 py-0.5 text-[10px] theme-text">
            {model.installed ? 'used by Track 1' : 'selected — needs download'}
          </span>
        )}
        <span className="ml-auto" />
        {job?.status === 'downloading' ? (
          <span className="flex shrink-0 items-center gap-1 text-[11px] theme-text-muted">
            <Loader2 size={12} className="animate-spin" /> {pct}%
          </span>
        ) : model.installed ? (
          <>
            <button
              onClick={onBenchmark}
              disabled={benching}
              className="flex shrink-0 items-center gap-1 rounded-lg border theme-border px-2 py-1 text-[11px] theme-text hover:theme-surface disabled:opacity-50"
              title="Time re-scoring a question's candidates on this machine"
            >
              {benching ? <Loader2 size={12} className="animate-spin" /> : <Gauge size={12} />} Benchmark
            </button>
            <button
              onClick={onDelete}
              className="shrink-0 rounded p-1 theme-text-muted hover:text-rose-400"
              title="Delete the downloaded weights"
              aria-label={`Delete ${model.label}`}
            >
              <Trash2 size={13} />
            </button>
          </>
        ) : (
          <button
            onClick={onDownload}
            className="flex shrink-0 items-center gap-1 rounded-lg border theme-border px-2 py-1 text-[11px] theme-text hover:theme-surface"
          >
            <Download size={12} /> {mb(model.size_bytes)}
          </button>
        )}
      </div>

      <p className="mt-1.5 text-[11px] leading-relaxed theme-text-muted">{model.note}</p>

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] theme-text-muted">
        <span>
          <span className="theme-text">{model.fit.latency_source === 'measured' ? '' : '~'}{seconds(model.fit.latency_ms)}</span>
          {' '}per question · {model.fit.latency_source === 'measured' ? 'measured here' : 'estimated'}
        </span>
        <span><span className="theme-text">{mb(model.fit.memory_bytes)}</span> memory</span>
        <span>{model.licence}</span>
      </div>
      {model.fit.reasons.length > 0 && (
        <p className={`mt-1 text-[10px] leading-relaxed ${verdict.tone}`}>{model.fit.reasons.join(' · ')}</p>
      )}
      <p className="mt-1 text-[10px] theme-text-muted">
        <code className="theme-text">{model.repo}</code> @ {model.revision.slice(0, 7)}
        {model.installed ? ' · downloaded' : ' · not downloaded'}
        {job?.status === 'error' && <span className="text-rose-400"> · download failed: {job.error}</span>}
      </p>
    </div>
  )
}
