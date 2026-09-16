import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle, ChevronDown, Download, FlaskConical, Loader2, RefreshCw, Trash2,
  CircleCheck, CircleAlert, CircleSlash, Cloud, HelpCircle, X,
} from 'lucide-react'
import {
  modelTable, pullModel, deleteModel, runBenchmark,
  type ModelTable, type ModelRow, type PullProgress, type BenchmarkResult,
} from '../../lib/forgeClient'

/**
 * Steps 2–5 of the Forge: estimate · score · manage · benchmark.
 *
 * ## The one rule this screen exists to keep
 *
 * `MODULES.md` §2.2: *an estimate and a measurement must never look alike.* The
 * whole value of this module to the report is the gap between the two, and how
 * it closes as you work through it — so every row carries both columns, they
 * are styled differently, and "not benchmarked" is a first-class state rendered
 * in words rather than left as a blank cell.
 *
 * On the development machine that gap is currently 0.38×: llama3.2 estimated at
 * 29 tok/s, measured at 11. That is not a bug in the estimator, it is the
 * finding — a 4GB card has to hold the KV cache and compute buffers too, so a
 * model that fits on paper part-offloads in practice. The table shows the ratio
 * rather than hiding it.
 *
 * ## Ranking
 *
 * Rows arrive ranked by the backend and are rendered in that order. The
 * ordering is not editorial: it is the weighted composite from
 * `services/model_fit.py`, whose weights come from `PROJECT.md` §9.2's own
 * targets. Expanding a row shows every input that produced it, because a
 * ranking nobody can check is a ranking nobody should act on.
 */

function bytes(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined) return '—'
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1024
  let u = 0
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024
    u++
  }
  return `${v.toFixed(digits)} ${units[u]}`
}

const VERDICT = {
  safe: { icon: CircleCheck, tone: 'text-emerald-400', label: 'safe' },
  marginal: { icon: CircleAlert, tone: 'text-amber-400', label: 'marginal' },
  will_not_fit: { icon: CircleSlash, tone: 'text-red-400/80', label: 'will not fit' },
  cloud: { icon: Cloud, tone: 'theme-text-muted', label: 'cloud' },
  unknown: { icon: HelpCircle, tone: 'theme-text-muted', label: 'unknown' },
} as const

const PLACEMENT_HELP: Record<string, string> = {
  gpu: 'Weights fit in VRAM — the fast path.',
  offload: 'Too large for VRAM; Ollama splits layers between GPU and system RAM. It runs, slower.',
  cpu: 'No usable GPU — runs on the CPU from system RAM.',
  none: 'Fits neither VRAM nor system RAM.',
  cloud: "Hosted by Ollama's cloud. Benchmark reference only, never deployed (Rule 1).",
}

function Pill({ children, title, tone = 'muted' }: {
  children: React.ReactNode; title?: string; tone?: 'muted' | 'warn'
}) {
  return (
    <span
      title={title}
      className={`text-[10px] px-1.5 py-0.5 rounded border uppercase tracking-wide shrink-0 ${
        tone === 'warn'
          ? 'border-amber-400/40 text-amber-400/90'
          : 'theme-border theme-text-muted'
      }`}
    >
      {children}
    </span>
  )
}

/** A 0–100 dimension as a labelled bar, so a composite score can be taken apart. */
function Dimension({ label, value, weight }: { label: string; value: number; weight: number }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <span className="text-[10px] uppercase tracking-wide theme-text-muted opacity-70">
          {label}
        </span>
        <span className="text-[10px] font-mono theme-text-muted tabular-nums">
          {value.toFixed(0)} <span className="opacity-50">× {weight.toFixed(2)}</span>
        </span>
      </div>
      <div className="h-1 rounded-full bg-black/30 overflow-hidden">
        <div className="h-full rounded-full theme-bg-primary" style={{ width: `${value}%` }} />
      </div>
    </div>
  )
}

function Row({
  row, busy, onPull, onDelete, onBenchmark, onUse,
}: {
  row: ModelRow
  busy: string | null
  onPull: (row: ModelRow) => void
  onDelete: (row: ModelRow) => void
  onBenchmark: (row: ModelRow) => void
  onUse: (row: ModelRow) => void
}) {
  const [open, setOpen] = useState(false)
  const verdict = VERDICT[row.verdict.fit] ?? VERDICT.unknown
  const VerdictIcon = verdict.icon
  const measured = row.measured
  const isBusy = busy === row.tag

  return (
    <div className="rounded-xl border theme-border bg-black/10 overflow-hidden">
      <div className="flex items-start gap-3 p-3">
        <span className="text-[10px] font-mono theme-text-muted opacity-50 tabular-nums w-5 shrink-0 pt-1">
          {row.score === null ? '—' : row.rank}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium truncate">{row.label}</span>
            <Pill>{row.quantization}</Pill>
            {row.installed && <Pill title="Pulled and on this disk.">installed</Pill>}
            {row.source === 'discovered' && (
              <Pill title="Found in Ollama rather than declared in the catalogue — scored from the parameter count it reports for itself.">
                discovered
              </Pill>
            )}
            {!row.tag_verified && (
              <Pill tone="warn" title="Nobody has confirmed this tag exists in Ollama's registry. If the pull fails, correct it in backend/app/data/model_catalogue.json.">
                tag unverified
              </Pill>
            )}
          </div>
          <code className="text-[10px] theme-text-muted opacity-60 break-all">{row.tag}</code>

          <div className="grid grid-cols-2 @lg:grid-cols-4 gap-x-4 gap-y-1 mt-2">
            {/* ── estimated ── */}
            <div>
              <div className="text-[10px] uppercase tracking-wide theme-text-muted opacity-70">
                Estimated
              </div>
              <div className="text-xs font-mono">
                {row.estimate ? `~${bytes(row.estimate.total_bytes)}` : '—'}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide theme-text-muted opacity-70">
                Fit
              </div>
              <div className={`text-xs flex items-center gap-1 ${verdict.tone}`}>
                <VerdictIcon size={11} className="shrink-0" />
                <span className="truncate">{verdict.label}</span>
                {row.verdict.placement !== 'none' && row.verdict.placement !== 'unknown' && (
                  <span
                    className="theme-text-muted opacity-60 text-[10px]"
                    title={PLACEMENT_HELP[row.verdict.placement]}
                  >
                    {row.verdict.placement}
                  </span>
                )}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide theme-text-muted opacity-70">
                Est. speed
              </div>
              <div className="text-xs font-mono theme-text-muted" title={row.speed?.basis}>
                {row.speed?.tokens_per_sec ? `~${row.speed.tokens_per_sec} tok/s` : '—'}
              </div>
            </div>
            {/* ── measured: deliberately styled apart from the three above ── */}
            <div>
              <div className="text-[10px] uppercase tracking-wide theme-primary opacity-80">
                Measured
              </div>
              {measured?.tokens_per_sec ? (
                <div className="text-xs font-mono theme-text" title={`Benchmarked ${measured.at ?? ''}`}>
                  {measured.time_to_first_token_ms}ms · {measured.tokens_per_sec} tok/s
                </div>
              ) : (
                <div className="text-xs theme-text-muted opacity-50 italic">not benchmarked</div>
              )}
            </div>
          </div>

          {/* The finding, when there is one. */}
          {row.estimate_accuracy && (
            <p
              className="text-[11px] mt-2 text-amber-400/80"
              title="Measured ÷ estimated generation rate. Below 1 means the estimate was optimistic."
            >
              Estimate was {row.estimate_accuracy.ratio < 1 ? 'optimistic' : 'conservative'} —
              measured {row.estimate_accuracy.ratio.toFixed(2)}× the predicted rate.
            </p>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {row.installed ? (
            <>
              <button
                onClick={() => onBenchmark(row)}
                disabled={!!busy}
                title="Measure TTFT and tok/s on a ~2k-token RAG prompt. Takes minutes."
                className="p-1.5 rounded-lg border theme-border theme-text-muted hover:theme-text hover:bg-black/20 transition-colors disabled:opacity-40"
              >
                {isBusy ? <Loader2 size={13} className="animate-spin" /> : <FlaskConical size={13} />}
              </button>
              <button
                onClick={() => onUse(row)}
                disabled={!!busy || row.verdict.fit === 'will_not_fit'}
                title="Pin the deployed model to this one."
                className="px-2 py-1 text-[11px] rounded-lg border theme-border theme-text-muted hover:theme-text hover:bg-black/20 transition-colors disabled:opacity-40"
              >
                Use
              </button>
              <button
                onClick={() => onDelete(row)}
                disabled={!!busy}
                title="Delete from this machine."
                className="p-1.5 rounded-lg border theme-border theme-text-muted hover:text-red-400 hover:border-red-400/40 transition-colors disabled:opacity-40"
              >
                <Trash2 size={13} />
              </button>
            </>
          ) : row.remote ? (
            <Pill title={PLACEMENT_HELP.cloud}>cloud</Pill>
          ) : (
            <button
              onClick={() => onPull(row)}
              disabled={!!busy}
              title={
                row.verdict.fit === 'will_not_fit'
                  ? 'Estimated not to fit this machine — you can still pull it.'
                  : 'Download via Ollama.'
              }
              className="flex items-center gap-1.5 px-2 py-1 text-[11px] rounded-lg border theme-border theme-text-muted hover:theme-text hover:bg-black/20 transition-colors disabled:opacity-40"
            >
              {isBusy ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
              Pull
            </button>
          )}
          <button
            onClick={() => setOpen((v) => !v)}
            title="Show the inputs behind these numbers."
            className="p-1.5 rounded-lg theme-text-muted hover:theme-text transition-colors"
          >
            <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>

      {/* ── the inputs, so the ranking can be checked rather than trusted ── */}
      {open && (
        <div className="border-t theme-border px-3 py-3 bg-black/10 space-y-3">
          {row.estimate ? (
            <div>
              <div className="text-[10px] uppercase tracking-wide theme-text-muted opacity-70 mb-1">
                Memory estimate
              </div>
              <code className="text-[11px] theme-text-muted break-words">{row.estimate.formula}</code>
              <div className="text-[11px] theme-text-muted opacity-60 mt-1">
                weights {row.estimate.weights_source} · KV {row.estimate.kv_source} ·
                {' '}judged against {row.verdict.judged_against ?? '—'}
                {row.verdict.utilisation !== null &&
                  ` · ${(row.verdict.utilisation * 100).toFixed(0)}% of it`}
              </div>
            </div>
          ) : (
            <p className="text-[11px] theme-text-muted">{row.notes ?? 'Not scorable.'}</p>
          )}

          {row.dimensions && row.weights && (
            <div>
              <div className="text-[10px] uppercase tracking-wide theme-text-muted opacity-70 mb-2">
                Score {row.score} — weighted for grounded RAG (PROJECT.md §9.2)
              </div>
              <div className="grid grid-cols-2 @lg:grid-cols-4 gap-3">
                {(['quality', 'speed', 'fit', 'context'] as const).map((k) => (
                  <Dimension key={k} label={k} value={row.dimensions![k]} weight={row.weights![k]} />
                ))}
              </div>
            </div>
          )}

          {row.speed && (
            <div className="text-[11px] theme-text-muted">
              <span className="opacity-70">Speed basis:</span> <code>{row.speed.basis}</code>
            </div>
          )}

          {row.quality_meta && (
            <div className="text-[11px] theme-text-muted">
              <span className="opacity-70">Quality:</span>{' '}
              {row.quality_meta.mmlu !== null ? `MMLU ${row.quality_meta.mmlu}` : 'not set'}
              {row.quality?.quant_penalty ? ` ${row.quality.quant_penalty} for ${row.quantization}` : ''}
              {!row.quality_meta.verified && (
                <span className="text-amber-400/80">
                  {' '}— unverified, check against{' '}
                  <span className="break-all">{row.quality_meta.source}</span>
                </span>
              )}
            </div>
          )}
          {!row.quality_meta && row.source === 'discovered' && (
            <p className="text-[11px] theme-text-muted opacity-70">
              No quality score — this model was discovered, not declared. It is scored at the
              midpoint on that dimension so it competes on fit and speed rather than being
              buried for a figure the catalogue never had.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export function ModelsView({ onCommitted }: { onCommitted?: () => void }) {
  const [table, setTable] = useState<ModelTable | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [progress, setProgress] = useState<PullProgress | null>(null)
  const [cancelPull, setCancelPull] = useState<(() => void) | null>(null)
  const [result, setResult] = useState<BenchmarkResult | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setTable(await modelTable())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'request failed')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const handlePull = useCallback(async (row: ModelRow) => {
    setBusy(row.tag)
    setNotice(null)
    setProgress({ status: 'starting', digest: null, total_bytes: null, completed_bytes: null, percent: null, done: false })
    const { done, cancel } = pullModel(row.tag, setProgress)
    setCancelPull(() => cancel)
    try {
      await done
      setNotice(`Pulled ${row.tag}.`)
      await load()
    } catch (e) {
      // Ollama's own message — "model not found" names the fix, and the
      // catalogue ships tags nobody has verified, so this is not an edge case.
      setNotice(e instanceof Error ? e.message : 'the pull failed')
    } finally {
      setBusy(null)
      setProgress(null)
      setCancelPull(null)
    }
  }, [load])

  const handleDelete = useCallback(async (row: ModelRow) => {
    if (!window.confirm(`Delete ${row.tag} from this machine?`)) return
    setBusy(row.tag)
    try {
      await deleteModel(row.tag)
      setNotice(`Deleted ${row.tag}.`)
      await load()
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'the delete failed')
    } finally {
      setBusy(null)
    }
  }, [load])

  const handleBenchmark = useCallback(async (row: ModelRow) => {
    setBusy(row.tag)
    setNotice(null)
    setResult(null)
    try {
      const measurement = await runBenchmark(row.tag)
      setResult(measurement)
      await load()
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'the benchmark failed')
    } finally {
      setBusy(null)
    }
  }, [load])

  const handleUse = useCallback(async (row: ModelRow) => {
    const { setActiveModel } = await import('../../lib/forgeClient')
    setBusy(row.tag)
    try {
      await setActiveModel({ mode: 'pinned', tag: row.tag, quantization: row.quantization })
      setNotice(`Deployment pinned to ${row.tag}.`)
      onCommitted?.()
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'could not write the config')
    } finally {
      setBusy(null)
    }
  }, [onCommitted])

  if (error) {
    return (
      <div className="flex items-start gap-3 p-4 rounded-xl border border-red-500/30 bg-red-500/10 text-sm">
        <AlertTriangle size={16} className="text-red-400 shrink-0 mt-0.5" />
        <div>
          <div className="font-medium">Couldn't load the model table</div>
          <div className="theme-text-muted text-xs mt-1">{error}</div>
        </div>
      </div>
    )
  }

  if (!table) return <div className="text-sm theme-text-muted">Scoring models…</div>

  const budget = table.budget

  return (
    <div className="space-y-3 animate-in fade-in duration-200">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm theme-text-muted">
          Every candidate estimated against this machine, ranked. The{' '}
          <span className="theme-text">Measured</span> column is the one that counts —
          estimates are placeholders until a benchmark replaces them.
        </p>
        <button
          onClick={() => void load()}
          disabled={!!busy}
          className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border theme-border theme-text-muted hover:theme-text hover:bg-black/20 transition-colors disabled:opacity-50"
        >
          <RefreshCw size={12} />
          Rescore
        </button>
      </div>

      <div className="text-xs theme-text-muted opacity-75">
        Budget: {bytes(budget.vram_available_bytes)} VRAM
        {budget.device ? ` (${budget.device})` : ''} + {bytes(budget.ram_available_bytes)} system RAM.
        KV cache budgeted for a {table.context_tokens.toLocaleString()}-token prompt.
      </div>

      {!table.ollama.available && (
        <div className="flex items-start gap-2 p-3 rounded-xl border border-amber-400/30 bg-amber-400/10 text-xs">
          <AlertTriangle size={14} className="text-amber-400 shrink-0 mt-0.5" />
          <div>
            <div className="font-medium">Ollama isn't reachable — estimates only</div>
            <div className="theme-text-muted mt-0.5">
              {table.ollama.error} Nothing can be pulled, measured or deployed until it answers.
            </div>
          </div>
        </div>
      )}

      {progress && (
        <div className="p-3 rounded-xl border theme-border bg-black/20">
          <div className="flex items-center gap-2 text-xs mb-2">
            <Loader2 size={13} className="animate-spin theme-primary" />
            <span className="truncate flex-1">{progress.status}</span>
            {progress.percent !== null && (
              <span className="font-mono tabular-nums">{progress.percent}%</span>
            )}
            <button
              onClick={() => cancelPull?.()}
              title="Stop. Ollama keeps the layers already downloaded, so resuming won't start over."
              className="p-1 rounded theme-text-muted hover:text-red-400"
            >
              <X size={13} />
            </button>
          </div>
          <div className="h-1.5 rounded-full bg-black/30 overflow-hidden">
            <div
              className="h-full rounded-full theme-bg-primary transition-[width] duration-300"
              style={{ width: `${progress.percent ?? 0}%` }}
            />
          </div>
          {progress.total_bytes && (
            <div className="text-[10px] theme-text-muted mt-1 tabular-nums">
              {bytes(progress.completed_bytes)} of {bytes(progress.total_bytes)}
            </div>
          )}
        </div>
      )}

      {result && (
        <div className="p-3 rounded-xl border theme-border bg-black/20 text-xs space-y-1">
          <div className="flex items-center gap-2">
            <FlaskConical size={13} className="theme-primary" />
            <span className="font-medium">Benchmarked {result.tag}</span>
            <button onClick={() => setResult(null)} className="ml-auto theme-text-muted hover:theme-text">
              <X size={13} />
            </button>
          </div>
          <div className="theme-text-muted">
            {result.time_to_first_token_ms}ms to first token · {result.tokens_per_sec} tok/s ·{' '}
            {result.prompt_token_count} prompt tokens
          </div>
          <div className="theme-text-muted opacity-70">
            Prompt from{' '}
            {result.prompt.source === 'rag_logs' ? (
              <span className="theme-text">a real logged retrieval</span>
            ) : (
              'the bundled fixture'
            )}
            {' · '}
            {result.warmed_up ? 'warmed up first' : 'cold — includes loading the weights'}
            {' · logged as '}
            <code>{result.query_id}</code>
          </div>
        </div>
      )}

      {notice && (
        <div className="flex items-start gap-2 p-2.5 rounded-lg border theme-border bg-black/20 text-xs">
          <span className="flex-1 break-words">{notice}</span>
          <button onClick={() => setNotice(null)} className="theme-text-muted hover:theme-text">
            <X size={12} />
          </button>
        </div>
      )}

      <div className="space-y-2">
        {table.rows.map((row) => (
          <Row
            key={row.id}
            row={row}
            busy={busy}
            onPull={handlePull}
            onDelete={handleDelete}
            onBenchmark={handleBenchmark}
            onUse={handleUse}
          />
        ))}
      </div>
    </div>
  )
}
