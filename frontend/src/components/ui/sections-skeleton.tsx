import type { LucideIcon } from 'lucide-react'
import { Skeleton } from './skeleton'

/**
 * A settings page while its data loads: the real section headings, which are
 * fixed text and can show straight away, with placeholders only where the
 * controls will go. Same card shape as the loaded page, so nothing jumps.
 */
export function SectionsSkeleton({ sections }: { sections: { icon?: LucideIcon; title: string }[] }) {
  return (
    <div className="space-y-4" role="status" aria-busy="true" aria-label="Loading settings">
      {sections.map(({ icon: Icon, title }) => (
        <section key={title} className="space-y-2 rounded-lg border theme-border p-4">
          <h4 className="flex items-center gap-1.5 text-sm theme-text">
            {Icon && <Icon size={14} className="theme-text-muted" />} {title}
          </h4>
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-2/3" />
          <Skeleton className="mt-1 h-8 w-1/2" />
        </section>
      ))}
    </div>
  )
}
