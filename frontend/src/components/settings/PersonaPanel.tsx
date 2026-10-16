import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertCircle, Check, Inbox, Orbit, RefreshCw, Trash2, UserRound, X } from 'lucide-react'
import { TabError } from '../errors/TabError'
import { toFailure, type LoadFailure } from '../errors/ErrorPage'
import { GraphCanvas } from '../blueprints/GraphCanvas'
import { Switch } from '../ui/switch'
import { useConfirm } from '../ui/confirm-dialog'
import { SectionsSkeleton } from '../ui/sections-skeleton'
import { useLiveRefresh } from '../../hooks/useLiveRefresh'
import {
  decideTrait,
  fetchPersona,
  forgetPersona,
  forgetTrait,
  scanPersona,
  setPersonaEnabled,
  type PersonaState,
  type PersonaTrait,
} from '../../lib/personaClient'

/**
 * Settings → Persona — what Daedalus has learned about you, as a globe.
 *
 * A background job reads your own messages and proposes habits it noticed:
 * how you like answers written, your shorthand for equipment, the topics you
 * return to, and what kind of user you seem to be. A proposal does nothing
 * until you accept it here — then it shapes how answers are written (never
 * what they claim), and your shorthand is spelled out before the documents are
 * searched. Each proposal shows the messages it came from.
 */

const KIND_LABEL: Record<string, string> = {
  style: 'Style', vocabulary: 'Vocabulary', focus: 'Focus', role: 'Role',
}
// Fixed hues like the Blueprints node types: they mark status, the label says it.
const TINT: Record<string, string> = {
  You: 'text-sky-400', Kind: 'theme-text-muted', Accepted: 'text-emerald-400', Proposed: 'text-amber-400',
}

export function PersonaPanel(_props: { isPeek?: boolean }) {
  const [state, setState] = useState<PersonaState | null>(null)
  const [loadError, setLoadError] = useState<LoadFailure | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [confirm, confirmDialog] = useConfirm()

  const load = useCallback(() => {
    fetchPersona()
      .then((s) => {
        setState(s)
        setLoadError(null)
      })
      .catch((e: unknown) => setLoadError(toFailure(e)))
  }, [])
  useEffect(load, [load])
  // A scan finishing after an answer, or a decision in another tab.
  useLiveRefresh(['persona'], load)

  const act = async (fn: () => Promise<PersonaState>) => {
    setBusy(true)
    setError(null)
    try {
      setState(await fn())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const nodes = useMemo(
    () => (state?.graph.nodes ?? []).map((n) => ({ ...n, tint: TINT[n.type as string] })),
    [state],
  )

  if (loadError) {
    return (
      <TabError
        code={loadError.status}
        detail={loadError.message}
        what="The persona could not be read from the backend."
        onRetry={load}
      />
    )
  }
  if (!state) {
    return <SectionsSkeleton sections={[{ icon: Orbit, title: 'Your persona' }, { icon: Inbox, title: 'Proposals' }]} />
  }

  const proposed = state.traits.filter((t) => t.status === 'proposed')
  const accepted = state.traits.filter((t) => t.status === 'accepted')
  const focus = state.traits.find((t) => t.trait_id === selected)

  return (
    <div className="space-y-6">
      {confirmDialog}
      <header className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm theme-text">Persona</h3>
          <p className="mt-1 text-xs leading-relaxed theme-text-muted">
            Daedalus notices how you work — the language and length you prefer, your shorthand for
            equipment, what you keep asking about — and proposes it here. Nothing changes until you
            accept it, and it only shapes <em>how</em> answers are written: facts, readings and steps
            still come from the sensors and documents. It is never used during an evaluation run, and
            never learns from incognito chats.
          </p>
        </div>
        <Switch
          checked={state.enabled}
          onChange={(v) => void act(() => setPersonaEnabled(v))}
          disabled={busy}
          label="Learn and use the persona"
        />
      </header>

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-rose-400/40 bg-rose-400/10 p-2.5 text-[11px] theme-text">
          <AlertCircle size={13} className="shrink-0 text-rose-400" /> {error}
        </div>
      )}

      <section className="space-y-3 rounded-lg border theme-border p-4">
        <div className="flex items-center justify-between gap-2">
          <h4 className="flex items-center gap-1.5 text-sm theme-text">
            <Orbit size={14} className="theme-text-muted" /> Your persona
            <span className="text-[11px] theme-text-muted">
              · <span className="text-emerald-400">●</span> accepted · <span className="text-amber-400">●</span> proposed
            </span>
          </h4>
          <button
            type="button"
            disabled={busy || !state.enabled}
            onClick={() =>
              void act(async () => {
                setNotice(null)
                const s = await scanPersona()
                setNotice(s.queued ? `${s.queued} new proposal${s.queued === 1 ? '' : 's'}.` : 'Nothing new noticed.')
                return s
              })
            }
            className="flex items-center gap-1.5 rounded-md border theme-border px-2 py-1 text-[11px] theme-text-muted hover:theme-text disabled:opacity-40"
            title="Read every chat's unread messages now, instead of waiting for three more questions"
          >
            <RefreshCw size={12} className={busy ? 'animate-spin' : ''} /> Look for patterns now
          </button>
        </div>
        {notice && <p className="text-[11px] theme-text-muted">{notice}</p>}
        {state.traits.length === 0 ? (
          <p className="py-8 text-center text-xs theme-text-muted">
            Nothing learned yet. After every few questions in a normal chat, Daedalus looks for habits
            and proposes them below.
          </p>
        ) : (
          <GraphCanvas
            nodes={nodes}
            edges={state.graph.edges}
            selected={selected}
            onSelect={setSelected}
            caption="What Daedalus has learned about you"
            height={320}
          />
        )}
        {focus && <TraitDetail trait={focus} />}
      </section>

      <section className="space-y-3 rounded-lg border theme-border p-4">
        <h4 className="flex items-center gap-1.5 text-sm theme-text">
          <Inbox size={14} className="theme-text-muted" /> Proposals
          <span className="text-[11px] theme-text-muted">({proposed.length})</span>
        </h4>
        {proposed.length === 0 && <p className="text-xs theme-text-muted">No proposals waiting.</p>}
        {proposed.map((t) => (
          <TraitRow key={t.trait_id} trait={t} onSelect={() => setSelected(t.trait_id)}>
            <button
              type="button"
              disabled={busy}
              onClick={() => void act(() => decideTrait(t.trait_id, true))}
              className="flex items-center gap-1 rounded-md border border-emerald-400/40 px-2 py-1 text-[11px] text-emerald-400 hover:bg-emerald-400/10"
            >
              <Check size={12} /> Accept
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void act(() => decideTrait(t.trait_id, false))}
              className="flex items-center gap-1 rounded-md border theme-border px-2 py-1 text-[11px] theme-text-muted hover:theme-text"
              title="Reject — it will not be proposed again"
            >
              <X size={12} /> Reject
            </button>
          </TraitRow>
        ))}
      </section>

      <section className="space-y-3 rounded-lg border theme-border p-4">
        <h4 className="flex items-center gap-1.5 text-sm theme-text">
          <UserRound size={14} className="theme-text-muted" /> In use
          <span className="text-[11px] theme-text-muted">({accepted.length})</span>
        </h4>
        {accepted.length === 0 && <p className="text-xs theme-text-muted">Nothing accepted yet.</p>}
        {accepted.map((t) => (
          <TraitRow key={t.trait_id} trait={t} onSelect={() => setSelected(t.trait_id)}>
            <button
              type="button"
              disabled={busy}
              onClick={() => void act(() => forgetTrait(t.trait_id))}
              className="flex items-center gap-1 rounded-md border theme-border px-2 py-1 text-[11px] theme-text-muted hover:theme-text"
            >
              <Trash2 size={12} /> Forget
            </button>
          </TraitRow>
        ))}
        <button
          type="button"
          disabled={busy || state.traits.length === 0}
          onClick={async () => {
            const ok = await confirm({
              title: 'Forget everything Daedalus has learned about you?',
              body: 'Every proposal and accepted trait is deleted, and it starts learning from scratch. Your chats are not touched.',
              confirmLabel: 'Forget everything',
            })
            if (ok) await act(forgetPersona)
          }}
          className="text-[11px] text-rose-400 hover:underline disabled:opacity-40"
        >
          Forget everything
        </button>
      </section>
    </div>
  )
}

function TraitRow({ trait, onSelect, children }: { trait: PersonaTrait; onSelect: () => void; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border theme-border px-3 py-2">
      <button type="button" onClick={onSelect} className="min-w-0 text-left">
        <span className="mr-2 rounded border theme-border px-1.5 py-0.5 text-[10px] theme-text-muted">
          {KIND_LABEL[trait.kind]}
        </span>
        <span className="text-xs theme-text">{trait.statement}</span>
        <span className="ml-2 text-[10px] theme-text-muted">
          seen {trait.sightings}× · {trait.evidence.length} message{trait.evidence.length === 1 ? '' : 's'}
        </span>
      </button>
      <div className="flex gap-1.5">{children}</div>
    </div>
  )
}

function TraitDetail({ trait }: { trait: PersonaTrait }) {
  return (
    <div className="space-y-1.5 rounded-md border theme-border p-3">
      <p className="text-xs theme-text">
        {trait.statement} <span className="theme-text-muted">· {trait.status}</span>
      </p>
      <p className="text-[11px] theme-text-muted">Because you wrote:</p>
      <ul className="space-y-1">
        {trait.evidence.map((e) => (
          <li key={`${e.session_id}:${e.seq}`} className="text-[11px] theme-text">
            {e.text ? <>“{e.text}”</> : <span className="italic theme-text-muted">(that chat was deleted)</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}
