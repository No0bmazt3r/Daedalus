import { useEffect, useState } from 'react'
import { TabError } from '../../errors/TabError'
import { toFailure, type LoadFailure } from '../../errors/ErrorPage'
import {
  saveCorpusConfig, previewChunks, type CorpusDocument, type CorpusConfig, type ChunkPreview,
} from '../../../lib/blueprintsClient'
import { ThemeSelect } from '../../ui/theme-select'

export function ChunkStep({
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
  // The preview cannot be produced: the preview area is the error page.
  const [error, setError] = useState<LoadFailure | null>(null)
  const [attempt, setAttempt] = useState(0)
  // Saving the settings failed: a line by the button, not an error page.
  const [saveError, setSaveError] = useState<string | null>(null)
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
        .catch((e: unknown) => setError(toFailure(e)))
    }, 300)
    return () => window.clearTimeout(timer)
  }, [subject, draft, attempt])

  const shown = preview?.subject === subject ? preview.data : null

  const save = async () => {
    setSaving(true)
    try {
      await saveCorpusConfig(draft)
      setSaveError(null)
      onSaved()
    } catch (e) {
      setSaveError((e as Error).message)
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
          {saveError && <p className="text-[10px] leading-relaxed status-bad">Could not save: {saveError}</p>}
          <p className="text-[10px] leading-relaxed theme-text-muted">
            Saving does not re-chunk. Anything already ingested keeps the boundaries it was
            ingested with. Running step 4 is what applies the change.
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
            <TabError
              code={error.status}
              detail={error.message}
              what="The chunk preview for this document could not be produced."
              onRetry={() => { setError(null); setAttempt((n) => n + 1) }}
            />
          )}

          {shown && !error && (
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
