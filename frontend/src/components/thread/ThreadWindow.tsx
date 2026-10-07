import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronRight, ChevronsDownUp, ChevronsUpDown, ListFilter, MessageSquare, Network, RefreshCw, Search, X } from 'lucide-react'
import { fetchTraces, type TraceChat, type TraceFilters, type TraceSummary } from '../../lib/threadClient'
import { FloatingWindow } from '../ui/floating-window'
import { Collapse } from '../ui/collapse'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip'
import { Skeleton } from '../ui/skeleton'
import { FILTERS, chatLabel, formatMs } from './status'
import { StatusIcon } from './StatusIcon'
import { TraceView } from './TraceView'

/**
 * Ariadne's Thread — the provenance workspace. MODULES.md §1.
 *
 * Recent questions on the left, the chosen one's thread on the right. It must
 * never become a nicer table browser (§0.2): Data stores already shows the
 * rows. What only this can show is the join across the seven tables, the order
 * of the steps, and the verdict on every number.
 */

const PAGE = 50

function when(ts: string): string {
  const d = new Date(ts)
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

/** Consecutive questions from one chat — the list's unit, under one header. */
// `id` is the chat, what a fold is remembered by, so a new question in a folded
// chat leaves it folded; `key` is only for React, since a chat can recur further down.
type Group = { key: string; id: string; chat: TraceChat | null; items: TraceSummary[] }

function groupByChat(items: TraceSummary[]): Group[] {
  const groups: Group[] = []
  for (const t of items) {
    const last = groups[groups.length - 1]
    if (last && last.items[0].session_id === t.session_id) last.items.push(t)
    else groups.push({ key: `${t.session_id ?? 'none'}:${t.query_id}`, id: t.session_id ?? 'none', chat: t.chat, items: [t] })
  }
  return groups
}

/** A group's header: collapses it, says which chat it is, and narrows the list to it. */
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
        {note && chat?.exists && <span className="shrink-0 normal-case tracking-normal opacity-70">· incognito</span>}
        <span className="ml-auto shrink-0 rounded-full theme-surface px-1.5 tabular-nums tracking-normal">{count}</span>
      </button>
      {onFilter && (
        <button
          onClick={onFilter}
          className="shrink-0 rounded p-0.5 theme-text-muted opacity-0 transition-opacity hover:theme-text group-hover/header:opacity-100 focus-visible:opacity-100"
          title={`Show only questions from “${title}”`}
        >
          <ListFilter size={11} />
        </button>
      )}
    </div>
  )
}

function QueryRow({ t, selected, onSelect }: { t: TraceSummary; selected: boolean; onSelect: () => void }) {
  return (
    <button
      onClick={onSelect}
      className={`w-full rounded-md border px-2.5 py-1.5 text-left transition-colors ${
        selected ? 'theme-accent-border theme-surface-strong' : 'theme-border hover:theme-surface'
      }`}
    >
      <span className="block truncate text-xs theme-text">{t.question || '(no text)'}</span>
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
  )
}

function QueryList({
  groups, selected, onSelect, collapsed, onToggle, onFilterChat,
}: {
  groups: Group[]
  selected: string | null
  onSelect: (id: string) => void
  collapsed: Set<string>
  onToggle: (key: string) => void
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
                    <QueryRow t={t} selected={t.query_id === selected} onSelect={() => onSelect(t.query_id)} />
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

export function ThreadWindow({
  open,
  onClose,
  requestedQueryId,
}: {
  open: boolean
  onClose: () => void
  /** An answer to show, from the strip under a chat reply. */
  requestedQueryId: string | null
}) {
  const [grounded, setGrounded] = useState<TraceFilters['grounded'] | 'all'>('all')
  const [search, setSearch] = useState('')
  // One chat's questions only, picked from a chat header in the list.
  const [chat, setChat] = useState<TraceChat | null>(null)
  // Chats folded away, by session id. Everything starts open.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const toggleGroup = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (!next.delete(key)) next.add(key)
      return next
    })
  }, [])
  const [items, setItems] = useState<TraceSummary[] | null>(null)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(requestedQueryId)
  const [lastRequested, setLastRequested] = useState(requestedQueryId)

  // A new request from a chat answer wins over whatever was selected. Derived
  // during render, the documented pattern for state that follows a prop.
  if (requestedQueryId !== lastRequested) {
    setLastRequested(requestedQueryId)
    if (requestedQueryId) setSelected(requestedQueryId)
  }

  const load = useCallback((offset: number) => {
    const filters: TraceFilters = {
      limit: PAGE, offset,
      grounded: grounded === 'all' ? undefined : grounded,
      session_id: chat?.session_id,
      q: search.trim() || undefined,
    }
    return fetchTraces(filters)
      .then((page) => {
        setError(null)
        setTotal(page.total)
        setItems((prev) => (offset && prev ? [...prev, ...page.items] : page.items))
        if (!offset) setSelected((s) => s ?? page.items[0]?.query_id ?? null)
      })
      .catch((e: Error) => setError(e.message))
  }, [grounded, search, chat])

  // Re-read on every open and whenever a filter changes; typing waits a beat.
  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => void load(0), search ? 250 : 0)
    return () => window.clearTimeout(timer)
  }, [open, load, search])

  const groups = useMemo(() => groupByChat(items ?? []), [items])
  const allCollapsed = groups.length > 0 && groups.every((g) => collapsed.has(g.id))
  // An answer asked for from a chat must be visible, so its group opens.
  const selectedGroup = groups.find((g) => g.items.some((t) => t.query_id === selected))?.id
  const [revealed, setRevealed] = useState<string | null>(null)
  if (requestedQueryId && selected === requestedQueryId && selectedGroup && revealed !== requestedQueryId) {
    setRevealed(requestedQueryId)
    if (collapsed.has(selectedGroup)) toggleGroup(selectedGroup)
  }

  return (
    <FloatingWindow
      id="thread"
      open={open}
      onClose={onClose}
      title="Ariadne's Thread"
      subtitle="How each answer was produced, and whether its numbers came from the evidence"
      icon={<Network size={16} className="theme-accent" />}
      width={1152}
      height={750}
      headerActions={() => (
        <button
          onClick={() => void load(0)}
          className="rounded-md p-1.5 theme-text-muted hover:theme-text hover:theme-surface"
          title="Refresh"
        >
          <RefreshCw size={14} />
        </button>
      )}
    >
      <TooltipProvider delay={200}>
      <div className="grid h-full min-h-0 grid-cols-[18rem_1fr]">
        <aside className="flex min-h-0 min-w-0 flex-col gap-2 border-r theme-border p-3">
          <label className="flex items-center gap-1.5 rounded-md border theme-border px-2">
            <Search size={12} className="theme-text-muted" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search questions or ids"
              className="h-8 w-full bg-transparent text-xs theme-text outline-none placeholder:opacity-50"
            />
          </label>
          {/* Icons in their verdict's colour, the name and meaning on hover —
              one row at any width, where four worded chips wrapped to two. */}
          <div className="grid grid-cols-2 gap-1">
            {FILTERS.map((f) => {
              const active = grounded === f.id
              return (
                <Tooltip key={f.id}>
                  <TooltipTrigger
                    render={
                      <button
                        onClick={() => setGrounded(f.id)}
                        aria-pressed={active}
                        aria-label={f.label}
                        className={`flex h-7 items-center gap-1.5 rounded-md border px-2 text-[11px] transition-colors ${
                          active ? 'theme-accent-border theme-surface-strong' : 'theme-border opacity-60 hover:opacity-100 hover:theme-surface'
                        }`}
                      />
                    }
                  >
                    <f.icon size={13} className={`shrink-0 ${f.tone}`} />
                    <span className={`truncate ${active ? 'theme-text' : 'theme-text-muted'}`}>{f.label}</span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="flex-col items-start gap-0.5">
                    <span className="font-medium">{f.label}</span>
                    <span className="opacity-80">{f.hint}</span>
                  </TooltipContent>
                </Tooltip>
              )
            })}
          </div>
          {chat && (
            <div className="flex items-center gap-1.5 rounded-md border theme-accent-border theme-surface px-2 py-1 text-[11px] theme-text">
              <MessageSquare size={11} className="shrink-0 theme-accent" />
              <span className="min-w-0 flex-1 truncate" title={`Only questions from “${chatLabel(chat).title}”`}>
                {chatLabel(chat).title}
              </span>
              <button
                onClick={() => setChat(null)}
                className="shrink-0 rounded p-0.5 theme-text-muted hover:theme-text"
                title="Show every chat again"
              >
                <X size={11} />
              </button>
            </div>
          )}
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden no-scrollbar">
            {error ? (
              <p className="my-auto text-center text-xs status-bad">Could not load the questions: {error}</p>
            ) : items === null ? (
              <Skeleton className="h-40 w-full" />
            ) : items.length === 0 ? (
              <p className="my-auto text-center text-xs leading-relaxed theme-text-muted">
                {search || grounded !== 'all'
                  ? 'No question matches these filters.'
                  : 'No questions yet. Ask something in a chat and its thread appears here.'}
              </p>
            ) : (
              <>
                {groups.length > 1 && (
                  <button
                    onClick={() => setCollapsed(allCollapsed ? new Set() : new Set(groups.map((g) => g.id)))}
                    className="flex w-full items-center justify-end gap-1 px-1 text-[10px] theme-text-muted hover:theme-text"
                  >
                    {allCollapsed ? <ChevronsUpDown size={11} /> : <ChevronsDownUp size={11} />}
                    {allCollapsed ? 'Expand all' : 'Collapse all'}
                  </button>
                )}
                <QueryList
                  groups={groups}
                  selected={selected}
                  onSelect={setSelected}
                  collapsed={collapsed}
                  onToggle={toggleGroup}
                  onFilterChat={chat ? null : setChat}
                />
                {items.length < total && (
                  <button
                    onClick={() => void load(items.length)}
                    className="mt-2 w-full rounded-md border theme-border py-1 text-[11px] theme-text-muted hover:theme-text"
                  >
                    Load more ({total - items.length} left)
                  </button>
                )}
              </>
            )}
          </div>
        </aside>
        {/* `my-auto` centres a short trace (or the empty state) in the pane;
            a long one has no spare height, so it starts at the top and scrolls. */}
        <div className="flex min-h-0 min-w-0 flex-col overflow-y-auto overflow-x-hidden no-scrollbar p-4">
          <div className="my-auto">
            {selected ? (
              <TraceView queryId={selected} />
            ) : (
              <p className="text-center text-xs theme-text-muted">Pick a question to follow its thread.</p>
            )}
          </div>
        </div>
      </div>
      </TooltipProvider>
    </FloatingWindow>
  )
}
