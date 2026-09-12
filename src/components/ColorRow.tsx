import { RotateCcw } from 'lucide-react'
import { clearZoneHighlight, showZoneHighlight } from '../lib/zoneHighlight'

interface ColorRowProps {
  label: string
  value: string
  onChange: (hex: string) => void
  /** Shown as "changed" and restored when the reset button is pressed. */
  reference?: string
  onReset?: () => void
  title?: string
  /** Key into ZONE_MAP — hovering the row outlines that part of the UI. */
  zone?: string
}

/**
 * One editable colour: a live swatch backed by a native colour input, the hex
 * beside it, and a reset arrow that lights up once the value drifts from the
 * theme it came from.
 */
export function ColorRow({ label, value, onChange, reference, onReset, title, zone }: ColorRowProps) {
  const changed =
    !!reference && value.toLowerCase() !== reference.toLowerCase()

  return (
    <div
      className="flex items-center justify-between gap-2 py-1 group"
      title={title}
      onMouseEnter={() => showZoneHighlight(zone)}
      onMouseLeave={clearZoneHighlight}
    >
      <span className="text-xs theme-text-muted truncate">{label}</span>
      <div className="flex items-center gap-1.5 shrink-0">
        <span className="text-[10px] font-mono theme-text-muted opacity-0 group-hover:opacity-60 transition-opacity tabular-nums">
          {value}
        </span>
        <label
          className="relative w-6 h-6 rounded-full border border-black/40 shadow-sm cursor-pointer overflow-hidden ring-offset-1 hover:ring-1 hover:ring-[var(--primary)] transition-all"
          style={{ backgroundColor: value }}
        >
          <input
            type="color"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            aria-label={label}
            className="absolute inset-0 opacity-0 cursor-pointer"
          />
        </label>
        {onReset && (
          <button
            type="button"
            onClick={onReset}
            title="Reset this color"
            aria-label={`Reset ${label}`}
            className={`p-1 rounded transition-all ${
              changed
                ? 'theme-primary opacity-100 hover:bg-black/20'
                : 'theme-text-muted opacity-0 group-hover:opacity-40 hover:!opacity-80'
            }`}
          >
            <RotateCcw size={11} />
          </button>
        )}
      </div>
    </div>
  )
}
