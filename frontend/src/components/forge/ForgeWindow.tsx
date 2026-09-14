import { Hammer, Gauge, Download, FlaskConical, Check } from 'lucide-react'
import { FloatingWindow } from '../ui/floating-window'
import { HardwareView } from './HardwareView'

/**
 * The Forge — hardware and model console (Layer 11, PROJECT.md §8.2).
 *
 * Six steps are specified: detect · estimate · score · manage · benchmark ·
 * commit. **Only step 1 is built.** The rest are listed here rather than hidden
 * so the window says what it will be, and so nobody has to read
 * docs/MODULES.md §2 to find out what is missing.
 *
 * Rule 5 — this is a setup surface. It writes model configuration and pulls
 * models; the orchestrator must never reach it, and nothing here is exposed to
 * the model as a tool.
 */

const PLANNED = [
  {
    icon: Gauge,
    title: 'Estimate & score',
    body: 'Memory per model × quantization, scored safe / marginal / will-not-fit against the available RAM above.',
  },
  {
    icon: Download,
    title: 'Manage models',
    body: 'List, pull and delete Ollama models. A local API call, which Rule 1 permits.',
  },
  {
    icon: FlaskConical,
    title: 'Benchmark',
    body: 'Time-to-first-token and tok/s on a RAG-context-sized prompt — the measurement that replaces the estimate in the report.',
  },
  {
    icon: Check,
    title: 'Commit',
    body: 'Write the chosen model to config/model_config.json for FastAPI to consume. Never hardcoded.',
  },
]

export function ForgeWindow({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <FloatingWindow
      open={open}
      onClose={onClose}
      title="The Forge"
      subtitle="hardware & model console"
      icon={<Hammer size={16} className="theme-primary" />}
      width={860}
      height={700}
    >
      {({ isPeek }) => (
        <div className="@container flex-1 overflow-y-auto no-scrollbar p-6">
          <div className="mx-auto w-full @3xl:max-w-3xl space-y-6">
            <HardwareView isPeek={isPeek} />

            {/* Step 1 of 6 is built. Say so plainly rather than leaving the
                window looking like it is merely a hardware readout. */}
            <div>
              <div className="flex items-center gap-2 mb-1">
                <h4 className="text-sm font-medium">Not built yet</h4>
                <span className="text-[10px] px-1.5 py-0.5 rounded border theme-border theme-text-muted uppercase tracking-wide">
                  1 of 6 steps
                </span>
              </div>
              <p className="text-xs theme-text-muted mb-3">
                Detection works. The rest of §8.2 is specified in{' '}
                <code className="theme-text">docs/MODULES.md</code> §2 and not implemented.
              </p>
              <div className="grid grid-cols-1 @xl:grid-cols-2 gap-3">
                {PLANNED.map((step) => (
                  <div
                    key={step.title}
                    className={`p-4 rounded-xl border theme-border border-dashed ${
                      isPeek ? 'bg-transparent' : 'bg-black/5'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1.5 theme-text-muted">
                      <step.icon size={14} />
                      <span className="text-sm font-medium">{step.title}</span>
                    </div>
                    <p className="text-xs theme-text-muted opacity-75">{step.body}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </FloatingWindow>
  )
}
