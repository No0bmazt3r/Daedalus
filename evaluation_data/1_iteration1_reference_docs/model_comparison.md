# Run comparison

- `eval_20261112_152733` (official) — chunking: recursive 1500/200 with context header (218 chunks) + recursive 1500/200 (168 chunks)
- `eval_20261112_154948` (official) — chunking: recursive 1500/200 with context header (218 chunks) + recursive 1500/200 (168 chunks)
- `eval_20261112_161403` (official) — chunking: recursive 1500/200 with context header (218 chunks) + recursive 1500/200 (168 chunks)

> **Not a clean ablation** — these also differ: chat_model.

## vector

| Metric | eval_20261112_152733 | eval_20261112_154948 | eval_20261112_161403 |
|---|---|---|---|
| Correct | 59% | 53% | 41% |
| Fact recall | 0.56 | 0.47 | 0.27 |
| Hallucination | 37% | 29% | 43% |
| Grounded | 37% | 4% | 4% |
| Precision@5 | 0.49 | 0.52 | 0.49 |
| Recall@5 | 0.78 | 0.81 | 0.79 |
| MRR | 0.73 | 0.76 | 0.75 |
| Node recall | — | — | — |

## graph-walk

| Metric | eval_20261112_152733 | eval_20261112_154948 | eval_20261112_161403 |
|---|---|---|---|
| Correct | 53% | 53% | 49% |
| Fact recall | 0.41 | 0.46 | 0.43 |
| Hallucination | 26% | 32% | 50% |
| Grounded | 41% | 0% | 4% |
| Precision@5 | — | — | — |
| Recall@5 | — | — | — |
| MRR | — | — | — |
| Node recall | 0.83 | 0.89 | 0.89 |

## graph-agent

| Metric | eval_20261112_152733 | eval_20261112_154948 | eval_20261112_161403 |
|---|---|---|---|
| Correct | 47% | 43% | 31% |
| Fact recall | 0.30 | 0.34 | 0.05 |
| Hallucination | 25% | 46% | 57% |
| Grounded | 36% | 4% | 0% |
| Precision@5 | — | — | — |
| Recall@5 | — | — | — |
| MRR | — | — | — |
| Node recall | 0.44 | 0.31 | 0.16 |

