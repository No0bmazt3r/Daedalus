// System maintenance — /api/system/{logs,export,import,wipe}.
//
// A setup client (Rule 5). Nothing here is reachable from the chat path and no
// agent tool wraps it: a model that could call `wipe` could end a study.

import { request, type RequestOptions } from './http';

/** One parsed line. `level` is null for a traceback's continuation lines. */
export interface LogLine {
  at: string | null;
  level: 'DEBUG' | 'INFO' | 'WARNING' | 'ERROR' | 'CRITICAL' | null;
  logger: string | null;
  message: string;
  raw: string;
}

export interface LogTail {
  path: string;
  exists: boolean;
  lines: LogLine[];
  returned: number;
  truncated: boolean;
  levels: string[];
}

/** One thing the Danger Zone can empty. */
export interface WipeCategory {
  kind: string;
  label: string;
  detail: string;
  /** True when the copy around it needs to be heavier — the audit log. */
  grave: boolean;
}

export interface WipeResult {
  kind?: string;
  label?: string;
  count?: number;
  detail: string;
  /** Present only for `everything`, one entry per category. */
  results?: { kind: string; ok: boolean; count: number; detail: string }[];
  total?: number;
}

export interface ImportResult {
  ok: boolean;
  restored: Record<string, number>;
  skipped: string[];
  detail: string;
}

// A wipe walks several stores and a Chroma instance; a poll of the log should
// not wait as long as one.
const SLOW: RequestOptions = { timeoutMs: 60000 };

export const fetchLogs = (opts: { limit?: number; level?: string; q?: string } = {}) => {
  const params = new URLSearchParams();
  if (opts.limit) params.set('limit', String(opts.limit));
  // 'ALL' is the viewer's word for no filter; the backend takes its absence.
  if (opts.level && opts.level !== 'ALL') params.set('level', opts.level);
  if (opts.q) params.set('q', opts.q);
  return request<LogTail>(`/api/system/logs?${params}`);
};

export const fetchWipeCategories = () =>
  request<{ categories: WipeCategory[] }>('/api/system/wipe');

export const wipe = (kind: string) =>
  request<WipeResult>(`/api/system/wipe/${encodeURIComponent(kind)}`, {
    ...SLOW,
    method: 'DELETE',
  });

export const importData = (payload: unknown) =>
  request<ImportResult>('/api/system/import', {
    ...SLOW,
    method: 'POST',
    body: JSON.stringify(payload),
  });

/**
 * Download the backup.
 *
 * Not through `request()`: this one wants the raw body and the filename the
 * server chose, and a JSON-parsing wrapper would be in the way of both.
 */
export async function downloadExport(): Promise<string> {
  const res = await fetch('/api/system/export', { credentials: 'same-origin' });
  if (!res.ok) throw new Error(`export failed (HTTP ${res.status})`);

  const disposition = res.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename="?([^";]+)"?/);
  const filename = match ? match[1] : 'daedalus-backup.json';

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
  return filename;
}

// ── Side-car containers ──────────────────────────────────────────────────────
//
// Only available when a Docker socket is mounted into the backend, which is off
// by default. See `services/containers.py` for why that default is not a
// convenience setting: a process that can reach the socket can do anything
// Docker can on the host, and the agent's `bash` tool runs in the same
// container.

export interface ManagedContainer {
  name: string;
  container: string;
  label: string;
  purpose: string;
  /** The one command that creates it, when it has never been created. */
  compose_hint: string;
  control_available: boolean;
  exists: boolean;
  running: boolean;
  state: string | null;
  error: string | null;
}

export interface ContainerStatus {
  control_available: boolean;
  containers: ManagedContainer[];
}

export const fetchContainers = () =>
  request<ContainerStatus>('/api/system/containers');

/** Start or stop one managed container. Never create or remove — compose owns that. */
export const containerAction = (name: string, action: 'start' | 'stop') =>
  request<{ detail: string; running: boolean; containers: ManagedContainer[] }>(
    `/api/system/containers/${encodeURIComponent(name)}/${action}`,
    { ...SLOW, method: 'POST' },
  );
