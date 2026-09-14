// Clients for the diagnostic and configuration APIs:
//   /api/logs       — read-only browser over the stores (backend/app/api/logs.py)
//   /api/providers  — cloud endpoints for the evaluation baseline
//   /api/system     — store health, and where the metrics stack lives
//
// None of these is on the chat path. The log browser backs the sidebar's Data
// stores section; the rest are Settings-only.

const REQUEST_TIMEOUT_MS = 15000;

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

// ── raw log browser ──────────────────────────────────────────────────────────

export interface LogTable {
  name: string;
  rows: number | null;
}

export interface LogStore {
  store: string;
  label: string;
  path: string;
  available: boolean;
  tables: LogTable[];
  error?: string;
}

export interface LogPage {
  store: string;
  table: string;
  columns: string[];
  rows: Record<string, unknown>[];
  total: number;
  limit: number;
  offset: number;
  available: boolean;
  redacted_columns?: string[];
}

export async function logCatalogue(): Promise<LogStore[]> {
  const data = await request<{ stores: LogStore[] }>('/api/logs/catalogue');
  return data.stores;
}

export function readLogTable(
  store: string,
  table: string,
  opts: { limit?: number; offset?: number; newestFirst?: boolean } = {},
): Promise<LogPage> {
  const params = new URLSearchParams({
    limit: String(opts.limit ?? 100),
    offset: String(opts.offset ?? 0),
    newest_first: String(opts.newestFirst ?? true),
  });
  return request<LogPage>(
    `/api/logs/${encodeURIComponent(store)}/${encodeURIComponent(table)}?${params}`,
  );
}

// ── observability ────────────────────────────────────────────────────────────

export interface Observability {
  url: string;
  configured: boolean;
}

/** Where the metrics/logs stack lives, if one is configured. See TODO.md, M7. */
export function observability(): Promise<Observability> {
  return request<Observability>('/api/system/observability');
}

// ── cloud model endpoints ────────────────────────────────────────────────────

export interface Provider {
  id: string;
  label: string;
  base_url: string;
  docs: string;
}

export interface ModelEndpoint {
  id: string;
  created_at: string;
  updated_at: string;
  label: string;
  provider: string;
  base_url: string;
  /** Masked — the real key never leaves the backend. */
  key_hint: string | null;
  has_key: boolean;
  enabled: boolean;
  purpose: string;
  last_tested_at: string | null;
  last_test_ok: boolean | null;
  last_test_detail: string | null;
  last_test_models: number | null;
}

export async function providerCatalogue(): Promise<Provider[]> {
  const data = await request<{ providers: Provider[] }>('/api/providers/catalogue');
  return data.providers;
}

export async function listEndpoints(): Promise<ModelEndpoint[]> {
  const data = await request<{ endpoints: ModelEndpoint[] }>('/api/providers');
  return data.endpoints;
}

export function addEndpoint(body: {
  provider: string;
  base_url: string;
  api_key: string;
  label?: string;
}): Promise<ModelEndpoint> {
  return request<ModelEndpoint>('/api/providers', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/**
 * Runs the provider's model-list call and returns the endpoint with its
 * verdict recorded. A rejected key resolves — it is a finding, not an error —
 * so read `last_test_ok`, don't rely on this throwing.
 */
export function testEndpoint(id: string): Promise<ModelEndpoint> {
  return request<ModelEndpoint>(`/api/providers/${encodeURIComponent(id)}/test`, {
    method: 'POST',
  });
}

export function updateEndpoint(
  id: string,
  body: { label?: string; api_key?: string; enabled?: boolean },
): Promise<ModelEndpoint> {
  return request<ModelEndpoint>(`/api/providers/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(body),
  });
}

export async function deleteEndpoint(id: string): Promise<boolean> {
  const data = await request<{ deleted: boolean }>(
    `/api/providers/${encodeURIComponent(id)}`,
    { method: 'DELETE' },
  );
  return data.deleted;
}

// ── system models ────────────────────────────────────────────────────────────

export interface SystemModel {
  id: string;
  name: string;
  provider: string;
  type: 'local' | 'cloud';
  details?: Record<string, unknown>;
}

export async function listModels(): Promise<SystemModel[]> {
  const data = await request<{ models: SystemModel[] }>('/api/system/models');
  return data.models;
}
