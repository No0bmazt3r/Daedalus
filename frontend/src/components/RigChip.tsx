import { useCallback, useEffect, useState } from 'react'
import { Popover } from '@base-ui/react/popover'
import { Copy, Check, Radio } from 'lucide-react'
import { useConfirm } from './ui/confirm-dialog'

/**
 * The rig link at a glance: off, waiting, live or frozen, and where it is
 * paired and revoked (`backend/app/system/rig_link.py`).
 *
 * A chip rather than a pop-up: a link that drops should be visible, not
 * interrupt a chat. It only ever reports readings coming *in*; nothing here
 * can act on the rig (Rule 2).
 */

type RigState = 'off' | 'waiting' | 'live' | 'frozen'

interface RigStatus {
  state: RigState
  paired_at: string | null
  device_id: string
  last_row: string | null
  age_seconds: number | null
  frozen_seconds: Record<string, number>
}

const POLL_MS = 5000

const LOOK: Record<RigState, { label: string; dot: string; text: string }> = {
  off: { label: 'Rig off', dot: 'bg-[var(--text-muted)]', text: 'theme-text-muted' },
  waiting: { label: 'Rig waiting', dot: 'bg-[var(--text-muted)] animate-pulse', text: 'theme-text-muted' },
  live: { label: 'Rig live', dot: 'status-ok-fill', text: 'status-ok' },
  frozen: { label: 'Rig frozen', dot: 'status-warn-fill animate-pulse', text: 'status-warn' },
}

const SENSOR_NAME: Record<string, string> = {
  temperature: 'T-101', pressure: 'P-101', ph: 'pH-101', co2_ppm: 'CO₂',
}

function ago(seconds: number | null): string {
  if (seconds == null) return '-'
  if (seconds < 120) return `${seconds} s ago`
  if (seconds < 7200) return `${Math.floor(seconds / 60)} min ago`
  return `${Math.floor(seconds / 3600)} h ago`
}

function held(seconds: number): string {
  return seconds < 120 ? `${seconds} s` : `${Math.floor(seconds / 60)} min`
}

async function call(method: string, body?: unknown): Promise<RigStatus & { token?: string }> {
  const res = await fetch(`/api/ingest/${method === 'GET' ? 'status' : 'pair'}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

export function RigChip() {
  const [status, setStatus] = useState<RigStatus | null>(null)
  const [token, setToken] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirm, confirmDialog] = useConfirm()

  const load = useCallback(() => {
    call('GET').then(setStatus, () => setStatus(null))
  }, [])

  useEffect(() => {
    load()
    const timer = setInterval(load, POLL_MS)
    return () => clearInterval(timer)
  }, [load])

  const pair = async () => {
    if (status && status.state !== 'off' && !(await confirm({
      title: 'Pair the rig again?',
      body: 'A new token replaces the current one. MainUI stops sending until you paste the new token into it.',
      confirmLabel: 'Make new token',
    }))) return
    try {
      const next = await call('POST', { confirm: true })
      setToken(next.token ?? null)
      setCopied(false)
      setStatus(next)
      setError(null)
    } catch (e) {
      setError(`Could not pair: ${(e as Error).message}`)
    }
  }

  const disconnect = async () => {
    if (!(await confirm({
      title: 'Disconnect the rig?',
      body: 'The token is revoked and Daedalus stops recording readings from MainUI until you pair again.',
      confirmLabel: 'Disconnect',
      danger: true,
    }))) return
    try {
      setStatus(await call('DELETE'))
      setToken(null)
      setError(null)
    } catch (e) {
      setError(`Could not disconnect: ${(e as Error).message}`)
    }
  }

  const copy = () => {
    if (!token) return
    void navigator.clipboard.writeText(token)
    setCopied(true)
  }

  const state: RigState = status?.state ?? 'off'
  const look = LOOK[state]
  const frozen = Object.entries(status?.frozen_seconds ?? {})
  const label = state === 'frozen' && frozen.length
    ? `Rig live · ${SENSOR_NAME[frozen[0][0]] ?? frozen[0][0]} frozen ${held(frozen[0][1])}`
    : look.label

  return (
    <>
      <Popover.Root>
        <Popover.Trigger
          className={`flex shrink-0 items-center gap-2 h-9 px-3 rounded-full border theme-border text-xs hover:bg-[color-mix(in_srgb,var(--text-main)_9%,transparent)] ${look.text}`}
          aria-label={`${label}. Open rig link`}
        >
          <span className={`h-2 w-2 rounded-full ${look.dot}`} />
          <span className="whitespace-nowrap">{label}</span>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Positioner side="bottom" align="end" sideOffset={6} className="z-[120]">
            <Popover.Popup className="w-80 rounded-xl border theme-border theme-card p-4 shadow-2xl text-xs theme-text outline-none">
              <div className="flex items-center gap-2 mb-1">
                <Radio size={14} className="theme-accent" />
                <span className="text-sm font-medium">Rig link</span>
                <span className={`ml-auto ${look.text}`}>{state}</span>
              </div>
              <p className="theme-text-muted mb-3">
                Readings from CO2SorptionDT come in once a second. The assistant reads them; it cannot control the rig.
              </p>

              <dl className="grid grid-cols-[6.5rem_1fr] gap-y-1 mb-3">
                <dt className="theme-text-muted">Device</dt><dd className="font-mono">{status?.device_id ?? '-'}</dd>
                <dt className="theme-text-muted">Paired</dt>
                <dd>{status?.paired_at ? status.paired_at.replace('T', ' ').slice(0, 16) + ' UTC' : 'no'}</dd>
                <dt className="theme-text-muted">Last reading</dt><dd>{status?.last_row ? ago(status.age_seconds) : 'none yet'}</dd>
                {frozen.map(([name, s]) => (
                  <div key={name} className="contents">
                    <dt className="status-warn">Frozen</dt>
                    <dd className="status-warn">{SENSOR_NAME[name] ?? name} unchanged for {held(s)}. Check MainUI's ports.</dd>
                  </div>
                ))}
              </dl>

              {token && (
                <div className="mb-3 rounded-lg border status-warn-border p-2">
                  <p className="mb-1.5 theme-text-muted">
                    Paste this into MainUI's Data tab, then click Test connection. It is shown once.
                  </p>
                  <div className="flex items-center gap-1.5">
                    <code className="min-w-0 flex-1 break-all rounded theme-surface px-1.5 py-1 font-mono text-[11px]">{token}</code>
                    <button onClick={copy} aria-label="Copy token" className="p-1.5 rounded-md theme-text-muted hover:theme-text">
                      {copied ? <Check size={13} className="status-ok" /> : <Copy size={13} />}
                    </button>
                  </div>
                </div>
              )}

              {error && <p className="mb-2 status-bad">{error}</p>}

              <div className="flex gap-2">
                <button
                  onClick={() => void pair()}
                  className="flex-1 rounded-lg border theme-border px-3 py-1.5 hover:bg-[color-mix(in_srgb,var(--text-main)_9%,transparent)]"
                >
                  {state === 'off' ? 'Connect rig' : 'New token'}
                </button>
                {state !== 'off' && (
                  <button
                    onClick={() => void disconnect()}
                    className="rounded-lg border theme-border px-3 py-1.5 hover:text-[var(--status-bad)]"
                  >
                    Disconnect
                  </button>
                )}
              </div>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
      {confirmDialog}
    </>
  )
}
