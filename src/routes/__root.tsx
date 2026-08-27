import { createRootRoute, Link, Outlet } from '@tanstack/react-router'
import { MessageSquare, Network, Cpu } from 'lucide-react'

export const Route = createRootRoute({
  component: RootComponent,
})

function RootComponent() {
  return (
    <div className="flex h-screen w-full bg-daedalus-obsidian text-daedalus-text font-sans overflow-hidden">
      {/* Sidebar - The Labyrinth Walls */}
      <aside className="w-64 flex-shrink-0 bg-daedalus-slate border-r border-daedalus-border flex flex-col">
        <div className="h-16 flex items-center px-6 border-b border-daedalus-border">
          <h1 className="text-xl font-bold text-daedalus-gold tracking-widest uppercase">
            Daedalus
          </h1>
        </div>
        
        <nav className="flex-1 py-6 px-3 space-y-2 overflow-y-auto">
          <Link
            to="/oracle"
            className="flex items-center gap-3 px-3 py-2.5 rounded-md text-daedalus-text-muted hover:text-daedalus-text hover:bg-daedalus-border/50 transition-colors [&.active]:text-daedalus-copper [&.active]:bg-daedalus-border/80 [&.active]:font-medium"
          >
            <MessageSquare size={18} />
            <span>The Oracle</span>
          </Link>
          
          <Link
            to="/labyrinth"
            className="flex items-center gap-3 px-3 py-2.5 rounded-md text-daedalus-text-muted hover:text-daedalus-text hover:bg-daedalus-border/50 transition-colors [&.active]:text-daedalus-copper [&.active]:bg-daedalus-border/80 [&.active]:font-medium"
          >
            <Network size={18} />
            <span>Ariadne's Thread</span>
          </Link>
          
          <Link
            to="/forge"
            className="flex items-center gap-3 px-3 py-2.5 rounded-md text-daedalus-text-muted hover:text-daedalus-text hover:bg-daedalus-border/50 transition-colors [&.active]:text-daedalus-copper [&.active]:bg-daedalus-border/80 [&.active]:font-medium"
          >
            <Cpu size={18} />
            <span>The Architect's Forge</span>
          </Link>
        </nav>
        
        <div className="p-4 border-t border-daedalus-border text-xs text-daedalus-text-muted text-center">
          Reactor Status: <span className="text-emerald-500 font-medium">Monitoring</span>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col relative overflow-hidden bg-[radial-gradient(ellipse_at_top_right,_var(--color-daedalus-slate)_0%,_transparent_50%)]">
        <Outlet />
      </main>
    </div>
  )
}
