// Labyrinth Blueprints — /api/graph and /api/corpus (MODULES.md §3).
//
// The knowledge map: what this system knows, and how it is connected. Two
// halves with very different readiness, and the types below keep that visible
// rather than smoothing it over.
//
// Every endpoint returns a discriminated `available` flag. That is not defensive
// coding — MODULES.md §0 rule 4 makes it the contract: a module whose data does
// not exist yet must say *which milestone* it is waiting on, because a blank
// panel that looks broken is worse than one that explains itself. The corpus
// half is blocked on M2 and answers that way today.
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

export interface CorpusDocuments extends Unavailable {
  documents: unknown[];
  total: number;
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

export const fetchCorpusDocuments = () => request<CorpusDocuments>('/api/corpus/documents');

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

export const setRagTrack = (track: RagTrack) =>
  request<RagConfig>('/api/rag/config', {
    method: 'PUT',
    body: JSON.stringify({ track }),
  });
