import { Fragment, useState, type ReactNode } from 'react'
import { AlertTriangle, BookOpen, ChevronDown, Database, Network } from 'lucide-react'
import { Collapse } from './ui/collapse'
import type { StoredEvidence } from '../lib/chatClient'

/**
 * Citations under an assistant answer — PROJECT.md §7.1 step 11 made visible.
 *
 * The orchestrator stores the evidence pack with the turn (`message.evidence`,
 * never replayed into a prompt). Each line carries the label the model was told
 * to cite — `[S1]` a sensor reading, `[D1]` a document
 * passage, `[G1]` a graph node — so an answer's claims can be traced to what the
 * tools actually returned without opening the audit store.
 *
 * Labels in the text become chips that show their evidence on hover. Only
 * labels the pack issued are linked: the validator already rejects an answer
 * citing one it did not, so an unlinked label here would mean a stored turn
 * predating that check, and it is left as plain text rather than dressed up.
 */

// `[S1]` and `[G6, G7]`. New answers arrive in only this form — the backend
// rewrites `[EVIDENCE: S1]` and the like (`validator.normalise_citations`) —
// but turns stored before that still carry the prefixed shape, so it is
// accepted here too.
const CITATION_RE =
  /\[\s*(?:(?:evidence|sources?|refs?|reference|citation|cite|see)\s*[:#-]?\s*)?([A-Z]\d+(?:\s*(?:[,;&/]|and)\s*[A-Z]\d+)*)\s*\]/gi
const SPLIT_RE = /\s*(?:[,;&/]|\band\b)\s*/i

const KIND_ICON: Record<string, typeof Database> = {
  sensor: Database,
  document: BookOpen,
  graph: Network,
}

/**
 * What each label letter means. `S` is a **sensor reading** from the telemetry
 * database — not "source". Documents are `D`, which only appears when retrieval
 * actually returned a passage.
 */
const KIND_NAME: Record<string, string> = {
  S: 'Sensor reading',
  D: 'Document passage',
  G: 'Knowledge-graph node',
}

function lineText(evidence: StoredEvidence, label: string): string {
  return (evidence.lines[label] ?? '').replace(/^\[[A-Z]\d+\]\s*/, '')
}

// A reading: a number with the unit written after it (the validator's `UNITS`,
// `services/orchestration/numbers.py`), or pH before it. A bare number is not
// one — a count, a step, a year — so it is left as text.
const READING_RE = new RegExp(
  String.raw`(?<![\w.-])-?\d{1,3}(?:,\d{3})+(?:\.\d+)?\s?(?:°\s?[CF]|%|m³|(?:ppm|ppb|percent|degC|degrees|barg|bara|mbar|bar|kPa|Pa|psi|atm|L\/min|mL\/min|lpm|slpm|sccm|mL|L|m3|kg|mg|g|mm|cm|rpm|mV|mA|kW|mmol|mol)\b)` +
  String.raw`|(?<![\w.-])-?\d+(?:\.\d+)?\s?(?:°\s?[CF]|%|m³|(?:ppm|ppb|percent|degC|degrees|barg|bara|mbar|bar|kPa|Pa|psi|atm|L\/min|mL\/min|lpm|slpm|sccm|mL|L|m3|kg|mg|g|mm|cm|rpm|mV|mA|kW|mmol|mol)\b)` +
  String.raw`|\bpH\s?\d+(?:\.\d+)?`,
  'gi',
)

/**
 * Plain answer text with each reading picked out, so `980 ppm` can be found
 * without reading the sentence. Accent and weight only: every number in a
 * delivered answer already passed the validator, so a verdict colour here
 * would say nothing — that view is Ariadne's Thread's.
 */
function withReadings(text: string, keyBase: number): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  for (const m of text.matchAll(READING_RE)) {
    out.push(text.slice(last, m.index))
    out.push(
      <span key={`r${keyBase + m.index}`} className="whitespace-nowrap font-medium theme-accent">
        {m[0]}
      </span>,
    )
    last = m.index + m[0].length
  }
  out.push(text.slice(last))
  return out
}

/** The answer text with its readings picked out and its citation labels turned into chips. */
export function withCitations(text: string, evidence: StoredEvidence | undefined): ReactNode {
  if (!evidence) return withReadings(text, 0)
  const out: ReactNode[] = []
  let last = 0
  for (const match of text.matchAll(CITATION_RE)) {
    const labels = match[1].split(SPLIT_RE).map((l) => l.trim().toUpperCase())
    if (!labels.every((l) => l in evidence.lines)) continue
    out.push(...withReadings(text.slice(last, match.index), last))
    out.push(
      <Fragment key={match.index}>
        {labels.map((label) => (
          // Inline on the baseline, not a superscript: raised chips at the start
          // of a wrapped line read as stray footnote marks floating in the gap.
          <span
            key={label}
            title={`${KIND_NAME[label[0]] ?? 'Evidence'} ${label}: ${lineText(evidence, label)}`}
            className="inline-block align-baseline mx-0.5 px-1 rounded border theme-border text-[10px] leading-[1.35] font-medium theme-surface-strong theme-text-muted cursor-help"
          >
            {label}
          </span>
        ))}
      </Fragment>,
    )
    last = match.index + match[0].length
  }
  out.push(...withReadings(text.slice(last), last))
  return out
}

/** Labels the answer actually cited, in order of first use. */
function citedLabels(text: string, evidence: StoredEvidence): string[] {
  const seen = new Set<string>()
  for (const match of text.matchAll(CITATION_RE)) {
    for (const label of match[1].split(SPLIT_RE).map((l) => l.trim().toUpperCase())) {
      if (label in evidence.lines) seen.add(label)
    }
  }
  return [...seen]
}

function SourceLine({ evidence, label }: { evidence: StoredEvidence; label: string }) {
  const kind = evidence.citations.find((c) => c.label === label)?.kind ?? ''
  const Icon = KIND_ICON[kind] ?? Database
  return (
    <li className="flex items-start gap-2">
      <code className="shrink-0 text-[10px] mt-0.5 px-1 rounded theme-surface-strong theme-text">{label}</code>
      <Icon size={11} className="shrink-0 mt-1 theme-text-muted" />
      <span className="leading-relaxed">{lineText(evidence, label)}</span>
    </li>
  )
}

/** The collapsible source list under an answer. Renders nothing without evidence. */
export function Sources({ text, evidence }: { text: string; evidence: StoredEvidence | undefined }) {
  const [open, setOpen] = useState(false)
  const [showAll, setShowAll] = useState(false)
  if (!evidence) return null

  const cited = citedLabels(text, evidence)
  const all = evidence.citations.map((c) => c.label)
  const uncited = all.filter((l) => !cited.includes(l))
  if (!all.length && !evidence.failures.length) return null

  const summary = cited.length
    ? `${cited.length} source${cited.length === 1 ? '' : 's'} cited`
    : all.length
      ? `${all.length} piece${all.length === 1 ? '' : 's'} of evidence gathered, none cited`
      : 'no evidence found'

  return (
    <div className="mt-2 text-[12px] theme-text-muted">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex items-center gap-1.5 hover:theme-text transition-colors"
      >
        <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : '-rotate-90'}`} />
        {summary}
        <span className="opacity-60">· {evidence.tools_used.join(', ')}</span>
      </button>
      {open && (
        <p className="mt-1 pl-4 text-[10px] opacity-60">
          S sensor reading · D document passage · G knowledge-graph node
        </p>
      )}
      <Collapse open={open} className="mt-1.5 pl-4 space-y-2">
        {cited.length > 0 && (
          <ul className="space-y-1.5">
            {cited.map((label) => <SourceLine key={label} evidence={evidence} label={label} />)}
          </ul>
        )}
        {uncited.length > 0 && (
          <div>
            <button
              onClick={() => setShowAll((s) => !s)}
              className="text-[11px] underline underline-offset-2 hover:theme-text transition-colors"
            >
              {showAll ? 'hide' : 'show'} {uncited.length} gathered but not cited
            </button>
            <Collapse open={showAll} className="mt-1.5">
              <ul className="space-y-1.5 opacity-75">
                {uncited.map((label) => <SourceLine key={label} evidence={evidence} label={label} />)}
              </ul>
            </Collapse>
          </div>
        )}
        {evidence.failures.map((f) => (
          <p key={f} className="flex items-start gap-1.5 status-warn text-[11px]">
            <AlertTriangle size={11} className="shrink-0 mt-0.5" /> {f}
          </p>
        ))}
        {evidence.notes.map((n) => (
          <p key={n} className="text-[11px] opacity-75">{n}</p>
        ))}
      </Collapse>
    </div>
  )
}
