import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Search, Plus, Ghost, PanelLeft, Palette, Hammer, Map, Settings2,
  Database, HardDrive, Circle, CornerDownLeft, type LucideIcon,
} from 'lucide-react'
import { useSessions } from '../contexts/SessionsContext'
import { useSettings } from '../contexts/SettingsContext'
import { sessionLabel } from '../lib/sessionsClient'
import { logCatalogue, type LogStore } from '../lib/systemClient'
import { SETTINGS_PANELS, getGroupLabel } from '../lib/settingsRegistry'
import { BLUEPRINT_TABS, type BlueprintsTab } from './blueprints/BlueprintsWindow'

/**
 * The command palette — `Ctrl+K`.
 *
 * ## Why this replaced the sidebar filter on that chord
 *
 * `Ctrl+K` used to open an inline filter over the chat list, which was good at
 * exactly one thing — narrowing a list you are already looking at — and that is
 * still what the magnifier in the "Chats and tasks" header does. What it could
 * not do is *reach*. This console scatters its destinations across four floating
 * windows, eleven settings panels and five stores' worth of tables, and every
 * one of them had its own separate path. One chord that reaches all of it is the
 * argument for a palette; a prettier chat filter would not have been.
 *
 * It also fixes a dead chord. The filter lives inside the block gated on
 * `show('sidebar-chats')`, so with the chat list switched off in Settings →
 * Appearance, `Ctrl+K` set some state and rendered nothing at all. An overlay
 * owned by the root has no such dependency.
 *
 * ## The action stays `search_chats`
 *
 * Its label and hint now describe the palette, but the `KeybindAction` id is
 * unchanged on purpose: it is the key this binding is stored under in the
 * `keybinds` preference, and renaming it would silently discard the chord of
 * anybody who had rebound it. The id is storage; the label is the UI.
 *
 * ## Matching is the settings matcher, widened
 *
 * `searchSettingsPanels` already answers "every term must appear somewhere in
 * the label, group or keywords", which is what stops `model email` matching the
 * panel that `model default` should. The same rule is applied here over one
 * haystack per item, so a settings panel ranks the same way in the palette as it
 * does in the Settings search — two indexes that disagreed about the same query
 * would be worse than either alone.
 *
 * ## Rows are the app's own state, never a second source of truth
 *
 * Chats come from `SessionsContext` and tables from `/api/logs/catalogue`, both
 * of which something else already renders. The palette holds no list of its own
 * that could go stale, and running a row calls the same callback the sidebar row
 * would have called.
 */

type GroupName = 'Go to' | 'Chats' | 'Data stores' | 'Actions'

/** Render order, which is also the order the arrow keys walk. */
const GROUP_ORDER: GroupName[] = ['Go to', 'Chats', 'Data stores', 'Actions']

/** Per group, so one store with forty tables cannot bury everything else. */
const GROUP_LIMIT: Record<GroupName, number> = {
  'Go to': 8,
  Chats: 6,
  'Data stores': 8,
  Actions: 6,
}

interface PaletteItem {
  id: string
  group: GroupName
  icon: LucideIcon
  label: string
  /** Muted prefix — "Settings ›", "Blueprints ›". Part of the match text. */
  crumb?: string
  /** Right-aligned meta: a row count, a state. Never part of the match text. */
  meta?: string
  haystack: string
  run: () => void
}

/** Everything the palette can do. Owned by the root, like the windows are. */
export interface PaletteActions {
  openChat: (sessionId: string) => void
  openStore: (store: string, table: string) => void
  openSettings: (panel?: string) => void
  openTheme: () => void
  openForge: () => void
  openBlueprints: (tab?: BlueprintsTab) => void
  newChat: () => void
  toggleIncognito: () => void
  toggleSidebar: () => void
}

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, ' ')
}

/**
 * Every term must match, and a label match outranks a keyword match.
 *
 * Deliberately not fuzzy. A fuzzy matcher earns its keep over a large corpus of
 * similar names; over four windows and eleven panels it mostly invents matches,
 * and a palette that answers `cov` with six plausible rows is slower to use than
 * one that answers with the one right row.
 */
function rank(item: PaletteItem, terms: string[]): number | null {
  if (!terms.length) return 0
  const hay = item.haystack
  if (!terms.every((t) => hay.includes(t))) return null
  const label = item.label.toLowerCase()
  if (label.startsWith(terms[0])) return 0
  if (label.includes(terms[0])) return 1
  return 2
}

function Row({
  item, active, onRun, onHover,
}: {
  item: PaletteItem
  active: boolean
  onRun: () => void
  onHover: () => void
}) {
  const ref = useRef<HTMLButtonElement>(null)

  // Keyboard moves the selection past the fold, so the selection moves the
  // scroll. `nearest` rather than `center`: a list that recentres on every
  // arrow press makes the rows above and below unreadable.
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [active])

  return (
    <button
      ref={ref}
      role="option"
      aria-selected={active}
      onClick={onRun}
      onMouseMove={onHover}
      className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left transition-colors ${
        active ? 'theme-track theme-text' : 'theme-text-muted hover:theme-text'
      }`}
    >
      <item.icon size={13} className={`shrink-0 ${active ? 'theme-accent' : 'opacity-70'}`} />
      <span className="min-w-0 flex-1 truncate text-xs">
        {item.crumb && <span className="theme-text-muted">{item.crumb} › </span>}
        {item.label}
      </span>
      {item.meta && (
        <span className="shrink-0 tabular-nums text-[10px] theme-text-muted">{item.meta}</span>
      )}
      {active && <CornerDownLeft size={11} className="shrink-0 theme-text-muted" />}
    </button>
  )
}

export function CommandPalette({
  open, onClose, actions,
}: {
  open: boolean
  onClose: () => void
  actions: PaletteActions
}) {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [stores, setStores] = useState<LogStore[]>([])
  const { sessions, activeSessionId } = useSessions()
  const { isIncognito } = useSettings()

  // Read on open rather than held: the catalogue's row counts move constantly
  // and a palette quoting a number from the last time it was opened would be
  // asserting something it has not checked.
  useEffect(() => {
    if (!open) return
    setQuery('')
    setActive(0)
    let cancelled = false
    logCatalogue()
      .then((loaded) => !cancelled && setStores(loaded))
      .catch(() => !cancelled && setStores([]))
    return () => { cancelled = true }
  }, [open])

  const run = useCallback(
    (item: PaletteItem) => {
      onClose()
      item.run()
    },
    [onClose],
  )

  const items = useMemo<PaletteItem[]>(() => {
    const out: PaletteItem[] = []
    const push = (
      item: Omit<PaletteItem, 'haystack'> & { keywords?: string },
    ) => {
      const { keywords, ...rest } = item
      out.push({
        ...rest,
        haystack: normalize(
          [rest.label, rest.crumb ?? '', rest.group, keywords ?? ''].join(' '),
        ),
      })
    }

    // ── Go to: the windows, their tabs, and every settings panel ────────────
    push({
      id: 'go:theme', group: 'Go to', icon: Palette, label: 'Theme & Appearance',
      keywords: 'colour color font preset custom window',
      run: actions.openTheme,
    })
    push({
      id: 'go:forge', group: 'Go to', icon: Hammer, label: 'The Forge',
      keywords: 'models pull ollama hardware benchmark gpu window',
      run: actions.openForge,
    })
    push({
      id: 'go:blueprints', group: 'Go to', icon: Map, label: 'Labyrinth Blueprints',
      keywords: 'knowledge map graph corpus rag track window',
      run: () => actions.openBlueprints(),
    })
    for (const t of BLUEPRINT_TABS) {
      push({
        id: `go:blueprints:${t.id}`, group: 'Go to', icon: Map, crumb: 'Blueprints',
        label: t.label, keywords: `${t.keywords} knowledge map rag`,
        run: () => actions.openBlueprints(t.id),
      })
    }
    push({
      id: 'go:settings', group: 'Go to', icon: Settings2, label: 'Settings',
      keywords: 'preferences configuration window',
      run: () => actions.openSettings(),
    })
    for (const panel of SETTINGS_PANELS) {
      push({
        id: `go:settings:${panel.id}`, group: 'Go to', icon: panel.icon,
        crumb: 'Settings', label: panel.label,
        meta: panel.implemented ? undefined : 'not built',
        keywords: [getGroupLabel(panel.group), ...panel.keywords].join(' '),
        run: () => actions.openSettings(panel.id),
      })
    }

    // ── Chats ───────────────────────────────────────────────────────────────
    for (const session of sessions) {
      const label = sessionLabel(session)
      push({
        id: `chat:${session.session_id}`, group: 'Chats', icon: Circle, label,
        meta: session.session_id === activeSessionId ? 'open' : undefined,
        keywords: 'conversation thread history',
        run: () => actions.openChat(session.session_id),
      })
    }

    // ── Data stores ─────────────────────────────────────────────────────────
    for (const store of stores) {
      for (const table of store.tables) {
        push({
          id: `store:${store.store}:${table.name}`, group: 'Data stores',
          icon: store.store === 'sensor' ? HardDrive : Database,
          crumb: store.label, label: table.name,
          meta: table.rows != null ? `${table.rows}` : undefined,
          keywords: `${store.store} table rows database browse`,
          run: () => actions.openStore(store.store, table.name),
        })
      }
    }

    // ── Actions ─────────────────────────────────────────────────────────────
    push({
      id: 'do:new', group: 'Actions', icon: Plus, label: 'New chat',
      keywords: 'start conversation begin',
      run: actions.newChat,
    })
    push({
      id: 'do:incognito', group: 'Actions', icon: Ghost,
      label: isIncognito ? 'Turn off incognito' : 'Turn on incognito',
      meta: isIncognito ? 'on' : undefined,
      keywords: 'ghost private off the record history pause',
      run: actions.toggleIncognito,
    })
    push({
      id: 'do:sidebar', group: 'Actions', icon: PanelLeft, label: 'Toggle sidebar',
      keywords: 'hide show collapse left column',
      run: actions.toggleSidebar,
    })

    return out
  }, [actions, activeSessionId, isIncognito, sessions, stores])

  // Filtered, grouped, capped — and flattened in the same pass, because the
  // arrow keys walk the list as rendered and a second traversal to build that
  // order is a second chance for the two to disagree.
  const { groups, flat } = useMemo(() => {
    const terms = normalize(query).split(' ').filter(Boolean)
    const scored: { item: PaletteItem; score: number }[] = []
    for (const item of items) {
      const score = rank(item, terms)
      if (score !== null) scored.push({ item, score })
    }

    const grouped: { name: GroupName; items: PaletteItem[]; offset: number }[] = []
    const ordered: PaletteItem[] = []
    for (const name of GROUP_ORDER) {
      const rows = scored
        .filter((s) => s.item.group === name)
        .sort((a, b) => a.score - b.score)
        .slice(0, GROUP_LIMIT[name])
        .map((s) => s.item)
      if (!rows.length) continue
      grouped.push({ name, items: rows, offset: ordered.length })
      ordered.push(...rows)
    }
    return { groups: grouped, flat: ordered }
  }, [items, query])

  const onKeyDown = (e: React.KeyboardEvent) => {
    // Handled here and marked: `useGlobalShortcuts` skips anything already
    // defaultPrevented, so Escape closes the palette instead of also closing
    // the window behind it, and Enter cannot reach the composer.
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
      return
    }
    if (e.key === 'ArrowDown' || (e.key === 'n' && e.ctrlKey)) {
      e.preventDefault()
      setActive((i) => (flat.length ? (i + 1) % flat.length : 0))
      return
    }
    if (e.key === 'ArrowUp' || (e.key === 'p' && e.ctrlKey)) {
      e.preventDefault()
      setActive((i) => (flat.length ? (i - 1 + flat.length) % flat.length : 0))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const item = flat[active]
      if (item) run(item)
    }
  }

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[120] flex items-start justify-center bg-black/40 px-4 pt-[14vh] backdrop-blur-sm animate-in fade-in duration-150"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Command palette"
        className="w-full max-w-xl overflow-hidden rounded-xl border theme-border theme-card shadow-2xl animate-in fade-in slide-in-from-top-2 duration-200"
      >
        <div className="flex items-center gap-2.5 border-b theme-border px-3.5 py-2.5">
          <Search size={14} className="shrink-0 theme-text-muted" />
          <input
            autoFocus
            value={query}
            // The selection returns to the top with every keystroke: typing
            // changes the list under it, and index 3 of the old results is not
            // a meaningful place to be in the new ones. Done here rather than
            // in an effect on `query`, which would be a second render to undo
            // a state the first one already knew was wrong.
            onChange={(e) => { setQuery(e.target.value); setActive(0) }}
            onKeyDown={onKeyDown}
            placeholder="Search chats, tables, settings…"
            aria-label="Search chats, tables, settings"
            aria-activedescendant={flat[active] ? `palette-${flat[active].id}` : undefined}
            className="min-w-0 flex-1 bg-transparent text-sm theme-text outline-none placeholder:opacity-50"
          />
        </div>

        <div role="listbox" aria-label="Results" className="max-h-[52vh] overflow-y-auto no-scrollbar p-1.5">
          {groups.length === 0 ? (
            <p className="px-2.5 py-6 text-center text-xs theme-text-muted">
              Nothing matches “{query}”.
            </p>
          ) : (
            groups.map((group) => (
              <div key={group.name} className="mb-1 last:mb-0">
                <div className="px-2.5 pb-1 pt-1.5 text-[10px] uppercase tracking-wider theme-text-muted">
                  {group.name}
                </div>
                {group.items.map((item, i) => {
                  const at = group.offset + i
                  return (
                    <div key={item.id} id={`palette-${item.id}`}>
                      <Row
                        item={item}
                        active={at === active}
                        onRun={() => run(item)}
                        onHover={() => setActive(at)}
                      />
                    </div>
                  )
                })}
              </div>
            ))
          )}
        </div>

        <div className="flex items-center gap-3 border-t theme-border px-3.5 py-1.5 text-[10px] theme-text-muted">
          <span>↑↓ move</span>
          <span>↵ open</span>
          <span>esc close</span>
          <span className="ml-auto">{flat.length} {flat.length === 1 ? 'result' : 'results'}</span>
        </div>
      </div>
    </div>
  )
}
