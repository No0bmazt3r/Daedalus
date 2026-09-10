import { Button } from './ui/button'
import { ScrollArea } from './ui/scroll-area'
import { Plus, PanelLeftClose, Inbox, Clock, Search, Circle, LayoutGrid, Settings, LogOut, Network, Hammer, Map } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu"

interface SidebarProps {
  onClose?: () => void;
}

export function Sidebar({ onClose }: SidebarProps) {
  return (
    <div className="flex flex-col h-full bg-[#18181a] text-zinc-300 font-sans border-r border-zinc-800">
      {/* Header */}
      <div className="flex items-center justify-between p-3">
        <div className="flex items-center gap-2 px-2 cursor-pointer hover:bg-zinc-800/50 p-1.5 rounded-md transition-colors">
          <img src="/labyrinth.svg" alt="Daedalus" className="w-5 h-5 text-emerald-400" />
          <span className="font-semibold text-[15px] tracking-wide text-zinc-100 font-serif">Daedalus</span>
        </div>
        <div className="flex items-center gap-1">
          {onClose && (
            <Button variant="ghost" size="icon" onClick={onClose} className="w-8 h-8 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800">
              <PanelLeftClose size={16} />
            </Button>
          )}
        </div>
      </div>
      
      {/* New Chat Button */}
      <div className="px-3 mb-4">
        <Button className="w-full justify-start gap-2 bg-zinc-800/50 hover:bg-zinc-800 text-zinc-200 border border-zinc-700/50 shadow-none font-normal h-9">
          <Plus size={16} />
          New
        </Button>
      </div>

      <ScrollArea className="flex-1 px-3">
        {/* Navigation */}
        <div className="flex flex-col gap-0.5 mb-6">
          <Button variant="ghost" className="w-full justify-start h-8 px-2 text-sm font-normal text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800/80">
            <LayoutGrid size={15} className="mr-2" /> Projects
          </Button>
          <Button variant="ghost" className="w-full justify-start h-8 px-2 text-sm font-normal text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800/80">
            <Inbox size={15} className="mr-2" /> Artifacts
          </Button>
          <Button variant="ghost" className="w-full justify-start h-8 px-2 text-sm font-normal text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800/80">
            <Clock size={15} className="mr-2" /> Scheduled
          </Button>
        </div>

        {/* Projects section */}
        <div className="mb-6">
          <div className="flex items-center justify-between px-2 mb-1 group cursor-pointer">
            <span className="text-[11px] font-medium text-zinc-500">Projects</span>
            <Plus size={14} className="text-zinc-500 opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
          <div className="flex flex-col gap-0.5">
            <Button variant="ghost" className="w-full justify-start h-8 px-2 text-sm font-normal text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800/80">
              <Inbox size={14} className="mr-2 text-zinc-400" /> FYP Defense Prep
            </Button>
          </div>
        </div>

        {/* Chats and tasks */}
        <div className="mb-6">
          <div className="flex items-center justify-between px-2 mb-1 group cursor-pointer">
            <span className="text-[11px] font-medium text-zinc-500">Chats and tasks</span>
            <Search size={12} className="text-zinc-500 opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
          
          <div className="flex flex-col gap-0.5">
            {[
              "Reactor SOP retrieval logic",
              "Graph RAG implementation details",
              "UI layout structuring",
              "Checking node connections"
            ].map((title, i) => (
              <Button key={i} variant="ghost" className="w-full justify-start h-8 px-2 text-sm font-normal text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/80">
                <Circle size={8} className="shrink-0 mr-2 text-zinc-600" /> 
                <span className="truncate">{title}</span>
              </Button>
            ))}
          </div>
        </div>

        {/* System Features */}
        <div>
          <div className="flex items-center justify-between px-2 mb-1 group cursor-pointer">
            <span className="text-[11px] font-medium text-zinc-500">Core Modules</span>
            <Plus size={14} className="text-zinc-500 opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
          
          <div className="flex flex-col gap-0.5">
            {[
              { title: "Ariadne's Thread", icon: Network, color: "text-emerald-500" },
              { title: "The Forge", icon: Hammer, color: "text-amber-500" },
              { title: "Labyrinth Blueprints", icon: Map, color: "text-blue-500" }
            ].map((item, i) => (
              <Button key={i} variant="ghost" className="w-full justify-start h-8 px-2 text-sm font-normal text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/80">
                <item.icon size={14} className={`mr-2 shrink-0 ${item.color}`} /> 
                <span className="truncate">{item.title}</span>
              </Button>
            ))}
          </div>
        </div>
      </ScrollArea>

      {/* Bottom Section */}
      <div className="p-3 border-t border-zinc-800 mt-auto flex flex-col gap-1">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <div className="flex items-center justify-between p-2 rounded-md hover:bg-zinc-800/80 cursor-pointer transition-colors w-full">
              <div className="flex items-center gap-3">
                <img src="/avatar.png" alt="Sharvin" className="w-8 h-8 rounded-full object-cover" />
                <span className="text-sm font-medium text-zinc-200">Sharvin</span>
              </div>
            </div>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64 bg-[#1e1e1e] border-zinc-800 text-zinc-200 p-2">
            <div className="flex flex-col px-2 py-2 mb-1">
              <span className="font-semibold text-base text-zinc-100">Sharvin</span>
            </div>
            <DropdownMenuSeparator className="bg-zinc-800 my-1" />
            <DropdownMenuItem className="py-2.5 px-2 cursor-pointer hover:bg-zinc-800 focus:bg-zinc-800 focus:text-zinc-100 rounded-md">
              <Settings size={16} className="mr-3 text-zinc-400" /> <span className="font-medium text-sm">Settings</span>
            </DropdownMenuItem>
            <DropdownMenuSeparator className="bg-zinc-800 my-1" />
            <DropdownMenuItem className="py-2.5 px-2 cursor-pointer hover:bg-zinc-800 focus:bg-zinc-800 focus:text-zinc-100 rounded-md">
              <LogOut size={16} className="mr-3 text-zinc-400" /> <span className="font-medium text-sm">Sign out</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
