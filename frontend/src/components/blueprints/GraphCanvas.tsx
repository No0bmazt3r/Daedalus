import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useElementSize } from '../../hooks/useElementSize'
import { Plus, Minus, RotateCcw } from 'lucide-react'
import type { GraphNode, NodeType } from '../../lib/blueprintsClient'
import {
  IDENTITY, apply, centroid, dragRotate, multiply, project, sphereLayout, towardsFront,
  type Mat3, type Vec3,
} from '../../lib/globe'
import { NODE_STYLE, shortId } from './nodeStyles'

/**
 * The node-link diagram as a globe — MODULES.md §3.6.
 *
 * Nodes sit on the surface of a sphere (`lib/globe.ts`): linked nodes pull
 * together, so a cluster is a region of the globe, and turning it brings any
 * region to the front. No sphere is drawn — just the dots and links, Obsidian
 * style; the back half is drawn faint so the round shape still reads.
 *
 * ## Interaction
 *
 * Drag anywhere to turn it, scroll or +/− to zoom, Reset to go back. Nodes are
 * fixed in the layout: dragging one turns the globe, it never moves the node.
 * Clicking a node selects it and the globe turns it to the front; Tab walks the
 * nodes and does the same, Enter selects. In replay, the globe turns to face the
 * hop being stepped through.
 *
 * Hover hints are `title` attributes, so `ui/title-tooltips.tsx` draws them as
 * the app's tooltip. An SVG `<title>` child would show the browser's grey box.
 *
 * ## Motion
 *
 * One animation loop (`tick`) does all of it, at most one render a frame:
 * pointer moves are batched into the next frame rather than rendered as they
 * arrive, a flick keeps the globe turning and slows under friction, zoom eases
 * to its target, turn-to-front eases in, and a new graph opens out from the
 * centre. `prefers-reduced-motion` gets none of the easing.
 *
 * ## Costs nothing while it is still
 *
 * The layout runs once, synchronously, when the graph changes (~40ms for 62
 * nodes). The loop stops as soon as nothing is moving, and there is
 * deliberately no idle spin: a screensaver on a laptop that overheats is a bug,
 * not a feature.
 *
 * Position carries no meaning beyond connectedness: the table view next door is
 * where anything measurable lives.
 */

/** Sphere radius in drawing units. */
const R = 200
/** Room around the globe for labels and the perspective bulge, in drawing units. */
const MARGIN = 28
const HEIGHT = 460
const CONTROL = 'p-1.5 theme-text-muted transition-colors hover:theme-text'
type View = { rot: Mat3; zoom: number; grow: number }
const HOME: View = { rot: IDENTITY, zoom: 1, grow: 1 }
/** Where a freshly mounted globe starts: folded to the centre, about to open. */
const FOLDED: View = { ...HOME, grow: 0 }

const ZOOM_MIN = 0.7
const ZOOM_MAX = 4
/** Share of the remaining angle turned per frame — about 0.4s to arrive. */
const TURN = 0.16
/** A press that moves less than this is a click, not a turn. */
const CLICK_SLOP = 4
/** Share of a flick's speed kept each frame after release; lower stops sooner. */
const FRICTION = 0.93
/** Below this many pixels a frame, a coasting globe is treated as stopped. */
const MIN_SPEED = 0.05
/** A release this long after the last move is a stop, not a flick. */
const FLICK_MS = 80
/** Share of the remaining zoom covered per frame. */
const ZOOM_EASE = 0.2
/** How long a new graph takes to open out from the centre. */
const GROW_MS = 700

const easeOut = (t: number) => 1 - (1 - t) ** 3

/** Node radius grows with degree so hubs read as hubs, clamped so none dominates. */
const radius = (degree: number) => Math.min(4 + degree * 0.6, 10)

const reducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** SVG elements' React types omit `title`; the global tooltip reads the attribute all the same. */
const hint = (text: string) => ({ title: text }) as object

export function GraphCanvas({
  nodes,
  edges,
  selected,
  onSelect,
  highlight,
  caption,
  height,
}: {
  nodes: GraphNode[]
  edges: { from: string; type: string; to: string }[]
  selected: string | null
  onSelect: (id: string) => void
  /**
   * Node ids to bring forward, everything else dimmed. Traversal replay drives
   * this from the hop being stepped through — MODULES.md §3.2's "highlighting
   * each node and edge in sequence, hop by hop". The globe turns to face them.
   */
  highlight?: Set<string> | null
  caption?: string
  /** Drawing height in pixels. Omitted means fill the parent, measured. */
  height?: number
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const measured = useElementSize(frameRef).height
  const drawHeight = height ?? (measured > 0 ? measured : HEIGHT)

  // The view lives in a ref for the animation loop and in state for render.
  const viewRef = useRef<View>(FOLDED)
  const [view, setView] = useState<View>(FOLDED)

  const [hovered, setHovered] = useState<string | null>(null)
  const dragRef = useRef<{ x: number; y: number; travelled: number; at: number } | null>(null)
  const movedRef = useRef(false)
  const rafRef = useRef<number | null>(null)
  // What the loop is working towards. `pending` is pointer travel not yet drawn.
  const motion = useRef({
    pending: [0, 0] as [number, number],
    velocity: [0, 0] as [number, number],
    zoom: 1,
    target: null as Vec3 | null,
    last: 0,
  })

  // Rebuilt only when the graph's shape changes, not on selection or hover.
  const { layout, links } = useMemo(() => {
    const index = new Map(nodes.map((n, i) => [n.id, i]))
    // An edge whose endpoint was filtered out is dropped, not drawn to nowhere.
    const kept = edges.filter((e) => index.has(e.from) && index.has(e.to))
    const points = sphereLayout(nodes.length, kept.map((e) => [index.get(e.from)!, index.get(e.to)!]))
    return {
      layout: new Map(nodes.map((n, i) => [n.id, points[i]])),
      links: kept,
    }
  }, [nodes, edges])

  // Named, so it can schedule itself.
  const tick = useCallback(function tick(now: number) {
    const m = motion.current
    const reduce = reducedMotion()
    const dt = m.last ? Math.min(now - m.last, 50) : 16
    m.last = now
    let { rot, zoom, grow } = viewRef.current
    let busy = !!dragRef.current

    // Slower when zoomed in, so a pixel of drag moves about a pixel of globe.
    const ppr = 180 * zoom
    if (dragRef.current) {
      const [dx, dy] = m.pending
      if (dx || dy) rot = dragRotate(rot, dx, dy, ppr)
      // Smoothed, so one jittery event does not decide the flick.
      m.velocity = [m.velocity[0] * 0.5 + dx * 0.5, m.velocity[1] * 0.5 + dy * 0.5]
      m.pending = [0, 0]
    } else if (Math.hypot(...m.velocity) > MIN_SPEED && !reduce) {
      rot = dragRotate(rot, m.velocity[0], m.velocity[1], ppr)
      const keep = FRICTION ** (dt / 16)
      m.velocity = [m.velocity[0] * keep, m.velocity[1] * keep]
      busy = true
    } else {
      m.velocity = [0, 0]
    }

    if (m.target) {
      const turn = towardsFront(apply(rot, m.target), reduce ? 1 : TURN)
      if (turn) {
        rot = multiply(turn, rot)
        busy = true
      } else m.target = null
    }

    if (Math.abs(zoom - m.zoom) > 0.001 && !reduce) {
      zoom += (m.zoom - zoom) * ZOOM_EASE
      busy = true
    } else zoom = m.zoom

    if (grow < 1) {
      grow = reduce ? 1 : Math.min(1, grow + dt / GROW_MS)
      busy = true
    }

    viewRef.current = { rot, zoom, grow }
    setView(viewRef.current)
    rafRef.current = busy ? requestAnimationFrame(tick) : null
    if (!busy) m.last = 0
  }, [])

  /** Make sure the loop is running; it stops itself once nothing moves. */
  const kick = useCallback(() => {
    if (rafRef.current === null) rafRef.current = requestAnimationFrame(tick)
  }, [tick])

  // Clears the handle too: StrictMode mounts twice, and a cancelled frame
  // left in the ref makes `kick` think the loop is still running, so it never
  // restarts and the globe stays folded (invisible) forever.
  useEffect(() => () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
  }, [])

  /** Halt coasting and any turn-to-front, e.g. when the user grabs the globe. */
  const stop = useCallback(() => {
    motion.current.velocity = [0, 0]
    motion.current.target = null
  }, [])

  /** Turn the globe until `target` (a point on the unrotated sphere) faces the viewer. */
  const turnTo = useCallback((target: Vec3 | null | undefined) => {
    motion.current.velocity = [0, 0]
    motion.current.target = target ?? null
    if (target) kick()
  }, [kick])

  // A new graph opens out from the centre.
  useEffect(() => {
    viewRef.current = { ...viewRef.current, grow: 0 }
    kick()
  }, [layout, kick])

  useEffect(() => {
    if (selected) turnTo(layout.get(selected))
  }, [selected, layout, turnTo])

  useEffect(() => {
    if (!highlight?.size) return
    turnTo(centroid([...highlight].map((id) => layout.get(id)).filter((p): p is Vec3 => !!p)))
  }, [highlight, layout, turnTo])

  const zoomBy = useCallback((factor: number) => {
    motion.current.zoom = Math.min(Math.max(motion.current.zoom * factor, ZOOM_MIN), ZOOM_MAX)
    kick()
  }, [kick])

  const reset = useCallback(() => {
    stop()
    motion.current.zoom = 1
    viewRef.current = { ...HOME, zoom: viewRef.current.zoom }
    kick()
  }, [stop, kick])

  /** Queue a turn of (dx, dy) pixels for the next frame. */
  const turnBy = useCallback((dx: number, dy: number) => {
    motion.current.pending[0] += dx
    motion.current.pending[1] += dy
    kick()
  }, [kick])

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const move = (e: PointerEvent) => {
      const drag = dragRef.current
      if (!drag) return
      const dx = e.clientX - drag.x
      const dy = e.clientY - drag.y
      drag.x = e.clientX
      drag.y = e.clientY
      drag.travelled += Math.hypot(dx, dy)
      drag.at = performance.now()
      if (drag.travelled > CLICK_SLOP) movedRef.current = true
      turnBy(dx, dy)
    }
    const up = () => {
      const drag = dragRef.current
      if (!drag) return
      dragRef.current = null
      // Held still before letting go: no flick.
      if (performance.now() - drag.at > FLICK_MS) motion.current.velocity = [0, 0]
      kick()
    }
    // Non-passive, or the page scrolls behind the globe on every zoom.
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      zoomBy(e.deltaY > 0 ? 1 / 1.12 : 1.12)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    svg.addEventListener('wheel', wheel, { passive: false })
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      svg.removeEventListener('wheel', wheel)
    }
  }, [turnBy, zoomBy, kick])

  // What to emphasise: the focused node and its neighbours. An explicit
  // `highlight` outranks selection, so hovering during a replay does not
  // redraw which hop is shown.
  const focus = hovered ?? (highlight ? null : selected)
  const adjacent = useMemo(() => {
    if (!focus) return null
    const set = new Set<string>([focus])
    for (const l of links) {
      if (l.from === focus) set.add(l.to)
      if (l.to === focus) set.add(l.from)
    }
    return set
  }, [focus, links])

  const dim = (id: string) => {
    if (highlight && !hovered) return highlight.has(id) ? 1 : 0.12
    return adjacent && !adjacent.has(id) ? 0.15 : 1
  }
  const emphasised = (id: string) =>
    id === selected || id === hovered || (adjacent?.has(id) ?? false) || (highlight?.has(id) ?? false)

  // Project once per render; nodes drawn back to front so the near side covers the far.
  const opened = easeOut(view.grow)
  const placed = new Map(
    nodes.map((n) => {
      const p = project(apply(view.rot, layout.get(n.id) ?? [0, 0, 1]), R * opened)
      return [n.id, p] as const
    }),
  )
  const degreeOf = new Map(nodes.map((n) => [n.id, n.degree ?? 0]))
  const order = [...nodes].sort((a, b) => placed.get(a.id)!.depth - placed.get(b.id)!.depth)

  const half = (R * 1.07 + MARGIN) / view.zoom
  const fade = (depth: number) => (0.25 + 0.75 * depth) * opened

  return (
    <div className="flex h-full min-h-0 flex-col rounded-lg border theme-border theme-card">
      <div ref={frameRef} className="relative min-h-0 flex-1">
        <svg
          ref={svgRef}
          viewBox={`${-half} ${-half} ${half * 2} ${half * 2}`}
          className="w-full cursor-grab touch-none select-none outline-none active:cursor-grabbing"
          style={{ height: drawHeight }}
          tabIndex={0}
          role="group"
          aria-label="Knowledge graph globe. Arrow keys turn it, plus and minus zoom, Tab moves between nodes."
          onPointerDown={(e) => {
            // preventDefault keeps a press on a node from focusing it, which
            // would start a turn-to-front fighting the drag.
            e.preventDefault()
            stop()
            movedRef.current = false
            dragRef.current = { x: e.clientX, y: e.clientY, travelled: 0, at: performance.now() }
            kick()
          }}
          onKeyDown={(e) => {
            const turns: Record<string, [number, number]> = {
              ArrowLeft: [-24, 0], ArrowRight: [24, 0], ArrowUp: [0, -24], ArrowDown: [0, 24],
            }
            if (turns[e.key]) {
              e.preventDefault()
              stop()
              // A small flick, so the arrow keys glide like a drag does.
              motion.current.velocity = [turns[e.key][0] / 6, turns[e.key][1] / 6]
              kick()
            } else if (e.key === '+' || e.key === '=') zoomBy(1.25)
            else if (e.key === '-') zoomBy(1 / 1.25)
            else if (e.key === '0') reset()
          }}
        >
          <defs>
            <marker
              id="bp-arrow" viewBox="0 0 10 10" refX="9" refY="5"
              markerWidth="4" markerHeight="4" orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
            </marker>
          </defs>

          <g className="theme-text-muted">
            {links.map((l, i) => {
              const s = placed.get(l.from)!
              const t = placed.get(l.to)!
              const on = !!focus && emphasised(l.from) && emphasised(l.to)
              // Direction only on lit links: arrows on every edge are what
              // turns a graph view into noise.
              const dx = t.x - s.x
              const dy = t.y - s.y
              const len = Math.hypot(dx, dy) || 1
              const pad = on ? Math.min((radius(degreeOf.get(l.to) ?? 0) + 3) * t.scale, len / 2) : 0
              return (
                <line
                  key={`${l.type}-${l.from}-${l.to}-${i}`}
                  x1={s.x} y1={s.y}
                  x2={t.x - (dx / len) * pad}
                  y2={t.y - (dy / len) * pad}
                  stroke="currentColor"
                  strokeWidth={on ? 1.2 : 0.7}
                  opacity={fade((s.depth + t.depth) / 2)}
                  strokeOpacity={Math.min(dim(l.from), dim(l.to)) * (on ? 0.9 : 0.45)}
                  style={{ transition: 'stroke-opacity 200ms, stroke-width 200ms' }}
                  markerEnd={on ? 'url(#bp-arrow)' : undefined}
                  {...hint(`${shortId(l.from)} → ${l.type} → ${shortId(l.to)}`)}
                />
              )
            })}
          </g>

          <g>
            {order.map((n) => {
              const p = placed.get(n.id)!
              const style = NODE_STYLE[n.type as NodeType]
              const r = radius(n.degree ?? 0) * p.scale
              const isSelected = n.id === selected
              const label = n.label || shortId(n.id)
              const degree = n.degree ?? 0
              // While something is in focus only it and its neighbours are named;
              // otherwise the near cap is, widening as you zoom in (Obsidian's rule).
              const showLabel = focus || highlight
                ? emphasised(n.id)
                : p.depth > Math.max(0.55, 0.88 - 0.12 * (view.zoom - 1))
              return (
                <g
                  key={n.id}
                  transform={`translate(${p.x.toFixed(1)}, ${p.y.toFixed(1)})`}
                  opacity={fade(p.depth)}
                  className="cursor-pointer outline-none [&:focus-visible>g>circle:first-child]:stroke-current [&:focus-visible>g>circle:first-child]:stroke-[3]"
                  role="button"
                  tabIndex={0}
                  aria-label={`${n.type} ${label}, ${degree} edges`}
                  aria-pressed={isSelected}
                  onFocus={() => turnTo(layout.get(n.id))}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onSelect(n.id)
                    }
                  }}
                  onClick={() => { if (!movedRef.current) onSelect(n.id) }}
                  onPointerEnter={() => { if (!dragRef.current) setHovered(n.id) }}
                  onPointerLeave={() => setHovered(null)}
                  {...hint(`${label}\n${n.type} · ${shortId(n.id)} · ${degree} edge${degree === 1 ? '' : 's'}`)}
                >
                  <g opacity={dim(n.id)} className="transition-opacity duration-200">
                  <circle
                    r={r}
                    className={style.tint}
                    fill="currentColor"
                    stroke={isSelected ? 'currentColor' : 'none'}
                    strokeOpacity={0.5}
                    strokeWidth={3}
                    style={isSelected ? { filter: 'drop-shadow(0 0 4px currentColor)' } : undefined}
                  />
                  {/* Degree 0 is an orphan — ringed so it shows here and not only in Coverage. */}
                  {degree === 0 && (
                    <circle r={r + 3} fill="none" stroke="currentColor" className="text-amber-400"
                            strokeWidth={1} strokeDasharray="2 2" />
                  )}
                  {showLabel && (
                    <text
                      y={r + 10 * p.scale}
                      textAnchor="middle"
                      className="theme-text pointer-events-none"
                      fill="currentColor"
                      fontSize={8 * p.scale}
                    >
                      {label.length > 22 ? `${label.slice(0, 21)}…` : label}
                    </text>
                  )}
                  </g>
                </g>
              )
            })}
          </g>
        </svg>

        {/* Over the canvas, where map controls usually are, rather than in a bar under it. */}
        <div className="absolute right-2 top-2 flex flex-col overflow-hidden rounded-md border theme-border theme-card">
          <button onClick={() => zoomBy(1.25)} title="Zoom in" aria-label="Zoom in" className={CONTROL}>
            <Plus size={12} />
          </button>
          <button onClick={() => zoomBy(1 / 1.25)} title="Zoom out" aria-label="Zoom out" className={CONTROL}>
            <Minus size={12} />
          </button>
          <button onClick={reset} title="Reset the view" aria-label="Reset the view" className={CONTROL}>
            <RotateCcw size={12} />
          </button>
        </div>
      </div>

      <p className="shrink-0 border-t theme-border px-3 py-1.5 text-[10px] theme-text-muted">
        {caption ??
          'Drag to turn the globe · scroll to zoom · hover for neighbours · click a node to open it. ' +
            'Linked nodes sit together; position shows connectedness, not measurement.'}
      </p>
    </div>
  )
}
