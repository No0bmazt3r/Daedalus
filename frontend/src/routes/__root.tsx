import { useState } from 'react'
import { createRootRoute, Outlet } from '@tanstack/react-router'
import { Sidebar } from '../components/Sidebar'
import { Menu } from 'lucide-react'
import { Button } from '../components/ui/button'
import { ThemeModal } from '../components/ThemeModal'
import { SettingsModal } from '../components/SettingsModal'
import { BackgroundEffects } from '../components/BackgroundEffects'
import { ForgeWindow } from '../components/forge/ForgeWindow'
import { StoreWindow } from '../components/stores/StoreWindow'
import { SettingsProvider } from '../contexts/SettingsContext'
import { SessionsProvider } from '../contexts/SessionsContext'
import { ThemeProvider } from '../contexts/ThemeContext'

export const Route = createRootRoute({
  component: RootLayout,
})

function RootLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [themeModalOpen, setThemeModalOpen] = useState(false)
  const [settingsModalOpen, setSettingsModalOpen] = useState(false)
  const [forgeOpen, setForgeOpen] = useState(false)
  // Every floating window is owned here rather than by the Sidebar. Rendered
  // inside it they would sit under `.attention-zone`, and inherit the sidebar's
  // idle opacity the moment the pointer moved onto the window itself.
  const [storeTarget, setStoreTarget] = useState<{ store: string; table: string } | null>(null)

  return (
    <ThemeProvider>
      <SettingsProvider>
        <SessionsProvider>
        <div className="flex h-screen theme-bg theme-text relative overflow-hidden transition-colors duration-200">
          {/* Sidebar Container */}
          <div 
            /* attention-zone, and deliberately no theme-sidebar: the Sidebar
               inside paints the surface, and an opaque colour out here would
               sit behind it and cancel the idle transparency. */
            className={`transition-all duration-300 ease-in-out border-r theme-border flex flex-col ${sidebarOpen ? 'w-64' : 'w-0 border-r-0'} overflow-hidden shrink-0 attention-zone`}
          >
            <div className="w-64 h-full flex flex-col shrink-0">
              <Sidebar 
                onClose={() => setSidebarOpen(false)} 
                onOpenTheme={() => setThemeModalOpen(true)} 
                onOpenSettings={() => setSettingsModalOpen(true)}
                onOpenForge={() => setForgeOpen(true)}
                onOpenStore={(store, table) => setStoreTarget({ store, table })}
                activeStore={storeTarget}
              />
            </div>
          </div>
        
          {/* Main Content Area */}
          <main className="flex-1 flex flex-col overflow-hidden relative theme-bg">
            {!sidebarOpen && (
              <Button 
                variant="ghost" 
                size="icon" 
                onClick={() => setSidebarOpen(true)}
                className="absolute top-2 left-2 z-50 theme-text-muted hover:theme-text"
              >
                <Menu size={20} />
              </Button>
            )}
            <BackgroundEffects />
            <div className="z-10 relative flex-1 flex flex-col w-full h-full attention-zone">
              <Outlet />
            </div>
          </main>

          <ThemeModal open={themeModalOpen} onClose={() => setThemeModalOpen(false)} />
          <SettingsModal open={settingsModalOpen} onClose={() => setSettingsModalOpen(false)} />
          <ForgeWindow open={forgeOpen} onClose={() => setForgeOpen(false)} />
          <StoreWindow
            open={storeTarget !== null}
            store={storeTarget?.store ?? null}
            table={storeTarget?.table ?? null}
            onClose={() => setStoreTarget(null)}
          />
        </div>
        </SessionsProvider>
      </SettingsProvider>
    </ThemeProvider>
  )
}
