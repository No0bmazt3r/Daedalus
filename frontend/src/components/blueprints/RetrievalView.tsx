import { useCallback, useEffect, useState } from 'react'
import { TabError } from '../errors/TabError'
import { toFailure, type LoadFailure } from '../errors/ErrorPage'
import { AlertTriangle, FileText, Timer, Layers, ChevronDown } from 'lucide-react'
import { reflowPassage } from '../../lib/passage'
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

type Chunk = Retrieval['chunks'][number]

/**
 * One retrieved passage: where it came from on top, then its text as
 * paragraphs. Long passages open folded to a few lines so five of them fit on
 * a screen; the whole text is one click away.
 */
function PassageCard({ c }: { c: Chunk }) {
  const [open, setOpen] = useState(false)
  const paragraphs = c.missing ? [] : reflowPassage(c.text ?? '')
  const long = (c.text ?? '').length > 600
  return (
    <li className={`rounded-lg border ${c.missing ? 'border-amber-400/40 bg-amber-400/5' : 'theme-border theme-card'}`}>
      <div className="flex items-start gap-2 border-b theme-border px-3 py-2">
        <span className="mt-px shrink-0 rounded border theme-border px-1.5 text-[10px] tabular-nums theme-text-muted" title="Rank: 1 was the closest match">
          #{c.rank}
        </span>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[12px] theme-text">
            <FileText size={11} className="shrink-0 theme-text-muted" />
            <span className="truncate" title={c.source_file ?? c.chunk_id}>{c.source_file ?? c.chunk_id}</span>
            {c.page_number ? <span className="shrink-0 text-[11px] theme-text-muted">p.{c.page_number}</span> : null}
          </p>
          {c.section_title && (
            <p className="truncate text-[11px] theme-text-muted" title={c.section_title}>§ {c.section_title}</p>
          )}
        </div>
        <span
          className={`shrink-0 rounded border theme-border px-1.5 py-0.5 text-[10px] tabular-nums ${distanceTone(c.distance)}`}
          title="Cosine distance. Lower is closer"
        >
          dist {c.distance != null ? c.distance.toFixed(3) : '-'}
        </span>
      </div>
      {c.missing ? (
        <p className="px-3 py-2 text-[11px] leading-relaxed text-amber-400">
          This chunk is no longer in the corpus, so its text cannot be shown.
        </p>
      ) : (
        <div className="px-3 py-2">
          <div className={`space-y-2 text-[12px] leading-relaxed theme-text opacity-90 ${long && !open ? 'line-clamp-6' : ''}`}>
            {paragraphs.map((p, i) => <p key={i} className="whitespace-pre-line">{p}</p>)}
          </div>
          {long && (
            <button
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              className="mt-1.5 flex items-center gap-1 text-[11px] theme-accent hover:underline"
            >
              <ChevronDown size={11} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
              {open ? 'Show less' : 'Show full passage'}
            </button>
          )}
        </div>
      )}
    </li>
  )
}

function QueryPicker({
  items, selected, onSelect,
}: {
  items: RetrievalSummary[]
  selected: string | null
  onSelect: (id: string) => void
}) {
  return (
    // Sticks while the passages scroll, so the selected query stays in view.
    <ul className="space-y-1 @2xl:sticky @2xl:top-0 @2xl:max-h-[calc(100vh-14rem)] @2xl:self-start @2xl:overflow-y-auto no-scrollbar">
      {items.map((r) => {
        const active = r.query_id === selected
        return (
          <li key={r.query_id}>
            <button
              onClick={() => onSelect(r.query_id)}
              title={r.query_text || undefined}
              aria-pressed={active}
              className={`w-full rounded-md border px-2.5 py-1.5 text-left transition-colors ${
                active ? 'theme-accent-border theme-surface-strong' : 'theme-border hover:theme-surface'
              }`}
            >
              <span className="block truncate text-xs theme-text">{r.query_text || '(no text)'}</span>
              <span className="mt-0.5 flex items-center gap-1.5 text-[10px] theme-text-muted">
                <span>top {r.top_k ?? '-'}</span>
                <span>·</span>
                <span className="tabular-nums">{r.retrieval_latency_ms ?? '-'}ms</span>
              </span>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * A real question, as a draft entry for `config/eval/queries.yaml`. The
 * retrieved documents are offered as `relevant_documents` *candidates* only:
 * the labels are ground truth and must be checked by hand — copying what the
 * system found and calling it correct would grade Track 1 against itself.
 */
function CopyAsQuestion({ question, files }: { question: string; files: string[] }) {
  const [copied, setCopied] = useState(false)
  const yaml = [
    '- id: QXX',
    '  category: single_hop_factual  # TODO: single_hop_procedural | multi_hop_causal | ambiguous | out_of_corpus',
    `  question: ${JSON.stringify(question)}`,
    '  language: en',
    '  rig_specific: false  # TODO',
    '  expect:',
    '    answerable: true',
    '    key_facts: []  # TODO: what a correct answer must state',
    `    relevant_documents: []  # TODO, check by hand. Retrieved: ${[...new Set(files)].join(', ') || 'none'}`,
    '    relevant_nodes: []',
    '  notes: drafted from a real query in Blueprints → Replay',
  ].join('\n')
  return (
    <button
      onClick={() => void navigator.clipboard.writeText(yaml).then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500) })}
      title="Copy this question as a draft entry for config/eval/queries.yaml. The labels are left for you to write."
      className="ml-auto rounded-md border theme-border px-1.5 py-0.5 theme-text-muted hover:theme-text"
    >
      {copied ? 'Copied' : 'Copy as eval question'}
    </button>
  )
}

function Detail({ queryId }: { queryId: string | null }) {
  // Tagged with the query it describes, so the detail for the *previous*
  // selection cannot render against the current one — and so clearing it does
  // not need a synchronous setState inside the effect, which is a render
  // published only to be corrected on the next one.
  const [result, setResult] = useState<
    { queryId: string; data: Retrieval | null; reason: string | null; failure?: LoadFailure } | null
  >(null)
  const [attempt, setAttempt] = useState(0)

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
      .catch((e: unknown) => setResult({ queryId, data: null, reason: null, failure: toFailure(e) }))
  }, [queryId, attempt])

  if (!queryId) return null
  const shown = result?.queryId === queryId ? result : null
  // Could not be read: the error page. Recorded but not replayable: the honest empty state.
  if (shown?.failure) {
    return (
      <TabError
        code={shown.failure.status}
        detail={shown.failure.message}
        what="This retrieval could not be read from the audit log."
        onRetry={() => { setResult(null); setAttempt((n) => n + 1) }}
      />
    )
  }
  if (shown?.reason) return <Unavailable reason={shown.reason} />
  const data = shown?.data
  // Shaped like a retrieval (query card, then ranked passages) so nothing jumps.
  if (!data) {
    return (
      <div className="space-y-2" role="status" aria-busy="true" aria-label="Loading retrieval">
        <Skeleton className="h-16 w-full" />
        {[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full" />)}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border theme-border theme-card p-3">
        <p className="text-xs theme-text">{data.query_text}</p>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] theme-text-muted">
          <span className="flex items-center gap-1">
            <Layers size={10} /> {data.chunks.length} of top {data.top_k ?? '-'}
          </span>
          <span className="flex items-center gap-1">
            {/* Retrieval only. No model call is inside this number, and
                BENCHMARK.md §9.7 is about exactly this being quoted as if it
                were end-to-end. */}
            <Timer size={10} /> {data.retrieval_latency_ms ?? '-'}ms retrieval
          </span>
          {data.collection && <code className="theme-text-muted">{data.collection}</code>}
          <CopyAsQuestion question={data.query_text} files={data.chunks.map((c) => c.source_file).filter((f): f is string => !!f)} />
        </div>
      </div>

      {data.missing_count > 0 && (
        <p className="flex items-start gap-1.5 rounded-lg border border-amber-400/40 bg-amber-400/10 p-2.5 text-[11px] leading-relaxed theme-text">
          <AlertTriangle size={12} className="mt-0.5 shrink-0 text-amber-400" />
          {data.missing_count} of these passages no longer exist in the corpus. It has been
          re-chunked since this query ran. The answer was grounded in text the corpus can no longer
          produce, which is worth knowing before citing it.
        </p>
      )}

      {data.chunks.length === 0 ? (
        <Unavailable reason="This query found nothing. The corpus was searched and had no matching passage. That's a valid result, not an error, and it's what lets the system honestly say 'I don't have that'." />
      ) : (
        <ol className="space-y-1.5">
          {data.chunks.map((c) => (
            <PassageCard key={`${c.chunk_id}-${c.rank}`} c={c} />
          ))}
        </ol>
      )}

      <p className="text-[10px] leading-relaxed theme-text-muted">
        Distances are cosine distances, exactly as the store returned them. Lower means closer. They
        are not converted to a similarity percentage so that each one can be checked against
        Chroma directly.
      </p>
    </div>
  )
}

export function RetrievalView() {
  const [items, setItems] = useState<RetrievalSummary[] | null>(null)
  const [listError, setListError] = useState<LoadFailure | null>(null)
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
      .catch((e: unknown) => setListError(toFailure(e)))
  }, [])

  useEffect(() => { load() }, [load])

  // A failed read used to look like "nothing recorded yet", which is a claim
  // about the data the window could not check. It is the error page instead.
  if (listError) {
    return (
      <TabError
        code={listError.status}
        detail={listError.message}
        what="The recorded retrievals could not be read from the audit log."
        onRetry={() => { setListError(null); load() }}
      />
    )
  }
  // The query list and the detail beside it, each as its own placeholder.
  if (!items) {
    return (
      <div className="grid gap-4 @2xl:grid-cols-[minmax(0,260px)_minmax(0,1fr)]" role="status" aria-busy="true" aria-label="Loading retrievals">
        <div className="space-y-1">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-11 w-full" />)}</div>
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
      </div>
    )
  }

  if (items.length === 0) {
    return (
      <Unavailable
        reason={
          'No vector retrieval has been recorded yet. A row is written when a traced query runs ' +
          'search_corpus, so this fills up once the orchestrator is asking questions against an ' +
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
