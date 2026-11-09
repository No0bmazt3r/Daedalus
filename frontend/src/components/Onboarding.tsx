import { useState } from 'react'
import { ArrowRight, Check, Hammer } from 'lucide-react'
import { LabyrinthIcon } from './LabyrinthIcon'
import { useSettings } from '../contexts/SettingsContext'
import { useUiPrefs } from '../contexts/UiPrefsContext'
import { stateRole } from '../lib/personaClient'

/**
 * First run: who is at the keyboard. One card in place of the greeting, shown
 * until it is finished or skipped, once per install (`reset.sh` brings it back).
 *
 * Everything is optional. The name is for the greeting only and never reaches
 * a prompt. The role is saved as an *accepted* persona trait — the user said
 * it, so there is nothing to propose — and is changed or forgotten in
 * Settings → Persona like any other.
 */

/** Asks the shell to open The Forge; the chat cannot reach its callbacks. */
export const OPEN_FORGE_EVENT = 'daedalus:open-forge'

const ROLES: { value: string; hint: string }[] = [
  { value: 'operator', hint: 'Runs the reactor day to day' },
  { value: 'student', hint: 'Learning how it works' },
  { value: 'researcher', hint: 'Studies the results' },
  { value: 'engineer', hint: 'Builds and maintains it' },
  { value: 'supervisor', hint: 'Oversees the work' },
]

const FOCUS_RING = 'outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--primary)_60%,transparent)]'

export function Onboarding() {
  const { setProfile } = useUiPrefs()
  const { noModel, modelsLoading, deployedModel, selectedModel } = useSettings()
  const [name, setName] = useState('')
  const [role, setRole] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const finish = async () => {
    setSaving(true)
    setError(null)
    try {
      if (role) await stateRole(role)
      setProfile({ name: name.trim() || null, onboarded: true })
    } catch (e) {
      // Stay on the card: a role that did not save should not look like it did.
      setError(e instanceof Error ? e.message : 'could not save your role')
      setSaving(false)
    }
  }

  const ready = deployedModel?.tag || selectedModel

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void finish()
      }}
      aria-labelledby="onboarding-title"
      className="w-full max-w-lg theme-card border theme-border rounded-2xl p-6 shadow-sm animate-in fade-in slide-in-from-bottom-2 duration-300 motion-reduce:animate-none"
    >
      <div className="flex items-center gap-3">
        <LabyrinthIcon className="w-9 h-9 theme-accent shrink-0" />
        <div>
          <h1 id="onboarding-title" className="text-xl font-serif tracking-tight">Welcome to Daedalus</h1>
          <p className="text-[13px] theme-text-muted">Two quick questions. Both are optional.</p>
        </div>
      </div>

      <label className="mt-6 block">
        <span className="text-[13px] font-medium">What should I call you?</span>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={40}
          placeholder="Operator"
          autoComplete="given-name"
          className={`mt-1.5 w-full rounded-lg border theme-border bg-transparent px-3 py-2 text-[15px] placeholder:opacity-40 ${FOCUS_RING}`}
        />
        <span className="mt-1 block text-[11px] theme-text-muted">Only used to greet you. It is never sent to a model.</span>
      </label>

      <fieldset className="mt-5">
        <legend className="text-[13px] font-medium">What best describes you?</legend>
        <div role="radiogroup" aria-label="Your role" className="mt-1.5 flex flex-wrap gap-2">
          {ROLES.map((r) => {
            const on = role === r.value
            return (
              <button
                key={r.value}
                type="button"
                role="radio"
                aria-checked={on}
                title={r.hint}
                // Clicking the chosen one again un-chooses it: the question is optional.
                onClick={() => setRole(on ? null : r.value)}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] capitalize transition-colors duration-150 ${FOCUS_RING} ${
                  on
                    ? 'theme-accent border-[color-mix(in_srgb,var(--primary)_60%,transparent)] bg-[color-mix(in_srgb,var(--primary)_14%,transparent)]'
                    : 'theme-border theme-text-muted hover:theme-text hover:bg-[color-mix(in_srgb,var(--text-main)_6%,transparent)]'
                }`}
              >
                {on && <Check size={13} aria-hidden />}
                {r.value}
              </button>
            )
          })}
        </div>
        <span className="mt-1 block text-[11px] theme-text-muted">
          Shapes how answers are written, never what they say. Change it any time in Settings → Persona.
        </span>
      </fieldset>

      <div className="mt-5 flex items-center gap-2 rounded-lg border theme-border px-3 py-2 text-[12px]">
        {modelsLoading ? (
          <span className="theme-text-muted">Checking for models on this machine…</span>
        ) : noModel ? (
          <>
            <span className="status-warn">No model yet. Daedalus needs one to answer.</span>
            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent(OPEN_FORGE_EVENT))}
              className={`ml-auto flex items-center gap-1.5 rounded-md border theme-border px-2 py-1 theme-text hover:bg-[color-mix(in_srgb,var(--text-main)_6%,transparent)] ${FOCUS_RING}`}
            >
              <Hammer size={12} aria-hidden /> Open The Forge
            </button>
          </>
        ) : (
          <>
            <Check size={13} className="status-ok shrink-0" aria-hidden />
            <span className="theme-text-muted">
              Ready{ready ? <>: <code className="theme-text">{ready}</code></> : null}
            </span>
          </>
        )}
      </div>

      {error && <p role="alert" className="mt-3 text-[12px] status-bad">{error}</p>}

      <div className="mt-6 flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={() => setProfile({ name: null, onboarded: true })}
          disabled={saving}
          className={`rounded-md px-3 py-1.5 text-[13px] theme-text-muted hover:theme-text disabled:opacity-50 ${FOCUS_RING}`}
        >
          Skip
        </button>
        <button
          type="submit"
          disabled={saving}
          className={`group flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-[13px] font-medium bg-[var(--primary)] theme-text-on-primary hover:opacity-90 disabled:opacity-50 ${FOCUS_RING}`}
        >
          {saving ? 'Saving…' : 'Get started'}
          <ArrowRight size={14} className="transition-transform duration-200 group-hover:translate-x-0.5 motion-reduce:transition-none" aria-hidden />
        </button>
      </div>
    </form>
  )
}
