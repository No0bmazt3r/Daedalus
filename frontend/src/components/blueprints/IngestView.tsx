import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Upload, FileText, Trash2, Play, RotateCcw, AlertCircle, AlertTriangle, Check,
  Loader2, Eraser, ChevronRight, Scissors, Cpu, Hammer, ArrowUpRight,
} from 'lucide-react'
import {
  fetchCorpusStatus, fetchCorpusDocuments, uploadDocument, deleteDocument,
  fetchCorpusConfig, saveCorpusConfig, previewChunks, startIngest, resumeIngest,
  clearVectors, fetchRun, fetchRunEvents,
  type CorpusStatus, type CorpusDocument, type CorpusConfig, type ChunkPreview,
  type IngestRun, type IngestEvent,
} from '../../lib/blueprintsClient'
import { fetchEmbeddingConfig, type EmbeddingConfig } from '../../lib/embeddingsClient'
import { Skeleton } from '../ui/skeleton'
import { StepRail, StepFooter, type Step } from '../ui/stepper'
import { ThemeSelect } from '../ui/theme-select'

/**
 * The ingestion pipeline, as the four steps it actually is — MODULES.md §3.1.
 *
 * This is the **Build** tab, Track 1's counterpart to Track 2's graph authoring:
 * each arm gets knowledge a different way, and this is Track 1's way. It used to
 * be the *Corpus* tab, which was a misnomer — the corpus is the artefact, and
 * this screen is the machinery that produces it. The artefact now has its own
 * tab, which is what that name is for.
 *
 * `architecture/04` Steps 1-6: import, chunk, embed, run. The first build put
 * all four on one page, which was wrong for a reason worth writing down: they
 * are **sequential and dependent**, not four independent panels. Chunk settings
 * mean nothing without a document to chunk; an embedding model cannot be checked
 * against an index that does not exist yet; a run is the consequence of the
 * three decisions above it. A page that shows all four at once shows three
 * things you cannot act on and gives no clue which one to touch first.
 *
 * So it is a stepper, and the steps gate:
 *
 * ```
 * 1 Import ──▶ 2 Chunk ──▶ 3 Embedding ──▶ 4 Run
 *   documents    boundaries   the model        writes
 * ```
 *
 * ## Going back is always allowed; going forward is not
 *
 * Every completed step stays clickable, because the whole point of adjusting
 * chunk settings is that you do it repeatedly while looking at the preview. What
 * is gated is *forward*: you cannot reach Run without documents, because a run
 * with nothing to ingest is a button that produces an error instead of a result.
 * The rail says why a step is not reachable rather than just disabling it.
 *
 * ## An empty corpus is the normal starting state
 *
 * Step 1 with nothing in it is not an error and does not say "no data". It is
 * where the pipeline begins, and the panel reads as an instruction rather than
 * as an empty table — MODULES.md §0 rule 4 is about explaining, and at this
 * point the explanation is "start here".
 *
 * ## Why the embedding model is a step and not a link
 *
 * It used to be reported here and chosen in the Forge. But it is the one
 * decision in this flow that is *irreversible with respect to the work*:
 * changing it after ingesting invalidates every vector, because vectors from two
 * models are not comparable. Making it a step you pass through before the run —
 * rather than a fact you notice afterwards — is what stops that being learned
 * the expensive way.
 */

const LEVEL_STYLE: Record<IngestEvent['level'], string> = {
  debug: 'theme-text-muted opacity-60',
  info: 'theme-text-muted',
  warn: 'text-amber-400',
  error: 'text-rose-400',
}

const SOURCE_TYPES = [
  { id: 'manual', label: 'Manual' },
  { id: 'sop', label: 'SOP' },
  { id: 'anomaly_record', label: 'Anomaly record' },
  { id: 'uauc_record', label: 'UAUC record' },
  { id: 'other', label: 'Other' },
]

const STEPS: readonly Step[] = [
  { id: 1, label: 'Import', icon: Upload, hint: 'Add the documents to index' },
  { id: 2, label: 'Chunk', icon: Scissors, hint: 'Decide where they get split' },
  { id: 3, label: 'Embedding', icon: Cpu, hint: 'Choose the model that turns chunks into vectors' },
  { id: 4, label: 'Run', icon: Play, hint: 'Ingest, and watch it happen' },
]

function bytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

/**
 * The four stages, as circles joined by a track that fills as you advance.
 *
 * ## Why a filling connector rather than four buttons
 *
 * The buttons said "these are four places you can go". They are not — they are
 * one process with an order, and the order is the thing a first-time reader most
 * needs to see. A connector that fills between 1 and 2 says *2 comes after 1 and
 * you have crossed it*, which is a claim four separate boxes cannot make however
 * they are styled.
 *
 * ## The animation carries direction, and only one segment moves
 *
 * The fill is a `scaleX` from the left, so going forward it grows toward the
 * next step and going back it drains toward the previous one — the motion
 * matches the travel rather than just marking a state change. The travelling
 * highlight is on the segment being crossed *only*: a row where every connector
 * shimmers reads as "loading", not as "you are here".
 *
 * Under `prefers-reduced-motion` the fill still lands in the right place and
 * only the travel is dropped. Progress is information; the motion carrying it
 * is decoration, and the two must not fail together.
 */
// ── step 1 ───────────────────────────────────────────────────────────────────

function ImportStep({
  documents, extraction, onChange, onDelete,
}: {
  documents: CorpusDocument[]
  extraction: CorpusStatus['extraction']
  onChange: () => void
  onDelete: (id: string) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  const [sourceType, setSourceType] = useState('manual')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)

  const send = useCallback(
    async (files: FileList | File[]) => {
      setBusy(true)
      setError(null)
      const problems: string[] = []
      for (const file of Array.from(files)) {
        try {
          await uploadDocument(file, { source_type: sourceType })
        } catch (e) {
          problems.push(`${file.name}: ${(e as Error).message}`)
        }
      }
      setBusy(false)
      setError(problems.length ? problems.join(' · ') : null)
      onChange()
    },
    [onChange, sourceType],
  )

  return (
    <div className="space-y-3">
      <p className="text-[11px] leading-relaxed theme-text-muted">
        The documents Track 1 will retrieve from — manuals, SOPs, anomaly and UAUC records. Text is
        extracted on upload, so a file that cannot be read is refused now rather than at the run.
      </p>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-wider theme-text-muted">Import as</span>
        {SOURCE_TYPES.map((t) => (
          <button
            key={t.id}
            onClick={() => setSourceType(t.id)}
            className={`rounded-md border px-2 py-0.5 text-[11px] transition-colors ${
              sourceType === t.id
                ? 'theme-accent-border theme-surface-strong theme-text'
                : 'theme-border theme-text-muted hover:theme-text'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          if (e.dataTransfer.files.length) void send(e.dataTransfer.files)
        }}
        onClick={() => input.current?.click()}
        className={`flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed px-4 py-8 text-center transition-colors ${
          dragging ? 'theme-accent-border theme-surface-strong' : 'theme-border hover:theme-surface'
        }`}
      >
        {busy ? (
          <Loader2 size={20} className="animate-spin theme-accent" />
        ) : (
          <Upload size={20} className="theme-text-muted" />
        )}
        <p className="text-xs theme-text">
          {busy ? 'Uploading and extracting…' : 'Drop documents here, or click to choose'}
        </p>
        <p className="text-[10px] theme-text-muted">
          {extraction.extensions.join('  ')}
          {!extraction.pdf_available && ' — PDF needs pypdf, see below'}
        </p>
        <input
          ref={input}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => { if (e.target.files?.length) void send(e.target.files) }}
        />
      </div>

      {!extraction.pdf_available && (
        <p className="flex items-start gap-1.5 text-[10px] leading-relaxed text-amber-400">
          <AlertTriangle size={11} className="mt-0.5 shrink-0" />
          {extraction.pdf_detail}
        </p>
      )}

      {error && (
        <p className="flex items-start gap-1.5 text-[11px] text-rose-400">
          <AlertCircle size={12} className="mt-0.5 shrink-0" /> {error}
        </p>
      )}

      {documents.length === 0 ? (
        <p className="rounded-lg border border-dashed theme-border px-4 py-5 text-center text-[11px] leading-relaxed theme-text-muted">
          Nothing imported yet. This is where the pipeline starts — the corpus being empty is a
          state, not a failure, and Track 1 stays unable to answer until something lands here.
        </p>
      ) : (
        <div className="space-y-1.5">
          {documents.map((d) => (
            <div
              key={d.document_id}
              className="flex items-start gap-2 rounded-lg border theme-border theme-card p-2.5"
            >
              <FileText
                size={13}
                className={`mt-0.5 shrink-0 ${d.extract_status === 'failed' ? 'text-rose-400' : 'theme-accent'}`}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-xs theme-text">{d.filename}</p>
                <p className="mt-0.5 text-[10px] theme-text-muted">
                  {d.source_type} · {bytes(d.size_bytes)}
                  {d.page_count ? ` · ${d.page_count}p` : ''}
                  {d.char_count ? ` · ${d.char_count.toLocaleString()} chars` : ''}
                  {d.chunk_count > 0 && ` · ${d.chunk_count} chunks, ${d.embedded_count} embedded`}
                </p>
                {d.extract_status === 'failed' && (
                  <p className="mt-1 text-[10px] leading-relaxed text-rose-400">{d.extract_error}</p>
                )}
              </div>
              <button
                onClick={() => onDelete(d.document_id)}
                title="Delete this document, its chunks and its vectors"
                className="shrink-0 rounded-md p-1 theme-text-muted transition-colors hover:text-rose-400"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── step 2 ───────────────────────────────────────────────────────────────────

function ChunkStep({
  config, documents, onSaved,
}: {
  config: CorpusConfig
  documents: CorpusDocument[]
  onSaved: () => void
}) {
  const readable = documents.filter((d) => d.extract_status === 'ok')
  const [subject, setSubject] = useState<string | null>(readable[0]?.document_id ?? null)
  const [draft, setDraft] = useState({
    strategy: config.strategy,
    chunk_size: config.chunk_size,
    chunk_overlap: config.chunk_overlap,
  })
  // Tagged with the document it describes, so a preview for the *previous*
  // selection cannot render against the current one. That pairing is also what
  // removes the need to null it synchronously when the subject changes — which
  // was a setState inside an effect, i.e. a render published purely to be
  // corrected on the next one.
  const [preview, setPreview] = useState<{ subject: string; data: ChunkPreview } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const dirty =
    draft.strategy !== config.strategy ||
    draft.chunk_size !== config.chunk_size ||
    draft.chunk_overlap !== config.chunk_overlap

  useEffect(() => {
    if (!subject) return
    // Debounced: the slider fires per pixel and each preview parses the whole
    // document on the server.
    const timer = window.setTimeout(() => {
      previewChunks(subject, draft)
        .then((p) => { setPreview({ subject, data: p }); setError(null) })
        .catch((e: Error) => setError(e.message))
    }, 300)
    return () => window.clearTimeout(timer)
  }, [subject, draft])

  const shown = preview?.subject === subject ? preview.data : null

  const save = async () => {
    setSaving(true)
    try {
      await saveCorpusConfig(draft)
      setError(null)
      onSaved()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-[11px] leading-relaxed theme-text-muted">
        Where documents get split. This is the setting with the largest effect on retrieval and the
        hardest to judge from a number, so the preview runs the real chunker over a real document
        and writes nothing.
      </p>

      <div className="grid gap-3 @2xl:grid-cols-2">
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {config.strategies.map((s) => (
              <button
                key={s.id}
                onClick={() => setDraft((d) => ({ ...d, strategy: s.id }))}
                className={`rounded-md border px-2 py-0.5 text-[11px] transition-colors ${
                  draft.strategy === s.id
                    ? 'theme-accent-border theme-surface-strong theme-text'
                    : 'theme-border theme-text-muted hover:theme-text'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
          <p className="text-[10px] leading-relaxed theme-text-muted">
            {config.strategies.find((s) => s.id === draft.strategy)?.hint}
          </p>

          {([
            ['chunk_size', 'Size', config.bounds.chunk_size.min, config.bounds.chunk_size.max, 50],
            ['chunk_overlap', 'Overlap', 0, Math.max(0, draft.chunk_size - 50), 10],
          ] as const).map(([key, label, min, max, step]) => (
            <label key={key} className="block">
              <span className="flex items-center justify-between text-[11px] theme-text-muted">
                {label}
                <span className="tabular-nums theme-text">
                  {draft[key]} chars ≈ {Math.round(draft[key] / 4)} tokens
                </span>
              </span>
              <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={draft[key]}
                onChange={(e) => setDraft((d) => ({ ...d, [key]: Number(e.target.value) }))}
                className="mt-1 w-full accent-[var(--primary)]"
              />
            </label>
          ))}

          <button
            onClick={save}
            disabled={!dirty || saving}
            className="w-full rounded-md border theme-accent-border px-2 py-1 text-[11px] theme-accent transition-colors hover:theme-surface-strong disabled:opacity-40"
          >
            {saving ? 'Saving…' : dirty ? 'Save these settings' : 'Saved'}
          </button>
          <p className="text-[10px] leading-relaxed theme-text-muted">
            Saving does not re-chunk. Anything already ingested keeps the boundaries it was
            ingested with — the run in step 4 is what applies a change.
          </p>
        </div>

        <div className="space-y-2">
          {readable.length > 1 && (
            <ThemeSelect
              size="sm"
              ariaLabel="Document to preview"
              value={subject ?? ''}
              onChange={setSubject}
              options={readable.map((d) => ({ value: d.document_id, label: d.filename }))}
            />
          )}

          {error && (
            <p className="flex items-start gap-1.5 text-[10px] leading-relaxed text-rose-400">
              <AlertCircle size={11} className="mt-0.5 shrink-0" /> {error}
            </p>
          )}

          {shown && (
            <>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[10px] theme-text-muted">
                <span className="text-xs tabular-nums theme-text">{shown.total_chunks} chunks</span>
                <span className="tabular-nums">min {shown.size_min}</span>
                <span className="tabular-nums">avg {shown.size_avg}</span>
                <span className="tabular-nums">max {shown.size_max}</span>
                <span className="tabular-nums">~{shown.token_estimate_total.toLocaleString()} tokens</span>
              </div>
              <div className="max-h-72 space-y-1 overflow-y-auto no-scrollbar">
                {shown.chunks.map((c) => (
                  <div key={c.ordinal} className="rounded-md border theme-border px-2 py-1">
                    <div className="flex items-center gap-1.5 text-[10px] theme-text-muted">
                      <span className="tabular-nums">#{c.ordinal}</span>
                      {c.page_number ? <span>p{c.page_number}</span> : null}
                      {c.section_title && <span className="truncate">{c.section_title}</span>}
                      <span className="ml-auto shrink-0 tabular-nums">{c.text.length}</span>
                    </div>
                    <p className="mt-0.5 line-clamp-3 text-[10px] leading-relaxed theme-text opacity-80">
                      {c.text}
                    </p>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── step 3 ───────────────────────────────────────────────────────────────────

/**
 * Which model will embed, and whether it can — a readiness gate, not a manager.
 *
 * This step used to list every embedding model with its own Pull buttons, which
 * was a second model console sitting inside the corpus panel. The Forge already
 * is the model console: it owns pulling, quantization, hardware fit and the
 * embedding pane, and two surfaces doing the same job drift until one of them is
 * subtly wrong about what is installed.
 *
 * So this reports and hands off. What belongs *here* is the question the
 * pipeline needs answered — "can the run embed, and with what" — and the
 * consequence of the answer, which is specific to ingestion: the model is
 * stamped onto the index it builds, and changing it later invalidates every
 * vector. What belongs in the Forge is everything about the model as a model.
 *
 * The handoff opens the Forge rather than linking to it in prose, because a
 * sentence telling somebody where to go is a worse version of a button that
 * takes them there.
 */
function EmbeddingStep({ onOpenForge }: { onOpenForge?: () => void }) {
  const [config, setConfig] = useState<EmbeddingConfig | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(() => {
    fetchEmbeddingConfig().then(setConfig).catch((e: Error) => setError(e.message))
  }, [])
  useEffect(() => { load() }, [load])

  if (error && !config) {
    return (
      <p className="flex items-start gap-1.5 text-[11px] text-rose-400">
        <AlertCircle size={12} className="mt-0.5 shrink-0" /> {error}
      </p>
    )
  }
  if (!config) return <Skeleton className="h-48 w-full" />

  const chosen = (config.model || '').trim()
  const selected = config.local_models.find((m) => m.tag === chosen)
  const installed = !!selected?.installed
  // Three distinct blockers, reported as three distinct sentences below. "No
  // model chosen" is the first one and used to be invisible, because the config
  // shipped with a model already named.
  const blocked = !chosen || !config.ollama_available || !installed

  return (
    <div className="space-y-3">
      <p className="text-[11px] leading-relaxed theme-text-muted">
        The model that turns chunks into vectors. Not the chat model, and the one choice in this
        flow that cannot be changed cheaply afterwards: it is stamped onto the index it builds, and
        vectors from two models are not comparable — so changing it later means re-embedding
        everything.
      </p>

      <div
        className={`rounded-lg border p-3 ${
          blocked ? 'border-amber-400/40 bg-amber-400/10' : 'theme-accent-border theme-surface-strong'
        }`}
      >
        <div className="flex items-start gap-2">
          {blocked ? (
            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-400" />
          ) : (
            <Check size={14} className="mt-0.5 shrink-0 theme-accent" />
          )}
          <div className="min-w-0 flex-1">
            {!chosen ? (
              <>
                <p className="text-xs theme-text">No embedding model selected</p>
                <p className="mt-0.5 text-[10px] leading-relaxed theme-text-muted">
                  Nothing is chosen, and nothing is assumed. The model is stamped onto the index
                  it builds and changing it afterwards invalidates every vector, so this is picked
                  rather than defaulted — the run is blocked until it is.
                </p>
              </>
            ) : (
              <>
                <p className="text-xs theme-text">
                  {selected?.label ?? chosen}
                  <span className="ml-1.5 text-[10px] theme-text-muted">
                    <code>{chosen}</code>
                  </span>
                </p>
                <p className="mt-0.5 text-[10px] theme-text-muted">
                  {config.dimensions
                    ? `${config.dimensions}d (${config.dimensions_source})`
                    : 'width unknown'}
                  {' · '}
                  {!config.ollama_available
                    ? 'Ollama unreachable'
                    : installed
                      ? 'pulled and ready'
                      : 'not pulled — the run will chunk, then fail every embed batch'}
                  {!config.production_safe && ' · cloud baseline, not production-safe'}
                </p>
              </>
            )}
          </div>
        </div>
      </div>

      <dl className="grid gap-2 @2xl:grid-cols-2">
        {([
          ['Index it builds', config.collection || 'none until a model is chosen'],
          ['Index state', config.index_detail],
        ] as const).map(([k, v]) => (
          <div key={k} className="rounded-lg border theme-border theme-card p-2.5">
            <dt className="text-[10px] uppercase tracking-wider theme-text-muted">{k}</dt>
            <dd className="mt-0.5 break-words text-[11px] leading-relaxed theme-text">{v}</dd>
          </div>
        ))}
      </dl>

      {/* The handoff. One place manages models, and it is not this one. */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border theme-border theme-card p-2.5">
        <Cpu size={13} className="shrink-0 theme-text-muted" />
        <p className="min-w-0 flex-1 text-[11px] leading-relaxed theme-text-muted">
          Pulling a model, switching to a different one, or checking what it costs on this hardware
          is the Forge's job — this step only reports what the run will use.
        </p>
        {onOpenForge && (
          <button
            onClick={onOpenForge}
            className="flex shrink-0 items-center gap-1.5 rounded-md border theme-accent-border px-2.5 py-1 text-[11px] theme-accent transition-colors hover:theme-surface-strong"
          >
            <Hammer size={11} /> Open the Forge
            <ArrowUpRight size={11} />
          </button>
        )}
      </div>

      <button
        onClick={load}
        className="flex items-center gap-1.5 rounded-md border theme-border px-2 py-1 text-[11px] theme-text-muted transition-colors hover:theme-text"
      >
        <RotateCcw size={11} /> Re-check
      </button>
    </div>
  )
}

// ── step 4 ───────────────────────────────────────────────────────────────────

function RunPanel({ run, onRefresh }: { run: IngestRun; onRefresh: () => void }) {
  const [events, setEvents] = useState<IngestEvent[]>([])
  const [level, setLevel] = useState<string>('')
  const [open, setOpen] = useState(true)
  const live = run.status === 'running'

  useEffect(() => {
    let cancelled = false
    const load = () => {
      fetchRunEvents(run.run_id, level || undefined)
        .then((r) => !cancelled && setEvents(r.events))
        .catch(() => !cancelled && setEvents([]))
    }
    load()
    if (!live) return () => { cancelled = true }
    const timer = window.setInterval(() => { load(); onRefresh() }, 1500)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [run.run_id, run.status, level, live, onRefresh])

  const tone =
    run.status === 'ok' ? 'theme-accent'
    : run.status === 'failed' ? 'text-rose-400'
    : 'text-amber-400'

  return (
    <div className="rounded-lg border theme-border theme-card">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-3 py-2 text-left">
        <ChevronRight size={12} className={`shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
        {live && <Loader2 size={12} className="shrink-0 animate-spin text-amber-400" />}
        <span className="min-w-0 flex-1 truncate text-[11px] theme-text">
          <span className={tone}>{run.status}</span>
          <span className="theme-text-muted">
            {' · '}{run.kind} · {run.documents_done}/{run.documents_total} docs ·{' '}
            {run.chunks_written} chunks · {run.vectors_written} vectors
          </span>
        </span>
        <span className="shrink-0 text-[10px] theme-text-muted">
          {run.elapsed_ms != null ? `${(run.elapsed_ms / 1000).toFixed(1)}s` : run.stage}
        </span>
      </button>

      {open && (
        <div className="border-t theme-border px-3 py-2">
          <div className="mb-1.5 flex flex-wrap items-center gap-1.5 text-[10px]">
            <span className="theme-text-muted">
              {run.strategy} · {run.chunk_size}/{run.chunk_overlap} · {run.embedding_model ?? 'no model'}
            </span>
            <span className="ml-auto flex gap-1">
              {['', 'error', 'warn', 'info', 'debug'].map((l) => (
                <button
                  key={l || 'all'}
                  onClick={() => setLevel(l)}
                  className={`rounded px-1.5 py-0.5 transition-colors ${
                    level === l ? 'theme-surface-strong theme-text' : 'theme-text-muted hover:theme-text'
                  }`}
                >
                  {l || 'all'}
                </button>
              ))}
            </span>
          </div>
          {run.error && <p className="mb-1.5 text-[10px] leading-relaxed text-rose-400">{run.error}</p>}
          <div className="max-h-60 space-y-0.5 overflow-y-auto no-scrollbar font-mono text-[10px]">
            {events.length === 0 ? (
              <p className="py-2 theme-text-muted">No events at this level.</p>
            ) : (
              events.map((e) => (
                <div key={e.id} className="flex gap-2">
                  <span className={`w-9 shrink-0 ${LEVEL_STYLE[e.level]}`}>{e.level}</span>
                  <span className="w-14 shrink-0 theme-text-muted opacity-60">{e.stage}</span>
                  <span className={`min-w-0 flex-1 ${LEVEL_STYLE[e.level]}`}>{e.message}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function RunStep({
  status, config, documents, activeRun, busy, error, onAct, onRefresh,
}: {
  status: CorpusStatus
  config: CorpusConfig
  documents: CorpusDocument[]
  activeRun: IngestRun | null
  busy: string | null
  error: string | null
  onAct: (label: string, fn: () => Promise<unknown>) => void
  onRefresh: () => void
}) {
  const { corpus, embedding } = status
  const pending = corpus.chunks - corpus.embedded
  const readable = documents.filter((d) => d.extract_status === 'ok').length

  return (
    <div className="space-y-3">
      {/* The recipe, restated before it runs. Everything on this line is copied
          onto the run row, so a result stays traceable to the settings that
          produced it even after the defaults change. */}
      <div className="rounded-lg border theme-border theme-card p-3">
        <h4 className="text-xs theme-text">What will run</h4>
        <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] @xl:grid-cols-4">
          {([
            ['Documents', `${readable} readable`],
            ['Chunking', `${config.strategy} ${config.chunk_size}/${config.chunk_overlap}`],
            ['Embedding', embedding.model ?? 'none selected'],
            ['Index', embedding.collection ?? '—'],
          ] as const).map(([k, v]) => (
            <div key={k}>
              <dt className="text-[10px] uppercase tracking-wider theme-text-muted">{k}</dt>
              <dd className="truncate theme-text">{v}</dd>
            </div>
          ))}
        </dl>
      </div>

      {!embedding.ollama_available && (
        <p className="flex items-start gap-1.5 rounded-lg border border-amber-400/40 bg-amber-400/10 p-2.5 text-[11px] theme-text">
          <AlertTriangle size={12} className="mt-0.5 shrink-0 text-amber-400" />
          Ollama is unreachable. The run will chunk and write, then fail every embed batch — which
          is recoverable with Resume, but pulling the model first is cheaper.
        </p>
      )}

      <div className="grid grid-cols-2 gap-2 @2xl:grid-cols-4">
        {([
          ['Documents', corpus.documents, bytes(corpus.bytes)],
          ['Chunks', corpus.chunks, ''],
          ['Vectors', corpus.embedded, pending > 0 ? `${pending} pending` : ''],
          ['Failed', corpus.failed_documents, 'unreadable'],
        ] as const).map(([label, value, hint]) => (
          <div key={label} className="rounded-lg border theme-border theme-card px-3 py-2">
            <div className="text-lg tabular-nums theme-text">{value}</div>
            <div className="text-[10px] uppercase tracking-wider theme-text-muted">{label}</div>
            {hint && <div className="mt-0.5 text-[10px] theme-text-muted opacity-70">{hint}</div>}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-1.5">
        <button
          onClick={() => onAct('ingest', () => startIngest())}
          disabled={!!busy || readable === 0}
          className="flex items-center gap-1.5 rounded-md border theme-accent-border px-2.5 py-1 text-[11px] theme-accent transition-colors hover:theme-surface-strong disabled:opacity-40"
        >
          <Play size={11} /> {busy === 'ingest' ? 'Starting…' : corpus.chunks ? 'Re-ingest all' : 'Ingest'}
        </button>
        <button
          onClick={() => onAct('resume', () => resumeIngest())}
          disabled={!!busy || pending === 0}
          title="Embed the chunks that have no vector, without re-chunking"
          className="flex items-center gap-1.5 rounded-md border theme-border px-2.5 py-1 text-[11px] theme-text-muted transition-colors hover:theme-text disabled:opacity-40"
        >
          <RotateCcw size={11} /> {busy === 'resume' ? 'Embedding…' : `Resume (${pending})`}
        </button>
        <button
          onClick={() => onAct('clear', () => clearVectors())}
          disabled={!!busy || corpus.embedded === 0}
          title="Drop every vector, keep every chunk — what an embedding-model change needs"
          className="flex items-center gap-1.5 rounded-md border theme-border px-2.5 py-1 text-[11px] theme-text-muted transition-colors hover:text-rose-400 disabled:opacity-40"
        >
          <Eraser size={11} /> Clear vectors
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-rose-400/40 bg-rose-400/10 p-2.5 text-[11px] theme-text">
          <AlertCircle size={13} className="mt-0.5 shrink-0 text-rose-400" /> {error}
        </div>
      )}

      {activeRun && <RunPanel run={activeRun} onRefresh={onRefresh} />}

      {status.runs.filter((r) => r.run_id !== activeRun?.run_id).length > 0 && (
        <div className="space-y-1.5">
          <h4 className="text-xs theme-text">Earlier runs</h4>
          {status.runs
            .filter((r) => r.run_id !== activeRun?.run_id)
            .slice(0, 5)
            .map((r) => <RunPanel key={r.run_id} run={r} onRefresh={onRefresh} />)}
        </div>
      )}
    </div>
  )
}

// ── the stepper ──────────────────────────────────────────────────────────────

export function IngestView({ onOpenForge }: { onOpenForge?: () => void }) {
  const [status, setStatus] = useState<CorpusStatus | null>(null)
  const [documents, setDocuments] = useState<CorpusDocument[]>([])
  const [config, setConfig] = useState<CorpusConfig | null>(null)
  const [step, setStep] = useState(1)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeRun, setActiveRun] = useState<IngestRun | null>(null)

  const refresh = useCallback(() => {
    void fetchCorpusStatus().then(setStatus).catch(() => setStatus(null))
    void fetchCorpusDocuments().then((r) => setDocuments(r.documents)).catch(() => setDocuments([]))
    void fetchCorpusConfig().then(setConfig).catch(() => setConfig(null))
  }, [])

  useEffect(() => { refresh() }, [refresh])

  // A run is a server-side job that outlives this component, so on mount we
  // adopt whatever is already going — and jump to the step that shows it,
  // because a pipeline halfway through a corpus is the thing you opened to see.
  useEffect(() => {
    if (!status?.active_run || activeRun?.run_id === status.active_run) return
    void fetchRun(status.active_run)
      .then((r) => { setActiveRun(r.run); setStep(4) })
      .catch(() => {})
  }, [status?.active_run, activeRun?.run_id])

  const act = useCallback(
    async (label: string, fn: () => Promise<unknown>) => {
      setBusy(label)
      setError(null)
      try {
        const result = (await fn()) as { run?: IngestRun }
        if (result?.run) setActiveRun(result.run)
      } catch (e) {
        setError((e as Error).message)
      } finally {
        setBusy(null)
        refresh()
      }
    },
    [refresh],
  )

  if (!status || !config) return <Skeleton className="h-96 w-full" />

  const readable = documents.filter((d) => d.extract_status === 'ok').length
  // One sentence per step saying why it is not reachable yet — a disabled
  // control that does not say why is a dead end with a cursor change.
  const noDocs = readable === 0 ? 'Import a readable document first' : undefined
  const blocked: Record<number, string | undefined> = { 1: undefined, 2: noDocs, 3: noDocs, 4: noDocs }

  return (
    <div className="space-y-4">
      <StepRail steps={STEPS} step={step} setStep={setStep} blocked={blocked} />

      <div>
        <h3 className="text-sm theme-text">{STEPS[step - 1].label}</h3>
        <p className="text-[11px] theme-text-muted">{STEPS[step - 1].hint}</p>
      </div>

      {step === 1 && (
        <ImportStep
          documents={documents}
          extraction={status.extraction}
          onChange={refresh}
          onDelete={(id) => act('delete', () => deleteDocument(id))}
        />
      )}
      {step === 2 && <ChunkStep config={config} documents={documents} onSaved={refresh} />}
      {step === 3 && <EmbeddingStep onOpenForge={onOpenForge} />}
      {step === 4 && (
        <RunStep
          status={status}
          config={config}
          documents={documents}
          activeRun={activeRun}
          busy={busy}
          error={error}
          onAct={act}
          onRefresh={() => {
            if (activeRun) {
              void fetchRun(activeRun.run_id).then((r) => setActiveRun(r.run)).catch(() => {})
            }
            refresh()
          }}
        />
      )}

      <StepFooter steps={STEPS} step={step} setStep={setStep} nextBlocked={blocked[step + 1]} />

    </div>
  )
}
