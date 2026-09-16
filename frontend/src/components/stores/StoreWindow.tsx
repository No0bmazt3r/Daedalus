import { Table2 } from 'lucide-react'
import { FloatingWindow } from '../ui/floating-window'
import { StoreBrowser } from './StoreBrowser'

/**
 * Raw rows, in a window.
 *
 * This was briefly a route that replaced the whole pane. A window is the better
 * fit in practice: reading rows is something you do *while* looking at
 * something else — a chat, a trace — and a full-screen takeover makes you leave
 * the thing you were checking against. Peek exists for exactly that, and a
 * route cannot offer it.
 */
export function StoreWindow({
  open,
  store,
  table,
  onClose,
}: {
  open: boolean
  store: string | null
  table: string | null
  onClose: () => void
}) {
  return (
    <FloatingWindow
      open={open && !!store && !!table}
      onClose={onClose}
      title="Raw store contents"
      subtitle={store && table ? `${store} / ${table}` : undefined}
      icon={<Table2 size={16} className="theme-accent" />}
      width={1152}
      height={750}
    >
      {store && table ? (
        <StoreBrowser key={`${store}/${table}`} store={store} table={table} />
      ) : null}
    </FloatingWindow>
  )
}
