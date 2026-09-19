import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide,
  forceX, forceY,
  type Simulation, type SimulationNodeDatum,
} from 'd3-force'
import type { GraphNode, NodeType } from '../../lib/blueprintsClient'
import { NODE_STYLE, shortId } from './nodeStyles'

/**
 * The node-link diagram — MODULES.md §3.6.
 *
 * Layout is `d3-force` from npm, **bundled by Vite, never loaded from a CDN**.
 * Rule 1: this system runs air-gapped, and the same reasoning that put Monocraft
 * in `src/assets/fonts/` rather than on fonts.googleapis.com applies to a layout
 * library. A graph that renders only when the lab has internet is not a local
 * system.
 *
 * ## Drawn as SVG rather than canvas
 *
 * At tens of nodes the render cost is irrelevant, and SVG gives hover, focus and
 * text selection for free. Canvas would be the right call at thousands of nodes;
 * this graph is bounded by what a person can hand-author.
 *
 * ## The simulation is stopped, not left running
 *
 * A force layout that never settles is a screensaver. The initial layout runs a
 * fixed number of ticks synchronously, paints once, and stops — so the diagram
 * holds still while you read it, and an open window costs no CPU.
 *
 * Interaction reheats it, and a `requestAnimationFrame` loop drives the ticks
 * until alpha decays, then stops again. d3's own timer is never used: it would
 * advance the simulation without telling React, so the neighbours would move in
 * the data and not on screen.
 *
 * ## Nodes return home when released
 *
 * Each node's settled position is captured after the initial layout, and weak
 * `forceX`/`forceY` pull it back there. Drag a node and its neighbours yield;
 * let go and everything eases back to the arrangement you were reading.
 *
 * The first version pinned a released node where it was dropped, which is the
 * common d3 idiom and wrong here. This diagram is a reference figure, not a
 * workspace — there is nothing to arrange *for*, so a dropped node was just
 * permanent damage to the layout, with the edges left stretched behind it.
 *
 * Homing also buys stability that plain re-equilibrium does not: a force layout
 * has many local minima, so releasing without a home target settles somewhere
 * valid but different, and the figure reshuffles every time it is touched.
 *
 * ## What the layout does and does not mean
 *
 * Position carries no meaning. Force layout encodes *connectedness*, so
 * clusters are real but distance is not a measurement, and the same graph lands
 * differently on each run. Anything a reader should be able to measure belongs
 * in the table view next door, which is exactly the division §3.6 draws.
 */

interface SimNode extends SimulationNodeDatum {
  id: string
  type: NodeType
  label: string
  degree: number
}

interface SimLink {
  source: string | SimNode
  target: string | SimNode
  type: string
}

const WIDTH = 720
const HEIGHT = 460

/** Node radius grows with degree so hubs read as hubs, clamped so none dominates. */
const radius = (degree: number) => Math.min(9 + degree * 0.9, 16)

/**
 * How hard a node is drawn back to where it settled.
 *
 * Measured against a 20-node hub-and-spoke graph, displacing one node by 316px
 * and releasing. The trade is return accuracy against how alive the drag feels,
 * and it is monotonic in both directions:
 *
 * | pull | returns within | layout settles within | neighbours yield by |
 * |------|----------------|-----------------------|---------------------|
 * | 0.30 | 1.4px          | 19.8px                | 47px                |
 * | 0.60 | 0.7px          | 10.0px                | 31px                |
 * | 1.00 | 0.4px          |  6.0px                | 19px                |
 *
 * 0.6 keeps the yield clearly visible — neighbours should look like they are
 * making room, or the diagram feels like a picture rather than a mechanism —
 * while settling inside 10px, which on a 720px canvas is not a reshuffle.
 *
 * The residual is equilibrium, not an unfinished animation: adding the homing
 * forces changes the force balance slightly, so the new rest state sits just off
 * the captured positions. Lowering the alpha floor does not shrink it — that was
 * measured too, across a 7.5x range, and moved the result by 0.1px.
 *
 * It also does not accumulate, which is the property that actually matters here.
 * Twelve successive 360px drags on a 37-node graph left the maximum drift at
 * 12.4px after every single one — the same number each time, not a creeping one
 * — with each dragged node landing 0.7-11.1px from where it started.
 */
const HOME_PULL = 0.6

/**
 * Energy held while dragging, given on release, and the floor to stop at.
 *
 * The floor decides when the loop gives up, not where the nodes land: settling
 * takes ~150 ticks (about 2.5s) and the positions stop changing well before the
 * alpha does. So this is set to stop the animation frames promptly rather than
 * to buy accuracy it cannot buy.
 */
const ALPHA_DRAG = 0.25
const ALPHA_RELEASE = 0.5
const ALPHA_REST = 0.015

export function GraphCanvas({
  nodes,
  edges,
  selected,
  onSelect,
  highlight,
  caption,
  height = HEIGHT,
}: {
  nodes: GraphNode[]
  edges: { from: string; type: string; to: string }[]
  selected: string | null
  onSelect: (id: string) => void
  /**
   * Node ids to bring forward, everything else dimmed. Traversal replay drives
   * this from the hop being stepped through — which is MODULES.md §3.2's
   * "highlighting each node and edge in sequence, hop by hop".
   */
  highlight?: Set<string> | null
  caption?: string
  height?: number
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const simRef = useRef<Simulation<SimNode, undefined> | null>(null)
  const homesRef = useRef<Map<string, { x: number; y: number }>>(new Map())
  const rafRef = useRef<number | null>(null)
  const [, setFrame] = useState(0)
  const [hovered, setHovered] = useState<string | null>(null)
  const dragRef = useRef<{ id: string } | null>(null)

  // Rebuilt only when the graph's shape changes, not on selection or hover —
  // otherwise every click would re-run the layout and the diagram would jump
  // out from under the cursor.
  const { simNodes, simLinks } = useMemo(() => {
    const present = new Set(nodes.map((n) => n.id))
    return {
      simNodes: nodes.map<SimNode>((n) => ({
        id: n.id,
        type: n.type,
        label: n.label || shortId(n.id),
        degree: n.degree ?? 0,
      })),
      // An edge whose endpoint was filtered out would make d3 throw, so links
      // are kept only when both ends are on screen.
      simLinks: edges
        .filter((e) => present.has(e.from) && present.has(e.to))
        .map<SimLink>((e) => ({ source: e.from, target: e.to, type: e.type })),
    }
  }, [nodes, edges])

  /**
   * Tick the simulation on animation frames until it settles, then stop.
   *
   * Idempotent — a second call while already running is a no-op, so every
   * interaction can just ask for the loop without tracking whether one exists.
   */
  const run = useCallback(() => {
    if (rafRef.current !== null) return
    const step = () => {
      const sim = simRef.current
      if (!sim) {
        rafRef.current = null
        return
      }
      sim.tick()
      setFrame((f) => f + 1)
      // Keep going while the drag is live, however long that is; otherwise run
      // until the energy is gone. Stopping is what keeps an idle window free.
      if (!dragRef.current && sim.alpha() < ALPHA_REST) {
        sim.stop()
        rafRef.current = null
        return
      }
      rafRef.current = requestAnimationFrame(step)
    }
    rafRef.current = requestAnimationFrame(step)
  }, [])

  useEffect(() => {
    const sim = forceSimulation<SimNode>(simNodes)
      .force('link', forceLink<SimNode, SimLink>(simLinks).id((d) => d.id).distance(70).strength(0.35))
      .force('charge', forceManyBody().strength(-260))
      .force('center', forceCenter(WIDTH / 2, HEIGHT / 2))
      // Keeps labels from overlapping, which matters more than exact spacing
      // when every node is captioned.
      .force('collide', forceCollide<SimNode>((d) => radius(d.degree) + 14))
      .stop()

    // Run to a settled layout synchronously, then paint once. 300 ticks on tens
    // of nodes is a few milliseconds and avoids animating a layout nobody
    // asked to watch.
    sim.tick(300)

    // Where each node came to rest. This is "home" — what a released node eases
    // back to, and what keeps the figure stable across interactions.
    const homes = new Map(sim.nodes().map((n) => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }]))
    homesRef.current = homes

    // Added after the initial layout, not before: the target does not exist
    // until the layout has produced it. Weak enough that a drag still pushes
    // neighbours out of the way, strong enough to win once the drag ends.
    sim
      .force('homeX', forceX<SimNode>((d) => homes.get(d.id)?.x ?? d.x ?? 0).strength(HOME_PULL))
      .force('homeY', forceY<SimNode>((d) => homes.get(d.id)?.y ?? d.y ?? 0).strength(HOME_PULL))

    simRef.current = sim
    setFrame((f) => f + 1)

    return () => {
      sim.stop()
      simRef.current = null
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [simNodes, simLinks])

  // Drag: the held node follows the cursor, neighbours yield, and on release
  // everything eases home.
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return

    const toLocal = (e: PointerEvent) => {
      const rect = svg.getBoundingClientRect()
      return {
        x: ((e.clientX - rect.left) / rect.width) * WIDTH,
        y: ((e.clientY - rect.top) / rect.height) * HEIGHT,
      }
    }

    const move = (e: PointerEvent) => {
      const drag = dragRef.current
      const sim = simRef.current
      if (!drag || !sim) return
      const node = sim.nodes().find((n) => n.id === drag.id)
      if (!node) return
      const { x, y } = toLocal(e)
      node.fx = x
      node.fy = y
      // alphaTarget, not alpha: it holds the energy up for as long as the drag
      // lasts instead of decaying mid-gesture and going sluggish.
      sim.alphaTarget(ALPHA_DRAG)
      run()
    }

    const up = () => {
      const sim = simRef.current
      const drag = dragRef.current
      dragRef.current = null
      if (!drag || !sim) return
      const node = sim.nodes().find((n) => n.id === drag.id)
      if (!node) return
      // A press with no movement is a click, not a drag: `fx` was never set, so
      // there is nothing to release and nothing to settle. Reheating anyway
      // would make the whole diagram twitch every time a node is opened.
      if (node.fx === null || node.fx === undefined) return
      // Release the pin. Held at fx/fy the node could never move again, which
      // is what made a dropped node look stuck.
      node.fx = null
      node.fy = null
      // Let the energy decay from here, with enough left to carry it home.
      sim.alphaTarget(0).alpha(ALPHA_RELEASE)
      run()
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
    }
  }, [run])

  const sim = simRef.current
  const laidOut = sim?.nodes() ?? []
  const byId = new Map(laidOut.map((n) => [n.id, n]))

  // What to emphasise: the selected node and everything one hop from it.
  // An explicit `highlight` set outranks both — when a replay is stepping
  // through hop 2, hovering elsewhere should not redraw the emphasis.
  const focus = hovered ?? (highlight ? null : selected)
  const adjacent = useMemo(() => {
    if (!focus) return null
    const set = new Set<string>([focus])
    for (const l of simLinks) {
      const s = typeof l.source === 'string' ? l.source : l.source.id
      const t = typeof l.target === 'string' ? l.target : l.target.id
      if (s === focus) set.add(t)
      if (t === focus) set.add(s)
    }
    return set
  }, [focus, simLinks])

  const dim = (id: string) => {
    if (highlight && !hovered) return highlight.has(id) ? 1 : 0.12
    return adjacent && !adjacent.has(id) ? 0.15 : 1
  }

  return (
    <div className="rounded-lg border theme-border theme-card">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full touch-none select-none"
        style={{ height }}
      >
        <defs>
          <marker
            id="bp-arrow" viewBox="0 0 10 10" refX="9" refY="5"
            markerWidth="5" markerHeight="5" orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
          </marker>
        </defs>

        <g>
          {simLinks.map((l, i) => {
            const s = byId.get(typeof l.source === 'string' ? l.source : l.source.id)
            const t = byId.get(typeof l.target === 'string' ? l.target : l.target.id)
            if (!s?.x || !t?.x) return null
            // Stop the line short of the target so the arrowhead sits outside
            // the circle instead of under it.
            const dx = (t.x ?? 0) - (s.x ?? 0)
            const dy = (t.y ?? 0) - (s.y ?? 0)
            const len = Math.hypot(dx, dy) || 1
            const pad = radius(t.degree) + 6
            const opacity = Math.min(dim(s.id), dim(t.id))
            return (
              <line
                key={`${l.type}-${s.id}-${t.id}-${i}`}
                x1={s.x} y1={s.y}
                x2={(t.x ?? 0) - (dx / len) * pad}
                y2={(t.y ?? 0) - (dy / len) * pad}
                stroke="currentColor"
                className="theme-text-muted"
                strokeWidth={1}
                opacity={opacity * 0.45}
                markerEnd="url(#bp-arrow)"
              >
                <title>{`${shortId(s.id)} --${l.type}--> ${shortId(t.id)}`}</title>
              </line>
            )
          })}
        </g>

        <g>
          {laidOut.map((n) => {
            const style = NODE_STYLE[n.type]
            const r = radius(n.degree)
            const isSelected = n.id === selected
            return (
              <g
                key={n.id}
                transform={`translate(${n.x ?? 0}, ${n.y ?? 0})`}
                opacity={dim(n.id)}
                className="cursor-pointer"
                onPointerDown={(e) => {
                  e.preventDefault()
                  dragRef.current = { id: n.id }
                }}
                onClick={() => onSelect(n.id)}
                onPointerEnter={() => setHovered(n.id)}
                onPointerLeave={() => setHovered(null)}
              >
                <circle
                  r={r}
                  className={style.tint}
                  fill="currentColor"
                  fillOpacity={isSelected ? 0.95 : 0.55}
                  stroke="currentColor"
                  strokeWidth={isSelected ? 2.5 : 1}
                />
                {/* Degree 0 is an orphan — ringed here so it is visible in the
                    diagram and not only in the Coverage tab. */}
                {n.degree === 0 && (
                  <circle r={r + 4} fill="none" stroke="currentColor" className="text-amber-400"
                          strokeWidth={1} strokeDasharray="2 2" />
                )}
                <text
                  y={r + 10}
                  textAnchor="middle"
                  className="theme-text pointer-events-none"
                  fill="currentColor"
                  fontSize={9}
                >
                  {n.label.length > 22 ? `${n.label.slice(0, 21)}…` : n.label}
                </text>
                <title>{`${n.type} · ${n.id} · ${n.degree} edge${n.degree === 1 ? '' : 's'}`}</title>
              </g>
            )
          })}
        </g>
      </svg>

      <p className="border-t theme-border px-3 py-1.5 text-[10px] theme-text-muted">
        {caption ??
          "Drag a node to pull it out — it eases back when you let go · hover to isolate a " +
            "node's neighbours · click to open it. Position carries no meaning: the layout " +
            'shows connectedness, not measurement.'}
      </p>
    </div>
  )
}
