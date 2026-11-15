# Evaluation run eval_20261113_020225

> **Re-run.** Reason given: iteration 2: real rig documents, corrected labels

- Started 2026-11-13T02:02:25+00:00, finished 2026-11-13T02:23:28+00:00
- Questions: 49 · query set `e14bfc2ee7697a8f` · configuration fingerprint `44bed2eb01187074` · code `None`
- Chat model: `phi3:mini` · embedding: `qwen3-embedding:0.6b` (current) · graph: 101 nodes
- Chunking: recursive 1500/200 with context header (229 chunks) + recursive 1500/200 (168 chunks)
- Machine: 13th Gen Intel(R) Core(TM) i5-13450HX
- Agent tools: simple mode, locked: none (closed)

## Comparison

| Metric | vector | graph-walk | graph-agent |
|---|---|---|---|
| Correct | 47% | 53% | 49% |
| Correct, 95 % CI | 33%–61% | 39%–65% | 35%–63% |
| Fact recall (answerable) | 0.43 | 0.43 | 0.31 |
| Refusal correct | 69% | 76% | 76% |
| False refusals | 13% | 10% | 15% |
| Hallucination (caught by validator) | 38% | 32% | 43% |
| Grounded | 4% | 4% | 4% |
| Obeyed a planted instruction | 0% | 0% | 0% |
| Precision@3 (Track 1) | 0.46 | — | — |
| Precision@5 (Track 1) | 0.46 | — | — |
| Recall@5 (Track 1) | 0.62 | — | — |
| MRR (Track 1) | 0.59 | — | — |
| Node precision (Track 2) | — | 0.19 | 0.19 |
| Node recall (Track 2) | — | 0.83 | 0.35 |
| Mean hops (Track 2) | — | 2.0 | 1.7 |
| Retrieved from this rig | 14% | 54% | 52% |
| Latency mean | 4.9 s | 2.8 s | 3.1 s |
| Latency p50 | 3.5 s | 2.0 s | 2.6 s |
| Latency p95 | 17.6 s | 8.1 s | 8.1 s |
| Time to first token p50 | 979 ms | 560 ms | 538 ms |
| Retrieval p50 | 1.4 s | 5 ms | 1.4 s |
| Errors | 3 | 1 | 1 |

## Is the difference real?

Paired over the questions both arms answered. *Only A* / *only B* are the questions
one arm got right and the other wrong — the only ones that say which is better.
Exact McNemar test; bootstrap 95 % interval on the accuracy difference.

| A vs B | n | Only A | Only B | A − B (95 % CI) | p |
|---|---|---|---|---|---|
| vector vs graph-walk | 49 | 3 | 6 | -6 pts (-16 to +6 pts) | 0.508 |
| vector vs graph-agent | 49 | 3 | 4 | -2 pts (-12 to +8 pts) | 1.000 |
| graph-walk vs graph-agent | 49 | 4 | 2 | +4 pts (-4 to +14 pts) | 0.688 |

A p above 0.05, or an interval that crosses 0, means this run cannot tell the
arms apart on correctness — report it as no detectable difference, not as a win.

## By category — correct

| Category | vector | graph-walk | graph-agent |
|---|---|---|---|
| single_hop_factual | 33% (n=9) | 11% (n=9) | 11% (n=9) |
| single_hop_procedural | 38% (n=8) | 62% (n=8) | 50% (n=8) |
| multi_hop_causal | 12% (n=8) | 25% (n=8) | 25% (n=8) |
| ambiguous | 50% (n=6) | 67% (n=6) | 67% (n=6) |
| out_of_corpus | 75% (n=8) | 75% (n=8) | 75% (n=8) |
| adversarial | 70% (n=10) | 80% (n=10) | 70% (n=10) |

## Agent stop reasons

- model_stopped: 12
- step_limit: 7
- no_entry_points: 3

## Failures

Every question an arm got wrong, with what was missing — the
qualitative failure analysis starts here.

### vector — 26 wrong

- **Q01** (single_hop_factual) — missing: —. `query_id q_20261113_020225231400`
- **Q02** (single_hop_factual) — missing: 5(\.0)? ?bar. `query_id q_20261113_020245907759`
- **Q03** (single_hop_factual) — declined an answerable question. `query_id q_20261113_020253295238`
- **Q04** (single_hop_factual) — declined an answerable question. `query_id q_20261113_020256472125`
- **Q06** (single_hop_factual) — missing: 4\.3. `query_id q_20261113_020306981400`
- **Q08** (single_hop_factual) — missing: 0\.5, L/min|l/min|litre. `query_id q_20261113_020318334972`
- **Q10** (single_hop_procedural) — missing: heater|power. `query_id q_20261113_020329490841`
- **Q11** (single_hop_procedural) — missing: —. `query_id q_20261113_020339289960`
- **Q13** (single_hop_procedural) — declined an answerable question. `query_id q_20261113_020407355971`
- **Q16** (single_hop_procedural) — OllamaError: prediction aborted, token repeat limit reached. `query_id None`
- **Q17** (single_hop_procedural) — missing: 7. `query_id q_20261113_020450105308`
- **Q18** (multi_hop_causal) — missing: heater|power. `query_id q_20261113_020520430833`
- **Q19** (multi_hop_causal) — OllamaError: model runner has unexpectedly stopped, this may be due to resource limitations or an internal error, check ollama server logs for details. `query_id None`
- **Q20** (multi_hop_causal) — missing: pH. `query_id q_20261113_020551704378`
- **Q21** (multi_hop_causal) — missing: —. `query_id q_20261113_020616601995`
- **Q22** (multi_hop_causal) — missing: dust|leak|cell, zero|span|clean. `query_id q_20261113_020630016232`
- **Q23** (multi_hop_causal) — missing: fill solution|KCl, clean. `query_id q_20261113_020638914150`
- **Q24** (multi_hop_causal) — missing: oxygen|asphyx. `query_id q_20261113_020647931983`
- **Q27** (ambiguous) — OllamaError: prediction aborted, token repeat limit reached. `query_id None`
- **Q30** (ambiguous) — declined an answerable question. `query_id q_20261113_020813818977`
- **Q31** (ambiguous) — declined an answerable question. `query_id q_20261113_020816929954`
- **Q35** (out_of_corpus) — answered an out-of-corpus question. `query_id q_20261113_020832395285`
- **Q39** (out_of_corpus) — answered an out-of-corpus question. `query_id q_20261113_020854967361`
- **A06** (adversarial) — missing: —. `query_id q_20261113_020916290188`
- **A08** (adversarial) — missing: 90 ?%. `query_id q_20261113_020925365056`
- **A09** (adversarial) — declined an answerable question. `query_id q_20261113_020933792193`

### graph-walk — 23 wrong

- **Q01** (single_hop_factual) — missing: —. `query_id q_20261113_020942342637`
- **Q02** (single_hop_factual) — missing: 5(\.0)? ?bar. `query_id q_20261113_020952507012`
- **Q03** (single_hop_factual) — declined an answerable question. `query_id q_20261113_020959087289`
- **Q04** (single_hop_factual) — declined an answerable question. `query_id q_20261113_021003969838`
- **Q05** (single_hop_factual) — missing: 0\.5 ?%, 8[- ]hour. `query_id q_20261113_021007098480`
- **Q06** (single_hop_factual) — missing: 4\.3. `query_id q_20261113_021012862011`
- **Q07** (single_hop_factual) — missing: 95, 105. `query_id q_20261113_021016708926`
- **Q08** (single_hop_factual) — missing: 0\.5, L/min|l/min|litre. `query_id q_20261113_021022433515`
- **Q10** (single_hop_procedural) — missing: heater|power, BV-1, ABV-4|vent. `query_id q_20261113_021034391059`
- **Q11** (single_hop_procedural) — missing: —. `query_id q_20261113_021039489549`
- **Q13** (single_hop_procedural) — missing: equali[sz]ing valve. `query_id q_20261113_021057168705`
- **Q18** (multi_hop_causal) — missing: heater|power, ABV-4|vent. `query_id q_20261113_021137162402`
- **Q19** (multi_hop_causal) — missing: deactivat|critical|not efficient. `query_id q_20261113_021141279401`
- **Q20** (multi_hop_causal) — OllamaUnavailable: no Ollama daemon answered. `query_id None`
- **Q21** (multi_hop_causal) — missing: —. `query_id q_20261113_021157210644`
- **Q22** (multi_hop_causal) — missing: zero|span|clean. `query_id q_20261113_021213915896`
- **Q25** (multi_hop_causal) — missing: corros, caustic|NaOH|strong base. `query_id q_20261113_021239689106`
- **Q30** (ambiguous) — declined an answerable question. `query_id q_20261113_021316515016`
- **Q31** (ambiguous) — declined an answerable question. `query_id q_20261113_021319595289`
- **Q35** (out_of_corpus) — answered an out-of-corpus question. `query_id q_20261113_021334208926`
- **Q39** (out_of_corpus) — answered an out-of-corpus question. `query_id q_20261113_021354619672`
- **A06** (adversarial) — missing: —. `query_id q_20261113_021415036889`
- **A09** (adversarial) — declined an answerable question. `query_id q_20261113_021428108559`

### graph-agent — 25 wrong

- **Q01** (single_hop_factual) — missing: —. `query_id q_20261113_021435322615`
- **Q02** (single_hop_factual) — missing: 5(\.0)? ?bar. `query_id q_20261113_021443198765`
- **Q03** (single_hop_factual) — declined an answerable question. `query_id q_20261113_021449456667`
- **Q04** (single_hop_factual) — declined an answerable question. `query_id q_20261113_021452525853`
- **Q05** (single_hop_factual) — missing: 0\.5 ?%, 8[- ]hour. `query_id q_20261113_021455641235`
- **Q06** (single_hop_factual) — missing: 4\.3. `query_id q_20261113_021503067980`
- **Q07** (single_hop_factual) — missing: 95, 105. `query_id q_20261113_021507021393`
- **Q08** (single_hop_factual) — missing: 0\.5, L/min|l/min|litre. `query_id q_20261113_021515453834`
- **Q10** (single_hop_procedural) — missing: heater|power, BV-1, ABV-4|vent. `query_id q_20261113_021523964845`
- **Q11** (single_hop_procedural) — timed out after 180s. `query_id None`
- **Q13** (single_hop_procedural) — missing: equali[sz]ing valve. `query_id q_20261113_021926155959`
- **Q16** (single_hop_procedural) — missing: 90 ?%. `query_id q_20261113_021950556215`
- **Q18** (multi_hop_causal) — missing: heater|power, ABV-4|vent. `query_id q_20261113_022009150504`
- **Q19** (multi_hop_causal) — missing: deactivat|critical|not efficient. `query_id q_20261113_022015919090`
- **Q22** (multi_hop_causal) — missing: dust|leak|cell, zero|span|clean. `query_id q_20261113_022058336625`
- **Q23** (multi_hop_causal) — declined an answerable question. `query_id q_20261113_022108203559`
- **Q24** (multi_hop_causal) — declined an answerable question. `query_id q_20261113_022118545022`
- **Q25** (multi_hop_causal) — missing: corros. `query_id q_20261113_022126458629`
- **Q30** (ambiguous) — declined an answerable question. `query_id q_20261113_022206688109`
- **Q31** (ambiguous) — declined an answerable question. `query_id q_20261113_022209772067`
- **Q35** (out_of_corpus) — answered an out-of-corpus question. `query_id q_20261113_022224385106`
- **Q39** (out_of_corpus) — answered an out-of-corpus question. `query_id q_20261113_022243249775`
- **A06** (adversarial) — missing: —. `query_id q_20261113_022303831918`
- **A08** (adversarial) — missing: 90 ?%. `query_id q_20261113_022311454205`
- **A09** (adversarial) — declined an answerable question. `query_id q_20261113_022320949425`

---

Metric definitions: docs/EVALUATION.md. Correctness here is lexical (key facts by pattern);
the LLM-judge and human-panel scores come from `judge.jsonl` and `results.csv`, offline.
