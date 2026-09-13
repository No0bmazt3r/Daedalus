import { useState } from 'react'
import { createRootRoute, Outlet } from '@tanstack/react-router'
import { Sidebar } from '../components/Sidebar'
import { Menu } from 'lucide-react'
import { Button } from '../components/ui/button'
import { ThemeModal } from '../components/ThemeModal'
import { SettingsModal } from '../components/SettingsModal'
import { BackgroundEffects } from '../components/BackgroundEffects'
import { SettingsProvider } from '../contexts/SettingsContext'
import { ThemeProvider } from '../contexts/ThemeContext'

export const Route = createRootRoute({
  component: RootLayout,
})

function RootLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [themeModalOpen, setThemeModalOpen] = useState(false)
  const [settingsModalOpen, setSettingsModalOpen] = useState(false)

  return (
    <ThemeProvider>
      <SettingsProvider>
        <div className="flex h-screen theme-bg theme-text relative overflow-hidden transition-colors duration-200">
          {/* Sidebar Container */}
          <div 
            className={`transition-all duration-300 ease-in-out border-r theme-border flex flex-col ${sidebarOpen ? 'w-64' : 'w-0 border-r-0'} overflow-hidden shrink-0 theme-sidebar`}
          >
            <div className="w-64 h-full flex flex-col shrink-0">
              <Sidebar 
                onClose={() => setSidebarOpen(false)} 
                onOpenTheme={() => setThemeModalOpen(true)} 
                onOpenSettings={() => setSettingsModalOpen(true)}
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
                className="absolute top-2 left-2 z-50 text-zinc-400 hover:text-white"
              >
                <Menu size={20} />
              </Button>
            )}
            <BackgroundEffects />
            <div className="z-10 relative flex-1 flex flex-col w-full h-full">
              <Outlet />
            </div>
          </main>

          <ThemeModal open={themeModalOpen} onClose={() => setThemeModalOpen(false)} />
          <SettingsModal open={settingsModalOpen} onClose={() => setSettingsModalOpen(false)} />
        </div>
      </SettingsProvider>
    </ThemeProvider>
  )
}
