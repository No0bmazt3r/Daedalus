import type { CSSProperties } from 'react'

// Grid palette: each letter is a theme colour, '.' is empty.
export const COLOURS: Record<string, string> = {
  a: 'var(--primary)',
  t: 'var(--text-main)',
  m: 'var(--text-muted)',
  r: 'var(--status-bad)',
  w: 'var(--status-warn)',
  g: 'var(--status-ok)',
  // Muted too, but its own letter so it can move on its own (the 502 rubble).
  d: 'var(--text-muted)',
  // The 507 item that will not fit.
  b: 'var(--status-info)',
}

/**
 * The picture, animated per code by `.pix-<code>` in index.css. Each pixel
 * carries its colour letter as a class (`px-a`, `px-w`, …) and its grid
 * position as `--x` / `--y`, so the CSS can move one part of a picture (the
 * dot in the maze, the sand in the hourglass) or stagger an effect across it.
 */
export function PixelArt({ rows, anim, className = '' }: { rows: string[]; anim: number; className?: string }) {
  const size = Math.max(rows.length, ...rows.map((r) => r.length))
  return (
    // The wrapper takes the shadow and the whole-picture motion, the SVG the per-pixel motion.
    <div className={`pix pix-${anim} ${className}`} aria-hidden>
      <svg
        viewBox={`0 0 ${size} ${size}`}
        shapeRendering="crispEdges"
        className="pix-svg h-full w-full overflow-visible drop-shadow-[0_10px_0_color-mix(in_srgb,var(--text-main)_12%,transparent)]"
      >
        {rows.flatMap((row, y) =>
          [...row].map((c, x) =>
            COLOURS[c] ? (
              <rect
                key={`${x}-${y}`}
                x={x}
                y={y}
                width={1}
                height={1}
                fill={COLOURS[c]}
                className={`px-${c}`}
                style={{ '--x': x, '--y': y } as CSSProperties}
              />
            ) : null,
          ),
        )}
      </svg>
    </div>
  )
}
