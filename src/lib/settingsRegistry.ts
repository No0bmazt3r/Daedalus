// Canonical metadata for the Settings information architecture.
//
// Ported from the Odysseus settings registry: this module *describes* Settings,
// it does not render them. Navigation, search and the sidebar all read from
// here, so a panel is declared exactly once and can never drift out of sync
// between the nav list and the search index.

import {
  Bell,
  Cpu,
  Database,
  Keyboard,
  Link as LinkIcon,
  List,
  Mail,
  Palette,
  Plus,
  Search,
  Settings2,
  User,
  Users,
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
}

export const SETTINGS_GROUPS: readonly SettingsGroup[] = Object.freeze([
  { id: 'models', label: 'Models & AI' },
  { id: 'data', label: 'Data & Knowledge' },
  { id: 'communications', label: 'Communications' },
  { id: 'experience', label: 'Experience' },
  { id: 'account', label: 'Account' },
  { id: 'administration', label: 'Administration', adminOnly: true },
]);

function panel(p: Omit<SettingsPanel, 'adminOnly' | 'implemented' | 'keywords'> &
  Partial<Pick<SettingsPanel, 'adminOnly' | 'implemented' | 'keywords'>>): SettingsPanel {
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
    id: 'services', label: 'Add Models', group: 'models', icon: Plus,
    keywords: ['models', 'provider', 'endpoint', 'ollama', 'pull', 'download'],
  }),
  panel({
    id: 'added-models', label: 'Added Models', group: 'models', icon: List,
    keywords: ['models', 'configured', 'installed', 'quantization'],
  }),
  panel({
    id: 'ai', label: 'AI Defaults', group: 'models', icon: Cpu, implemented: true,
    keywords: ['ai', 'defaults', 'model', 'chat', 'temperature', 'context'],
  }),
  panel({
    id: 'hardware', label: 'Hardware', group: 'models', icon: Cpu,
    keywords: ['hardware', 'ram', 'vram', 'gpu', 'cpu', 'profiler', 'benchmark', 'fit'],
  }),

  panel({
    id: 'databases', label: 'Databases', group: 'data', icon: Database, implemented: true,
    keywords: ['database', 'db', 'sqlite', 'chroma', 'vector', 'sensor', 'audit', 'logs', 'storage', 'health'],
  }),
  panel({
    id: 'knowledge', label: 'Knowledge Base', group: 'data', icon: Search,
    keywords: ['rag', 'documents', 'sop', 'manual', 'ingestion', 'chunks', 'embedding'],
  }),

  panel({
    id: 'integrations', label: 'Integrations', group: 'communications', icon: LinkIcon,
    keywords: ['integrations', 'connections', 'services', 'scada'],
  }),
  panel({
    id: 'email', label: 'Email', group: 'communications', icon: Mail,
    keywords: ['email', 'imap', 'smtp', 'notifications'],
  }),
  panel({
    id: 'reminders', label: 'Reminders', group: 'communications', icon: Bell,
    keywords: ['reminders', 'notifications', 'alerts', 'anomaly'],
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
    id: 'account', label: 'Account', group: 'account', icon: User,
    keywords: ['account', 'profile', 'password', 'logout'],
  }),

  panel({
    id: 'tools', label: 'Agent Tools', group: 'administration', icon: Wrench, adminOnly: true,
    keywords: ['agent', 'tools', 'sensor', 'trend', 'anomaly', 'retrieve'],
  }),
  panel({
    id: 'users', label: 'Users', group: 'administration', icon: Users, adminOnly: true,
    keywords: ['users', 'accounts', 'roles', 'admin'],
  }),
  panel({
    id: 'system', label: 'System', group: 'administration', icon: Settings2, adminOnly: true,
    keywords: ['system', 'server', 'version', 'diagnostics', 'health'],
  }),
]);

export const DEFAULT_SETTINGS_PANEL_ID = 'ai';

const byId = new Map(SETTINGS_PANELS.map((p) => [p.id, p]));

export function getSettingsPanel(id: string): SettingsPanel | null {
  return byId.get(id) ?? null;
}

export function getGroupLabel(groupId: string): string {
  return SETTINGS_GROUPS.find((g) => g.id === groupId)?.label ?? '';
}

/** Panels in a group, honouring admin visibility. */
export function panelsForGroup(groupId: string, isAdmin: boolean): SettingsPanel[] {
  return SETTINGS_PANELS.filter(
    (p) => p.group === groupId && (!p.adminOnly || isAdmin)
  );
}

export function visibleGroups(isAdmin: boolean): SettingsGroup[] {
  return SETTINGS_GROUPS.filter((g) => !g.adminOnly || isAdmin).filter(
    (g) => panelsForGroup(g.id, isAdmin).length > 0
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
export function searchSettingsPanels(query: string, isAdmin: boolean): SettingsPanel[] {
  const normalized = normalize(query);
  if (!normalized) return [];
  const terms = normalized.split(' ');

  return SETTINGS_PANELS.filter((p) => {
    if (p.adminOnly && !isAdmin) return false;
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
