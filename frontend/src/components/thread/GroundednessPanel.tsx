import { type ReactNode } from 'react'
import { AlertTriangle, EyeOff } from 'lucide-react'
import { stripLabel } from '../../lib/threadLogic'
import { type Groundedness, type NumberMark } from '../../lib/threadClient'
import { withEvidenceHighlights } from '../Citations'
import { VERDICT } from './status'

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

/** The answer, with each number wrapped in its verdict's colour. */
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

export function GroundednessPanel({ check }: { check: Groundedness }) {
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

      {check.redacted && (
        <p className="flex items-start gap-1.5 rounded-md theme-surface p-2 text-[11px] leading-relaxed theme-text-muted">
          <EyeOff size={12} className="mt-0.5 shrink-0" />
          Asked in an incognito chat, so the question and answer were not recorded. The verdict and the
          timings were, because they say nothing about what was asked.
        </p>
      )}

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
