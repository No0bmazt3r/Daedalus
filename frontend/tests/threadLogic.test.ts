/// <reference types="node" />
// `pnpm test` — Node's own runner, no test framework. See src/lib/threadLogic.ts.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Groundedness, Trace, TraceSummary } from '../src/lib/threadClient.ts';
import { groupByChat, share, stepSelection, traceMarkdown } from '../src/lib/threadLogic.ts';

function turn(query_id: string, session_id: string | null): TraceSummary {
  return {
    query_id, session_id, timestamp: '2026-10-07T10:00:00+00:00', question: `q ${query_id}`,
    chat: session_id ? { session_id, title: `chat ${session_id}`, exists: true, incognito: false } : null,
    intent: null, model: null, status: 'grounded', bucket: 'grounded', grounded: true,
    latency_ms: 10, tool_count: 0, retrieval_count: 0, error_count: 0, tracks: [], label: null,
  };
}

test('consecutive turns from one chat form one group; a chat that recurs forms another', () => {
  const groups = groupByChat([turn('a', 's1'), turn('b', 's1'), turn('c', 's2'), turn('d', 's1'), turn('e', null)]);
  assert.deepEqual(groups.map((g) => [g.id, g.items.length]), [['s1', 2], ['s2', 1], ['s1', 1], ['none', 1]]);
  // React keys stay unique although s1 appears twice.
  assert.equal(new Set(groups.map((g) => g.key)).size, groups.length);
});

test('arrow keys skip folded chats and stop at the ends', () => {
  const groups = groupByChat([turn('a', 's1'), turn('b', 's2'), turn('c', 's2'), turn('d', 's3')]);
  const folded = new Set(['s2']);
  assert.equal(stepSelection(groups, folded, 'a', 1), 'd');
  assert.equal(stepSelection(groups, folded, 'd', 1), 'd');
  assert.equal(stepSelection(groups, folded, 'a', -1), 'a');
  assert.equal(stepSelection(groups, folded, null, 1), 'a');
  // The selection sits in a chat that was just folded: start again from the top.
  assert.equal(stepSelection(groups, folded, 'b', 1), 'a');
  assert.equal(stepSelection([], folded, 'x', 1), 'x');
});

test('share rounds and refuses to divide by zero', () => {
  assert.equal(share(1, 3), 33);
  assert.equal(share(0, 0), null);
});

test('the Markdown export carries the question, every step and every number verdict', () => {
  const summary = { ...turn('q_1', 's1'), label: { hallucinated: true, note: 'wrong | sensor', timestamp: 't' } };
  const trace: Trace = {
    query_id: 'q_1', summary, total_ms: 100, evidence_available: true,
    steps: [
      { kind: 'query', title: 'Question', at: null, ms: null, status: 'ok', detail: {}, table: 'conversation_logs' },
      { kind: 'model', title: 'qwen3:1.7b', at: null, ms: 90, status: 'ok', detail: {}, table: 'model_logs' },
    ],
  };
  const check: Groundedness = {
    query_id: 'q_1', answer: 'CO2 is 488.5 ppm [S1].', delivered: 'CO2 is 488.5 ppm [S1].', replaced: false,
    status: 'grounded', grounded: true, validation: {}, counts: { supported: 1 }, citations: [],
    evidence_available: true, redacted: false,
    numbers: [{
      text: '488.5', start: 7, end: 12, value: 488.5, unit: 'ppm', verdict: 'supported', reason: 'in the evidence',
      sources: [{ label: 'S1', line: '[S1] co2_ppm = 488.5 ppm.' }],
    }],
  };
  const md = traceMarkdown(trace, check);
  assert.match(md, /^# Ariadne's Thread — q_1/);
  assert.match(md, /\*\*Human label:\*\* hallucinated — wrong \| sensor/);
  assert.match(md, /\| 2 \| model \| qwen3:1\.7b \| 90 \| ok \|/);
  assert.match(md, /\| 488\.5 \| supported \| in the evidence \| \[S1\] co2_ppm = 488\.5 ppm\. \|/);
  // A pipe in a value must not break the table.
  assert.doesNotMatch(md, /wrong \| sensor \|/);
});

test('the Markdown export lists each retrieved chunk with its chunking and whether it was cited', () => {
  const trace: Trace = { query_id: 'q_2', summary: null, total_ms: null, evidence_available: true, steps: [] };
  const check: Groundedness = {
    query_id: 'q_2', answer: 'x', delivered: 'x', replaced: false, status: 'grounded', grounded: true,
    validation: {}, counts: {}, citations: [], evidence_available: true, redacted: false, numbers: [],
  };
  const md = traceMarkdown(trace, check, [{
    track: 'vector', query: 'q', top_k: 2, store: null, retrieval_ms: 5, rerank_ms: null, rerank_model: null, candidates: null,
    documents: ['sop.pdf'],
    chunks: [{
      rank: 1, chunk_id: 'c1', missing: false, text: 't', document: 'sop.pdf', document_title: null, source_type: 'sop',
      page: 4, section: 'NDIR', ordinal: 3, tokens: 120, distance: 0.2134, rerank_score: null, origin: 'rig',
      chunking: { strategy: 'recursive', size: 512, overlap: 64, embedding_model: 'nomic' }, label: 'D1', cited: true,
    }],
  }]);
  assert.match(md, /## Retrieval — Track 1 \(vector\)/);
  assert.match(md, /\| 1 \| sop\.pdf \| p\.4 §NDIR \| recursive 512\/64 \| 0\.213 \| - \| rig \| D1 \|/);
});
