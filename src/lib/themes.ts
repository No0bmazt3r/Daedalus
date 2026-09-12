// Theme system — preset themes, live customization, derived colors,
// background effects, typography and persistence.
//
// Ported from the Odysseus theme engine (static/js/theme.js) and adapted to
// the Daedalus palette model: where Odysseus works with 5 base colors
// (bg / fg / panel / border / red), Daedalus carries 7 (bg / sidebar / card /
// border / primary / text / textMuted) because the React components already
// bind to those CSS variables.

export type FontKey = 'sans' | 'mono' | 'serif' | 'opendyslexic';
export type DensityKey = 'compact' | 'comfortable' | 'spacious';
export type UiScale = '100' | '125';
export type PatternKey =
  | 'none' | 'dots' | 'synapse' | 'rain' | 'constellations'
  | 'perlin-flow' | 'petals' | 'sparkles' | 'embers';
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
}

export const LS_THEME_STATE = 'daedalus-theme-state';
export const LS_THEME_ID = 'daedalus-theme';
export const LS_CUSTOM_THEMES = 'daedalus-custom-themes';
export const LS_UI_SCALE = 'daedalus-ui-scale';

export const DEFAULT_THEME_ID = 'oled';
export const DEFAULT_FONT: FontKey = 'sans';
export const DEFAULT_DENSITY: DensityKey = 'comfortable';
export const DEFAULT_UI_SCALE: UiScale = '100';
export const MAX_CUSTOM_THEMES = 8;

export const THEME_CHANGE_EVENT = 'daedalus-theme-change';

export const FONT_MAP: Record<FontKey, string> = {
  sans: "'Geist Variable', system-ui, -apple-system, 'Segoe UI', sans-serif",
  mono: "'Fira Code', ui-monospace, SFMono-Regular, Menlo, monospace",
  serif: "Georgia, 'Times New Roman', serif",
  opendyslexic: "'OpenDyslexic', 'Comic Sans MS', sans-serif",
};

export const FONT_OPTIONS: { value: FontKey; label: string }[] = [
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
  oled: 'none',
  dark: 'none',
  light: 'dots',
  paper: 'dots',
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
  gpt: 'none',
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
  | 'toggleActive';

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

// ── Applying a theme to the document ─────────────────────────────────────

export function applyColors(colors: ThemeColors, advanced?: AdvancedColors) {
  const s = document.documentElement.style;
  s.setProperty('--bg', colors.bg);
  s.setProperty('--sidebar', colors.sidebar);
  s.setProperty('--card', colors.card);
  s.setProperty('--border', colors.border);
  s.setProperty('--primary', colors.primary);
  s.setProperty('--text-main', colors.text);
  s.setProperty('--text-muted', colors.textMuted);

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
export function applyFrostedGlass(on: boolean) {
  document.body.classList.toggle('theme-frosted', !!on);
}

export function applyThemeState(state: ThemeState) {
  applyColors(state.colors, state.advanced);
  applyFontDensity(state.font, state.density);
  applyBgEffectColor(state.effectColor);
  applyBgEffectIntensity(state.effectIntensity);
  applyBgEffectSize(state.effectSize);
  applyFrostedGlass(state.frosted);
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
}

export type CustomThemeMap = Record<string, CustomThemeEntry>;

function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJSON(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode / quota — the look still applies for this session */
  }
}

export function loadCustomThemes(): CustomThemeMap {
  const raw = readJSON<CustomThemeMap>(LS_CUSTOM_THEMES, {});
  return raw && typeof raw === 'object' ? raw : {};
}

export function persistCustomThemes(map: CustomThemeMap) {
  writeJSON(LS_CUSTOM_THEMES, map);
}

export function loadUiScale(): UiScale {
  try {
    const v = localStorage.getItem(LS_UI_SCALE);
    return v === '125' ? '125' : DEFAULT_UI_SCALE;
  } catch {
    return DEFAULT_UI_SCALE;
  }
}

export function persistUiScale(scale: UiScale) {
  try {
    localStorage.setItem(LS_UI_SCALE, scale);
  } catch {
    /* ignore */
  }
}

export function persistThemeState(state: ThemeState) {
  writeJSON(LS_THEME_STATE, state);
  try {
    localStorage.setItem(LS_THEME_ID, state.id);
  } catch {
    /* ignore */
  }
}

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

  const fonts: FontKey[] = ['sans', 'mono', 'serif', 'opendyslexic'];
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
  };
}

/**
 * Restore the saved look, migrating the old `daedalus-theme` string key
 * (which only ever held a theme id) to the richer state object.
 */
export function loadThemeState(): ThemeState {
  const stored = readJSON<unknown>(LS_THEME_STATE, null);
  if (stored) return coerceState(stored);

  let legacyId = DEFAULT_THEME_ID;
  try {
    legacyId = localStorage.getItem(LS_THEME_ID) || DEFAULT_THEME_ID;
  } catch {
    /* ignore */
  }
  const theme = getThemeById(legacyId) || THEMES[0];
  return defaultStateFor(theme.id, theme.colors, theme.advanced);
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
  };
}

export function slugify(name: string): string {
  return name.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}
