import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Drag a floating window by its header, and snap it to an edge like a desktop
 * window manager.
 *
 * ## Snapping
 *
 * While the pointer is dragging, its distance to the viewport edges decides a
 * target region — the halves, the four quadrants, or the whole screen from the
 * top edge. The region is drawn as a dashed outline (`.snap-preview` in
 * `index.css`) *before* the drop, because a window that resizes itself the
 * instant you brush an edge is a window fighting you; showing the intention and
 * committing on release is what makes it feel like a desktop.
 *
 * The **pointer** decides the zone, not the window's own rectangle. A window is
 * grabbed wherever you happened to click it, so its edges say more about where
 * the cursor started than about where you are aiming.
 *
 * Dragging a snapped window **restores its old size** and keeps the grab point
 * under the cursor, proportionally: grab a maximized window 80% of the way
 * across its title bar and the restored window appears with the cursor 80% of
 * the way across *its* title bar. Restoring to the old size but the old
 * position throws the window out from under the pointer, which reads as a jump.
 *
 * ## What is remembered, and what is not
 *
 * The pre-snap rectangle is measured from the DOM at the moment of snapping
 * rather than taken from props, so a window the person had already resized by
 * hand returns to *their* size and not to the component's default. It lives for
 * as long as the window is snapped; closing the window forgets it, which is
 * right — snap state is a gesture, not a preference.
 */

export type SnapZone =
  | 'left'
  | 'right'
  | 'maximize'
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'

export interface Rect {
  left: number
  top: number
  width: number
  height: number
}

/** How close to an edge the pointer has to be. About a finger's width of slop. */
const EDGE = 26
/**
 * How far along an edge still counts as its corner. Fixed pixels rather than a
 * fraction of the viewport: it is a target somebody is aiming at with a mouse,
 * and the size that is comfortable to hit does not change with the window.
 */
const CORNER = 140

export function zoneFor(x: number, y: number, vw: number, vh: number): SnapZone | null {
  const nearLeft = x <= EDGE
  const nearRight = x >= vw - EDGE
  const nearTop = y <= EDGE

  if (nearLeft && y <= CORNER) return 'top-left'
  if (nearLeft && y >= vh - CORNER) return 'bottom-left'
  if (nearRight && y <= CORNER) return 'top-right'
  if (nearRight && y >= vh - CORNER) return 'bottom-right'
  if (nearLeft) return 'left'
  if (nearRight) return 'right'
  // The top edge maximizes, as it does on every desktop. The bottom edge is
  // deliberately inert: it is where a window ends up while you are reaching for
  // something below it, and snapping there would be a surprise, not a command.
  if (nearTop) return 'maximize'
  return null
}

export function rectFor(zone: SnapZone, vw: number, vh: number): Rect {
  const halfW = Math.round(vw / 2)
  const halfH = Math.round(vh / 2)
  switch (zone) {
    case 'left':
      return { left: 0, top: 0, width: halfW, height: vh }
    case 'right':
      return { left: vw - halfW, top: 0, width: halfW, height: vh }
    case 'top-left':
      return { left: 0, top: 0, width: halfW, height: halfH }
    case 'top-right':
      return { left: vw - halfW, top: 0, width: halfW, height: halfH }
    case 'bottom-left':
      return { left: 0, top: vh - halfH, width: halfW, height: halfH }
    case 'bottom-right':
      return { left: vw - halfW, top: vh - halfH, width: halfW, height: halfH }
    case 'maximize':
      return { left: 0, top: 0, width: vw, height: vh }
  }
}

export function useDraggable() {
  const [position, setPosition] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 })
  /** The region the drop would land in. Drawn as an outline while dragging. */
  const [preview, setPreview] = useState<Rect | null>(null)
  /** Where the window is now, when it is snapped. Null means free-floating. */
  const [snapRect, setSnapRect] = useState<Rect | null>(null)
  /** True for the length of the move into or out of a snapped position. */
  const [settling, setSettling] = useState(false)

  const handleRef = useRef<HTMLDivElement>(null)
  const windowRef = useRef<HTMLDivElement>(null)
  /** The window's own rectangle before it was snapped, measured from the DOM. */
  const preSnap = useRef<Rect | null>(null)
  const settleTimer = useRef(0)

  const settle = useCallback(() => {
    setSettling(true)
    window.clearTimeout(settleTimer.current)
    // Matches `.snap-settling` in index.css. The class has to come off again,
    // or the next drag animates `left`/`top` and the window trails the cursor.
    settleTimer.current = window.setTimeout(() => setSettling(false), 220)
  }, [])

  useEffect(() => () => window.clearTimeout(settleTimer.current), [])

  useEffect(() => {
    if (!isDragging) return

    const onMove = (e: MouseEvent) => {
      setPosition({ x: e.clientX - dragOffset.x, y: e.clientY - dragOffset.y })
      const zone = zoneFor(e.clientX, e.clientY, window.innerWidth, window.innerHeight)
      setPreview(zone ? rectFor(zone, window.innerWidth, window.innerHeight) : null)
    }

    const onUp = (e: MouseEvent) => {
      setIsDragging(false)
      const zone = zoneFor(e.clientX, e.clientY, window.innerWidth, window.innerHeight)
      setPreview(null)
      if (!zone) return

      // Measured now rather than at drag start: the window may have been
      // resized by hand since it was last snapped, and *their* size is the one
      // to come back to.
      if (!preSnap.current && windowRef.current) {
        const r = windowRef.current.getBoundingClientRect()
        preSnap.current = { left: r.left, top: r.top, width: r.width, height: r.height }
      }
      const rect = rectFor(zone, window.innerWidth, window.innerHeight)
      setSnapRect(rect)
      setPosition({ x: rect.left, y: rect.top })
      settle()
    }

    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
    return () => {
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
  }, [isDragging, dragOffset, settle])

  // A snapped window that outlives the viewport it was snapped to — the browser
  // resized, a second monitor went away — would keep a rectangle describing a
  // screen that no longer exists. Re-derived from the zone it is in instead.
  useEffect(() => {
    if (!snapRect) return
    const onResize = () => {
      setSnapRect((current) => {
        if (!current) return current
        const vw = window.innerWidth
        const vh = window.innerHeight
        // Which zone this rectangle *was*, read back from its geometry.
        const left = current.left < vw / 4
        const full = current.width > vw * 0.75
        const half = current.height < vh * 0.75
        const zone: SnapZone = full
          ? 'maximize'
          : half
            ? current.top < vh / 4
              ? left
                ? 'top-left'
                : 'top-right'
              : left
                ? 'bottom-left'
                : 'bottom-right'
            : left
              ? 'left'
              : 'right'
        const next = rectFor(zone, vw, vh)
        setPosition({ x: next.left, y: next.top })
        return next
      })
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [snapRect])

  const onMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!windowRef.current) return
    const rect = windowRef.current.getBoundingClientRect()

    if (snapRect && preSnap.current) {
      // Un-snap under the cursor: keep the grab point at the same fraction of
      // the width it was grabbed at, so the window does not leap sideways.
      const fraction = rect.width ? (e.clientX - rect.left) / rect.width : 0.5
      const restored = preSnap.current
      const left = e.clientX - fraction * restored.width
      const top = e.clientY - Math.min(e.clientY - rect.top, 40)
      preSnap.current = null
      setSnapRect(null)
      setPosition({ x: left, y: top })
      setDragOffset({ x: e.clientX - left, y: e.clientY - top })
      setIsDragging(true)
      settle()
      return
    }

    // First grab: the window is still positioned by its anchor, so its current
    // rectangle is where dragging has to start from.
    if (position.x === 0 && position.y === 0) {
      setPosition({ x: rect.left, y: rect.top })
      setDragOffset({ x: e.clientX - rect.left, y: e.clientY - rect.top })
    } else {
      setDragOffset({ x: e.clientX - position.x, y: e.clientY - position.y })
    }
    setIsDragging(true)
  }

  /** Header double-click, and the keyboard path: fill the screen, or come back. */
  const toggleMaximize = useCallback(() => {
    if (snapRect) {
      const restored = preSnap.current
      preSnap.current = null
      setSnapRect(null)
      if (restored) setPosition({ x: restored.left, y: restored.top })
      settle()
      return
    }
    if (windowRef.current) {
      const r = windowRef.current.getBoundingClientRect()
      preSnap.current = { left: r.left, top: r.top, width: r.width, height: r.height }
    }
    const rect = rectFor('maximize', window.innerWidth, window.innerHeight)
    setSnapRect(rect)
    setPosition({ x: rect.left, y: rect.top })
    settle()
  }, [snapRect, settle])

  return {
    position,
    onMouseDown,
    handleRef,
    windowRef,
    /** The dashed target, while a drag is over an edge. */
    preview,
    /** Geometry to apply while snapped; null when the window floats freely. */
    snapRect,
    /** Add `.snap-settling` while true, so the move animates but the drag does not. */
    settling,
    toggleMaximize,
  }
}
