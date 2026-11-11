import { useState } from 'react'
import { ChevronRight, Table2 } from 'lucide-react'
import { stripLabel } from '../../lib/threadLogic'
import { openStore, type TraceStep } from '../../lib/threadClient'
import { Collapse } from '../ui/collapse'
import { withEvidenceHighlights } from '../Citations'
import { formatMs } from './status'

/** The trace's steps: one row each, opening to everything its log row recorded. */

const KIND_LABEL: Record<TraceStep['kind'], string> = {
  query: 'QUERY', understanding: 'INTENT', tool: 'TOOL', retrieval: 'RETRIEVAL', rerank: 'RERANK',
  evidence: 'EVIDENCE', context: 'CONTEXT', model: 'MODEL', thinking: 'THINKING', validation: 'CHECK',
  answer: 'ANSWER', error: 'ERROR', feedback: 'FEEDBACK', label: 'LABEL',
}

// Step statuses as logged: `ok`, `error`, `refused` (a tool policy or the
// safety guard said no), `warning` (an error_logs level, or evidence with a
// failed tool in it).
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
  if (step.kind === 'thinking' && typeof detail.thought === 'string' && detail.thought) {
    // As the chat's "Thought process" shows it: the reasoning as prose, not a field.
    return (
      <div className="border-l-2 theme-border pl-3 text-xs leading-relaxed theme-text-muted whitespace-pre-wrap break-words">
        {detail.thought}
      </div>
    )
  }
  if (step.kind === 'rerank' && Array.isArray(detail.moves)) {
    const moves = detail.moves as { before: number | null; after: number; document: string | null; page: number | null; score: number | null }[]
    return (
      <div className="space-y-1.5 text-[11px]">
        <p className="theme-text-muted">
          {String(detail.model)} scored {String(detail.candidates ?? '?')} candidates and kept {moves.length}.
          {!detail.positions_logged && ' Their places before re-ranking were not logged for this turn.'}
        </p>
        <ul className="space-y-1">
          {moves.map((m) => {
            const moved = m.before != null && m.before !== m.after
            return (
              <li key={m.after} className="flex items-baseline gap-3">
                <span className={`w-16 shrink-0 font-mono tabular-nums ${moved ? 'theme-accent' : 'theme-text-muted'}`}>
                  {m.before != null ? `#${m.before} → #${m.after}` : `#${m.after}`}
                </span>
                <span className="min-w-0 flex-1 truncate theme-text">
                  {m.document ?? 'chunk no longer in the corpus'}{m.page != null && ` p.${m.page}`}
                </span>
                <span className="shrink-0 tabular-nums theme-text-muted">score {m.score != null ? m.score.toFixed(4) : '-'}</span>
              </li>
            )
          })}
        </ul>
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

export function StepRow({ step, totalMs }: { step: TraceStep; totalMs: number | null }) {
  // The model's reasoning is what people open a trace to read, so it starts open
  // when there is some. Keyed by turn in TraceView, so each trace starts this way.
  const [open, setOpen] = useState(step.kind === 'thinking' && Boolean(step.detail.thought))
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
        <div className="space-y-2 border-t theme-border px-3 py-2.5">
          <Details step={step} />
          {/* Not a row viewer: the Thread's job is the join (§0.2). This only
              opens the table the row came from, newest first, in Data stores. */}
          {step.table && (
            <button
              onClick={() => openStore('audit', step.table!)}
              className="flex items-center gap-1 text-[10px] theme-text-muted hover:theme-text"
            >
              <Table2 size={10} /> Open <code>{step.table}</code> in Data stores
            </button>
          )}
        </div>
      </Collapse>
    </li>
  )
}
