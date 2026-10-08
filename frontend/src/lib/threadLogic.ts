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
