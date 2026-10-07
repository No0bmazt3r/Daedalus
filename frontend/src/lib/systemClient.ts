// Clients for the diagnostic and configuration APIs:
//   /api/logs       — read-only browser over the stores (backend/app/api/logs.py)
//   /api/providers  — cloud endpoints for the evaluation baseline
//   /api/system     — store health, and where the metrics stack lives
//
// None of these is on the chat path. The log browser backs the sidebar's Data
// stores section; the rest are Settings-only.

import { request } from './http';

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
  const data = await request<{ stores: LogStore[] }>('/api/logs/catalogue', { cache: 'no-store' });
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
    { cache: 'no-store' }
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

// ── the Forge — hardware detection ───────────────────────────────────────────

export interface GpuDevice {
  name: string;
  vram_total_bytes: number | null;
  vram_used_bytes: number | null;
  driver_version: string | null;
}

/** Per-section freshness. Tiers and their rates live in the backend service. */
export interface HardwareSectionMeta {
  tier: 'static' | 'live' | 'slow';
  captured_at: string | null;
  age_seconds: number | null;
  interval_seconds: number | null;
}

/**
 * How current the snapshot is.
 *
 * Detection no longer runs inside the request — it costs seconds on a real
 * machine — so the age travels with the numbers. A cached figure presented as
 * live would be worse than a slow panel, which is the whole reason this block
 * exists.
 */
export interface HardwareRefreshMeta {
  /** Newest probe in the snapshot, ISO 8601 UTC. */
  captured_at: string | null;
  /** Age of the *oldest* live figure — the snapshot is only as fresh as that. */
  age_seconds: number | null;
  /** Past two missed refreshes. The UI says so rather than implying live data. */
  stale: boolean;
  live_interval_seconds: number;
  slow_interval_seconds: number;
  /** False when the loop is dormant: numbers then advance only on a read. */
  background: boolean;
  next_refresh_in_seconds: number;
  sections: Record<string, HardwareSectionMeta>;
}

/** The Windows host's totals, when this is running under WSL. Null otherwise. */
export interface HostMachine {
  memory_total_bytes: number | null;
  cpu_model: string | null;
  cores_physical: number | null;
  cores_logical: number | null;
  base_clock_mhz: number | null;
  gpus: string[];
}

export interface HardwareProfile {
  host: {
    platform: string | null;
    release: string | null;
    python: string;
    wsl: boolean;
    /**
     * True when the backend is in a container, which is what every figure below
     * is describing: a cgroup's CPU allowance, and no GPU at all unless one was
     * passed through. Named in the Platform stat for that reason.
     */
    container: boolean;
  };
  cpu: {
    model: string | null;
    arch: string | null;
    cores_physical: number | null;
    cores_logical: number | null;
    /** Base clock, not the turbo ceiling — named for what the backend reads. */
    base_clock_mhz: number | null;
    load_percent: number | null;
  };
  memory: {
    total_bytes: number | null;
    available_bytes: number | null;
    used_percent: number | null;
    swap_total_bytes: number | null;
    /** Which probe answered: 'psutil', '/proc/meminfo' or 'sysconf'. */
    source: string | null;
    /** Why a richer probe did not — set even when a fallback succeeded. */
    error: string | null;
  };
  disk: { path: string; total_bytes: number | null; free_bytes: number | null };
  gpu: { available: boolean; source: string | null; devices: GpuDevice[]; error: string | null };
  ollama: {
    base_url: string;
    reachable: boolean;
    version: string | null;
    resolved_url: string | null;
    /** Whether the daemon is visible in the backend's own process namespace. */
    runs_here: boolean;
  };
  /** Null unless under WSL with interop available — names which machine the rest describes. */
  host_machine: HostMachine | null;
  detector: string;
  refresh: HardwareRefreshMeta;
}

/**
 * What this machine is. Always answers; unknowns come back null.
 *
 * Cheap — the backend serves a snapshot a background task keeps warm, so this
 * is safe to poll while the panel is open and costs about a millisecond. It is
 * also the signal that keeps that task awake: it goes dormant when nothing has
 * read the profile for a couple of minutes.
 */
export function hardwareProfile(): Promise<HardwareProfile> {
  return request<HardwareProfile>('/api/forge/hardware');
}

/**
 * Force a full re-probe — the Re-detect button.
 *
 * The expensive path, deliberately: it pays for every probe, including the
 * ~2.5s WSL interop call the cache exists to avoid. Seconds, not milliseconds.
 */
export function redetectHardware(): Promise<HardwareProfile> {
  return request<HardwareProfile>('/api/forge/hardware/refresh', { method: 'POST' });
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

/** What Ollama says a model can do. Open-ended: unknown values are ignored. */
export type ModelCapability =
  | 'completion' | 'tools' | 'thinking' | 'vision' | 'insert' | 'embedding';

export interface SystemModel {
  id: string;
  name: string;
  provider: string;
  /**
   * Where it runs. `cloud` is selectable, but it is an evaluation override
   * rather than the production path — the turn is logged `chat_cloud` and the
   * transcript marks it. See `note`.
   */
  type: 'local' | 'cloud';
  /** From Ollama's `/api/show`. Empty when it could not be asked. */
  capabilities?: ModelCapability[];
  /** The warning to show beside a cloud model. Null for local ones. */
  note?: string | null;
  details?: Record<string, unknown>;
}

export async function listModels(): Promise<SystemModel[]> {
  const data = await request<{ models: SystemModel[] }>('/api/system/models');
  return data.models;
}
