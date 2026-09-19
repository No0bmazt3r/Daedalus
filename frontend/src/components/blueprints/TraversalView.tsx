import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, X, CornerDownRight, AlertCircle, Sparkles, Play, SkipBack } from 'lucide-react'
import {
  fetchTraversal, seedTraversals,
  type Traversal, type Unavailable as UnavailableShape, type Hop,
} from '../../lib/blueprintsClient'
import { Skeleton } from '../ui/skeleton'
import { NodeChip, EdgeLabel } from './nodeStyles'
import { GraphCanvas } from './GraphCanvas'
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
 * ## The diagram is stepped, not animated
 *
 * §3.2 asks for the walk "highlighting each node and edge in sequence, hop by
 * hop". A stepper rather than a play-through: the reader controls the pace, can
 * hold on the hop that matters, and the same control works in a screenshot for
 * the report. The subgraph shown is only what the walk actually touched — not
 * the whole graph with a path drawn on it — because the claim being made is
 * about what the traversal reached, and the rest of the graph is not evidence.
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
  /** 0 = entry only; n = through hop n. Reset whenever the trace changes. */
  const [step, setStep] = useState(0)

  const load = useCallback(() => {
    if (!queryId) return
    setData(null)
    setStep(0)
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

  // Only what the walk touched. Built from the recorded hops rather than from
  // the live graph, for the same reason the replay itself is: this renders what
  // happened, not what the graph would do now.
  const traversal = data && data.available ? data : null
  const walkNodes = useMemo(() => {
    if (!traversal) return []
    const ids = new Set<string>(traversal.path.entry_nodes)
    for (const h of traversal.path.hops) {
      for (const id of [...h.from, ...h.to]) ids.add(id)
    }
    return [...ids].map(
      (id) => traversal.nodes[id] ?? { id, type: 'Sensor' as const, label: id, missing: true },
    )
  }, [traversal])

  // The pairs the walk actually crossed. Deriving these from `from` × `to`
  // would draw a cartesian product — for a hop spanning two Sensors and two
  // Thresholds that is four edges where the graph has two.
  const walkEdges = useMemo(() => {
    if (!traversal) return []
    return traversal.path.hops.flatMap((h) =>
      (h.edges ?? []).map((e) => ({ ...e, type: h.edge.replace('↩', '') })),
    )
  }, [traversal])

  const highlighted = useMemo(() => {
    if (!traversal) return null
    if (step === 0) return new Set(traversal.path.entry_nodes)
    const ids = new Set<string>(traversal.path.entry_nodes)
    for (const h of traversal.path.hops.filter((x) => x.hop <= step)) {
      for (const id of [...h.from, ...h.to]) ids.add(id)
    }
    return ids
  }, [traversal, step])

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

          <GraphCanvas
            nodes={walkNodes}
            edges={walkEdges}
            selected={null}
            onSelect={() => {}}
            highlight={highlighted}
            height={340}
            caption={
              step === 0
                ? `Entry: ${path.entry_nodes.length} starting node${path.entry_nodes.length === 1 ? '' : 's'}, found by ${path.entry_strategy}. Step through the hops below.`
                : `Hop ${step} of ${path.hops.length}${path.hops[step - 1]?.reason ? ` — ${path.hops[step - 1].reason}` : ''}`
            }
          />

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => setStep(0)}
              disabled={step === 0}
              title="back to entry"
              className="rounded-md border theme-border px-2 py-1.5 theme-text-muted transition-opacity hover:theme-text disabled:opacity-30"
            >
              <SkipBack size={12} />
            </button>
            {/* One button per hop rather than a play control: a reader wants to
                stop on the hop that carries the argument, not watch it go by. */}
            {path.hops.map((h) => (
              <button
                key={h.hop}
                onClick={() => setStep(h.hop)}
                className={`rounded-md border px-2.5 py-1.5 text-[11px] transition-colors ${
                  step === h.hop
                    ? 'theme-accent-border theme-surface-strong theme-text'
                    : 'theme-border theme-text-muted hover:theme-text'
                }`}
              >
                {h.hop}
              </button>
            ))}
            <button
              onClick={() => setStep(path.hops.length)}
              disabled={step === path.hops.length}
              title="show the full walk"
              className="ml-1 inline-flex items-center gap-1 rounded-md border theme-border px-2 py-1.5 text-[11px] theme-text-muted transition-opacity hover:theme-text disabled:opacity-30"
            >
              <Play size={11} /> all
            </button>
          </div>

          <ol className="space-y-4 border-l theme-border pl-3">
            {path.hops.map((h) => (
              <li key={h.hop} className={step !== 0 && h.hop > step ? 'opacity-30' : ''}>
                <ol><HopRow hop={h} nodes={data.nodes} /></ol>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  )
}
