import { useState } from 'react'
import { ChevronRight, ExternalLink } from 'lucide-react'
import { openThread, type TraceSummary } from '../../lib/threadClient'
import { Collapse } from '../ui/collapse'
import { STATUS, formatMs } from './status'
import { TraceView } from './TraceView'

/**
 * The collapsed line under a chat answer: `2 tools · 1.8s · grounded`
 * (MODULES.md §1.3 A). Expanding it shows that turn's thread in place, without
 * leaving the chat; the link opens it in the Thread window beside the others.
 */
export function TraceStrip({ trace }: { trace: TraceSummary }) {
  const [open, setOpen] = useState(false)
  const status = STATUS[trace.status]
  const parts = [
    trace.tool_count ? `${trace.tool_count} tool${trace.tool_count === 1 ? '' : 's'}` : null,
    formatMs(trace.latency_ms),
  ].filter(Boolean)

  return (
    <div className="mt-2">
      <div className="flex items-center gap-2 text-[11px] theme-text-muted">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex items-center gap-1 rounded px-1 -ml-1 hover:theme-text hover:theme-surface"
          title="How this answer was produced"
        >
          <ChevronRight size={11} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
          <span className="tabular-nums">{parts.join(' · ')}</span>
          <span>·</span>
          <span className={status.tone} title={status.hint}>{status.label}</span>
        </button>
        <button
          onClick={() => openThread(trace.query_id)}
          className="flex items-center gap-1 rounded px-1 opacity-0 group-hover:opacity-100 hover:theme-text transition-opacity"
          title="Open in Ariadne's Thread"
        >
          <ExternalLink size={10} /> Thread
        </button>
      </div>
      <Collapse open={open}>
        <div className="mt-2 rounded-lg border theme-border p-2.5">
          {open && <TraceView queryId={trace.query_id} compact />}
        </div>
      </Collapse>
    </div>
  )
}
