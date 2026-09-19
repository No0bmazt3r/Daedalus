import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle, Download, Loader2, RefreshCw, Terminal, Trash2, Upload,
} from 'lucide-react'
import { ConfirmDialog } from '../ui/confirm-dialog'
import { ThemeSelect } from '../ui/theme-select'
import { Switch } from '../ui/switch'
import {
  downloadExport,
  fetchLogs,
  fetchWipeCategories,
  importData,
  wipe,
  type LogLine,
  type LogTail,
  type WipeCategory,
} from '../../lib/maintenanceClient'

/**
 * Settings → System.
 *
 * Three cards, following the Odysseus panel of the same name: the process log,
 * a backup, and the Danger Zone. What differs is what each one is allowed to
 * touch, and all three differences come from `PROJECT.md`:
 *
 * - **The backup carries no credentials.** A backup file is the most copied and
 *   least guarded artefact a system produces. It records that a key is set, not
 *   what it is.
 * - **The sensor database is not a category.** Rule 2 — the SCADA subsystem owns
 *   that file and this application opens it read-only. `reset.sh --sensor` is
 *   the one way, at a terminal, having typed the word.
 * - **The audit log is a category, with heavier copy.** It is the evidence §9.2's
 *   figures come from. Sometimes right to clear, never casual.
 *
 * The log viewer filters server-side. Odysseus fetches the tail and filters in
 * the browser, which is simpler and sends the whole tail on every poll — fine
 * for a click, wasteful for a three-second interval.
 */

/**
 * The console does not follow the theme, on purpose.
 *
 * Everything else in this app derives from the active palette, and it should.
 * A log console is the exception: it is the one surface where the *content* is
 * the point, the content is fixed-width text somebody else's library wrote, and
 * a cream-on-cream paper theme makes it unreadable — which is the state that
 * prompted this. Terminals look the way they do because it works.
 *
 * So the colours below are literals rather than theme variables, and the font
 * is an explicit stack rather than `--font-ui`. The card around it stays themed;
 * the terminal inside it is a terminal.
 */
const TERMINAL_BG = '#0b0e14'
const TERMINAL_FG = '#c8d0dc'

// A stack, not a single family: the first entry that exists wins, and a
// developer machine, a Mac and a bare container each have a different first
// entry. `ui-monospace` resolves to the platform's own terminal face.
const TERMINAL_FONT =
  'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", "Liberation Mono", monospace'

// Close to the 16-colour palette every terminal has agreed on for forty years,
// which is why they read correctly without a legend.
const LEVEL_COLOUR: Record<string, string> = {
  DEBUG: '#6b7a90',
  INFO: '#6cb6ff',
  WARNING: '#e3b341',
  ERROR: '#f85149',
  CRITICAL: '#ff7b72',
}

const POLL_MS = 3000

function LogsCard({ card }: { card: string }) {
  const [tail, setTail] = useState<LogTail | null>(null)
  const [level, setLevel] = useState('ALL')
  const [query, setQuery] = useState('')
  const [limit, setLimit] = useState(200)
  const [loading, setLoading] = useState(false)
  const [auto, setAuto] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const consoleRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async (isPoll = false) => {
    if (!isPoll) setLoading(true)
    try {
      // Whether the reader is at the bottom decides whether a poll scrolls.
      // Measured before the fetch, because the DOM changes underneath it.
      const box = consoleRef.current
      const pinned = !box || box.scrollHeight - box.scrollTop - box.clientHeight < 40

      const next = await fetchLogs({ limit, level, q: query })
      setTail(next)
      setError(null)

      if (pinned) {
        requestAnimationFrame(() => {
          if (consoleRef.current) {
            consoleRef.current.scrollTop = consoleRef.current.scrollHeight
          }
        })
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not read the log')
    } finally {
      setLoading(false)
    }
  }, [level, limit, query])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!auto) return
    const id = window.setInterval(() => void load(true), POLL_MS)
    return () => window.clearInterval(id)
  }, [auto, load])

  return (
    <div className={card}>
      <h4 className="text-sm font-medium flex items-center gap-1.5 mb-1">
        <Terminal size={13} className="theme-accent" />
        Process log
      </h4>
      <p className="text-xs theme-text-muted mb-3">
        What the backend is doing — startup, exceptions, timeouts. Separate from the audit
        database, which records what each answer was built from.
      </p>

      <div className="flex flex-wrap items-center gap-2 mb-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the log…"
          className="flex-1 min-w-40 px-2.5 py-1.5 rounded-lg border theme-border theme-surface-strong theme-text text-xs outline-none placeholder:opacity-40"
        />
        <ThemeSelect
          value={level}
          onChange={setLevel}
          ariaLabel="Level"
          size="sm"
          options={[
            { value: 'ALL', label: 'All levels' },
            ...(tail?.levels ?? []).map((l) => ({ value: l, label: l })),
          ]}
        />
        <ThemeSelect
          value={String(limit)}
          onChange={(v) => setLimit(Number(v))}
          ariaLabel="Lines"
          size="sm"
          options={[100, 200, 500, 1000].map((n) => ({ value: String(n), label: `${n} lines` }))}
        />
        <button
          onClick={() => load()}
          disabled={loading}
          className="p-1.5 rounded-lg border theme-border theme-text-muted hover:theme-text disabled:opacity-40 transition-colors"
          title="Refresh"
        >
          <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
        </button>
        <label className="flex items-center gap-1.5 text-[11px] theme-text-muted" title={`Poll every ${POLL_MS / 1000}s`}>
          <Switch checked={auto} onChange={setAuto} label="Auto-refresh the log" />
          Auto
        </label>
      </div>

      <div
        ref={consoleRef}
        className="h-72 overflow-auto rounded-lg border border-black/40 p-2.5 text-[11px] leading-[1.55]"
        style={{
          background: TERMINAL_BG,
          color: TERMINAL_FG,
          fontFamily: TERMINAL_FONT,
          // Terminals do not hyphenate or reflow words; a wrapped log line
          // should break at the edge and continue, not be re-laid-out.
          fontVariantLigatures: 'none',
          tabSize: 4,
        }}
      >
        {error ? (
          <p style={{ color: LEVEL_COLOUR.ERROR }}>{error}</p>
        ) : !tail || tail.lines.length === 0 ? (
          <p style={{ color: '#6b7a90' }}>
            {tail && !tail.exists
              ? 'No log file yet — it appears once the backend has written something.'
              : 'Nothing matches those filters.'}
          </p>
        ) : (
          tail.lines.map((line: LogLine, index) => (
            <div
              key={`${index}-${line.raw.slice(0, 24)}`}
              className={`whitespace-pre-wrap break-all ${line.level ? '' : 'pl-5'}`}
              style={line.level ? undefined : { color: '#8b949e' }}
            >
              {line.level ? (
                <>
                  <span style={{ color: '#5c6773' }}>{line.at}</span>{' '}
                  <span style={{ color: LEVEL_COLOUR[line.level] ?? TERMINAL_FG, fontWeight: 600 }}>
                    {line.level}
                  </span>{' '}
                  <span style={{ color: '#7d8590' }}>{line.logger}</span>{' '}
                  <span>{line.message}</span>
                </>
              ) : (
                line.message
              )}
            </div>
          ))
        )}
      </div>
      {tail && (
        <p className="text-[10px] theme-text-muted mt-1.5">
          {tail.returned} lines · <code>{tail.path}</code>
        </p>
      )}
    </div>
  )
}

function BackupCard({ card }: { card: string }) {
  const [busy, setBusy] = useState<'export' | 'import' | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const doExport = useCallback(async () => {
    setBusy('export')
    setMessage(null)
    try {
      const filename = await downloadExport()
      setMessage({ ok: true, text: `Downloaded ${filename}` })
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : 'export failed' })
    } finally {
      setBusy(null)
    }
  }, [])

  const doImport = useCallback(async (file: File) => {
    setBusy('import')
    setMessage(null)
    try {
      // Strip a BOM: a backup edited in Notepad acquires one, and JSON.parse
      // reports it as a syntax error at position 0, which reads as corruption.
      const text = (await file.text()).replace(/^﻿/, '').trim()
      const result = await importData(JSON.parse(text))
      setMessage({
        ok: true,
        text: result.skipped.length
          ? `${result.detail} — skipped: ${result.skipped.join('; ')}`
          : result.detail,
      })
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : 'import failed' })
    } finally {
      setBusy(null)
    }
  }, [])

  return (
    <div className={card}>
      <h4 className="text-sm font-medium flex items-center gap-1.5 mb-1">
        <Download size={13} className="theme-accent" />
        Backup
      </h4>
      <p className="text-xs theme-text-muted mb-3 leading-relaxed">
        Preferences, the committed model and embedding choices, search and MCP
        configuration, and the tool policy — as one JSON file.{' '}
        <span className="theme-text">No credentials are included.</span> A backup gets
        emailed and left in a downloads folder, which is the wrong place for an API key,
        so keys are recorded as set/unset and re-entered after a restore.
      </p>

      <div className="flex items-center gap-2">
        <button
          onClick={doExport}
          disabled={!!busy}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border theme-border text-xs theme-text-muted hover:theme-text disabled:opacity-40 transition-colors"
        >
          {busy === 'export' ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
          Export
        </button>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={!!busy}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border theme-border text-xs theme-text-muted hover:theme-text disabled:opacity-40 transition-colors"
        >
          {busy === 'import' ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
          Import
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            if (file) void doImport(file)
          }}
        />
        <span className="text-[11px] theme-text-muted">Import is additive — nothing is deleted</span>
      </div>

      {message && (
        <p className={`text-[11px] mt-2 leading-relaxed ${message.ok ? 'status-ok' : 'status-warn'}`}>
          {message.text}
        </p>
      )}
    </div>
  )
}

function DangerCard({ card }: { card: string }) {
  const [categories, setCategories] = useState<WipeCategory[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [pending, setPending] = useState<WipeCategory | null>(null)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    fetchWipeCategories().then((d) => setCategories(d.categories)).catch(() => setCategories([]))
  }, [])

  const run = useCallback(async (kind: string) => {
    setBusy(kind)
    setMessage(null)
    try {
      const result = await wipe(kind)
      setMessage({ ok: true, text: result.detail })
    } catch (e) {
      setMessage({ ok: false, text: e instanceof Error ? e.message : 'that did not work' })
    } finally {
      setBusy(null)
      setPending(null)
    }
  }, [])

  const row = (category: WipeCategory) => (
    <div
      key={category.kind}
      // `items-center`, not `items-start`: the button is one line tall and the
      // copy beside it is two or three, so aligning to the top left it floating
      // against the heading instead of against the row.
      className="flex items-center justify-between gap-4 py-2.5 border-b theme-border last:border-b-0"
    >
      <div className="min-w-0">
        <div className={`text-xs ${category.grave ? 'status-warn' : 'theme-text'}`}>
          {category.label}
        </div>
        <p className="text-[11px] theme-text-muted leading-relaxed">{category.detail}</p>
      </div>
      {/* The word, not only the icon. A bin glyph is recognisable and it is not
          a sentence — on the row that empties the evaluation evidence, the
          button should say what it does.

          Red at rest rather than on hover. A destructive control that looks
          neutral until the pointer is already on it has done its warning too
          late, and `--status-bad` is the theme's own red, so it stays legible
          on a cream palette as well as a dark one. */}
      <button
        onClick={() => { setPending(category); setMessage(null) }}
        disabled={!!busy}
        className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg border text-[11px] font-medium status-bad status-bad-border status-bad-bg hover:opacity-80 disabled:opacity-40 transition-opacity shrink-0 min-w-20"
      >
        {busy === category.kind
          ? <Loader2 size={12} className="animate-spin" />
          : <Trash2 size={12} />}
        Delete
      </button>
    </div>
  )

  // The shared card class with its border swapped, rather than a second class
  // string: `.theme-border` and `.status-bad-border` are both `!important`, so
  // stacking them would leave the winner up to the order they happen to sit in
  // the stylesheet.
  return (
    <div className={card.replace('theme-border', 'status-bad-border')}>
      <h4 className="text-sm font-medium flex items-center gap-1.5 mb-1 status-bad">
        <AlertTriangle size={13} />
        Danger zone
      </h4>
      <p className="text-xs theme-text-muted mb-3 leading-relaxed">
        Irreversible, and each one targets a single category. The sensor database is not
        here and cannot be: Rule 2 gives that file to the SCADA subsystem and Daedalus
        opens it read-only. For a full reset including the schema, use{' '}
        <code>./reset.sh</code>, which snapshots first.
      </p>

      <div>
        {categories.map(row)}
        {categories.length > 0 && row({
          kind: 'everything',
          label: 'Everything above',
          detail: 'Every category in turn. One failure does not stop the rest, and the result says which.',
          grave: true,
        })}
      </div>

      {message && (
        <p className={`text-[11px] mt-3 leading-relaxed ${message.ok ? 'status-ok' : 'status-warn'}`}>
          {message.text}
        </p>
      )}

      {/* Graver categories ask for the word to be typed. Two clicks in a row can
          be muscle memory; typing DELETE cannot. */}
      <ConfirmDialog
        open={!!pending}
        danger
        title={`Delete ${pending?.label.toLowerCase() ?? ''}?`}
        body={
          <>
            <p>{pending?.detail}</p>
            <p className="mt-2 status-bad">This cannot be undone.</p>
            {pending?.grave && (
              <p className="mt-2">
                {pending.kind === 'audit'
                  ? 'These rows are what §9.2’s latency figures and the groundedness scoring are computed from. Anything already measured stops being reproducible.'
                  : 'Every category at once — transcripts, audit rows, the vector index, credentials and configuration.'}
              </p>
            )}
          </>
        }
        confirmLabel={busy ? 'Deleting…' : 'Delete'}
        requireTyped={pending?.grave ? 'DELETE' : undefined}
        busy={!!busy}
        onConfirm={() => pending && run(pending.kind)}
        onCancel={() => setPending(null)}
      />
    </div>
  )
}

export function SystemPanel({ isPeek }: { isPeek: boolean }) {
  const card = `p-5 rounded-xl border theme-border transition-colors ${isPeek ? 'bg-transparent' : 'theme-surface'}`

  return (
    <div className="space-y-5 animate-in fade-in duration-200">
      <div>
        <h3 className="text-xl font-medium mb-1">System</h3>
        <p className="text-sm theme-text-muted">
          What the backend is doing, how to carry it to another machine, and how to empty it.
        </p>
      </div>

      <LogsCard card={card} />
      <BackupCard card={card} />
      <DangerCard card={card} />
    </div>
  )
}
