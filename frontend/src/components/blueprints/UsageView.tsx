import { useEffect, useState } from 'react'
import { CheckCircle2, AlertCircle } from 'lucide-react'
import { TabError } from '../errors/TabError'
import { toFailure, type LoadFailure } from '../errors/ErrorPage'
import { fetchDocumentUsage, type DocumentUsage } from '../../lib/blueprintsClient'
import { Skeleton } from '../ui/skeleton'

/**
 * Which documents earn their place — Track 1's counterpart to Coverage.
 *
 * Per document, how often a retrieval returned it and how often an answer
 * cited it, from `rag_logs` and the stored evidence of each answer. A document
 * nothing retrieves is knowledge nothing reaches; one retrieved but never cited
 * costs prompt tokens and earns nothing. Both are what to look at once the real
 * corpus is in.
 */
const SECTIONS: { verdict: DocumentUsage['verdict']; title: string; consequence: string }[] = [
  {
    verdict: 'never_retrieved',
    title: 'Never retrieved',
    consequence: 'No question has reached this document yet. Either nobody asked about it, or its chunks do not match how operators phrase things.',
  },
  {
    verdict: 'never_cited',
    title: 'Retrieved, never cited',
    consequence: 'It reaches the prompt but no answer used it, so it takes context room and adds nothing. Check whether it is noise for these questions.',
  },
  {
    verdict: 'cited',
    title: 'Cited',
    consequence: 'Answers used it. The counts say how often.',
  },
]

export function UsageView() {
  const [rows, setRows] = useState<DocumentUsage[] | null>(null)
  const [error, setError] = useState<LoadFailure | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    fetchDocumentUsage().then((d) => { setRows(d.documents); setError(null) }).catch((e: unknown) => setError(toFailure(e)))
  }, [attempt])

  if (error) {
    return (
      <TabError
        code={error.status}
        detail={error.message}
        what="Document usage could not be read from the backend."
        onRetry={() => { setError(null); setAttempt((n) => n + 1) }}
      />
    )
  }
  return (
    <div className="space-y-5">
      <header>
        <h3 className="text-sm theme-text">Usage</h3>
        <p className="text-xs theme-text-muted">
          Which documents earn their place: retrieved by each track, and cited by answers.
        </p>
      </header>
      {!rows && <Skeleton className="h-48 w-full" />}
      {rows && SECTIONS.map(({ verdict, title, consequence }) => {
        const items = rows.filter((r) => r.verdict === verdict)
        const good = verdict === 'cited'
        return (
          <section key={verdict} className="rounded-lg border theme-border theme-card p-3">
            <div className="flex items-center gap-2">
              {good || items.length === 0
                ? <CheckCircle2 size={13} className="text-emerald-400 shrink-0" />
                : <AlertCircle size={13} className="text-amber-400 shrink-0" />}
              <h4 className="text-xs theme-text">{title}</h4>
              <span className="ml-auto text-[10px] theme-text-muted">{items.length}</span>
            </div>
            <p className="mt-1.5 pl-5 text-[11px] leading-relaxed theme-text-muted">{consequence}</p>
            {items.length > 0 && (
              <table className="mt-2.5 ml-5 w-[calc(100%-1.25rem)] text-[11px] tabular-nums">
                <thead className="text-left theme-text-muted">
                  <tr>
                    <th className="py-1 pr-3 font-normal">Document</th>
                    <th className="py-1 pr-3 font-normal">Type</th>
                    <th className="py-1 pr-3 font-normal" title="Retrievals by Track 1 (vector)">Track 1</th>
                    <th className="py-1 pr-3 font-normal" title="Retrievals by Track 2 (graph)">Track 2</th>
                    <th className="py-1 pr-3 font-normal" title="Answers that cited it">Cited</th>
                  </tr>
                </thead>
                <tbody className="theme-text">
                  {items.map((r) => (
                    <tr key={r.document_id} className="border-t theme-border">
                      <td className="py-1 pr-3 break-all">{r.filename}</td>
                      <td className="py-1 pr-3 theme-text-muted">{r.source_type}{r.origin === 'rig' ? ' · rig' : ''}</td>
                      <td className="py-1 pr-3">{r.retrieved_vector}</td>
                      <td className="py-1 pr-3">{r.retrieved_graph}</td>
                      <td className="py-1 pr-3">{r.cited}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        )
      })}
    </div>
  )
}
