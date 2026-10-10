import { useState } from 'react'
import { ChevronRight, Tag } from 'lucide-react'
import { type TraceBucket, type TracePage } from '../../lib/threadClient'
import { share } from '../../lib/threadLogic'
import { Collapse } from '../ui/collapse'
import { BUCKET_FILL, formatMs } from './status'

/** Figures over every turn the filters match — the evaluation's numbers, live. */
export function SummaryStrip({ page }: { page: TracePage }) {
  const { stats, labels } = page
  // Folded to one line by default: the list is what this column is for, and
  // the full figures are one click away.
  const [open, setOpen] = useState(false)
  if (!stats.total) return null
  const buckets: TraceBucket[] = ['grounded', 'ungrounded', 'unchecked']
  return (
    <div className="space-y-3 rounded-lg border theme-border theme-card px-3 py-2.5">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 text-[11px]"
        title={open ? 'Hide the figures' : 'Show the figures: counts, time, labels'}
      >
        <ChevronRight size={11} className={`shrink-0 theme-text-muted transition-transform ${open ? 'rotate-90' : ''}`} />
        {buckets.map((b) => (
          <span key={b} className="flex items-center gap-1" title={`${labels[b]}: ${stats.by_bucket[b] ?? 0}`}>
            <span className={`h-2 w-2 rounded-full ${BUCKET_FILL[b]}`} />
            <span className="tabular-nums theme-text">{stats.by_bucket[b] ?? 0}</span>
          </span>
        ))}
        <span className="ml-auto flex items-center gap-1 tabular-nums theme-text-muted" title="Labelled answers">
          <Tag size={10} /> {stats.labelled}/{stats.total}
        </span>
      </button>
      <Collapse open={open} variant="flow" className="space-y-3">
      {/* Gaps between segments, so a thin one still reads as its own colour. */}
      <div className="flex h-2 gap-0.5 overflow-hidden rounded-full">
        {buckets.map((b) => {
          const n = stats.by_bucket[b] ?? 0
          return n ? (
            <span
              key={b}
              className={`rounded-full ${BUCKET_FILL[b]}`}
              style={{ width: `${(n / stats.total) * 100}%` }}
              title={`${labels[b]}: ${n} of ${stats.total} (${share(n, stats.total)}%)`}
            />
          ) : null
        })}
      </div>
      <ul className="space-y-1.5 text-[11px]">
        {buckets.map((b) => (
          <li key={b} className="flex items-center gap-2" title={`${share(stats.by_bucket[b] ?? 0, stats.total)}% of ${stats.total}`}>
            <span className={`h-2 w-2 shrink-0 rounded-full ${BUCKET_FILL[b]}`} />
            <span className="min-w-0 flex-1 truncate theme-text-muted">{labels[b]}</span>
            <span className="tabular-nums theme-text">{stats.by_bucket[b] ?? 0}</span>
          </li>
        ))}
      </ul>
      {/* Plain names first, the statistic's name on hover: "typical" is what
          p50 means to whoever reads it, "slowest 5%" is p95. */}
      <div className="grid grid-cols-2 gap-2 border-t theme-border pt-3">
        <Stat
          label="Typical time"
          value={formatMs(stats.latency_p50_ms)}
          note="median (p50)"
          title="Half of the answers took less than this, for the whole turn as the operator waited"
        />
        <Stat
          label="Slowest 5%"
          value={formatMs(stats.latency_p95_ms)}
          note="95th percentile"
          title="95% of the answers were faster than this"
        />
        <div
          className="col-span-2 rounded-md theme-surface px-2.5 py-2"
          title="Answers a person has labelled Correct or Hallucinated: the evaluation's ground truth"
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider theme-text-muted">
              <Tag size={10} /> Labelled
            </span>
            <span className="text-sm tabular-nums theme-text">
              {stats.labelled}<span className="text-[11px] theme-text-muted"> of {stats.total}</span>
            </span>
          </div>
          <div className="mt-1.5 h-1 overflow-hidden rounded-full theme-bg">
            <span
              className="block h-full rounded-full theme-bg-primary"
              style={{ width: `${share(stats.labelled, stats.total) ?? 0}%` }}
            />
          </div>
          <p className="mt-1 text-[10px] theme-text-muted">
            {stats.labelled === 0
              ? 'None labelled yet'
              : stats.hallucinated > 0
                ? <span className="status-bad">{stats.hallucinated} hallucinated</span>
                : 'None hallucinated'}
          </p>
        </div>
      </div>
      </Collapse>
    </div>
  )
}

/** One figure in the summary: what it is, the number, and its statistic's name. */
function Stat({ label, value, note, title }: { label: string; value: string; note: string; title: string }) {
  return (
    <div className="rounded-md theme-surface px-2.5 py-2" title={title}>
      <p className="truncate text-[10px] uppercase tracking-wider theme-text-muted">{label}</p>
      <p className="mt-0.5 text-sm tabular-nums theme-text">{value}</p>
      <p className="text-[10px] theme-text-muted">{note}</p>
    </div>
  )
}
