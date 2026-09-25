import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, ChevronDown, Download, Loader2, RefreshCw,
  CircleCheck, CircleAlert, CircleSlash, Cloud, HelpCircle, X, Search, Cpu, ExternalLink,
  Star, Globe, Terminal, Layers, ArrowRight,
} from 'lucide-react'
import {
  modelTable, modelUsage, searchHuggingFace, inspectTag, pullModel,
  type ModelTable, type ModelRow, type PullProgress, type ModelUsage,
} from '../../lib/forgeClient'
import { loadOnePref, savePref, PREF_FORGE_SHORTLIST } from '../../lib/prefsClient'
import { useLiveRefresh } from '../../hooks/useLiveRefresh'
import { CapabilityBadges } from '../ui/capability-badges'
import { ModelArchitecture } from '../ui/model-architecture'
import { Skeleton, SkeletonList } from '../ui/skeleton'
import { Collapse } from '../ui/collapse'

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

function ms(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${Math.round(n)}ms`
}

function Detail({ row, usage }: { row: ModelRow; usage?: ModelUsage }) {
  const est = row.estimate

  if (!est) {
    return (
      <p className="text-[11px] theme-text-muted leading-relaxed">
        {row.notes ?? 'Not scorable, because Ollama reports no parameter count for this model.'}
      </p>
    )
  }

  // A fragment, not a wrapping <div>. `Collapse` cascades the *direct children*
  // of its own element, so a layout wrapper here would make the whole panel one
  // child and the whole cascade one beat — which is exactly what it looked
  // like. The grid classes moved onto the Collapse's className instead.
  return (
    <>
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
        {/* Directly under the estimate, because it is the estimate's inputs —
            the KV term above is layers x kv_heads x head_dim x 2 x bytes. */}
        <div className="mt-3 pt-3 border-t theme-border">
          <ModelArchitecture arch={row.arch} />
        </div>
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

      {/* Every run model_logs holds for this tag, benchmark and chat alike. The
          Measured column is the last benchmark; this is the distribution, as
          mean, p50 and p95 — the three PROJECT.md §9.2 asks for by name. */}
      {usage && usage.runs > 0 && (
        <Section
          title="On this machine"
          right={
            <span className="text-[10px] theme-text-muted">
              {usage.runs} run{usage.runs === 1 ? '' : 's'}
              {usage.errors > 0 && <span className="status-warn"> · {usage.errors} failed</span>}
            </span>
          }
        >
          <div className="divide-y divide-[color-mix(in_srgb,var(--border)_60%,transparent)]">
            <Fact
              label="TTFT p50 / p95"
              value={`${ms(usage.time_to_first_token_ms.p50)} / ${ms(usage.time_to_first_token_ms.p95)}`}
              hint={`mean ${ms(usage.time_to_first_token_ms.mean)}`}
            />
            <Fact
              label="End-to-end p50"
              value={ms(usage.total_inference_ms.p50)}
              hint={`mean ${ms(usage.total_inference_ms.mean)} · p95 ${ms(usage.total_inference_ms.p95)}`}
            />
            <Fact
              label="Generation p50"
              value={usage.tokens_per_sec.p50 ? `${usage.tokens_per_sec.p50} tok/s` : '—'}
              hint="From the engine's own counters, so it measures the model rather than the machine's other work."
            />
            <Fact
              label="Runs by source"
              value={Object.entries(usage.by_source).map(([k, v]) => `${v} ${k}`).join(' · ')}
            />
          </div>
        </Section>
      )}

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
    </>
  )
}

/**
 * One model, with its quantisations inside it.
 *
 * The table arrives one row per model × quantisation, which is the right shape
 * for the scorer and the wrong one for a reader: the old list showed Gemma 3 1B
 * three times and counted the shortlist as fifteen when it holds six. So rows
 * are grouped by `model_id`, and the quantisation is a choice made on the card.
 */
interface ModelGroup {
  model_id: string
  /** Every variant, best-ranked first — the order the table already sorted. */
  variants: ModelRow[]
  /** One of the six PROJECT.md §8.1 names. Fixed: the report argues about these. */
  reportCandidate: boolean
  installed: boolean
  /** Only catalogue and on-disk models can be starred; a search hit has no stable home. */
  starrable: boolean
}

function groupRows(rows: ModelRow[], starrable: boolean): ModelGroup[] {
  const byId = new Map<string, ModelGroup>()
  for (const row of rows) {
    let group = byId.get(row.model_id)
    if (!group) {
      group = { model_id: row.model_id, variants: [], reportCandidate: false, installed: false, starrable }
      byId.set(row.model_id, group)
    }
    group.variants.push(row)
    group.reportCandidate ||= row.shortlist
    group.installed ||= row.installed
  }
  return [...byId.values()]
}

/**
 * The shortlist is yours to edit, but stored as edits against the report's six
 * rather than as a list of its own. A catalogue that later adds a seventh
 * candidate then reaches everyone who has not removed it, and "what did you
 * change?" has an answer.
 */
interface ShortlistPref {
  added: string[]
  removed: string[]
}

function isShortlistPref(v: unknown): v is ShortlistPref {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return Array.isArray(o.added) && Array.isArray(o.removed)
}

function useShortlist() {
  const [pref, setPref] = useState<ShortlistPref>({ added: [], removed: [] })

  useEffect(() => {
    loadOnePref(PREF_FORGE_SHORTLIST)
      .then((v) => { if (isShortlistPref(v)) setPref(v) })
      .catch(() => undefined)
  }, [])

  const starred = useCallback(
    (g: ModelGroup) =>
      (g.reportCandidate && !pref.removed.includes(g.model_id)) || pref.added.includes(g.model_id),
    [pref],
  )

  const toggle = useCallback((g: ModelGroup) => {
    setPref((prev) => {
      const id = g.model_id
      const on = (g.reportCandidate && !prev.removed.includes(id)) || prev.added.includes(id)
      const next: ShortlistPref = g.reportCandidate
        ? {
            added: prev.added.filter((x) => x !== id),
            removed: on ? [...prev.removed, id] : prev.removed.filter((x) => x !== id),
          }
        : {
            added: on ? prev.added.filter((x) => x !== id) : [...prev.added, id],
            removed: prev.removed.filter((x) => x !== id),
          }
      savePref(PREF_FORGE_SHORTLIST, next)
      return next
    })
  }, [])

  return { starred, toggle }
}

function ModelCard({
  group, starred, onToggleStar, usage, busy, onPull, onManage,
}: {
  group: ModelGroup
  starred: boolean
  onToggleStar: (g: ModelGroup) => void
  usage: Record<string, ModelUsage>
  busy: string | null
  onPull: (row: ModelRow) => void
  /** Installed models are managed in Installed; the browser only points there. */
  onManage?: () => void
}) {
  const [open, setOpen] = useState(false)
  // What is on disk first, because that is what you would benchmark or delete;
  // otherwise the best-scoring quantisation for this machine.
  const [picked, setPicked] = useState<string | null>(null)
  const row =
    group.variants.find((v) => v.id === picked)
    ?? group.variants.find((v) => v.installed)
    ?? group.variants[0]

  const verdict = VERDICT[row.verdict.fit] ?? VERDICT.unknown
  const VerdictIcon = verdict.icon
  const measured = row.measured
  const isBusy = busy === row.tag

  return (
    <div className="rounded-xl border theme-border theme-surface overflow-hidden">
      <div className="flex items-start gap-3 p-3">
        {group.starrable ? (
          <button
            onClick={() => onToggleStar(group)}
            title={starred ? 'Remove from your shortlist' : 'Add to your shortlist'}
            aria-pressed={starred}
            className={`shrink-0 pt-0.5 transition-colors ${starred ? 'theme-accent' : 'theme-text-muted hover:theme-text'}`}
          >
            <Star size={13} fill={starred ? 'currentColor' : 'none'} />
          </button>
        ) : (
          <span className="w-[13px] shrink-0" />
        )}
        <span className="text-[11px] font-mono theme-text-muted tabular-nums w-5 shrink-0 pt-0.5">
          {row.score === null ? '—' : row.rank}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium truncate">{row.label}</span>
            {group.reportCandidate && (
              <Pill
                tone="ok"
                title="One of the six candidates PROJECT.md §8.1 names. Stays marked even if you unstar it, so the report's choices remain traceable."
              >
                report candidate
              </Pill>
            )}
            {row.installed && <Pill tone="ok" title="This quantisation is pulled and on this disk.">installed</Pill>}
            <CapabilityBadges capabilities={row.capabilities} />
            {row.tag_exists === false && (
              <Pill tone="warn" title="The Ollama registry has no manifest for this tag, so a pull would fail.">
                tag missing
              </Pill>
            )}
          </div>

          {/* Quantisation: a choice on the card when there is one to make. */}
          <div className="flex items-center gap-1.5 flex-wrap mt-1">
            {group.variants.length > 1 ? (
              group.variants.map((v) => (
                <button
                  key={v.id}
                  onClick={() => setPicked(v.id)}
                  title={`${v.tag}${v.installed ? ' · installed' : ''}`}
                  className={`text-[10px] px-1.5 py-0.5 rounded border uppercase tracking-wide transition-colors ${
                    v.id === row.id
                      ? 'theme-accent-border theme-accent theme-surface-strong'
                      : 'theme-border theme-text-muted hover:theme-text'
                  }`}
                >
                  {v.quantization}
                  {v.installed && <span className="status-ok"> ●</span>}
                </button>
              ))
            ) : (
              <Pill title={`Quantization: ${row.quantization_known ? 'width is tabulated' : 'width inferred from the name'}`}>
                {row.quantization}
              </Pill>
            )}
            <code className="text-[10px] theme-text-muted break-all">{row.tag}</code>
          </div>

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
            onManage && <button
              onClick={onManage}
              title="Benchmark, see its run history, or delete it — in Installed."
              className="flex items-center gap-1.5 px-2 py-1 text-[11px] rounded-lg border theme-border theme-text-muted hover:theme-text hover:bg-[color-mix(in_srgb,var(--text-main)_9%,transparent)] transition-colors"
            >
              Manage <ArrowRight size={12} />
            </button>
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

      {/* The grid lives here, not inside `Detail`. `Collapse` cascades its own
          element's direct children, so the layout wrapper has to *be* that
          element — otherwise every section is one child, the cascade is one
          beat, and the panel pops in fully formed.

          `flow` rather than the default domino: this is a tall panel of
          sections, so the container unfolds and the sections settle downward
          without the bounce. See `ui/collapse` for why those differ. */}
      <Collapse
        open={open}
        variant="flow"
        className="border-t theme-border px-4 py-4 theme-surface grid grid-cols-1 @2xl:grid-cols-2 gap-x-8 gap-y-4"
      >
        <Detail row={row} usage={usage[row.tag]} />
      </Collapse>
    </div>
  )
}

/** Something typed into the search box that Ollama would accept as a tag. */
function looksLikeTag(q: string): boolean {
  return q.startsWith('hf.co/') || /^[\w.-]+(\/[\w.-]+)?:[\w.-]+$/.test(q)
}

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
  const [error, setError] = useState<string | null>(null)
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

  const load = useCallback(async () => {
    // Settled, not all: usage comes from the audit log and the table from the
    // scorer. The list is useful without the usage figures.
    const [t, u] = await Promise.allSettled([modelTable(), modelUsage()])
    if (u.status === 'fulfilled') setUsage(u.value.models)
    if (t.status === 'fulfilled') {
      setTable(t.value)
      setError(null)
    } else {
      setError(t.reason instanceof Error ? t.reason.message : 'request failed')
    }
  }, [])

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
                : 'Filter by name, tag or vendor — or paste a tag like qwen3:30b'
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
