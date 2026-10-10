# Report Notes — material for writing the FYP2 report

What the FYP2 report needs that the other documents do not carry, plus a map of
where everything else already lives. It replaces the FYP1 spec sets
(`docs/research/`, `docs/architecture/`), retired on 2026-10-10: their still-true
content is in [`PROJECT.md`](PROJECT.md), and the framing only they carried is
below. The originals remain in git history.

---

## 1. Where each report chapter draws from

| Chapter | Source |
|---|---|
| Abstract | `PROJECT.md` §14 — the abstract paragraph |
| Introduction — problem, objectives, scope | `PROJECT.md` §1 and §13; §3 below for the FYP1 framing |
| Literature review | §4 below — the anchors the FYP1 specs cited, and the prior art |
| Methodology — architecture | `PROJECT.md` §3 (five rules), §4 (zones, layers), §6 (stores), §7 (orchestration, tools); figures in §7 below |
| Methodology — the two tracks | `PROJECT.md` §5; [`MODULES.md`](MODULES.md) §3 (Blueprints) |
| Methodology — model selection | `PROJECT.md` §8; [`MODEL_FIT.md`](MODEL_FIT.md); [`BENCHMARK.md`](BENCHMARK.md) |
| Methodology — evaluation design | `PROJECT.md` §5 *Comparison protocol* and §9; [`EVALUATION.md`](EVALUATION.md) |
| Implementation | [`FEATURES.md`](FEATURES.md); [`CODE_MAP.md`](CODE_MAP.md) for which files make each feature |
| Results | The evaluation run's `report.md` and `results.csv` (`data/eval/…`); [`STATUS.md`](STATUS.md) §5 for the early, single-run latency figures (not citable as results) |
| Discussion — failure modes | `PROJECT.md` §5 *Honest risks* and *Auditing each arm*; the run's failure list |
| Changes from the proposal | [`STATUS.md`](STATUS.md) §6, and `PROJECT.md` §2.2 for how each FYP1 conflict was resolved |
| Viva / examiner phrasing | `PROJECT.md` §14 |
| Screenshots | [`STATUS.md`](STATUS.md) §3.16 — the checklist |

---

## 2. Project identity

| | |
|---|---|
| FYP title | Conversational Agentic AI for Real-Time CO₂ Sorption Reactor Monitoring |
| System name | Daedalus — a standalone chat application over the reactor's data |
| Author | Sharvin A/L Kanesan (22006930) |
| Programme | Bachelor of Computer Science (Hons), Universiti Teknologi PETRONAS |
| Supervisor | Ts. Dr. Yew Kwang Hooi |
| Examiner | Ts. Dr. Shuhaida Mohamed Shuhandi |
| Status | FYP1 complete (architecture, SLR, data validation); FYP2 implementation built, evaluation pending |

---

## 3. The FYP1 framing

**Who it is for.** Reading the reactor today means reading raw sensor graphs,
knowing SCADA and operating-mode jargon (Manual / Absorption / Desorption), and
cross-referencing separate SOPs and logs by hand. That shuts out the
non-specialists the interim report named: CS students, business students and
new safety engineers.

**Three pillars**, as the interim report set them out:

1. **A dual-track retrieval comparison** — traditional vector RAG against
   agentic GraphRAG on one query set with one model. This is what turns the
   project from "one chatbot" into a comparative empirical study, and it
   answers the SLR's gap: no existing study compares vector retrieval with
   graph-based retrieval for an offline, local industrial deployment.
2. **Hardware-aware model selection** — operationalises **Objective 3** (SLM
   suitability): measure which quantized models the machine at hand can run before
   committing to benchmarking.
3. **Safety by construction** — the read-only boundary and the
   no-invented-numbers rule enforced below the prompt.

**The reactor**, as documented in FYP1 (interim report Table 4):

| Tag | Measures | Unit |
|---|---|---|
| T-101 | Temperature | °C |
| P-101 | Pressure | barg |
| pH-101 | pH | — |
| LV-101 / LV-102 | Level | % |
| NDIR | CO₂ concentration | ppm |
| ABVs | Automated ball valves — **write-only** from SCADA | — |

SCADA (CO2SorptionDT, PyQt5) writes a row every 5 s — about 17,000 rows per
24-hour run, small enough for SQLite with no rollup tables. The ABVs are why
the AI layer is read-only: no downstream system can verify their real state, so
a hallucinated write could actuate hardware. If the wider team stores telemetry
in Supabase, that copy sits **outside** the AI trust boundary; Daedalus reads
only the local SQLite file.

**Success targets** (interim report Table 6/7): under 3 s end-to-end latency,
over 80% retrieval precision@5, under 10% hallucination rate.

---

## 4. Literature and prior art

Anchors the FYP1 specs tied the design to — cite from the SLR:

| Reference | Used for |
|---|---|
| Rayfield et al. (2025) — ReAct meets industrial IoT | Track 2's agent loop is the ReAct pattern applied to a knowledge graph rather than raw API calls |
| Lu et al. (2025) — long-context and complex-reasoning limits of small language models | The expected weakness of Track 2's meta-reasoning steps ("is this enough?", "where next?") on sub-2B models — now an observed one (qwen3:1.7b, `PROJECT.md` §5) |
| The SLR's research gap | No unified evaluation of a local retrieval stack; no vector-vs-graph comparison for offline industrial use |
| Contextual query rewriting / condensation | Follow-up questions are rewritten to stand alone before classification (`PROJECT.md` §7.4) — a documented technique, so it cites cleanly |

**Prior art for the hardware-fit tool** — cite as related work:

| Tool | What it is | Relationship |
|---|---|---|
| [llmfit](https://github.com/AlexsJones/llmfit) | Rust CLI/TUI scoring hundreds of models across runtimes on memory fit, speed, quality and context | Primary inspiration. The Forge is a purpose-built version of the same idea, scoped to the shortlisted candidates and to RAG-sized prompts |
| LLM Checker | Node.js CLI that runs models through Ollama to benchmark rather than estimate | Named in the interim report; a cross-check for The Forge's estimates (`TODO.md` M9) |
| AirLLM | Layer-streaming to run very large models in limited VRAM | Feasibility reference only — production uses fully resident quantized models |
| Odysseus (PewDiePie) | Self-hosted assistant whose theme, settings and preference designs were studied | Design reference, no code — see [`../ACKNOWLEDGMENTS.md`](../ACKNOWLEDGMENTS.md) |

The case for building rather than only using these: it is a demonstrable
artefact of the project's own engineering, and it is scoped to the actual
candidate models and the actual RAG context sizes, which a general tool is not.

---

## 5. Technology choices and what was rejected

Worth a paragraph in the tools-justification section. Every choice is held
against Rule 1 (local) and Rule 2 (read-only).

| Layer | Chosen | Rejected or dropped | Why |
|---|---|---|---|
| Sensor data | SQLite, opened `mode=ro` | — | Already what SCADA writes; serverless, offline |
| Model runtime | Ollama | Cloud LLM APIs | Rule 1. Cloud models stay benchmark baselines, recorded separately |
| Vector store | ChromaDB, embedded | FAISS | No metadata filtering built in; more plumbing for the same result |
| | | Turso / libSQL, sqlite-vec, LanceDB | A planned six-way bake-off, cut 2026-10-01 for time — future work (§8) |
| | | Pinecone, MongoDB Atlas | Cloud-managed — Rule 1 |
| | | Chroma as a server | Removed with the container stack; one embedded client is simpler |
| Graph store | NetworkX over a git-tracked YAML file | Neo4j | Needs a server process — against the embedded, zero-infrastructure design |
| | | Kùzu | Deferred to Phase 2; NetworkX is ample at this size |
| Tool contracts | Daedalus' own typed registry | PydanticAI | The registry's declarations already generate the schema and are enforced at dispatch |
| Frontend | React + Vite + TanStack Router web dashboard | PyQt5 tab | The web app exists and proves the backend is decoupled; the tab moved to Phase 2 |
| Log viewer | Ariadne's Thread, in the dashboard | Streamlit | One app; it doubles as the evaluation's labelling tool |
| Metrics | The audit log, read directly | Prometheus / Grafana | Overkill for one machine |
| Deployment | Host processes + `daedalus.sh` | Docker Compose | Bought nothing on a single-user machine; gigabytes of memory under WSL |
| Embeddings | Local model via Ollama, chosen per machine | Hosted embedding APIs | Rule 1 — embedding the corpus would send every document out |

---

## 6. Hypotheses, and how to report them

The stratified hypotheses are in `PROJECT.md` §5 (multi-hop causal is the one
GraphRAG is expected to win). Three framing points the FYP1 specs made and the
report should keep:

- **A null result is a result.** If Track 1 matches Track 2 at a fraction of
  the latency, that says the graph's added complexity is not justified at this
  problem size — arguably the more interesting finding. Design to find out, not
  to make GraphRAG win.
- **Name the cuts.** Track 1 is a plain baseline with cross-encoder re-ranking
  by decision; the four advanced techniques were scoped out, not forgotten.
- **Two different failure modes.** A graph fails by omission — enumerable, and
  shown in Coverage. A vector index fails by a confident wrong match, which
  cannot be enumerated. The two arms are not equally auditable in principle.

---

## 7. Figures

**Data flows** — four diagrams the architecture chapter needs:

```
1 Sensor     physical sensors → SCADA → local SQLite (read-only to Daedalus)
             → get_live_reading / get_trend → evidence pack → local SLM → answer

2 Knowledge  manuals / SOPs → extract → clean → chunk + metadata
             → local embedding model → ChromaDB → search_corpus → evidence pack
             (Track 2: authored graph YAML → NetworkX → graph_walk / graph_agent)

3 Query      question → POST /api/chat → condense → classify → safety guard
             → plan tools → evidence → prompt → Ollama → validator
             → answer + citations (SSE)

4 Audit      every step → one query_id → ai_logs.db (7 tables)
             → Ariadne's Thread, evaluation harness, exported judge.jsonl
```

**Boundary statements** to place on the layered diagram:

| Layer | Statement |
|---|---|
| Physical | "The physical layer is existing lab equipment and is not modified by this FYP." |
| SCADA | "The data acquisition layer is read by the AI layer, but the AI layer does not write to SCADA or sensors." |
| Sensor data | "The AI layer accesses the sensor database in read-only mode via parameterised SQL queries." |
| Ingestion | "Knowledge ingestion is performed fully offline. No document is sent to any cloud service." |
| Retrieval | "The retrieval layer is fully local and stores only embedded domain knowledge, not control commands." |

Never draw: an LLM → SQL arrow, an AI → SCADA arrow, a log viewer → reactor
arrow, or a cloud service inside the runtime boundary (`PROJECT.md` §13).

**Worked examples** — one row per intent, for a figure or a table:

| Intent | Question | Flow | Answer shape |
|---|---|---|---|
| `live_status` | "What is the current temperature?" | `get_live_reading(temperature)` | "28.0 °C" `[S1]` |
| `trend_query` | "Average CO₂ over the past hour?" | `get_trend(co2_ppm, average, last hour)` | "452.7 ppm" `[S1]` |
| `sop_query` | "What should I do if the NDIR reading drifts?" | selected track's retrieval | Steps from the SOP `[D1]` or `[G1]` |
| `mixed_query` | "Why did the CO₂ reading spike at 10:00?" | `get_trend` + retrieval | Reading and procedure, **no** unsupported cause |
| `unsafe_control` | "Open valve ABV-1." | Guard blocks — no tool, no model | "I cannot control the reactor…" |
| `out_of_scope` | "Send an email." | No tools | A refusal |

The demo values above are synthetic — say so in any caption.

---

## 8. Future work (Phase 2)

- **PyQt5 tab** inside CO2SorptionDT, as a second client of `/api/chat`.
- **Vector-DB bake-off.** ChromaDB, sqlite-vec, libSQL, Turso (local only),
  FAISS and LanceDB behind one adapter, on a fixed pre-embedded corpus, so the
  comparison is of databases rather than chunking. Hard gates first (offline,
  persistence), then a weighted score: retrieval precision/recall 30%, p95
  latency 20%, offline guarantee 15%, integration effort 10%, metadata
  filtering 8%, disk 7%, maturity 5%, re-index effort 5%.
- **Track 1's advanced techniques** — query expansion, hybrid BM25, contextual
  compression, multi-hop — as an ablation over the frozen baseline.
- **Multi-device** `device_profiles` with per-device tools (the sensor table
  already carries a defaulted `device_id`), a Kùzu graph backend, and LAN /
  multi-lab deployment.
- **Local voice input** (Whisper in the backend, not the browser's
  speech API, which sends audio to Google).

---

## 9. Reproducibility notes for the methodology

- **Pin model tags** (`qwen3:1.7b-q4_K_M`, not `qwen3`): Ollama's default tags
  move between quantizations over time, and `model_logs` records the tag each
  call ran on.
- **Test offline once** before the official run — inference with networking
  disabled — rather than assuming the local-only claim holds (`TODO.md` M4).
- **Freeze, then run once.** `rag_config.frozen` locks every setting the
  comparison depends on, and the harness refuses an official run without it.
- **Report latency honestly**: the benchmark's method and what it does not
  claim are in [`BENCHMARK.md`](BENCHMARK.md) §9.
