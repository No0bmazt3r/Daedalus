import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, Ban, Check, ChevronDown, Loader2, Lock, LockOpen, Play, ShieldCheck,
  Wrench, X,
} from 'lucide-react'
import { Skeleton } from '../ui/skeleton'
import {
  fetchToolCatalogue,
  lockEffect,
  tryTool,
  unlockEffect,
  type AgentTool,
  type ToolCatalogue,
  type ToolEffect,
  type ToolResult,
} from '../../lib/toolsClient'

/**
 * Settings → Agent Tools.
 *
 * Layer 8, made inspectable. The list is generated on the backend from the same
 * declarations the dispatcher gates on, so this panel cannot show a permission
 * the runtime does not actually enforce — which is the only way a screen like
 * this is worth anything.
 *
 * Three things it shows that a plain tool list would not:
 *
 * 1. **Effects**, per tool. `network_egress` at runtime is refused by code, not
 *    by a sentence in a prompt, and the refusal is rendered with its reason.
 * 2. **Citability.** A result marked `transcript` may inform an answer and can
 *    never be its source (Rule 3, `PROJECT.md` §7.4). The badge is the same flag
 *    the orchestrator reads.
 * 3. **What is deliberately missing.** The tools Odysseus has and this does not,
 *    each with the rule that excludes it — because "we did not think of it" and
 *    "the rule forbids it" look identical in an absence.
 *
 * Try runs a tool for real, with a person watching, and logs it under a `try_`
 * query id so an experiment is distinguishable from an answer's evidence.
 */

const EFFECT_TONE: Record<ToolEffect, string> = {
  execute_code: 'status-bad',
  read_sensor: 'theme-text-muted',
  read_corpus: 'theme-text-muted',
  read_graph: 'theme-text-muted',
  read_transcript: 'status-warn',
  read_system: 'theme-text-muted',
  clock: 'theme-text-muted',
  inference: 'theme-text-muted',
  user_interaction: 'theme-text-muted',
  network_egress: 'status-bad',
  write: 'status-bad',
  admin: 'status-bad',
}

const INTEGRITY_HINT = {
  system: "Daedalus' own output, from its own stores. Trusted.",
  corpus:
    'Text out of an ingested document. Quotable as evidence, never obeyed as instruction — a document can contain anything, including instructions aimed at a model reading it.',
  transcript:
    'Something the model said in an earlier turn. Untrusted and stale: the number in it was true then and was never re-fetched.',
} as const

const EFFECT_CONSEQUENCE: Record<string, string> = {
  network_egress:
    'Lets the assistant search and fetch the web mid-answer. Breaks Rule 1 for as long as it is open, and any groundedness measured while it is open is measuring a different system.',
  write:
    'Lets the assistant create conversations and post into them, and write files inside its workspace directory. Writes are labelled as tool-authored.',
  admin:
    'Lets the assistant read the benchmark endpoint list and change the active retrieval track. It can never read a credential, and the track is still refused while the comparison is frozen.',
  execute_code:
    'Lets the assistant run shell commands and Python on this machine, inside its workspace, with a timeout and a pattern denylist. That is containment, not a sandbox — run Daedalus in its container if the boundary needs to be real.',
}

function Badge({ children, tone = 'muted', title }: {
  children: React.ReactNode; tone?: string; title?: string
}) {
  return (
    <span
      title={title}
      className={`text-[10px] px-1.5 py-0.5 rounded border theme-border uppercase tracking-wide shrink-0 ${
        tone === 'muted' ? 'theme-text-muted' : tone
      }`}
    >
      {children}
    </span>
  )
}

function ToolRow({ tool, card }: { tool: AgentTool; card: string }) {
  const [open, setOpen] = useState(false)
  const [args, setArgs] = useState<Record<string, string>>({})
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<ToolResult | null>(null)

  const run = useCallback(async () => {
    setRunning(true)
    setResult(null)
    try {
      // Everything arrives from a text input as a string. The backend validator
      // is the authority on types, so this converts only what it can prove —
      // a number-ish string for a number-ish param, a comma list for a list —
      // and lets the declaration reject anything else with a readable reason.
      const typed: Record<string, unknown> = {}
      for (const param of tool.params) {
        const raw = (args[param.name] ?? '').trim()
        if (!raw) continue
        if (param.type === 'int') typed[param.name] = Number(raw)
        else if (param.type === 'bool') typed[param.name] = raw === 'true'
        else if (param.type === 'list') typed[param.name] = raw.split(',').map((s) => s.trim())
        else typed[param.name] = raw
      }
      setResult(await tryTool(tool.name, typed))
    } catch (e) {
      setResult({
        tool: tool.name, category: tool.category, ok: false, status: 'error',
        integrity: 'system', citable: false, data: null,
        detail: e instanceof Error ? e.message : 'the call failed', elapsed_ms: 0,
      })
    } finally {
      setRunning(false)
    }
  }, [args, tool])

  return (
    <div className="rounded-xl border theme-border overflow-hidden">
      <div className="flex items-start gap-3 p-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <code className="text-sm theme-text">{tool.name}</code>
            {tool.effects.map((e) => (
              <Badge key={e} tone={EFFECT_TONE[e]} title={`Effect: ${e}`}>
                {e.replace('read_', '')}
              </Badge>
            ))}
            {!tool.citable && (
              <Badge tone="status-warn" title="Rule 3: may inform an answer, never be its source.">
                not evidence
              </Badge>
            )}
            {!tool.available && (
              <Badge tone="status-bad" title={tool.refused_because ?? tool.blocked_by ?? ''}>
                unavailable
              </Badge>
            )}
          </div>
          <p className="text-[11px] theme-text-muted leading-relaxed mt-1">{tool.summary}</p>
          {(tool.refused_because || tool.blocked_by) && (
            <p className="text-[11px] status-warn mt-1">
              {tool.refused_because ?? `waiting on ${tool.blocked_by}`}
            </p>
          )}
        </div>
        <button
          onClick={() => setOpen((v) => !v)}
          title="Arguments, and a way to run it."
          className="p-1.5 rounded-lg theme-text-muted hover:theme-text transition-colors shrink-0"
        >
          <ChevronDown size={14} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>

      {open && (
        <div className={`border-t theme-border p-3 space-y-3 ${card}`}>
          <div className="flex items-center gap-2 text-[10px] theme-text-muted">
            <ShieldCheck size={11} />
            <span title={INTEGRITY_HINT[tool.integrity]}>
              returns <code className="theme-text">{tool.integrity}</code> ·{' '}
              {tool.citable ? 'citable as evidence' : 'never citable'}
            </span>
          </div>

          {tool.params.length === 0 ? (
            <p className="text-[11px] theme-text-muted">Takes no arguments.</p>
          ) : (
            <div className="space-y-2">
              {tool.params.map((p) => (
                <div key={p.name} className="flex flex-col gap-1">
                  <label className="text-[11px] theme-text-muted">
                    <code className="theme-text">{p.name}</code>
                    <span className="opacity-60">
                      {' '}· {p.type}{p.required ? ' · required' : ''}
                      {p.enum ? ` · one of ${p.enum.join(', ')}` : ''}
                      {p.maximum !== null ? ` · max ${p.maximum}` : ''}
                    </span>
                  </label>
                  <input
                    value={args[p.name] ?? ''}
                    onChange={(e) => setArgs((a) => ({ ...a, [p.name]: e.target.value }))}
                    placeholder={p.description}
                    className="w-full px-2.5 py-1.5 rounded-lg border theme-border theme-surface-strong theme-text text-xs outline-none placeholder:opacity-40"
                  />
                </div>
              ))}
            </div>
          )}

          <button
            onClick={run}
            disabled={running || !tool.available}
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border theme-border text-xs theme-text-muted hover:theme-text disabled:opacity-40 transition-colors"
          >
            {running ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
            Run
          </button>

          {result && (
            <div
              className={`rounded-lg border p-2.5 text-[11px] ${
                result.ok ? 'status-ok-border status-ok-bg' : 'status-warn-border status-warn-bg'
              }`}
            >
              <div className="flex items-center gap-1.5 flex-wrap">
                {result.ok ? (
                  <Check size={12} className="status-ok" />
                ) : (
                  <X size={12} className="status-warn" />
                )}
                <code className="theme-text">{result.status}</code>
                <span className="theme-text-muted">· {result.elapsed_ms}ms</span>
                {!result.citable && result.ok && (
                  <Badge tone="status-warn" title="This result may not be cited.">
                    not evidence
                  </Badge>
                )}
              </div>
              <p className="theme-text mt-1 leading-relaxed">{result.detail}</p>
              {result.data !== null && result.data !== undefined && (
                <pre className="mt-2 max-h-52 overflow-auto text-[10px] theme-text-muted whitespace-pre-wrap break-words">
                  {JSON.stringify(result.data, null, 2)}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function PolicyCard({ catalogue, onChange, card }: {
  catalogue: ToolCatalogue
  onChange: (next: ToolCatalogue) => void
  card: string
}) {
  const [pending, setPending] = useState<ToolEffect | null>(null)
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)

  const open = new Map(catalogue.unlocked.map((u) => [u.effect, u]))

  const submit = async (effect: ToolEffect) => {
    setError(null)
    try {
      onChange(await unlockEffect(effect, note))
      setPending(null)
      setNote('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not unlock')
    }
  }

  return (
    <div className={card}>
      <div className="flex items-start justify-between gap-3 mb-1">
        <h4 className="text-sm font-medium flex items-center gap-1.5">
          <LockOpen size={13} className={open.size ? 'status-warn' : 'theme-text-muted'} />
          Extended capabilities
        </h4>
        {open.size > 0 && (
          <button
            onClick={async () => onChange(await lockEffect())}
            className="text-[11px] flex items-center gap-1 px-2 py-1 rounded-lg border theme-border theme-text-muted hover:theme-text transition-colors"
          >
            <Lock size={11} /> Lock all
          </button>
        )}
      </div>
      <p className="text-xs theme-text-muted mb-3 leading-relaxed">
        The four effects the runtime gate gets to refuse. All four ship <em>open</em>:
        this is a single-operator console and the operator is the admin, so four
        confirmation clicks between you and your own tools would protect nobody. Closing
        one takes effect on the next call, and the reason is stored either way — it is
        what answers “what was this system allowed to do when that benchmark was
        recorded?” months later. <span className="theme-text">Lock all</span> returns the
        system to the fully-offline, read-only shape <code>PROJECT.md</code> §3 describes,
        which is what to do before recording a number you intend to cite.
      </p>

      <div className="space-y-2">
        {catalogue.unlockable.map((effect) => {
          const unlocked = open.get(effect)
          return (
            <div key={effect} className="rounded-lg border theme-border p-2.5">
              <div className="flex items-start gap-2">
                {unlocked ? (
                  <LockOpen size={12} className="status-warn mt-0.5 shrink-0" />
                ) : (
                  <Lock size={12} className="theme-text-muted mt-0.5 shrink-0" />
                )}
                <div className="min-w-0 flex-1">
                  <code className="text-[11px] theme-text">{effect}</code>
                  <p className="text-[11px] theme-text-muted leading-relaxed mt-0.5">
                    {EFFECT_CONSEQUENCE[effect]}
                  </p>
                  {unlocked && (
                    <p className="text-[10px] status-warn mt-1">
                      open since {new Date(unlocked.unlocked_at).toLocaleString()} ·{' '}
                      <span className="theme-text-muted">“{unlocked.note}”</span>
                    </p>
                  )}
                </div>
                {unlocked ? (
                  <button
                    onClick={async () => onChange(await lockEffect(effect))}
                    className="text-[11px] px-2 py-1 rounded-lg border theme-border theme-text-muted hover:theme-text transition-colors shrink-0"
                  >
                    Lock
                  </button>
                ) : (
                  <button
                    onClick={() => { setPending(pending === effect ? null : effect); setNote('') }}
                    className="text-[11px] px-2 py-1 rounded-lg border theme-border theme-text-muted hover:theme-text transition-colors shrink-0"
                  >
                    Unlock
                  </button>
                )}
              </div>

              {pending === effect && (
                <div className="mt-2 flex gap-2">
                  <input
                    autoFocus
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && note.trim()) void submit(effect) }}
                    placeholder="Why — e.g. “measuring what web access does to groundedness”"
                    className="flex-1 px-2.5 py-1.5 rounded-lg border theme-border theme-surface-strong theme-text text-xs outline-none placeholder:opacity-40"
                  />
                  <button
                    onClick={() => submit(effect)}
                    disabled={!note.trim()}
                    className="text-[11px] px-2.5 rounded-lg border theme-border theme-text-muted hover:theme-text disabled:opacity-40 transition-colors"
                  >
                    Confirm
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
      {error && (
        <p className="flex items-center gap-1.5 text-xs status-warn mt-2">
          <AlertTriangle size={12} /> {error}
        </p>
      )}
    </div>
  )
}

export function AgentToolsPanel({ isPeek }: { isPeek: boolean }) {
  const [catalogue, setCatalogue] = useState<ToolCatalogue | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchToolCatalogue()
      .then(setCatalogue)
      .catch((e: Error) => setError(e.message))
  }, [])

  const byCategory = useMemo(() => {
    const map = new Map<string, AgentTool[]>()
    for (const tool of catalogue?.tools ?? []) {
      map.set(tool.category, [...(map.get(tool.category) ?? []), tool])
    }
    return map
  }, [catalogue])

  const card = `p-5 rounded-xl border theme-border transition-colors ${isPeek ? 'bg-transparent' : 'theme-surface'}`

  if (error) {
    return (
      <p className="flex items-center gap-2 text-xs status-warn">
        <AlertTriangle size={13} /> {error}
      </p>
    )
  }
  if (!catalogue) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <div>
        <h3 className="text-xl font-medium mb-1">Agent Tools</h3>
        <p className="text-sm theme-text-muted">
          What the orchestrator may call, what each call is allowed to touch, and what
          its result may be used for.
        </p>
      </div>

      {/* The gate, stated once. This is the panel's actual claim: the list below
          is generated from the code that enforces it, not written beside it. */}
      <div className="flex gap-3 p-4 rounded-xl border theme-border">
        <ShieldCheck size={16} className="shrink-0 mt-0.5 theme-accent" />
        <div className="text-xs leading-relaxed theme-text-muted">
          <span className="font-medium theme-text">Checked before the call, not after.</span>{' '}
          Every tool declares its effects, its parameters and the integrity of what it
          returns, and dispatch verifies all three before the function is entered. A tool
          declaring{' '}
          {catalogue.forbidden_at_runtime.map((e, i) => (
            <span key={e}>
              {i > 0 && ', '}
              <code className="status-bad">{e}</code>
            </span>
          ))}{' '}
          is refused on the runtime surface — that is Rule 1 and Rule 5 in code rather
          than in a prompt. Every call is logged to <code>tool_logs</code> with its
          arguments, status and latency.
        </div>
      </div>

      {catalogue.unlocked.length > 0 && (
        <div className="flex gap-3 p-4 rounded-xl border status-warn-border status-warn-bg">
          <AlertTriangle size={16} className="shrink-0 mt-0.5 status-warn" />
          <div className="text-xs leading-relaxed theme-text-muted">
            <span className="font-medium theme-text">
              {catalogue.unlocked.length} extended{' '}
              {catalogue.unlocked.length === 1 ? 'capability is' : 'capabilities are'} open.
            </span>{' '}
            Convenient, and not the configuration <code>PROJECT.md</code> §3 describes.
            Anything measured in this state — groundedness especially — describes a
            system with web access and a shell, so lock them before recording a result
            you intend to cite.
          </div>
        </div>
      )}

      <PolicyCard catalogue={catalogue} onChange={setCatalogue} card={card} />

      {catalogue.categories.map((category) => {
        const tools = byCategory.get(category.id) ?? []
        if (!tools.length) return null
        return (
          <div key={category.id} className="space-y-2">
            <div className="flex items-baseline gap-2">
              <h4 className="text-sm font-medium flex items-center gap-1.5">
                <Wrench size={13} className="theme-accent" />
                {category.id}
              </h4>
              <span className="text-[11px] theme-text-muted">{category.description}</span>
            </div>
            <div className="space-y-2">
              {tools.map((tool) => (
                <ToolRow key={tool.name} tool={tool} card={card} />
              ))}
            </div>
          </div>
        )
      })}

      {/* An absence is not self-explaining. */}
      <div className={card}>
        <h4 className="text-sm font-medium flex items-center gap-1.5 mb-1">
          <Ban size={13} className="theme-text-muted" />
          Not implemented
        </h4>
        <p className="text-xs theme-text-muted mb-3">
          This list has shrunk twice, both times because a capability refused by the gate
          is a better record than one that was never built. What is left is not withheld —
          there is genuinely nothing behind it.
        </p>
        <div className="space-y-2.5">
          {catalogue.excluded.map((e) => (
            <div key={e.name} className="min-w-0">
              <code className="text-[11px] theme-text">{e.name}</code>
              <span className="text-[10px] theme-text-muted"> · {e.category}</span>
              <p className="text-[11px] theme-text-muted leading-relaxed">{e.reason}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
