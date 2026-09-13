// Owns the live appearance state: the active palette, the user's saved
// themes, typography and background-effect settings. Everything the theme
// modal does goes through here, and every change is applied to the document
// and persisted to the FastAPI backend in one place — nothing is kept in
// browser storage.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  applyThemeState,
  applyUiScale,
  coerceCustomThemes,
  coerceState,
  coerceUiScale,
  computeAdvancedDefaults,
  customEntryFromState,
  defaultStateFor,
  DEFAULT_THEME_ID,
  getThemeById,
  isHex6,
  MAX_CUSTOM_THEMES,
  normalizeHex,
  slugify,
  stateFromCustom,
  THEMES,
  type AdvancedColors,
  type AdvancedKey,
  type BaseKey,
  type CustomThemeMap,
  type DensityKey,
  type FontKey,
  type PatternKey,
  type ThemeColors,
  type ThemeState,
  type UiScale,
} from '../lib/themes';
import {
  flushPending,
  loadAllPrefs,
  migrateLegacyLocalStorage,
  onWrite,
  PREF_CUSTOM_THEMES,
  PREF_THEME,
  PREF_UI_SCALE,
  savePref,
  type SyncStatus,
} from '../lib/prefsClient';

export type SaveResult = { ok: true } | { ok: false; error: string };

interface ThemeContextType {
  state: ThemeState;
  customThemes: CustomThemeMap;
  uiScale: UiScale;
  /** Bumps on every autosave so the modal can flash an "Auto-saved" pill. */
  savedAt: number;
  savedLabel: string;
  /** Whether preferences have loaded from the backend, and whether it is up. */
  syncStatus: SyncStatus;

  selectTheme: (id: string) => void;
  setBaseColor: (key: BaseKey, value: string) => void;
  setAdvancedColor: (key: AdvancedKey, value: string) => void;
  clearAdvanced: () => void;
  resetBaseColor: (key: BaseKey) => void;
  resetAdvancedColor: (key: AdvancedKey) => void;
  applyPalette: (colors: ThemeColors) => void;

  setFont: (font: FontKey) => void;
  setDensity: (density: DensityKey) => void;
  setUiScale: (scale: UiScale) => void;
  setPattern: (pattern: PatternKey) => void;
  setEffectColor: (color: string) => void;
  resetEffectColor: () => void;
  setEffectIntensity: (v: number) => void;
  setEffectSize: (v: number) => void;
  setFrosted: (on: boolean) => void;
  setReactive: (on: boolean) => void;

  saveCustomTheme: (name: string) => SaveResult;
  deleteCustomTheme: (name: string) => void;
  exportTheme: () => string;
  importTheme: (json: string) => SaveResult;
  resetToDefault: () => void;

  /** The palette the active theme started from, for the reset buttons. */
  referenceColors: ThemeColors;
  advancedDefaults: Record<AdvancedKey, string>;
  isCustomTheme: (id: string) => boolean;
}

const ThemeContext = createContext<ThemeContextType | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const defaultTheme = getThemeById(DEFAULT_THEME_ID) || THEMES[0];
  const [state, setState] = useState<ThemeState>(() =>
    defaultStateFor(defaultTheme.id, defaultTheme.colors, defaultTheme.advanced)
  );
  const [customThemes, setCustomThemes] = useState<CustomThemeMap>({});
  const [uiScale, setUiScaleState] = useState<UiScale>('100');
  const [savedAt, setSavedAt] = useState(0);
  const [savedLabel, setSavedLabel] = useState('Auto-saved');
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('loading');

  // Nothing is persisted until the backend has answered. Without this guard
  // the defaults rendered during the initial fetch would be written straight
  // back over the user's saved theme.
  const hydrated = useRef(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const values = await loadAllPrefs();
        // One-time hand-off from the browser storage an earlier build used.
        const migrated = await migrateLegacyLocalStorage(values);
        const merged = { ...values, ...migrated };
        if (cancelled) return;

        if (merged[PREF_THEME] !== undefined) {
          setState(coerceState(merged[PREF_THEME]));
        }
        setCustomThemes(coerceCustomThemes(merged[PREF_CUSTOM_THEMES]));
        setUiScaleState(coerceUiScale(merged[PREF_UI_SCALE]));
        setSyncStatus('ready');
      } catch {
        // Backend down — run on defaults for this session rather than
        // silently falling back to browser storage.
        if (!cancelled) setSyncStatus('offline');
      } finally {
        if (!cancelled) hydrated.current = true;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // A failed write demotes the badge; a later success restores it.
  useEffect(
    () =>
      onWrite((status) =>
        setSyncStatus((prev) =>
          status === 'failed' ? 'offline' : prev === 'loading' ? prev : 'ready'
        )
      ),
    []
  );

  // Don't lose an edit made in the moment before the tab goes away.
  useEffect(() => {
    const onHide = () => flushPending();
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, []);

  // Apply + persist on every change. One effect keeps the document, the
  // backend and React state from ever drifting apart.
  useEffect(() => {
    applyThemeState(state);
    if (!hydrated.current) return;
    savePref(PREF_THEME, state);
    setSavedAt(Date.now());
  }, [state]);

  useEffect(() => {
    applyUiScale(uiScale);
    if (!hydrated.current) return;
    savePref(PREF_UI_SCALE, uiScale);
  }, [uiScale]);

  useEffect(() => {
    if (!hydrated.current) return;
    savePref(PREF_CUSTOM_THEMES, customThemes);
  }, [customThemes]);

  const flash = useCallback((label: string) => {
    setSavedLabel(label);
    setSavedAt(Date.now());
  }, []);

  const isCustomTheme = useCallback(
    (id: string) => Object.prototype.hasOwnProperty.call(customThemes, id),
    [customThemes]
  );

  /**
   * Write a new state and, when the active theme is one of the user's saved
   * ones, fold the change back into it so reopening the theme keeps the
   * tweaks. Kept out of the setState updater on purpose — updaters must stay
   * free of side effects.
   */
  const commitState = useCallback(
    (next: ThemeState, label = 'Auto-saved') => {
      setState(next);
      setSavedLabel(label);
      if (Object.prototype.hasOwnProperty.call(customThemes, next.id)) {
        setCustomThemes((map) => ({ ...map, [next.id]: customEntryFromState(next) }));
      }
    },
    [customThemes]
  );

  /**
   * A colour edit. Editing a built-in preset leaves it behind for the
   * transient `custom` slot rather than mutating the preset itself.
   */
  const commitEdit = useCallback(
    (patch: Partial<ThemeState>, label = 'Auto-saved') => {
      const nextId = isCustomTheme(state.id) ? state.id : 'custom';
      commitState({ ...state, ...patch, id: nextId }, label);
    },
    [state, isCustomTheme, commitState]
  );

  const selectTheme = useCallback(
    (id: string) => {
      const custom = customThemes[id];
      if (custom) {
        setState(stateFromCustom(id, custom));
        setSavedLabel('Theme applied');
        return;
      }
      const theme = getThemeById(id);
      if (!theme) return;
      setState(defaultStateFor(theme.id, theme.colors, theme.advanced));
      setSavedLabel('Theme applied');
    },
    [customThemes]
  );

  const setBaseColor = useCallback(
    (key: BaseKey, value: string) => {
      const hex = normalizeHex(value);
      if (!isHex6(hex)) return;
      commitEdit({ colors: { ...state.colors, [key]: hex } });
    },
    [state.colors, commitEdit]
  );

  const setAdvancedColor = useCallback(
    (key: AdvancedKey, value: string) => {
      const hex = normalizeHex(value);
      if (!isHex6(hex)) return;
      const defaults = computeAdvancedDefaults(state.colors);
      const advanced: AdvancedColors = { ...(state.advanced || {}) };
      // Matching the computed default means "no override" — the zone keeps
      // tracking the base palette instead of freezing at today's value.
      if (hex.toLowerCase() === (defaults[key] || '').toLowerCase()) delete advanced[key];
      else advanced[key] = hex;
      commitEdit({ advanced: Object.keys(advanced).length ? advanced : undefined });
    },
    [state.colors, state.advanced, commitEdit]
  );

  const clearAdvanced = useCallback(
    () => commitEdit({ advanced: undefined }, 'Overrides cleared'),
    [commitEdit]
  );

  const applyPalette = useCallback(
    (colors: ThemeColors) => commitEdit({ colors }, 'Palette applied'),
    [commitEdit]
  );

  // The palette the current theme started from — what the per-row reset
  // buttons snap back to, and what makes them light up as "changed".
  const referenceColors = useMemo<ThemeColors>(() => {
    const preset = getThemeById(state.originId);
    if (preset) return preset.colors;
    const custom = customThemes[state.originId];
    if (custom) return custom.colors;
    return state.colors;
  }, [state.originId, state.colors, customThemes]);

  const advancedDefaults = useMemo(
    () => computeAdvancedDefaults(state.colors),
    [state.colors]
  );

  const resetBaseColor = useCallback(
    (key: BaseKey) => setBaseColor(key, referenceColors[key]),
    [setBaseColor, referenceColors]
  );

  const resetAdvancedColor = useCallback(
    (key: AdvancedKey) => setAdvancedColor(key, advancedDefaults[key]),
    [setAdvancedColor, advancedDefaults]
  );

  const setFont = useCallback((font: FontKey) => commitEdit({ font }), [commitEdit]);
  const setDensity = useCallback((density: DensityKey) => commitEdit({ density }), [commitEdit]);
  const setPattern = useCallback((pattern: PatternKey) => commitEdit({ pattern }), [commitEdit]);
  const setEffectIntensity = useCallback(
    (v: number) => commitEdit({ effectIntensity: Math.max(0, Math.min(1, v)) }),
    [commitEdit]
  );
  const setEffectSize = useCallback(
    (v: number) => commitEdit({ effectSize: Math.max(0.3, Math.min(2.5, v)) }),
    [commitEdit]
  );
  const setFrosted = useCallback((frosted: boolean) => commitEdit({ frosted }), [commitEdit]);
  const setReactive = useCallback((reactive: boolean) => commitEdit({ reactive }), [commitEdit]);

  const setEffectColor = useCallback(
    (color: string) => {
      const hex = normalizeHex(color);
      if (!isHex6(hex)) return;
      commitEdit({ effectColor: hex });
    },
    [commitEdit]
  );

  const resetEffectColor = useCallback(() => commitEdit({ effectColor: '' }), [commitEdit]);

  const setUiScale = useCallback((scale: UiScale) => setUiScaleState(scale), []);

  const saveCustomTheme = useCallback(
    (name: string): SaveResult => {
      const trimmed = name.trim();
      if (!trimmed) return { ok: false, error: 'Enter a name.' };
      const slug = slugify(trimmed);
      if (!slug) return { ok: false, error: 'Invalid name.' };
      if (getThemeById(slug)) return { ok: false, error: 'Cannot overwrite a built-in theme.' };
      const exists = Object.prototype.hasOwnProperty.call(customThemes, slug);
      if (!exists && Object.keys(customThemes).length >= MAX_CUSTOM_THEMES) {
        return { ok: false, error: `Max ${MAX_CUSTOM_THEMES} custom themes. Delete one first.` };
      }
      const next: ThemeState = { ...state, id: slug, originId: slug };
      setCustomThemes((prev) => ({ ...prev, [slug]: customEntryFromState(next) }));
      setState(next);
      flash('Theme saved');
      return { ok: true };
    },
    [customThemes, state, flash]
  );

  const deleteCustomTheme = useCallback(
    (name: string) => {
      setCustomThemes((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
      // Deleting the theme you are wearing drops you back to the default.
      setState((prev) =>
        prev.id === name
          ? defaultStateFor(
              DEFAULT_THEME_ID,
              (getThemeById(DEFAULT_THEME_ID) || THEMES[0]).colors
            )
          : prev
      );
    },
    []
  );

  const exportTheme = useCallback(() => JSON.stringify(state, null, 2), [state]);

  const importTheme = useCallback(
    (json: string): SaveResult => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(json.trim());
      } catch {
        return { ok: false, error: 'Invalid JSON.' };
      }
      if (!parsed || typeof parsed !== 'object') {
        return { ok: false, error: 'Invalid theme object.' };
      }
      const raw = parsed as Record<string, unknown>;
      const colors = (raw.colors || raw) as Record<string, unknown>;
      const required: BaseKey[] = ['bg', 'sidebar', 'card', 'border', 'primary', 'text', 'textMuted'];
      const missing = required.filter((k) => !colors[k]);
      if (missing.length) return { ok: false, error: 'Missing: ' + missing.join(', ') };
      const bad = required.filter((k) => !isHex6(String(colors[k])));
      if (bad.length) return { ok: false, error: 'Bad hex for ' + bad.join(', ') };

      const name = typeof raw.id === 'string' && raw.id ? raw.id : 'imported';
      const slug = slugify(name) || 'imported';
      if (getThemeById(slug)) return { ok: false, error: 'Cannot overwrite a built-in theme.' };
      const exists = Object.prototype.hasOwnProperty.call(customThemes, slug);
      if (!exists && Object.keys(customThemes).length >= MAX_CUSTOM_THEMES) {
        return { ok: false, error: `Max ${MAX_CUSTOM_THEMES} custom themes. Delete one first.` };
      }

      const next = coerceState({ ...raw, id: slug, colors });
      setCustomThemes((prev) => ({ ...prev, [slug]: customEntryFromState(next) }));
      setState(next);
      flash('Theme imported');
      return { ok: true };
    },
    [customThemes, flash]
  );

  const resetToDefault = useCallback(() => {
    const theme = getThemeById(DEFAULT_THEME_ID) || THEMES[0];
    setState(defaultStateFor(theme.id, theme.colors, theme.advanced));
    setUiScaleState('100');
    flash('Reset to default');
  }, [flash]);

  const value = useMemo<ThemeContextType>(
    () => ({
      state,
      customThemes,
      uiScale,
      savedAt,
      savedLabel,
      syncStatus,
      selectTheme,
      setBaseColor,
      setAdvancedColor,
      clearAdvanced,
      resetBaseColor,
      resetAdvancedColor,
      applyPalette,
      setFont,
      setDensity,
      setUiScale,
      setPattern,
      setEffectColor,
      resetEffectColor,
      setEffectIntensity,
      setEffectSize,
      setFrosted,
      setReactive,
      saveCustomTheme,
      deleteCustomTheme,
      exportTheme,
      importTheme,
      resetToDefault,
      referenceColors,
      advancedDefaults,
      isCustomTheme,
    }),
    [
      state, customThemes, uiScale, savedAt, savedLabel, syncStatus, selectTheme, setBaseColor,
      setAdvancedColor, clearAdvanced, resetBaseColor, resetAdvancedColor, applyPalette,
      setFont, setDensity, setUiScale, setPattern, setEffectColor, resetEffectColor,
      setEffectIntensity, setEffectSize, setFrosted, setReactive, saveCustomTheme, deleteCustomTheme,
      exportTheme, importTheme, resetToDefault, referenceColors, advancedDefaults, isCustomTheme,
    ]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}
