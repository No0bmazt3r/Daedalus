import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { TabError } from '../errors/TabError'
import { toFailure, type LoadFailure } from '../errors/ErrorPage'
import { useLiveRefresh } from '../../hooks/useLiveRefresh'
import {
  Map, Network, ListChecks, Route, Library, Boxes, AlertCircle,
  PenLine, Upload, ScrollText,
} from 'lucide-react'
import { FloatingWindow } from '../ui/floating-window'
import {
  fetchTraversals, fetchRagConfig, RAG_TRACK_CHANGED_EVENT,
  type TraversalSummary, type RagTrack, type RagConfig, type TrackStatus,
} from '../../lib/blueprintsClient'
import { Skeleton } from '../ui/skeleton'
import { GraphView } from './GraphView'
import { CoverageView } from './CoverageView'
import { UsageView } from './UsageView'
import { TraversalView } from './TraversalView'
import { CorpusView } from './CorpusView'
import { IngestView } from './IngestView'
import { RetrievalView } from './RetrievalView'
import { AuthoringView } from './AuthoringView'
import { IngestLogsView } from './IngestLogsView'

/**
 * Labyrinth Blueprints — the knowledge map (MODULES.md §3).
 *
 * > *"What does this system actually know, and how is it connected?"*
 *
 * Daedalus's plans for the maze, showing **one retrieval track: the one that is
 * answering queries**, chosen in Settings → Retrieval Track.
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
 * ## The other track is not reachable at all
 *
 * Strictly. There is no detour, no "inspect the other one" button and no
 * off-track banner, because there is no off-track state to be in: the window
 * renders `activeTrack`'s tabs and nothing else exists to navigate to.
 *
 * This is the UI half of the rule the tool registry enforces on the model. With
 * Track 1 selected the orchestrator is not offered `search_graph`, and it would
 * be incoherent for the console beside it to keep the graph one click away — a
 * comparison whose two arms are separated for the model and merged for the
 * operator is separated in the half nobody reads and merged in the half
 * everybody does.
 *
 * **The cost, stated.** You author the graph *before* switching to it, so with
 * Track 1 live there is no way to reach Build or Coverage. That is deliberate,
 * and the resolution is one setting rather than a second door: switch the track
 * in Settings → Retrieval Track and Track 2's tabs are what this window is. The
 * switch is recorded in a committed file, so "I was working on the graph" is a
 * fact about the run rather than something the window let you do invisibly.
 *
 * ## Fallbacks, in order
 *
 * Every step of "which track is live" can fail, and each failure has a distinct
 * answer rather than a shared blank page (MODULES.md §0 rule 4):
 *
 * 1. **Not read yet** — a skeleton tab row at its final height. Guessing a
 *    track and correcting it a moment later would swap the whole tab row under
 *    the cursor, so nothing is asserted until it is known.
 * 2. **Config unreadable** (backend down, bad JSON) — says so and offers a
 *    retry, and shows nothing else. Guessing a track here would be the strict
 *    rule failing open, which is the one direction it must not fail: a window
 *    that showed Track 2's graph because it could not read the setting would be
 *    doing exactly what the setting exists to prevent.
 * 3. **Live track not ready** — it is still what the window shows, because
 *    readiness is reported and never enforced (see `KnowledgeBasePanel`). The
 *    notice says what it is waiting on and points at the track switch. It does
 *    *not* offer the other track's views: that was the detour, and the detour is
 *    what made the two arms feel like tabs of one thing.
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

import { TRACK_OF_TAB, type BlueprintsTab } from './tabs'
import { tabArrowKeys } from '../ui/tablist'

type TabId = BlueprintsTab

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
    full: 'Track 1: traditional vector RAG',
    icon: Boxes,
    tabs: [
      { id: 'ingest', label: 'Build', icon: Upload, hint: 'Import, chunk and embed your documents' },
      { id: 'corpus', label: 'Corpus', icon: Library, hint: 'Every document and chunk, as the retriever stores them' },
      { id: 'retrieval', label: 'Replay', icon: Route, hint: 'Which passages a query actually pulled, and at what distance' },
      { id: 'logs', label: 'Logs', icon: ScrollText, hint: 'Every ingest run and its log, including why a run failed' },
    ],
  },
  graph: {
    label: 'Track 2 · Graph',
    full: 'Track 2: agentic GraphRAG',
    icon: Network,
    tabs: [
      { id: 'authoring', label: 'Build', icon: PenLine, hint: 'Add nodes and edges. Track 2 only knows what you add here' },
      { id: 'graph', label: 'Graph', icon: Network, hint: 'The knowledge graph: 6 node types, 5 edge types' },
      { id: 'coverage', label: 'Coverage', icon: ListChecks, hint: "Orphans and gaps. Each row is a question the graph can't answer" },
      { id: 'replay', label: 'Replay', icon: Route, hint: 'The walk a graph-track query actually took, hop by hop' },
    ],
  },
}

// Opens on the leftmost tab, Build, which is the first step of the pipeline.
const DEFAULT_TAB: Record<RagTrack, TabId> = { vector: 'ingest', graph: 'authoring' }

/**
 * Every tab is a quarter wide, and the row is centred.
 *
 * Track 1 has three tabs and Track 2 has four. A fixed width keeps one geometry
 * for both, so switching tracks slides the underline instead of redrawing the
 * header at a new per-tab size.
 *
 * Centring is what that costs and it is worth paying: left-aligned, Track 1's
 * three tabs left a quarter of dead rail on the right that read as a missing
 * tab — something that had failed to render rather than a row that is simply
 * shorter. Centred, a three-tab row is just a three-tab row.
 *
 * The underline is positioned from the group's own width rather than the
 * container's, so it stays under its tab at either count.
 */
const TAB_BASIS = 100 / 4

function TracePicker({
  traces, selected, onSelect,
}: {
  traces: TraversalSummary[]
  selected: string | null
  onSelect: (id: string) => void
}) {
  return (
    // Sticks while the walk scrolls, so the selected query stays in view.
    <ul className="space-y-1 @2xl:sticky @2xl:top-0 @2xl:max-h-[calc(100vh-14rem)] @2xl:self-start @2xl:overflow-y-auto no-scrollbar">
      {traces.map((t) => {
        const active = t.query_id === selected
        return (
          <li key={t.query_id}>
            <button
              onClick={() => onSelect(t.query_id)}
              aria-pressed={active}
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
 * The live track has nothing to show yet.
 *
 * States it and points at the switch. It used to offer a button into the other
 * track's views, which was the most-used door in a window that is supposed to
 * show one arm — an empty Corpus tab made jumping to the graph the obvious
 * move, and from there the two arms read as two tabs of one thing.
 *
 * Changing the track is the answer, and it deliberately costs a trip to
 * Settings: it is written to a committed file and recorded per query, so which
 * arm produced a result stays recoverable. A button here would have made that a
 * click nobody remembers.
 */
function NotReady({ live }: { live: TrackStatus }) {
  return (
    <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-400/40 bg-amber-400/10 p-2.5">
      <AlertCircle size={13} className="mt-0.5 shrink-0 text-amber-400" />
      <p className="min-w-0 flex-1 text-[11px] leading-relaxed theme-text">
        <span className="theme-text-muted">{TRACKS[live.id].full}</span> is the selected track and
        has nothing to show yet{live.blocked_by ? `. It needs ${live.blocked_by}` : ''}.{' '}
        <span className="theme-text-muted">{live.detail}</span>
        <br />
        <span className="theme-text-muted">
          The other track's views are hidden while this one is selected. You can switch
          tracks in Settings → Retrieval Track.
        </span>
      </p>
    </div>
  )
}

export function BlueprintsWindow({
  open, onClose, requestedTab = null, onOpenForge,
}: {
  open: boolean
  onClose: () => void
  /** Open on this tab instead of the live track's default — see `BLUEPRINT_TABS`. */
  requestedTab?: BlueprintsTab | null
  /**
   * Opens the Forge. Passed through to the Corpus step that reports the
   * embedding model, which hands model management off rather than duplicating
   * it — the window does not own the other windows, the root does.
   */
  onOpenForge?: () => void
}) {
  const [config, setConfig] = useState<RagConfig | null>(null)
  const [configError, setConfigError] = useState<LoadFailure | null>(null)
  const [tab, setTab] = useState<TabId>('graph')
  const [traces, setTraces] = useState<TraversalSummary[]>([])
  const [tracesError, setTracesError] = useState<LoadFailure | null>(null)
  const [selected, setSelected] = useState<string | null>(null)

  const loadTraces = useCallback(() => {
    fetchTraversals()
      .then((r) => {
        setTracesError(null)
        setTraces(r.traversals)
        setSelected((current) =>
          current && r.traversals.some((t) => t.query_id === current)
            ? current
            : r.traversals.find((t) => t.replayable)?.query_id ?? null,
        )
      })
      // Not an empty list: an empty list would claim nothing was recorded.
      .catch((e: unknown) => setTracesError(toFailure(e)))
  }, [])

  const show = useCallback((track: RagTrack) => {
    setTab(DEFAULT_TAB[track])
  }, [])

  /**
   * Honour a tab asked for by name — but only if the live track owns it.
   *
   * A palette row, a stale request, a link from somewhere: none of them may
   * move the window onto the other arm. A foreign tab falls back to the live
   * track's default rather than being refused, because the caller asked to see
   * Blueprints and showing Blueprints is the right answer to that.
   */
  const showTab = useCallback((wanted: TabId, live: RagTrack) => {
    setTab(TRACK_OF_TAB[wanted] === live ? wanted : DEFAULT_TAB[live])
  }, [])

  // Re-read on every open rather than once: the track is changed in Settings, a
  // different window, and a stale badge here would assert the opposite of what
  // is running. Following the live track is the whole point of knowing it.
  const loadConfig = useCallback((preferTab: TabId | null = null) => {
    fetchRagConfig()
      .then((c) => {
        // Cleared on success rather than before the request. Clearing it up
        // front is a synchronous setState inside the effect that calls this —
        // a render of the empty state, then another once the answer lands — and
        // it makes a failed Retry blink the message away and back. Held until
        // there is something better to say, the strip just stops being true.
        setConfigError(null)
        setConfig(c)
        // A tab asked for by name wins over the live track's default. Applied
        // in here rather than in a second effect because this resolves last:
        // set outside, the config's own `show` would land after it and undo it.
        if (preferTab) showTab(preferTab, c.track)
        else show(c.track)
      })
      .catch((e: Error) => {
        // The previous answer is kept: a failed re-read is not evidence the
        // track changed, and blanking a window that was correct a second ago
        // loses more than the stale badge costs. The strip below says so.
        setConfigError(toFailure(e))
        // The request is *not* honoured here. Which track owns a tab is only
        // half the question; the other half is which track is live, and that is
        // exactly what could not be read. Applying it anyway would show the
        // graph because the setting was unavailable.
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

  // Live: keep the badge and readiness current, and only move the tab if the track itself changed.
  useLiveRefresh(['rag', 'corpus', 'embeddings'], () => {
    if (!open) return
    fetchRagConfig()
      .then((c) => {
        if (config && config.track !== c.track) show(c.track)
        setConfigError(null)
        setConfig(c)
      })
      .catch(() => undefined)
  })

  // Two more ways the track changes while this window is not looking.
  //
  // **Minimize hides, it does not unmount** — so the window can sit invisible
  // across a track change in Settings, keep its stale config, and come back
  // showing the other arm's tabs until it is closed and reopened. `open` never
  // changed, so the effect above never re-ran.
  //
  // The event covers it the moment it happens; `becameVisible` covers every
  // other cause, including the `manage_settings` agent tool writing the config
  // from the backend, which no frontend event can know about.
  useEffect(() => {
    if (!open) return
    const onChanged = () => loadConfig()
    window.addEventListener(RAG_TRACK_CHANGED_EVENT, onChanged)
    return () => window.removeEventListener(RAG_TRACK_CHANGED_EVENT, onChanged)
  }, [open, loadConfig])

  useEffect(() => {
    if (open && tab === 'replay') loadTraces()
  }, [open, tab, loadTraces])

  const activeTrack = config?.track ?? null
  // The window *is* the live track. There is no second variable that could
  // disagree with it, which is what makes the isolation structural rather than
  // a rule every render has to remember to apply.
  const group = activeTrack ? TRACKS[activeTrack] : null

  const liveStatus = useMemo(
    () => config?.tracks.find((t) => t.id === config.track) ?? null,
    [config],
  )
  // Fallback 3. Shown whenever the selected track cannot answer, regardless of
  // whether the other one could — the other one is not on offer, so its
  // readiness is not this notice's business.
  const notReady = liveStatus && !liveStatus.ready ? liveStatus : null

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
      {({ minimized }) => (
      <WindowBody
        minimized={minimized}
        onRestored={loadConfig}
      >
      <div className="@container flex-1 flex flex-col min-h-0">
        <div className="shrink-0 border-b theme-border px-6 pt-4">
          {/* No track chip and no way back, because there is nowhere to come
              back from: this window renders the live track and the other one is
              not reachable. The window's subtitle names which arm is running. */}
          <div className="flex min-h-[34px] items-center justify-center">
            {group ? (
              // The tabs and their underline are one positioning context, so the
              // underline's percentages resolve against the tab group rather
              // than the full-width row the group is centred in.
              <div
                role="tablist"
                aria-label="Blueprints views"
                className="relative flex"
                style={{ width: `${TAB_BASIS * group.tabs.length}%` }}
                onKeyDown={tabArrowKeys(group.tabs.map((t) => t.id), tab, setTab)}
              >
                {group.tabs.map((entry) => {
                  const selectedTab = tab === entry.id
                  return (
                    <button
                      key={entry.id}
                      onClick={() => setTab(entry.id)}
                      role="tab"
                      data-tab={entry.id}
                      aria-selected={selectedTab}
                      tabIndex={selectedTab ? 0 : -1}
                      title={entry.hint}
                      style={{ flexBasis: `${100 / group.tabs.length}%` }}
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
                    width: `${100 / group.tabs.length}%`,
                    transform: `translateX(${Math.max(group.tabs.findIndex((t) => t.id === tab), 0) * 100}%)`,
                  }}
                />
              </div>
            ) : (
              <Skeleton className="h-5 w-64" />
            )}
          </div>
        </div>

        {/* `min-h-full` plus a flex column is what lets a view *fill* the window
            instead of sitting at whatever height its content happens to be. The
            graph diagram uses it: maximize the window and the canvas grows with
            it, rather than leaving a screen of empty space under a fixed 460px
            box. Views that do not opt in are unaffected — without a `flex-1`
            child the column is just a block that scrolls as before. */}
        <div className="flex-1 min-h-0 overflow-y-auto no-scrollbar p-6">
          <div
            key={`${activeTrack ?? 'unknown'}-${tab}`}
            className="mx-auto flex min-h-full w-full flex-col @4xl:max-w-4xl @7xl:max-w-[min(100%,1400px)] animate-in fade-in slide-in-from-bottom-2 duration-300 ease-out"
          >

            {notReady && <NotReady live={notReady} />}

            {configError ? (
              // The live track could not be read: the window is the error page.
              // Showing a track anyway would be the strict rule failing open in
              // the only direction it must not — Track 2 *because* the setting
              // that selects a track could not be read.
              <TabError
                code={configError.status}
                detail={configError.message}
                what="Blueprints couldn't tell which retrieval track is active. It only shows the active track, so rather than guess, it shows nothing."
                onRetry={() => loadConfig()}
              />
            ) : !group ? (
              <Skeleton className="h-64 w-full" />
            ) : (
              <>
                    {tab === 'corpus' && <CorpusView onBuild={() => setTab('ingest')} />}
                    {tab === 'retrieval' && <RetrievalView />}
                    {tab === 'usage' && <UsageView />}
                    {tab === 'ingest' && <IngestView onOpenForge={onOpenForge} onShowCorpus={() => setTab('corpus')} onShowLogs={() => setTab('logs')} />}
                    {tab === 'logs' && <IngestLogsView />}
                    {tab === 'authoring' && <AuthoringView />}
                {tab === 'graph' && <GraphView />}
                {tab === 'coverage' && <CoverageView />}
                {tab === 'replay' && (
                  tracesError ? (
                    <TabError
                      code={tracesError.status}
                      detail={tracesError.message}
                      what="The recorded graph walks could not be read from the audit log."
                      onRetry={loadTraces}
                    />
                  ) : traces.length === 0 ? (
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
      </WindowBody>
      )}
    </FloatingWindow>
  )
}

/**
 * Calls `onRestored` when the window stops being minimized.
 *
 * A component rather than an effect inside `BlueprintsWindow`, because the
 * `minimized` flag only exists inside `FloatingWindow`'s render prop and
 * lifting it would mean threading state back up through the very component that
 * owns it. This just watches the edge and passes it on.
 *
 * Only the false-edge: `onRestored` firing on minimize would issue a request
 * for a window nobody is looking at, which is the opposite of the point.
 */
function WindowBody({
  minimized, onRestored, children,
}: {
  minimized: boolean
  onRestored: () => void
  children: React.ReactNode
}) {
  const wasMinimized = useRef(minimized)
  useEffect(() => {
    if (wasMinimized.current && !minimized) onRestored()
    wasMinimized.current = minimized
  }, [minimized, onRestored])
  return <>{children}</>
}
