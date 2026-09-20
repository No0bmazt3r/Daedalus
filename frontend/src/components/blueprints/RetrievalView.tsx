import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, FileText, Timer, Layers } from 'lucide-react'
import {
  fetchRetrievals, fetchRetrieval,
  type RetrievalSummary, type Retrieval,
} from '../../lib/blueprintsClient'
import { Skeleton } from '../ui/skeleton'
import { Unavailable } from './Unavailable'

/**
 * Retrieval replay — what a Track 1 query actually pulled. MODULES.md §3.2.
 *
 * Track 2 has always been able to show its working: Replay walks the graph hop
 * by hop and the reader can see exactly why an answer was reachable. Track 1
 * could not, and that asymmetry was a hole in the project's own claim. A
 * comparison of two retrieval strategies where only one of them is auditable is
 * not a comparison of two retrieval strategies — and "grounded" is not a
 * property you can assert about an arm nobody can inspect.
 *
 * So this is the vector arm's evidence: the query, the passages it returned, the
 * distance each came back at, and the document each passage belongs to. Enough
 * to check a citation by reading it, which is the only check that actually
 * settles anything.
 *
 * ## It renders a recording, never a re-run
 *
 * Every row comes from `rag_logs`, written at the dispatch boundary when the
 * query ran. Re-querying to "replay" would show what the index returns today —
 * a different claim, and a quietly wrong one after any re-ingest.
 *
 * ## Distances are shown as stored
 *
 * Cosine distance from Chroma, not converted to a similarity percentage. Lower
 * is closer. The conversion is easy and would make the numbers friendlier, and
 * it would also make them uncheckable against the store — which for the one
 * screen whose job is to be checkable is the wrong trade.
 *
 * ## A missing chunk is a finding
 *
 * `rag_logs` holds chunk ids; the text is joined from the corpus. When the join
 * misses, the chunk was retrieved and has since been re-chunked away. That is
 * reported rather than dropped: it means this answer rests on a passage the
 * corpus can no longer produce, which an evaluation needs to know.
 */

function distanceTone(distance: number | null): string {
  if (distance == null) return 'theme-text-muted'
  // Cosine distance: 0 is identical, 2 is opposite. The bands are a reading
  // aid, not a threshold anything acts on — nothing here filters by score.
  if (distance < 0.5) return 'theme-accent'
  if (distance < 0.9) return 'theme-text'
  return 'theme-text-muted'
}

function QueryPicker({
  items, selected, onSelect,
}: {
  items: RetrievalSummary[]
  selected: string | null
  onSelect: (id: string) => void
}) {
  return (
    <ul className="space-y-1">
      {items.map((r) => {
        const active = r.query_id === selected
        return (
          <li key={r.query_id}>
            <button
              onClick={() => onSelect(r.query_id)}
              className={`w-full rounded-md border px-2.5 py-1.5 text-left transition-colors ${
                active ? 'theme-accent-border theme-surface-strong' : 'theme-border hover:theme-surface'
              }`}
            >
              <span className="block truncate text-xs theme-text">{r.query_text || '(no text)'}</span>
              <span className="mt-0.5 flex items-center gap-1.5 text-[10px] theme-text-muted">
                <span>top {r.top_k ?? '—'}</span>
                <span>·</span>
                <span className="tabular-nums">{r.retrieval_latency_ms ?? '—'}ms</span>
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

function Detail({ queryId }: { queryId: string | null }) {
  // Tagged with the query it describes, so the detail for the *previous*
  // selection cannot render against the current one — and so clearing it does
  // not need a synchronous setState inside the effect, which is a render
  // published only to be corrected on the next one.
  const [result, setResult] = useState<
    { queryId: string; data: Retrieval | null; reason: string | null } | null
  >(null)

  useEffect(() => {
    if (!queryId) return
    void fetchRetrieval(queryId)
      .then((r) =>
        setResult(
          r.available
            ? { queryId, data: r, reason: null }
            : { queryId, data: null, reason: r.reason },
        ),
      )
      .catch((e: Error) => setResult({ queryId, data: null, reason: e.message }))
  }, [queryId])

  if (!queryId) return null
  const shown = result?.queryId === queryId ? result : null
  if (shown?.reason) return <Unavailable reason={shown.reason} />
  const data = shown?.data
  if (!data) return <Skeleton className="h-64 w-full" />

  return (
    <div className="space-y-3">
      <div className="rounded-lg border theme-border theme-card p-3">
        <p className="text-xs theme-text">{data.query_text}</p>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] theme-text-muted">
          <span className="flex items-center gap-1">
            <Layers size={10} /> {data.chunks.length} of top {data.top_k ?? '—'}
          </span>
          <span className="flex items-center gap-1">
            {/* Retrieval only. No model call is inside this number, and
                BENCHMARK.md §9.7 is about exactly this being quoted as if it
                were end-to-end. */}
            <Timer size={10} /> {data.retrieval_latency_ms ?? '—'}ms retrieval
          </span>
          {data.collection && <code className="theme-text-muted">{data.collection}</code>}
        </div>
      </div>

      {data.missing_count > 0 && (
        <p className="flex items-start gap-1.5 rounded-lg border border-amber-400/40 bg-amber-400/10 p-2.5 text-[11px] leading-relaxed theme-text">
          <AlertTriangle size={12} className="mt-0.5 shrink-0 text-amber-400" />
          {data.missing_count} of these passages no longer exist in the corpus — it has been
          re-chunked since this query ran. The answer was grounded in text the corpus can no longer
          produce, which is worth knowing before citing it.
        </p>
      )}

      {data.chunks.length === 0 ? (
        <Unavailable reason="This query retrieved nothing. The corpus was searched and had no passage for it — which is a result, not a failure, and is what an honest 'I don't have that' is built on." />
      ) : (
        <ol className="space-y-1.5">
          {data.chunks.map((c) => (
            <li
              key={`${c.chunk_id}-${c.rank}`}
              className={`rounded-lg border p-2.5 ${
                c.missing ? 'border-amber-400/40 bg-amber-400/5' : 'theme-border theme-card'
              }`}
            >
              <div className="flex items-center gap-1.5 text-[10px]">
                <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full border theme-border tabular-nums theme-text-muted">
                  {c.rank}
                </span>
                <FileText size={10} className="shrink-0 theme-text-muted" />
                <span className="min-w-0 flex-1 truncate theme-text-muted">
                  {c.source_file ?? c.chunk_id}
                  {c.page_number ? ` · p${c.page_number}` : ''}
                  {c.section_title ? ` · ${c.section_title}` : ''}
                </span>
                <span className={`shrink-0 tabular-nums ${distanceTone(c.distance)}`}>
                  {c.distance != null ? c.distance.toFixed(4) : '—'}
                </span>
              </div>
              {c.missing ? (
                <p className="mt-1.5 text-[10px] leading-relaxed text-amber-400">
                  This chunk is no longer in the corpus, so its text cannot be shown.
                </p>
              ) : (
                <p className="mt-1.5 whitespace-pre-wrap text-[10px] leading-relaxed theme-text opacity-85">
                  {c.text}
                </p>
              )}
            </li>
          ))}
        </ol>
      )}

      <p className="text-[10px] leading-relaxed theme-text-muted">
        Distances are cosine distance exactly as the store returned them — lower is closer, and
        they are not converted to a similarity percentage so that each one can be checked against
        Chroma directly.
      </p>
    </div>
  )
}

export function RetrievalView() {
  const [items, setItems] = useState<RetrievalSummary[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)

  const load = useCallback(() => {
    fetchRetrievals()
      .then((r) => {
        setItems(r.retrievals)
        setSelected((current) =>
          current && r.retrievals.some((x) => x.query_id === current)
            ? current
            : r.retrievals.find((x) => x.replayable)?.query_id ?? null,
        )
      })
      .catch(() => setItems([]))
  }, [])

  useEffect(() => { load() }, [load])

  if (!items) return <Skeleton className="h-64 w-full" />

  if (items.length === 0) {
    return (
      <Unavailable
        reason={
          'No vector retrieval has been recorded yet. A row is written when a traced query runs ' +
          'search_corpus — so this fills once the orchestrator is asking questions against an ' +
          'ingested corpus. Trialling the tool in Settings deliberately writes nothing: a trial ' +
          'is not a query, and a row for one would land in the evaluation set as though it were.'
        }
      />
    )
  }

  return (
    <div className="grid gap-4 @2xl:grid-cols-[minmax(0,260px)_minmax(0,1fr)]">
      <QueryPicker items={items} selected={selected} onSelect={setSelected} />
      <Detail queryId={selected} />
    </div>
  )
}
