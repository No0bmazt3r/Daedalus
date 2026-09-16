/**
 * Loading placeholders that hold the shape of what is coming.
 *
 * A pane that is fetching and a pane that is genuinely empty render the same
 * blank rectangle, and the reader cannot tell which they are looking at. These
 * fill that gap: they occupy roughly the layout the real content will take, so
 * nothing jumps when the data lands and the difference between "loading" and
 * "nothing here" is visible without reading any text.
 *
 * Colour comes from `--text-main` mixed into transparency rather than a fixed
 * grey — see `.skeleton` in index.css for why.
 */

/** One shimmering block. Give it a size with `className`. */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div aria-hidden className={`skeleton ${className}`} />
}

/**
 * A run of text lines. The last is short, because a paragraph's final line
 * usually is, and a stack of equal bars reads as a table rather than prose.
 */
export function SkeletonText({ lines = 3, className = '' }: { lines?: number; className?: string }) {
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={`h-3 ${i === lines - 1 ? 'w-2/5' : i % 2 ? 'w-4/5' : 'w-full'}`}
        />
      ))}
    </div>
  )
}

/** A labelled figure, as used in the hardware and model stat grids. */
export function SkeletonStat() {
  return (
    <div className="space-y-1.5">
      <Skeleton className="h-2 w-16" />
      <Skeleton className="h-3.5 w-20" />
    </div>
  )
}

/**
 * A bordered card with a title row and a grid of figures — the shape both the
 * hardware panel and the model rows use.
 */
export function SkeletonCard({ stats = 4, className = '' }: { stats?: number; className?: string }) {
  return (
    <div className={`p-4 rounded-xl border theme-border theme-surface ${className}`}>
      <div className="flex items-center gap-2 mb-3">
        <Skeleton className="h-4 w-4 rounded" />
        <Skeleton className="h-3.5 w-28" />
        <Skeleton className="h-3 w-20 ml-auto" />
      </div>
      <div className="grid grid-cols-2 @lg:grid-cols-4 gap-x-4 gap-y-3">
        {Array.from({ length: stats }).map((_, i) => (
          <SkeletonStat key={i} />
        ))}
      </div>
    </div>
  )
}

/** A list row with a leading label, a couple of figures and trailing buttons. */
export function SkeletonRow() {
  return (
    <div className="flex items-start gap-3 p-3 rounded-xl border theme-border theme-surface">
      <Skeleton className="h-3 w-4 mt-1 shrink-0" />
      <div className="flex-1 min-w-0 space-y-2">
        <div className="flex items-center gap-2">
          <Skeleton className="h-3.5 w-32" />
          <Skeleton className="h-3 w-12 rounded" />
          <Skeleton className="h-3 w-16 rounded" />
        </div>
        <Skeleton className="h-2.5 w-40" />
        <div className="grid grid-cols-2 @lg:grid-cols-4 gap-x-4 gap-y-2 pt-1">
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonStat key={i} />
          ))}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <Skeleton className="h-6 w-6 rounded-lg" />
        <Skeleton className="h-6 w-6 rounded-lg" />
      </div>
    </div>
  )
}

/**
 * A list of rows, with a screen-reader announcement.
 *
 * `aria-busy` and the visually hidden label are the half of this that is not
 * decorative: the blocks say "loading" to anyone who can see them, and nothing
 * at all to anyone using a screen reader.
 */
export function SkeletonList({ rows = 3, label = 'Loading' }: { rows?: number; label?: string }) {
  return (
    <div className="space-y-2" role="status" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }).map((_, i) => (
        <SkeletonRow key={i} />
      ))}
    </div>
  )
}
