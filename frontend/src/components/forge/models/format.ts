import { CircleCheck, CircleAlert, CircleSlash, Cloud, HelpCircle } from 'lucide-react'

export function bytes(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined) return '-'
  if (n < 1024) return `${n} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = n / 1024
  let u = 0
  while (v >= 1024 && u < units.length - 1) {
    v /= 1024
    u++
  }
  return `${v.toFixed(digits)} ${units[u]}`
}

export function ms(n: number | null | undefined): string {
  if (n === null || n === undefined) return '-'
  return n >= 1000 ? `${(n / 1000).toFixed(1)}s` : `${Math.round(n)}ms`
}

export const VERDICT = {
  safe: { icon: CircleCheck, tone: 'status-ok', label: 'safe' },
  marginal: { icon: CircleAlert, tone: 'status-warn', label: 'marginal' },
  will_not_fit: { icon: CircleSlash, tone: 'status-bad', label: 'will not fit' },
  cloud: { icon: Cloud, tone: 'theme-text-muted', label: 'cloud' },
  unknown: { icon: HelpCircle, tone: 'theme-text-muted', label: 'unknown' },
} as const

export const PLACEMENT_HELP: Record<string, string> = {
  gpu: 'Weights fit in VRAM. This is the fast path.',
  offload: 'Too large for VRAM, so Ollama splits layers between GPU and system RAM. It runs, just slower.',
  cpu: 'Runs on the CPU from system RAM.',
  none: 'Fits neither VRAM nor system RAM.',
  cloud: "Hosted by Ollama's cloud. Benchmark reference only, never deployed (Rule 1).",
}

export const PROVENANCE_HELP: Record<string, string> = {
  declared: 'Arithmetic over a parameter count. Nothing has been run yet.',
  registry: "Real published size from the model's Ollama manifest, known before downloading.",
  measured: 'Real bytes on this disk, read from Ollama.',
  assumed: 'A documented default, because nothing better is available yet.',
}

/** Something typed into the search box that Ollama would accept as a tag. */
export function looksLikeTag(q: string): boolean {
  return q.startsWith('hf.co/') || /^[\w.-]+(\/[\w.-]+)?:[\w.-]+$/.test(q)
}
