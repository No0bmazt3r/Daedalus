# Track 2: Agentic GraphRAG Pipeline

This is the comparison arm. Instead of flat vector similarity search over document chunks, this track builds a **knowledge graph** of the domain and uses an **agentic loop** (multi-step, tool-calling, self-directed retrieval) to answer queries — particularly ones requiring multi-hop reasoning across sensors, thresholds, operating modes, SOPs, and anomaly history.

## 1. Purpose

Test whether structuring domain knowledge as an explicit graph — plus letting the agent decide *how* to traverse/query it rather than doing one fixed retrieval step — improves groundedness and correctness on complex queries, at the cost of added latency and engineering complexity. This is the project's original empirical contribution flagged in the SLR gap analysis (no existing study compares vector-RAG vs. graph-based retrieval for this class of offline industrial deployment).

## 2. What "agentic" means here specifically

Unlike Track 1 (one retrieval call → one generation call), the agent in Track 2 runs a **loop**:

1. Receive query, decide initial retrieval action (which node types to look up, or which relationship to traverse).
2. Execute a graph query tool.
3. **Evaluate**: is the retrieved subgraph sufficient to answer the question? (This can be a simple heuristic, e.g. "does the subgraph contain both a sensor node and a threshold/SOP node," or an SLM self-check call.)
4. If insufficient → issue a follow-up graph query (different traversal, different starting node, or fall back to vector search over node descriptions).
5. Repeat up to a max hop count (e.g. 3) to bound latency.
6. Synthesize final answer from the accumulated subgraph.

This is the "ReAct-style" pattern referenced in your own literature review (Rayfield et al., 2025 — ReAct meets industrial IoT) but applied to a knowledge graph rather than raw API calls.

## 3. Knowledge graph schema (proposed)

### Node types

| Node type | Examples | Attributes |
|---|---|---|
| `Sensor` | T-101, P-101, pH-101, NDIR | `id`, `unit`, `normal_range_min/max` |
| `OperatingMode` | Manual, Absorption, Desorption | `id`, `description` |
| `Threshold` | "CO2 > 500ppm = warning" | `sensor_id`, `condition`, `severity` |
| `SOPDocument` | SOP-04: Desorption startup | `id`, `title`, `full_text_ref` |
| `SOPStep` | Step 3 of SOP-04 | `sop_id`, `step_number`, `text` |
| `AnomalyRecord` | Anomaly #17, 2025-07-01 | `id`, `timestamp`, `sensor_id`, `description`, `resolution` |
| `AnomalyType` | "Temperature drift", "NDIR fault" | `id`, `description` |

### Edge types (relationships)

| Edge | Meaning |
|---|---|
| `Sensor -[MONITORED_IN]-> OperatingMode` | This sensor is relevant during this mode |
| `Sensor -[HAS_THRESHOLD]-> Threshold` | This sensor has this alert threshold |
| `Threshold -[TRIGGERS]-> AnomalyType` | Crossing this threshold indicates this anomaly type |
| `AnomalyType -[RESOLVED_BY]-> SOPDocument` | This SOP addresses this anomaly type |
| `SOPDocument -[CONTAINS]-> SOPStep` | Structural containment |
| `AnomalyRecord -[INSTANCE_OF]-> AnomalyType` | Historical occurrence links to its category |
| `AnomalyRecord -[INVOLVES]-> Sensor` | Which sensor was implicated |

This schema is intentionally small and hand-designed for a bounded domain — it does not need to be learned/extracted at large scale, since the corpus (a handful of manuals, SOPs, and anomaly logs for one lab rig) is small enough for semi-manual or LLM-assisted graph construction (see Section 5).

## 4. Example: why this helps on multi-hop queries

**Query:** "The reactor showed high pressure and high temperature at the same time this morning — what should I do, and has this happened before?"

- **Traditional RAG** would embed this whole sentence and search for chunks similar to it — likely retrieving the single SOP section that best matches the wording, but possibly missing either the pressure-specific or temperature-specific guidance if they live in different documents, and it has no structured way to check "has this co-occurrence happened before" beyond hoping an anomaly log chunk happens to mention both.
- **GraphRAG** can instead: (1) find both `Sensor` nodes (Pressure, Temperature) → (2) traverse to their `Threshold` nodes → (3) traverse to `AnomalyType` nodes triggered by *both* → (4) find `SOPDocument` nodes linked to that anomaly type → (5) separately query `AnomalyRecord` nodes that are `INSTANCE_OF` that anomaly type to answer the "has this happened before" part. This is a deliberate multi-step traversal that flat vector search doesn't naturally express.

This is exactly the kind of query your evaluation query set should include a few of, specifically to give GraphRAG a fair chance to show its advantage (see `04-rag-comparison-framework.md`).

## 5. Graph construction approach

Two options, and you can reasonably do a hybrid:

1. **Manual/semi-manual construction** — given the corpus is small (a handful of SOPs, manuals, anomaly logs), hand-authoring the node/edge schema instances is feasible within FYP scope and guarantees correctness (no extraction errors). Recommended primary approach given your timeline.
2. **LLM-assisted extraction** — use the local SLM/LLM to read each document and propose node/edge triples, which are then reviewed/corrected. This is more "impressive" for a report but adds an extra failure mode (extraction hallucination) that would need its own precision check — treat as a stretch goal, not a dependency.

## 6. Storage engine options

| Option | Pros | Cons |
|---|---|---|
| **NetworkX** (in-memory Python graph) | Zero setup, no server, trivial to query/traverse in Python, plenty for this corpus size | No persistence out of the box (serialize to disk manually via pickle/JSON), not built for concurrent access |
| **Kùzu** (embedded graph DB) | Real Cypher-like query language, embedded (no server), fast for small-medium graphs | Extra dependency, less common — expect some Sprint-3-equivalent learning curve |
| **SQLite with graph-shaped tables** (nodes table + edges table) | Reuses your existing SQLite infrastructure, keeps a unified storage story | You're hand-rolling traversal logic in SQL/Python instead of using a graph query language |

**Recommendation for FYP scope:** start with NetworkX for simplicity and fast iteration; if time allows, evaluate Kùzu as the "more production-grade" alternative for the write-up, since a fair comparison of storage backends (echoing the ChromaDB vs Turso comparison in Track 1) would strengthen the evaluation chapter.

## 7. Tool signatures

```python
def graph_lookup(entity: str, entity_type: str | None = None) -> list[GraphNode]:
    """Find nodes matching an entity name/type (e.g. 'T-101', 'Sensor')."""

def graph_traverse(start_node_id: str, relationship: str, max_hops: int = 2) -> Subgraph:
    """Traverse outward from a node along a given relationship type, up to max_hops."""

def graph_query_natural(query: str) -> Subgraph:
    """Fallback: embed query, do a vector search over node/edge text descriptions
    to find entry points into the graph when the query doesn't name an entity directly."""
```

The agent's control loop calls these tools iteratively (not just once) based on the SLM's own assessment of whether it has enough information — this is the core architectural difference from Track 1.

## 8. Agent loop pseudocode

```
def answer_graphrag(query, max_hops=3):
    subgraph = Subgraph.empty()
    entities = extract_entities(query)          # SLM call or simple NER/regex
    for entity in entities:
        subgraph += graph_lookup(entity)

    hop = 0
    while hop < max_hops:
        sufficiency = assess_sufficiency(subgraph, query)  # heuristic or SLM self-check
        if sufficiency.is_enough:
            break
        next_relationship = decide_next_traversal(subgraph, query)  # SLM decides
        subgraph += graph_traverse(subgraph.frontier_nodes(), next_relationship)
        hop += 1

    if subgraph.is_empty():
        subgraph += graph_query_natural(query)   # fallback path

    return synthesize_answer(query, subgraph)    # SLM call, grounded only in subgraph
```

## 9. Strengths

- Explicit relationship modeling enables genuine multi-hop reasoning.
- Transparent traversal path — you can log exactly which nodes/edges were visited, which makes the "source citation" feature in the UI even richer (show the actual reasoning path, not just a chunk).
- Graph structure is inherently a form of built-in fact-checking: if a relationship doesn't exist in the graph, the agent can correctly say "I don't have information connecting these."

## 10. Weaknesses / risks (report honestly — this is expected in a comparison study)

- **More engineering overhead** — schema design, graph construction, and multi-step agent loop are all extra work compared to Track 1.
- **Higher latency** — multiple tool calls and possibly multiple SLM calls (for sufficiency-checking and next-step decisions) per query, directly working against your <3s latency target. This should be measured and reported honestly, not hidden.
- **Graph coverage gaps** — if a relevant relationship wasn't hand-authored into the graph, GraphRAG can fail *silently* in a different way than vector RAG does (it simply won't find a path, vs. vector RAG retrieving a semantically-close-but-wrong chunk). Worth an explicit failure-mode discussion in your report.
- **Small-model reasoning limits** — the "decide next traversal" and "assess sufficiency" steps ask the SLM to do meta-reasoning, which is exactly the kind of task smaller models (sub-2B) tend to struggle with per your own SLR (Lu et al., 2025, on long-context/complex reasoning limits of SLMs). This is itself a legitimate finding to report — e.g. "GraphRAG's benefit only materializes with the 8B-tier local LLM, not the sub-2B SLM tier."

## 11. What this track needs from you before FYP2 build-out

- [ ] Finalize the node/edge schema against your actual SOP/manual corpus (the schema above is a template — adjust field names to match your real documents)
- [ ] Decide manual vs. LLM-assisted graph construction
- [ ] Pick storage engine (NetworkX recommended to start)
- [ ] Design the "sufficiency check" — simplest version: does the subgraph contain at least one node of each entity type mentioned in the query
- [ ] Cap max_hops and add a timeout guard so a failing traversal can't blow past your latency budget indefinitely
