// Canonical metadata for the Settings information architecture.
//
// Ported from the Odysseus settings registry: this module *describes* Settings,
// it does not render them. Navigation, search and the sidebar all read from
// here, so a panel is declared exactly once and can never drift out of sync
// between the nav list and the search index.

import {
  Boxes,
  Cpu,
  Clock,
  Database,
  Globe,
  Keyboard,
  Link as LinkIcon,
  List,
  Network,
  Palette,
  Plus,
  Search,
  Settings2,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

export interface SettingsGroup {
  id: string;
  label: string;
  adminOnly?: boolean;
}

export interface SettingsPanel {
  id: string;
  label: string;
  group: string;
  icon: LucideIcon;
  /** Extra search terms that should match this panel but aren't in its label. */
  keywords: string[];
  adminOnly: boolean;
  /** False while a panel is still a placeholder, so search can say so. */
  implemented: boolean;
  /**
   * A retrieval track's own settings: shown only while that track is selected.
   * Each answer comes from one track, so the other track's knobs are noise
   * until somebody switches — and switching is one click in Retrieval Track.
   */
  track?: 'vector' | 'graph';
}

export const SETTINGS_GROUPS: readonly SettingsGroup[] = Object.freeze([
  { id: 'models', label: 'Models & AI' },
  { id: 'data', label: 'Data & Knowledge' },
  { id: 'experience', label: 'Experience' },
  { id: 'administration', label: 'Administration', adminOnly: true },
]);

function panel(p: Omit<SettingsPanel, 'adminOnly' | 'implemented' | 'keywords' | 'track'> &
  Partial<Pick<SettingsPanel, 'adminOnly' | 'implemented' | 'keywords' | 'track'>>): SettingsPanel {
  return Object.freeze({
    adminOnly: false,
    implemented: false,
    keywords: [],
    ...p,
  });
}

/** Order here is the order rendered in the sidebar. */
export const SETTINGS_PANELS: readonly SettingsPanel[] = Object.freeze([
  panel({
    id: 'services', label: 'Add Models', group: 'models', icon: Plus, implemented: true,
    keywords: [
      'models', 'provider', 'endpoint', 'api', 'key', 'cloud', 'openai',
      'anthropic', 'deepseek', 'openrouter', 'groq', 'mistral', 'gemini',
      'baseline', 'benchmark', 'ollama',
    ],
  }),
  panel({
    id: 'added-models', label: 'Added Models', group: 'models', icon: List, implemented: true,
    keywords: ['models', 'configured', 'installed', 'quantization', 'benchmark', 'cloud', 'inventory'],
  }),
  panel({
    id: 'background', label: 'Background Jobs', group: 'models', icon: Clock, implemented: true,
    keywords: [
      'background', 'jobs', 'title', 'titles', 'rename', 'naming', 'chat', 'session', 'history',
      'summary', 'summariser', 'summarizer', 'memory', 'model',
    ],
  }),
  panel({
    id: 'hardware', label: 'Hardware', group: 'models', icon: Cpu, implemented: true,
    keywords: ['hardware', 'ram', 'vram', 'gpu', 'cpu', 'profiler', 'benchmark', 'fit'],
  }),

  panel({
    id: 'databases', label: 'Databases', group: 'data', icon: Database, implemented: true,
    keywords: ['database', 'db', 'sqlite', 'chroma', 'vector', 'sensor', 'audit', 'logs', 'storage', 'health', 'rows', 'raw', 'browse', 'table', 'inspect'],
  }),
  // The knowledge layer: which track answers, then that track's own settings —
  // only the selected track's panel is listed (`track`, `trackVisible`). The id
  // 'knowledge' is kept for the switch so a saved "last open panel" still
  // lands somewhere sensible.
  panel({
    id: 'knowledge', label: 'Retrieval Track', group: 'data', icon: Search, implemented: true,
    keywords: [
      'knowledge base', 'rag', 'track', 'switch', 'compare', 'comparison', 'freeze', 'frozen',
      'graphrag', 'graph', 'vector', 'retrieval',
    ],
  }),
  panel({
    id: 'vector-rag', label: 'Vector RAG', group: 'data', icon: Boxes, implemented: true, track: 'vector',
    keywords: [
      'track 1', 'vector', 'rag', 'rerank', 're-ranking', 'cross-encoder', 'minilm', 'candidates',
      'chroma', 'index', 'embedding', 'chunks', 'documents',
    ],
  }),
  panel({
    id: 'graph-rag', label: 'Graph RAG', group: 'data', icon: Network, implemented: true, track: 'graph',
    keywords: [
      'track 2', 'graph', 'graphrag', 'agent', 'agent loop', 'walk', 'hops', 'budget', 'steps',
      'traversal', 'sufficiency',
    ],
  }),

  panel({
    id: 'search', label: 'Search', group: 'data', icon: Globe, implemented: true,
    keywords: [
      'search', 'web', 'internet', 'provider', 'searxng', 'duckduckgo', 'brave',
      'google', 'pse', 'tavily', 'serper', 'api', 'key', 'fallback', 'sourcing',
      'corpus', 'documents', 'safesearch',
    ],
  }),

  panel({
    id: 'appearance', label: 'Appearance', group: 'experience', icon: Palette, implemented: true,
    keywords: ['appearance', 'theme', 'colour', 'color', 'font', 'density', 'effects', 'peek'],
  }),
  panel({
    id: 'shortcuts', label: 'Shortcuts', group: 'experience', icon: Keyboard, implemented: true,
    keywords: ['shortcuts', 'keyboard', 'hotkeys', 'incognito', 'toggles'],
  }),

  // Integrations sits beside Agent Tools rather than in a group of its own: an
  // MCP server is the external half of the tool layer, and the two screens are
  // read together — one lists what can be called, the other what it can reach.
  panel({
    id: 'integrations', label: 'Integrations', group: 'administration', icon: LinkIcon,
    adminOnly: true, implemented: true,
    keywords: [
      'integrations', 'connections', 'services', 'mcp', 'server', 'external',
      'model context protocol', 'stdio', 'http', 'tools', 'pin', 'drift',
    ],
  }),
  panel({
    id: 'tools', label: 'Agent Tools', group: 'administration', icon: Wrench, adminOnly: true,
    implemented: true,
    keywords: [
      'agent', 'tools', 'sensor', 'trend', 'retrieve', 'capability',
      'effects', 'citable', 'evidence', 'graph', 'traverse', 'corpus', 'session',
      'clock', 'ask', 'permissions', 'gate',
    ],
  }),
  panel({
    id: 'system', label: 'System', group: 'administration', icon: Settings2, adminOnly: true,
    implemented: true,
    keywords: [
      'system', 'server', 'version', 'diagnostics', 'health', 'logs', 'terminal',
      'console', 'backup', 'export', 'import', 'restore', 'danger', 'wipe',
      'delete', 'reset', 'clear',
    ],
  }),
]);

export const DEFAULT_SETTINGS_PANEL_ID = 'services';

const byId = new Map(SETTINGS_PANELS.map((p) => [p.id, p]));

export function getSettingsPanel(id: string): SettingsPanel | null {
  return byId.get(id) ?? null;
}

export function getGroupLabel(groupId: string): string {
  return SETTINGS_GROUPS.find((g) => g.id === groupId)?.label ?? '';
}

/**
 * Whether a panel belongs to the selected retrieval track. `null` — the track
 * not known yet — hides both track panels rather than flashing the wrong one.
 */
export function trackVisible(p: SettingsPanel, track: string | null): boolean {
  return !p.track || p.track === track;
}

/** Panels in a group, honouring admin visibility and the selected track. */
export function panelsForGroup(groupId: string, isAdmin: boolean, track: string | null = null): SettingsPanel[] {
  return SETTINGS_PANELS.filter(
    (p) => p.group === groupId && (!p.adminOnly || isAdmin) && trackVisible(p, track)
  );
}

export function visibleGroups(isAdmin: boolean, track: string | null = null): SettingsGroup[] {
  return SETTINGS_GROUPS.filter((g) => !g.adminOnly || isAdmin).filter(
    (g) => panelsForGroup(g.id, isAdmin, track).length > 0
  );
}

function haystack(p: SettingsPanel): string {
  return [p.label, getGroupLabel(p.group), ...p.keywords].join(' ').toLowerCase();
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Every term must match somewhere in the panel's label, group or keywords —
 * so "model default" finds AI Defaults while "model email" finds nothing.
 */
export function searchSettingsPanels(
  query: string, isAdmin: boolean, track: string | null = null,
): SettingsPanel[] {
  const normalized = normalize(query);
  if (!normalized) return [];
  const terms = normalized.split(' ');

  return SETTINGS_PANELS.filter((p) => {
    if (p.adminOnly && !isAdmin) return false;
    if (!trackVisible(p, track)) return false;
    const text = haystack(p);
    return terms.every((t) => text.includes(t));
  }).sort((a, b) => {
    // A label match is a stronger signal than a keyword match.
    const aLabel = a.label.toLowerCase().includes(terms[0]) ? 0 : 1;
    const bLabel = b.label.toLowerCase().includes(terms[0]) ? 0 : 1;
    if (aLabel !== bLabel) return aLabel - bLabel;
    return a.label.localeCompare(b.label);
  });
}
