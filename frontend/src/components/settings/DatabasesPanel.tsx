import { useCallback, useEffect, useState } from 'react'
import { Database, HardDrive, Lock, RefreshCw, Sprout, AlertTriangle, Check, ExternalLink, Activity } from 'lucide-react'
import { observability, type Observability } from '../../lib/systemClient'
import { SkeletonCard } from '../ui/skeleton'

/**
 * Store health, and nothing else.
 *
 * This panel used to browse raw rows too. It doesn't any more: that moved to
 * the sidebar, next to the chat history, because looking at rows is something
 * you do constantly and Settings is somewhere you go occasionally. What is
 * left here is the question this panel is actually for — is every store
 * healthy — plus the way out to the metrics stack when one isn't.
 */

interface DatabaseInfo {
  id: string
  label: string
  engine: string
  access: string
  deployment: string
  purpose: string
  path: string
  size_bytes: number | null
  available: boolean
  metrics: Record<string, unknown>
}

function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes === undefined) return '—'
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(1)} ${units[unit]}`
}

function formatMetric(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (typeof value === 'number') return value.toLocaleString()
  const text = String(value)
  // ISO timestamps are unreadable at a glance in a metrics grid.
  if (/^\d{4}-\d{2}-\d{2}T/.test(text)) return text.replace('T', ' ').slice(0, 19)
  return text
}

function humanizeKey(key: string): string {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export function DatabasesPanel({ isPeek }: { isPeek: boolean }) {
  const [databases, setDatabases] = useState<DatabaseInfo[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [seedResult, setSeedResult] = useState<string | null>(null)
  const [obs, setObs] = useState<Observability | null>(null)

  const load = useCallback(async () => {
    setBusy(true)
    try {
      const res = await fetch('/api/system/databases')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = (await res.json()) as { databases: DatabaseInfo[] }
      setDatabases(data.databases)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'request failed')
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Independent of the store health call: whether the metrics stack is
  // configured has nothing to do with whether the databases are up, and a
  // failure to answer should not blank the panel.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const found = await observability()
        if (!cancelled) setObs(found)
      } catch {
        if (!cancelled) setObs({ url: '', configured: false })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const seed = useCallback(async () => {
    setBusy(true)
    setSeedResult(null)
    try {
      const res = await fetch('/api/system/seed-demo', { method: 'POST' })
      const data = (await res.json()) as { rows_inserted?: number; note?: string; detail?: string }
      setSeedResult(res.ok ? `${data.note} (${data.rows_inserted ?? 0} rows)` : data.detail || 'failed')
      await load()
    } catch (e) {
      setSeedResult(e instanceof Error ? e.message : 'request failed')
    } finally {
      setBusy(false)
    }
  }, [load])

  const card = `p-5 rounded-xl border theme-border transition-colors ${isPeek ? 'bg-transparent' : 'theme-surface'}`

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-xl font-medium mb-1">Databases</h3>
          <p className="text-sm theme-text-muted">
            Daedalus keeps its stores physically separate — a fault in ingestion or
            logging cannot reach the sensor data of record.
          </p>
          <p className="text-xs theme-text-muted mt-2">
            Only the vector store runs as a container. The SQLite stores are
            embedded files the backend opens directly, so there is no server to
            run for them.
          </p>
          <p className="text-xs theme-text-muted mt-2">
            This panel reports health. To read the rows, use{' '}
            <span className="theme-text">Data stores</span> in the sidebar.
          </p>
        </div>
        <div className="shrink-0 flex items-center gap-2">
          <button
            onClick={() => void load()}
            disabled={busy}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border theme-border theme-text-muted hover:theme-text hover:bg-[color-mix(in_srgb,var(--text-main)_9%,transparent)] transition-colors disabled:opacity-40"
          >
            <RefreshCw size={12} className={busy ? 'animate-spin' : ''} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-3 p-4 rounded-xl border status-bad-border status-bad-bg text-sm">
          <AlertTriangle size={16} className="status-bad shrink-0 mt-0.5" />
          <div>
            <div className="font-medium">Couldn't reach the backend</div>
            <div className="theme-text-muted text-xs mt-1">{error}</div>
          </div>
        </div>
      )}

      {databases?.map((db) => (
        <div key={db.id} className={card}>
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="flex items-start gap-3 min-w-0">
              <div className={`p-2.5 rounded-lg shrink-0 ${db.available ? 'bg-[color-mix(in_srgb,var(--primary)_16%,transparent)] theme-accent' : 'theme-surface-strong theme-text-muted'}`}>
                {db.id === 'sensor' ? <HardDrive size={18} /> : <Database size={18} />}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">{db.label}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded border theme-border theme-text-muted uppercase tracking-wide">
                    {db.engine}
                  </span>
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded border theme-border theme-text-muted uppercase tracking-wide"
                    title={
                      db.deployment === 'service'
                        ? 'Runs as its own container'
                        : 'A file opened directly by the backend — no server process'
                    }
                  >
                    {db.deployment}
                  </span>
                  {db.access === 'read-only' && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--primary)]/40 theme-accent uppercase tracking-wide flex items-center gap-1">
                      <Lock size={9} /> read-only
                    </span>
                  )}
                </div>
                <p className="text-xs theme-text-muted mt-1">{db.purpose}</p>
                <code className="text-[10px] theme-text-muted break-all block mt-1.5">
                  {db.path}
                </code>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0 text-xs">
              {/* Spelled out rather than left as a coloured dot — "is this
                  healthy" is the one question this panel exists to answer, and
                  a dot makes the reader infer it. */}
              <span
                className={`flex items-center gap-1.5 px-2 py-1 rounded-md border ${
                  db.available
                    ? 'border-[var(--primary)]/40 theme-accent'
                    : 'status-bad-border status-bad'
                }`}
              >
                <span
                  className={`w-1.5 h-1.5 rounded-full ${db.available ? 'theme-bg-primary' : 'status-bad-fill'}`}
                />
                {db.available ? 'Healthy' : 'Not healthy'}
              </span>
              <span className="theme-text-muted">
                {db.available ? formatBytes(db.size_bytes) : '—'}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 @sm:grid-cols-2 @xl:grid-cols-3 gap-x-4 gap-y-2 pt-3 border-t theme-border">
            {Object.entries(db.metrics)
              .filter(([key]) => key !== 'error')
              .map(([key, value]) => (
                <div key={key} className="min-w-0">
                  <div className="text-[10px] uppercase tracking-wide theme-text-muted truncate">
                    {humanizeKey(key)}
                  </div>
                  <div className="text-sm font-mono truncate" title={String(value ?? '')}>
                    {formatMetric(value)}
                  </div>
                </div>
              ))}
          </div>

          {typeof db.metrics.error === 'string' && db.metrics.error && (
            <p className="mt-3 text-xs status-warn">{db.metrics.error}</p>
          )}

          {db.id === 'sensor' && !db.available && (
            <div className="mt-4 pt-3 border-t theme-border">
              <p className="text-xs theme-text-muted mb-2">
                No telemetry yet. In production the SCADA ingestion subsystem writes
                this database; for offline development you can generate a demo run.
              </p>
              <button
                onClick={() => void seed()}
                disabled={busy}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg theme-bg-primary theme-text-on-primary hover:opacity-80 transition-opacity disabled:opacity-50"
              >
                <Sprout size={12} /> Generate demo data
              </button>
              {seedResult && (
                <p className="mt-2 text-xs theme-accent flex items-center gap-1.5">
                  <Check size={11} /> {seedResult}
                </p>
              )}
            </div>
          )}
        </div>
      ))}

      {!databases && !error && (
        <div className="space-y-3" role="status" aria-busy="true" aria-live="polite">
          <span className="sr-only">Loading store status</span>
          {/* Five, because there are always exactly five stores. */}
          {Array.from({ length: 5 }).map((_, i) => (
            <SkeletonCard key={i} stats={3} />
          ))}
        </div>
      )}

      {/* Always present, whether or not anything is failing. A link that only
          appears during an outage is a link nobody knows exists. */}
      <div className={card}>
        <div className="flex items-start gap-3">
          <div className="p-2.5 rounded-lg shrink-0 theme-surface-strong theme-text-muted">
            <Activity size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-medium">Metrics &amp; container logs</div>
            <p className="text-xs theme-text-muted mt-1">
              This panel says <em>whether</em> a store is healthy. The metrics
              stack — Prometheus, Grafana, and the container logs — is where you
              find out <em>why</em> it isn't.
            </p>
            {obs?.configured ? (
              <a
                href={obs.url}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1.5 mt-3 px-3 py-1.5 text-xs rounded-lg border theme-border theme-text-muted hover:theme-text hover:bg-[color-mix(in_srgb,var(--text-main)_9%,transparent)] transition-colors"
              >
                <ExternalLink size={12} />
                Open metrics &amp; logs
              </a>
            ) : (
              <p className="text-xs theme-text-muted mt-3">
                Not configured. Set <code className="theme-text">DAEDALUS_OBSERVABILITY_URL</code>{' '}
                in <code className="theme-text">.env</code> once the stack is running — see
                M7 in <code className="theme-text">TODO.md</code>.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
