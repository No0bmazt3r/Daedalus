import { useEffect, useState, type ReactNode } from 'react'
import { AlertTriangle, ArrowUpRight, ChevronRight, MessageSquare } from 'lucide-react'
import {
  fetchGroundedness, fetchTrace,
  type Groundedness, type NumberMark, type Trace, type TraceStep, type TraceSummary,
} from '../../lib/threadClient'
import { Skeleton } from '../ui/skeleton'
import { Collapse } from '../ui/collapse'
import { withEvidenceHighlights } from '../Citations'
import { STATUS, VERDICT, chatLabel, formatMs } from './status'
import { useSessions } from '../../contexts/SessionsContext'
import { StatusIcon } from './StatusIcon'

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
 * written (`services/thread.py` explains why it is not re-decided here). This
 * view adds the source line for each green number, so a reader can check it.
 */

const KIND_LABEL: Record<TraceStep['kind'], string> = {
  query: 'QUERY', understanding: 'INTENT', tool: 'TOOL', retrieval: 'RETRIEVAL',
  evidence: 'EVIDENCE', context: 'CONTEXT', model: 'MODEL', validation: 'CHECK',
  answer: 'ANSWER', error: 'ERROR', feedback: 'FEEDBACK',
}

// Step statuses as logged: `ok`, `error`, `refused` (a tool policy or the
// safety guard said no), `warning` (an error_logs level, or evidence with a
// failed tool in it).
/** An evidence line without its own `[S1]` prefix — the label is shown beside it already. */
function stripLabel(line: string): string {
  return line.replace(/^\[[A-Z]\d+\]\s*/, '')
}

function stepTone(step: TraceStep): string {
  if (step.status === 'error') return 'status-bad'
  if (step.status === 'refused' || step.status === 'warning') return 'status-warn'
  return 'theme-text'
}

/** A value from a log row, readable: strings as text, structures as JSON. */
function Value({ value }: { value: unknown }) {
  if (value == null || value === '') return <span className="theme-text-muted">-</span>
  if (typeof value === 'object') {
    return (
      <pre className="whitespace-pre-wrap break-words rounded-md theme-surface p-2 font-mono text-[10px] leading-relaxed theme-text">
        {JSON.stringify(value, null, 2)}
      </pre>
    )
  }
  return <span className="whitespace-pre-wrap break-words">{String(value)}</span>
}

function Details({ step }: { step: TraceStep }) {
  const { detail } = step
  if (step.kind === 'evidence') {
    const lines = (detail.lines ?? {}) as Record<string, string>
    const failures = (detail.failures ?? []) as string[]
    return (
      <div className="space-y-1.5">
        {Object.entries(lines).map(([label, line]) => (
          <p key={label} className="text-[11px] leading-relaxed">
            <code className="mr-1.5 rounded theme-surface px-1 theme-accent">{label}</code>
            {withEvidenceHighlights(stripLabel(line))}
          </p>
        ))}
        {failures.map((f) => (
          <p key={f} className="text-[11px] status-warn">Failed: {withEvidenceHighlights(f)}</p>
        ))}
        {detail.no_documents === true && (
          <p className="text-[11px] theme-text-muted">Retrieval ran and found no documents.</p>
        )}
      </div>
    )
  }
  const entries = Object.entries(detail).filter(([, v]) => v != null && v !== '' && !(Array.isArray(v) && !v.length))
  if (!entries.length) return <p className="text-[11px] theme-text-muted">Nothing more was logged for this step.</p>
  return (
    <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-3 gap-y-1.5 text-[11px]">
      {entries.map(([key, value]) => (
        <div key={key} className="contents">
          <dt className="theme-text-muted">{key.replace(/_/g, ' ')}</dt>
          <dd className="min-w-0 theme-text"><Value value={value} /></dd>
        </div>
      ))}
    </dl>
  )
}

function StepRow({ step, totalMs }: { step: TraceStep; totalMs: number | null }) {
  const [open, setOpen] = useState(false)
  // The answer row's own `ms` is the whole turn; a bar for it would always be full.
  const share = step.kind !== 'answer' && step.ms != null && totalMs ? Math.min(1, step.ms / totalMs) : null
  return (
    <li className="rounded-md border theme-border">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:theme-surface"
      >
        <ChevronRight size={12} className={`shrink-0 theme-text-muted transition-transform ${open ? 'rotate-90' : ''}`} />
        <span className="w-[4.5rem] shrink-0 font-mono text-[10px] tracking-wider theme-text-muted">
          {KIND_LABEL[step.kind]}
        </span>
        <span className={`min-w-0 flex-1 truncate text-xs ${stepTone(step)}`}>{step.title}</span>
        {share != null && (
          <span className="hidden h-1.5 w-24 shrink-0 overflow-hidden rounded-full theme-surface sm:block" title={`${Math.round(share * 100)}% of the turn`}>
            <span className="block h-full theme-bg-primary" style={{ width: `${Math.max(2, share * 100)}%` }} />
          </span>
        )}
        <span className="w-12 shrink-0 text-right text-[10px] tabular-nums theme-text-muted">
          {step.ms != null ? formatMs(step.ms) : ''}
        </span>
      </button>
      <Collapse open={open}>
        <div className="border-t theme-border px-3 py-2.5">
          <Details step={step} />
        </div>
      </Collapse>
    </li>
  )
}

/** The answer, with each number wrapped in its verdict's colour. */
// The unit written after a number, as `numbers._UNIT_AFTER_RE` reads it. Only
// used when the backend found a unit there, so a following word is never taken.
const UNIT_AFTER = /^\s?(°\s?c|°|%|[a-z]+(?:\/[a-z]+)?³?\d?)/i

// What else in plain text is worth catching the eye, in priority order: dates,
// clock times, names with a digit in them (CO2, CO₂, ABV-1, SOP-04), unit and
// tolerance symbols, and any digits left over (a list marker, a small count).
const EMPHASIS =
  /\d{4}-\d{2}-\d{2}(?:[T ]\d{1,2}:\d{2}(?::\d{2})?)?|\b\d{1,2}:\d{2}(?::\d{2})?(?:\s?[ap]\.?m\.?)?|\b[A-Za-z]+(?:-?\d+|₂)[A-Za-z0-9₂]*|°\s?[CF]?|%|±|\b\d+(?:\.\d+)?\b/g

/** Plain text with its dates, times, formulae and symbols picked out. */
function emphasise(text: string, keyBase: number): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  for (const m of text.matchAll(EMPHASIS)) {
    out.push(text.slice(last, m.index))
    out.push(
      <span key={`${keyBase}-${m.index}`} className="rounded px-0.5 font-medium theme-accent theme-surface">
        {m[0]}
      </span>,
    )
    last = m.index + m[0].length
  }
  out.push(text.slice(last))
  return out
}

function MarkedAnswer({ text, marks }: { text: string; marks: NumberMark[] }) {
  const out: ReactNode[] = []
  let last = 0
  for (const m of [...marks].sort((a, b) => a.start - b.start)) {
    if (m.start < last) continue
    out.push(...emphasise(text.slice(last, m.start), last))
    const source = m.sources[0]
    // `450 ppm` reads as one value, so the mark covers the unit too.
    const end = m.unit ? m.end + (UNIT_AFTER.exec(text.slice(m.end))?.[0].length ?? 0) : m.end
    out.push(
      <mark
        key={m.start}
        className={`rounded px-0.5 ${VERDICT[m.verdict].tone}`}
        title={[
          `${m.text}: ${m.reason}`,
          source ? `[${source.label}] ${source.line}` : '',
        ].filter(Boolean).join('\n')}
      >
        {text.slice(m.start, end)}
      </mark>,
    )
    last = end
  }
  out.push(...emphasise(text.slice(last), last))
  return <p className="whitespace-pre-wrap text-[13px] leading-relaxed theme-text">{out}</p>
}

function GroundednessPanel({ check }: { check: Groundedness }) {
  const supported = check.numbers.filter((m) => m.verdict === 'supported')
  return (
    <section className="space-y-2.5 rounded-lg border theme-border theme-card p-3">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 className="text-xs font-medium theme-text">Groundedness</h3>
        {(['supported', 'unsupported', 'stale', 'not_a_claim', 'unchecked'] as const).map((v) =>
          check.counts[v] ? (
            <span key={v} className={`rounded px-1.5 py-0.5 text-[10px] ${VERDICT[v].tone}`}>
              {check.counts[v]} {VERDICT[v].label}
            </span>
          ) : null,
        )}
        {!check.numbers.length && <span className="text-[10px] theme-text-muted">No numbers in this answer.</span>}
      </header>

      {check.replaced && (
        <p className="flex items-start gap-1.5 rounded-md status-bad-bg p-2 text-[11px] leading-relaxed theme-text">
          <AlertTriangle size={12} className="mt-0.5 shrink-0 status-bad" />
          The operator never saw this text. The validator replaced it with: “{check.delivered}”
        </p>
      )}

      {check.answer ? (
        <MarkedAnswer text={check.answer} marks={check.numbers} />
      ) : (
        <p className="text-[11px] theme-text-muted">No answer was produced.</p>
      )}

      {supported.some((m) => m.sources.length) && (
        <div className="space-y-1 border-t theme-border pt-2">
          <p className="text-[10px] uppercase tracking-wider theme-text-muted">Where each number came from</p>
          {supported.filter((m) => m.sources.length).map((m) => (
            <p key={m.start} className="text-[11px] leading-relaxed">
              <span className="mr-1.5 font-medium status-ok">{m.text}</span>
              <code className="mr-1.5 rounded theme-surface px-1 theme-accent">{m.sources[0].label}</code>
              <span className="theme-text-muted">{withEvidenceHighlights(stripLabel(m.sources[0].line))}</span>
            </p>
          ))}
        </div>
      )}

      {!check.evidence_available && (
        <p className="text-[10px] leading-relaxed theme-text-muted">
          The chat this came from was deleted, so the evidence lines are gone. The verdicts are the ones
          recorded when the answer was checked; only the source of each number cannot be shown.
        </p>
      )}
      <p className="text-[10px] leading-relaxed theme-text-muted">
        A detector, not a proof: it catches an invented or stale number, not a right number attached to
        the wrong sensor, or a claim with no number in it.
      </p>
    </section>
  )
}

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

export function TraceView({ queryId, compact = false }: {
  queryId: string
  /** Under a chat answer: the question and status are already on screen. */
  compact?: boolean
}) {
  // Tagged with the id it belongs to, so a slow response for the previous
  // selection can never render against the current one.
  const [state, setState] = useState<{
    queryId: string; trace: Trace | null; check: Groundedness | null; error: string | null
  } | null>(null)

  useEffect(() => {
    let live = true
    void Promise.all([fetchTrace(queryId), fetchGroundedness(queryId)])
      .then(([trace, check]) => { if (live) setState({ queryId, trace, check, error: null }) })
      .catch((e: Error) => { if (live) setState({ queryId, trace: null, check: null, error: e.message }) })
    return () => { live = false }
  }, [queryId])

  const shown = state?.queryId === queryId ? state : null
  if (shown?.error) {
    return <p className="rounded-lg border theme-border p-3 text-xs status-bad">Could not load this trace: {shown.error}</p>
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
          </div>
        </section>
      )}

      <ol className="space-y-1">
        {trace.steps.map((step, i) => (
          <StepRow key={`${step.kind}-${i}`} step={step} totalMs={trace.total_ms} />
        ))}
      </ol>

      <GroundednessPanel check={check} />
    </div>
  )
}
