import { useEffect, useRef, useState } from 'react'
import { LabyrinthIcon } from "./LabyrinthIcon";
import { Button } from './ui/button'
import { ScrollArea } from './ui/scroll-area'
import { Plus, PanelLeftClose, Search, Circle, Settings, LogOut, Network, Hammer, Map, Palette, MoreHorizontal, Pencil, Trash2, Ghost } from 'lucide-react'
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

interface SidebarProps {
  onClose: () => void;
  onOpenTheme: () => void;
  onOpenSettings: () => void;
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
        className="w-full h-8 px-2 text-sm rounded-md theme-card border theme-border theme-text outline-none focus:ring-1 focus:ring-zinc-500/50"
      />
    )
  }

  return (
    <div className={`group/row flex items-center rounded-md ${active ? 'bg-black/30' : 'hover:bg-black/20'}`}>
      <Button
        variant="ghost"
        onClick={onSelect}
        onDoubleClick={() => setEditing(true)}
        title={sessionLabel(session)}
        className={`flex-1 min-w-0 justify-start h-8 px-2 text-sm font-normal hover:bg-transparent ${active ? 'theme-text' : 'theme-text-muted hover:theme-text'}`}
      >
        <Circle size={8} className={`shrink-0 mr-2 ${active ? 'theme-primary opacity-100' : 'opacity-60'}`} />
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
          <DropdownMenuItem onClick={() => setEditing(true)} className="py-2 px-2 cursor-pointer hover:bg-black/20 rounded-md text-sm">
            <Pencil size={14} className="mr-2 theme-text-muted" /> Rename
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onDelete} className="py-2 px-2 cursor-pointer hover:bg-black/20 rounded-md text-sm text-red-400">
            <Trash2 size={14} className="mr-2" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export function Sidebar({ onClose, onOpenTheme, onOpenSettings }: SidebarProps) {
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
        <div className="flex items-center gap-2 px-2 cursor-pointer hover:bg-black/20 p-1.5 rounded-md transition-colors">
          <LabyrinthIcon className="w-5 h-5 zone-brand" />
          <span className="font-semibold text-[15px] tracking-wide font-serif zone-brand-text">Daedalus</span>
        </div>
        <div className="flex items-center gap-1">
          {onClose && (
            <Button variant="ghost" size="icon" onClick={onClose} className="w-8 h-8 theme-text-muted hover:theme-text hover:bg-black/20">
              <PanelLeftClose size={16} />
            </Button>
          )}
        </div>
      </div>

      {/* New Chat Button */}
      <div className="px-3 mb-4">
        <Button
          onClick={newChat}
          className="w-full justify-start gap-2 bg-black/20 hover:bg-black/40 theme-text theme-border shadow-none font-normal h-9"
        >
          <Plus size={16} />
          New
        </Button>
      </div>

      <ScrollArea className="flex-1 px-3">
        {/* Core Modules (Top Navigation) */}
        <div className="flex flex-col gap-0.5 mb-6">
          {[
            { title: "Ariadne's Thread", icon: Network },
            { title: "The Forge", icon: Hammer },
            { title: "Labyrinth Blueprints", icon: Map }
          ].map((item, i) => (
            <Button key={i} variant="ghost" className="w-full justify-start h-8 px-2 text-sm font-normal theme-text-muted hover:theme-text hover:bg-black/20">
              <item.icon size={15} className="mr-2 shrink-0 theme-primary" /> 
              <span className="truncate">{item.title}</span>
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
            <Search size={12} className={`theme-text-muted transition-opacity ${searching ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`} />
          </div>

          {searching && (
            <input
              autoFocus
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') { setFilter(''); setSearching(false) } }}
              placeholder="Filter chats…"
              className="w-full h-8 px-2 mb-1 text-sm rounded-md theme-card border theme-border theme-text outline-none focus:ring-1 focus:ring-zinc-500/50 placeholder:opacity-50"
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
              <span className="px-2 py-1 text-xs theme-text-muted opacity-60">Loading…</span>
            )}

            {status === 'offline' && (
              <span className="px-2 py-1 text-xs text-amber-400/80">
                Backend unreachable — chats can't be listed
              </span>
            )}

            {status === 'ready' && visible.length === 0 && !isIncognito && (
              <span className="px-2 py-1 text-xs theme-text-muted opacity-60">
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
      </ScrollArea>

      {/* Bottom Section */}
      <div className="p-3 border-t theme-border mt-auto flex flex-col gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center justify-between p-2 rounded-md hover:bg-black/20 cursor-pointer transition-colors w-full border-none outline-none">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full theme-bg-primary zone-toggle-active flex items-center justify-center font-bold text-black text-xs">S</div>
              <span className="text-sm font-medium">Sharvin</span>
            </div>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64 theme-card theme-border theme-text p-2">
            <div className="flex flex-col px-2 py-2 mb-1">
              <span className="font-semibold text-base">Sharvin</span>
            </div>
            <DropdownMenuSeparator className="theme-border my-1 border-b" />
            <DropdownMenuItem onClick={onOpenTheme} className="py-2.5 px-2 cursor-pointer hover:bg-black/20 rounded-md">
              <Palette size={16} className="mr-3 theme-text-muted" /> <span className="font-medium text-sm">Theme & Appearance</span>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onOpenSettings} className="py-2.5 px-2 cursor-pointer hover:bg-black/20 rounded-md">
              <Settings size={16} className="mr-3 theme-text-muted" /> <span className="font-medium text-sm">Settings</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator className="theme-border my-1 border-b" />
            <DropdownMenuItem className="py-2.5 px-2 cursor-pointer hover:bg-black/20 rounded-md">
              <LogOut size={16} className="mr-3 theme-text-muted" /> <span className="font-medium text-sm">Sign out</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
