// Keyboard shortcuts — the map, the matching, and how a combo is written down.
//
// Ported from Odysseus' `keyboard-shortcuts.js` and the rebinding half of its
// settings panel, with the differences this codebase already makes elsewhere:
// the map persists to the backend rather than to `localStorage`, and it is a
// typed table rather than a bag of strings, so an action that has no handler
// fails to compile instead of failing silently at 2am.
//
// ## What is here and what is not
//
// This module knows nothing about the app. It turns a `KeyboardEvent` into a
// combo, compares one, formats one for display, and finds duplicates. The
// wiring — which action opens the Forge, which clears the composer — lives in
// `hooks/useGlobalShortcuts.ts`, so this file stays testable and the handlers
// stay next to the state they touch.
//
// ## Combos are stored lowercase, joined by `+`
//
// `ctrl+alt+b`, `ctrl+,`, `escape`. Modifier order is fixed (ctrl, alt, shift)
// so two spellings of the same chord cannot exist, which is what makes conflict
// detection a string comparison instead of a set comparison.

/** Every rebindable action. Adding one here forces a handler and a label. */
export type KeybindAction =
  | 'toggle_sidebar'
  | 'search_chats'
  | 'focus_input'
  | 'open_settings'
  | 'new_chat'
  | 'delete_chat'
  | 'toggle_incognito'
  | 'open_theme'
  | 'open_forge'
  | 'open_blueprints'
  | 'close_window';

export type KeybindMap = Record<KeybindAction, string>;

/**
 * The shipped map.
 *
 * `ctrl+alt+<letter>` for anything destructive or window-opening, because a
 * single modifier collides with the browser's own bindings and with typing.
 * `ctrl+k` and `ctrl+,` are the two exceptions, and they are conventions people
 * already have in their fingers.
 */
export const KEYBIND_DEFAULTS: KeybindMap = {
  toggle_sidebar: 'ctrl+alt+b',
  search_chats: 'ctrl+k',
  focus_input: 'ctrl+/',
  open_settings: 'ctrl+,',
  new_chat: 'ctrl+alt+n',
  delete_chat: 'ctrl+alt+d',
  toggle_incognito: 'ctrl+alt+i',
  open_theme: 'ctrl+alt+t',
  open_forge: 'ctrl+alt+g',
  open_blueprints: 'ctrl+alt+p',
  close_window: 'escape',
};

/** What each action does, in the words the panel shows. */
export const KEYBIND_LABELS: Record<KeybindAction, { label: string; hint: string }> = {
  toggle_sidebar: { label: 'Toggle sidebar', hint: 'Hide or show the left column' },
  // The id stays `search_chats` although this now opens the command palette:
  // it is the key the binding is stored under in the `keybinds` preference, so
  // renaming it would discard the chord of anybody who had rebound it. The id
  // is storage, the label is the UI.
  search_chats: {
    label: 'Command palette',
    hint: 'Search chats, tables, settings and windows',
  },
  focus_input: { label: 'Focus the composer', hint: 'Put the cursor in the message box' },
  open_settings: { label: 'Open Settings', hint: 'The window you are reading this in' },
  new_chat: { label: 'New chat', hint: 'Start a conversation and select it' },
  delete_chat: { label: 'Delete this chat', hint: 'Asks first — it cannot be undone' },
  toggle_incognito: { label: 'Toggle incognito', hint: 'Stop recording this session to history' },
  open_theme: { label: 'Open Theme & Appearance', hint: 'Colours, font, background effect' },
  open_forge: { label: 'Open The Forge', hint: 'Hardware, model fit, benchmarks' },
  open_blueprints: { label: 'Open Labyrinth Blueprints', hint: 'The architecture map' },
  close_window: { label: 'Close the open window', hint: 'Whichever floating window is in front' },
};

/** Grouping for the panel. Every action appears exactly once. */
export const KEYBIND_CATEGORIES: readonly { name: string; actions: readonly KeybindAction[] }[] = [
  { name: 'Navigation', actions: ['toggle_sidebar', 'search_chats', 'focus_input'] },
  { name: 'Conversations', actions: ['new_chat', 'delete_chat', 'toggle_incognito'] },
  {
    name: 'Windows',
    actions: ['open_settings', 'open_theme', 'open_forge', 'open_blueprints', 'close_window'],
  },
];

export const KEYBIND_ACTIONS: readonly KeybindAction[] = KEYBIND_CATEGORIES.flatMap(
  (c) => c.actions
);

/**
 * True on every Apple platform, iPad and iPhone included: a Magic Keyboard's
 * Option key sets the AltGraph state exactly like a Mac's, so it needs the same
 * carve-out in `isAltGrEvent`.
 */
export const IS_MAC =
  typeof navigator !== 'undefined' &&
  (/Mac|iPhone|iPad/.test(navigator.platform || '') || /Mac/.test(navigator.userAgent || ''));

/**
 * True when this keystroke is AltGr rather than a real Ctrl+Alt chord.
 *
 * AltGr — the right Alt on AZERTY and QWERTZ, used to type `@ # { } [ ] | \ €`
 * — is reported by browsers as Ctrl+Alt. Without this guard, typing an `@` on a
 * German layout would fire whatever is bound to `ctrl+alt+q`, and one of those
 * bindings deletes a conversation.
 *
 * `getModifierState('AltGraph')` is true for AltGr and false for a genuine left
 * Ctrl+Alt, so real shortcuts still work. Never true on macOS, where Option is
 * a normal part of shortcuts and sets AltGraph legitimately.
 *
 * The trade this inherits from Odysseus: on Windows AltGr *is* Ctrl+RightAlt, so
 * a deliberate `ctrl+alt+<char>` typed with the right Alt is unreachable. Use
 * the left one.
 */
export function isAltGrEvent(e: KeyboardEvent, isMac = IS_MAC): boolean {
  return (
    !isMac &&
    !!e.ctrlKey &&
    !!e.altKey &&
    typeof e.getModifierState === 'function' &&
    e.getModifierState('AltGraph')
  );
}

const MODIFIER_KEYS = new Set(['control', 'alt', 'shift', 'meta', 'altgraph', 'capslock']);

/**
 * The combo this event represents, or `''` when it is not one on its own.
 *
 * Cmd is folded into `ctrl` rather than stored separately: one map then works on
 * both platforms, and `formatCombo` renders it as ⌘ on a Mac. A bare modifier
 * returns `''`, because "Shift" is not a shortcut.
 */
export function comboFromEvent(e: KeyboardEvent): string {
  if (isAltGrEvent(e)) return '';
  const key = (e.key || '').toLowerCase();
  if (MODIFIER_KEYS.has(key)) return '';

  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('ctrl');
  if (e.altKey) parts.push('alt');
  if (e.shiftKey) parts.push('shift');
  parts.push(key === ' ' ? 'space' : key);
  return parts.join('+');
}

/** Whether this event is that combo. An empty combo never matches anything. */
export function matchesCombo(e: KeyboardEvent, combo: string): boolean {
  if (!combo) return false;
  return comboFromEvent(e) === combo;
}

const CAP_NAMES: Record<string, string> = {
  ctrl: IS_MAC ? '⌘' : 'Ctrl',
  alt: IS_MAC ? '⌥' : 'Alt',
  shift: IS_MAC ? '⇧' : 'Shift',
  escape: 'Esc',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  enter: 'Enter',
  space: 'Space',
  backspace: '⌫',
  delete: 'Del',
  tab: 'Tab',
};

/** One keycap per part, ready to render. `['Ctrl', 'Alt', 'B']`. */
export function formatCombo(combo: string): string[] {
  if (!combo) return [];
  return combo.split('+').map((part) => {
    const named = CAP_NAMES[part];
    if (named) return named;
    return part.length === 1 ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1);
  });
}

/**
 * Actions sharing a combo with another action.
 *
 * Reported rather than prevented: two bindings on one chord is a mistake worth
 * showing, but refusing the second one mid-rebind would mean the panel silently
 * discards what somebody just pressed. The handler fires the first match in
 * declaration order, and the panel says which rows are ambiguous.
 */
export function findConflicts(binds: KeybindMap): Set<KeybindAction> {
  const seen = new Map<string, KeybindAction[]>();
  for (const action of KEYBIND_ACTIONS) {
    const combo = binds[action];
    if (!combo) continue;
    seen.set(combo, [...(seen.get(combo) ?? []), action]);
  }
  const conflicts = new Set<KeybindAction>();
  for (const actions of seen.values()) {
    if (actions.length > 1) actions.forEach((a) => conflicts.add(a));
  }
  return conflicts;
}

/**
 * A stored value turned back into a complete map.
 *
 * Unknown actions are dropped and missing ones fall back to their default, so a
 * map saved before an action existed — or after one was retired — still loads
 * rather than leaving the app with no shortcuts at all.
 */
export function normaliseBinds(stored: unknown): KeybindMap {
  const out = { ...KEYBIND_DEFAULTS };
  if (!stored || typeof stored !== 'object') return out;
  for (const action of KEYBIND_ACTIONS) {
    const value = (stored as Record<string, unknown>)[action];
    // `''` is meaningful: it is how an action is left deliberately unbound.
    if (typeof value === 'string') out[action] = value.toLowerCase();
  }
  return out;
}

/**
 * Events the shortcut layer fires at components that own the state it needs.
 *
 * The alternative is threading a ref for the composer and one for the chat
 * filter up through two contexts to the root, which makes every component that
 * has a focusable thing in it part of the shortcut system. A `CustomEvent` keeps
 * the coupling to a name.
 */
export const FOCUS_COMPOSER_EVENT = 'daedalus:focus-composer';

/** True when the keystroke landed in something the person is typing into. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable
  );
}
