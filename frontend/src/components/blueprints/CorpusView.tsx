import { useCallback, useEffect, useState } from 'react'
import { FileText, AlertCircle, Search, ChevronRight, Database } from 'lucide-react'
import {
  fetchCorpusStatus, fetchCorpusDocuments, fetchDocumentChunks,
  type CorpusStatus, type CorpusDocument, type CorpusChunk,
} from '../../lib/blueprintsClient'
import { Skeleton } from '../ui/skeleton'

/**
 * The corpus — what Track 1 actually holds, MODULES.md §3.1.
 *
 * Inventory, not machinery. Every ingested document, and every chunk **as the
 * retriever sees it**: the exact text that was embedded, its offsets, its page,
 * the section it came from, and whether it has a vector at all.
 *
 * ## Why this is its own tab now
 *
 * It used to be one tab doing four jobs — inventory, chunk settings, embedding
 * model and the run — under the name *Corpus*, which made the name wrong. The
 * corpus is the artefact; importing and embedding is the machinery that produces
 * it, and that is now **Build**. Naming a pipeline after its output is how you
 * end up with a screen where nothing on it is the thing it is called.
 *
 * It also completes the symmetry the comparison needs. Track 2 has always had an
 * inventory (Graph) separate from its authoring (Build); Track 1 did not, so the
 * question "what does this arm actually know" had a good answer on one side and
 * a settings page on the other.
 *
 * ## The chunk text is the point
 *
 * A citation is only checkable if you can read the passage it points at. This
 * shows the stored text, which is the same text that was embedded and the same
 * text Replay resolves a retrieved id back to — one copy, three views of it.
 */

function bytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

function ChunkRow({ chunk }: { chunk: CorpusChunk }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-md border theme-border">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-[10px]"
      >
        <ChevronRight size={10} className={`shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
        <span className="shrink-0 tabular-nums theme-text-muted">#{chunk.ordinal}</span>
        {chunk.page_number ? (
          <span className="shrink-0 theme-text-muted">p{chunk.page_number}</span>
        ) : null}
        {chunk.section_title && (
          <span className="min-w-0 flex-1 truncate theme-text-muted">{chunk.section_title}</span>
        )}
        <span className="ml-auto shrink-0 tabular-nums theme-text-muted">
          {chunk.token_estimate ? `~${chunk.token_estimate}t` : `${chunk.text.length}c`}
        </span>
        {/* A chunk with no vector is not in the index, so retrieval cannot
            return it however well it matches. Worth a mark of its own. */}
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
            chunk.embedded ? 'bg-emerald-400' : 'bg-amber-400'
          }`}
          title={chunk.embedded ? `embedded with ${chunk.embedding_model}` : 'no vector — not retrievable'}
        />
      </button>
      {open && (
        <div className="border-t theme-border px-2 py-1.5">
          <p className="whitespace-pre-wrap text-[10px] leading-relaxed theme-text opacity-85">
            {chunk.text}
          </p>
          <p className="mt-1.5 text-[10px] theme-text-muted">
            chars {chunk.char_start}–{chunk.char_end}
            {chunk.embed_error && <span className="text-rose-400"> · {chunk.embed_error}</span>}
          </p>
        </div>
      )}
    </div>
  )
}

export function CorpusView() {
  const [status, setStatus] = useState<CorpusStatus | null>(null)
  const [documents, setDocuments] = useState<CorpusDocument[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [chunks, setChunks] = useState<CorpusChunk[]>([])
  const [filter, setFilter] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void fetchCorpusStatus().then(setStatus).catch(() => setStatus(null))
    void fetchCorpusDocuments()
      .then((r) => setDocuments(r.documents))
      .catch((e: Error) => { setDocuments([]); setError(e.message) })
  }, [])

  const load = useCallback((id: string) => {
    setSelected(id)
    setChunks([])
    void fetchDocumentChunks(id, 500).then((r) => setChunks(r.chunks)).catch(() => setChunks([]))
  }, [])

  if (!documents || !status) return <Skeleton className="h-80 w-full" />

  const { corpus } = status
  const needle = filter.trim().toLowerCase()
  const visible = needle
    ? chunks.filter((c) => c.text.toLowerCase().includes(needle))
    : chunks

  if (documents.length === 0) {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-dashed theme-border px-4 py-8 text-center">
          <Database size={20} className="mx-auto theme-text-muted" />
          <p className="mt-2 text-xs theme-text">The corpus is empty.</p>
          <p className="mx-auto mt-1 max-w-md text-[11px] leading-relaxed theme-text-muted">
            Nothing has been ingested, so Track 1 has nothing to retrieve from and cannot answer a
            knowledge question. That is a state, not a failure — import documents in the
            <span className="theme-accent"> Build </span>
            tab and they appear here with their chunks.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 @2xl:grid-cols-4">
        {([
          ['Documents', corpus.documents, bytes(corpus.bytes)],
          ['Chunks', corpus.chunks, 'as the retriever sees them'],
          ['Vectors', corpus.embedded, corpus.chunks - corpus.embedded > 0
            ? `${corpus.chunks - corpus.embedded} not retrievable` : 'all retrievable'],
          ['Unreadable', corpus.failed_documents, 'failed extraction'],
        ] as const).map(([label, value, hint]) => (
          <div key={label} className="rounded-lg border theme-border theme-card px-3 py-2">
            <div className="text-lg tabular-nums theme-text">{value}</div>
            <div className="text-[10px] uppercase tracking-wider theme-text-muted">{label}</div>
            <div className="mt-0.5 text-[10px] theme-text-muted opacity-70">{hint}</div>
          </div>
        ))}
      </div>

      {error && (
        <p className="flex items-start gap-1.5 text-[11px] text-rose-400">
          <AlertCircle size={12} className="mt-0.5 shrink-0" /> {error}
        </p>
      )}

      <div className="grid gap-3 @3xl:grid-cols-[minmax(0,280px)_minmax(0,1fr)]">
        <div className="space-y-1.5">
          {documents.map((d) => (
            <button
              key={d.document_id}
              onClick={() => load(d.document_id)}
              className={`flex w-full items-start gap-2 rounded-lg border p-2.5 text-left transition-colors ${
                selected === d.document_id
                  ? 'theme-accent-border theme-surface-strong'
                  : 'theme-border theme-card hover:theme-surface'
              }`}
            >
              <FileText
                size={13}
                className={`mt-0.5 shrink-0 ${d.extract_status === 'failed' ? 'text-rose-400' : 'theme-accent'}`}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs theme-text">{d.filename}</span>
                <span className="mt-0.5 block text-[10px] theme-text-muted">
                  {d.source_type}
                  {d.document_version ? ` · v${d.document_version}` : ''}
                  {d.page_count ? ` · ${d.page_count}p` : ''}
                  {' · '}{d.chunk_count} chunks, {d.embedded_count} embedded
                </span>
              </span>
            </button>
          ))}
        </div>

        <div className="space-y-2">
          {!selected ? (
            <p className="rounded-lg border border-dashed theme-border px-4 py-6 text-center text-[11px] theme-text-muted">
              Choose a document to read its chunks exactly as the retriever stores them.
            </p>
          ) : (
            <>
              <label className="flex items-center gap-1.5 rounded-md border theme-border theme-surface px-2 py-1">
                <Search size={11} className="shrink-0 theme-text-muted" />
                <input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Find text within these chunks…"
                  className="min-w-0 flex-1 bg-transparent text-[11px] theme-text outline-none placeholder:opacity-50"
                />
                <span className="shrink-0 text-[10px] tabular-nums theme-text-muted">
                  {visible.length}/{chunks.length}
                </span>
              </label>
              <div className="max-h-[28rem] space-y-1 overflow-y-auto no-scrollbar">
                {visible.map((c) => <ChunkRow key={c.chunk_id} chunk={c} />)}
                {visible.length === 0 && (
                  <p className="py-3 text-center text-[10px] theme-text-muted">
                    {chunks.length === 0
                      ? 'This document has no chunks — it has been imported but never ingested.'
                      : `No chunk contains “${filter}”.`}
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
