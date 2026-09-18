// The Forge — /api/forge, the hardware and model console (PROJECT.md §8.2).
//
// Six steps: detect · estimate · score · manage · benchmark · commit. Hardware
// detection lives in systemClient alongside the other diagnostics; everything
// from the model table onward is here.
//
// Rule 5: every one of these is a setup surface. Nothing in the chat path may
// import this module.

import { request, streamEvents, type EventStream } from './http';

// ── the model table (steps 2 & 3) ────────────────────────────────────────────

/**
 * Where a number came from, in increasing order of authority:
 *
 *   declared  — arithmetic over a parameter count. Nothing has been run
 *   registry  — the real published size, from an Ollama manifest, before pulling
 *   measured  — real bytes on disk and real architecture, after pulling
 *
 * Never conflated: MODULES.md §2.2 turns on an estimate and a measurement being
 * visibly different things.
 */
export type Provenance = 'declared' | 'registry' | 'measured' | 'assumed' | 'unknown';

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
  /**
   * Where `tokens_per_sec` came from, and it decides whether the figure means
   * anything. `engine` is Ollama's own `eval_duration` — a property of the
   * model. `wall_clock` is `completion ÷ (total − TTFT)`, the fallback for a
   * run that reported no counters, and it charges the model for every
   * client-side and network delay in that window. On a short generation the
   * window is small enough that the quotient is nonsense, so the UI has to say
   * which one it is rather than print both the same way.
   */
  rate_source: 'engine' | 'wall_clock' | null;
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
  /** Rough capability, for filtering. */
  kind: 'general' | 'coding' | 'reasoning' | 'vision';
  /** One of PROJECT.md §8.1's six report candidates, as opposed to the wider library. */
  shortlist: boolean;
  source: ModelSource;
  /** Registry says the tag is real. `null` means the registry was unreachable, not that it is wrong. */
  tag_exists: boolean | null;
  /** Real download size from the Ollama manifest — known before pulling. */
  download_bytes: number | null;
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
  /** Only on Hugging Face rows. */
  hf?: {
    repo: string;
    url: string;
    architecture: string | null;
    downloads: number | null;
    likes: number | null;
    gated: boolean;
  };
}

/** Which list a row came from. Drives the filter bar. */
export type ModelSource = 'shortlist' | 'library' | 'installed' | 'huggingface' | 'cloud' | 'custom';

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

export interface TableOptions {
  contextTokens?: number;
}

/** The ranked table. Answers with Ollama stopped — the estimate half needs no daemon. */
export function modelTable(opts: TableOptions = {}): Promise<ModelTable> {
  const params = new URLSearchParams();
  if (opts.contextTokens) params.set('context_tokens', String(opts.contextTokens));
  const query = params.toString();
  return request<ModelTable>(`/api/forge/models${query ? `?${query}` : ''}`);
}

export interface HuggingFaceResult {
  rows: ModelRow[];
  /** Non-null when the search could not run — offline is a normal state here. */
  error: string | null;
  cached: boolean;
}

/**
 * Search Hugging Face for GGUF models, scored against this machine.
 *
 * Its own call rather than part of the table because it needs the internet and
 * can fail, and the main table must render without either. Results are pullable
 * — Ollama takes `hf.co/{repo}:{quant}` directly.
 */
export function searchHuggingFace(
  query: string,
  opts: TableOptions & { limit?: number } = {},
): Promise<HuggingFaceResult> {
  const params = new URLSearchParams({ q: query, limit: String(opts.limit ?? 24) });
  if (opts.contextTokens) params.set('context_tokens', String(opts.contextTokens));
  // Hugging Face plus a cold cache can take a few seconds.
  return request<HuggingFaceResult>(`/api/forge/huggingface?${params}`, { timeoutMs: 30000 });
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

/** One event from the benchmark stream. Exactly one `done` or `error` arrives. */
export interface BenchmarkProgress {
  phase: 'building_prompt' | 'warming_up' | 'generating' | 'done' | 'error';
  tokens?: number;
  piece?: string;
  result?: BenchmarkResult;
  error?: string;
  /**
   * Set when a cloud tag was refused for want of an account. Ollama returns a
   * URL carrying this machine's public key; following it is the fix. It rides
   * the event and nothing else — never the persisted error message.
   */
  signin_url?: string;
}

/**
 * Measure TTFT and tok/s on a RAG-context-sized prompt.
 *
 * Minutes, not seconds: a warm-up pass plus a ~2k-token prefill, and on a
 * CPU-bound machine that is genuinely slow. It streams so the UI can show what
 * it is doing rather than sit on a spinner for several minutes, and `cancel`
 * exists so leaving the panel does not leave the read hanging.
 *
 * The measurement arrives on the `done` event. `done` the promise only says the
 * stream closed, and rejects if the run failed.
 */
export function runBenchmark(
  tag: string,
  onProgress: (p: BenchmarkProgress) => void,
): EventStream {
  let failure: string | undefined;

  const stream = streamEvents<BenchmarkProgress>('/api/forge/benchmark', { tag }, (event) => {
    onProgress(event);
    if (event.phase === 'error') failure = event.error ?? 'the benchmark failed';
  });

  return {
    cancel: stream.cancel,
    done: stream.done.then(() => {
      if (failure) throw new Error(failure);
    }),
  };
}

// ── inspect one arbitrary tag ────────────────────────────────────────────────

export interface InspectResult {
  row: ModelRow | null;
  /** Names the fix when a tag cannot be resolved — "no manifest for …", and so on. */
  error: string | null;
}

/**
 * Score one arbitrary tag: an Ollama library tag, a namespaced repo, or
 * `hf.co/{repo}:{quant}`. For when you already know the model and only want the
 * verdict.
 */
export function inspectTag(tag: string, opts: TableOptions = {}): Promise<InspectResult> {
  const params = new URLSearchParams({ tag });
  if (opts.contextTokens) params.set('context_tokens', String(opts.contextTokens));
  return request<InspectResult>(`/api/forge/inspect?${params}`, { timeoutMs: 30000 });
}

// ── usage and latency, per model ─────────────────────────────────────────────

/** mean / p50 / p95, because §9.2 asks for all three. A mean alone hides the tail. */
export interface LatencySummary {
  mean: number | null;
  p50: number | null;
  p95: number | null;
  min: number | null;
  max: number | null;
}

export interface ModelUsage {
  model_name: string;
  runs: number;
  errors: number;
  /** Benchmark runs and real chat traffic share one table; this separates them. */
  by_source: Record<string, number>;
  first_used: string | null;
  last_used: string | null;
  prompt_tokens: number;
  completion_tokens: number;
  /** Wall clock: what the caller waited through. */
  time_to_first_token_ms: LatencySummary;
  total_inference_ms: LatencySummary;
  /** From the engine's own counters: what the model costs. */
  tokens_per_sec: LatencySummary;
}

export interface UsageReport {
  models: Record<string, ModelUsage>;
  totals: {
    models: number;
    runs: number;
    errors: number;
    prompt_tokens: number;
    completion_tokens: number;
  };
}

/** Everything `model_logs` knows about what has actually run. */
export function modelUsage(): Promise<UsageReport> {
  return request<UsageReport>('/api/forge/usage');
}
