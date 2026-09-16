/**
 * A two-position ON/OFF switch.
 *
 * Deliberately not the rounded pill-and-knob: that shape reads as an iOS
 * toggle, tells you the state only by the knob's position and the track's
 * colour, and sits oddly in an app whose default face is Monocraft. This is a
 * segmented control — both positions are drawn, the live one is filled, and
 * the word is always legible.
 *
 * Still one control rather than two radio buttons: the value is binary, so
 * `role="switch"` is the right semantics and a click anywhere flips it.
 */
export function Switch({
  checked,
  onChange,
  disabled = false,
  label,
  className = '',
}: {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  /** For screen readers, when no visible <label> is associated. */
  label?: string
  /** Applied to the live ON segment, for a state that wants its own colour. */
  className?: string
}) {
  const seg =
    'flex-1 flex items-center justify-center transition-colors duration-150 select-none'

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="inline-flex shrink-0 h-7 w-[76px] rounded-[3px] border theme-border overflow-hidden text-[10px] font-bold tracking-[0.15em] disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-[color-mix(in_srgb,var(--primary)_55%,transparent)]"
    >
      <span
        className={`${seg} ${
          checked
            ? `theme-bg-primary theme-text-on-primary ${className}`
            : 'theme-text-muted'
        }`}
      >
        ON
      </span>
      {/* A hairline between the halves, so the boundary is visible even when
          neither side is the filled one (the disabled case). */}
      <span
        className={`${seg} border-l theme-border ${
          checked ? 'theme-text-muted' : 'theme-switch-off theme-text'
        }`}
      >
        OFF
      </span>
    </button>
  )
}
