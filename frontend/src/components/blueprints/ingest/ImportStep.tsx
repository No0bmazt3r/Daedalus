import { useCallback, useRef, useState } from 'react'
import { Upload, FileText, Trash2, AlertCircle, AlertTriangle, Loader2 } from 'lucide-react'
import {
  uploadDocument, updateDocument, type CorpusStatus, type CorpusDocument, type DocumentOrigin,
} from '../../../lib/blueprintsClient'
import { SOURCE_TYPES, SOURCE_LABEL, ORIGINS, ORIGIN_BADGE, bytes, isIngested } from './shared'
import { useConfirm } from '../../ui/confirm-dialog'

export function ImportStep({
  documents: all, extraction, onChange, onDelete, onShowCorpus,
}: {
  documents: CorpusDocument[]
  extraction: CorpusStatus['extraction']
  onChange: () => void
  onDelete: (id: string) => void
  onShowCorpus?: () => void
}) {
  // Only what still needs work is listed here: new, half-embedded or
  // unreadable. Once a document is ingested it is managed from Corpus.
  const documents = all.filter((d) => !isIngested(d))
  const ingestedCount = all.length - documents.length
  const input = useRef<HTMLInputElement>(null)
  const [sourceType, setSourceType] = useState('manual')
  const [origin, setOrigin] = useState<DocumentOrigin>('reference')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirm, confirmDialog] = useConfirm()

  const remove = async (d: CorpusDocument) => {
    const ok = await confirm({
      title: `Delete ${d.filename}?`,
      body: `This removes the document${d.chunk_count ? `, its ${d.chunk_count} chunks and ${d.embedded_count} vectors` : ''}. To get it back you'd have to import and ingest it again.`,
      confirmLabel: 'Delete document',
      danger: true,
    })
    if (ok) onDelete(d.document_id)
  }
  const [dragging, setDragging] = useState(false)

  const send = useCallback(
    async (files: FileList | File[]) => {
      setBusy(true)
      setError(null)
      const problems: string[] = []
      for (const file of Array.from(files)) {
        try {
          await uploadDocument(file, { source_type: sourceType, origin })
        } catch (e) {
          problems.push(`${file.name}: ${(e as Error).message}`)
        }
      }
      setBusy(false)
      setError(problems.length ? problems.join(' · ') : null)
      onChange()
    },
    [onChange, sourceType, origin],
  )

  const flip = async (d: CorpusDocument) => {
    setError(null)
    try {
      await updateDocument(d.document_id, { origin: d.origin === 'rig' ? 'reference' : 'rig' })
      onChange()
    } catch (e) {
      setError(`${d.filename}: ${(e as Error).message}`)
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-[11px] leading-relaxed theme-text-muted">
        The documents Track 1 searches: manuals, SOPs, troubleshooting and safety guides. Text is
        pulled out on upload, so a file that can't be read is rejected right away instead of failing later.
      </p>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-wider theme-text-muted">Import as</span>
        {SOURCE_TYPES.map((t) => (
          <button
            key={t.id}
            onClick={() => setSourceType(t.id)}
            aria-pressed={sourceType === t.id}
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

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-[10px] uppercase tracking-wider theme-text-muted">Whose</span>
        {ORIGINS.map((o) => (
          <button
            key={o.id}
            onClick={() => setOrigin(o.id)}
            aria-pressed={origin === o.id}
            title={o.hint}
            className={`rounded-md border px-2 py-0.5 text-[11px] transition-colors ${
              origin === o.id
                ? 'theme-accent-border theme-surface-strong theme-text'
                : 'theme-border theme-text-muted hover:theme-text'
            }`}
          >
            {o.label}
          </button>
        ))}
        <span className="text-[10px] theme-text-muted">
          {ORIGINS.find((o) => o.id === origin)?.hint}
        </span>
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
          {!extraction.pdf_available && ' (PDF needs pypdf, see below)'}
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

      {ingestedCount > 0 && (
        <p className="flex items-center gap-2 text-[11px] theme-text-muted">
          {ingestedCount} ingested document{ingestedCount === 1 ? ' is' : 's are'} in Corpus.
          {onShowCorpus && (
            <button onClick={onShowCorpus} className="theme-accent hover:underline">
              View in Corpus
            </button>
          )}
        </p>
      )}

      {documents.length === 0 && ingestedCount > 0 ? null : documents.length === 0 ? (
        <p className="rounded-lg border border-dashed theme-border px-4 py-5 text-center text-[11px] leading-relaxed theme-text-muted">
          Nothing imported yet. This is where the pipeline starts. An empty corpus is
          expected, but Track 1 can't answer anything until you add documents here.
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
                <p className="flex items-center gap-1.5 text-xs theme-text">
                  <span className="truncate">{d.filename}</span>
                  <button
                    onClick={() => void flip(d)}
                    title={`${d.origin === 'rig' ? "From this lab" : "From another installation"}. Click to change. Takes effect from the next question, no re-ingest needed.`}
                    className={`shrink-0 rounded border px-1.5 py-px text-[10px] ${ORIGIN_BADGE[d.origin ?? 'reference']}`}
                  >
                    {d.origin === 'rig' ? 'This rig' : 'Reference'}
                  </button>
                </p>
                <p className="mt-0.5 text-[10px] theme-text-muted">
                  {SOURCE_LABEL[d.source_type] ?? d.source_type} · {bytes(d.size_bytes)}
                  {d.page_count ? ` · ${d.page_count}p` : ''}
                  {d.char_count ? ` · ${d.char_count.toLocaleString()} chars` : ''}
                  {d.chunk_count > 0 && ` · ${d.chunk_count} chunks, ${d.embedded_count} embedded`}
                </p>
                {d.extract_status === 'failed' && (
                  <p className="mt-1 text-[10px] leading-relaxed text-rose-400">{d.extract_error}</p>
                )}
              </div>
              <button
                onClick={() => void remove(d)}
                title="Delete this document, its chunks and its vectors"
                aria-label={`Delete ${d.filename}`}
                className="shrink-0 rounded-md p-1.5 theme-text-muted transition-colors hover:text-rose-400"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
      {confirmDialog}
    </div>
  )
}

// ── step 2 ───────────────────────────────────────────────────────────────────
