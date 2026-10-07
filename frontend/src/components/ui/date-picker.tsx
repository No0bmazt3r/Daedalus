import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react'

/**
 * A date picker in the app's theme, in place of the browser's `<input
 * type="date">` — whose `mm/dd/yyyy` box and calendar ignore the theme and look
 * different in every browser.
 *
 * Three views, one level each: days of a month; the twelve months (click the
 * month's name); a block of twelve years (click the year). `value` is
 * `YYYY-MM-DD` or `''`, exactly what the native input gave, so swapping one for
 * the other changes no caller logic.
 *
 * The calendar is portalled to `<body>` and placed under its button, because it
 * usually opens inside something that scrolls or clips (a window's sidebar),
 * which would cut it off. It closes on a click outside, `Esc`, or a scroll.
 */

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

function toValue(y: number, m: number, d: number): string {
  return `${y}-${pad(m + 1)}-${pad(d)}`
}

function parse(value: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  return match ? { y: Number(match[1]), m: Number(match[2]) - 1, d: Number(match[3]) } : null
}

/** `2026-10-07` → `7 Oct 2026`. */
function display(value: string): string {
  const p = parse(value)
  return p ? `${p.d} ${MONTHS[p.m].slice(0, 3)} ${p.y}` : ''
}

export function DatePicker({
  value, onChange, placeholder = 'Any date', ariaLabel, min, max,
}: {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  ariaLabel?: string
  /** `YYYY-MM-DD`; days outside the range cannot be picked. */
  min?: string
  max?: string
}) {
  // The open calendar's button, which it is placed under; null while closed.
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const open = anchor !== null

  return (
    <div className="relative">
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={(e) => setAnchor(open ? null : e.currentTarget)}
        className={`flex h-8 w-full min-w-0 items-center gap-1.5 rounded-md border px-2 text-left text-[11px] transition-colors ${
          open ? 'theme-accent-border' : 'theme-border hover:theme-surface'
        }`}
      >
        <CalendarDays size={12} className="shrink-0 theme-text-muted" />
        <span className={`min-w-0 flex-1 truncate ${value ? 'theme-text' : 'theme-text-muted'}`}>
          {value ? display(value) : placeholder}
        </span>
        {value && (
          <span
            role="button"
            tabIndex={0}
            aria-label="Clear the date"
            onClick={(e) => { e.stopPropagation(); onChange('') }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onChange('') } }}
            className="shrink-0 rounded p-0.5 theme-text-muted hover:theme-text"
          >
            <X size={11} />
          </span>
        )}
      </button>
      {anchor && (
        <Calendar
          anchor={anchor}
          value={value}
          min={min}
          max={max}
          onPick={(v) => { onChange(v); setAnchor(null) }}
          onClose={() => setAnchor(null)}
        />
      )}
    </div>
  )
}

const PANEL_WIDTH = 256 // w-64
const PANEL_HEIGHT_GUESS = 330 // the day view; corrected once measured

function placeUnder(anchor: HTMLElement, width: number, height: number) {
  const a = anchor.getBoundingClientRect()
  const above = a.bottom + 4 + height > window.innerHeight - 8
  return {
    left: Math.min(Math.max(8, a.left), window.innerWidth - width - 8),
    top: above ? Math.max(8, a.top - height - 4) : a.bottom + 4,
    above,
  }
}

function Calendar({
  anchor, value, min, max, onPick, onClose,
}: {
  anchor: HTMLElement
  value: string
  min?: string
  max?: string
  onPick: (value: string) => void
  onClose: () => void
}) {
  const today = new Date()
  const chosen = parse(value)
  const [view, setView] = useState<'days' | 'months' | 'years'>('days')
  const [year, setYear] = useState(chosen?.y ?? today.getFullYear())
  const [month, setMonth] = useState(chosen?.m ?? today.getMonth())
  const panel = useRef<HTMLDivElement>(null)
  // Placed under its button from the very first frame. Starting at (0, 0) and
  // moving once measured made it appear to fly in from the top-left corner.
  const [place, setPlace] = useState(() => placeUnder(anchor, PANEL_WIDTH, PANEL_HEIGHT_GUESS))

  // Then corrected with the real size: above the button when the screen ends
  // below it, and never off either side.
  useLayoutEffect(() => {
    const box = panel.current?.getBoundingClientRect()
    if (box) setPlace(placeUnder(anchor, box.width, box.height))
  }, [anchor, view])

  useEffect(() => {
    const outside = (e: PointerEvent) => {
      const t = e.target as Node
      if (!panel.current?.contains(t) && !anchor.contains(t)) onClose()
    }
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }
    const scroll = (e: Event) => { if (!panel.current?.contains(e.target as Node)) onClose() }
    document.addEventListener('pointerdown', outside, true)
    document.addEventListener('keydown', key, true)
    window.addEventListener('scroll', scroll, true)
    return () => {
      document.removeEventListener('pointerdown', outside, true)
      document.removeEventListener('keydown', key, true)
      window.removeEventListener('scroll', scroll, true)
    }
  }, [anchor, onClose])

  const allowed = (v: string) => (!min || v >= min) && (!max || v <= max)
  const todayValue = toValue(today.getFullYear(), today.getMonth(), today.getDate())

  const step = (by: number) => {
    if (view === 'days') {
      const d = new Date(year, month + by, 1)
      setYear(d.getFullYear())
      setMonth(d.getMonth())
    } else {
      setYear((y) => y + by * (view === 'years' ? 12 : 1))
    }
  }

  // Monday-first grid with the previous and next months' days greyed in.
  const first = new Date(year, month, 1)
  const lead = (first.getDay() + 6) % 7
  const cells = Array.from({ length: 42 }, (_, i) => new Date(year, month, i - lead + 1))
  const yearStart = Math.floor(year / 12) * 12

  const cellClass = (selected: boolean, current: boolean, dim: boolean, disabled: boolean) =>
    `flex items-center justify-center rounded-md text-[11px] tabular-nums transition-colors ${
      disabled ? 'cursor-default opacity-25'
        : selected ? 'theme-bg-primary theme-text-on-primary font-medium'
        : current ? 'theme-accent-border border theme-text hover:theme-surface-strong'
        : dim ? 'theme-text-muted opacity-50 hover:theme-surface-strong'
        : 'theme-text hover:theme-surface-strong'
    }`

  return createPortal(
    <div
      ref={panel}
      role="dialog"
      aria-label="Pick a date"
      style={{ left: place.left, top: place.top, transformOrigin: place.above ? 'bottom left' : 'top left' }}
      className="fixed z-[120] w-64 rounded-xl border theme-border theme-card p-3 shadow-2xl animate-in fade-in zoom-in-95 duration-150"
    >
      <div className="mb-2 flex items-center gap-1">
        <button type="button" onClick={() => step(-1)} aria-label="Previous" className="rounded-md p-1 theme-text-muted hover:theme-text hover:theme-surface-strong">
          <ChevronLeft size={14} />
        </button>
        <div className="flex flex-1 items-center justify-center gap-1 text-xs font-medium theme-text">
          {view === 'days' && (
            <button type="button" onClick={() => setView('months')} className="rounded-md px-1.5 py-0.5 hover:theme-surface-strong">
              {MONTHS[month]}
            </button>
          )}
          {view !== 'years' ? (
            <button type="button" onClick={() => setView('years')} className="rounded-md px-1.5 py-0.5 tabular-nums hover:theme-surface-strong">
              {year}
            </button>
          ) : (
            <span className="tabular-nums">{yearStart} – {yearStart + 11}</span>
          )}
        </div>
        <button type="button" onClick={() => step(1)} aria-label="Next" className="rounded-md p-1 theme-text-muted hover:theme-text hover:theme-surface-strong">
          <ChevronRight size={14} />
        </button>
      </div>

      {view === 'days' && (
        <>
          <div className="mb-1 grid grid-cols-7 text-center text-[10px] uppercase theme-text-muted">
            {WEEKDAYS.map((d) => <span key={d}>{d}</span>)}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {cells.map((d) => {
              const v = toValue(d.getFullYear(), d.getMonth(), d.getDate())
              const ok = allowed(v)
              return (
                <button
                  key={v}
                  type="button"
                  disabled={!ok}
                  onClick={() => onPick(v)}
                  className={`h-7 ${cellClass(v === value, v === todayValue, d.getMonth() !== month, !ok)}`}
                >
                  {d.getDate()}
                </button>
              )
            })}
          </div>
        </>
      )}

      {view === 'months' && (
        <div className="grid grid-cols-3 gap-1">
          {MONTHS.map((name, m) => (
            <button
              key={name}
              type="button"
              onClick={() => { setMonth(m); setView('days') }}
              className={`h-9 ${cellClass(chosen?.y === year && chosen.m === m, today.getFullYear() === year && today.getMonth() === m, false, false)}`}
            >
              {name.slice(0, 3)}
            </button>
          ))}
        </div>
      )}

      {view === 'years' && (
        <div className="grid grid-cols-3 gap-1">
          {Array.from({ length: 12 }, (_, i) => yearStart + i).map((y) => (
            <button
              key={y}
              type="button"
              onClick={() => { setYear(y); setView('months') }}
              className={`h-9 ${cellClass(chosen?.y === y, today.getFullYear() === y, false, false)}`}
            >
              {y}
            </button>
          ))}
        </div>
      )}

      <div className="mt-2 flex items-center justify-between border-t theme-border pt-2 text-[11px]">
        <button type="button" onClick={() => onPick('')} className="theme-text-muted hover:theme-text">
          Clear
        </button>
        <button
          type="button"
          disabled={!allowed(todayValue)}
          onClick={() => onPick(todayValue)}
          className="theme-accent hover:underline disabled:opacity-40"
        >
          Today
        </button>
      </div>
    </div>,
    document.body,
  )
}
