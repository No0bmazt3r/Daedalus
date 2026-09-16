import { useState } from 'react'
import { Hammer, Cpu, Layers, Rocket, Cloud } from 'lucide-react'
import { FloatingWindow } from '../ui/floating-window'
import { HardwareView } from './HardwareView'
import { ModelsView } from './ModelsView'
import { DeploymentPanel } from './DeploymentPanel'
import { ModelEndpointsPanel } from '../settings/ModelEndpointsPanel'

/**
 * The Forge — hardware and model console (Layer 11, PROJECT.md §8.2).
 *
 * All six steps, in the order you work through them:
 *
 * | tab | steps | what it answers |
 * |---|---|---|
 * | Hardware   | 1 detect                          | what is this machine? |
 * | Models     | 2 estimate · 3 score · 4 manage · 5 benchmark | what can it run, and how fast really? |
 * | Deployment | 6 commit                          | what does the orchestrator run? |
 * | Cloud      | —                                 | the offline benchmark reference tier |
 *
 * Grouped this way rather than one tab per step because steps 2–5 are one
 * table: the estimate, the verdict and the measurement are columns on the same
 * row, and separating them would hide the comparison the module exists to make.
 *
 * `MODULES.md` §2.4: the Forge *absorbs* the Added Models panel rather than
 * duplicating it — the Cloud tab renders the same `ModelEndpointsPanel` that
 * Settings does. Cloud endpoints belong here because they are part of the model
 * story, and they sit in their own tab, behind their own warning, because under
 * Rule 1 they are an evaluation baseline and never a deployment target. Putting
 * them in the ranked table would invite exactly the misreading that separation
 * prevents.
 *
 * Rule 5 — this is a setup surface. It writes model configuration and pulls
 * models; the orchestrator must never reach it, and nothing here is exposed to
 * the model as a tool.
 */

const TABS = [
  { id: 'hardware', label: 'Hardware', icon: Cpu, hint: 'Step 1 — what this machine is' },
  { id: 'models', label: 'Models', icon: Layers, hint: 'Steps 2–5 — estimate, score, manage, benchmark' },
  { id: 'deployment', label: 'Deployment', icon: Rocket, hint: 'Step 6 — what actually runs' },
  { id: 'cloud', label: 'Cloud', icon: Cloud, hint: 'Offline benchmark reference only — never deployed' },
] as const

type TabId = (typeof TABS)[number]['id']

export function ForgeWindow({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<TabId>('hardware')
  // Bumped when the models table commits a choice, so the Deployment tab
  // re-resolves instead of showing what was true before the click.
  const [committed, setCommitted] = useState(0)

  return (
    <FloatingWindow
      open={open}
      onClose={onClose}
      title="The Forge"
      subtitle="hardware & model console"
      icon={<Hammer size={16} className="theme-primary" />}
      width={900}
      height={720}
    >
      {({ isPeek }) => (
        <div className="@container flex-1 flex flex-col min-h-0">
          <div className="flex items-center gap-1 px-6 pt-4 border-b theme-border shrink-0">
            {TABS.map((entry) => {
              const selected = tab === entry.id
              return (
                <button
                  key={entry.id}
                  onClick={() => setTab(entry.id)}
                  title={entry.hint}
                  className={`flex items-center gap-1.5 px-3 py-2 text-xs rounded-t-lg border-b-2 transition-colors ${
                    selected
                      ? 'border-current theme-primary'
                      : 'border-transparent theme-text-muted hover:theme-text'
                  }`}
                >
                  <entry.icon size={13} />
                  {entry.label}
                </button>
              )
            })}
          </div>

          <div className="flex-1 overflow-y-auto no-scrollbar p-6">
            <div className="mx-auto w-full @3xl:max-w-3xl">
              {tab === 'hardware' && <HardwareView isPeek={isPeek} />}
              {tab === 'models' && <ModelsView onCommitted={() => setCommitted((n) => n + 1)} />}
              {tab === 'deployment' && <DeploymentPanel reloadKey={committed} />}
              {tab === 'cloud' && (
                <div className="space-y-4">
                  {/* Stated before the panel, not after it: somebody arriving
                      here should know these can never be deployed before they
                      start adding keys, not once they have. */}
                  <div className="flex items-start gap-2 p-3 rounded-xl border border-amber-400/30 bg-amber-400/10 text-xs">
                    <Cloud size={14} className="text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-medium">Benchmark reference only — never deployed</div>
                      <div className="theme-text-muted mt-0.5">
                        PROJECT.md Rule 1: production is fully local. These endpoints exist so the
                        dual-track comparison has an accuracy ceiling to measure against, and they
                        are used post hoc over exported logs. They are deliberately absent from the
                        ranked model table.
                      </div>
                    </div>
                  </div>
                  <ModelEndpointsPanel isPeek={isPeek} />
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </FloatingWindow>
  )
}
