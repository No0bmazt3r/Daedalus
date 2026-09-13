import { useCallback, useEffect, useState } from 'react'
import { Database, HardDrive, Lock, RefreshCw, Sprout, AlertTriangle, Check } from 'lucide-react'

interface DatabaseInfo {
  id: string
  label: string
  engine: string
  access: string
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

  const card = `p-5 rounded-xl border theme-border transition-colors ${isPeek ? 'bg-transparent' : 'bg-black/10'}`

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-xl font-medium mb-1">Databases</h3>
          <p className="text-sm theme-text-muted">
            Daedalus keeps its stores physically separate — a fault in ingestion or
            logging cannot reach the sensor data of record.
          </p>
        </div>
        <button
          onClick={() => void load()}
          disabled={busy}
          className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border theme-border theme-text-muted hover:theme-text hover:bg-black/20 transition-colors disabled:opacity-50"
        >
          <RefreshCw size={12} className={busy ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-3 p-4 rounded-xl border border-red-500/30 bg-red-500/10 text-sm">
          <AlertTriangle size={16} className="text-red-400 shrink-0 mt-0.5" />
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
              <div className={`p-2.5 rounded-lg shrink-0 ${db.available ? 'bg-[color-mix(in_srgb,var(--primary)_16%,transparent)] theme-primary' : 'bg-black/20 theme-text-muted'}`}>
                {db.id === 'sensor' ? <HardDrive size={18} /> : <Database size={18} />}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">{db.label}</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded border theme-border theme-text-muted uppercase tracking-wide">
                    {db.engine}
                  </span>
                  {db.access === 'read-only' && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded border border-[var(--primary)]/40 theme-primary uppercase tracking-wide flex items-center gap-1">
                      <Lock size={9} /> read-only
                    </span>
                  )}
                </div>
                <p className="text-xs theme-text-muted mt-1">{db.purpose}</p>
                <code className="text-[10px] theme-text-muted opacity-60 break-all block mt-1.5">
                  {db.path}
                </code>
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0 text-xs">
              <span
                className={`w-2 h-2 rounded-full ${db.available ? 'theme-bg-primary' : 'bg-red-500'}`}
              />
              <span className="theme-text-muted">
                {db.available ? formatBytes(db.size_bytes) : 'unavailable'}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-1 @sm:grid-cols-2 @xl:grid-cols-3 gap-x-4 gap-y-2 pt-3 border-t theme-border">
            {Object.entries(db.metrics)
              .filter(([key]) => key !== 'error')
              .map(([key, value]) => (
                <div key={key} className="min-w-0">
                  <div className="text-[10px] uppercase tracking-wide theme-text-muted opacity-70 truncate">
                    {humanizeKey(key)}
                  </div>
                  <div className="text-sm font-mono truncate" title={String(value ?? '')}>
                    {formatMetric(value)}
                  </div>
                </div>
              ))}
          </div>

          {typeof db.metrics.error === 'string' && db.metrics.error && (
            <p className="mt-3 text-xs text-amber-400/90">{db.metrics.error}</p>
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
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg theme-bg-primary text-black hover:opacity-80 transition-opacity disabled:opacity-50"
              >
                <Sprout size={12} /> Generate demo data
              </button>
              {seedResult && (
                <p className="mt-2 text-xs theme-primary flex items-center gap-1.5">
                  <Check size={11} /> {seedResult}
                </p>
              )}
            </div>
          )}
        </div>
      ))}

      {!databases && !error && (
        <div className="text-sm theme-text-muted">Loading store status…</div>
      )}
    </div>
  )
}
