import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, ArrowLeft, Cloud, Cpu, ExternalLink, FlaskConical, Loader2, Plus,
  RefreshCw, Trash2, X, CircleCheck, CircleAlert, CircleSlash, HelpCircle, Activity,
  Settings2,
} from 'lucide-react'
import {
  modelTable, modelUsage, deleteModel, runBenchmark,
  type ModelRow, type BenchmarkResult, type BenchmarkProgress, type ModelUsage,
} from '../../lib/forgeClient'
import { ModelEndpointsPanel } from '../settings/ModelEndpointsPanel'
import { listEndpoints, type ModelEndpoint } from '../../lib/systemClient'
import { CapabilityBadges } from '../ui/capability-badges'
import { SkeletonList } from '../ui/skeleton'

/**
 * The model manager: what this machine has, and what it has been doing.
 *
 * ## Local and cloud are the two panes, SLM and LLM are a label
 *
 * An earlier version made "Production SLM" and "Local LLM" separate panes, which
 * put the wrong thing in the navigation. §8.1 marks only the *cloud* tier "never
 * deployed" — both local tiers are real answering models, and the composer's
 * picker already offers every installed local model whatever its size. So the
 * boundary that deserves to be a pane is local vs cloud, and SLM vs LLM is a
 * property of a model you can see and filter on.
 *
 * ## Usage, not just inventory
 *
 * A manager that only lists what is installed answers half the question. The
 * other half is what has actually run, which `model_logs` already knows:
 * run counts split by benchmark and chat, token totals, and latency as mean,
 * p50 and p95 — the three `PROJECT.md` §9.2 asks for by name. A mean on its own
 * hides the tail, and on the development machine mean TTFT ran at roughly twice
 * p50 because of a handful of cold loads.
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

function count(n: number | null | undefined): string {
  if (!n) return '0'
  if (n < 1000) return String(n)
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`
  return `${(n / 1_000_000).toFixed(1)}M`
}

function ms(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${Math.round(n)}ms`
}

function since(iso: string | null): string {
  if (!iso) return 'never'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return 'never'
  const secs = (Date.now() - then) / 1000
  if (secs < 60) return 'just now'
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`
  return `${Math.round(secs / 86400)}d ago`
}

const VERDICT = {
  safe: { icon: CircleCheck, tone: 'status-ok', label: 'safe' },
  marginal: { icon: CircleAlert, tone: 'status-warn', label: 'marginal' },
  will_not_fit: { icon: CircleSlash, tone: 'status-bad', label: 'will not fit' },
  cloud: { icon: Cloud, tone: 'theme-text-muted', label: 'cloud' },
  unknown: { icon: HelpCircle, tone: 'theme-text-muted', label: 'unknown' },
} as const

function Pill({ children, title, tone = 'muted' }: {
  children: React.ReactNode; title?: string; tone?: 'muted' | 'accent'
}) {
  return (
    <span
      title={title}
      className={`text-[10px] px-1.5 py-0.5 rounded border uppercase tracking-wide shrink-0 ${
        tone === 'accent' ? 'theme-accent theme-accent-border' : 'theme-border theme-text-muted'
      }`}
    >
      {children}
    </span>
  )
}

function Stat({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="min-w-0" title={title}>
      <div className="text-[10px] uppercase tracking-wide theme-text-muted truncate">{label}</div>
      <div className="text-xs font-mono tabular-nums truncate">{value}</div>
    </div>
  )
}

/** One Ollama cloud tag: usable as a baseline, never as a deployment target. */
function CloudModel({
  row, usage, busy, benchProgress, signinUrl, lastError, onBenchmark,
}: {
  row: ModelRow
  usage: ModelUsage | undefined
  busy: string | null
  benchProgress?: BenchmarkProgress | null
  /** Live only: Ollama returns it with the refusal, and it is never stored. */
  signinUrl: string | null
  /** Why the last run failed, as Ollama put it. Cleared on the next attempt. */
  lastError: string | null
  onBenchmark: (row: ModelRow) => void
}) {
  const isBusy = busy === row.tag
  const measured = row.measured

  return (
    <div className="rounded-xl border theme-border theme-surface overflow-hidden">
      <div className="flex items-start gap-3 p-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium truncate">{row.label}</span>
            <Pill title="Served from Ollama's cloud. Not on this disk.">cloud</Pill>
            {row.quantization && <Pill>{row.quantization}</Pill>}
            <CapabilityBadges capabilities={row.capabilities} />
          </div>
          <code className="text-[10px] theme-text-muted break-all">{row.tag}</code>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => onBenchmark(row)}
            disabled={!!busy}
            title="Benchmark as a baseline — runs on Ollama's servers, logged apart"
            className="p-1.5 rounded-lg border theme-border theme-text-muted hover:theme-text hover:bg-[color-mix(in_srgb,var(--text-main)_9%,transparent)] transition-colors disabled:opacity-40"
          >
            {isBusy ? <Loader2 size={13} className="animate-spin" /> : <FlaskConical size={13} />}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 @lg:grid-cols-4 gap-x-4 gap-y-2 px-3 pb-3">
        <Stat label="Parameters" value={row.params_b ? `${row.params_b}B` : '—'} />
        <Stat label="On disk" value="—" title="Nothing is stored locally: the tag is a pointer." />
        <Stat label="Runs" value={usage ? count(usage.runs) : '0'} />
        <Stat label="Last used" value={usage ? since(usage.last_used) : 'never'} />
      </div>

      {isBusy && benchProgress ? (
        <div className="border-t theme-border px-3 py-2.5 text-[11px] font-mono theme-text-muted animate-pulse">
          {benchProgress.phase === 'building_prompt' && 'Building fixture prompt...'}
          {benchProgress.phase === 'warming_up' && 'Warming up...'}
          {benchProgress.phase === 'generating' && `Measuring: ${benchProgress.tokens ?? 0} tokens`}
          {benchProgress.phase === 'error' && <span className="status-bad">Failed</span>}
          {benchProgress.phase === 'done' && 'Saving...'}
        </div>
      ) : measured?.tokens_per_sec ? (
        <div className="border-t theme-border px-3 py-2.5">
          <div className="flex items-center gap-1.5 mb-2">
            <Activity size={11} className="theme-accent" />
            <span className="text-[10px] uppercase tracking-wide theme-text-muted">
              Baseline — Ollama's hardware, not this machine
              {measured.rate_source === 'wall_clock' && ' · rate approximate'}
            </span>
          </div>
          <div className="grid grid-cols-2 @lg:grid-cols-4 gap-x-4 gap-y-2">
            <Stat label="TTFT" value={ms(measured.time_to_first_token_ms)} />
            <Stat label="End-to-end" value={ms(measured.total_inference_ms)} />
            <Stat
              label="Generation"
              value={
                measured.rate_source === 'engine'
                  ? `${measured.tokens_per_sec} tok/s`
                  : `~${measured.tokens_per_sec} tok/s`
              }
              title={
                measured.rate_source === 'engine'
                  ? "Engine-reported — a property of the model"
                  : 'Wall-clock estimate: no engine counters from the cloud, so this is '
                    + 'not a trustworthy rate. TTFT and end-to-end are sound.'
              }
            />
            <Stat label="Measured" value={since(measured.at ?? null)} />
          </div>
        </div>
      ) : usage && usage.errors > 0 ? (
        // A failed attempt still writes a `model_logs` row, so it counts as a
        // run above. Saying only "not benchmarked" next to "1 run, just now"
        // reads as a broken panel rather than a rejected request.
        <div className="border-t theme-border px-3 py-2.5 text-[11px] status-warn flex items-start gap-1.5">
          <CircleAlert size={12} className="shrink-0 mt-px" />
          <span>
            Last run failed ({usage.errors} of {usage.runs}).
            {/* Ollama's own words. Not being signed in is only one of the ways
                this fails — a free account that has spent its five-hour or
                weekly window gets a 429 and is already linked, so telling it
                to sign in would send somebody to fix a thing that is not
                broken. The signin offer appears only when Ollama asked for it. */}
            {lastError ? <> <span className="font-mono">{lastError}</span></> : null}
            {signinUrl ? (
              // Handed back with the refusal, key already in it, so there is
              // nothing to type. Gone on reload by design — it is a capability,
              // not a setting, and is never persisted.
              <>
                {' '}
                <a
                  href={signinUrl}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-1 underline theme-accent"
                >
                  Sign in to Ollama
                  <ExternalLink size={10} />
                </a>
                {' '}— free — then try again.
              </>
            ) : lastError ? (
              <> Try again once that clears.</>
            ) : (
              <> Run it again to see why.</>
            )}
          </span>
        </div>
      ) : (
        <div className="border-t theme-border px-3 py-2.5 text-[11px] theme-text-muted italic">
          Not benchmarked yet. Needs <code>ollama signin</code> first.
        </div>
      )}
    </div>
  )
}

/** One configured API provider. Listed here, edited in the endpoints panel. */
function ApiEndpoint({ ep, onManage }: { ep: ModelEndpoint; onManage: () => void }) {
  const ok = ep.last_test_ok
  return (
    <div className="rounded-xl border theme-border theme-surface p-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium truncate">{ep.label}</span>
            <Pill>{ep.provider}</Pill>
            {!ep.enabled && <Pill title="Configured but switched off.">disabled</Pill>}
            <span
              className={`text-[11px] flex items-center gap-1 ${
                ok === null ? 'theme-text-muted' : ok ? 'status-ok' : 'status-bad'
              }`}
              title={ep.last_test_detail ?? 'Never tested.'}
            >
              {ok === null ? <HelpCircle size={11} /> : ok ? <CircleCheck size={11} /> : <CircleAlert size={11} />}
              {ok === null ? 'untested' : ok ? 'reachable' : 'failed'}
            </span>
          </div>
          <code className="text-[10px] theme-text-muted break-all">{ep.base_url}</code>
        </div>
        <button
          onClick={onManage}
          title="Test, edit or remove this endpoint."
          className="shrink-0 p-1.5 rounded-lg border theme-border theme-text-muted hover:theme-text hover:bg-[color-mix(in_srgb,var(--text-main)_9%,transparent)] transition-colors"
        >
          <Settings2 size={13} />
        </button>
      </div>
      <div className="grid grid-cols-2 @lg:grid-cols-3 gap-x-4 gap-y-2 mt-3">
        <Stat label="Key" value={ep.has_key ? (ep.key_hint ?? 'set') : 'none'} />
        <Stat label="Purpose" value={ep.purpose} title="The store rejects any value but 'benchmark'." />
        <Stat label="Last tested" value={since(ep.last_tested_at)} />
      </div>
    </div>
  )
}

function LocalModel({
  row, usage, busy, benchProgress, onBenchmark, onDelete,
}: {
  row: ModelRow
  usage: ModelUsage | undefined
  busy: string | null
  benchProgress?: BenchmarkProgress | null
  onBenchmark: (row: ModelRow) => void
  onDelete: (row: ModelRow) => void
}) {
  const verdict = VERDICT[row.verdict.fit] ?? VERDICT.unknown
  const VerdictIcon = verdict.icon
  const isBusy = busy === row.tag
  const isSlm = row.tier === 'slm'

  return (
    <div className="rounded-xl border theme-border theme-surface overflow-hidden">
      <div className="flex items-start gap-3 p-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium truncate">{row.label}</span>
            <Pill
              tone="accent"
              title={
                isSlm
                  ? 'Small language model, 4B parameters and under. Fast enough for interactive use on modest hardware.'
                  : 'Larger local model, above 4B. More accurate, slower, and equally available to the assistant.'
              }
            >
              {isSlm ? 'SLM' : 'LLM'}
            </Pill>
            <Pill>{row.quantization}</Pill>
            <CapabilityBadges capabilities={row.capabilities} />
            <span className={`text-[11px] flex items-center gap-1 ${verdict.tone}`}>
              <VerdictIcon size={11} />
              {verdict.label}
              <span className="theme-text-muted text-[10px]">{row.verdict.placement}</span>
            </span>
          </div>
          <code className="text-[10px] theme-text-muted break-all">{row.tag}</code>
        </div>

        <div className="flex items-center gap-1 shrink-0">
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
        </div>
      </div>

      <div className="grid grid-cols-2 @lg:grid-cols-4 gap-x-4 gap-y-2 px-3 pb-3">
        <Stat label="On disk" value={bytes(row.size_bytes)} />
        <Stat
          label="Context"
          value={row.context_length ? `${(row.context_length / 1024).toFixed(0)}K` : '—'}
        />
        <Stat
          label="Runs"
          value={usage ? String(usage.runs) : '0'}
          title={
            usage
              ? Object.entries(usage.by_source).map(([k, v]) => `${v} ${k}`).join(' · ')
              : 'Nothing logged yet'
          }
        />
        <Stat label="Last used" value={usage ? since(usage.last_used) : 'never'} />
      </div>

      {isBusy && benchProgress ? (
        <div className="border-t theme-border px-3 py-2.5 text-[11px] font-mono theme-text-muted animate-pulse">
          {benchProgress.phase === 'building_prompt' && 'Building prompt...'}
          {benchProgress.phase === 'warming_up' && 'Warming up...'}
          {benchProgress.phase === 'generating' && `Measuring: ${benchProgress.tokens ?? 0} tokens`}
          {benchProgress.phase === 'error' && <span className="status-bad">Failed</span>}
          {benchProgress.phase === 'done' && 'Saving...'}
        </div>
      ) : usage && usage.runs > 0 ? (
        <div className="border-t theme-border px-3 py-2.5">
          <div className="flex items-center gap-1.5 mb-2">
            <Activity size={11} className="theme-accent" />
            <span className="text-[10px] uppercase tracking-widest theme-text-muted">
              Measured over {usage.runs} run{usage.runs === 1 ? '' : 's'}
            </span>
            {usage.errors > 0 && (
              <span className="text-[10px] status-warn ml-auto">
                {usage.errors} failed
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 @lg:grid-cols-4 gap-x-4 gap-y-2">
            <Stat
              label="TTFT p50"
              value={ms(usage.time_to_first_token_ms.p50)}
              title={`mean ${ms(usage.time_to_first_token_ms.mean)} · p95 ${ms(usage.time_to_first_token_ms.p95)}`}
            />
            <Stat
              label="TTFT p95"
              value={ms(usage.time_to_first_token_ms.p95)}
              title="The number that says whether an operator ever waits. §9.2 asks for it by name."
            />
            <Stat
              label="End-to-end p50"
              value={ms(usage.total_inference_ms.p50)}
              title={`mean ${ms(usage.total_inference_ms.mean)} · p95 ${ms(usage.total_inference_ms.p95)}`}
            />
            <Stat
              label="Generation"
              value={usage.tokens_per_sec.p50 ? `${usage.tokens_per_sec.p50} tok/s` : '—'}
              title="From the engine's own counters, so it measures the model rather than the machine's other work."
            />
          </div>
          <div className="text-[10px] theme-text-muted mt-2 tabular-nums">
            {count(usage.prompt_tokens)} prompt tokens in · {count(usage.completion_tokens)} generated
          </div>
        </div>
      ) : (
        <div className="border-t theme-border px-3 py-2.5 text-[11px] theme-text-muted italic">
          Never run. Benchmark it, or send it a message from the composer.
        </div>
      )}
    </div>
  )
}

type PaneId = 'local' | 'cloud'
type TierFilter = 'all' | 'slm' | 'llm'

export function AddedModelsView({ isPeek }: { isPeek: boolean }) {
  const [pane, setPane] = useState<PaneId>('local')
  const [tier, setTier] = useState<TierFilter>('all')
  const [rows, setRows] = useState<ModelRow[] | null>(null)
  const [usage, setUsage] = useState<Record<string, ModelUsage>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [result, setResult] = useState<BenchmarkResult | null>(null)
  const [benchProgress, setBenchProgress] = useState<BenchmarkProgress | null>(null)
  // Cloud tags Ollama serves, and the API providers configured for benchmarks.
  // Two different kinds of "a model you may use as a baseline"; both belong in
  // the cloud pane, and neither is a deployment target.
  const [cloudRows, setCloudRows] = useState<ModelRow[]>([])
  const [endpoints, setEndpoints] = useState<ModelEndpoint[]>([])
  const [endpointsLoaded, setEndpointsLoaded] = useState(false)
  // The add/manage form is a destination, not the pane itself. You arrive at
  // the inventory first and go there only when you want to change something.
  const [managingApi, setManagingApi] = useState(false)
  const [signinUrl, setSigninUrl] = useState<string | null>(null)
  const [lastError, setLastError] = useState<string | null>(null)

  const load = useCallback(async () => {
    // Settled, not all: usage is derived from the audit log and the inventory
    // from Ollama. Either can fail without the other being useless.
    const [table, used, eps] = await Promise.allSettled([
      modelTable(), modelUsage(), listEndpoints(),
    ])
    if (used.status === 'fulfilled') setUsage(used.value.models)
    if (eps.status === 'fulfilled') setEndpoints(eps.value)
    setEndpointsLoaded(true)
    if (table.status === 'fulfilled') {
      setRows(table.value.rows.filter((r) => r.installed && !r.remote))
      setCloudRows(table.value.rows.filter((r) => r.remote))
      setError(table.value.ollama.available ? null : table.value.ollama.error)
    } else {
      setRows([])
      setCloudRows([])
      setError(table.reason instanceof Error ? table.reason.message : 'request failed')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const { slm, llm, visible } = useMemo(() => {
    const all = rows ?? []
    const s = all.filter((r) => r.tier === 'slm')
    const l = all.filter((r) => r.tier !== 'slm')
    return {
      slm: s,
      llm: l,
      visible: tier === 'slm' ? s : tier === 'llm' ? l : all,
    }
  }, [rows, tier])

  const handleBenchmark = useCallback(async (row: ModelRow) => {
    setBusy(row.tag)
    setNotice(null)
    setResult(null)
    setBenchProgress(null)
    setSigninUrl(null)
    setLastError(null)
    try {
      const { done } = runBenchmark(row.tag, (p) => {
        setBenchProgress(p)
        if (p.phase === 'error') {
          setLastError(p.error ?? null)
          if (p.signin_url) setSigninUrl(p.signin_url)
        }
        if (p.phase === 'done' && p.result) {
          setResult(p.result)
        }
      })
      await done
      await load()
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'the benchmark failed')
    } finally {
      setBusy(null)
      setBenchProgress(null)
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

  const chip = (active: boolean) =>
    `px-2.5 py-1 text-[11px] rounded-lg border transition-colors ${
      active
        ? 'theme-accent-border theme-accent theme-surface-strong'
        : 'theme-border theme-text-muted hover:theme-text'
    }`

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm theme-text-muted">
          What this machine has, and what it has been running. Both local tiers are
          the production path; cloud models answer only as a marked evaluation
          override. To find and pull something new, use{' '}
          <span className="theme-text">Models</span>.
        </p>
        <button
          onClick={() => void load()}
          disabled={!!busy}
          className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border theme-border theme-text-muted hover:theme-text hover:bg-[color-mix(in_srgb,var(--text-main)_9%,transparent)] transition-colors disabled:opacity-40"
        >
          <RefreshCw size={12} />
          Refresh
        </button>
      </div>

      <div className="flex items-center gap-1 flex-wrap border-b theme-border pb-2">
        {([
          { id: 'local' as const, label: 'Local models', icon: Cpu, n: (rows ?? []).length },
          { id: 'cloud' as const, label: 'Cloud models', icon: Cloud, n: cloudRows.length + endpoints.length },
        ]).map((entry) => (
          <button
            key={entry.id}
            onClick={() => setPane(entry.id)}
            className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded-lg transition-colors ${
              pane === entry.id
                ? 'theme-accent theme-surface-strong'
                : 'theme-text-muted hover:theme-text'
            }`}
          >
            <entry.icon
              key={pane === entry.id ? 'on' : 'off'}
              size={12}
              className={`tab-icon ${pane === entry.id ? 'tab-icon-active' : ''}`}
            />
            {entry.label}
            {entry.n !== null && <span className="tabular-nums opacity-70">{entry.n}</span>}
          </button>
        ))}
      </div>

      {error && pane === 'local' && (
        <div className="flex items-start gap-2 p-3 rounded-xl border status-warn-border status-warn-bg text-xs">
          <AlertTriangle size={14} className="status-warn shrink-0 mt-0.5" />
          <div>
            <div className="font-medium">Ollama isn't reachable</div>
            <div className="theme-text-muted mt-0.5">{error}</div>
          </div>
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

      <div key={pane} className="animate-in fade-in slide-in-from-bottom-1 duration-300 ease-out space-y-3">
        {pane === 'local' ? (
          rows === null ? (
            <SkeletonList rows={2} label="Reading what is installed" />
          ) : (
            <>
              <div className="flex items-center gap-2 flex-wrap">
                {(['all', 'slm', 'llm'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTier(t)}
                    title={
                      t === 'slm'
                        ? '4B parameters and under. Fast enough for interactive use.'
                        : t === 'llm'
                          ? 'Above 4B. More accurate, slower, still available to the assistant.'
                          : 'Both sizes'
                    }
                    className={chip(tier === t)}
                  >
                    {t === 'all' ? `All ${(rows ?? []).length}` : `${t.toUpperCase()} ${t === 'slm' ? slm.length : llm.length}`}
                  </button>
                ))}
              </div>

              <div key={tier} className="space-y-3 animate-in fade-in duration-200 ease-out">
              {visible.length ? (
                visible.map((row) => (
                  <LocalModel
                    key={row.id}
                    row={row}
                    usage={usage[row.tag]}
                    busy={busy}
                    benchProgress={busy === row.tag ? benchProgress : null}
                    onBenchmark={handleBenchmark}
                    onDelete={handleDelete}
                  />
                ))
              ) : (
                <p className="text-xs theme-text-muted italic px-3 py-5 rounded-xl border border-dashed theme-border">
                  {rows.length
                    ? `No ${tier.toUpperCase()} models installed.`
                    : 'Nothing installed yet. Pull one from the Models tab.'}
                </p>
              )}
              </div>
            </>
          )
        ) : managingApi ? (
          <>
            <button
              onClick={() => { setManagingApi(false); void load() }}
              className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded-lg theme-text-muted hover:theme-text transition-colors"
            >
              <ArrowLeft size={12} />
              Back to cloud models
            </button>
            {/* ModelEndpointsPanel carries its own Rule 1 warning, so nothing
                is added here: two warnings stacked reads as boilerplate. */}
            <ModelEndpointsPanel isPeek={isPeek} />
          </>
        ) : (
          <div className="flex flex-col gap-5">
            <p className="text-xs theme-text-muted">
              Reference baselines for the evaluation chapter. None of these is on the
              production path: picking one in chat logs the turn as{' '}
              <code>chat_cloud</code> and keeps it out of the local latency figures.
            </p>

            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Cloud size={12} className="theme-text-muted" />
                <span className="text-[10px] uppercase tracking-wide theme-text-muted">
                  Via Ollama · {cloudRows.length}
                </span>
              </div>
              {cloudRows.length ? (
                cloudRows.map((row) => (
                  <CloudModel
                    key={row.id}
                    row={row}
                    usage={usage[row.tag]}
                    busy={busy}
                    benchProgress={busy === row.tag ? benchProgress : null}
                    signinUrl={signinUrl}
                    lastError={lastError}
                    onBenchmark={handleBenchmark}
                  />
                ))
              ) : (
                <p className="text-xs theme-text-muted italic px-3 py-5 rounded-xl border border-dashed theme-border">
                  No cloud tags. Pull one with <code>ollama pull gpt-oss:120b-cloud</code>.
                </p>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Settings2 size={12} className="theme-text-muted" />
                <span className="text-[10px] uppercase tracking-wide theme-text-muted">
                  API endpoints · {endpoints.length}
                </span>
                <button
                  onClick={() => setManagingApi(true)}
                  className="ml-auto flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded-lg border theme-border theme-text-muted hover:theme-text hover:bg-[color-mix(in_srgb,var(--text-main)_9%,transparent)] transition-colors"
                >
                  <Plus size={12} />
                  Add API model
                </button>
              </div>
              {!endpointsLoaded ? (
                <SkeletonList rows={2} />
              ) : endpoints.length ? (
                endpoints.map((ep) => (
                  <ApiEndpoint key={ep.id} ep={ep} onManage={() => setManagingApi(true)} />
                ))
              ) : (
                <p className="text-xs theme-text-muted italic px-3 py-5 rounded-xl border border-dashed theme-border">
                  None configured. Add one to benchmark against a hosted model.
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
