import { useCallback, useEffect, useState } from 'react'
import { TabError } from '../errors/TabError'
import { toFailure, type LoadFailure } from '../errors/ErrorPage'
import { useLiveRefresh } from '../../hooks/useLiveRefresh'
import { FileText, Search, ChevronRight, Database, Trash2, AlertCircle } from 'lucide-react'
import {
  fetchCorpusStatus, fetchCorpusDocuments, fetchDocumentChunks, deleteDocument, updateDocument,
  type CorpusStatus, type CorpusDocument, type CorpusChunk,
} from '../../lib/blueprintsClient'
import { Skeleton } from '../ui/skeleton'
import { bytes, ORIGIN_BADGE, SOURCE_TYPES, SOURCE_LABEL } from './ingest/shared'
import { ThemeSelect } from '../ui/theme-select'
import { useConfirm } from '../ui/confirm-dialog'

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
 * ## Why there is no Coverage tab here
 *
 * Track 2 has one and Track 1 does not, and that asymmetry is a property of the
 * two approaches rather than an unfinished screen.
 *
 * A hand-authored graph fails by **omission**, and omission over a fixed schema
 * is *enumerable*: an `AnomalyType` with no `RESOLVED_BY` edge is a question the
 * graph provably cannot answer, and Coverage lists exactly those. A vector
 * corpus has no such list. It returns the top-k nearest chunks for *every*
 * query, including ones it knows nothing about — so its failure is a bad match
 * rather than a missing edge, and you cannot enumerate the passages that were
 * never written.
 *
 * What Track 1 *can* report is mechanical: documents that failed extraction,
 * chunks with no vector, documents imported but never ingested. Those are on
 * this tab as counts, because they are properties of the corpus rather than a
 * separate question about it. Giving them their own tab for symmetry would
 * imply an equivalence that does not hold, and that equivalence is one of the
 * more interesting things §5's comparison has to say.
 *
 * ## The chunk text is the point
 *
 * A citation is only checkable if you can read the passage it points at. This
 * shows the stored text, which is the same text that was embedded and the same
 * text Replay resolves a retrieved id back to — one copy, three views of it.
 */

function ChunkRow({ chunk }: { chunk: CorpusChunk }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-md border theme-border">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-[10px] transition-colors hover:theme-surface"
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
          title={chunk.embedded ? `embedded with ${chunk.embedding_model}` : "no vector yet, so it can't be retrieved"}
        />
        <span className="sr-only">{chunk.embedded ? 'embedded' : 'not embedded'}</span>
      </button>
      {open && (
        <div className="border-t theme-border px-2 py-1.5">
          <p className="whitespace-pre-wrap text-[11px] leading-relaxed theme-text opacity-85">
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

export function CorpusView({ onBuild }: { onBuild?: () => void }) {
  const [status, setStatus] = useState<CorpusStatus | null>(null)
  const [documents, setDocuments] = useState<CorpusDocument[] | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [chunks, setChunks] = useState<CorpusChunk[]>([])
  const [filter, setFilter] = useState('')
  const [error, setError] = useState<LoadFailure | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  // Narrowing the document list, for when there are more than fit on screen.
  const [docQuery, setDocQuery] = useState('')
  const [docType, setDocType] = useState('all')
  const [docOrigin, setDocOrigin] = useState('all')
  const [docState, setDocState] = useState('all')
  const [docSort, setDocSort] = useState('newest')
  const [confirm, confirmDialog] = useConfirm()

  const reload = useCallback(() => {
    void fetchCorpusStatus().then(setStatus).catch((e: unknown) => setError(toFailure(e)))
    void fetchCorpusDocuments()
      .then((r) => { setDocuments(r.documents); setError(null) })
      .catch((e: unknown) => setError(toFailure(e)))
  }, [])
  useEffect(reload, [reload])
  useLiveRefresh(['corpus'], reload)

  const load = useCallback((id: string) => {
    setSelected(id)
    setChunks([])
    // No chunks on failure would claim the document has none.
    void fetchDocumentChunks(id, 500).then((r) => setChunks(r.chunks)).catch((e: unknown) => setError(toFailure(e)))
  }, [])

  // Ingested documents are managed here (Build's Import list only shows what
  // still needs work), so this is where they are deleted and re-labelled.
  const removeDoc = async (d: CorpusDocument) => {
    const ok = await confirm({
      title: `Delete ${d.filename}?`,
      body: `This removes the document, its ${d.chunk_count} chunks and ${d.embedded_count} vectors. Track 1 can no longer find it. To get it back you'd have to import and ingest it again.`,
      confirmLabel: 'Delete document',
      danger: true,
    })
    if (!ok) return
    setActionError(null)
    try {
      await deleteDocument(d.document_id)
      setSelected(null)
      setChunks([])
    } catch (e) {
      setActionError((e as Error).message)
    }
    reload()
  }
  const flipOrigin = async (d: CorpusDocument) => {
    setActionError(null)
    try {
      await updateDocument(d.document_id, { origin: d.origin === 'rig' ? 'reference' : 'rig' })
    } catch (e) {
      setActionError((e as Error).message)
    }
    reload()
  }

  // The documents cannot be read: this tab is the error page.
  if (error) {
    return (
      <TabError
        code={error.status}
        detail={error.message}
        what="The corpus documents could not be read from the backend."
        onRetry={reload}
      />
    )
  }
  // Shaped like the page it stands in for (four tiles, then the two columns),
  // so nothing jumps when the data arrives.
  if (!documents || !status) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2 @2xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-[62px] w-full" />)}
        </div>
        <div className="grid gap-3 @3xl:grid-cols-[minmax(0,280px)_minmax(0,1fr)]">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    )
  }

  const { corpus } = status
  const docNeedle = docQuery.trim().toLowerCase()
  const stateOf = (d: CorpusDocument) =>
    d.extract_status === 'failed' ? 'failed'
    : d.chunk_count > 0 && d.embedded_count === d.chunk_count ? 'ready' : 'partial'
  const shownDocs = documents
    .filter((d) => !docNeedle || d.filename.toLowerCase().includes(docNeedle) || (d.title ?? '').toLowerCase().includes(docNeedle))
    .filter((d) => docType === 'all' || d.source_type === docType)
    .filter((d) => docOrigin === 'all' || (d.origin ?? 'reference') === docOrigin)
    .filter((d) => docState === 'all' || stateOf(d) === docState)
    .sort((a, b) =>
      docSort === 'name' ? a.filename.localeCompare(b.filename)
      : docSort === 'chunks' ? b.chunk_count - a.chunk_count
      : b.uploaded_at.localeCompare(a.uploaded_at))
  const filtering = !!docNeedle || docType !== 'all' || docOrigin !== 'all' || docState !== 'all'
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
            knowledge question. That's expected, not an error. Imported documents appear here
            with their chunks.
          </p>
          {onBuild && (
            <button
              onClick={onBuild}
              className="mt-3 inline-flex items-center gap-1.5 rounded-md border theme-accent-border px-3 py-1.5 text-[11px] theme-accent transition-colors hover:theme-surface-strong"
            >
              Import documents in Build <ChevronRight size={11} />
            </button>
          )}
        </div>
      </div>
    )
  }



  return (
    <div className="space-y-4">
      {confirmDialog}
      <div className="grid grid-cols-2 gap-2 @2xl:grid-cols-4">
        {([
          ['Documents', corpus.documents, bytes(corpus.bytes)],
          ['Chunks', corpus.chunks, 'as the retriever sees them'],
          ['Vectors', corpus.embedded, corpus.chunks - corpus.embedded > 0
            ? `${corpus.chunks - corpus.embedded} not retrievable` : 'all retrievable'],
          ['Unreadable', corpus.failed_documents, 'failed extraction'],
        ] as const).map(([label, value, hint]) => (
          <div key={label} className="rounded-lg border theme-border theme-card px-3 py-2">
            <div className={`text-lg tabular-nums ${label === 'Unreadable' && value > 0 ? 'text-rose-400' : 'theme-text'}`}>{value}</div>
            <div className="text-[10px] uppercase tracking-wider theme-text-muted">{label}</div>
            <div className="mt-0.5 text-[10px] theme-text-muted opacity-70">{hint}</div>
          </div>
        ))}
      </div>

      {/* Stated rather than left as a missing tab. The asymmetry with Track 2 is
          a finding about the two approaches, and §5's comparison has to say it
          somewhere — better here, where somebody is looking for it. */}
      <details className="group text-[11px] leading-relaxed theme-text-muted">
        <summary className="flex cursor-pointer list-none items-center gap-1 hover:theme-text">
          <ChevronRight size={11} className="transition-transform group-open:rotate-90" />
          Why is there no Coverage tab for Track 1?
        </summary>
        <p className="mt-1 pl-4">
        Track 2 has a Coverage tab and this arm does not, because the two fail differently. An
        authored graph fails by <span className="theme-text">omission</span>, and omission over a
        fixed schema can be listed out. An anomaly type with no procedure attached is a question it
        provably cannot answer. A vector corpus returns its nearest chunks for every query,
        including ones it knows nothing about, so its failure is a bad match rather than a missing
        edge and there is no list of the passages nobody wrote. The counts above are the part that
        <span className="theme-text"> is </span>
        checkable.
        </p>
      </details>

      <div className="grid gap-3 @3xl:grid-cols-[minmax(0,280px)_minmax(0,1fr)]">
        {/* Sticks while the chunks scroll, so the open document stays in view. */}
        <div className="space-y-1.5 @3xl:sticky @3xl:top-0 @3xl:self-start">
          <label className="flex items-center gap-1.5 rounded-md border theme-border theme-surface px-2 py-1">
            <Search size={11} className="shrink-0 theme-text-muted" />
            <input
              value={docQuery}
              onChange={(e) => setDocQuery(e.target.value)}
              aria-label="Find a document by name"
              placeholder="Find a document…"
              className="min-w-0 flex-1 bg-transparent text-[11px] theme-text outline-none placeholder:opacity-50"
            />
          </label>
          <div className="grid grid-cols-2 gap-1.5">
            <ThemeSelect
              size="sm" ariaLabel="Document type" value={docType} onChange={setDocType}
              options={[{ value: 'all', label: 'All types' }, ...SOURCE_TYPES.map((t) => ({ value: t.id, label: SOURCE_LABEL[t.id] }))]}
            />
            <ThemeSelect
              size="sm" ariaLabel="Whose document" value={docOrigin} onChange={setDocOrigin}
              options={[{ value: 'all', label: 'Any origin' }, { value: 'rig', label: 'This rig' }, { value: 'reference', label: 'Reference' }]}
            />
            <ThemeSelect
              size="sm" ariaLabel="Index status" value={docState} onChange={setDocState}
              options={[
                { value: 'all', label: 'Any status' }, { value: 'ready', label: 'Fully embedded' },
                { value: 'partial', label: 'Not all embedded' }, { value: 'failed', label: 'Unreadable' },
              ]}
            />
            <ThemeSelect
              size="sm" ariaLabel="Sort documents" value={docSort} onChange={setDocSort}
              options={[{ value: 'newest', label: 'Newest first' }, { value: 'name', label: 'Name A–Z' }, { value: 'chunks', label: 'Most chunks' }]}
            />
          </div>
          <p className="flex items-center gap-2 text-[10px] theme-text-muted">
            {shownDocs.length} of {documents.length} document{documents.length === 1 ? '' : 's'}
            {filtering && (
              <button
                onClick={() => { setDocQuery(''); setDocType('all'); setDocOrigin('all'); setDocState('all') }}
                className="theme-accent hover:underline"
              >
                Clear filters
              </button>
            )}
          </p>
          <div className="max-h-[28rem] space-y-1.5 overflow-y-auto no-scrollbar">
          {shownDocs.length === 0 && (
            <p className="py-3 text-center text-[11px] theme-text-muted">No document matches these filters.</p>
          )}
          {shownDocs.map((d) => (
            <button
              key={d.document_id}
              onClick={() => load(d.document_id)}
              aria-pressed={selected === d.document_id}
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
                  {d.document_version ? ` · ${d.document_version}` : ''}
                  {d.page_count ? ` · ${d.page_count}p` : ''}
                  {' · '}{d.chunk_count} chunks, {d.embedded_count} embedded
                </span>
              </span>
            </button>
          ))}
          </div>
        </div>

        <div className="space-y-2">
          {!selected ? (
            <p className="rounded-lg border border-dashed theme-border px-4 py-6 text-center text-[11px] theme-text-muted">
              Choose a document to read its chunks exactly as the retriever stores them.
            </p>
          ) : (
            <>
              {(() => {
                const doc = documents.find((d) => d.document_id === selected)
                if (!doc) return null
                return (
                  <div className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-xs theme-text">{doc.filename}</span>
                    <button
                      onClick={() => void flipOrigin(doc)}
                      title="Whose document this is. Click to change. Takes effect from the next question, no re-ingest needed."
                      className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] ${ORIGIN_BADGE[doc.origin ?? 'reference']}`}
                    >
                      {doc.origin === 'rig' ? 'This rig' : 'Reference'}
                    </button>
                    <button
                      onClick={() => void removeDoc(doc)}
                      aria-label={`Delete ${doc.filename}`}
                      title="Delete this document, its chunks and its vectors"
                      className="shrink-0 rounded-md p-1.5 theme-text-muted transition-colors hover:text-rose-400"
                    >
                      <Trash2 size={12} />
                    </button>
                  </div>
                )
              })()}
              {(() => {
                const doc = documents.find((d) => d.document_id === selected)
                return doc?.page_count ? (
                  <PageRanges key={doc.document_id} doc={doc} onSaved={reload} onError={setActionError} />
                ) : null
              })()}
              {actionError && (
                <p className="flex items-start gap-1.5 text-[11px] text-rose-400">
                  <AlertCircle size={12} className="mt-0.5 shrink-0" /> {actionError}
                </p>
              )}
              <label className="flex items-center gap-1.5 rounded-md border theme-border theme-surface px-2 py-1">
                <Search size={11} className="shrink-0 theme-text-muted" />
                <input
                  value={filter}
                  aria-label="Find text within these chunks"
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
                      ? 'This document has no chunks yet. It was imported but never ingested.'
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


/**
 * Which pages of a PDF to read. For a long manual that is mostly irrelevant
 * here, so its useful sections are ingested without the rest outnumbering the
 * corpus. Read at extraction, so it applies on the next re-ingest.
 */
function PageRanges({ doc, onSaved, onError }: {
  doc: CorpusDocument
  onSaved: () => void
  onError: (message: string | null) => void
}) {
  const [value, setValue] = useState(doc.page_ranges ?? '')
  const [saving, setSaving] = useState(false)
  const dirty = value.trim() !== (doc.page_ranges ?? '')
  const save = async () => {
    setSaving(true)
    onError(null)
    try {
      await updateDocument(doc.document_id, { page_ranges: value.trim() || null })
      onSaved()
    } catch (e) {
      onError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2 text-[11px] theme-text-muted">
      <span>Pages read</span>
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={`all ${doc.page_count}`}
        aria-label="Pages to read, like 11-12, 71-92"
        className="w-40 rounded-md border theme-border theme-surface px-2 py-0.5 theme-text outline-none placeholder:opacity-50"
      />
      <button
        onClick={() => void save()}
        disabled={!dirty || saving}
        className="rounded-md border theme-border px-2 py-0.5 theme-text disabled:opacity-40"
      >
        {saving ? 'Saving…' : 'Save'}
      </button>
      <span className="opacity-70">Applies on the next re-ingest.</span>
    </div>
  )
}
