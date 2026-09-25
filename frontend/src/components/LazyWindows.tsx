import { lazy, Suspense, useState } from 'react'
import {
  loadThemeModal, loadSettingsModal, loadForgeWindow,
  loadBlueprintsWindow, loadStoreWindow, loadCommandPalette,
} from '../lib/windowLoaders'

/**
 * Every floating window, code-split. `lazy()` needs a default export and these
 * modules have named ones, so each is re-exported through `.then`.
 */
export const ThemeModal = lazy(() => loadThemeModal().then((m) => ({ default: m.ThemeModal })))
export const SettingsModal = lazy(() => loadSettingsModal().then((m) => ({ default: m.SettingsModal })))
export const ForgeWindow = lazy(() => loadForgeWindow().then((m) => ({ default: m.ForgeWindow })))
export const BlueprintsWindow = lazy(() =>
  loadBlueprintsWindow().then((m) => ({ default: m.BlueprintsWindow })),
)
export const StoreWindow = lazy(() => loadStoreWindow().then((m) => ({ default: m.StoreWindow })))
export const CommandPalette = lazy(() => loadCommandPalette().then((m) => ({ default: m.CommandPalette })))

/**
 * Mounts its children the first time `when` is true, and keeps them mounted.
 *
 * Not "render while open": a window's own state sits above `FloatingWindow`
 * (the Forge's active tab, for one), and closing a window has always kept it,
 * because the component stayed mounted and `FloatingWindow` rendered nothing.
 * Unmounting on close would reset all of that. So a window that was never
 * opened costs nothing, and one that was opened behaves exactly as before.
 *
 * The fallback is empty on purpose: the chunk is normally prefetched already
 * (`prefetchWindows`), and a spinner that flashes for a frame is worse than a
 * window that appears a frame later.
 */
export function MountOnce({ when, children }: { when: boolean; children: React.ReactNode }) {
  const [seen, setSeen] = useState(when)
  // Derived state, set during render: React re-renders immediately without
  // committing the stale output, which is the documented pattern for this.
  if (when && !seen) setSeen(true)
  if (!seen) return null
  return <Suspense fallback={null}>{children}</Suspense>
}
