import { useCallback, useEffect, useMemo, useState } from 'react'
import { X, Ghost, CircleDashed, ChevronLeft, ChevronRight, Settings2 } from 'lucide-react'
import { useDraggable } from '../hooks/useDraggable'
import { useResizableSidebar, SIDEBAR_MIN_WIDTH, SIDEBAR_MAX_WIDTH } from '../hooks/useResizableSidebar'
import { useSettings } from '../contexts/SettingsContext'
import {
  DEFAULT_SETTINGS_PANEL_ID,
  getSettingsPanel,
  panelsForGroup,
  visibleGroups,
  type SettingsPanel,
} from '../lib/settingsRegistry'
import { ThemeSelect } from './ui/theme-select'
import { SettingsSearch } from './settings/SettingsSearch'
import { DatabasesPanel } from './settings/DatabasesPanel'

interface SettingsModalProps {
  open: boolean
  onClose: () => void
}

export function SettingsModal({ open, onClose }: SettingsModalProps) {
  const { isIncognito, setIsIncognito, selectedModel, setSelectedModel } = useSettings()
  const [activeTab, setActiveTab] = useState(DEFAULT_SETTINGS_PANEL_ID)
  const [isPeek, setIsPeek] = useState(false)
  // Where the window sits. Centring it with flexbox looked fine but broke
  // resizing: an absolutely-positioned flex child is re-centred as it grows,
  // so dragging the corner moved the window left/up at the same time and the
  // corner only tracked the cursor at half speed. An explicit top-left pins
  // it, so resizing grows right and down the way a window should.
  // Derived, not state: it only ever depends on `open`, so an effect would
  // just add a render pass and a frame where the window has no position.
  const { position, onMouseDown, handleRef, windowRef } = useDraggable()
  const sidebar = useResizableSidebar()

  // Admin panels are hidden until there's an auth layer to decide this.
  const isAdmin = true

  const models = ['Daedalus 2.0', 'Daedalus Pro', 'Daedalus Flash', 'Daedalus Vision']

  const openPanel = useCallback(
    (id: string) => {
      // The collapsed rail's search button asks to expand rather than navigate.
      if (id === '__expand__') {
        sidebar.toggleCollapsed()
        return
      }
      if (getSettingsPanel(id)) setActiveTab(id)
    },
    [sidebar]
  )

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // Recomputed each time the window opens, so it lands centred even if the
  // browser has been resized since. Dragging or resizing afterwards is not
  // affected: `position` takes over below, and native resize owns the size.
  const anchor = useMemo(() => {
    if (!open || typeof window === 'undefined') return { left: 0, top: 0 }
    const width = Math.min(900, window.innerWidth * 0.95)
    const height = Math.min(650, window.innerHeight * 0.9)
    return {
      left: Math.max(8, (window.innerWidth - width) / 2),
      top: Math.max(8, (window.innerHeight - height) / 2),
    }
  }, [open])

  if (!open) return null

  const groups = visibleGroups(isAdmin)
  const activePanel = getSettingsPanel(activeTab)
  const cardClass = `p-6 rounded-xl border theme-border transition-colors ${isPeek ? 'bg-transparent' : 'bg-black/10'}`

  return (
    <div className="fixed inset-0 z-[100] pointer-events-none">
      <div
        className="fixed inset-0 bg-black/40 pointer-events-auto transition-opacity duration-300"
        style={{ opacity: isPeek ? 0 : 1 }}
        onClick={onClose}
      />

      <div
        ref={windowRef}
        style={{
          // useDraggable reports absolute viewport coordinates, so these are
          // left/top — using them as a transform made the window jump on grab.
          left: position.x || anchor.left,
          top: position.y || anchor.top,
          // Set inline rather than via `.theme-bg`: that utility is
          // `!important`, which would beat an inline style and make Peek a no-op.
          backgroundColor: isPeek
            ? 'color-mix(in srgb, var(--bg, #000) 55%, transparent)'
            : 'var(--bg)',
          backdropFilter: isPeek ? 'none' : undefined,
          // Default size comes from CSS, not state: native `resize` writes to
          // the inline width/height, and a React-controlled value would fight it.
        }}
        className={`pointer-events-auto absolute resize overflow-hidden w-[900px] h-[650px] min-w-[560px] min-h-[400px] max-w-[95vw] max-h-[90vh] flex flex-col theme-text theme-border border rounded-xl shadow-2xl transition-colors duration-300 ${isPeek ? 'border-white/20 shadow-none' : ''}`}
      >
        {/* Header (drag handle) */}
        <div
          ref={handleRef}
          onMouseDown={onMouseDown}
          className="flex items-center justify-between px-4 py-3 border-b theme-border cursor-move bg-black/10 select-none shrink-0"
          style={{ backgroundColor: isPeek ? 'transparent' : undefined }}
        >
          <div className="flex items-center gap-2 font-medium">
            <Settings2 size={16} className="theme-primary" />
            <span>Settings</span>
            {activePanel && (
              <span className="theme-text-muted font-normal text-sm">
                · {activePanel.label}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => setIsPeek(!isPeek)}
              className={`flex items-center gap-1 px-2 py-1 rounded-md transition-colors text-xs font-medium border ${
                isPeek
                  ? 'bg-primary/20 text-[var(--primary)] border-[var(--primary)]/30'
                  : 'theme-text-muted hover:theme-text border-transparent hover:bg-black/20'
              }`}
              title="Fade this window to preview the page behind it"
            >
              <CircleDashed size={14} className={isPeek ? 'animate-[spin_4s_linear_infinite]' : ''} />
              Peek
            </button>
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={onClose}
              aria-label="Close settings"
              className="p-1 rounded-md hover:bg-black/20 theme-text-muted hover:theme-text transition-colors ml-1"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="flex flex-1 overflow-hidden min-h-0">
          {/* Navigation rail */}
          <div
            className={`relative border-r theme-border flex flex-col shrink-0 ${
              isPeek ? '' : 'bg-black/5'
            }`}
            style={{
              width: sidebar.width,
              // Animate only when not dragging, or the rail lags the pointer.
              transition: sidebar.isResizing ? 'none' : 'width 200ms ease',
              backgroundColor: isPeek ? 'transparent' : undefined,
            }}
          >
            <div
              className={`flex px-2 pt-2 pb-1 shrink-0 ${
                sidebar.collapsed ? 'justify-center' : 'justify-end'
              }`}
            >
              <button
                onClick={sidebar.toggleCollapsed}
                aria-expanded={!sidebar.collapsed}
                aria-label={sidebar.collapsed ? 'Expand settings navigation' : 'Collapse settings navigation'}
                title={sidebar.collapsed ? 'Expand settings navigation' : 'Collapse settings navigation'}
                className="p-1.5 rounded-md hover:bg-black/10 theme-text-muted hover:theme-text transition-colors"
              >
                {sidebar.collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
              </button>
            </div>

            <SettingsSearch
              isAdmin={isAdmin}
              onOpenPanel={openPanel}
              collapsed={sidebar.collapsed}
            />

            <div className="flex-1 overflow-y-auto no-scrollbar pb-2">
              {groups.map((group) => (
                <div key={group.id}>
                  {!sidebar.collapsed && (
                    <div className="px-4 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider theme-text-muted opacity-70">
                      {group.label}
                    </div>
                  )}
                  {sidebar.collapsed && <div className="mx-3 my-2 border-t theme-border" />}
                  {panelsForGroup(group.id, isAdmin).map((panel) => (
                    <NavButton
                      key={panel.id}
                      panel={panel}
                      active={activeTab === panel.id}
                      collapsed={sidebar.collapsed}
                      onSelect={() => setActiveTab(panel.id)}
                    />
                  ))}
                </div>
              ))}
            </div>

            {/* Drag-to-resize separator. Keyboard accessible: Enter/Space
                toggles collapse, arrows resize in 16px steps. */}
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize settings navigation"
              aria-valuemin={SIDEBAR_MIN_WIDTH}
              aria-valuemax={SIDEBAR_MAX_WIDTH}
              aria-valuenow={Math.round(sidebar.width)}
              tabIndex={0}
              onPointerDown={sidebar.onResizeStart}
              onKeyDown={sidebar.onResizeKeyDown}
              className={`absolute top-0 right-0 h-full w-1.5 cursor-col-resize z-10 transition-colors focus:outline-none focus-visible:bg-[var(--primary)] hover:bg-[color-mix(in_srgb,var(--primary)_50%,transparent)] ${
                sidebar.isResizing ? 'bg-[var(--primary)]' : 'bg-transparent'
              }`}
            />
          </div>

          {/* Panel area */}
          <div className="@container flex-1 overflow-y-auto no-scrollbar p-8 bg-transparent min-w-0">
            {/* One measure for every panel. It grows with the window up to a
                readable limit, then centres — stretching a settings form to
                full width would just make a 1300px-wide select, which is
                harder to scan, not easier. Panels that genuinely benefit from
                width (Databases) add columns via their own container queries. */}
            <div className="mx-auto w-full @2xl:max-w-2xl @4xl:max-w-3xl @6xl:max-w-4xl">
            {activeTab === 'ai' && (
              <div className="space-y-6 animate-in fade-in duration-200">
                <div>
                  <h3 className="text-xl font-medium mb-1">AI Defaults</h3>
                  <p className="text-sm theme-text-muted mb-6">
                    Manage your default models and AI settings.
                  </p>
                </div>
                <div className={cardClass}>
                  <div className="flex flex-col gap-3">
                    <span className="text-sm font-medium">Default Chat Model</span>
                    <ThemeSelect
                      value={selectedModel}
                      onChange={setSelectedModel}
                      ariaLabel="Default chat model"
                      options={models.map((m) => ({ value: m, label: m }))}
                    />
                    <p className="text-xs theme-text-muted mt-1">
                      This model will be selected by default for new conversations.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {activeTab === 'databases' && <DatabasesPanel isPeek={isPeek} />}

            {activeTab === 'appearance' && (
              <div className="space-y-6 animate-in fade-in duration-200">
                <div>
                  <h3 className="text-xl font-medium mb-1">Appearance</h3>
                  <p className="text-sm theme-text-muted mb-6">
                    Themes, colours, typography and background effects.
                  </p>
                </div>
                <div className={cardClass}>
                  <p className="text-sm theme-text-muted">
                    Appearance lives in its own window so you can see changes against
                    the live app. Open it from the sidebar menu → <strong>Theme &amp; Appearance</strong>.
                  </p>
                </div>
              </div>
            )}

            {activeTab === 'shortcuts' && (
              <div className="space-y-6 animate-in fade-in duration-200">
                <div>
                  <h3 className="text-xl font-medium mb-1">Shortcuts &amp; Toggles</h3>
                  <p className="text-sm theme-text-muted mb-6">
                    Configure keyboard shortcuts and quick toggles.
                  </p>
                </div>
                <div className="space-y-4">
                  <div
                    className={`flex items-center justify-between p-5 rounded-xl border theme-border transition-colors ${
                      isPeek ? 'bg-transparent' : 'bg-black/10'
                    }`}
                  >
                    <div className="flex items-center gap-4">
                      <div
                        className={`p-3 rounded-lg ${
                          isIncognito
                            ? 'incognito-bg-soft incognito-text incognito-glow'
                            : 'bg-black/20 theme-text-muted'
                        }`}
                      >
                        <Ghost size={22} />
                      </div>
                      <div>
                        <div className="font-medium text-base">Incognito Mode</div>
                        <div className="text-sm theme-text-muted mt-0.5">
                          Pause history recording for this session. Your prompts will not be saved.
                        </div>
                      </div>
                    </div>
                    <button
                      role="switch"
                      aria-checked={isIncognito}
                      aria-label="Incognito mode"
                      onClick={() => setIsIncognito(!isIncognito)}
                      className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors focus:outline-none ${
                        isIncognito ? 'incognito-bg' : 'bg-zinc-600'
                      }`}
                    >
                      <span
                        className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                          isIncognito ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>
                </div>
              </div>
            )}

            {activePanel && !activePanel.implemented && (
              <div className="flex flex-col items-center justify-center h-full text-center space-y-4 animate-in fade-in duration-200">
                <activePanel.icon size={44} className="theme-text-muted opacity-30" />
                <div>
                  <h3 className="text-lg font-medium theme-text-muted">{activePanel.label}</h3>
                  <p className="text-sm theme-text-muted/70 max-w-sm mx-auto mt-2">
                    Not built yet. Tracked in <code>TODO.md</code>.
                  </p>
                </div>
              </div>
            )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function NavButton({
  panel,
  active,
  collapsed,
  onSelect,
}: {
  panel: SettingsPanel
  active: boolean
  collapsed: boolean
  onSelect: () => void
}) {
  const Icon = panel.icon
  return (
    <button
      onClick={onSelect}
      aria-current={active ? 'page' : undefined}
      title={collapsed ? panel.label : undefined}
      className={`w-full flex items-center px-4 py-2 text-sm transition-colors border-r-2 ${
        active
          ? 'bg-black/20 theme-text font-medium border-[var(--primary)]'
          : 'theme-text-muted hover:bg-black/10 hover:theme-text border-transparent'
      } ${collapsed ? 'justify-center px-0' : 'gap-3'}`}
    >
      <Icon size={15} className="shrink-0" />
      {!collapsed && (
        <span className="truncate flex items-center gap-1.5">
          {panel.label}
          {!panel.implemented && (
            <span className="w-1 h-1 rounded-full bg-current opacity-30" title="Not built yet" />
          )}
        </span>
      )}
    </button>
  )
}
