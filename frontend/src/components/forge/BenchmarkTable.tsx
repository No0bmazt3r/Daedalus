import { useEffect, useMemo, useState } from 'react'
import { Download, Columns2, FlaskConical } from 'lucide-react'
import {
  benchmarkExportUrl, benchmarkHistory, runBenchmark, type BenchmarkRow,
} from '../../lib/forgeClient'
import { ThemeSelect } from '../ui/theme-select'

/**
 * The benchmark evidence table — Objective 3's numbers, exportable for the
 * report — and two models side by side, so "which model on this machine" is read
 * off rather than remembered across tabs.
 *
 * "Benchmark both" runs the pair back to back, so both get the same prompt
 * (the latest logged retrieval, or the fixture). Comparing two older runs is
 * allowed, but says so when their prompts were not the same size.
 */
export function BenchmarkTable({ models, refreshKey }: { models: string[]; refreshKey: unknown }) {
  const [rows, setRows] = useState<BenchmarkRow[] | null>(null)
  const [pair, setPair] = useState<[string, string]>(['', ''])
  const [running, setRunning] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)

  useEffect(() => {
    benchmarkHistory().then((r) => setRows(r.rows)).catch((e: unknown) => setError((e as Error).message))
  }, [refreshKey, reload])

  // Newest run per model: the history is newest first.
  const latest = useMemo(() => {
    const out = new Map<string, BenchmarkRow>()
    for (const r of rows ?? []) if (!out.has(r.model)) out.set(r.model, r)
    return out
  }, [rows])

  const options = [{ value: '', label: 'Choose a model' }, ...models.map((m) => ({ value: m, label: m }))]
  const [a, b] = pair.map((m) => latest.get(m))
  const sameSize = a && b && a.prompt_tokens && b.prompt_tokens
    && Math.abs(a.prompt_tokens - b.prompt_tokens) / Math.max(a.prompt_tokens, b.prompt_tokens) < 0.1

  const benchmarkBoth = async () => {
    setError(null)
    try {
      for (const tag of pair) {
        setRunning(tag)
        await runBenchmark(tag, () => {}).done
      }
      setReload((n) => n + 1)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setRunning(null)
    }
  }

  const cell = (v: number | string | null | undefined, unit = '') => (v === null || v === undefined ? '—' : `${v}${unit}`)
  const metrics: { label: string; get: (r: BenchmarkRow) => number | null; unit: string; better: 'low' | 'high' }[] = [
    { label: 'Time to first token', get: (r) => r.ttft_ms, unit: ' ms', better: 'low' },
    { label: 'Total', get: (r) => r.total_ms, unit: ' ms', better: 'low' },
    { label: 'Prefill', get: (r) => r.prefill_tok_s, unit: ' tok/s', better: 'high' },
    { label: 'Generation', get: (r) => r.generation_tok_s, unit: ' tok/s', better: 'high' },
    { label: 'Estimated generation', get: (r) => r.estimated_tok_s, unit: ' tok/s', better: 'high' },
    { label: 'Estimated memory', get: (r) => r.estimated_memory_gb, unit: ' GB', better: 'low' },
  ]
  const wins = (m: (typeof metrics)[number], mine?: BenchmarkRow, theirs?: BenchmarkRow) => {
    const x = mine && m.get(mine), y = theirs && m.get(theirs)
    return x != null && y != null && x !== y && (m.better === 'low' ? x < y : x > y)
  }

  return (
    <section className="space-y-3 rounded-xl border theme-border p-3">
      <header className="flex flex-wrap items-center gap-2">
        <FlaskConical size={13} className="theme-accent" />
        <h3 className="text-xs font-medium theme-text">Benchmark results</h3>
        <span className="text-[11px] theme-text-muted">{rows ? `${rows.length} runs` : 'loading…'}</span>
        <span className="ml-auto flex gap-1.5">
          {(['csv', 'md'] as const).map((f) => (
            <a
              key={f}
              href={benchmarkExportUrl(f)}
              download
              className="flex items-center gap-1 rounded-md border theme-border px-2 py-0.5 text-[11px] theme-text-muted hover:theme-text"
            >
              <Download size={11} /> {f === 'csv' ? 'CSV' : 'Markdown'}
            </a>
          ))}
        </span>
      </header>

      {error && <p className="text-[11px] text-rose-400">{error}</p>}

      {rows && rows.length > 0 && (
        <div className="max-h-56 overflow-auto">
          <table className="w-full text-[11px] tabular-nums">
            <thead className="theme-text-muted text-left">
              <tr>
                {['When', 'Model', 'Where', 'Prompt', 'TTFT', 'Prefill tok/s', 'Gen tok/s', 'Est. tok/s', 'Est. GB'].map((h) => (
                  <th key={h} className="py-1 pr-3 font-normal whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="theme-text">
              {rows.map((r) => (
                <tr key={`${r.model}-${r.at}`} className="border-t theme-border">
                  <td className="py-1 pr-3 whitespace-nowrap">{r.at.slice(0, 16).replace('T', ' ')}</td>
                  <td className="py-1 pr-3">{r.model}</td>
                  <td className="py-1 pr-3">{r.where}</td>
                  <td className="py-1 pr-3">{cell(r.prompt_tokens)}</td>
                  <td className="py-1 pr-3">{cell(r.ttft_ms, ' ms')}</td>
                  <td className="py-1 pr-3">{cell(r.prefill_tok_s)}</td>
                  <td className="py-1 pr-3">{cell(r.generation_tok_s)}</td>
                  <td className="py-1 pr-3">{cell(r.estimated_tok_s)}</td>
                  <td className="py-1 pr-3">{cell(r.estimated_memory_gb)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {rows && rows.length === 0 && (
        <p className="text-[11px] theme-text-muted">No benchmark has run yet. Benchmark a model above.</p>
      )}

      <div className="space-y-2 border-t theme-border pt-3">
        <div className="flex flex-wrap items-center gap-2">
          <Columns2 size={13} className="theme-text-muted" />
          <span className="text-xs theme-text">Side by side</span>
          {[0, 1].map((i) => (
            <ThemeSelect
              key={i}
              value={pair[i]}
              onChange={(v) => setPair((p) => (i === 0 ? [v, p[1]] : [p[0], v]))}
              options={options}
              ariaLabel={`Model ${i + 1}`}
              size="sm"
              className="w-48"
            />
          ))}
          <button
            onClick={() => void benchmarkBoth()}
            disabled={!pair[0] || !pair[1] || pair[0] === pair[1] || running !== null}
            className="rounded-md border theme-border px-2 py-0.5 text-[11px] theme-text hover:theme-surface disabled:opacity-40"
          >
            {running ? `Benchmarking ${running}…` : 'Benchmark both'}
          </button>
        </div>

        {pair[0] && pair[1] && (
          <table className="w-full text-[11px] tabular-nums">
            <thead className="theme-text-muted text-left">
              <tr>
                <th className="py-1 pr-3 font-normal" />
                <th className="py-1 pr-3 font-normal">{pair[0]}</th>
                <th className="py-1 pr-3 font-normal">{pair[1]}</th>
              </tr>
            </thead>
            <tbody>
              {metrics.map((m) => (
                <tr key={m.label} className="border-t theme-border">
                  <td className="py-1 pr-3 theme-text-muted">{m.label}</td>
                  {[[a, b], [b, a]].map(([mine, theirs], i) => (
                    <td key={i} className={`py-1 pr-3 ${wins(m, mine, theirs) ? 'text-emerald-400' : 'theme-text'}`}>
                      {mine ? cell(m.get(mine), m.unit) : 'not benchmarked'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {a && b && !sameSize && (
          <p className="text-[11px] text-amber-400">
            These two runs had different prompt sizes ({a.prompt_tokens} vs {b.prompt_tokens} tokens), so the times
            are not directly comparable. Benchmark both to measure them on the same prompt.
          </p>
        )}
      </div>
    </section>
  )
}
