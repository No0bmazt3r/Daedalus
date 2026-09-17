// The answering endpoint — POST /api/chat (Layer 7).
//
// Separate from sessionsClient because it is a different kind of call: sessions
// are CRUD over a transcript, this runs a model. It is also the only client
// call whose latency is measured in seconds rather than milliseconds, so it
// gets its own timeout.

import { request } from './http';
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

/**
 * Ask a question and get an answer.
 *
 * The server records both turns, so a caller must not also POST the user
 * message — that would store it twice.
 *
 * `model` overrides the committed choice for this request only, and only for a
 * locally installed model. An override the server refused comes back in
 * `model_choice.reason` rather than failing, so the UI can say what answered.
 */
export interface ChatProgress {
  phase: 'generating' | 'done' | 'error';
  piece?: string;
  result?: ChatReply;
  error?: string;
}

export function sendChat(
  sessionId: string,
  message: string,
  model: string | null,
  onProgress: (p: ChatProgress) => void,
): Promise<ChatReply> {
  const controller = new AbortController();
  let buffer = '';

  return (async () => {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sessionId, message, model: model || null }),
      signal: controller.signal,
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    }

    if (!res.body) throw new Error('No response body');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let finalReply: ChatReply | undefined = undefined;

    while (true) {
      const { value, done: finished } = await reader.read();
      if (finished) break;
      buffer += decoder.decode(value, { stream: true });

      const frames = buffer.split('\n\n');
      buffer = frames.pop() ?? '';
      for (const frame of frames) {
        const line = frame.split('\n').find((l) => l.startsWith('data: '));
        if (!line) continue;
        try {
          const event = JSON.parse(line.slice(6)) as ChatProgress;
          onProgress(event);
          if (event.phase === 'error') {
             throw new Error(event.error ?? 'Unknown error');
          }
          if (event.phase === 'done' && event.result) {
             finalReply = event.result;
          }
        } catch (err) {
          if (err instanceof SyntaxError) continue;
          throw err;
        }
      }
    }

    if (!finalReply) throw new Error('Stream ended without a final result');
    return finalReply;
  })();
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

export function checkChatStatus(sessionId: string): Promise<{ generating: boolean; model?: string; started_at?: number }> {
  return request<{ generating: boolean; model?: string; started_at?: number }>(`/api/chat/${encodeURIComponent(sessionId)}/status`);
}
