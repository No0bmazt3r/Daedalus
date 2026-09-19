import { useCallback, useEffect, useState } from 'react'
import { Check, X, CornerDownRight, AlertCircle, Sparkles } from 'lucide-react'
import {
  fetchTraversal, seedTraversals,
  type Traversal, type Unavailable as UnavailableShape, type Hop,
} from '../../lib/blueprintsClient'
import { Skeleton } from '../ui/skeleton'
import { NodeChip, EdgeLabel } from './nodeStyles'
import { Unavailable } from './Unavailable'

/**
 * Traversal replay — MODULES.md §3.2, the feature that earns this module.
 *
 * A static graph browser is mildly useful. Replaying the walk the agent actually
 * took is the deliverable, and it is the **only** view in the system that makes
 * the dual-track comparison visible rather than statistical. The comparison
 * chapter will report that GraphRAG won or lost on multi-hop causal queries by
 * some margin; this is the figure that shows a reader *why* — flat retrieval
 * embeds the whole question and hopes one chunk covers it, and here is the
 * structural walk that did not have to hope.
 *
 * ## It renders a recording, never a re-run
 *
 * Every hop comes from `rag_logs.traversal_path`, written when the query ran.
 * Re-deriving the walk here would show what the graph *would* do today rather
 * than what produced that answer — and MODULES.md §0 rule 2 is that Layer 10
 * has one source of truth.
 *
 * ## The sufficiency verdicts are the argument
 *
 * "Is this enough?" between hops is what makes Track 2 agentic rather than a
 * fancy join, and it is also the step PROJECT.md §5 flags as the honest risk:
 * sub-2B SLMs may be too small to do that meta-reasoning well. Printing each
 * verdict next to the hop it followed is what lets a reader judge whether the
 * model was actually reasoning or just walking until it ran out of hops.
 */

function HopRow({ hop, nodes }: { hop: Hop; nodes: Traversal['nodes'] }) {
  const resolve = (ids: string[]) => ids.map((id) => nodes[id] ?? { id, type: 'Sensor' as const, label: id, missing: true })
  const deadEnd = hop.to.length === 0

  return (
    <li className="relative pl-7">
      <span className="absolute left-0 top-1 flex h-5 w-5 items-center justify-center rounded-full border theme-border theme-card text-[10px] theme-text-muted">
        {hop.hop}
      </span>

      <div className="flex flex-wrap items-center gap-1.5">
        {resolve(hop.from).map((n) => <NodeChip key={n.id} node={n} />)}
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-2 pl-3">
        <CornerDownRight size={12} className="theme-text-muted shrink-0" />
        <EdgeLabel edge={hop.edge} />
        {deadEnd ? (
          // A hop that reached nothing is rendered, not dropped. MODULES.md §3.3
          // is about omission being invisible — a recorded dead end is exactly
          // the evidence that the graph was asked and had no answer, and it is
          // what a coverage gap costs at answer time.
          <span className="rounded border border-amber-400/40 bg-amber-400/10 px-2 py-0.5 text-[10px] text-amber-400">
            reached nothing — no edge of this type was authored
          </span>
        ) : (
          <div className="flex flex-wrap items-center gap-1.5">
            {resolve(hop.to).map((n) => <NodeChip key={n.id} node={n} />)}
          </div>
        )}
      </div>

      {hop.reason !== null && (
        <div className="mt-1.5 flex items-start gap-1.5 pl-3">
          {hop.sufficient ? (
            <Check size={12} className="mt-0.5 shrink-0 text-emerald-400" />
          ) : (
            <X size={12} className="mt-0.5 shrink-0 theme-text-muted" />
          )}
          <span className="text-[11px] theme-text-muted">
            sufficient? <span className={hop.sufficient ? 'text-emerald-400' : 'theme-text'}>
              {hop.sufficient ? 'yes' : 'no'}
            </span> — {hop.reason}
          </span>
        </div>
      )}
    </li>
  )
}

export function TraversalView({ queryId }: { queryId: string | null }) {
  const [data, setData] = useState<Traversal | UnavailableShape | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [seeding, setSeeding] = useState(false)

  const load = useCallback(() => {
    if (!queryId) return
    setData(null)
    fetchTraversal(queryId).then(setData).catch((e: Error) => setError(e.message))
  }, [queryId])

  useEffect(load, [load])

  const seed = async () => {
    setSeeding(true)
    try {
      await seedTraversals(true)
      load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSeeding(false)
    }
  }

  if (!queryId) {
    return (
      <Unavailable
        blockedBy="M5 / M6"
        reason={
          'Nothing has recorded a graph traversal yet, because the orchestrator is not wired. ' +
          'Seed a set of real walks to develop and review this view against — they run through ' +
          'the actual graph tools, so what is stored is what those tools really did.'
        }
        action={
          <button
            onClick={seed}
            disabled={seeding}
            className="inline-flex items-center gap-1.5 rounded-md border theme-accent-border px-3 py-1.5 text-xs theme-accent transition-opacity disabled:opacity-50"
          >
            <Sparkles size={12} />
            {seeding ? 'seeding…' : 'Seed recorded traversals'}
          </button>
        }
      />
    )
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-rose-400/40 bg-rose-400/10 p-3 text-xs theme-text">
        <AlertCircle size={14} className="shrink-0 text-rose-400" /> {error}
      </div>
    )
  }
  if (!data) return <Skeleton className="h-64 w-full" />
  if (!data.available) return <Unavailable reason={data.reason} blockedBy={data.blocked_by} />

  const { path } = data
  const refused = path.entry_nodes.length === 0

  return (
    <div className="space-y-4">
      <header className="space-y-2">
        <p className="text-sm leading-relaxed theme-text">“{data.query_text}”</p>
        <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
          <code className="rounded border theme-border px-1.5 py-0.5 theme-text-muted">
            {data.query_id}
          </code>
          <span className="rounded border theme-border px-1.5 py-0.5 theme-text-muted">
            {data.hop_count} {data.hop_count === 1 ? 'hop' : 'hops'}
          </span>
          <span className="rounded border theme-border px-1.5 py-0.5 theme-text-muted">
            {data.retrieval_latency_ms ?? '—'} ms
          </span>
          {/* The evidence that Track 2 stayed embedding-free, read from the
              data rather than asserted. A `vector` value here would mean the
              decision was reversed somewhere. */}
          <span
            title="how the starting nodes were found"
            className={`rounded border px-1.5 py-0.5 ${
              path.entry_strategy === 'vector'
                ? 'border-rose-400/40 bg-rose-400/10 text-rose-400'
                : 'border-emerald-400/40 bg-emerald-400/10 text-emerald-400'
            }`}
          >
            entry: {path.entry_strategy ?? 'none'}
          </span>
        </div>
      </header>

      {refused ? (
        <div className="rounded-lg border border-dashed theme-border p-4">
          <p className="text-xs theme-text">
            No entry point. Nothing in the question matched a node, so the walk never started.
          </p>
          <p className="mt-1.5 text-[11px] leading-relaxed theme-text-muted">
            For an out-of-corpus question this is the correct outcome and the behaviour
            PROJECT.md §5 measures as refusal correctness. For a question the graph
            <em> should</em> have answered, the fix is usually an alias rather than code.
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wider theme-text-muted">entry</span>
            {path.entry_nodes.map((id) => {
              const n = data.nodes[id]
              return n ? <NodeChip key={id} node={n} /> : <code key={id} className="text-[10px]">{id}</code>
            })}
          </div>
          <ol className="space-y-4 border-l theme-border pl-3">
            {path.hops.map((h) => (
              <HopRow key={h.hop} hop={h} nodes={data.nodes} />
            ))}
          </ol>
        </>
      )}
    </div>
  )
}
