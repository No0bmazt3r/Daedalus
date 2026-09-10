import { Link } from '@tanstack/react-router'
import { Button } from './ui/button'
import { ScrollArea } from './ui/scroll-area'
import { PlusCircle, MessageSquare, X } from 'lucide-react'

interface SidebarProps {
  onClose?: () => void;
}

export function Sidebar({ onClose }: SidebarProps) {
  return (
    <div className="p-4 flex flex-col h-full bg-zinc-950">
      <div className="flex items-center justify-between mb-6 px-2">
        <div className="flex items-center gap-3">
          <img src="/labyrinth.svg" alt="Daedalus Logo" className="w-8 h-8" />
          <h2 className="text-xl font-bold text-emerald-400">DAEDALUS</h2>
        </div>
        {onClose && (
          <Button variant="ghost" size="icon" onClick={onClose} className="text-zinc-400 hover:text-white">
            <X size={18} />
          </Button>
        )}
      </div>
      
      <Button className="w-full mb-4 bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-2">
        <PlusCircle size={16} />
        New Chat
      </Button>

      <div className="px-2 mb-2 text-xs font-semibold text-zinc-500 uppercase tracking-wider">
        Recent Sessions
      </div>
      
      <ScrollArea className="flex-1">
        <div className="flex flex-col gap-1">
          <Link to="/">
            <Button variant="ghost" className="w-full justify-start text-left text-zinc-300 hover:text-white flex items-center gap-2">
              <MessageSquare size={14} className="text-emerald-500" />
              Reactor Status #001
            </Button>
          </Link>
          <Link to="/">
            <Button variant="ghost" className="w-full justify-start text-left text-zinc-300 hover:text-white flex items-center gap-2">
              <MessageSquare size={14} className="text-emerald-500" />
              Anomaly T-101 Debug
            </Button>
          </Link>
        </div>
      </ScrollArea>
    </div>
  )
}
