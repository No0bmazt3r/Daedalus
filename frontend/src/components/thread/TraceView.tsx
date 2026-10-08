import { useEffect, useState } from 'react'
import { ArrowUpRight, Download, MessageSquare } from 'lucide-react'
import { traceMarkdown } from '../../lib/threadLogic'
import {
  fetchGroundedness, fetchTrace, fetchTraceRetrieval, type Groundedness, type RetrievalDetail, type Trace, type TraceSummary,
} from '../../lib/threadClient'
import { Skeleton } from '../ui/skeleton'
import { statusOf } from '../errors/ErrorPage'
import { TabError } from '../errors/TabError'
import { STATUS, chatLabel, formatMs } from './status'
import { useSessions } from '../../contexts/SessionsContext'
import { StatusIcon } from './StatusIcon'
import { RetrievalPanel } from './RetrievalPanel'
import { StepRow } from './TraceSteps'
import { GroundednessPanel } from './GroundednessPanel'
import { LabelPanel } from './LabelPanel'

/**
 * One answer's thread: the chain that produced it, then the answer with every
 * number marked. MODULES.md §1.3–1.4.
 *
 * ## The bars are shares of the turn, not a timeline
 *
 * Steps are logged with how long they took, not when they started (timestamps
 * are to the second), so a true waterfall cannot be drawn without inventing
 * offsets. A bar per step sized to its share of the whole turn answers the
 * question the waterfall exists for — "the model was 78% of this" — from what
 * was actually recorded.
 *
 * ## The marks are the validator's
 *
 * Green, red and amber are what the validator decided when the answer was
 * written (`services/thread/` explains why it is not re-decided here). This
 * view adds the source line for each green number, so a reader can check it.
 */

/** Which chat the question was asked in, with a way back to it while it exists. */
function ChatLine({ chat }: { chat: TraceSummary['chat'] }) {
  const { selectSession } = useSessions()
  const { title, note } = chatLabel(chat)
  return (
    <div className="flex items-center gap-1.5 text-[11px] theme-text-muted">
      <MessageSquare size={12} className="shrink-0 theme-accent" />
      <span className="shrink-0">From</span>
      <span className="min-w-0 truncate font-medium theme-text">{title}</span>
      {note && <span className="shrink-0 opacity-70">· {note}</span>}
      {chat?.exists && (
        <button
          onClick={() => selectSession(chat.session_id)}
          className="ml-auto flex shrink-0 items-center gap-0.5 rounded px-1.5 py-0.5 hover:theme-text hover:theme-surface"
          title="Show this chat behind the window"
        >
          Open chat <ArrowUpRight size={11} />
        </button>
      )}
    </div>
  )
}

/** Save `text` as a file named `name` — the export buttons. */
function download(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  a.click()
  URL.revokeObjectURL(url)
}

export function TraceView({ queryId, compact = false, onDismiss }: {
  queryId: string
  /** Under a chat answer: the question and status are already on screen. */
  compact?: boolean
  /** Close whatever shows this trace — offered on the error page. */
  onDismiss?: () => void
}) {
  // Tagged with the id it belongs to, so a slow response for the previous
  // selection can never render against the current one.
  const [state, setState] = useState<{
    queryId: string; trace: Trace | null; check: Groundedness | null; retrievals: RetrievalDetail[]
    error: { message: string; status: number } | null
  } | null>(null)
  // Bumped by Retry, to fetch the same id again.
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let live = true
    void Promise.all([fetchTrace(queryId), fetchGroundedness(queryId), fetchTraceRetrieval(queryId)])
      .then(([trace, check, r]) => { if (live) setState({ queryId, trace, check, retrievals: r.retrievals, error: null }) })
      .catch((e: Error) => {
        if (live) setState({ queryId, trace: null, check: null, retrievals: [], error: { message: e.message, status: statusOf(e) ?? 500 } })
      })
    return () => { live = false }
  }, [queryId, attempt])

  const shown = state?.queryId === queryId ? state : null
  // A trace that cannot be read turns its pane into the error page.
  if (shown?.error) {
    const { status, message } = shown.error
    return (
      <TabError
        code={status}
        detail={message}
        // A 404 here is not a missing page: the audit log has no record of this answer.
        what={status === 404 ? 'The audit log has no record of this answer.' : 'This trace could not be read from the audit log.'}
        fix={status === 404 ? 'It may come from another database, or from before logging began.' : undefined}
        onRetry={() => { setState(null); setAttempt((n) => n + 1) }}
        onClose={onDismiss}
        closeLabel="Close this trace"
      />
    )
  }
  if (!shown?.trace || !shown.check) return <Skeleton className="h-72 w-full" />
  const { trace, check } = shown
  const s = trace.summary

  return (
    <div className="space-y-3">
      {s && !compact && (
        <section className="rounded-lg border theme-border theme-card p-3">
          <ChatLine chat={s.chat} />
          <p className="mt-1.5 text-[13px] theme-text">{s.question || '(no question text)'}</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] theme-text-muted">
            <span className={`flex items-center gap-1 font-medium ${STATUS[s.status].tone}`}>
              <StatusIcon status={s.status} />
              {STATUS[s.status].label}
            </span>
            <span className="tabular-nums">{formatMs(s.latency_ms)}</span>
            {s.model && <code>{s.model}</code>}
            {s.intent && <span>{s.intent}</span>}
            <code className="select-all">{trace.query_id}</code>
            {/* For a report appendix, or an examiner: the thread as it is on screen. */}
            <span className="ml-auto flex items-center gap-1">
              <button
                onClick={() => download(`${trace.query_id}.md`, traceMarkdown(trace, check, shown.retrievals), 'text/markdown')}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:theme-text hover:theme-surface"
                title="Download this thread as Markdown"
              >
                <Download size={11} /> Markdown
              </button>
              <button
                onClick={() => download(`${trace.query_id}.json`, JSON.stringify({ trace, groundedness: check, retrieval: shown.retrievals }, null, 2), 'application/json')}
                className="flex items-center gap-1 rounded px-1.5 py-0.5 hover:theme-text hover:theme-surface"
                title="Download this thread as JSON"
              >
                <Download size={11} /> JSON
              </button>
            </span>
          </div>
        </section>
      )}

      <ol className="space-y-1">
        {trace.steps.map((step, i) => (
          <StepRow key={`${step.kind}-${i}`} step={step} totalMs={trace.total_ms} />
        ))}
      </ol>

      <RetrievalPanel retrievals={shown.retrievals} />
      <GroundednessPanel check={check} />
      {s && <LabelPanel key={trace.query_id} queryId={trace.query_id} initial={s.label} />}
    </div>
  )
}
