# Run comparison

- `eval_20261113_014538` (official) — chunking: recursive 1500/200 with context header (229 chunks) + recursive 1500/200 (168 chunks)
- `eval_20261113_020225` (official) — chunking: recursive 1500/200 with context header (229 chunks) + recursive 1500/200 (168 chunks)
- `eval_20261113_022329` (official) — chunking: recursive 1500/200 with context header (229 chunks) + recursive 1500/200 (168 chunks)

> **Not a clean ablation** — these also differ: chat_model.

## vector

| Metric | eval_20261113_014538 | eval_20261113_020225 | eval_20261113_022329 |
|---|---|---|---|
| Correct | 49% | 47% | 37% |
| Fact recall | 0.38 | 0.43 | 0.25 |
| Hallucination | 26% | 38% | 43% |
| Grounded | 33% | 4% | 4% |
| Precision@5 | 0.41 | 0.46 | 0.42 |
| Recall@5 | 0.55 | 0.62 | 0.56 |
| MRR | 0.52 | 0.59 | 0.52 |
| Node recall | — | — | — |

## graph-walk

| Metric | eval_20261113_014538 | eval_20261113_020225 | eval_20261113_022329 |
|---|---|---|---|
| Correct | 55% | 53% | 47% |
| Fact recall | 0.42 | 0.43 | 0.38 |
| Hallucination | 30% | 32% | 57% |
| Grounded | 22% | 4% | 4% |
| Precision@5 | — | — | — |
| Recall@5 | — | — | — |
| MRR | — | — | — |
| Node recall | 0.73 | 0.83 | 0.80 |

## graph-agent

| Metric | eval_20261113_014538 | eval_20261113_020225 | eval_20261113_022329 |
|---|---|---|---|
| Correct | 53% | 49% | 35% |
| Fact recall | 0.40 | 0.31 | 0.12 |
| Hallucination | 14% | 43% | 54% |
| Grounded | 29% | 4% | 0% |
| Precision@5 | — | — | — |
| Recall@5 | — | — | — |
| MRR | — | — | — |
| Node recall | 0.44 | 0.35 | 0.19 |

