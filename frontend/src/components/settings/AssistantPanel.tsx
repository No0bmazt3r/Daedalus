import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, Clock, Lock, MessageSquareText, Plus, ShieldAlert, X } from 'lucide-react'
import {
  browserTimezone,
  fetchAssistant,
  saveAssistant,
  type AssistantPatch,
  type AssistantStatus,
  type RefusalKind,
} from '../../lib/assistantClient'
import { Skeleton } from '../ui/skeleton'
import { ThemeSelect } from '../ui/theme-select'
import { useConfirm } from '../ui/confirm-dialog'

/**
 * Settings → Assistant — what the assistant is told, and when it says no.
 *
 * Three things, all read by the backend on every question, so a change applies
 * to the next message without a restart:
 *
 * - **Date and time.** Which clock "this morning" and "at 10:00" mean.
 *   Auto-detected from this browser, or picked by hand.
 * - **System prompt.** The rules the model answers under. Replace it here, or
 *   reset it to the built-in default.
 * - **Safety.** The built-in refusals are fixed, and shown so you can see what
 *   they cover. Their wording can change, and extra blocked phrases can be
 *   added, but nothing here can switch a built-in rule off.
 */

const SOURCE_LABEL: Record<AssistantStatus['timezone_source'], string> = {
  manual: 'picked by hand',
  env: 'set by DAEDALUS_TZ in .env',
  browser: 'detected from this browser',
  machine: "this machine's clock",
}

const REFUSAL_LABEL: Record<RefusalKind, string> = {
  control: 'Reply when asked to control the reactor',
  data: 'Reply when asked to change data',
  override: 'Reply when asked to ignore its rules',
  custom: 'Reply when a blocked phrase is used',
}

// Every zone the browser knows, labelled with its current UTC offset so the
// list can be searched by city ("kuala") or by offset ("+8").
function offset(zone: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' })
      .formatToParts(new Date()).find((p) => p.type === 'timeZoneName')?.value ?? ''
  } catch {
    return ''
  }
}
const ZONE_OPTIONS = (
  (Intl as unknown as { supportedValuesOf?: (key: string) => string[] }).supportedValuesOf?.('timeZone') ?? []
).map((z) => ({ value: z, label: `${z.replace(/_/g, ' ')} (${offset(z)})` }))

const inputClass =
  'w-full rounded-lg border theme-border theme-surface-strong theme-text px-2.5 py-1.5 text-xs outline-none focus:ring-1 focus:ring-[var(--primary)] disabled:opacity-50'

function useClock(timeZone: string) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(id)
  }, [])
  try {
    return now.toLocaleString(undefined, { timeZone, dateStyle: 'full', timeStyle: 'medium' })
  } catch {
    return now.toLocaleString()
  }
}

export function AssistantPanel(_props: { isPeek?: boolean }) {
  const [status, setStatus] = useState<AssistantStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirm, confirmDialog] = useConfirm()

  const load = useCallback(() => {
    fetchAssistant()
      .then((s) => { setStatus(s); setError(null) })
      .catch((e: Error) => setError(e.message))
  }, [])
  useEffect(load, [load])

  const save = async (patch: AssistantPatch) => {
    setSaving(true)
    setError(null)
    try {
      setStatus(await saveAssistant(patch))
      return true
    } catch (e) {
      setError((e as Error).message)
      return false
    } finally {
      setSaving(false)
    }
  }

  if (!status) {
    return error ? <ErrorNote message={error} /> : <Skeleton className="h-64 w-full" />
  }

  return (
    <div className="space-y-6">
      {confirmDialog}
      <header>
        <h3 className="text-sm theme-text">Assistant</h3>
        <p className="mt-1 text-xs leading-relaxed theme-text-muted">
          What the assistant is told and when it refuses. Changes apply to the next question, no
          restart needed.
        </p>
      </header>

      {error && <ErrorNote message={error} />}

      <TimeSection status={status} saving={saving} save={save} />
      <PromptSection status={status} saving={saving} save={save} confirm={confirm} />
      <SafetySection status={status} saving={saving} save={save} />
    </div>
  )
}

type SectionProps = {
  status: AssistantStatus
  saving: boolean
  save: (patch: AssistantPatch) => Promise<boolean>
}

function TimeSection({ status, saving, save }: SectionProps) {
  const clock = useClock(status.effective_timezone)

  return (
    <section className="space-y-3 rounded-lg border theme-border p-4">
      <h4 className="flex items-center gap-1.5 text-sm theme-text">
        <Clock size={14} className="theme-text-muted" /> Date and time
      </h4>
      <p className="text-[11px] leading-relaxed theme-text-muted">
        The clock the assistant uses for questions like "this morning" or "at 10:00". It follows
        this browser by default.
      </p>

      <div className="rounded-lg theme-surface-strong px-3 py-2.5">
        <p className="text-sm theme-text tabular-nums">{clock}</p>
        <p className="mt-0.5 text-[11px] theme-text-muted">
          {status.effective_timezone} · {SOURCE_LABEL[status.timezone_source]}
        </p>
      </div>

      {/* One list: auto-detect first, then every zone. Searchable, because it is ~400 long. */}
      <ThemeSelect
        label="Timezone"
        size="sm"
        searchable
        searchPlaceholder="Search a city or offset, e.g. Kuala or +8"
        value={status.settings.timezone ?? 'auto'}
        onChange={(zone) => void save({ timezone: zone === 'auto' ? null : zone })}
        options={[
          { value: 'auto', label: `Auto-detect (${status.settings.detected_timezone ?? browserTimezone()})` },
          ...ZONE_OPTIONS,
        ]}
        className={saving ? 'pointer-events-none opacity-60' : ''}
      />
    </section>
  )
}

function FrozenNote() {
  return (
    <p className="flex items-start gap-1.5 text-[11px] leading-relaxed status-warn">
      <Lock size={12} className="mt-0.5 shrink-0" />
      The comparison is frozen, so this is read-only. Edit config/rag_config.json by hand to unfreeze.
    </p>
  )
}

function PromptSection({
  status, saving, save, confirm,
}: SectionProps & { confirm: ReturnType<typeof useConfirm>[0] }) {
  const current = status.settings.system_prompt ?? status.defaults.system_prompt
  const [draft, setDraft] = useState(current)
  const isDefault = status.settings.system_prompt === null
  const dirty = draft !== current

  const reset = async () => {
    const ok = await confirm({
      title: 'Reset the system prompt?',
      body: 'Your custom prompt is replaced by the built-in default.',
      confirmLabel: 'Reset',
    })
    if (ok && (await save({ system_prompt: null }))) setDraft(status.defaults.system_prompt)
  }

  return (
    <section className="space-y-3 rounded-lg border theme-border p-4">
      <div className="flex items-center justify-between gap-2">
        <h4 className="flex items-center gap-1.5 text-sm theme-text">
          <MessageSquareText size={14} className="theme-text-muted" /> System prompt
        </h4>
        <span className="rounded border theme-border px-1.5 py-0.5 text-[10px] theme-text-muted">
          {isDefault ? 'default' : 'custom'}
        </span>
      </div>
      <p className="text-[11px] leading-relaxed theme-text-muted">
        The rules the model answers under, sent at the start of every question. The answer checks
        (numbers must come from evidence, citations must be real) still run whatever this says.
      </p>
      {status.frozen && <FrozenNote />}

      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        disabled={status.frozen}
        rows={14}
        spellCheck={false}
        className={`${inputClass} font-mono leading-relaxed resize-y`}
      />
      <div className="flex flex-wrap items-center justify-end gap-2">
        <span className="mr-auto text-[10px] theme-text-muted tabular-nums">{draft.length} / 8000</span>
        {!isDefault && (
          <button
            onClick={() => void reset()}
            disabled={saving || status.frozen}
            className="rounded-lg border theme-border px-3 py-1.5 text-xs theme-text-muted hover:theme-text disabled:opacity-40"
          >
            Reset to default
          </button>
        )}
        {dirty && (
          <button
            onClick={() => setDraft(current)}
            disabled={saving}
            className="rounded-lg px-3 py-1.5 text-xs theme-text-muted hover:theme-text disabled:opacity-40"
          >
            Discard
          </button>
        )}
        <button
          onClick={() => void save({ system_prompt: draft === status.defaults.system_prompt ? null : draft })}
          disabled={saving || status.frozen || !dirty}
          className="rounded-lg theme-bg-primary theme-text-on-primary px-3 py-1.5 text-xs font-medium disabled:opacity-40"
        >
          Save prompt
        </button>
      </div>
    </section>
  )
}

function SafetySection({ status, saving, save }: SectionProps) {
  const [phrase, setPhrase] = useState('')
  const phrases = status.settings.blocked_phrases
  const locked = status.frozen || saving

  const addPhrase = async () => {
    const p = phrase.trim()
    if (!p) return
    if (await save({ blocked_phrases: [...phrases, p] })) setPhrase('')
  }

  return (
    <section className="space-y-4 rounded-lg border theme-border p-4">
      <h4 className="flex items-center gap-1.5 text-sm theme-text">
        <ShieldAlert size={14} className="theme-text-muted" /> Safety
      </h4>
      <p className="text-[11px] leading-relaxed theme-text-muted">
        Checked before the model runs. A refused question never reaches a tool or a model, and the
        same question is always refused the same way.
      </p>
      {status.frozen && <FrozenNote />}

      <div className="space-y-2">
        <p className="text-xs theme-text">Always refused</p>
        <p className="text-[11px] leading-relaxed theme-text-muted">
          Built in and fixed, so they can't be turned off from here. Asking <em>how</em> to do any of
          these is fine; only asking the assistant to <em>do</em> it is refused.
        </p>
        <ul className="space-y-1.5">
          {status.built_in_rules.map((r) => (
            <li key={r.kind} className="flex items-start gap-2 rounded-lg theme-surface-strong px-3 py-2">
              <Lock size={12} className="mt-0.5 shrink-0 theme-text-muted" />
              <div className="min-w-0">
                <p className="text-xs theme-text">{r.label}</p>
                <p className="text-[11px] theme-text-muted">e.g. {r.examples.map((e) => `"${e}"`).join(', ')}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-2">
        <p className="text-xs theme-text">Also refuse questions containing</p>
        <p className="text-[11px] leading-relaxed theme-text-muted">
          Whole words or phrases, any capitalisation. These only add refusals.
        </p>
        {phrases.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {phrases.map((p) => (
              <span key={p} className="inline-flex items-center gap-1 rounded-md border theme-border px-2 py-0.5 text-[11px] theme-text">
                {p}
                <button
                  onClick={() => void save({ blocked_phrases: phrases.filter((x) => x !== p) })}
                  disabled={locked}
                  aria-label={`Remove ${p}`}
                  className="theme-text-muted hover:theme-text disabled:opacity-40"
                >
                  <X size={11} />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          <input
            value={phrase}
            onChange={(e) => setPhrase(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void addPhrase() }}
            disabled={locked}
            placeholder="e.g. salary"
            className={inputClass}
          />
          <button
            onClick={() => void addPhrase()}
            disabled={locked || !phrase.trim()}
            className="flex shrink-0 items-center gap-1 rounded-lg border theme-border px-3 text-xs theme-text-muted hover:theme-text disabled:opacity-40"
          >
            <Plus size={12} /> Add
          </button>
        </div>
      </div>

      <div className="space-y-3">
        <p className="text-xs theme-text">What it says when it refuses</p>
        {(Object.keys(REFUSAL_LABEL) as RefusalKind[]).map((kind) => (
          <RefusalField key={kind} kind={kind} status={status} locked={locked} save={save} />
        ))}
      </div>
    </section>
  )
}

function RefusalField({
  kind, status, locked, save,
}: { kind: RefusalKind; status: AssistantStatus; locked: boolean; save: SectionProps['save'] }) {
  const stored = status.settings.refusals[kind] ?? ''
  const [draft, setDraft] = useState(stored)
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] theme-text-muted">{REFUSAL_LABEL[kind]}</span>
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { if (draft.trim() !== stored) void save({ refusals: { [kind]: draft.trim() || null } }) }}
        disabled={locked}
        rows={2}
        placeholder={status.defaults.refusals[kind]}
        className={`${inputClass} resize-y placeholder:opacity-60`}
      />
    </label>
  )
}

function ErrorNote({ message }: { message: string }) {
  return (
    <p className="flex items-start gap-1.5 text-xs status-bad">
      <AlertCircle size={13} className="mt-0.5 shrink-0" /> {message}
    </p>
  )
}
