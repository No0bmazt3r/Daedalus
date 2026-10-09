import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle2, XCircle, X } from 'lucide-react'

/**
 * A pop-up in the corner that reports how a background job ended.
 *
 * A success clears itself after a few seconds. A failure stays until it is
 * dismissed, because it is the one you need to act on.
 */
export function Toast({
  tone, title, body, action, onClose,
}: {
  tone: 'ok' | 'bad'
  title: string
  body?: string
  action?: { label: string; onClick: () => void }
  onClose: () => void
}) {
  useEffect(() => {
    if (tone !== 'ok') return
    const timer = window.setTimeout(onClose, 6000)
    return () => window.clearTimeout(timer)
  }, [tone, onClose])

  const Icon = tone === 'ok' ? CheckCircle2 : XCircle
  return createPortal(
    <div
      role={tone === 'ok' ? 'status' : 'alert'}
      className={`fixed bottom-4 right-4 z-[210] flex w-80 max-w-[calc(100vw-2rem)] items-start gap-2.5 rounded-xl border p-3 shadow-2xl theme-card animate-in fade-in slide-in-from-bottom-2 duration-200 ${
        tone === 'ok' ? 'border-emerald-400/40' : 'border-rose-400/40'
      }`}
    >
      <Icon size={16} className={`mt-0.5 shrink-0 ${tone === 'ok' ? 'text-emerald-400' : 'text-rose-400'}`} />
      <div className="min-w-0 flex-1">
        <p className="text-xs theme-text">{title}</p>
        {body && <p className="mt-0.5 text-[11px] leading-relaxed theme-text-muted">{body}</p>}
        {action && (
          <button
            onClick={() => { action.onClick(); onClose() }}
            className="mt-2 rounded-md border theme-border px-2 py-1 text-[11px] theme-text transition-colors hover:theme-surface-strong"
          >
            {action.label}
          </button>
        )}
      </div>
      <button onClick={onClose} aria-label="Dismiss" className="shrink-0 rounded p-1 theme-text-muted hover:theme-text">
        <X size={12} />
      </button>
    </div>,
    document.body,
  )
}
