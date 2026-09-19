import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle, Check, Link as LinkIcon, Loader2, Pin, Play, Plus, Trash2, X,
} from 'lucide-react'
import { ThemeSelect } from '../ui/theme-select'
import { Skeleton } from '../ui/skeleton'
import {
  addMcpServer,
  deleteMcpServer,
  fetchMcpServers,
  pinMcpServer,
  setMcpServerEnabled,
  testMcpServer,
  type McpServer,
  type McpStatus,
  type McpTestResult,
} from '../../lib/mcpClient'

/**
 * Settings → Integrations.
 *
 * External service connections in one place, which for Daedalus means MCP
 * servers. Same shape as the Odysseus panel this follows: a list, and a button
 * to add to it.
 *
 * ## The one thing this screen exists to make visible
 *
 * Every other tool in the project is declared in Python and reviewed in a diff.
 * An MCP server declares its own tools at connect time and can declare different
 * ones tomorrow — which is the point of the protocol, and is in tension with
 * `PROJECT.md` §7.2 (the tool layer is deterministic and whitelisted) and §5
 * (both tracks are frozen while the comparison runs).
 *
 * So a server's tool list is **pinned**: written down, hashed, and compared on
 * every connection. A difference is reported as drift and the new tool is
 * refused until somebody re-pins. That makes "the agent had a tool nobody wrote
 * down" a thing this screen says out loud rather than a gap in a results
 * chapter.
 *
 * Pinning is deliberately not automatic. A snapshot that followed whatever the
 * server last said would be no snapshot at all.
 */

function relativeTime(iso: string | null): string {
  if (!iso) return 'never'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return iso
  const seconds = Math.round((Date.now() - then) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`
  return `${Math.round(seconds / 86400)}d ago`
}

function ServerRow({ server, onChange }: {
  server: McpServer
  onChange: (next: McpStatus) => void
}) {
  const [busy, setBusy] = useState<'test' | 'pin' | null>(null)
  const [result, setResult] = useState<McpTestResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const act = useCallback(async (what: 'test' | 'pin') => {
    setBusy(what)
    setError(null)
    try {
      if (what === 'test') {
        const r = await testMcpServer(server.id)
        setResult(r)
        onChange(await fetchMcpServers())
      } else {
        setResult(null)
        onChange(await pinMcpServer(server.id))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'that did not work')
    } finally {
      setBusy(null)
    }
  }, [onChange, server.id])

  return (
    <div className="rounded-xl border theme-border p-3 space-y-2">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <code className="text-sm theme-text">{server.label}</code>
            <span className="text-[10px] px-1.5 py-0.5 rounded border theme-border theme-text-muted uppercase tracking-wide">
              {server.transport}
            </span>
            {server.tools_pinned_at ? (
              <span className="text-[10px] status-ok" title={`Snapshot hash ${server.tools_hash}`}>
                {server.tool_count} tools pinned
              </span>
            ) : (
              <span className="text-[10px] status-warn" title="Nothing is pinned, so no tool on this server can be called yet.">
                not pinned
              </span>
            )}
            {!server.enabled && <span className="text-[10px] theme-text-muted">disabled</span>}
          </div>
          <code className="text-[10px] theme-text-muted break-all">
            {server.transport === 'stdio'
              ? [server.command, ...server.args].join(' ')
              : server.url}
          </code>
          <div className="text-[10px] theme-text-muted mt-0.5">
            {server.server_name
              ? `${server.server_name} ${server.server_version ?? ''} · MCP ${server.protocol_version ?? '?'} · `
              : ''}
            connected {relativeTime(server.last_connected_at)}
            {server.has_headers && ` · ${server.header_keys.length} headers`}
            {server.env_keys.length > 0 && ` · ${server.env_keys.length} env`}
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => act('test')}
            disabled={!!busy}
            title="Connect and list the tools it currently offers."
            className="p-1.5 rounded-lg border theme-border theme-text-muted hover:theme-text disabled:opacity-40 transition-colors"
          >
            {busy === 'test' ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
          </button>
          <button
            onClick={() => act('pin')}
            disabled={!!busy}
            title="Freeze the current tool list as the one of record. Drift is measured against it, and only pinned tools can be called."
            className="p-1.5 rounded-lg border theme-border theme-text-muted hover:theme-text disabled:opacity-40 transition-colors"
          >
            {busy === 'pin' ? <Loader2 size={12} className="animate-spin" /> : <Pin size={12} />}
          </button>
          <button
            onClick={async () => onChange(await setMcpServerEnabled(server.id, !server.enabled))}
            title={server.enabled ? 'Disable — kept, but refused by tool calls.' : 'Enable.'}
            className="p-1.5 rounded-lg border theme-border theme-text-muted hover:theme-text transition-colors"
          >
            {server.enabled ? <Check size={12} className="status-ok" /> : <X size={12} />}
          </button>
          <button
            onClick={async () => onChange(await deleteMcpServer(server.id))}
            title="Remove this server."
            className="p-1.5 rounded-lg border theme-border theme-text-muted hover:text-[var(--status-bad)] transition-colors"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {server.tools && server.tools.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {server.tools.map((t) => (
            <span
              key={t.name}
              title={t.description}
              className="text-[10px] px-1.5 py-0.5 rounded border theme-border theme-text-muted"
            >
              {t.name}
            </span>
          ))}
        </div>
      )}

      {error && (
        <p className="flex items-center gap-1.5 text-[11px] status-warn">
          <AlertTriangle size={11} /> {error}
        </p>
      )}

      {result && (
        <div
          className={`rounded-lg border p-2 text-[11px] ${
            result.drifted
              ? 'status-warn-border status-warn-bg'
              : result.ok
                ? 'status-ok-border status-ok-bg'
                : 'status-warn-border status-warn-bg'
          }`}
        >
          <p className="theme-text">{result.detail}</p>
          {result.drifted && (
            <p className="theme-text-muted mt-1 leading-relaxed">
              The live tool list no longer matches the snapshot. Tools that are not pinned
              are refused, so nothing new can be called until you re-pin — which is the
              moment to decide whether a changed tool list is one you want results
              attributed to.
            </p>
          )}
        </div>
      )}
    </div>
  )
}

export function IntegrationsPanel({ isPeek }: { isPeek: boolean }) {
  const [status, setStatus] = useState<McpStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [saving, setSaving] = useState(false)

  const [label, setLabel] = useState('')
  const [transport, setTransport] = useState<'stdio' | 'http'>('stdio')
  const [command, setCommand] = useState('')
  const [args, setArgs] = useState('')
  const [url, setUrl] = useState('')

  useEffect(() => {
    fetchMcpServers().then(setStatus).catch((e: Error) => setError(e.message))
  }, [])

  const submit = useCallback(async () => {
    setSaving(true)
    setError(null)
    try {
      setStatus(await addMcpServer({
        label: label.trim(),
        transport,
        command: transport === 'stdio' ? command.trim() : null,
        // Split on whitespace: an MCP command line is a program and flags, and
        // asking for JSON here would be ceremony for `-y @scope/server`.
        args: transport === 'stdio'
          ? args.split(/\s+/).map((a) => a.trim()).filter(Boolean)
          : [],
        url: transport === 'http' ? url.trim() : null,
      }))
      setAdding(false)
      setLabel(''); setCommand(''); setArgs(''); setUrl('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not add that server')
    } finally {
      setSaving(false)
    }
  }, [args, command, label, transport, url])

  const card = `p-5 rounded-xl border theme-border transition-colors ${isPeek ? 'bg-transparent' : 'theme-surface'}`
  const field =
    'w-full px-3 py-2 rounded-lg border theme-border theme-surface-strong theme-text text-sm outline-none focus:ring-1 focus:ring-[color-mix(in_srgb,var(--primary)_55%,transparent)] placeholder:opacity-40'

  if (!status) {
    return error ? (
      <p className="flex items-center gap-2 text-xs status-warn">
        <AlertTriangle size={13} /> {error}
      </p>
    ) : (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-5 animate-in fade-in duration-200">
      <div>
        <h3 className="text-xl font-medium mb-1">Integrations</h3>
        <p className="text-sm theme-text-muted">
          External tool servers, over MCP {status.protocol_version}. Their tools reach the
          agent through one proxy, so they pass the same gate as everything else.
        </p>
      </div>

      <div className="flex gap-3 p-4 rounded-xl border theme-border">
        <LinkIcon size={16} className="shrink-0 mt-0.5 theme-accent" />
        <div className="text-xs leading-relaxed theme-text-muted">
          <span className="font-medium theme-text">Pinned, or not callable.</span>{' '}
          An MCP server declares its own tools and can declare different ones tomorrow.
          Pinning writes that list down and hashes it; a later connection that differs is
          reported as drift, and a tool outside the snapshot is refused. That is how §7.2's
          “deterministic and whitelisted” survives a protocol designed to be neither.
          Locking <code>execute_code</code>, <code>network_egress</code> or{' '}
          <code>write</code> in Agent Tools closes MCP entirely.
        </div>
      </div>

      <div className="space-y-2">
        {status.servers.map((server) => (
          <ServerRow key={server.id} server={server} onChange={setStatus} />
        ))}
        {status.servers.length === 0 && !adding && (
          <p className="text-xs theme-text-muted italic px-3 py-5 rounded-xl border border-dashed theme-border">
            No servers configured. A stdio server is a command this machine runs; an HTTP
            server is a URL it posts to.
          </p>
        )}
      </div>

      {adding ? (
        <div className={card}>
          <div className="grid gap-3 @lg:grid-cols-[minmax(0,10rem)_1fr]">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium theme-text-muted">Transport</label>
              <ThemeSelect
                value={transport}
                onChange={(v) => setTransport(v as 'stdio' | 'http')}
                ariaLabel="Transport"
                options={[
                  { value: 'stdio', label: 'stdio (a command)' },
                  { value: 'http', label: 'http (a URL)' },
                ]}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium theme-text-muted">Label</label>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="how a tool call names it, e.g. filesystem"
                className={field}
              />
            </div>
          </div>

          {transport === 'stdio' ? (
            <div className="grid gap-3 @lg:grid-cols-2 mt-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium theme-text-muted">Command</label>
                <input
                  value={command}
                  onChange={(e) => setCommand(e.target.value)}
                  placeholder="npx"
                  className={`${field} font-mono`}
                  spellCheck={false}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium theme-text-muted">Arguments</label>
                <input
                  value={args}
                  onChange={(e) => setArgs(e.target.value)}
                  placeholder="-y @modelcontextprotocol/server-filesystem /path"
                  className={`${field} font-mono`}
                  spellCheck={false}
                />
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-1.5 mt-3">
              <label className="text-xs font-medium theme-text-muted">URL</label>
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="http://localhost:3000/mcp"
                className={`${field} font-mono`}
                spellCheck={false}
              />
            </div>
          )}

          <p className="text-[11px] theme-text-muted mt-2 leading-relaxed">
            A stdio server is a program this backend starts, with a scrubbed environment —
            it never inherits <code>.env</code>. Adding one is an operator action for that
            reason: the agent can call servers, but cannot create them.
          </p>

          <div className="flex items-center gap-3 mt-4">
            <button
              onClick={submit}
              disabled={saving || !label.trim() || (transport === 'stdio' ? !command.trim() : !url.trim())}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium theme-bg-primary theme-text-on-primary hover:opacity-80 disabled:opacity-40 transition-opacity"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
              Add
            </button>
            <button
              onClick={() => { setAdding(false); setError(null) }}
              className="text-xs theme-text-muted hover:theme-text transition-colors"
            >
              Cancel
            </button>
            {error && (
              <span className="flex items-center gap-1.5 text-xs status-warn">
                <AlertTriangle size={12} /> {error}
              </span>
            )}
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg border theme-border text-xs theme-text-muted hover:theme-text transition-colors"
        >
          <Plus size={13} /> Add MCP server
        </button>
      )}
    </div>
  )
}
