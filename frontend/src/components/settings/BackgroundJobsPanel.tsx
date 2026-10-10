import { useCallback, useState, useEffect } from 'react'
import { TabError } from '../errors/TabError'
import { toFailure, type LoadFailure } from '../errors/ErrorPage'
import { AlertCircle, FileText, Tag, Info } from 'lucide-react'
import {
  fetchBackgroundJobs,
  saveBackgroundJobs,
  type BackgroundJobsPatch,
  type BackgroundJobsStatus,
  type ResolvedJob,
  type TitleMode,
} from '../../lib/backgroundJobsClient'
import { useLiveRefresh } from '../../hooks/useLiveRefresh'
import { ThemeSelect } from '../ui/theme-select'
import { SectionsSkeleton } from '../ui/sections-skeleton'

/**
 * Settings → Background Jobs — the model work that runs after an answer.
 *
 * Two jobs, both on their own thread after the answer is stored, so the
 * operator never waits for either:
 *
 * - **Chat titles** name a chat from the conversation, and can rename it as it
 *   drifts. The alternative is the old behaviour: the first message, cut to 60
 *   characters, forever.
 * - **Rolling summary** folds turns that no longer fit the history budget into
 *   a short summary replayed ahead of the recent turns.
 *
 * Each can have its own model, because a job's needs differ from the answer's:
 * a five-word title does not need the biggest model on the machine, and should
 * not queue the operator's next question behind it.
 *
 * Only local models are offered. A background job sends the whole conversation
 * to its model, and unlike a chat turn there is no turn to record that against
 * — so the backend refuses cloud tags, and this list never shows them.
 */

const AUTO = 'auto'

const REFRESH_OPTIONS = [
  { value: '0', label: 'Name it once' },
  { value: '2', label: 'Every 2 questions' },
  { value: '4', label: 'Every 4 questions' },
  { value: '8', label: 'Every 8 questions' },
]

const MODE_OPTIONS: { value: TitleMode; label: string }[] = [
  { value: 'model', label: 'Written by a model' },
  { value: 'first_message', label: 'First message only' },
]

// `isPeek` is accepted for the modal's uniform panel signature; nothing here is translucent.
export function BackgroundJobsPanel(_props: { isPeek?: boolean }) {
  const [status, setStatus] = useState<BackgroundJobsStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  // The jobs cannot be read: the panel is the error page. `error` is a failed save.
  const [loadError, setLoadError] = useState<LoadFailure | null>(null)
  const load = useCallback(() => {
    fetchBackgroundJobs()
      .then((s) => {
        setStatus(s)
        setLoadError(null)
      })
      .catch((e: unknown) => setLoadError(toFailure(e)))
  }, [])

  useEffect(load, [load])
  // A model pulled or deleted changes what can be chosen.
  useLiveRefresh(['models'], load)

  const save = async (patch: BackgroundJobsPatch) => {
    setSaving(true)
    setError(null)
    try {
      setStatus(await saveBackgroundJobs(patch))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  if (loadError) {
    return (
      <TabError
        code={loadError.status}
        detail={loadError.message}
        what="The background job settings could not be read from the backend."
        onRetry={load}
      />
    )
  }
  if (!status) {
    return (
      <SectionsSkeleton sections={[
        { icon: Tag, title: 'Chat titles' },
        { icon: FileText, title: 'Rolling summary' },
      ]} />
    )
  }

  const { config, models, resolved } = status
  const modelOptions = [
    { value: AUTO, label: 'Same as the chat model' },
    ...models.map((m) => ({
      value: m.name,
      label: m.parameter_size ? `${m.name} · ${m.parameter_size}` : m.name,
    })),
  ]
  // A configured model that has since been deleted still has to show as the
  // current value, or the select would claim something else is chosen.
  const withCurrent = (current: string) =>
    modelOptions.some((o) => o.value === current)
      ? modelOptions
      : [...modelOptions, { value: current, label: `${current} (not installed)` }]
  const modelTitle = config.title.mode === 'model'

  return (
    <div className="space-y-6">
      <header>
        <h3 className="text-sm theme-text">Background jobs</h3>
        <p className="mt-1 text-xs leading-relaxed theme-text-muted">
          Model work that runs after an answer is delivered, on its own thread, so you never wait
          for it. Each job can use a different local model from the one answering chat.
        </p>
      </header>

      <section className="space-y-3 rounded-lg border theme-border p-4">
        <h4 className="flex items-center gap-1.5 text-sm theme-text">
          <Tag size={14} className="theme-text-muted" /> Chat titles
        </h4>
        <p className="text-[11px] leading-relaxed theme-text-muted">
          A chat starts named after its first message. With a model, it is renamed after the first
          answer from what the conversation is actually about, and again as it moves on. A title you
          type yourself is never overwritten; clear it to hand the chat back to the job.
        </p>

        <div className="grid gap-3 @lg:grid-cols-2">
          <ThemeSelect
            label="How chats are named"
            value={config.title.mode}
            onChange={(mode) => void save({ title: { mode } })}
            options={MODE_OPTIONS}
            size="sm"
            className={saving ? 'pointer-events-none opacity-60' : ''}
          />
          <ThemeSelect
            label="Rename as the chat grows"
            value={String(config.title.refresh_every)}
            onChange={(v) => void save({ title: { refresh_every: Number(v) } })}
            options={
              REFRESH_OPTIONS.some((o) => o.value === String(config.title.refresh_every))
                ? REFRESH_OPTIONS
                : [...REFRESH_OPTIONS, {
                    value: String(config.title.refresh_every),
                    label: `Every ${config.title.refresh_every} questions`,
                  }]
            }
            size="sm"
            className={!modelTitle || saving ? 'pointer-events-none opacity-50' : ''}
          />
        </div>
        <ThemeSelect
          label="Model"
          value={config.title.model}
          onChange={(model) => void save({ title: { model } })}
          options={withCurrent(config.title.model)}
          size="sm"
          className={!modelTitle || saving ? 'pointer-events-none opacity-50' : ''}
        />
        {modelTitle && <Resolved job={resolved.title} />}
      </section>

      <section className="space-y-3 rounded-lg border theme-border p-4">
        <h4 className="flex items-center gap-1.5 text-sm theme-text">
          <FileText size={14} className="theme-text-muted" /> Rolling summary
        </h4>
        <p className="text-[11px] leading-relaxed theme-text-muted">
          When a long chat no longer fits the history budget, the oldest turns are folded into a
          short summary that later prompts replay. Every measured value is removed from it before
          it is stored, because a summary is context, never evidence. With no model, it falls back to a
          list of your earlier questions.
        </p>
        <ThemeSelect
          label="Model"
          value={config.summary.model}
          onChange={(model) => void save({ summary: { model } })}
          options={withCurrent(config.summary.model)}
          size="sm"
          className={saving ? 'pointer-events-none opacity-60' : ''}
        />
        <Resolved job={resolved.summary} />
      </section>

      {error && <ErrorNote message={error} />}

      <p className="flex items-start gap-1.5 text-[11px] leading-relaxed theme-text-muted">
        <Info size={12} className="mt-0.5 shrink-0" />
        <span>
          Only models on this machine are listed: a background job sends the whole conversation to
          its model, with no chat turn to record that against. Saved to{' '}
          <code className="theme-text">config/background_jobs.json</code>.
        </span>
      </p>
    </div>
  )
}

function Resolved({ job }: { job: ResolvedJob }) {
  const warn = job.source === 'fallback' || !job.tag
  return (
    <p className={`text-[11px] leading-relaxed ${warn ? 'text-amber-400' : 'theme-text-muted'}`}>
      {job.tag ? (
        <>
          Runs on <code className="theme-text">{job.tag}</code> · {job.reason}
        </>
      ) : (
        <>No model can run this job: {job.reason}</>
      )}
    </p>
  )
}

function ErrorNote({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-rose-400/40 bg-rose-400/10 p-2.5 text-[11px] theme-text">
      <AlertCircle size={13} className="shrink-0 text-rose-400" /> {message}
    </div>
  )
}
