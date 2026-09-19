import { Construction } from 'lucide-react'

/**
 * The honest empty state — MODULES.md §0 rule 4.
 *
 * All three glass-box modules depend on work that is not built, and each must
 * say *"nothing has been recorded yet, because X isn't wired"* rather than
 * rendering a plausible-looking empty view. A blank panel that looks broken is
 * worse than one that explains itself; a blank panel that looks *finished* is
 * worse than both, because it invites the reader to conclude the system knows
 * nothing rather than that this half has not been built.
 *
 * So the milestone is named on screen, not just in a comment.
 */
export function Unavailable({
  reason,
  blockedBy,
  action,
}: {
  reason: string
  blockedBy?: string
  action?: React.ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed theme-border px-6 py-12 text-center">
      <Construction size={22} className="theme-text-muted" />
      {blockedBy && (
        <span className="rounded-full border theme-accent-border px-2.5 py-0.5 text-[10px] uppercase tracking-wider theme-accent">
          blocked by {blockedBy}
        </span>
      )}
      <p className="max-w-md text-xs leading-relaxed theme-text-muted">{reason}</p>
      {action}
    </div>
  )
}
