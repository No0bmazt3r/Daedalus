import { useEffect, useState } from 'react'
import { fetchCorpusDocuments, type CorpusDocuments } from '../../lib/blueprintsClient'
import { Skeleton } from '../ui/skeleton'
import { Unavailable } from './Unavailable'

/**
 * The corpus — MODULES.md §3.1 half A. **Blocked on M2.**
 *
 * When ingestion lands this lists every ingested document with its type,
 * version, page and chunk counts and embedding status, and drills into a
 * document to show its chunks with metadata and the text as the retriever sees
 * it (architecture/04).
 *
 * It is wired now, against the honest empty state, rather than left out. Two
 * reasons: a missing tab makes the module look finished when it is half built,
 * and the empty state is the thing that names *which* milestone owes the data —
 * which is the whole point of MODULES.md §0 rule 4.
 *
 * Worth knowing when this is built: the pipeline that fills it will make the
 * two tracks diverge silently. Dropping a PDF into `data/documents/` gives
 * Track 1 a new searchable document for free, while Track 2 stays blind until
 * somebody hand-authors the matching nodes. PROJECT.md §5 only holds if both
 * corpora are equally complete, so ingestion should report documents with no
 * graph node as another row in Coverage.
 */
export function CorpusView() {
  const [data, setData] = useState<CorpusDocuments | null>(null)

  useEffect(() => {
    fetchCorpusDocuments().then(setData).catch(() => setData(null))
  }, [])

  if (!data) return <Skeleton className="h-40 w-full" />

  return (
    <div className="space-y-4">
      <Unavailable reason={data.reason} blockedBy={data.blocked_by} />
      <div className="rounded-lg border theme-border theme-card p-3">
        <h4 className="text-xs theme-text">Shared by both tracks</h4>
        <p className="mt-1.5 text-[11px] leading-relaxed theme-text-muted">
          Filed under Track 1 because it is the vector track's primary artefact, but the graph
          track indexes the same chunks — traversal identifies which documents are relevant, then
          pulls their text by <code className="theme-text">source_file</code> rather than by
          similarity. One corpus for both arms is what keeps the comparison about architecture
          instead of about chunking.
        </p>
      </div>

      <div className="rounded-lg border theme-border theme-card p-3">
        <h4 className="text-xs theme-text">What lands here</h4>
        <ul className="mt-2 space-y-1 text-[11px] leading-relaxed theme-text-muted">
          <li>· Every ingested document — source file, type, version, pages, chunks, embedding status</li>
          <li>· Drill into a document for its chunks with <code>source_type</code>, <code>reactor_mode</code> and <code>document_version</code></li>
          <li>· The chunk text exactly as the retriever sees it</li>
        </ul>
      </div>
    </div>
  )
}
