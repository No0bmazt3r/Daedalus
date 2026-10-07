// Words and colours for a turn's status and a number's verdict, shared by the
// Thread window and the strip under each chat answer. Its own module because a
// file exporting both components and plain values breaks React Fast Refresh
// (see `components/blueprints/tabs.ts`).

import type { NumberVerdict, TraceStatus } from '../../lib/threadClient'

export const STATUS: Record<TraceStatus, { label: string; tone: string; hint: string }> = {
  grounded: {
    label: 'grounded', tone: 'status-ok',
    hint: 'Passed validation, had evidence, and cited it',
  },
  ungrounded: {
    label: 'not grounded', tone: 'status-warn',
    hint: 'Passed validation but cited no evidence',
  },
  blocked: {
    label: 'blocked', tone: 'status-bad',
    hint: 'The validator found a claim the evidence does not support and replaced the answer',
  },
  refused: {
    label: 'refused', tone: 'theme-text-muted',
    hint: 'The safety guard stopped it before any tool or model ran',
  },
  no_model: {
    label: 'no model', tone: 'theme-text-muted',
    hint: 'Answered by the pipeline alone (out of scope, or a clarifying question)',
  },
  error: {
    label: 'error', tone: 'status-bad',
    hint: 'The model call or the pipeline failed',
  },
}

export const VERDICT: Record<NumberVerdict, { label: string; tone: string }> = {
  supported: { label: 'in the evidence', tone: 'status-ok status-ok-bg' },
  unsupported: { label: 'in no evidence (Rule 3)', tone: 'status-bad status-bad-bg' },
  stale: { label: 'only in replayed history', tone: 'status-warn status-warn-bg' },
  not_a_claim: { label: 'not a measurement', tone: 'theme-text-muted theme-surface' },
  unchecked: { label: 'not checked', tone: 'theme-text' },
}

/** `1840` → `1.8s`, `95` → `95ms`. */
export function formatMs(ms: number | null | undefined): string {
  if (ms == null) return '-'
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`
}
