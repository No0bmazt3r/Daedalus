import { useCallback, useEffect, useState } from 'react'
import {
  Cpu, MemoryStick, HardDrive, MonitorCog, Server, RefreshCw, AlertTriangle,
} from 'lucide-react'
import { hardwareProfile, type HardwareProfile } from '../../lib/systemClient'

/**
 * What this machine is — step 1 of the six in PROJECT.md §8.2.
 *
 * Rendered in two places from this one component: Settings → Hardware, and the
 * Forge window in the sidebar. The same numbers in both, because two
 * implementations of "how much RAM is there" would eventually disagree and one
 * of them would be the one quoted in the report.
 *
 * Every field is nullable by design. A machine with no GPU, no `nvidia-smi` and
 * no Ollama is normal; each unknown shows as "—" with the reason, rather than
 * the panel failing or — worse — inventing a plausible number.
 */

function bytes(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined) return '—'
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1024
  let u = 0
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024
    u++
  }
  return `${v.toFixed(digits)} ${units[u]}`
}

/** A labelled bar. `used` and `total` share whatever unit the caller formatted. */
function Meter({ percent, tone = 'primary' }: { percent: number; tone?: 'primary' | 'warn' }) {
  const clamped = Math.max(0, Math.min(100, percent))
  return (
    <div className="h-1.5 rounded-full bg-black/30 overflow-hidden mt-2">
      <div
        className={`h-full rounded-full transition-[width] duration-500 ${
          tone === 'warn' ? 'bg-amber-400/80' : 'theme-bg-primary'
        }`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  )
}

function Stat({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wide theme-text-muted opacity-70 truncate">
        {label}
      </div>
      <div className="text-sm font-mono truncate" title={title ?? value}>
        {value}
      </div>
    </div>
  )
}

export function HardwareView({ isPeek = false }: { isPeek?: boolean }) {
  const [hw, setHw] = useState<HardwareProfile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setBusy(true)
    try {
      setHw(await hardwareProfile())
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

  const card = `p-5 rounded-xl border theme-border transition-colors ${isPeek ? 'bg-transparent' : 'bg-black/10'}`

  if (error) {
    return (
      <div className="flex items-start gap-3 p-4 rounded-xl border border-red-500/30 bg-red-500/10 text-sm">
        <AlertTriangle size={16} className="text-red-400 shrink-0 mt-0.5" />
        <div>
          <div className="font-medium">Couldn't reach the backend</div>
          <div className="theme-text-muted text-xs mt-1">{error}</div>
        </div>
      </div>
    )
  }

  if (!hw) return <div className="text-sm theme-text-muted">Detecting hardware…</div>

  const mem = hw.memory
  const memUsed = mem.used_percent ?? 0
  const disk = hw.disk
  const diskUsedPct =
    disk.total_bytes && disk.free_bytes !== null
      ? ((disk.total_bytes - disk.free_bytes) / disk.total_bytes) * 100
      : 0

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm theme-text-muted">
          Detected on this machine. These are the numbers the model-fit estimate
          works from — <span className="theme-text">measured, not assumed</span>.
        </p>
        <button
          onClick={() => void load()}
          disabled={busy}
          className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border theme-border theme-text-muted hover:theme-text hover:bg-black/20 transition-colors disabled:opacity-50"
        >
          <RefreshCw size={12} className={busy ? 'animate-spin' : ''} />
          Re-detect
        </button>
      </div>

      {/* ── CPU ── */}
      <div className={card}>
        <div className="flex items-center gap-2 mb-3">
          <Cpu size={16} className="theme-primary" />
          <span className="font-medium">Processor</span>
        </div>
        <div className="text-sm mb-3 break-words">{hw.cpu.model ?? 'Unknown CPU'}</div>
        <div className="grid grid-cols-2 @sm:grid-cols-4 gap-x-4 gap-y-2">
          <Stat label="Physical cores" value={hw.cpu.cores_physical?.toString() ?? '—'} />
          <Stat label="Logical cores" value={hw.cpu.cores_logical?.toString() ?? '—'} />
          <Stat
            label="Max frequency"
            value={hw.cpu.frequency_mhz ? `${(hw.cpu.frequency_mhz / 1000).toFixed(2)} GHz` : '—'}
          />
          <Stat label="Architecture" value={hw.cpu.arch ?? '—'} />
        </div>
      </div>

      {/* ── Memory ── */}
      <div className={card}>
        <div className="flex items-center gap-2 mb-3">
          <MemoryStick size={16} className="theme-primary" />
          <span className="font-medium">Memory</span>
          <span className="text-xs theme-text-muted ml-auto tabular-nums">
            {bytes(mem.available_bytes)} free of {bytes(mem.total_bytes)}
          </span>
        </div>
        <Meter percent={memUsed} tone={memUsed > 85 ? 'warn' : 'primary'} />
        <div className="grid grid-cols-2 @sm:grid-cols-3 gap-x-4 gap-y-2 mt-3">
          <Stat label="Total RAM" value={bytes(mem.total_bytes)} />
          <Stat label="Available" value={bytes(mem.available_bytes)} />
          <Stat label="Swap" value={bytes(mem.swap_total_bytes)} />
        </div>
        {/* Available RAM, not total, is what decides whether a model loads —
            so it is the number the fit estimate must be read against. */}
        <p className="text-xs theme-text-muted opacity-75 mt-3">
          Model fit is judged against <span className="theme-text">available</span> memory,
          not total — the rest is already spoken for.
        </p>
      </div>

      {/* ── GPU ── */}
      <div className={card}>
        <div className="flex items-center gap-2 mb-3">
          <MonitorCog size={16} className="theme-primary" />
          <span className="font-medium">Graphics</span>
          {hw.gpu.source && (
            <span className="text-[10px] px-1.5 py-0.5 rounded border theme-border theme-text-muted uppercase tracking-wide">
              via {hw.gpu.source}
            </span>
          )}
        </div>

        {hw.gpu.devices.length === 0 ? (
          <div className="text-sm theme-text-muted">
            No GPU detected.
            <span className="opacity-75">
              {' '}
              {hw.gpu.error
                ? hw.gpu.error
                : 'Not an error — the production SLM tier is chosen to run on CPU.'}
            </span>
          </div>
        ) : (
          hw.gpu.devices.map((d, i) => {
            const usedPct =
              d.vram_total_bytes && d.vram_used_bytes !== null
                ? (d.vram_used_bytes / d.vram_total_bytes) * 100
                : 0
            return (
              <div key={i} className={i > 0 ? 'mt-4 pt-4 border-t theme-border' : ''}>
                <div className="text-sm mb-1 break-words">{d.name}</div>
                <div className="text-xs theme-text-muted tabular-nums">
                  {bytes(d.vram_used_bytes)} used of {bytes(d.vram_total_bytes)} VRAM
                </div>
                <Meter percent={usedPct} tone={usedPct > 85 ? 'warn' : 'primary'} />
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 mt-3">
                  <Stat label="VRAM" value={bytes(d.vram_total_bytes)} />
                  <Stat label="Driver" value={d.driver_version ?? '—'} />
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* ── Disk ── */}
      <div className={card}>
        <div className="flex items-center gap-2 mb-3">
          <HardDrive size={16} className="theme-primary" />
          <span className="font-medium">Disk</span>
          <span className="text-xs theme-text-muted ml-auto tabular-nums">
            {bytes(disk.free_bytes)} free of {bytes(disk.total_bytes)}
          </span>
        </div>
        <Meter percent={diskUsedPct} tone={diskUsedPct > 90 ? 'warn' : 'primary'} />
        {/* Reported where models land, not `/` — on a small root with a large
            home, the root figure answers the wrong question. */}
        <code className="text-[10px] theme-text-muted opacity-60 break-all block mt-3">
          {disk.path}
        </code>
      </div>

      {/* ── Runtime ── */}
      <div className={card}>
        <div className="flex items-center gap-2 mb-3">
          <Server size={16} className="theme-primary" />
          <span className="font-medium">Runtime</span>
        </div>
        <div className="grid grid-cols-2 @sm:grid-cols-4 gap-x-4 gap-y-2">
          <Stat
            label="Platform"
            value={`${hw.host.platform ?? '—'}${hw.host.wsl ? ' (WSL)' : ''}`}
            title={hw.host.release ?? undefined}
          />
          <Stat label="Python" value={hw.host.python} />
          <Stat
            label="Ollama"
            value={hw.ollama.reachable ? (hw.ollama.version ?? 'reachable') : 'not reachable'}
            title={hw.ollama.resolved_url ?? hw.ollama.base_url}
          />
          <Stat label="Detector" value={hw.detector} />
        </div>
        {hw.ollama.resolved_url && hw.ollama.resolved_url !== hw.ollama.base_url && (
          <p className="text-xs theme-text-muted opacity-75 mt-3">
            Answered on <code className="theme-text">{hw.ollama.resolved_url}</code>, not the
            configured <code>{hw.ollama.base_url}</code> — normal in dev mode, where the backend
            runs on the host rather than in the container.
          </p>
        )}
      </div>
    </div>
  )
}
