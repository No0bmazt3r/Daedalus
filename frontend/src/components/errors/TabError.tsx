import { RotateCw, X } from 'lucide-react'
import { ERRORS } from './catalogue'
import { PixelArt } from './PixelArt'
import './animations.css'

/**
 * The error page, filling the one tab, window or panel that failed.
 *
 * `ErrorPage` covers the whole screen, which is right when the app itself
 * cannot go on (an unknown address, the backend down). When one part fails —
 * the Forge's model list, a Blueprints tab, a Settings panel — that part
 * becomes the error page: the same picture, animation, title, what happened and
 * what to try, sized to the space it has (side by side when wide, stacked when
 * narrow), while the rest of the app keeps working. There is no smaller error
 * box anywhere: a part that cannot load always looks like this.
 *
 * The parent gives it a height (`h-full` in a flex column, or a pane); it
 * centres itself in whatever it gets, and never shrinks below a readable size.
 */
export function TabError({ code, detail, what, fix, onRetry, onClose, closeLabel = 'Close' }: {
  code: number
  /** The error's own message, shown as is. */
  detail?: string
  /** What failed to load, in place of the catalogue's general wording. */
  what?: string
  fix?: string
  /** Re-run the failed load. Offered for every code but 404, where nothing would change. */
  onRetry?: () => void
  /** Dismiss the failed part (close its window or panel), where that makes sense. */
  onClose?: () => void
  closeLabel?: string
}) {
  const known = ERRORS[code]
  const shownCode = known ? code : code >= 500 ? 500 : 400
  const info = ERRORS[shownCode]
  const wide = info.art[0].length > info.art.length

  return (
    <div
      role="alert"
      className="@container relative flex h-full min-h-[24rem] w-full flex-1 items-center justify-center overflow-y-auto no-scrollbar theme-bg theme-text"
      style={{
        // The same faint block grid as the full-screen page.
        backgroundImage:
          'linear-gradient(color-mix(in srgb, var(--text-main) 5%, transparent) 1px, transparent 1px),' +
          'linear-gradient(90deg, color-mix(in srgb, var(--text-main) 5%, transparent) 1px, transparent 1px)',
        backgroundSize: '40px 40px',
      }}
    >
      {/* This code's own animation, from its file in codes/. */}
      <style>{info.css}</style>
      <div className={`grid w-full items-center gap-6 p-6 @3xl:gap-10 @3xl:p-10 ${wide ? '@3xl:grid-cols-[3fr_2fr] max-w-5xl' : '@3xl:grid-cols-[2fr_3fr] max-w-4xl'}`}>
        <div className="relative flex items-center justify-center">
          <span
            className="pointer-events-none absolute select-none font-bold leading-none tabular-nums theme-accent opacity-[0.07] text-[clamp(5rem,16cqw,11rem)]"
            aria-hidden
          >
            {code}
          </span>
          <PixelArt
            rows={info.art}
            anim={shownCode}
            colours={info.colours}
            className={wide ? 'relative w-full max-w-xl [&>svg]:h-auto' : 'relative h-40 w-40 @3xl:h-60 @3xl:w-60'}
          />
        </div>

        <div className="flex flex-col items-center text-center @3xl:items-start @3xl:text-left">
          <p className="text-5xl font-bold leading-none tracking-widest tabular-nums theme-accent @3xl:text-6xl">{code}</p>
          <p className="mt-2 text-[11px] uppercase tracking-[0.3em] theme-text-muted">
            {known ? info.name : code >= 500 ? 'Server error' : 'Request error'}
          </p>
          <h2 className="mt-4 text-xl font-semibold @3xl:text-2xl">{info.title}</h2>
          <p className="mt-2 text-sm italic theme-text-muted">{info.myth}</p>
          <p className="text-sm italic theme-text-muted">{info.block}</p>

          <div className="mt-5 grid w-full gap-2.5 text-left @lg:grid-cols-2">
            <div className="rounded-xl border theme-border theme-card px-4 py-3">
              <p className="text-[11px] uppercase tracking-wider theme-text-muted">What happened</p>
              <p className="mt-1 text-sm leading-relaxed">{what ?? info.what}</p>
            </div>
            <div className="rounded-xl border theme-border theme-card px-4 py-3">
              <p className="text-[11px] uppercase tracking-wider theme-text-muted">What to try</p>
              <p className="mt-1 text-sm leading-relaxed">{fix ?? info.fix}</p>
            </div>
          </div>
          {detail && (
            <p className="mt-2.5 w-full break-words rounded-lg theme-surface px-3 py-2 text-left font-mono text-[11px] theme-text-muted">
              {detail}
            </p>
          )}

          {(onRetry && code !== 404) || onClose ? (
            <div className="mt-5 flex flex-wrap justify-center gap-2 @3xl:justify-start">
              {onRetry && code !== 404 && (
                <button
                  onClick={onRetry}
                  className="flex items-center gap-2 rounded-lg theme-bg-primary theme-text-on-primary px-4 py-2 text-sm font-medium transition-opacity hover:opacity-90"
                >
                  <RotateCw size={14} /> Try again
                </button>
              )}
              {onClose && (
                <button
                  onClick={onClose}
                  className="flex items-center gap-2 rounded-lg border theme-border px-4 py-2 text-sm transition-colors hover:theme-surface-strong"
                >
                  <X size={14} /> {closeLabel}
                </button>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
