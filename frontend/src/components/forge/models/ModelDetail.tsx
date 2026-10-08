import { ExternalLink } from 'lucide-react'
import { type ModelRow, type ModelUsage } from '../../../lib/forgeClient'
import { ModelArchitecture } from '../../ui/model-architecture'
import { bytes, ms, PROVENANCE_HELP } from './format'
import { Fact, Dimension, Section } from './parts'

export function Detail({ row, usage }: { row: ModelRow; usage?: ModelUsage }) {
  const est = row.estimate

  if (!est) {
    return (
      <p className="text-[11px] theme-text-muted leading-relaxed">
        {row.notes ?? 'Not scorable, because Ollama reports no parameter count for this model.'}
      </p>
    )
  }

  // A fragment, not a wrapping <div>. `Collapse` cascades the *direct children*
  // of its own element, so a layout wrapper here would make the whole panel one
  // child and the whole cascade one beat — which is exactly what it looked
  // like. The grid classes moved onto the Collapse's className instead.
  return (
    <>
      <Section
        title="Memory estimate"
        right={
          <span
            className="text-[10px] theme-text-muted"
            title={PROVENANCE_HELP[est.weights_source]}
          >
            {est.weights_source} weights
          </span>
        }
      >
        <div className="divide-y divide-[color-mix(in_srgb,var(--border)_60%,transparent)]">
          <Fact
            label="Weights"
            value={bytes(est.weights_bytes)}
            hint={PROVENANCE_HELP[est.weights_source]}
          />
          <Fact
            label={`KV cache · ${est.context_tokens.toLocaleString()} tok`}
            value={bytes(est.kv_cache_bytes)}
            hint={`${(est.kv_bytes_per_token / 1024).toFixed(0)} KB per token. ${PROVENANCE_HELP[est.kv_source] ?? est.kv_source}`}
          />
          <Fact label="Runtime overhead" value={bytes(est.runtime_overhead_bytes)} />
          <Fact
            label="Total"
            value={<span className="font-semibold">{bytes(est.total_bytes)}</span>}
          />
        </div>
        {row.verdict.utilisation !== null && (
          <p className="text-[11px] theme-text-muted mt-2">
            {(row.verdict.utilisation * 100).toFixed(0)}% of available{' '}
            {row.verdict.judged_against === 'vram' ? 'VRAM' :
              row.verdict.judged_against === 'vram+ram' ? 'VRAM + system RAM' : 'system RAM'}
            {row.verdict.headroom_bytes !== null && row.verdict.headroom_bytes > 0 &&
              ` · ${bytes(row.verdict.headroom_bytes)} spare`}
          </p>
        )}
        {/* Directly under the estimate, because it is the estimate's inputs —
            the KV term above is layers x kv_heads x head_dim x 2 x bytes. */}
        <div className="mt-3 pt-3 border-t theme-border">
          <ModelArchitecture arch={row.arch} />
        </div>
      </Section>

      <Section
        title="Score"
        right={
          <span className="text-[11px] font-mono theme-text">
            {row.score ?? '-'}
            <span className="theme-text-muted"> / 100</span>
          </span>
        }
      >
        {row.dimensions && row.weights ? (
          <>
            <div>
              {(['quality', 'speed', 'fit', 'context'] as const).map((k) => (
                <Dimension key={k} label={k} value={row.dimensions![k]} weight={row.weights![k]} />
              ))}
            </div>
            <p className="text-[11px] theme-text-muted mt-2 leading-relaxed">
              Weighted for grounded RAG, using PROJECT.md §9.2's own targets. Hallucination
              rate is the hardest of those to hit, so quality carries the most.
            </p>
          </>
        ) : (
          <p className="text-[11px] theme-text-muted">Not scored.</p>
        )}
      </Section>

      <Section title="Speed estimate">
        <p className="text-[11px] theme-text-muted leading-relaxed">
          <code className="theme-text">{row.speed?.basis}</code>
          <br />
          Generation is memory-bound (every weight gets read once per token), so throughput
          tracks bandwidth ÷ model size.
        </p>
      </Section>

      <Section title="Quality">
        {row.quality_meta?.mmlu != null ? (
          <p className="text-[11px] theme-text-muted leading-relaxed">
            MMLU {row.quality_meta.mmlu}
            {row.quality?.quant_penalty ? ` ${row.quality.quant_penalty} for ${row.quantization}` : ''}
            {row.quality?.effective_mmlu != null && ` = ${row.quality.effective_mmlu} effective`}
            {!row.quality_meta.verified && (
              <>
                <br />
                <span className="status-warn">Unverified.</span>
                <span> Check it against </span>
                <span className="break-all">{row.quality_meta.source}</span>
              </>
            )}
          </p>
        ) : (
          <p className="text-[11px] theme-text-muted leading-relaxed">
            No capability score, because this model was never declared in the catalogue. It
            scores from a neutral baseline with the {row.quantization} penalty applied, so it
            still ranks correctly against other unscored models without claiming a figure
            nobody has measured.
          </p>
        )}
      </Section>

      {/* Every run model_logs holds for this tag, benchmark and chat alike. The
          Measured column is the last benchmark; this is the distribution, as
          mean, p50 and p95 — the three PROJECT.md §9.2 asks for by name. */}
      {usage && usage.runs > 0 && (
        <Section
          title="On this machine"
          right={
            <span className="text-[10px] theme-text-muted">
              {usage.runs} run{usage.runs === 1 ? '' : 's'}
              {usage.errors > 0 && <span className="status-warn"> · {usage.errors} failed</span>}
            </span>
          }
        >
          <div className="divide-y divide-[color-mix(in_srgb,var(--border)_60%,transparent)]">
            <Fact
              label="TTFT p50 / p95"
              value={`${ms(usage.time_to_first_token_ms.p50)} / ${ms(usage.time_to_first_token_ms.p95)}`}
              hint={`mean ${ms(usage.time_to_first_token_ms.mean)}`}
            />
            <Fact
              label="End-to-end p50"
              value={ms(usage.total_inference_ms.p50)}
              hint={`mean ${ms(usage.total_inference_ms.mean)} · p95 ${ms(usage.total_inference_ms.p95)}`}
            />
            <Fact
              label="Generation p50"
              value={usage.tokens_per_sec.p50 ? `${usage.tokens_per_sec.p50} tok/s` : '-'}
              hint="From the engine's own counters, so it measures the model rather than the machine's other work."
            />
            <Fact
              label="Runs by source"
              value={Object.entries(usage.by_source).map(([k, v]) => `${v} ${k}`).join(' · ')}
            />
          </div>
        </Section>
      )}

      {row.hf && (
        <Section title="Hugging Face">
          <div className="divide-y divide-[color-mix(in_srgb,var(--border)_60%,transparent)]">
            <Fact label="Repository" value={row.hf.repo} mono={false} />
            <Fact label="Architecture" value={row.hf.architecture ?? '-'} />
            <Fact label="Downloads" value={row.hf.downloads?.toLocaleString() ?? '-'} />
          </div>
          <a
            href={row.hf.url}
            target="_blank"
            rel="noreferrer noopener"
            className="text-[11px] theme-accent hover:underline inline-flex items-center gap-1 mt-2"
          >
            Open on Hugging Face <ExternalLink size={10} />
          </a>
        </Section>
      )}
    </>
  )
}
