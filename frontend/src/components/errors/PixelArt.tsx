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
  // Minecraft materials, mixed from the theme so they follow it (the 400 redstone circuit).
  k: 'color-mix(in srgb, var(--text-muted) 45%, var(--bg))', // cobblestone: lever plate, piston body
  o: 'color-mix(in srgb, var(--status-warn) 45%, var(--bg))', // wood: lever pivot, torch sticks
  h: 'color-mix(in srgb, var(--status-warn) 45%, var(--bg))', // lever stick, on
  j: 'color-mix(in srgb, var(--status-warn) 45%, var(--bg))', // lever stick, off
  x: 'var(--dust-off)', // redstone dust (lit by CSS)
  z: 'var(--dust-off)', // redstone dust after a repeater
  y: 'var(--dust-off)', // redstone torch tip
  q: 'var(--dust-off)', // redstone dust that never powers
  p: 'var(--status-bad)', // spark off powered dust
  u: 'var(--status-bad)', // spark off dust after a repeater
  c: 'color-mix(in srgb, var(--text-muted) 22%, var(--bg))', // a block's front face (the 3D side)
  e: 'color-mix(in srgb, var(--status-warn) 45%, var(--bg))', // piston head (wood), top
  i: 'color-mix(in srgb, var(--status-warn) 22%, var(--bg))', // piston head, front
  f: 'color-mix(in srgb, var(--status-warn) 45%, var(--bg))', // piston arm, top (shown when extended)
  F: 'color-mix(in srgb, var(--status-warn) 22%, var(--bg))', // piston arm, front
  P: 'color-mix(in srgb, var(--status-warn) 45%, var(--bg))', // pushed-out piston head, top
  Q: 'color-mix(in srgb, var(--status-warn) 22%, var(--bg))', // pushed-out piston head, front
  // Minecraft people (401 Steve's arm, 402 Steve and the villager). Steve's shirt is b (info blue).
  S: 'color-mix(in srgb, var(--status-warn) 30%, var(--text-main))', // skin
  V: 'color-mix(in srgb, var(--status-warn) 30%, var(--text-main))', // villager skin (shakes on its own)
  K: 'color-mix(in srgb, var(--text-muted) 22%, var(--bg))', // villager unibrow
  W: 'var(--text-main)', // villager eye white
  G: 'var(--status-ok)', // villager eye
  N: 'color-mix(in srgb, var(--status-warn) 45%, var(--text-muted))', // villager nose
}

/**
 * The picture, animated per code by `.pix-<code>` in index.css. Each pixel
 * carries its colour letter as a class (`px-a`, `px-w`, …) and its grid
 * position as `--x` / `--y`, so the CSS can move one part of a picture (the
 * dot in the maze, the sand in the hourglass) or stagger an effect across it.
 */
export function PixelArt({ rows, anim, className = '' }: { rows: string[]; anim: number; className?: string }) {
  const w = Math.max(...rows.map((r) => r.length))
  return (
    // The wrapper takes the shadow and the whole-picture motion, the SVG the per-pixel motion.
    <div className={`pix pix-${anim} ${className}`} aria-hidden>
      <svg
        viewBox={`0 0 ${w} ${rows.length}`}
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
