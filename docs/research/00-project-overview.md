# CO2SorptionDT Conversational Agentic AI — Project Overview

**Project title:** Conversational Agentic AI for Real-Time CO₂ Sorption Reactor Monitoring
**Author:** Sharvin A/L Kanesan (22006930)
**Programme:** Bachelor of Computer Science (Hons), Universiti Teknologi PETRONAS
**Supervisor:** Ts. Dr. Yew Kwang Hooi
**Examiner:** Ts. Dr. Shuhaida Mohamed Shuhandi
**Status:** FYP1 complete (architecture, SLR, data validation), FYP2 in progress (implementation + evaluation)

This file is the entry point for context. Companion files go deeper on each subsystem:

| File | Covers |
|---|---|
| `01-system-architecture.md` | 4-zone architecture, data flow, safety boundary |
| `02-traditional-rag-spec.md` | The baseline/traditional RAG pipeline design |
| `03-agentic-graphrag-spec.md` | The agentic GraphRAG pipeline design (comparison arm) |
| `04-rag-comparison-framework.md` | How the two RAG approaches will be evaluated against each other |
| `05-model-hardware-fit-tool.md` | The llmfit-inspired hardware/model fit-checking module |
| `06-data-schema.md` | SQLite sensor schema, sample data, query patterns |
| `07-tech-stack-and-tools.md` | Full technology stack, justifications, alternatives considered |

---

## 1. The problem, in one paragraph

CO2SorptionDT is an existing PyQt5 SCADA desktop application that monitors a lab-scale CO₂ sorption reactor — logging temperature, pressure, pH, level, and NDIR CO₂ concentration to a local SQLite database in real time. To understand what the reactor is doing, a person currently has to read raw sensor graphs, know SCADA/reactor-operating-mode jargon (Manual/Absorption/Desorption), and manually cross-reference separate SOP documents and anomaly logs. This is slow, error-prone, and excludes non-specialist stakeholders (CS students, business students, new safety engineers) from being able to reason about the reactor's state.

## 2. What this project builds

A **conversational AI layer** that sits on top of (not replacing) CO2SorptionDT, letting anyone ask plain-language questions like:

- "Is the reactor running fine right now?"
- "Why did the CO₂ reading spike at 10:00?"
- "What's the average temperature over the past hour?"
- "What do I do if the NDIR reading drifts?"
- "Was there an anomaly this morning?"

...and get back a grounded, correct, natural-language answer — **without the AI ever hallucinating a sensor value**, because it never generates numbers itself. It only narrates numbers that were deterministically fetched from the database.

## 3. The two-pronged research angle (why this project is more than "add a chatbot")

This project deliberately builds and compares **two different retrieval architectures** side by side, rather than committing to one:

1. **Traditional RAG** — a straightforward embed-chunk-retrieve-generate pipeline over SOPs/manuals/anomaly logs, paired with deterministic SQL-style tools for live/historical sensor data. This is the baseline described in the interim report (ChromaDB + flat vector similarity search).
2. **Agentic GraphRAG** — a knowledge-graph-based retrieval system where entities (sensors, thresholds, operating modes, anomaly types, SOP steps, causal relationships) are represented as nodes/edges, and an agent traverses/queries the graph plus performs multi-step reasoning (tool calls, self-critique, iterative retrieval) rather than a single-shot vector lookup.

Both pipelines answer the same evaluation query set, and are benchmarked head-to-head on **groundedness, retrieval relevance, latency, and multi-hop question handling** (GraphRAG's theoretical advantage — e.g. "what SOP applies when both pressure AND temperature are anomalous, and what's the historical precedent?").

This turns the FYP from "one chatbot" into a **comparative empirical study**, which is a stronger contribution for the final report and matches the SLR's identified research gap around unified local retrieval-stack evaluation.

## 4. The third pillar: local model/hardware fit-checking

Because everything must run **100% offline on lab hardware** (no cloud LLM APIs in production), a key sub-deliverable is a tool — inspired by [llmfit](https://github.com/AlexsJones/llmfit) — that:

- Detects the host machine's RAM, CPU, GPU/VRAM, and backend (Ollama/llama.cpp/etc.)
- Scores candidate SLMs/LLMs across memory fit, estimated speed, quality, and context-length dimensions
- Recommends which quantized models (Qwen3, Phi-3, Gemma 3, Llama 3.1, Mistral) will actually run acceptably on the lab machine **before** committing to full-scale benchmarking
- Optionally runs a lightweight real benchmark pass (tok/s, time-to-first-token) to replace estimates with measured numbers

This directly operationalizes Objective 3 (SLM suitability evaluation) and gives the project a repeatable, evidence-based way to justify model selection instead of picking a model by guesswork.

## 5. High-level feature list

### Core conversational features
- [ ] Natural language chat panel embedded as a PyQt5 tab inside CO2SorptionDT
- [ ] Live sensor query ("what's the current temperature?")
- [ ] Historical/trend query ("average pressure over the last hour")
- [ ] Anomaly query ("was there an anomaly this morning?")
- [ ] Troubleshooting/SOP query ("what do I do if X drifts?")
- [ ] Source/citation display in the chat UI (which tool or document backed this answer)
- [ ] Conversation history (scrollable, session-based)

### Retrieval architecture (dual-track, for comparison)
- [ ] Traditional RAG pipeline (ChromaDB, flat chunk retrieval)
- [ ] Agentic GraphRAG pipeline (knowledge graph + multi-step agent reasoning)
- [ ] Shared evaluation harness so both pipelines can be scored on identical query sets

### Deterministic data-access layer (shared by both RAG tracks)
- [ ] `get_live_reading()` — latest sensor row
- [ ] `get_trend()` — aggregation/trend over a time window
- [ ] `get_anomaly_status()` — anomaly flag lookup
- [ ] `rag_retrieve()` (traditional) / `graph_query()` (agentic) — document/knowledge retrieval
- [ ] Read-only enforcement at the database connection level (no write path from AI layer, ever)

### Model & hardware fit tooling
- [ ] Hardware detection (RAM/CPU/GPU/VRAM)
- [ ] Model catalog scoring (fit, speed, quality, context)
- [ ] Recommendation output (CLI/JSON) for which local models to benchmark
- [ ] Optional real benchmark pass (tok/s, latency) once Ollama is running

### Evaluation & benchmarking
- [ ] Response groundedness measurement (hallucination rate) — target <10%
- [ ] Retrieval relevance (precision/recall) — target >80% precision
- [ ] Latency per query — target <3s
- [ ] Traditional RAG vs Agentic GraphRAG comparison report
- [ ] Qualitative expert/user evaluation panel (chemical engineering students + faculty)

## 6. What's explicitly out of scope

- Cloud LLM integration in production (OpenAI/Anthropic/etc. — benchmark-only reference ceiling)
- Any write path from the AI layer to the reactor, SCADA, or actuators (ABVs)
- Cybersecurity/IIoT hardening (network security, prompt-injection mitigation, encryption)
- Standalone web front-end (deferred to a future Phase 2 / Next.js)
- Automated chart generation (existing SCADA visualisation handles this)
- Physical hardware modification

## 7. Key non-negotiable design principle

> **The language model never computes or invents numbers. It only phrases numbers and facts that were already deterministically retrieved.**

Every feature file below should be read with this constraint in mind — it governs the tool-calling design in both the traditional RAG and GraphRAG tracks, and it's the safety/reliability argument that differentiates this project from directly prompting an LLM with raw sensor data.
