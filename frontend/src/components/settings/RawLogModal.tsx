import { useCallback, useEffect, useState, useMemo } from 'react'
import { X, RefreshCw, ChevronLeft, ChevronRight, Table2, EyeOff, ArrowDownUp, CircleDashed } from 'lucide-react'
import {
  logCatalogue,
  readLogTable,
  type LogPage,
  type LogStore,
} from '../../lib/systemClient'
import { useDraggable } from '../../hooks/useDraggable'

/**
 * Raw row viewer for the stores Daedalus owns.
 *
 * The audit trail is only useful if you can look at it. `trace(query_id)`
 * answers "prove this one response was grounded"; this answers "show me
 * everything that has been recorded right now".
 *
 * Read-only in the strict sense — the backend opens every connection
 * `mode=ro` and only serves tables on an allowlist, so this cannot reach
 * `model_endpoints` (API keys) or `sqlite_master`.
 */

const PAGE_SIZE = 50

function cellText(value: unknown): string {
  if (value === null || value === undefined) return '∅'
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

/** ISO timestamps are unreadable at a glance in a dense grid. */
function isTimestamp(column: string, value: unknown): boolean {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && /_at$|^timestamp$/.test(column)
}

export function RawLogModal({
  open,
  onClose,
  initialStore,
}: {
  open: boolean
  onClose: () => void
  initialStore?: string
}) {
  const [stores, setStores] = useState<LogStore[] | null>(null)
  const [active, setActive] = useState<{ store: string; table: string } | null>(null)
  const [page, setPage] = useState<LogPage | null>(null)
  const [offset, setOffset] = useState(0)
  const [newestFirst, setNewestFirst] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Record<string, unknown> | null>(null)
  const [isPeek, setIsPeek] = useState(false)

  const { position, onMouseDown, handleRef, windowRef } = useDraggable()

  const anchor = useMemo(() => {
    if (!open || typeof window === 'undefined') return { left: 0, top: 0 }
    const width = Math.min(1152, window.innerWidth * 0.95)
    const height = Math.min(750, window.innerHeight * 0.85)
    return {
      left: Math.max(8, (window.innerWidth - width) / 2),
      top: Math.max(8, (window.innerHeight - height) / 2),
    }
  }, [open])

  // Load the catalogue whenever the window opens, not once on mount — the
  // counts are the point, and they go stale the moment you use the app.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    setError(null)
    void (async () => {
      try {
        const loaded = await logCatalogue()
        if (cancelled) return
        setStores(loaded)
        const preferred = loaded.find((s) => s.store === initialStore) ?? loaded[0]
        if (preferred?.tables.length) {
          setActive({ store: preferred.store, table: preferred.tables[0].name })
          setOffset(0)
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'could not load the catalogue')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, initialStore])

  const load = useCallback(async () => {
    if (!active) return
    setBusy(true)
    try {
      setPage(await readLogTable(active.store, active.table, {
        limit: PAGE_SIZE,
        offset,
        newestFirst,
      }))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not read that table')
      setPage(null)
    } finally {
      setBusy(false)
    }
  }, [active, offset, newestFirst])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (expanded) setExpanded(null)
        else onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose, expanded])

  if (!open) return null

  const shown = page?.rows.length ?? 0
  const total = page?.total ?? 0
  const canPrev = offset > 0
  const canNext = offset + PAGE_SIZE < total

  return (
    <div className="fixed inset-0 z-[100] pointer-events-none">
      <div 
        className="fixed inset-0 bg-black/60 backdrop-blur-sm pointer-events-auto transition-opacity duration-300"
        style={{ opacity: isPeek ? 0 : 1 }}
        onClick={onClose}
      />
      <div
        ref={windowRef}
        style={{
          left: position.x || anchor.left,
          top: position.y || anchor.top,
          backgroundColor: isPeek
            ? 'color-mix(in srgb, var(--bg, #000) 55%, transparent)'
            : 'var(--bg)',
          backdropFilter: isPeek ? 'none' : undefined,
        }}
        className={`pointer-events-auto absolute resize overflow-hidden w-[1152px] h-[750px] min-w-[560px] min-h-[400px] max-w-[95vw] max-h-[90vh] flex flex-col theme-text theme-border border rounded-xl shadow-2xl transition-colors duration-300 ${isPeek ? 'border-white/20 shadow-none' : ''}`}
      >
        {/* Header */}
        <div
          ref={handleRef}
          onMouseDown={onMouseDown}
          className="flex items-center justify-between px-4 py-3 border-b theme-border cursor-move bg-black/10 select-none shrink-0"
          style={{ backgroundColor: isPeek ? 'transparent' : undefined }}
        >
          <div className="flex items-center gap-2 font-medium">
            <Table2 size={16} className="theme-primary" />
            Raw store contents
            <span className="text-xs theme-text-muted font-normal ml-1">read-only</span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => setIsPeek(!isPeek)}
              className={`flex items-center gap-1 px-2 py-1 rounded-md transition-colors text-xs font-medium border mr-2 ${
                isPeek
                  ? 'bg-primary/20 text-[var(--primary)] border-[var(--primary)]/30'
                  : 'theme-text-muted hover:theme-text border-transparent hover:bg-black/20'
              }`}
              title="Fade this window to preview the page behind it"
            >
              <CircleDashed size={14} className={isPeek ? 'animate-[spin_4s_linear_infinite]' : ''} />
              Peek
            </button>
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => void load()}
              disabled={busy}
              aria-label="Refresh"
              className="p-1.5 rounded-md theme-text-muted hover:theme-text hover:bg-black/20 disabled:opacity-40"
            >
              <RefreshCw size={15} className={busy ? 'animate-spin' : ''} />
            </button>
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={onClose}
              aria-label="Close"
              className="p-1.5 rounded-md theme-text-muted hover:theme-text hover:bg-black/20"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className={`flex flex-1 min-h-0 ${isPeek ? 'bg-transparent' : 'bg-black/5'}`}>
          {/* Table list */}
          <div className="w-56 shrink-0 border-r theme-border overflow-y-auto no-scrollbar p-2">
            {stores?.map((store) => (
              <div key={store.store} className="mb-3">
                <div className="px-2 py-1 text-[11px] font-medium theme-text-muted uppercase tracking-wide">
                  {store.label}
                </div>
                {store.tables.map((table) => {
                  const isActive = active?.store === store.store && active?.table === table.name
                  return (
                    <button
                      key={table.name}
                      onClick={() => {
                        setActive({ store: store.store, table: table.name })
                        setOffset(0)
                      }}
                      className={`w-full flex items-center justify-between px-2 py-1.5 rounded-md text-xs transition-colors ${
                        isActive ? 'bg-black/30 theme-text' : 'theme-text-muted hover:theme-text hover:bg-black/20'
                      }`}
                    >
                      <span className="truncate font-mono">{table.name}</span>
                      <span className="shrink-0 ml-2 tabular-nums opacity-70">
                        {table.rows ?? '—'}
                      </span>
                    </button>
                  )
                })}
              </div>
            ))}
            {!stores && !error && (
              <div className="px-2 py-1 text-xs theme-text-muted opacity-60">Loading…</div>
            )}
          </div>

          {/* Rows */}
          <div className="flex-1 flex flex-col min-w-0">
            <div className="flex items-center justify-between gap-3 px-4 py-2 border-b theme-border text-xs shrink-0">
              <div className="flex items-center gap-3 min-w-0">
                <span className="font-mono truncate">{active?.table ?? '—'}</span>
                <span className="theme-text-muted shrink-0">
                  {total > 0
                    ? `${offset + 1}–${offset + shown} of ${total.toLocaleString()}`
                    : 'no rows'}
                </span>
                {page?.redacted_columns?.length ? (
                  <span className="flex items-center gap-1 theme-text-muted shrink-0">
                    <EyeOff size={11} /> {page.redacted_columns.length} redacted
                  </span>
                ) : null}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => setNewestFirst((v) => !v)}
                  title={newestFirst ? 'Newest first' : 'Oldest first'}
                  className="flex items-center gap-1 px-2 py-1 rounded-md theme-text-muted hover:theme-text hover:bg-black/20"
                >
                  <ArrowDownUp size={12} />
                  {newestFirst ? 'Newest' : 'Oldest'}
                </button>
                <button
                  onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
                  disabled={!canPrev}
                  aria-label="Previous page"
                  className="p-1 rounded-md theme-text-muted hover:theme-text hover:bg-black/20 disabled:opacity-30"
                >
                  <ChevronLeft size={14} />
                </button>
                <button
                  onClick={() => setOffset((o) => o + PAGE_SIZE)}
                  disabled={!canNext}
                  aria-label="Next page"
                  className="p-1 rounded-md theme-text-muted hover:theme-text hover:bg-black/20 disabled:opacity-30"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-auto">
              {error && <div className="p-4 text-sm text-amber-400/90">{error}</div>}

              {!error && page && page.rows.length === 0 && (
                <div className="p-8 text-center text-sm theme-text-muted opacity-70">
                  This table is empty.
                </div>
              )}

              {!error && page && page.rows.length > 0 && (
                <table className="w-full text-xs border-collapse">
                  <thead className="sticky top-0 theme-card">
                    <tr className="border-b theme-border">
                      {page.columns.map((col) => (
                        <th
                          key={col}
                          className="text-left font-medium px-3 py-2 whitespace-nowrap theme-text-muted"
                        >
                          {col}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {page.rows.map((row, i) => (
                      <tr
                        key={i}
                        onClick={() => setExpanded(row)}
                        className="border-b theme-border/40 hover:bg-black/20 cursor-pointer"
                      >
                        {page.columns.map((col) => {
                          const text = cellText(row[col])
                          return (
                            <td
                              key={col}
                              title={text}
                              className={`px-3 py-1.5 align-top max-w-[22rem] truncate font-mono ${
                                row[col] === null ? 'opacity-30' : ''
                              }`}
                            >
                              {isTimestamp(col, row[col])
                                ? text.replace('T', ' ').slice(0, 19)
                                : text}
                            </td>
                          )
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>

        {/* One row, in full. A transcript or a stack trace is unreadable in a
            truncated cell, and widening the column would ruin every other. */}
        {expanded && (
          <div
            className="absolute inset-0 z-10 flex items-center justify-center p-8 bg-black/70"
            onClick={() => setExpanded(null)}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-2xl max-h-[70vh] overflow-y-auto theme-card theme-border border rounded-xl p-5 shadow-2xl"
            >
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-medium">Row detail</span>
                <button
                  onClick={() => setExpanded(null)}
                  aria-label="Close row detail"
                  className="p-1 rounded-md theme-text-muted hover:theme-text hover:bg-black/20"
                >
                  <X size={14} />
                </button>
              </div>
              <dl className="space-y-2">
                {Object.entries(expanded).map(([key, value]) => (
                  <div key={key} className="grid grid-cols-[10rem_1fr] gap-3 text-xs">
                    <dt className="theme-text-muted font-mono truncate">{key}</dt>
                    <dd className="font-mono whitespace-pre-wrap break-words">
                      {value === null ? <span className="opacity-30">∅</span> : cellText(value)}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
