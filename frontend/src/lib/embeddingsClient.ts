// The embedding model — /api/embeddings (architecture/04 Step 5).
//
// Separate from forgeClient on purpose. The Forge shapes the *answering* model
// to the machine; this chooses the model that turns chunks into vectors, and
// the two are different models doing different jobs at different times. Sharing
// a client would invite sharing a mental model, which is the confusion worth
// preventing here.
//
// Rule 5: a setup surface. Nothing in the chat path may import this module.

import { request, streamEvents, type EventStream } from './http';

/**
 * Where a figure came from, in increasing order of authority.
 *
 * `declared` is a catalogue claim about a published tag. `measured` is read from
 * the GGUF header of the file on this disk — no model is run for it. `verified`
 * is the width an actual embedding came back with, which is the only one that is
 * ground truth for what a vector store receives: a header states what the
 * architecture declares, and a model with Matryoshka truncation or an unusual
 * pooling config can emit something narrower.
 *
 * Same relationship the Forge already has between an estimate and a benchmark
 * (MODULES.md §2.2), one tier further up.
 */
export type FigureSource = 'verified' | 'measured' | 'declared' | 'unknown';

export interface EmbeddingModel {
  tag: string;
  installed_tag: string | null;
  label: string;
  installed: boolean;
  size_bytes: number | null;
  /** From Ollama's `/api/show` once pulled; from the catalogue before that. */
  dimensions_source: FigureSource;
  max_tokens_source: FigureSource;
  /** Set once dimensions were verified by embedding a probe string. */
  verified_at?: string;
  /** What the GGUF header declared, kept when a verified width disagrees. */
  header_dimensions?: number | null;
  dimensions_mismatch?: boolean;
  /** Read off the pulled file — null until it is on disk. */
  family: string | null;
  parameter_size: string | null;
  quantization: string | null;
  /** Vector width. Changing it is what makes an existing index unusable. */
  dimensions: number | null;
  /**
   * How much text embeds in one pass. M2 chunks at 300-500 tokens, so a model
   * with a 256-token window silently truncates — and a truncated chunk embeds
   * as a different document than the citation points at.
   */
  max_tokens: number | null;
  recommended: boolean;
  note: string;
  /** Rough — what the model was trained to handle, not a measured claim. */
  languages: string | null;
  /** dimensions x 4, because Chroma stores float32. */
  bytes_per_vector: number | null;
  /** That, times an illustrative corpus size. Labelled as illustrative in the UI. */
  index_bytes_estimate: number | null;
  illustrative_chunks?: number;
}

export interface CloudBaseline {
  id: string;
  label: string;
  provider: string;
  enabled: boolean;
  has_key: boolean;
}

/**
 * `empty`   — nothing ingested yet.
 * `current` — the index was built with the selected model.
 * `stale`   — it was not. Retrieval still returns results, ranked by comparing
 *             vectors from two different spaces, which is not a worse ranking
 *             but a meaningless one. Re-ingest.
 */
export type IndexState = 'empty' | 'current' | 'stale';

export interface EmbeddingConfig {
  provider: 'local' | 'cloud';
  model: string;
  endpoint_id: string | null;
  dimensions: number | null;
  indexed_with: string | null;
  indexed_at: string | null;
  /** Cloud runs write a separate collection so they cannot touch the local index. */
  collection: string;
  production_safe: boolean;
  ready: boolean;
  index_state: IndexState;
  index_detail: string;
  local_models: EmbeddingModel[];
  cloud_baselines: CloudBaseline[];
  ollama_available: boolean;
}

export interface PullEvent {
  status?: string;
  completed?: number;
  total?: number;
  done?: boolean;
  error?: string;
}

export const fetchEmbeddingConfig = () => request<EmbeddingConfig>('/api/embeddings/config');

export const setEmbeddingModel = (body: {
  provider: 'local' | 'cloud';
  model: string;
  endpoint_id?: string | null;
  dimensions?: number | null;
}) =>
  request<EmbeddingConfig>('/api/embeddings/config', {
    method: 'PUT',
    body: JSON.stringify(body),
  });

export const pullEmbeddingModel = (
  tag: string,
  onEvent: (e: PullEvent) => void,
): EventStream => streamEvents<PullEvent>('/api/embeddings/pull', { tag }, onEvent);

/**
 * Embed a fixed probe string and record the width that comes back.
 *
 * The only call here that runs a model rather than reading metadata about one:
 * a brief load and one forward pass over a few words.
 */
export const verifyEmbeddingModel = (tag: string) =>
  request<EmbeddingConfig & { dimensions: number; elapsed_ms: number }>(
    '/api/embeddings/verify',
    { method: 'POST', body: JSON.stringify({ tag }), timeoutMs: 120000 },
  );
