import { useEffect, useMemo, useRef, useState } from 'react'
import { MODE_FRAMES, ThinkingOrb, resolvePreset, type OrbState } from 'thinking-orbs'
import { useTheme } from '../contexts/ThemeContext'

// The stage the server reports while a reply is in flight (`chatClient` progress
// phases). Each stage has a few orb designs and lines that take turns, so a slow
// stage keeps moving instead of sitting on one sentence. Every line stays true
// to its stage: rotation changes the wording, never what is claimed to be
// happening. Unknown or missing phases use the "working" set.
type Beat = { state: OrbState; label: string }
const PHASES: Record<string, Beat[]> = {
  understood: [
    { state: 'working', label: 'Reading your question' },
    { state: 'shaping', label: 'Working out what you need' },
    { state: 'breathing', label: 'Planning where to look' },
  ],
  evidence: [
    { state: 'searching', label: 'Searching the knowledge base' },
    { state: 'connecting', label: 'Looking up the facts' },
    { state: 'weaving', label: 'Gathering the evidence' },
  ],
  generating: [
    { state: 'solving', label: 'Thinking' },
    { state: 'weaving', label: 'Putting the pieces together' },
    { state: 'composing', label: 'Writing the answer' },
  ],
  validated: [
    { state: 'composing', label: 'Checking the answer' },
    { state: 'connecting', label: 'Matching numbers to evidence' },
  ],
}
const WORKING: Beat[] = [
  { state: 'working', label: 'Working' },
  { state: 'breathing', label: 'Getting ready' },
]
const BEAT_MS = 2800

const SIZE = 32

/** Shown in place of an assistant reply until its first words arrive. */
export function ThinkingIndicator({ phase }: { phase?: string }) {
  const { state: theme } = useTheme()
  const beats = PHASES[phase ?? ''] ?? WORKING
  // Restarts at the first beat whenever the stage changes.
  const [beat, setBeat] = useState({ phase, i: 0 })
  const i = beat.phase === phase ? beat.i : 0
  useEffect(() => {
    const timer = window.setInterval(
      () => setBeat((b) => ({ phase, i: (b.phase === phase ? b.i : 0) + 1 })),
      BEAT_MS,
    )
    return () => window.clearInterval(timer)
  }, [phase])
  const { state, label } = beats[i % beats.length]
  // The orb draws on a canvas, so it needs a real colour rather than a CSS
  // variable. Read once per mount: the theme does not change mid-reply.
  const color = useMemo(
    () => getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() || '#34d399',
    [],
  )
  return (
    <span className="flex items-center gap-2.5">
      {/* Screen readers hear the stage once, not every rotating line. */}
      <span className="sr-only" role="status" aria-live="polite">{beats[0].label}</span>
      {/* The pixel skeleton theme squares everything, so the orb follows it. */}
      {theme.skeleton === 'pixel'
        ? <PixelOrb state={state} color={color} />
        : <ThinkingOrb state={state} size={SIZE} color={color} aria-hidden="true" />}
      {/* Keyed so each new line fades in rather than snapping. */}
      <span key={label} aria-hidden="true" className="text-sm theme-text-muted animate-in fade-in slide-in-from-bottom-1 duration-300">
        {label}…
      </span>
    </span>
  )
}

/**
 * The same orb, drawn in square dots snapped to a pixel grid.
 *
 * thinking-orbs paints round dots in an internal function with no option for
 * another shape, but it exports the geometry (`resolvePreset`, `MODE_FRAMES`).
 * So this computes the identical animation and only replaces the paint step.
 */
function PixelOrb({ state, color }: { state: OrbState; color: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = SIZE * dpr
    canvas.height = SIZE * dpr
    const { mode, speed, opts } = resolvePreset(state, SIZE)
    const frameAt = MODE_FRAMES[mode]
    const GRID = 2 // CSS px per "pixel"

    const draw = (t: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, SIZE, SIZE)
      ctx.fillStyle = color
      for (const d of frameAt(SIZE, t, opts).dots) {
        // `white` 0 is full ink, 1 is paper, on either theme.
        ctx.globalAlpha = (d.a ?? 1) * (1 - Math.min(1, Math.max(0, d.white)))
        const side = Math.max(GRID, Math.round((d.r * 2) / GRID) * GRID)
        ctx.fillRect(Math.round(d.x / GRID) * GRID - side / 2, Math.round(d.y / GRID) * GRID - side / 2, side, side)
      }
      ctx.globalAlpha = 1
    }

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      draw(0.6)
      return
    }
    let raf = 0
    const loop = () => {
      draw((performance.now() / 1000) * speed)
      raf = requestAnimationFrame(loop)
    }
    raf = requestAnimationFrame(loop)
    return () => cancelAnimationFrame(raf)
  }, [state, color])

  return <canvas ref={ref} aria-hidden="true" style={{ width: SIZE, height: SIZE, display: 'block', imageRendering: 'pixelated' }} />
}
