import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { createRootRoute, Outlet } from '@tanstack/react-router'
import { Sidebar } from '../components/Sidebar'
import { Menu } from 'lucide-react'
import { Button } from '../components/ui/button'
import { restoreWindow, useTiledInset } from '../components/ui/floating-window'
import { BackgroundEffects } from '../components/BackgroundEffects'
import type { BlueprintsTab } from '../components/blueprints/tabs'
import type { ForgeTab } from '../components/forge/ForgeWindow'
import type { PaletteActions } from '../components/CommandPalette'
import {
  ThemeModal, SettingsModal, ForgeWindow, BlueprintsWindow, StoreWindow, CommandPalette,
  MountOnce,
} from '../components/LazyWindows'
import { prefetchWindows } from '../lib/windowLoaders'
import { reportBrowserTimezone } from '../lib/assistantClient'
import { SettingsProvider, useSettings } from '../contexts/SettingsContext'
import { SessionsProvider, useSessions } from '../contexts/SessionsContext'
import { ThemeProvider } from '../contexts/ThemeContext'
import { UiPrefsProvider, useUiPrefs } from '../contexts/UiPrefsContext'
import { ConfirmDialog } from '../components/ui/confirm-dialog'
import { ErrorPage, statusOf } from '../components/ErrorPage'
import { useBackendDown } from '../hooks/useBackendDown'
import { focusComposer, useGlobalShortcuts } from '../hooks/useGlobalShortcuts'

export const Route = createRootRoute({
  component: RootLayout,
  // Full-screen pages; ErrorPage portals itself over the whole window.
  notFoundComponent: () => <ErrorPage code={404} />,
  errorComponent: ({ error }) => (
    <ErrorPage code={statusOf(error) ?? 500} detail={error instanceof Error ? error.message : undefined} />
  ),
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
  // Nothing works without the backend, so say so with the full 503 page. It
  // lifts by itself once /api/health answers again.
  const backendDown = useBackendDown()
  // A window snapped to a half of the screen tiles beside the app: the shell
  // shrinks into the other half and the sidebar folds away to give the chat
  // room. Unsnapping puts the sidebar back the way it was.
  const inset = useTiledInset()
  const tiled = inset.left > 0 || inset.right > 0
  const [sidebarBeforeTile, setSidebarBeforeTile] = useState<boolean | null>(null)
  if (tiled && sidebarBeforeTile === null) {
    setSidebarBeforeTile(sidebarOpen)
    setSidebarOpen(false)
  } else if (!tiled && sidebarBeforeTile !== null) {
    setSidebarOpen(sidebarBeforeTile)
    setSidebarBeforeTile(null)
  }
  const [themeModalOpen, setThemeModalOpen] = useState(false)
  const [settingsModalOpen, setSettingsModalOpen] = useState(false)
  const [forgeOpen, setForgeOpen] = useState(false)
  const [blueprintsOpen, setBlueprintsOpen] = useState(false)
  // Which panel/tab the palette last asked for. Held rather than fired because
  // both windows read it as a prop; asking for the one already showing is a
  // no-op, so neither needs clearing afterwards.
  const [settingsPanel, setSettingsPanel] = useState<string | null>(null)
  const [blueprintsTab, setBlueprintsTab] = useState<BlueprintsTab | null>(null)
  // Unlike Blueprints' tab this is cleared on a plain open: a link that asked
  // for Re-rankers should not pin every later open of the Forge to it.
  const [forgeTab, setForgeTab] = useState<ForgeTab | null>(null)
  const [paletteOpen, setPaletteOpen] = useState(false)
  // Every floating window is owned here rather than by the Sidebar. Rendered
  // inside it they would sit under `.attention-zone`, and inherit the sidebar's
  // idle opacity the moment the pointer moved onto the window itself.
  const [storeTarget, setStoreTarget] = useState<{ store: string; table: string } | null>(null)
  // The shortcut deletes a conversation, so it asks first — through the app's
  // own dialog rather than `window.confirm`, which ignores the theme and cannot
  // say which conversation it means.
  const [confirmDelete, setConfirmDelete] = useState<{ id: string; title: string } | null>(null)

  // Every window is its own chunk, fetched once the page is idle so that the
  // first open does not wait on the network. See `lib/windowLoaders.ts`.
  useEffect(() => prefetchWindows(), [])
  // Auto-detect: the assistant's clock follows this browser unless a zone is picked in Settings.
  useEffect(() => { void reportBrowserTimezone() }, [])

  const { keybinds } = useUiPrefs()
  const {
    isIncognito, setIsIncognito, noModelPromptOpen, dismissNoModelPrompt,
  } = useSettings()
  const { sessions, activeSessionId, newChat, remove, selectSession } = useSessions()

  /** Close whatever is in front, in the order the windows stack. */
  const closeTopWindow = useCallback(() => {
    // The palette handles its own Escape and marks the event, so this only
    // reaches here if something else had focus while it was open.
    if (paletteOpen) return setPaletteOpen(false)
    if (confirmDelete) return setConfirmDelete(null)
    if (storeTarget) return setStoreTarget(null)
    if (blueprintsOpen) return setBlueprintsOpen(false)
    if (forgeOpen) return setForgeOpen(false)
    if (themeModalOpen) return setThemeModalOpen(false)
    if (settingsModalOpen) return setSettingsModalOpen(false)
  }, [
    blueprintsOpen, confirmDelete, forgeOpen, paletteOpen, settingsModalOpen,
    storeTarget, themeModalOpen,
  ])

  /**
   * Open Blueprints, on a named tab or on the live track's default.
   *
   * Every entry point goes through here because `blueprintsTab` is *sticky
   * state*, not an event: the sidebar row and the shortcut used to open the
   * window without touching it, so a tab the palette had set once was re-applied
   * on every subsequent open, forever. Clicking "Labyrinth Blueprints" landed on
   * whatever tab you had last jumped to from the palette, which is the opposite
   * of what clicking the module's own name should do.
   */
  /** Open the Forge, on a named tab or wherever it was — see `forgeTab`. */
  const openForge = useCallback((tab: ForgeTab | null = null) => {
    openWindow('forge', () => {
      setForgeTab(tab)
      setForgeOpen(true)
    })
  }, [])

  const openBlueprints = useCallback((tab: BlueprintsTab | null = null) => {
    openWindow('blueprints', () => {
      setBlueprintsTab(tab)
      setBlueprintsOpen(true)
    })
  }, [])

  /**
   * What a palette row does when you press Enter on it.
   *
   * Every one of these is the callback some existing affordance already calls —
   * the sidebar row, the account menu, the shortcut. The palette is a second
   * door onto the same handlers, never a second implementation of them.
   */
  const paletteActions = useMemo<PaletteActions>(
    () => ({
      openChat: (id) => { setSidebarOpen(true); selectSession(id) },
      openStore: (store, table) =>
        openWindow('stores', () => setStoreTarget({ store, table })),
      openSettings: (panel) =>
        openWindow('settings', () => {
          if (panel) setSettingsPanel(panel)
          setSettingsModalOpen(true)
        }),
      openTheme: () => openWindow('theme', () => setThemeModalOpen(true)),
      openForge: () => openForge(),
      openBlueprints: (tab) => openBlueprints(tab ?? null),
      newChat,
      toggleIncognito: () => setIsIncognito(!isIncognito),
      toggleSidebar: () => setSidebarOpen((v) => !v),
    }),
    [isIncognito, newChat, openBlueprints, openForge, selectSession, setIsIncognito],
  )

  useGlobalShortcuts(keybinds, {
    toggle_sidebar: () => setSidebarOpen((v) => !v),
    // The palette, not the sidebar filter. It toggles, because the chord that
    // opened it is the one a hand is already on when it turns out to be the
    // wrong window. See `CommandPalette` for why this took the chord over.
    search_chats: () => setPaletteOpen((v) => !v),
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
    open_forge: () => openForge(),
    open_blueprints: () => openBlueprints(),
    close_window: closeTopWindow,
  })

  return (
    <>
        {backendDown && <ErrorPage code={503} detail={backendDown} />}
        <div
          className="flex h-screen theme-bg theme-text relative overflow-hidden transition-[padding,background-color,color] duration-300"
          style={{ paddingLeft: inset.left, paddingRight: inset.right }}
        >
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
                onOpenForge={() => openForge()}
                onOpenBlueprints={() => openBlueprints()}
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

          {/* Each window mounts the first time it opens and stays mounted, so
              its state survives a close exactly as it did before splitting. */}
          <MountOnce when={themeModalOpen}>
            <ThemeModal open={themeModalOpen} onClose={() => setThemeModalOpen(false)} />
          </MountOnce>
          <MountOnce when={settingsModalOpen}>
            <SettingsModal
              open={settingsModalOpen}
              onClose={() => setSettingsModalOpen(false)}
              onOpenTheme={() => openWindow('theme', () => setThemeModalOpen(true))}
              onOpenForge={(tab) => openForge(tab)}
              panel={settingsPanel}
            />
          </MountOnce>
          <MountOnce when={forgeOpen}>
            <ForgeWindow
              open={forgeOpen}
              onClose={() => setForgeOpen(false)}
              requestedTab={forgeTab}
              onOpenSettings={(panel) => paletteActions.openSettings(panel)}
            />
          </MountOnce>
          <MountOnce when={blueprintsOpen}>
            <BlueprintsWindow
              open={blueprintsOpen}
              onClose={() => setBlueprintsOpen(false)}
              requestedTab={blueprintsTab}
              onOpenForge={() => openForge()}
            />
          </MountOnce>
          <MountOnce when={storeTarget !== null}>
            <StoreWindow
              open={storeTarget !== null}
              store={storeTarget?.store ?? null}
              table={storeTarget?.table ?? null}
              onClose={() => setStoreTarget(null)}
            />
          </MountOnce>
        </div>

        {/* Outside the shell's `overflow-hidden`, like ConfirmDialog: it covers
            the whole viewport and must not be clipped by the app frame. Gated
            here rather than inside, so each opening mounts a fresh one — see
            the component for why that is the reset. */}
        {paletteOpen && (
          <Suspense fallback={null}>
            <CommandPalette onClose={() => setPaletteOpen(false)} actions={paletteActions} />
          </Suspense>
        )}

        <ConfirmDialog
          open={confirmDelete !== null}
          title="Delete this conversation?"
          body={
            <>
              <strong className="theme-text">{confirmDelete?.title}</strong> and every
              message in it are removed. The audit log keeps its own record, so this only
              removes the conversation, not the evidence.
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

        {/* Zero local models: nothing can answer, summarise or benchmark. */}
        <ConfirmDialog
          open={noModelPromptOpen && confirmDelete === null}
          title="No model installed"
          body={
            <>
              There are zero models in the system. Please add a model first, before starting
              any task. Open <strong className="theme-text">The Forge</strong>, pick one that
              fits this machine, and pull it. If you already have models, check that Ollama is
              running.
            </>
          }
          confirmLabel="Open The Forge"
          cancelLabel="Later"
          danger
          onConfirm={() => {
            dismissNoModelPrompt()
            openForge()
          }}
          onCancel={dismissNoModelPrompt}
        />
    </>
  )
}
