import { type ReactNode } from 'react'
import { AlertTriangle, Check, EyeOff } from 'lucide-react'
import { parseEvidenceLine, stripLabel, type Moment } from '../../lib/threadLogic'
import { type Groundedness, type NumberMark } from '../../lib/threadClient'
import { withEvidenceHighlights } from '../Citations'
import { VERDICT } from './status'
import { AnswerMarkdown } from '../AnswerMarkdown'

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

// Private-use characters around a mark's index: plain text to the Markdown
// parser, so a marked number survives being inside **bold** or a list item.
const OPEN = '\uE000'
const CLOSE = '\uE001'
const SLOT = /\uE000(\d+)\uE001/g

/**
 * The answer as Markdown, with each number wrapped in its verdict's colour.
 *
 * The marks are offsets into the raw text, and Markdown rendering loses
 * offsets. So each marked span is swapped for a placeholder first, the text is
 * rendered, and the placeholders are turned back into marks in the text nodes.
 */
function MarkedAnswer({ text, marks }: { text: string; marks: NumberMark[] }) {
  const kept: { mark: NumberMark; shown: string }[] = []
  let source = ''
  let last = 0
  for (const m of [...marks].sort((a, b) => a.start - b.start)) {
    if (m.start < last) continue
    // `450 ppm` reads as one value, so the mark covers the unit too.
    const end = m.unit ? m.end + (UNIT_AFTER.exec(text.slice(m.end))?.[0].length ?? 0) : m.end
    source += text.slice(last, m.start) + OPEN + kept.length + CLOSE
    kept.push({ mark: m, shown: text.slice(m.start, end) })
    last = end
  }
  source += text.slice(last)

  const renderText = (fragment: string): ReactNode[] => {
    const out: ReactNode[] = []
    let at = 0
    for (const slot of fragment.matchAll(SLOT)) {
      out.push(...emphasise(fragment.slice(at, slot.index), at))
      const { mark: m, shown } = kept[Number(slot[1])]
      const src = m.sources[0]
      out.push(
        <mark
          key={`m${m.start}`}
          className={`rounded px-0.5 ${VERDICT[m.verdict].tone}`}
          title={[`${m.text}: ${m.reason}`, src ? `[${src.label}] ${src.line}` : ''].filter(Boolean).join('\n')}
        >
          {shown}
        </mark>,
      )
      at = slot.index + slot[0].length
    }
    out.push(...emphasise(fragment.slice(at), at))
    return out
  }

  return (
    <div className="text-[13px] leading-relaxed theme-text">
      <AnswerMarkdown text={source} renderText={renderText} />
    </div>
  )
}

/**
 * The answer's supported numbers grouped by the evidence line they came from,
 * so each line is shown once however many numbers it supplied.
 */
function sourcesOf(marks: NumberMark[]): { label: string; line: string; used: NumberMark[] }[] {
  const by = new Map<string, { label: string; line: string; used: NumberMark[] }>()
  for (const m of marks) {
    const src = m.sources[0]
    if (!src) continue
    const entry = by.get(src.label) ?? { label: src.label, line: src.line, used: [] }
    if (!entry.used.some((u) => u.value === m.value)) entry.used.push(m)
    by.set(src.label, entry)
  }
  return [...by.values()]
}

const firstNumber = (s: string) => Number(s.replace(/,/g, '').match(/-?\d+(?:\.\d+)?/)?.[0])

/** A row's time: UTC on top, site time under it, the date only when it differs. */
function When({ when, day }: { when?: Moment | string; day?: string }) {
  if (!when) return null
  if (typeof when === 'string') return <span>{when}</span>
  return (
    <span className="block leading-tight">
      <span className="block theme-text">
        {when.date !== day && `${when.date}, `}{when.utc} <span className="theme-text-muted">UTC</span>
      </span>
      {when.site && <span className="block text-[10px] theme-text-muted">{when.site} site</span>}
    </span>
  )
}

/**
 * One evidence line as a table: a header naming the sensor and its window,
 * then one row per figure. Rows whose figure the answer used carry a check and
 * green figures, so "which numbers came from here" is read straight off the table.
 * A line that is not a sensor summary (a document passage, a note) is shown
 * once as text.
 */
function SourceCard({ label, line, used }: { label: string; line: string; used: NumberMark[] }) {
  const parsed = parseEvidenceLine(line)
  const usedValues = new Set(used.map((u) => u.value))
  return (
    <div className="overflow-hidden rounded-md border theme-border">
      <div className="flex items-start gap-2 border-b theme-border theme-surface px-2.5 py-2">
        <code className="mt-px rounded border theme-border px-1 text-[11px] theme-accent">{label}</code>
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-xs theme-text">{parsed?.title ?? 'Evidence'}</p>
          {/* Each part kept whole: a time range broken mid-way is hard to read. */}
          {parsed?.span ? (
            <p className="text-[11px] leading-snug theme-text-muted">
              <span className="whitespace-nowrap">{parsed.span.main}</span>
              {parsed.span.site && <span className="block whitespace-nowrap text-[10px]">{parsed.span.site}</span>}
            </p>
          ) : parsed?.subtitle && <p className="text-[11px] theme-text-muted">{parsed.subtitle}</p>}
        </div>
        <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] status-ok status-ok-bg">
          {used.length} used
        </span>
      </div>

      {parsed ? (
        <table className="w-full border-collapse text-[12px]">
          <caption className="sr-only">Figures in evidence line {label}; checked rows were used in the answer</caption>
          <thead>
            <tr className="text-[10px] uppercase tracking-wider theme-text-muted">
              <th scope="col" className="w-8 py-1 pl-2.5 pr-1.5"><span className="sr-only">Used</span></th>
              <th scope="col" className="py-1 pr-2 text-left font-normal">Figure</th>
              <th scope="col" className="py-1 px-2 text-center font-normal">Value</th>
              <th scope="col" className="py-1 pr-2.5 text-center font-normal">Time</th>
            </tr>
          </thead>
          <tbody>
            {parsed.rows.map((r) => {
              const hit = usedValues.has(firstNumber(r.value))
              return (
                <tr key={r.label} className="border-t theme-border align-middle">
                  <td className="w-8 py-1.5 pl-2.5 pr-1.5">
                    {hit && <Check size={12} className="status-ok" aria-label="Used in the answer" />}
                  </td>
                  <th scope="row" className="py-1.5 pr-2 text-left font-normal theme-text-muted">{r.label}</th>
                  <td className={`whitespace-nowrap px-2 py-1.5 text-center tabular-nums ${hit ? 'font-medium status-ok' : 'theme-text'}`}>
                    {r.value}
                  </td>
                  <td className="whitespace-nowrap py-1.5 pr-2.5 text-center text-[11px] tabular-nums">
                    <When when={r.when} day={parsed.date} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      ) : (
        <p className="px-2.5 py-2 text-[12px] leading-relaxed theme-text-muted">{withEvidenceHighlights(stripLabel(line))}</p>
      )}

      {parsed && (
        <details className="border-t theme-border px-2.5 py-1.5 text-[11px] theme-text-muted">
          <summary className="cursor-pointer hover:theme-text">Original evidence line</summary>
          <p className="mt-1 leading-relaxed">{withEvidenceHighlights(stripLabel(line))}</p>
        </details>
      )}
    </div>
  )
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
        <div className="space-y-2 border-t theme-border pt-2">
          <p className="text-[10px] uppercase tracking-wider theme-text-muted">Where each number came from</p>
          {sourcesOf(supported).map((src) => <SourceCard key={src.label} {...src} />)}
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
