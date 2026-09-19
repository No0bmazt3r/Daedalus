// Which of the app's own furniture is on screen — Settings → Appearance.
//
// Ported from Odysseus' appearance panel, where a column of switches decides
// whether the brand, the search box, each tool button and the user bar are
// drawn at all. The same idea earns its place here for a different reason:
// this console is meant to be screenshotted for a report, and being able to
// turn off the parts that are not what the figure is about beats cropping.
//
// ## Shipped as *shown*, and stored as the difference
//
// Every key defaults to `true` (except `chat-fullwidth`, an opt-in layout choice),
// and the stored object holds only what has been changed. An empty record
// therefore means "the app as it ships", restoring a section is a delete, and a
// key added in a later version appears rather than being absent because an old
// saved object never mentioned it. Same argument as `tool_locks` in the backend,
// for the same reason: a default that depends on a stored row is not a default.
//
// ## Chrome only
//
// Nothing here can hide an answer, a citation, a warning or a refusal. The
// switches cover navigation and decoration — the things whose absence costs a
// click, never a fact. Colours, font, density and background effects are the
// Theme window's, and are deliberately not duplicated here.

export type ChromeKey =
  | 'sidebar-brand'
  | 'sidebar-new'
  | 'sidebar-modules'
  | 'sidebar-chats'
  | 'sidebar-stores'
  | 'sidebar-account'
  | 'chat-welcome'
  | 'chat-incognito'
  | 'chat-fullwidth';

export interface ChromeToggle {
  key: ChromeKey;
  label: string;
  hint: string;
  /** What the app ships with. Only `chat-fullwidth` ships off. */
  shipped: boolean;
}

export interface ChromeSection {
  id: string;
  label: string;
  toggles: readonly ChromeToggle[];
}

export const CHROME_SECTIONS: readonly ChromeSection[] = [
  {
    id: 'sidebar',
    label: 'Sidebar',
    toggles: [
      {
        key: 'sidebar-brand',
        label: 'Brand',
        hint: 'The Daedalus mark and name at the top',
        shipped: true,
      },
      { key: 'sidebar-new', label: 'New button', hint: 'Starts a conversation', shipped: true },
      {
        key: 'sidebar-modules',
        label: 'Core modules',
        hint: "Ariadne's Thread, The Forge, Labyrinth Blueprints",
        shipped: true,
      },
      {
        key: 'sidebar-chats',
        label: 'Chats and tasks',
        hint: 'The conversation list and its filter',
        shipped: true,
      },
      {
        key: 'sidebar-stores',
        label: 'Data stores',
        hint: 'The four databases and their tables',
        shipped: true,
      },
      {
        key: 'sidebar-account',
        label: 'Bottom bar',
        hint: 'The row that opens Theme and Settings',
        shipped: true,
      },
    ],
  },
  {
    id: 'chat',
    label: 'Chat area',
    toggles: [
      {
        key: 'chat-welcome',
        label: 'Welcome message',
        hint: 'The mark and greeting on an empty conversation',
        shipped: true,
      },
      {
        key: 'chat-incognito',
        label: 'Incognito button',
        hint: 'The ghost above the composer. The shortcut still works without it',
        shipped: true,
      },
      {
        key: 'chat-fullwidth',
        label: 'Full-width transcript',
        hint: 'Use the whole window instead of a measured column',
        shipped: false,
      },
    ],
  },
];

export const CHROME_TOGGLES: readonly ChromeToggle[] = CHROME_SECTIONS.flatMap((s) => s.toggles);

/** What the app ships with, as a complete map. */
export const CHROME_DEFAULTS: Record<ChromeKey, boolean> = Object.fromEntries(
  CHROME_TOGGLES.map((t) => [t.key, t.shipped])
) as Record<ChromeKey, boolean>;

/** A stored object turned back into a complete map, unknown keys dropped. */
export function normaliseChrome(stored: unknown): Record<ChromeKey, boolean> {
  const out = { ...CHROME_DEFAULTS };
  if (!stored || typeof stored !== 'object') return out;
  for (const toggle of CHROME_TOGGLES) {
    const value = (stored as Record<string, unknown>)[toggle.key];
    if (typeof value === 'boolean') out[toggle.key] = value;
  }
  return out;
}

/** How many toggles in a section differ from what the app ships with. */
export function sectionChangedCount(
  section: ChromeSection,
  chrome: Record<ChromeKey, boolean>
): number {
  return section.toggles.filter((t) => chrome[t.key] !== t.shipped).length;
}
