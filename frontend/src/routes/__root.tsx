import { useCallback, useState } from 'react'
import { createRootRoute, Outlet } from '@tanstack/react-router'
import { Sidebar } from '../components/Sidebar'
import { Menu } from 'lucide-react'
import { Button } from '../components/ui/button'
import { ThemeModal } from '../components/ThemeModal'
import { restoreWindow } from '../components/ui/floating-window'
import { SettingsModal } from '../components/SettingsModal'
import { BackgroundEffects } from '../components/BackgroundEffects'
import { ForgeWindow } from '../components/forge/ForgeWindow'
import { BlueprintsWindow } from '../components/blueprints/BlueprintsWindow'
import { StoreWindow } from '../components/stores/StoreWindow'
import { SettingsProvider, useSettings } from '../contexts/SettingsContext'
import { SessionsProvider, useSessions } from '../contexts/SessionsContext'
import { ThemeProvider } from '../contexts/ThemeContext'
import { UiPrefsProvider, useUiPrefs } from '../contexts/UiPrefsContext'
import { ConfirmDialog } from '../components/ui/confirm-dialog'
import {
  focusComposer,
  openChatSearch,
  useGlobalShortcuts,
} from '../hooks/useGlobalShortcuts'

export const Route = createRootRoute({
  component: RootLayout,
})

/**
 * Open a window, or bring it back if it was minimized.
 *
 * Minimize is internal to the window, so `open` stays true while it is
 * collapsed — and every trigger here calls `setOpen(true)`, which is a no-op in
 * that state. Without the restore step, minimizing Theme and then clicking
 * Theme again did nothing at all.
 *
 * Every path into a window goes through these callbacks, so this is the one
 * place it needs handling: the sidebar rows, the account menu, and the store
 * rows that open a specific table. `restoreWindow` is a no-op when the window
 * is closed or already visible, so it is always safe to call first.
 */
function openWindow(id: string, open: () => void) {
  restoreWindow(id)
  open()
}

function RootLayout() {
  return (
    <ThemeProvider>
      <SettingsProvider>
        <SessionsProvider>
          <UiPrefsProvider>
            <AppShell />
          </UiPrefsProvider>
        </SessionsProvider>
      </SettingsProvider>
    </ThemeProvider>
  )
}

/**
 * Everything below the providers, because the shortcut layer needs what they
 * hold: the session list to start and delete conversations, incognito to
 * toggle, and the keybind map itself. Keeping this inside `RootLayout` would
 * mean calling `useSessions` in the component that renders `SessionsProvider`,
 * which React does not allow and which would be the wrong shape anyway — the
 * windows and the shortcuts that open them belong together.
 */
function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [themeModalOpen, setThemeModalOpen] = useState(false)
  const [settingsModalOpen, setSettingsModalOpen] = useState(false)
  const [forgeOpen, setForgeOpen] = useState(false)
  const [blueprintsOpen, setBlueprintsOpen] = useState(false)
  // Every floating window is owned here rather than by the Sidebar. Rendered
  // inside it they would sit under `.attention-zone`, and inherit the sidebar's
  // idle opacity the moment the pointer moved onto the window itself.
  const [storeTarget, setStoreTarget] = useState<{ store: string; table: string } | null>(null)
  // The shortcut deletes a conversation, so it asks first — through the app's
  // own dialog rather than `window.confirm`, which ignores the theme and cannot
  // say which conversation it means.
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; title: string } | null>(null)

  const { keybinds } = useUiPrefs()
  const { isIncognito, setIsIncognito } = useSettings()
  const { sessions, activeSessionId, newChat, remove } = useSessions()

  /** Close whatever is in front, in the order the windows stack. */
  const closeTopWindow = useCallback(() => {
    if (confirmDelete) return setConfirmDelete(null)
    if (storeTarget) return setStoreTarget(null)
    if (blueprintsOpen) return setBlueprintsOpen(false)
    if (forgeOpen) return setForgeOpen(false)
    if (themeModalOpen) return setThemeModalOpen(false)
    if (settingsModalOpen) return setSettingsModalOpen(false)
  }, [blueprintsOpen, confirmDelete, forgeOpen, settingsModalOpen, storeTarget, themeModalOpen])

  useGlobalShortcuts(keybinds, {
    toggle_sidebar: () => setSidebarOpen((v) => !v),
    // Searching a list that is not on screen is not a shortcut, it is a
    // surprise — so this opens the column first.
    search_chats: () => {
      setSidebarOpen(true)
      openChatSearch()
    },
    focus_input: focusComposer,
    open_settings: () => openWindow('settings', () => setSettingsModalOpen(true)),
    new_chat: newChat,
    delete_chat: () => {
      const session = sessions.find((s) => s.session_id === activeSessionId)
      if (!session) return
      setConfirmDelete({
        id: session.session_id,
        title: session.title?.trim() || 'this conversation',
      })
    },
    toggle_incognito: () => setIsIncognito(!isIncognito),
    open_theme: () => openWindow('theme', () => setThemeModalOpen(true)),
    open_forge: () => openWindow('forge', () => setForgeOpen(true)),
    open_blueprints: () => openWindow('blueprints', () => setBlueprintsOpen(true)),
    close_window: closeTopWindow,
  })

  return (
    <>
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
                onOpenTheme={() => openWindow('theme', () => setThemeModalOpen(true))}
                onOpenSettings={() => openWindow('settings', () => setSettingsModalOpen(true))}
                onOpenForge={() => openWindow('forge', () => setForgeOpen(true))}
                onOpenBlueprints={() => openWindow('blueprints', () => setBlueprintsOpen(true))}
                onOpenStore={(store, table) =>
                  openWindow('stores', () => setStoreTarget({ store, table }))
                }
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
          <SettingsModal
            open={settingsModalOpen}
            onClose={() => setSettingsModalOpen(false)}
            onOpenTheme={() => openWindow('theme', () => setThemeModalOpen(true))}
          />
          <ForgeWindow open={forgeOpen} onClose={() => setForgeOpen(false)} />
          <BlueprintsWindow open={blueprintsOpen} onClose={() => setBlueprintsOpen(false)} />
          <StoreWindow
            open={storeTarget !== null}
            store={storeTarget?.store ?? null}
            table={storeTarget?.table ?? null}
            onClose={() => setStoreTarget(null)}
          />
        </div>

        <ConfirmDialog
          open={confirmDelete !== null}
          title="Delete this conversation?"
          body={
            <>
              <strong className="theme-text">{confirmDelete?.title}</strong> and every
              message in it are removed. The audit log keeps its own record — this is the
              conversation, not the evidence.
            </>
          }
          confirmLabel="Delete"
          danger
          onConfirm={() => {
            if (confirmDelete) void remove(confirmDelete.id)
            setConfirmDelete(null)
          }}
          onCancel={() => setConfirmDelete(null)}
        />
    </>
  )
}
