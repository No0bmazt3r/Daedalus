import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Map, Network, ListChecks, Route, Library, Boxes, ArrowLeft, RefreshCw, AlertCircle,
} from 'lucide-react'
import { FloatingWindow } from '../ui/floating-window'
import {
  fetchTraversals, fetchRagConfig,
  type TraversalSummary, type RagTrack, type RagConfig, type TrackStatus,
} from '../../lib/blueprintsClient'
import { Skeleton } from '../ui/skeleton'
import { GraphView } from './GraphView'
import { CoverageView } from './CoverageView'
import { TraversalView } from './TraversalView'
import { CorpusView } from './CorpusView'
import { TrackBanner } from './TrackBanner'
import { Unavailable } from './Unavailable'

/**
 * Labyrinth Blueprints — the knowledge map (MODULES.md §3).
 *
 * > *"What does this system actually know, and how is it connected?"*
 *
 * Daedalus's plans for the maze, showing **one retrieval track: the one that is
 * answering queries**, chosen in Settings → Knowledge Base.
 *
 * ```
 * Track 1 — vector  →  Corpus
 * Track 2 — graph   →  Graph · Coverage · Replay
 * ```
 *
 * ## Why one track and not two
 *
 * The window used to open with both tracks side by side as peer buttons, which
 * asked the reader a question they had no way to answer: two systems on screen,
 * equally prominent, only one of them responsible for any answer they had seen.
 * A picker is the wrong shape for a setting that lives somewhere else — it reads
 * as "pick one", when the choice was already made in Settings and *that* is the
 * one that matters. So the window simply follows the setting, and changing
 * tracks is a trip to Settings.
 *
 * It is not badged either. A chip reading "Track 2 · Graph ●" was the picker's
 * last remnant, and with one track on screen it distinguished that track from
 * nothing — the window's own subtitle already names what is live. The badge
 * survives only where it still separates two things: on the detour below.
 *
 * ## The other track is a fallback, not a peer
 *
 * It cannot disappear entirely, because the graph is *authored* while Track 1 is
 * live: Coverage is the to-do list you work through before switching, and a
 * window that hid the graph until the graph was selected would make Track 2
 * impossible to prepare from inside the app. The resolution is rank rather than
 * removal — the live track is the window, and the other one is reachable only
 * from a notice that has already explained why you would want it, with
 * `TrackBanner` stating the relationship for as long as you are over there.
 *
 * ## Fallbacks, in order
 *
 * Every step of "which track is live" can fail, and each failure has a distinct
 * answer rather than a shared blank page (MODULES.md §0 rule 4):
 *
 * 1. **Not read yet** — a skeleton tab row at its final height. Guessing a
 *    track and correcting it a moment later would swap the whole tab row under
 *    the cursor, so nothing is asserted until it is known.
 * 2. **Config unreadable** (backend down, bad JSON) — says so, offers a retry,
 *    and offers the graph views anyway: the graph is the built track, and a
 *    window that can only apologise is worse than one that admits it does not
 *    know which track is live while still showing what it has.
 * 3. **Live track not ready** — it is still what the window shows, because
 *    readiness is reported and never enforced (see `KnowledgeBasePanel`). But
 *    when the *other* track has something to show, the notice says so and links
 *    to it, so an empty window is never the end of the road.
 * 4. **Track known, view empty** — each view owns that one, via `Unavailable`.
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

type TabId = 'corpus' | 'graph' | 'coverage' | 'replay'

/** The tab ids, for callers that want to open the window on one. */
export type BlueprintsTab = TabId

interface TrackSpec {
  label: string
  /** Long form, for prose that has to name the whole thing. */
  full: string
  icon: typeof Network
  tabs: { id: TabId; label: string; icon: typeof Network; hint: string }[]
}

const TRACKS: Record<RagTrack, TrackSpec> = {
  vector: {
    label: 'Track 1 · Vector',
    full: 'Track 1 — traditional vector RAG',
    icon: Boxes,
    tabs: [
      { id: 'corpus', label: 'Corpus', icon: Library, hint: 'Ingested documents and chunks — blocked on M2' },
    ],
  },
  graph: {
    label: 'Track 2 · Graph',
    full: 'Track 2 — agentic GraphRAG',
    icon: Network,
    tabs: [
      { id: 'graph', label: 'Graph', icon: Network, hint: 'The knowledge graph: 7 node types, 7 edge types' },
      { id: 'coverage', label: 'Coverage', icon: ListChecks, hint: 'Orphans and gaps — every row is a question the graph cannot answer' },
      { id: 'replay', label: 'Replay', icon: Route, hint: 'The walk a graph-track query actually took, hop by hop' },
    ],
  },
}

const OTHER: Record<RagTrack, RagTrack> = { vector: 'graph', graph: 'vector' }

const DEFAULT_TAB: Record<RagTrack, TabId> = { vector: 'corpus', graph: 'graph' }

/** Which track owns each tab — the inverse of `TRACKS[].tabs`. */
const TRACK_OF_TAB: Record<TabId, RagTrack> = {
  corpus: 'vector',
  graph: 'graph',
  coverage: 'graph',
  replay: 'graph',
}

/**
 * Flat, for the command palette, which offers each tab as its own destination.
 *
 * Exported from here rather than restated there so a tab cannot exist in one
 * list and not the other. Opening a tab whose track is not live is allowed and
 * lands on the detour, banner and all — that is the same door the fallback
 * notice opens, reached by name instead of by dead end.
 */
export const BLUEPRINT_TABS: readonly { id: TabId; label: string; keywords: string }[] = [
  { id: 'corpus', label: 'Corpus', keywords: 'documents chunks ingested vector track 1' },
  { id: 'graph', label: 'Graph', keywords: 'nodes edges knowledge browse track 2' },
  { id: 'coverage', label: 'Coverage', keywords: 'orphans gaps missing todo authoring' },
  { id: 'replay', label: 'Replay', keywords: 'traversal hops walk trace query path' },
]

/**
 * The tab row is laid out in thirds whichever track is showing.
 *
 * Track 1 has one tab and Track 2 has three, and sizing each row to its own
 * count would make a single tab a full-width bar — a heading pretending to be a
 * control. Thirds keep one geometry for both, so switching tracks moves the
 * underline rather than redrawing the header.
 */
const TAB_BASIS = 100 / 3

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

/**
 * The live track has nothing to show, and the other one does.
 *
 * Offered rather than taken: silently redirecting to whichever track has data
 * would make the window disagree with Settings without saying so, and the
 * reader would be looking at the wrong system believing it was the right one.
 */
function FallbackOffer({
  live, other, onGo,
}: {
  live: TrackStatus
  other: TrackStatus
  onGo: () => void
}) {
  const spec = TRACKS[other.id]
  return (
    <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-lg border theme-border theme-card p-2.5">
      <AlertCircle size={13} className="shrink-0 theme-text-muted" />
      <p className="min-w-0 flex-1 text-[11px] leading-relaxed theme-text">
        <span className="theme-text-muted">{TRACKS[live.id].full}</span> is live but has nothing to
        show yet{live.blocked_by ? ` — it needs ${live.blocked_by}` : ''}.{' '}
        <span className="theme-text-muted">
          {live.detail} · change the live track in Settings → Knowledge Base.
        </span>
      </p>
      <button
        onClick={onGo}
        className="flex shrink-0 items-center gap-1.5 rounded-md border theme-accent-border px-2 py-1 text-[11px] theme-accent transition-colors hover:theme-surface-strong"
      >
        <spec.icon size={11} />
        Inspect {spec.label}
      </button>
    </div>
  )
}

export function BlueprintsWindow({
  open, onClose, requestedTab = null,
}: {
  open: boolean
  onClose: () => void
  /** Open on this tab instead of the live track's default — see `BLUEPRINT_TABS`. */
  requestedTab?: BlueprintsTab | null
}) {
  const [config, setConfig] = useState<RagConfig | null>(null)
  const [configError, setConfigError] = useState<string | null>(null)
  // null until the track is known — see fallback 1. Set from the config on
  // every open, and only ever moved off it deliberately, by the offer above.
  const [viewing, setViewing] = useState<RagTrack | null>(null)
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

  const show = useCallback((track: RagTrack) => {
    setViewing(track)
    setTab(DEFAULT_TAB[track])
  }, [])

  /** Open a named tab, on whichever track owns it. */
  const showTab = useCallback((wanted: TabId) => {
    setViewing(TRACK_OF_TAB[wanted])
    setTab(wanted)
  }, [])

  // Re-read on every open rather than once: the track is changed in Settings, a
  // different window, and a stale badge here would assert the opposite of what
  // is running. Following the live track is the whole point of knowing it.
  const loadConfig = useCallback((preferTab: TabId | null = null) => {
    setConfigError(null)
    fetchRagConfig()
      .then((c) => {
        setConfig(c)
        // A tab asked for by name wins over the live track's default. Applied
        // in here rather than in a second effect because this resolves last:
        // set outside, the config's own `show` would land after it and undo it.
        if (preferTab) showTab(preferTab)
        else show(c.track)
      })
      .catch((e: Error) => {
        // The previous answer is kept: a failed re-read is not evidence the
        // track changed, and blanking a window that was correct a second ago
        // loses more than the stale badge costs. The strip below says so.
        setConfigError(e.message || 'the backend is not answering')
        // Still honour the request — the tab a caller named does not depend on
        // knowing which track is live, and refusing it would make a palette row
        // silently do nothing whenever the backend is down.
        if (preferTab) showTab(preferTab)
      })
  }, [show, showTab])

  // `requestedTab` is a dependency, so asking for a tab while the window is
  // already open re-runs this and moves to it. That re-reads the config too,
  // which is the behaviour anyway: it is re-read on every open for the same
  // reason, and it is one cheap GET.
  useEffect(() => {
    if (!open) return
    loadTraces()
    loadConfig(requestedTab)
  }, [open, requestedTab, loadTraces, loadConfig])

  useEffect(() => {
    if (open && tab === 'replay') loadTraces()
  }, [open, tab, loadTraces])

  const activeTrack = config?.track ?? null
  const group = viewing ? TRACKS[viewing] : null
  const offTrack = !!(viewing && activeTrack && viewing !== activeTrack)

  const liveStatus = useMemo(
    () => config?.tracks.find((t) => t.id === config.track) ?? null,
    [config],
  )
  const otherStatus = useMemo(
    () => (config ? config.tracks.find((t) => t.id === OTHER[config.track]) ?? null : null),
    [config],
  )
  // Fallback 3. Only on the live track — once you have taken the offer, the
  // banner is what explains where you are, and two notices would say it twice.
  const offer =
    !offTrack && liveStatus && otherStatus && !liveStatus.ready && otherStatus.ready
      ? { live: liveStatus, other: otherStatus }
      : null

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
          {/* Nothing names the live track here. The window's own subtitle
              already does, and one track on screen needs no badge to tell it
              apart from the other. This row exists only on the detour: it is
              the way back, and the only place the chrome has to admit that what
              is below did not answer anything. */}
          {offTrack && activeTrack && group && (
            <div className="mb-3 flex items-center gap-2">
              <button
                onClick={() => show(activeTrack)}
                className="flex shrink-0 items-center gap-1.5 rounded-md border theme-border px-2 py-1 text-[11px] theme-text-muted transition-colors hover:theme-text"
              >
                <ArrowLeft size={11} />
                Back to {TRACKS[activeTrack].label}
              </button>
              <span className="flex items-center gap-1.5 text-[10px] theme-text-muted">
                <group.icon size={11} className="text-amber-400" />
                viewing {group.label} — not answering queries
              </span>
            </div>
          )}

          <div className="relative flex min-h-[34px] items-center">
            {group ? (
              <>
                {group.tabs.map((entry) => {
                  const selectedTab = tab === entry.id
                  return (
                    <button
                      key={entry.id}
                      onClick={() => setTab(entry.id)}
                      title={entry.hint}
                      style={{ flexBasis: `${TAB_BASIS}%` }}
                      className={`flex shrink-0 items-center justify-center gap-1.5 rounded-t-lg px-3 py-2 text-xs transition-colors duration-200 ${
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
                    width: `${TAB_BASIS}%`,
                    transform: `translateX(${Math.max(group.tabs.findIndex((t) => t.id === tab), 0) * 100}%)`,
                  }}
                />
              </>
            ) : (
              <Skeleton className="h-5 w-64" />
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto no-scrollbar p-6">
          <div
            key={`${viewing ?? 'unknown'}-${tab}`}
            className="mx-auto w-full @4xl:max-w-4xl @7xl:max-w-[min(100%,1400px)] animate-in fade-in slide-in-from-bottom-2 duration-300 ease-out"
          >
            {/* Fallback 2. Shown above whatever is on screen rather than instead
                of it, so a failed *re-read* does not throw away a working view. */}
            {configError && (
              <div className="mb-4 flex flex-wrap items-center gap-x-2 gap-y-1.5 rounded-lg border border-amber-400/40 bg-amber-400/10 p-2.5">
                <AlertCircle size={13} className="shrink-0 text-amber-400" />
                <p className="min-w-0 flex-1 text-[11px] leading-relaxed theme-text">
                  Couldn't read which retrieval track is live —{' '}
                  <span className="theme-text-muted">{configError}</span>
                  {config && <span className="theme-text-muted"> · showing the last known track</span>}
                </p>
                <button
                  // Wrapped, not passed: `loadConfig` now takes a tab, and
                  // handing it the click event would ask for a tab named
                  // `[object MouseEvent]`.
                  onClick={() => loadConfig()}
                  className="flex shrink-0 items-center gap-1.5 rounded-md border theme-border px-2 py-1 text-[11px] theme-text-muted transition-colors hover:theme-text"
                >
                  <RefreshCw size={11} />
                  Retry
                </button>
              </div>
            )}

            {offer && (
              <FallbackOffer live={offer.live} other={offer.other} onGo={() => show(offer.other.id)} />
            )}

            {offTrack && activeTrack && viewing && (
              <TrackBanner tabTrack={viewing} activeTrack={activeTrack} isReplay={tab === 'replay'} />
            )}

            {!group ? (
              // Nothing is known yet. With no error that is just the read in
              // flight; with one it is fallback 2's dead end, and the graph is
              // offered because it is the track that is actually built.
              configError ? (
                <Unavailable
                  reason="The retrieval track couldn't be read, so this window doesn't know which half of the knowledge layer is answering queries. The views below read the graph directly and work without it."
                  action={
                    <button
                      onClick={() => show('graph')}
                      className="flex items-center gap-1.5 rounded-md border theme-accent-border px-2.5 py-1 text-[11px] theme-accent transition-colors hover:theme-surface-strong"
                    >
                      <Network size={11} />
                      Inspect {TRACKS.graph.label} anyway
                    </button>
                  }
                />
              ) : (
                <Skeleton className="h-64 w-full" />
              )
            ) : (
              <>
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
              </>
            )}
          </div>
        </div>
      </div>
    </FloatingWindow>
  )
}
