import { useCallback, useEffect, useMemo, useState } from 'react'
import { TabError } from '../errors/TabError'
import { toFailure, type LoadFailure } from '../errors/ErrorPage'
import {
  AlertTriangle, Loader2, RefreshCw, X, Search, Cpu, Star, Globe, Terminal, Layers,
} from 'lucide-react'
import {
  modelTable, modelUsage, searchHuggingFace, inspectTag, pullModel, type ModelTable, type ModelRow, type PullProgress, type ModelUsage,
} from '../../lib/forgeClient'
import { useLiveRefresh } from '../../hooks/useLiveRefresh'
import { Skeleton, SkeletonList } from '../ui/skeleton'
import { bytes, looksLikeTag } from './models/format'
import { ModelCard } from './models/ModelCard'
import { groupRows, useShortlist, type ModelGroup } from './models/shortlist'

/**
 * Steps 2–5 of the Forge for answering models: estimate · score · manage ·
 * benchmark. Embedding models and cloud baselines have their own Forge tabs.
 *
 * ## The one rule this screen exists to keep
 *
 * `MODULES.md` §2.2: *an estimate and a measurement must never look alike.* The
 * value of this module to the report is the gap between them and how it closes,
 * so every row carries both, styled apart, and "not benchmarked" is a state
 * written in words rather than an empty cell.
 *
 * ## One scorer, whatever the source
 *
 * The catalogue, models found on this disk, Hugging Face results and a typed
 * tag are all scored by the same code against the same hardware, so any two
 * cards can be compared. How the list is filtered is described on `ModelsView`.
 *
 * ## Colours
 *
 * Verdicts use the `.status-*` classes, not Tailwind literals. A theme here is
 * an arbitrary accent over an arbitrary background — `status-warn` is fine on
 * a dark surface and nearly invisible on a cream one, which is what happened to
 * the first version of this screen. See `deriveStatusColors` in `lib/themes.ts`.
 */

type Scope = 'shortlist' | 'all' | 'huggingface'

/**
 * Chat models: every answering model, one list, filtered rather than tabbed.
 *
 * The old screen had seven tabs mixing three different questions — where a
 * model is listed (Shortlist, Library, Hugging Face, Custom), whether it is on
 * this disk (Installed), and what kind of model it is (Embeddings) — so
 * "installed and on the shortlist" was not something you could ask. Now kind is
 * the Forge's top-level tab, and the rest are filters that combine:
 *
 * | control | question |
 * |---|---|
 * | Shortlist / Everything / Hugging Face | the models you starred, the whole catalogue, or a live search |
 * | Installed | only what is on this disk |
 * | Any size / SLM / LLM | §8.1's two local tiers |
 * | Runnable only | hide what is estimated not to fit |
 *
 * Hugging Face is a scope beside the catalogue rather than a separate tab of
 * its own kind: the search box searches it once you choose it, and only then.
 * Choosing it is the consent to send the query off the machine; the catalogue
 * scopes never do. A typed tag (`qwen3:30b`, `hf.co/…`) can be checked from any
 * scope, because it is one specific model rather than a list.
 */
export function ModelsView({ onManage }: { onManage?: () => void }) {
  const [table, setTable] = useState<ModelTable | null>(null)
  const [usage, setUsage] = useState<Record<string, ModelUsage>>({})
  const [error, setError] = useState<LoadFailure | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [progress, setProgress] = useState<PullProgress | null>(null)
  const [cancelPull, setCancelPull] = useState<(() => void) | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // ── filters ──
  const [scope, setScope] = useState<Scope>('shortlist')
  const [search, setSearch] = useState('')
  const [tier, setTier] = useState<'all' | 'slm' | 'llm'>('all')
  const [runnableOnly, setRunnableOnly] = useState(false)

  const { starred, toggle } = useShortlist()

  // ── beyond the catalogue: Hugging Face search, or one typed tag ──
  const [hfQuery, setHfQuery] = useState<string | null>(null)
  const [hfRows, setHfRows] = useState<ModelRow[]>([])
  const [hfError, setHfError] = useState<string | null>(null)
  const [hfLoading, setHfLoading] = useState(false)
  const [tagRow, setTagRow] = useState<ModelRow | null>(null)
  const [tagError, setTagError] = useState<string | null>(null)
  const [tagLoading, setTagLoading] = useState(false)

  // Settled, not all: usage comes from the audit log and the table from the
  // scorer. The list is useful without the usage figures. State is set in the
  // callback only.
  const load = useCallback(() => Promise.allSettled([modelTable(), modelUsage()]).then(([t, u]) => {
    if (u.status === 'fulfilled') setUsage(u.value.models)
    if (t.status === 'fulfilled') {
      setTable(t.value)
      setError(null)
    } else {
      setError(toFailure(t.reason))
    }
  }), [])

  useEffect(() => {
    void load()
  }, [load])
  // A pull or delete anywhere — here, in Installed, or `ollama rm` in a
  // terminal — changes what is installed, so the badges and Manage buttons follow.
  useLiveRefresh(['models'], () => void load())

  // A new search makes an earlier tag check about a different question.
  const onSearchChange = (value: string) => {
    setSearch(value)
    setTagRow(null)
    setTagError(null)
  }

  // Hugging Face is searched only while its scope is chosen, debounced because
  // the box is typed into. Every state change happens inside the timer, so a
  // keystroke never renders twice.
  useEffect(() => {
    if (scope !== 'huggingface') return
    const q = search.trim()
    let cancelled = false
    const timer = window.setTimeout(async () => {
      setHfLoading(true)
      setHfError(null)
      try {
        const res = await searchHuggingFace(q)
        if (cancelled) return
        setHfQuery(q)
        setHfRows(res.rows)
        setHfError(res.error)
      } catch (e) {
        if (cancelled) return
        setHfError(e instanceof Error ? e.message : 'search failed')
        setHfRows([])
      } finally {
        if (!cancelled) setHfLoading(false)
      }
    }, 400)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [scope, search])

  const checkTag = useCallback(async () => {
    const tag = search.trim()
    if (!tag) return
    setTagLoading(true)
    setTagError(null)
    try {
      const res = await inspectTag(tag)
      setTagRow(res.row)
      setTagError(res.error)
    } catch (e) {
      setTagError(e instanceof Error ? e.message : 'lookup failed')
      setTagRow(null)
    } finally {
      setTagLoading(false)
    }
  }, [search])

  // Answering models only. Cloud tags have their own tab (Rule 1: a baseline,
  // never a deployment target) and embedders are a different job entirely.
  const groups = useMemo(
    () => groupRows((table?.rows ?? []).filter((r) => !r.remote && r.tier !== 'embedding'), true),
    [table?.rows],
  )

  const passesFilters = useCallback((g: ModelGroup) => {
    const best = g.variants[0]
    if (tier !== 'all' && best.tier !== tier) return false
    if (runnableOnly && !g.variants.some((v) => ['safe', 'marginal'].includes(v.verdict.fit))) return false
    return true
  }, [tier, runnableOnly])

  const needle = search.trim().toLowerCase()
  const matches = useCallback((g: ModelGroup) => {
    if (!needle) return true
    return g.variants.some((r) =>
      `${r.label} ${r.tag} ${r.vendor ?? ''} ${r.kind}`.toLowerCase().includes(needle),
    )
  }, [needle])

  const hfGroups = useMemo(() => groupRows(hfRows, false), [hfRows])

  const visible = useMemo(() => {
    // The Hugging Face list is already the result of a server-side search;
    // filtering it again by the same box would hide rows the search matched on
    // a field this one does not see. Installed means nothing for a search hit.
    if (scope === 'huggingface') {
      return hfGroups.filter((g) => {
        const best = g.variants[0]
        if (tier !== 'all' && best.tier !== tier) return false
        if (runnableOnly && !g.variants.some((v) => ['safe', 'marginal'].includes(v.verdict.fit))) return false
        return true
      })
    }
    return groups.filter((g) => (scope === 'all' || starred(g)) && passesFilters(g) && matches(g))
  }, [scope, hfGroups, groups, starred, passesFilters, matches, tier, runnableOnly])

  // How many a search would find outside the shortlist, so an empty shortlist
  // result can say where the model is rather than just "nothing".
  const elsewhere = useMemo(
    () => (scope === 'shortlist' && needle
      ? groups.filter((g) => !starred(g) && passesFilters(g) && matches(g)).length
      : 0),
    [scope, needle, groups, starred, passesFilters, matches],
  )

  const counts = useMemo(() => ({
    shortlist: groups.filter(starred).length,
    all: groups.length,
  }), [groups, starred])

  const tagGroups = useMemo(() => groupRows(tagRow ? [tagRow] : [], false), [tagRow])

  const handlePull = useCallback(async (row: ModelRow) => {
    setBusy(row.tag)
    setNotice(null)
    setProgress({ status: 'starting', digest: null, total_bytes: null, completed_bytes: null, percent: null, done: false })
    const { done, cancel } = pullModel(row.tag, setProgress)
    setCancelPull(() => cancel)
    try {
      await done
      setNotice(`Pulled ${row.tag}. Benchmark or manage it in Installed.`)
      await load()
    } catch (e) {
      setNotice(e instanceof Error ? e.message : 'the pull failed')
    } finally {
      setBusy(null)
      setProgress(null)
      setCancelPull(null)
    }
  }, [load])

  if (error) {
    return (
      <TabError
        code={error.status}
        detail={error.message}
        what="The model table could not be loaded from the backend."
        onRetry={() => void load()}
      />
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
  const cardProps = {
    usage, busy, onManage,
    onToggleStar: toggle, onPull: handlePull,
  }

  return (
    <div className="space-y-3 animate-in fade-in duration-200">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm theme-text-muted">
          The models that answer questions, estimated against this machine and ranked. The{' '}
          <span className="theme-text">Measured</span> column is the one that counts.
          Star a model to add it to your shortlist.
        </p>
        <button
          onClick={() => void load()}
          disabled={!!busy}
          className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border theme-border theme-text-muted hover:theme-text hover:bg-[color-mix(in_srgb,var(--text-main)_9%,transparent)] transition-colors disabled:opacity-40"
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

      {/* ── search ── */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1 min-w-0">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 theme-text-muted" />
          <input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={
              scope === 'huggingface'
                ? 'Search Hugging Face GGUF models…'
                : 'Filter by name, tag or vendor, or paste a tag like qwen3:30b'
            }
            spellCheck={false}
            className="w-full pl-7 pr-2 py-1.5 text-[11px] rounded-lg border theme-border theme-surface theme-text placeholder:theme-text-muted focus:outline-none focus:theme-accent-border"
          />
        </div>
        {looksLikeTag(search.trim()) && (
          <button
            onClick={() => void checkTag()}
            disabled={tagLoading}
            title="Score this exact tag against this machine. Ollama tags resolve through its registry, hf.co/… tags through Hugging Face."
            className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] rounded-lg border theme-border theme-text-muted hover:theme-text transition-colors disabled:opacity-40"
          >
            {tagLoading ? <Loader2 size={11} className="animate-spin" /> : <Terminal size={11} />}
            Check tag
          </button>
        )}
      </div>

      {/* ── filters ── */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center rounded-lg border theme-border overflow-hidden">
          {([
            { id: 'shortlist' as const, label: 'Shortlist', icon: Star, n: counts.shortlist, hint: 'The models you starred. Starts as the six PROJECT.md §8.1 names.' },
            { id: 'all' as const, label: 'Everything', icon: Layers, n: counts.all, hint: 'The whole catalogue, plus anything on this disk it does not declare.' },
            { id: 'huggingface' as const, label: 'Hugging Face', icon: Globe, n: null, hint: 'Live GGUF search. Needs the internet; the query leaves this machine only while this is chosen. Results pull via hf.co/{repo}:{quant}.' },
          ]).map((s) => (
            <button
              key={s.id}
              onClick={() => setScope(s.id)}
              title={s.hint}
              className={`flex items-center gap-1.5 px-2.5 py-1 text-[11px] transition-colors ${
                scope === s.id ? 'theme-accent theme-surface-strong' : 'theme-text-muted hover:theme-text'
              }`}
            >
              <s.icon size={11} className="shrink-0" fill={s.id === 'shortlist' && scope === s.id ? 'currentColor' : 'none'} />
              {s.label}
              {s.n !== null && <span className="tabular-nums opacity-70">{s.n}</span>}
            </button>
          ))}
        </div>
        <span className="h-4 border-l theme-border" aria-hidden />
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

      {notice && (
        <div className="flex items-start gap-2 p-2.5 rounded-lg border theme-border theme-surface-strong text-xs">
          <span className="flex-1 break-words">{notice}</span>
          <button onClick={() => setNotice(null)} className="theme-text-muted hover:theme-text">
            <X size={12} />
          </button>
        </div>
      )}

      {(tagLoading || tagError || tagGroups.length > 0) && (
        <div className="space-y-2">
          <p className="text-[10px] uppercase tracking-widest theme-text-muted">Checked tag</p>
          {tagLoading && <SkeletonList rows={1} label="Checking the tag" />}
          {tagError && (
            <div className="flex items-start gap-2 p-2.5 rounded-lg border status-warn-border status-warn-bg text-[11px]">
              <AlertTriangle size={13} className="status-warn shrink-0 mt-0.5" />
              <span className="break-words">{tagError}</span>
            </div>
          )}
          {tagGroups.map((group) => (
            <ModelCard key={group.model_id} group={group} starred={false} {...cardProps} />
          ))}
        </div>
      )}

      {scope === 'huggingface' && hfError && (
        <div className="flex items-start gap-2 p-3 rounded-xl border status-warn-border status-warn-bg text-xs">
          <AlertTriangle size={14} className="status-warn shrink-0 mt-0.5" />
          <div>
            <div className="font-medium">Hugging Face search unavailable</div>
            <div className="theme-text-muted mt-0.5">
              {hfError} Shortlist and Everything work offline.
            </div>
          </div>
        </div>
      )}

      {/* Keyed on the scope so switching lists replays the entry animation
          instead of swapping rows in place. */}
      <div key={scope} className="space-y-2 animate-in fade-in slide-in-from-bottom-1 duration-300 ease-out">
        {scope === 'huggingface' && hfLoading && <SkeletonList rows={4} label="Searching Hugging Face" />}
        {scope === 'huggingface' && !hfLoading && hfQuery !== null && hfRows.length > 0 && (
          <p className="text-[10px] uppercase tracking-widest theme-text-muted">
            {hfRows.length} result{hfRows.length === 1 ? '' : 's'}
            {hfQuery ? ` for "${hfQuery}"` : ', most downloaded'}
          </p>
        )}
        {!(scope === 'huggingface' && hfLoading) && visible.map((group) => (
          <ModelCard
            key={group.model_id}
            group={group}
            starred={starred(group)}
            {...cardProps}
          />
        ))}
        {!visible.length && !(scope === 'huggingface' && (hfLoading || hfQuery === null || hfError)) && (
          <div className="text-xs theme-text-muted py-6 text-center space-y-2">
            <p>
              {scope === 'huggingface'
                ? 'No GGUF models found for that search.'
                : scope === 'shortlist' && !needle && tier === 'all' && !runnableOnly
                  ? 'Your shortlist is empty. Star models in Everything to add them.'
                  : `Nothing matches these filters.${runnableOnly ? ' Try turning off "Runnable only".' : ''}`}
            </p>
            {elsewhere > 0 && (
              <button onClick={() => setScope('all')} className="theme-accent hover:underline">
                {elsewhere} match{elsewhere === 1 ? '' : 'es'} in Everything
              </button>
            )}
            {scope !== 'huggingface' && needle && (
              <button onClick={() => setScope('huggingface')} className="block mx-auto theme-accent hover:underline">
                Search Hugging Face for "{search.trim()}"
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
