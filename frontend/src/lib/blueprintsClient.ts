// Labyrinth Blueprints — /api/graph and /api/corpus (MODULES.md §3).
//
// The knowledge map: what this system knows, and how it is connected. Two
// halves with very different readiness, and the types below keep that visible
// rather than smoothing it over.
//
// The graph endpoints return a discriminated `available` flag. That is not
// defensive coding — MODULES.md §0 rule 4 makes it the contract: a module whose
// data does not exist yet must say *which milestone* it is waiting on, because a
// blank panel that looks broken is worse than one that explains itself.
//
// The corpus half used to answer that way for every call, blocked on M2. It is
// built now: `/api/corpus` is a real pipeline — upload, chunk, embed, inspect —
// and an empty corpus is an empty corpus rather than an unbuilt feature.
//
// Read-only by construction. There is no "run a traversal" call here and there
// must never be one: replay renders a walk that was recorded, and performing one
// on demand would make this a second retrieval path with none of Layer 10's
// logging.

import { request } from './http';

/** The 7 node types from PROJECT.md §5 Track 2. */
export type NodeType =
  | 'Sensor'
  | 'OperatingMode'
  | 'Threshold'
  | 'SOPDocument'
  | 'SOPStep'
  | 'AnomalyRecord'
  | 'AnomalyType';

/** The 7 edge types. A traversal's `edge` may carry a trailing ↩ for a reverse walk. */
export type EdgeType =
  | 'MONITORED_IN'
  | 'HAS_THRESHOLD'
  | 'TRIGGERS'
  | 'RESOLVED_BY'
  | 'CONTAINS'
  | 'INSTANCE_OF'
  | 'INVOLVES';

export interface GraphNode {
  id: string;
  type: NodeType;
  label: string;
  description?: string;
  aliases?: string[];
  degree?: number;
  /** Sensor only — the `sensor_readings` column, which is the join to live telemetry. */
  column?: string;
  unit?: string;
  /** Threshold only. */
  operator?: string;
  value?: number;
  applies_mode?: string | null;
  /** SOPDocument only — the join key into chunk metadata's `source_file`. */
  filename?: string;
  version?: string;
  /** SOPStep only. */
  step_number?: number;
  /** AnomalyRecord only. */
  occurred_at?: string;
  severity?: string;
  resolution?: string;
  /** Set when a recorded traversal crossed a node the graph no longer has. */
  missing?: boolean;
}

export interface GraphSchema {
  available: true;
  nodes: { type: NodeType; count: number }[];
  edges: { type: EdgeType; count: number; from: NodeType; to: NodeType }[];
  total_nodes: number;
  total_edges: number;
}

export interface GraphEdge {
  from: string;
  type: EdgeType;
  to: string;
}

export interface NodeList {
  available: true;
  nodes: GraphNode[];
  /** Only edges with both endpoints in `nodes` — what the diagram can draw. */
  edges: GraphEdge[];
  total: number;
  total_edges: number;
}

export interface Neighbour {
  edge: EdgeType;
  node: GraphNode;
}

export interface NodeDetail {
  available: true;
  node: GraphNode;
  outgoing: Neighbour[];
  incoming: Neighbour[];
}

/** A gap is a question the graph cannot answer — MODULES.md §3.3. */
export interface Coverage {
  available: true;
  orphans: GraphNode[];
  unresolved_anomaly_types: GraphNode[];
  sensors_without_thresholds: GraphNode[];
  thresholds_without_triggers: GraphNode[];
  empty_sops: GraphNode[];
  total_gaps: number;
}

export interface Hop {
  hop: number;
  from: string[];
  edge: string;
  to: string[];
  /**
   * Which of the from/to pairs were actually joined. Recorded separately
   * because the sets do not imply the pairings — a hop spanning two Sensors and
   * two Thresholds has four possible pairs and two real ones, and a renderer
   * left to guess draws edges the graph does not contain.
   */
  edges: { from: string; to: string }[];
  /** The agent's own verdict between steps. null when it never assessed. */
  sufficient: boolean | null;
  reason: string | null;
}

export interface TraversalPath {
  entry_query: string;
  /**
   * How the starting nodes were found. Track 2 is deliberately embedding-free,
   * so a `vector` value here would mean that decision was reversed — which is
   * exactly why it is recorded per query rather than asserted in a doc.
   */
  entry_strategy: 'alias' | 'fuzzy' | 'vector' | 'none' | null;
  entry_nodes: string[];
  hops: Hop[];
  hop_count: number;
  elapsed_ms: number;
}

export interface Traversal {
  available: true;
  query_id: string;
  timestamp: string;
  track: string;
  query_text: string;
  hop_count: number;
  retrieval_latency_ms: number | null;
  entry_strategy: string | null;
  path: TraversalPath;
  /** Node id → its current attributes, for rendering labels instead of ids. */
  nodes: Record<string, GraphNode>;
}

/** Why there is nothing to show, and which milestone owes it. */
export interface Unavailable {
  available: false;
  blocked_by?: string;
  reason: string;
}

export const NODE_TYPES: NodeType[] = [
  'Sensor',
  'OperatingMode',
  'Threshold',
  'SOPDocument',
  'SOPStep',
  'AnomalyRecord',
  'AnomalyType',
];

export const fetchGraphSchema = () => request<GraphSchema>('/api/graph/schema');

export const fetchNodes = (params: { q?: string; type?: NodeType | null } = {}) => {
  const search = new URLSearchParams();
  if (params.q) search.set('q', params.q);
  if (params.type) search.set('type', params.type);
  const qs = search.toString();
  return request<NodeList>(`/api/graph/nodes${qs ? `?${qs}` : ''}`);
};

// Node ids carry a colon (`Sensor:co2_ppm`) and the backend route is a `:path`
// converter, so the id is encoded as one segment rather than split on the colon.
export const fetchNode = (id: string) =>
  request<NodeDetail>(`/api/graph/nodes/${encodeURIComponent(id)}`);

export const fetchCoverage = () => request<Coverage>('/api/graph/coverage');

export interface TraversalSummary {
  query_id: string;
  timestamp: string;
  query_text: string;
  hop_count: number;
  retrieval_latency_ms: number | null;
  entry_strategy: string | null;
  replayable: boolean;
  /**
   * Written by the seeder rather than the orchestrator. Surfaced rather than
   * filtered: a seeded latency is traversal wall-clock only, so a reader must
   * never mistake one for a measured end-to-end figure.
   */
  seeded: boolean;
}

export const fetchTraversals = () =>
  request<{ available: true; traversals: TraversalSummary[]; total: number }>(
    '/api/graph/traversals',
  );

export const fetchTraversal = (queryId: string) =>
  request<Traversal | Unavailable>(`/api/graph/traversal/${encodeURIComponent(queryId)}`);

/**
 * Seed recorded traversals — development only, and deliberately in this client
 * rather than systemClient: it exists for this module's empty state and nothing
 * else should grow a dependency on it. Rows land marked `vector_db_used='seed'`
 * and must be excluded from every reported metric.
 */
export const seedTraversals = (force = false) =>
  request<{ ok: boolean; seeded: number; existing?: number; note?: string }>(
    `/api/system/seed-graph-traces${force ? '?force=true' : ''}`,
    { method: 'POST' },
  );


// ── the retrieval track switch (PROJECT.md §5) ───────────────────────────────

export type RagTrack = 'vector' | 'graph';

export interface TrackStatus {
  id: RagTrack;
  label: string;
  role: string;
  /** Computed, not declared — whether this track can actually answer right now. */
  ready: boolean;
  detail: string;
  blocked_by: string | null;
}

export interface RagConfig {
  track: RagTrack;
  /**
   * PROJECT.md §5's freeze discipline. Once both arms are built the evaluation
   * runs once without further tuning, so a frozen config refuses API writes and
   * unfreezing is a deliberate hand edit of a committed file.
   */
  frozen: boolean;
  note: string;
  tracks: TrackStatus[];
}

export const fetchRagConfig = () => request<RagConfig>('/api/rag/config');

/**
 * Fired after the track actually changes, so anything showing it can re-read.
 *
 * The track is chosen in Settings → Knowledge Base and displayed in a different
 * window, and windows here are *hidden, not unmounted* when minimized — so
 * Blueprints could sit minimized across a track change, keep its stale config,
 * and come back showing the wrong arm until it was closed and reopened.
 *
 * Dispatched from the client rather than from the panel that calls it, so every
 * path that changes the track notifies by construction. A panel that has to
 * remember to fire an event is a panel that will eventually forget, and the
 * next one added will not know it was supposed to.
 */
export const RAG_TRACK_CHANGED_EVENT = 'daedalus:rag-track-changed';

export const setRagTrack = async (track: RagTrack) => {
  const config = await request<RagConfig>('/api/rag/config', {
    method: 'PUT',
    body: JSON.stringify({ track }),
  });
  // After the write resolves, never before: a refused change (the comparison is
  // frozen) must not announce one that did not happen.
  window.dispatchEvent(new CustomEvent(RAG_TRACK_CHANGED_EVENT, { detail: config }));
  return config;
};


// ── the corpus pipeline (Track 1) ────────────────────────────────────────────
//
// M2, built. These replace the `available: false, blocked_by: 'M2'` shapes the
// corpus half used to answer with — see `api/corpus.py`.

export interface CorpusDocument {
  document_id: string;
  filename: string;
  media_type: string;
  size_bytes: number;
  source_type: 'manual' | 'sop' | 'anomaly_record' | 'uauc_record' | 'other';
  title: string | null;
  document_version: string | null;
  reactor_mode: string | null;
  extract_status: 'pending' | 'ok' | 'failed';
  extract_error: string | null;
  extractor: string | null;
  page_count: number | null;
  char_count: number | null;
  uploaded_at: string;
  chunk_count: number;
  embedded_count: number;
}

export interface CorpusChunk {
  chunk_id: string;
  document_id: string;
  ordinal: number;
  text: string;
  char_start: number;
  char_end: number;
  token_estimate: number | null;
  page_number: number | null;
  section_title: string | null;
  embedded: number;
  embedding_model: string | null;
  embed_error: string | null;
  filename?: string;
}

export interface ChunkSettings {
  strategy: string;
  chunk_size: number;
  chunk_overlap: number;
}

export interface ChunkStrategy {
  id: string;
  label: string;
  hint: string;
  recommended: boolean;
}

export interface CorpusConfig extends ChunkSettings {
  note: string;
  strategies: ChunkStrategy[];
  defaults: ChunkSettings;
  bounds: { chunk_size: { min: number; max: number }; chunk_overlap: { min: number; max: number } };
}

/** A chunking run that wrote nothing — the point of `chunking` having no I/O. */
export interface ChunkPreview {
  document_id: string;
  filename: string;
  settings: ChunkSettings;
  total_chunks: number;
  total_chars: number;
  size_min: number;
  size_max: number;
  size_avg: number;
  token_estimate_total: number;
  chunks: CorpusChunk[];
  truncated: boolean;
  extraction: { chars: number; page_count: number | null; extractor: string; warnings: string[] };
}

export interface IngestRun {
  run_id: string;
  kind: 'ingest' | 'rechunk' | 'reembed';
  status: 'running' | 'ok' | 'failed' | 'cancelled';
  stage: string | null;
  strategy: string;
  chunk_size: number;
  chunk_overlap: number;
  embedding_model: string | null;
  collection: string | null;
  documents_total: number;
  documents_done: number;
  chunks_written: number;
  vectors_written: number;
  started_at: string;
  finished_at: string | null;
  elapsed_ms: number | null;
  error: string | null;
  error_count?: number;
}

export interface IngestEvent {
  id: number;
  at: string;
  level: 'debug' | 'info' | 'warn' | 'error';
  stage: string;
  document_id: string | null;
  message: string;
  detail: unknown;
}

export interface CorpusStatus {
  corpus: {
    available: boolean;
    documents: number;
    bytes: number;
    chunks: number;
    embedded: number;
    failed_documents: number;
    last_run: { run_id: string; status: string; finished_at: string } | null;
    error: string | null;
  };
  settings: CorpusConfig;
  extraction: {
    extensions: string[];
    pdf_available: boolean;
    pdf_detail: string;
    ocr: boolean;
    ocr_detail: string;
  };
  embedding: {
    model: string | null;
    index_state: string;
    index_detail: string;
    collection: string | null;
    ollama_available: boolean;
  };
  active_run: string | null;
  runs: IngestRun[];
}

export const fetchCorpusStatus = () => request<CorpusStatus>('/api/corpus/status');

export const fetchCorpusDocuments = () =>
  request<{ available: true; documents: CorpusDocument[]; total: number }>('/api/corpus/documents');

/**
 * The body *is* the file. `/api/corpus/documents` takes raw bytes rather than
 * multipart, which keeps `python-multipart` out of the backend image — see the
 * module note there. Metadata rides in the query string.
 */
export const uploadDocument = (file: File, meta: { source_type: string; title?: string }) => {
  const params = new URLSearchParams({ filename: file.name, source_type: meta.source_type });
  if (meta.title) params.set('title', meta.title);
  return request<{ document: CorpusDocument }>(`/api/corpus/documents?${params}`, {
    method: 'POST',
    body: file,
    // A manual is megabytes and the server parses it before answering, which is
    // comfortably past the 15s default and is not a hung request.
    timeoutMs: 120_000,
    // Let the browser send the File as-is. A JSON content-type here would be a
    // lie and some proxies act on it.
    headers: { 'Content-Type': file.type || 'application/octet-stream' },
  });
};

export const deleteDocument = (id: string) =>
  request<{ deleted: string; chunks_removed: number; warning: string | null }>(
    `/api/corpus/documents/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  );

export const fetchDocumentChunks = (id: string, limit = 200) =>
  request<{ chunks: CorpusChunk[]; total: number }>(
    `/api/corpus/documents/${encodeURIComponent(id)}/chunks?limit=${limit}`,
  );

export const fetchCorpusConfig = () => request<CorpusConfig>('/api/corpus/config');

export const saveCorpusConfig = (settings: ChunkSettings) =>
  request<CorpusConfig & { note: string }>('/api/corpus/config', {
    method: 'PUT',
    body: JSON.stringify(settings),
  });

export const previewChunks = (documentId: string, settings: Partial<ChunkSettings>, limit = 12) =>
  request<ChunkPreview>('/api/corpus/preview', {
    method: 'POST',
    body: JSON.stringify({ document_id: documentId, ...settings, limit }),
  });

export const startIngest = (body: { document_ids?: string[] } & Partial<ChunkSettings> = {}) =>
  request<{ run: IngestRun }>('/api/corpus/ingest', {
    method: 'POST',
    body: JSON.stringify(body),
    // The endpoint holds the response until the run row exists (up to 8s), so
    // the client always gets either an id to poll or the reason there is none.
    timeoutMs: 30_000,
  });

export const resumeIngest = (documentId?: string) =>
  request<{ run: IngestRun }>('/api/corpus/resume', {
    method: 'POST',
    body: JSON.stringify({ document_id: documentId ?? null }),
    // Synchronous on the server — it embeds what one run already failed to.
    timeoutMs: 300_000,
  });

export const clearVectors = () =>
  request<{ cleared: number; warning: string | null; note: string }>('/api/corpus/clear-vectors', {
    method: 'POST',
  });

export const fetchRun = (runId: string) =>
  request<{ run: IngestRun; active: boolean }>(`/api/corpus/runs/${encodeURIComponent(runId)}`);

export const fetchRunEvents = (runId: string, level?: string) =>
  request<{ run_id: string; events: IngestEvent[] }>(
    `/api/corpus/runs/${encodeURIComponent(runId)}/events${level ? `?level=${level}` : ''}`,
  );

// ── graph authoring (Track 2) ────────────────────────────────────────────────

export interface GraphFieldSpec { name: string; hint: string }
export interface GraphNodeTypeSpec { id: NodeType; id_prefix: string; fields: GraphFieldSpec[] }
export interface GraphEdgeTypeSpec { id: EdgeType; from: NodeType; to: NodeType }

export interface GraphSchemaSpec {
  node_types: GraphNodeTypeSpec[];
  edge_types: GraphEdgeTypeSpec[];
}

/** One authored edit. Refused ones are kept — that is the debugging surface. */
export interface GraphEdit {
  edit_id: string;
  at: string;
  target: 'node' | 'edge' | 'graph';
  action: 'create' | 'update' | 'delete' | 'import';
  element_id: string | null;
  element_type: string | null;
  before_json: unknown;
  after_json: unknown;
  ok: number;
  error: string | null;
  nodes_after: number | null;
  edges_after: number | null;
  note: string | null;
}

export interface AuthoringStatus {
  valid: boolean;
  error: string | null;
  path: string;
  totals: { nodes: number; edges: number };
  by_type: { type: NodeType; count: number }[];
  edges_by_type: { type: EdgeType; count: number }[];
  coverage: { total_gaps?: number } & Record<string, unknown>;
  schema: GraphSchemaSpec;
  recent: GraphEdit[];
}

export const fetchAuthoringStatus = () =>
  request<AuthoringStatus>('/api/graph/authoring/status');

export const fetchAuthoringHistory = (onlyFailures = false, limit = 100) =>
  request<{ edits: GraphEdit[] }>(
    `/api/graph/authoring/history?limit=${limit}${onlyFailures ? '&only_failures=true' : ''}`,
  );

export const createGraphNode = (
  nodeType: string, nodeId: string, attributes: Record<string, unknown>,
) =>
  request<{ ok: true; nodes: number; edges: number }>('/api/graph/authoring/nodes', {
    method: 'POST',
    body: JSON.stringify({ node_type: nodeType, node_id: nodeId, attributes }),
  });

export const updateGraphNode = (nodeId: string, attributes: Record<string, unknown>) =>
  request<{ ok: true; nodes: number; edges: number }>(
    `/api/graph/authoring/nodes/${encodeURIComponent(nodeId)}`,
    { method: 'PATCH', body: JSON.stringify(attributes) },
  );

export const deleteGraphNode = (nodeId: string, cascade = false) =>
  request<{ ok: true; nodes: number; edges: number }>(
    `/api/graph/authoring/nodes/${encodeURIComponent(nodeId)}?cascade=${cascade}`,
    { method: 'DELETE' },
  );

export const createGraphEdge = (source: string, edgeType: string, target: string) =>
  request<{ ok: true; nodes: number; edges: number }>('/api/graph/authoring/edges', {
    method: 'POST',
    body: JSON.stringify({ source, edge_type: edgeType, target }),
  });

export const deleteGraphEdge = (source: string, edgeType: string, target: string) => {
  const params = new URLSearchParams({ source, edge_type: edgeType, target });
  return request<{ ok: true; nodes: number; edges: number }>(
    `/api/graph/authoring/edges?${params}`,
    { method: 'DELETE' },
  );
};

// ── retrieval replay (Track 1) ───────────────────────────────────────────────
//
// Track 2's counterpart to this is `fetchTraversal`. Both read `rag_logs` and
// neither re-runs anything: replaying by re-querying would show what the index
// returns *today* rather than what produced that answer, and Layer 10 has one
// source of truth.

export interface RetrievalSummary {
  query_id: string;
  timestamp: string;
  query_text: string;
  top_k: number | null;
  retrieval_latency_ms: number | null;
  vector_db_used: string | null;
  replayable: boolean;
}

export interface RetrievedChunk {
  rank: number;
  chunk_id: string;
  /** Cosine distance as Chroma returned it — never converted to a similarity. */
  distance: number | null;
  /**
   * True when the chunk id is no longer in the corpus. A real finding, not an
   * error: it says this answer was grounded in a passage the corpus can no
   * longer produce, usually because it was re-chunked since.
   */
  missing: boolean;
  text: string | null;
  source_file: string | null;
  source_type: string | null;
  page_number: number | null;
  section_title: string | null;
  ordinal: number | null;
}

export interface Retrieval {
  available: true;
  query_id: string;
  timestamp: string;
  track: 'vector';
  query_text: string;
  top_k: number | null;
  collection: string | null;
  retrieval_latency_ms: number | null;
  source_files: string[];
  chunks: RetrievedChunk[];
  missing_count: number;
}

export const fetchRetrievals = () =>
  request<{ available: true; retrievals: RetrievalSummary[]; total: number }>(
    '/api/corpus/retrievals',
  );

export const fetchRetrieval = (queryId: string) =>
  request<Retrieval | Unavailable>(`/api/corpus/retrieval/${encodeURIComponent(queryId)}`);

// ── assisted authoring: the proposal queue (Track 2) ─────────────────────────
//
// The model proposes, a person disposes. Nothing reaches the graph until an
// `accept` — which goes through the same authoring path a hand edit does, so an
// accepted proposal is validated and logged to `graph_edits` identically.

export interface GraphProposal {
  proposal_id: string;
  run_id: string;
  created_at: string;
  status: 'pending' | 'accepted' | 'rejected' | 'failed';
  target: 'node' | 'edge';
  node_type: string | null;
  element_id: string | null;
  attributes: Record<string, unknown>;
  source_id: string | null;
  edge_type: string | null;
  target_id: string | null;
  document_id: string | null;
  chunk_id: string | null;
  /** Quoted verbatim from the source chunk — what makes the proposal checkable. */
  evidence: string | null;
  model: string | null;
  /**
   * A **snapshot** from propose time, not a live verdict. An edge refused for a
   * missing endpoint becomes acceptable the moment that endpoint is accepted,
   * and `accept` re-validates for real — so this warns rather than blocks.
   */
  valid: number;
  validation_error: string | null;
  decided_error: string | null;
}

export interface ProposalRun {
  run_id: string;
  created_at: string;
  status: 'running' | 'ok' | 'failed';
  model: string | null;
  documents_read: number;
  chunks_read: number;
  proposed: number;
  duplicates: number;
  invalid: number;
  elapsed_ms: number | null;
  error: string | null;
}

export interface ProposalStatus {
  available: boolean;
  counts: { pending: number; accepted: number; rejected: number; failed: number };
  chunks_available: number;
  max_chunks: number;
  active_run: string | null;
  runs: ProposalRun[];
  error?: string;
}

export const fetchProposalStatus = () =>
  request<ProposalStatus>('/api/graph/proposals/status');

export const fetchProposals = (status = 'pending') =>
  request<{ proposals: GraphProposal[] }>(`/api/graph/proposals?status=${status}`);

export const generateProposals = (documentIds?: string[]) =>
  request<{ run: ProposalRun }>('/api/graph/proposals/generate', {
    method: 'POST',
    body: JSON.stringify({ document_ids: documentIds ?? null }),
    // One model call per chunk, up to MAX_CHUNKS. On CPU that is minutes.
    timeoutMs: 900_000,
  });

export const acceptProposal = (id: string) =>
  request<{ ok: true; nodes: number; edges: number }>(
    `/api/graph/proposals/${encodeURIComponent(id)}/accept`,
    { method: 'POST' },
  );

export const rejectProposal = (id: string) =>
  request<{ ok: true }>(`/api/graph/proposals/${encodeURIComponent(id)}/reject`, {
    method: 'POST',
  });
