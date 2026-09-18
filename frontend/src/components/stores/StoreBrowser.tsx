import { useCallback, useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, RefreshCw, X, ArrowDownUp, Table2 } from 'lucide-react'
import { Skeleton } from '../ui/skeleton'
import { readLogTable, type LogPage } from '../../lib/systemClient'

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
 *
 * This is the pane body only. It fills whatever it is given and carries no
 * window chrome of its own: browsing rows is navigation, so it renders in the
 * main content area from a route, the way a chat does — not in a modal
 * floating over one.
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

export function StoreBrowser({ store, table }: { store: string; table: string }) {
  const [page, setPage] = useState<LogPage | null>(null)
  const [offset, setOffset] = useState(0)
  const [newestFirst, setNewestFirst] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Record<string, unknown> | null>(null)

  // Landing on a different table must not keep the previous one's page offset,
  // or a small table opens on an empty page.
  useEffect(() => {
    setOffset(0)
    setExpanded(null)
  }, [store, table])

  const load = useCallback(async (silent = false) => {
    if (!silent) setBusy(true)
    try {
      setPage(await readLogTable(store, table, { limit: PAGE_SIZE, offset, newestFirst }))
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not read that table')
      setPage(null)
    } finally {
      if (!silent) setBusy(false)
    }
  }, [store, table, offset, newestFirst])

  useEffect(() => {
    void load()
  }, [load])

  // Auto-refresh the first page so it feels live.
  useEffect(() => {
    if (offset !== 0) return
    const timer = setInterval(() => void load(true), 2000)
    return () => clearInterval(timer)
  }, [offset, load])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && expanded) setExpanded(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [expanded])

  const shown = page?.rows.length ?? 0
  const total = page?.total ?? 0
  const canPrev = offset > 0
  const canNext = offset + PAGE_SIZE < total

  return (
    <div className="relative flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b theme-border text-xs shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <Table2 size={14} className="theme-accent shrink-0" />
          <span className="font-mono truncate">
            <span className="theme-text-muted">{store}</span>
            <span className="theme-text-muted mx-1">/</span>
            {table}
          </span>
          <span className="text-[10px] px-1.5 py-0.5 rounded border theme-border theme-text-muted uppercase tracking-wide shrink-0">
            read-only
          </span>
          <span className="theme-text-muted shrink-0">
            {total > 0
              ? `${offset + 1}–${offset + shown} of ${total.toLocaleString()}`
              : 'no rows'}
          </span>

          {page?.redacted_columns?.length ? (
            <span 
              className="text-[10px] px-1.5 py-0.5 rounded border theme-border status-warn uppercase tracking-wide shrink-0"
              title={`Secret values hidden in: ${page.redacted_columns.join(', ')}`}
            >
              Masked
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => setNewestFirst((v) => !v)}
            title={newestFirst ? 'Newest first' : 'Oldest first'}
            className="flex items-center gap-1 px-2 py-1 rounded-md theme-text-muted hover:theme-text hover:bg-[color-mix(in_srgb,var(--text-main)_9%,transparent)]"
          >
            <ArrowDownUp size={12} />
            {newestFirst ? 'Newest' : 'Oldest'}
          </button>
          <button
            onClick={() => void load()}
            disabled={busy}
            aria-label="Refresh"
            className="p-1.5 rounded-md theme-text-muted hover:theme-text hover:bg-[color-mix(in_srgb,var(--text-main)_9%,transparent)] disabled:opacity-40"
          >
            <RefreshCw size={14} className={busy ? 'animate-spin' : ''} />
          </button>
          <button
            onClick={() => setOffset((o) => Math.max(0, o - PAGE_SIZE))}
            disabled={!canPrev}
            aria-label="Previous page"
            className="p-1 rounded-md theme-text-muted hover:theme-text hover:bg-[color-mix(in_srgb,var(--text-main)_9%,transparent)] disabled:opacity-30"
          >
            <ChevronLeft size={14} />
          </button>
          <button
            onClick={() => setOffset((o) => o + PAGE_SIZE)}
            disabled={!canNext}
            aria-label="Next page"
            className="p-1 rounded-md theme-text-muted hover:theme-text hover:bg-[color-mix(in_srgb,var(--text-main)_9%,transparent)] disabled:opacity-30"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      </div>

      {/* Rows */}
      <div className="flex-1 overflow-auto min-h-0">
        {error && <div className="p-4 text-sm status-warn">{error}</div>}

        {/* A null page rendered nothing, so opening a table looked like an
            empty table until the rows arrived. */}
        {!error && !page && (
          <div className="p-4 space-y-2" role="status" aria-busy="true" aria-live="polite">
            <span className="sr-only">Loading rows</span>
            <Skeleton className="h-6 w-full" />
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-4 w-full" />
            ))}
          </div>
        )}

        {!error && page && page.rows.length === 0 && (
          <div className="p-8 text-center text-sm theme-text-muted">
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
                  className="border-b theme-border/40 hover:bg-[color-mix(in_srgb,var(--text-main)_9%,transparent)] cursor-pointer"
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
                className="p-1 rounded-md theme-text-muted hover:theme-text hover:bg-[color-mix(in_srgb,var(--text-main)_9%,transparent)]"
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
  )
}
