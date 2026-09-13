# Daedalus Documentation

Everything about this project lives in this folder. Start with
**[`PROJECT.md`](PROJECT.md)** — it is the canonical specification and it wins
over anything else here.

---

## Start here

| I want to… | Read |
|---|---|
| Understand the whole project | [`PROJECT.md`](PROJECT.md) |
| Know what's actually built right now | [`FEATURES.md`](FEATURES.md) |
| See what's next | [`../TODO.md`](../TODO.md) |
| Run it | [`../README.md`](../README.md) |

## Precedence — read this before trusting any file

These documents were written at different times for different purposes. When
two disagree, resolve in this order:

1. **[`PROJECT.md`](PROJECT.md)** — canonical. Reconciles the two historical
   sets and records every conflict and its resolution (§2.2).
2. **[`FEATURES.md`](FEATURES.md)** — canonical for *implementation detail*:
   the API surface, data-store contracts, theme engine, CSS utilities.
   Describes what exists; `PROJECT.md` describes what is intended.
3. **[`architecture/`](architecture/)** and **[`research/`](research/)** —
   historical. Still useful for depth, but **superseded wherever they conflict
   with `PROJECT.md`**.

> The two historical sets are kept because each is strong where the other is
> thin: `research/` carries the academic framing and evaluation rigour,
> `architecture/` carries the implementation-ready schemas and I/O contracts.
> Neither is wrong; both are incomplete on their own.

---

## `research/` — FYP1 research specifications

The interim-report-aligned view. Strongest on **why** the project is shaped the
way it is: the dual-track RAG comparison, the evaluation methodology, the
hardware-fit tooling.

| File | Covers |
|---|---|
| [`00-project-overview.md`](research/00-project-overview.md) | Problem statement, the three research pillars, feature list, scope |
| [`01-system-architecture.md`](research/01-system-architecture.md) | 4-zone model, safety boundary, concurrency, dual-track routing |
| [`02-traditional-rag-spec.md`](research/02-traditional-rag-spec.md) | Track 1 — vector RAG pipeline, chunking, embedding, retrieval |
| [`03-agentic-graphrag-spec.md`](research/03-agentic-graphrag-spec.md) | Track 2 — knowledge graph schema, agent loop, storage options |
| [`04-rag-comparison-framework.md`](research/04-rag-comparison-framework.md) | How the two tracks get compared fairly — controls, query set, metrics |
| [`05-model-hardware-fit-tool.md`](research/05-model-hardware-fit-tool.md) | llmfit-inspired hardware profiler and model scoring |
| [`06-data-schema.md`](research/06-data-schema.md) | Sensor schema, query patterns, ownership boundary |
| [`07-tech-stack-and-tools.md`](research/07-tech-stack-and-tools.md) | Stack choices and, usefully, what was rejected and why |

**Known staleness:** these files say a web frontend is out of scope. That is no
longer true — see `PROJECT.md` §2.2 conflict #1.

## `architecture/` — 11-layer implementation specifications

The "Project Daedalus v2" view. Strongest on **how**: schemas, tool I/O
contracts, orchestration steps, log tables, examiner phrasings.

**Always start with [`00-design-rules.md`](architecture/00-design-rules.md)** —
the five non-negotiable constraints every other layer must respect.

| Layer | File | Covers |
|---|---|---|
| — | [`architecture-overview.md`](architecture/architecture-overview.md) | The v2 overview: 11 layers, 4 zones, device-agnostic ambitions |
| — | [`00-design-rules.md`](architecture/00-design-rules.md) | **The five non-negotiable rules.** Read first |
| 1 | [`01-physical-reactor-layer.md`](architecture/01-physical-reactor-layer.md) | Reactor hardware, sensors, the write-only ABV problem |
| 2 | [`02-scada-layer.md`](architecture/02-scada-layer.md) | SCADA acquisition, Supabase vs local SQLite |
| 3 | [`03-sqlite-data-layer.md`](architecture/03-sqlite-data-layer.md) | Sensor schema, read-only rules, validation |
| 4 | [`04-rag-ingestion-layer.md`](architecture/04-rag-ingestion-layer.md) | Document sources, chunking, metadata, embeddings |
| 5 | [`05-vector-retrieval-layer.md`](architecture/05-vector-retrieval-layer.md) | ChromaDB, advanced RAG techniques, DB benchmark framework |
| 6 | [`06-model-provider-layer.md`](architecture/06-model-provider-layer.md) | Ollama config, model tiers, quantization, AirLLM positioning |
| 7 | [`07-orchestration-layer.md`](architecture/07-orchestration-layer.md) | The 11-step flow, intents, safety guard, evidence pack |
| 8 | [`08-tool-layer.md`](architecture/08-tool-layer.md) | All four tools with full input/output JSON schemas |
| 9 | [`09-presentation-layer.md`](architecture/09-presentation-layer.md) | Chat UI responsibilities and hard constraints |
| 10 | [`10-observability-layer.md`](architecture/10-observability-layer.md) | Log table schemas, query_id tracing, evaluation harness |
| 11 | [`11-admin-utility-layer.md`](architecture/11-admin-utility-layer.md) | Model Selector Console spec, MVP vs optional |
| — | [`12-query-flow-and-examples.md`](architecture/12-query-flow-and-examples.md) | Six worked query examples, end to end |
| — | [`13-deployment.md`](architecture/13-deployment.md) | Folder structure, Docker Compose, diagrams |
| — | [`14-examiner-statements.md`](architecture/14-examiner-statements.md) | Examiner-safe phrasings and anti-patterns |

**Known staleness:** `architecture-overview.md` proposes GraphRAG *instead of*
vector RAG and a device-agnostic core. Both are overruled — see `PROJECT.md`
§2.2 conflicts #2 and #3.

---

## Feeding this to an AI

Context windows are finite; don't paste the whole folder.

| Task | Give it |
|---|---|
| Anything at all | `PROJECT.md` (start here, always) |
| Changing existing code | `PROJECT.md` + `FEATURES.md` |
| Building a new layer | `PROJECT.md` + `architecture/00-design-rules.md` + that layer's file |
| Database work | `PROJECT.md` §6 + `architecture/03-sqlite-data-layer.md` |
| The tool layer | `architecture/00-design-rules.md` + `architecture/08-tool-layer.md` |
| RAG / retrieval | `research/02` + `research/03` + `architecture/05` |
| Evaluation | `research/04` + `architecture/10` |
| Report or viva prep | `research/00` + `architecture/14` |

Two rules worth passing along with the files:

1. `PROJECT.md` wins over `architecture/` and `research/`.
2. `architecture/00-design-rules.md` constrains every layer — no exceptions.
