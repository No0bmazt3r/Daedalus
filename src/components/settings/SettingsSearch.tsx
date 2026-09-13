import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, CornerDownLeft } from 'lucide-react'
import { getGroupLabel, searchSettingsPanels, type SettingsPanel } from '../../lib/settingsRegistry'

interface SettingsSearchProps {
  isAdmin: boolean
  onOpenPanel: (id: string) => void
  collapsed: boolean
}

/**
 * Find-a-setting box. Searches the registry (labels, group names and keywords)
 * so a panel is discoverable by what it does, not only by what it's called —
 * typing "vram" finds Hardware, "sqlite" finds Databases.
 */
export function SettingsSearch({ isAdmin, onOpenPanel, collapsed }: SettingsSearchProps) {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const results = useMemo(
    () => searchSettingsPanels(query, isAdmin),
    [query, isAdmin]
  )

  // Keep the highlighted row in view during arrow-key navigation.
  useEffect(() => {
    const active = listRef.current?.querySelector('[data-active="true"]')
    active?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  const choose = (panel: SettingsPanel) => {
    onOpenPanel(panel.id)
    setQuery('')
    inputRef.current?.blur()
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setQuery('')
      inputRef.current?.blur()
      return
    }
    if (!results.length) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) => (i + 1) % results.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => (i - 1 + results.length) % results.length)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      choose(results[activeIndex])
    }
  }

  if (collapsed) {
    return (
      <div className="px-2 pb-2">
        <button
          onClick={() => onOpenPanel('__expand__')}
          title="Find settings"
          aria-label="Find settings"
          className="w-full flex items-center justify-center p-2 rounded-lg theme-text-muted hover:theme-text hover:bg-black/10 transition-colors"
        >
          <Search size={15} />
        </button>
      </div>
    )
  }

  const open = query.trim().length > 0

  return (
    <div className="relative px-3 pb-3">
      <div className="relative">
        <Search
          size={13}
          className="absolute left-2.5 top-1/2 -translate-y-1/2 theme-text-muted pointer-events-none"
        />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            // A new result set always starts from the top.
            setActiveIndex(0)
          }}
          onKeyDown={onKeyDown}
          placeholder="Find settings…"
          autoComplete="off"
          aria-label="Find settings"
          aria-expanded={open}
          aria-controls="settings-search-results"
          role="combobox"
          className="w-full pl-8 pr-2 py-1.5 text-xs rounded-lg bg-black/20 border theme-border theme-text placeholder:opacity-40 focus:outline-none focus:ring-1 focus:ring-[var(--primary)] transition-shadow [&::-webkit-search-cancel-button]:appearance-none"
        />
      </div>

      {open && (
        <div
          id="settings-search-results"
          ref={listRef}
          role="listbox"
          aria-label="Settings search results"
          className="absolute left-3 right-3 top-full z-20 mt-1 max-h-64 overflow-y-auto no-scrollbar rounded-lg border theme-border theme-card shadow-xl"
        >
          {results.length === 0 ? (
            <div className="px-3 py-3 text-xs theme-text-muted">
              No settings match “{query.trim()}”.
            </div>
          ) : (
            results.map((panel, i) => (
              <button
                key={panel.id}
                role="option"
                aria-selected={i === activeIndex}
                data-active={i === activeIndex}
                onMouseEnter={() => setActiveIndex(i)}
                onClick={() => choose(panel)}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                  i === activeIndex ? 'bg-[color-mix(in_srgb,var(--primary)_16%,transparent)]' : ''
                }`}
              >
                <panel.icon size={14} className="shrink-0 theme-text-muted" />
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-medium truncate">{panel.label}</span>
                  <span className="block text-[10px] theme-text-muted truncate">
                    {getGroupLabel(panel.group)}
                    {!panel.implemented && ' · not built yet'}
                  </span>
                </span>
                {i === activeIndex && (
                  <CornerDownLeft size={11} className="shrink-0 theme-text-muted opacity-60" />
                )}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
