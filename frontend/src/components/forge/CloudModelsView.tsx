import { useCallback, useEffect, useState } from 'react'
import {
  ArrowLeft, Cloud, ExternalLink, FlaskConical, Loader2, Plus, X,
  CircleCheck, CircleAlert, HelpCircle, Activity, Settings2,
} from 'lucide-react'
import {
  modelTable, modelUsage, runBenchmark,
  type ModelRow, type BenchmarkResult, type BenchmarkProgress, type ModelUsage,
} from '../../lib/forgeClient'
import { ModelEndpointsPanel } from '../settings/ModelEndpointsPanel'
import { listEndpoints, type ModelEndpoint } from '../../lib/systemClient'
import { CapabilityBadges } from '../ui/capability-badges'
import { SkeletonList } from '../ui/skeleton'
import { PaneIntro, SectionLabel, EmptyNote } from './paneParts'
import { useLiveRefresh } from '../../hooks/useLiveRefresh'

/**
 * Forge → Cloud baselines: the hosted models the evaluation compares against.
 *
 * Its own tab rather than a filter on Chat models because Rule 1 draws the line
 * here: a cloud model is an evaluation baseline, never a deployment target.
 * Mixing them into one ranked list would put a model that must never answer an
 * operator next to the ones that do, scored as if it were a peer.
 *
 * Two kinds of baseline, both here: cloud tags Ollama serves
 * (`gpt-oss:120b-cloud`), and API endpoints configured for benchmarks. Picking
 * either in chat logs the turn as `chat_cloud` and keeps it out of the local
 * latency figures.
 */

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

export function CloudModelsView({ isPeek }: { isPeek: boolean }) {
  const [usage, setUsage] = useState<Record<string, ModelUsage>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [result, setResult] = useState<BenchmarkResult | null>(null)
  const [benchProgress, setBenchProgress] = useState<BenchmarkProgress | null>(null)
  const [cloudRows, setCloudRows] = useState<ModelRow[]>([])
  const [endpoints, setEndpoints] = useState<ModelEndpoint[]>([])
  const [endpointsLoaded, setEndpointsLoaded] = useState(false)
  // The add/manage form is a destination, not the pane itself. You arrive at
  // the inventory first and go there only when you want to change something.
  const [managingApi, setManagingApi] = useState(false)
  const [signinUrl, setSigninUrl] = useState<string | null>(null)
  const [lastError, setLastError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [table, used, eps] = await Promise.allSettled([
      modelTable(), modelUsage(), listEndpoints(),
    ])
    if (used.status === 'fulfilled') setUsage(used.value.models)
    if (eps.status === 'fulfilled') setEndpoints(eps.value)
    setEndpointsLoaded(true)
    setCloudRows(table.status === 'fulfilled' ? table.value.rows.filter((r) => r.remote) : [])
  }, [])

  useEffect(() => {
    void load()
  }, [load])
  useLiveRefresh(['models', 'endpoints'], () => void load())

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

  if (managingApi) {
    return (
      <div className="space-y-4">
        <button
          onClick={() => { setManagingApi(false); void load() }}
          className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded-lg theme-text-muted hover:theme-text transition-colors"
        >
          <ArrowLeft size={12} />
          Back to cloud baselines
        </button>
        {/* ModelEndpointsPanel carries its own Rule 1 warning, so nothing
            is added here: two warnings stacked reads as boilerplate. */}
        <ModelEndpointsPanel isPeek={isPeek} />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PaneIntro>
        Reference baselines for the evaluation chapter, never the production path. Picking
        one in chat logs the turn as <code>chat_cloud</code> and keeps it out of the local
        latency figures.
      </PaneIntro>

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

      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <SectionLabel icon={Cloud} count={cloudRows.length}>Via Ollama</SectionLabel>
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
            <EmptyNote>
              No cloud tags. Pull one with <code>ollama pull gpt-oss:120b-cloud</code>.
            </EmptyNote>
          )}
        </div>

        <div className="flex flex-col gap-2">
          <SectionLabel
            icon={Settings2}
            count={endpoints.length}
            action={
              <button
                onClick={() => setManagingApi(true)}
                className="flex items-center gap-1.5 px-2.5 py-1 text-[11px] rounded-lg border theme-border theme-text-muted hover:theme-text hover:bg-[color-mix(in_srgb,var(--text-main)_9%,transparent)] transition-colors"
              >
                <Plus size={12} />
                Add API model
              </button>
            }
          >
            API endpoints
          </SectionLabel>
          {!endpointsLoaded ? (
            <SkeletonList rows={2} />
          ) : endpoints.length ? (
            endpoints.map((ep) => (
              <ApiEndpoint key={ep.id} ep={ep} onManage={() => setManagingApi(true)} />
            ))
          ) : (
            <EmptyNote>None configured. Add one to benchmark against a hosted model.</EmptyNote>
          )}
        </div>
      </div>
    </div>
  )
}
