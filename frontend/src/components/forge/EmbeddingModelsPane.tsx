import { useEffect, useState } from 'react'
import {
  Check, AlertTriangle, CloudOff, Cloud, HelpCircle, X, Download, Loader2, Search,
} from 'lucide-react'
import {
  fetchEmbeddingConfig, setEmbeddingModel, pullEmbeddingModel, verifyEmbeddingModel,
  type EmbeddingConfig,
  // Aliased: the local component below is also called `IndexState`, and the
  // tone map needs the union to be exhaustively checked.
  type IndexState as IndexStateValue,
} from '../../lib/embeddingsClient'
import { Skeleton } from '../ui/skeleton'
import { EmbeddingRow } from './EmbeddingRow'

/**
 * The embedding models, in two modes:
 *
 * | mode | where | what it does |
 * |---|---|---|
 * | `browse` | Forge → Embedding models | find and pull: the catalogue, filters, pull any tag by name |
 * | `installed` | Forge → Installed → Embedding models | manage: index state, which model builds the index, verify, cloud baseline |
 *
 * One component rather than two so the card, the fetch and the pull logic
 * exist once; the mode only decides which list and which controls are shown.
 *
 * Which model turns chunks into vectors — `architecture/04` Step 5.
 *
 * ## Why this is in the Forge and not in Settings
 *
 * It lived beside the retrieval-track switch first, on the reasoning that the
 * choice is inseparable from the index it produced. That is true and it is still
 * the wrong home: the Forge is the model console, and this is a model. Splitting
 * "models you pull" across two windows by what the model is *for* means neither
 * window answers "what is on this machine".
 *
 * So the Forge owns the whole lifecycle — discover, pull, select, delete — and
 * Settings → Knowledge Base keeps only what is genuinely a corpus fact: whether
 * the index matches the selected model.
 *
 * ## Browse is for finding, Installed is for managing
 *
 * Browsing lists the whole catalogue once and offers only Pull. An installed
 * model there shows Manage, which goes to Installed, rather than repeating the
 * selection and verify controls — so each control has exactly one home.
 *
 * ## Its own tab, not a tier inside Chat models
 *
 * An embedding model is not a small answering model. It never appears in the
 * composer's picker, is never benchmarked for tokens/sec, and has no fit
 * verdict — the scorer weighs quality, speed and context pressure for something
 * that generates text. Filing it beside the SLM and LLM tiers would say the
 * opposite of all three.
 *
 * ## This is not the chat model
 *
 * The panel says so on screen, because it is the mistake everything else here
 * is downstream of. `nomic-embed-text` embeds the corpus once, offline, at
 * ingest. Qwen3 answers questions at query time and never sees a vector.
 * Changing the chat model — including mid-conversation, which this project
 * allows — does nothing to the index.
 *
 * ## Changing *this* model means re-embedding, not losing, the corpus
 *
 * An embedding is only comparable to embeddings from the same model. Different
 * model, different vector space, and cosine similarity across two spaces is not
 * a worse ranking — it is a meaningless one. So a change means every chunk must
 * be embedded again before retrieval means anything, and the panel says so
 * before the change rather than after.
 *
 * What a change does *not* do is destroy anything. Each model owns its own
 * collection (`config.collection`, derived from the tag), so selecting another
 * one addresses a different index — empty until it is ingested — and selecting
 * the first one back finds its vectors where they were. `index_state` reads the
 * model stamped on the collection itself rather than a note kept beside it, so
 * it stays true across a restored config or a `data/chroma` copied from another
 * machine.
 *
 *
 * ## Cloud is quarantined, not offered as an equal
 *
 * Rule 1 permits cloud models as offline evaluation baselines. For embeddings
 * the exposure is worse than for a chat turn, and the panel explains why rather
 * than just disabling the control: embedding the corpus in the cloud sends every
 * document out, and every later query has to be embedded by the same model to
 * be comparable — so every question goes out too. A cloud selection therefore
 * writes a separate collection and cannot serve the local system.
 */

// `unknown` is deliberately not styled as a problem or as an all-clear. Chroma
// being unreachable says nothing about the index, and an amber "we could not
// look" is the honest rendering of a question that was never answered.
const INDEX_TONES: Record<
  IndexStateValue,
  { wrap: string; tint: string; icon: typeof AlertTriangle }
> = {
  // Nothing chosen yet. Neutral, not a warning: on a fresh install this is the
  // correct state and flagging it red would make "you have not started" look
  // like "something is broken".
  unset: { wrap: 'theme-border', tint: 'theme-text-muted', icon: HelpCircle },
  stale: { wrap: 'border-rose-400/40 bg-rose-400/10', tint: 'text-rose-400', icon: AlertTriangle },
  current: {
    wrap: 'border-emerald-400/40 bg-emerald-400/10', tint: 'text-emerald-400', icon: Check,
  },
  unknown: { wrap: 'border-amber-400/40 bg-amber-400/10', tint: 'text-amber-400', icon: HelpCircle },
  empty: { wrap: 'theme-border', tint: 'theme-text-muted', icon: Check },
}

function IndexState({ config }: { config: EmbeddingConfig }) {
  const tone = INDEX_TONES[config.index_state] ?? INDEX_TONES.empty
  const Icon = tone.icon
  // One collection per model means several can exist at once. Only worth the
  // room when there is more than the selected model's, which is exactly the
  // local-versus-cloud comparison §5 asks for.
  const others = config.indexes.filter((i) => i.name !== config.collection && i.documents > 0)

  return (
    <div className={`space-y-2 rounded-lg border p-2.5 ${tone.wrap}`}>
      <div className="flex items-start gap-2">
        <Icon size={13} className={`mt-0.5 shrink-0 ${tone.tint}`} />
        <p className="text-[11px] leading-relaxed theme-text">
          <span className="theme-text-muted">index {config.index_state} — </span>
          {config.index_detail}
        </p>
      </div>
      {others.length > 0 && (
        <div className="space-y-0.5 border-t theme-border pt-2 pl-[21px]">
          <p className="text-[10px] uppercase tracking-wide theme-text-muted">
            other indexes on this machine
          </p>
          {others.map((index) => (
            <p key={index.name} className="text-[10px] theme-text-muted">
              <code className="theme-text">{index.name}</code> · {index.documents} chunks
              {index.embedding_model ? ` · ${index.embedding_model}` : ' · unattributed'}
              {index.dimensions ? ` · ${index.dimensions}d` : ''}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * `nomic-embed-text:latest` and `nomic-embed-text` are one model, but
 * `snowflake-arctic-embed:335m` and `snowflake-arctic-embed:33m` are two.
 * Mirrors `normalise_tag` in `services/embedding_models.py`.
 */
function normaliseTag(tag: string): string {
  return tag.endsWith(':latest') ? tag.slice(0, -':latest'.length) : tag
}

type LangFilter = 'all' | 'english' | 'multilingual'

export function EmbeddingModelsPane({
  mode, onManage, onBrowse,
}: {
  mode: 'browse' | 'installed'
  /** Browse mode: go to where an installed model is managed. */
  onManage?: () => void
  /** Installed mode: go to where a model can be pulled. */
  onBrowse?: () => void
}) {
  const [config, setConfig] = useState<EmbeddingConfig | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pullingTag, setPullingTag] = useState<string | null>(null)
  const [progress, setProgress] = useState<string | null>(null)
  const [showCloud, setShowCloud] = useState(false)
  const [verifying, setVerifying] = useState<string | null>(null)
  const [filter, setFilter] = useState<LangFilter>('all')
  const [search, setSearch] = useState('')
  const [typedTag, setTypedTag] = useState('')
  const [notice, setNotice] = useState<string | null>(null)

  const load = () => fetchEmbeddingConfig().then(setConfig).catch((e: Error) => setError(e.message))
  useEffect(() => { load() }, [])

  const models = config?.local_models ?? []
  const isMultilingual = (languages: string | null | undefined) =>
    !!languages && !languages.startsWith('English')
  const needle = search.trim().toLowerCase()
  const shown = models.filter((m) => {
    if (mode === 'installed') return m.installed
    if (filter === 'english' && !m.languages?.startsWith('English')) return false
    if (filter === 'multilingual' && !isMultilingual(m.languages)) return false
    if (needle && !`${m.label} ${m.tag} ${m.languages ?? ''}`.toLowerCase().includes(needle)) return false
    return true
  })
  // Installed first: those are the ones you can choose between right now.
  const ordered = [...shown.filter((m) => m.installed), ...shown.filter((m) => !m.installed)]
  const selectedTag = config?.provider === 'local' ? normaliseTag(config.model) : null
  const counts: Record<LangFilter, number> = {
    all: models.length,
    english: models.filter((m) => m.languages?.startsWith('English')).length,
    multilingual: models.filter((m) => isMultilingual(m.languages)).length,
  }

  const select = async (provider: 'local' | 'cloud', model: string, endpointId?: string) => {
    setError(null)
    try {
      setConfig(await setEmbeddingModel({ provider, model, endpoint_id: endpointId ?? null }))
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const pull = (tag: string, typed = false) => {
    setPullingTag(tag)
    setProgress(null)
    setError(null)
    setNotice(null)
    const stream = pullEmbeddingModel(tag, (e) => {
      if (e.error) setError(e.error)
      else if (e.total && e.completed) {
        setProgress(`${Math.round((e.completed / e.total) * 100)}%`)
      } else if (e.status) setProgress(e.status)
    })
    stream.done
      .catch((e: Error) => setError(e.message))
      .finally(() => {
        setPullingTag(null)
        setProgress(null)
        fetchEmbeddingConfig()
          .then((next) => {
            setConfig(next)
            // The list is built from what Ollama says can embed, so a chat model
            // pulled here by mistake would vanish without a word. Say so.
            if (typed && !next.local_models.some((m) => m.installed && m.tag === normaliseTag(tag))) {
              setNotice(
                `${tag} was pulled, but Ollama does not report it as an embedding model, so it is not listed here. ` +
                'If it is a chat model, it is under Installed → Local models; delete it there if it was a mistake.',
              )
            } else if (typed) {
              setTypedTag('')
            }
          })
          .catch((e: Error) => setError(e.message))
      })
  }

  const verify = (tag: string) => {
    setVerifying(tag)
    setError(null)
    verifyEmbeddingModel(tag)
      .catch((e: Error) => setError(e.message))
      .finally(() => { setVerifying(null); load() })
  }

  if (!config) return <Skeleton className="h-64 w-full" />

  return (
    <div className="space-y-4">
      {mode === 'browse' ? (
        <p className="text-sm theme-text-muted">
          Models that turn document chunks into vectors for Track 1. Pull one here, then
          choose which one builds the index under{' '}
          <span className="theme-text">Installed → Embedding models</span>. Every figure is read
          from the model file; once pulled, it is re-read from the copy on this disk.
        </p>
      ) : (
      <>
      <header>
        <h3 className="text-sm theme-text">Embedding model</h3>
        <p className="mt-1 text-xs leading-relaxed theme-text-muted">
          Turns document chunks into vectors, once, at ingest.{' '}
          <span className="theme-text">This is not the chat model</span> — changing which model
          answers questions, even mid-conversation, does not touch the index.
        </p>
        <p className="mt-1.5 text-[11px] leading-relaxed theme-text-muted">
          Used by Track 1 only — Track 2 has no embedding model at all. Never offered to the
          assistant, and not scored for fit or speed: those measure a model that generates text.
        </p>
      </header>

      <IndexState config={config} />
      </>
      )}

      {!config.ollama_available && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-400/40 bg-amber-400/10 p-2.5 text-[11px] theme-text">
          <AlertTriangle size={13} className="shrink-0 text-amber-400" />
          Ollama is not reachable, so nothing can be pulled. Installed models cannot be detected either.
        </div>
      )}

      {mode === 'installed' && !models.some((m) => m.installed) && (
        <p className="rounded-xl border border-dashed theme-border px-3 py-3 text-xs theme-text-muted">
          No embedding model installed yet.{' '}
          {onBrowse ? (
            <button onClick={onBrowse} className="theme-accent hover:underline">Browse embedding models</button>
          ) : (
            'Pull one from the Forge\'s Embedding models tab'
          )}{' '}
          — Track 1 cannot ingest without one, and Track 2 does not need one at all.
        </p>
      )}

      {/* ── filters, and pulling anything the catalogue does not list ── */}
      {mode === 'browse' && (
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[160px]">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 theme-text-muted" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by name or language…"
              spellCheck={false}
              className="w-full pl-7 pr-2 py-1.5 text-[11px] rounded-lg border theme-border theme-surface theme-text placeholder:theme-text-muted focus:outline-none focus:theme-accent-border"
            />
          </div>
          {([
            ['all', 'All'],
            ['english', 'English'],
            ['multilingual', 'Multilingual'],
          ] as const).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setFilter(id)}
              className={`px-2.5 py-1 text-[11px] rounded-lg border transition-colors ${
                filter === id
                  ? 'theme-accent-border theme-accent theme-surface-strong'
                  : 'theme-border theme-text-muted hover:theme-text'
              }`}
            >
              {label} <span className="tabular-nums opacity-70">{counts[id]}</span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <input
            value={typedTag}
            onChange={(e) => setTypedTag(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && typedTag.trim() && !pullingTag && pull(typedTag.trim(), true)}
            placeholder="Pull any embedding model by name, e.g. nomic-embed-text:v1.5"
            spellCheck={false}
            className="flex-1 min-w-0 px-2.5 py-1.5 text-[11px] font-mono rounded-lg border theme-border theme-surface theme-text placeholder:theme-text-muted focus:outline-none focus:theme-accent-border"
          />
          <button
            onClick={() => pull(typedTag.trim(), true)}
            disabled={!typedTag.trim() || !!pullingTag || !config.ollama_available}
            title="Any Ollama tag, or hf.co/{repo}:{quant}. Figures for a model outside the catalogue are read from the file once it is pulled."
            className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-[11px] rounded-lg border theme-border theme-text-muted hover:theme-text transition-colors disabled:opacity-40"
          >
            {pullingTag === typedTag.trim() && pullingTag
              ? <><Loader2 size={12} className="animate-spin" />{progress ?? 'pulling…'}</>
              : <><Download size={12} />Pull</>}
          </button>
        </div>

        {notice && (
          <div className="flex items-start gap-2 p-2.5 rounded-lg border status-warn-border status-warn-bg text-[11px]">
            <AlertTriangle size={13} className="status-warn shrink-0 mt-0.5" />
            <span className="flex-1 break-words">{notice}</span>
            <button onClick={() => setNotice(null)} className="theme-text-muted hover:theme-text">
              <X size={12} />
            </button>
          </div>
        )}
      </div>
      )}

      <div className="@container space-y-2">
        {mode === 'browse' && !ordered.length && (
          <p className="text-xs theme-text-muted py-4 text-center">Nothing matches these filters.</p>
        )}
        {ordered.map((m) =>
          mode === 'installed' ? (
            <EmbeddingRow
              key={m.tag}
              model={m}
              selected={selectedTag === m.tag}
              onSelect={() => select('local', m.tag)}
              pulling={pullingTag === m.tag}
              progress={progress}
              onPull={() => pull(m.tag)}
              onVerify={() => verify(m.tag)}
              verifying={verifying === m.tag}
            />
          ) : (
            <EmbeddingRow
              key={m.tag}
              model={m}
              selected={selectedTag === m.tag}
              pulling={pullingTag === m.tag}
              progress={progress}
              onPull={() => pull(m.tag)}
              onManage={onManage}
            />
          ),
        )}
        {/* The selection may name something that is not installed — a choice
            recorded before pulling, or a model deleted afterwards. Saying so
            beats a list that silently does not contain the selected row. */}
        {mode === 'installed' && selectedTag && !models.some((m) => m.installed && m.tag === selectedTag) && (
          <p className="rounded-xl border status-warn-border status-warn-bg px-3 py-2 text-[11px] theme-text">
            <code>{config.model}</code> is selected but not installed. Pull it, or choose an
            installed one.
          </p>
        )}
      </div>

      {/* Cloud sits behind a disclosure, below the local list and after the
          explanation. It is a baseline, not an alternative, and presenting it as
          a peer of the local models would be the wrong shape for Rule 1. */}
      {mode === 'installed' && (
      <div className="rounded-lg border theme-border">
        <button
          onClick={() => setShowCloud((v) => !v)}
          className="flex w-full items-center gap-2 p-2.5 text-left"
        >
          {config.provider === 'cloud' ? (
            <Cloud size={13} className="shrink-0 text-amber-400" />
          ) : (
            <CloudOff size={13} className="shrink-0 theme-text-muted" />
          )}
          <span className="text-xs theme-text">Cloud embedding baseline</span>
          <span className="ml-auto text-[10px] theme-text-muted">
            {showCloud ? 'hide' : 'show'}
          </span>
        </button>

        {showCloud && (
          <div className="space-y-2 border-t theme-border p-2.5">
            <p className="text-[11px] leading-relaxed theme-text-muted">
              Rule 1 allows cloud models as <span className="theme-text">offline evaluation
              baselines only</span>, and embeddings are a bigger exposure than a chat turn:
              embedding the corpus sends <span className="theme-text">every document</span> to a
              third party, and every later query must be embedded by the same model to be
              comparable — so every question goes out too. There is no one-off cloud embedding.
            </p>
            <p className="text-[11px] leading-relaxed theme-text-muted">
              A cloud selection writes its own collection, under a separate{' '}
              <code className="theme-text">daedalus_knowledge_cloud_baseline</code> prefix, and
              cannot serve the local system — the runtime refuses it. Its index sits alongside
              the local one rather than replacing it, which is what makes the two comparable.
            </p>

            {config.cloud_baselines.length === 0 ? (
              <p className="rounded border border-dashed theme-border p-2.5 text-[11px] theme-text-muted">
                No benchmark endpoints configured. Add one in Settings → Add Models first; the same
                credentials are reused rather than stored twice.
              </p>
            ) : (
              <div className="space-y-1.5">
                {config.cloud_baselines.map((b) => (
                  <div
                    key={b.id}
                    className={`flex items-center gap-2 rounded border p-2 ${
                      config.endpoint_id === b.id ? 'border-amber-400/50 bg-amber-400/10' : 'theme-border'
                    }`}
                  >
                    <span className="min-w-0 flex-1 truncate text-[11px] theme-text">{b.label}</span>
                    <span className="shrink-0 text-[10px] theme-text-muted">{b.provider}</span>
                    <button
                      onClick={() => select('cloud', 'text-embedding-3-large', b.id)}
                      disabled={!b.has_key || !b.enabled}
                      className="shrink-0 rounded border theme-border px-2 py-1 text-[10px] theme-text-muted hover:theme-text disabled:opacity-40"
                    >
                      use as baseline
                    </button>
                  </div>
                ))}
              </div>
            )}

            {config.provider === 'cloud' && (
              <button
                onClick={() => select('local', 'nomic-embed-text')}
                className="inline-flex items-center gap-1.5 rounded border theme-accent-border px-2.5 py-1.5 text-[11px] theme-accent"
              >
                <X size={11} /> Return to a local model
              </button>
            )}
          </div>
        )}
      </div>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-rose-400/40 bg-rose-400/10 p-2.5 text-[11px] theme-text">
          <AlertTriangle size={13} className="shrink-0 text-rose-400" /> {error}
        </div>
      )}
    </div>
  )
}
