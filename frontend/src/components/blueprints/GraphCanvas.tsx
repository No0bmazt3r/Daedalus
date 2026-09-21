import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useElementHeight } from '../../hooks/useElementHeight'
import {
  forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide,
  forceX, forceY,
  type Simulation, type SimulationNodeDatum,
} from 'd3-force'
import { Maximize2, Plus, Minus } from 'lucide-react'
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
 * ## The viewport is fitted to the graph, not fixed to the box
 *
 * A force layout spreads to whatever size the forces imply — it has no idea a
 * 720x460 frame exists. The first version hard-coded that frame as the viewBox,
 * so any node the simulation pushed outside it was simply clipped, with nothing
 * on screen to say part of the graph was missing.
 *
 * So the viewBox is computed from the nodes' own bounding box after layout,
 * padded for labels, and corrected to the drawing area's aspect ratio so the
 * diagram is never stretched. Everything is on screen by construction.
 *
 * Fitting happens once, after the initial layout, and again only when asked.
 * Refitting on every tick would make the whole diagram breathe in and out while
 * a node is dragged, which is far worse than a node briefly leaving the frame.
 *
 * ## Zoom and pan
 *
 * Fitting alone is not enough once a graph is dense: everything is visible but
 * the labels are too small to read. Wheel zooms about the cursor, dragging the
 * background pans, and Fit returns to the whole graph. All three work on the
 * viewBox rather than a CSS transform, so stroke widths and text stay crisp at
 * any zoom and hit-testing needs no correction.
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
/** Padding around the fitted bounding box, in graph units. */
const FIT_PADDING = 28

/**
 * How far the viewport may zoom, as a multiple of the fitted width.
 *
 * Bounded in both directions for the same reason: an unbounded viewBox is how a
 * scroll gesture ends on an empty screen with no way back except Fit. 0.2 is
 * close enough to read one node's label; 3 still shows the whole graph with room
 * around it.
 */
const ZOOM_MIN = 0.2
const ZOOM_MAX = 3

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
  height,
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
  /**
   * Drawing height in pixels. Omitted means **fill the parent**, measured — the
   * canvas then grows when the window is maximized instead of leaving a screen
   * of empty space under a fixed box.
   *
   * A number rather than a CSS class because the value is not only a style: the
   * fit maths matches the viewBox's aspect ratio to the drawing area's, and
   * getting that from CSS alone is not possible. `vh` would be wrong for the
   * same reason it is wrong anywhere in this app — the window is resizable, so
   * the viewport's height says nothing about this element's.
   */
  height?: number
}) {
  const svgRef = useRef<SVGSVGElement>(null)
  const simRef = useRef<Simulation<SimNode, undefined> | null>(null)
  const homesRef = useRef<Map<string, { x: number; y: number }>>(new Map())
  const rafRef = useRef<number | null>(null)
  // The viewport, in graph coordinates. A ref rather than state because the
  // wheel and pan handlers are non-React listeners that must read the current
  // value, not the one captured when they were attached; `setFrame` is what
  // turns a mutation into a repaint.
  // Measured when `height` is not given. `HEIGHT` covers the frame before the
  // first observation, so the fit maths never divides by zero and the canvas
  // never renders at no height for a frame.
  const frameRef = useRef<HTMLDivElement>(null)
  const measured = useElementHeight(frameRef)
  const drawHeight = height ?? (measured > 0 ? measured : HEIGHT)

  const viewRef = useRef({ x: 0, y: 0, w: WIDTH, h: drawHeight })
  const fittedRef = useRef({ w: WIDTH, h: drawHeight })
  const panRef = useRef<{ x: number; y: number; view: { x: number; y: number } } | null>(null)
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
   * Size the viewport to the graph's own bounding box.
   *
   * Labels are the reason this is not just the node extents: text is centred
   * under each node and extends past it on both sides, so a node at the right
   * edge would have its caption clipped even though the circle fits. The
   * half-width estimate below is deliberately rough — it only has to be an
   * over-estimate, and `FIT_PADDING` absorbs the error.
   */
  const fit = useCallback(() => {
    const sim = simRef.current
    const laid = sim?.nodes() ?? []
    if (!laid.length) return

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const n of laid) {
      const r = radius(n.degree)
      // ~2.6px per character at font-size 9, halved because the text is centred.
      const halfLabel = Math.min(n.label.length, 22) * 2.6
      const reach = Math.max(r, halfLabel)
      minX = Math.min(minX, (n.x ?? 0) - reach)
      maxX = Math.max(maxX, (n.x ?? 0) + reach)
      minY = Math.min(minY, (n.y ?? 0) - r)
      maxY = Math.max(maxY, (n.y ?? 0) + r + 14) // the caption line below
    }

    const boxW = Math.max(maxX - minX + FIT_PADDING * 2, 100)
    const boxH = Math.max(maxY - minY + FIT_PADDING * 2, 100)

    // Match the drawing area's aspect ratio, or the browser letterboxes the
    // viewBox for us and the padding stops being symmetric.
    const aspect = WIDTH / drawHeight
    let w = boxW
    let h = boxH
    if (boxW / boxH > aspect) h = boxW / aspect
    else w = boxH * aspect

    viewRef.current = {
      x: minX - FIT_PADDING - (w - boxW) / 2,
      y: minY - FIT_PADDING - (h - boxH) / 2,
      w,
      h,
    }
    fittedRef.current = { w, h }
    setFrame((f) => f + 1)
  }, [drawHeight])

  /**
   * Keep the viewBox's aspect matched to the frame when the frame changes.
   *
   * A resize — maximizing the window, opening the detail panel — changes the
   * drawing area's shape. Left alone the viewBox keeps its old aspect and the
   * browser letterboxes it, so a taller window adds empty bands rather than
   * showing more graph.
   *
   * Deliberately **not** a re-`fit()`. Refitting would discard whatever the
   * reader had zoomed and panned to, and a resize is not a request to go back
   * to the whole graph — it is a request for more room. So the horizontal
   * extent and the centre are held and only the vertical extent is adjusted,
   * which spends the new pixels on more graph and keeps the view they chose.
   */
  const lastHeight = useRef(drawHeight)
  useEffect(() => {
    if (lastHeight.current === drawHeight) return
    lastHeight.current = drawHeight

    const view = viewRef.current
    const aspect = WIDTH / drawHeight
    const nextH = view.w / aspect
    viewRef.current = { ...view, y: view.y + view.h / 2 - nextH / 2, h: nextH }
    fittedRef.current = { ...fittedRef.current, h: fittedRef.current.w / aspect }
    setFrame((f) => f + 1)
  }, [drawHeight])

  /** Zoom about a point given in 0..1 of the drawing area. */
  const zoomBy = useCallback((factor: number, px = 0.5, py = 0.5) => {
    const view = viewRef.current
    const fitted = fittedRef.current
    const next = Math.min(
      Math.max(view.w * factor, fitted.w * ZOOM_MIN),
      fitted.w * ZOOM_MAX,
    )
    const scale = next / view.w
    const nh = view.h * scale
    // Keep whatever is under the cursor under the cursor.
    viewRef.current = {
      x: view.x + (view.w - next) * px,
      y: view.y + (view.h - nh) * py,
      w: next,
      h: nh,
    }
    setFrame((f) => f + 1)
  }, [])

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
    fit()
    setFrame((f) => f + 1)

    return () => {
      sim.stop()
      simRef.current = null
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
    }
  }, [simNodes, simLinks, fit])

  // Drag: the held node follows the cursor, neighbours yield, and on release
  // everything eases home.
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return

    // Through the live viewBox, not the fixed box: once the viewport can zoom
    // and pan, screen position and graph position are no longer the same thing,
    // and a dragged node would otherwise jump away from the cursor.
    const toLocal = (e: PointerEvent) => {
      const rect = svg.getBoundingClientRect()
      const view = viewRef.current
      return {
        x: view.x + ((e.clientX - rect.left) / rect.width) * view.w,
        y: view.y + ((e.clientY - rect.top) / rect.height) * view.h,
      }
    }

    const move = (e: PointerEvent) => {
      const pan = panRef.current
      if (pan) {
        const rect = svg.getBoundingClientRect()
        const view = viewRef.current
        // Screen pixels to graph units, so the background tracks the cursor at
        // one-to-one however far it is zoomed in.
        viewRef.current = {
          ...view,
          x: pan.view.x - ((e.clientX - pan.x) / rect.width) * view.w,
          y: pan.view.y - ((e.clientY - pan.y) / rect.height) * view.h,
        }
        setFrame((f) => f + 1)
        return
      }

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
      panRef.current = null
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

    // Non-passive, because a passive listener may not preventDefault and the
    // page would scroll behind the diagram on every zoom.
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      const rect = svg.getBoundingClientRect()
      zoomBy(
        e.deltaY > 0 ? 1.12 : 1 / 1.12,
        (e.clientX - rect.left) / rect.width,
        (e.clientY - rect.top) / rect.height,
      )
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
  }, [run, zoomBy])

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
    <div className="flex h-full min-h-0 flex-col rounded-lg border theme-border theme-card">
      <div ref={frameRef} className="min-h-0 flex-1">
      <svg
        ref={svgRef}
        viewBox={`${viewRef.current.x} ${viewRef.current.y} ${viewRef.current.w} ${viewRef.current.h}`}
        className="w-full cursor-grab touch-none select-none active:cursor-grabbing"
        style={{ height: drawHeight }}
        onPointerDown={(e) => {
          // Only the background pans. A node's own handler stops propagation,
          // so reaching here means the press was not on a node.
          const rect = svgRef.current?.getBoundingClientRect()
          if (!rect) return
          panRef.current = {
            x: e.clientX,
            y: e.clientY,
            view: { x: viewRef.current.x, y: viewRef.current.y },
          }
        }}
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
                  // Or the background's pan handler fires too and the node drags
                  // while the whole view slides under it.
                  e.stopPropagation()
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
      </div>

      <div className="flex shrink-0 items-center gap-1 border-t theme-border px-2 py-1.5">
        <button
          onClick={() => zoomBy(1 / 1.25)}
          title="Zoom in"
          className="rounded border theme-border p-1 theme-text-muted transition-colors hover:theme-text"
        >
          <Plus size={11} />
        </button>
        <button
          onClick={() => zoomBy(1.25)}
          title="Zoom out"
          className="rounded border theme-border p-1 theme-text-muted transition-colors hover:theme-text"
        >
          <Minus size={11} />
        </button>
        <button
          onClick={fit}
          title="Fit the whole graph"
          className="inline-flex items-center gap-1 rounded border theme-border px-2 py-1 text-[10px] theme-text-muted transition-colors hover:theme-text"
        >
          <Maximize2 size={10} /> Fit
        </button>
      </div>
      <p className="shrink-0 border-t theme-border px-3 py-1.5 text-[10px] theme-text-muted">
        {caption ??
          'Scroll to zoom · drag the background to pan · drag a node to pull it out, it eases ' +
            'back when you let go · click a node to read it beside the diagram. Position carries ' +
            'no meaning: the layout shows connectedness, not measurement.'}
      </p>
    </div>
  )
}
