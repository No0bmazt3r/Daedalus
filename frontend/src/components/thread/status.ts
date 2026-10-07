// Words and colours for a turn's status and a number's verdict, shared by the
// Thread window and the strip under each chat answer. Its own module because a
// file exporting both components and plain values breaks React Fast Refresh
// (see `components/blueprints/tabs.ts`).

import {
  Ban, CircleDashed, Layers, OctagonAlert, ShieldAlert, ShieldCheck, ShieldX, type LucideIcon,
} from 'lucide-react'
import type { NumberVerdict, TraceBucket, TraceChat, TraceStatus } from '../../lib/threadClient'

/**
 * Each status has an icon and a colour, so a list reads at a glance; the label
 * and hint are its tooltip. The shields are the verdicts (green, amber, red);
 * the grey icons are turns no verdict was reached on.
 */
export const STATUS: Record<TraceStatus, { label: string; tone: string; hint: string; icon: LucideIcon }> = {
  grounded: {
    label: 'Grounded', tone: 'status-ok', icon: ShieldCheck,
    hint: 'Passed validation, had evidence, and cited it',
  },
  ungrounded: {
    label: 'Not grounded', tone: 'status-warn', icon: ShieldAlert,
    hint: 'Passed validation but cited no evidence',
  },
  blocked: {
    label: 'Blocked', tone: 'status-bad', icon: ShieldX,
    hint: 'The validator found a claim the evidence does not support and replaced the answer',
  },
  refused: {
    label: 'Refused', tone: 'theme-text-muted', icon: Ban,
    hint: 'The safety guard stopped it before any tool or model ran',
  },
  no_model: {
    label: 'No model', tone: 'theme-text-muted', icon: CircleDashed,
    hint: 'Answered by the pipeline alone: out of scope, or a clarifying question',
  },
  error: {
    label: 'Error', tone: 'status-bad', icon: OctagonAlert,
    hint: 'The model call or the pipeline failed',
  },
}

/**
 * The list's filters: All, then the three buckets Settings → Ariadne's Thread
 * files each status into. `label` is the default name; the window shows the
 * one Settings has (`TracePage.labels`).
 */
export const FILTERS: {
  id: TraceBucket | 'all'
  label: string
  hint: string
  tone: string
  icon: LucideIcon
}[] = [
  { id: 'all', label: 'All', hint: 'Every question', tone: 'theme-text', icon: Layers },
  {
    id: 'grounded', label: 'Grounded', tone: 'status-ok', icon: ShieldCheck,
    hint: 'Passed validation and met what Settings says grounded requires',
  },
  {
    id: 'ungrounded', label: 'Not grounded', tone: 'status-warn', icon: ShieldAlert,
    hint: 'Checked and not grounded: cited no evidence, or blocked by the validator',
  },
  {
    id: 'unchecked', label: 'Not checked', tone: 'theme-text-muted', icon: CircleDashed,
    hint: 'No answer check ran: the guard refused it, it was answered without a model, or it failed',
  },
]

/** A bucket's colour, for the summary strip. */
export const BUCKET_FILL: Record<TraceBucket, string> = {
  grounded: 'status-ok-fill',
  ungrounded: 'bg-[var(--status-warn)]',
  unchecked: 'bg-[var(--text-muted)]',
}

export const VERDICT: Record<NumberVerdict, { label: string; tone: string }> = {
  supported: { label: 'in the evidence', tone: 'status-ok status-ok-bg' },
  unsupported: { label: 'in no evidence (Rule 3)', tone: 'status-bad status-bad-bg' },
  stale: { label: 'only in replayed history', tone: 'status-warn status-warn-bg' },
  not_a_claim: { label: 'not a measurement', tone: 'theme-text-muted theme-surface' },
  unchecked: { label: 'not checked', tone: 'theme-accent theme-surface' },
}

/** A chat's name as the Thread shows it, and what to add when it cannot be opened. */
export function chatLabel(chat: TraceChat | null): { title: string; note: string | null } {
  if (!chat) return { title: 'No chat', note: 'Asked outside a chat, e.g. by an evaluation run' }
  const title = chat.title ?? 'Untitled chat'
  if (!chat.exists) return { title: chat.title ?? 'Deleted chat', note: 'This chat was deleted; its record remains' }
  return { title, note: chat.incognito ? 'Incognito chat' : null }
}

/** `1840` → `1.8s`, `95` → `95ms`. */
export function formatMs(ms: number | null | undefined): string {
  if (ms == null) return '-'
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`
}
