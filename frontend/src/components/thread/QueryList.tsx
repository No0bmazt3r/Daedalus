import { ChevronRight, Columns2, ListFilter, MessageSquare, Tag } from 'lucide-react'
import { type TraceChat, type TraceSummary } from '../../lib/threadClient'
import { type Group } from '../../lib/threadLogic'
import { Collapse } from '../ui/collapse'
import { chatLabel, formatMs } from './status'
import { StatusIcon } from './StatusIcon'

function when(ts: string): string {
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

/** A group's header: folds it, says which chat it is, and narrows the list to it. */
function ChatHeader({
  chat, count, open, onToggle, onFilter,
}: {
  chat: TraceChat | null
  count: number
  open: boolean
  onToggle: () => void
  onFilter: (() => void) | null
}) {
  const { title, note } = chatLabel(chat)
  return (
    <div className="group/header flex items-center gap-1 pt-2 pb-0.5">
      <button
        onClick={onToggle}
        aria-expanded={open}
        title={`${open ? 'Collapse' : 'Expand'} “${title}”${note ? `\n${note}` : ''}`}
        className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-1 text-left text-[10px] uppercase tracking-wider theme-text-muted hover:theme-text"
      >
        <ChevronRight size={11} className={`shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
        <MessageSquare size={11} className="shrink-0 theme-accent" />
        <span className="min-w-0 truncate">{title}</span>
        {/* An untitled deleted chat is already called "Deleted chat"; its id's
            tail tells two of them apart. */}
        {chat && !chat.exists && (
          <span className="shrink-0 normal-case tracking-normal opacity-70">
            · {chat.title ? 'deleted' : chat.session_id.slice(-4)}
          </span>
        )}
        {chat?.incognito && <span className="shrink-0 normal-case tracking-normal opacity-70">· incognito</span>}
        <span className="ml-auto shrink-0 rounded-full theme-surface px-1.5 tabular-nums tracking-normal">{count}</span>
      </button>
      {onFilter && (
        <button
          onClick={onFilter}
          className="shrink-0 rounded p-0.5 theme-text-muted opacity-0 transition-opacity hover:theme-text group-hover/header:opacity-100 focus-visible:opacity-100"
          aria-label={`Show only questions from “${title}”`}
          title={`Show only questions from “${title}”`}
        >
          <ListFilter size={11} />
        </button>
      )}
    </div>
  )
}

function QueryRow({
  t, selected, comparing, onSelect, onCompare,
}: {
  t: TraceSummary
  selected: boolean
  comparing: boolean
  onSelect: () => void
  onCompare: (() => void) | null
}) {
  return (
    <div className="group/row relative">
      <button
        data-qid={t.query_id}
        onClick={onSelect}
        aria-pressed={selected}
        className={`w-full rounded-md border px-2.5 py-1.5 text-left transition-colors ${
          selected ? 'theme-accent-border theme-surface-strong' : comparing ? 'border-dashed theme-accent-border' : 'theme-border hover:theme-surface'
        }`}
      >
        <span className="flex items-center gap-1.5">
          <span className="min-w-0 flex-1 truncate text-xs theme-text">{t.question || '(no text)'}</span>
          {t.label && (
            <Tag
              size={10}
              className={`shrink-0 ${t.label.hallucinated ? 'status-bad' : 'status-ok'}`}
              aria-label={t.label.hallucinated ? 'Labelled hallucinated' : 'Labelled correct'}
            />
          )}
        </span>
        {/* One line that gives way rather than widening the row: the
            status side truncates, the date keeps its width. */}
        <span className="mt-0.5 flex items-center gap-1.5 whitespace-nowrap text-[10px] theme-text-muted">
          <StatusIcon status={t.status} />
          <span className="min-w-0 truncate">
            <span className="tabular-nums">{formatMs(t.latency_ms)}</span>
            {t.tool_count > 0 && ` · ${t.tool_count} tool${t.tool_count === 1 ? '' : 's'}`}
          </span>
          <span className="ml-auto shrink-0">{when(t.timestamp)}</span>
        </span>
      </button>
      {onCompare && (
        <button
          onClick={onCompare}
          className="absolute right-1.5 top-1 rounded p-0.5 theme-text-muted opacity-0 transition-opacity theme-card hover:theme-text group-hover/row:opacity-100 focus-visible:opacity-100"
          aria-label="Compare with the open thread"
          title="Compare with the open thread"
        >
          <Columns2 size={11} />
        </button>
      )}
    </div>
  )
}

export function QueryList({
  groups, selected, compare, onSelect, onCompare, collapsed, onToggle, onFilterChat,
}: {
  groups: Group[]
  selected: string | null
  compare: string | null
  onSelect: (id: string) => void
  onCompare: (id: string) => void
  collapsed: Set<string>
  onToggle: (id: string) => void
  /** Absent once the list is already one chat's, where the headers would repeat the filter. */
  onFilterChat: ((chat: TraceChat) => void) | null
}) {
  return (
    <div>
      {groups.map((g) => {
        const open = !collapsed.has(g.id)
        return (
          <section key={g.key}>
            <ChatHeader
              chat={g.chat}
              count={g.items.length}
              open={open}
              onToggle={() => onToggle(g.id)}
              onFilter={onFilterChat && g.chat ? () => onFilterChat(g.chat!) : null}
            />
            <Collapse open={open}>
              <ul className="space-y-1">
                {g.items.map((t) => (
                  <li key={t.query_id}>
                    <QueryRow
                      t={t}
                      selected={t.query_id === selected}
                      comparing={t.query_id === compare}
                      onSelect={() => onSelect(t.query_id)}
                      onCompare={selected && t.query_id !== selected ? () => onCompare(t.query_id) : null}
                    />
                  </li>
                ))}
              </ul>
            </Collapse>
          </section>
        )
      })}
    </div>
  )
}
