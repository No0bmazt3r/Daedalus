import { createPortal } from 'react-dom'
import { useNavigate, useRouter } from '@tanstack/react-router'
import { ArrowLeft, Home, RotateCw } from 'lucide-react'
import { ERRORS } from './catalogue'
import { PixelArt } from './PixelArt'
import './animations.css'

/**
 * One page for every HTTP error, themed half Daedalus (the labyrinth, Icarus,
 * the workshop) and half block-built (pixel art, crafting, mining).
 *
 * Each code has a myth line, a block line, then a plain explanation and what to
 * try, so the flavour never replaces the useful part. The art is a small grid
 * drawn in the theme's own colours, so it follows every theme. Shown by the
 * router for unknown routes (404) and crashes (the error's status, else 500),
 * and at `/error/<code>` directly.
 *
 * One file per code in `codes/` (text, picture and animation), found
 * automatically by `catalogue.ts`; shared motions in `animations.css`.
 */

/** The status on an error thrown by `request()`, if it has one. */
export function statusOf(error: unknown): number | null {
  const status = (error as { status?: unknown } | null)?.status
  return typeof status === 'number' ? status : null
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
        {/* This code's own animation, from its file in codes/. */}
        <style>{info.css}</style>
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
