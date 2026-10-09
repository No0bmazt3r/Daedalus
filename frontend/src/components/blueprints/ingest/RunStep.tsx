import { useEffect, useState } from 'react'
import { Play, RotateCcw, AlertCircle, AlertTriangle, Loader2, Eraser, ChevronRight, CheckCircle2, XCircle, MinusCircle } from 'lucide-react'
import {
  startIngest, resumeIngest, clearVectors, fetchRunEvents, type CorpusStatus, type CorpusDocument, type CorpusConfig, type IngestRun, type IngestEvent,
} from '../../../lib/blueprintsClient'
import { LEVEL_STYLE, bytes, runTime } from './shared'
import { useConfirm } from '../../ui/confirm-dialog'

// Icon + word + colour, so a run's outcome never rests on colour alone.
const STATUS_BADGE: Record<IngestRun['status'], { icon: typeof Loader2; cls: string }> = {
  running: { icon: Loader2, cls: 'border-amber-400/40 bg-amber-400/10 text-amber-400' },
  ok: { icon: CheckCircle2, cls: 'border-emerald-400/40 bg-emerald-400/10 text-emerald-400' },
  failed: { icon: XCircle, cls: 'border-rose-400/40 bg-rose-400/10 text-rose-400' },
  cancelled: { icon: MinusCircle, cls: 'theme-border theme-text-muted' },
}

export function RunPanel({ run, onRefresh, defaultOpen = true }: { run: IngestRun; onRefresh: () => void; defaultOpen?: boolean }) {
  const [events, setEvents] = useState<IngestEvent[]>([])
  const [level, setLevel] = useState<string>('')
  const [open, setOpen] = useState(defaultOpen)
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

  const badge = STATUS_BADGE[run.status] ?? STATUS_BADGE.cancelled
  const when = runTime(run.started_at)
  const docs = run.documents ?? []
  const docLabel = docs.length === 0 ? null : docs.length === 1 ? docs[0] : `${docs[0]} +${docs.length - 1} more`
  const StatusIcon = badge.icon

  return (
    <div className="rounded-lg border theme-border theme-card">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:theme-surface-strong"
      >
        <ChevronRight size={12} className={`shrink-0 theme-text-muted transition-transform ${open ? 'rotate-90' : ''}`} />
        <span className={`flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] ${badge.cls}`}>
          <StatusIcon size={10} className={live ? 'animate-spin' : ''} /> {run.status}
        </span>
        <span className="min-w-0 flex-1 truncate text-[11px] theme-text-muted" title={docs.join('\n') || undefined}>
          {docLabel && <span className="theme-text">{docLabel} · </span>}
          {run.kind} · {run.documents_done}/{run.documents_total} docs · {run.chunks_written} chunks ·{' '}
          {run.vectors_written} vectors
          {!open && run.error && <span className="text-rose-400"> · {run.error}</span>}
        </span>
        <span className="shrink-0 text-[10px] tabular-nums theme-text-muted" title={`Started ${when.full}`}>
          {when.short}
          {' · '}
          {run.elapsed_ms != null ? `${(run.elapsed_ms / 1000).toFixed(1)}s` : run.stage}
        </span>
      </button>

      {open && (
        <div className="border-t theme-border px-3 py-2">
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-[10px]">
            <span className="theme-text-muted">
              {run.strategy} · {run.chunk_size}/{run.chunk_overlap} · {run.embedding_model ?? 'no model'}
            </span>
            <span role="group" aria-label="Filter by level" className="ml-auto flex gap-1">
              {['', 'error', 'warn', 'info', 'debug'].map((l) => (
                <button
                  key={l || 'all'}
                  onClick={() => setLevel(l)}
                  aria-pressed={level === l}
                  className={`rounded px-1.5 py-0.5 transition-colors ${
                    level === l ? 'theme-surface-strong theme-text' : 'theme-text-muted hover:theme-text'
                  }`}
                >
                  {l || 'all'}
                </button>
              ))}
            </span>
          </div>
          {docs.length > 1 && (
            <p className="mb-1.5 text-[11px] theme-text-muted">
              Documents: <span className="theme-text">{docs.join(', ')}</span>
            </p>
          )}
          {run.error && (
            <p className="mb-1.5 flex items-center gap-1.5 rounded-md border border-rose-400/30 bg-rose-400/10 px-2 py-1 text-[11px] text-rose-400">
              <AlertCircle size={11} className="shrink-0" /> {run.error}
            </p>
          )}
          <div className="max-h-60 space-y-0.5 overflow-y-auto font-mono text-[11px] leading-relaxed">
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
  status, config, documents, activeRun, busy, error, onAct, onRefresh, onShowLogs,
}: {
  onShowLogs?: () => void
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
  const earlier = status.runs.filter((r) => r.run_id !== activeRun?.run_id)
  const [confirm, confirmDialog] = useConfirm()

  const clear = async () => {
    const ok = await confirm({
      title: 'Clear all vectors?',
      body: `This deletes ${corpus.embedded} vectors from ${embedding.collection ?? 'the index'}. Chunks are kept, so Resume can embed them again. Track 1 can't answer until you do.`,
      confirmLabel: 'Clear vectors',
      danger: true,
    })
    if (ok) onAct('clear', () => clearVectors())
  }

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
          ['Unreadable', corpus.failed_documents, 'documents'],
        ] as const).map(([label, value, hint]) => (
          <div key={label} className="rounded-lg border theme-border theme-card px-3 py-2">
            <div className={`text-lg tabular-nums ${label === 'Unreadable' && value > 0 ? 'text-rose-400' : 'theme-text'}`}>{value}</div>
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
          onClick={clear}
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

      {/* Run history lives in the Logs tab. Here: just the last run's outcome. */}
      {!activeRun && earlier[0] && (
        <RunPanel run={earlier[0]} onRefresh={onRefresh} defaultOpen={earlier[0].status === 'failed'} />
      )}
      {earlier.length > 0 && onShowLogs && (
        <button onClick={onShowLogs} className="text-[11px] theme-accent hover:underline">
          See every run in Logs
        </button>
      )}
      {confirmDialog}
    </div>
  )
}

// ── the stepper ──────────────────────────────────────────────────────────────
