# Traditional RAG vs. Agentic GraphRAG — Comparison Framework

This file describes how the two retrieval tracks (`02-traditional-rag-spec.md` and `03-agentic-graphrag-spec.md`) will be evaluated against each other fairly, so the comparison is a genuine empirical contribution rather than an unsupported claim.

## 1. Why a formal comparison framework matters

A side-by-side claim like "GraphRAG performed better" is worthless to an examiner without: (a) an identical evaluation query set run through both, (b) the same underlying SLM/LLM for both (so you're isolating the retrieval architecture, not the model), and (c) pre-registered metrics decided *before* looking at results. This mirrors the rigor already established in your interim report's evaluation plan (Table 6/7) — this file extends that plan to cover the two-track comparison specifically.

## 2. Controlled variables (must be held constant across both tracks)

| Variable | Value (fixed across both tracks) |
|---|---|
| SLM/LLM used for generation | Same model, same quantization, same temperature/sampling settings |
| Document corpus | Identical source manuals/SOPs/anomaly logs (Track 2's graph is built *from* the same corpus Track 1 chunks) |
| Query set | Identical held-out evaluation queries |
| Hardware | Same machine, same load conditions, sequential runs (not concurrent, to avoid resource contention skewing latency) |
| Ground truth | Same manually-labelled reference answers |

## 3. The evaluation query set — deliberately stratified by difficulty

To give both tracks a fair shot at showing their strengths, the query set should include multiple categories, not just easy ones:

| Category | Example | Expected winner (hypothesis, to be tested not assumed) |
|---|---|---|
| **Single-hop factual** | "What is the normal operating temperature range for T-101?" | Likely a tie — both should handle this well |
| **Single-hop procedural** | "What's the SOP for starting a desorption cycle?" | Likely a tie |
| **Multi-hop causal** | "If both pressure and temperature spike, what SOP applies and has this combination occurred before?" | Hypothesis: GraphRAG wins |
| **Ambiguous/underspecified** | "Something feels off with the reactor, what should I check?" | Uncertain — worth testing which degrades more gracefully |
| **Out-of-corpus (should refuse)** | "What's the boiling point of liquid nitrogen?" (irrelevant to this reactor's SOPs) | Tests whether each track correctly says "I don't know" rather than hallucinating from parametric knowledge |

Aim for roughly 6–10 queries per category (30–50 total) — small enough to hand-label ground truth for within FYP2's timeline, large enough to say something statistically meaningful beyond anecdote.

## 4. Metrics (per track, then compared)

These extend Table 6 from the interim report to be measured **once per track**, side by side:

| Metric | Measurement method | How it's compared |
|---|---|---|
| **Response groundedness** | Manual labelling: does the answer's claims match retrieved evidence, or does it contain unsupported/hallucinated content? | Hallucination rate, Track 1 vs Track 2, per query category |
| **Retrieval relevance** | Precision/recall of retrieved chunks (Track 1) or subgraph nodes (Track 2) against a hand-labelled "relevant evidence set" per query | Precision/recall, Track 1 vs Track 2 |
| **Latency per query** | Wall-clock time from query submission to rendered response | Mean + p95 latency, Track 1 vs Track 2 — expect Track 2 to be slower; report by how much |
| **Multi-hop success rate** | Of the "multi-hop causal" category specifically, % answered correctly and completely | This is the key differentiator metric — the whole point of building Track 2 |
| **Refusal correctness** | Of the "out-of-corpus" category, % that correctly declined rather than hallucinating an answer | Tests groundedness discipline of each pipeline's prompt/context design |
| **Hop count / tool-call count** | Track 2 only — how many graph queries did the agent need per question | Diagnostic metric to understand latency cost, not a pass/fail target |

## 5. Reporting format for the final report

A single comparison table like this, populated once results are in:

| Metric | Traditional RAG | Agentic GraphRAG | Winner |
|---|---|---|---|
| Hallucination rate (overall) | X% | Y% | — |
| Hallucination rate (multi-hop only) | X% | Y% | — |
| Retrieval precision | X% | Y% | — |
| Mean latency | X s | Y s | — |
| Multi-hop success rate | X% | Y% | — |
| Refusal correctness | X% | Y% | — |

Plus a qualitative discussion section: *when* does each approach fail, and *why* (tie failures back to the architectural weaknesses already flagged in each spec file — e.g. GraphRAG failing due to graph coverage gaps, Traditional RAG failing due to chunk-boundary information loss).

## 6. A note on framing this for your defense/report

This comparison is intellectually honest **regardless of which wins** — if Traditional RAG matches GraphRAG's accuracy at a fraction of the latency for your actual query distribution, that is itself a valid and useful finding (arguably a more surprising/publishable one, since it would suggest the added complexity of GraphRAG isn't justified for this problem size). Don't feel obligated to make GraphRAG win — design the experiment to find out the truth, and report whichever result you get. Examiners respond far better to "we tested this rigorously and here's what we found" than to a result that looks suspiciously like it was reverse-engineered to please a hypothesis.

## 7. Suggested sequencing in FYP2

1. Build Track 1 first (simpler, matches original interim report scope) — get it working end-to-end.
2. Build Track 2 second, reusing the same deterministic sensor tools and PyQt UI, swapping only the Path-B retrieval backend.
3. Freeze both. Run the evaluation query set through both without further tuning (to keep it a fair snapshot-in-time comparison).
4. Only after the comparison is captured, optionally iterate/tune further if time remains.

This ordering protects you from the common failure mode of continuously tweaking one track after seeing its results, which would invalidate the comparison.
