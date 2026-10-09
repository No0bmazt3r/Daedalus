import { useCallback, useEffect, useState } from 'react'
import { ScrollText } from 'lucide-react'
import { TabError } from '../errors/TabError'
import { toFailure, type LoadFailure } from '../errors/ErrorPage'
import { useLiveRefresh } from '../../hooks/useLiveRefresh'
import { fetchRuns, type IngestRun } from '../../lib/blueprintsClient'
import { Skeleton } from '../ui/skeleton'
import { RunPanel } from './ingest/RunStep'

/**
 * Every ingest run and its log, newest first — Track 1's Logs tab.
 *
 * Its own tab so Build stays about doing the next run, and "why did that one
 * fail" has one place to look. The newest run opens by default; the rest stay
 * collapsed, their headers already saying how each ended.
 */
export function IngestLogsView() {
  const [runs, setRuns] = useState<IngestRun[] | null>(null)
  const [error, setError] = useState<LoadFailure | null>(null)
  const [failedOnly, setFailedOnly] = useState(false)

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
  if (!runs) return <Skeleton className="h-64 w-full" />

  if (runs.length === 0) {
    return (
      <div className="rounded-lg border border-dashed theme-border px-4 py-10 text-center">
        <ScrollText size={20} className="mx-auto theme-text-muted" />
        <p className="mt-2 text-xs theme-text">No ingest has run yet.</p>
        <p className="mt-1 text-[11px] theme-text-muted">Each run from Build is logged here, step by step.</p>
      </div>
    )
  }

  const failed = runs.filter((r) => r.status === 'failed').length
  const shown = failedOnly ? runs.filter((r) => r.status === 'failed') : runs

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <h3 className="text-sm theme-text">Ingest runs</h3>
        <span className="text-[11px] theme-text-muted">
          {runs.length} run{runs.length === 1 ? '' : 's'}{failed ? ` · ${failed} failed` : ''}
        </span>
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
      {shown.length === 0 ? (
        <p className="py-4 text-center text-[11px] theme-text-muted">No failed runs.</p>
      ) : (
        shown.map((r, i) => (
          <RunPanel key={r.run_id} run={r} onRefresh={load} defaultOpen={i === 0} />
        ))
      )}
    </div>
  )
}
