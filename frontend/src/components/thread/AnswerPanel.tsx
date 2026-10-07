import { useEffect } from 'react'
import { Database, ExternalLink, Network, X } from 'lucide-react'
import type { StoredEvidence } from '../../lib/chatClient'
import { openThread } from '../../lib/threadClient'
import { EvidenceList } from '../Citations'
import { TraceView } from './TraceView'

export type AnswerTab = 'thread' | 'evidence'

/**
 * One answer's analysis, beside the chat rather than inside it.
 *
 * The thread and the evidence pack are both worth having one click from an
 * answer, and both are long; expanded in place they pushed the next turn a
 * screen away. Here they sit in a column the chat narrows to make room for, so
 * the answer stays readable next to its working. One panel for the whole chat:
 * opening another answer's strip swaps what it shows.
 */
export function AnswerPanel({
  tab, onTab, onClose, queryId, text, evidence,
}: {
  tab: AnswerTab
  onTab: (tab: AnswerTab) => void
  onClose: () => void
  queryId: string | null
  text: string
  evidence: StoredEvidence | undefined
}) {
  // Escape closes the panel the way it closes a window.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const tabs: { id: AnswerTab; label: string; icon: typeof Network; enabled: boolean }[] = [
    { id: 'thread', label: 'Thread', icon: Network, enabled: !!queryId },
    { id: 'evidence', label: 'Evidence', icon: Database, enabled: !!evidence },
  ]

  return (
    <aside
      aria-label="Answer details"
      className="flex h-full w-[26rem] shrink-0 flex-col border-l theme-border theme-sidebar animate-in fade-in slide-in-from-right-4 duration-200 max-lg:absolute max-lg:inset-y-0 max-lg:right-0 max-lg:z-40 max-lg:shadow-2xl"
    >
      <header className="flex shrink-0 items-center gap-1 border-b theme-border px-3 py-2">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => onTab(t.id)}
            disabled={!t.enabled}
            aria-pressed={tab === t.id}
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-colors disabled:opacity-40 ${
              tab === t.id ? 'theme-surface-strong theme-text' : 'theme-text-muted hover:theme-text'
            }`}
          >
            <t.icon size={13} className="theme-accent" /> {t.label}
          </button>
        ))}
        <span className="flex-1" />
        {queryId && (
          <button
            onClick={() => openThread(queryId)}
            className="rounded-md p-1.5 theme-text-muted hover:theme-text hover:theme-surface"
            title="Open in the Ariadne's Thread window"
          >
            <ExternalLink size={13} />
          </button>
        )}
        <button
          onClick={onClose}
          className="rounded-md p-1.5 theme-text-muted hover:theme-text hover:theme-surface"
          title="Close (Esc)"
        >
          <X size={14} />
        </button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden no-scrollbar p-3">
        {tab === 'thread' && queryId ? (
          <TraceView key={queryId} queryId={queryId} compact />
        ) : tab === 'evidence' && evidence ? (
          <EvidenceList text={text} evidence={evidence} />
        ) : (
          <p className="my-auto text-center text-xs theme-text-muted">Nothing recorded for this answer.</p>
        )}
      </div>
    </aside>
  )
}
