import { useState } from 'react'
import { ChevronDown, Database, Lock, Network, Search } from 'lucide-react'
import { Collapse } from '../ui/collapse'
import type { AgentTool, ToolCatalogue } from '../../lib/toolsClient'

/**
 * Settings → Agent Tools → Simple.
 *
 * Only the tools that answer a chat question — the two sensor reads and the
 * selected track's retrieval — in plain words, read-only. No switches, no trial
 * runs, no capability chips: those are Advanced, where changing them is the
 * point. Here the question is only "what can the assistant do when I ask it
 * something?", and the answer is always this short list.
 *
 * The list comes from `catalogue.answering`, which the backend reads from the
 * planner, so this view cannot show a tool the chat path never calls. And it is
 * the whole truth while Simple is on: the registry refuses every other tool at
 * dispatch, and Advanced's per-tool switches are not consulted. A tool still
 * shows "off" with the reason if the gate refuses it for some other cause.
 */

/** Plain-language copy. The backend's `summary` stays the technical description. */
const PLAIN: Record<string, { title: string; does: string; usedFor: string; label: string }> = {
  get_live_reading: {
    title: 'Current or past reading',
    does: 'The latest value of a sensor, or the reading nearest a time you name. Says so when the feed has gone stale.',
    usedFor: '“What is the CO2 now?” · “What was the pressure at 10:30?”',
    label: 'S',
  },
  get_trend: {
    title: 'Statistics over time',
    does: 'Average, minimum, maximum, first or latest over a window, with where the peak fell.',
    usedFor: '“Average temperature over the last hour?”',
    label: 'S',
  },
  search_corpus: {
    title: 'Document search',
    does: 'The manual and SOP passages closest in meaning to the question.',
    usedFor: '“What should I do if the NDIR drifts?”',
    label: 'D',
  },
  graph_agent: {
    title: 'Knowledge graph agent',
    does: 'Starts from what the question names, then the local model chooses each step through the graph and stops when it has enough.',
    usedFor: '“Pressure and temperature both spiked. What do I do?”',
    label: 'G',
  },
  graph_walk: {
    title: 'Knowledge graph walk',
    does: 'Starts from the sensor or fault type the question names and follows the graph to the procedure and its steps.',
    usedFor: '“What should I do about high CO2?”',
    label: 'G',
  },
}

const TRACK_NAME = { vector: 'Vector RAG · Track 1', graph: 'Graph RAG · Track 2' } as const

function Row({ tool }: { tool: AgentTool }) {
  const [open, setOpen] = useState(false)
  const plain = PLAIN[tool.name]
  const on = tool.available && !tool.disabled
  const why = tool.disabled ? 'switched off in Advanced' : tool.refused_because ?? tool.blocked_by

  return (
    <div className="border-b theme-border last:border-b-0">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="w-full flex items-center gap-2.5 py-2 text-left hover:opacity-80 transition-opacity"
      >
        <span
          className={`h-1.5 w-1.5 rounded-full shrink-0 ${on ? 'bg-emerald-400' : 'bg-amber-400'}`}
          title={on ? 'Active, used when a question needs it' : `Off: ${why}`}
        />
        <span className="text-xs theme-text shrink-0">{plain?.title ?? tool.name}</span>
        <span className="text-[11px] theme-text-muted truncate flex-1">{plain?.does ?? tool.summary}</span>
        <span className={`text-[10px] shrink-0 ${on ? 'theme-text-muted' : 'status-warn'}`}>
          {on ? 'active' : 'off'}
        </span>
        <ChevronDown
          size={12}
          className={`shrink-0 theme-text-muted transition-transform ${open ? 'rotate-180' : '-rotate-90'}`}
        />
      </button>
      <Collapse open={open} className="pb-2.5 pl-4 space-y-1 text-[11px] theme-text-muted">
        {plain && <p>{plain.does}</p>}
        {plain && <p>Asked by questions like {plain.usedFor}</p>}
        {plain && (
          <p>
            Cited in answers as <code className="theme-text">[{plain.label}1]</code>,{' '}
            <code className="theme-text">[{plain.label}2]</code>…
          </p>
        )}
        {!on && why && <p className="status-warn">Off: {why}</p>}
        <p>
          Tool <code className="theme-text">{tool.name}</code> · reads only
        </p>
      </Collapse>
    </div>
  )
}

export function AgentToolsSimple({ catalogue, card }: { catalogue: ToolCatalogue; card: string }) {
  const answering = catalogue.answering
  if (!answering) {
    return <p className="text-xs theme-text-muted">The answering tools could not be read. Advanced shows every tool.</p>
  }

  const byName = new Map(catalogue.tools.map((t) => [t.name, t]))
  const sensor = answering.sensor.map((n) => byName.get(n)).filter((t): t is AgentTool => !!t)
  const retrieval = byName.get(answering.retrieval)
  const others = catalogue.tools.length - answering.tools.length
  const RetrievalIcon = answering.track === 'graph' ? Network : Search

  return (
    <div className="space-y-4">
      <div className={card}>
        <div className="flex items-center gap-2 mb-1">
          <Database size={13} className="theme-accent shrink-0" />
          <h4 className="text-xs font-medium theme-text">Read the reactor database</h4>
        </div>
        <p className="text-[11px] theme-text-muted mb-2">
          Every number in an answer comes from one of these, never from the model.
        </p>
        <div className="rounded-xl border theme-border px-3">
          {sensor.map((tool) => <Row key={tool.name} tool={tool} />)}
        </div>
      </div>

      <div className={card}>
        <div className="flex items-center gap-2 mb-1">
          <RetrievalIcon size={13} className="theme-accent shrink-0" />
          <h4 className="text-xs font-medium theme-text">Search the knowledge base</h4>
          <span className="text-[10px] px-1.5 py-0.5 rounded border theme-border theme-text-muted uppercase tracking-wide">
            {TRACK_NAME[answering.track]}
          </span>
        </div>
        <p className="text-[11px] theme-text-muted mb-2">
          Procedures and explanations. Only the selected track is used. You can change it in Settings → Retrieval Track.
        </p>
        <div className="rounded-xl border theme-border px-3">
          {retrieval ? <Row tool={retrieval} /> : (
            <p className="py-2 text-[11px] status-warn">{answering.retrieval} is not registered.</p>
          )}
        </div>
      </div>

      <p className="flex items-start gap-2 text-[11px] theme-text-muted leading-relaxed">
        <Lock size={12} className="shrink-0 mt-0.5" />
        These are the only tools that can run while Simple is on. The other {others} are blocked, no matter what
        Advanced&apos;s switches say. All of these only read: nothing here can change the reactor or its data,
        and a request to do so is refused before any tool runs. Switch to Advanced for the rest.
      </p>
    </div>
  )
}
