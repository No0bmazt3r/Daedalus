import { useState } from 'react'
import { BookOpen, ChevronRight, Network, Quote } from 'lucide-react'
import type { RetrievalDetail, RetrievedChunkDetail } from '../../lib/threadClient'
import { Collapse } from '../ui/collapse'
import { formatMs } from './status'

/**
 * What one answer retrieved, laid out for comparing the tracks.
 *
 * Track 1 (vector RAG): the settings it ran with — embedding model, top-k,
 * re-ranker and how many candidates it re-ranked — then every chunk in rank
 * order: its document, page and section, how that chunk was cut (strategy,
 * size, overlap), its distance and re-rank score, whether it is this rig's own
 * document or a reference, and whether the answer cited it. The chunk's text
 * opens on click.
 *
 * Track 2 (graph RAG): how the walk entered the graph, each hop, and every node
 * it touched, with the cited ones marked.
 *
 * Two threads side by side (the window's Compare) put two of these next to each
 * other, which is the comparison the evaluation makes.
 */

function Chip({ children, title, tone = 'theme-text-muted' }: { children: React.ReactNode; title?: string; tone?: string }) {
  return (
    <span title={title} className={`rounded border theme-border px-1.5 py-0.5 text-[10px] ${tone}`}>
      {children}
    </span>
  )
}

function ChunkRow({ c }: { c: RetrievedChunkDetail }) {
  const [open, setOpen] = useState(false)
  const where = [c.page != null ? `p.${c.page}` : null, c.section ? `§${c.section}` : null].filter(Boolean).join(' · ')
  return (
    <li className={`rounded-md border ${c.cited ? 'status-ok-border' : 'theme-border'}`}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-start gap-2 px-2.5 py-2 text-left hover:theme-surface"
      >
        <span className="mt-0.5 w-5 shrink-0 text-right text-[10px] tabular-nums theme-text-muted">#{c.rank}</span>
        <div className="min-w-0 flex-1 space-y-1">
          <p className="flex items-center gap-1.5 text-xs theme-text">
            <BookOpen size={11} className="shrink-0 theme-accent" />
            <span className="min-w-0 truncate">{c.missing ? '(no longer in the corpus)' : c.document ?? c.chunk_id}</span>
            {where && <span className="shrink-0 text-[10px] theme-text-muted">{where}</span>}
          </p>
          <div className="flex flex-wrap items-center gap-1">
            {c.cited && <Chip tone="status-ok" title="The answer cited this chunk">cited {c.label}</Chip>}
            {!c.cited && c.label && <Chip title="Shown to the model, not cited">{c.label}</Chip>}
            {c.origin && (
              <Chip
                tone={c.origin === 'rig' ? 'theme-accent' : 'theme-text-muted'}
                title={c.origin === 'rig' ? "This reactor's own document" : 'A reference document, from another installation or a textbook'}
              >
                {c.origin}
              </Chip>
            )}
            <Chip title="Cosine distance as stored. Lower is closer.">
              dist <span className="tabular-nums">{c.distance != null ? c.distance.toFixed(3) : '-'}</span>
            </Chip>
            {c.rerank_score != null && (
              <Chip title="The re-ranker's score. Higher is more relevant.">
                rerank <span className="tabular-nums">{c.rerank_score.toFixed(2)}</span>
              </Chip>
            )}
            {c.chunking && (
              <Chip title={`Cut by its ingest run: ${c.chunking.strategy} chunking, ${c.chunking.size} with ${c.chunking.overlap} overlap`}>
                {c.chunking.strategy} {c.chunking.size}/{c.chunking.overlap}
              </Chip>
            )}
            {c.tokens != null && <Chip title="Estimated tokens in this chunk">{c.tokens} tok</Chip>}
          </div>
        </div>
        <ChevronRight size={12} className={`mt-0.5 shrink-0 theme-text-muted transition-transform ${open ? 'rotate-90' : ''}`} />
      </button>
      <Collapse open={open}>
        <div className="border-t theme-border px-3 py-2">
          {c.missing ? (
            <p className="text-[11px] theme-text-muted">
              Re-chunked away since this answer: the corpus can no longer produce this passage.
            </p>
          ) : (
            <p className="flex gap-1.5 whitespace-pre-wrap text-[11px] leading-relaxed theme-text">
              <Quote size={10} className="mt-1 shrink-0 theme-text-muted" />
              {c.text}
            </p>
          )}
        </div>
      </Collapse>
    </li>
  )
}

function VectorRetrieval({ r }: { r: RetrievalDetail }) {
  const chunks = r.chunks ?? []
  const first = chunks.find((c) => c.chunking)?.chunking
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        <Chip tone="theme-text">Track 1 · vector RAG</Chip>
        {first?.embedding_model && <Chip title="The embedding model the index was built with">{first.embedding_model}</Chip>}
        <Chip title="How many chunks were asked for">top {r.top_k ?? '-'}</Chip>
        {r.rerank_model && <Chip title={`Re-ranked ${r.candidates ?? '?'} candidates down to ${r.top_k ?? '?'}`}>rerank {r.rerank_model} · {r.candidates ?? '?'}→{r.top_k ?? '?'}</Chip>}
        <Chip title="Search, plus re-ranking">{formatMs(r.retrieval_ms)}{r.rerank_ms ? ` + ${formatMs(r.rerank_ms)}` : ''}</Chip>
        {r.store && <Chip title="The Chroma collection searched">{r.store}</Chip>}
      </div>
      {r.query && <p className="text-[11px] theme-text-muted">Searched for: <span className="theme-text">{r.query}</span></p>}
      {chunks.length ? (
        <>
          <p className="text-[10px] theme-text-muted">
            {chunks.filter((c) => c.cited).length} of {chunks.length} chunks cited, from{' '}
            {(r.documents ?? []).length} document{(r.documents ?? []).length === 1 ? '' : 's'}
          </p>
          <ol className="space-y-1">{chunks.map((c) => <ChunkRow key={c.chunk_id} c={c} />)}</ol>
        </>
      ) : (
        <p className="text-[11px] theme-text-muted">The search ran and returned no chunks.</p>
      )}
    </div>
  )
}

function GraphRetrieval({ r }: { r: RetrievalDetail }) {
  const nodes = r.nodes ?? []
  const name = (id: string) => nodes.find((n) => n.id === id)?.name ?? id
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        <Chip tone="theme-text">Track 2 · graph RAG</Chip>
        {r.entry_strategy && <Chip title="How the walk found its starting nodes">entry: {r.entry_strategy}</Chip>}
        <Chip title="How far the walk went">{r.hop_count ?? (r.hops ?? []).length} hops</Chip>
        <Chip>{formatMs(r.retrieval_ms)}</Chip>
      </div>
      {(r.entry_nodes ?? []).length > 0 && (
        <p className="text-[11px] theme-text-muted">
          Entered at: <span className="theme-text">{(r.entry_nodes ?? []).map(name).join(', ')}</span>
        </p>
      )}
      {(r.hops ?? []).length > 0 && (
        <ol className="space-y-1">
          {(r.hops ?? []).map((h) => (
            <li key={h.hop} className="rounded-md border theme-border px-2.5 py-1.5 text-[11px]">
              <span className="mr-1.5 tabular-nums theme-text-muted">{h.hop}.</span>
              <span className="theme-text">{h.from.map(name).join(', ')}</span>
              <span className="mx-1.5 font-mono text-[10px] theme-accent">—{h.edge}→</span>
              <span className="theme-text">{h.to.map(name).join(', ') || '(nothing)'}</span>
              {h.reason && <p className="mt-0.5 text-[10px] theme-text-muted">{h.reason}</p>}
            </li>
          ))}
        </ol>
      )}
      {nodes.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {nodes.map((n) => (
            <Chip
              key={n.id}
              tone={n.cited ? 'status-ok' : n.missing ? 'status-warn' : 'theme-text-muted'}
              title={`${n.type ?? 'node'} ${n.id}${n.cited ? ', cited' : ''}${n.missing ? ', no longer in the graph' : ''}`}
            >
              {n.cited && `${n.label} `}{n.name}
            </Chip>
          ))}
        </div>
      )}
    </div>
  )
}

export function RetrievalPanel({ retrievals }: { retrievals: RetrievalDetail[] }) {
  if (!retrievals.length) return null
  return (
    <section className="space-y-3 rounded-lg border theme-border theme-card p-3">
      <header className="flex items-center gap-2">
        {retrievals.some((r) => r.track === 'graph') ? <Network size={12} className="theme-accent" /> : <BookOpen size={12} className="theme-accent" />}
        <h3 className="text-xs font-medium theme-text">Retrieval</h3>
        <span className="text-[10px] theme-text-muted">what was looked up, and what the answer used</span>
      </header>
      {retrievals.map((r, i) => (
        <div key={i} className={i ? 'border-t theme-border pt-3' : ''}>
          {r.track === 'graph' ? <GraphRetrieval r={r} /> : <VectorRetrieval r={r} />}
        </div>
      ))}
    </section>
  )
}
