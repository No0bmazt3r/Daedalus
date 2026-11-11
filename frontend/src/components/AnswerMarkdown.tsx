import { Children, type ReactNode } from 'react'
import { Ban } from 'lucide-react'
import { openThread } from '../lib/threadClient'
import Markdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { withCitations } from './Citations'
import type { StoredEvidence } from '../lib/chatClient'

/**
 * An assistant answer as Markdown — bold, lists, headings, tables — with the
 * citation chips and highlighted readings applied inside each piece of text.
 *
 * Models write Markdown whether asked to or not, and shown raw it leaves
 * `**stars**` in the text and runs list items together. `react-markdown` never
 * renders raw HTML from the text, so an answer cannot inject markup.
 */
// Where the validator cut an unsupported sentence (`chat_service.REMOVED_MARK`).
const REMOVED_MARK = '⟦removed⟧'

/**
 * The cut, shown where it happened. Not the text: the point of cutting is that
 * an unsupported number is never read as checked. "See why" opens the turn in
 * Ariadne's Thread, where the original is struck through with its reason.
 */
function RemovedMark({ queryId }: { queryId?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded px-1 align-baseline text-[0.85em] italic theme-text-muted theme-surface">
      <Ban size={11} className="shrink-0 status-warn" aria-hidden />
      Removed: not supported by the evidence
      {queryId && <span aria-hidden>·</span>}
      {queryId && (
        <button
          onClick={() => openThread(queryId)}
          className="not-italic underline underline-offset-2 hover:theme-text"
        >
          see why
        </button>
      )}
    </span>
  )
}

export function AnswerMarkdown({
  text, evidence, renderText, queryId,
}: {
  text: string
  evidence?: StoredEvidence
  /** The turn's id, so a removal marker can open it in the Thread. */
  queryId?: string
  /** Replaces the default chips-and-readings treatment of each text node. */
  renderText?: (fragment: string) => ReactNode
}) {
  // Chips and readings go on the text nodes; Markdown has already taken the
  // formatting out, so `[D1]` is still plain text here (it is not a link
  // without a definition).
  const render = renderText ?? ((c: string) => {
    if (!c.includes(REMOVED_MARK)) return withCitations(c, evidence, text)
    return c.split(REMOVED_MARK).flatMap((part, i) => [
      ...(i ? [<RemovedMark key={`removed-${i}`} queryId={queryId} />] : []),
      ...(part ? [<span key={`part-${i}`}>{withCitations(part, evidence, text)}</span>] : []),
    ])
  })
  const enrich = (children: ReactNode) =>
    Children.map(children, (c) => (typeof c === 'string' ? render(c) : c))

  const components: Components = {
    p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{enrich(children)}</p>,
    strong: ({ children }) => <strong className="font-semibold theme-text">{enrich(children)}</strong>,
    em: ({ children }) => <em>{enrich(children)}</em>,
    // The Thread strikes what the validator cut; muted so it reads as gone.
    del: ({ children }) => <del className="line-through decoration-2 decoration-[var(--status-warn)] opacity-60">{enrich(children)}</del>,
    ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
    ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
    li: ({ children }) => <li className="pl-1">{enrich(children)}</li>,
    h1: ({ children }) => <h3 className="mb-1.5 mt-3 font-semibold first:mt-0">{enrich(children)}</h3>,
    h2: ({ children }) => <h3 className="mb-1.5 mt-3 font-semibold first:mt-0">{enrich(children)}</h3>,
    h3: ({ children }) => <h4 className="mb-1 mt-3 font-semibold first:mt-0">{enrich(children)}</h4>,
    h4: ({ children }) => <h4 className="mb-1 mt-3 font-semibold first:mt-0">{enrich(children)}</h4>,
    code: ({ children }) => <code className="rounded px-1 py-0.5 text-[0.9em] theme-surface-strong">{children}</code>,
    pre: ({ children }) => <pre className="my-2 overflow-x-auto rounded-lg p-3 text-[13px] theme-surface-strong">{children}</pre>,
    blockquote: ({ children }) => <blockquote className="my-2 border-l-2 theme-border pl-3 theme-text-muted">{children}</blockquote>,
    a: ({ children, href }) => (
      <a href={href} target="_blank" rel="noopener noreferrer" className="theme-accent underline underline-offset-2">{children}</a>
    ),
    table: ({ children }) => (
      <div className="my-2 overflow-x-auto"><table className="w-full border-collapse text-[13px]">{children}</table></div>
    ),
    th: ({ children }) => <th className="border-b theme-border px-2 py-1 text-left font-semibold">{enrich(children)}</th>,
    td: ({ children }) => <td className="border-b theme-border px-2 py-1 align-top">{enrich(children)}</td>,
  }

  return <Markdown remarkPlugins={[remarkGfm]} components={components}>{text}</Markdown>
}
