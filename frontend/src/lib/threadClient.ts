// Ariadne's Thread — /api/trace (MODULES.md §1).
//
// One chat turn, reassembled from the audit log: the chain that produced the
// answer, and every number in it marked against the evidence. Read-only; the
// backend owns every decision (`services/thread.py`), this file only types it.

import { request } from './http';

/** How a turn ended. See `thread.status()` for each word's meaning. */
export type TraceStatus = 'grounded' | 'ungrounded' | 'blocked' | 'refused' | 'no_model' | 'error';

export interface TraceSummary {
  query_id: string;
  timestamp: string;
  session_id: string | null;
  question: string;
  intent: string | null;
  model: string | null;
  status: TraceStatus;
  grounded: boolean | null;
  latency_ms: number | null;
  tool_count: number;
  retrieval_count: number;
  error_count: number;
}

export type StepKind =
  | 'query' | 'understanding' | 'tool' | 'retrieval' | 'evidence'
  | 'context' | 'model' | 'validation' | 'answer' | 'error' | 'feedback';

export interface TraceStep {
  kind: StepKind;
  title: string;
  at: string | null;
  /** How long the step took, where the log records it. */
  ms: number | null;
  status: string;
  detail: Record<string, unknown>;
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
}

export interface TraceFilters {
  limit?: number;
  offset?: number;
  session_id?: string;
  intent?: string;
  grounded?: 'yes' | 'no' | 'unchecked';
  q?: string;
}

export function fetchTraces(filters: TraceFilters = {}): Promise<{ items: TraceSummary[]; total: number }> {
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

/**
 * Ask the shell to open the Thread on one answer. An event rather than a prop
 * because the chat sits under the router's `Outlet`, which the shell does not
 * pass callbacks through — the same reason `focusComposer` is an event.
 */
export const OPEN_THREAD_EVENT = 'daedalus:open-thread';

export function openThread(queryId?: string) {
  window.dispatchEvent(new CustomEvent(OPEN_THREAD_EVENT, { detail: { queryId } }));
}
