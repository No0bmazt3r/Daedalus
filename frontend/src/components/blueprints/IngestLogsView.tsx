import { useCallback, useEffect, useState } from 'react'
import { ScrollText, FileText, ChevronRight, Search } from 'lucide-react'
import { TabError } from '../errors/TabError'
import { toFailure, type LoadFailure } from '../errors/ErrorPage'
import { useLiveRefresh } from '../../hooks/useLiveRefresh'
import {
  fetchRuns, fetchDocumentLogs, fetchDocumentEvents,
  type IngestRun, type DocumentLog, type DocumentEvent,
} from '../../lib/blueprintsClient'
import { Skeleton } from '../ui/skeleton'
import { RunPanel } from './ingest/RunStep'
import { LEVEL_STYLE, STATUS_BADGE, runTime } from './ingest/shared'

/**
 * Every ingest run and its log, newest first — Track 1's Logs tab.
 *
 * Its own tab so Build stays about doing the next run, and "why did that one
 * fail" has one place to look. Two ways in: **by run** (what one ingest did)
 * and **by document** (everything that ever happened to one file, across runs).
 */
export function IngestLogsView() {
  const [runs, setRuns] = useState<IngestRun[] | null>(null)
  const [error, setError] = useState<LoadFailure | null>(null)
  const [failedOnly, setFailedOnly] = useState(false)
  const [view, setView] = useState<'run' | 'document'>('run')

  const load = useCallback(() => {
    fetchRuns(50)
      .then((r) => { setRuns(r.runs); setError(null) })
      .catch((e: unknown) => setError(toFailure(e)))
  }, [])
  useEffect(load, [load])
  useLiveRefresh(['corpus'], load)

  if (error) {
    return (
      <TabError
        code={error.status}
        detail={error.message}
        what="The ingest runs could not be read from the backend."
        onRetry={load}
      />
    )
  }
  if (runs && runs.length === 0) {
    return (
      <div className="rounded-lg border border-dashed theme-border px-4 py-10 text-center">
        <ScrollText size={20} className="mx-auto theme-text-muted" />
        <p className="mt-2 text-xs theme-text">No ingest has run yet.</p>
        <p className="mt-1 text-[11px] theme-text-muted">Each run from Build is logged here, step by step.</p>
      </div>
    )
  }

  const failed = runs?.filter((r) => r.status === 'failed').length ?? 0
  const shown = !runs ? [] : failedOnly ? runs.filter((r) => r.status === 'failed') : runs

  return (
    <div className="space-y-2">
      <div role="group" aria-label="Group logs by" className="flex w-fit gap-1 rounded-lg border theme-border p-0.5">
        {(['run', 'document'] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            aria-pressed={view === v}
            className={`rounded-md px-2.5 py-1 text-[11px] transition-colors ${
              view === v ? 'theme-surface-strong theme-text' : 'theme-text-muted hover:theme-text'
            }`}
          >
            By {v}
          </button>
        ))}
      </div>
      {view === 'document' ? <ByDocument /> : (
      <>
      <div className="flex items-center gap-2">
        <h3 className="text-sm theme-text">Ingest runs</h3>
        {runs && (
          <span className="text-[11px] theme-text-muted">
            {runs.length} run{runs.length === 1 ? '' : 's'}{failed ? ` · ${failed} failed` : ''}
          </span>
        )}
        <button
          onClick={() => setFailedOnly((v) => !v)}
          aria-pressed={failedOnly}
          className={`ml-auto rounded-md border px-2 py-0.5 text-[11px] transition-colors ${
            failedOnly ? 'border-rose-400/40 text-rose-400' : 'theme-border theme-text-muted hover:theme-text'
          }`}
        >
          Failed only
        </button>
      </div>
      {!runs ? (
        <Skeleton className="h-48 w-full" />
      ) : shown.length === 0 ? (
        <p className="py-4 text-center text-[11px] theme-text-muted">No failed runs.</p>
      ) : (
        shown.map((r, i) => (
          <RunPanel key={r.run_id} run={r} onRefresh={load} defaultOpen={i === 0} />
        ))
      )}
      </>
      )}
    </div>
  )
}

/** Every document with ingest history, each opening onto its own log. */
function ByDocument() {
  const [docs, setDocs] = useState<DocumentLog[] | null>(null)
  const [error, setError] = useState<LoadFailure | null>(null)
  const [query, setQuery] = useState('')
  const load = useCallback(() => {
    fetchDocumentLogs()
      .then((r) => { setDocs(r.documents); setError(null) })
      .catch((e: unknown) => setError(toFailure(e)))
  }, [])
  useEffect(load, [load])
  useLiveRefresh(['corpus'], load)

  if (error) {
    return <TabError code={error.status} detail={error.message} what="The document logs could not be read." onRetry={load} />
  }
  const needle = query.trim().toLowerCase()
  const shown = !docs ? [] : needle ? docs.filter((d) => d.filename.toLowerCase().includes(needle)) : docs

  return (
    <div className="space-y-2">
      <label className="flex items-center gap-1.5 rounded-md border theme-border theme-surface px-2 py-1">
        <Search size={11} className="shrink-0 theme-text-muted" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Find a document's log"
          placeholder="Find a document…"
          className="min-w-0 flex-1 bg-transparent text-[11px] theme-text outline-none placeholder:opacity-50"
        />
        {docs && <span className="shrink-0 text-[10px] tabular-nums theme-text-muted">{shown.length}/{docs.length}</span>}
      </label>
      {!docs ? (
        <Skeleton className="h-40 w-full" />
      ) : shown.length === 0 ? (
        <p className="py-4 text-center text-[11px] theme-text-muted">
          {docs.length === 0 ? 'No document has been ingested yet.' : 'No document matches.'}
        </p>
      ) : (
        shown.map((d) => <DocumentLogRow key={d.document_id} doc={d} />)
      )}
    </div>
  )
}

function DocumentLogRow({ doc }: { doc: DocumentLog }) {
  const [open, setOpen] = useState(false)
  const [events, setEvents] = useState<DocumentEvent[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const when = runTime(doc.last_at)
  const badge = doc.last_status ? STATUS_BADGE[doc.last_status] : null

  useEffect(() => {
    if (!open) return
    fetchDocumentEvents(doc.document_id)
      .then((r) => setEvents(r.events))
      .catch((e: Error) => setError(e.message))
  }, [open, doc.document_id, doc.last_at])

  // The events arrive newest run first; grouped so each run is a heading.
  const runs: { id: string; status: IngestRun['status']; started: string; kind: string; lines: DocumentEvent[] }[] = []
  for (const e of events ?? []) {
    const last = runs[runs.length - 1]
    if (last?.id === e.run_id) last.lines.push(e)
    else runs.push({ id: e.run_id, status: e.run_status, started: e.run_started_at, kind: e.run_kind, lines: [e] })
  }

  return (
    <div className="rounded-lg border theme-border theme-card">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors hover:theme-surface-strong"
      >
        <ChevronRight size={12} className={`shrink-0 theme-text-muted transition-transform ${open ? 'rotate-90' : ''}`} />
        <FileText size={12} className="shrink-0 theme-accent" />
        <span className="min-w-0 flex-1 truncate text-[11px] theme-text" title={doc.filename}>{doc.filename}</span>
        {badge && doc.last_status && (
          <span className={`flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] ${badge.cls}`} title="How its latest run ended">
            <badge.icon size={10} /> {doc.last_status}
          </span>
        )}
        <span className="shrink-0 text-[10px] theme-text-muted">
          {doc.runs} run{doc.runs === 1 ? '' : 's'}
          {doc.errors > 0 && <span className="text-rose-400"> · {doc.errors} error{doc.errors === 1 ? '' : 's'}</span>}
        </span>
        <span className="shrink-0 text-[10px] tabular-nums theme-text-muted" title={`Last activity ${when.full}`}>{when.short}</span>
      </button>
      {open && (
        <div className="space-y-2 border-t theme-border px-3 py-2">
          {error && <p className="text-[11px] text-rose-400">{error}</p>}
          {!events && !error && <Skeleton className="h-16 w-full" />}
          {runs.map((r) => {
            const t = runTime(r.started)
            const b = STATUS_BADGE[r.status] ?? STATUS_BADGE.cancelled
            return (
              <div key={r.id}>
                <p className="mb-1 flex items-center gap-1.5 text-[10px] theme-text-muted">
                  <span className={`flex items-center gap-1 rounded-full border px-1.5 py-px ${b.cls}`}>
                    <b.icon size={9} /> {r.status}
                  </span>
                  <span title={`Started ${t.full}`}>{r.kind} · {t.short}</span>
                </p>
                <div className="space-y-0.5 font-mono text-[11px] leading-relaxed">
                  {r.lines.map((e) => (
                    <div key={e.id} className="flex gap-2">
                      <span className={`w-9 shrink-0 ${LEVEL_STYLE[e.level]}`}>{e.level}</span>
                      <span className="w-14 shrink-0 theme-text-muted opacity-60">{e.stage}</span>
                      <span className={`min-w-0 flex-1 break-words ${LEVEL_STYLE[e.level]}`}>{e.message}</span>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
