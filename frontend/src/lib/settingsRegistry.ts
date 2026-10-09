// Canonical metadata for the Settings information architecture.
//
// Ported from the Odysseus settings registry: this module *describes* Settings,
// it does not render them. Navigation, search and the sidebar all read from
// here, so a panel is declared exactly once and can never drift out of sync
// between the nav list and the search index.

import {
  Bot,
  Boxes,
  CalendarClock,
  ShieldAlert,
  Clock,
  Globe,
  Keyboard,
  Link as LinkIcon,
  Network,
  Palette,
  Search,
  Database,
  Terminal,
  Download,
  AlertTriangle,
  Wrench,
  Cloud,
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

/**
 * The line between Settings and the Forge: **the Forge answers "what models are
 * on this machine, and can it run them"** — acquire, judge fit, benchmark,
 * delete; **Settings answers "how does the assistant behave"** — which model
 * does which job, retrieval policy, preferences, administration. Anything you
 * would freeze for the comparison, or that changes an answer, is here.
 *
 * Add Models, Added Models and Hardware used to be Settings panels too. They
 * were the Forge's own components rendered a second time, so they were removed
 * rather than kept as two entry points to one screen; `REDIRECTS` sends their
 * old ids somewhere sensible.
 */
export const SETTINGS_GROUPS: readonly SettingsGroup[] = Object.freeze([
  { id: 'knowledge', label: 'Knowledge' },
  { id: 'assistant', label: 'Assistant' },
  { id: 'connections', label: 'Connections' },
  { id: 'experience', label: 'Experience' },
  { id: 'administration', label: 'Administration', adminOnly: true },
  { id: 'system', label: 'System', adminOnly: true },
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
  // The knowledge layer: which track answers, then that track's own settings —
  // only the selected track's panel is listed (`track`, `trackVisible`). The id
  // 'knowledge' is kept for the switch so a saved "last open panel" still
  // lands somewhere sensible.
  panel({
    id: 'knowledge', label: 'Retrieval Track', group: 'knowledge', icon: Search, implemented: true,
    keywords: [
      'knowledge base', 'rag', 'track', 'switch', 'compare', 'comparison', 'freeze', 'frozen',
      'graphrag', 'graph', 'vector', 'retrieval',
    ],
  }),
  panel({
    id: 'vector-rag', label: 'Vector RAG', group: 'knowledge', icon: Boxes, implemented: true, track: 'vector',
    keywords: [
      'track 1', 'vector', 'rag', 'rerank', 're-ranking', 'cross-encoder', 'minilm', 'candidates',
      'chroma', 'index', 'embedding', 'embedder', 'nomic', 'chunks', 'documents', 'cloud baseline',
    ],
  }),
  panel({
    id: 'graph-rag', label: 'Graph RAG', group: 'knowledge', icon: Network, implemented: true, track: 'graph',
    keywords: [
      'track 2', 'graph', 'graphrag', 'agent', 'agent loop', 'walk', 'hops', 'budget', 'steps',
      'traversal', 'sufficiency',
    ],
  }),

  panel({
    id: 'assistant-time', label: 'Date & Time', group: 'assistant', icon: CalendarClock, implemented: true,
    keywords: ['date', 'time', 'clock', 'timezone', 'time zone', 'region', 'auto', 'detect'],
  }),

  panel({
    id: 'assistant-prompt', label: 'System Prompt', group: 'assistant', icon: Bot, implemented: true,
    keywords: ['system prompt', 'prompt', 'instructions', 'rules', 'persona', 'assistant'],
  }),

  panel({
    id: 'assistant-safety', label: 'Safety', group: 'assistant', icon: ShieldAlert, implemented: true,
    keywords: ['safety', 'refuse', 'refusal', 'block', 'blocked', 'flag', 'guard', 'phrases', 'words'],
  }),

  panel({
    id: 'thread', label: "Ariadne's Thread", group: 'assistant', icon: Network, implemented: true,
    keywords: [
      'thread', 'ariadne', 'trace', 'grounded', 'not grounded', 'not checked', 'unchecked', 'label',
      'labels', 'bucket', 'filter', 'citation', 'evidence', 'hallucination', 'provenance', 'groundedness',
    ],
  }),

  panel({
    id: 'background', label: 'Background Jobs', group: 'assistant', icon: Clock, implemented: true,
    keywords: [
      'background', 'jobs', 'title', 'titles', 'rename', 'naming', 'chat', 'session', 'history',
      'summary', 'summariser', 'summarizer', 'memory', 'model',
    ],
  }),

  // Outside services this machine talks to during setup: search providers for
  // sourcing documents, and MCP servers for tools.
  panel({
    id: 'search', label: 'Search', group: 'connections', icon: Globe, implemented: true,
    keywords: [
      'search', 'web', 'internet', 'provider', 'searxng', 'duckduckgo', 'brave',
      'google', 'pse', 'tavily', 'serper', 'api', 'key', 'fallback', 'sourcing',
      'corpus', 'documents', 'safesearch',
    ],
  }),
  panel({
    id: 'cloud-models', label: 'Cloud Models', group: 'connections', icon: Cloud, implemented: true,
    keywords: ['cloud', 'hosted', 'remote', 'baseline', 'endpoint', 'openai', 'deepseek', 'ollama cloud', 'offline', 'local only'],
  }),
  panel({
    id: 'integrations', label: 'Integrations', group: 'connections', icon: LinkIcon, implemented: true,
    keywords: [
      'integrations', 'connections', 'services', 'mcp', 'server', 'external',
      'model context protocol', 'stdio', 'http', 'tools', 'pin', 'drift',
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

  panel({
    id: 'tools', label: 'Agent Tools', group: 'administration', icon: Wrench, adminOnly: true,
    implemented: true,
    keywords: [
      'agent', 'tools', 'sensor', 'trend', 'retrieve', 'capability',
      'effects', 'citable', 'evidence', 'graph', 'traverse', 'corpus', 'session',
      'clock', 'ask', 'permissions', 'gate', 'simple', 'advanced',
    ],
  }),
  // System, as four panels: used at different times, and the destructive one
  // should never sit a scroll below an everyday one.
  panel({
    id: 'storage', label: 'Storage Health', group: 'system', icon: Database, adminOnly: true,
    implemented: true,
    keywords: [
      'system', 'storage', 'stores', 'database', 'databases', 'db', 'sqlite', 'chroma',
      'health', 'diagnostics', 'metrics', 'demo data', 'seed',
    ],
  }),
  panel({
    id: 'logs', label: 'Process Log', group: 'system', icon: Terminal, adminOnly: true,
    implemented: true,
    keywords: ['system', 'logs', 'log', 'terminal', 'console', 'server', 'errors', 'diagnostics'],
  }),
  panel({
    id: 'backup', label: 'Backup', group: 'system', icon: Download, adminOnly: true,
    implemented: true,
    keywords: ['system', 'backup', 'export', 'import', 'restore', 'migrate', 'move'],
  }),
  panel({
    id: 'danger', label: 'Danger Zone', group: 'system', icon: AlertTriangle, adminOnly: true,
    implemented: true,
    keywords: ['system', 'danger', 'wipe', 'delete', 'reset', 'clear', 'erase'],
  }),
]);

export const DEFAULT_SETTINGS_PANEL_ID = 'knowledge';

/**
 * Panel ids that no longer exist, and where they now land. A saved "last open
 * panel" or an old palette entry still opens something sensible. The model
 * panels went to the Forge, which Settings cannot open in place, so they land on
 * the default and the Forge is one click from the sidebar.
 */
const REDIRECTS: Readonly<Record<string, string>> = Object.freeze({
  databases: 'storage',
  system: 'storage',
  services: DEFAULT_SETTINGS_PANEL_ID,
  'added-models': DEFAULT_SETTINGS_PANEL_ID,
  hardware: DEFAULT_SETTINGS_PANEL_ID,
  assistant: 'assistant-prompt',
});

const byId = new Map(SETTINGS_PANELS.map((p) => [p.id, p]));

export function getSettingsPanel(id: string): SettingsPanel | null {
  return byId.get(id) ?? byId.get(REDIRECTS[id] ?? '') ?? null;
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
