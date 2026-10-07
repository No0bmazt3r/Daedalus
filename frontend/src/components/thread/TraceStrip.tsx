import { ChevronRight, ExternalLink } from 'lucide-react'
import { openThread, type TraceSummary } from '../../lib/threadClient'
import { STATUS, formatMs } from './status'
import { StatusIcon } from './StatusIcon'

/**
 * The one line under a chat answer: `2 tools · 1.8s · grounded` (MODULES.md
 * §1.3 A). Clicking it shows the thread in the answer panel beside the chat,
 * so the transcript keeps its length; the link opens the Thread window.
 */
export function TraceStrip({
  trace, active, onOpen,
}: {
  trace: TraceSummary
  /** This answer's thread is what the panel is showing. */
  active: boolean
  onOpen: () => void
}) {
  const status = STATUS[trace.status]
  const parts = [
    trace.tool_count ? `${trace.tool_count} tool${trace.tool_count === 1 ? '' : 's'}` : null,
    formatMs(trace.latency_ms),
  ].filter(Boolean)

  return (
    <div className="mt-1.5 flex items-center gap-2 text-[11px] theme-text-muted">
      <button
        onClick={onOpen}
        aria-pressed={active}
        className={`-ml-1 flex items-center gap-1 rounded px-1 transition-colors hover:theme-text hover:theme-surface ${active ? 'theme-text theme-surface' : ''}`}
        title="How this answer was produced"
      >
        <ChevronRight size={11} />
        <span className="tabular-nums">{parts.join(' · ')}</span>
        <span>·</span>
        <StatusIcon status={trace.status} size={11} />
        <span className={status.tone}>{status.label.toLowerCase()}</span>
      </button>
      <button
        onClick={() => openThread(trace.query_id)}
        className="flex items-center gap-1 rounded px-1 opacity-0 transition-opacity hover:theme-text group-hover:opacity-100"
        title="Open in Ariadne's Thread"
      >
        <ExternalLink size={10} /> Thread
      </button>
    </div>
  )
}
