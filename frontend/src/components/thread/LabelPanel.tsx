import { useState } from 'react'
import { Tag } from 'lucide-react'
import { saveLabel, type TraceLabel } from '../../lib/threadClient'

/**
 * A person's verdict on the answer — the ground truth the evaluation needs
 * (MODULES.md §1.4: the validator is a detector, `hallucination_flag` is a
 * person's call). Stored as a new `feedback_logs` row each time; the newest wins.
 */
export function LabelPanel({ queryId, initial }: { queryId: string; initial: TraceLabel | null }) {
  const [label, setLabel] = useState(initial)
  const [note, setNote] = useState(initial?.note ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = (hallucinated: boolean | null) => {
    setSaving(true)
    setError(null)
    void saveLabel(queryId, hallucinated, hallucinated === null ? null : note.trim() || null)
      .then((l) => { setLabel(l); if (!l) setNote('') })
      .catch((e: Error) => setError(e.message))
      .finally(() => setSaving(false))
  }

  const choice = label ? (label.hallucinated ? 'bad' : 'ok') : null
  const optionClass = (on: boolean, tone: string) =>
    `flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] transition-colors disabled:opacity-50 ${
      on ? `${tone} theme-surface-strong theme-accent-border` : 'theme-border theme-text-muted hover:theme-text'
    }`

  return (
    <section className="space-y-2 rounded-lg border theme-border theme-card p-3">
      <header className="flex items-center gap-2">
        <Tag size={12} className="theme-accent" />
        <h3 className="text-xs font-medium theme-text">Your label</h3>
        <span className="text-[10px] theme-text-muted">
          {label ? `saved ${new Date(label.timestamp).toLocaleString()}` : 'not labelled yet'}
        </span>
      </header>
      <p className="text-[10px] leading-relaxed theme-text-muted">
        Did this answer state anything the evidence does not support? This is the evaluation's ground
        truth; the colours above are only the detector's guess.
      </p>
      <div className="flex flex-wrap items-center gap-1.5">
        <button disabled={saving} onClick={() => save(false)} className={optionClass(choice === 'ok', 'status-ok')}>
          Correct
        </button>
        <button disabled={saving} onClick={() => save(true)} className={optionClass(choice === 'bad', 'status-bad')}>
          Hallucinated
        </button>
        {label && (
          <button disabled={saving} onClick={() => save(null)} className="ml-auto text-[10px] theme-text-muted hover:theme-text">
            Clear label
          </button>
        )}
      </div>
      <textarea
        aria-label="Label note"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        maxLength={2000}
        rows={2}
        placeholder="Note (optional): what was wrong, or why it is right"
        className="w-full resize-y rounded-md border theme-border bg-transparent px-2 py-1.5 text-[11px] theme-text outline-none placeholder:opacity-50 focus:ring-1 focus:ring-[var(--primary)]"
      />
      {label && note.trim() !== (label.note ?? '') && (
        <button
          disabled={saving}
          onClick={() => save(label.hallucinated)}
          className="text-[10px] theme-accent hover:underline disabled:opacity-50"
        >
          Save the note with this label
        </button>
      )}
      {error && <p className="text-[11px] status-bad">Could not save: {error}</p>}
    </section>
  )
}
