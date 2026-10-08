import { useState } from 'react'
import { ChevronDown, Download, Loader2, Star, ArrowRight } from 'lucide-react'
import { type ModelRow, type ModelUsage } from '../../../lib/forgeClient'
import { CapabilityBadges } from '../../ui/capability-badges'
import { Collapse } from '../../ui/collapse'
import { bytes, VERDICT, PLACEMENT_HELP } from './format'
import { Pill } from './parts'
import { Detail } from './ModelDetail'
import type { ModelGroup } from './shortlist'

export function ModelCard({
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
          {row.score === null ? '-' : row.rank}
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
                {row.estimate ? `${row.estimate.weights_source === 'declared' ? '~' : ''}${bytes(row.estimate.total_bytes)}` : '-'}
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
                {row.speed?.tokens_per_sec ? `~${row.speed.tokens_per_sec} tok/s` : '-'}
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
              title="Benchmark it, see its run history, or delete it in Installed."
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
