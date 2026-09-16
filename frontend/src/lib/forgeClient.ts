// The Forge — /api/forge, the hardware and model console (PROJECT.md §8.2).
//
// Six steps: detect · estimate · score · manage · benchmark · commit. Hardware
// detection lives in systemClient alongside the other diagnostics; everything
// from the model table onward is here.
//
// Rule 5: every one of these is a setup surface. Nothing in the chat path may
// import this module.

import { request } from './http';

// ── the model table (steps 2 & 3) ────────────────────────────────────────────

/** `declared` is arithmetic; `measured` came off the machine. Never conflate them. */
export type Provenance = 'declared' | 'measured' | 'assumed' | 'unknown';

export type FitVerdict = 'safe' | 'marginal' | 'will_not_fit' | 'cloud' | 'unknown';

/** Where the model would actually run, which is why a verdict needs two pools. */
export type Placement = 'gpu' | 'offload' | 'cpu' | 'none' | 'cloud' | 'unknown';

export interface MemoryEstimate {
  total_bytes: number;
  weights_bytes: number;
  weights_source: Provenance;
  kv_cache_bytes: number;
  kv_bytes_per_token: number;
  kv_source: Provenance;
  runtime_overhead_bytes: number;
  context_tokens: number;
  bytes_per_param: number;
  /** The arithmetic, spelled out, so a reader can check it instead of trusting it. */
  formula: string;
}

export interface Verdict {
  fit: FitVerdict;
  placement: Placement;
  utilisation: number | null;
  judged_against: string | null;
  headroom_bytes: number | null;
}

export interface SpeedEstimate {
  tokens_per_sec: number | null;
  run_mode: string;
  /** The inputs behind the estimate — llmfit's rule, and what makes it checkable. */
  basis: string;
}

export interface QualityScore {
  score: number;
  effective_mmlu: number | null;
  quant_penalty: number;
  known: boolean;
}

export interface Measurement {
  at: string | null;
  query_id: string | null;
  time_to_first_token_ms: number | null;
  total_inference_ms: number | null;
  prompt_token_count: number | null;
  completion_token_count: number | null;
  tokens_per_sec: number | null;
}

export interface ModelRow {
  id: string;
  model_id: string;
  label: string;
  vendor: string | null;
  tag: string;
  /** False when nobody has confirmed this tag exists in Ollama's registry. */
  tag_verified: boolean;
  tier: 'slm' | 'llm' | 'discovered';
  /** `catalogue` was declared up front; `discovered` was found installed. */
  source: 'catalogue' | 'discovered';
  params_b: number | null;
  context_length: number | null;
  context_source: Provenance;
  notes: string | null;
  installed: boolean;
  /** Hosted by Ollama's cloud — a benchmark reference, never a local deployment. */
  remote: boolean;
  size_bytes: number | null;
  modified_at: string | null;
  quantization: string;
  quantization_known: boolean;
  quality_meta: {
    mmlu: number | null;
    confidence: string | null;
    source: string | null;
    /** False until somebody checks it against the model card. The UI says so. */
    verified: boolean;
  } | null;
  estimate: MemoryEstimate | null;
  verdict: Verdict;
  speed: SpeedEstimate | null;
  quality: QualityScore | null;
  dimensions: { fit: number; speed: number; quality: number; context: number } | null;
  weights: Record<string, number> | null;
  score: number | null;
  rank: number;
  measured: Measurement | null;
  /** Present once a row has both an estimate and a benchmark. <1 = optimistic estimate. */
  estimate_accuracy: {
    estimated_tokens_per_sec: number;
    measured_tokens_per_sec: number;
    ratio: number;
  } | null;
}

export interface MemoryBudget {
  primary: 'vram' | 'ram';
  vram_available_bytes: number | null;
  vram_total_bytes: number | null;
  ram_available_bytes: number | null;
  ram_total_bytes: number | null;
  combined_available_bytes: number;
  device: string | null;
}

export interface ModelTable {
  rows: ModelRow[];
  budget: MemoryBudget;
  context_tokens: number;
  ollama: { available: boolean; error: string | null; installed_count: number };
  quantizations: Record<string, { bytes_per_param: number; speed_multiplier: number; quality_penalty: number }>;
  weights: Record<string, number>;
}

/** The ranked table. Answers with Ollama stopped — the estimate half needs no daemon. */
export function modelTable(contextTokens?: number): Promise<ModelTable> {
  const query = contextTokens ? `?context_tokens=${contextTokens}` : '';
  return request<ModelTable>(`/api/forge/models${query}`);
}

// ── manage (step 4) ──────────────────────────────────────────────────────────

export interface PullProgress {
  status: string;
  digest: string | null;
  total_bytes: number | null;
  completed_bytes: number | null;
  percent: number | null;
  done: boolean;
  error?: string;
}

/**
 * Pull a model, reporting progress as it streams.
 *
 * Hand-rolled over `fetch` rather than `EventSource`, for two reasons that
 * matter here: EventSource cannot issue a POST, and it reconnects on close —
 * which for a pull would silently restart the download. The returned function
 * aborts, which closes the stream and stops the upstream read; Ollama keeps the
 * layers already written, so resuming does not start over.
 */
export function pullModel(
  tag: string,
  onProgress: (event: PullProgress) => void,
): { done: Promise<void>; cancel: () => void } {
  const controller = new AbortController();

  const done = (async () => {
    const res = await fetch('/api/forge/models/pull', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag }),
      signal: controller.signal,
    });
    if (!res.ok || !res.body) throw new Error(`could not start the pull (HTTP ${res.status})`);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    for (;;) {
      const { done: finished, value } = await reader.read();
      if (finished) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by a blank line. A chunk can split one, so
      // anything after the last separator stays in the buffer for next time.
      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        const line = frame.split('\n').find((l) => l.startsWith('data: '));
        if (!line) continue;
        try {
          const event = JSON.parse(line.slice(6)) as PullProgress;
          onProgress(event);
          if (event.error) throw new Error(event.error);
        } catch (err) {
          if (err instanceof SyntaxError) continue;
          throw err;
        }
      }
    }
  })();

  return { done, cancel: () => controller.abort() };
}

export function deleteModel(tag: string): Promise<{ deleted: boolean; tag: string }> {
  return request(`/api/forge/models/${tag.split('/').map(encodeURIComponent).join('/')}`, {
    method: 'DELETE',
  });
}

// ── benchmark (step 5) ───────────────────────────────────────────────────────

export interface BenchmarkResult {
  tag: string;
  query_id: string;
  at: string;
  status: 'ok' | 'error';
  error: string | null;
  time_to_first_token_ms: number | null;
  total_inference_ms: number | null;
  tokens_per_sec: number | null;
  prompt_token_count: number | null;
  completion_token_count: number | null;
  /** False means the numbers include loading weights from disk — a different claim. */
  warmed_up: boolean;
  prompt: {
    source: 'rag_logs' | 'fixture';
    from_query_id: string | null;
    query_text: string | null;
    chunks: number;
    approx_prompt_tokens: number;
  };
  sample: string;
}

/**
 * Measure TTFT and tok/s on a RAG-context-sized prompt.
 *
 * Minutes, not seconds: a warm-up pass plus a ~2k-token prefill, and on a
 * CPU-bound machine that is genuinely slow. The default 15s abort would kill
 * every run, so this one gets its own timeout.
 */
export function runBenchmark(tag: string): Promise<BenchmarkResult> {
  return request<BenchmarkResult>('/api/forge/benchmark', {
    method: 'POST',
    body: JSON.stringify({ tag }),
    timeoutMs: 10 * 60 * 1000,
  });
}

// ── commit (step 6) ──────────────────────────────────────────────────────────

export interface ActiveModel {
  mode: 'auto' | 'pinned';
  tag: string | null;
  resolved: boolean;
  /** Why this model — in auto mode, the ranking that chose it. */
  reason: string;
  row: ModelRow | null;
  candidates_considered: number;
  config: {
    mode: 'auto' | 'pinned';
    pinned: { tag: string; quantization: string | null } | null;
    updated_at: string | null;
    updated_by: string | null;
    note: string | null;
  };
}

/** What the orchestrator would run right now. Resolves, rather than just reading the file. */
export function activeModel(): Promise<ActiveModel> {
  return request<ActiveModel>('/api/forge/active-model');
}

export function setActiveModel(body: {
  mode: 'auto' | 'pinned';
  tag?: string | null;
  quantization?: string | null;
  note?: string | null;
}): Promise<ActiveModel> {
  return request<ActiveModel>('/api/forge/active-model', {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}
