import { useCallback, useEffect, useMemo, useState } from 'react'
import { Map, Network, ListChecks, Route, Library, Boxes } from 'lucide-react'
import { FloatingWindow } from '../ui/floating-window'
import {
  fetchTraversals, fetchRagConfig,
  type TraversalSummary, type RagTrack,
} from '../../lib/blueprintsClient'
import { GraphView } from './GraphView'
import { CoverageView } from './CoverageView'
import { TraversalView } from './TraversalView'
import { CorpusView } from './CorpusView'
import { TrackBanner } from './TrackBanner'

/**
 * Labyrinth Blueprints — the knowledge map (MODULES.md §3).
 *
 * > *"What does this system actually know, and how is it connected?"*
 *
 * Daedalus's plans for the maze, organised the way `PROJECT.md` §5 organises
 * the system: **by retrieval track**, because that is the real seam in this
 * module and pretending otherwise is what made it confusing.
 *
 * ```
 * Track 1 — vector          Track 2 — graph
 *   Corpus                    Graph · Coverage · Replay
 * ```
 *
 * The window opens on whichever track is answering queries (Settings →
 * Knowledge Base), and marks it. Switching tracks in Settings changes what this
 * opens on; it does not remove the other one.
 *
 * ## Why the other track stays reachable
 *
 * Because the graph is *authored* while Track 1 is live. Coverage is the to-do
 * list you work through before switching, so a window that hid the graph until
 * the graph was selected would make Track 2 impossible to prepare from inside
 * the app. Grouping the tabs says which track a view belongs to, which is the
 * part that was actually unclear — the earlier flat row of four tabs implied
 * all four described one system.
 *
 * ## Corpus sits under Track 1, and is shared
 *
 * It is Track 1's primary artefact, so that is where it lives. But the graph
 * track indexes the same chunks — traversal identifies which documents are
 * relevant, then pulls their text by `source_file` rather than by similarity —
 * so this is not a Track-1-only asset, and the view says so. That shared corpus
 * is what keeps the comparison about architecture instead of about chunking
 * (TODO.md M2).
 *
 * ## Read-only, and off the chat path
 *
 * MODULES.md §0: this window reads what was already recorded and never
 * re-derives it. Ingesting documents, chunking and embedding all *write*, so
 * they belong in a setup surface under Rule 5, not here.
 */

const TRACKS = [
  {
    id: 'vector' as const,
    label: 'Track 1 · Vector',
    hint: 'Traditional vector RAG — the corpus, chunked and embedded',
    tabs: [
      { id: 'corpus', label: 'Corpus', icon: Library, hint: 'Ingested documents and chunks — blocked on M2' },
    ],
  },
  {
    id: 'graph' as const,
    label: 'Track 2 · Graph',
    hint: 'Agentic GraphRAG — the hand-authored knowledge graph',
    tabs: [
      { id: 'graph', label: 'Graph', icon: Network, hint: 'The knowledge graph: 7 node types, 7 edge types' },
      { id: 'coverage', label: 'Coverage', icon: ListChecks, hint: 'Orphans and gaps — every row is a question the graph cannot answer' },
      { id: 'replay', label: 'Replay', icon: Route, hint: 'The walk a graph-track query actually took, hop by hop' },
    ],
  },
]

type TabId = 'corpus' | 'graph' | 'coverage' | 'replay'

const DEFAULT_TAB: Record<RagTrack, TabId> = { vector: 'corpus', graph: 'graph' }

function TracePicker({
  traces, selected, onSelect,
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
  const [activeTrack, setActiveTrack] = useState<RagTrack | null>(null)
  const [viewing, setViewing] = useState<RagTrack>('graph')
  const [tab, setTab] = useState<TabId>('graph')
  const [traces, setTraces] = useState<TraversalSummary[]>([])
  const [selected, setSelected] = useState<string | null>(null)

  const loadTraces = useCallback(() => {
    fetchTraversals()
      .then((r) => {
        setTraces(r.traversals)
        setSelected((current) =>
          current && r.traversals.some((t) => t.query_id === current)
            ? current
            : r.traversals.find((t) => t.replayable)?.query_id ?? null,
        )
      })
      .catch(() => setTraces([]))
  }, [])

  // Re-read on every open rather than once: the track is changed in Settings, a
  // different window, and a stale badge here would assert the opposite of what
  // is running. Opening on the live track is the whole point of knowing it.
  useEffect(() => {
    if (!open) return
    loadTraces()
    fetchRagConfig()
      .then((c) => {
        setActiveTrack(c.track)
        setViewing(c.track)
        setTab(DEFAULT_TAB[c.track])
      })
      .catch(() => setActiveTrack(null))
  }, [open, loadTraces])

  useEffect(() => {
    if (open && tab === 'replay') loadTraces()
  }, [open, tab, loadTraces])

  const group = useMemo(() => TRACKS.find((t) => t.id === viewing)!, [viewing])

  const chooseTrack = (id: RagTrack) => {
    setViewing(id)
    setTab(DEFAULT_TAB[id])
  }

  return (
    <FloatingWindow
      id="blueprints"
      open={open}
      onClose={onClose}
      title="Labyrinth Blueprints"
      subtitle={
        activeTrack
          ? `the knowledge map · ${activeTrack === 'graph' ? 'Track 2 (graph)' : 'Track 1 (vector)'} is live`
          : 'the knowledge map'
      }
      icon={<Map size={16} className="theme-accent" />}
      width={980}
      height={720}
    >
      <div className="@container flex-1 flex flex-col min-h-0">
        <div className="shrink-0 border-b theme-border px-6 pt-4">
          {/* Which track's views you are looking at. Separate from the tab row
              because it is a different kind of choice: the track is the system
              you are inspecting, the tab is which view of it. */}
          <div className="flex items-center gap-1.5">
            {TRACKS.map((t) => {
              const Icon = t.id === 'vector' ? Boxes : Network
              const isViewing = viewing === t.id
              const isLive = activeTrack === t.id
              return (
                <button
                  key={t.id}
                  onClick={() => chooseTrack(t.id)}
                  title={t.hint}
                  className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] transition-colors ${
                    isViewing
                      ? 'theme-accent-border theme-surface-strong theme-text'
                      : 'theme-border theme-text-muted hover:theme-text'
                  }`}
                >
                  <Icon size={11} className={isViewing ? 'theme-accent' : ''} />
                  {t.label}
                  {isLive && (
                    <span
                      title="this track is answering queries"
                      className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400"
                    />
                  )}
                </button>
              )
            })}
            {activeTrack && (
              <span className="ml-auto text-[10px] theme-text-muted">
                ● live = answering queries
              </span>
            )}
          </div>

          <div className="relative mt-3 flex items-center">
            {group.tabs.map((entry) => {
              const selectedTab = tab === entry.id
              return (
                <button
                  key={entry.id}
                  onClick={() => setTab(entry.id as TabId)}
                  title={entry.hint}
                  style={{ flexBasis: `${100 / group.tabs.length}%` }}
                  className={`flex items-center justify-center gap-1.5 rounded-t-lg px-3 py-2 text-xs transition-colors duration-200 ${
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
                width: `${100 / group.tabs.length}%`,
                transform: `translateX(${group.tabs.findIndex((t) => t.id === tab) * 100}%)`,
              }}
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto no-scrollbar p-6">
          <div
            key={`${viewing}-${tab}`}
            className="mx-auto w-full @4xl:max-w-4xl @7xl:max-w-[min(100%,1400px)] animate-in fade-in slide-in-from-bottom-2 duration-300 ease-out"
          >
            {activeTrack && (
              <TrackBanner tabTrack={viewing} activeTrack={activeTrack} isReplay={tab === 'replay'} />
            )}
            {tab === 'corpus' && <CorpusView />}
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
          </div>
        </div>
      </div>
    </FloatingWindow>
  )
}
