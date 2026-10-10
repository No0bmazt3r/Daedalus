import { useState } from 'react'
import { Hammer, Cpu, MessageSquare, Binary, Boxes, ListOrdered } from 'lucide-react'
import { FloatingWindow } from '../ui/floating-window'
import { HardwareView } from './HardwareView'
import { ModelsView } from './ModelsView'
import { EmbeddingModelsPane } from './EmbeddingModelsPane'
import { InstalledModelsView, type PaneId } from './InstalledModelsView'
import { RerankersPane } from './RerankersPane'
import { MarqueeText } from '../ui/marquee-text'
import { tabArrowKeys } from '../ui/tablist'

/**
 * The Forge — hardware and model console (Layer 11, PROJECT.md §8.2).
 *
 * | tab | what it answers |
 * |---|---|
 * | Hardware         | step 1: what is this machine? |
 * | Chat models      | steps 2–4 for answering models: browse, estimate, score, pull |
 * | Embedding models | browse and pull the models that turn chunks into vectors |
 * | Re-rankers       | browse Track 1's cross-encoders: fit verdicts against this machine, download |
 * | Installed        | what is on it, by kind — chat (local + cloud baselines), embedding, re-rankers: benchmark, verify, delete |
 *
 * Installed is for managing; the two model tabs are for browsing. Every control
 * has one home: a browse card for a model you already have shows Manage, which
 * switches here, rather than repeating Benchmark and Delete.
 *
 * The browse tabs are split by kind because the kinds are judged differently: a
 * chat model gets a fit verdict and a rank, an embedder has neither, because
 * both measure something that generates text.
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
 * `MODULES.md` §2.4: Installed's cloud pane renders the same `ModelEndpointsPanel`
 * that Settings does rather than a second copy of it. It is a pane apart from
 * local models because under Rule 1 a cloud endpoint is an evaluation baseline
 * and never a deployment target. One flat list of "models" would blur exactly the
 * distinction that separation exists to make.
 *
 * Rule 5 — this is a setup surface. It writes model configuration and pulls
 * models; the orchestrator must never reach it, and nothing here is exposed to
 * the model as a tool.
 */

const TABS = [
  { id: 'hardware', label: 'Hardware', icon: Cpu, hint: 'Step 1: what this machine is' },
  { id: 'chat', label: 'Chat models', icon: MessageSquare, hint: 'Browse the models that answer: estimated, scored and ranked against this machine' },
  { id: 'embedding', label: 'Embedding models', icon: Binary, hint: 'Browse the models that turn document chunks into vectors for Track 1' },
  { id: 'rerankers', label: 'Re-rankers', icon: ListOrdered, hint: "Download Track 1's cross-encoders, which re-score the nearest chunks" },
  { id: 'installed', label: 'Installed', icon: Boxes, hint: 'What this machine has: benchmark, delete, verify embedders, cloud baselines' },
] as const

export type ForgeTab = (typeof TABS)[number]['id']
type TabId = ForgeTab

export function ForgeWindow({
  open, onClose, requestedTab = null, onOpenSettings,
}: {
  open: boolean
  onClose: () => void
  /** Opens a Settings panel — where an embedding model is chosen for the index. */
  onOpenSettings?: (panel: string) => void
  /** A tab to land on — Settings → Vector RAG asks for Re-rankers. Sticky, like Blueprints'. */
  requestedTab?: ForgeTab | null
}) {
  const [tab, setTab] = useState<TabId>(requestedTab ?? 'hardware')
  const [installedPane, setInstalledPane] = useState<PaneId>('chat')
  const manage = (pane: PaneId) => () => { setInstalledPane(pane); setTab('installed') }
  // A new request (or the same one after the window was closed) moves the tab.
  // Adjusted during render rather than in an effect, so the window never paints
  // one frame on the old tab first.
  const request = open && requestedTab ? requestedTab : null
  const [seen, setSeen] = useState<ForgeTab | null>(request)
  if (request !== seen) {
    setSeen(request)
    if (request) setTab(request)
  }

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
            <div
              role="tablist"
              aria-label="Forge views"
              className="relative flex items-center"
              onKeyDown={tabArrowKeys(TABS.map((t) => t.id), tab, setTab)}
            >
              {TABS.map((entry) => {
                const selected = tab === entry.id
                return (
                  <button
                    key={entry.id}
                    onClick={() => setTab(entry.id)}
                    role="tab"
                    data-tab={entry.id}
                    aria-selected={selected}
                    tabIndex={selected ? 0 : -1}
                    title={entry.hint}
                    style={{ flexBasis: `${100 / TABS.length}%` }}
                    className={`flex min-w-0 items-center justify-center gap-1.5 px-3 py-2 text-xs rounded-t-lg transition-colors duration-200 ${
                      selected ? 'theme-accent' : 'theme-text-muted hover:theme-text'
                    }`}
                  >
                    {/* Keyed on `selected` so React remounts the icon when the
                        tab is chosen and the one-shot animation replays. A
                        class swap alone would not restart it. */}
                    <entry.icon
                      key={selected ? 'on' : 'off'}
                      size={13}
                      className={`tab-icon shrink-0 ${selected ? 'tab-icon-active' : ''}`}
                    />
                    {/* One line always. A label too long for its share of the
                        bar scrolls rather than wrapping to two lines and
                        making that one tab taller than the rest. */}
                    <MarqueeText text={entry.label} />
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
            {/* The measure grows in steps rather than stopping at one width.
                A clamp is right — 1900px of prose is unreadable — but a single
                `max-w-3xl` meant a maximized window drew a 768px column down
                the middle of a 1900px pane and called it a layout. The last
                step is `min(100%, …)` so the cap can never exceed the pane it
                is centred in. The panes themselves reflow into columns; see
                `HardwareView`. */}
            <div
              key={tab}
              className="mx-auto w-full @3xl:max-w-3xl @5xl:max-w-5xl @7xl:max-w-[min(100%,1500px)] animate-in fade-in slide-in-from-bottom-2 duration-300 ease-out"
            >
              {tab === 'hardware' && <HardwareView isPeek={isPeek} />}
              {tab === 'installed' && (
                <InstalledModelsView
                  isPeek={isPeek}
                  initialPane={installedPane}
                  onBrowseChat={() => setTab('chat')}
                  onBrowseEmbeddings={() => setTab('embedding')}
                  onBrowseRerankers={() => setTab('rerankers')}
                  onChooseEmbedding={onOpenSettings ? () => onOpenSettings('vector-rag') : undefined}
                />
              )}
              {tab === 'chat' && <ModelsView onManage={manage('chat')} />}
              {tab === 'rerankers' && <RerankersPane mode="browse" onManage={manage('rerankers')} />}
              {tab === 'embedding' && (
                <EmbeddingModelsPane mode="browse" onManage={manage('embedding')} />
              )}
            </div>
          </div>
        </div>
      )}
    </FloatingWindow>
  )
}
