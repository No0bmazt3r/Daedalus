import { Info } from 'lucide-react'
import type { RagTrack } from '../../lib/blueprintsClient'

/**
 * Says which retrieval track is live, on a tab that belongs to the other one.
 *
 * ## When it appears
 *
 * Only when you have deliberately left the live track. `BlueprintsWindow` shows
 * one track — the one answering queries — so the two are no longer peers on
 * screen; the other is reachable as a fallback, and this is what marks the
 * detour for as long as it lasts.
 *
 * ## Why signal rather than hide, once you are there
 *
 * The off-track views cannot simply be removed, because of the authoring loop:
 * you inspect and complete the graph *before* switching to it, so the window
 * that shows you the graph must work while the graph is not live. Hiding it
 * would make Track 2 impossible to prepare from inside the app.
 *
 * The confusion that ranking did not solve is narrower than "the graph is
 * visible". It is that a diagram on screen looks like a description of how the
 * answer was produced. So this states the relationship instead of removing the
 * view — the same call MODULES.md §0 rule 4 makes about empty states: explain,
 * do not blank.
 *
 * ## Replay is the case that actually needed this
 *
 * The graph and corpus tabs are inventories; they are true whatever is running.
 * Replay is not. With Track 1 live, nothing writes a traversal, so the tab keeps
 * rendering older walks and quietly becomes a museum — the reader has no way to
 * tell a current trace from one recorded under a setting that no longer holds.
 */
export function TrackBanner({
  tabTrack,
  activeTrack,
  isReplay = false,
}: {
  /** Which track this tab describes. */
  tabTrack: RagTrack
  /** Which track is actually answering queries right now. */
  activeTrack: RagTrack
  isReplay?: boolean
}) {
  if (tabTrack === activeTrack) return null

  const liveLabel = activeTrack === 'vector' ? 'Track 1 — traditional vector RAG' : 'Track 2 — agentic GraphRAG'
  const thisLabel = tabTrack === 'vector' ? 'the vector corpus' : 'the knowledge graph'

  return (
    <div className="mb-4 flex items-start gap-2 rounded-lg border border-amber-400/40 bg-amber-400/10 p-2.5">
      <Info size={13} className="mt-0.5 shrink-0 text-amber-400" />
      <p className="text-[11px] leading-relaxed theme-text">
        <span className="theme-text-muted">{liveLabel}</span> is answering queries, so {thisLabel}{' '}
        {isReplay
          ? 'is not being walked — nothing new will be recorded here until Track 2 is selected. What follows are walks recorded earlier.'
          : 'below is authored and inspectable, but is not what produced any recent answer.'}{' '}
        <span className="theme-text-muted">Change it in Settings → Knowledge Base.</span>
      </p>
    </div>
  )
}
