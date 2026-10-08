import { useEffect, useState } from 'react'
import { Play, RotateCcw, AlertCircle, AlertTriangle, Loader2, Eraser, ChevronRight } from 'lucide-react'
import {
  startIngest, resumeIngest, clearVectors, fetchRunEvents, type CorpusStatus, type CorpusDocument, type CorpusConfig, type IngestRun, type IngestEvent,
} from '../../../lib/blueprintsClient'
import { LEVEL_STYLE, bytes } from './shared'

export function RunPanel({ run, onRefresh }: { run: IngestRun; onRefresh: () => void }) {
  const [events, setEvents] = useState<IngestEvent[]>([])
  const [level, setLevel] = useState<string>('')
  const [open, setOpen] = useState(true)
  const live = run.status === 'running'

  useEffect(() => {
    let cancelled = false
    const load = () => {
      fetchRunEvents(run.run_id, level || undefined)
        .then((r) => !cancelled && setEvents(r.events))
        .catch(() => !cancelled && setEvents([]))
    }
    load()
    if (!live) return () => { cancelled = true }
    const timer = window.setInterval(() => { load(); onRefresh() }, 1500)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [run.run_id, run.status, level, live, onRefresh])

  const tone =
    run.status === 'ok' ? 'theme-accent'
    : run.status === 'failed' ? 'text-rose-400'
    : 'text-amber-400'

  return (
    <div className="rounded-lg border theme-border theme-card">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-3 py-2 text-left">
        <ChevronRight size={12} className={`shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
        {live && <Loader2 size={12} className="shrink-0 animate-spin text-amber-400" />}
        <span className="min-w-0 flex-1 truncate text-[11px] theme-text">
          <span className={tone}>{run.status}</span>
          <span className="theme-text-muted">
            {' · '}{run.kind} · {run.documents_done}/{run.documents_total} docs ·{' '}
            {run.chunks_written} chunks · {run.vectors_written} vectors
          </span>
        </span>
        <span className="shrink-0 text-[10px] theme-text-muted">
          {run.elapsed_ms != null ? `${(run.elapsed_ms / 1000).toFixed(1)}s` : run.stage}
        </span>
      </button>

      {open && (
        <div className="border-t theme-border px-3 py-2">
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-[10px]">
            <span className="theme-text-muted">
              {run.strategy} · {run.chunk_size}/{run.chunk_overlap} · {run.embedding_model ?? 'no model'}
            </span>
            <span className="ml-auto flex gap-1">
              {['', 'error', 'warn', 'info', 'debug'].map((l) => (
                <button
                  key={l || 'all'}
                  onClick={() => setLevel(l)}
                  className={`rounded px-1.5 py-0.5 transition-colors ${
                    level === l ? 'theme-surface-strong theme-text' : 'theme-text-muted hover:theme-text'
                  }`}
                >
                  {l || 'all'}
                </button>
              ))}
            </span>
          </div>
          {run.error && <p className="mb-1.5 text-[10px] leading-relaxed text-rose-400">{run.error}</p>}
          <div className="max-h-60 space-y-0.5 overflow-y-auto no-scrollbar font-mono text-[10px]">
            {events.length === 0 ? (
              <p className="py-2 theme-text-muted">No events at this level.</p>
            ) : (
              events.map((e) => (
                <div key={e.id} className="flex gap-2">
                  <span className={`w-9 shrink-0 ${LEVEL_STYLE[e.level]}`}>{e.level}</span>
                  <span className="w-14 shrink-0 theme-text-muted opacity-60">{e.stage}</span>
                  <span className={`min-w-0 flex-1 ${LEVEL_STYLE[e.level]}`}>{e.message}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export function RunStep({
  status, config, documents, activeRun, busy, error, onAct, onRefresh,
}: {
  status: CorpusStatus
  config: CorpusConfig
  documents: CorpusDocument[]
  activeRun: IngestRun | null
  busy: string | null
  error: string | null
  onAct: (label: string, fn: () => Promise<unknown>) => void
  onRefresh: () => void
}) {
  const { corpus, embedding } = status
  const pending = corpus.chunks - corpus.embedded
  const readable = documents.filter((d) => d.extract_status === 'ok').length

  return (
    <div className="space-y-3">
      {/* The recipe, restated before it runs. Everything on this line is copied
          onto the run row, so a result stays traceable to the settings that
          produced it even after the defaults change. */}
      <div className="rounded-lg border theme-border theme-card p-3">
        <h4 className="text-xs theme-text">What will run</h4>
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] @xl:grid-cols-4">
          {([
            ['Documents', `${readable} readable`],
            ['Chunking', `${config.strategy} ${config.chunk_size}/${config.chunk_overlap}`],
            ['Embedding', embedding.model ?? 'none selected'],
            ['Index', embedding.collection ?? '-'],
          ] as const).map(([k, v]) => (
            <div key={k}>
              <dt className="text-[10px] uppercase tracking-wider theme-text-muted">{k}</dt>
              <dd className="truncate theme-text">{v}</dd>
            </div>
          ))}
        </dl>
      </div>

      {!embedding.ollama_available && (
        <p className="flex items-start gap-1.5 rounded-lg border border-amber-400/40 bg-amber-400/10 p-2.5 text-[11px] theme-text">
          <AlertTriangle size={12} className="mt-0.5 shrink-0 text-amber-400" />
          Can't reach Ollama. The run will chunk and save, then fail at every embed step. You can
          fix that later with Resume, but it's easier to pull the model first.
        </p>
      )}

      <div className="grid grid-cols-2 gap-2 @2xl:grid-cols-4">
        {([
          ['Documents', corpus.documents, bytes(corpus.bytes)],
          ['Chunks', corpus.chunks, ''],
          ['Vectors', corpus.embedded, pending > 0 ? `${pending} pending` : ''],
          ['Failed', corpus.failed_documents, 'unreadable'],
        ] as const).map(([label, value, hint]) => (
          <div key={label} className="rounded-lg border theme-border theme-card px-3 py-2">
            <div className="text-lg tabular-nums theme-text">{value}</div>
            <div className="text-[10px] uppercase tracking-wider theme-text-muted">{label}</div>
            {hint && <div className="mt-0.5 text-[10px] theme-text-muted opacity-70">{hint}</div>}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={() => onAct('ingest', () => startIngest())}
          disabled={!!busy || readable === 0}
          className="flex items-center gap-1.5 rounded-md border theme-accent-border px-2.5 py-1 text-[11px] theme-accent transition-colors hover:theme-surface-strong disabled:opacity-40"
        >
          <Play size={11} /> {busy === 'ingest' ? 'Starting…' : corpus.chunks ? 'Re-ingest all' : 'Ingest'}
        </button>
        <button
          onClick={() => onAct('resume', () => resumeIngest())}
          disabled={!!busy || pending === 0}
          title="Embed the chunks that have no vector, without re-chunking"
          className="flex items-center gap-1.5 rounded-md border theme-border px-2.5 py-1 text-[11px] theme-text-muted transition-colors hover:theme-text disabled:opacity-40"
        >
          <RotateCcw size={11} /> {busy === 'resume' ? 'Embedding…' : `Resume (${pending})`}
        </button>
        <button
          onClick={() => onAct('clear', () => clearVectors())}
          disabled={!!busy || corpus.embedded === 0}
          title="Delete all vectors but keep the chunks. Do this when you change the embedding model"
          className="flex items-center gap-1.5 rounded-md border theme-border px-2.5 py-1 text-[11px] theme-text-muted transition-colors hover:text-rose-400 disabled:opacity-40"
        >
          <Eraser size={11} /> Clear vectors
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-400/40 bg-rose-400/10 p-2.5 text-[11px] theme-text">
          <AlertCircle size={13} className="mt-0.5 shrink-0 text-rose-400" /> {error}
        </div>
      )}

      {activeRun && <RunPanel run={activeRun} onRefresh={onRefresh} />}

      {status.runs.filter((r) => r.run_id !== activeRun?.run_id).length > 0 && (
        <div className="space-y-1.5">
          <h4 className="text-xs theme-text">Earlier runs</h4>
          {status.runs
            .filter((r) => r.run_id !== activeRun?.run_id)
            .slice(0, 5)
            .map((r) => <RunPanel key={r.run_id} run={r} onRefresh={onRefresh} />)}
        </div>
      )}
    </div>
  )
}

// ── the stepper ──────────────────────────────────────────────────────────────
