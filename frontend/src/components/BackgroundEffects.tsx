import { useEffect, useRef } from 'react'
import {
  initSynapse,
  initRain,
  initConstellations,
  initPerlinFlow,
  initPetals,
  initSparkles,
  initEmbers,
} from '../lib/canvasEffects'
import { useTheme } from '../contexts/ThemeContext'
import type { PatternKey } from '../lib/themes'

type EffectInit = (canvas: HTMLCanvasElement, cancelToken: { cancelled: boolean }) => void

const CANVAS_EFFECTS: Partial<Record<PatternKey, EffectInit>> = {
  synapse: initSynapse,
  rain: initRain,
  constellations: initConstellations,
  'perlin-flow': initPerlinFlow,
  petals: initPetals,
  sparkles: initSparkles,
  embers: initEmbers,
}

/**
 * Paints the active theme's background effect behind the app. CSS-only
 * patterns (dots, the synapse grid) come from `.bg-pattern-*` classes on the
 * container, which sits above the pane background and below the content;
 * animated ones run on a canvas that is torn down and rebuilt whenever the
 * effect, its colour or its size changes.
 */
export function BackgroundEffects() {
  const { state } = useTheme()
  const { pattern, effectColor, effectSize, colors } = state
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const init = CANVAS_EFFECTS[pattern]
    const canvas = canvasRef.current
    if (!init || !canvas) return

    const cancelToken = { cancelled: false }
    init(canvas, cancelToken)

    return () => {
      cancelToken.cancelled = true
      const ctx = canvas.getContext('2d')
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height)
    }
    // Effects sample the CSS variables once at start-up, so a colour or size
    // change has to restart them to take hold.
  }, [pattern, effectColor, effectSize, colors.primary, colors.text])

  if (pattern === 'none') return null

  return (
    <div
      className={`absolute inset-0 z-0 overflow-hidden pointer-events-none bg-pattern-${pattern}`}
      aria-hidden="true"
    >
      {CANVAS_EFFECTS[pattern] && (
        <canvas
          ref={canvasRef}
          className="absolute inset-0 w-full h-full"
          style={{ opacity: 'var(--bg-effect-intensity, 1)' }}
        />
      )}
    </div>
  )
}
