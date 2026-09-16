import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { X, CircleDashed } from 'lucide-react'
import { useDraggable } from '../../hooks/useDraggable'

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
export function FloatingWindow({
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
  const { position, onMouseDown, handleRef, windowRef } = useDraggable()

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
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[100] pointer-events-none">
      <div
        className="fixed inset-0 bg-black/40 backdrop-blur-sm pointer-events-auto transition-opacity duration-300"
        style={{ opacity: isPeek ? 0 : 1 }}
        onClick={onClose}
      />

      <div
        ref={windowRef}
        style={{
          left: position.x || anchor.left,
          top: position.y || anchor.top,
          width,
          height,
          backgroundColor: isPeek
            ? 'color-mix(in srgb, var(--bg, #000) 55%, transparent)'
            : 'var(--bg)',
          backdropFilter: isPeek ? 'none' : undefined,
        }}
        className={`pointer-events-auto absolute resize overflow-hidden min-w-[560px] min-h-[400px] max-w-[95vw] max-h-[90vh] flex flex-col theme-text theme-border border rounded-xl shadow-2xl transition-colors duration-300 ${
          isPeek ? 'border-white/20 shadow-none' : ''
        } ${className}`}
      >
        <div
          ref={handleRef}
          onMouseDown={onMouseDown}
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
              onClick={() => setIsPeek(!isPeek)}
              className={`flex items-center gap-1 px-2 py-1 rounded-md transition-colors text-xs font-medium border mr-1 ${
                isPeek
                  ? 'bg-primary/20 text-[var(--primary)] border-[var(--primary)]/30'
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
  )
}
