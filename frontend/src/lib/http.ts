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
