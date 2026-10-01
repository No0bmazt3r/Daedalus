import { useLayoutEffect, useRef, useState } from 'react'

/**
 * One line of text that never wraps. When it fits, it is plain text. When it
 * does not, it scrolls right-to-left in a seamless loop — two copies a gap
 * apart, the second following the first in — with the edges faded so the text
 * slides in from and out into the background rather than being cut off.
 *
 * Measured, not guessed: a ResizeObserver on the box and the text decides
 * whether it overflows, so a window resized wider stops the scroll and one
 * resized narrower starts it. Speed is constant (`PX_PER_SECOND`), so a long
 * label takes longer rather than moving faster.
 *
 * `prefers-reduced-motion` gets an ellipsis instead (see `.marquee` in
 * index.css) — a moving label is decoration, and the full text is in `title`.
 */
const PX_PER_SECOND = 28
const GAP_PX = 24

export function MarqueeText({ text, className = '' }: { text: string; className?: string }) {
  const box = useRef<HTMLSpanElement>(null)
  const copy = useRef<HTMLSpanElement>(null)
  const [shift, setShift] = useState(0)

  useLayoutEffect(() => {
    const outer = box.current
    const inner = copy.current
    if (!outer || !inner) return
    const measure = () => {
      const overflow = inner.scrollWidth - outer.clientWidth
      setShift(overflow > 1 ? inner.scrollWidth + GAP_PX : 0)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(outer)
    observer.observe(inner)
    return () => observer.disconnect()
  }, [text])

  const moving = shift > 0
  return (
    <span
      ref={box}
      title={text}
      className={`marquee ${moving ? 'marquee-moving' : ''} ${className}`}
      style={moving ? ({
        '--marquee-shift': `${shift}px`,
        '--marquee-duration': `${shift / PX_PER_SECOND}s`,
        '--marquee-gap': `${GAP_PX}px`,
      } as React.CSSProperties) : undefined}
    >
      <span className="marquee-track">
        <span ref={copy} className="marquee-copy">{text}</span>
        {/* The follower that makes the loop seamless; hidden from readers,
            who already have the first copy. */}
        {moving && <span className="marquee-copy" aria-hidden>{text}</span>}
      </span>
    </span>
  )
}
