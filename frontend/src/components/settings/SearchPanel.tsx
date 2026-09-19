import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle, Check, ExternalLink, Globe, Loader2, Play, Plus, Power, Search,
  Trash2, X,
} from 'lucide-react'
import { ThemeSelect } from '../ui/theme-select'
import {
  containerAction,
  fetchContainers,
  type ManagedContainer,
} from '../../lib/maintenanceClient'
import { Skeleton } from '../ui/skeleton'
import {
  DISABLED,
  fetchSearchConfig,
  runSearch,
  setSearchConfig,
  setSearchProvider,
  testSearchProvider,
  type SafeSearch,
  type SearchConfig,
  type SearchProvider,
  type SearchResponse,
  type TestResult,
} from '../../lib/searchClient'

/**
 * Settings → Search.
 *
 * Configures a web search provider for **setup work** — finding and checking the
 * manuals, SOPs and datasheets M2 ingests, and reading a model card while sizing
 * one in the Forge. Not a retrieval path: Rule 1 keeps the runtime local, and
 * `search_config.purpose` is CHECK-constrained to `'setup'` so the schema holds
 * the line rather than this component's good intentions.
 *
 * Ported from the Odysseus Search tab, with three deliberate differences:
 *
 * 1. **No implicit fallback.** Odysseus quietly appends DuckDuckGo when the
 *    chain is empty. A second provider is a second party seeing the query, and
 *    one nobody chose is one nobody can account for in a write-up.
 * 2. **Failures are stated, not swallowed.** Each provider reports *why* it
 *    could not answer — a missing key, a rate limit, a SearXNG with no working
 *    engines — instead of returning an empty list that looks like "no results".
 * 3. **The chain is visible.** "Run a search" shows every attempt in order, so a
 *    fallback is something you watch happen rather than infer.
 *
 * The API key is write-only. It goes to the backend on Save and comes back only
 * as a masked hint, so this component never holds a stored key.
 */

const SAFESEARCH_OPTIONS: readonly { value: SafeSearch; label: string }[] = [
  { value: 'strict', label: 'Strict' },
  { value: 'moderate', label: 'Moderate' },
  { value: 'off', label: 'Off' },
]

const COUNT_PRESETS = [3, 5, 10, 20] as const

function relativeTime(iso: string | null): string {
  if (!iso) return 'never'
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return iso
  const seconds = Math.round((Date.now() - then) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`
  return `${Math.round(seconds / 86400)}d ago`
}

/**
 * The SearXNG container's state, and a switch for it when one is available.
 *
 * Present only when SearXNG is the selected provider — a control for a service
 * nobody chose is noise. When the backend has no Docker socket (the default) it
 * shows the command instead of a button, because the honest thing to offer is
 * the thing that actually works.
 */
function ContainerControl({ onChanged }: { onChanged: () => void }) {
  const [state, setState] = useState<ManagedContainer | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const status = await fetchContainers()
      setState(status.containers.find((c) => c.name === 'searxng') ?? null)
    } catch {
      setState(null)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const toggle = useCallback(async () => {
    if (!state) return
    setBusy(true)
    setError(null)
    try {
      const result = await containerAction('searxng', state.running ? 'stop' : 'start')
      setState(result.containers.find((c) => c.name === 'searxng') ?? null)
      // The provider's readiness probe now has a different answer.
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'that did not work')
    } finally {
      setBusy(false)
    }
  }, [onChanged, state])

  if (!state) return null

  return (
    <div className="mt-3 pt-3 border-t theme-border">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-[11px] theme-text-muted">Container</span>
        <code className="text-[11px] theme-text">{state.container}</code>
        <span className={`text-[11px] ${state.running ? 'status-ok' : 'theme-text-muted'}`}>
          {state.running ? 'running' : state.exists ? (state.state ?? 'stopped') : 'not created'}
        </span>

        {state.control_available ? (
          <button
            onClick={toggle}
            disabled={busy}
            className="ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-lg border theme-border text-[11px] theme-text-muted hover:theme-text disabled:opacity-40 transition-colors"
          >
            {busy ? <Loader2 size={11} className="animate-spin" /> : <Power size={11} />}
            {state.running ? 'Stop' : 'Start'}
          </button>
        ) : (
          <code className="ml-auto text-[10px] theme-text-muted">{state.compose_hint}</code>
        )}
      </div>

      {!state.control_available && (
        <p className="text-[10px] theme-text-muted mt-1.5 leading-relaxed">
          Starting it from here needs a Docker socket mounted into the backend
          (<code>DOCKER_SOCKET</code> in <code>.env</code>), which is off by default: a
          process that can reach that socket can do anything Docker can on this machine,
          and the agent's <code>bash</code> tool runs in the same container. If you turn
          it on, lock <code>execute_code</code> in Agent Tools.
        </p>
      )}
      {error && (
        <p className="flex items-center gap-1.5 text-[11px] status-warn mt-1.5">
          <AlertTriangle size={11} /> {error}
        </p>
      )}
    </div>
  )
}

export function SearchPanel({ isPeek }: { isPeek: boolean }) {
  const [config, setConfig] = useState<SearchConfig | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Draft state. Separate from `config` because a panel that wrote on every
  // keystroke would put a half-typed API key in the database.
  const [provider, setProvider] = useState<string>(DISABLED)
  const [count, setCount] = useState(5)
  const [safesearch, setSafesearch] = useState<SafeSearch>('strict')
  const [chain, setChain] = useState<string[]>([])
  const [baseUrl, setBaseUrl] = useState('')
  const [engineId, setEngineId] = useState('')
  const [apiKey, setApiKey] = useState('')

  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [testing, setTesting] = useState(false)
  const [test, setTest] = useState<TestResult | null>(null)

  const [probe, setProbe] = useState('')
  const [searching, setSearching] = useState(false)
  const [search, setSearch] = useState<SearchResponse | null>(null)
  const [searchError, setSearchError] = useState<string | null>(null)

  /** Point the credential drafts at one provider's stored values. */
  const adoptProvider = useCallback((next: SearchConfig, id: string) => {
    const row = next.providers.find((p) => p.id === id)
    setBaseUrl(row?.base_url ?? '')
    setEngineId(row?.engine_id ?? '')
    // Never prefilled: the backend does not return it, and a placeholder that
    // looked like a key would invite saving the mask back over the real one.
    setApiKey('')
  }, [])

  const load = useCallback(async () => {
    try {
      const next = await fetchSearchConfig()
      setConfig(next)
      setProvider(next.provider)
      setCount(next.result_count)
      setSafesearch(next.safesearch)
      setChain(next.fallback_chain)
      adoptProvider(next, next.provider)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not load search settings')
    }
  }, [adoptProvider])

  useEffect(() => {
    void load()
  }, [load])

  const selected: SearchProvider | undefined = useMemo(
    () => config?.providers.find((p) => p.id === provider),
    [config, provider],
  )

  const onProviderChange = (id: string) => {
    setProvider(id)
    setTest(null)
    // A chain must not contain its own primary — it would retry the provider
    // that just failed.
    setChain((current) => current.filter((c) => c !== id))
    if (config) adoptProvider(config, id)
  }

  /** Persist credentials then the selection. Returns the fresh config. */
  const persist = useCallback(async (): Promise<SearchConfig | null> => {
    if (provider !== DISABLED) {
      const creds: { base_url?: string; api_key?: string; engine_id?: string } = {}
      if (selected?.needs_url) creds.base_url = baseUrl.trim()
      if (selected?.needs_engine_id) creds.engine_id = engineId.trim()
      // Only when something was typed. An untouched field must leave the stored
      // key alone rather than clear it.
      if (apiKey.trim()) creds.api_key = apiKey.trim()
      if (Object.keys(creds).length) await setSearchProvider(provider, creds)
    }
    const next = await setSearchConfig({
      provider,
      result_count: count,
      safesearch,
      fallback_chain: chain,
    })
    setConfig(next)
    setApiKey('')
    return next
  }, [provider, selected, baseUrl, engineId, apiKey, count, safesearch, chain])

  const save = useCallback(async () => {
    setSaving(true)
    setError(null)
    try {
      await persist()
      setSaved(true)
      window.setTimeout(() => setSaved(false), 2000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not save')
    } finally {
      setSaving(false)
    }
  }, [persist])

  // Save first, so the test measures what is on screen rather than what was
  // stored an edit ago — Odysseus does the same, and for the same reason.
  const runTest = useCallback(async () => {
    if (provider === DISABLED) return
    setTesting(true)
    setError(null)
    setTest(null)
    try {
      await persist()
      const result = await testSearchProvider(provider)
      setTest(result)
      setConfig(result.config)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'the test could not run')
    } finally {
      setTesting(false)
    }
  }, [persist, provider])

  const doSearch = useCallback(async () => {
    const query = probe.trim()
    if (!query) return
    setSearching(true)
    setSearch(null)
    setSearchError(null)
    try {
      setSearch(await runSearch(query))
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : 'the search could not run')
    } finally {
      setSearching(false)
    }
  }, [probe])

  const clearKey = useCallback(async () => {
    if (!selected) return
    try {
      setConfig(await setSearchProvider(selected.id, { api_key: '' }))
      setApiKey('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not clear the key')
    }
  }, [selected])

  const card = `p-5 rounded-xl border theme-border transition-colors ${isPeek ? 'bg-transparent' : 'theme-surface'}`
  const field =
    'w-full px-3 py-2 rounded-lg border theme-border theme-surface-strong theme-text text-sm outline-none focus:ring-1 focus:ring-[color-mix(in_srgb,var(--primary)_55%,transparent)] placeholder:opacity-40'

  if (!config) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-40 w-full" />
      </div>
    )
  }

  const providerOptions = [
    ...config.providers.map((p) => ({ value: p.id, label: p.label })),
    { value: DISABLED, label: 'Disabled' },
  ]
  // A provider can only be a fallback once, and never the primary.
  const availableFallbacks = config.providers.filter(
    (p) => p.id !== provider && !chain.includes(p.id),
  )

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <div>
        <h3 className="text-xl font-medium mb-1">Search</h3>
        <p className="text-sm theme-text-muted">
          A web search provider for sourcing and checking documents before they are ingested.
        </p>
      </div>

      {/* The same argument the Add Models panel makes, for the same reason: a
          panel that reaches the internet inside an offline project has to say
          where it sits relative to Rule 1, or it reads as a contradiction. */}
      <div className="flex gap-3 p-4 rounded-xl border status-warn-border status-warn-bg">
        <Globe size={16} className="shrink-0 mt-0.5 status-warn" />
        <div className="text-xs leading-relaxed theme-text-muted">
          <span className="font-medium theme-text">Setup use only.</span>{' '}
          {config.purpose_detail} Model weights already work this way — §8.2 calls
          downloading them “a one-time setup activity performed when internet is
          available”, and this is the same line drawn for documents. The store
          enforces it: a row whose purpose is anything but <code>setup</code> cannot
          be written.
        </div>
      </div>

      {/* ── Provider ── */}
      <div className={card}>
        <div className="flex items-center justify-between gap-3 mb-4">
          <h4 className="text-sm font-medium flex items-center gap-2">
            <Search size={14} className="theme-accent" />
            Web search
          </h4>
          <div className="flex items-center gap-2">
            {config.enabled && (
              <span
                className={`text-[11px] flex items-center gap-1 ${config.ready ? 'status-ok' : 'status-warn'}`}
                title={config.ready_detail}
              >
                {config.ready ? <Check size={11} /> : <AlertTriangle size={11} />}
                {config.ready_detail}
              </span>
            )}
            <button
              onClick={runTest}
              disabled={testing || provider === DISABLED}
              title="Run one query against this provider and report what came back."
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border theme-border text-xs theme-text-muted hover:theme-text disabled:opacity-40 transition-colors"
            >
              {testing ? <Loader2 size={12} className="animate-spin" /> : <Play size={12} />}
              Test
            </button>
          </div>
        </div>

        <div className="grid gap-3 @lg:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium theme-text-muted">Provider</label>
            <ThemeSelect
              value={provider}
              onChange={onProviderChange}
              ariaLabel="Search provider"
              options={providerOptions}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium theme-text-muted" title="How many results to ask a provider for.">
              Results per query
            </label>
            <div className="flex gap-2">
              <ThemeSelect
                value={COUNT_PRESETS.includes(count as never) ? String(count) : 'custom'}
                onChange={(v) => setCount(v === 'custom' ? count : Number(v))}
                ariaLabel="Results per query"
                className="flex-1"
                options={[
                  ...COUNT_PRESETS.map((n) => ({ value: String(n), label: String(n) })),
                  { value: 'custom', label: 'Custom' },
                ]}
              />
              {!COUNT_PRESETS.includes(count as never) && (
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={count}
                  onChange={(e) => setCount(Math.max(1, Math.min(100, Number(e.target.value) || 1)))}
                  className={`${field} w-24`}
                  aria-label="Custom result count"
                />
              )}
            </div>
          </div>
        </div>

        {provider !== DISABLED && (
          <div className="grid gap-3 @lg:grid-cols-2 mt-3">
            {selected?.needs_url && (
              <div className="flex flex-col gap-1.5 @lg:col-span-2">
                <label className="text-xs font-medium theme-text-muted" htmlFor="search-url">
                  Instance URL
                </label>
                <input
                  id="search-url"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder={selected.base_url_default || 'http://localhost:8080'}
                  className={`${field} font-mono`}
                  autoComplete="off"
                  spellCheck={false}
                />
                {/* An empty field is not a broken one when the compose profile
                    is configured — it means "the bundled instance". Saying so
                    is the difference between a blank box and a default. */}
                {!baseUrl.trim() && selected.base_url_default && (
                  <p className="text-[11px] theme-text-muted">
                    Empty uses the bundled container at{' '}
                    <code className="theme-text">{selected.base_url_default}</code>, started
                    with <code className="theme-text">./daedalus.sh start --with-search</code>.
                  </p>
                )}
              </div>
            )}

            {selected?.needs_key && (
              <div className="flex flex-col gap-1.5 @lg:col-span-2">
                <label className="text-xs font-medium theme-text-muted" htmlFor="search-key">
                  {selected.key_label || 'API key'}
                </label>
                <div className="flex gap-2">
                  <input
                    id="search-key"
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder={selected.has_key ? `stored · ${selected.key_hint}` : selected.key_label}
                    className={`${field} font-mono`}
                    autoComplete="new-password"
                    data-1p-ignore="true"
                    data-lpignore="true"
                    spellCheck={false}
                  />
                  {selected.has_key && (
                    <button
                      onClick={clearKey}
                      title="Delete the stored key."
                      className="px-2.5 rounded-lg border theme-border theme-text-muted hover:text-[var(--status-bad)] transition-colors"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
                <p className="text-[11px] theme-text-muted">
                  Stored on this machine only. The backend never returns it, so you will
                  only ever see a masked hint like <code>tvl…9f4a</code>.
                </p>
              </div>
            )}

            {selected?.needs_engine_id && (
              <div className="flex flex-col gap-1.5 @lg:col-span-2">
                <label className="text-xs font-medium theme-text-muted" htmlFor="search-cx">
                  Engine id (CX)
                </label>
                <input
                  id="search-cx"
                  value={engineId}
                  onChange={(e) => setEngineId(e.target.value)}
                  placeholder="a1b2c3d4e5f6g7h8i"
                  className={`${field} font-mono`}
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
            )}

            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium theme-text-muted">SafeSearch</label>
              <ThemeSelect
                value={safesearch}
                onChange={setSafesearch}
                ariaLabel="SafeSearch level"
                options={SAFESEARCH_OPTIONS}
              />
            </div>
          </div>
        )}

        {selected && (
          <p className="text-[11px] theme-text-muted mt-3 leading-relaxed">
            {selected.hint}
            {selected.docs_url && (
              <>
                {' '}
                <a
                  href={selected.docs_url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex items-center gap-0.5 theme-accent hover:underline"
                >
                  {selected.needs_key ? 'Get a key' : 'Docs'} <ExternalLink size={10} />
                </a>
              </>
            )}
          </p>
        )}

        {selected?.needs_url && <ContainerControl onChanged={() => void load()} />}

        {provider === DISABLED && (
          <p className="text-[11px] theme-text-muted mt-3">
            Nothing leaves this machine. Corpus sourcing is done by hand, which is the
            configuration a deployed reactor assistant ships in.
          </p>
        )}

        {/* ── Fallbacks ── */}
        {provider !== DISABLED && (
          <div className="mt-4 pt-4 border-t theme-border">
            <div className="flex items-baseline justify-between gap-2 mb-2">
              <label className="text-xs font-medium theme-text-muted">Fallbacks</label>
              <span className="text-[10px] theme-text-muted">
                tried in order, only when the one above returns nothing
              </span>
            </div>
            <div className="space-y-2">
              {chain.map((id, index) => {
                const row = config.providers.find((p) => p.id === id)
                return (
                  <div key={id} className="flex items-center gap-2">
                    <span className="text-[11px] font-mono theme-text-muted w-4 shrink-0">
                      {index + 1}.
                    </span>
                    <ThemeSelect
                      value={id}
                      onChange={(next) =>
                        setChain((current) => current.map((c, i) => (i === index ? next : c)))
                      }
                      ariaLabel={`Fallback ${index + 1}`}
                      className="flex-1"
                      options={[
                        { value: id, label: row?.label ?? id },
                        ...availableFallbacks.map((p) => ({ value: p.id, label: p.label })),
                      ]}
                    />
                    {row && !row.ready && (
                      <span className="text-[10px] status-warn shrink-0" title={row.ready_detail}>
                        {row.ready_detail}
                      </span>
                    )}
                    <button
                      onClick={() => setChain((current) => current.filter((_, i) => i !== index))}
                      title="Remove this fallback."
                      className="p-1.5 rounded-lg theme-text-muted hover:text-[var(--status-bad)] transition-colors"
                    >
                      <X size={13} />
                    </button>
                  </div>
                )
              })}
              {availableFallbacks.length > 0 && (
                <button
                  onClick={() => setChain((current) => [...current, availableFallbacks[0].id])}
                  className="flex items-center gap-1 text-[11px] theme-text-muted hover:theme-text transition-colors"
                >
                  <Plus size={11} /> Add fallback
                </button>
              )}
              {chain.length === 0 && (
                <p className="text-[11px] theme-text-muted">
                  None. A failed search reports why it failed rather than quietly asking
                  somebody else — a second provider is a second party seeing the query.
                </p>
              )}
            </div>
          </div>
        )}

        <div className="flex items-center gap-3 mt-4">
          <button
            onClick={save}
            disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium theme-bg-primary theme-text-on-primary hover:opacity-80 disabled:opacity-40 transition-opacity"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            Save
          </button>
          {saved && <span className="text-xs status-ok">Saved</span>}
          {error && (
            <span className="flex items-center gap-1.5 text-xs status-warn">
              <AlertTriangle size={12} /> {error}
            </span>
          )}
          {selected?.last_tested_at && !test && (
            <span className="text-xs theme-text-muted ml-auto" title={selected.last_test_detail ?? ''}>
              last test {relativeTime(selected.last_tested_at)} ·{' '}
              <span className={selected.last_test_ok ? 'status-ok' : 'status-warn'}>
                {selected.last_test_ok ? 'ok' : 'failed'}
              </span>
            </span>
          )}
        </div>

        {test && (
          <div
            className={`mt-3 rounded-lg border p-3 text-[11px] leading-relaxed ${
              test.ok ? 'status-ok-border status-ok-bg' : 'status-warn-border status-warn-bg'
            }`}
          >
            <div className="flex items-center gap-1.5">
              {test.ok ? (
                <Check size={12} className="status-ok" />
              ) : (
                <AlertTriangle size={12} className="status-warn" />
              )}
              <span className="theme-text">{test.detail}</span>
              <span className="theme-text-muted">· {test.elapsed_ms}ms</span>
            </div>
            {test.results.length > 0 && (
              <ul className="mt-2 space-y-1">
                {test.results.map((r) => (
                  <li key={r.url} className="truncate theme-text-muted">
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="theme-accent hover:underline"
                    >
                      {r.title || r.url}
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* ── Run a search ── */}
      {config.enabled && (
        <div className={card}>
          <h4 className="text-sm font-medium mb-1">Run a search</h4>
          <p className="text-xs theme-text-muted mb-3">
            Uses the chain above and shows every attempt it made — which is the only way
            to see a fallback actually happen.
          </p>
          <div className="flex gap-2">
            <input
              value={probe}
              onChange={(e) => setProbe(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void doSearch()
              }}
              placeholder="e.g. pressurised water reactor operating manual pdf"
              className={field}
            />
            <button
              onClick={doSearch}
              disabled={searching || !probe.trim()}
              className="flex items-center gap-1.5 px-3 rounded-lg border theme-border text-xs theme-text-muted hover:theme-text disabled:opacity-40 transition-colors shrink-0"
            >
              {searching ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />}
              Search
            </button>
          </div>

          {searchError && (
            <p className="flex items-start gap-1.5 text-[11px] status-warn mt-3">
              <AlertTriangle size={12} className="shrink-0 mt-0.5" />
              {searchError}
            </p>
          )}

          {search && (
            <div className="mt-3 space-y-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] theme-text-muted">
                {search.attempts.map((a) => (
                  <span key={a.provider} className="flex items-center gap-1">
                    {a.ok ? (
                      <Check size={10} className="status-ok" />
                    ) : (
                      <X size={10} className="status-warn" />
                    )}
                    <code className="theme-text">{a.provider}</code>
                    <span>{a.detail}</span>
                    <span>· {a.elapsed_ms}ms</span>
                  </span>
                ))}
              </div>
              <ul className="space-y-2.5">
                {search.results.map((r) => (
                  <li key={r.url} className="min-w-0">
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-xs theme-accent hover:underline break-words"
                    >
                      {r.title || r.url}
                    </a>
                    <div className="text-[10px] theme-text-muted truncate">{r.url}</div>
                    {r.snippet && (
                      <p className="text-[11px] theme-text-muted leading-relaxed mt-0.5">
                        {r.snippet}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
