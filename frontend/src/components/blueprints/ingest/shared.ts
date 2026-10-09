import { type CorpusDocument, type DocumentOrigin, type IngestEvent } from '../../../lib/blueprintsClient'

export const LEVEL_STYLE: Record<IngestEvent['level'], string> = {
  debug: 'theme-text-muted opacity-60',
  info: 'theme-text-muted',
  warn: 'text-amber-400',
  error: 'text-rose-400',
}

export const SOURCE_TYPES = [
  { id: 'manual', label: 'Manual' },
  { id: 'sop', label: 'SOP' },
  { id: 'anomaly_record', label: 'Troubleshooting / incident' },
  { id: 'uauc_record', label: 'Safety (UAUC)' },
  { id: 'other', label: 'Other / background' },
]

export const SOURCE_LABEL: Record<string, string> = Object.fromEntries(SOURCE_TYPES.map((t) => [t.id, t.label]))

/**
 * Whose document it is. Asked at upload because it is cheapest to answer then,
 * and defaulted to Reference so nothing counts as this rig's unless somebody
 * said so. An answer resting only on a Reference for a rig-specific fact —
 * a setpoint, a step — has to say it is another installation's guidance.
 */
export const ORIGINS: { id: DocumentOrigin; label: string; hint: string }[] = [
  { id: 'rig', label: 'This rig', hint: "This lab's own documents, like its manuals and SOPs" },
  { id: 'reference', label: 'Reference', hint: "A document from another installation. Good for concepts, not for this rig's specifics" },
]

export const ORIGIN_BADGE: Record<DocumentOrigin, string> = {
  rig: 'border-emerald-400/40 bg-emerald-400/10 text-emerald-400',
  reference: 'theme-border theme-text-muted',
}

/**
 * A run's start time for the row: "Today, 10:25 PM", "Yesterday, 3:21 PM", or a
 * date. The hover text spells the moment out in full, with how long ago it was.
 */
export function runTime(iso: string): { short: string; full: string } {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return { short: iso, full: iso }
  const time = at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  const days = Math.round(
    (new Date().setHours(0, 0, 0, 0) - new Date(at).setHours(0, 0, 0, 0)) / 86_400_000,
  )
  const day = days === 0 ? 'Today' : days === 1 ? 'Yesterday'
    : at.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
  const mins = Math.round((Date.now() - at.getTime()) / 60_000)
  const ago = mins < 1 ? 'just now' : mins < 60 ? `${mins} min ago`
    : mins < 1440 ? `${Math.round(mins / 60)} h ago` : `${Math.round(mins / 1440)} days ago`
  const full = at.toLocaleString(undefined, { dateStyle: 'full', timeStyle: 'medium' })
  return { short: `${day}, ${time}`, full: `${full} (${ago})` }
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

// ── step 1 ───────────────────────────────────────────────────────────────────

/** Fully ingested: every chunk has a vector. It lives in Corpus from then on. */
export function isIngested(d: CorpusDocument): boolean {
  return d.extract_status === 'ok' && d.chunk_count > 0 && d.embedded_count === d.chunk_count
}
