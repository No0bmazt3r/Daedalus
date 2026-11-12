import { useCallback, useEffect, useRef, useState } from 'react'
import { FileSpreadsheet, LogIn, LogOut, RefreshCw } from 'lucide-react'
import { TabError } from '../errors/TabError'
import { toFailure, type LoadFailure } from '../errors/ErrorPage'
import { SectionsSkeleton } from '../ui/sections-skeleton'
import { useConfirm } from '../ui/confirm-dialog'

/**
 * Settings → Google: the account the evaluation export writes its sheets to
 * (`backend/app/system/google_link.py`, docs/EVAL_SHEETS.md).
 *
 * Connect opens Google's own sign-in in a new tab; Google returns to the
 * backend, which keeps the grant in `data/google_link.json`. This panel only
 * ever sees the email. Permission is `drive.file`: Daedalus can see the sheets
 * it made and nothing else in the account. Advanced mode only.
 */

interface GoogleStatus {
  allowed: boolean
  reason: string | null
  configured: boolean
  connected: boolean
  email: string | null
  connected_at: string | null
  expires_hint: string | null
  expired: boolean
}

const WAIT_MS = 10 * 60 * 1000 // a sign-in older than this is abandoned server-side too

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/google${path}`, init)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(body.detail ?? `HTTP ${res.status}`), { status: res.status })
  return body as T
}

function when(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '-'
}

export function GoogleConnectionPanel() {
  const [status, setStatus] = useState<GoogleStatus | null>(null)
  const [failure, setFailure] = useState<LoadFailure | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [waiting, setWaiting] = useState(false)
  const [confirm, confirmDialog] = useConfirm()
  const poll = useRef<number | null>(null)

  const load = useCallback(async () => {
    try {
      const s = await api<GoogleStatus>('/status')
      setStatus(s)
      setFailure(null)
      return s
    } catch (e) {
      setFailure(toFailure(e))
      return null
    }
  }, [])

  const stopPolling = () => {
    if (poll.current !== null) window.clearInterval(poll.current)
    poll.current = null
    setWaiting(false)
  }

  useEffect(() => {
    let cancelled = false
    api<GoogleStatus>('/status').then(
      (s) => { if (!cancelled) setStatus(s) },
      (e) => { if (!cancelled) setFailure(toFailure(e)) },
    )
    return () => {
      cancelled = true
      if (poll.current !== null) window.clearInterval(poll.current)
    }
  }, [])

  const connect = async () => {
    setError(null)
    try {
      const { auth_url } = await api<{ auth_url: string }>('/connect', { method: 'POST' })
      window.open(auth_url, '_blank', 'noopener')
      // The sign-in finishes in the other tab; watch for the grant to appear.
      const before = status?.connected_at ?? null
      const started = Date.now()
      setWaiting(true)
      poll.current = window.setInterval(async () => {
        const s = await load()
        if ((s?.connected && s.connected_at !== before) || Date.now() - started > WAIT_MS) stopPolling()
      }, 2000)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const disconnect = async (then?: () => Promise<void>) => {
    if (!then && !(await confirm({
      title: 'Disconnect Google?',
      body: 'Daedalus forgets this account and cancels its access at Google. Sheets already made stay in the account; run `cli_eval sheets` again after reconnecting to keep updating them.',
      confirmLabel: 'Disconnect',
      danger: true,
    }))) return
    setError(null)
    try {
      setStatus(await api<GoogleStatus>('/disconnect', { method: 'POST' }))
      if (then) await then()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  if (failure) return <TabError code={failure.status} detail={failure.message} what="The Google connection could not load." onRetry={() => void load()} />
  if (!status) return <SectionsSkeleton sections={[{ icon: FileSpreadsheet, title: 'Google account' }]} />

  const button = 'inline-flex items-center gap-1.5 rounded-lg border theme-border px-3 py-1.5 text-xs theme-text hover:bg-[color-mix(in_srgb,var(--text-main)_9%,transparent)] disabled:opacity-50'
  const blocked = !status.allowed || !status.configured

  return (
    <div className="space-y-6">
      <header>
        <h3 className="flex items-center gap-1.5 text-sm theme-text"><FileSpreadsheet size={14} className="theme-accent" /> Google</h3>
        <p className="mt-1 text-xs leading-relaxed theme-text-muted">
          The account the evaluation export writes to: a private master workbook per run and one sheet per
          panel member, shared to their email. Daedalus asks only for <code>drive.file</code>, so it sees the
          sheets it made and nothing else. Never used by the chat; exports run from the terminal
          (<code>cli_eval sheets</code>, <code>cli_eval pull</code>).
        </p>
      </header>

      <section className="space-y-3 rounded-lg border theme-border p-4">
        <h4 className="text-sm theme-text">Google account</h4>

        {!status.allowed && <p className="text-[11px] status-warn">{status.reason}</p>}
        {status.allowed && !status.configured && (
          <p className="text-[11px] leading-relaxed status-warn">
            No OAuth client yet. In Google Cloud Console create an OAuth client of type <b>Desktop app</b>, add
            your account as a test user, then set <code>DAEDALUS_GOOGLE_CLIENT_ID</code> and
            <code> DAEDALUS_GOOGLE_CLIENT_SECRET</code> in <code>.env</code> and restart Daedalus.
          </p>
        )}

        {status.connected ? (
          <dl className="grid grid-cols-[8rem_1fr] gap-y-1 text-xs">
            <dt className="theme-text-muted">Connected as</dt><dd className="theme-text">{status.email ?? 'unknown address'}</dd>
            <dt className="theme-text-muted">Since</dt><dd className="theme-text">{when(status.connected_at)}</dd>
            <dt className="theme-text-muted">Reconnect by</dt>
            <dd className={status.expired ? 'status-bad' : 'theme-text'}>
              {status.expired ? 'Expired: reconnect now' : `${when(status.expires_hint)} (Google expires testing apps after 7 days)`}
            </dd>
          </dl>
        ) : (
          <p className="text-[11px] theme-text-muted">Not connected.</p>
        )}

        <div className="flex flex-wrap gap-2">
          {!status.connected || status.expired ? (
            <button className={button} disabled={blocked || waiting} onClick={() => void connect()}>
              <LogIn size={12} /> {status.expired ? 'Reconnect' : 'Connect Google'}
            </button>
          ) : (
            <>
              <button className={button} disabled={blocked || waiting} onClick={() => void disconnect(connect)}>
                <RefreshCw size={12} /> Change account
              </button>
              <button className={`${button} hover:text-[var(--status-bad)]`} onClick={() => void disconnect()}>
                <LogOut size={12} /> Disconnect
              </button>
            </>
          )}
        </div>
        {waiting && <p className="text-[11px] theme-text-muted">Finish signing in in the Google tab; this updates by itself.</p>}
        {error && <p className="text-[11px] status-bad">{error}</p>}
      </section>
      {confirmDialog}
    </div>
  )
}
