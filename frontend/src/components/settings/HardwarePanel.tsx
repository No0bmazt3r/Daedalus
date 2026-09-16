import { Cpu } from 'lucide-react'
import { HardwareView } from '../forge/HardwareView'

/**
 * Settings → Hardware. The detection half of the Forge, where you go to *check*
 * the machine rather than to act on it.
 *
 * Same component the Forge window renders, so the two can never quote different
 * numbers — which matters, because one of them ends up in the report.
 */
export function HardwarePanel({ isPeek }: { isPeek: boolean }) {
  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <div>
        <h3 className="text-xl font-medium mb-1 flex items-center gap-2">
          <Cpu size={18} className="theme-accent" />
          Hardware
        </h3>
        <p className="text-sm theme-text-muted">
          What this machine is, kept current by the backend rather than re-scanned
          each time you open this panel. Step 1 of the model-fit workflow —
          estimating, scoring and benchmarking models against it lives in{' '}
          <span className="theme-text">The Forge</span>, in the sidebar.
        </p>
      </div>
      <HardwareView isPeek={isPeek} />
    </div>
  )
}
