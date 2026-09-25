// The dynamic imports behind every floating window, in one place.
//
// Each window is its own chunk: the Forge, Blueprints (with d3-force), Settings
// and the rest are not needed to render the chat, so they are not in the bundle
// that paints it. Kept apart from `components/LazyWindows.tsx` because a file
// that exports both components and plain functions breaks React Fast Refresh
// (see `components/blueprints/tabs.ts` for the full story).

export const loadThemeModal = () => import('../components/ThemeModal')
export const loadSettingsModal = () => import('../components/SettingsModal')
export const loadForgeWindow = () => import('../components/forge/ForgeWindow')
export const loadBlueprintsWindow = () => import('../components/blueprints/BlueprintsWindow')
export const loadStoreWindow = () => import('../components/stores/StoreWindow')
export const loadCommandPalette = () => import('../components/CommandPalette')

const ALL = [
  loadCommandPalette, loadSettingsModal, loadForgeWindow,
  loadBlueprintsWindow, loadThemeModal, loadStoreWindow,
]

/**
 * Fetch every window's chunk once the browser is idle after start-up.
 *
 * Splitting keeps the first paint small; prefetching keeps the first *open*
 * instant, so nobody waits on a download when they press the Forge shortcut.
 * The browser caches each module, so the later `lazy()` import resolves
 * immediately. A failure here is ignored: the real open will retry and, if it
 * still fails, surface it there.
 */
export function prefetchWindows(): () => void {
  const run = () => {
    for (const load of ALL) void load().catch(() => undefined)
  }
  if (typeof window.requestIdleCallback === 'function') {
    const id = window.requestIdleCallback(run, { timeout: 5000 })
    return () => window.cancelIdleCallback(id)
  }
  const timer = window.setTimeout(run, 1500)
  return () => window.clearTimeout(timer)
}
