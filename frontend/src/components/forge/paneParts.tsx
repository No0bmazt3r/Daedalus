import { ArrowRight } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

/**
 * The pieces every Forge → Installed pane is built from, so the three panes
 * (local, embedding, cloud) cannot drift apart: each opens with a one-line
 * intro and a browse link, labels its sections the same way, and says "nothing
 * here" in the same box.
 */

/** One muted line saying what the pane is, with an optional action on the right. */
export function PaneIntro({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <p className="text-xs leading-relaxed theme-text-muted">{children}</p>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  )
}

/** "Browse chat models →" — the way out of a managing pane to a browsing tab. */
export function BrowseLink({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1 whitespace-nowrap text-[11px] theme-text-muted hover:theme-text transition-colors"
    >
      {children} <ArrowRight size={11} />
    </button>
  )
}

/** A small uppercase heading over a group of cards, with an optional count. */
export function SectionLabel({ icon: Icon, children, count, action }: {
  icon?: LucideIcon
  children: React.ReactNode
  count?: number
  action?: React.ReactNode
}) {
  return (
    <div className="flex items-center gap-2">
      {Icon && <Icon size={12} className="theme-text-muted shrink-0" />}
      <span className="text-[10px] uppercase tracking-wide theme-text-muted">
        {children}
        {count !== undefined && ` · ${count}`}
      </span>
      {action && <div className="ml-auto">{action}</div>}
    </div>
  )
}

/** The one empty state: a dashed box and a sentence. */
export function EmptyNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs theme-text-muted italic px-3 py-5 rounded-xl border border-dashed theme-border">
      {children}
    </p>
  )
}
