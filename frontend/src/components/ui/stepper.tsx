import { Check, ChevronLeft, ChevronRight, type LucideIcon } from 'lucide-react'

/**
 * The shared pipeline stepper — the rail, and the Back/Next footer.
 *
 * Lifted out of the corpus panel once a second flow needed it. Both tracks now
 * have a *Build* tab and they should not each invent their own idea of what a
 * step looks like: the rail is how somebody reads "this is a process with an
 * order", and two rails that disagreed would undo that in the one place the two
 * arms are meant to be directly comparable.
 *
 * ## What earns a stepper, and what does not
 *
 * A stepper is right when the stages are **sequential and dependent** — when a
 * later stage is meaningless or impossible until an earlier one is done, and
 * when showing them all at once shows things nobody can act on. Ingestion
 * qualifies: there is nothing to chunk before a document is imported. Graph
 * authoring qualifies: an edge cannot exist before its two endpoints do.
 *
 * It is wrong for a short form — splitting four fields across three screens is
 * ceremony — and wrong for a comparison, where the whole point is seeing the
 * columns together. The Forge's model table is the clearest example of the
 * second: its estimate, verdict and measurement are columns of one row, and
 * `ForgeWindow` already argues that separating them would hide the comparison
 * the module exists to make. It is deliberately not a stepper.
 */

export interface Step {
  id: number
  label: string
  icon: LucideIcon
  hint: string
}

export function StepRail({
  steps, step, setStep, blocked,
}: {
  steps: readonly Step[]
  step: number
  setStep: (n: number) => void
  /** Why each step cannot be reached yet, by id. Absent means reachable. */
  blocked: Record<number, string | undefined>
}) {
  return (
    <ol className="flex items-start" aria-label="Ingestion pipeline">
      {steps.map((s, i) => {
        const why = blocked[s.id]
        const active = step === s.id
        const done = step > s.id
        const Icon = s.icon
        return (
          <li key={s.id} className="flex min-w-0 flex-1 items-start last:flex-none">
            <div className="flex min-w-0 flex-col items-center gap-1.5">
              <button
                onClick={() => !why && setStep(s.id)}
                disabled={!!why}
                title={why ?? s.hint}
                aria-current={active ? 'step' : undefined}
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[11px] tabular-nums transition-colors duration-300 ${
                  done
                    ? 'theme-bg-primary border-transparent theme-text-on-primary'
                    : active
                      ? `theme-accent-border theme-surface-strong theme-accent step-dot-active`
                      : why
                        ? 'theme-border theme-text-muted opacity-35 cursor-not-allowed'
                        : 'theme-border theme-text-muted hover:theme-text'
                }`}
              >
                {done ? <Check size={12} /> : active ? <Icon size={12} /> : s.id}
              </button>
              <span
                className={`max-w-[7rem] truncate text-center text-[10px] transition-colors duration-300 ${
                  active ? 'theme-text' : why ? 'theme-text-muted opacity-35' : 'theme-text-muted'
                }`}
              >
                {s.label}
              </span>
            </div>

            {i < steps.length - 1 && (
              <div
                aria-hidden
                className={`step-track mx-1.5 mt-3 min-w-4 flex-1 ${
                  // The segment being crossed is the one *leaving* the current
                  // step, and only while its destination is actually reachable.
                  step === s.id && !blocked[s.id + 1] ? 'step-track-flow' : ''
                }`}
              >
                <span className="step-track-fill" data-filled={step > s.id} />
              </div>
            )}
          </li>
        )
      })}
    </ol>
  )
}

export function StepFooter({
  steps, step, setStep, nextBlocked, nextLabel,
}: {
  steps: readonly Step[]
  step: number
  setStep: (n: number) => void
  nextBlocked?: string
  nextLabel?: string
}) {
  return (
    <div className="flex items-center gap-2 border-t theme-border pt-3">
      <button
        onClick={() => setStep(step - 1)}
        disabled={step === 1}
        className="flex items-center gap-1 rounded-md border theme-border px-2 py-1 text-[11px] theme-text-muted transition-colors hover:theme-text disabled:opacity-30"
      >
        <ChevronLeft size={11} /> Back
      </button>
      {nextBlocked && (
        <span className="min-w-0 flex-1 truncate text-[10px] theme-text-muted">{nextBlocked}</span>
      )}
      {step < steps.length && (
        <button
          onClick={() => setStep(step + 1)}
          disabled={!!nextBlocked}
          className={`${nextBlocked ? '' : 'ml-auto'} flex items-center gap-1 rounded-md border theme-accent-border px-2.5 py-1 text-[11px] theme-accent transition-colors hover:theme-surface-strong disabled:opacity-30`}
        >
          {nextLabel ?? `Next: ${steps[step].label}`} <ChevronRight size={11} />
        </button>
      )}
    </div>
  )
}
