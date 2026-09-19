import { useCallback, useEffect, useState } from 'react'
import { Map, Network, ListChecks, Route, Library } from 'lucide-react'
import { FloatingWindow } from '../ui/floating-window'
import { fetchTraversals, type TraversalSummary } from '../../lib/blueprintsClient'
import { GraphView } from './GraphView'
import { CoverageView } from './CoverageView'
import { TraversalView } from './TraversalView'
import { CorpusView } from './CorpusView'

/**
 * Labyrinth Blueprints — the knowledge map (MODULES.md §3).
 *
 * > *"What does this system actually know, and how is it connected?"*
 *
 * Daedalus's plans for the maze. Four tabs across the module's two halves:
 *
 * | tab      | half             | state |
 * |---|---|---|
 * | Graph    | Layer 5, Track 2 | built — the hand-authored knowledge graph |
 * | Coverage | Layer 5, Track 2 | built — what the graph cannot answer |
 * | Replay   | Layer 5 + 10     | built, fed by recorded walks |
 * | Corpus   | Layer 4          | **blocked on M2** — honest empty state |
 *
 * ## Why this is a floating window and not a route
 *
 * MODULES.md §0 rule 1: all three glass-box modules open in the shared
 * `FloatingWindow` shell, because all three are things you consult *while*
 * looking at something else. Blueprints in particular gets read against the
 * answer that cited a document, and a full-screen takeover would hide the thing
 * being checked.
 *
 * ## Read-only, and off the chat path
 *
 * Rule 2 and MODULES.md §0: this window reads what was already recorded and
 * never re-derives it. It cannot send a query, and the orchestrator cannot
 * reach it.
 *
 * ## Not built here: the force-directed canvas
 *
 * MODULES.md §3.6 allows one, bundled rather than CDN-loaded, and pairs it with
 * a table view "for everything else". The table half is here and carries the
 * browsing; the replay renders its walk as an ordered hop list, which is the
 * shape §3.2's own example uses and which stays readable at any hop count. A
 * node-link canvas would add a bundled layout library for a visual that a
 * four-hop walk does not yet need.
 */

const TABS = [
  { id: 'graph', label: 'Graph', icon: Network, hint: 'The hand-authored knowledge graph: 7 node types, 7 edge types' },
  { id: 'coverage', label: 'Coverage', icon: ListChecks, hint: 'Orphans and gaps — every row is a question the graph cannot answer' },
  { id: 'replay', label: 'Replay', icon: Route, hint: 'The walk a graph-track query actually took, hop by hop' },
  { id: 'corpus', label: 'Corpus', icon: Library, hint: 'Ingested documents and chunks — blocked on M2' },
] as const

type TabId = (typeof TABS)[number]['id']

function TracePicker({
  traces,
  selected,
  onSelect,
}: {
  traces: TraversalSummary[]
  selected: string | null
  onSelect: (id: string) => void
}) {
  return (
    <ul className="space-y-1">
      {traces.map((t) => {
        const active = t.query_id === selected
        return (
          <li key={t.query_id}>
            <button
              onClick={() => onSelect(t.query_id)}
              className={`w-full rounded-md border px-2.5 py-1.5 text-left transition-colors ${
                active ? 'theme-accent-border theme-surface-strong' : 'theme-border hover:theme-surface'
              }`}
            >
              <span className="block truncate text-xs theme-text">{t.query_text}</span>
              <span className="mt-0.5 flex items-center gap-1.5 text-[10px] theme-text-muted">
                <span>{t.hop_count} {t.hop_count === 1 ? 'hop' : 'hops'}</span>
                <span>·</span>
                <span>{t.entry_strategy ?? 'none'}</span>
                {t.seeded && (
                  <>
                    <span>·</span>
                    {/* Never hidden: a seeded row's latency is traversal
                        wall-clock only and must not be read as a measurement. */}
                    <span className="theme-accent">seed</span>
                  </>
                )}
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

export function BlueprintsWindow({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<TabId>('graph')
  const [traces, setTraces] = useState<TraversalSummary[]>([])
  const [selected, setSelected] = useState<string | null>(null)

  const loadTraces = useCallback(() => {
    fetchTraversals()
      .then((r) => {
        setTraces(r.traversals)
        // Select the newest replayable walk so the tab opens onto something
        // rather than onto a picker the reader has to act on first.
        setSelected((current) =>
          current && r.traversals.some((t) => t.query_id === current)
            ? current
            : r.traversals.find((t) => t.replayable)?.query_id ?? null,
        )
      })
      .catch(() => setTraces([]))
  }, [])

  // Only while open, so a closed window costs nothing.
  useEffect(() => {
    if (open) loadTraces()
  }, [open, loadTraces])

  // The Replay tab's empty state can seed traces, which changes what the picker
  // should list — so re-read when returning to it.
  useEffect(() => {
    if (open && tab === 'replay') loadTraces()
  }, [open, tab, loadTraces])

  return (
    <FloatingWindow
      id="blueprints"
      open={open}
      onClose={onClose}
      title="Labyrinth Blueprints"
      subtitle="the knowledge map"
      icon={<Map size={16} className="theme-accent" />}
      width={980}
      height={720}
    >
      <div className="@container flex-1 flex flex-col min-h-0">
        <div className="px-6 pt-4 border-b theme-border shrink-0">
          <div className="relative flex items-center">
            {TABS.map((entry) => {
              const selectedTab = tab === entry.id
              return (
                <button
                  key={entry.id}
                  onClick={() => setTab(entry.id)}
                  title={entry.hint}
                  style={{ flexBasis: `${100 / TABS.length}%` }}
                  className={`flex items-center justify-center gap-1.5 px-3 py-2 text-xs rounded-t-lg transition-colors duration-200 ${
                    selectedTab ? 'theme-accent' : 'theme-text-muted hover:theme-text'
                  }`}
                >
                  <entry.icon
                    key={selectedTab ? 'on' : 'off'}
                    size={13}
                    className={`tab-icon ${selectedTab ? 'tab-icon-active' : ''}`}
                  />
                  {entry.label}
                </button>
              )
            })}
            <span
              aria-hidden
              className="absolute bottom-0 h-0.5 rounded-full theme-bg-primary transition-transform duration-300 ease-out"
              style={{
                width: `${100 / TABS.length}%`,
                transform: `translateX(${TABS.findIndex((t) => t.id === tab) * 100}%)`,
              }}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto no-scrollbar p-6">
          <div
            key={tab}
            className="mx-auto w-full @4xl:max-w-4xl animate-in fade-in slide-in-from-bottom-2 duration-300 ease-out"
          >
            {tab === 'graph' && <GraphView />}
            {tab === 'coverage' && <CoverageView />}
            {tab === 'replay' && (
              traces.length === 0 ? (
                <TraversalView queryId={null} />
              ) : (
                <div className="grid gap-4 @2xl:grid-cols-[minmax(0,260px)_minmax(0,1fr)]">
                  <TracePicker traces={traces} selected={selected} onSelect={setSelected} />
                  <TraversalView queryId={selected} />
                </div>
              )
            )}
            {tab === 'corpus' && <CorpusView />}
          </div>
        </div>
      </div>
    </FloatingWindow>
  )
}
