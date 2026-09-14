import { createFileRoute } from '@tanstack/react-router'
import { StoreBrowser } from '../components/stores/StoreBrowser'

/**
 * Raw rows of one table, in the main content pane.
 *
 * A route rather than a modal on purpose: the sidebar lists the stores next to
 * the chats, and picking one should behave like picking a chat — it replaces
 * what the pane is showing, it is deep-linkable, and Back works.
 */
export const Route = createFileRoute('/stores/$store/$table')({
  component: StoreRoute,
})

function StoreRoute() {
  const { store, table } = Route.useParams()
  // Keyed so switching tables remounts rather than carrying the previous
  // table's rows through the fetch.
  return <StoreBrowser key={`${store}/${table}`} store={store} table={table} />
}
