import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X, CircleDashed, Minus } from 'lucide-react'
import { useDraggable } from '../../hooks/useDraggable'

/**
 * Where minimized windows collapse to.
 *
 * Chips are portalled into one shared node so several of them line up rather
 * than stacking. `createPortal` plus a plain node, not a context provider:
 * the whole feature stays inside this file, so a window gains minimize without
 * anything being wired into the app tree.
 *
 * The preferred home is the control cluster beside the incognito toggle, which
 * `ChatInterface` renders as `#${MINIMIZED_DOCK_SLOT}`. That is an existing,
 * always-visible strip and it is out of the composer's way — a floating bar at
 * bottom-centre sat directly under the thing you type into.
 *
 * The free-floating fallback exists for anywhere that slot is not mounted (a
 * route without the chat interface), so a minimized window can never become
 * unreachable.
 */
export const MINIMIZED_DOCK_SLOT = 'minimized-dock-slot'

/**
 * Things that are outside a window in the DOM but belong to it.
 *
 * Menus, selects and tooltips are portalled to the end of <body>, so a naive
 * "is the click inside the window element?" test calls them outside and
 * minimizes the window the moment you open a dropdown in it. The dock is here
 * too: clicking a chip is how you restore a *different* window, and it should
 * not also set this one aside on the way past.
 */
const FLOATING_LAYER = [
  '[data-slot="dropdown-menu-content"]',
  '[data-slot="dropdown-menu-sub-content"]',
  '[data-slot="dropdown-menu-portal"]',
  '[data-slot="tooltip-content"]',
  '[role="menu"]',
  '[role="listbox"]',
  '[role="dialog"]',
  `#${MINIMIZED_DOCK_SLOT}`,
  '#minimized-dock-fallback',
].join(',')

/**
 * Minimize when a click lands anywhere that is not this window.
 *
 * `FloatingWindow` gets this for free from its backdrop, which covers the page
 * and catches the click. `ThemeModal` has no backdrop by design — it is
 * non-modal so you can watch the app change while dragging a slider — so it
 * needs the document-level version instead.
 *
 * `pointerdown` in the capture phase rather than `click`: a menu that closes on
 * mousedown can remove the clicked node before `click` fires, at which point
 * `contains` is asking about an element that is no longer in the tree.
 */
export function useMinimizeOnOutsideClick(
  ref: { current: HTMLElement | null },
  enabled: boolean,
  onOutside: () => void,
) {
  useEffect(() => {
    if (!enabled) return
    const onPointerDown = (event: PointerEvent) => {
      const el = ref.current
      const target = event.target
      if (!el || !(target instanceof Node)) return
      if (el.contains(target)) return
      if (target instanceof Element && target.closest(FLOATING_LAYER)) return
      onOutside()
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    return () => document.removeEventListener('pointerdown', onPointerDown, true)
  }, [enabled, onOutside, ref])
}

/**
 * How a minimized window is reached from outside.
 *
 * Minimize is internal state, so the parent that owns `open` cannot see it. The
 * triggers all call `setOpen(true)` — which is a no-op when `open` is already
 * true — so after minimizing, clicking Theme or Settings again did nothing at
 * all and the button looked dead.
 *
 * A window registers how to restore itself here while it is minimized, and
 * anything that means to open it calls `restoreWindow` first. Keyed by a
 * caller-supplied id rather than by title, because a title is display text and
 * may be translated or truncated.
 */
const restorers = new Map<string, () => void>()

/**
 * Restore a minimized window. Returns whether there was one.
 *
 * Safe to call unconditionally: on a window that is closed, or open and not
 * minimized, it does nothing and reports false.
 */
export function restoreWindow(id: string): boolean {
  const restore = restorers.get(id)
  if (!restore) return false
  restore()
  return true
}

/** Registers `restore` for as long as the window is minimized. */
function useRestoreRegistration(id: string | undefined, minimized: boolean, restore: () => void) {
  useEffect(() => {
    if (!id || !minimized) return
    restorers.set(id, restore)
    return () => {
      // Only clear our own entry: a remount could otherwise delete the
      // registration a newer instance has just written.
      if (restorers.get(id) === restore) restorers.delete(id)
    }
  }, [id, minimized, restore])
}

let fallbackDock: HTMLDivElement | null = null

function getDock(): HTMLElement | null {
  if (typeof document === 'undefined') return null

  const slot = document.getElementById(MINIMIZED_DOCK_SLOT)
  if (slot) {
    // Drop any fallback that is on screen, so chips do not end up split
    // between two docks when the slot mounts after the first minimize.
    fallbackDock?.remove()
    fallbackDock = null
    return slot
  }

  if (fallbackDock?.isConnected) return fallbackDock
  fallbackDock = document.createElement('div')
  fallbackDock.id = 'minimized-dock-fallback'
  // Above the window layer (z-100): a chip has to stay clickable while another
  // window is still open in front of it.
  fallbackDock.className =
    'fixed top-4 right-6 z-[110] flex items-center gap-2 pointer-events-none'
  document.body.appendChild(fallbackDock)
  return fallbackDock
}

/**
 * The app's window shell: a draggable, resizable panel with a Peek mode.
 *
 * Used by Settings, Data stores and the Forge, which are modal: a backdrop, a
 * centred window, click-outside to dismiss.
 *
 * **ThemeModal deliberately does not use this.** It is a *non-modal* palette —
 * no backdrop, parked top-right — because the whole point of a live theme
 * editor is watching the app change behind it while you drag a slider. Giving
 * it a backdrop that swallows clicks would break the one workflow it exists
 * for. It is the exception, not drift, and should stay one unless this
 * component grows a `modal={false}` mode.
 *
 * Two details that are easy to get wrong and are therefore fixed here:
 *
 * - **The position is `left`/`top`, not a transform.** `useDraggable` reports
 *   absolute viewport coordinates, so a transform made the window jump the
 *   instant it was grabbed.
 * - **The background is an inline style, not `.theme-bg`.** That utility is
 *   `!important`, which beats an inline style and would make Peek a no-op.
 *
 * Size is CSS, deliberately not state: the native `resize` handle writes to the
 * inline width/height, and a React-controlled value would fight it.
 */
/**
 * Minimize for a window that is not built on `FloatingWindow`.
 *
 * `ThemeModal` is the only one: it is deliberately non-modal — no backdrop, so
 * you can watch the app change while dragging a slider — and moving it onto
 * this shell would cost it exactly that. Rather than a second implementation,
 * it borrows the chip and the dock from here, so both kinds of window collapse
 * into the same strip and look identical once they are there.
 */
export function useMinimizeToDock({
  id,
  open,
  onClose,
  title,
  icon,
}: {
  /** Stable key, so `restoreWindow(id)` can reach this window while minimized. */
  id?: string
  open: boolean
  onClose: () => void
  title: ReactNode
  icon?: ReactNode
}) {
  const [minimized, setMinimized] = useState(false)
  const [dock, setDock] = useState<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) setMinimized(false)
  }, [open])

  // The dock node is created here rather than in an effect: this is the first
  // moment it is needed, a click handler is where a DOM side effect belongs,
  // and a page where nobody minimizes anything never grows the node at all.
  //
  // Memoised because `useMinimizeOnOutsideClick` takes it as a dependency; a
  // fresh function each render would tear down and re-add the document
  // listener on every keystroke in the window.
  const minimize = useCallback(() => {
    setDock(getDock())
    setMinimized(true)
  }, [])

  const restore = useCallback(() => setMinimized(false), [])

  useRestoreRegistration(id, minimized, restore)

  const chip = renderChip({ title, icon, onRestore: restore, onClose })

  return {
    minimized,
    minimize,
    restore,
    /** Render this alongside the window; it is null unless minimized. */
    dockChip: minimized && dock ? createPortal(chip, dock) : null,
  }
}

/** The chip itself, shared by both paths so they cannot drift apart. */
function renderChip({
  title,
  icon,
  onRestore,
  onClose,
}: {
  title: ReactNode
  icon?: ReactNode
  onRestore: () => void
  onClose: () => void
}) {
  const name = typeof title === 'string' ? title : 'window'
  // Square, matching `Switch` and the pixel skeletons rather than the round
  // buttons it sits beside. Height still 36px so it lines up with them.
  return (
    <span className="pointer-events-auto inline-flex items-center h-9 rounded-[3px] border theme-border theme-text text-xs transition-colors hover:bg-[color-mix(in_srgb,var(--text-main)_9%,transparent)] animate-in fade-in slide-in-from-top-1 duration-200">
      <button
        onClick={onRestore}
        title={`Restore ${name}`}
        className="flex items-center gap-1.5 pl-2.5 pr-1.5 h-full rounded-l-[2px]"
      >
        {icon}
        <span className="truncate max-w-[140px]">{title}</span>
      </button>
      <button
        onClick={onClose}
        aria-label={`Close ${name}`}
        title="Close without restoring"
        className="flex items-center h-full pr-2 pl-0.5 rounded-r-[2px] theme-text-muted hover:text-[var(--status-bad)]"
      >
        <X size={13} />
      </button>
    </span>
  )
}

export function FloatingWindow({
  id,
  open,
  onClose,
  title,
  subtitle,
  icon,
  headerActions,
  width = 900,
  height = 650,
  className = '',
  children,
}: {
  /** Stable key, so `restoreWindow(id)` can reach this window while minimized. */
  id?: string
  open: boolean
  onClose: () => void
  title: ReactNode
  subtitle?: ReactNode
  icon?: ReactNode
  /** Extra header controls, rendered before Peek and Close. */
  headerActions?: (ctx: { isPeek: boolean }) => ReactNode
  width?: number
  height?: number
  className?: string
  children: ReactNode | ((ctx: { isPeek: boolean }) => ReactNode)
}) {
  const [isPeek, setIsPeek] = useState(false)
  const [minimized, setMinimized] = useState(false)
  const [dock, setDock] = useState<HTMLElement | null>(null)
  const { position, onMouseDown, handleRef, windowRef, preview, snapRect, settling, toggleMaximize } =
    useDraggable()

  // Closing and reopening should give a normal window, not a chip. Minimize is
  // a view state, not a preference worth remembering.
  useEffect(() => {
    if (!open) setMinimized(false)
  }, [open])

  // Declared here, above the Escape handler that uses `restore`.
  const minimize = useCallback(() => {
    setDock(getDock())
    setMinimized(true)
  }, [])

  const restore = useCallback(() => setMinimized(false), [])

  useRestoreRegistration(id, minimized, restore)

  // Recomputed each time the window opens, so it lands centred even if the
  // browser has been resized since. Dragging takes over from `position` after.
  const anchor = useMemo(() => {
    if (!open || typeof window === 'undefined') return { left: 0, top: 0 }
    const w = Math.min(width, window.innerWidth * 0.95)
    const h = Math.min(height, window.innerHeight * 0.9)
    return {
      left: Math.max(8, (window.innerWidth - w) / 2),
      top: Math.max(8, (window.innerHeight - h) / 2),
    }
  }, [open, width, height])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      // Escape restores a minimized window rather than closing it. Closing
      // something you cannot see, and losing whatever was in it, is the wrong
      // response to the key people press to back out of things.
      if (minimized) restore()
      else onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, minimized, restore])

  const chip = renderChip({ title, icon, onRestore: restore, onClose })

  if (!open) return null

  return (
    <>
      {/* `display: none` rather than an early return, so the children stay
          mounted. Unmounting would throw away the active tab, the scroll
          position and every filter — and "restore" would quietly mean
          "reopen", which is not what a minimize button promises. */}
      <div
        className="fixed inset-0 z-[100] pointer-events-none"
        style={{ display: minimized ? 'none' : undefined }}
        aria-hidden={minimized}
      >
      {/* Clicking away minimizes rather than closes. A window here holds real
          work — a filtered model table, a half-written API key, an open store
          row — and a stray click outside it should set that aside, not throw
          it away. Closing stays deliberate: the ✕, or Escape. */}
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-sm pointer-events-auto transition-opacity duration-300"
        style={{ opacity: isPeek ? 0 : 1 }}
        onClick={minimize}
        title="Click to set this aside"
      />

      {/* The dashed target, drawn under the window and over the page, while a
          drag is over an edge. Portalled to <body> so it is not clipped by the
          window's own `overflow: hidden`. */}
      {preview &&
        createPortal(
          <div className="snap-preview" style={preview} aria-hidden />,
          document.body,
        )}

      <div
        ref={windowRef}
        style={{
          left: snapRect ? snapRect.left : position.x || anchor.left,
          top: snapRect ? snapRect.top : position.y || anchor.top,
          width: snapRect ? snapRect.width : width,
          height: snapRect ? snapRect.height : height,
          // A snapped window is the size of the region it was dropped in, so
          // the class-level clamps have to stand down: `max-w-[95vw]` would
          // leave a maximized window 5% short, and `min-w-[560px]` would push a
          // half-screen snap off a narrow display.
          ...(snapRect
            ? { maxWidth: 'none', maxHeight: 'none', minWidth: 0, minHeight: 0 }
            : null),
          backgroundColor: isPeek
            ? 'color-mix(in srgb, var(--bg, #000) 55%, transparent)'
            : 'var(--bg)',
          backdropFilter: isPeek ? 'none' : undefined,
        }}
        className={`pointer-events-auto absolute overflow-hidden flex flex-col theme-text theme-border border rounded-xl shadow-2xl transition-colors duration-300 ${
          // Native resize is withdrawn while snapped: the handle writes inline
          // width/height that React overwrites on the next render, so it looks
          // broken rather than unavailable.
          snapRect ? '' : 'resize min-w-[560px] min-h-[400px] max-w-[95vw] max-h-[90vh]'
        } ${settling ? 'snap-settling' : ''} ${isPeek ? 'theme-hairline shadow-none' : ''} ${className}`}
      >
        <div
          ref={handleRef}
          onMouseDown={onMouseDown}
          onDoubleClick={toggleMaximize}
          title={snapRect ? 'Double-click to restore' : 'Drag to move · drag to an edge to snap · double-click to maximize'}
          className="flex items-center justify-between px-4 py-3 border-b theme-border cursor-move theme-surface select-none shrink-0"
          style={{ backgroundColor: isPeek ? 'transparent' : undefined }}
        >
          <div className="flex items-center gap-2 font-medium min-w-0">
            {icon}
            <span className="truncate">{title}</span>
            {subtitle && (
              <span className="theme-text-muted font-normal text-sm truncate">· {subtitle}</span>
            )}
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {headerActions?.({ isPeek })}
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={minimize}
              aria-label="Minimize"
              title="Collapse to the bar at the bottom. Nothing is lost — the window reopens exactly as you left it."
              className="p-1.5 rounded-md theme-text-muted hover:theme-text hover:bg-[color-mix(in_srgb,var(--text-main)_9%,transparent)]"
            >
              <Minus size={16} />
            </button>
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => setIsPeek(!isPeek)}
              className={`flex items-center gap-1 px-2 py-1 rounded-md transition-colors text-xs font-medium border mr-1 ${
                isPeek
                  ? 'bg-primary/20 text-[var(--primary-readable)] border-[var(--primary)]/30'
                  : 'theme-text-muted hover:theme-text border-transparent hover:bg-[color-mix(in_srgb,var(--text-main)_9%,transparent)]'
              }`}
              title="Fade this window to preview the page behind it"
            >
              <CircleDashed size={14} className={isPeek ? 'animate-[spin_4s_linear_infinite]' : ''} />
              Peek
            </button>
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={onClose}
              aria-label="Close"
              className="p-1.5 rounded-md theme-text-muted hover:theme-text hover:bg-[color-mix(in_srgb,var(--text-main)_9%,transparent)]"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className={`flex-1 min-h-0 flex flex-col ${isPeek ? 'bg-transparent' : 'theme-surface'}`}>
          {typeof children === 'function' ? children({ isPeek }) : children}
        </div>
        </div>
      </div>
      {minimized && dock && createPortal(chip, dock)}
    </>
  )
}
