// Web search — /api/search.
//
// A *setup* client, in the same sense as `forgeClient`: it configures a thing
// that runs while somebody is preparing the corpus, never during a query. Rule
// 5 — nothing on the chat path may import this module, and the backend enforces
// the other half with a `purpose` CHECK that admits only 'setup'.

import { request, type RequestOptions } from './http';

/** `strict` is the default and the one the panel opens on. */
export type SafeSearch = 'strict' | 'moderate' | 'off';

/** `disabled` is a selectable state, not the absence of a selection. */
export const DISABLED = 'disabled';

export interface SearchProvider {
  id: string;
  label: string;
  /** What the provider needs before it can run. Drives which rows are shown. */
  needs_key: boolean;
  needs_url: boolean;
  needs_engine_id: boolean;
  /** "Brave API key" — the placeholder, so the field names the right key. */
  key_label: string;
  hint: string;
  docs_url: string | null;

  /** Whether it could run right now, and what it is waiting for if not. */
  ready: boolean;
  ready_detail: string;

  base_url: string | null;
  /** What it falls back to with nothing saved — the bundled container's URL. */
  base_url_default: string | null;
  engine_id: string | null;
  /** `tvl…9f4a`. The key itself never leaves the backend. */
  key_hint: string | null;
  has_key: boolean;

  last_tested_at: string | null;
  last_test_ok: boolean | null;
  last_test_detail: string | null;
  last_test_count: number | null;
  last_test_ms: number | null;
}

export interface SearchConfig {
  provider: string;
  result_count: number;
  safesearch: SafeSearch;
  /** Ordered: tried top to bottom when the primary returns nothing. */
  fallback_chain: string[];
  /** CHECK-constrained to 'setup' in the schema. */
  purpose: string;
  updated_at: string | null;

  enabled: boolean;
  ready: boolean;
  ready_detail: string;
  providers: SearchProvider[];
  /** One sentence on what this surface is for, written once on the backend. */
  purpose_detail: string;
}

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  age: string;
}

/** One provider's turn in the chain — success or the reason it was skipped. */
export interface SearchAttempt {
  provider: string;
  ok: boolean;
  detail: string;
  elapsed_ms: number;
}

export interface TestResult {
  provider: string;
  ok: boolean;
  detail: string;
  results: SearchResult[];
  count: number;
  elapsed_ms: number;
  config: SearchConfig;
}

export interface SearchResponse {
  query: string;
  provider: string;
  results: SearchResult[];
  attempts: SearchAttempt[];
  elapsed_ms: number;
}

// A search leaves this machine and waits on somebody else's server. Fifteen
// seconds is the backend's own per-provider timeout, and a chain of three can
// legitimately spend all of it three times over.
const SEARCH_TIMEOUT: RequestOptions = { timeoutMs: 60000 };

export const fetchSearchConfig = () => request<SearchConfig>('/api/search/config');

export const setSearchConfig = (body: {
  provider: string;
  result_count: number;
  safesearch: SafeSearch;
  fallback_chain: string[];
}) =>
  request<SearchConfig>('/api/search/config', {
    method: 'PUT',
    body: JSON.stringify(body),
  });

/**
 * Write one provider's credentials.
 *
 * Omit a field to leave it alone; pass `''` to clear it. That is what lets the
 * panel save a provider whose key it was never given — it only ever held a
 * masked hint.
 */
export const setSearchProvider = (
  id: string,
  body: { base_url?: string; api_key?: string; engine_id?: string },
) =>
  request<SearchConfig>(`/api/search/providers/${encodeURIComponent(id)}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  });

/** Run one provider once. A failing provider is a 200 with `ok: false`. */
export const testSearchProvider = (provider: string, query?: string) =>
  request<TestResult>('/api/search/test', {
    ...SEARCH_TIMEOUT,
    method: 'POST',
    body: JSON.stringify({ provider, query: query ?? null }),
  });

/** Run the configured chain. Reports every attempt, not just the winner. */
export const runSearch = (query: string, count?: number) =>
  request<SearchResponse>('/api/search/query', {
    ...SEARCH_TIMEOUT,
    method: 'POST',
    body: JSON.stringify({ query, count: count ?? null }),
  });
