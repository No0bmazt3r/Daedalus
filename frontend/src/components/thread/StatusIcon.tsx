import type { TraceStatus } from '../../lib/threadClient'
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip'
import { STATUS } from './status'

/** A turn's status as its icon, with the label and what it means on hover. */
export function StatusIcon({ status, size = 12 }: { status: TraceStatus; size?: number }) {
  const s = STATUS[status]
  return (
    <Tooltip>
      <TooltipTrigger
        render={<span className={`inline-flex shrink-0 items-center ${s.tone}`} aria-label={s.label} />}
      >
        <s.icon size={size} />
      </TooltipTrigger>
      <TooltipContent side="top" className="flex-col items-start gap-0.5">
        <span className="font-medium">{s.label}</span>
        <span className="opacity-80">{s.hint}</span>
      </TooltipContent>
    </Tooltip>
  )
}
