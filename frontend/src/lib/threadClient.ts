// Ariadne's Thread — /api/trace (MODULES.md §1).
//
// One chat turn, reassembled from the audit log: the chain that produced the
// answer, and every number in it marked against the evidence. Read-only; the
// backend owns every decision (`services/thread.py`), this file only types it.

import { request } from './http';

/** How a turn ended. See `thread.status()` for each word's meaning. */
export type TraceStatus = 'grounded' | 'ungrounded' | 'blocked' | 'refused' | 'no_model' | 'error';

/** The chat a turn came from. `exists` is false once that chat was deleted. */
export interface TraceChat {
  session_id: string;
  title: string | null;
  exists: boolean;
  incognito: boolean;
}

/** The three buckets the list files every turn into (Settings → Ariadne's Thread). */
export type TraceBucket = 'grounded' | 'ungrounded' | 'unchecked';

/** A person's verdict on an answer — the evaluation's ground truth. */
export interface TraceLabel {
  hallucinated: boolean;
  note: string | null;
  timestamp: string;
}

export interface TraceSummary {
  query_id: string;
  timestamp: string;
  session_id: string | null;
  chat: TraceChat | null;
  question: string;
  intent: string | null;
  model: string | null;
  status: TraceStatus;
  /** Where Settings files this status. */
  bucket: TraceBucket;
  /** What the validator recorded, whatever the settings say. */
  grounded: boolean | null;
  latency_ms: number | null;
  tool_count: number;
  retrieval_count: number;
  error_count: number;
  tracks: string[];
  label: TraceLabel | null;
}

/** Figures over every turn the filters match, not just the page. */
export interface TraceStats {
  total: number;
  by_status: Partial<Record<TraceStatus, number>>;
  by_bucket: Partial<Record<TraceBucket, number>>;
  latency_p50_ms: number | null;
  latency_p95_ms: number | null;
  labelled: number;
  hallucinated: number;
}

export interface TracePage {
  items: TraceSummary[];
  total: number;
  stats: TraceStats;
  /** The buckets' names, as Settings has them. */
  labels: Record<TraceBucket, string>;
  /** Which bucket each status is filed in, as Settings has it. */
  buckets: Record<TraceStatus, TraceBucket>;
}

export type StepKind =
  | 'query' | 'understanding' | 'tool' | 'retrieval' | 'evidence'
  | 'context' | 'model' | 'validation' | 'answer' | 'error' | 'feedback' | 'label';

export interface TraceStep {
  kind: StepKind;
  title: string;
  at: string | null;
  /** How long the step took, where the log records it. */
  ms: number | null;
  status: string;
  detail: Record<string, unknown>;
  /** The audit table this step's row is in, or null (the evidence lives with the chat). */
  table: string | null;
}

export interface Trace {
  query_id: string;
  summary: TraceSummary | null;
  total_ms: number | null;
  steps: TraceStep[];
  /** False once the chat was deleted: the trace reads, its evidence does not. */
  evidence_available: boolean;
}

export type NumberVerdict = 'supported' | 'unsupported' | 'stale' | 'not_a_claim' | 'unchecked';

export interface NumberMark {
  text: string;
  start: number;
  end: number;
  value: number;
  unit: string | null;
  verdict: NumberVerdict;
  reason: string;
  sources: { label: string; line: string }[];
}

export interface Groundedness {
  query_id: string;
  /** What the model wrote — the text being judged. */
  answer: string;
  /** What the operator was shown, which is the fallback when `replaced`. */
  delivered: string | null;
  replaced: boolean;
  status: TraceStatus;
  grounded: boolean | null;
  validation: Record<string, unknown> | null;
  numbers: NumberMark[];
  counts: Partial<Record<NumberVerdict, number>>;
  citations: { label: string; line: string | null }[];
  evidence_available: boolean;
  /** An incognito turn: no text was kept, so nothing is marked. */
  redacted: boolean;
}

export interface TraceFilters {
  limit?: number;
  offset?: number;
  session_id?: string;
  intent?: string;
  model?: string;
  track?: 'vector' | 'graph';
  /** ISO timestamp, inclusive. */
  since?: string;
  /** ISO timestamp, exclusive. */
  until?: string;
  bucket?: TraceBucket;
  labelled?: 'yes' | 'no';
  q?: string;
}

export function fetchTraces(filters: TraceFilters = {}): Promise<TracePage> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const qs = params.toString();
  return request(`/api/trace${qs ? `?${qs}` : ''}`);
}

export function fetchTrace(queryId: string): Promise<Trace> {
  return request(`/api/trace/${encodeURIComponent(queryId)}`);
}

export function fetchGroundedness(queryId: string): Promise<Groundedness> {
  return request(`/api/trace/${encodeURIComponent(queryId)}/groundedness`);
}

/** Label an answer; `hallucinated: null` withdraws the label. Returns the label in force. */
export async function saveLabel(queryId: string, hallucinated: boolean | null, note: string | null): Promise<TraceLabel | null> {
  const body = await request<{ label: TraceLabel | null }>(`/api/trace/${encodeURIComponent(queryId)}/label`, {
    method: 'PUT',
    body: JSON.stringify({ hallucinated, note }),
  });
  return body.label;
}

/** Settings → Ariadne's Thread. Relabels the view only; never the record. */
export interface ThreadSettings {
  require_citation: boolean;
  require_evidence: boolean;
  buckets: Record<TraceStatus, TraceBucket>;
  labels: Record<TraceBucket, string>;
}

export interface ThreadSettingsPatch {
  require_citation?: boolean | null;
  require_evidence?: boolean | null;
  buckets?: Partial<Record<TraceStatus, TraceBucket>> | null;
  labels?: Partial<Record<TraceBucket, string | null>> | null;
  reset?: true;
}

export function fetchThreadSettings(): Promise<{ settings: ThreadSettings; defaults: ThreadSettings }> {
  return request('/api/trace/settings');
}

export function saveThreadSettings(patch: ThreadSettingsPatch): Promise<{ settings: ThreadSettings; defaults: ThreadSettings }> {
  return request('/api/trace/settings', { method: 'PUT', body: JSON.stringify(patch) });
}

/**
 * Ask the shell to open the Thread on one answer. An event rather than a prop
 * because the chat sits under the router's `Outlet`, which the shell does not
 * pass callbacks through — the same reason `focusComposer` is an event.
 */
export const OPEN_THREAD_EVENT = 'daedalus:open-thread';

/** Ask the shell to open Data stores on one table — a trace step's raw rows. */
export const OPEN_STORE_EVENT = 'daedalus:open-store';

export function openStore(store: string, table: string) {
  window.dispatchEvent(new CustomEvent(OPEN_STORE_EVENT, { detail: { store, table } }));
}

export function openThread(queryId?: string) {
  window.dispatchEvent(new CustomEvent(OPEN_THREAD_EVENT, { detail: { queryId } }));
}
