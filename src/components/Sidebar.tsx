import { Button } from './ui/button'
import { ScrollArea } from './ui/scroll-area'
import { Plus, PanelLeftClose, Search, Circle, Settings, LogOut, Network, Hammer, Map, Palette } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu"

interface SidebarProps {
  onClose?: () => void;
  onOpenTheme?: () => void;
}

export function Sidebar({ onClose, onOpenTheme }: SidebarProps) {
  return (
    <div className="flex flex-col h-full theme-sidebar theme-text font-sans border-r theme-border transition-colors duration-200">
      {/* Header */}
      <div className="flex items-center justify-between p-3">
        <div className="flex items-center gap-2 px-2 cursor-pointer hover:bg-black/20 p-1.5 rounded-md transition-colors">
          <img src="/labyrinth.svg" alt="Daedalus" className="w-5 h-5 theme-primary" />
          <span className="font-semibold text-[15px] tracking-wide font-serif">Daedalus</span>
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
        <Button className="w-full justify-start gap-2 bg-black/20 hover:bg-black/40 theme-text theme-border shadow-none font-normal h-9">
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
          <div className="flex items-center justify-between px-2 mb-1 group cursor-pointer">
            <span className="text-[11px] font-medium theme-text-muted">Chats and tasks</span>
            <Search size={12} className="theme-text-muted opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
          
          <div className="flex flex-col gap-0.5">
            {[
              "Reactor SOP retrieval logic",
              "Graph RAG implementation details",
              "UI layout structuring",
              "Checking node connections"
            ].map((title, i) => (
              <Button key={i} variant="ghost" className="w-full justify-start h-8 px-2 text-sm font-normal theme-text-muted hover:theme-text hover:bg-black/20">
                <Circle size={8} className="shrink-0 mr-2 opacity-60" /> 
                <span className="truncate">{title}</span>
              </Button>
            ))}
          </div>
        </div>
      </ScrollArea>

      {/* Bottom Section */}
      <div className="p-3 border-t theme-border mt-auto flex flex-col gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger className="flex items-center justify-between p-2 rounded-md hover:bg-black/20 cursor-pointer transition-colors w-full border-none outline-none">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-full theme-bg-primary flex items-center justify-center font-bold text-black text-xs">S</div>
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
            <DropdownMenuItem className="py-2.5 px-2 cursor-pointer hover:bg-black/20 rounded-md">
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
