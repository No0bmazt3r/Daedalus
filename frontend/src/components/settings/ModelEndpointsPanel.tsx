import { useCallback, useEffect, useState } from 'react'
import {
  Plus, Trash2, Check, X, Loader2, ExternalLink, KeyRound, AlertTriangle, CloudOff,
} from 'lucide-react'
import { ThemeSelect } from '../ui/theme-select'
import {
  addEndpoint,
  deleteEndpoint,
  listEndpoints,
  providerCatalogue,
  testEndpoint,
  type ModelEndpoint,
  type Provider,
} from '../../lib/systemClient'

/**
 * Settings → Add Models.
 *
 * Configures cloud providers for the **offline evaluation baseline**, not for
 * the live runtime. PROJECT.md Rule 1 forbids cloud APIs in the query path and
 * permits them only as benchmark references; the stored `purpose` column is
 * CHECK-constrained to `'benchmark'`, so the rule holds in the schema rather
 * than in this component's good intentions.
 *
 * The API key is write-only. It goes to the backend on Add and comes back only
 * as a masked hint — this component never holds a stored key.
 */

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

export function ModelEndpointsPanel({ isPeek }: { isPeek: boolean }) {
  const [providers, setProviders] = useState<Provider[]>([])
  const [endpoints, setEndpoints] = useState<ModelEndpoint[]>([])
  const [providerId, setProviderId] = useState('deepseek')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [adding, setAdding] = useState(false)
  const [testing, setTesting] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const [cat, eps] = await Promise.all([providerCatalogue(), listEndpoints()])
      setProviders(cat)
      setEndpoints(eps)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not load endpoints')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // Selecting a provider prefills its published URL, but never overwrites a
  // URL the user has typed — that would silently discard a self-hosted address.
  const selected = providers.find((p) => p.id === providerId)
  const onProviderChange = (id: string) => {
    const next = providers.find((p) => p.id === id)
    const wasPrefill = providers.some((p) => p.base_url && p.base_url === baseUrl)
    setProviderId(id)
    if (!baseUrl || wasPrefill) setBaseUrl(next?.base_url ?? '')
  }

  const submit = useCallback(async () => {
    const url = baseUrl.trim() || selected?.base_url || ''
    if (!url || adding) return
    setAdding(true)
    setError(null)
    try {
      const created = await addEndpoint({
        provider: providerId,
        base_url: url,
        api_key: apiKey.trim(),
      })
      setEndpoints((prev) => [created, ...prev])
      // Clear the key from component state the moment it is stored.
      setApiKey('')
      setBaseUrl('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not add that endpoint')
    } finally {
      setAdding(false)
    }
  }, [adding, apiKey, baseUrl, providerId, selected])

  const runTest = useCallback(async (id: string) => {
    setTesting(id)
    setError(null)
    try {
      const updated = await testEndpoint(id)
      setEndpoints((prev) => prev.map((e) => (e.id === id ? updated : e)))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'the test could not run')
    } finally {
      setTesting(null)
    }
  }, [])

  const remove = useCallback(async (id: string) => {
    setEndpoints((prev) => prev.filter((e) => e.id !== id))
    try {
      await deleteEndpoint(id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not delete that endpoint')
      void load()
    }
  }, [load])

  const card = `p-5 rounded-xl border theme-border transition-colors ${isPeek ? 'bg-transparent' : 'bg-black/10'}`
  const field =
    'w-full px-3 py-2 rounded-lg border theme-border bg-black/20 theme-text text-sm outline-none focus:ring-1 focus:ring-zinc-500/50 placeholder:opacity-40'

  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <div>
        <h3 className="text-xl font-medium mb-1">Add API Models</h3>
        <p className="text-sm theme-text-muted">
          Connect a cloud provider (OpenAI, Anthropic, DeepSeek, OpenRouter, …).
        </p>
      </div>

      {/* Rule 1 is the whole safety argument of this project — a panel that
          adds cloud providers has to say where it sits relative to it, or it
          reads like a contradiction. */}
      <div className="flex gap-3 p-4 rounded-xl border border-amber-500/30 bg-amber-500/5">
        <CloudOff size={16} className="shrink-0 mt-0.5 text-amber-400/90" />
        <div className="text-xs leading-relaxed theme-text-muted">
          <span className="font-medium theme-text">Benchmark use only.</span>{' '}
          The live reactor assistant runs entirely on local models — cloud
          providers are never called from the chat path. These endpoints exist
          as reference baselines for the retrieval comparison and for
          LLM-as-a-judge over exported logs. The store enforces this: a row
          whose purpose is anything but <code>benchmark</code> cannot be written.
        </div>
      </div>

      {/* Add form */}
      <div className={card}>
        <div className="grid gap-3 @lg:grid-cols-[minmax(0,14rem)_1fr]">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium theme-text-muted">Provider</label>
            <ThemeSelect
              value={providerId}
              onChange={onProviderChange}
              ariaLabel="Provider"
              options={providers.map((p) => ({ value: p.id, label: p.label }))}
            />
          </div>
          <div className="flex flex-col gap-1.5 min-w-0">
            <label className="text-xs font-medium theme-text-muted" htmlFor="endpoint-url">
              Base URL
            </label>
            <input
              id="endpoint-url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder={selected?.base_url || 'https://…/v1'}
              className={`${field} font-mono`}
              autoComplete="off"
              data-1p-ignore="true"
              data-lpignore="true"
              spellCheck={false}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1.5 mt-3">
          <label className="text-xs font-medium theme-text-muted" htmlFor="endpoint-key">
            API key
          </label>
          <input
            id="endpoint-key"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
            }}
            placeholder="API key, e.g. sk-proj-AbCdEf…"
            className={`${field} font-mono`}
            autoComplete="new-password"
            data-1p-ignore="true"
            data-lpignore="true"
            spellCheck={false}
          />
          <p className="text-[11px] theme-text-muted opacity-70 mt-0.5">
            Stored on this machine only. The backend never returns it — you will
            see a masked hint like <code>sk-…9f4a</code>.
            {selected?.docs && (
              <>
                {' '}
                <a
                  href={selected.docs}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-0.5 theme-primary hover:underline"
                >
                  Get a key <ExternalLink size={10} />
                </a>
              </>
            )}
          </p>
        </div>

        <div className="flex items-center gap-3 mt-4">
          <button
            onClick={submit}
            disabled={adding || (!baseUrl.trim() && !selected?.base_url)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium theme-bg-primary text-black hover:opacity-80 disabled:opacity-40 disabled:cursor-not-allowed transition-opacity"
          >
            {adding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            Add
          </button>
          {error && (
            <span className="flex items-center gap-1.5 text-xs text-amber-400/90">
              <AlertTriangle size={12} /> {error}
            </span>
          )}
        </div>
      </div>

      {/* Configured endpoints */}
      <div>
        <h4 className="text-sm font-medium mb-3">
          Connected providers
          {endpoints.length > 0 && (
            <span className="theme-text-muted font-normal"> · {endpoints.length}</span>
          )}
        </h4>

        {endpoints.length === 0 ? (
          <div className={`${card} text-sm theme-text-muted opacity-70`}>
            Nothing connected yet. Add a provider above to use it as an evaluation baseline.
          </div>
        ) : (
          <div className="space-y-2">
            {endpoints.map((ep) => (
              <div key={ep.id} className={`${card} flex items-start justify-between gap-4`}>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium text-sm">{ep.label}</span>
                    {ep.last_test_ok === true && (
                      <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-500/15 text-emerald-400">
                        <Check size={9} /> connected
                      </span>
                    )}
                    {ep.last_test_ok === false && (
                      <span className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-500/15 text-red-400">
                        <X size={9} /> failed
                      </span>
                    )}
                    {ep.last_test_ok === null && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-black/25 theme-text-muted">
                        untested
                      </span>
                    )}
                  </div>
                  <div className="text-xs font-mono theme-text-muted mt-1 truncate">
                    {ep.base_url}
                  </div>
                  <div className="flex items-center gap-3 text-[11px] theme-text-muted mt-1.5 flex-wrap">
                    <span className="flex items-center gap-1">
                      <KeyRound size={10} />
                      {ep.key_hint ?? 'no key stored'}
                    </span>
                    <span>tested {relativeTime(ep.last_tested_at)}</span>
                  </div>
                  {ep.last_test_detail && (
                    <div
                      className={`text-[11px] mt-1 ${
                        ep.last_test_ok ? 'text-emerald-400/80' : 'text-red-400/80'
                      }`}
                    >
                      {ep.last_test_detail}
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => void runTest(ep.id)}
                    disabled={testing === ep.id}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border theme-border theme-text-muted hover:theme-text hover:bg-black/20 disabled:opacity-40 transition-colors"
                  >
                    {testing === ep.id && <Loader2 size={11} className="animate-spin" />}
                    Test
                  </button>
                  <button
                    onClick={() => void remove(ep.id)}
                    aria-label={`Remove ${ep.label}`}
                    className="p-1.5 rounded-lg theme-text-muted hover:text-red-400 hover:bg-black/20 transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
