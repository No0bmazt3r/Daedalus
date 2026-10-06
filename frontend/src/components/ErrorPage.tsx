import type { CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useRouter } from '@tanstack/react-router'
import { ArrowLeft, Home, RotateCw } from 'lucide-react'

/**
 * One page for every HTTP error, themed half Daedalus (the labyrinth, Icarus,
 * the workshop) and half block-built (pixel art, crafting, mining).
 *
 * Each code has a myth line, a block line, then a plain explanation and what to
 * try, so the flavour never replaces the useful part. The art is a small grid
 * drawn in the theme's own colours, so it follows every theme. Shown by the
 * router for unknown routes (404) and crashes (the error's status, else 500),
 * and at `/error/<code>` directly.
 */

// Grid palette: each letter is a theme colour, '.' is empty.
const COLOURS: Record<string, string> = {
  a: 'var(--primary)',
  t: 'var(--text-main)',
  m: 'var(--text-muted)',
  r: 'var(--status-bad)',
  w: 'var(--status-warn)',
  g: 'var(--status-ok)',
  // Muted too, but its own letter so it can move on its own (the 502 rubble).
  d: 'var(--text-muted)',
}

interface ErrorInfo {
  title: string
  name: string
  myth: string
  block: string
  what: string
  fix: string
  art: string[]
}

export const ERRORS: Record<number, ErrorInfo> = {
  400: {
    name: 'Bad Request', title: 'The thread is tangled',
    myth: "Ariadne's thread came back in knots.",
    block: 'That recipe is not in any crafting book.',
    what: 'The request was malformed, so the server could not read it.',
    fix: 'Check what was sent, fix the input, and try again.',
    art: [
      '............', '.aaa....aaa.', 'a...a..a...a', 'a....aa....a',
      '.a...aa...a.', '..aaa..aaa..', '....a..a....', '...a....a...',
      '..a......a..', '.a........a.', 'a..........a', '............',
    ],
  },
  401: {
    name: 'Unauthorized', title: 'The gate asks your name',
    myth: 'The labyrinth gate stays shut to strangers.',
    block: 'This iron door needs a key you are not holding.',
    what: 'You are not signed in, or your sign-in has expired.',
    fix: 'Sign in again, then retry.',
    art: [
      '..mmmmmmmm..', '..mttttttm..', '..mt....tm..', '..mt....tm..',
      '..mt....tm..', '..mttttttm..', '..mt.ww.tm..', '..mt.ww.tm..',
      '..mt.ww.tm..', '..mt....tm..', '..mttttttm..', '..mmmmmmmm..',
    ],
  },
  403: {
    name: 'Forbidden', title: 'King Minos says no',
    myth: 'You were seen, and the king still closed the door.',
    block: 'Bedrock. No pickaxe gets through this.',
    what: 'The server knows who you are, but you are not allowed here.',
    fix: 'Ask for access, or go back to somewhere you can reach.',
    art: Array.from({ length: 12 }, (_, i) =>
      Array.from({ length: 12 }, (_, j) =>
        Math.abs(j - i) <= 1 || Math.abs(j - (11 - i)) <= 1 ? 'r' : (i >> 1) % 2 === (j >> 1) % 2 ? 'm' : 't',
      ).join(''),
    ),
  },
  404: {
    name: 'Not Found', title: 'Lost in the labyrinth',
    myth: 'Even Daedalus took a wrong turn in here once.',
    block: 'You dug down and found nothing but stone.',
    what: 'This page or resource does not exist, or it has moved.',
    fix: 'Check the address, or head back to the chat.',
    art: [
      'tttttttttttt', 't....t.....t', 't.tt.t.ttt.t', 't.t..t...t.t',
      't.t.ttt.t..t', 't.t...t.t.tt', 't.ttt.t.t..t', 't...t...tt.t',
      'ttt.ttttt..t', 't.....a....t', 't.ttttttt.tt', 'tttttttttttt',
    ],
  },
  405: {
    name: 'Method Not Allowed', title: 'Wrong tool for this block',
    myth: 'Daedalus never carved marble with a feather.',
    block: 'A wooden pickaxe will not mine obsidian.',
    what: 'This address exists, but not for this kind of request (e.g. GET on a POST-only route).',
    fix: 'Use the request method the endpoint expects.',
    art: [
      '..mmmmmmmm..', '.mm......mm.', 'mm...tt...mm', 'm....tt....m',
      '.....tt.....', '.....tt.....', '.....tt.....', '.....tt.....',
      '.....tt.....', '.....tt.....', '.....tt.....', '............',
    ],
  },
  409: {
    name: 'Conflict', title: 'Two paths, one corridor',
    myth: 'Two heroes reached the same door at once.',
    block: 'Something is already built on this block.',
    what: 'The request clashes with the current state, like a duplicate or a change made meanwhile.',
    fix: 'Refresh to see the latest state, then try again.',
    art: [
      't..........t', '.t........t.', '..t......t..', '...t....t...',
      '....t..t....', '.....tt.....', '.....tt.....', '....t..t....',
      '.mmt....tmm.', '..m......m..', '.m........m.', '............',
    ],
  },
  413: {
    name: 'Payload Too Large', title: 'Too heavy to fly',
    myth: 'Icarus could not take off carrying the whole workshop.',
    block: 'Your inventory is full.',
    what: 'What was sent is bigger than the server accepts.',
    fix: 'Send something smaller, or split it into parts.',
    art: [
      '............', 'mm........mm', 'mmm......mmm', '.wwwwwwwwww.',
      '.wttttttttw.', '.wttttttttw.', '.wwwwaawwww.', '.wttwaawttw.',
      '.wttttttttw.', '.wttttttttw.', '.wwwwwwwwww.', '............',
    ],
  },
  415: {
    name: 'Unsupported Media Type', title: 'Unknown material',
    myth: 'Daedalus could not work a metal he had never seen.',
    block: 'This block has no texture. Nobody knows what it is.',
    what: 'The server does not accept this content type.',
    fix: 'Send a supported format (for documents: text, Markdown or PDF).',
    art: [
      'mmmmmmmmmmmm', 'm..........m', 'm...aaaa...m', 'm..aa..aa..m',
      'm......aa..m', 'm.....aa...m', 'm....aa....m', 'm....aa....m',
      'm..........m', 'm....aa....m', 'm..........m', 'mmmmmmmmmmmm',
    ],
  },
  422: {
    name: 'Unprocessable Entity', title: 'Crafted wrong',
    myth: 'The wings were built, but with the feathers backwards.',
    block: 'The right items, in the wrong slots.',
    what: 'The request was readable, but some values failed validation.',
    fix: 'Check each field against what is expected, then resend.',
    art: Array.from({ length: 13 }, (_, i) =>
      Array.from({ length: 13 }, (_, j) => {
        if (i % 4 === 0 || j % 4 === 0) return 't'
        const cell = Math.floor(i / 4) * 3 + Math.floor(j / 4)
        return cell === 4 ? 'r' : cell % 2 === 0 ? 'a' : '.'
      }).join(''),
    ),
  },
  429: {
    name: 'Too Many Requests', title: 'Flying too close to the sun',
    myth: 'Icarus climbed too fast, and the wax gave way.',
    block: 'Slow down. The furnace is still smelting the last batch.',
    what: 'Too many requests in a short time, so the server is rate limiting you.',
    fix: 'Wait a moment, then try again more slowly.',
    art: [
      '.....ww.....', '.w...ww...w.', '..w......w..', '....wwww....',
      '...wwwwww...', 'ww.wwwwww.ww', 'ww.wwwwww.ww', '...wwwwww...',
      '....wwww....', '..w......w..', '.w...ww...w.', '.....ww.....',
    ],
  },
  500: {
    name: 'Internal Server Error', title: 'The workshop caught fire',
    myth: 'Something in the forge went badly wrong.',
    block: 'A block update cascaded and took the build with it.',
    what: 'The server hit an unexpected error. This is a bug, not something you did.',
    fix: 'Try again. If it keeps happening, check Settings → Process Log.',
    art: [
      '.....r......', '....rr......', '....rrr..r..', '...rrwr..rr.',
      '..rrwwrrrrr.', '..rwwwwrwrr.', '.rrwwawwwrr.', '.rwwaaawwwr.',
      '.rwaaaaawwr.', '.rwaaaaaawr.', '..rwaaaawr..', '...rrrrrr...',
    ],
  },
  502: {
    name: 'Bad Gateway', title: 'The bridge is out',
    myth: 'The messenger reached the river and found no bridge.',
    block: 'Someone mined out the middle of the bridge.',
    what: 'A server in between got a bad answer from the one behind it.',
    fix: 'Usually a backend that crashed or restarted. Wait a moment and retry.',
    art: [
      '............', '............', '............', 'tttt....tttt',
      'tmmt....tmmt', 't..t....t..t', 't..t.d..t..t', 't..t....t..t',
      't..t..d.t..t', '............', 'aaaaaaaaaaaa', '.aa.aa.aa.aa',
    ],
  },
  503: {
    name: 'Service Unavailable', title: 'Workshop closed for repairs',
    myth: 'Daedalus has stepped out. The doors are barred.',
    block: 'The server is still loading chunks.',
    what: 'The server is down, starting up, or overloaded.',
    fix: 'Make sure the backend is running (./daedalus.sh dev), then retry.',
    art: [
      '..w....w....', '...w..w.....', 'tttttttttt..', '.tttttttttt.',
      '..tttttttt..', '....tttt....', '....tttt....', '...tttttt...',
      '..tttttttt..', '..tttttttt..', '............', '............',
    ],
  },
  504: {
    name: 'Gateway Timeout', title: 'The message never came back',
    myth: 'The runner went into the maze and has not returned.',
    block: 'The sand ran out before the redstone fired.',
    what: 'A server waited too long for another one to answer.',
    fix: 'The backend may be slow or busy (a big model loading?). Try again shortly.',
    art: [
      'tttttttttttt', '.t........t.', '.twwwwwwwwt.', '..twwwwwwt..',
      '...twwwwt...', '....twwt....', '....t..t....', '...t.ww.t...',
      '..t..ww..t..', '.t..wwww..t.', '.twwwwwwwwt.', 'tttttttttttt',
    ],
  },
}

/** The status on an error thrown by `request()`, if it has one. */
export function statusOf(error: unknown): number | null {
  const status = (error as { status?: unknown } | null)?.status
  return typeof status === 'number' ? status : null
}

/**
 * The picture, animated per code by `.pix-<code>` in index.css. Each pixel
 * carries its colour letter as a class (`px-a`, `px-w`, …) and its grid
 * position as `--x` / `--y`, so the CSS can move one part of a picture (the
 * dot in the maze, the sand in the hourglass) or stagger an effect across it.
 */
function PixelArt({ rows, anim, className = '' }: { rows: string[]; anim: number; className?: string }) {
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

export function ErrorPage({ code, detail, preview = false }: {
  code: number
  detail?: string
  /** The `/error/<code>` route in development: show a row linking every page. Never on a real error. */
  preview?: boolean
}) {
  const navigate = useNavigate()
  const router = useRouter()
  const known = ERRORS[code]
  const shownCode = known ? code : code >= 500 ? 500 : 400
  const info = ERRORS[shownCode]
  const retryable = code === 429 || code >= 500

  // Portalled to <body>: the whole window, sidebar included, and clear of the
  // layout's attention dimming. Under the floating windows (z-100), so anything
  // open there still works.
  return createPortal(
    <div
      className="fixed inset-0 z-[95] overflow-y-auto theme-bg theme-text"
      style={{
        // A faint block grid, so the page reads as built from blocks.
        backgroundImage:
          'linear-gradient(color-mix(in srgb, var(--text-main) 5%, transparent) 1px, transparent 1px),' +
          'linear-gradient(90deg, color-mix(in srgb, var(--text-main) 5%, transparent) 1px, transparent 1px)',
        backgroundSize: '48px 48px',
      }}
    >
      <div className="mx-auto grid min-h-full max-w-7xl items-center gap-10 px-8 py-12 lg:grid-cols-[5fr_6fr] lg:gap-16 lg:px-16">
        <div className="relative flex items-center justify-center">
          {/* The code again, huge and faint, behind the picture. */}
          <span
            className="pointer-events-none absolute select-none font-bold leading-none tabular-nums theme-accent opacity-[0.07] text-[clamp(8rem,22vw,20rem)]"
            aria-hidden
          >
            {code}
          </span>
          <PixelArt rows={info.art} anim={shownCode} className="relative h-[min(60vh,440px)] w-[min(80vw,440px)]" />
        </div>

        <div className="flex flex-col items-center text-center lg:items-start lg:text-left">
          <p className="text-[clamp(4.5rem,10vw,8rem)] font-bold leading-none tracking-widest tabular-nums theme-accent">
            {code}
          </p>
          <p className="mt-2 text-xs uppercase tracking-[0.3em] theme-text-muted">
            {known ? info.name : code >= 500 ? 'Server error' : 'Request error'}
          </p>

          <h1 className="mt-6 text-3xl font-semibold lg:text-4xl">{info.title}</h1>
          <p className="mt-3 text-base italic theme-text-muted">{info.myth}</p>
          <p className="text-base italic theme-text-muted">{info.block}</p>

          <div className="mt-8 grid w-full gap-3 text-left sm:grid-cols-2">
            <div className="rounded-xl border theme-border theme-card px-5 py-4">
              <p className="text-xs uppercase tracking-wider theme-text-muted">What happened</p>
              <p className="mt-1.5 text-sm leading-relaxed">{info.what}</p>
            </div>
            <div className="rounded-xl border theme-border theme-card px-5 py-4">
              <p className="text-xs uppercase tracking-wider theme-text-muted">What to try</p>
              <p className="mt-1.5 text-sm leading-relaxed">{info.fix}</p>
            </div>
          </div>
          {detail && (
            <p className="mt-3 w-full break-words rounded-lg theme-surface px-4 py-2 text-left font-mono text-xs theme-text-muted">
              {detail}
            </p>
          )}

          <div className="mt-8 flex flex-wrap justify-center gap-2 lg:justify-start">
            <button
              onClick={() => void navigate({ to: '/' })}
              className="flex items-center gap-2 rounded-lg theme-bg-primary theme-text-on-primary px-5 py-2.5 text-sm font-medium transition-opacity hover:opacity-90"
            >
              <Home size={15} /> Back to chat
            </button>
            <button
              onClick={() => router.history.back()}
              className="flex items-center gap-2 rounded-lg border theme-border px-5 py-2.5 text-sm transition-colors hover:theme-surface-strong"
            >
              <ArrowLeft size={15} /> Go back
            </button>
            {retryable && (
              <button
                onClick={() => window.location.reload()}
                className="flex items-center gap-2 rounded-lg border theme-border px-5 py-2.5 text-sm transition-colors hover:theme-surface-strong"
              >
                <RotateCw size={15} /> Try again
              </button>
            )}
          </div>

          {preview && import.meta.env.DEV && (
            <nav className="mt-10 flex flex-wrap justify-center gap-1.5 text-[11px] theme-text-muted lg:justify-start" aria-label="Preview every error page">
              {Object.keys(ERRORS).map((c) => (
                <button
                  key={c}
                  onClick={() => void navigate({ to: '/error/$code', params: { code: c } })}
                  className={`rounded border theme-border px-1.5 py-0.5 hover:theme-text ${Number(c) === code ? 'theme-accent' : ''}`}
                >
                  {c}
                </button>
              ))}
            </nav>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
