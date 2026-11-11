import { useCallback, useEffect, useState } from 'react'
import { Popover } from '@base-ui/react/popover'
import { KeyRound, Radio } from 'lucide-react'
import { openSettingsPanel } from '../lib/threadClient'

/**
 * The rig link at a glance: off, waiting, connected, live or frozen
 * (`backend/app/system/rig_link.py`).
 *
 * Status only. Tokens are made, named and revoked in Settings → Rig connection,
 * one place for them; the button here opens it. A chip rather than a pop-up: a
 * link that drops should be visible, not interrupt a chat. It only ever reports
 * readings coming *in*; nothing here can act on the rig (Rule 2).
 */

type RigState = 'off' | 'waiting' | 'connected' | 'live' | 'frozen'

interface RigStatus {
  state: RigState
  tokens: number
  device_id: string
  seen_seconds: number | null
  last_row: string | null
  age_seconds: number | null
  frozen_seconds: Record<string, number>
}

const POLL_MS = 5000

const LOOK: Record<RigState, { label: string; dot: string; text: string; says: string }> = {
  off: {
    label: 'Rig off · Connect', dot: 'bg-[var(--text-muted)]', text: 'theme-text-muted',
    says: 'No rig token yet. Make one, then paste it into MainUI → Daedalus → ⚙ Connection.',
  },
  waiting: {
    label: 'Rig waiting', dot: 'bg-[var(--text-muted)] animate-pulse', text: 'theme-text-muted',
    says: "A token is ready, but MainUI hasn't connected in the last minute. Open MainUI and press Test connection.",
  },
  connected: {
    label: 'Rig connected · no readings', dot: 'status-warn-fill', text: 'status-warn',
    says: "MainUI is connected, but COM4/COM6 aren't sending. Connect the ports in MainUI.",
  },
  live: {
    label: 'Rig live', dot: 'status-ok-fill', text: 'status-ok',
    says: 'Readings are arriving once a second.',
  },
  frozen: {
    label: 'Rig frozen', dot: 'status-warn-fill animate-pulse', text: 'status-warn',
    says: 'Readings are arriving, but a sensor has stopped changing.',
  },
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

export function RigChip() {
  const [status, setStatus] = useState<RigStatus | null>(null)
  const [open, setOpen] = useState(false)

  const load = useCallback(() => {
    fetch('/api/ingest/status')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setStatus, () => setStatus(null))
  }, [])

  useEffect(() => {
    load()
    const timer = setInterval(load, POLL_MS)
    return () => clearInterval(timer)
  }, [load])

  const state: RigState = status?.state ?? 'off'
  const look = LOOK[state]
  const frozen = Object.entries(status?.frozen_seconds ?? {})
  const label = state === 'frozen' && frozen.length
    ? `Rig live · ${SENSOR_NAME[frozen[0][0]] ?? frozen[0][0]} frozen ${held(frozen[0][1])}`
    : look.label

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
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
            <p className={`mb-3 ${state === 'connected' || state === 'frozen' ? look.text : 'theme-text-muted'}`}>{look.says}</p>

            <dl className="grid grid-cols-[6.5rem_1fr] gap-y-1 mb-3">
              <dt className="theme-text-muted">Device</dt><dd className="font-mono">{status?.device_id ?? '-'}</dd>
              <dt className="theme-text-muted">Tokens</dt><dd>{status ? `${status.tokens} active` : '-'}</dd>
              <dt className="theme-text-muted">MainUI seen</dt><dd>{status?.seen_seconds != null ? ago(status.seen_seconds) : 'not since Daedalus started'}</dd>
              <dt className="theme-text-muted">Last reading</dt><dd>{status?.last_row ? ago(status.age_seconds) : 'none yet'}</dd>
              {frozen.map(([name, s]) => (
                <div key={name} className="contents">
                  <dt className="status-warn">Frozen</dt>
                  <dd className="status-warn">{SENSOR_NAME[name] ?? name} unchanged for {held(s)}. Check MainUI's ports.</dd>
                </div>
              ))}
            </dl>
            <p className="theme-text-muted mb-3">The assistant reads the rig; it cannot control it.</p>

            <button
              onClick={() => { setOpen(false); openSettingsPanel('rig') }}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border theme-border px-3 py-1.5 hover:bg-[color-mix(in_srgb,var(--text-main)_9%,transparent)]"
            >
              <KeyRound size={12} /> {state === 'off' ? 'Make a token' : 'Manage tokens'}
            </button>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
