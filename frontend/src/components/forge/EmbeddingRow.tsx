import { useState } from 'react'
import { Download, RefreshCw, Check, ChevronDown, ScanLine, ArrowRight, CircleCheck, CircleAlert, CircleSlash, Gauge } from 'lucide-react'
import type { EmbeddingModel, FigureSource } from '../../lib/embeddingsClient'
import { Collapse } from '../ui/collapse'

/**
 * One embedding model's card, as the Forge's Embedding models tab lists it.
 *
 * Discovery and choice are one list here: pull a model, verify its vector
 * width, and pick which one builds the index, all on the same card. They used
 * to be split between Models → Embeddings and Added Models → Embedding models,
 * which listed every installed embedder twice.
 *
 * ## No fit score, and that is the point
 *
 * Every chat-model card carries an estimate, a verdict and a rank, because the
 * question there is "which of forty candidates should I run?". Embedding
 * models get no rank — what decides between them is vector width, context
 * window and language coverage, all shown, not a score. Inventing one so the
 * table looked uniform would be the exact failure `MODULES.md` §2.2 is about: a
 * number that looks as authoritative as the measured ones and means nothing.
 *
 * For the same reason there is no retrieval-quality figure here. MTEB scores
 * exist and would be the honest basis for ranking these, but the catalogue does
 * not carry verified ones — and `model_catalogue.json` already ships its six
 * MMLU figures as `verified: false` precisely so nobody quotes an unchecked
 * number. Printing an unsourced score for embedders would repeat the mistake
 * that flag was added to prevent.
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

const VERDICT = {
  safe: { icon: CircleCheck, tone: 'status-ok', label: 'safe' },
  marginal: { icon: CircleAlert, tone: 'status-warn', label: 'marginal' },
  will_not_fit: { icon: CircleSlash, tone: 'status-bad', label: 'will not fit' },
} as const

/**
 * The same card in both places, with different actions. Installed passes
 * `onSelect` and `onVerify` — managing what you have. Browsing passes
 * `onManage` instead, so an installed model points to where it is managed
 * rather than repeating those controls.
 */
export function EmbeddingRow({
  model, selected, pulling, progress, onPull, onVerify, verifying = false, onSelect, onManage,
  onBenchmark, benchmarking = false,
}: {
  model: EmbeddingModel
  selected: boolean
  pulling: boolean
  progress: string | null
  onPull: () => void
  onVerify?: () => void
  verifying?: boolean
  onSelect?: () => void
  onManage?: () => void
  /** Installed: time embedding one question on this machine. */
  onBenchmark?: () => void
  benchmarking?: boolean
}) {
  const [open, setOpen] = useState(false)
  // A window shorter than a chunk truncates without error, and a truncated
  // chunk embeds as a different document than its citation points at — so the
  // fit verdict fails it on any machine, and the figure is flagged here too.
  const tooNarrow = model.fit.reasons.some((r) => r.includes('cut short'))
  const verdict = VERDICT[model.fit.verdict]

  return (
    <div className="rounded-xl border theme-border theme-surface overflow-hidden">
      <div className="flex items-start gap-3 p-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium truncate">{model.label}</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded border uppercase tracking-wide shrink-0 theme-border theme-text-muted">
              embedding
            </span>
            <span
              className={`inline-flex items-center gap-1 text-[11px] shrink-0 ${verdict.tone}`}
              title={model.fit.reasons.join(' · ') || 'Fits this machine'}
            >
              <verdict.icon size={11} /> {verdict.label}
            </span>
            {model.recommended_for.map((r) => (
              <span
                key={r}
                title={`The strongest embedding model this machine can run${r === 'malay' ? ' that also understands Malay' : ''}`}
                className="text-[10px] px-1.5 py-0.5 rounded border uppercase tracking-wide shrink-0 theme-accent-border theme-accent"
              >
                recommended{r === 'malay' ? ' for malay' : ''}
              </span>
            ))}
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
              label="per question"
              source={model.fit.latency_source === 'measured' ? 'measured' : 'declared'}
              value={`${model.fit.latency_source === 'measured' ? '' : '~'}${model.fit.latency_ms} ms`}
              hint={
                model.fit.latency_source === 'measured'
                  ? 'Measured on this machine: median time to embed one question.'
                  : 'Estimated from the model\'s size. Benchmark it once installed to measure this machine.'
              }
            />
          </div>
          {model.fit.reasons.length > 0 && (
            <p className={`mt-1.5 text-[10px] leading-relaxed ${verdict.tone}`}>{model.fit.reasons.join(' · ')}</p>
          )}
        </div>

        <div className="shrink-0 flex items-center gap-1.5">
          {model.installed && onManage && (
            <button
              onClick={onManage}
              title="Choose it for the index, or verify it, in Installed."
              className="inline-flex items-center gap-1.5 rounded-lg border theme-border px-2.5 py-1 text-[11px] theme-text-muted transition-colors hover:theme-text"
            >
              Manage <ArrowRight size={11} />
            </button>
          )}
          {model.installed && onSelect && !selected && (
            <button
              onClick={onSelect}
              title="Make this the model that embeds the corpus. The index for any other model is kept, not deleted."
              className="inline-flex items-center gap-1.5 rounded-lg border theme-accent-border px-2.5 py-1 text-[11px] theme-accent transition-colors hover:theme-surface-strong"
            >
              <Check size={11} />Use for index
            </button>
          )}
          {model.installed && onBenchmark && (
            <button
              onClick={onBenchmark}
              disabled={benchmarking}
              title="Time embedding one question on this machine; replaces the estimate in its verdict"
              className="inline-flex items-center gap-1.5 rounded-lg border theme-border px-2.5 py-1 text-[11px] theme-text-muted transition-colors hover:theme-text disabled:opacity-40"
            >
              {benchmarking
                ? <><RefreshCw size={11} className="animate-spin" />timing…</>
                : <><Gauge size={11} />Benchmark</>}
            </button>
          )}
          {/* Only for installed models: verifying means running one, and there
              is nothing on disk to run before a pull. */}
          {model.installed && onVerify && (
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
              label="per vector"
              value={bytes(model.bytes_per_vector)}
              hint="dimensions x 4 bytes, because Chroma stores float32."
            />
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
            The recommendation orders models by an approximate rank from published MTEB retrieval
            results, among those judged safe on this machine. The rank is not shown as a score: it
            is a sourced ordering, not a measurement, and would otherwise look exactly as
            authoritative as the measured figures.
          </p>
      </Collapse>
    </div>
  )
}
