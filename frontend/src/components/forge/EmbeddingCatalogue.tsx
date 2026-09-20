import { useState } from 'react'
import { Download, RefreshCw, AlertTriangle, Check, ChevronDown, ScanLine } from 'lucide-react'
import {
  pullEmbeddingModel, verifyEmbeddingModel,
  type EmbeddingConfig, type EmbeddingModel, type FigureSource,
} from '../../lib/embeddingsClient'
import { Skeleton } from '../ui/skeleton'
import { Collapse } from '../ui/collapse'

/**
 * Forge → Models → Embeddings: the candidates, and pulling them.
 *
 * The Models tab is discovery — *what could run here* — and Added Models is
 * inventory, *what is here now*. Embedding models follow the same split rather
 * than being listed twice: this is where you find and pull one, and the
 * Embedding models pane is where you see what you have and pick which one
 * builds the index.
 *
 * ## No fit score, and that is the point
 *
 * Every other row in this tab carries an estimate, a verdict and a rank, because
 * the question there is "which of forty candidates should I run?". There are
 * four embedding models and no ranking to do — what decides between them is
 * vector width and context window, both shown, not a score. Inventing one so the
 * table looked uniform would be the exact failure `MODULES.md` §2.2 is about: a
 * number that looks as authoritative as the measured ones and means nothing.
 *
 * For the same reason there is no retrieval-quality figure here. MTEB scores
 * exist and would be the honest basis for ranking these, but the catalogue does
 * not carry verified ones — and `model_catalogue.json` already ships its six
 * MMLU figures as `verified: false` precisely so nobody quotes an unchecked
 * number. Printing an unsourced score for embedders would repeat the mistake
 * that flag was added to prevent.
 *
 * ## The state lives in the parent
 *
 * `ModelsView` owns the fetch so the tab's own count is real. This component
 * rendering four rows under a chip reading "0" was the UI contradicting itself,
 * and a reader has no way to know which half is lying.
 */

function bytes(n: number | null | undefined): string {
  if (!n) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  let v = n, u = 0
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u++ }
  return `${v.toFixed(u === 0 ? 0 : 1)} ${units[u]}`
}

const SOURCE_HINT: Record<FigureSource, string> = {
  verified: 'the width an actual embedding came back with — ground truth for what the vector store receives',
  measured: "read from this model's GGUF header after pulling. No model was run for it",
  declared: 'from the catalogue — a claim about the published tag, not yet verified against a file',
  unknown: 'neither measured nor declared: this tag is not in the catalogue and has not been pulled',
}

function Fact({ label, value, hint, tone, source }: {
  label: string
  value: string
  hint?: string
  tone?: 'warn'
  /**
   * Rendered as a word, not a colour or an icon. `MODULES.md` §2.2 turns on an
   * estimate and a measurement being *visibly different things*, and a subtle
   * tint is exactly the kind of difference a reader stops noticing.
   */
  source?: FigureSource
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-baseline gap-1">
        <span className="text-[10px] uppercase tracking-wide theme-text-muted">{label}</span>
        {source && source !== 'unknown' && (
          <span
            title={SOURCE_HINT[source]}
            className={`text-[9px] uppercase tracking-wide ${
              source === 'verified'
                ? 'theme-accent'
                : source === 'measured'
                  ? 'status-ok'
                  : 'theme-text-muted opacity-70'
            }`}
          >
            {source}
          </span>
        )}
      </div>
      <div
        title={hint}
        className={`text-xs ${tone === 'warn' ? 'status-warn' : 'theme-text'}`}
      >
        {value}
      </div>
    </div>
  )
}

function Row({
  model, selected, pulling, progress, onPull, onVerify, verifying,
}: {
  model: EmbeddingModel
  selected: boolean
  pulling: boolean
  progress: string | null
  onPull: () => void
  onVerify: () => void
  verifying: boolean
}) {
  const [open, setOpen] = useState(false)
  // M2 chunks at 300-500 tokens. A narrower window truncates without error, and
  // a truncated chunk embeds as a different document than its citation points
  // at — so it is flagged before the model is pulled, not after.
  const tooNarrow = (model.max_tokens ?? 0) > 0 && (model.max_tokens as number) < 512

  return (
    <div className="rounded-xl border theme-border theme-surface overflow-hidden">
      <div className="flex items-start gap-3 p-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium truncate">{model.label}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded border uppercase tracking-wide shrink-0 theme-border theme-text-muted">
              embedding
            </span>
            {model.recommended && (
              <span className="text-[10px] px-1.5 py-0.5 rounded border uppercase tracking-wide shrink-0 theme-accent-border theme-accent">
                recommended
              </span>
            )}
            {model.installed && <span className="text-[11px] status-ok">installed</span>}
            {selected && (
              <span className="inline-flex items-center gap-1 text-[11px] theme-accent">
                <Check size={11} /> builds the index
              </span>
            )}
          </div>

          {/* The three numbers that actually decide between these, on the row
              rather than behind the disclosure — they are the reason to pick
              one, not supporting detail. */}
          <div className="mt-2 grid grid-cols-2 @md:grid-cols-4 gap-x-4 gap-y-2">
            <Fact
              label="dimensions"
              source={model.dimensions_source}
              value={model.dimensions ? `${model.dimensions}` : '—'}
              hint="Vector width. Wider is not simply better: it doubles the index and the per-query comparison cost, and changing it invalidates an existing index entirely."
            />
            <Fact
              label="context"
              source={model.max_tokens_source}
              value={model.max_tokens ? `${model.max_tokens} tok` : '—'}
              tone={tooNarrow ? 'warn' : undefined}
              hint={
                tooNarrow
                  ? 'Narrower than a 300-500 token chunk. Anything longer is truncated silently.'
                  : 'How much text embeds in one pass. Comfortably above M2 chunk size.'
              }
            />
            <Fact
              label="download"
              source={model.installed ? 'measured' : 'declared'}
              value={bytes(model.size_bytes)}
              hint={model.installed ? 'Real bytes on this disk.' : 'Published size; the pull may differ.'}
            />
            <Fact
              label="per vector"
              value={bytes(model.bytes_per_vector)}
              hint="dimensions x 4 bytes, because Chroma stores float32."
            />
          </div>
        </div>

        <div className="shrink-0 flex items-center gap-1.5">
          {/* Only for installed models: verifying means running one, and there
              is nothing on disk to run before a pull. */}
          {model.installed && (
            <button
              onClick={onVerify}
              disabled={verifying}
              title={
                model.dimensions_source === 'verified'
                  ? `Verified ${model.verified_at ?? ''}. Re-run to check again.`
                  : 'Embed a short probe string and measure the vector that comes back — the only figure that is ground truth for what the vector store receives. Briefly loads the model.'
              }
              className="inline-flex items-center gap-1.5 rounded-lg border theme-border px-2.5 py-1 text-[11px] theme-text-muted transition-colors hover:theme-text disabled:opacity-40"
            >
              {verifying
                ? <><RefreshCw size={11} className="animate-spin" />verifying…</>
                : <><ScanLine size={11} />{model.dimensions_source === 'verified' ? 'Re-verify' : 'Verify'}</>}
            </button>
          )}
          {!model.installed && (
            <button
              onClick={onPull}
              disabled={pulling}
              className="inline-flex items-center gap-1.5 rounded-lg border theme-border px-2.5 py-1 text-[11px] theme-text-muted transition-colors hover:theme-text disabled:opacity-40"
            >
              {pulling
                ? <><RefreshCw size={11} className="animate-spin" />{progress ?? 'pulling…'}</>
                : <><Download size={11} />Pull</>}
            </button>
          )}
          <button
            onClick={() => setOpen((v) => !v)}
            title={open ? 'Hide details' : 'Show details'}
            className="rounded-lg border theme-border p-1.5 theme-text-muted transition-colors hover:theme-text"
          >
            <ChevronDown
              size={12}
              className={`transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
            />
          </button>
        </div>
      </div>

      {/* `flow`, like the other two row expansions in the Forge: they sit behind
          the same chevron and should not each open differently. */}
      <Collapse
        open={open}
        variant="flow"
        className="border-t theme-border px-3 py-2.5 space-y-2"
      >
          <div className="grid grid-cols-2 @md:grid-cols-3 gap-x-4 gap-y-2">
            <Fact label="tag" value={model.tag} />
            <Fact label="languages" value={model.languages ?? '—'} />
            <Fact
              label={`index @ ${model.illustrative_chunks ?? 200} chunks`}
              value={bytes(model.index_bytes_estimate)}
              hint="Illustrative, not a measurement: bytes-per-vector times a corpus of that size. The real figure depends on how many chunks ingestion produces."
            />
            {/* Only present once the file is on disk, which is why they are
                down here rather than on the row: a card that showed three
                blanks before pulling would read as missing data. */}
            {model.installed && (
              <>
                <Fact label="family" source="measured" value={model.family ?? '—'} />
                <Fact label="parameters" source="measured" value={model.parameter_size ?? '—'} />
                <Fact label="quantization" source="measured" value={model.quantization ?? '—'} />
              </>
            )}
          </div>

          {model.installed && model.dimensions_source === 'measured' && (
            <p className="text-[10px] leading-relaxed theme-text-muted">
              These figures were read from the pulled model's GGUF header, not from the catalogue.
              Where the two disagree — a repackaged or re-quantized tag can ship a different
              context window than its model card advertises — what is on this disk wins. Verify to
              confirm the vector width by actually embedding something.
            </p>
          )}

          {model.dimensions_mismatch && (
            <p className="rounded-lg border status-warn-border status-warn-bg px-2.5 py-2 text-[11px] leading-relaxed theme-text">
              The header declares <code>{model.header_dimensions}</code> dimensions but the model
              returned <code>{model.dimensions}</code>. The verified width is what the vector store
              receives, so it is what every figure here is computed from.
            </p>
          )}

          {model.dimensions_source === 'verified' && !model.dimensions_mismatch && (
            <p className="text-[10px] leading-relaxed theme-text-muted">
              Vector width confirmed by embedding a probe string — the header and the real output
              agree.
            </p>
          )}
          <p className="text-[11px] leading-relaxed theme-text-muted">{model.note}</p>
          {model.installed && model.installed_tag && (
            <p className="text-[10px] theme-text-muted">
              installed as <code className="theme-text">{model.installed_tag}</code>
            </p>
          )}
          <p className="text-[10px] leading-relaxed theme-text-muted">
            No retrieval-quality score is shown. Ranking these honestly needs verified MTEB
            figures, and the catalogue does not carry any — an unsourced number here would look
            exactly as authoritative as the measured ones elsewhere in the Forge.
          </p>
      </Collapse>
    </div>
  )
}

export function EmbeddingCatalogue({
  config,
  onChanged,
}: {
  config: EmbeddingConfig | null
  onChanged: () => void
}) {
  const [pulling, setPulling] = useState<string | null>(null)
  const [progress, setProgress] = useState<string | null>(null)
  const [verifying, setVerifying] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const verify = (tag: string) => {
    setVerifying(tag)
    setError(null)
    verifyEmbeddingModel(tag)
      .catch((e: Error) => setError(e.message))
      .finally(() => { setVerifying(null); onChanged() })
  }

  const pull = (tag: string) => {
    setPulling(tag)
    setProgress(null)
    setError(null)
    const stream = pullEmbeddingModel(tag, (e) => {
      if (e.error) setError(e.error)
      else if (e.total && e.completed) setProgress(`${Math.round((e.completed / e.total) * 100)}%`)
      else if (e.status) setProgress(e.status)
    })
    stream.done
      .catch((e: Error) => setError(e.message))
      .finally(() => { setPulling(null); setProgress(null); onChanged() })
  }

  if (!config) return <Skeleton className="h-48 w-full" />

  return (
    <div className="@container space-y-3">
      <p className="text-xs leading-relaxed theme-text-muted">
        Turns document chunks into vectors for Track 1 retrieval.{' '}
        <span className="theme-text">Not answering models</span> — never offered to the assistant,
        and no fit verdict, because fit, speed and quality all measure something that generates
        text. Pick which one builds the index in{' '}
        <span className="theme-text">Added Models → Embedding models</span>.
      </p>

      {!config.ollama_available && (
        <div className="flex items-center gap-2 rounded-xl border status-warn-border status-warn-bg p-3 text-xs">
          <AlertTriangle size={14} className="status-warn shrink-0" />
          Ollama isn't reachable, so nothing can be pulled.
        </div>
      )}

      {config.local_models.map((m) => (
        <Row
          key={m.tag}
          model={m}
          selected={config.provider === 'local' && config.model.split(':')[0] === m.tag}
          pulling={pulling === m.tag}
          progress={progress}
          onPull={() => pull(m.tag)}
          onVerify={() => verify(m.tag)}
          verifying={verifying === m.tag}
        />
      ))}

      {error && (
        <div className="flex items-center gap-2 rounded-xl border status-warn-border status-warn-bg p-3 text-xs">
          <AlertTriangle size={14} className="status-warn shrink-0" /> {error}
        </div>
      )}
    </div>
  )
}
