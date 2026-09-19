import {
  Gauge, SlidersHorizontal, Ruler, FileText, ListOrdered, History, TriangleAlert,
  type LucideIcon,
} from 'lucide-react'
import type { NodeType, GraphNode } from '../../lib/blueprintsClient'

/**
 * One icon and one accent per node type, defined once.
 *
 * Shared rather than per-view because the legend, the browser, the coverage
 * tables and the traversal replay all name the same seven types, and a Sensor
 * that is a gauge in one panel and a circle in another makes the reader check
 * whether they are the same thing.
 *
 * Colours are fixed hues rather than theme tokens on purpose. The theme engine
 * supplies one accent; these need seven that stay distinguishable from each
 * other under every theme, so they are chosen for mutual contrast and used only
 * as a small type marker — never as the only carrier of meaning, which is also
 * why every badge prints its type name next to the colour.
 */
export const NODE_STYLE: Record<NodeType, { icon: LucideIcon; tint: string; ring: string }> = {
  Sensor:        { icon: Gauge,             tint: 'text-sky-400',     ring: 'border-sky-400/40 bg-sky-400/10' },
  OperatingMode: { icon: SlidersHorizontal, tint: 'text-violet-400',  ring: 'border-violet-400/40 bg-violet-400/10' },
  Threshold:     { icon: Ruler,             tint: 'text-amber-400',   ring: 'border-amber-400/40 bg-amber-400/10' },
  AnomalyType:   { icon: TriangleAlert,     tint: 'text-rose-400',    ring: 'border-rose-400/40 bg-rose-400/10' },
  AnomalyRecord: { icon: History,           tint: 'text-orange-400',  ring: 'border-orange-400/40 bg-orange-400/10' },
  SOPDocument:   { icon: FileText,          tint: 'text-emerald-400', ring: 'border-emerald-400/40 bg-emerald-400/10' },
  SOPStep:       { icon: ListOrdered,       tint: 'text-teal-400',    ring: 'border-teal-400/40 bg-teal-400/10' },
}

/** The bare id without its type prefix — `Sensor:co2_ppm` reads as `co2_ppm`. */
export const shortId = (id: string) => id.split(':').slice(1).join(':') || id

export function NodeChip({
  node,
  onClick,
  className = '',
}: {
  node: GraphNode
  onClick?: () => void
  className?: string
}) {
  // A node recorded in a traversal that the graph no longer contains. Rendered
  // as struck-through rather than dropped: the walk crossed it, and omitting it
  // would misrepresent what actually happened.
  if (node.missing) {
    return (
      <span
        title="this node was crossed by the recorded walk but is not in the graph any more"
        className={`inline-flex items-center gap-1.5 rounded-md border border-dashed theme-border px-2 py-1 text-xs line-through theme-text-muted ${className}`}
      >
        {shortId(node.id)}
      </span>
    )
  }

  const style = NODE_STYLE[node.type]
  const Icon = style.icon
  const Tag = onClick ? 'button' : 'span'

  return (
    <Tag
      onClick={onClick}
      title={`${node.type} · ${node.id}`}
      className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs transition-colors ${style.ring} ${
        onClick ? 'hover:brightness-125 cursor-pointer' : ''
      } ${className}`}
    >
      <Icon size={12} className={style.tint} />
      <span className="theme-text">{node.label || shortId(node.id)}</span>
    </Tag>
  )
}

export function TypeBadge({ type }: { type: NodeType }) {
  const style = NODE_STYLE[type]
  const Icon = style.icon
  return (
    <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] ${style.ring}`}>
      <Icon size={10} className={style.tint} />
      <span className="theme-text-muted">{type}</span>
    </span>
  )
}

/**
 * The relationship label. A trailing ↩ means the walk followed the edge
 * backwards — half this schema reads that way (an AnomalyType's history is the
 * AnomalyRecords pointing *in* via INSTANCE_OF), and hiding the direction would
 * make a replay look like it traversed an edge that does not exist.
 */
export function EdgeLabel({ edge }: { edge: string }) {
  const reversed = edge.endsWith('↩')
  const name = reversed ? edge.slice(0, -1) : edge
  return (
    <span
      title={reversed ? `${name}, followed backwards` : name}
      className="inline-flex items-center gap-1 font-mono text-[10px] tracking-wide theme-text-muted"
    >
      {reversed && <span className="theme-accent">↩</span>}
      {name}
    </span>
  )
}
