import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * Every `title="…"` in the app, shown as the styled tooltip instead of the
 * browser's grey box.
 *
 * There are a couple of hundred `title` hints, and wrapping each in
 * `<Tooltip>` would touch every file and make every new hint opt in. One
 * delegated listener at the root does it for all of them, including ones not
 * written yet: on hover (or keyboard focus) the attribute is lifted off the
 * element so the browser stays quiet, the same popup as `ui/tooltip.tsx` is
 * drawn, and the attribute goes back when the pointer leaves.
 *
 * Above the element by default, below when there is no room, kept inside the
 * viewport. Touch is skipped — a long press is not a hover — and anything
 * already using `<Tooltip>` has no `title`, so the two never both show.
 */

const DELAY_MS = 200 // the same delay as the chat's TooltipProvider
const GAP = 6
const MARGIN = 8

type Shown = { text: string; anchor: DOMRect; key: number }

export function TitleTooltips() {
  const [shown, setShown] = useState<Shown | null>(null)
  const current = useRef<{ el: Element; text: string } | null>(null)
  const timer = useRef<number | undefined>(undefined)

  useEffect(() => {
    let key = 0

    const restore = () => {
      window.clearTimeout(timer.current)
      const c = current.current
      // Only if nothing re-set it meanwhile: a re-render may have written a newer title.
      if (c && !c.el.hasAttribute('title')) c.el.setAttribute('title', c.text)
      current.current = null
      setShown(null)
    }

    const enter = (target: EventTarget | null) => {
      if (!(target instanceof Element)) return
      // Still inside the element being shown: its title is lifted, so `closest`
      // would otherwise skip past it to some outer element's hint.
      if (current.current?.el.contains(target)) return
      const el = target.closest('[title]')
      if (!el) return
      restore()
      const text = el.getAttribute('title')?.trim()
      if (!text) return
      el.removeAttribute('title')
      current.current = { el, text }
      timer.current = window.setTimeout(() => {
        if (current.current?.el !== el || !el.isConnected) return
        setShown({ text, anchor: el.getBoundingClientRect(), key: ++key })
      }, DELAY_MS)
    }

    const onOver = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') enter(e.target)
    }
    const onOut = (e: PointerEvent) => {
      const c = current.current
      if (c && !(e.relatedTarget instanceof Node && c.el.contains(e.relatedTarget))) restore()
    }
    const onFocus = (e: FocusEvent) => {
      if (e.target instanceof Element && e.target.matches(':focus-visible')) enter(e.target)
    }

    document.addEventListener('pointerover', onOver)
    document.addEventListener('pointerout', onOut)
    document.addEventListener('focusin', onFocus)
    document.addEventListener('focusout', restore)
    // A click, a key or a scroll moves things; a tooltip left behind would point at nothing.
    document.addEventListener('pointerdown', restore, true)
    document.addEventListener('keydown', restore, true)
    window.addEventListener('scroll', restore, true)
    window.addEventListener('blur', restore)
    return () => {
      restore()
      document.removeEventListener('pointerover', onOver)
      document.removeEventListener('pointerout', onOut)
      document.removeEventListener('focusin', onFocus)
      document.removeEventListener('focusout', restore)
      document.removeEventListener('pointerdown', restore, true)
      document.removeEventListener('keydown', restore, true)
      window.removeEventListener('scroll', restore, true)
      window.removeEventListener('blur', restore)
    }
  }, [])

  return shown
    ? createPortal(<Popup key={shown.key} text={shown.text} anchor={shown.anchor} />, document.body)
    : null
}

function Popup({ text, anchor }: { text: string; anchor: DOMRect }) {
  const ref = useRef<HTMLDivElement>(null)
  const [place, setPlace] = useState<{ left: number; top: number; side: 'top' | 'bottom'; arrow: number } | null>(null)

  // Measured before paint, so it never flashes at the wrong spot.
  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect()
    if (!box) return
    const side = anchor.top - box.height - GAP < MARGIN ? 'bottom' : 'top'
    const centre = anchor.left + anchor.width / 2
    const left = Math.min(Math.max(centre - box.width / 2, MARGIN), window.innerWidth - box.width - MARGIN)
    const top = side === 'top' ? anchor.top - box.height - GAP : anchor.bottom + GAP
    setPlace({ left, top, side, arrow: Math.min(Math.max(centre - left, 10), box.width - 10) })
  }, [anchor])

  return (
    <div
      ref={ref}
      role="tooltip"
      data-side={place?.side}
      style={{ left: place?.left ?? 0, top: place?.top ?? 0, visibility: place ? 'visible' : 'hidden' }}
      className={`pointer-events-none fixed z-[1000] w-fit max-w-xs whitespace-pre-line rounded-md bg-foreground px-3 py-1.5 text-xs text-background animate-in fade-in-0 zoom-in-95 ${
        place?.side === 'bottom' ? 'slide-in-from-top-2' : 'slide-in-from-bottom-2'
      }`}
    >
      {text}
      <span
        aria-hidden
        className={`absolute size-2.5 -translate-x-1/2 rotate-45 rounded-[2px] bg-foreground ${
          place?.side === 'bottom' ? '-top-1' : '-bottom-1'
        }`}
        style={{ left: place?.arrow ?? 0 }}
      />
    </div>
  )
}
