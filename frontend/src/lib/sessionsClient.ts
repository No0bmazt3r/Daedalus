// Client for the chat session API (backend/app/api/sessions.py).
//
// Conversation state lives on the server, not in this component tree and not
// in browser storage. That is deliberate: the transcript is replayed into the
// model's context on the next turn, so history the client could edit would be
// a client-controlled input to the prompt.
//
// The same reason is why there is no `role` on `appendUserMessage` — assistant
// turns are written by the orchestrator once it has actually produced them.

export interface ChatSession {
  session_id: string;
  created_at: string;
  updated_at: string;
  title: string | null;
  device_id: string;
  ephemeral: boolean;
  archived_at: string | null;
  message_count?: number | null;
}

export interface ChatSessionDetail extends ChatSession {
  summary: string | null;
  summary_upto_seq: number;
}

export interface ChatMessage {
  id: number;
  session_id: string;
  seq: number;
  role: 'user' | 'assistant';
  content: string;
  query_id: string | null;
  evidence: unknown;
  token_estimate: number;
  created_at: string;
  model_tag?: string;
}

const BASE = '/api/sessions';
const REQUEST_TIMEOUT_MS = 5000;

/** Thrown for any non-2xx response, carrying the status so callers can branch. */
export class SessionApiError extends Error {
  // Declared and assigned explicitly rather than as a constructor parameter
  // property: this project builds with `erasableSyntaxOnly`, which rejects
  // syntax that has to emit runtime code.
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'SessionApiError';
    this.status = status;
  }

  /** The session is gone — deleted in another tab, or the store was reset. */
  get isNotFound(): boolean {
    return this.status === 404;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      signal: controller.signal,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    });
  } catch (err) {
    // An abort and a dead backend are the same thing to the caller: the
    // request did not happen. Status 0 distinguishes it from an HTTP error.
    throw new SessionApiError(
      err instanceof Error && err.name === 'AbortError'
        ? 'the backend did not respond in time'
        : 'could not reach the backend',
      0,
    );
  } finally {
    window.clearTimeout(timer);
  }

  if (!res.ok) {
    let detail = `${res.status}`;
    try {
      const body = (await res.json()) as { detail?: unknown };
      if (typeof body.detail === 'string') detail = body.detail;
    } catch {
      /* a non-JSON error body is still an error; the status carries it */
    }
    throw new SessionApiError(detail, res.status);
  }

  if (res.status === 204) return undefined as T;

  try {
    return (await res.json()) as T;
  } catch {
    // A 2xx that is not JSON means something other than the API answered —
    // a dev proxy, or a container image that predates this endpoint and let
    // the SPA catch-all serve index.html. Report it as an API fault rather
    // than letting a parser error surface as the user-facing message.
    throw new SessionApiError('the backend returned an unexpected response', res.status);
  }
}

/** Open a new chat. `ephemeral` is incognito — never listed, swept on restart. */
export function createSession(
  options: { title?: string; ephemeral?: boolean } = {},
): Promise<ChatSessionDetail> {
  return request<ChatSessionDetail>(BASE, {
    method: 'POST',
    body: JSON.stringify({
      ...(options.title ? { title: options.title } : {}),
      ephemeral: options.ephemeral ?? false,
    }),
  });
}

/** The sidebar list, most recently updated first. */
export async function listSessions(limit = 50): Promise<ChatSession[]> {
  const data = await request<{ sessions: ChatSession[] }>(
    `${BASE}?limit=${encodeURIComponent(limit)}`,
  );
  return data.sessions;
}

export function getSession(id: string): Promise<ChatSessionDetail> {
  return request<ChatSessionDetail>(`${BASE}/${encodeURIComponent(id)}`);
}

export async function getMessages(id: string): Promise<ChatMessage[]> {
  const data = await request<{ messages: ChatMessage[] }>(
    `${BASE}/${encodeURIComponent(id)}/messages`,
  );
  return data.messages;
}

/**
 * Append a user message.
 *
 * There is no assistant equivalent here, and that is load bearing — see the
 * note at the top of this file.
 */
export function appendUserMessage(id: string, content: string): Promise<ChatMessage> {
  return request<ChatMessage>(`${BASE}/${encodeURIComponent(id)}/messages`, {
    method: 'POST',
    body: JSON.stringify({ content }),
  });
}

export function renameSession(id: string, title: string): Promise<ChatSessionDetail> {
  return request<ChatSessionDetail>(`${BASE}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ title }),
  });
}

export function archiveSession(id: string, archived = true): Promise<ChatSessionDetail> {
  return request<ChatSessionDetail>(`${BASE}/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ archived }),
  });
}

/** Deletes the chat and its messages. Audit rows in ai_logs.db are untouched. */
export async function deleteSession(id: string): Promise<boolean> {
  const data = await request<{ deleted: boolean }>(`${BASE}/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  return data.deleted;
}

/** A chat with no title yet is shown by a placeholder, never by a blank row. */
export function sessionLabel(session: ChatSession): string {
  return session.title?.trim() || 'New chat';
}
