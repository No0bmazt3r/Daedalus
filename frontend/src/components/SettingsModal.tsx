import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Settings2 } from 'lucide-react'
import { FloatingWindow } from './ui/floating-window'
import {
  useResizableSidebar,
  SIDEBAR_MIN_WIDTH,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_DESKTOP_MIN_CONTAINER,
} from '../hooks/useResizableSidebar'
import { useElementWidth } from '../hooks/useElementWidth'
import {
  DEFAULT_SETTINGS_PANEL_ID,
  getSettingsPanel,
  panelsForGroup,
  trackVisible,
  visibleGroups,
  type SettingsPanel,
} from '../lib/settingsRegistry'
import { fetchRagConfig, RAG_TRACK_CHANGED_EVENT, type RagTrack } from '../lib/blueprintsClient'
import { subscribe } from '../lib/liveEvents'
import { SettingsSearch } from './settings/SettingsSearch'
import { GraphRagPanel, KnowledgeBasePanel, VectorRagPanel } from './settings/KnowledgeBasePanel'
import { SearchPanel } from './settings/SearchPanel'
import { AgentToolsPanel } from './settings/AgentToolsPanel'
import { IntegrationsPanel } from './settings/IntegrationsPanel'
import { BackupPanel, DangerPanel, LogsPanel } from './settings/SystemPanel'
import { DatabasesPanel } from './settings/DatabasesPanel'
import { BackgroundJobsPanel } from './settings/BackgroundJobsPanel'
import { AssistantPanel } from './settings/AssistantPanel'
import { AppearancePanel } from './settings/AppearancePanel'
import { ShortcutsPanel } from './settings/ShortcutsPanel'
import type { ForgeTab } from './forge/ForgeWindow'

interface SettingsModalProps {
  open: boolean
  onClose: () => void
  /** Appearance hands colours and fonts to the Theme window rather than copying them. */
  onOpenTheme?: () => void
  /** Opens The Forge on a tab — where Vector RAG sends you to pull a model. */
  onOpenForge?: (tab: ForgeTab) => void
  /**
   * A panel to jump to, from the command palette. Not the *current* panel —
   * the window owns that, and lifting it would mean every click on the rail
   * round-tripped through the root to come back as a prop.
   */
  panel?: string | null
}

export function SettingsModal({ open, onClose, onOpenTheme, onOpenForge, panel = null }: SettingsModalProps) {
  // A panel requested at mount opens directly; later requests are applied
  // during render below, on change.
  const [activeTab, setActiveTab] = useState(
    panel && getSettingsPanel(panel) ? panel : DEFAULT_SETTINGS_PANEL_ID,
  )

  // The selected retrieval track decides which track's settings panel is
  // listed. Re-read whenever the track changes, from here or from anywhere
  // else (`setRagTrack` broadcasts it).
  const [track, setTrack] = useState<RagTrack | null>(null)
  useEffect(() => {
    let cancelled = false
    fetchRagConfig().then((c) => { if (!cancelled) setTrack(c.track) }).catch(() => undefined)
    const onChanged = (e: Event) => {
      const next = (e as CustomEvent<{ track?: RagTrack }>).detail?.track
      if (next) setTrack(next)
    }
    window.addEventListener(RAG_TRACK_CHANGED_EVENT, onChanged)
    // Another tab or window changing the track arrives as a live event instead.
    const unsubscribe = subscribe(['rag'], () => {
      fetchRagConfig().then((c) => { if (!cancelled) setTrack(c.track) }).catch(() => undefined)
    })
    return () => {
      unsubscribe()
      cancelled = true
      window.removeEventListener(RAG_TRACK_CHANGED_EVENT, onChanged)
    }
  }, [])

  // Sitting on the other track's panel when the track changes (or asking for
  // it from the palette) lands on the track switch instead of a hidden page.
  const shown = getSettingsPanel(activeTab)
  // `getSettingsPanel` follows redirects, so a removed panel's id (saved, or
  // from an old link) renders the panel it moved to.
  const resolved = shown?.id ?? DEFAULT_SETTINGS_PANEL_ID
  const effectiveTab = shown && track && !trackVisible(shown, track) ? 'knowledge' : resolved

  // Asking for the panel already open is a no-op, which is what makes it safe
  // for the caller to leave the request set rather than having to clear it.
  const [seenPanel, setSeenPanel] = useState(panel)
  if (panel !== seenPanel) {
    setSeenPanel(panel)
    if (panel && getSettingsPanel(panel)) setActiveTab(panel)
  }

  // The window is draggable and resizable, so its content can be narrow on a
  // wide screen — a viewport media query would be measuring the wrong thing.
  // Below the breakpoint the vertical rail becomes a horizontal strip, and
  // dragging and collapsing stop being offered because they no longer mean
  // anything. This is Odysseus' `isDesktopSidebarMode`, same 620px threshold.
  const bodyRef = useRef<HTMLDivElement>(null)
  const bodyWidth = useElementWidth(bodyRef)
  // `0` means "not measured yet"; assume desktop so the compact layout never
  // flashes on the first frame.
  const isCompact = bodyWidth > 0 && bodyWidth < SIDEBAR_DESKTOP_MIN_CONTAINER
  const sidebar = useResizableSidebar({ enabled: !isCompact })

  // Admin panels are hidden until there's an auth layer to decide this.
  const isAdmin = true


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

  if (!open) return null

  const groups = visibleGroups(isAdmin, track)
  const activePanel = getSettingsPanel(effectiveTab)
  return (
    <FloatingWindow
      id="settings"
      open={open}
      onClose={onClose}
      title="Settings"
      subtitle={activePanel?.label}
      icon={<Settings2 size={16} className="theme-accent" />}
      width={900}
      height={650}
    >
      {({ isPeek }) => (
        <div ref={bodyRef} className={`flex flex-1 overflow-hidden min-h-0 ${isCompact ? 'flex-col' : ''}`}>
          {/* Navigation rail. Vertical and resizable when there is room;
              a horizontal scrolling strip when there is not. */}
          <div
            className={`relative theme-border flex shrink-0 ${
              isCompact ? 'flex-row items-center border-b overflow-x-auto no-scrollbar' : 'flex-col border-r'
            } ${isPeek ? '' : 'theme-surface'}`}
            style={{
              width: isCompact ? '100%' : sidebar.width,
              // Animate only when not dragging, or the rail lags the pointer.
              transition: sidebar.isResizing ? 'none' : 'width 200ms ease',
              backgroundColor: isPeek ? 'transparent' : undefined,
            }}
          >
            {!isCompact && (
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
                className="p-1.5 rounded-md hover:bg-[color-mix(in_srgb,var(--text-main)_6%,transparent)] theme-text-muted hover:theme-text transition-colors"
              >
                {sidebar.collapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
              </button>
            </div>
            )}

            {!isCompact && (
              <SettingsSearch
                track={track}
                isAdmin={isAdmin}
                onOpenPanel={openPanel}
                collapsed={sidebar.collapsed}
              />
            )}

            <div
              className={
                isCompact
                  ? 'flex flex-row items-center gap-1 px-2 py-1.5'
                  : 'flex-1 overflow-y-auto no-scrollbar pb-2'
              }
            >
              {groups.map((group) => (
                <div key={group.id} className={isCompact ? 'flex flex-row items-center gap-1' : ''}>
                  {!sidebar.collapsed && !isCompact && (
                    <div className="px-4 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wider theme-text-muted">
                      {group.label}
                    </div>
                  )}
                  {sidebar.collapsed && !isCompact && <div className="mx-3 my-2 border-t theme-border" />}
                  {/* Groups keep their identity in the strip as a divider —
                      a flat run of 15 buttons is unreadable. */}
                  {isCompact && <div className="h-5 w-px shrink-0 theme-border border-l mx-1 first:hidden" />}
                  {panelsForGroup(group.id, isAdmin, track).map((panel) => (
                    <NavButton
                      key={panel.id}
                      panel={panel}
                      active={effectiveTab === panel.id}
                      collapsed={sidebar.collapsed && !isCompact}
                      horizontal={isCompact}
                      onSelect={() => setActiveTab(panel.id)}
                    />
                  ))}
                </div>
              ))}
            </div>

            {/* Drag-to-resize separator. Keyboard accessible: Enter/Space
                toggles collapse, arrows resize in 16px steps. Absent in the
                horizontal layout, where there is no width to drag. */}
            {!isCompact && (
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize settings navigation"
                aria-valuemin={SIDEBAR_MIN_WIDTH}
                aria-valuemax={SIDEBAR_MAX_WIDTH}
                aria-valuenow={Math.round(sidebar.width ?? SIDEBAR_MIN_WIDTH)}
                tabIndex={0}
                onPointerDown={sidebar.onResizeStart}
                onKeyDown={sidebar.onResizeKeyDown}
                className={`absolute top-0 right-0 h-full w-1.5 cursor-col-resize z-10 transition-colors focus:outline-none focus-visible:bg-[var(--primary)] hover:bg-[color-mix(in_srgb,var(--primary)_50%,transparent)] ${
                  sidebar.isResizing ? 'bg-[var(--primary)]' : 'bg-transparent'
                }`}
              />
            )}
          </div>

          {/* Panel area. Keyed on the active panel so switching replays the
              entry animation rather than swapping contents in place. */}
          <div
            key={effectiveTab}
            className={`@container flex-1 overflow-y-auto no-scrollbar bg-transparent min-w-0 animate-in fade-in slide-in-from-bottom-2 duration-300 ease-out ${isCompact ? 'p-5' : 'p-8'}`}
          >
            {/* One measure for every panel. It grows with the window up to a
                readable limit, then centres — stretching a settings form to
                full width would just make a 1300px-wide select, which is
                harder to scan, not easier. Panels that genuinely benefit from
                width (Databases) add columns via their own container queries. */}
            {/* Same ladder as the Forge: the column keeps growing with the
                window rather than stopping, and the last step cannot exceed
                the pane it is centred in. */}
            <div className="mx-auto w-full @2xl:max-w-2xl @4xl:max-w-3xl @6xl:max-w-4xl @7xl:max-w-[min(100%,1400px)]">

            {/* Models (add, installed, hardware) are the Forge's, and store
                health is part of System — see `settingsRegistry.ts`. */}
            {effectiveTab === 'assistant' && <AssistantPanel isPeek={isPeek} />}
            {effectiveTab === 'background' && <BackgroundJobsPanel isPeek={isPeek} />}
            {effectiveTab === 'knowledge' && <KnowledgeBasePanel />}
            {effectiveTab === 'vector-rag' && <VectorRagPanel onOpenForge={onOpenForge} />}
            {effectiveTab === 'graph-rag' && <GraphRagPanel />}
            {effectiveTab === 'search' && <SearchPanel isPeek={isPeek} />}
            {effectiveTab === 'tools' && <AgentToolsPanel isPeek={isPeek} />}
            {effectiveTab === 'integrations' && <IntegrationsPanel isPeek={isPeek} />}
            {effectiveTab === 'storage' && <DatabasesPanel isPeek={isPeek} />}
            {effectiveTab === 'logs' && <LogsPanel />}
            {effectiveTab === 'backup' && <BackupPanel />}
            {effectiveTab === 'danger' && <DangerPanel />}

            {effectiveTab === 'appearance' && (
              <AppearancePanel isPeek={isPeek} onOpenTheme={onOpenTheme} />
            )}

            {effectiveTab === 'shortcuts' && <ShortcutsPanel isPeek={isPeek} />}

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
      )}
    </FloatingWindow>
  )
}

function NavButton({
  panel,
  active,
  collapsed,
  horizontal = false,
  onSelect,
}: {
  panel: SettingsPanel
  active: boolean
  collapsed: boolean
  /** Compact layout: a chip in a scrolling strip rather than a list row. */
  horizontal?: boolean
  onSelect: () => void
}) {
  const Icon = panel.icon

  if (horizontal) {
    return (
      <button
        onClick={onSelect}
        aria-current={active ? 'page' : undefined}
        title={panel.label}
        className={`shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs transition-colors ${
          active
            ? 'theme-surface-strong theme-text font-medium'
            : 'theme-text-muted hover:bg-[color-mix(in_srgb,var(--text-main)_6%,transparent)] hover:theme-text'
        }`}
      >
        {/* Keyed on `active` so the one-shot select animation replays when
            the panel is chosen. See .tab-icon in index.css. */}
        <Icon
          key={active ? 'on' : 'off'}
          size={14}
          className={`shrink-0 tab-icon ${active ? 'tab-icon-active' : ''}`}
        />
        <span className="whitespace-nowrap">{panel.label}</span>
        {!panel.implemented && (
          <span className="w-1 h-1 rounded-full bg-current opacity-30" title="Not built yet" />
        )}
      </button>
    )
  }

  return (
    <button
      onClick={onSelect}
      aria-current={active ? 'page' : undefined}
      title={collapsed ? panel.label : undefined}
      className={`w-full flex items-center px-4 py-2 text-sm transition-colors border-r-2 ${
        active
          ? 'theme-surface-strong theme-text font-medium border-[var(--primary)]'
          : 'theme-text-muted hover:bg-[color-mix(in_srgb,var(--text-main)_6%,transparent)] hover:theme-text border-transparent'
      } ${collapsed ? 'justify-center px-0' : 'gap-3'}`}
    >
      <Icon
        key={active ? 'on' : 'off'}
        size={15}
        className={`shrink-0 tab-icon ${active ? 'tab-icon-active' : ''}`}
      />
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
