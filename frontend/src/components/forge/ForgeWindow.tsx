import { useState } from 'react'
import { Hammer, Cpu, Layers, Boxes } from 'lucide-react'
import { FloatingWindow } from '../ui/floating-window'
import { HardwareView } from './HardwareView'
import { ModelsView } from './ModelsView'
import { AddedModelsView } from './AddedModelsView'

/**
 * The Forge — hardware and model console (Layer 11, PROJECT.md §8.2).
 *
 * All six steps, in the order you work through them:
 *
 * | tab | steps | what it answers |
 * |---|---|---|
 * | Hardware     | 1 detect                    | what is this machine? |
 * | Models       | 2 estimate · 3 score · 4 pull · 5 benchmark | what *could* run here, ranked |
 * | Added Models | 4 manage                    | what is here now, grouped and managed |
 *
 * The split between the last two is by question rather than by kind. Models is
 * a discovery surface: forty-odd candidates with filters, estimates and a
 * ranking, which is the right shape for "what should I pull?" and the wrong one
 * for "I have three models, one is stale, remove it". Added Models is the
 * inventory, grouped by §8.1's own tiers so the console and the report describe
 * the deployment the same way.
 *
 * Grouped this way rather than one tab per step because steps 2-5 are one
 * table: the estimate, the verdict and the measurement are columns on the same
 * row, and separating them would hide the comparison the module exists to make.
 *
 * ## Step 6 has no tab, on purpose
 *
 * It used to. `PROJECT.md` §8.1 still holds — the model is selected via
 * `config/model_config.json` and never hardcoded — but nothing needs a panel to
 * do it. The file defaults to `auto`, which resolves to the best-scoring
 * installed model for whatever machine reads it, and the composer's own picker
 * handles per-conversation choice. A tab that only ever set a value the
 * composer already sets was two controls for one decision.
 *
 * The config is still read on every `POST /api/chat`, is still what answers
 * when no browser is choosing (a scripted run, the M8 evaluation harness), and
 * is still hand-editable to pin a model for a reproducible experiment.
 *
 * `MODULES.md` §2.4: the Forge absorbs the Added Models panel rather than
 * duplicating it, so the cloud section renders the same `ModelEndpointsPanel`
 * that Settings does. It sits below the local tiers and behind its own warning,
 * because under Rule 1 a cloud endpoint is an evaluation baseline and never a
 * deployment target. One flat list of "models" would blur exactly the
 * distinction that separation exists to make.
 *
 * Rule 5 — this is a setup surface. It writes model configuration and pulls
 * models; the orchestrator must never reach it, and nothing here is exposed to
 * the model as a tool.
 */

const TABS = [
  { id: 'hardware', label: 'Hardware', icon: Cpu, hint: 'Step 1: what this machine is' },
  { id: 'models', label: 'Models', icon: Layers, hint: 'Steps 2 to 5: what could run here, estimated, scored and ranked' },
  { id: 'added', label: 'Added Models', icon: Boxes, hint: 'What this machine has: local SLM and LLM tiers, plus the cloud reference endpoints' },
] as const

type TabId = (typeof TABS)[number]['id']

export function ForgeWindow({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [tab, setTab] = useState<TabId>('hardware')

  return (
    <FloatingWindow
      id="forge"
      open={open}
      onClose={onClose}
      title="The Forge"
      subtitle="hardware & model console"
      icon={<Hammer size={16} className="theme-accent" />}
      width={900}
      height={720}
    >
      {({ isPeek }) => (
        <div className="@container flex-1 flex flex-col min-h-0">
          {/* One indicator that slides, rather than a border that blinks from
              one button to the next. The tabs are equal-width so its position
              is just an index, which keeps this to a transform and avoids
              measuring anything on every render. */}
          <div className="px-6 pt-4 border-b theme-border shrink-0">
            <div className="relative flex items-center">
              {TABS.map((entry) => {
                const selected = tab === entry.id
                return (
                  <button
                    key={entry.id}
                    onClick={() => setTab(entry.id)}
                    title={entry.hint}
                    style={{ flexBasis: `${100 / TABS.length}%` }}
                    className={`flex items-center justify-center gap-1.5 px-3 py-2 text-xs rounded-t-lg transition-colors duration-200 ${
                      selected ? 'theme-accent' : 'theme-text-muted hover:theme-text'
                    }`}
                  >
                    {/* Keyed on `selected` so React remounts the icon when the
                        tab is chosen and the one-shot animation replays. A
                        class swap alone would not restart it. */}
                    <entry.icon
                      key={selected ? 'on' : 'off'}
                      size={13}
                      className={`tab-icon ${selected ? 'tab-icon-active' : ''}`}
                    />
                    {entry.label}
                  </button>
                )
              })}
              <span
                aria-hidden
                className="absolute bottom-0 h-0.5 rounded-full theme-bg-primary transition-transform duration-300 ease-out"
                style={{
                  width: `${100 / TABS.length}%`,
                  transform: `translateX(${TABS.findIndex((t) => t.id === tab) * 100}%)`,
                }}
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto no-scrollbar p-6">
            {/* Keyed on the tab so React remounts and the entry animation runs
                again. Without the key the pane swaps its contents in place and
                the transition never fires. */}
            <div
              key={tab}
              className="mx-auto w-full @3xl:max-w-3xl animate-in fade-in slide-in-from-bottom-2 duration-300 ease-out"
            >
              {tab === 'hardware' && <HardwareView isPeek={isPeek} />}
              {tab === 'models' && <ModelsView />}
              {tab === 'added' && <AddedModelsView isPeek={isPeek} />}
            </div>
          </div>
        </div>
      )}
    </FloatingWindow>
  )
}
