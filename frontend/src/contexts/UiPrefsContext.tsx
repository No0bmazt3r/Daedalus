import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  loadAllPrefs,
  savePref,
  PREF_KEYBINDS,
  PREF_UI_CHROME,
} from '../lib/prefsClient';
import {
  KEYBIND_DEFAULTS,
  normaliseBinds,
  type KeybindAction,
  type KeybindMap,
} from '../lib/keybinds';
import {
  CHROME_DEFAULTS,
  normaliseChrome,
  type ChromeKey,
  type ChromeSection,
} from '../lib/uiChrome';

/**
 * The two preferences that describe the interface itself: what the keyboard
 * does, and which furniture is drawn.
 *
 * ## One provider, one request
 *
 * They are separate keys in the store — a shortcut map and a visibility map have
 * nothing to say to each other — but they are read together through
 * `loadAllPrefs`, so the app boots with one round trip rather than two. The
 * split matters on write: changing a shortcut must not rewrite the appearance
 * object, or two panels open at once would overwrite each other.
 *
 * ## Optimistic, and stored as the difference
 *
 * A change applies immediately and is written behind a debounce by
 * `prefsClient`; a failed write leaves the session correct and the next one
 * repairs the record. Only entries that differ from the shipped default are
 * sent, so an untouched install stores nothing and "reset" is a delete — the
 * same shape the backend's tool locks use, for the same reason: a default that
 * has to be written down is not a default.
 *
 * ## Why not `localStorage`
 *
 * Because nothing in this app is in `localStorage`. A console whose keyboard map
 * lives in one browser profile cannot be described in a write-up, cannot be
 * restored from the backup Settings → System takes, and cannot be read back when
 * somebody asks what the interface was when a figure was captured.
 */
interface UiPrefsContextType {
  /** The live shortcut map. Always complete — missing entries fall back. */
  keybinds: KeybindMap;
  setKeybind: (action: KeybindAction, combo: string) => void;
  resetKeybind: (action: KeybindAction) => void;
  resetAllKeybinds: () => void;

  /** Which chrome is drawn. Always complete. */
  chrome: Record<ChromeKey, boolean>;
  setChrome: (key: ChromeKey, visible: boolean) => void;
  resetChromeSection: (section: ChromeSection) => void;
  resetAllChrome: () => void;
  /** Convenience for render sites: `show('sidebar-brand') && <Brand/>`. */
  show: (key: ChromeKey) => boolean;

  /** False until the stored values have been read, so nothing flashes. */
  hydrated: boolean;
}

const UiPrefsContext = createContext<UiPrefsContextType | undefined>(undefined);

/** Only what differs from the shipped default is worth storing. */
function diffOnly<K extends string, V>(live: Record<K, V>, shipped: Record<K, V>): Record<K, V> {
  const out = {} as Record<K, V>;
  for (const key of Object.keys(live) as K[]) {
    if (live[key] !== shipped[key]) out[key] = live[key];
  }
  return out;
}

export function UiPrefsProvider({ children }: { children: ReactNode }) {
  const [keybinds, setKeybinds] = useState<KeybindMap>(KEYBIND_DEFAULTS);
  const [chrome, setChromeState] = useState<Record<ChromeKey, boolean>>(CHROME_DEFAULTS);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadAllPrefs()
      .then((values) => {
        if (cancelled) return;
        setKeybinds(normaliseBinds(values[PREF_KEYBINDS]));
        setChromeState(normaliseChrome(values[PREF_UI_CHROME]));
      })
      .catch(() => {
        /* backend down — the shipped defaults are a working interface */
      })
      .finally(() => {
        if (!cancelled) setHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const persistBinds = useCallback((next: KeybindMap) => {
    setKeybinds(next);
    savePref(PREF_KEYBINDS, diffOnly(next, KEYBIND_DEFAULTS));
  }, []);

  const persistChrome = useCallback((next: Record<ChromeKey, boolean>) => {
    setChromeState(next);
    savePref(PREF_UI_CHROME, diffOnly(next, CHROME_DEFAULTS));
  }, []);

  const value = useMemo<UiPrefsContextType>(
    () => ({
      keybinds,
      setKeybind: (action, combo) => persistBinds({ ...keybinds, [action]: combo.toLowerCase() }),
      resetKeybind: (action) => persistBinds({ ...keybinds, [action]: KEYBIND_DEFAULTS[action] }),
      resetAllKeybinds: () => persistBinds({ ...KEYBIND_DEFAULTS }),

      chrome,
      setChrome: (key, visible) => persistChrome({ ...chrome, [key]: visible }),
      resetChromeSection: (section) => {
        const next = { ...chrome };
        for (const toggle of section.toggles) next[toggle.key] = toggle.shipped;
        persistChrome(next);
      },
      resetAllChrome: () => persistChrome({ ...CHROME_DEFAULTS }),
      show: (key) => chrome[key] !== false,

      hydrated,
    }),
    [keybinds, chrome, hydrated, persistBinds, persistChrome]
  );

  return <UiPrefsContext.Provider value={value}>{children}</UiPrefsContext.Provider>;
}

export function useUiPrefs() {
  const context = useContext(UiPrefsContext);
  if (!context) throw new Error('useUiPrefs must be used within a UiPrefsProvider');
  return context;
}
