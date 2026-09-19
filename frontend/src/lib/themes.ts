// Theme system — preset themes, live customization, derived colors,
// background effects, typography and persistence.
//
// Ported from the Odysseus theme engine (static/js/theme.js) and adapted to
// the Daedalus palette model: where Odysseus works with 5 base colors
// (bg / fg / panel / border / red), Daedalus carries 7 (bg / sidebar / card /
// border / primary / text / textMuted) because the React components already
// bind to those CSS variables.

export type FontKey = 'minecraft' | 'sans' | 'mono' | 'serif' | 'opendyslexic';
export type DensityKey = 'compact' | 'comfortable' | 'spacious';
export type UiScale = '100' | '125';
export type PatternKey =
  | 'none' | 'dots' | 'synapse' | 'rain' | 'constellations'
  | 'perlin-flow' | 'petals' | 'sparkles' | 'embers' | 'nexus'
  | 'aurora' | 'bubbles' | 'voxels';
export type HarmonyKey = 'complementary' | 'analogous' | 'triadic' | 'monochromatic';

export interface ThemeColors {
  bg: string;
  sidebar: string;
  card: string;
  border: string;
  primary: string;
  text: string;
  textMuted: string;
}

/** Optional per-zone overrides layered on top of the base palette. */
export type AdvancedColors = Partial<Record<AdvancedKey, string>>;

export interface Theme {
  id: string;
  name: string;
  colors: ThemeColors;
  advanced?: AdvancedColors;
}

/** Everything that makes up "the current look", persisted as one object. */
export interface ThemeState {
  id: string;
  /**
   * The theme the current palette was last derived from. Editing a preset
   * moves `id` to the transient `custom` slot, but the per-row reset buttons
   * still need to know what to snap back to.
   */
  originId: string;
  colors: ThemeColors;
  advanced?: AdvancedColors;
  font: FontKey;
  density: DensityKey;
  pattern: PatternKey;
  /** '' means "follow the theme's primary colour". */
  effectColor: string;
  /** 0..1 */
  effectIntensity: number;
  /** 0.3..2.5 multiplier */
  effectSize: number;
  frosted: boolean;
  /** Whether the background effect responds to the pointer. */
  reactive: boolean;
  /**
   * How loading skeletons are drawn. `pixel` squares the corners, lays a block
   * grid over them and steps the shimmer, to sit with Monocraft; `smooth` is
   * the rounded, gliding default.
   */
  skeleton: SkeletonStyle;
}

export type SkeletonStyle = 'smooth' | 'pixel';

export const DEFAULT_SKELETON: SkeletonStyle = 'pixel';

export const DEFAULT_THEME_ID = 'oled';
export const DEFAULT_FONT: FontKey = 'minecraft';
export const DEFAULT_DENSITY: DensityKey = 'comfortable';
export const DEFAULT_UI_SCALE: UiScale = '100';
export const MAX_CUSTOM_THEMES = 8;

export const THEME_CHANGE_EVENT = 'daedalus-theme-change';

export const FONT_MAP: Record<FontKey, string> = {
  // Monocraft, bundled at src/assets/fonts and declared in index.css. It is
  // monospaced, so the fallbacks are too — a proportional fallback would
  // re-flow every table and log view if the woff2 ever failed to load.
  minecraft: "'Monocraft', ui-monospace, SFMono-Regular, Menlo, monospace",
  sans: "'Geist Variable', system-ui, -apple-system, 'Segoe UI', sans-serif",
  mono: "'Fira Code', ui-monospace, SFMono-Regular, Menlo, monospace",
  serif: "Georgia, 'Times New Roman', serif",
  opendyslexic: "'OpenDyslexic', 'Comic Sans MS', sans-serif",
};

export const FONT_OPTIONS: { value: FontKey; label: string }[] = [
  { value: 'minecraft', label: 'Minecraft (Monocraft)' },
  { value: 'sans', label: 'Sans-serif (Geist)' },
  { value: 'mono', label: 'Monospace' },
  { value: 'serif', label: 'Serif' },
  { value: 'opendyslexic', label: 'OpenDyslexic (dyslexia-friendly)' },
];

export const DENSITY_OPTIONS: { value: DensityKey; label: string }[] = [
  { value: 'compact', label: 'Compact' },
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'spacious', label: 'Spacious' },
];

export const UI_SCALE_OPTIONS: { value: UiScale; label: string }[] = [
  { value: '100', label: 'Default' },
  { value: '125', label: 'Larger' },
];

export const PATTERN_OPTIONS: { value: PatternKey; label: string }[] = [
  { value: 'none', label: 'Solid' },
  { value: 'dots', label: 'Dots' },
  { value: 'synapse', label: 'Synapse' },
  { value: 'rain', label: 'Rain' },
  { value: 'constellations', label: 'Constellations' },
  { value: 'perlin-flow', label: 'Perlin Flow' },
  { value: 'petals', label: 'Petals' },
  { value: 'sparkles', label: 'Sparkles' },
  { value: 'embers', label: 'Embers' },
  { value: 'nexus', label: 'Nexus' },
  { value: 'aurora', label: 'Aurora' },
  { value: 'bubbles', label: 'Bubbles' },
  { value: 'voxels', label: 'Voxels' },
];

/** Patterns where the intensity / size sliders have nothing to act on. */
export const STATIC_PATTERNS = new Set<PatternKey>(['none', 'dots']);

export const THEMES: Theme[] = [
  {
    id: 'oled',
    name: 'OLED Black',
    colors: {
      bg: '#000000',
      sidebar: '#09090b',
      card: '#18181b',
      border: '#27272a',
      primary: '#34d399',
      text: '#f4f4f5',
      textMuted: '#a1a1aa',
    },
  },
  {
    id: 'dark',
    name: 'Dark Matter',
    colors: {
      bg: '#282c34',
      sidebar: '#111111',
      card: '#161616',
      border: '#355a66',
      primary: '#9cdef2',
      text: '#9cdef2',
      textMuted: '#669dae',
    },
  },
  {
    id: 'light',
    name: 'Daylight',
    colors: {
      bg: '#f0ebe3',
      sidebar: '#faf6f0',
      card: '#ffffff',
      border: '#d4cdc2',
      primary: '#c47d5a',
      text: '#5a5248',
      textMuted: '#8a8278',
    },
  },
  {
    id: 'paper',
    name: 'Paper',
    colors: {
      bg: '#faf8f5',
      sidebar: '#ffffff',
      card: '#ffffff',
      border: '#d5d0c8',
      primary: '#c5ac4a',
      text: '#3b3836',
      textMuted: '#7c7871',
    },
  },
  {
    id: 'midnight',
    name: 'Midnight',
    colors: {
      bg: '#0d1117',
      sidebar: '#161b22',
      card: '#21262d',
      border: '#30363d',
      primary: '#f85149',
      text: '#c9d1d9',
      textMuted: '#8b949e',
    },
  },
  {
    id: 'cyberpunk',
    name: 'Cyberpunk',
    colors: {
      bg: '#0a0a0f',
      sidebar: '#12101a',
      card: '#181523',
      border: '#9b30ff',
      primary: '#0ff0fc',
      text: '#0ff0fc',
      textMuted: '#89b4b6',
    },
  },
  {
    id: 'retrowave',
    name: 'Retrowave',
    colors: {
      bg: '#1a1a2e',
      sidebar: '#16213e',
      card: '#1a274c',
      border: '#533483',
      primary: '#e94560',
      text: '#e94560',
      textMuted: '#a93345',
    },
  },
  {
    id: 'forest',
    name: 'Forest',
    colors: {
      bg: '#1b2a1b',
      sidebar: '#142414',
      card: '#1c301c',
      border: '#3d6b3d',
      primary: '#7cb871',
      text: '#a8d5a2',
      textMuted: '#71946e',
    },
  },
  {
    id: 'ocean',
    name: 'Deep Ocean',
    colors: {
      bg: '#0b1a2c',
      sidebar: '#091422',
      card: '#132742',
      border: '#1e5074',
      primary: '#4facfe',
      text: '#64d2ff',
      textMuted: '#4a9ac0',
    },
  },
  {
    id: 'ume',
    name: 'Ume',
    colors: {
      bg: '#2b1b2e',
      sidebar: '#1e1420',
      card: '#271a2a',
      border: '#6c4675',
      primary: '#f5a0c0',
      text: '#f5c2e7',
      textMuted: '#b68fac',
    },
  },
  {
    id: 'copper',
    name: 'Copper',
    colors: {
      bg: '#1c1410',
      sidebar: '#140f0a',
      card: '#1f1811',
      border: '#7a5533',
      primary: '#d4764e',
      text: '#e8c39e',
      textMuted: '#b09477',
    },
  },
  {
    id: 'terminal',
    name: 'Terminal',
    colors: {
      bg: '#000000',
      sidebar: '#0a0a0a',
      card: '#111111',
      border: '#003b00',
      primary: '#00ff41',
      text: '#00ff41',
      textMuted: '#00a32a',
    },
  },
  {
    id: 'organs',
    name: 'Organs',
    colors: {
      bg: '#0a0406',
      sidebar: '#15080a',
      card: '#1b0a0d',
      border: '#3a1519',
      primary: '#c83240',
      text: '#efe1c8',
      textMuted: '#a2957f',
    },
  },
  {
    id: 'lavender',
    name: 'Lavender',
    colors: {
      bg: '#f3eef8',
      sidebar: '#faf7ff',
      card: '#ffffff',
      border: '#cec3de',
      primary: '#9b6dcc',
      text: '#3d3551',
      textMuted: '#7a7090',
    },
  },
  {
    id: 'gpt',
    name: 'Graphite',
    colors: {
      bg: '#212121',
      sidebar: '#171717',
      card: '#2f2f2f',
      border: '#424242',
      primary: '#ececec',
      text: '#ececec',
      textMuted: '#949494',
    },
  },
  {
    id: 'cute',
    name: 'Cute',
    colors: {
      bg: '#fff0f5',
      sidebar: '#fff8fa',
      card: '#ffffff',
      border: '#f0c0d0',
      primary: '#ff6b9d',
      text: '#d4608a',
      textMuted: '#a84c6e',
    },
  },
];

/** Default background effect per built-in theme. */
export const THEME_DEFAULT_PATTERN: Record<string, PatternKey> = {
  oled: 'nexus',
  dark: 'nexus',
  light: 'nexus',
  paper: 'nexus',
  midnight: 'rain',
  cyberpunk: 'synapse',
  retrowave: 'embers',
  forest: 'petals',
  ocean: 'constellations',
  terminal: 'perlin-flow',
  organs: 'rain',
  ume: 'petals',
  lavender: 'sparkles',
  copper: 'embers',
  gpt: 'nexus',
  cute: 'sparkles',
};

/** Themes whose effect colour should not simply follow `primary`. */
export const THEME_DEFAULT_EFFECT_COLOR: Record<string, string> = {
  midnight: '#ffffff',
  organs: '#451616',
  cute: '#ff8cb8',
  ume: '#f5a0c0',
};

/** Default effect intensity (0..1). Anything unlisted is full strength. */
export const THEME_DEFAULT_INTENSITY: Record<string, number> = {
  midnight: 0.5,
  terminal: 0.8,
  organs: 0.65,
};

/** Themes that start with frosted glass on. */
export const THEME_DEFAULT_FROSTED: Record<string, boolean> = {
  lavender: true,
};

/**
 * Themes whose background reacts to the pointer out of the box — every theme
 * that ships with an animated effect, since a still background has nothing to
 * react with.
 */
// Pointer reactivity was removed — see `lib/pointerField.ts`. Kept as an empty
// record so the shape of `ThemeState` and every stored theme stays valid, and
// so a reader finds this note rather than a missing symbol.
export const THEME_DEFAULT_REACTIVE: Record<string, boolean> = {};

// ── Colour maths ──────────────────────────────────────────────────────────

export function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
  return m
    ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) }
    : null;
}

export function hexToHSL(hex: string): [number, number, number] {
  const rgb = hexToRgb(hex) || { r: 0, g: 0, b: 0 };
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return [h * 360, s * 100, l * 100];
}

export function hslToHex(h: number, s: number, l: number): string {
  const hh = ((h % 360) + 360) % 360;
  const ss = Math.max(0, Math.min(100, s)) / 100;
  const ll = Math.max(0, Math.min(100, l)) / 100;
  const a = ss * Math.min(ll, 1 - ll);
  const f = (n: number) => {
    const k = (n + hh / 30) % 12;
    return ll - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  const toHex = (v: number) => Math.round(v * 255).toString(16).padStart(2, '0');
  return '#' + toHex(f(0)) + toHex(f(8)) + toHex(f(4));
}

/** Normalise anything CSS hands back (rgb(), #abc, #ABCDEF) to #rrggbb. */
export function normalizeHex(raw: string): string {
  let h = String(raw || '').trim().toLowerCase();
  if (!h) return '';
  const rgb = h.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (rgb) {
    const hx = (n: string) =>
      Math.max(0, Math.min(255, parseInt(n, 10))).toString(16).padStart(2, '0');
    return '#' + hx(rgb[1]) + hx(rgb[2]) + hx(rgb[3]);
  }
  if (h[0] !== '#') h = '#' + h;
  if (/^#[0-9a-f]{3}$/.test(h)) {
    return '#' + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
  }
  return h;
}

export function isHex6(v: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(String(v || ''));
}

export interface SyntaxColors {
  bg: string; fg: string; keyword: string; string: string; comment: string;
  function: string; number: string; builtin: string; variable: string; params: string;
}

/** Derive a full syntax-highlighting ramp from the three anchor colours. */
export function deriveSyntaxColors(colors: ThemeColors): SyntaxColors {
  const [fgH, fgS, fgL] = hexToHSL(colors.text);
  const [bgH, bgS, bgL] = hexToHSL(colors.bg);
  const [redH, redS] = hexToHSL(colors.primary || '#e06c75');
  const isDark = bgL < 50;
  const codeBgL = isDark ? Math.max(bgL - 4, 0) : Math.min(bgL + 4, 100);
  return {
    bg: hslToHex(bgH, bgS, codeBgL),
    fg: colors.text,
    keyword: hslToHex((redH + 280) % 360, Math.min(redS + 10, 80), isDark ? 70 : 45),
    string: hslToHex(40, Math.min(fgS + 20, 70), isDark ? 72 : 42),
    comment: hslToHex(fgH, Math.max(fgS - 20, 5), fgL * 0.5 + bgL * 0.5),
    function: hslToHex(210, Math.min(fgS + 20, 75), isDark ? 70 : 45),
    number: hslToHex(20, Math.min(fgS + 15, 65), isDark ? 68 : 48),
    builtin: hslToHex(180, Math.min(fgS + 15, 60), isDark ? 65 : 40),
    variable: hslToHex((fgH + 30) % 360, Math.min(fgS + 5, 60), fgL),
    params: hslToHex(fgH, Math.max(fgS - 5, 10), isDark ? Math.min(fgL + 8, 85) : Math.max(fgL - 8, 25)),
  };
}

/** WCAG relative luminance. */
export function relativeLuminance(hex: string): number {
  const rgb = hexToRgb(hex) || { r: 0, g: 0, b: 0 };
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b);
}

/** WCAG contrast ratio between two colours, 1..21. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The accent used for incognito mode.
 *
 * Incognito has to read as a *different* state from the normal accent, so a
 * complementary rotation of the theme's own accent gives a colour that is both
 * clearly distinct and still harmonious with the palette. Saturation gets a
 * floor (a muted accent would otherwise produce a muted, easily-missed state)
 * and lightness is walked away from the background until the result is
 * genuinely legible — a fixed lightness fails on very light themes, where a
 * mid-tone complement washes out to barely 2:1.
 */
export function deriveIncognitoColor(colors: ThemeColors): string {
  const [h, s] = hexToHSL(colors.primary);
  const [, , bgL] = hexToHSL(colors.bg);
  const isDark = bgL < 50;
  // A near-greyscale accent has no meaningful hue to rotate, so those themes
  // fall back to the violet that incognito conventionally uses.
  const hue = s < 12 ? 265 : (h + 150) % 360;
  const sat = Math.min(Math.max(s, 55), 85);

  const TARGET = 4.5;
  let l = isDark ? 68 : 45;
  const step = isDark ? 3 : -3;
  let best = hslToHex(hue, sat, l);
  let bestRatio = contrastRatio(best, colors.bg);

  for (let i = 0; i < 30 && l >= 5 && l <= 95; i++) {
    const candidate = hslToHex(hue, sat, l);
    const ratio = contrastRatio(candidate, colors.bg);
    if (ratio >= TARGET) return candidate;
    if (ratio > bestRatio) {
      best = candidate;
      bestRatio = ratio;
    }
    l += step;
  }
  // Nothing hit the target (a mid-grey background leaves little room) — keep
  // whichever step read best rather than returning an arbitrary one.
  return best;
}

// ── Base palette rows (the "Colors" card) ────────────────────────────────

export type BaseKey = keyof ThemeColors;

export const BASE_KEYS: { key: BaseKey; css: string; label: string }[] = [
  { key: 'bg', css: '--bg', label: 'Background' },
  { key: 'text', css: '--text-main', label: 'Text' },
  { key: 'textMuted', css: '--text-muted', label: 'Muted Text' },
  { key: 'card', css: '--card', label: 'Panel' },
  { key: 'sidebar', css: '--sidebar', label: 'Sidebar' },
  { key: 'border', css: '--border', label: 'Border' },
  { key: 'primary', css: '--primary', label: 'Accent' },
];

// ── Advanced per-zone overrides (the "More Colors" section) ──────────────

export type AdvancedKey =
  | 'userBubbleBg' | 'aiBubbleBg' | 'bubbleBorder'
  | 'sidebarBg' | 'brandColor' | 'brandMixTo'
  | 'inputBg' | 'inputBorder' | 'sendBtnBg' | 'sendBtnHover'
  | 'codeBg' | 'codeFg'
  | 'toggleActive' | 'incognitoAccent';

export const ADV_KEYS: { key: AdvancedKey; css: string; label: string; group: string }[] = [
  { key: 'userBubbleBg', css: '--user-bubble-bg', label: 'User Chat Bubble', group: 'Chat Bubbles' },
  { key: 'aiBubbleBg', css: '--ai-bubble-bg', label: 'AI Chat Bubble', group: 'Chat Bubbles' },
  { key: 'bubbleBorder', css: '--bubble-border', label: 'Chat Bubble Border', group: 'Chat Bubbles' },
  { key: 'sidebarBg', css: '--sidebar-bg', label: 'Sidebar Bg', group: 'Sidebar' },
  { key: 'brandColor', css: '--brand-color', label: 'Daedalus Logo', group: 'Sidebar' },
  { key: 'brandMixTo', css: '--brand-mix-to', label: 'Logo Gradient End', group: 'Sidebar' },
  { key: 'inputBg', css: '--input-bg', label: 'Input Bg', group: 'Chat Input / Prompt Area' },
  { key: 'inputBorder', css: '--input-border', label: 'Input Border', group: 'Chat Input / Prompt Area' },
  { key: 'sendBtnBg', css: '--send-btn-bg', label: 'Send Btn', group: 'Chat Input / Prompt Area' },
  { key: 'sendBtnHover', css: '--send-btn-hover', label: 'Send Hover', group: 'Chat Input / Prompt Area' },
  { key: 'codeBg', css: '--code-bg', label: 'Code Bg', group: 'Code Blocks' },
  { key: 'codeFg', css: '--code-fg', label: 'Code Text', group: 'Code Blocks' },
  { key: 'toggleActive', css: '--toggle-active', label: 'Toggle On', group: 'Controls' },
  { key: 'incognitoAccent', css: '--incognito', label: 'Incognito Mode', group: 'Controls' },
];

export const ADV_GROUPS = ['Chat Bubbles', 'Sidebar', 'Chat Input / Prompt Area', 'Code Blocks', 'Controls'];

/**
 * What each advanced zone looks like when the user has not overridden it —
 * every value tracks the base palette, so changing "Accent" slides the send
 * button with it.
 */
export function computeAdvancedDefaults(colors: ThemeColors): Record<AdvancedKey, string> {
  const syn = deriveSyntaxColors(colors);
  return {
    userBubbleBg: colors.sidebar,
    aiBubbleBg: colors.card,
    bubbleBorder: colors.border,
    sidebarBg: colors.sidebar,
    brandColor: colors.primary,
    brandMixTo: colors.text,
    inputBg: colors.card,
    inputBorder: colors.border,
    sendBtnBg: colors.primary,
    sendBtnHover: colors.primary,
    codeBg: syn.bg,
    codeFg: syn.fg,
    toggleActive: colors.primary,
    incognitoAccent: deriveIncognitoColor(colors),
  };
}

// ── Colour harmony generator ─────────────────────────────────────────────

export function generateHarmonyColors(
  accentHex: string,
  harmonyType: HarmonyKey,
  mode: 'dark' | 'light'
): ThemeColors {
  const [h, s] = hexToHSL(accentHex);
  const isDark = mode === 'dark';

  let bgH: number, bgS: number, bgL: number;
  let fgS: number, fgL: number, panelL: number;
  let borderH: number, borderS: number, borderL: number;

  if (harmonyType === 'complementary') {
    bgH = h; bgS = Math.max(s * 0.15, 3);
    bgL = isDark ? 13 : 95; fgL = isDark ? 85 : 15; fgS = Math.max(s * 0.2, 5);
    panelL = isDark ? 8 : 98;
    borderH = h; borderS = Math.max(s * 0.25, 8); borderL = isDark ? 28 : 75;
  } else if (harmonyType === 'analogous') {
    bgH = (h - 30 + 360) % 360; bgS = Math.max(s * 0.12, 3);
    bgL = isDark ? 14 : 95; fgL = isDark ? 84 : 18; fgS = Math.max(s * 0.15, 5);
    panelL = isDark ? 9 : 97;
    borderH = (h + 30) % 360; borderS = Math.max(s * 0.3, 10); borderL = isDark ? 30 : 72;
  } else if (harmonyType === 'triadic') {
    bgH = (h + 240) % 360; bgS = Math.max(s * 0.1, 2);
    bgL = isDark ? 13 : 96; fgL = isDark ? 86 : 14; fgS = Math.max(s * 0.18, 5);
    panelL = isDark ? 8 : 99;
    borderH = (h + 120) % 360; borderS = Math.max(s * 0.2, 8); borderL = isDark ? 28 : 74;
  } else {
    bgH = h; bgS = Math.max(s * 0.08, 2);
    bgL = isDark ? 12 : 96; fgL = isDark ? 87 : 13; fgS = Math.max(s * 0.15, 5);
    panelL = isDark ? 7 : 99;
    borderH = h; borderS = Math.max(s * 0.2, 6); borderL = isDark ? 26 : 76;
  }

  return {
    bg: hslToHex(bgH, bgS, bgL),
    sidebar: hslToHex(bgH, bgS * 0.6, panelL),
    card: hslToHex(bgH, bgS * 0.6, isDark ? panelL + 5 : panelL - 2),
    border: hslToHex(borderH, borderS, borderL),
    primary: accentHex,
    text: hslToHex(h, fgS, fgL),
    textMuted: hslToHex(h, fgS, isDark ? Math.max(fgL - 25, 30) : Math.min(fgL + 30, 65)),
  };
}

// ── Status colours ────────────────────────────────────────────────────────
//
// Green / amber / red for "safe", "marginal" and "will not fit", plus anything
// else that needs to signal a verdict rather than a brand.
//
// These have to be derived rather than written as Tailwind literals. A theme
// here is an arbitrary accent over an arbitrary background, light or dark, so
// `text-amber-400` is legible on a dark surface and almost invisible on a pale
// one — which is exactly what happened to the Forge's "unverified" warnings on
// a cream theme. Deriving them from the background's lightness means one set of
// class names stays readable on every theme anybody builds.
//
// Hues are the conventional ones and deliberately not tinted toward the accent:
// a red that has drifted toward a yellow accent stops reading as an error.

interface StatusColors {
  ok: string;
  warn: string;
  bad: string;
  info: string;
}

/**
 * Status colours pitched against the background they will sit on.
 *
 * On a dark surface they are light and saturated; on a pale one they are dark
 * and saturated. Both directions clear WCAG AA for normal text against their
 * own background, which the mid-range Tailwind defaults do not.
 */
export function deriveStatusColors(colors: ThemeColors): StatusColors {
  const isDark = relativeLuminance(colors.bg) < 0.5;
  return isDark
    ? {
        ok: hslToHex(150, 62, 58),
        warn: hslToHex(38, 92, 62),
        bad: hslToHex(2, 78, 66),
        info: hslToHex(210, 80, 68),
      }
    : {
        // Pitched a little darker than the obvious values: on the palest themes
        // (Daylight, Paper) the mid-range versions landed at 4.44–4.48:1, just
        // under AA, which is the kind of near-miss that only shows up when it
        // is measured rather than eyeballed.
        ok: hslToHex(150, 74, 24),
        warn: hslToHex(28, 94, 29),
        bad: hslToHex(2, 74, 40),
        info: hslToHex(210, 84, 34),
      };
}

/** WCAG AA for normal text. Everything derived here is held to it. */
const AA_CONTRAST = 4.5;

/**
 * The theme's accent, adjusted until it is readable *as text* on the theme's
 * background.
 *
 * `--primary` is chosen to look good as a fill: a bar, a dot, a selected
 * background. Small text is a different job. A pale yellow accent is a fine
 * progress bar and an unreadable label on a cream background — which is exactly
 * what the Forge's headings, active tabs and selected chips turned into.
 *
 * So the hue and saturation are kept, because that is what makes it recognisably
 * *this theme's* accent, and only the lightness moves — away from the
 * background until it clears AA. On a dark theme that means lightening, on a
 * light one darkening. An accent that already passes is returned untouched, so
 * most themes see no change at all.
 */
export function deriveReadableAccent(colors: ThemeColors): string {
  if (contrastRatio(colors.primary, colors.bg) >= AA_CONTRAST) return colors.primary;

  const [h, s, startL] = hexToHSL(colors.primary);
  // Keep some saturation: an accent desaturated to grey stops reading as the
  // theme's colour, which is the whole reason for using it.
  const saturation = Math.max(s, 30);
  const step = relativeLuminance(colors.bg) < 0.5 ? 2 : -2;

  let best = colors.primary;
  let bestRatio = contrastRatio(colors.primary, colors.bg);

  for (let l = startL + step; l >= 0 && l <= 100; l += step) {
    const candidate = hslToHex(h, saturation, l);
    const ratio = contrastRatio(candidate, colors.bg);
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = candidate;
    }
    if (ratio >= AA_CONTRAST) return candidate;
  }
  // Ran out of lightness before clearing AA — return the best found rather than
  // something arbitrary. Only reachable for an accent on a mid-grey background,
  // where nothing of that hue would pass.
  return best;
}

/**
 * The theme's body text colour, floored to AA against its own background.
 *
 * Two shipped themes do not clear it on their own — Cute at 3.26:1 and
 * Retrowave at 4.46:1 — and that is *body* text, not a secondary label. It is
 * also why `deriveReadableMuted` could not fully fix Retrowave: muted is
 * clamped so it never overshoots the body text, so body text being unreadable
 * puts a ceiling on everything quieter than it.
 *
 * Same treatment as the others: hue and saturation held, lightness pushed away
 * from the background only as far as AA requires. A theme that already passes
 * is returned untouched, which is fourteen of the sixteen.
 */
export function deriveReadableText(colors: ThemeColors): string {
  if (contrastRatio(colors.text, colors.bg) >= AA_CONTRAST) return colors.text;

  const [h, s, startL] = hexToHSL(colors.text);
  const step = relativeLuminance(colors.bg) < 0.5 ? 2 : -2;

  let best = colors.text;
  let bestRatio = contrastRatio(colors.text, colors.bg);

  for (let l = startL + step; l >= 0 && l <= 100; l += step) {
    const candidate = hslToHex(h, s, l);
    const ratio = contrastRatio(candidate, colors.bg);
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = candidate;
    }
    if (ratio >= AA_CONTRAST) return candidate;
  }
  return best;
}

/**
 * The theme's muted text colour, nudged until it is actually readable.
 *
 * Muted text is quieter on purpose, but it is still content — a memory
 * breakdown, a provenance note, the reason a model ranked where it did. Several
 * of the shipped themes picked a `textMuted` that looks right next to the main
 * text and does not clear AA against the background: Retrowave sat at 2.64:1,
 * Daylight at 3.19:1, Lavender at 4.04:1. On those, a panel of secondary text
 * reads as a grey smear.
 *
 * So the hue and saturation are kept — that is the theme's character — and the
 * lightness moves *toward the main text colour* until it clears AA. It stops as
 * soon as it passes, so a theme that was already fine is untouched and the
 * others move as little as they can. Muted stays visibly quieter than body
 * text; it just stops being invisible.
 *
 * Applied to every theme, including generated ones, because a user-built theme
 * can land on the same problem and there is nowhere else to catch it.
 */
export function deriveReadableMuted(colors: ThemeColors): string {
  if (contrastRatio(colors.textMuted, colors.bg) >= AA_CONTRAST) return colors.textMuted;

  const [h, s, mutedL] = hexToHSL(colors.textMuted);
  const [, , textL] = hexToHSL(deriveReadableText(colors));
  // Toward the main text, which is by construction the readable end.
  const step = textL > mutedL ? 2 : -2;

  let best = colors.textMuted;
  let bestRatio = contrastRatio(colors.textMuted, colors.bg);

  for (let l = mutedL + step; l >= 0 && l <= 100; l += step) {
    // Never overshoot the body text — muted must stay the quieter of the two.
    if ((step > 0 && l > textL) || (step < 0 && l < textL)) break;
    const candidate = hslToHex(h, s, l);
    const ratio = contrastRatio(candidate, colors.bg);
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = candidate;
    }
    if (ratio >= AA_CONTRAST) return candidate;
  }
  // Reached the body text without clearing AA — then the body text does not
  // clear it either, and this is as close as muted can honestly get.
  return best;
}

/**
 * Black or white, whichever is readable *on* the theme's accent.
 *
 * Buttons that fill with `--primary` need a label colour, and seven of them
 * hardcoded `text-black`. That happens to work for most accents because most
 * are light, but it is luck rather than design: of the shipped themes, Organs'
 * deep red already fails at 3.99:1, and a custom accent is whatever the user
 * picked — a navy or a dark purple would be black on near-black.
 *
 * Only two candidates, because a filled button wants maximum separation from
 * its background and anything in between is worse than both.
 */
export function derivePrimaryContrast(colors: ThemeColors): string {
  const onBlack = contrastRatio('#000000', colors.primary);
  const onWhite = contrastRatio('#ffffff', colors.primary);
  return onBlack >= onWhite ? '#000000' : '#ffffff';
}

// ── Applying a theme to the document ─────────────────────────────────────

export function applyColors(colors: ThemeColors, advanced?: AdvancedColors) {
  const s = document.documentElement.style;
  s.setProperty('--bg', colors.bg);
  s.setProperty('--sidebar', colors.sidebar);
  s.setProperty('--card', colors.card);
  s.setProperty('--border', colors.border);
  s.setProperty('--primary', colors.primary);
  s.setProperty('--text-main', deriveReadableText(colors));
  // Floored to AA — see deriveReadableMuted. Most themes pass untouched.
  s.setProperty('--text-muted', deriveReadableMuted(colors));

  // Accent-as-text. See deriveReadableAccent: --primary stays the fill colour,
  // this is the one anything small and textual should use.
  s.setProperty('--primary-readable', deriveReadableAccent(colors));
  // The label colour for anything filled with --primary.
  s.setProperty('--primary-contrast', derivePrimaryContrast(colors));

  const status = deriveStatusColors(colors);
  s.setProperty('--status-ok', status.ok);
  s.setProperty('--status-warn', status.warn);
  s.setProperty('--status-bad', status.bad);
  s.setProperty('--status-info', status.info);

  // Keep the mobile browser chrome matched to the background.
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', colors.bg);

  const syn = deriveSyntaxColors(colors);
  s.setProperty('--hl-bg', syn.bg);
  s.setProperty('--hl-fg', syn.fg);
  s.setProperty('--hl-keyword', syn.keyword);
  s.setProperty('--hl-string', syn.string);
  s.setProperty('--hl-comment', syn.comment);
  s.setProperty('--hl-function', syn.function);
  s.setProperty('--hl-number', syn.number);
  s.setProperty('--hl-builtin', syn.builtin);
  s.setProperty('--hl-variable', syn.variable);
  s.setProperty('--hl-params', syn.params);

  const adv = advanced || {};
  const defaults = computeAdvancedDefaults(colors);
  for (const { key, css } of ADV_KEYS) {
    s.setProperty(css, adv[key] || defaults[key]);
  }

  updateFavicon(colors.primary);
}

export function applyFontDensity(font: FontKey, density: DensityKey) {
  const family = FONT_MAP[font] || FONT_MAP[DEFAULT_FONT];
  document.documentElement.style.setProperty('--font-family', family);
  // Monocraft is a bitmap face and wants antialiasing off to stay crisp; every
  // other option wants it on. index.css keys that off .font-pixel.
  document.documentElement.classList.toggle('font-pixel', font === 'minecraft');
  document.documentElement.classList.remove('density-compact', 'density-spacious');
  if (density !== 'comfortable') document.documentElement.classList.add('density-' + density);
}

export function applyUiScale(scale: UiScale) {
  document.documentElement.classList.remove('ui-scale-125');
  if (scale === '125') document.documentElement.classList.add('ui-scale-125');
}

export function applyBgEffectColor(color: string) {
  document.documentElement.style.setProperty('--bg-effect-color', color || '');
}

export function applyBgEffectIntensity(v: number) {
  const n = v === undefined || v === null || isNaN(v) ? 1 : Math.max(0, Math.min(1, Number(v)));
  document.documentElement.style.setProperty('--bg-effect-intensity', String(n));
}

export function applyBgEffectSize(v: number) {
  const n = v === undefined || v === null || isNaN(v) ? 1 : Math.max(0.2, Math.min(3, Number(v)));
  document.documentElement.style.setProperty('--bg-effect-size', String(n));
}

/** Translucent + blurred treatment on every panel, modal and dropdown. */
/**
 * Skeleton style, as a data attribute on <html>.
 *
 * An attribute rather than a variable because the difference is structural —
 * border radius, a background grid, a stepped animation — and CSS can express
 * all of that from one selector without every skeleton having to read state.
 */
export function applySkeletonStyle(style: SkeletonStyle) {
  document.documentElement.dataset.skeleton = style;
}

export function applyFrostedGlass(on: boolean) {
  document.body.classList.toggle('theme-frosted', !!on);
}

export function applyReactive(on: boolean) {
  document.documentElement.style.setProperty('--bg-effect-reactive', on ? '1' : '0');
}

export function applyThemeState(state: ThemeState) {
  applyColors(state.colors, state.advanced);
  applyFontDensity(state.font, state.density);
  applyBgEffectColor(state.effectColor);
  applyBgEffectIntensity(state.effectIntensity);
  applyBgEffectSize(state.effectSize);
  applyFrostedGlass(state.frosted);
  applyReactive(state.reactive);
  applySkeletonStyle(state.skeleton);
  window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: state }));
}

async function updateFavicon(color: string) {
  try {
    const response = await fetch('/labyrinth.svg');
    if (!response.ok) return;
    let svgText = await response.text();
    svgText = svgText.replace(/fill="[^"]*"/g, `fill="${color}"`);
    const blob = new Blob([svgText], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    let link = document.querySelector("link[rel~='icon']") as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement('link');
      link.rel = 'icon';
      document.head.appendChild(link);
    }
    const previous = link.href;
    link.href = url;
    if (previous.startsWith('blob:')) URL.revokeObjectURL(previous);
  } catch {
    /* favicon is cosmetic — never let it break a theme switch */
  }
}

// ── Defaults / persistence ───────────────────────────────────────────────

export function getThemeById(id: string): Theme | undefined {
  return THEMES.find((t) => t.id === id);
}

/** The full state a built-in (or custom) theme starts from. */
export function defaultStateFor(
  id: string,
  colors: ThemeColors,
  advanced?: AdvancedColors
): ThemeState {
  return {
    id,
    originId: id,
    colors,
    advanced,
    font: DEFAULT_FONT,
    density: DEFAULT_DENSITY,
    pattern: THEME_DEFAULT_PATTERN[id] ?? 'none',
    effectColor: THEME_DEFAULT_EFFECT_COLOR[id] ?? '',
    effectIntensity: THEME_DEFAULT_INTENSITY[id] ?? 1,
    effectSize: 1,
    frosted: THEME_DEFAULT_FROSTED[id] === true,
    reactive: false,
    skeleton: DEFAULT_SKELETON,
  };
}

export interface CustomThemeEntry {
  colors: ThemeColors;
  advanced?: AdvancedColors;
  font?: FontKey;
  density?: DensityKey;
  pattern?: PatternKey;
  effectColor?: string;
  effectIntensity?: number;
  effectSize?: number;
  frosted?: boolean;
  reactive?: boolean;
}

export type CustomThemeMap = Record<string, CustomThemeEntry>;

/** Fill in anything a stored / imported object is missing. */
export function coerceState(raw: unknown, fallbackId = DEFAULT_THEME_ID): ThemeState {
  const base = getThemeById(fallbackId) || THEMES[0];
  const o = (raw && typeof raw === 'object' ? raw : {}) as Partial<ThemeState>;
  const id = typeof o.id === 'string' && o.id ? o.id : fallbackId;
  const colorsIn = (o.colors || {}) as Partial<ThemeColors>;
  const seed = getThemeById(id)?.colors || base.colors;
  const colors: ThemeColors = {
    bg: isHex6(colorsIn.bg || '') ? colorsIn.bg! : seed.bg,
    sidebar: isHex6(colorsIn.sidebar || '') ? colorsIn.sidebar! : seed.sidebar,
    card: isHex6(colorsIn.card || '') ? colorsIn.card! : seed.card,
    border: isHex6(colorsIn.border || '') ? colorsIn.border! : seed.border,
    primary: isHex6(colorsIn.primary || '') ? colorsIn.primary! : seed.primary,
    text: isHex6(colorsIn.text || '') ? colorsIn.text! : seed.text,
    textMuted: isHex6(colorsIn.textMuted || '') ? colorsIn.textMuted! : seed.textMuted,
  };

  let advanced: AdvancedColors | undefined;
  if (o.advanced && typeof o.advanced === 'object') {
    const clean: AdvancedColors = {};
    for (const { key } of ADV_KEYS) {
      const v = (o.advanced as AdvancedColors)[key];
      if (v && isHex6(v)) clean[key] = normalizeHex(v);
    }
    if (Object.keys(clean).length) advanced = clean;
  }

  const fonts: FontKey[] = ['minecraft', 'sans', 'mono', 'serif', 'opendyslexic'];
  const densities: DensityKey[] = ['compact', 'comfortable', 'spacious'];
  const patterns = PATTERN_OPTIONS.map((p) => p.value);

  return {
    id,
    originId: typeof o.originId === 'string' && o.originId ? o.originId : id,
    colors,
    advanced,
    font: fonts.includes(o.font as FontKey) ? (o.font as FontKey) : DEFAULT_FONT,
    density: densities.includes(o.density as DensityKey) ? (o.density as DensityKey) : DEFAULT_DENSITY,
    pattern: patterns.includes(o.pattern as PatternKey)
      ? (o.pattern as PatternKey)
      : THEME_DEFAULT_PATTERN[id] ?? 'none',
    effectColor: isHex6(o.effectColor || '') ? normalizeHex(o.effectColor!) : '',
    effectIntensity:
      typeof o.effectIntensity === 'number' && !isNaN(o.effectIntensity)
        ? Math.max(0, Math.min(1, o.effectIntensity))
        : THEME_DEFAULT_INTENSITY[id] ?? 1,
    effectSize:
      typeof o.effectSize === 'number' && !isNaN(o.effectSize)
        ? Math.max(0.3, Math.min(2.5, o.effectSize))
        : 1,
    frosted: typeof o.frosted === 'boolean' ? o.frosted : THEME_DEFAULT_FROSTED[id] === true,
    // Coerced rather than read: a theme saved while the feature existed
    // should not bring it back.
    reactive: false,
    // Absent on anything saved before this existed, which is every stored
    // theme and every exported file, so it has to fall back rather than fail.
    skeleton: o.skeleton === 'smooth' || o.skeleton === 'pixel' ? o.skeleton : DEFAULT_SKELETON,
  };
}

export function coerceCustomThemes(raw: unknown): CustomThemeMap {
  if (!raw || typeof raw !== 'object') return {};
  const out: CustomThemeMap = {};
  for (const [name, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (!entry || typeof entry !== 'object') continue;
    const e = entry as CustomThemeEntry;
    if (!e.colors || typeof e.colors !== 'object') continue;
    // Route it through coerceState so a hand-edited or stale server row can
    // never put an invalid colour on the page.
    const state = coerceState({ id: name, ...e });
    out[name] = customEntryFromState(state);
  }
  return out;
}

export function coerceUiScale(raw: unknown): UiScale {
  return raw === '125' ? '125' : DEFAULT_UI_SCALE;
}

/** Turn a stored custom entry into a full state object. */
export function stateFromCustom(name: string, entry: CustomThemeEntry): ThemeState {
  return coerceState({
    id: name,
    originId: name,
    colors: entry.colors,
    advanced: entry.advanced,
    font: entry.font,
    density: entry.density,
    pattern: entry.pattern,
    effectColor: entry.effectColor,
    effectIntensity: entry.effectIntensity,
    effectSize: entry.effectSize,
    frosted: entry.frosted,
    reactive: entry.reactive,
  });
}

export function customEntryFromState(state: ThemeState): CustomThemeEntry {
  return {
    colors: state.colors,
    advanced: state.advanced,
    font: state.font,
    density: state.density,
    pattern: state.pattern,
    effectColor: state.effectColor,
    effectIntensity: state.effectIntensity,
    effectSize: state.effectSize,
    frosted: state.frosted,
    reactive: state.reactive,
  };
}

export function slugify(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}
