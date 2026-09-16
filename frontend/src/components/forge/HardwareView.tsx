import { useCallback, useEffect, useState } from 'react'
import {
  Cpu, MemoryStick, HardDrive, MonitorCog, Server, RefreshCw, AlertTriangle,
} from 'lucide-react'
import {
  hardwareProfile, redetectHardware, type HardwareProfile,
} from '../../lib/systemClient'

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
 *
 * ## Where these numbers come from
 *
 * Not from a scan triggered by opening the panel — that cost seconds of
 * subprocess and interop time every time, and scaled with how often somebody
 * looked. The backend keeps a snapshot warm on a schedule and this polls it,
 * which costs about a millisecond a time. Two consequences worth knowing:
 *
 * - The panel prints how old the numbers are. Presenting a cached figure as
 *   live would be a worse failure than a slow panel, so the age is on screen.
 * - Polling *is* the signal that keeps the backend's loop awake — it goes
 *   dormant when nothing has read the profile for a couple of minutes. So this
 *   stops polling when the tab is hidden, and stops entirely on unmount, which
 *   is what makes a closed panel genuinely free rather than merely quiet.
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

/**
 * "12s ago". Coarse on purpose — the display ticks every few seconds, and a
 * counter that advances in ones would re-render the panel sixty times a minute
 * to save nobody any confusion.
 */
function ago(seconds: number | null): string {
  if (seconds === null) return 'never'
  if (seconds < 10) return 'just now'
  if (seconds < 60) return `${Math.round(seconds / 5) * 5}s ago`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`
  return `${Math.round(seconds / 3600)}h ago`
}

/** Section keys in the words this panel already uses for them. */
const SECTION_LABELS: Record<string, string> = {
  cpu: 'processor',
  memory: 'memory',
  disk: 'disk',
  gpu: 'GPU',
  ollama: 'Ollama',
  host: 'platform',
  host_machine: 'host machine',
}

/** "a", "a and b", "a, b and c". */
function list(items: string[]): string {
  if (items.length <= 1) return items[0] ?? ''
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`
}

/** Agreement for a list that is one item on some machines and four on others. */
function agree(items: string[], singular: string, plural: string): string {
  return items.length === 1 ? singular : plural
}

function sentence(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/**
 * The cadence tooltip, built from the tiers the backend reports rather than
 * from a fixed sentence.
 *
 * It has to be derived, because the GPU picks its own tier from what answered:
 * with pynvml it is a 13ms in-process call and refreshes with the live
 * numbers, without it a ~600ms subprocess that drops to the slow tier. A
 * hardcoded description would be wrong on whichever kind of machine it wasn't
 * written on.
 */
function cadence(hw: HardwareProfile): string {
  const meta = hw.refresh
  const byTier: Record<string, string[]> = { live: [], slow: [], static: [] }
  for (const [key, section] of Object.entries(meta.sections)) {
    // Absent on anything that isn't WSL — no sense naming a refresh rate for
    // something the panel is not showing.
    if (key === 'host_machine' && hw.host_machine === null) continue
    byTier[section.tier]?.push(SECTION_LABELS[key] ?? key)
  }

  const live = Math.round(meta.live_interval_seconds)
  const slow = Math.round(meta.slow_interval_seconds / 60)
  const parts: string[] = []
  // Each clause agrees with its own list: which sections land in which tier
  // varies by machine, so any of these can be one item or four.
  if (byTier.live.length) {
    parts.push(
      sentence(
        `${list(byTier.live)} ${agree(byTier.live, 'refreshes', 'refresh')} every ${live}s.`,
      ),
    )
  }
  if (byTier.slow.length) {
    parts.push(
      sentence(
        `${list(byTier.slow)} ${agree(byTier.slow, 'refreshes', 'refresh')} every ${slow} min` +
          ', which are slower to probe and rarely change.',
      ),
    )
  }
  if (byTier.static.length) {
    parts.push(
      sentence(
        `${list(byTier.static)} ${agree(byTier.static, 'is', 'are')} detected once; ` +
          `${agree(byTier.static, 'it cannot', 'they cannot')} change while the backend runs.`,
      ),
    )
  }
  parts.push('Re-detect re-runs all of them now.')
  return parts.join(' ')
}

/** A labelled bar. `used` and `total` share whatever unit the caller formatted. */
function Meter({ percent, tone = 'primary' }: { percent: number; tone?: 'primary' | 'warn' }) {
  const clamped = Math.max(0, Math.min(100, percent))
  return (
    <div className="h-1.5 rounded-full theme-track overflow-hidden mt-2">
      <div
        className={`h-full rounded-full transition-[width] duration-500 ${
          tone === 'warn' ? 'status-warn-fill' : 'theme-bg-primary'
        }`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  )
}

function Stat({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] uppercase tracking-wide theme-text-muted truncate">
        {label}
      </div>
      <div className="text-sm font-mono truncate" title={title ?? value}>
        {value}
      </div>
    </div>
  )
}

/** Fallback poll spacing, for before the first response and after a failure. */
const POLL_FALLBACK_MS = 30_000

/** How often the "updated Ns ago" line is recomputed. See `ago()` for why coarse. */
const CLOCK_TICK_MS = 5_000

export function HardwareView({ isPeek = false }: { isPeek?: boolean }) {
  const [hw, setHw] = useState<HardwareProfile | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** True only during an explicit Re-detect — the poll must not spin the icon. */
  const [busy, setBusy] = useState(false)
  /**
   * How old the snapshot is, in seconds: seeded from each response and advanced
   * by a local tick so the line keeps counting between polls.
   *
   * Held in state rather than derived at render time from a clock — reading
   * `Date.now()` while rendering is the kind of impurity that makes a component
   * update unpredictably, and every poll reseeds this from the backend anyway,
   * so the local ticking can never drift far.
   */
  const [ageSeconds, setAgeSeconds] = useState<number | null>(null)

  /**
   * One cheap read of the cached snapshot. Returns how long to wait before the
   * next one — the backend says when its live tier is next due, so the poll
   * tracks the real refresh rather than guessing at it, and self-corrects if
   * the interval is reconfigured.
   */
  const poll = useCallback(async (): Promise<number> => {
    try {
      const next = await hardwareProfile()
      setHw(next)
      setAgeSeconds(next.refresh.age_seconds)
      setError(null)
      // A second of slack, so the request lands just after the refresh it is
      // waiting for rather than a hair before it and missing a whole cycle.
      return Math.max(5, next.refresh.next_refresh_in_seconds + 1) * 1000
    } catch (e) {
      setError(e instanceof Error ? e.message : 'request failed')
      return POLL_FALLBACK_MS
    }
  }, [])

  /** The button: a real re-probe, seconds long, so this one shows a spinner. */
  const redetect = useCallback(async () => {
    setBusy(true)
    try {
      const next = await redetectHardware()
      setHw(next)
      setAgeSeconds(next.refresh.age_seconds)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'request failed')
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    let timer: number | undefined

    const run = async () => {
      if (cancelled) return
      // A hidden tab is the clearest "nobody is watching" signal available, and
      // skipping the read is also what lets the backend loop fall dormant.
      // Check back on the fallback interval rather than never, so a tab
      // restored without a visibilitychange event still recovers.
      if (document.hidden) {
        timer = window.setTimeout(() => void run(), POLL_FALLBACK_MS)
        return
      }
      const wait = await poll()
      if (cancelled) return
      timer = window.setTimeout(() => void run(), wait)
    }

    const onVisibility = () => {
      if (document.hidden) return
      // Back in view: read immediately rather than showing whatever was on
      // screen when the tab was hidden.
      window.clearTimeout(timer)
      void run()
    }

    void run()
    document.addEventListener('visibilitychange', onVisibility)

    const clock = window.setInterval(
      () => setAgeSeconds((n) => (n === null ? null : n + CLOCK_TICK_MS / 1000)),
      CLOCK_TICK_MS,
    )

    return () => {
      // Unmount — closing the Forge window or leaving the Settings panel — is
      // what stops the work, all the way down to the backend's loop.
      cancelled = true
      window.clearTimeout(timer)
      window.clearInterval(clock)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [poll])

  const card = `p-5 rounded-xl border theme-border transition-colors ${isPeek ? 'bg-transparent' : 'theme-surface'}`

  // Only when there is nothing to show. Once the panel is populated a failed
  // poll must not blank it — the backend restarting mid-session is ordinary,
  // and replacing a full readout with an error card over a blip that the next
  // poll recovers from would be the wrong trade. The failure is reported on the
  // freshness line instead, next to the age it explains.
  if (error && !hw) {
    return (
      <div className="flex items-start gap-3 p-4 rounded-xl border status-bad-border status-bad-bg text-sm">
        <AlertTriangle size={16} className="status-bad shrink-0 mt-0.5" />
        <div>
          <div className="font-medium">Couldn't reach the backend</div>
          <div className="theme-text-muted text-xs mt-1">{error}</div>
        </div>
      </div>
    )
  }

  if (!hw) return <div className="text-sm theme-text-muted">Detecting hardware…</div>

  const meta = hw.refresh
  // The ticking value when there is one; the backend's own figure covers the
  // render between `hw` arriving and the first tick.
  const shownAge = ageSeconds ?? meta.age_seconds
  const live = Math.round(meta.live_interval_seconds)
  const freshness = error
    ? `Couldn't refresh (${error}). Showing the last reading, from ${ago(shownAge)}`
    : meta.stale
      ? `Cached. Last read ${ago(shownAge)}`
      : meta.background
        ? `Updated ${ago(shownAge)} · refreshing every ${live}s`
        : `Updated ${ago(shownAge)}`
  const tierExplainer = cadence(hw)

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
        <div className="min-w-0">
          <p className="text-sm theme-text-muted">
            Detected on this machine. These are the numbers the model-fit estimate
            works from: <span className="theme-text">measured, not assumed</span>.
          </p>
          {/* These numbers are cached, so the panel says how old they are.
              Quietly serving a stale figure as if it were live is the one
              failure this design could introduce, so it is on screen. */}
          <p
            className="text-xs theme-text-muted mt-1.5 flex items-center gap-1.5"
            title={tierExplainer}
          >
            <span
              className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${
                error || meta.stale ? 'status-warn-fill' : 'theme-bg-primary'
              }`}
            />
            <span className="truncate">{freshness}</span>
          </p>
        </div>
        <button
          onClick={() => void redetect()}
          disabled={busy}
          title="Probe everything again now, including the slow checks the schedule normally skips."
          className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border theme-border theme-text-muted hover:theme-text hover:bg-[color-mix(in_srgb,var(--text-main)_9%,transparent)] transition-colors disabled:"
        >
          <RefreshCw size={12} className={busy ? 'animate-spin' : ''} />
          {busy ? 'Detecting…' : 'Re-detect'}
        </button>
      </div>

      {/* ── CPU ── */}
      <div className={card}>
        <div className="flex items-center gap-2 mb-3">
          <Cpu size={16} className="theme-accent" />
          <span className="font-medium">Processor</span>
        </div>
        <div className="text-sm mb-3 break-words">{hw.cpu.model ?? 'Unknown CPU'}</div>
        <div className="grid grid-cols-2 @sm:grid-cols-4 gap-x-4 gap-y-2">
          <Stat label="Physical cores" value={hw.cpu.cores_physical?.toString() ?? '—'} />
          <Stat label="Logical cores" value={hw.cpu.cores_logical?.toString() ?? '—'} />
          <Stat
            label="Base clock"
            value={hw.cpu.base_clock_mhz ? `${(hw.cpu.base_clock_mhz / 1000).toFixed(2)} GHz` : '—'}
          />
          <Stat label="Architecture" value={hw.cpu.arch ?? '—'} />
        </div>
      </div>

      {/* ── Memory ── */}
      <div className={card}>
        <div className="flex items-center gap-2 mb-3">
          <MemoryStick size={16} className="theme-accent" />
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
        <p className="text-xs theme-text-muted mt-3">
          Model fit is judged against <span className="theme-text">available</span> memory,
          not total. The rest is already spoken for.
        </p>
        {/* A dash here used to be unexplained. The probe now says which reader
            answered and what stopped the better one, because "no RAM figure"
            and "psutil did not install on this distro" need different fixes. */}
        {mem.total_bytes === null ? (
          <p className="text-xs status-warn mt-2 break-words">
            RAM could not be read. {mem.error ?? 'No probe answered.'}
          </p>
        ) : (
          mem.source &&
          mem.source !== 'psutil' && (
            <p className="text-xs theme-text-muted mt-2 break-words">
              Read from <code className="theme-text">{mem.source}</code>
              {mem.error ? `: ${mem.error}` : ''}
            </p>
          )
        )}
      </div>

      {/* ── GPU ── */}
      <div className={card}>
        <div className="flex items-center gap-2 mb-3">
          <MonitorCog size={16} className="theme-accent" />
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
            <span>
              {' '}
              {hw.gpu.error
                ? hw.gpu.error
                : 'Not an error. The production SLM tier is chosen to run on CPU.'}
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
          <HardDrive size={16} className="theme-accent" />
          <span className="font-medium">Disk</span>
          <span className="text-xs theme-text-muted ml-auto tabular-nums">
            {bytes(disk.free_bytes)} free of {bytes(disk.total_bytes)}
          </span>
        </div>
        <Meter percent={diskUsedPct} tone={diskUsedPct > 90 ? 'warn' : 'primary'} />
        {/* Reported where models land, not `/` — on a small root with a large
            home, the root figure answers the wrong question. */}
        <code className="text-[10px] theme-text-muted break-all block mt-3">
          {disk.path}
        </code>
      </div>

      {/* ── Runtime ── */}
      <div className={card}>
        <div className="flex items-center gap-2 mb-3">
          <Server size={16} className="theme-accent" />
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
          <p className="text-xs theme-text-muted mt-3">
            Answered on <code className="theme-text">{hw.ollama.resolved_url}</code>, not the
            configured <code>{hw.ollama.base_url}</code>. That is normal in dev mode, where the
            backend runs on the host rather than in the container.
          </p>
        )}
      </div>
    </div>
  )
}
