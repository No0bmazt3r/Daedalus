// The answering endpoint — POST /api/chat (Layer 7).
//
// Separate from sessionsClient because it is a different kind of call: sessions
// are CRUD over a transcript, this runs a model. It is also the only client
// call whose latency is measured in seconds rather than milliseconds, so it
// gets its own timeout.

import { request, streamEvents } from './http';
import type { ChatMessage } from './sessionsClient';

interface ChatTimings {
  /** Wall clock, what the operator waited through. */
  time_to_first_token_ms: number | null;
  total_inference_ms: number | null;
  /** From Ollama's own counters — what the model cost, not what the machine was doing. */
  prefill_ms: number | null;
  generation_ms: number | null;
}

/** One evidence label an answer may cite — `[S1]` a reading, `[D1]` a passage, `[G1]` a graph node. */
interface ChatCitation {
  label: string;
  kind: 'sensor' | 'document' | 'graph';
  tool: string;
  type: 'sqlite' | 'document' | 'graph';
  [detail: string]: unknown;
}

/** Step 10's verdict. When `passed` is false the answer is the fixed fallback. */
interface ChatValidation {
  passed: boolean;
  reasons: string[];
  unsupported_numbers: string[];
  stale_numbers: string[];
  unknown_citations: string[];
  /** Reading labels (`S…`) cited on a sentence that states nothing from that reading. */
  mismatched_citations: string[];
  cited: string[];
  control_claim: string | null;
}

/**
 * The evidence pack stored with an assistant turn (`message.evidence`). Shown
 * as citations under the answer; never replayed into a prompt.
 */
export interface StoredEvidence {
  citations: { label: string; kind: string; tool: string; [detail: string]: unknown }[]
  /** label → the line the model was shown, prefixed with its own label. */
  lines: Record<string, string>
  failures: string[]
  notes: string[]
  tools_used: string[]
}

export function asEvidence(value: unknown): StoredEvidence | undefined {
  if (!value || typeof value !== 'object') return undefined
  const v = value as Partial<StoredEvidence>
  if (!Array.isArray(v.citations) || !v.lines || typeof v.lines !== 'object') return undefined
  return {
    citations: v.citations,
    lines: v.lines,
    failures: v.failures ?? [],
    notes: v.notes ?? [],
    tools_used: v.tools_used ?? [],
  }
}

interface ChatReply {
  query_id: string;
  session_id: string;
  /** The stored user turn, replacing the optimistic echo. */
  user_message: ChatMessage;
  /** The stored assistant turn. */
  message: ChatMessage;
  answer: string;
  /** Which model actually answered. Not necessarily the one requested; null when none ran (a refusal). */
  model: string | null;
  model_choice: {
    tag: string | null;
    source: 'auto' | 'pinned' | 'config' | 'override' | 'pipeline';
    reason: string;
    rejected?: string;
  };
  timings: ChatTimings;
  context: {
    history_messages: number;
    dropped: number;
    estimated_tokens: number;
    needs_summary: boolean;
  };
  /** architecture/07's response contract — PROJECT.md §7.1 steps 3–11. */
  intent: string | null;
  tools_used: string[];
  citations: ChatCitation[];
  /** Validation passed, there was evidence, and the answer cited it. */
  grounded: boolean;
  validation: ChatValidation | null;
  latency_ms: number;
}

/** One event from the answer stream. Exactly one `done` or `error` arrives. */
interface ChatProgress {
  /**
   * In order: `understood` (steps 1–4), `evidence` (5–7), `generating` per
   * token, `validated` (10), then `done` or `error`. Streamed tokens are
   * provisional — `done` carries the stored answer, which is the fallback when
   * validation rejected what streamed.
   */
  phase: 'understood' | 'evidence' | 'generating' | 'validated' | 'done' | 'error';
  piece?: string;
  result?: ChatReply;
  error?: string;
}

/**
 * Ask a question and get an answer, streamed.
 *
 * The server records both turns, so a caller must not also POST the user
 * message — that would store it twice.
 *
 * `model` overrides the committed choice for this request only, and only for a
 * locally installed model. An override the server refused comes back in
 * `model_choice.reason` rather than failing, so the UI can say what answered.
 *
 * `onProgress` sees every event; the promise is the whole answer, for callers
 * that only want the finished turn. A failure arrives as an `error` event
 * rather than a rejected fetch — the response has already started by then — so
 * it is recorded and thrown once the stream closes.
 */
export function sendChat(
  sessionId: string,
  message: string,
  model: string | null,
  onProgress: (p: ChatProgress) => void,
): Promise<ChatReply> {
  let reply: ChatReply | undefined;
  let failure: string | undefined;

  const { done } = streamEvents<ChatProgress>(
    '/api/chat',
    { session_id: sessionId, message, model: model || null },
    (event) => {
      onProgress(event);
      if (event.phase === 'error') failure = event.error ?? 'the model did not answer';
      if (event.phase === 'done' && event.result) reply = event.result;
    },
  );

  return done.then(() => {
    if (failure) throw new Error(failure);
    if (!reply) throw new Error('the answer stream ended without a result');
    return reply;
  });
}

export interface ActiveChatModel {
  tag: string | null;
  mode: 'auto' | 'pinned';
  resolved: boolean;
  reason: string;
}

/** Which model would answer right now. In `auto` this depends on the machine. */
export function activeChatModel(): Promise<ActiveChatModel> {
  return request<ActiveChatModel>('/api/chat/model');
}

interface ChatStatus {
  generating: boolean;
  model?: string;
  started_at?: number;
}

/**
 * Whether an answer is still being generated for this session.
 *
 * The generation outlives the request that started it, so a client that
 * reloaded or navigated away has no other way to find out.
 */
export function checkChatStatus(sessionId: string): Promise<ChatStatus> {
  return request<ChatStatus>(`/api/chat/${encodeURIComponent(sessionId)}/status`);
}

/** +1 up, -1 down, 0 withdrawn. Appended to `feedback_logs`; the newest counts. */
export type Rating = -1 | 0 | 1;

export function rateAnswer(queryId: string, rating: Rating, sessionId: string | null): Promise<unknown> {
  return request('/api/chat/feedback', {
    method: 'POST',
    body: JSON.stringify({ query_id: queryId, rating, session_id: sessionId }),
  });
}

/** The current rating of every rated answer in a chat, `{query_id: ±1}`. */
export async function fetchRatings(sessionId: string): Promise<Record<string, number>> {
  const data = await request<{ ratings: Record<string, number> }>(
    `/api/chat/feedback?session_id=${encodeURIComponent(sessionId)}`,
  );
  return data.ratings;
}
