import { useCallback, useEffect, useState } from 'react'
import { Network, RefreshCw, Search } from 'lucide-react'
import { fetchTraces, type TraceFilters, type TraceSummary } from '../../lib/threadClient'
import { FloatingWindow } from '../ui/floating-window'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../ui/tooltip'
import { Skeleton } from '../ui/skeleton'
import { FILTERS, formatMs } from './status'
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

function QueryList({
  items, selected, onSelect,
}: {
  items: TraceSummary[]
  selected: string | null
  onSelect: (id: string) => void
}) {
  return (
    <ul className="space-y-1">
      {items.map((t) => (
        <li key={t.query_id}>
          <button
            onClick={() => onSelect(t.query_id)}
            className={`w-full rounded-md border px-2.5 py-1.5 text-left transition-colors ${
              t.query_id === selected ? 'theme-accent-border theme-surface-strong' : 'theme-border hover:theme-surface'
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
        </li>
      ))}
    </ul>
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
  }, [grounded, search])

  // Re-read on every open and whenever a filter changes; typing waits a beat.
  useEffect(() => {
    if (!open) return
    const timer = window.setTimeout(() => void load(0), search ? 250 : 0)
    return () => window.clearTimeout(timer)
  }, [open, load, search])

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
          <div className="grid grid-cols-4 gap-1">
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
                        className={`flex h-7 items-center justify-center rounded-md border transition-colors ${
                          active ? 'theme-accent-border theme-surface-strong' : 'theme-border opacity-60 hover:opacity-100 hover:theme-surface'
                        }`}
                      />
                    }
                  >
                    <f.icon size={14} className={f.tone} />
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="flex-col items-start gap-0.5">
                    <span className="font-medium">{f.label}</span>
                    <span className="opacity-80">{f.hint}</span>
                  </TooltipContent>
                </Tooltip>
              )
            })}
          </div>
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
                <QueryList items={items} selected={selected} onSelect={setSelected} />
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
