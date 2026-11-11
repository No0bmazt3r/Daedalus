import { FlaskConical, Globe, Monitor } from 'lucide-react'

/**
 * Where a turn was asked: the Daedalus web app, CO2SorptionDT's MainUI (with
 * the rig token's name, so it says which machine), or the evaluation harness.
 *
 * Recorded by the route the question arrived on (`/api/chat` vs
 * `/api/rig-chat`), never by anything the client says, so it cannot be faked
 * from the web side. Turns logged before origins were recorded have none.
 */
const LOOK = {
  web: { icon: Globe, text: 'Web', tone: 'theme-text-muted', why: 'Asked in the Daedalus web app' },
  mainui: { icon: Monitor, text: 'MainUI', tone: 'status-info', why: 'Asked from CO2SorptionDT MainUI' },
  eval: { icon: FlaskConical, text: 'Eval', tone: 'theme-text-muted', why: 'Asked by the evaluation harness' },
} as const

export function OriginBadge({ origin, label, full = false }: {
  origin: string | null | undefined
  label?: string | null
  /** The turn header: the token's name spelled out, and "unknown" for old turns. */
  full?: boolean
}) {
  const look = origin ? LOOK[origin as keyof typeof LOOK] : undefined
  if (!look) {
    return full ? (
      <span className="theme-text-muted" title="Asked before Daedalus recorded where questions come from">
        origin not recorded
      </span>
    ) : null
  }
  const Icon = look.icon
  const named = origin === 'mainui' && label
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1 rounded border theme-border px-1 ${look.tone}`}
      title={named ? `${look.why}, token "${label}"` : look.why}
    >
      <Icon size={10} aria-hidden />
      {look.text}
      {full && named && <span className="theme-text-muted">· {label}</span>}
    </span>
  )
}
