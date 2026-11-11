import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, KeyRound, Plus, Radio } from 'lucide-react'
import { TabError } from '../errors/TabError'
import { toFailure, type LoadFailure } from '../errors/ErrorPage'
import { ThemeSelect } from '../ui/theme-select'
import { SectionsSkeleton } from '../ui/sections-skeleton'
import { useConfirm } from '../ui/confirm-dialog'

/**
 * Settings → Rig connection: the tokens that let CO2SorptionDT's MainUI send
 * readings and use the chat (`backend/app/system/rig_link.py`).
 *
 * Like API keys. Each has a name and an expiry, is shown in full once when it
 * is made, and is stored by Daedalus only as a hash. Revoking one leaves the
 * others working. The first four characters identify it later, so you can tell
 * which one MainUI holds without the secret ever being on screen again.
 */

interface RigToken {
  id: string
  name: string
  prefix: string | null
  created_at: string | null
  expires_at: string | null
  last_used_at: string | null
  expired: boolean
}

const EXPIRY = [
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '365', label: '1 year' },
  { value: 'never', label: 'Never' },
]

function day(iso: string | null): string {
  return iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '-'
}

function used(iso: string | null): string {
  if (!iso) return 'never'
  const s = (Date.now() - new Date(iso).getTime()) / 1000
  if (s < 120) return 'just now'
  if (s < 7200) return `${Math.round(s / 60)} min ago`
  if (s < 172800) return `${Math.round(s / 3600)} h ago`
  return day(iso)
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/ingest${path}`, init)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(body.detail ?? `HTTP ${res.status}`), { status: res.status })
  return body as T
}

export function RigConnectionPanel() {
  const [tokens, setTokens] = useState<RigToken[] | null>(null)
  const [failure, setFailure] = useState<LoadFailure | null>(null)
  const [name, setName] = useState('')
  const [expiry, setExpiry] = useState('90')
  const [made, setMade] = useState<{ token: string; name: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirm, confirmDialog] = useConfirm()

  const load = useCallback(async () => {
    try {
      setTokens((await api<{ tokens: RigToken[] }>('/tokens')).tokens)
      setFailure(null)
    } catch (e) {
      setFailure(toFailure(e))
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    api<{ tokens: RigToken[] }>('/tokens').then(
      (out) => { if (!cancelled) setTokens(out.tokens) },
      (e) => { if (!cancelled) setFailure(toFailure(e)) },
    )
    return () => { cancelled = true }
  }, [])

  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      const out = await api<{ token: string; name: string }>('/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, expires_days: expiry === 'never' ? null : Number(expiry) }),
      })
      setMade({ token: out.token, name: out.name })
      setCopied(false)
      setName('')
      await load()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const revoke = async (t: RigToken) => {
    if (!(await confirm({
      title: `Revoke "${t.name}"?`,
      body: 'Anything using this token stops sending readings and loses the chat straight away. Other tokens keep working.',
      confirmLabel: 'Revoke',
      danger: true,
    }))) return
    try {
      await api(`/tokens/${encodeURIComponent(t.id)}`, { method: 'DELETE' })
      if (made && t.prefix && made.token.startsWith(t.prefix)) setMade(null)
      await load()
    } catch (e) {
      setError((e as Error).message)
    }
  }

  if (failure) return <TabError code={failure.status} detail={failure.message} what="The rig tokens could not load." onRetry={() => void load()} />
  if (!tokens) return <SectionsSkeleton sections={[{ icon: Plus, title: 'New token' }, { icon: KeyRound, title: 'Tokens' }]} />

  const input = 'w-full rounded-lg border theme-border theme-surface px-3 py-1.5 text-xs theme-text outline-none focus-visible:border-[var(--primary-readable)]'

  return (
    <div className="space-y-6">
      <header>
        <h3 className="flex items-center gap-1.5 text-sm theme-text"><Radio size={14} className="theme-accent" /> Rig connection</h3>
        <p className="mt-1 text-xs leading-relaxed theme-text-muted">
          Tokens let CO2SorptionDT&apos;s MainUI send readings to Daedalus and use the chat. Paste one into
          MainUI → Daedalus → ⚙ Connection. A token is shown in full only once; Daedalus keeps a hash, so
          a lost token cannot be recovered: revoke it and make another. Daedalus reads the rig; it
          cannot control it.
        </p>
      </header>

      <section className="space-y-3 rounded-lg border theme-border p-4">
        <h4 className="flex items-center gap-1.5 text-sm theme-text"><Plus size={14} className="theme-text-muted" /> New token</h4>
        <div className="grid gap-3 @lg:grid-cols-[1fr_12rem]">
          <label className="space-y-1">
            <span className="block text-[11px] theme-text-muted">Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && name.trim() && !busy) void create() }}
              maxLength={60}
              placeholder="e.g. Lab PC MainUI"
              className={input}
            />
          </label>
          <ThemeSelect label="Expires after" value={expiry} onChange={setExpiry} options={EXPIRY} size="sm" />
        </div>
        <button
          onClick={() => void create()}
          disabled={!name.trim() || busy}
          className="inline-flex items-center gap-1.5 rounded-lg border theme-border px-3 py-1.5 text-xs theme-text hover:bg-[color-mix(in_srgb,var(--text-main)_9%,transparent)] disabled:opacity-50"
        >
          <KeyRound size={12} /> Make token
        </button>
        {error && <p className="text-[11px] status-bad">{error}</p>}

        {made && (
          <div className="space-y-1.5 rounded-lg border status-warn-border p-3">
            <p className="text-[11px] leading-relaxed theme-text-muted">
              <b className="theme-text">{made.name}</b>: copy it now and paste it into MainUI → Daedalus →
              ⚙ Connection, then press Test connection. It will not be shown again.
            </p>
            <div className="flex items-center gap-1.5">
              <code className="min-w-0 flex-1 break-all rounded theme-surface px-2 py-1 font-mono text-[11px] theme-text">{made.token}</code>
              <button
                onClick={() => { void navigator.clipboard.writeText(made.token); setCopied(true) }}
                aria-label="Copy token"
                className="p-1.5 rounded-md theme-text-muted hover:theme-text"
              >
                {copied ? <Check size={13} className="status-ok" /> : <Copy size={13} />}
              </button>
            </div>
          </div>
        )}
      </section>

      <section className="space-y-3 rounded-lg border theme-border p-4">
        <h4 className="flex items-center gap-1.5 text-sm theme-text"><KeyRound size={14} className="theme-text-muted" /> Tokens</h4>
        {tokens.length === 0 ? (
          <p className="py-4 text-center text-[11px] theme-text-muted">No tokens yet. Make one above to connect MainUI.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left theme-text-muted">
                  {['Name', 'Starts with', 'Created', 'Expires', 'Last used', ''].map((h) => (
                    <th key={h} scope="col" className="pb-2 pr-3 font-normal">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="theme-text">
                {tokens.map((t) => (
                  <tr key={t.id} className={`border-t theme-border ${t.expired ? 'opacity-60' : ''}`}>
                    <td className="py-2 pr-3">{t.name}</td>
                    <td className="py-2 pr-3 font-mono" title={t.prefix ? 'The first four characters, to tell tokens apart' : 'Made before names: no prefix kept'}>
                      {t.prefix ? `${t.prefix}…` : '-'}
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap">{day(t.created_at)}</td>
                    <td className={`py-2 pr-3 whitespace-nowrap ${t.expired ? 'status-bad' : ''}`}>
                      {t.expired ? 'Expired' : t.expires_at ? day(t.expires_at) : 'Never'}
                    </td>
                    <td className="py-2 pr-3 whitespace-nowrap">{used(t.last_used_at)}</td>
                    <td className="py-2 text-right">
                      <button
                        onClick={() => void revoke(t)}
                        className="rounded-md border theme-border px-2 py-0.5 text-[11px] theme-text-muted hover:text-[var(--status-bad)]"
                      >
                        Revoke
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {confirmDialog}
    </div>
  )
}
