import { useEffect, useMemo, useState } from 'react'
import { Search, ArrowRight, ArrowLeft, AlertCircle, Network, Table2 } from 'lucide-react'
import {
  fetchGraphSchema, fetchNodes, fetchNode, NODE_TYPES,
  type GraphSchema, type GraphNode, type GraphEdge, type NodeDetail, type NodeType,
} from '../../lib/blueprintsClient'
import { Skeleton } from '../ui/skeleton'
import { NODE_STYLE, TypeBadge, NodeChip, EdgeLabel, shortId } from './nodeStyles'
import { GraphCanvas } from './GraphCanvas'

/**
 * The graph browser — MODULES.md §3.1 half B.
 *
 * Browse the hand-authored knowledge graph as a list, search it, and see any
 * node with its neighbours.
 *
 * ## Two views of the same set, which is MODULES.md §3.6's actual instruction
 *
 * "Provide a table view alongside the canvas." Not instead of — alongside, and
 * the reason is that they answer different questions. The diagram shows
 * structure: that two Thresholds converge on one AnomalyType is a shape you see
 * in one glance and would have to reconstruct from rows. The table shows
 * inventory: "every AnomalyType with no resolving SOP" is a list, and a
 * node-link diagram of sixty nodes is a hairball you would have to count.
 *
 * So the toggle is not a preference. Both filter the same query, so narrowing
 * to one node type in the table narrows the diagram to that type's subgraph —
 * which is also the cure for the hairball.
 *
 * ## Neighbours are shown in both directions
 *
 * Half this schema reads backwards. An SOPDocument's useful neighbour is the
 * AnomalyType that points *at* it via RESOLVED_BY, and an AnomalyType's history
 * is the AnomalyRecords pointing in via INSTANCE_OF. Showing only outgoing
 * edges would make those nodes look like leaves.
 */

/** Attributes worth printing in the detail pane, in the order they read. */
const DETAIL_FIELDS: { key: keyof GraphNode; label: string }[] = [
  { key: 'column', label: 'telemetry column' },
  { key: 'unit', label: 'unit' },
  { key: 'operator', label: 'operator' },
  { key: 'value', label: 'value' },
  { key: 'applies_mode', label: 'applies in mode' },
  { key: 'filename', label: 'source file' },
  { key: 'version', label: 'version' },
  { key: 'step_number', label: 'step' },
  { key: 'occurred_at', label: 'occurred' },
  { key: 'severity', label: 'severity' },
  { key: 'resolution', label: 'resolution' },
]

function Legend({ schema }: { schema: GraphSchema }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {schema.nodes.map(({ type, count }) => {
        const Icon = NODE_STYLE[type].icon
        return (
          <span
            key={type}
            className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[10px] ${NODE_STYLE[type].ring}`}
          >
            <Icon size={11} className={NODE_STYLE[type].tint} />
            <span className="theme-text">{type}</span>
            <span className="theme-text-muted">{count}</span>
          </span>
        )
      })}
    </div>
  )
}

function Detail({ detail, onNavigate }: { detail: NodeDetail; onNavigate: (id: string) => void }) {
  const { node, outgoing, incoming } = detail
  const fields = DETAIL_FIELDS.filter(
    (f) => node[f.key] !== undefined && node[f.key] !== null && node[f.key] !== '',
  )

  return (
    <div className="space-y-4">
      <header className="space-y-1.5">
        <TypeBadge type={node.type} />
        <h3 className="text-sm theme-text">{node.label}</h3>
        <code className="block text-[10px] theme-text-muted">{node.id}</code>
        {node.description && (
          <p className="pt-1 text-xs leading-relaxed theme-text-muted">{node.description}</p>
        )}
      </header>

      {fields.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
          {fields.map((f) => (
            <div key={String(f.key)} className="contents">
              <dt className="theme-text-muted">{f.label}</dt>
              <dd className="theme-text">{String(node[f.key])}</dd>
            </div>
          ))}
        </dl>
      )}

      {node.aliases && node.aliases.length > 0 && (
        <section>
          <h4 className="text-[11px] theme-text-muted">
            Aliases — how a question reaches this node
          </h4>
          {/* Load-bearing, not decoration: Track 2 is embedding-free, so these
              are the entry points. Every alias not authored is a phrasing the
              graph answers worse. */}
          <div className="mt-1.5 flex flex-wrap gap-1">
            {node.aliases.map((a) => (
              <code key={a} className="rounded border theme-border px-1.5 py-0.5 text-[10px] theme-text-muted">
                {a}
              </code>
            ))}
          </div>
        </section>
      )}

      {[
        { rows: outgoing, title: 'Points to', Icon: ArrowRight },
        { rows: incoming, title: 'Pointed to by', Icon: ArrowLeft },
      ].map(({ rows, title, Icon }) =>
        rows.length === 0 ? null : (
          <section key={title}>
            <h4 className="flex items-center gap-1.5 text-[11px] theme-text-muted">
              <Icon size={11} /> {title}
            </h4>
            <ul className="mt-1.5 space-y-1">
              {rows.map((n, i) => (
                <li key={`${n.edge}-${n.node.id}-${i}`} className="flex items-center gap-2">
                  <EdgeLabel edge={n.edge} />
                  <NodeChip node={n.node} onClick={() => onNavigate(n.node.id)} />
                </li>
              ))}
            </ul>
          </section>
        ),
      )}

      {outgoing.length === 0 && incoming.length === 0 && (
        <p className="rounded border border-dashed theme-border p-3 text-[11px] theme-text-muted">
          No edges. This node is unreachable by any traversal — see Coverage.
        </p>
      )}
    </div>
  )
}

export function GraphView() {
  const [schema, setSchema] = useState<GraphSchema | null>(null)
  const [nodes, setNodes] = useState<GraphNode[] | null>(null)
  const [edges, setEdges] = useState<GraphEdge[]>([])
  const [view, setView] = useState<'diagram' | 'table'>('diagram')
  const [query, setQuery] = useState('')
  const [type, setType] = useState<NodeType | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [detail, setDetail] = useState<NodeDetail | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchGraphSchema().then(setSchema).catch((e: Error) => setError(e.message))
  }, [])

  // Debounced so typing does not fire a request per keystroke. The graph is
  // tiny and the backend would cope, but a list that reorders under the cursor
  // on every character is unpleasant to use regardless of cost.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      fetchNodes({ q: query, type })
        .then((r) => {
          setNodes(r.nodes)
          setEdges(r.edges)
        })
        .catch((e: Error) => setError(e.message))
    }, 180)
    return () => window.clearTimeout(timer)
  }, [query, type])

  useEffect(() => {
    if (!selected) {
      setDetail(null)
      return
    }
    fetchNode(selected).then(setDetail).catch((e: Error) => setError(e.message))
  }, [selected])

  const grouped = useMemo(() => {
    const out = new Map<NodeType, GraphNode[]>()
    for (const n of nodes ?? []) {
      const list = out.get(n.type)
      if (list) list.push(n)
      else out.set(n.type, [n])
    }
    return [...out.entries()]
  }, [nodes])

  if (error) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-rose-400/40 bg-rose-400/10 p-3 text-xs theme-text">
        <AlertCircle size={14} className="mt-0.5 shrink-0 text-rose-400" />
        <div>
          <p>{error}</p>
          <p className="mt-1 theme-text-muted">
            A graph that does not validate is not served as an empty one — fix the authoring
            error named above in <code>knowledge_graph.yaml</code>.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {schema ? <Legend schema={schema} /> : <Skeleton className="h-8 w-full" />}

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 theme-text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search id, label or alias"
            className="w-full rounded-md border theme-border theme-card py-1.5 pl-8 pr-2 text-xs theme-text outline-none focus:theme-accent-border"
          />
        </div>
        <select
          value={type ?? ''}
          onChange={(e) => setType((e.target.value || null) as NodeType | null)}
          className="rounded-md border theme-border theme-card px-2 py-1.5 text-xs theme-text outline-none theme-select"
        >
          <option value="">All types</option>
          {NODE_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <div className="flex shrink-0 overflow-hidden rounded-md border theme-border">
          {([['diagram', Network], ['table', Table2]] as const).map(([id, Icon]) => (
            <button
              key={id}
              onClick={() => setView(id)}
              title={id === 'diagram' ? 'Node-link diagram — structure' : 'Grouped list — inventory'}
              className={`px-2 py-1.5 transition-colors ${
                view === id ? 'theme-bg-primary theme-text-on-primary' : 'theme-text-muted hover:theme-text'
              }`}
            >
              <Icon size={13} />
            </button>
          ))}
        </div>
      </div>

      {view === 'diagram' && (
        nodes === null ? (
          <Skeleton className="h-[460px] w-full" />
        ) : nodes.length === 0 ? (
          <p className="rounded border border-dashed theme-border p-8 text-center text-xs theme-text-muted">
            No node matches. The graph holds {schema?.total_nodes ?? '—'} nodes.
          </p>
        ) : (
          <GraphCanvas nodes={nodes} edges={edges} selected={selected} onSelect={setSelected} />
        )
      )}

      <div
        className={
          view === 'table'
            ? 'grid gap-4 @2xl:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]'
            : 'grid gap-4'
        }
      >
        <div className={`space-y-3 ${view === 'diagram' ? 'hidden' : ''}`}>
          {nodes === null && <Skeleton className="h-40 w-full" />}
          {nodes !== null && nodes.length === 0 && (
            <p className="rounded border border-dashed theme-border p-4 text-center text-xs theme-text-muted">
              No node matches. The graph holds {schema?.total_nodes ?? '—'} nodes.
            </p>
          )}
          {grouped.map(([nodeType, list]) => (
            <section key={nodeType}>
              <h4 className="mb-1.5 text-[10px] uppercase tracking-wider theme-text-muted">
                {nodeType} · {list.length}
              </h4>
              <ul className="space-y-1">
                {list.map((n) => {
                  const Icon = NODE_STYLE[n.type].icon
                  const active = selected === n.id
                  return (
                    <li key={n.id}>
                      <button
                        onClick={() => setSelected(n.id)}
                        className={`flex w-full items-center gap-2 rounded-md border px-2.5 py-1.5 text-left transition-colors ${
                          active ? 'theme-accent-border theme-surface-strong' : 'theme-border hover:theme-surface'
                        }`}
                      >
                        <Icon size={12} className={`shrink-0 ${NODE_STYLE[n.type].tint}`} />
                        <span className="min-w-0 flex-1 truncate text-xs theme-text">{n.label}</span>
                        {/* Degree makes an orphan visible while browsing, not
                            only in the Coverage tab. */}
                        <span
                          title={`${n.degree} edge${n.degree === 1 ? '' : 's'}`}
                          className={`shrink-0 text-[10px] ${n.degree === 0 ? 'text-amber-400' : 'theme-text-muted'}`}
                        >
                          {n.degree}
                        </span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>

        {(view === 'table' || selected) && (
          <div className="rounded-lg border theme-border theme-card p-4">
            {detail ? (
              <Detail detail={detail} onNavigate={setSelected} />
            ) : (
              <p className="py-8 text-center text-xs theme-text-muted">
                {selected ? `Loading ${shortId(selected)}…` : 'Select a node to see its neighbours.'}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
