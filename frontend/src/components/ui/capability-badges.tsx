import { Brain, Wrench, Eye } from 'lucide-react'

/**
 * What a model can do, as icons.
 *
 * Shared by the composer's picker and the Forge so the two never disagree about
 * what a tag is capable of. Values come from Ollama's `/api/show`; anything not
 * listed here is ignored rather than rendered as an unexplained glyph.
 *
 * Hints are deliberately terse — they are tooltips, not documentation.
 */
const BADGES = [
  { id: 'thinking', icon: Brain, hint: 'Reasoning — thinks before answering' },
  { id: 'tools', icon: Wrench, hint: 'Tool calling' },
  { id: 'vision', icon: Eye, hint: 'Accepts images' },
] as const

export function CapabilityBadges({
  capabilities,
  size = 11,
}: {
  capabilities?: string[]
  size?: number
}) {
  const shown = BADGES.filter((b) => capabilities?.includes(b.id))
  if (!shown.length) return null
  return (
    <span className="flex items-center gap-1 shrink-0">
      {shown.map((b) => (
        <span key={b.id} title={b.hint} className="theme-text-muted">
          <b.icon size={size} />
        </span>
      ))}
    </span>
  )
}
