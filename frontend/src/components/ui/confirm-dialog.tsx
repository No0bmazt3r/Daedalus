import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, Loader2 } from 'lucide-react'

/**
 * A themed confirmation, for actions that cannot be undone.
 *
 * The codebase used `window.confirm` for its two destructive paths. That works,
 * and it costs three things worth more than the lines it saves: the dialog is
 * drawn by the operating system so it ignores the theme entirely, it cannot say
 * *what* is about to happen beyond one line of text, and it cannot ask the
 * person to type anything — so a mis-click and a decision look identical.
 *
 * ## `requireTyped`
 *
 * For the graver actions — the audit log, everything at once — the confirm
 * button stays disabled until the exact word is typed. Two clicks in a row can
 * be muscle memory; typing `DELETE` cannot. Odysseus asks twice with two
 * dialogs, which stops the accidental second click but not the reflexive one.
 *
 * Escape cancels, the confirm button takes focus on open, and focus returns to
 * whatever opened it on close.
 */

interface ConfirmDialogProps {
  open: boolean
  title: string
  /** What will happen. Shown as body copy, so it can be a sentence or two. */
  body: React.ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** Red treatment, for anything irreversible. */
  danger?: boolean
  /** When set, the confirm button unlocks only once this exact text is typed. */
  requireTyped?: string
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  requireTyped,
  busy = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState('')
  const confirmRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  // Remembered on open so focus can go back where it came from — a dialog that
  // drops focus to <body> leaves a keyboard user at the top of the page.
  const opener = useRef<HTMLElement | null>(null)

  // A reopened dialog starts with an empty confirmation field — reset during
  // render on the closed→open edge, not in the effect below.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setTyped('')
  }

  useEffect(() => {
    if (!open) return
    opener.current = document.activeElement as HTMLElement | null
    // After paint, or the element is not focusable yet.
    const id = window.setTimeout(() => {
      (requireTyped ? inputRef.current : confirmRef.current)?.focus()
    }, 0)
    return () => {
      window.clearTimeout(id)
      opener.current?.focus?.()
    }
  }, [open, requireTyped])

  const onKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      onCancel()
    }
  }, [onCancel])

  if (!open) return null

  const unlocked = !requireTyped || typed.trim() === requireTyped

  return createPortal(
    <div
      // Above the floating windows, which is where this is opened from.
      className="fixed inset-0 z-[200] flex items-center justify-center p-4 animate-in fade-in duration-150"
      onKeyDown={onKeyDown}
    >
      {/* Clicking away cancels — the safe outcome, so it needs no confirmation
          of its own. */}
      <div
        className="absolute inset-0 bg-black/55 backdrop-blur-[2px]"
        onClick={onCancel}
        aria-hidden
      />

      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        className="relative w-full max-w-sm rounded-2xl border confirm-glass shadow-2xl px-6 pt-6 pb-5 text-center animate-in zoom-in-95 duration-150"
      >
        {danger && (
          <div className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-full status-bad-bg">
            <AlertTriangle size={20} className="status-bad" />
          </div>
        )}
        <h3 id="confirm-dialog-title" className="text-sm font-semibold theme-text mb-1.5">
          {title}
        </h3>
        <div className="text-xs theme-text-muted leading-relaxed">{body}</div>

        {requireTyped && (
          <label className="block mt-4">
            <span className="text-[11px] theme-text-muted">
              Type <code className="font-semibold theme-text">{requireTyped}</code> to confirm
            </span>
            <input
              ref={inputRef}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && unlocked && !busy) onConfirm()
              }}
              placeholder={requireTyped}
              autoComplete="off"
              spellCheck={false}
              className="mt-1.5 w-full text-center tracking-widest placeholder:opacity-30 px-2.5 py-2 rounded-lg border theme-border theme-surface-strong theme-text text-xs font-mono outline-none focus:ring-1 focus:ring-[color-mix(in_srgb,var(--status-bad)_55%,transparent)]"
            />
          </label>
        )}

        {/* Stacked, full width: the action first, the way out right under it. */}
        <div className="mt-5 flex flex-col gap-2">
          <button
            ref={confirmRef}
            onClick={onConfirm}
            disabled={busy || !unlocked}
            className={`flex w-full items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium disabled:opacity-40 disabled:cursor-not-allowed transition-opacity hover:opacity-90 ${
              danger ? 'status-bad-fill text-white' : 'theme-bg-primary theme-text-on-primary'
            }`}
          >
            {busy && <Loader2 size={12} className="animate-spin" />}
            {confirmLabel}
          </button>
          <button
            onClick={onCancel}
            disabled={busy}
            className="w-full py-2 rounded-lg border theme-border text-xs theme-text hover:theme-surface-strong disabled:opacity-40 transition-colors"
          >
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

type ConfirmOptions = Omit<ConfirmDialogProps, 'open' | 'busy' | 'onConfirm' | 'onCancel'>

/**
 * `window.confirm`, but themed: `if (!(await confirm({...}))) return`.
 * Render the returned dialog anywhere in the component.
 */
export function useConfirm() {
  const [pending, setPending] = useState<{ options: ConfirmOptions; resolve: (ok: boolean) => void } | null>(null)
  const confirm = useCallback(
    (options: ConfirmOptions) => new Promise<boolean>((resolve) => setPending({ options, resolve })),
    [],
  )
  const close = (ok: boolean) => {
    pending?.resolve(ok)
    setPending(null)
  }
  const dialog = pending && (
    <ConfirmDialog {...pending.options} open onConfirm={() => close(true)} onCancel={() => close(false)} />
  )
  return [confirm, dialog] as const
}
