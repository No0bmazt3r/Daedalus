import { useRef, useState } from 'react'
import { Check, ChevronDown, Search } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './dropdown-menu'

interface SelectOption<T extends string> {
  value: T
  label: string
}

interface ThemeSelectProps<T extends string> {
  value: T
  onChange: (value: T) => void
  options: readonly SelectOption<T>[]
  label?: string
  ariaLabel?: string
  /** Extra classes for the wrapper, e.g. flex sizing. */
  className?: string
  /** `sm` matches the compact rows in the theme editor. */
  size?: 'sm' | 'md'
  /** Adds a filter box above the list, for long lists like timezones. */
  searchable?: boolean
  searchPlaceholder?: string
}

/**
 * A themed replacement for `<select>`.
 *
 * A native select's option list is drawn by the operating system, so it
 * ignores the app's palette entirely — on a dark theme it still renders as a
 * grey menu with a blue highlight. This is a real popup in the DOM, so it
 * inherits the active theme like everything else.
 */
export function ThemeSelect<T extends string>({
  value,
  onChange,
  options,
  label,
  ariaLabel,
  className = '',
  size = 'md',
  searchable = false,
  searchPlaceholder = 'Search…',
}: ThemeSelectProps<T>) {
  const selected = options.find((o) => o.value === value)
  const compact = size === 'sm'
  const [query, setQuery] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const q = query.trim().toLowerCase()
  const shown = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options

  return (
    <div className={`flex flex-col gap-1 min-w-0 ${className}`}>
      {label && <span className="text-[11px] theme-text-muted">{label}</span>}
      <DropdownMenu
        onOpenChange={(open) => {
          if (!searchable) return
          setQuery('')
          // After the menu has taken focus, hand it to the search box.
          if (open) window.setTimeout(() => searchRef.current?.focus(), 0)
        }}
      >
        <DropdownMenuTrigger
          aria-label={ariaLabel || label}
          className={`flex w-full items-center justify-between gap-2 rounded-lg border theme-border theme-text theme-surface-strong transition-colors hover:bg-[color-mix(in_srgb,var(--text-main)_12%,transparent)] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--primary)] data-[popup-open]:ring-1 data-[popup-open]:ring-[var(--primary)] ${
            compact ? 'px-2 py-1.5 text-xs' : 'px-3 py-2.5 text-sm'
          }`}
        >
          <span className="truncate">{selected?.label ?? value}</span>
          <ChevronDown size={compact ? 12 : 15} className="shrink-0 opacity-50" />
        </DropdownMenuTrigger>

        <DropdownMenuContent
          align="start"
          sideOffset={4}
          className="theme-card theme-border theme-text border min-w-[var(--anchor-width)] max-h-64 overflow-y-auto no-scrollbar"
        >
          {searchable && (
            <div className="sticky top-0 z-10 -mx-1 -mt-1 mb-1 border-b theme-border theme-card px-2 py-1.5">
              <label className="flex items-center gap-1.5">
                <Search size={12} className="shrink-0 theme-text-muted" />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  // The menu reads keys for type-ahead; keep typing in the box.
                  // Arrow keys and Escape still reach the menu.
                  onKeyDown={(e) => {
                    if (!['ArrowDown', 'ArrowUp', 'Escape', 'Tab'].includes(e.key)) e.stopPropagation()
                  }}
                  placeholder={searchPlaceholder}
                  spellCheck={false}
                  className="w-full bg-transparent text-xs theme-text outline-none placeholder:opacity-50"
                />
              </label>
            </div>
          )}
          {searchable && shown.length === 0 && (
            <p className="px-2 py-1.5 text-xs theme-text-muted">No matches</p>
          )}
          {shown.map((option) => {
            const active = option.value === value
            return (
              <DropdownMenuItem
                key={option.value}
                onClick={() => onChange(option.value)}
                className={`cursor-pointer gap-2 ${
                  compact ? 'text-xs' : 'text-sm'
                } ${
                  active
                    ? 'theme-accent bg-[color-mix(in_srgb,var(--primary)_16%,transparent)]'
                    : 'theme-text-muted'
                }`}
              >
                <Check
                  size={12}
                  className={`shrink-0 ${active ? 'opacity-100' : 'opacity-0'}`}
                />
                <span className="truncate">{option.label}</span>
              </DropdownMenuItem>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
