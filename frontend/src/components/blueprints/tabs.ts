// The Blueprints tab set, and which retrieval track owns each one.
//
// Its own module rather than an export from `BlueprintsWindow`, for a reason
// that is not style: a file exporting both a component and a plain value breaks
// React Fast Refresh, which then falls back to a **full page reload** on every
// edit. The dev server said so on every save —
//
//     hmr invalidate … Could not Fast Refresh ("BLUEPRINT_TABS" export is
//     incompatible)
//
// — and a full reload during UI work loses the open window, the active tab and
// any half-filled form, which is most of what makes HMR worth having.
//
// It is also the right shape independently. The command palette needs this list
// and has no business importing the window to get it.
//
// ## The two tracks mirror each other
//
// Each arm is inspected the same way, which is what lets §5's comparison be
// about the retrieval strategies rather than about how well each half happened
// to get instrumented:
//
// |            | Track 1     | Track 2    |
// |------------|-------------|------------|
// | inventory  | Corpus      | Graph      |
// | gaps       | —           | Coverage   |
// | trace      | Replay      | Replay     |
// | authoring  | Build       | Build      |
//
// Track 1's `Corpus` used to be all four at once, which made its name wrong: it
// was named for the artefact and was mostly a pipeline manager. Splitting it
// gives each tab one job and gives the name back its meaning.

import type { RagTrack } from '../../lib/blueprintsClient';

export type BlueprintsTab =
  | 'corpus'
  | 'retrieval'
  | 'ingest'
  | 'graph'
  | 'coverage'
  | 'replay'
  | 'authoring';

/**
 * Each tab carries its `track`, because both the window and the palette filter
 * by it: Blueprints shows one arm, and a palette row offering a tab the window
 * will not open is a row that lies — you would select Coverage, land on Corpus,
 * and have no idea why.
 */
export const BLUEPRINT_TABS: readonly {
  id: BlueprintsTab;
  label: string;
  track: RagTrack;
  keywords: string;
}[] = [
  {
    id: 'corpus', label: 'Corpus', track: 'vector',
    keywords: 'documents chunks inventory what is indexed vector track 1',
  },
  {
    id: 'retrieval', label: 'Replay', track: 'vector',
    keywords: 'retrieval chunks distances trace grounded evidence which passages vector',
  },
  {
    id: 'ingest', label: 'Build', track: 'vector',
    keywords: 'import upload chunk embed ingest pipeline run documents',
  },
  {
    id: 'graph', label: 'Graph', track: 'graph',
    keywords: 'nodes edges knowledge browse track 2',
  },
  {
    id: 'coverage', label: 'Coverage', track: 'graph',
    keywords: 'orphans gaps missing todo authoring',
  },
  {
    id: 'replay', label: 'Replay', track: 'graph',
    keywords: 'traversal hops walk trace query path',
  },
  {
    id: 'authoring', label: 'Build', track: 'graph',
    keywords: 'author edit add node edge create graph pipeline',
  },
];

/** Which track owns each tab — the inverse of the table above. */
export const TRACK_OF_TAB: Record<BlueprintsTab, RagTrack> = Object.fromEntries(
  BLUEPRINT_TABS.map((t) => [t.id, t.track]),
) as Record<BlueprintsTab, RagTrack>;
