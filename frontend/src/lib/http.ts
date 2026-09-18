// The shared fetch wrapper for every Daedalus API client.
//
// Extracted from systemClient when the Forge grew its own client: two copies of
// "how do we talk to the backend" would eventually disagree about timeouts or
// about how an error body is read, and the difference would show up as one
// panel reporting a useful message where another reported "HTTP 500".

const REQUEST_TIMEOUT_MS = 15000;

export interface RequestOptions extends RequestInit {
  /**
   * Override the abort timeout. The Forge needs it: a benchmark runs a warm-up
   * pass and a 2k-token prefill, which on a CPU-bound machine is comfortably
   * past fifteen seconds and is not a hung request.
   */
  timeoutMs?: number;
}

export async function request<T>(path: string, init?: RequestOptions): Promise<T> {
  const controller = new AbortController();
  const timer = window.setTimeout(
    () => controller.abort(),
    init?.timeoutMs ?? REQUEST_TIMEOUT_MS,
  );
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      signal: controller.signal,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    });
  } catch (err) {
    throw new Error(
      err instanceof Error && err.name === 'AbortError'
        ? 'the backend did not respond in time'
        : 'could not reach the backend',
    );
  } finally {
    window.clearTimeout(timer);
  }

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { detail?: unknown };
      if (typeof body.detail === 'string') detail = body.detail;
    } catch {
      /* non-JSON error body — the status is the message */
    }
    throw new Error(detail);
  }

  try {
    return (await res.json()) as T;
  } catch {
    // A 2xx that isn't JSON means something other than the API answered.
    throw new Error('the backend returned an unexpected response');
  }
}

// ── server-sent events ───────────────────────────────────────────────────────

export interface EventStream {
  /** Resolves when the server closes the stream, rejects if it breaks. */
  done: Promise<void>;
  /** Abort the request. `done` then rejects. */
  cancel: () => void;
}

/**
 * POST JSON, then read an SSE response frame by frame.
 *
 * Here rather than in each client for the same reason `request` is: chat and
 * the benchmark both stream, and two copies of the framing would eventually
 * disagree about something subtle — a frame split across two chunks, say,
 * which is the case that only shows up under a slow model.
 *
 * No timeout, deliberately. These are the two calls that are legitimately slow:
 * a long answer is minutes of a healthy connection, and the fifteen-second
 * abort `request` uses would kill every one of them.
 */
export function streamEvents<E>(
  path: string,
  body: unknown,
  onEvent: (event: E) => void,
): EventStream {
  const controller = new AbortController();

  const done = (async () => {
    const res = await fetch(path, {
      method: 'POST',
      body: JSON.stringify(body),
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    if (!res.body) throw new Error('the backend sent no response body');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      for (;;) {
        const { value, done: finished } = await reader.read();
        if (finished) break;
        buffer += decoder.decode(value, { stream: true });

        // A blank line ends a frame, so the last piece after the split is a
        // partial one. It stays in the buffer until the rest of it arrives.
        const frames = buffer.split('\n\n');
        buffer = frames.pop() ?? '';
        for (const frame of frames) {
          const line = frame.split('\n').find((l) => l.startsWith('data: '));
          if (!line) continue;
          let event: E;
          try {
            event = JSON.parse(line.slice(6)) as E;
          } catch {
            // Only the parse is guarded. Wrapping the callback too would
            // swallow whatever the caller threw whenever it was a SyntaxError.
            continue;
          }
          onEvent(event);
        }
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
  })();

  return { done, cancel: () => controller.abort() };
}
