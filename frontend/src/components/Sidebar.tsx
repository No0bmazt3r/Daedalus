import { useEffect, useRef, useState } from 'react'
import { LabyrinthIcon } from "./LabyrinthIcon";
import { Button } from './ui/button'
import { ScrollArea } from './ui/scroll-area'
import { Plus, PanelLeftClose, Search, Circle, Settings, LogOut, Network, Hammer, Map, Palette, MoreHorizontal, Pencil, Trash2, Ghost, Database, HardDrive, ChevronRight, Table2 } from 'lucide-react'
import { Skeleton } from './ui/skeleton'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu"
import { useSessions } from '../contexts/SessionsContext'
import { useSettings } from '../contexts/SettingsContext'
import { sessionLabel, type ChatSession } from '../lib/sessionsClient'
import { logCatalogue, type LogStore } from '../lib/systemClient'

interface SidebarProps {
  onClose: () => void;
  onOpenTheme: () => void;
  onOpenSettings: () => void;
  onOpenForge: () => void;
  /** Opens the raw-row window on one table. */
  onOpenStore: (store: string, table: string) => void;
  /** The table currently open in that window, so the row can be highlighted. */
  activeStore?: { store: string; table: string } | null;
}

/** One chat row: click to open, hover for rename/delete, double-click to rename. */
function SessionRow({
  session,
  active,
  onSelect,
  onRename,
  onDelete,
}: {
  session: ChatSession
  active: boolean
  onSelect: () => void
  onRename: (title: string) => void
  onDelete: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(sessionLabel(session))
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) inputRef.current?.select()
  }, [editing])

  const commit = () => {
    setEditing(false)
    const clean = draft.trim()
    if (clean && clean !== sessionLabel(session)) onRename(clean)
    else setDraft(sessionLabel(session))
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') { setDraft(sessionLabel(session)); setEditing(false) }
        }}
        className="w-full h-8 px-2 text-sm rounded-md theme-card border theme-border theme-text outline-none focus:ring-1 focus:ring-[color-mix(in_srgb,var(--primary)_55%,transparent)]"
      />
    )
  }

  return (
    <div className={`group/row flex items-center rounded-md ${active ? 'theme-track' : 'hover:bg-[color-mix(in_srgb,var(--text-main)_9%,transparent)]'}`}>
      <Button
        variant="ghost"
        onClick={onSelect}
        onDoubleClick={() => setEditing(true)}
        title={sessionLabel(session)}
        className={`flex-1 min-w-0 justify-start h-8 px-2 text-sm font-normal hover:bg-transparent ${active ? 'theme-text' : 'theme-text-muted hover:theme-text'}`}
      >
        <Circle size={8} className={`shrink-0 mr-2 ${active ? 'theme-accent opacity-100' : 'opacity-60'}`} />
        <span className="truncate">{sessionLabel(session)}</span>
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Options for ${sessionLabel(session)}`}
          className="shrink-0 w-7 h-8 flex items-center justify-center rounded-md theme-text-muted opacity-0 group-hover/row:opacity-100 data-[state=open]:opacity-100 hover:theme-text outline-none"
        >
          <MoreHorizontal size={14} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40 theme-card theme-border theme-text border p-1">
          <DropdownMenuItem onClick={() => setEditing(true)} className="py-2 px-2 cursor-pointer hover:bg-[color-mix(in_srgb,var(--text-main)_9%,transparent)] rounded-md text-sm">
            <Pencil size={14} className="mr-2 theme-text-muted" /> Rename
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onDelete} className="py-2 px-2 cursor-pointer hover:bg-[color-mix(in_srgb,var(--text-main)_9%,transparent)] rounded-md text-sm status-bad">
            <Trash2 size={14} className="mr-2" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

/**
 * The five stores, browsable from the sidebar.
 *
 * This lives next to the chat history rather than inside Settings → Databases
 * on purpose. Settings answers "is everything healthy"; that is a question you
 * ask occasionally. "What is actually in this table right now" is a question
 * you ask constantly while building, so it belongs one click away, in the same
 * list you already navigate with.
 */
function DataStores({
  onOpenStore,
  activeStore,
}: {
  onOpenStore: (store: string, table: string) => void
  activeStore?: { store: string; table: string } | null
}) {
  const [stores, setStores] = useState<LogStore[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState<Record<string, boolean>>({})

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      try {
        const loaded = await logCatalogue()
        if (cancelled) return
        setStores((prev) => {
          // Open a store with rows automatically, but only on the first load.
          if (prev === null) {
            const withRows = loaded.find(
              (s) => s.available && s.tables.some((t) => (t.rows ?? 0) > 0),
            )
            const first = withRows ?? loaded.find((s) => s.available && s.tables.length)
            if (first) setOpen({ [first.store]: true })
          }
          return loaded
        })
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'unavailable')
      }
    }

    void load()
    const timer = setInterval(() => void load(), 3000)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between px-2 mb-1">
        <span className="text-[11px] font-medium theme-text-muted">Data stores</span>
      </div>

      {error && (
        <span className="px-2 py-1 text-xs status-warn block">
          Backend unreachable — stores can't be listed
        </span>
      )}
      {!stores && !error && (
        <div className="px-2 py-1 space-y-1.5" role="status" aria-busy="true" aria-live="polite">
          <span className="sr-only">Loading data stores</span>
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-4 w-full" />
          ))}
        </div>
      )}

      <div className="flex flex-col gap-0.5">
        {stores?.map((store) => {
          const isOpen = !!open[store.store]
          return (
            <div key={store.store}>
              <button
                onClick={() => setOpen((o) => ({ ...o, [store.store]: !o[store.store] }))}
                className="w-full flex items-center h-8 px-2 rounded-md text-sm font-normal theme-text-muted hover:theme-text hover:bg-[color-mix(in_srgb,var(--text-main)_9%,transparent)] transition-colors"
              >
                <ChevronRight
                  size={13}
                  className={`shrink-0 mr-1 transition-transform ${isOpen ? 'rotate-90' : ''}`}
                />
                {store.store === 'sensor' ? (
                  <HardDrive size={14} className="mr-2 shrink-0 theme-accent" />
                ) : (
                  <Database size={14} className="mr-2 shrink-0 theme-accent" />
                )}
                <span className="truncate flex-1 text-left">{store.label}</span>
                {/* Health is Settings' job; the dot here is only so a store
                    that cannot be read does not look like an empty one. */}
                {!store.available && (
                  <span className="shrink-0 w-1.5 h-1.5 rounded-full status-bad-fill" title={store.error || 'unavailable'} />
                )}
              </button>

              {isOpen && (
                <div className="flex flex-col gap-0.5 ml-[22px] mt-0.5 mb-1 pl-2 border-l theme-border">
                  {store.available && store.tables.length === 0 && (
                    <span className="px-2 py-1 text-xs theme-text-muted">No tables</span>
                  )}
                  {!store.available && (
                    <span className="px-2 py-1 text-xs theme-text-muted">
                      {store.error || 'Unavailable'}
                    </span>
                  )}
                  {store.tables.map((table) => {
                    const active =
                      activeStore?.store === store.store && activeStore?.table === table.name
                    return (
                      <button
                        key={table.name}
                        onClick={() => onOpenStore(store.store, table.name)}
                        className={`w-full flex items-center h-7 px-2 rounded-md text-xs transition-colors ${
                          active
                            ? 'theme-track theme-text'
                            : 'theme-text-muted hover:theme-text hover:bg-[color-mix(in_srgb,var(--text-main)_9%,transparent)]'
                        }`}
                      >
                        <Table2 size={11} className="shrink-0 mr-2 opacity-60" />
                        <span className="truncate flex-1 text-left font-mono">{table.name}</span>
                        <span className="shrink-0 ml-2 tabular-nums opacity-60">
                          {table.rows ?? '—'}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function Sidebar({ onClose, onOpenTheme, onOpenSettings, onOpenForge, onOpenStore, activeStore }: SidebarProps) {
  const { sessions, activeSessionId, status, newChat, selectSession, rename, remove } = useSessions()
  const { isIncognito } = useSettings()
  const [filter, setFilter] = useState('')
  const [searching, setSearching] = useState(false)

  const needle = filter.trim().toLowerCase()
  const visible = needle
    ? sessions.filter((s) => sessionLabel(s).toLowerCase().includes(needle))
    : sessions

  return (
    <div className="flex flex-col h-full theme-sidebar zone-sidebar theme-text font-sans border-r theme-border transition-colors duration-200">
      {/* Header */}
      <div className="flex items-center justify-between p-3">
        <div className="flex items-center gap-2 px-2 cursor-pointer hover:bg-[color-mix(in_srgb,var(--text-main)_9%,transparent)] p-1.5 rounded-md transition-colors">
          <LabyrinthIcon className="w-5 h-5 zone-brand" />
          <span className="font-semibold text-[15px] tracking-wide font-serif zone-brand-text">Daedalus</span>
        </div>
        <div className="flex items-center gap-1">
          {onClose && (
            <Button variant="ghost" size="icon" onClick={onClose} className="w-8 h-8 theme-text-muted hover:theme-text hover:bg-[color-mix(in_srgb,var(--text-main)_9%,transparent)]">
              <PanelLeftClose size={16} />
            </Button>
          )}
        </div>
      </div>

      {/* New Chat Button */}
      <div className="px-3 mb-4">
        <Button
          onClick={newChat}
          className="w-full justify-start gap-2 theme-surface-strong hover:bg-[color-mix(in_srgb,var(--text-main)_14%,transparent)] theme-text theme-border shadow-none font-normal h-9"
        >
          <Plus size={16} />
          New
        </Button>
      </div>

      <ScrollArea className="flex-1" viewportClassName="px-3">
        {/* Core Modules (Top Navigation) */}
        <div className="flex flex-col gap-0.5 mb-6">
          {/* The three core modules — designed in docs/MODULES.md. Only the
              Forge is built; the other two carry a dot and say so rather than
              being buttons that silently do nothing. */}
          {[
            { title: "Ariadne's Thread", icon: Network, onClick: undefined },
            { title: 'The Forge', icon: Hammer, onClick: onOpenForge },
            { title: 'Labyrinth Blueprints', icon: Map, onClick: undefined },
          ].map((item) => (
            <Button
              key={item.title}
              variant="ghost"
              onClick={item.onClick}
              disabled={!item.onClick}
              title={item.onClick ? undefined : 'Not built yet — see docs/MODULES.md'}
              className="w-full justify-start h-8 px-2 text-sm font-normal theme-text-muted hover:theme-text hover:bg-[color-mix(in_srgb,var(--text-main)_9%,transparent)] disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-default"
            >
              <item.icon size={15} className="mr-2 shrink-0 theme-accent" />
              <span className="truncate flex-1 text-left">{item.title}</span>
              {!item.onClick && (
                <span className="shrink-0 w-1.5 h-1.5 rounded-full bg-[var(--text-muted)] opacity-50" />
              )}
            </Button>
          ))}
        </div>

        {/* Chats and tasks */}
        <div className="mb-6">
          <div
            className="flex items-center justify-between px-2 mb-1 group cursor-pointer"
            onClick={() => setSearching((v) => !v)}
          >
            <span className="text-[11px] font-medium theme-text-muted">Chats and tasks</span>
            <Search size={12} className={`theme-text-muted transition-opacity ${searching ? '' : 'opacity-0 group-hover:opacity-100'}`} />
          </div>

          {searching && (
            <input
              autoFocus
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') { setFilter(''); setSearching(false) } }}
              placeholder="Filter chats…"
              className="w-full h-8 px-2 mb-1 text-sm rounded-md theme-card border theme-border theme-text outline-none focus:ring-1 focus:ring-[color-mix(in_srgb,var(--primary)_55%,transparent)] placeholder:opacity-50"
            />
          )}

          <div className="flex flex-col gap-0.5">
            {/* Incognito chats are deliberately absent from this list — that is
                what makes them incognito — so the current one is shown here as
                a marker rather than as a row that would outlive the session. */}
            {isIncognito && (
              <div className="flex items-center h-8 px-2 text-sm incognito-text opacity-80">
                <Ghost size={13} className="shrink-0 mr-2" />
                <span className="truncate">Off the record — not saved</span>
              </div>
            )}

            {status === 'loading' && sessions.length === 0 && (
              <div className="px-2 py-1 space-y-1.5" role="status" aria-busy="true" aria-live="polite">
                <span className="sr-only">Loading chats</span>
                {/* Varying widths, because a stack of identical bars reads as a
                    table rather than a list of differently-titled chats. */}
                {['w-4/5', 'w-full', 'w-3/5', 'w-11/12', 'w-2/3'].map((w, i) => (
                  <Skeleton key={i} className={`h-4 ${w}`} />
                ))}
              </div>
            )}

            {status === 'offline' && (
              <span className="px-2 py-1 text-xs status-warn">
                Backend unreachable — chats can't be listed
              </span>
            )}

            {status === 'ready' && visible.length === 0 && !isIncognito && (
              <span className="px-2 py-1 text-xs theme-text-muted">
                {needle ? 'No chats match that.' : 'No chats yet. Ask something to start one.'}
              </span>
            )}

            {visible.map((session) => (
              <SessionRow
                key={session.session_id}
                session={session}
                active={session.session_id === activeSessionId}
                onSelect={() => selectSession(session.session_id)}
                onRename={(title) => void rename(session.session_id, title)}
                onDelete={() => void remove(session.session_id)}
              />
            ))}
          </div>
        </div>

        <DataStores onOpenStore={onOpenStore} activeStore={activeStore} />
      </ScrollArea>

      {/* Bottom Section */}
      <div className="p-3 border-t theme-border mt-auto flex flex-col gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center justify-between p-2 rounded-md hover:bg-[color-mix(in_srgb,var(--text-main)_9%,transparent)] cursor-pointer transition-colors w-full border-none outline-none">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full theme-bg-primary zone-toggle-active flex items-center justify-center font-bold theme-text-on-primary text-xs">S</div>
              <span className="text-sm font-medium">Sharvin</span>
            </div>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64 theme-card theme-border theme-text p-2">
            <div className="flex flex-col px-2 py-2 mb-1">
              <span className="font-semibold text-base">Sharvin</span>
            </div>
            <DropdownMenuSeparator className="theme-border my-1 border-b" />
            <DropdownMenuItem onClick={onOpenTheme} className="py-2.5 px-2 cursor-pointer hover:bg-[color-mix(in_srgb,var(--text-main)_9%,transparent)] rounded-md">
              <Palette size={16} className="mr-3 theme-text-muted" /> <span className="font-medium text-sm">Theme & Appearance</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onOpenSettings} className="py-2.5 px-2 cursor-pointer hover:bg-[color-mix(in_srgb,var(--text-main)_9%,transparent)] rounded-md">
              <Settings size={16} className="mr-3 theme-text-muted" /> <span className="font-medium text-sm">Settings</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator className="theme-border my-1 border-b" />
            <DropdownMenuItem className="py-2.5 px-2 cursor-pointer hover:bg-[color-mix(in_srgb,var(--text-main)_9%,transparent)] rounded-md">
              <LogOut size={16} className="mr-3 theme-text-muted" /> <span className="font-medium text-sm">Sign out</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
