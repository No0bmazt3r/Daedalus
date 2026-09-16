import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, ChevronDown, Download, FlaskConical, Loader2, RefreshCw, Trash2,
  CircleCheck, CircleAlert, CircleSlash, Cloud, HelpCircle, X, Search, Cpu, ExternalLink,
  Star, Library, HardDrive, Globe, Terminal, Layers,
} from 'lucide-react'
import {
  modelTable, searchHuggingFace, inspectTag, pullModel, deleteModel, runBenchmark,
  type ModelTable, type ModelRow, type PullProgress, type BenchmarkResult, type ModelSource,
} from '../../lib/forgeClient'
import { Skeleton, SkeletonList } from '../ui/skeleton'

/**
 * Steps 2–5 of the Forge: estimate · score · manage · benchmark.
 *
 * ## The one rule this screen exists to keep
 *
 * `MODULES.md` §2.2: *an estimate and a measurement must never look alike.* The
 * value of this module to the report is the gap between them and how it closes,
 * so every row carries both, styled apart, and "not benchmarked" is a state
 * written in words rather than an empty cell.
 *
 * ## Four lists, one scorer
 *
 * | source | what it is |
 * |---|---|
 * | Shortlist | the six candidates from §8.1 that the report argues about |
 * | Library | the wider verified Ollama library — what else this machine could run |
 * | Installed | what is on this disk, including models nobody declared |
 * | Hugging Face | a live GGUF search, pullable via `hf.co/{repo}:{quant}` |
 *
 * All four are scored by the same code against the same hardware, so a row from
 * one can be compared with a row from another. Only the provenance differs, and
 * every row says which it is.
 *
 * ## Colours
 *
 * Verdicts use the `.status-*` classes, not Tailwind literals. A theme here is
 * an arbitrary accent over an arbitrary background — `status-warn` is fine on
 * a dark surface and nearly invisible on a cream one, which is what happened to
 * the first version of this screen. See `deriveStatusColors` in `lib/themes.ts`.
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
  safe: { icon: CircleCheck, tone: 'status-ok', label: 'safe' },
  marginal: { icon: CircleAlert, tone: 'status-warn', label: 'marginal' },
  will_not_fit: { icon: CircleSlash, tone: 'status-bad', label: 'will not fit' },
  cloud: { icon: Cloud, tone: 'theme-text-muted', label: 'cloud' },
  unknown: { icon: HelpCircle, tone: 'theme-text-muted', label: 'unknown' },
} as const

const PLACEMENT_HELP: Record<string, string> = {
  gpu: 'Weights fit in VRAM. This is the fast path.',
  offload: 'Too large for VRAM, so Ollama splits layers between GPU and system RAM. It runs, just slower.',
  cpu: 'Runs on the CPU from system RAM.',
  none: 'Fits neither VRAM nor system RAM.',
  cloud: "Hosted by Ollama's cloud. Benchmark reference only, never deployed (Rule 1).",
}

const PROVENANCE_HELP: Record<string, string> = {
  declared: 'Arithmetic over a parameter count. Nothing has been run yet.',
  registry: "Real published size from the model's Ollama manifest, known before downloading.",
  measured: 'Real bytes on this disk, read from Ollama.',
  assumed: 'A documented default, because nothing better is available yet.',
}

const SOURCES: {
  id: ModelSource | 'all'
  label: string
  icon: typeof Star
  hint: string
}[] = [
  { id: 'shortlist', label: 'Shortlist', icon: Star, hint: "The six candidates from PROJECT.md §8.1, which are what the report argues about" },
  { id: 'library', label: 'Library', icon: Library, hint: 'The wider Ollama library, every tag verified against the registry' },
  { id: 'installed', label: 'Installed', icon: HardDrive, hint: 'On this disk right now' },
  { id: 'huggingface', label: 'Hugging Face', icon: Globe, hint: 'Live GGUF search. Pull any of these with hf.co/{repo}:{quant}' },
  { id: 'custom', label: 'Custom', icon: Terminal, hint: 'Score a tag you already know: an Ollama tag, or hf.co/{repo}:{quant}' },
  { id: 'all', label: 'All', icon: Layers, hint: 'Everything except the live search' },
]

function Pill({ children, title, tone = 'muted' }: {
  children: React.ReactNode; title?: string; tone?: 'muted' | 'warn' | 'ok'
}) {
  const toneClass =
    tone === 'warn' ? 'status-warn status-warn-border'
      : tone === 'ok' ? 'status-ok status-ok-border'
        : 'theme-border theme-text-muted'
  return (
    <span
      title={title}
      className={`text-[10px] px-1.5 py-0.5 rounded border uppercase tracking-wide shrink-0 ${toneClass}`}
    >
      {children}
    </span>
  )
}

/** One labelled number in the detail panel. */
function Fact({ label, value, hint, mono = true }: {
  label: string; value: React.ReactNode; hint?: string; mono?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-[11px] theme-text-muted shrink-0" title={hint}>
        {label}
      </span>
      <span className={`text-[11px] ${mono ? 'font-mono tabular-nums' : ''} text-right`}>
        {value}
      </span>
    </div>
  )
}

/** A 0–100 dimension with its weight, so a composite can be taken apart. */
function Dimension({ label, value, weight }: { label: string; value: number; weight: number }) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className="text-[11px] theme-text-muted w-14 shrink-0 capitalize">{label}</span>
      <div className="h-1.5 rounded-full theme-track overflow-hidden flex-1 min-w-0">
        <div className="h-full rounded-full theme-bg-primary" style={{ width: `${value}%` }} />
      </div>
      <span className="text-[11px] font-mono tabular-nums w-20 text-right shrink-0 whitespace-nowrap">
        {value.toFixed(0)}
        <span className="theme-text-muted"> ×{weight.toFixed(2)}</span>
      </span>
    </div>
  )
}

function Section({ title, children, right }: {
  title: string; children: React.ReactNode; right?: React.ReactNode
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 mb-1.5">
        <span className="text-[10px] uppercase tracking-widest theme-text-muted">
          {title}
        </span>
        {right}
      </div>
      {children}
    </div>
  )
}

function Detail({ row }: { row: ModelRow }) {
  const est = row.estimate

  if (!est) {
    return (
      <p className="text-[11px] theme-text-muted leading-relaxed">
        {row.notes ?? 'Not scorable, because Ollama reports no parameter count for this model.'}
      </p>
    )
  }

  return (
    <div className="grid grid-cols-1 @2xl:grid-cols-2 gap-x-8 gap-y-4">
      <Section
        title="Memory estimate"
        right={
          <span
            className="text-[10px] theme-text-muted"
            title={PROVENANCE_HELP[est.weights_source]}
          >
            {est.weights_source} weights
          </span>
        }
      >
        <div className="divide-y divide-[color-mix(in_srgb,var(--border)_60%,transparent)]">
          <Fact
            label="Weights"
            value={bytes(est.weights_bytes)}
            hint={PROVENANCE_HELP[est.weights_source]}
          />
          <Fact
            label={`KV cache · ${est.context_tokens.toLocaleString()} tok`}
            value={bytes(est.kv_cache_bytes)}
            hint={`${(est.kv_bytes_per_token / 1024).toFixed(0)} KB per token. ${PROVENANCE_HELP[est.kv_source] ?? est.kv_source}`}
          />
          <Fact label="Runtime overhead" value={bytes(est.runtime_overhead_bytes)} />
          <Fact
            label="Total"
            value={<span className="font-semibold">{bytes(est.total_bytes)}</span>}
          />
        </div>
        {row.verdict.utilisation !== null && (
          <p className="text-[11px] theme-text-muted mt-2">
            {(row.verdict.utilisation * 100).toFixed(0)}% of available{' '}
            {row.verdict.judged_against === 'vram' ? 'VRAM' :
              row.verdict.judged_against === 'vram+ram' ? 'VRAM + system RAM' : 'system RAM'}
            {row.verdict.headroom_bytes !== null && row.verdict.headroom_bytes > 0 &&
              ` · ${bytes(row.verdict.headroom_bytes)} spare`}
          </p>
        )}
      </Section>

      <Section
        title="Score"
        right={
          <span className="text-[11px] font-mono theme-text">
            {row.score ?? '—'}
            <span className="theme-text-muted"> / 100</span>
          </span>
        }
      >
        {row.dimensions && row.weights ? (
          <>
            <div>
              {(['quality', 'speed', 'fit', 'context'] as const).map((k) => (
                <Dimension key={k} label={k} value={row.dimensions![k]} weight={row.weights![k]} />
              ))}
            </div>
            <p className="text-[11px] theme-text-muted mt-2 leading-relaxed">
              Weighted for grounded RAG, using PROJECT.md §9.2's own targets. Hallucination
              rate is the hardest of those to hit, so quality carries the most.
            </p>
          </>
        ) : (
          <p className="text-[11px] theme-text-muted">Not scored.</p>
        )}
      </Section>

      <Section title="Speed estimate">
        <p className="text-[11px] theme-text-muted leading-relaxed">
          <code className="theme-text">{row.speed?.basis}</code>
          <br />
          Generation is memory-bound (every weight gets read once per token), so throughput
          tracks bandwidth ÷ model size.
        </p>
      </Section>

      <Section title="Quality">
        {row.quality_meta?.mmlu != null ? (
          <p className="text-[11px] theme-text-muted leading-relaxed">
            MMLU {row.quality_meta.mmlu}
            {row.quality?.quant_penalty ? ` ${row.quality.quant_penalty} for ${row.quantization}` : ''}
            {row.quality?.effective_mmlu != null && ` = ${row.quality.effective_mmlu} effective`}
            {!row.quality_meta.verified && (
              <>
                <br />
                <span className="status-warn">Unverified.</span>
                <span> Check it against </span>
                <span className="break-all">{row.quality_meta.source}</span>
              </>
            )}
          </p>
        ) : (
          <p className="text-[11px] theme-text-muted leading-relaxed">
            No capability score, because this model was never declared in the catalogue. It
            scores from a neutral baseline with the {row.quantization} penalty applied, so it
            still ranks correctly against other unscored models without claiming a figure
            nobody has measured.
          </p>
        )}
      </Section>

      {row.hf && (
        <Section title="Hugging Face">
          <div className="divide-y divide-[color-mix(in_srgb,var(--border)_60%,transparent)]">
            <Fact label="Repository" value={row.hf.repo} mono={false} />
            <Fact label="Architecture" value={row.hf.architecture ?? '—'} />
            <Fact label="Downloads" value={row.hf.downloads?.toLocaleString() ?? '—'} />
          </div>
          <a
            href={row.hf.url}
            target="_blank"
            rel="noreferrer noopener"
            className="text-[11px] theme-accent hover:underline inline-flex items-center gap-1 mt-2"
          >
            Open on Hugging Face <ExternalLink size={10} />
          </a>
        </Section>
      )}
    </div>
  )
}

function Row({
  row, busy, onPull, onDelete, onBenchmark,
}: {
  row: ModelRow
  busy: string | null
  onPull: (row: ModelRow) => void
  onDelete: (row: ModelRow) => void
  onBenchmark: (row: ModelRow) => void
}) {
  const [open, setOpen] = useState(false)
  const verdict = VERDICT[row.verdict.fit] ?? VERDICT.unknown
  const VerdictIcon = verdict.icon
  const measured = row.measured
  const isBusy = busy === row.tag

  return (
    <div className="rounded-xl border theme-border theme-surface overflow-hidden">
      <div className="flex items-start gap-3 p-3">
        <span className="text-[11px] font-mono theme-text-muted tabular-nums w-5 shrink-0 pt-0.5">
          {row.score === null ? '—' : row.rank}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium truncate">{row.label}</span>
            <Pill title={`Quantization: ${row.quantization_known ? 'width is tabulated' : 'width inferred from the name'}`}>
              {row.quantization}
            </Pill>
            {row.shortlist && <Pill tone="ok" title="One of the six candidates PROJECT.md §8.1 names.">shortlist</Pill>}
            {row.installed && <Pill tone="ok" title="Pulled and on this disk.">installed</Pill>}
            {row.tag_exists === false && (
              <Pill tone="warn" title="The Ollama registry has no manifest for this tag, so a pull would fail.">
                tag missing
              </Pill>
            )}
          </div>
          <code className="text-[10px] theme-text-muted break-all">{row.tag}</code>

          <div className="grid grid-cols-2 @lg:grid-cols-4 gap-x-4 gap-y-1 mt-2">
            <div>
              <div className="text-[10px] uppercase tracking-wide theme-text-muted">
                Estimated
              </div>
              <div className="text-xs font-mono" title={row.estimate?.formula}>
                {row.estimate ? `${row.estimate.weights_source === 'declared' ? '~' : ''}${bytes(row.estimate.total_bytes)}` : '—'}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide theme-text-muted">Fit</div>
              <div className={`text-xs flex items-center gap-1 ${verdict.tone}`}>
                <VerdictIcon size={11} className="shrink-0" />
                <span className="truncate">{verdict.label}</span>
                {row.verdict.placement !== 'none' && row.verdict.placement !== 'unknown' && (
                  <span
                    className="theme-text-muted text-[10px]"
                    title={PLACEMENT_HELP[row.verdict.placement]}
                  >
                    {row.verdict.placement}
                  </span>
                )}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide theme-text-muted">
                Est. speed
              </div>
              <div className="text-xs font-mono theme-text-muted" title={row.speed?.basis}>
                {row.speed?.tokens_per_sec ? `~${row.speed.tokens_per_sec} tok/s` : '—'}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide theme-accent">
                Measured
              </div>
              {measured?.tokens_per_sec ? (
                <div className="text-xs font-mono theme-text" title={`Benchmarked ${measured.at ?? ''}`}>
                  {measured.time_to_first_token_ms}ms · {measured.tokens_per_sec} tok/s
                </div>
              ) : (
                <div className="text-xs theme-text-muted italic">not benchmarked</div>
              )}
            </div>
          </div>

          {row.estimate_accuracy && (
            <p
              className="text-[11px] mt-2 status-warn"
              title="Measured ÷ estimated generation rate. Below 1 means the estimate was optimistic."
            >
              Estimate was {row.estimate_accuracy.ratio < 1 ? 'optimistic' : 'conservative'}:
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
                className="p-1.5 rounded-lg border theme-border theme-text-muted hover:theme-text hover:bg-[color-mix(in_srgb,var(--text-main)_9%,transparent)] transition-colors disabled:opacity-40"
              >
                {isBusy ? <Loader2 size={13} className="animate-spin" /> : <FlaskConical size={13} />}
              </button>
              <button
                onClick={() => onDelete(row)}
                disabled={!!busy}
                title="Delete from this machine."
                className="p-1.5 rounded-lg border theme-border theme-text-muted hover:text-[var(--status-bad)] hover:border-[color-mix(in_srgb,var(--status-bad)_45%,transparent)] transition-colors disabled:opacity-40"
              >
                <Trash2 size={13} />
              </button>
            </>
          ) : row.remote ? (
            <Pill title={PLACEMENT_HELP.cloud}>cloud</Pill>
          ) : (
            <button
              onClick={() => onPull(row)}
              disabled={!!busy || row.tag_exists === false}
              title={
                row.tag_exists === false
                  ? 'The registry has no manifest for this tag.'
                  : row.verdict.fit === 'will_not_fit'
                    ? 'Estimated not to fit, though you can still pull it.'
                    : `Download via Ollama${row.download_bytes ? ` (${bytes(row.download_bytes)})` : ''}.`
              }
              className="flex items-center gap-1.5 px-2 py-1 text-[11px] rounded-lg border theme-border theme-text-muted hover:theme-text hover:bg-[color-mix(in_srgb,var(--text-main)_9%,transparent)] transition-colors disabled:opacity-40"
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

      {open && (
        <div className="border-t theme-border px-4 py-4 theme-surface animate-in fade-in slide-in-from-top-1 duration-200 ease-out">
          <Detail row={row} />
        </div>
      )}
    </div>
  )
}

export function ModelsView() {
  const [table, setTable] = useState<ModelTable | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [progress, setProgress] = useState<PullProgress | null>(null)
  const [cancelPull, setCancelPull] = useState<(() => void) | null>(null)
  const [result, setResult] = useState<BenchmarkResult | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // ── filters ──
  const [source, setSource] = useState<ModelSource | 'all'>('shortlist')
  const [search, setSearch] = useState('')
  const [tier, setTier] = useState<'all' | 'slm' | 'llm'>('all')
  const [runnableOnly, setRunnableOnly] = useState(false)

  // ── Hugging Face is its own fetch: it needs the network and can fail ──
  const [hfRows, setHfRows] = useState<ModelRow[] | null>(null)
  const [hfError, setHfError] = useState<string | null>(null)
  const [hfLoading, setHfLoading] = useState(false)

  // ── Custom: one tag, typed and scored on demand ──
  const [customTag, setCustomTag] = useState('')
  const [customRow, setCustomRow] = useState<ModelRow | null>(null)
  const [customError, setCustomError] = useState<string | null>(null)
  const [customLoading, setCustomLoading] = useState(false)

  const inspect = useCallback(async () => {
    const tag = customTag.trim()
    if (!tag) return
    setCustomLoading(true)
    setCustomError(null)
    try {
      const res = await inspectTag(tag)
      setCustomRow(res.row)
      setCustomError(res.error)
    } catch (e) {
      setCustomError(e instanceof Error ? e.message : 'lookup failed')
      setCustomRow(null)
    } finally {
      setCustomLoading(false)
    }
  }, [customTag])

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

  // Debounced, because this hits Hugging Face and the box is typed into.
  useEffect(() => {
    if (source !== 'huggingface') return
    let cancelled = false
    setHfLoading(true)
    const timer = window.setTimeout(async () => {
      try {
        const res = await searchHuggingFace(search)
        if (cancelled) return
        setHfRows(res.rows)
        setHfError(res.error)
      } catch (e) {
        if (!cancelled) setHfError(e instanceof Error ? e.message : 'search failed')
      } finally {
        if (!cancelled) setHfLoading(false)
      }
    }, 350)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [source, search])

  const visible = useMemo(() => {
    if (source === 'custom') return customRow ? [customRow] : []
    const base = source === 'huggingface' ? (hfRows ?? []) : (table?.rows ?? [])
    const needle = search.trim().toLowerCase()
    return base.filter((row) => {
      if (source !== 'all' && source !== 'huggingface' && row.source !== source) return false
      // The HF list is already the result of a server-side search; filtering it
      // again by the same box would hide rows the search deliberately matched
      // on a field this one does not see.
      if (needle && source !== 'huggingface') {
        const hay = `${row.label} ${row.tag} ${row.vendor ?? ''} ${row.kind}`.toLowerCase()
        if (!hay.includes(needle)) return false
      }
      if (tier !== 'all' && row.tier !== tier) return false
      if (runnableOnly && !['safe', 'marginal'].includes(row.verdict.fit)) return false
      return true
    })
  }, [source, hfRows, customRow, table?.rows, search, tier, runnableOnly])

  const counts = useMemo(() => {
    const rows = table?.rows ?? []
    return {
      shortlist: rows.filter((r) => r.source === 'shortlist').length,
      library: rows.filter((r) => r.source === 'library').length,
      installed: rows.filter((r) => r.source === 'installed').length,
      all: rows.length,
      huggingface: hfRows?.length ?? 0,
      custom: customRow ? 1 : 0,
    } as Record<string, number>
  }, [table?.rows, hfRows, customRow])

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
      setResult(await runBenchmark(row.tag))
      await load()
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'the benchmark failed')
    } finally {
      setBusy(null)
    }
  }, [load])

  if (error) {
    return (
      <div className="flex items-start gap-3 p-4 rounded-xl border status-bad-border status-bad-bg text-sm">
        <AlertTriangle size={16} className="status-bad shrink-0 mt-0.5" />
        <div>
          <div className="font-medium">Couldn't load the model table</div>
          <div className="theme-text-muted text-xs mt-1">{error}</div>
        </div>
      </div>
    )
  }

  if (!table) {
    return (
      <div className="space-y-3" role="status" aria-busy="true" aria-live="polite">
        <span className="sr-only">Scoring models against this machine</span>
        <div className="flex items-start justify-between gap-4">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-7 w-24 rounded-lg shrink-0" />
        </div>
        <Skeleton className="h-3 w-3/4" />
        <div className="flex gap-2 pb-2 border-b theme-border">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-6 w-20 rounded-lg" />
          ))}
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-7 flex-1 rounded-lg" />
          <Skeleton className="h-7 w-20 rounded-lg" />
          <Skeleton className="h-7 w-14 rounded-lg" />
        </div>
        <SkeletonList rows={5} label="Scoring models" />
      </div>
    )
  }

  const budget = table.budget
  const chip = (active: boolean) =>
    `px-2.5 py-1 text-[11px] rounded-lg border transition-colors ${
      active
        ? 'theme-accent-border theme-accent theme-surface-strong'
        : 'theme-border theme-text-muted hover:theme-text'
    }`

  return (
    <div className="space-y-3 animate-in fade-in duration-200">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm theme-text-muted">
          Every candidate estimated against this machine, ranked. The{' '}
          <span className="theme-text">Measured</span> column is the one that counts.
          Estimates are placeholders until a benchmark replaces them.
        </p>
        <button
          onClick={() => void load()}
          disabled={!!busy}
          className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border theme-border theme-text-muted hover:theme-text hover:bg-[color-mix(in_srgb,var(--text-main)_9%,transparent)] transition-colors disabled:"
        >
          <RefreshCw size={12} />
          Rescore
        </button>
      </div>

      {/* ── what every verdict below is judged against ── */}
      <div className="flex items-center gap-2 flex-wrap text-xs theme-text-muted">
        <Cpu size={12} className="shrink-0" />
        <span>
          {budget.vram_available_bytes
            ? `${bytes(budget.vram_available_bytes)} VRAM${budget.device ? ` (${budget.device})` : ''} + ${bytes(budget.ram_available_bytes)} system RAM`
            : `${bytes(budget.ram_available_bytes)} system RAM. No GPU, so everything runs on the CPU`}
          {' · KV budgeted for '}{table.context_tokens.toLocaleString()} tokens
        </span>
      </div>

      {/* ── source tabs ── */}
      <div className="flex items-center gap-1 flex-wrap border-b theme-border pb-2">
        {SOURCES.map((entry) => {
          const selected = source === entry.id
          return (
            <button
              key={entry.id}
              onClick={() => setSource(entry.id)}
              title={entry.hint}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded-lg transition-colors ${
                selected ? 'theme-accent theme-surface-strong' : 'theme-text-muted hover:theme-text'
              }`}
            >
              <entry.icon
                key={selected ? 'on' : 'off'}
                size={12}
                className={`tab-icon shrink-0 ${selected ? 'tab-icon-active' : ''}`}
              />
              {entry.label}
              <span className="theme-text-muted tabular-nums">
                {entry.id === 'huggingface' && hfRows === null ? '' : counts[entry.id] ?? 0}
              </span>
            </button>
          )
        })}
      </div>

      {/* ── filters ── */}
      {source === 'custom' ? (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <input
              value={customTag}
              onChange={(e) => setCustomTag(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void inspect()}
              placeholder="qwen3:30b  ·  hf.co/bartowski/Llama-3.2-1B-Instruct-GGUF:Q4_K_M"
              spellCheck={false}
              className="flex-1 min-w-0 px-2.5 py-1.5 text-[11px] font-mono rounded-lg border theme-border theme-surface theme-text placeholder:theme-text-muted placeholder: focus:outline-none focus:theme-accent-border"
            />
            <button
              onClick={() => void inspect()}
              disabled={customLoading || !customTag.trim()}
              className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-[11px] rounded-lg border theme-border theme-text-muted hover:theme-text hover:bg-[color-mix(in_srgb,var(--text-main)_9%,transparent)] transition-colors disabled:opacity-40"
            >
              {customLoading ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
              Check fit
            </button>
          </div>
          <p className="text-[11px] theme-text-muted">
            Any tag Ollama would accept. Library tags resolve through Ollama's registry;
            <code className="theme-text"> hf.co/…</code> tags resolve through Hugging Face.
            Either way it is scored against this machine like everything else.
          </p>
          {customError && (
            <div className="flex items-start gap-2 p-2.5 rounded-lg border status-warn-border status-warn-bg text-[11px]">
              <AlertTriangle size={13} className="status-warn shrink-0 mt-0.5" />
              <span className="break-words">{customError}</span>
            </div>
          )}
        </div>
      ) : (
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 theme-text-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={source === 'huggingface' ? 'Search Hugging Face…' : 'Filter by name, tag or vendor…'}
            className="w-full pl-7 pr-2 py-1.5 text-[11px] rounded-lg border theme-border theme-surface theme-text placeholder:theme-text-muted placeholder: focus:outline-none focus:theme-accent-border"
          />
        </div>
        {(['all', 'slm', 'llm'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTier(t)}
            title={
              t === 'slm' ? 'Small language models, 4B parameters and under'
                : t === 'llm' ? 'Larger local models, above 4B'
                  : 'Both sizes'
            }
            className={chip(tier === t)}
          >
            {t === 'all' ? 'Any size' : t.toUpperCase()}
          </button>
        ))}
        <button
          onClick={() => setRunnableOnly((v) => !v)}
          title="Hide anything estimated not to fit this machine."
          className={chip(runnableOnly)}
        >
          Runnable only
        </button>
      </div>
      )}

      {!table.ollama.available && (
        <div className="flex items-start gap-2 p-3 rounded-xl border status-warn-border status-warn-bg text-xs">
          <AlertTriangle size={14} className="status-warn shrink-0 mt-0.5" />
          <div>
            <div className="font-medium">Ollama isn't reachable, so these are estimates only</div>
            <div className="theme-text-muted mt-0.5">
              {table.ollama.error} Nothing can be pulled, measured or deployed until it answers.
            </div>
          </div>
        </div>
      )}

      {source === 'huggingface' && hfError && (
        <div className="flex items-start gap-2 p-3 rounded-xl border status-warn-border status-warn-bg text-xs">
          <AlertTriangle size={14} className="status-warn shrink-0 mt-0.5" />
          <div>
            <div className="font-medium">Hugging Face search unavailable</div>
            <div className="theme-text-muted mt-0.5">
              {hfError} The other three lists work offline.
            </div>
          </div>
        </div>
      )}

      {progress && (
        <div className="p-3 rounded-xl border theme-border theme-surface-strong">
          <div className="flex items-center gap-2 text-xs mb-2">
            <Loader2 size={13} className="animate-spin theme-accent" />
            <span className="truncate flex-1">{progress.status}</span>
            {progress.percent !== null && (
              <span className="font-mono tabular-nums">{progress.percent}%</span>
            )}
            <button
              onClick={() => cancelPull?.()}
              title="Stop. Ollama keeps the layers already downloaded, so resuming won't start over."
              className="p-1 rounded theme-text-muted hover:text-[var(--status-bad)]"
            >
              <X size={13} />
            </button>
          </div>
          <div className="h-1.5 rounded-full theme-track overflow-hidden">
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
        <div className="p-3 rounded-xl border theme-border theme-surface-strong text-xs space-y-1">
          <div className="flex items-center gap-2">
            <FlaskConical size={13} className="theme-accent" />
            <span className="font-medium">Benchmarked {result.tag}</span>
            <button onClick={() => setResult(null)} className="ml-auto theme-text-muted hover:theme-text">
              <X size={13} />
            </button>
          </div>
          <div className="theme-text-muted">
            {result.time_to_first_token_ms}ms to first token · {result.tokens_per_sec} tok/s ·{' '}
            {result.prompt_token_count} prompt tokens
          </div>
          <div className="theme-text-muted">
            Prompt from{' '}
            {result.prompt.source === 'rag_logs' ? (
              <span className="theme-text">a real logged retrieval</span>
            ) : (
              'the bundled fixture'
            )}
            {' · '}
            {result.warmed_up ? 'warmed up first' : 'cold, so it includes loading the weights'}
            {' · logged as '}
            <code>{result.query_id}</code>
          </div>
        </div>
      )}

      {notice && (
        <div className="flex items-start gap-2 p-2.5 rounded-lg border theme-border theme-surface-strong text-xs">
          <span className="flex-1 break-words">{notice}</span>
          <button onClick={() => setNotice(null)} className="theme-text-muted hover:theme-text">
            <X size={12} />
          </button>
        </div>
      )}

      {/* Keyed on the source so switching lists replays the entry animation
          instead of swapping rows in place. */}
      <div key={source} className="space-y-2 animate-in fade-in slide-in-from-bottom-1 duration-300 ease-out">
        {hfLoading && source === 'huggingface' && (
          <>
            <div className="flex items-center gap-2 text-xs theme-text-muted py-2">
              <Loader2 size={13} className="animate-spin" />
              Searching Hugging Face…
            </div>
            <SkeletonList rows={4} label="Searching Hugging Face" />
          </>
        )}
        {visible.map((row) => (
          <Row
            key={row.id}
            row={row}
            busy={busy}
            onPull={handlePull}
            onDelete={handleDelete}
            onBenchmark={handleBenchmark}
          />
        ))}
        {customLoading && source === 'custom' && <SkeletonList rows={1} label="Checking the tag" />}
        {!visible.length && !hfLoading && !customLoading && (
          <p className="text-xs theme-text-muted py-6 text-center">
            {source === 'custom'
              ? 'Type a model tag above to score it against this machine.'
              : `Nothing matches these filters.${runnableOnly ? ' Try turning off "Runnable only".' : ''}`}
          </p>
        )}
      </div>
    </div>
  )
}
