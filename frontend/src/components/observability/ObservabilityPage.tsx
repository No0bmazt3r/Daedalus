import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Activity, RefreshCw, ArrowUpRight, Terminal, Info } from 'lucide-react'
import {
  Area, Bar, BarChart, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip as ChartTooltip, XAxis, YAxis,
} from 'recharts'
import {
  observability, OBS_PHASES, type Observability, type ObsPhase, type ObsRange, type ObsSource,
} from '../../lib/systemClient'
import { openSettingsPanel, openThread, type TraceStatus } from '../../lib/threadClient'
import { STATUS, formatMs } from '../thread/status'
import { TabError } from '../errors/TabError'
import { toFailure, type LoadFailure } from '../errors/ErrorPage'
import { Skeleton } from '../ui/skeleton'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip'
import { MINIMIZED_DOCK_SLOT, dockSlotRef } from '../ui/floating-window'

/**
 * How the assistant has been doing, from the audit log (TODO.md, M7).
 *
 * Built in rather than a Prometheus/Grafana stack: the numbers already live in
 * `ai_logs.db`, and Daedalus runs on one machine with nothing else beside it.
 * Turns are classified exactly as Ariadne's Thread classifies them, and every
 * row that names a turn opens it there. Loads on open and on Refresh; it is a
 * summary of history, not a live feed (the Rig chip is the live one).
 */

const RANGES: { id: ObsRange; label: string }[] = [
  { id: '24h', label: '24 h' }, { id: '7d', label: '7 d' }, { id: '30d', label: '30 d' }, { id: 'all', label: 'All' },
]
const SOURCES: { id: ObsSource; label: string; hint: string }[] = [
  { id: 'chat', label: 'Chat', hint: 'Everyday chats, including refused questions' },
  { id: 'eval', label: 'Eval', hint: 'Evaluation runs (cli_eval)' },
  { id: 'benchmark', label: 'Benchmark', hint: 'The Forge benchmarks: model calls only, no chat turns' },
]
const PHASE_LABEL: Record<ObsPhase, string> = {
  retrieval: 'Retrieval', rerank: 'Re-rank', load: 'Model load', prefill: 'Prefill', generation: 'Generation',
}
// Fewer points than this and a line says nothing a list of numbers does not.
const MIN_POINTS = 4

const card = 'rounded-xl border theme-border theme-card p-4'
const muted = 'text-[11px] leading-relaxed theme-text-muted'

function pct(rate: number | null): string {
  return rate == null ? '-' : `${Math.round(rate * 100)}%`
}

function seconds(ms: number): string {
  return ms >= 1000 ? `${+(ms / 1000).toFixed(1)}s` : `${ms}ms`
}

function bucketLabel(iso: string, unit: Observability['unit']): string {
  const at = new Date(iso)
  if (unit === 'hour') return at.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  return at.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

function Segmented<T extends string>({ label, value, options, onChange }: {
  label: string
  value: T
  options: { id: T; label: string; hint?: string }[]
  onChange: (next: T) => void
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap items-center gap-1">
      {options.map((o) => (
        <button
          key={o.id}
          role="radio"
          aria-checked={value === o.id}
          title={o.hint}
          onClick={() => onChange(o.id)}
          className={`h-8 min-w-[2.75rem] px-2.5 text-xs whitespace-nowrap rounded-lg border transition-colors ${
            value === o.id
              ? 'theme-accent-border theme-accent theme-surface-strong'
              : 'theme-border theme-text-muted hover:theme-text'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Tile({ label, value, note, warn = false, info }: {
  label: string; value: string; note?: string; warn?: boolean; info?: ReactNode
}) {
  return (
    <div className={card}>
      <div className={`${muted} flex items-center gap-1.5`}>{label}{info}</div>
      <div className={`mt-1 text-2xl tabular-nums ${warn ? 'status-warn' : 'theme-text'}`}>{value}</div>
      {note && <div className={`${muted} mt-0.5`}>{note}</div>}
    </div>
  )
}

function Section({ title, hint, children, aside, className = '' }: {
  title: string; hint?: string; children: ReactNode; aside?: ReactNode; className?: string
}) {
  return (
    <section className={`${card} min-w-0 ${className}`}>
      <div className="flex items-start gap-3 mb-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm theme-text">{title}</h2>
          {hint && <p className={muted}>{hint}</p>}
        </div>
        {aside}
      </div>
      {children}
    </section>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <div className={`${muted} flex min-h-[8rem] items-center justify-center text-center px-4`}>{children}</div>
}

/** A line sample for the legend, so p50 and p95 differ by stroke and not by hue alone. */
function LineKey({ dashed, label, color }: { dashed?: boolean; label: string; color: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <svg width="18" height="6" aria-hidden>
        <line x1="0" y1="3" x2="18" y2="3" stroke={color} strokeWidth="2" strokeDasharray={dashed ? '4 3' : undefined} />
      </svg>
      {label}
    </span>
  )
}

// p50 is the theme's accent; p95 its complement (`--chart-p95`, set per theme),
// and dashed too, so the two never rely on hue alone.
const P50 = 'var(--primary-readable)'
const P95 = 'var(--chart-p95)'

/** What p50 and p95 mean, on hover or keyboard focus. */
function PercentileInfo() {
  return (
    <Tooltip>
      <TooltipTrigger
        render={<button aria-label="What p50 and p95 mean" className="inline-flex rounded theme-text-muted hover:theme-text focus-visible:outline-2 focus-visible:outline-[var(--primary-readable)]" />}
      >
        <Info size={13} />
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-72 flex-col items-start gap-1 text-left">
        <span><b>p50</b> (the median): half the answers came back faster than this. The typical wait.</span>
        <span><b>p95</b>: 95 in every 100 answers came back faster than this. The slow end, which an average hides.</span>
        <span className="opacity-80">On a day with only a few turns, p95 is simply the slowest one.</span>
      </TooltipContent>
    </Tooltip>
  )
}

const tooltipStyle = {
  contentStyle: {
    background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 11, color: 'var(--text-main)',
  },
  labelStyle: { color: 'var(--text-muted)' },
  cursor: { fill: 'color-mix(in srgb, var(--text-main) 6%, transparent)', stroke: 'var(--border)' },
}
const axis = { stroke: 'var(--text-muted)', fontSize: 11, tickLine: false, axisLine: false } as const

/** Buckets that had turns, labelled. Empty ones are left out: on a sparse log they
 * were most of the axis, and the gaps said nothing the dates do not. */
function withTurns(data: Observability) {
  return data.series.filter((p) => p.turns).map((p) => ({ ...p, label: bucketLabel(p.start, data.unit) }))
}

function LatencyChart({ data }: { data: Observability }) {
  const filled = withTurns(data)
  if (filled.length < MIN_POINTS) {
    return (
      <SparseList note={`Not enough data for a trend yet (${filled.length} ${data.unit}${filled.length === 1 ? '' : 's'} with turns).`}>
        {filled.map((p) => (
          <li key={p.start} className="flex justify-between gap-3">
            <span className="shrink-0 whitespace-nowrap">{p.label}</span>
            <span className="tabular-nums">p50 {formatMs(p.p50_ms)} · p95 {formatMs(p.p95_ms)} · {p.turns} turns</span>
          </li>
        ))}
      </SparseList>
    )
  }
  return (
    <>
      <div className={`${muted} flex items-center gap-4 mb-2`}>
        <LineKey color={P50} label="p50 (typical)" />
        <LineKey color={P95} dashed label="p95 (slow end)" />
        <PercentileInfo />
      </div>
      <div className="h-64 @[100rem]:h-72" role="img" aria-label={`Response time per ${data.unit}, p50 and p95`}>
        <ResponsiveContainer>
          <ComposedChart data={filled} margin={{ top: 4, right: 8, bottom: 0, left: -8 }}>
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis dataKey="label" {...axis} minTickGap={16} />
            <YAxis {...axis} tickFormatter={seconds} width={48} />
            <ChartTooltip {...tooltipStyle} formatter={(v, name) => [formatMs(v as number), name]} />
            <defs>
              <linearGradient id="obs-p50" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--primary-readable)" stopOpacity={0.28} />
                <stop offset="100%" stopColor="var(--primary-readable)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <Area name="p50" dataKey="p50_ms" type="monotone" stroke="var(--primary-readable)" strokeWidth={2} fill="url(#obs-p50)" dot={{ r: 2.5 }} isAnimationActive={false} />
            <Line name="p95" dataKey="p95_ms" type="monotone" stroke={P95} strokeWidth={2} strokeDasharray="5 4" dot={{ r: 2.5, fill: 'var(--card)' }} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </>
  )
}

function BreakdownChart({ data }: { data: Observability }) {
  const filled = withTurns(data)
  const legend = (
    <div className={`${muted} flex flex-wrap gap-x-4 gap-y-1 mb-2`}>
      {OBS_PHASES.map((phase, i) => (
        <span key={phase} className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: `var(--chart-${i + 1})` }} aria-hidden />
          {PHASE_LABEL[phase]}
        </span>
      ))}
    </div>
  )
  if (filled.length < MIN_POINTS) {
    return (
      <SparseList note={`Not enough data for a trend yet. Average per turn:`}>
        {filled.map((p) => (
          <li key={p.start} className="flex justify-between gap-3">
            <span className="shrink-0 whitespace-nowrap">{p.label}</span>
            <span className="tabular-nums text-right">
              {OBS_PHASES.filter((ph) => p[ph]).map((ph) => `${PHASE_LABEL[ph]} ${formatMs(p[ph])}`).join(' · ') || '-'}
            </span>
          </li>
        ))}
      </SparseList>
    )
  }
  return (
    <>
      {legend}
      <div className="h-64 @[100rem]:h-72" role="img" aria-label={`Average time per turn by phase, per ${data.unit}`}>
        <ResponsiveContainer>
          <BarChart data={filled} margin={{ top: 4, right: 8, bottom: 0, left: -8 }}>
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis dataKey="label" {...axis} minTickGap={16} />
            <YAxis {...axis} tickFormatter={seconds} width={48} />
            <ChartTooltip {...tooltipStyle} formatter={(v, name) => [formatMs(v as number), name]} />
            {OBS_PHASES.map((phase, i) => (
              <Bar key={phase} name={PHASE_LABEL[phase]} dataKey={phase} stackId="t" fill={`var(--chart-${i + 1})`} maxBarSize={44}
                radius={i === OBS_PHASES.length - 1 ? [4, 4, 0, 0] : 0} isAnimationActive={false} />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </>
  )
}

function SparseList({ note, children }: { note: string; children: ReactNode }) {
  return (
    <div className="min-h-[8rem]">
      <p className={`${muted} mb-2`}>{note}</p>
      <ul className="space-y-1 text-xs theme-text">{children}</ul>
    </div>
  )
}

function Table({ head, children, empty }: { head: string[]; children: ReactNode[]; empty: string }) {
  if (!children.length) return <Empty>{empty}</Empty>
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="theme-text-muted text-left">
            {head.map((h, i) => <th key={h} scope="col" className={`font-normal pb-2 ${i ? 'text-right pl-3' : ''}`}>{h}</th>)}
          </tr>
        </thead>
        <tbody className="theme-text">{children}</tbody>
      </table>
    </div>
  )
}

const td = 'py-1.5 pl-3 text-right tabular-nums whitespace-nowrap'
const rowClass = 'border-t theme-border'

function Recent({ data }: { data: Observability }) {
  const [tab, setTab] = useState<'errors' | 'slowest'>(data.errors.length ? 'errors' : 'slowest')
  const tabs = [
    { id: 'errors' as const, label: 'Errors', n: data.errors.length },
    { id: 'slowest' as const, label: 'Slowest', n: data.slowest.length },
  ]
  const row = 'w-full flex items-start gap-3 px-2 py-2 rounded-lg text-left text-xs'
  const clickable = 'hover:bg-[color-mix(in_srgb,var(--text-main)_6%,transparent)] focus-visible:outline-2 focus-visible:outline-[var(--primary-readable)]'
  return (
    <Section
      title="Errors and slowest turns"
      hint="Click a row to open its trace in Ariadne's Thread."
      aside={
        <button onClick={() => openSettingsPanel('logs')} className={`${muted} inline-flex items-center gap-1 hover:theme-text`}>
          <Terminal size={12} /> Process log
        </button>
      }
    >
      <div role="tablist" className="flex gap-1 mb-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`h-8 px-3 text-xs rounded-lg ${tab === t.id ? 'theme-surface-strong theme-text' : 'theme-text-muted hover:theme-text'}`}
          >
            {t.label} <span className="tabular-nums opacity-70">{t.n}</span>
          </button>
        ))}
      </div>
      <div role="tabpanel">
        {tab === 'errors' && (data.errors.length === 0 ? <Empty>No errors in this range.</Empty> : (
          <ul>
            {data.errors.map((e, i) => {
              const body = (
                <>
                  <span className="w-24 shrink-0 theme-text-muted tabular-nums">{new Date(e.timestamp).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                  <span className="min-w-0 flex-1">
                    <span className="status-bad">{[e.component, e.error_type].filter(Boolean).join(' · ') || 'error'}</span>
                    <span className="block theme-text-muted break-words">{e.message}</span>
                  </span>
                  {e.query_id && <ArrowUpRight size={12} className="shrink-0 theme-text-muted" aria-hidden />}
                </>
              )
              return (
                <li key={i} className={i ? rowClass : ''}>
                  {e.query_id
                    ? <button className={`${row} ${clickable}`} onClick={() => openThread(e.query_id!)}>{body}</button>
                    : <div className={row} title="Not part of a turn (startup or a background job)">{body}</div>}
                </li>
              )
            })}
          </ul>
        ))}
        {tab === 'slowest' && (data.slowest.length === 0 ? <Empty>No turns in this range.</Empty> : (
          <ul>
            {data.slowest.map((t, i) => {
              const status = STATUS[t.status as TraceStatus]
              return (
                <li key={t.query_id} className={i ? rowClass : ''}>
                  <button className={`${row} ${clickable}`} onClick={() => openThread(t.query_id)}>
                    <span className="w-14 shrink-0 tabular-nums theme-text">{formatMs(t.latency_ms)}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate theme-text">{t.question || '(no question recorded)'}</span>
                      <span className="theme-text-muted">
                        <span className={status?.tone}>{status?.label ?? t.status}</span>
                        {t.model && ` · ${t.model}`} · {new Date(t.timestamp).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                      </span>
                    </span>
                    <ArrowUpRight size={12} className="shrink-0 theme-text-muted" aria-hidden />
                  </button>
                </li>
              )
            })}
          </ul>
        ))}
      </div>
    </Section>
  )
}

function Loading() {
  return (
    <div className="space-y-3" role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading figures</span>
      <div className="grid grid-cols-1 @sm:grid-cols-2 @2xl:grid-cols-3 @5xl:grid-cols-6 gap-3">
        {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-[5.5rem] rounded-xl" />)}
      </div>
      <div className="grid @4xl:grid-cols-2 gap-3">
        <Skeleton className="h-72 rounded-xl" /><Skeleton className="h-72 rounded-xl" />
      </div>
    </div>
  )
}

export function ObservabilityPage() {
  const [range, setRange] = useState<ObsRange>('all')
  const [source, setSource] = useState<ObsSource>('chat')
  const [data, setData] = useState<Observability | null>(null)
  const [failure, setFailure] = useState<LoadFailure | null>(null)
  const [busy, setBusy] = useState(true)
  const [nonce, setNonce] = useState(0)

  // Set busy from the events that cause a load, not inside the effect.
  const reload = useCallback(() => { setBusy(true); setNonce((n) => n + 1) }, [])
  const pickRange = (next: ObsRange) => { setBusy(true); setRange(next) }
  const pickSource = (next: ObsSource) => { setBusy(true); setSource(next) }

  useEffect(() => {
    let cancelled = false
    observability(range, source).then(
      (d) => { if (!cancelled) { setData(d); setFailure(null) } },
      (e) => { if (!cancelled) setFailure(toFailure(e)) },
    ).finally(() => { if (!cancelled) setBusy(false) })
    return () => { cancelled = true }
  }, [range, source, nonce])

  if (failure) {
    return <TabError code={failure.status} detail={failure.message} what="The Observability figures could not load." onRetry={reload} />
  }

  const h = data?.headline
  const noTurns = data != null && h?.turns === 0

  return (
    <TooltipProvider delay={200}>
    <div className="@container h-full overflow-y-auto theme-bg theme-text">
      <header className="sticky top-0 z-10 border-b theme-border theme-bg">
        <div className="px-4 sm:px-6 py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-center gap-2 mr-auto">
            <Activity size={16} className="theme-accent" />
            <h1 className="text-base">Observability</h1>
          </div>
          {/* Minimized windows dock here on this page, as beside the Rig chip on the chat. */}
          <div ref={dockSlotRef} id={MINIMIZED_DOCK_SLOT} className="flex flex-wrap items-center gap-2 empty:hidden" />
          <Segmented label="Time range" value={range} options={RANGES} onChange={pickRange} />
          <Segmented label="Source" value={source} options={SOURCES} onChange={pickSource} />
          <div className="flex items-center gap-2">
            <button
              onClick={reload}
              disabled={busy}
              aria-label="Refresh"
              className="h-8 w-8 inline-flex items-center justify-center rounded-lg border theme-border theme-text-muted hover:theme-text disabled:opacity-60"
            >
              <RefreshCw size={13} className={busy ? 'animate-spin' : ''} />
            </button>
            {data && (
              <span className={muted} aria-live="polite">
                Updated {new Date(data.generated_at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          </div>
        </div>
      </header>

      <div className="px-4 sm:px-6 py-5 space-y-3">
        <p className={muted}>
          From the audit log (<code>logs/ai_logs.db</code>). Turns are classified as Ariadne's Thread classifies them.
          {data && <> Days and hours are in {data.timezone}.</>}
        </p>

        {!data ? <Loading /> : (
          <>
            <div className="grid grid-cols-1 @sm:grid-cols-2 @2xl:grid-cols-3 @5xl:grid-cols-6 gap-3">
              <Tile label="Turns" value={String(h!.turns)} />
              <Tile label="Response time" value={formatMs(h!.p50_ms)} note={`p50 · p95 ${formatMs(h!.p95_ms)}`} info={<PercentileInfo />} />
              <Tile label="Errors" value={pct(h!.error_rate)} note={`${h!.errors} of ${h!.turns} turns`} warn={h!.errors > 0} />
              <Tile label="Refused" value={pct(h!.refusal_rate)} note={`${h!.refused} by the safety guard`} />
              <Tile label="Grounded" value={pct(h!.grounded_rate)} note={`${h!.grounded} of ${h!.checked} checked`} />
              <Tile
                label="Hallucinated"
                value={pct(h!.hallucination_rate)}
                note={h!.labelled ? `${h!.hallucinated} of ${h!.labelled} you labelled` : 'None labelled yet'}
                warn={h!.hallucinated > 0}
              />
            </div>

            {noTurns ? (
              <section className={card}>
                <Empty>
                  <span>
                    {source === 'benchmark'
                      ? 'Benchmarks call the model directly, so they have no chat turns. Their model calls are in Models below.'
                      : source === 'eval'
                        ? 'No evaluation runs in this range. Run one with python -m app.cli_eval.'
                        : 'No turns in this range. Ask the assistant something, or pick a longer range.'}
                    {range !== 'all' && source !== 'benchmark' && (
                      <button onClick={() => pickRange('all')} className="block mx-auto mt-2 underline hover:theme-text">Show all time</button>
                    )}
                  </span>
                </Empty>
              </section>
            ) : (
              <div className="grid @4xl:grid-cols-2 gap-3">
                <Section title="Response time" hint={`Per ${data.unit} with turns, from question to finished answer.`}>
                  <LatencyChart data={data} />
                </Section>
                <Section title="Where the time goes" hint={`Average per turn, per ${data.unit} with turns.`}>
                  <BreakdownChart data={data} />
                </Section>
              </div>
            )}

            {/* Tools and Models stacked beside the list: together they are about its height. */}
            <div className="grid @6xl:grid-cols-2 gap-3 items-start">
              <div className="grid @4xl:grid-cols-2 @6xl:grid-cols-1 gap-3">
              <Section title="Tools" hint="Calls the assistant made, by tool.">
                <Table head={['Tool', 'Calls', 'Failed', 'p50', 'p95']} empty="No tool calls in this range.">
                  {data.tools.map((t) => (
                    <tr key={t.name} className={rowClass}>
                      <td className="py-1.5 font-mono truncate max-w-[12rem]">{t.name}</td>
                      <td className={td}>{t.calls}</td>
                      <td className={`${td} ${t.failed ? 'status-bad' : ''}`}>{t.failed}</td>
                      <td className={td}>{formatMs(t.p50_ms)}</td>
                      <td className={td}>{formatMs(t.p95_ms)}</td>
                    </tr>
                  ))}
                </Table>
              </Section>
              <Section title="Models" hint="p50 per model. Tokens per second is generation speed.">
                <Table head={['Model', 'Calls', 'First token', 'Tokens/s', 'Failed']} empty="No model calls in this range.">
                  {data.models.map((m) => (
                    <tr key={m.name} className={rowClass}>
                      <td className="py-1.5 font-mono truncate max-w-[12rem]">{m.name}</td>
                      <td className={td}>{m.calls}</td>
                      <td className={td}>{formatMs(m.ttft_p50_ms)}</td>
                      <td className={td}>{m.tokens_per_s_p50 ?? '-'}</td>
                      <td className={`${td} ${m.failed ? 'status-bad' : ''}`}>{m.failed}</td>
                    </tr>
                  ))}
                </Table>
              </Section>
              </div>
              <Recent data={data} />
            </div>
          </>
        )}
      </div>
    </div>
    </TooltipProvider>
  )
}
