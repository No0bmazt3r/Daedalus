import { useState } from 'react'
import { CheckCircle2, ChevronRight, CircleSlash, Loader2, XCircle } from 'lucide-react'
import type { JobRun } from '../../lib/backgroundJobsClient'
import { useSessions } from '../../contexts/SessionsContext'
import { timeAgo } from '../../lib/time'

/**
 * A background job's pulse: a status line ("Running" or how the last run went)
 * and, folded under it, its recent runs. Status is icon + word + colour, never
 * colour alone. Runs live in memory, so the list starts empty after a restart.
 */

const STATUS = {
  running: { Icon: Loader2, word: 'Running', tone: 'theme-accent', spin: true },
  done: { Icon: CheckCircle2, word: 'Done', tone: 'status-ok', spin: false },
  skipped: { Icon: CircleSlash, word: 'Skipped', tone: 'theme-text-muted', spin: false },
  failed: { Icon: XCircle, word: 'Failed', tone: 'status-bad', spin: false },
} as const

const seconds = (ms: number | null) => (ms === null ? null : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`)

/** The chat a run was on: a link back while it exists, never one for incognito. */
function ChatName({ run }: { run: JobRun }) {
  const { selectSession } = useSessions()
  if (!run.chat) return <span className="italic">deleted chat</span>
  if (run.chat.incognito || !run.session_id) return <span className="italic">Incognito chat</span>
  const id = run.session_id
  return (
    <button
      onClick={() => selectSession(id)}
      title="Show this chat behind the window"
      className="min-w-0 truncate rounded theme-text hover:underline underline-offset-2 outline-none focus-visible:ring-1 focus-visible:ring-[color-mix(in_srgb,var(--primary)_70%,transparent)]"
    >
      {run.chat.title || 'New chat'}
    </button>
  )
}

function RunRow({ run }: { run: JobRun }) {
  const { Icon, word, tone, spin } = STATUS[run.status]
  const meta = [run.model, seconds(run.duration_ms)].filter(Boolean).join(' · ')
  return (
    <li className="flex items-start gap-2 py-1.5">
      <Icon size={13} className={`mt-0.5 shrink-0 ${tone} ${spin ? 'animate-spin motion-reduce:animate-none' : ''}`} aria-hidden />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span className={`shrink-0 font-medium ${tone}`}>{word}</span>
          <span className="shrink-0 opacity-60">·</span>
          <ChatName run={run} />
          <span className="ml-auto shrink-0 tabular-nums opacity-70" title={new Date(run.started_at).toLocaleString()}>
            {timeAgo(run.started_at)}
          </span>
        </div>
        {(run.detail || meta) && (
          <p className="mt-0.5 break-words opacity-80">
            {run.detail}
            {run.detail && meta && <span className="opacity-60"> · </span>}
            {meta && <span className="tabular-nums">{meta}</span>}
          </p>
        )}
      </div>
    </li>
  )
}

export function JobRunsList({ runs, keep }: { runs: JobRun[]; keep: number }) {
  const [open, setOpen] = useState(false)
  const running = runs.find((r) => r.status === 'running')
  const last = runs.find((r) => r.status !== 'running')

  return (
    <div className="rounded-md border theme-border text-[11px] theme-text-muted" aria-live="polite">
      <button
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        disabled={!runs.length}
        className="flex w-full items-center gap-2 px-3 py-2 text-left rounded-md outline-none focus-visible:ring-1 focus-visible:ring-[color-mix(in_srgb,var(--primary)_70%,transparent)] enabled:hover:bg-[color-mix(in_srgb,var(--text-main)_5%,transparent)]"
      >
        {running ? (
          <>
            <span className="relative flex size-2 shrink-0" aria-hidden>
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-[var(--primary)] opacity-60 motion-reduce:animate-none" />
              <span className="relative inline-flex size-2 rounded-full bg-[var(--primary)]" />
            </span>
            <span className="theme-accent font-medium">Running</span>
            <span className="opacity-60">·</span>
            <span className="min-w-0 truncate theme-text">
              {running.chat?.incognito ? 'Incognito chat' : running.chat?.title || 'New chat'}
            </span>
          </>
        ) : last ? (
          <>
            <span className={`size-2 shrink-0 rounded-full bg-current ${STATUS[last.status].tone}`} aria-hidden />
            <span className="min-w-0 truncate">
              Last ran {timeAgo(last.started_at)} · <span className={STATUS[last.status].tone}>{STATUS[last.status].word.toLowerCase()}</span>
              {last.model && <> · {last.model}</>}
              {last.duration_ms !== null && <> · {seconds(last.duration_ms)}</>}
            </span>
          </>
        ) : (
          <span>Has not run since the backend started</span>
        )}
        {runs.length > 0 && (
          <span className="ml-auto flex shrink-0 items-center gap-1">
            Recent runs
            <ChevronRight size={12} className={`transition-transform duration-200 ${open ? 'rotate-90' : ''}`} />
          </span>
        )}
      </button>
      {open && runs.length > 0 && (
        <div className="border-t theme-border px-3 pb-2">
          <ul className="divide-y divide-[color-mix(in_srgb,var(--text-main)_8%,transparent)]">
            {runs.map((r) => <RunRow key={`${r.started_at}-${r.session_id}-${r.status}`} run={r} />)}
          </ul>
          <p className="pt-1.5 opacity-60">The last {keep} runs since the backend started. Not saved.</p>
        </div>
      )}
    </div>
  )
}
