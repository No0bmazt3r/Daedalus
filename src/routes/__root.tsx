import { useState } from 'react'
import { createRootRoute, Outlet } from '@tanstack/react-router'
import { Sidebar } from '../components/Sidebar'
import { Menu } from 'lucide-react'
import { Button } from '../components/ui/button'

export const Route = createRootRoute({
  component: RootLayout,
})

function RootLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(true)

  return (
    <div className="flex h-screen bg-zinc-900 text-zinc-100 relative overflow-hidden">
      {/* Sidebar Container */}
      <div 
        className={`transition-all duration-300 ease-in-out border-r border-zinc-800 flex flex-col ${sidebarOpen ? 'w-64' : 'w-0 border-r-0'} overflow-hidden shrink-0`}
      >
        <div className="w-64 h-full flex flex-col shrink-0">
          <Sidebar onClose={() => setSidebarOpen(false)} />
        </div>
      </div>
      
      {/* Main Content Area */}
      <main className="flex-1 flex flex-col overflow-hidden relative">
        {!sidebarOpen && (
          <Button 
            variant="ghost" 
            size="icon" 
            onClick={() => setSidebarOpen(true)}
            className="absolute top-2 left-2 z-50 text-zinc-400 hover:text-white"
          >
            <Menu size={20} />
          </Button>
        )}
        <Outlet />
      </main>
    </div>
  )
}
