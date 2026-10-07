import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * Exit animation names the settle logic waits for.
 *
 * A set rather than one string, because `flow` uses its own outbound keyframes
 * and an exit this does not recognise is not merely unanimated — the section
 * unmounts immediately, mid-fade.
 */
const EXIT_ANIMATIONS = new Set(['domino-out', 'collapse-flow-out'])

/**
 * The app's one collapse/expand animation — the domino cascade from Odysseus'
 * sidebar sections, as a component every collapsible thing here uses.
 *
 * Opening a section does not reveal a block: the rows arrive from a little
 * below and to the left, one after another, with a small overshoot. Closing
 * peels them off from the bottom up, faster and without the bounce. The
 * keyframes and the stagger live in `index.css` under `[data-domino]`; this
 * file owns the part CSS cannot do, which is *keeping the children mounted
 * long enough for the outbound cascade to play*.
 *
 * ## Why the exit waits on the real animations
 *
 * A fixed timeout has to be as long as the longest list, so a two-row section
 * would sit through the timing of a twelve-row one — a dead pause that reads as
 * lag. `getAnimations({ subtree: true })` is asked what is actually running,
 * filtered to `domino-out` so an unrelated (possibly infinite) animation in the
 * subtree — a spinner — cannot hold the collapse open forever. A timeout
 * remains as a safety net: if an element is removed mid-flight its animation
 * never settles, and a section that cannot finish collapsing would be stuck
 * open. Same shape as `section-management.js`, for the same three reasons.
 *
 * ## Generation token
 *
 * Clicking twice quickly used to leave the section in whichever state the
 * *first* click's callback decided. Every toggle bumps a counter, and a
 * callback whose generation is stale returns without touching anything.
 *
 * ## What counts as a row
 *
 * The direct children of the element carrying `data-domino`. A list of rows
 * therefore cascades; a body that is one `<div>` of prose arrives as one beat,
 * which is right — prose is not a list and staggering its paragraphs would be
 * motion for its own sake.
 *
 * This is also the usual mistake. Wrapping a panel's sections in a layout
 * `<div>` and passing that makes the whole panel *one* child, so the cascade
 * degrades to a single beat and the panel appears to pop in fully formed. The
 * fix is to pass the sections directly and put the layout classes on
 * `className`, which lands them on the domino element itself.
 *
 * ## Two variants, because two different things are opening
 *
 * `domino` (the default) is for a **list of rows**: a short springy arrival with
 * a slight sideways lean, which reads as items dropping into place. It is the
 * sidebar's cascade and it should stay exactly as it is.
 *
 * `flow` is for a **panel of sections** — a model's full detail, a settings
 * body. Two differences, both because a panel is bigger than a list:
 *
 * 1. **The container unfolds.** `grid-template-rows: 0fr → 1fr` animates the
 *    height, so the box grows into place instead of appearing at full size with
 *    its contents catching up. On a tall panel that snap is most of what reads
 *    as "pop", and no amount of tuning the children's motion hides it.
 * 2. **The sections settle downward, without the bounce.** They arrive from
 *    slightly above rather than below, so the eye is carried top-to-bottom as
 *    the panel fills — the direction it will then read in. An overshoot on a
 *    400px panel is a wobble; on a 28px row it is character.
 */
export function Collapse({
  open,
  children,
  className = '',
  variant = 'domino',
}: {
  open: boolean
  children: ReactNode
  /** Applied to the animated element itself, so callers keep their layout. */
  className?: string
  /** `domino` for a list of rows, `flow` for a panel of sections. */
  variant?: 'domino' | 'flow'
}) {
  // What is on screen, which lags `open` by the length of the outbound cascade.
  const [mounted, setMounted] = useState(open)
  const [phase, setPhase] = useState<'in' | 'out' | null>(open ? null : null)
  // `flow` only: drives the height transition. Separate from `mounted` because
  // a transition needs two states in two different frames — mounting already
  // at `1fr` would transition from nothing and simply appear.
  const [unfolded, setUnfolded] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const generation = useRef(0)

  useEffect(() => {
    const gen = ++generation.current

    if (open) {
      setMounted(true)
      setPhase('in')
      // One frame after mounting at `0fr`, so the browser has a start value to
      // transition from. Setting it in the same pass is the classic no-op: the
      // element is only ever laid out at the end state.
      const frame = requestAnimationFrame(() => {
        if (generation.current === gen) setUnfolded(true)
      })
      // Long enough for the last row's delay plus its duration. Clearing it
      // matters: a row left carrying a finished animation cannot replay it.
      const timer = window.setTimeout(() => {
        if (generation.current === gen) setPhase(null)
      }, 900)
      return () => { window.clearTimeout(timer); cancelAnimationFrame(frame) }
    }

    // Fold first, so the box is already shrinking while the rows peel off.
    setUnfolded(false)

    // Closing from a closed state — nothing to play.
    if (!mounted) return

    setPhase('out')

    let safety = 0
    const settle = () => {
      if (generation.current !== gen) return
      window.clearTimeout(safety)
      setMounted(false)
      setPhase(null)
    }

    // A frame first: the phase attribute has to be in the DOM before asking
    // what is animating, or the answer is "nothing" and the exit is skipped.
    const raf = requestAnimationFrame(() => {
      if (generation.current !== gen) return
      const running = (ref.current?.getAnimations({ subtree: true }) ?? []).filter(
        (a) => EXIT_ANIMATIONS.has((a as CSSAnimation).animationName)
      )
      if (running.length === 0) {
        settle()
        return
      }
      void Promise.allSettled(running.map((a) => a.finished)).then(settle)
      safety = window.setTimeout(settle, 600)
    })

    return () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(safety)
    }
    // `mounted` is read but deliberately not a dependency: including it would
    // re-run this on the very state change it makes, restarting the exit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  if (!mounted) return null

  const body = (
    <div
      ref={ref}
      data-domino={phase ?? undefined}
      data-flow={variant === 'flow' ? 'true' : undefined}
      className={className}
    >
      {children}
    </div>
  )

  if (variant !== 'flow') return body

  // The unfolding wrapper. `grid-template-rows` rather than `max-height`,
  // because a max-height animation has to guess a number: guess low and the
  // content clips, guess high and the transition spends most of its duration
  // animating empty space, which is the "opens slowly then snaps" feel.
  return (
    <div className={`collapse-flow ${unfolded ? 'collapse-flow-open' : ''}`}>
      <div>{body}</div>
    </div>
  )
}

/**
 * The same behaviour for a caller that owns its own wrapper element.
 *
 * Returns what to render and what to put on it. `Collapse` adds a `<div>`,
 * which is usually free and occasionally not — inside a `<tbody>`, or where the
 * parent is a grid whose children are positioned individually.
 */
export function useCollapse(open: boolean) {
  const [mounted, setMounted] = useState(open)
  const [phase, setPhase] = useState<'in' | 'out' | null>(null)
  const ref = useRef<HTMLElement | null>(null)
  const generation = useRef(0)

  useEffect(() => {
    const gen = ++generation.current
    if (open) {
      setMounted(true)
      setPhase('in')
      const timer = window.setTimeout(() => {
        if (generation.current === gen) setPhase(null)
      }, 900)
      return () => window.clearTimeout(timer)
    }
    if (!mounted) return
    setPhase('out')
    let safety = 0
    const settle = () => {
      if (generation.current !== gen) return
      window.clearTimeout(safety)
      setMounted(false)
      setPhase(null)
    }
    const raf = requestAnimationFrame(() => {
      if (generation.current !== gen) return
      const running = (ref.current?.getAnimations({ subtree: true }) ?? []).filter(
        (a) => (a as CSSAnimation).animationName === 'domino-out'
      )
      if (running.length === 0) return settle()
      void Promise.allSettled(running.map((a) => a.finished)).then(settle)
      safety = window.setTimeout(settle, 600)
    })
    return () => {
      cancelAnimationFrame(raf)
      window.clearTimeout(safety)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  return {
    /** False while the section is fully closed — render nothing. */
    mounted,
    /** Spread onto the element whose children should cascade. */
    dominoProps: {
      ref: ref as React.RefObject<never>,
      'data-domino': phase ?? undefined,
    },
  }
}
