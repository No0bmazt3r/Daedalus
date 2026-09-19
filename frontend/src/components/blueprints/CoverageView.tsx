import { useEffect, useState } from 'react'
import { CheckCircle2, AlertCircle } from 'lucide-react'
import { fetchCoverage, type Coverage, type GraphNode } from '../../lib/blueprintsClient'
import { Skeleton } from '../ui/skeleton'
import { NodeChip } from './nodeStyles'

/**
 * Where the graph is structurally legal but semantically incomplete —
 * MODULES.md §3.3.
 *
 * Track 2's honest risk (PROJECT.md §5) is *silent failure when a relationship
 * was never authored*. A hand-authored graph fails by omission, and omission is
 * invisible from the answer side: you get a worse answer with no indication
 * why. This is the panel where that stops being invisible.
 *
 * It has two audiences and serves both with the same table. While authoring,
 * every row is a to-do — MODULES.md calls a coverage table exactly that. At
 * evaluation time, it is the evidence that the dual-track comparison is fair:
 * the comparison only holds if Track 2's corpus is as complete as Track 1's,
 * and this is how that gets checked rather than assumed.
 *
 * Note what this deliberately does not do: it never hides a gap behind a
 * "looks fine" summary. An empty state here is a claim worth making loudly, and
 * a non-empty one is not a failure of the panel.
 */

const SECTIONS: { key: keyof Coverage; title: string; consequence: string }[] = [
  {
    key: 'orphans',
    title: 'Orphans',
    consequence: 'No edges at all. Unreachable by any traversal, so it can never appear in an answer.',
  },
  {
    key: 'unresolved_anomaly_types',
    title: 'Anomaly types with no resolving SOP',
    consequence: '"What do I do about this?" walks to this node and stops. The procedure half of the answer is missing.',
  },
  {
    key: 'sensors_without_thresholds',
    title: 'Sensors with no threshold',
    consequence: 'Nothing connects a reading to an anomaly, so no causal walk can start from this sensor.',
  },
  {
    key: 'thresholds_without_triggers',
    title: 'Thresholds that trigger nothing',
    consequence: 'The limit is recorded but leads nowhere — a dead end one hop in.',
  },
  {
    key: 'empty_sops',
    title: 'SOPs with no steps',
    consequence: 'The document is named but its procedure is not authored, so the answer can cite it without being able to quote it.',
  },
]

export function CoverageView() {
  const [data, setData] = useState<Coverage | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchCoverage().then(setData).catch((e: Error) => setError(e.message))
  }, [])

  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-rose-400/40 bg-rose-400/10 p-3 text-xs theme-text">
        <AlertCircle size={14} className="text-rose-400 shrink-0" />
        {error}
      </div>
    )
  }
  if (!data) return <Skeleton className="h-48 w-full" />

  return (
    <div className="space-y-5">
      <header className="flex items-baseline justify-between gap-4">
        <div>
          <h3 className="text-sm theme-text">Coverage</h3>
          <p className="text-xs theme-text-muted">
            Every row is a question the graph cannot answer.
          </p>
        </div>
        <span
          className={`shrink-0 rounded-full border px-2.5 py-1 text-xs ${
            data.total_gaps === 0
              ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-400'
              : 'border-amber-400/40 bg-amber-400/10 text-amber-400'
          }`}
        >
          {data.total_gaps} {data.total_gaps === 1 ? 'gap' : 'gaps'}
        </span>
      </header>

      {SECTIONS.map(({ key, title, consequence }) => {
        const items = (data[key] as GraphNode[]) ?? []
        return (
          <section key={key} className="rounded-lg border theme-border theme-card p-3">
            <div className="flex items-center gap-2">
              {items.length === 0 ? (
                <CheckCircle2 size={13} className="text-emerald-400 shrink-0" />
              ) : (
                <AlertCircle size={13} className="text-amber-400 shrink-0" />
              )}
              <h4 className="text-xs theme-text">{title}</h4>
              <span className="ml-auto text-[10px] theme-text-muted">{items.length}</span>
            </div>
            <p className="mt-1.5 pl-5 text-[11px] leading-relaxed theme-text-muted">{consequence}</p>
            {items.length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-1.5 pl-5">
                {items.map((n) => (
                  <NodeChip key={n.id} node={n} />
                ))}
              </div>
            )}
          </section>
        )
      })}

      <p className="text-[11px] leading-relaxed theme-text-muted">
        Authored in{' '}
        <code className="theme-text">backend/app/data/graph/knowledge_graph.yaml</code>. Run{' '}
        <code className="theme-text">python -m app.services.knowledge_graph</code> for the same
        report in the terminal while editing.
      </p>
    </div>
  )
}
