import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, Network, RotateCcw, ShieldCheck, Tags } from 'lucide-react'
import {
  fetchThreadSettings, saveThreadSettings,
  type ThreadSettings, type ThreadSettingsPatch, type TraceBucket, type TraceStatus,
} from '../../lib/threadClient'
import { Switch } from '../ui/switch'
import { Skeleton } from '../ui/skeleton'
import { ThemeSelect } from '../ui/theme-select'
import { FILTERS, STATUS } from '../thread/status'
import { statusOf } from '../errors/ErrorPage'
import { TabError } from '../errors/TabError'

/**
 * Settings → Ariadne's Thread: how the Thread labels a turn.
 *
 * Three things to play with — what "grounded" requires, which of the three
 * buckets each of the six statuses is filed under, and what the buckets are
 * called. None of it touches the stored record, the validator or an
 * evaluation run (`services/thread_settings.py`), so it stays editable while
 * the comparison is frozen, and an open Thread window follows each change.
 */

const STATUS_ORDER: TraceStatus[] = ['grounded', 'ungrounded', 'blocked', 'refused', 'no_model', 'error']
const BUCKET_ORDER: TraceBucket[] = ['grounded', 'ungrounded', 'unchecked']
const BUCKET_FILTER = Object.fromEntries(FILTERS.map((f) => [f.id, f]))

const inputClass =
  'w-full rounded-lg border theme-border theme-surface-strong theme-text px-2.5 py-1.5 text-xs outline-none focus:ring-1 focus:ring-[var(--primary)] disabled:opacity-50'

export function ThreadPanel(_props: { isPeek?: boolean }) {
  const [state, setState] = useState<{ settings: ThreadSettings; defaults: ThreadSettings } | null>(null)
  // A rejected save (a 422 on a name) is a line here; settings that cannot be
  // read at all turn the panel into the error page.
  const [error, setError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<{ message: string; status: number } | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [saving, setSaving] = useState(false)
  // Bucket names are typed, so they save on blur rather than per keystroke.
  const [names, setNames] = useState<Record<TraceBucket, string> | null>(null)

  const apply = useCallback((s: { settings: ThreadSettings; defaults: ThreadSettings }) => {
    setState(s)
    setNames(s.settings.labels)
  }, [])

  useEffect(() => {
    fetchThreadSettings()
      .then((s) => { setLoadError(null); apply(s) })
      .catch((e: Error) => setLoadError({ message: e.message, status: statusOf(e) ?? 500 }))
  }, [apply, attempt])

  const save = (patch: ThreadSettingsPatch) => {
    setSaving(true)
    setError(null)
    saveThreadSettings(patch)
      .then(apply)
      .catch((e: Error) => setError(e.message))
      .finally(() => setSaving(false))
  }

  if (loadError) {
    return (
      <TabError
        code={loadError.status}
        detail={loadError.message}
        what="The Ariadne's Thread settings could not be read."
        onRetry={() => { setLoadError(null); setAttempt((n) => n + 1) }}
      />
    )
  }
  if (!state || !names) return <Skeleton className="h-64 w-full" />
  const { settings, defaults } = state
  const isDefault = JSON.stringify(settings) === JSON.stringify(defaults)

  return (
    <div className="space-y-4">
      {error && <ErrorNote message={error} />}

      <section className="space-y-2 rounded-lg border theme-border p-4">
        <div className="flex items-center justify-between gap-2">
          <h4 className="flex items-center gap-1.5 text-sm theme-text">
            <Network size={14} className="theme-text-muted" /> How the Thread labels an answer
          </h4>
          <button
            onClick={() => save({ reset: true })}
            disabled={saving || isDefault}
            className="flex items-center gap-1 rounded-lg border theme-border px-2.5 py-1 text-[11px] theme-text-muted hover:theme-text disabled:opacity-40"
          >
            <RotateCcw size={11} /> Reset to defaults
          </button>
        </div>
        <p className="text-[11px] leading-relaxed theme-text-muted">
          Changes how Ariadne's Thread files and names each answer, and nothing else. The stored record,
          the answer checks and any evaluation run are untouched, so this stays editable while the
          comparison is frozen, and an open Thread window updates as you change it.
        </p>
      </section>

      <section className="space-y-3 rounded-lg border theme-border p-4">
        <h4 className="flex items-center gap-1.5 text-sm theme-text">
          <ShieldCheck size={14} className="status-ok" /> What counts as grounded
        </h4>
        <p className="text-[11px] leading-relaxed theme-text-muted">
          An answer that passed every check is <b>grounded</b> when it meets both of these, and
          <b> not grounded</b> otherwise. Both on is the validator's own definition.
        </p>
        <Row
          title="It must cite its evidence"
          hint="Off: a passed answer is grounded even if it cites nothing, e.g. a correct ‘no data’ reply."
        >
          <Switch
            checked={settings.require_citation}
            disabled={saving}
            onChange={(v) => save({ require_citation: v })}
            label="It must cite its evidence"
          />
        </Row>
        <Row
          title="It must have had evidence"
          hint="At least one tool returned something. Off: an answer to a question no tool could serve still counts."
        >
          <Switch
            checked={settings.require_evidence}
            disabled={saving}
            onChange={(v) => save({ require_evidence: v })}
            label="It must have had evidence"
          />
        </Row>
      </section>

      <section className="space-y-3 rounded-lg border theme-border p-4">
        <h4 className="flex items-center gap-1.5 text-sm theme-text">
          <Tags size={14} className="theme-text-muted" /> Where each outcome is filed
        </h4>
        <p className="text-[11px] leading-relaxed theme-text-muted">
          Every answer ends in one of six outcomes. Each is filed under one of the three filters in the
          Thread's list, and counted under it in the summary strip.
        </p>
        <div className="divide-y theme-border rounded-lg border theme-border">
          {STATUS_ORDER.map((status) => {
            const s = STATUS[status]
            const changed = settings.buckets[status] !== defaults.buckets[status]
            return (
              <div key={status} className="flex items-center gap-3 px-3 py-2">
                <s.icon size={14} className={`shrink-0 ${s.tone}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-xs theme-text">
                    {s.label}
                    {changed && <span className="ml-1.5 text-[10px] status-warn">changed</span>}
                  </p>
                  <p className="text-[10px] leading-snug theme-text-muted">{s.hint}</p>
                </div>
                <ThemeSelect
                  size="sm"
                  ariaLabel={`File ${s.label} under`}
                  value={settings.buckets[status]}
                  onChange={(bucket) => save({ buckets: { [status]: bucket } })}
                  options={BUCKET_ORDER.map((b) => ({ value: b, label: settings.labels[b] }))}
                  className={`w-40 shrink-0 ${saving ? 'pointer-events-none opacity-60' : ''}`}
                />
              </div>
            )
          })}
        </div>
      </section>

      <section className="space-y-3 rounded-lg border theme-border p-4">
        <h4 className="flex items-center gap-1.5 text-sm theme-text">
          <Tags size={14} className="theme-text-muted" /> What the filters are called
        </h4>
        <p className="text-[11px] leading-relaxed theme-text-muted">
          The names on the Thread's filters and summary strip. Up to 24 characters; empty goes back to
          the default.
        </p>
        <div className="grid gap-2 sm:grid-cols-3">
          {BUCKET_ORDER.map((b) => {
            const f = BUCKET_FILTER[b]
            return (
              <label key={b} className="space-y-1">
                <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider theme-text-muted">
                  <f.icon size={11} className={f.tone} /> {defaults.labels[b]}
                </span>
                <input
                  value={names[b]}
                  maxLength={24}
                  disabled={saving}
                  onChange={(e) => setNames({ ...names, [b]: e.target.value })}
                  onBlur={() => {
                    const next = names[b].trim()
                    if (next !== settings.labels[b]) save({ labels: { [b]: next || null } })
                  }}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                  className={inputClass}
                />
              </label>
            )
          })}
        </div>
      </section>
    </div>
  )
}

function Row({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <p className="text-xs theme-text">{title}</p>
        <p className="text-[10px] leading-snug theme-text-muted">{hint}</p>
      </div>
      {children}
    </div>
  )
}

function ErrorNote({ message }: { message: string }) {
  return (
    <p className="flex items-start gap-1.5 text-xs status-bad">
      <AlertCircle size={13} className="mt-0.5 shrink-0" /> {message}
    </p>
  )
}
