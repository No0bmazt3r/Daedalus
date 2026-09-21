import { useCallback, useEffect, useState } from 'react'
import {
  Plus, Trash2, AlertCircle, Check, X, Link2, Boxes, History, ChevronRight, ListChecks,
  Sparkles,
} from 'lucide-react'
import {
  fetchAuthoringStatus, fetchAuthoringHistory, createGraphNode, deleteGraphNode,
  createGraphEdge, deleteGraphEdge, fetchNodes,
  type AuthoringStatus, type GraphEdit, type GraphNode, type NodeType,
  type GraphEdge,
} from '../../lib/blueprintsClient'
import { Skeleton } from '../ui/skeleton'
import { NodeChip } from './nodeStyles'
import { ThemeSelect } from '../ui/theme-select'
import { StepRail, StepFooter, type Step } from '../ui/stepper'
import { ProposalQueue } from './ProposalQueue'

/**
 * Building the graph — Track 2's pipeline, MODULES.md §3.
 *
 * Track 1 gets knowledge by ingesting documents; Track 2 gets it by somebody
 * authoring nodes and edges. Until this existed that meant hand-editing
 * `knowledge_graph.yaml` and finding out whether it was valid on the next
 * request — which for a schema whose failure mode is *silent retrieval loss*
 * (§3.3) is the wrong moment to learn.
 *
 * ## The forms are generated from the backend's schema
 *
 * Node types, edge domains and each type's fields all come from
 * `/api/graph/authoring/schema`. Restating them here in TypeScript would produce
 * a dropdown offering edges the validator refuses — a bug that only appears at
 * save time, and reappears every time the schema changes.
 *
 * ## Refusals are the useful part
 *
 * The history shows failed edits, not just successful ones. `Sensor
 * --RESOLVED_BY--> SOPDocument` is plausible English and meaningless in this
 * schema, and the log of things the schema said no to is what somebody
 * debugging an authoring session actually wants. The YAML is never left
 * invalid — a refused edit does not touch the file at all.
 *
 * ## Why this is a stepper
 *
 * Because the dependency is real and it is the first thing that confuses people:
 * **an edge cannot exist before its two endpoints do.** On one page, the edge
 * form sits there fully rendered with two empty pickers and no way to tell
 * whether that is a bug or the honest state of an empty graph. As a step it is
 * gated, and the rail says the reason.
 *
 * Nodes → Edges → Review is also the order a graph actually gets built, and the
 * order §3.3's coverage report reads it back in. Going *back* is unrestricted,
 * because authoring is iterative — you add a node, connect it, notice a gap,
 * add another — and a wizard that made you finish step 1 before ever seeing
 * step 2 would be describing a different activity.
 *
 * ## This does not invent anything
 *
 * No suggestion, no inference, no model. A node exists because a person wrote
 * it, which is the provenance that makes `search_graph` SYSTEM integrity rather
 * than CORPUS. A button that generated nodes would quietly demote the whole
 * track to the standing of an ingested PDF.
 */

const STEPS: readonly Step[] = [
  // Propose is step 1 because it is the cheap way in: reading the corpus and
  // accepting what survives is faster than typing, and what it cannot find is
  // exactly what steps 2 and 3 are for. Nothing forces it — an empty corpus or
  // no model simply leaves the queue empty and the manual steps unaffected.
  { id: 1, label: 'Propose', icon: Sparkles, hint: 'Extract candidates from the corpus — nothing is written until you accept' },
  { id: 2, label: 'Nodes', icon: Boxes, hint: 'The things the graph knows about' },
  { id: 3, label: 'Edges', icon: Link2, hint: 'How they relate — each edge type has fixed endpoints' },
  { id: 4, label: 'Review', icon: History, hint: 'Gaps, and every edit including the refused ones' },
]

function EdgeBadge({ type }: { type: string }) {
  return (
    <code className="rounded border theme-border px-1 py-0.5 text-[9px] theme-text-muted">
      {type}
    </code>
  )
}

function NodeForm({
  status, onDone,
}: {
  status: AuthoringStatus
  onDone: () => void
}) {
  const [type, setType] = useState<NodeType>(status.schema.node_types[0].id)
  const [slug, setSlug] = useState('')
  const [fields, setFields] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const spec = status.schema.node_types.find((t) => t.id === type)!
  const nodeId = `${spec.id_prefix}${slug.trim()}`

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const attributes = Object.fromEntries(
        Object.entries(fields).filter(([, v]) => v.trim() !== ''),
      )
      await createGraphNode(type, nodeId, attributes)
      setSlug('')
      setFields({})
      onDone()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2.5 rounded-lg border theme-border theme-card p-3">
      <div className="flex items-center gap-2">
        <Boxes size={13} className="theme-accent" />
        <h4 className="text-xs theme-text">Add a node</h4>
      </div>

      <div className="flex flex-wrap gap-1">
        {status.schema.node_types.map((t) => (
          <button
            key={t.id}
            onClick={() => { setType(t.id); setFields({}) }}
            className={`rounded-md border px-1.5 py-0.5 text-[10px] transition-colors ${
              type === t.id
                ? 'theme-accent-border theme-surface-strong theme-text'
                : 'theme-border theme-text-muted hover:theme-text'
            }`}
          >
            {t.id}
          </button>
        ))}
      </div>

      <label className="block">
        <span className="text-[10px] theme-text-muted">
          Id — the prefix is fixed, because it is what makes an id self-describing in a traversal
        </span>
        <span className="mt-1 flex items-center rounded-md border theme-border theme-surface">
          <span className="shrink-0 px-2 py-1 font-mono text-[11px] theme-text-muted">
            {spec.id_prefix}
          </span>
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="co2_ppm"
            className="min-w-0 flex-1 bg-transparent py-1 pr-2 font-mono text-[11px] theme-text outline-none placeholder:opacity-40"
          />
        </span>
      </label>

      {spec.fields.map((f) => (
        <label key={f.name} className="block">
          <span className="text-[10px] theme-text-muted">{f.name} — {f.hint}</span>
          <input
            value={fields[f.name] ?? ''}
            onChange={(e) => setFields((prev) => ({ ...prev, [f.name]: e.target.value }))}
            className="mt-1 w-full rounded-md border theme-border theme-surface px-2 py-1 text-[11px] theme-text outline-none focus:ring-1 focus:ring-[color-mix(in_srgb,var(--primary)_55%,transparent)]"
          />
        </label>
      ))}

      {error && (
        <p className="flex items-start gap-1.5 whitespace-pre-line text-[10px] leading-relaxed text-rose-400">
          <AlertCircle size={11} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}

      <button
        onClick={submit}
        disabled={busy || !slug.trim()}
        className="flex w-full items-center justify-center gap-1.5 rounded-md border theme-accent-border px-2 py-1 text-[11px] theme-accent transition-colors hover:theme-surface-strong disabled:opacity-40"
      >
        <Plus size={11} /> {busy ? 'Validating…' : `Create ${nodeId}`}
      </button>
    </div>
  )
}

function EdgeForm({
  status, nodes, onDone,
}: {
  status: AuthoringStatus
  nodes: GraphNode[]
  onDone: () => void
}) {
  const [edgeType, setEdgeType] = useState(status.schema.edge_types[0].id)
  const [source, setSource] = useState('')
  const [target, setTarget] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const domain = status.schema.edge_types.find((e) => e.id === edgeType)!
  // Filtered to the domain, so the picker cannot offer an edge the validator
  // will refuse. The backend still checks — this is convenience, not the rule.
  const sources = nodes.filter((n) => n.type === domain.from)
  const targets = nodes.filter((n) => n.type === domain.to)

  // Derived, not reset in an effect. Changing the edge type changes which nodes
  // are legal, so a previously chosen endpoint may no longer be in the list —
  // and a `<select>` whose value is absent from its options renders blank while
  // still holding the old id. Clearing it during render is one pass; clearing it
  // in an effect on `edgeType` publishes the stale pairing first, then corrects.
  const from = sources.some((n) => n.id === source) ? source : ''
  const to = targets.some((n) => n.id === target) ? target : ''

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      await createGraphEdge(from, edgeType, to)
      setSource('')
      setTarget('')
      onDone()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2.5 rounded-lg border theme-border theme-card p-3">
      <div className="flex items-center gap-2">
        <Link2 size={13} className="theme-accent" />
        <h4 className="text-xs theme-text">Connect two nodes</h4>
      </div>

      <div className="flex flex-wrap gap-1">
        {status.schema.edge_types.map((e) => (
          <button
            key={e.id}
            onClick={() => setEdgeType(e.id)}
            title={`${e.from} → ${e.to}`}
            className={`rounded-md border px-1.5 py-0.5 text-[10px] transition-colors ${
              edgeType === e.id
                ? 'theme-accent-border theme-surface-strong theme-text'
                : 'theme-border theme-text-muted hover:theme-text'
            }`}
          >
            {e.id}
          </button>
        ))}
      </div>

      <p className="text-[10px] theme-text-muted">
        <code className="theme-text">{domain.from}</code> →{' '}
        <code className="theme-text">{domain.to}</code> · the schema permits nothing else for this
        edge
      </p>

      {/* `ThemeSelect`, not `<select>`. A native select's option list is drawn by
          the operating system, so it ignores the palette entirely — on a dark
          theme it renders as a grey menu with a blue highlight and unreadable
          rows. This component exists precisely for that and was already in the
          codebase; using the native element here was the oversight. */}
      {([['From', from, setSource, sources], ['To', to, setTarget, targets]] as const).map(
        ([label, value, set, options]) => (
          <div key={label}>
            <span className="text-[10px] theme-text-muted">
              {label} {options.length === 0 && '— no node of that type exists yet'}
            </span>
            {options.length === 0 ? (
              <p className="mt-1 rounded-md border border-dashed theme-border px-2 py-1.5 text-[10px] theme-text-muted">
                Add a {label === 'From' ? domain.from : domain.to} node first.
              </p>
            ) : (
              <ThemeSelect
                size="sm"
                ariaLabel={`${label} node`}
                value={value}
                onChange={set}
                options={[
                  { value: '', label: 'choose…' },
                  ...options.map((n) => ({ value: n.id, label: n.label || n.id })),
                ]}
                className="mt-1"
              />
            )}
          </div>
        ),
      )}

      {error && (
        <p className="flex items-start gap-1.5 whitespace-pre-line text-[10px] leading-relaxed text-rose-400">
          <AlertCircle size={11} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}

      <button
        onClick={submit}
        disabled={busy || !from || !to}
        className="flex w-full items-center justify-center gap-1.5 rounded-md border theme-accent-border px-2 py-1 text-[11px] theme-accent transition-colors hover:theme-surface-strong disabled:opacity-40"
      >
        <Plus size={11} /> {busy ? 'Validating…' : 'Create edge'}
      </button>
    </div>
  )
}

function HistoryRow({ edit }: { edit: GraphEdit }) {
  const [open, setOpen] = useState(false)
  const failed = !edit.ok
  return (
    <div className={`rounded-md border px-2 py-1 ${failed ? 'border-rose-400/40 bg-rose-400/5' : 'theme-border'}`}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 text-left text-[10px]"
      >
        {failed ? (
          <X size={10} className="shrink-0 text-rose-400" />
        ) : (
          <Check size={10} className="shrink-0 theme-accent" />
        )}
        <span className="shrink-0 theme-text-muted">{edit.action}</span>
        <EdgeBadge type={edit.target} />
        <span className="min-w-0 flex-1 truncate font-mono theme-text">{edit.element_id}</span>
        <span className="shrink-0 tabular-nums theme-text-muted">
          {edit.ok ? `${edit.nodes_after}n/${edit.edges_after}e` : ''}
        </span>
        {failed && (
          <ChevronRight size={10} className={`shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
        )}
      </button>
      {open && failed && edit.error && (
        <p className="mt-1 whitespace-pre-line pl-4 text-[10px] leading-relaxed text-rose-400">
          {edit.error}
        </p>
      )}
      {edit.note && <p className="pl-4 text-[10px] theme-text-muted">{edit.note}</p>}
    </div>
  )
}

export function AuthoringView() {
  const [status, setStatus] = useState<AuthoringStatus | null>(null)
  const [nodes, setNodes] = useState<GraphNode[]>([])
  const [edges, setEdges] = useState<GraphEdge[]>([])
  const [history, setHistory] = useState<GraphEdit[]>([])
  const [failuresOnly, setFailuresOnly] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [step, setStep] = useState(1)

  const refresh = useCallback(() => {
    void fetchAuthoringStatus().then(setStatus).catch((e: Error) => setError(e.message))
    void fetchNodes()
      .then((r) => { setNodes(r.nodes); setEdges(r.edges) })
      .catch(() => { setNodes([]); setEdges([]) })
  }, [])

  useEffect(() => { refresh() }, [refresh])

  useEffect(() => {
    void fetchAuthoringHistory(failuresOnly).then((r) => setHistory(r.edits)).catch(() => setHistory([]))
  }, [failuresOnly, status?.totals.nodes, status?.totals.edges])

  const remove = async (fn: () => Promise<unknown>) => {
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError((e as Error).message)
    }
    refresh()
  }

  if (!status) {
    return error
      ? <div className="rounded-lg border border-rose-400/40 bg-rose-400/10 p-3 text-xs theme-text">{error}</div>
      : <Skeleton className="h-96 w-full" />
  }

  const connectable = status.schema.edge_types.some(
    (e) => nodes.some((n) => n.type === e.from) && nodes.some((n) => n.type === e.to),
  )
  // The one real dependency, stated rather than left to be discovered: an edge
  // needs both of its endpoints to exist, and the schema says which types those
  // must be. Until some edge type has both ends available, step 2 is a form
  // that cannot be completed.
  const noPair = !connectable
    ? nodes.length === 0
      ? 'Add a node first — an edge needs two that already exist'
      : 'No edge type has both of its endpoint types yet — add the other end'
    : undefined
  const blocked: Record<number, string | undefined> = {
    1: undefined, 2: undefined, 3: noPair, 4: undefined,
  }

  return (
    <div className="space-y-4">
      <StepRail steps={STEPS} step={step} setStep={setStep} blocked={blocked} />

      <div>
        <h3 className="text-sm theme-text">{STEPS[step - 1].label}</h3>
        <p className="text-[11px] theme-text-muted">{STEPS[step - 1].hint}</p>
      </div>

      {!status.valid && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-400/40 bg-rose-400/10 p-2.5">
          <AlertCircle size={13} className="mt-0.5 shrink-0 text-rose-400" />
          <div className="min-w-0 text-[11px] leading-relaxed theme-text">
            <p>The graph file does not validate, so Track 2 cannot load it.</p>
            <p className="mt-1 whitespace-pre-line theme-text-muted">{status.error}</p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg border theme-border theme-card px-3 py-2">
          <div className="text-lg tabular-nums theme-text">{status.totals.nodes}</div>
          <div className="text-[10px] uppercase tracking-wider theme-text-muted">Nodes</div>
        </div>
        <div className="rounded-lg border theme-border theme-card px-3 py-2">
          <div className="text-lg tabular-nums theme-text">{status.totals.edges}</div>
          <div className="text-[10px] uppercase tracking-wider theme-text-muted">Edges</div>
        </div>
        <div className="rounded-lg border theme-border theme-card px-3 py-2">
          <div className="text-lg tabular-nums theme-text">
            {(status.coverage.total_gaps as number) ?? '—'}
          </div>
          <div className="text-[10px] uppercase tracking-wider theme-text-muted">Gaps</div>
          <div className="mt-0.5 text-[10px] theme-text-muted opacity-70">see Coverage</div>
        </div>
      </div>

      <p className="text-[10px] leading-relaxed theme-text-muted">
        Authored to <code className="theme-text">{status.path}</code>. Still a git-tracked YAML —
        every edit here is validated before it is written, and a refused edit leaves the file
        untouched.
      </p>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-400/40 bg-rose-400/10 p-2.5 text-[11px] theme-text">
          <AlertCircle size={13} className="mt-0.5 shrink-0 text-rose-400" />
          <span className="whitespace-pre-line">{error}</span>
        </div>
      )}

      {step === 1 && <ProposalQueue onApplied={refresh} />}
      {step === 2 && <NodeForm status={status} onDone={refresh} />}
      {step === 3 && <EdgeForm status={status} nodes={nodes} onDone={refresh} />}

      {/* Two blocks in one branch, so a fragment. */}
      {step === 2 && (
      <>
      <div className="space-y-1.5">
        <h4 className="text-xs theme-text">Nodes by type</h4>
        <div className="flex flex-wrap gap-1">
          {status.by_type.map((t) => (
            <span
              key={t.type}
              className="flex items-center gap-1 rounded-md border theme-border px-1.5 py-0.5 text-[10px] theme-text-muted"
            >
              {t.type} <span className="tabular-nums theme-text">{t.count}</span>
            </span>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <h4 className="text-xs theme-text">Delete a node</h4>
        <div className="max-h-52 space-y-1 overflow-y-auto no-scrollbar">
          {nodes.map((n) => (
            <div key={n.id} className="flex items-center gap-2 rounded-md border theme-border px-2 py-1">
              <NodeChip node={n} />
              <span className="min-w-0 flex-1 truncate text-[10px] theme-text-muted">{n.id}</span>
              <button
                onClick={() => remove(() => deleteGraphNode(n.id))}
                title="Refused while edges point at it — pass cascade to take them with it"
                className="shrink-0 rounded p-0.5 theme-text-muted transition-colors hover:text-rose-400"
              >
                <Trash2 size={11} />
              </button>
              <button
                onClick={() => remove(() => deleteGraphNode(n.id, true))}
                title="Delete this node and every edge attached to it"
                className="shrink-0 rounded px-1 text-[9px] theme-text-muted transition-colors hover:text-rose-400"
              >
                cascade
              </button>
            </div>
          ))}
        </div>
      </div>

      </>
      )}

      {step === 3 && (
      <div className="space-y-1.5">
        <h4 className="text-xs theme-text">Delete an edge</h4>
        <div className="max-h-52 space-y-1 overflow-y-auto no-scrollbar">
          {edges.length === 0 ? (
            <p className="py-2 text-[10px] theme-text-muted">No edges yet.</p>
          ) : (
            edges.map((e) => (
              <div
                key={`${e.from}|${e.type}|${e.to}`}
                className="flex items-center gap-1.5 rounded-md border theme-border px-2 py-1 text-[10px]"
              >
                <span className="min-w-0 flex-1 truncate font-mono theme-text-muted">
                  {e.from} <EdgeBadge type={e.type} /> {e.to}
                </span>
                <button
                  onClick={() => remove(() => deleteGraphEdge(e.from, e.type, e.to))}
                  className="shrink-0 rounded p-0.5 theme-text-muted transition-colors hover:text-rose-400"
                >
                  <Trash2 size={11} />
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      )}

      {step === 4 && (status.coverage.total_gaps as number) > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-400/40 bg-amber-400/10 p-2.5">
          <ListChecks size={13} className="mt-0.5 shrink-0 text-amber-400" />
          <p className="min-w-0 flex-1 text-[11px] leading-relaxed theme-text">
            {status.coverage.total_gaps as number} structural gap(s) — nodes that are legal but
            leave a question unanswerable.{' '}
            <span className="theme-text-muted">
              The Coverage tab lists them one by one; a hand-authored graph fails by omission, and
              omission is invisible from the answer side.
            </span>
          </p>
        </div>
      )}

      {step === 4 && (
      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <History size={13} className="theme-accent" />
          <h4 className="text-xs theme-text">Edit history</h4>
          <button
            onClick={() => setFailuresOnly((v) => !v)}
            className={`ml-auto rounded-md border px-1.5 py-0.5 text-[10px] transition-colors ${
              failuresOnly
                ? 'border-rose-400/40 text-rose-400'
                : 'theme-border theme-text-muted hover:theme-text'
            }`}
          >
            {failuresOnly ? 'refused only' : 'all edits'}
          </button>
        </div>
        <p className="text-[10px] leading-relaxed theme-text-muted">
          Refused edits are kept. The schema saying no is the most informative thing in an
          authoring session, and a log of only what worked would omit it.
        </p>
        <div className="max-h-64 space-y-1 overflow-y-auto no-scrollbar">
          {history.length === 0 ? (
            <p className="py-2 text-[10px] theme-text-muted">
              {failuresOnly ? 'No refused edits.' : 'No edits yet.'}
            </p>
          ) : (
            history.map((e) => <HistoryRow key={e.edit_id} edit={e} />)
          )}
        </div>
      </div>
      )}

      <StepFooter steps={STEPS} step={step} setStep={setStep} nextBlocked={blocked[step + 1]} />
    </div>
  )
}
