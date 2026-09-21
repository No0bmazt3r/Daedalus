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
 * `empty`   — nothing has been ingested with the selected model yet.
 * `current` — this model's collection exists, and the model stamped on it is
 *             the one selected.
 * `stale`   — the collection holds vectors some other model produced, or
 *             vectors nothing accounted for. The query path refuses it rather
 *             than ranking by comparing two vector spaces, which is not a worse
 *             ranking but a meaningless one. Re-ingest.
 * `unknown` — Chroma could not be read, so none of the above was established.
 *             An absence of a verdict, not a verdict.
 *
 * Since each embedding model owns its own collection, `stale` is now a guard
 * against something having gone wrong rather than the ordinary consequence of
 * changing models — that just addresses a different, empty index.
 */
/**
 * `unset` is its own state, ahead of every question about the store: nobody has
 * chosen an embedding model. Distinct from `empty`, which means a model *is*
 * chosen and has simply not been used to build anything — different facts with
 * different fixes, and collapsing them is what let a fresh install report a
 * readiness it had no basis for.
 */
export type IndexState = 'unset' | 'empty' | 'current' | 'stale' | 'unknown';

/**
 * Which source answered `index_state`.
 *
 * `collection` is the index itself, and is the only one that is a fact about
 * the vectors. `config` is the note kept beside the store, used when Chroma
 * cannot be reached. `none` means neither could answer.
 */
export type IndexSource = 'collection' | 'config' | 'none';

/** One index, as the store describes itself. */
export interface VectorIndex {
  name: string;
  available: boolean;
  exists: boolean;
  documents: number;
  /** Stamped at ingest. Null means nothing recorded what built this. */
  embedding_model: string | null;
  dimensions: number | null;
  indexed_at: string | null;
  error: string | null;
}

export interface EmbeddingConfig {
  provider: 'local' | 'cloud';
  model: string;
  endpoint_id: string | null;
  dimensions: number | null;
  /** A verified width outranks a declared one — see `FigureSource`. */
  dimensions_source: FigureSource;
  /** The last ingest the config recorded, of any model. Null before the first. */
  indexed_with: string | null;
  indexed_at: string | null;
  /**
   * The collection this model owns, derived from its tag. Selecting a different
   * model addresses a different collection rather than invalidating this one,
   * and a cloud selection carries its own prefix on top of that so it cannot
   * touch the local index.
   */
  collection: string;
  production_safe: boolean;
  ready: boolean;
  index_state: IndexState;
  index_detail: string;
  index_source: IndexSource;
  /** Null when the store could not be read, which is not the same as zero. */
  index_documents: number | null;
  /**
   * Every index on this machine, not just the selected model's. A local index
   * and a cloud baseline over the same corpus are a pair to compare, not a mess
   * to tidy — §5's comparison is the reason both exist.
   */
  indexes: VectorIndex[];
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
