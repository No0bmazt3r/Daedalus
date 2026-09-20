import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Ghost, RotateCcw } from 'lucide-react'
import { Switch } from '../ui/switch'
import { useSettings } from '../../contexts/SettingsContext'
import { useUiPrefs } from '../../contexts/UiPrefsContext'
import {
  KEYBIND_CATEGORIES,
  KEYBIND_DEFAULTS,
  KEYBIND_LABELS,
  comboFromEvent,
  findConflicts,
  formatCombo,
  type KeybindAction,
} from '../../lib/keybinds'

/**
 * Settings → Shortcuts.
 *
 * Ported from the Odysseus panel, which got the interaction right: click the
 * keycap, press the chord, and it is *previewed* rather than committed — Enter
 * or the tick saves it, Escape abandons it. A rebind that commits on the first
 * keypress cannot be corrected, because the correction is itself a keypress.
 *
 * ## Capture phase, and why the global handler stays quiet
 *
 * The recorder listens in the capture phase and calls `preventDefault`, which is
 * the flag `useGlobalShortcuts` checks before it acts. Without that, binding
 * something to `ctrl+alt+d` would delete the conversation you are sitting in
 * while you are choosing the shortcut for it.
 *
 * ## Conflicts are shown, not prevented
 *
 * Refusing a duplicate would mean throwing away the chord somebody just pressed
 * and saying nothing useful. Instead both rows are marked, and the rule is
 * stated: the first one in this list wins, which is the order the handler walks.
 */

function Keycaps({ combo }: { combo: string }) {
  const caps = formatCombo(combo)
  if (!caps.length) {
    return <span className="text-[11px] theme-text-muted italic">unbound</span>
  }
  return (
    <span className="flex items-center gap-1">
      {caps.map((cap, i) => (
        <kbd
          key={`${cap}-${i}`}
          className="px-1.5 py-0.5 rounded border theme-border theme-surface-strong text-[10px] leading-none theme-text"
        >
          {cap}
        </kbd>
      ))}
    </span>
  )
}

function ShortcutRow({ action, conflicted }: { action: KeybindAction; conflicted: boolean }) {
  const { keybinds, setKeybind, resetKeybind } = useUiPrefs()
  const [recording, setRecording] = useState(false)
  const [pending, setPending] = useState<string | null>(null)

  const combo = keybinds[action]
  const isCustom = combo !== KEYBIND_DEFAULTS[action]
  const { label, hint } = KEYBIND_LABELS[action]

  const stop = useCallback(() => {
    setRecording(false)
    setPending(null)
  }, [])

  const commit = useCallback(() => {
    if (pending !== null) setKeybind(action, pending)
    stop()
  }, [action, pending, setKeybind, stop])

  useEffect(() => {
    if (!recording) return

    const onKey = (e: KeyboardEvent) => {
      // Capture phase, and marked: `useGlobalShortcuts` skips anything already
      // defaultPrevented, so the chord being recorded cannot also fire.
      e.preventDefault()
      e.stopPropagation()

      if (e.key === 'Escape') {
        stop()
        return
      }
      if (e.key === 'Enter' && pending !== null) {
        commit()
        return
      }
      // Backspace with nothing pending clears the binding. An action with no
      // chord is a legitimate state — it is how you turn one off without
      // inventing a combo you will never press.
      if (e.key === 'Backspace' && pending === null) {
        setPending('')
        return
      }
      const next = comboFromEvent(e)
      if (next) setPending(next)
    }

    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [recording, pending, commit, stop])

  return (
    <div
      className={`flex items-center gap-2 py-1.5 border-b theme-border last:border-b-0 ${
        conflicted ? 'status-warn' : ''
      }`}
    >
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-xs theme-text truncate">{label}</span>
          {conflicted && (
            <AlertTriangle
              size={11}
              className="status-warn shrink-0"
              // Named here rather than in a toast: the rule is what makes the
              // duplicate survivable, and it should be readable at the row.
              aria-label="Duplicate shortcut"
            />
          )}
        </div>
        <div className="text-[10px] theme-text-muted truncate">{hint}</div>
      </div>

      {/* Reset sits *before* the chord, so the chord is the last thing in the
          row and lands flush against the card's padding. It is hidden with
          `opacity-0` rather than unmounted — a button that appears only once a
          binding is custom would shift the keycaps sideways the moment you
          rebind — and hidden space at the end of a row reads as the keycaps
          being short of the edge, which is exactly what it looked like. Moved
          inwards it is invisible either way. */}
      <button
        onClick={() => resetKeybind(action)}
        disabled={!isCustom || recording}
        title={isCustom ? `Back to ${formatCombo(KEYBIND_DEFAULTS[action]).join(' ')}` : 'Unchanged'}
        aria-label={`Reset ${label}`}
        className="shrink-0 p-1 rounded-md theme-text-muted hover:theme-text disabled:opacity-0 transition-colors"
      >
        <RotateCcw size={12} />
      </button>

      <button
        onClick={() => (recording ? commit() : setRecording(true))}
        title={
          recording
            ? 'Press a chord · Enter saves · Backspace unbinds · Esc cancels'
            : 'Click, then press the keys you want'
        }
        className={`shrink-0 px-2 py-1 rounded-lg border text-[11px] transition-colors ${
          recording
            ? 'status-ok-border status-ok-bg theme-text'
            : 'theme-border theme-text-muted hover:theme-text'
        }`}
      >
        {recording ? (
          pending === null ? (
            <span className="text-[11px]">press keys…</span>
          ) : (
            <span className="flex items-center gap-1.5">
              <Keycaps combo={pending} />
              <span className="text-[10px] opacity-70">↵</span>
            </span>
          )
        ) : (
          <Keycaps combo={combo} />
        )}
      </button>
    </div>
  )
}

export function ShortcutsPanel({ isPeek }: { isPeek: boolean }) {
  const { keybinds, resetAllKeybinds } = useUiPrefs()
  const { isIncognito, setIsIncognito } = useSettings()
  const conflicts = findConflicts(keybinds)

  const card = `p-4 rounded-xl border theme-border transition-colors ${
    isPeek ? 'bg-transparent' : 'theme-surface'
  }`

  const changed = Object.keys(KEYBIND_DEFAULTS).filter(
    (a) => keybinds[a as KeybindAction] !== KEYBIND_DEFAULTS[a as KeybindAction]
  ).length

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      <div>
        <h3 className="text-xl font-medium mb-1">Shortcuts</h3>
        <p className="text-sm theme-text-muted">
          Click a chord to rebind it. Enter saves, Backspace unbinds, Escape cancels.
          Stored on the server with the rest of this console's settings, not in this
          browser.
        </p>
        {changed > 0 && (
          <p className="flex items-center gap-2 text-xs theme-text-muted mt-1.5">
            {changed} changed from the default.
            <button
              onClick={resetAllKeybinds}
              className="underline underline-offset-2 hover:theme-text transition-colors"
            >
              reset all
            </button>
          </p>
        )}
        {conflicts.size > 0 && (
          <p className="flex items-center gap-1.5 text-xs status-warn mt-1.5">
            <AlertTriangle size={12} />
            Two actions share a chord — the first one listed below is the one that fires.
          </p>
        )}
      </div>

      {/* Incognito keeps its place at the top: it is the one toggle in this
          panel that is a mode rather than a binding, and the shortcut below it
          is the same switch. */}
      <div className={`${card} flex items-center justify-between gap-4`}>
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={`p-2 rounded-lg shrink-0 ${
              isIncognito
                ? 'incognito-bg-soft incognito-text incognito-glow'
                : 'theme-surface-strong theme-text-muted'
            }`}
          >
            <Ghost size={18} />
          </div>
          <div className="min-w-0">
            <div className="text-sm">Incognito mode</div>
            <div className="text-xs theme-text-muted">
              Pause history recording for this session. Prompts are not saved.
            </div>
          </div>
        </div>
        <Switch
          checked={isIncognito}
          onChange={setIsIncognito}
          label="Incognito mode"
          // Its own accent rather than the theme's: the whole point of the mode
          // is that it does not look like every other state in the app.
          className={isIncognito ? 'incognito-bg' : ''}
        />
      </div>

      {KEYBIND_CATEGORIES.map((category) => (
        <div key={category.name}>
          <h4 className="text-xs font-medium theme-text mb-2">{category.name}</h4>
          <div className="rounded-xl border theme-border px-3">
            {category.actions.map((action) => (
              <ShortcutRow key={action} action={action} conflicted={conflicts.has(action)} />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
