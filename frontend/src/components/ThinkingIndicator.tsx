import { useMemo } from 'react'
import { ThinkingOrb, type OrbState } from 'thinking-orbs'

// The stage the server reports while a reply is in flight (`chatClient` progress
// phases), as an orb animation and a few words. Unknown or missing phases read
// as plain "working" rather than guessing.
const PHASES: Record<string, { state: OrbState; label: string }> = {
  understood: { state: 'working', label: 'Reading your question' },
  evidence: { state: 'searching', label: 'Searching the knowledge base' },
  generating: { state: 'solving', label: 'Thinking' },
  validated: { state: 'composing', label: 'Checking the answer' },
}

/** Shown in place of an assistant reply until its first words arrive. */
export function ThinkingIndicator({ phase }: { phase?: string }) {
  const { state, label } = PHASES[phase ?? ''] ?? { state: 'working' as const, label: 'Working' }
  // The orb draws on a canvas, so it needs a real colour rather than a CSS
  // variable. Read once per mount: the theme does not change mid-reply.
  const color = useMemo(
    () => getComputedStyle(document.documentElement).getPropertyValue('--primary').trim() || undefined,
    [],
  )
  return (
    <span className="flex items-center gap-2.5" role="status" aria-live="polite">
      <ThinkingOrb state={state} size={32} color={color} aria-label={label} />
      <span className="text-sm theme-text-muted">{label}…</span>
    </span>
  )
}
