// The Thread's pure logic: no React, no DOM, no fetch — so `node --test` runs it
// as it is (`tests/threadLogic.test.ts`, `pnpm test`). Type-only imports keep that
// true: they are erased before Node reads the file.

import type { Groundedness, RetrievalDetail, Trace, TraceChat, TraceStatus, TraceSummary } from './threadClient';

/**
 * Consecutive questions from one chat — the list's unit, under one header.
 * `id` is the chat, what a fold is remembered by, so a new question in a folded
 * chat leaves it folded; `key` is only for React, since a chat can recur
 * further down the list.
 */
export interface Group {
  key: string;
  id: string;
  chat: TraceChat | null;
  items: TraceSummary[];
}

export function groupByChat(items: TraceSummary[]): Group[] {
  const groups: Group[] = [];
  for (const t of items) {
    const last = groups[groups.length - 1];
    if (last && last.items[0].session_id === t.session_id) last.items.push(t);
    else {
      groups.push({
        key: `${t.session_id ?? 'none'}:${t.query_id}`,
        id: t.session_id ?? 'none',
        chat: t.chat,
        items: [t],
      });
    }
  }
  return groups;
}

/**
 * The question ↑ or ↓ moves to: through the visible list only, so a folded
 * chat is skipped. Stays put at either end; starts at the top with nothing
 * selected.
 */
export function stepSelection(
  groups: Group[],
  collapsed: ReadonlySet<string>,
  selected: string | null,
  direction: 1 | -1,
): string | null {
  const visible = groups.filter((g) => !collapsed.has(g.id)).flatMap((g) => g.items.map((t) => t.query_id));
  if (!visible.length) return selected;
  const at = selected ? visible.indexOf(selected) : -1;
  if (at === -1) return visible[0];
  return visible[Math.min(visible.length - 1, Math.max(0, at + direction))];
}

/** `3 of 12` as a percentage, for the summary strip; null with nothing to divide. */
export function share(part: number, total: number): number | null {
  return total ? Math.round((part / total) * 100) : null;
}

function cell(value: unknown): string {
  if (value == null || value === '') return '-';
  return (typeof value === 'object' ? JSON.stringify(value) : String(value)).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

/**
 * One answer's thread as Markdown — for a report appendix, or to hand to an
 * examiner: what was asked, how it was answered step by step, and the verdict
 * on every number. Everything comes from the two responses already on screen.
 */
export function traceMarkdown(trace: Trace, check: Groundedness, retrievals: RetrievalDetail[] = []): string {
  const s = trace.summary;
  const lines: string[] = [`# Ariadne's Thread — ${trace.query_id}`, ''];
  if (s) {
    lines.push(
      `- **Question:** ${s.question || '(not recorded)'}`,
      `- **Chat:** ${s.chat?.title ?? (s.chat ? 'Untitled' : 'none')}${s.chat && !s.chat.exists ? ' (deleted)' : ''}`,
      `- **Asked:** ${s.timestamp}`,
      `- **Status:** ${s.status} · validator grounded: ${s.grounded === null ? 'not checked' : s.grounded}`,
      `- **Model:** ${s.model ?? '-'} · **Intent:** ${s.intent ?? '-'} · **Total:** ${s.latency_ms ?? '-'} ms`,
    );
    if (s.label) {
      lines.push(`- **Human label:** ${s.label.hallucinated ? 'hallucinated' : 'correct'}${s.label.note ? ` — ${s.label.note}` : ''}`);
    }
    lines.push('');
  }
  lines.push('## Steps', '', '| # | Step | Title | ms | Status |', '|---|---|---|---|---|');
  trace.steps.forEach((step, i) => {
    lines.push(`| ${i + 1} | ${step.kind} | ${cell(step.title)} | ${cell(step.ms)} | ${step.status} |`);
  });
  for (const r of retrievals) {
    if (r.track === 'graph') {
      lines.push('', '## Retrieval — Track 2 (graph)', '',
        `Entry: ${r.entry_strategy ?? '-'} at ${(r.entry_nodes ?? []).join(', ') || '-'} · ${r.hop_count ?? (r.hops ?? []).length} hops`, '');
      for (const h of r.hops ?? []) lines.push(`${h.hop}. ${h.from.join(', ')} —${h.edge}→ ${h.to.join(', ') || '(nothing)'}`);
      const cited = (r.nodes ?? []).filter((n) => n.cited).map((n) => `${n.label} ${n.name}`);
      if (cited.length) lines.push('', `Cited: ${cited.join(', ')}`);
    } else {
      const chunking = (r.chunks ?? []).find((c) => c.chunking)?.chunking;
      lines.push('', '## Retrieval — Track 1 (vector)', '',
        `Top ${r.top_k ?? '-'} · ${chunking?.embedding_model ?? 'embedding model unknown'}` +
          `${r.rerank_model ? ` · re-ranked ${r.candidates ?? '?'} with ${r.rerank_model}` : ''}`,
        '', '| # | Document | Where | Chunking | Distance | Re-rank | Origin | Cited |', '|---|---|---|---|---|---|---|---|');
      for (const c of r.chunks ?? []) {
        const where = [c.page != null ? `p.${c.page}` : '', c.section ? `§${c.section}` : ''].filter(Boolean).join(' ')
        lines.push(`| ${c.rank} | ${cell(c.missing ? '(gone)' : c.document)} | ${cell(where)} | ${cell(c.chunking ? `${c.chunking.strategy} ${c.chunking.size}/${c.chunking.overlap}` : null)} | ${cell(c.distance?.toFixed(3))} | ${cell(c.rerank_score?.toFixed(2))} | ${cell(c.origin)} | ${c.cited ? c.label : '-'} |`);
      }
    }
  }
  lines.push('', '## Answer', '');
  if (check.replaced) lines.push(`> The validator replaced this answer. The operator saw: ${check.delivered}`, '');
  lines.push(check.redacted ? '_Not recorded: incognito chat._' : check.answer || '_No answer._', '');
  if (check.numbers.length) {
    lines.push('## Numbers', '', '| Number | Verdict | Why | Source |', '|---|---|---|---|');
    for (const m of check.numbers) {
      const source = m.sources[0];
      lines.push(`| ${cell(m.text)} | ${m.verdict} | ${cell(m.reason)} | ${source ? cell(`[${source.label}] ${source.line.replace(/^\[[A-Z]\d+\]\s*/, '')}`) : '-'} |`);
    }
    lines.push('');
  }
  lines.push('_A detector, not a proof: it catches an invented or stale number, not a right number on the wrong sensor._', '');
  return lines.join('\n');
}

/** The list's extra filters (under the sliders icon), as the form holds them. */
export type Extra = { status: '' | TraceStatus; track: '' | 'vector' | 'graph'; model: string; labelled: '' | 'yes' | 'no'; since: string; until: string }
export const NO_EXTRA: Extra = { status: '', track: '', model: '', labelled: '', since: '', until: '' }

/** The day after `date` (YYYY-MM-DD), as the exclusive end of a "To" day. */
export function dayAfter(date: string): string {
  const d = new Date(`${date}T00:00:00`)
  d.setDate(d.getDate() + 1)
  return d.toISOString()
}

/** An evidence line without its own `[S1]` prefix — the label is shown beside it already. */
export function stripLabel(line: string): string {
  return line.replace(/^\[[A-Z]\d+\]\s*/, '')
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** An evidence timestamp in parts: `2026-09-12 16:15:52 UTC (00:15 site time)`. */
export interface Moment { date: string; utc: string; site?: string }

function parseMoment(text: string): Moment | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}:\d{2})(?::\d{2})?(?:\.\d+)? UTC(?: \((\d{1,2}:\d{2}) site time\))?$/.exec(text.trim())
  if (!m) return null
  return { date: `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}`, utc: m[4], site: m[5] }
}

/** `12 Sep, 16:15 UTC (00:15 site)`, or the text unchanged if it is not a timestamp. */
function shortTime(text: string): string {
  const t = parseMoment(text)
  if (!t) return text
  return `${t.date}, ${t.utc} UTC${t.site ? ` (${t.site} site)` : ''}`
}

/**
 * A window, as short as it can be said: one date when both ends share it.
 * `12 Sep · 16:15–17:15 UTC (00:15–01:15 site)`.
 */
function timeRange(from: string, to: string): string {
  const { main, site } = rangeParts(from, to)
  return site ? `${main} (${site})` : main
}

/** The same window in two parts, so a narrow header can put site time on its own line. */
function rangeParts(from: string, to: string): { main: string; site?: string } {
  const a = parseMoment(from)
  const b = parseMoment(to)
  if (!a || !b || a.date !== b.date) return { main: `${shortTime(from)} → ${shortTime(to)}` }
  return {
    main: `${a.date} · ${a.utc}–${b.utc} UTC`,
    site: a.site && b.site ? `${a.site}–${b.site} site` : undefined,
  }
}

interface EvidenceRow { label: string; value: string; when?: Moment | string }
interface ParsedEvidence {
  title: string
  subtitle?: string
  /** For a window: its UTC span and its site-time span, for a two-line header. */
  span?: { main: string; site?: string }
  rows: EvidenceRow[]
  /** The day the window starts, so a row on that same day can leave its date out. */
  date?: string
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const moment = (text: string) => parseMoment(text) ?? text

/**
 * A sensor evidence line (the shapes `orchestration/evidence.py` writes for
 * `get_trend` and `get_live_reading`) as a title and labelled rows, so a
 * reader scans a small table instead of a paragraph. Null for anything else
 * (document passages, notes), which is shown as text.
 */
export function parseEvidenceLine(line: string): ParsedEvidence | null {
  const text = stripLabel(line).trim()

  // `co2_ppm from A to B[, X mode only], 721 readings: mean = 482.202 ppm. average …; min … at T; …`
  const trend = /^(\S+) from (.+?) to (.+?)(?:, (.+?) mode only)?, (\d+) readings: (.*)$/.exec(text)
  if (trend) {
    const [, sensor, from, to, mode, count, rest] = trend
    const rows: EvidenceRow[] = [{ label: 'Readings', value: count }]
    for (const part of rest.split(/\.\s+|;\s+/).map((p) => p.replace(/\.$/, '').trim()).filter(Boolean)) {
      const m = /^(\w+)\s*=?\s*(.+?)(?: at (.+))?$/.exec(part)
      if (!m) continue
      const [, name, value, when] = m
      // The headline aggregation repeats the average when it is the mean.
      if ((name === 'mean' || name === 'average') && rows.some((r) => r.label === 'Average')) continue
      rows.push({ label: name === 'mean' ? 'Average' : cap(name), value, when: when ? moment(when) : undefined })
    }
    const parts = rangeParts(from, to)
    const span = timeRange(from, to)
    return {
      title: sensor, subtitle: mode ? `${span} · ${mode} mode only` : span, rows,
      date: parseMoment(from)?.date,
      span: mode ? { ...parts, main: `${parts.main} · ${mode} mode only` } : parts,
    }
  }

  // `co2_ppm = 488.5 ppm. Reading at T, mode Desorption. STALE: 3 days old.`
  const live = /^(\S+) = (.+?)\. Reading at (.+?)(?:, mode ([^.]+))?\.(?:\s*(.*))?$/.exec(text)
  if (live) {
    const [, sensor, value, when, mode, tail] = live
    const rows: EvidenceRow[] = [{ label: 'Value', value, when: moment(when) }]
    if (mode) rows.push({ label: 'Mode', value: mode })
    if (tail && /STALE/.test(tail)) rows.push({ label: 'Stale', value: tail.replace(/^STALE:?\s*/, '').replace(/\.$/, '') || 'yes' })
    return { title: sensor, subtitle: 'Latest reading', rows }
  }
  return null
}
