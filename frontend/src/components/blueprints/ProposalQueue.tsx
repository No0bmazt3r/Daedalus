import { useCallback, useEffect, useState } from 'react'
import {
  Sparkles, Check, X, AlertTriangle, AlertCircle, Loader2, Quote, Link2, Boxes,
} from 'lucide-react'
import {
  fetchProposalStatus, fetchProposals, generateProposals, acceptProposal, rejectProposal,
  type ProposalStatus, type GraphProposal,
} from '../../lib/blueprintsClient'
import { Skeleton } from '../ui/skeleton'

/**
 * Assisted authoring — the model proposes, you dispose.
 *
 * Hand-typing every node is the cost of the provenance claim that makes
 * `search_graph` `SYSTEM` integrity rather than `CORPUS`. This removes the
 * typing and keeps the claim: candidates are extracted from the **ingested
 * corpus** under the graph's own fixed schema, and nothing reaches the YAML
 * until somebody accepts it here.
 *
 * ## Every row carries its evidence
 *
 * A proposal without the sentence that supports it is a guess with a confident
 * shape. The extractor is required to quote verbatim from the source chunk and
 * to omit anything it cannot quote, so the review is *read the sentence, check
 * the claim* rather than *trust the model*. That is the difference between this
 * and generating nodes.
 *
 * ## Invalid proposals are shown, not hidden
 *
 * A proposer that silently dropped its own bad output would look perfect and
 * hide the number this feature is actually judged on. They are queued with the
 * schema's refusal attached — and that refusal is a **snapshot from propose
 * time**, so "endpoint does not exist" stops being true the moment you accept
 * the node it was waiting for. Accepting re-validates for real, which is why the
 * button warns rather than disappears.
 *
 * ## Nodes are listed before edges
 *
 * An edge is only acceptable once both endpoints exist, so a reviewer working
 * top-down should not meet a refusal caused by a row further down the list.
 */

function Row({
  proposal, busy, onAccept, onReject,
}: {
  proposal: GraphProposal
  busy: boolean
  onAccept: () => void
  onReject: () => void
}) {
  const invalid = !proposal.valid
  const isNode = proposal.target === 'node'
  return (
    <li
      className={`rounded-lg border p-2.5 ${
        invalid ? 'border-amber-400/40 bg-amber-400/5' : 'theme-border theme-card'
      }`}
    >
      <div className="flex items-start gap-2">
        {isNode ? (
          <Boxes size={13} className="mt-0.5 shrink-0 theme-accent" />
        ) : (
          <Link2 size={13} className="mt-0.5 shrink-0 theme-accent" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-[11px] theme-text">
            {isNode
              ? proposal.element_id
              : `${proposal.source_id} —${proposal.edge_type}→ ${proposal.target_id}`}
          </p>
          {isNode && Object.keys(proposal.attributes).length > 0 && (
            <p className="mt-0.5 text-[10px] theme-text-muted">
              {Object.entries(proposal.attributes)
                .map(([k, v]) => `${k}: ${String(v)}`)
                .join(' · ')}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={onAccept}
            disabled={busy}
            title={
              invalid
                ? 'The schema refused this when it was proposed. Accepting re-checks against the graph as it is now — which may have changed.'
                : 'Add this to the graph'
            }
            className={`rounded-md border px-2 py-0.5 text-[10px] transition-colors disabled:opacity-40 ${
              invalid
                ? 'border-amber-400/40 text-amber-400 hover:bg-amber-400/10'
                : 'theme-accent-border theme-accent hover:theme-surface-strong'
            }`}
          >
            <Check size={10} className="mr-1 inline" />
            {invalid ? 'Accept anyway' : 'Accept'}
          </button>
          <button
            onClick={onReject}
            disabled={busy}
            className="rounded-md border theme-border px-2 py-0.5 text-[10px] theme-text-muted transition-colors hover:text-rose-400 disabled:opacity-40"
          >
            <X size={10} className="mr-1 inline" /> Reject
          </button>
        </div>
      </div>

      {proposal.evidence && (
        <p className="mt-1.5 flex items-start gap-1.5 text-[10px] leading-relaxed theme-text-muted">
          <Quote size={9} className="mt-0.5 shrink-0 opacity-60" />
          <span className="italic">{proposal.evidence}</span>
        </p>
      )}

      {invalid && proposal.validation_error && (
        <p className="mt-1.5 whitespace-pre-line text-[10px] leading-relaxed text-amber-400">
          {proposal.validation_error}
        </p>
      )}
      {proposal.decided_error && (
        <p className="mt-1.5 text-[10px] leading-relaxed text-rose-400">
          {proposal.decided_error}
        </p>
      )}
    </li>
  )
}

export function ProposalQueue({ onApplied }: { onApplied: () => void }) {
  const [status, setStatus] = useState<ProposalStatus | null>(null)
  const [proposals, setProposals] = useState<GraphProposal[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(() => {
    void fetchProposalStatus().then(setStatus).catch(() => setStatus(null))
    void fetchProposals('pending').then((r) => setProposals(r.proposals)).catch(() => setProposals([]))
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const act = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(null)
      refresh()
      onApplied()
    }
  }

  if (!status) return <Skeleton className="h-64 w-full" />

  const nothingToRead = status.chunks_available === 0

  return (
    <div className="space-y-3">
      <p className="text-[11px] leading-relaxed theme-text-muted">
        Reads the ingested corpus and proposes nodes and edges that fit this graph's schema —
        seven node types, seven relations, fixed endpoints. Nothing is written until you accept it,
        and every proposal quotes the sentence it came from so the review is checking a claim
        rather than trusting a model.
      </p>

      <div className="grid grid-cols-2 gap-2 @2xl:grid-cols-4">
        {([
          ['Pending', status.counts.pending],
          ['Accepted', status.counts.accepted],
          ['Rejected', status.counts.rejected],
          ['Chunks to read', Math.min(status.chunks_available, status.max_chunks)],
        ] as const).map(([label, value]) => (
          <div key={label} className="rounded-lg border theme-border theme-card px-3 py-2">
            <div className="text-lg tabular-nums theme-text">{value}</div>
            <div className="text-[10px] uppercase tracking-wider theme-text-muted">{label}</div>
          </div>
        ))}
      </div>

      <button
        onClick={() => act('generate', () => generateProposals())}
        disabled={!!busy || nothingToRead}
        className="flex items-center gap-1.5 rounded-md border theme-accent-border px-2.5 py-1 text-[11px] theme-accent transition-colors hover:theme-surface-strong disabled:opacity-40"
      >
        {busy === 'generate' ? (
          <Loader2 size={11} className="animate-spin" />
        ) : (
          <Sparkles size={11} />
        )}
        {busy === 'generate' ? 'Reading the corpus…' : 'Propose from the corpus'}
      </button>

      {nothingToRead && (
        <p className="flex items-start gap-1.5 text-[10px] leading-relaxed theme-text-muted">
          <AlertCircle size={11} className="mt-0.5 shrink-0" />
          There is nothing to read yet. The proposer extracts from ingested chunks — import and
          ingest documents in Corpus → Build first. It deliberately never reads the web: unreviewed
          external text in the graph would break the provenance this queue exists to protect.
        </p>
      )}

      {error && (
        <p className="flex items-start gap-1.5 whitespace-pre-line text-[11px] text-rose-400">
          <AlertCircle size={12} className="mt-0.5 shrink-0" /> {error}
        </p>
      )}

      {status.runs[0] && (
        <p className="text-[10px] theme-text-muted">
          Last run: {status.runs[0].proposed} proposed · {status.runs[0].duplicates} already in the
          graph · {status.runs[0].invalid} refused by the schema
          {status.runs[0].model ? ` · ${status.runs[0].model}` : ''}
          {status.runs[0].elapsed_ms != null
            ? ` · ${(status.runs[0].elapsed_ms / 1000).toFixed(1)}s`
            : ''}
        </p>
      )}

      {proposals.length > 0 && (
        <ul className="max-h-[26rem] space-y-1.5 overflow-y-auto no-scrollbar">
          {proposals.map((p) => (
            <Row
              key={p.proposal_id}
              proposal={p}
              busy={!!busy}
              onAccept={() => act(p.proposal_id, () => acceptProposal(p.proposal_id))}
              onReject={() => act(p.proposal_id, () => rejectProposal(p.proposal_id))}
            />
          ))}
        </ul>
      )}

      {proposals.length === 0 && !nothingToRead && status.runs.length > 0 && (
        <p className="flex items-start gap-1.5 text-[10px] leading-relaxed theme-text-muted">
          <AlertTriangle size={11} className="mt-0.5 shrink-0" />
          Nothing pending. Everything the last run found was either already in the graph or has
          been decided — a high duplicate count means the corpus is already well represented,
          which is a useful thing to learn early.
        </p>
      )}
    </div>
  )
}
