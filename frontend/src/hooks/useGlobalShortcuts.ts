import { useEffect, useRef } from 'react';
import {
  FOCUS_COMPOSER_EVENT,
  KEYBIND_ACTIONS,
  isTypingTarget,
  matchesCombo,
  type KeybindAction,
  type KeybindMap,
} from '../lib/keybinds';

/**
 * One listener for every shortcut, mounted once at the root.
 *
 * ## Why one listener rather than one per component
 *
 * Because the order matters and has to be visible. Thirteen components each
 * adding a `keydown` handler gives thirteen chances for two of them to answer
 * the same chord, in whatever order they happened to mount. Here the map is
 * walked in declaration order, the first match wins and returns, and a conflict
 * is something Settings → Shortcuts can *show* rather than something that
 * surfaces as one feature mysteriously not working.
 *
 * ## Typing wins, with two exceptions
 *
 * A chord that fires while somebody is in the composer takes the keystroke away
 * from them, so anything without a modifier is ignored inside an input. `Escape`
 * is allowed through because closing the window in front is what Escape means
 * everywhere, and so is any combo with Ctrl or Alt, which cannot be produced by
 * typing prose.
 */
export interface ShortcutHandlers {
  toggle_sidebar: () => void;
  search_chats: () => void;
  focus_input: () => void;
  open_settings: () => void;
  new_chat: () => void;
  delete_chat: () => void;
  toggle_incognito: () => void;
  open_theme: () => void;
  open_forge: () => void;
  open_blueprints: () => void;
  close_window: () => void;
}

export function useGlobalShortcuts(keybinds: KeybindMap, handlers: ShortcutHandlers) {
  // Kept in a ref so the listener is bound once. Re-binding it on every render
  // of the root — which happens whenever a window opens — would mean a window
  // that opens on a keystroke could hand the same keystroke to its replacement.
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  const bindsRef = useRef(keybinds);
  bindsRef.current = keybinds;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // A rebind in progress owns the keyboard: the panel captures in the
      // capture phase and marks the event, so the chord being recorded cannot
      // also fire the action it is being recorded for.
      if (e.defaultPrevented) return;

      const typing = isTypingTarget(e.target);
      for (const action of KEYBIND_ACTIONS) {
        const combo = bindsRef.current[action];
        if (!combo || !matchesCombo(e, combo)) continue;
        if (typing && !e.ctrlKey && !e.metaKey && !e.altKey && e.key !== 'Escape') return;
        e.preventDefault();
        handlersRef.current[action as KeybindAction]();
        return;
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}

/** Ask whoever owns the composer to focus it. See `keybinds.ts` for the why. */
export function focusComposer() {
  window.dispatchEvent(new CustomEvent(FOCUS_COMPOSER_EVENT));
}
