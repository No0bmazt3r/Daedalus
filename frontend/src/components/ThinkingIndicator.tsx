import { useEffect, useMemo, useRef } from 'react'
import { MODE_FRAMES, ThinkingOrb, resolvePreset, type OrbState } from 'thinking-orbs'
import { useTheme } from '../contexts/ThemeContext'

// The stage the server reports while a reply is in flight (`chatClient` progress
// phases), as an orb animation and a few words. Unknown or missing phases read
// as plain "working" rather than guessing.
const PHASES: Record<string, { state: OrbState; label: string }> = {
  understood: { state: 'working', label: 'Reading your question' },
  evidence: { state: 'searching', label: 'Searching the knowledge base' },
  generating: { state: 'solving', label: 'Thinking' },
  validated: { state: 'composing', label: 'Checking the answer' },
}

const SIZE = 32

/** Shown in place of an assistant reply until its first words arrive. */
export function ThinkingIndicator({ phase }: { phase?: string }) {
  const { state: theme } = useTheme()
  const { state, label } = PHASES[phase ?? ''] ?? { state: 'working' as const, label: 'Working' }
  // The orb draws on a canvas, so it needs a real colour rather than a CSS
  // variable. Read once per mount: the theme does not change mid-reply.
  const color = useMemo(
    () => getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() || '#34d399',
    [],
  )
  return (
    <span className="flex items-center gap-2.5" role="status" aria-live="polite">
      {/* The pixel skeleton theme squares everything, so the orb follows it. */}
      {theme.skeleton === 'pixel'
        ? <PixelOrb state={state} color={color} label={label} />
        : <ThinkingOrb state={state} size={SIZE} color={color} aria-label={label} />}
      <span className="text-sm theme-text-muted">{label}…</span>
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
function PixelOrb({ state, color, label }: { state: OrbState; color: string; label: string }) {
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

  return <canvas ref={ref} role="img" aria-label={label} style={{ width: SIZE, height: SIZE, display: 'block', imageRendering: 'pixelated' }} />
}
