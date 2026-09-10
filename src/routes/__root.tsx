import { createRootRoute, Outlet } from '@tanstack/react-router'
import { Sidebar } from '../components/Sidebar'

export const Route = createRootRoute({
  component: () => (
    <div className="flex h-screen bg-zinc-900 text-zinc-100">
      <aside className="w-64 border-r border-zinc-800 flex flex-col">
        <Sidebar />
      </aside>
      
      <main className="flex-1 flex flex-col overflow-hidden">
        <Outlet />
      </main>
    </div>
  ),
})
