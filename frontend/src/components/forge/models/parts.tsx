

export function Pill({ children, title, tone = 'muted' }: {
  children: React.ReactNode; title?: string; tone?: 'muted' | 'warn' | 'ok'
}) {
  const toneClass =
    tone === 'warn' ? 'status-warn status-warn-border'
      : tone === 'ok' ? 'status-ok status-ok-border'
        : 'theme-border theme-text-muted'
  return (
    <span
      title={title}
      className={`text-[10px] px-1.5 py-0.5 rounded border uppercase tracking-wide shrink-0 ${toneClass}`}
    >
      {children}
    </span>
  )
}

/** One labelled number in the detail panel. */
export function Fact({ label, value, hint, mono = true }: {
  label: string; value: React.ReactNode; hint?: string; mono?: boolean
}) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <span className="text-[11px] theme-text-muted shrink-0" title={hint}>
        {label}
      </span>
      <span className={`text-[11px] ${mono ? 'font-mono tabular-nums' : ''} text-right`}>
        {value}
      </span>
    </div>
  )
}

/** A 0–100 dimension with its weight, so a composite can be taken apart. */
export function Dimension({ label, value, weight }: { label: string; value: number; weight: number }) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      <span className="text-[11px] theme-text-muted w-14 shrink-0 capitalize">{label}</span>
      <div className="h-1.5 rounded-full theme-track overflow-hidden flex-1 min-w-0">
        <div className="h-full rounded-full theme-bg-primary" style={{ width: `${value}%` }} />
      </div>
      <span className="text-[11px] font-mono tabular-nums w-20 text-right shrink-0 whitespace-nowrap">
        {value.toFixed(0)}
        <span className="theme-text-muted"> ×{weight.toFixed(2)}</span>
      </span>
    </div>
  )
}

export function Section({ title, children, right }: {
  title: string; children: React.ReactNode; right?: React.ReactNode
}) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 mb-1.5">
        <span className="text-[10px] uppercase tracking-widest theme-text-muted">
          {title}
        </span>
        {right}
      </div>
      {children}
    </div>
  )
}
