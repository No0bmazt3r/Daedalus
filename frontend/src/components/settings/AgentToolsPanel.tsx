import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, Check, ChevronDown, Loader2, Play, ShieldCheck, Wand2, X,
} from 'lucide-react'
import { Skeleton } from '../ui/skeleton'
import { Collapse } from '../ui/collapse'
import { Switch } from '../ui/switch'
import {
  disableTool,
  enableTool,
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
 * the runtime does not actually enforce.
 *
 * ## Why this is compact
 *
 * An earlier version explained the capability model in three paragraphs above
 * the thing it described, and carried a standing warning about every capability
 * being open. Both were written when the four extended effects shipped *closed*
 * and opening one was an event. They ship open now, so the warning fired
 * permanently — and a warning that is always on is decoration.
 *
 * What is left is the part that changes: which effects are on, what each tool
 * may touch, and whether its result may be cited. The reasoning lives in
 * `services/agent_tools/registry.py` and `docs/FEATURES.md`, where it can be
 * read once rather than on every visit.
 *
 * ## Two switches, on purpose
 *
 * The capability chips answer "what is this machine permitted to do while a
 * result is being recorded". The per-tool switch answers "which tools should
 * the model be choosing between". They are not interchangeable: closing
 * `network_egress` to quiet one tool also closes the three that share the
 * effect, and hiding one tool says nothing about the safety envelope. A
 * switched-off tool leaves the schema list the model is given and is refused if
 * it asks by name anyway.
 *
 * ## Nothing here needs testing
 *
 * Expanding a row offers a trial run. It is inspection, not setup — no state is
 * recorded, nothing gates on it, and the orchestrator never takes that path. It
 * exists so a reader can see what a tool actually returns instead of trusting a
 * table. The copy says so, because a list of 29 rows each with a Run button
 * reads as a checklist somebody is expected to work through.
 *
 * ## The one claim it must not get wrong
 *
 * "Refused on the runtime surface" has to mean *refused right now*. The header
 * reads `catalogue.locked`, which is the same row the gate consults, rather
 * than the static `forbidden_at_runtime` set — printing the latter is how the
 * panel ended up announcing a refusal that had not happened since the default
 * changed.
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

/** What opening each one actually allows. Tooltips, not body copy. */
const EFFECT_CONSEQUENCE: Record<string, string> = {
  network_egress: 'Web search and page fetches during an answer. Breaks Rule 1 while open.',
  write: 'Create conversations, post into them, remember facts, write files in the agent workspace.',
  admin: 'Manage benchmark endpoints and the active retrieval track. Never reads a credential.',
  execute_code: 'Run shell commands and Python in the workspace, with a timeout and a denylist. Containment, not a sandbox.',
}

const INTEGRITY_HINT = {
  system: "Daedalus' own output, from its own stores. Trusted.",
  corpus:
    'Text from a document, page or program output this system did not write. Quotable as evidence, never obeyed as instruction.',
  transcript:
    'Something said in an earlier turn. Untrusted and stale: the number in it was true then and was never re-checked.',
} as const

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

/** The four extended effects as toggles. One line each, consequence on hover. */
function Capabilities({ catalogue, onChange }: {
  catalogue: ToolCatalogue
  onChange: (next: ToolCatalogue) => void
}) {
  const [busy, setBusy] = useState<ToolEffect | null>(null)
  const closed = new Set(catalogue.locked.map((l) => l.effect))

  const toggle = useCallback(async (effect: ToolEffect, isOpen: boolean) => {
    setBusy(effect)
    try {
      onChange(isOpen
        ? await lockEffect(effect, 'Locked from Settings → Agent Tools')
        : await unlockEffect(effect))
    } finally {
      setBusy(null)
    }
  }, [onChange])

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {catalogue.unlockable.map((effect) => {
        const isOpen = !closed.has(effect)
        return (
          <button
            key={effect}
            onClick={() => toggle(effect, isOpen)}
            disabled={busy === effect}
            title={`${EFFECT_CONSEQUENCE[effect]}\n\nClick to turn ${isOpen ? 'off' : 'on'}.`}
            className={`flex items-center gap-1.5 px-2 py-1 rounded-lg border text-[11px] transition-colors disabled:opacity-40 ${
              isOpen
                ? 'status-ok-border status-ok-bg theme-text'
                : 'theme-border theme-text-muted hover:theme-text'
            }`}
          >
            {busy === effect
              ? <Loader2 size={11} className="animate-spin" />
              : isOpen ? <Check size={11} className="status-ok" /> : <X size={11} />}
            <code>{effect}</code>
          </button>
        )
      })}
      <button
        onClick={async () => {
          onChange(closed.size === catalogue.unlockable.length
            ? await unlockEffect()
            : await lockEffect(undefined, 'Locked all from Settings → Agent Tools'))
        }}
        title={
          closed.size === catalogue.unlockable.length
            ? 'Reopen all four — the default for a single-operator console.'
            : 'Close all four: the fully-offline, read-only shape PROJECT.md §3 describes. Do this before recording a result you intend to cite.'
        }
        className="text-[11px] px-2 py-1 rounded-lg theme-text-muted hover:theme-text transition-colors"
      >
        {closed.size === catalogue.unlockable.length ? 'unlock all' : 'lock all'}
      </button>
    </div>
  )
}

function ToolRow({ tool, onChange }: {
  tool: AgentTool
  onChange: (next: ToolCatalogue) => void
}) {
  const [open, setOpen] = useState(false)
  const [args, setArgs] = useState<Record<string, string>>({})
  const [running, setRunning] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [result, setResult] = useState<ToolResult | null>(null)

  // Declared alongside each parameter on the backend, so an example is a value
  // the validator actually accepts rather than a line of prose about one.
  const examples = useMemo(() => {
    const out: Record<string, string> = {}
    for (const p of tool.params) {
      // A required enum needs no example to *read* — the placeholder prints the
      // permitted set — but it does need one to fill, or the trial it produces
      // fails validation on a parameter the panel was already showing you.
      const filler = p.example ?? (p.required && p.enum?.length ? p.enum[0] : null)
      if (filler) out[p.name] = filler
    }
    return out
  }, [tool.params])
  const hasExamples = Object.keys(examples).length > 0

  // A trial that only reads is filled in for you; one that changes something
  // makes you ask for it. Both are one click from running — the difference is
  // whether the click that *opened* a row is also the one that loaded a command
  // into `bash`.
  const changesSomething = tool.effects.some(
    (e) => e === 'write' || e === 'admin' || e === 'execute_code' || e === 'network_egress'
  )

  const toggleOpen = useCallback(() => {
    const next = !open
    setOpen(next)
    if (next && hasExamples && !changesSomething && Object.keys(args).length === 0) {
      setArgs(examples)
    }
  }, [open, args, examples, hasExamples, changesSomething])

  const toggleEnabled = useCallback(async () => {
    setSwitching(true)
    try {
      onChange(tool.disabled
        ? await enableTool(tool.name)
        : await disableTool(tool.name, 'Switched off from Settings → Agent Tools'))
    } finally {
      setSwitching(false)
    }
  }, [onChange, tool.disabled, tool.name])

  const run = useCallback(async () => {
    setRunning(true)
    setResult(null)
    try {
      // Everything arrives from a text input as a string. The backend validator
      // is the authority on types, so this converts only what it can prove and
      // lets the declaration reject anything else with a readable reason.
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
    <div className="border-b theme-border last:border-b-0">
      <div className="flex items-center gap-2">
      <button
        onClick={toggleOpen}
        className={`flex-1 min-w-0 flex items-center gap-2 py-1.5 text-left hover:opacity-80 transition-opacity ${
          tool.disabled ? 'opacity-45' : ''
        }`}
      >
        <ChevronDown
          size={12}
          className={`shrink-0 theme-text-muted transition-transform ${open ? 'rotate-180' : '-rotate-90'}`}
        />
        <code className="text-[11px] theme-text shrink-0">{tool.name}</code>
        <span className="text-[11px] theme-text-muted truncate flex-1">{tool.summary}</span>
        {!tool.citable && (
          <Badge tone="status-warn" title="Rule 3: may inform an answer, never be its source.">
            not evidence
          </Badge>
        )}
        {tool.effects.map((e) => (
          <Badge key={e} tone={EFFECT_TONE[e]} title={`Effect: ${e}`}>
            {e.replace('read_', '')}
          </Badge>
        ))}
        {!tool.available && !tool.disabled && (
          <Badge tone="status-bad" title={tool.refused_because ?? tool.blocked_by ?? ''}>
            off
          </Badge>
        )}
      </button>
      <div
        className="shrink-0 scale-[0.72] origin-right"
        title={
          tool.disabled
            ? `${tool.name} is OFF: not offered to the model, and refused if it asks anyway.`
            : `${tool.name} is ON: in the model's tool list. Turning it off does not change what it may touch — that is the capability row above.`
        }
      >
        <Switch
          checked={!tool.disabled}
          onChange={() => void toggleEnabled()}
          disabled={switching}
          label={`${tool.name} — on or off`}
        />
      </div>
      </div>

      <Collapse open={open} className="pb-3 pl-6 space-y-2">
          <p className="text-[10px] theme-text-muted" title={INTEGRITY_HINT[tool.integrity]}>
            returns <code className="theme-text">{tool.integrity}</code> ·{' '}
            {tool.citable ? 'citable as evidence' : 'never citable'}
            {tool.refused_because && <span className="status-warn"> · {tool.refused_because}</span>}
          </p>

          {tool.params.map((p) => (
            <input
              key={p.name}
              value={args[p.name] ?? ''}
              onChange={(e) => setArgs((a) => ({ ...a, [p.name]: e.target.value }))}
              placeholder={
                `${p.name}${p.required ? '*' : ''} · ${
                  p.enum ? p.enum.join(' | ') : p.example ? `e.g. ${p.example}` : p.type
                }`
              }
              title={p.description}
              className="w-full px-2.5 py-1.5 rounded-lg border theme-border theme-surface-strong theme-text text-xs outline-none placeholder:opacity-40"
            />
          ))}

          <div className="flex items-center gap-2">
            <button
              onClick={run}
              disabled={running || !tool.available}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border theme-border text-[11px] theme-text-muted hover:theme-text disabled:opacity-40 transition-colors"
            >
              {running ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
              Try it
            </button>
            {hasExamples && (
              <button
                onClick={() => setArgs(examples)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg border theme-border text-[11px] theme-text-muted hover:theme-text transition-colors"
              >
                <Wand2 size={11} />
                Use example
              </button>
            )}
            <span className="text-[10px] theme-text-muted">
              optional — runs once now and is logged as a trial. Nothing here needs testing.
            </span>
          </div>

          {result && (
            <div
              className={`rounded-lg border p-2 text-[11px] ${
                result.ok ? 'status-ok-border status-ok-bg' : 'status-warn-border status-warn-bg'
              }`}
            >
              <div className="flex items-center gap-1.5">
                {result.ok
                  ? <Check size={11} className="status-ok" />
                  : <X size={11} className="status-warn" />}
                <span className="theme-text">{result.detail}</span>
                <span className="theme-text-muted">· {result.elapsed_ms}ms</span>
              </div>
              {result.data !== null && result.data !== undefined && (
                <pre className="mt-1.5 max-h-44 overflow-auto text-[10px] theme-text-muted whitespace-pre-wrap break-words">
                  {JSON.stringify(result.data, null, 2)}
                </pre>
              )}
            </div>
          )}
      </Collapse>
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

  // What the gate would actually refuse right now, not the static forbidden set.
  // Printing the latter is how a panel ends up announcing a refusal that stopped
  // happening when the default changed.
  const refusedNow = useMemo(
    () => (catalogue?.locked ?? []).map((l) => l.effect),
    [catalogue],
  )

  // One line, and only when it is true. A permanent "0 tools are off" is the
  // same decoration as the standing warning this panel already dropped.
  const switchedOff = catalogue?.disabled ?? []

  // Collapsed while nothing is locked, which is the default and the boring
  // answer — the summary line already states it. Open when something *is*
  // refused, because that is the state somebody needs to see without hunting
  // for it, and it cannot be the initial `useState` value: the catalogue
  // arrives after the first render. An explicit click outranks both.
  const [capsOpenChoice, setCapsOpenChoice] = useState<boolean | null>(null)
  const capsOpen = capsOpenChoice ?? refusedNow.length > 0
  const setCapsOpen = (next: boolean) => setCapsOpenChoice(next)

  const card = `p-4 rounded-xl border theme-border transition-colors ${isPeek ? 'bg-transparent' : 'theme-surface'}`

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
    <div className="space-y-4 animate-in fade-in duration-200">
      <div>
        <h3 className="text-xl font-medium mb-1">Agent Tools</h3>
        <p className="text-sm theme-text-muted">
          {catalogue.tools.length} tools. Each declares what it may touch and whether its
          result can be cited; dispatch checks that before the call and logs every one.
        </p>
        {switchedOff.length > 0 && (
          <p className="flex items-center gap-2 text-xs theme-text-muted mt-1.5">
            {switchedOff.length} switched off — not offered to the model.
            <button
              onClick={async () => setCatalogue(await enableTool())}
              className="underline underline-offset-2 hover:theme-text transition-colors"
            >
              turn all back on
            </button>
          </p>
        )}
      </div>

      <div className={card}>
        <button
          onClick={() => setCapsOpen(!capsOpen)}
          aria-expanded={capsOpen}
          className="w-full flex items-center gap-2 text-left hover:opacity-80 transition-opacity"
        >
          <ShieldCheck size={13} className="theme-accent shrink-0" />
          <span className="text-xs theme-text shrink-0">Extended capabilities</span>
          <span className="text-[11px] theme-text-muted truncate flex-1">
            {refusedNow.length === 0
              ? 'all on — nothing is refused at runtime'
              : `${refusedNow.length} off · tools needing ${refusedNow.join(', ')} are refused`}
          </span>
          <ChevronDown
            size={12}
            className={`shrink-0 theme-text-muted transition-transform ${
              capsOpen ? 'rotate-180' : '-rotate-90'
            }`}
          />
        </button>
        <Collapse open={capsOpen} className="mt-3">
          <Capabilities catalogue={catalogue} onChange={setCatalogue} />
        </Collapse>
      </div>

      {catalogue.categories.map((category) => {
        const tools = byCategory.get(category.id) ?? []
        if (!tools.length) return null
        return (
          <div key={category.id}>
            <div className="flex items-baseline gap-2 mb-2">
              <h4 className="text-xs font-medium theme-text">{category.id}</h4>
              <span className="text-[10px] theme-text-muted truncate">{category.description}</span>
            </div>
            <div className="rounded-xl border theme-border px-3">
              {tools.map((tool) => (
                <ToolRow key={tool.name} tool={tool} onChange={setCatalogue} />
              ))}
            </div>
          </div>
        )
      })}

      {/* An absence is not self-explaining, but it does not need a card either. */}
      {catalogue.excluded.map((e) => (
        <p key={e.name} className="text-[10px] theme-text-muted leading-relaxed">
          <span className="theme-text">Not implemented:</span> <code>{e.name}</code> — {e.reason}
        </p>
      ))}
    </div>
  )
}
