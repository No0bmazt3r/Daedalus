import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import {
  ChevronRight, ChevronsDownUp, ChevronsUpDown, Columns2, ListFilter, MessageSquare, Network,
  RefreshCw, Search, SlidersHorizontal, Tag, X,
} from 'lucide-react'
import {
  fetchTraces,
  type TraceBucket, type TraceChat, type TraceFilters, type TracePage, type TraceStatus, type TraceSummary,
} from '../../lib/threadClient'
import { groupByChat, share, stepSelection, type Group } from '../../lib/threadLogic'
import { useLiveRefresh } from '../../hooks/useLiveRefresh'
import { FloatingWindow } from '../ui/floating-window'
import { Collapse } from '../ui/collapse'
import { ThemeSelect } from '../ui/theme-select'
import { statusOf } from '../errors/ErrorPage'
import { TabError } from '../errors/TabError'
import { Skeleton } from '../ui/skeleton'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip'
import { BUCKET_FILL, FILTERS, STATUS, chatLabel, formatMs } from './status'
import { StatusIcon } from './StatusIcon'
import { TraceView } from './TraceView'

/**
 * Ariadne's Thread — the provenance workspace. MODULES.md §1.
 *
 * Recent questions on the left, the chosen one's thread on the right. It must
 * never become a nicer table browser (§0.2): Data stores already shows the
 * rows. What only this can show is the join across the seven tables, the order
 * of the steps, the verdict on every number, and — since the evaluation needs
 * it — a person's label on each answer.
 *
 * - The bucket filters and their names come from Settings → Ariadne's Thread.
 * - The strip above the list counts every turn the filters match, not the page.
 * - ↑/↓ move through the list when it has focus; folded chats are skipped.
 * - Compare (the columns icon on a row) puts a second thread beside the first.
 * - It re-reads by itself when a chat turn finishes or a label is saved.
 */

const PAGE = 50

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
          title="Compare with the open thread"
        >
          <Columns2 size={11} />
        </button>
      )}
    </div>
  )
}

function QueryList({
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

/** Figures over every turn the filters match — the evaluation's numbers, live. */
function SummaryStrip({ page }: { page: TracePage }) {
  const { stats, labels } = page
  if (!stats.total) return null
  const buckets: TraceBucket[] = ['grounded', 'ungrounded', 'unchecked']
  return (
    <div className="space-y-3 rounded-lg border theme-border theme-card px-3 py-3">
      {/* Gaps between segments, so a thin one still reads as its own colour. */}
      <div className="flex h-2 gap-0.5 overflow-hidden rounded-full">
        {buckets.map((b) => {
          const n = stats.by_bucket[b] ?? 0
          return n ? (
            <span
              key={b}
              className={`rounded-full ${BUCKET_FILL[b]}`}
              style={{ width: `${(n / stats.total) * 100}%` }}
              title={`${labels[b]}: ${n} of ${stats.total} (${share(n, stats.total)}%)`}
            />
          ) : null
        })}
      </div>
      <ul className="space-y-1.5 text-[11px]">
        {buckets.map((b) => (
          <li key={b} className="flex items-center gap-2" title={`${share(stats.by_bucket[b] ?? 0, stats.total)}% of ${stats.total}`}>
            <span className={`h-2 w-2 shrink-0 rounded-full ${BUCKET_FILL[b]}`} />
            <span className="min-w-0 flex-1 truncate theme-text-muted">{labels[b]}</span>
            <span className="tabular-nums theme-text">{stats.by_bucket[b] ?? 0}</span>
          </li>
        ))}
      </ul>
      <div className="grid grid-cols-2 gap-2 border-t theme-border pt-2.5 text-[11px]">
        <div title="Median and 95th-percentile time for the whole turn, as the operator waited">
          <p className="text-[10px] uppercase tracking-wider theme-text-muted">Time p50 · p95</p>
          <p className="mt-0.5 tabular-nums theme-text">
            {formatMs(stats.latency_p50_ms)} <span className="theme-text-muted">·</span> {formatMs(stats.latency_p95_ms)}
          </p>
        </div>
        <div title="Answers a person has labelled; the evaluation's ground truth">
          <p className="flex items-center gap-1 text-[10px] uppercase tracking-wider theme-text-muted">
            <Tag size={9} /> Labelled
          </p>
          <p className="mt-0.5 tabular-nums theme-text">
            {stats.labelled}<span className="theme-text-muted"> / {stats.total}</span>
            {stats.hallucinated > 0 && <span className="status-bad"> · {stats.hallucinated} hallucinated</span>}
          </p>
        </div>
      </div>
    </div>
  )
}

type Extra = { track: '' | 'vector' | 'graph'; model: string; labelled: '' | 'yes' | 'no'; since: string; until: string }
const NO_EXTRA: Extra = { track: '', model: '', labelled: '', since: '', until: '' }

/** Track, model, label and dates — folded away until wanted. */
function MoreFilters({ value, onChange, models }: { value: Extra; onChange: (v: Extra) => void; models: string[] }) {
  const input = 'h-7 w-full rounded-md border theme-border bg-transparent px-2 text-[11px] theme-text outline-none'
  return (
    <div className="grid grid-cols-2 gap-1.5 rounded-md border theme-border p-2">
      <ThemeSelect
        size="sm"
        ariaLabel="Track"
        value={value.track || 'any'}
        onChange={(v) => onChange({ ...value, track: v === 'any' ? '' : (v as Extra['track']) })}
        options={[{ value: 'any', label: 'Any track' }, { value: 'vector', label: 'Vector RAG' }, { value: 'graph', label: 'Graph RAG' }]}
      />
      <ThemeSelect
        size="sm"
        ariaLabel="Label"
        value={value.labelled || 'any'}
        onChange={(v) => onChange({ ...value, labelled: v === 'any' ? '' : (v as Extra['labelled']) })}
        options={[{ value: 'any', label: 'Labelled or not' }, { value: 'yes', label: 'Labelled' }, { value: 'no', label: 'Not labelled' }]}
      />
      <ThemeSelect
        size="sm"
        ariaLabel="Model"
        className="col-span-2"
        value={value.model || 'any'}
        onChange={(v) => onChange({ ...value, model: v === 'any' ? '' : v })}
        options={[{ value: 'any', label: 'Any model' }, ...models.map((m) => ({ value: m, label: m }))]}
      />
      <label className="text-[10px] theme-text-muted">
        From
        <input type="date" value={value.since} onChange={(e) => onChange({ ...value, since: e.target.value })} className={input} />
      </label>
      <label className="text-[10px] theme-text-muted">
        To
        <input type="date" value={value.until} onChange={(e) => onChange({ ...value, until: e.target.value })} className={input} />
      </label>
      {JSON.stringify(value) !== JSON.stringify(NO_EXTRA) && (
        <button onClick={() => onChange(NO_EXTRA)} className="col-span-2 text-left text-[10px] theme-text-muted hover:theme-text">
          Clear these filters
        </button>
      )}
    </div>
  )
}

/** The day after `date` (YYYY-MM-DD), as the exclusive end of a "To" day. */
function dayAfter(date: string): string {
  const d = new Date(`${date}T00:00:00`)
  d.setDate(d.getDate() + 1)
  return d.toISOString()
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
  const [bucket, setBucket] = useState<TraceBucket | 'all'>('all')
  const [search, setSearch] = useState('')
  const [extra, setExtra] = useState<Extra>(NO_EXTRA)
  const [showExtra, setShowExtra] = useState(false)
  // One chat's questions only, picked from a chat header in the list.
  const [chat, setChat] = useState<TraceChat | null>(null)
  // Chats folded away, by session id. Everything starts open.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const toggleGroup = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (!next.delete(id)) next.add(id)
      return next
    })
  }, [])
  const [page, setPage] = useState<TracePage | null>(null)
  const [items, setItems] = useState<TraceSummary[] | null>(null)
  const [error, setError] = useState<{ message: string; status: number } | null>(null)
  const [selected, setSelected] = useState<string | null>(requestedQueryId)
  const [compare, setCompare] = useState<string | null>(null)
  const [lastRequested, setLastRequested] = useState(requestedQueryId)
  const listRef = useRef<HTMLDivElement>(null)
  // Every model seen so far, for the model filter — kept as the list narrows.
  const [models, setModels] = useState<string[]>([])

  // A new request from a chat answer wins over whatever was selected. Derived
  // during render, the documented pattern for state that follows a prop.
  if (requestedQueryId !== lastRequested) {
    setLastRequested(requestedQueryId)
    if (requestedQueryId) setSelected(requestedQueryId)
  }

  const extraCount = Object.values(extra).filter(Boolean).length

  /** Read `limit` rows from `offset`; a refresh asks for everything already loaded. */
  const load = useCallback((offset: number, limit = PAGE) => {
    const filters: TraceFilters = {
      limit, offset,
      bucket: bucket === 'all' ? undefined : bucket,
      session_id: chat?.session_id,
      q: search.trim() || undefined,
      track: extra.track || undefined,
      model: extra.model || undefined,
      labelled: extra.labelled || undefined,
      since: extra.since ? new Date(`${extra.since}T00:00:00`).toISOString() : undefined,
      until: extra.until ? dayAfter(extra.until) : undefined,
    }
    return fetchTraces(filters)
      .then((p) => {
        setError(null)
        setPage(p)
        setItems((prev) => (offset && prev ? [...prev, ...p.items] : p.items))
        setModels((prev) => [...new Set([...prev, ...p.items.map((t) => t.model).filter((m): m is string => !!m)])].sort())
        if (!offset) setSelected((s) => s ?? p.items[0]?.query_id ?? null)
      })
      .catch((e: Error) => setError({ message: e.message, status: statusOf(e) ?? 500 }))
  }, [bucket, search, chat, extra])

  // Re-read on every open and whenever a filter changes; typing waits a beat.
  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => void load(0), search ? 250 : 0)
    return () => window.clearTimeout(timer)
  }, [open, load, search])

  // A finished chat turn, a saved label or new settings: re-read what is loaded.
  const loaded = items?.length ?? 0
  useLiveRefresh(['trace'], () => {
    if (open) void load(0, Math.min(500, Math.max(PAGE, loaded)))
  })

  const groups = useMemo(() => groupByChat(items ?? []), [items])
  const allCollapsed = groups.length > 0 && groups.every((g) => collapsed.has(g.id))
  // An answer asked for from a chat must be visible, so its group opens.
  const selectedGroup = groups.find((g) => g.items.some((t) => t.query_id === selected))?.id
  const [revealed, setRevealed] = useState<string | null>(null)
  if (requestedQueryId && selected === requestedQueryId && selectedGroup && revealed !== requestedQueryId) {
    setRevealed(requestedQueryId)
    if (collapsed.has(selectedGroup)) toggleGroup(selectedGroup)
  }

  // Keep the selected row in view as ↑/↓ move it.
  useEffect(() => {
    listRef.current?.querySelector(`[data-qid="${selected}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  const onListKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    setSelected((s) => stepSelection(groups, collapsed, s, e.key === 'ArrowDown' ? 1 : -1))
  }

  const labels = page?.labels
  const filterHint = (id: TraceBucket) => {
    const held = (Object.entries(page?.buckets ?? {}) as [TraceStatus, TraceBucket][])
      .filter(([, b]) => b === id).map(([s]) => STATUS[s].label)
    return held.length ? `Holds: ${held.join(', ')}` : 'Nothing is filed here (Settings → Ariadne\'s Thread)'
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
      {/* The list cannot be read: the whole window becomes the error page. */}
      {error ? (
        <TabError
          code={error.status}
          detail={error.message}
          what="Ariadne's Thread could not read the list of questions from the audit log."
          onRetry={() => void load(0)}
          onClose={onClose}
          closeLabel="Close the Thread"
        />
      ) : (
      <div className="grid h-full min-h-0 grid-cols-[18rem_1fr]">
        <aside className="flex min-h-0 min-w-0 flex-col gap-2 border-r theme-border p-3">
          <div className="flex items-center gap-1">
            <label className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md border theme-border px-2">
              <Search size={12} className="shrink-0 theme-text-muted" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search questions or ids"
                className="h-8 w-full bg-transparent text-xs theme-text outline-none placeholder:opacity-50"
              />
            </label>
            <button
              onClick={() => setShowExtra((v) => !v)}
              aria-expanded={showExtra}
              className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-md border ${
                showExtra || extraCount ? 'theme-accent-border theme-text' : 'theme-border theme-text-muted hover:theme-text'
              }`}
              title="Track, model, label and date filters"
            >
              <SlidersHorizontal size={13} />
              {extraCount > 0 && (
                <span className="absolute -right-1 -top-1 rounded-full theme-bg-primary px-1 text-[9px] leading-[14px] theme-text-on-primary">
                  {extraCount}
                </span>
              )}
            </button>
          </div>
          <Collapse open={showExtra} variant="flow">
            <MoreFilters value={extra} onChange={setExtra} models={models} />
          </Collapse>
          {/* Icons in their verdict's colour, the name Settings gives each, and
              what it holds on hover. */}
          <div className="grid grid-cols-2 gap-1">
            {FILTERS.map((f) => {
              const active = bucket === f.id
              const label = f.id === 'all' ? f.label : labels?.[f.id] ?? f.label
              return (
                <Tooltip key={f.id}>
                  <TooltipTrigger
                    render={
                      <button
                        onClick={() => setBucket(f.id)}
                        aria-pressed={active}
                        aria-label={label}
                        className={`flex h-7 items-center gap-1.5 rounded-md border px-2 text-[11px] transition-colors ${
                          active ? 'theme-accent-border theme-surface-strong' : 'theme-border opacity-60 hover:opacity-100 hover:theme-surface'
                        }`}
                      />
                    }
                  >
                    <f.icon size={13} className={`shrink-0 ${f.tone}`} />
                    <span className={`truncate ${active ? 'theme-text' : 'theme-text-muted'}`}>{label}</span>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="flex-col items-start gap-0.5">
                    <span className="font-medium">{label}</span>
                    <span className="opacity-80">{f.id === 'all' ? f.hint : filterHint(f.id)}</span>
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
          {page && <SummaryStrip page={page} />}
          <div
            ref={listRef}
            tabIndex={0}
            onKeyDown={onListKey}
            aria-label="Questions. Up and down arrows move the selection."
            className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden no-scrollbar rounded-md outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)]"
          >
            {items === null ? (
              <Skeleton className="h-40 w-full" />
            ) : items.length === 0 ? (
              <p className="my-auto text-center text-xs leading-relaxed theme-text-muted">
                {search || bucket !== 'all' || extraCount || chat
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
                  compare={compare}
                  onSelect={setSelected}
                  onCompare={setCompare}
                  collapsed={collapsed}
                  onToggle={toggleGroup}
                  onFilterChat={chat ? null : setChat}
                />
                {page && items.length < page.total && (
                  <button
                    onClick={() => void load(items.length)}
                    className="mt-2 w-full rounded-md border theme-border py-1 text-[11px] theme-text-muted hover:theme-text"
                  >
                    Load more ({page.total - items.length} left)
                  </button>
                )}
              </>
            )}
          </div>
        </aside>
        {/* `my-auto` centres a short trace (or the empty state) in the pane;
            a long one has no spare height, so it starts at the top and scrolls. */}
        <div className="flex min-h-0 min-w-0 flex-col overflow-y-auto overflow-x-hidden no-scrollbar p-4">
          {compare && selected && compare !== selected ? (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-[11px] theme-text-muted">
                <Columns2 size={12} className="theme-accent" />
                Comparing two threads side by side
                <button
                  onClick={() => setCompare(null)}
                  className="ml-auto flex items-center gap-1 rounded px-1.5 py-0.5 hover:theme-text hover:theme-surface"
                >
                  <X size={11} /> Stop comparing
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <TraceView queryId={selected} onDismiss={() => setSelected(null)} />
                <TraceView queryId={compare} onDismiss={() => setCompare(null)} />
              </div>
            </div>
          ) : (
            <div className="my-auto">
              {selected ? (
                <TraceView queryId={selected} onDismiss={() => setSelected(null)} />
              ) : (
                <p className="text-center text-xs theme-text-muted">Pick a question to follow its thread.</p>
              )}
            </div>
          )}
        </div>
      </div>
      )}
      </TooltipProvider>
    </FloatingWindow>
  )
}
