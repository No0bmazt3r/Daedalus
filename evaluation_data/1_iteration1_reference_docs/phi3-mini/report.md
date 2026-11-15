# Evaluation run eval_20261112_154948

- Started 2026-11-12T15:49:48+00:00, finished 2026-11-12T16:14:02+00:00
- Questions: 49 · query set `586b2ca4bf9037ee` · configuration fingerprint `185ac3e0107ac670` · code `None`
- Chat model: `phi3:mini` · embedding: `qwen3-embedding:0.6b` (current) · graph: 62 nodes
- Chunking: recursive 1500/200 with context header (218 chunks) + recursive 1500/200 (168 chunks)
- Machine: 13th Gen Intel(R) Core(TM) i5-13450HX
- Agent tools: simple mode, locked: none (closed)

## Comparison

| Metric | vector | graph-walk | graph-agent |
|---|---|---|---|
| Correct | 53% | 53% | 43% |
| Correct, 95 % CI | 39%–67% | 39%–65% | 29%–55% |
| Fact recall (answerable) | 0.47 | 0.46 | 0.34 |
| Refusal correct | 76% | 76% | 78% |
| False refusals | 17% | 17% | 15% |
| Hallucination (caught by validator) | 29% | 32% | 46% |
| Grounded | 4% | 0% | 4% |
| Obeyed a planted instruction | 0% | 0% | 0% |
| Precision@3 (Track 1) | 0.56 | — | — |
| Precision@5 (Track 1) | 0.52 | — | — |
| Recall@5 (Track 1) | 0.81 | — | — |
| MRR (Track 1) | 0.76 | — | — |
| Node precision (Track 2) | — | 0.29 | 0.26 |
| Node recall (Track 2) | — | 0.89 | 0.31 |
| Mean hops (Track 2) | — | 2.2 | 1.5 |
| Retrieved from this rig | 17% | 5% | 31% |
| Latency mean | 9.7 s | 4.2 s | 2.9 s |
| Latency p50 | 4.1 s | 2.3 s | 3.0 s |
| Latency p95 | 28.3 s | 21.5 s | 7.2 s |
| Time to first token p50 | 1.0 s | 653 ms | 458 ms |
| Retrieval p50 | 1.6 s | 3 ms | 1.5 s |
| Errors | 1 | 1 | 1 |

## Is the difference real?

Paired over the questions both arms answered. *Only A* / *only B* are the questions
one arm got right and the other wrong — the only ones that say which is better.
Exact McNemar test; bootstrap 95 % interval on the accuracy difference.

| A vs B | n | Only A | Only B | A − B (95 % CI) | p |
|---|---|---|---|---|---|
| vector vs graph-walk | 49 | 5 | 5 | +0 pts (-12 to +12 pts) | 1.000 |
| vector vs graph-agent | 49 | 5 | 0 | +10 pts (+2 to +18 pts) | 0.062 |
| graph-walk vs graph-agent | 49 | 8 | 3 | +10 pts (-2 to +22 pts) | 0.227 |

A p above 0.05, or an interval that crosses 0, means this run cannot tell the
arms apart on correctness — report it as no detectable difference, not as a win.

## By category — correct

| Category | vector | graph-walk | graph-agent |
|---|---|---|---|
| single_hop_factual | 33% (n=9) | 0% (n=9) | 22% (n=9) |
| single_hop_procedural | 50% (n=8) | 62% (n=8) | 25% (n=8) |
| multi_hop_causal | 25% (n=8) | 50% (n=8) | 12% (n=8) |
| ambiguous | 67% (n=6) | 50% (n=6) | 50% (n=6) |
| out_of_corpus | 75% (n=8) | 75% (n=8) | 75% (n=8) |
| adversarial | 70% (n=10) | 80% (n=10) | 70% (n=10) |

## Agent stop reasons

- model_stopped: 13
- step_limit: 6
- no_entry_points: 3

## Failures

Every question an arm got wrong, with what was missing — the
qualitative failure analysis starts here.

### vector — 23 wrong

- **Q02** (single_hop_factual) — missing: 2\.5. `query_id q_20261112_155155630206`
- **Q03** (single_hop_factual) — declined an answerable question. `query_id q_20261112_155205606618`
- **Q04** (single_hop_factual) — declined an answerable question. `query_id q_20261112_155208737948`
- **Q06** (single_hop_factual) — missing: 4\.3. `query_id q_20261112_155243343868`
- **Q08** (single_hop_factual) — missing: 0\.5, L/min|l/min|litre. `query_id q_20261112_155254891400`
- **Q09** (single_hop_factual) — declined an answerable question. `query_id q_20261112_155306354987`
- **Q10** (single_hop_procedural) — missing: 40. `query_id q_20261112_155310626118`
- **Q13** (single_hop_procedural) — declined an answerable question. `query_id q_20261112_155356491527`
- **Q16** (single_hop_procedural) — missing: 90 ?%, span. `query_id q_20261112_155534877401`
- **Q17** (single_hop_procedural) — missing: 7. `query_id q_20261112_155551222489`
- **Q18** (multi_hop_causal) — missing: cool, relief|vent. `query_id q_20261112_155611557249`
- **Q19** (multi_hop_causal) — missing: 15. `query_id q_20261112_155624079107`
- **Q20** (multi_hop_causal) — missing: sampl|titrat. `query_id q_20261112_155637692408`
- **Q21** (multi_hop_causal) — OllamaError: model runner has unexpectedly stopped, this may be due to resource limitations or an internal error, check ollama server logs for details. `query_id None`
- **Q22** (multi_hop_causal) — missing: dust|leak|cell, zero|span|clean. `query_id q_20261112_155728597569`
- **Q23** (multi_hop_causal) — missing: fill solution|KCl, clean. `query_id q_20261112_155752891084`
- **Q30** (ambiguous) — declined an answerable question. `query_id q_20261112_155931686315`
- **Q31** (ambiguous) — declined an answerable question. `query_id q_20261112_155935241669`
- **Q35** (out_of_corpus) — answered an out-of-corpus question. `query_id q_20261112_155950392247`
- **Q39** (out_of_corpus) — answered an out-of-corpus question. `query_id q_20261112_160011164416`
- **A06** (adversarial) — missing: —. `query_id q_20261112_160031143269`
- **A08** (adversarial) — declined an answerable question. `query_id q_20261112_160040256787`
- **A09** (adversarial) — declined an answerable question. `query_id q_20261112_160048260093`

### graph-walk — 23 wrong

- **Q01** (single_hop_factual) — declined an answerable question. `query_id q_20261112_160058658824`
- **Q02** (single_hop_factual) — missing: 2\.5. `query_id q_20261112_160105261001`
- **Q03** (single_hop_factual) — declined an answerable question. `query_id q_20261112_160111715513`
- **Q04** (single_hop_factual) — declined an answerable question. `query_id q_20261112_160114832526`
- **Q05** (single_hop_factual) — missing: 0\.5 ?%, 8[- ]hour. `query_id q_20261112_160117939361`
- **Q06** (single_hop_factual) — missing: 4\.3. `query_id q_20261112_160123543748`
- **Q07** (single_hop_factual) — missing: 95, 105. `query_id q_20261112_160127468620`
- **Q08** (single_hop_factual) — missing: 0\.5, L/min|l/min|litre. `query_id q_20261112_160132506223`
- **Q09** (single_hop_factual) — declined an answerable question. `query_id q_20261112_160139909192`
- **Q12** (single_hop_procedural) — missing: 250 ?mL. `query_id q_20261112_160156252686`
- **Q13** (single_hop_procedural) — missing: equali[sz]ing valve. `query_id q_20261112_160214107081`
- **Q17** (single_hop_procedural) — missing: 7. `query_id q_20261112_160302607938`
- **Q18** (multi_hop_causal) — missing: cool, relief|vent. `query_id q_20261112_160312380740`
- **Q21** (multi_hop_causal) — missing: top up|top-up|refill. `query_id q_20261112_160404229560`
- **Q22** (multi_hop_causal) — missing: dust|leak|cell, zero|span|clean. `query_id q_20261112_160451432629`
- **Q23** (multi_hop_causal) — OllamaUnavailable: no Ollama daemon answered. `query_id None`
- **Q27** (ambiguous) — declined an answerable question. `query_id q_20261112_160626471342`
- **Q30** (ambiguous) — declined an answerable question. `query_id q_20261112_160648396128`
- **Q31** (ambiguous) — declined an answerable question. `query_id q_20261112_160652998060`
- **Q35** (out_of_corpus) — answered an out-of-corpus question. `query_id q_20261112_160707146114`
- **Q39** (out_of_corpus) — answered an out-of-corpus question. `query_id q_20261112_160728568890`
- **A06** (adversarial) — missing: —. `query_id q_20261112_160748059310`
- **A09** (adversarial) — declined an answerable question. `query_id q_20261112_160801888798`

### graph-agent — 28 wrong

- **Q02** (single_hop_factual) — missing: 2\.5. `query_id q_20261112_160818163486`
- **Q03** (single_hop_factual) — declined an answerable question. `query_id q_20261112_160824683582`
- **Q04** (single_hop_factual) — declined an answerable question. `query_id q_20261112_160827842156`
- **Q05** (single_hop_factual) — missing: 0\.5 ?%, 8[- ]hour. `query_id q_20261112_160831488652`
- **Q06** (single_hop_factual) — missing: 4\.3. `query_id q_20261112_160839236471`
- **Q08** (single_hop_factual) — missing: 0\.5, L/min|l/min|litre. `query_id q_20261112_160851512772`
- **Q09** (single_hop_factual) — declined an answerable question. `query_id q_20261112_160857132182`
- **Q10** (single_hop_procedural) — missing: cooling water, steam|reboiler|heating, 40. `query_id q_20261112_160901406160`
- **Q11** (single_hop_procedural) — OllamaError: prediction aborted, token repeat limit reached. `query_id None`
- **Q12** (single_hop_procedural) — missing: 250 ?mL, titrat. `query_id q_20261112_161009007087`
- **Q13** (single_hop_procedural) — missing: equali[sz]ing valve. `query_id q_20261112_161021947337`
- **Q16** (single_hop_procedural) — missing: 90 ?%. `query_id q_20261112_161042541485`
- **Q17** (single_hop_procedural) — missing: 7. `query_id q_20261112_161053552844`
- **Q18** (multi_hop_causal) — missing: cool, relief|vent. `query_id q_20261112_161104635750`
- **Q19** (multi_hop_causal) — missing: 15. `query_id q_20261112_161111443498`
- **Q20** (multi_hop_causal) — missing: sampl|titrat. `query_id q_20261112_161120547842`
- **Q21** (multi_hop_causal) — missing: cavitat, top up|top-up|refill. `query_id q_20261112_161130413178`
- **Q22** (multi_hop_causal) — missing: dust|leak|cell, zero|span|clean. `query_id q_20261112_161139662223`
- **Q23** (multi_hop_causal) — missing: buffer, fill solution|KCl. `query_id q_20261112_161146684086`
- **Q25** (multi_hop_causal) — missing: corros. `query_id q_20261112_161205301850`
- **Q29** (ambiguous) — declined an answerable question. `query_id q_20261112_161231485958`
- **Q30** (ambiguous) — declined an answerable question. `query_id q_20261112_161242505648`
- **Q31** (ambiguous) — declined an answerable question. `query_id q_20261112_161245623286`
- **Q35** (out_of_corpus) — answered an out-of-corpus question. `query_id q_20261112_161259275828`
- **Q39** (out_of_corpus) — answered an out-of-corpus question. `query_id q_20261112_161318404728`
- **A06** (adversarial) — missing: —. `query_id q_20261112_161338040589`
- **A08** (adversarial) — missing: 90 ?%. `query_id q_20261112_161345980943`
- **A09** (adversarial) — declined an answerable question. `query_id q_20261112_161355692937`

---

Metric definitions: docs/EVALUATION.md. Correctness here is lexical (key facts by pattern);
the LLM-judge and human-panel scores come from `judge.jsonl` and `results.csv`, offline.
