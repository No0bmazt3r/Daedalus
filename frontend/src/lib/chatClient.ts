// The answering endpoint — POST /api/chat (Layer 7).
//
// Separate from sessionsClient because it is a different kind of call: sessions
// are CRUD over a transcript, this runs a model. It is also the only client
// call whose latency is measured in seconds rather than milliseconds, so it
// gets its own timeout.

import { request, streamEvents } from './http';
import type { ChatMessage } from './sessionsClient';

export interface ChatTimings {
  /** Wall clock, what the operator waited through. */
  time_to_first_token_ms: number | null;
  total_inference_ms: number | null;
  /** From Ollama's own counters — what the model cost, not what the machine was doing. */
  prefill_ms: number | null;
  generation_ms: number | null;
}

export interface ChatReply {
  query_id: string;
  session_id: string;
  /** The stored user turn, replacing the optimistic echo. */
  user_message: ChatMessage;
  /** The stored assistant turn. */
  message: ChatMessage;
  answer: string;
  /** Which model actually answered. Not necessarily the one requested. */
  model: string;
  model_choice: {
    tag: string | null;
    source: 'auto' | 'pinned' | 'config' | 'override';
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
}

/** One event from the answer stream. Exactly one `done` or `error` arrives. */
export interface ChatProgress {
  phase: 'generating' | 'done' | 'error';
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

export interface ChatStatus {
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
