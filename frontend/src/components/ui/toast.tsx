import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle2, XCircle, X, Copy, Check } from 'lucide-react'
import { API_ERROR_EVENT, type ApiErrorDetail } from '../../lib/http'

type Action = { label: string; onClick: () => void }

/** The toast itself, with no positioning: `Toast` and `ToastHost` place it. */
export function ToastCard({
  tone, title, body, action, footer, onClose,
}: {
  tone: 'ok' | 'bad'
  title: string
  body?: string
  action?: Action
  /** Small print under the body — an error id, say. */
  footer?: ReactNode
  onClose: () => void
}) {
  const Icon = tone === 'ok' ? CheckCircle2 : XCircle
  return (
    <div
      role={tone === 'ok' ? 'status' : 'alert'}
      className={`pointer-events-auto flex w-80 max-w-[calc(100vw-2rem)] items-start gap-2.5 rounded-xl border p-3 shadow-2xl theme-card animate-in fade-in slide-in-from-bottom-2 duration-200 ${
        tone === 'ok' ? 'border-emerald-400/40' : 'border-rose-400/40'
      }`}
    >
      <Icon size={16} className={`mt-0.5 shrink-0 ${tone === 'ok' ? 'text-emerald-400' : 'text-rose-400'}`} />
      <div className="min-w-0 flex-1">
        <p className="text-xs theme-text">{title}</p>
        {body && <p className="mt-0.5 break-words text-[11px] leading-relaxed theme-text-muted">{body}</p>}
        {footer}
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
    </div>
  )
}

/**
 * A pop-up in the corner that reports how a background job ended.
 *
 * A success clears itself after a few seconds. A failure stays until it is
 * dismissed, because it is the one you need to act on.
 */
export function Toast(props: {
  tone: 'ok' | 'bad'
  title: string
  body?: string
  action?: Action
  onClose: () => void
}) {
  const { tone, onClose } = props
  useEffect(() => {
    if (tone !== 'ok') return
    const timer = window.setTimeout(onClose, 6000)
    return () => window.clearTimeout(timer)
  }, [tone, onClose])

  return createPortal(
    <div className="pointer-events-none fixed bottom-4 right-4 z-[210]">
      <ToastCard {...props} />
    </div>,
    document.body,
  )
}

const MAX_SHOWN = 4

/**
 * Every failed action, as a toast that says why — mounted once at the root.
 *
 * Listens for `API_ERROR_EVENT`, which `lib/http.ts` fires when a save, upload
 * or delete fails. Each toast carries the reason the backend gave, and for an
 * unexpected error the id it was logged under, so it can be found again in
 * Settings → Process Log. "Copy details" puts all of it on the clipboard for a
 * bug report. They stay until dismissed; the newest four are kept.
 */
export function ToastHost() {
  const [errors, setErrors] = useState<(ApiErrorDetail & { key: number })[]>([])

  useEffect(() => {
    const onError = (e: Event) => {
      const detail = (e as CustomEvent<ApiErrorDetail>).detail
      setErrors((prev) => [
        // The same failure twice in a row is one toast, not two.
        ...prev.filter((p) => !(p.path === detail.path && p.message === detail.message)),
        { ...detail, key: Date.now() + Math.random() },
      ].slice(-MAX_SHOWN))
    }
    window.addEventListener(API_ERROR_EVENT, onError)
    return () => window.removeEventListener(API_ERROR_EVENT, onError)
  }, [])

  if (errors.length === 0) return null
  return createPortal(
    <div className="pointer-events-none fixed bottom-4 right-4 z-[210] flex flex-col items-end gap-2">
      {errors.map((e) => (
        <ToastCard
          key={e.key}
          tone="bad"
          title={e.status >= 500 ? 'Something went wrong on the server' : 'That didn’t work'}
          body={e.message}
          footer={<ErrorFooter error={e} />}
          onClose={() => setErrors((prev) => prev.filter((p) => p.key !== e.key))}
        />
      ))}
    </div>,
    document.body,
  )
}

function ErrorFooter({ error }: { error: ApiErrorDetail }) {
  const [copied, setCopied] = useState(false)
  const details = [
    `${error.method} ${error.path}`,
    `status ${error.status}`,
    error.errorId ? `error id ${error.errorId}` : null,
    `reason: ${error.message}`,
    `at ${new Date().toISOString()}`,
  ].filter(Boolean).join('\n')

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] theme-text-muted">
      <span className="font-mono">{error.method} {error.path.split('?')[0]} · {error.status}</span>
      {error.errorId && (
        <span title="Search for this in Settings → Process Log to see the full error">
          error <span className="font-mono theme-text">{error.errorId}</span> · in Process Log
        </span>
      )}
      <button
        onClick={() => {
          void navigator.clipboard.writeText(details)
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1500)
        }}
        className="flex items-center gap-1 hover:theme-text"
      >
        {copied ? <Check size={10} /> : <Copy size={10} />} {copied ? 'Copied' : 'Copy details'}
      </button>
    </div>
  )
}
