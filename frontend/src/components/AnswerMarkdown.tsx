import { Children, type ReactNode } from 'react'
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
export function AnswerMarkdown({ text, evidence }: { text: string; evidence?: StoredEvidence }) {
  // Chips and readings go on the text nodes; Markdown has already taken the
  // formatting out, so `[D1]` is still plain text here (it is not a link
  // without a definition).
  const enrich = (children: ReactNode) =>
    Children.map(children, (c) => (typeof c === 'string' ? withCitations(c, evidence, text) : c))

  const components: Components = {
    p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{enrich(children)}</p>,
    strong: ({ children }) => <strong className="font-semibold theme-text">{enrich(children)}</strong>,
    em: ({ children }) => <em>{enrich(children)}</em>,
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
