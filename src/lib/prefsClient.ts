// Client for the FastAPI preference store (backend/app/api/prefs.py).
//
// This is the only persistence the UI has — nothing is kept in localStorage.
// Writes are coalesced per key so dragging a colour picker produces one
// request per idle moment rather than one per pixel.

export const PREF_THEME = 'theme';
export const PREF_CUSTOM_THEMES = 'custom-themes';
export const PREF_UI_SCALE = 'ui-scale';

export type PrefKey = typeof PREF_THEME | typeof PREF_CUSTOM_THEMES | typeof PREF_UI_SCALE;

export type SyncStatus = 'loading' | 'ready' | 'offline';

const BASE = '/api/prefs';
const WRITE_DEBOUNCE_MS = 350;
const REQUEST_TIMEOUT_MS = 5000;

async function request(path: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(path, {
      ...init,
      signal: controller.signal,
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    });
  } finally {
    window.clearTimeout(timer);
  }
}

/** Everything the backend has stored, in one round trip. */
export async function loadAllPrefs(): Promise<Record<string, unknown>> {
  const res = await request(BASE);
  if (!res.ok) throw new Error(`prefs load failed: ${res.status}`);
  const data = (await res.json()) as { values?: Record<string, unknown> };
  return data.values || {};
}

const pending = new Map<PrefKey, { value: unknown; timer: number }>();
const inFlight = new Set<PrefKey>();

type WriteListener = (status: 'saved' | 'failed', key: PrefKey) => void;
const listeners = new Set<WriteListener>();

export function onWrite(fn: WriteListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit(status: 'saved' | 'failed', key: PrefKey) {
  listeners.forEach((fn) => fn(status, key));
}

async function flush(key: PrefKey, value: unknown) {
  inFlight.add(key);
  try {
    const res = await request(`${BASE}/${key}`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
    });
    emit(res.ok ? 'saved' : 'failed', key);
  } catch {
    emit('failed', key);
  } finally {
    inFlight.delete(key);
  }
}

/** Queue a write, collapsing rapid successive changes to the same key. */
export function savePref(key: PrefKey, value: unknown) {
  const existing = pending.get(key);
  if (existing) window.clearTimeout(existing.timer);
  const timer = window.setTimeout(() => {
    pending.delete(key);
    void flush(key, value);
  }, WRITE_DEBOUNCE_MS);
  pending.set(key, { value, timer });
}

/**
 * Push any queued writes immediately — used when the page is going away.
 * `keepalive` is what lets the request outlive the document; sendBeacon is no
 * use here because it can only POST and the endpoint is a PUT.
 */
export function flushPending() {
  pending.forEach(({ value, timer }, key) => {
    window.clearTimeout(timer);
    void fetch(`${BASE}/${key}`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
    }).catch(() => undefined);
  });
  pending.clear();
}

/**
 * One-time hand-off from the browser storage an earlier build used. Anything
 * found is pushed to the backend and then removed, so no preference is left
 * living in the browser.
 */
const LEGACY_KEYS: Record<string, PrefKey> = {
  'daedalus-theme-state': PREF_THEME,
  'daedalus-custom-themes': PREF_CUSTOM_THEMES,
  'daedalus-ui-scale': PREF_UI_SCALE,
};
const LEGACY_THEME_ID_KEY = 'daedalus-theme';

export async function migrateLegacyLocalStorage(
  serverValues: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const migrated: Record<string, unknown> = {};
  let found = false;

  try {
    for (const [lsKey, prefKey] of Object.entries(LEGACY_KEYS)) {
      const raw = localStorage.getItem(lsKey);
      if (raw === null) continue;
      found = true;
      // Only adopt a legacy value the backend does not already have; the
      // server is the source of truth once it holds anything.
      if (serverValues[prefKey] === undefined) {
        try {
          migrated[prefKey] = prefKey === PREF_UI_SCALE ? raw : JSON.parse(raw);
        } catch {
          /* unparseable legacy value — drop it rather than carry it forward */
        }
      }
      localStorage.removeItem(lsKey);
    }
    if (localStorage.getItem(LEGACY_THEME_ID_KEY) !== null) {
      found = true;
      localStorage.removeItem(LEGACY_THEME_ID_KEY);
    }
  } catch {
    // Storage can be unavailable (private mode); nothing to migrate then.
    return {};
  }

  if (!found) return {};

  await Promise.all(
    Object.entries(migrated).map(([key, value]) =>
      flush(key as PrefKey, value).catch(() => undefined)
    )
  );
  return migrated;
}
