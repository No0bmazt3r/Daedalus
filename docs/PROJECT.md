# Project Daedalus — Canonical Project Specification

> **This file is the single source of truth.** It reconciles the two older
> specification sets (`docs/` and `context/`) into one coherent description of
> what Daedalus is, what it must never do, and what is actually built so far.
> When any other document disagrees with this one, **this one wins**.

---

## 0. Document map & precedence

| Source | What it is | Status |
|---|---|---|
| **`PROJECT.md`** (this file) | Reconciled canonical spec | **Authoritative** |
| [`FEATURES.md`](FEATURES.md) | What is actually built: API surface, store contracts, theme engine | **Authoritative for implementation detail** |
| [`research/00–07`](research/) | FYP1 / interim-report-aligned specs. Strong on the *research* framing: dual-track RAG comparison, hardware-fit tooling, evaluation rigour | Historical + still-valid research design |
| [`architecture/00–14`](architecture/) | "Project Daedalus v2" 11-layer implementation specs. Strong on *engineering* detail: tool I/O schemas, log tables, orchestration steps, examiner phrasings | Historical + still-valid implementation detail |

All of the above live in this one `docs/` folder — see [`README.md`](README.md)
for the navigation index and guidance on what to feed an AI for a given task.

Neither older set is wrong — they were written at different times for different
purposes. Section 2 documents exactly where they diverge and which way each
conflict was resolved.

---

## 1. What this project is

**FYP title:** Conversational Agentic AI for Real-Time CO₂ Sorption Reactor Monitoring
**Product name:** Daedalus
**Author:** Sharvin A/L Kanesan (22006930)
**Programme:** BCS (Hons), Universiti Teknologi PETRONAS
**Supervisor:** Ts. Dr. Yew Kwang Hooi · **Examiner:** Ts. Dr. Shuhaida Mohamed Shuhandi
**Status:** FYP1 complete (architecture, SLR, data validation). FYP2 in progress (implementation + evaluation).

### The problem

CO2SorptionDT is an existing PyQt5 SCADA desktop application monitoring a
lab-scale CO₂ sorption reactor, logging temperature, pressure, pH, level and
NDIR CO₂ concentration to a local SQLite database every 5 seconds. To
understand reactor state today, a person must read raw sensor graphs, know
SCADA/mode jargon (Manual/Absorption/Desorption), and manually cross-reference
separate SOP documents and logs. That is slow, error-prone, and shuts
out non-specialists.

### The solution

A **conversational AI layer that sits on top of — never replaces — CO2SorptionDT**,
letting anyone ask plain-language questions:

- "Is the reactor running fine right now?"
- "Why did the CO₂ reading spike at 10:00?"
- "What's the average temperature over the past hour?"
- "What do I do if the NDIR reading drifts?"

…and get a grounded, cited, natural-language answer — **without the model ever
inventing a sensor value**, because it never generates numbers. It only narrates
numbers that deterministic tools already fetched.

### The research contribution

This is not "add a chatbot". Three pillars make it a defensible FYP:

1. **A dual-track retrieval comparison.** Traditional vector RAG and Agentic
   GraphRAG are both built, then benchmarked head-to-head on an identical query
   set with an identical model — isolating the *retrieval architecture* as the
   only variable. (§5)
2. **A hardware-aware model selection methodology.** A purpose-built profiler
   scores candidate quantized SLMs against the actual lab machine before
   committing to benchmarking, replacing guesswork with evidence. (§8)
3. **A safety architecture enforced by construction, not by prompting.** The
   read-only boundary and the no-hallucinated-numbers rule are enforced at the
   driver and tool-registry level, where a prompt injection cannot reach. (§3)

---

## 2. Reconciling `research/` and `architecture/`

### 2.1 Where they already agree — the stable core

These are consistent across both sets and are **settled**; treat them as fixed:

| # | Agreed point |
|---|---|
| 1 | Production runtime is 100% local. Cloud LLMs appear only as offline benchmark/judge references, never in the live path |
| 2 | The AI layer is strictly read-only toward the reactor, SCADA and actuators |
| 3 | The LLM never produces numbers; all numeric evidence comes from deterministic tools |
| 4 | SOP/troubleshooting answers must be retrieval-grounded, and must refuse when nothing relevant is retrieved |
| 5 | FastAPI is the orchestration backend; Ollama is the local model runtime |
| 6 | SQLite holds sensor data (WAL mode, opened read-only by the AI); AI logs live in a **separate** database |
| 7 | The same three core tools: `get_live_reading`, `get_trend`, `rag_retrieve` |
| 8 | Same candidate models and quantization strategy (Q4_K_M-first) |
| 9 | Same success targets: **<3s** end-to-end latency, **>80%** retrieval precision, **<10%** hallucination rate |
| 10 | Setup/admin utilities are not runtime components and must not sit in the query path |
| 11 | Corpus is manuals, SOPs, troubleshooting/incident documents (`anomaly_record`), safety documents (`uauc_record`) and background references; chunked 300–500 tokens with overlap; embedded locally |

### 2.2 Where they conflict — and the resolution

| # | Topic | `research/` says | `architecture/` says | **Resolution** |
|---|---|---|---|---|
| 1 | **Frontend** | PyQt5 tab only; a web frontend is *explicitly out of scope*, "deferred to Phase 2" | Dual: Layer 9A PyQt5 tab **and** Layer 9B standalone React/Vite/TanStack/shadcn dashboard | **Web dashboard is primary.** It is what actually exists today and it proves the backend is decoupled. The PyQt5 tab drops to optional/Phase-2. `research/` is simply out of date here |
| 2 | **Retrieval strategy** | Two tracks, built and compared: vector RAG vs GraphRAG | `architecture-overview.md` says Graph RAG *instead of* vector DBs; but `05-vector-retrieval-layer.md` specifies ChromaDB production **plus** a 6-candidate vector-DB benchmark | **Keep the dual-track comparison** — it is the headline research contribution. The vector-DB bake-off is a *sub-study inside Track 1*, not a competing plan. `architecture-overview.md`'s "instead of" is overruled |
| 3 | **Device scope** | CO₂ reactor only | Device-agnostic `device_profiles` schema, dynamically generated per-device tools, `/device/:id/chat` routing | **Single-device for FYP2.** Multi-device is genuine scope creep against the timeline. Keep the schema *forward-compatible* (a `device_id` column, defaulted) so Phase 2 needs no migration, but build and evaluate one device |
| 4 | **Tool typing** | Plain Python function signatures | PydanticAI-enforced typed tool calling | **Adopt PydanticAI.** Typed tool contracts make Rule 3 structurally enforceable rather than conventional |
| 5 | **Observability** | Not covered at all | Six log tables, `query_id` tracing, Arize Phoenix, Streamlit log viewer | **Adopt `architecture/` wholesale.** `research/` has a genuine gap; there is no conflict to resolve |
| 6 | **Model-fit tooling** | `05-model-hardware-fit-tool.md` — llmfit-inspired CLI | `11-admin-utility-layer.md` — Model Selector Console (Streamlit) | **Same deliverable, two names.** Merge into one "Hardware & Model Console": CLI-first (the safe MVP), optional web UI later |
| 7 | **Evaluation method** | Local manual labelling | Hybrid: local Streamlit + n8n/Google Sheets + LLM-as-a-judge | **Adopt the hybrid**, with the cloud half explicitly fenced as an *offline, post-hoc* workflow over exported logs. It never touches the live runtime |
| 8 | **Sensor table PK** | `timestamp DATETIME PRIMARY KEY` | `id INTEGER PRIMARY KEY AUTOINCREMENT` + `timestamp TEXT` | **ISO-8601 `timestamp TEXT` as PK.** `architecture/03` itself recommends collapsing to a single ISO timestamp. Simpler joins, natural ordering |
| 9 | **Column naming** | `temp_c`, `pressure_barg`, `ph`, `co2_ppm` | `temperature`, `pressure`, `ph`, `co2_ppm`, `mode` | **Unit-suffixed physical columns** (`temp_c`, `pressure_barg`) — self-documenting. The tool layer exposes *friendly* names (`temperature`) and maps them to columns via a whitelist |
| 10 | **Graph store** | NetworkX primary, Kùzu as a stretch comparison | "KuzuDB or NetworkX" | **NetworkX first** (zero setup, fast iteration); Kùzu only if time allows |
| 11 | **Model list drift** | Qwen3, Phi-3, Gemma 3, Llama 3.1, Mistral | `architecture-overview` says Qwen2.5/Llama 3.2; `06` says Qwen3/Phi-3/Gemma 3 | **Use the `06`/`docs` list** (Qwen3 1.7B, Phi-3 Mini 3.8B, Gemma 3 1B for SLM tier). The overview's list is stale |
| 12 | **Naming** | "CO2SorptionDT Conversational Agentic AI" | "Project Daedalus" | **Daedalus** is the system/product name; the FYP title stays the formal academic one |

### 2.3 Open questions still needing your decision

These are genuinely undecided — flagged rather than silently resolved:

- [ ] **Is the PyQt5 tab still a deliverable at all**, or fully replaced by the web dashboard? Affects whether Zone 4 needs two clients.
- [ ] **Is the vector-DB bake-off (6 candidates) still in scope for FYP2**, on top of the dual-track RAG comparison? Two benchmark studies may be more than the timeline allows.
- [ ] **Confirm the lab machine's actual specs** (RAM/GPU) — this gates the entire model-tier decision.

---

## 3. The five non-negotiable rules

Everything below is subordinate to these. They are the safety and integrity
argument of the whole project.

### Rule 1 — Production is 100% local
No cloud APIs in the live runtime.
**Forbidden at runtime:** OpenAI, Anthropic, Gemini, Pinecone, MongoDB Atlas,
hosted embedding APIs, Hugging Face inference, cloud logging/dashboards.
**Allowed:** cloud LLMs strictly as offline evaluation baselines.

**How the boundary is held in code:** cloud credentials *are* configurable —
the evaluation chapter needs reference models — but only as benchmark
endpoints. `model_endpoints.purpose` carries `CHECK (purpose = 'benchmark')`,
so a row describing a cloud model for runtime use cannot be stored, and no
module on the chat path imports the service that reads them. The rule is
structural rather than remembered, exactly like Rule 2's `mode=ro`.

**One narrowing, added deliberately: *recorded* rather than *prevented*.** The
console lets an operator point a single chat turn at an Ollama cloud tag. The
production configuration is unaffected — `model_config.resolve()` only ever
names a local tag, and `auto` ranks installed models on this disk — but the
override exists because comparing the local answer against a hosted one is the
comparison §5 is built to make, and refusing outright pushed that comparison
outside the system, where nothing logged it.

What keeps it defensible is that the choice is never silent, at three layers:

| layer | what it does |
|---|---|
| picker | cloud models sit under **"Evaluation only · not Rule 1 safe"**, and the composer shows a cloud icon before you send |
| transcript | the turn is badged with the tag that answered it |
| `model_logs` | written as `source='chat_cloud'`, never `'chat'`, with `host` recording which machine served it |

So every query that asks about the production path filters `source = 'chat'`
and keeps excluding cloud turns without being rewritten. The claim the report
can make is therefore **"no cloud model serves the production configuration,
and any deviation is recorded and separable"** — which is a stronger, checkable
claim than an unenforced absolute. See [`BENCHMARK.md`](BENCHMARK.md) §8.

### Rule 2 — The AI layer is read-only toward the plant
It may read the sensor SQLite DB and its own knowledge stores. It may **never**
write to SCADA, actuators, ABVs, sensor hardware, or the SCADA ingestion subsystem.

*It may and must write to its own audit/evaluation logs* — those belong to the
AI layer, not the control layer, and do not breach the boundary.

**Why this is structural, not advisory:** the ABVs are a *write-only* path from
SCADA — no downstream system can verify their true physical state. A
hallucinated write could actuate hardware. Making Zone 3 read-only by
construction eliminates the entire risk category instead of relying on prompt
guardrails.

**Enforcement:**
- SQLite opened `file:...?mode=ro` via URI — the driver refuses writes.
- No tool in the registry has a write signature. `set_reading()`,
  `write_valve()`, `delete_reading()` **do not exist**.
- No raw-SQL tool is exposed, so the model cannot compose its own statement.
- A safety guard blocks control-intent queries before any tool runs.

### Rule 3 — Numbers come from tools, never from the model
`SQLite → get_live_reading() → Evidence object → LLM phrases it` ✅
`LLM weights → number` ❌

### Rule 4 — Procedural answers come from retrieval
`SOP document → local embedding → retrieval → LLM summarises` ✅
If nothing relevant is retrieved, the system **says so** rather than guessing.

### Rule 5 — Setup tools are not runtime tools
The hardware profiler, model console, vector-DB benchmark harness and
evaluation harness are administrative. They never sit in the live query path.

---

## 4. Architecture

### 4.1 Four zones

```
┌─ Zone 1 ─ Physical CO₂ Sorption Reactor ───────────── pre-existing ─┐
│  Column · T-101 · P-101 · pH-101 · LV-101/102 · NDIR · ABV valves   │
└────────────────────────────┬────────────────────────────────────────┘
                             │ sensor readings
┌─ Zone 2 ─ SCADA / Data Acquisition ────────────────── pre-existing ─┐
│  CO2SorptionDT · polling · ingestion                                │
│  → writes a row every 5s                                            │
└────────────────────────────┬────────────────────────────────────────┘
                             │ read-only SQL  ◄── THE SAFETY BOUNDARY
┌─ Zone 3 ─ Read-Only AI Layer ──────────────── THIS PROJECT'S WORK ─┐
│  FastAPI orchestrator · PydanticAI tools · Track 1 vector RAG ·     │
│  Track 2 agentic GraphRAG · Ollama SLM · audit logs                 │
└────────────────────────────┬────────────────────────────────────────┘
                             │ grounded answer + citations
┌─ Zone 4 ─ Presentation ─────────────────────────────────────────────┐
│  9B React web dashboard (PRIMARY, built) · 9A PyQt5 tab (optional)  │
└─────────────────────────────────────────────────────────────────────┘
```

### 4.2 Eleven layers

| # | Layer | Zone | Status |
|---|---|---|---|
| 1 | Physical reactor & sensors | 1 | Pre-existing, untouched |
| 2 | SCADA acquisition | 2 | Pre-existing |
| 3 | SQLite sensor data | 3 | **Store built** — read-only accessor + dev seeder |
| 4 | Knowledge ingestion (offline) | Setup | **Built** — upload → extract → chunk → embed → Chroma as one recorded run (Blueprints → Corpus); waiting on the real corpus |
| 5 | Retrieval — vector + graph | 3 | **Wired into chat**, one track at a time — Track 1 top-k over the current index with metadata filtering and cross-encoder re-ranking; Track 2 the agent loop (`graph_agent`) or the fixed walk it is measured against (`graph_walk`). Every result marked this rig or reference. Track 1's hybrid search, query expansion, compression and multi-hop not built |
| 6 | Model provider (Ollama) | 3 | **Built** — client, registry, model config, benchmark, and the serving path behind `POST /api/chat` |
| 7 | FastAPI orchestration | 3 | **Built** — all 11 steps of §7.1: guard, deterministic planning, evidence pack, validator with fallback, background summariser; citations shown in the chat |
| 8 | Deterministic tool layer | 3 | **Built** — the two sensor tools plus both tracks' retrieval, behind the registry's effect, track and argument gates |
| 9A | PyQt5 chat tab | 4 | Deferred / optional |
| 9B | React web dashboard | 4 | **Partially built** — see §11 |
| 10 | Observability & evaluation | Support | **Logging wired** — every chat turn writes conversation, tool, rag and model rows on one `query_id`, with grounded/hallucination flags; evaluation harness not built |
| 11 | Admin utilities | Setup | **Built** — The Forge: all six §8.2 steps, plus model discovery and per-model usage |

---

## 5. Retrieval: the dual-track comparison

Both tracks share Zones 1/2/4 and all deterministic sensor tools. They diverge
**only** on Path B — troubleshooting/SOP/domain-knowledge queries.

### Track 1 — Traditional vector RAG (baseline / control)

ChromaDB, local embeddings, top-k cosine retrieval. Advanced techniques layered
on top (all from `architecture/05`):

| Technique | Purpose | Status |
|---|---|---|
| Metadata-filtered retrieval | Narrow by `source_type`, `reactor_mode`, `document_version` | **Built** (`source_type`) |
| Query expansion | LLM rewrites the query with lab synonyms before searching | Not built |
| Hybrid search | Dense embeddings + BM25 sparse, for exact terminology | Not built |
| Cross-encoder re-ranking | Re-score top-N locally before synthesis | **Built** — on by default, frozen with the track |
| Contextual compression | Strip irrelevant sentences to save context window | Not built |
| Multi-hop | Loop back and re-retrieve if evidence is insufficient | Not built |

### Track 2 — Agentic GraphRAG (comparison arm)

A hand-authored knowledge graph plus a ReAct-style agent loop that traverses it
over multiple hops, self-assessing sufficiency between steps.

**Nodes:** `Sensor`, `OperatingMode`, `Threshold`, `SOPDocument`, `SOPStep`,
`AnomalyType`
**Edges:** `MONITORED_IN`, `HAS_THRESHOLD`, `TRIGGERS`, `RESOLVED_BY`,
`CONTAINS`

**Why it should win on multi-hop.** For *"pressure and temperature both spiked —
what do I do?"*, flat retrieval embeds the whole sentence and hopes one chunk
covers it. The graph instead walks: both `Sensor` nodes → their `Threshold`s →
the `AnomalyType` triggered by both → the `SOPDocument` that `RESOLVED_BY` it →
its `SOPStep`s, answering each half structurally.

**Honest risks to report:** higher latency (works against the <3s target), silent
failure when a relationship was never authored, and meta-reasoning steps
("is this enough?") that sub-2B SLMs may simply be too small to do well. That
last one is itself a legitimate finding — and an observed one: on the
development machine qwen3:1.7b takes 1–7 s per step and often walks to
operating modes when the question needs a procedure.

**Track 2 is embedding-free.** Entry points come from aliases authored on each
node, with a fuzzy fallback — never from vector similarity. If both tracks used
embeddings, the result could not separate "the graph helped" from "the
embeddings helped". Track 1 is pinned to an embedding model; Track 2 to none.

### Track 2's two modes — the within-track comparison

Track 2 retrieves in one of two modes (`rag_config.graph.mode`, Settings →
Knowledge Base → *Agent loop*), frozen with the track:

| Mode | Tool | Who decides the walk |
|---|---|---|
| `agent` (default) | `graph_agent` | The committed **local** model, one hop at a time: shown the question, what it has gathered, and a numbered list of schema-legal moves, it picks a move or stops, and judges after every hop whether it has enough |
| `walk` | `graph_walk` | Nobody — the schema's fixed causal chain: sensor → threshold → anomaly type → SOP → steps |

Both enter the graph the same way, so the only difference is who decides where
to walk. That isolates the *agentic* claim: running the query set once in each
mode says whether the model's choices beat a fixed path, separately from
whether a graph beats vectors at all.

The agent is bounded by a step limit (≤ 4, the schema's longest chain) and a
**hard wall-clock budget** (default 6 s, 1–30 s): each model call runs on a
worker thread and is abandoned at the deadline, so a cold model load cannot hold
the turn. Replies are validated before they are acted on; unusable ones are
rejected and recorded. With no local model the fixed walk runs, recorded as a
fallback. Each walk logs `mode`, `stop_reason`, `model_calls`, `rejected` and a
per-hop sufficiency verdict in `rag_logs.traversal_path`.

### How each arm gets its knowledge

The two tracks are filled by two different pipelines, and both are **setup
surfaces** under Rule 5 — they write, so neither is ever exposed to the model.

| | Track 1 | Track 2 |
|---|---|---|
| Knowledge arrives by | ingesting documents | somebody authoring nodes |
| Surface | Blueprints → Corpus → **Build** | Blueprints → **Build** |
| Source of truth | ChromaDB + `corpus.db` manifest | `config/knowledge_graph.yaml` |
| Log | `ingest_events`, per stage | `graph_edits`, including refusals |

### Knowledge provenance — this rig vs reference

The corpus mixes the lab's own documents with public literature: other
analysers' manuals, other universities' SOPs, other pilot plants' incident
reports. Their **concepts** transfer — foaming, heat-stable salts and NDIR drift
are the same chemistry and physics on any amine rig. Their **specifics** do not —
another plant's setpoints, valve tags and step order can be wrong here.

So every document is `rig` (this lab's own) or `reference` (another
installation's), chosen at upload and defaulting to `reference`: nothing counts
as this rig's unless somebody said so. Graph nodes carry the same `origin`;
`Sensor` and `OperatingMode` are the rig's by definition, every other node is a
reference unless marked. Evidence lines say `[THIS RIG]` or `[REFERENCE: another
installation]`, and prompt rule 9 requires a rig-specific fact supported only by
references to be called general guidance, to be confirmed against the lab's own
procedure. `rag_logs.retrieved_origins` records the split per retrieval, so the
evaluation can report how often answers rested on this rig's documents.

**Evaluation implication:** ground-truth answers for rig-specific questions must
come from `rig` documents. A reference document answering a setpoint question
"correctly" for another plant is not a correct answer here.

### Corpus categories

| `source_type` | Holds |
|---|---|
| `manual` | Instrument and equipment manuals — principles, calibration, maintenance, troubleshooting tables |
| `sop` | Step-by-step procedures — start-up, shutdown, sampling, calibration, cylinder handling |
| `anomaly_record` | Troubleshooting and incident literature — what goes wrong (foaming, degradation, heat-stable salts, corrosion), why, and the fix |
| `uauc_record` | Unsafe Act / Unsafe Condition — SDSs, hazard guidance, PPE, lab safety rules |
| `other` | Background — handbooks, review papers, measurement theory, typical operating ranges |

Category and origin are independent: an SDS can be the lab's own copy (`rig`)
or a supplier's generic one (`reference`).

### Assisted authoring

Track 2's authoring has an **assisted** first step, and its shape matters for the
comparison's validity. A local model reads the *ingested corpus* and proposes
nodes and edges constrained to the schema above; every proposal is canonicalised
against what already exists, dry-run through the real validator, and queued.
Nothing reaches the graph without a person accepting it, and an accept goes
through the same authoring path a hand edit does.

That boundary is load-bearing. `search_graph` claims a stronger provenance than
an ingested PDF precisely because every node was authored and reviews in a diff;
a proposer that wrote directly would retire that claim, and the comparison would
stop being between two retrieval strategies and start being between two guesses.
The web is deliberately not a source — Rule 5 makes web search a surface for
*finding documents to ingest*, and unreviewed external text in the graph breaks
the same claim.

### Auditing each arm

Both arms are inspectable the same way, which is what keeps the comparison about
the strategies rather than about how well each half happened to get instrumented:

| | Track 1 | Track 2 |
|---|---|---|
| inventory | Corpus | Graph |
| gaps | — | Coverage |
| trace | Replay | Replay |

**The missing cell is a finding, not an omission.** A hand-authored graph fails
by *omission*, and omission over a fixed schema is enumerable: an `AnomalyType`
with no `RESOLVED_BY` edge is a question the graph provably cannot answer. A
vector corpus has no such list — it returns its nearest chunks for every query,
including ones it knows nothing about, so its failure is a *bad match* rather
than a missing edge and the passages nobody wrote cannot be enumerated. Worth
stating in the report: the two arms are not equally auditable *in principle*,
and that asymmetry is a property of the approaches.

Both Replays read `rag_logs` and neither re-runs anything. Re-querying to
"replay" would show what the index returns today rather than what produced that
answer, which after any re-ingest is a quietly different claim.

### Comparison protocol

Hold constant: same model, quantization, temperature; same corpus; same query
set; same machine, run sequentially; same hand-labelled ground truth. **Also
held constant by construction:** each arm sees only its own retrieval tools
(§7.2), and both are recorded by one writer at the dispatch boundary.

**Three runs of the same query set:** Track 1; Track 2 in `walk` mode; Track 2 in
`agent` mode. Track 1 vs Track 2 asks whether graph structure beats vector
similarity; `walk` vs `agent` asks whether the model's hop choices beat a fixed
path. Only the selected track's tools run in any answer — the comparison is made
between runs, never inside one.

Stratify the query set (~30–50 queries, 6–10 per category):

| Category | Hypothesis |
|---|---|
| Single-hop factual | Tie |
| Single-hop procedural | Tie |
| **Multi-hop causal** | **GraphRAG wins — the key differentiator** |
| Ambiguous/underspecified | Unknown — which degrades more gracefully? |
| Out-of-corpus (must refuse) | Tests groundedness discipline |

Metrics: groundedness/hallucination rate, retrieval precision & recall, mean and
p95 latency, multi-hop success rate, refusal correctness, hop count — and, for
the agent, its stop reasons and rejected replies, plus for every run the share
of retrieved items that were this rig's documents.

**Sequencing discipline:** build Track 1 → build Track 2 → **freeze both** → run
the evaluation once without further tuning. Tweaking a track after seeing its
results invalidates the comparison.

> A result showing Traditional RAG matching GraphRAG at a fraction of the latency
> is a **valid and arguably more interesting finding**. Design the experiment to
> find the truth, not to make GraphRAG win.

---

## 6. Data model

### 6.1 Sensor readings (written by Zone 2, read-only to us)

```sql
CREATE TABLE sensor_readings (
    timestamp      TEXT PRIMARY KEY,   -- ISO-8601: 2026-01-07T10:00:05
    device_id      TEXT NOT NULL DEFAULT 'co2_reactor_01',  -- Phase-2 forward-compat
    mode           TEXT CHECK(mode IN ('Manual','Absorption','Desorption')),
    temp_c         REAL,   -- T-101
    pressure_barg  REAL,   -- P-101
    ph             REAL,   -- pH-101
    level_pct      REAL,   -- LV-101/102
    co2_ppm        REAL    -- NDIR
);
CREATE INDEX idx_readings_timestamp ON sensor_readings(timestamp);
```

**Volume:** ~17,000 rows/day at 5s sampling — comfortably within SQLite's range
for hourly-mean trend queries with no rollup tables.

### 6.2 Access & concurrency

```python
# Driver-level enforcement — not a convention
conn = sqlite3.connect("file:sensor_readings.db?mode=ro", uri=True)
```
```sql
PRAGMA journal_mode=WAL;      -- one writer + many readers, no blocking
PRAGMA synchronous=NORMAL;
```

Live data is **pulled on demand**, not streamed. A Q&A interface needs no
sub-second push, and polling keeps Zone 3 fully decoupled from Zone 2's cadence.

### 6.3 The five stores

Daedalus owns five physically separate databases. The separation is not
tidiness — it is the safety argument, and it is worth stating explicitly in
the report.

| Store | Engine | Path | AI access | Holds |
|---|---|---|---|---|
| **Sensor** | SQLite | `/data/sqlite/sensor_readings.db` | **read-only** (`mode=ro`) | IoT telemetry written by SCADA |
| **Audit** | SQLite | `/logs/ai_logs.db` | read/write | conversation · tool · rag · model · error · feedback · memory logs |
| **Chat** | SQLite | `/data/sqlite/chat.db` | read/write | conversation sessions and messages — the transcript the user owns |
| **Vector** | ChromaDB + SQLite | `chromadb` service (or `data/chroma`), plus `/data/sqlite/corpus.db` | read/write | embedded manual/SOP/troubleshooting/safety chunks, and the manifest of what was ingested |
| **Prefs** | SQLite | `/app/data/prefs.db` | read/write | UI state, kept out of the browser |

**The Vector store has two halves and is still one store.** Chroma holds the
vectors; `corpus.db` holds the record of what was ingested — documents, chunk
text with its offsets, every pipeline run with the recipe it used, and a
level-tagged event log. It is the same store's own metadata, sitting beside the
Chroma directory the way Chroma's own catalogue sits beside its vectors, and
§6.4's argument is untouched: Daedalus still writes only to its own files and
still cannot reach `sensor_readings`.

Splitting it out of Chroma rather than into it is what makes it migratable,
joinable and browsable. Keeping it out of `audit` is deliberate in the other
direction: deleting a document should take its ingestion history with it, and
that DELETE must never be able to reach the one store whose whole value is that
nothing ever deletes from it. `corpus.db` also carries Track 2's authoring
history (`graph_edits`) and its proposal queue, for the same reason — both are
operational records *about* the knowledge layer rather than the knowledge
itself, which stays in Chroma and in the authored YAML.

In the raw store browser the two halves appear as **Corpus & Authoring**
(`corpus.db` — the record: documents with their category and origin, chunk
text, runs, graph edit history) and **Knowledge Vector Store** (Chroma — the
search index built from that record). Chroma can be rebuilt from `corpus.db` by
re-embedding; the reverse is not true.

Verified: the read-only connection rejects INSERT, UPDATE, DELETE and DROP at
the driver, while reads continue to work.

**Chat and audit are deliberately two files**, though both hold conversation
text, because they have opposite lifecycles. A user renames, archives and
deletes their own chats; audit rows are append-only evidence that a response
was grounded, and §9's evaluation rests on them. Two files make *"deleting a
chat cannot delete the evidence"* a property of the filesystem rather than a
promise about our DELETE statements. `query_id` links them when a trace needs
both.

Each writable store carries a versioned schema — numbered SQL files applied
once, in order, inside a transaction, recorded in the database itself. The
sensor store is deliberately excluded: SCADA owns that schema, and migrating a
database we do not own would breach Rule 2 as surely as an INSERT would.

### 6.4 Store separation (state this explicitly in the report)

```
SCADA ingestion    → writes sensor_readings
Daedalus           → READS it; writes ONLY to its own separate stores:
                     ChromaDB dir, corpus.db, graph file, ai_logs.db,
                     chat.db, prefs.db
```

A bug in our indexing code physically **cannot** corrupt the sensor data of
record, because they are different files.

---

## 7. Orchestration & tools

### 7.1 The 11-step flow (`POST /api/chat`)

1. Receive query
2. Normalise (trim, length-check, detect control keywords)
3. **Classify intent** — `live_status` · `historical_query` · `trend_query` ·
   `sop_query` · `mixed_query` · `unsafe_control` · `out_of_scope`
4. **Safety guard** — control intent returns
   *"I cannot control the reactor. I only provide read-only monitoring information."*
   with **no tool execution and no LLM call**
5. Plan tool calls
6. Execute tools (parameterized, whitelisted)
7. Build the evidence pack
8. Build the prompt (system instruction + safety rules + evidence + query + citation requirement)
9. Call Ollama
10. **Validate the response** — empty? numbers absent from evidence? control language? timeout? → fall back to *"I could not generate a grounded answer from the available data."*
11. Return answer + citations + tools used + latency; log via a background task

### 7.2 Tool contracts

| Tool | Input | Returns |
|---|---|---|
| `get_live_reading` | `sensor`, optional `timestamp` | value, unit, timestamp, mode |
| `get_trend` | `sensor`, `start_time`, `end_time`, `aggregation`, optional `mode_filter` | aggregated value, unit, sample count, optional series (≤100 points) |
| `search_corpus` (Track 1's `rag_retrieve`) | `query`, `top_k`, `source_type` (`manual` · `sop` · `anomaly_record` · `uauc_record` · `other` · `any`) | chunks with text, distance, re-rank score, source file, section, page, **origin** |
| `graph_agent` (Track 2, `agent` mode) | `query`, `limit` | gathered nodes and edges, entry points, and the whole recorded walk — budget and step limit come from `rag_config`, not the caller |
| `graph_walk` (Track 2, `walk` mode) | `query`, `limit` | the same shape, from the fixed path |

Underneath, Track 2 is built from `graph_lookup`, `graph_traverse` and
`graph_query_natural`; the planner calls exactly one retrieval tool per
question — whichever the selected track and mode name.

**The two arms' retrieval tools are mutually exclusive at runtime.** §5 is a
controlled comparison, and an arm that can reach the other arm's retrieval is
not that arm — with Track 1 selected and `search_graph` still on the tool list, a
model that walked the graph would produce an answer filed under
`rag_logs.track='vector'` that a vector-only system could not have produced, and
nothing in the logs would say so. The registry gates on the selected track and
withholds the other set, so the tool list the model receives flips with the
setting.

This is **not** the same kind of rule as the effect gate below. That one is
safety and an operator may unlock an effect with a recorded reason; this one is
experimental validity and has no unlock, because "let this arm use the other
arm's retrieval" is not a permission anybody can grant — it only makes the
measurement mean something else. Tools that belong to neither arm, including
`knowledge_status`, are unaffected: it *reports on* both tracks without
retrieving through either, and it is the check that makes "I don't have that" a
statement rather than a guess.

Every retrieval writes one `rag_logs` row, and it is written at the **dispatch
boundary** rather than inside each tool. The two search tools stay separate
implementations — that is what makes "which track answered this" recoverable —
but recording them separately would let the comparison measure two
instrumentation methods as much as two retrieval strategies. A call with no
`query_id` writes nothing: a tool trialled in Settings is not a query, and a row
for one would land in the evaluation set as though it were.

**Security rules:** whitelisted sensor names (`temperature`, `pressure`, `ph`,
`co2_ppm`, `mode`) and aggregations (`average`, `min`, `max`,
`count`, `latest`, `first`); parameterized SQL only; no write queries; query
timeout and result-size caps; errors that never leak internals.

### 7.3 Worked example — mixed diagnostic

> **"Why did the CO₂ reading spike at 10:00?"**

```
intent: mixed_query
tools:  get_trend(co2_ppm, ~10:00) + rag_retrieve("CO₂ spike troubleshooting")
evidence: CO₂ rose 420 → 980 ppm · SOP says check NDIR calibration and gas flow
answer: "At around 10:00 the CO₂ reading increased sharply from 420 ppm to 980 ppm.
         The SOP suggests checking NDIR calibration and gas flow."
         [SQLite trend] [SOP_NDIR_Calibration.pdf p.4]
```

It must **not** say "the valve failed" — that causal claim has no supporting
evidence. Causal language requires retrieved backing.

### 7.4 Conversation memory

> Neither historical spec set covers multi-turn conversation. This section
> fills that gap. Built: `db/chat_store.py`, `services/chat_service.py`.

Ollama is stateless. "The assistant remembers" only ever means the orchestrator
re-sent the transcript, so the transcript is the memory and it is stored in its
own SQLite database (§6.3). Both halves reduce to that one store: within a
session each turn rebuilds the prompt from those rows; across sessions,
reopening a chat reads the same rows back. Only *how much* is replayed differs.

**The prompt is assembled in four tiers**, rebuilt fresh every turn:

```
system prompt                    (fixed)
rolling summary of folded turns  (regenerated in the background)
recent turns, newest-first       (within a ~1200-token budget)
EVIDENCE pack + current question (the only numbers the model may use)
```

The budget matters because the SLM tier runs at `num_ctx` 4096–8192 and the
evidence pack plus retrieved SOP chunks already claim 1–2k of it. Turns that
do not fit are folded into the rolling summary **after** the response is sent —
summarisation is another inference call, and doing it inline would spend the
latency budget the <3s target is measured against.

#### Replayed history is a Rule 3 hazard

Turn 3 said *"CO₂ is 470.2 ppm."* At turn 9 the model has a number in its
context that it never fetched, that was true twenty minutes ago, and that it
will happily reuse. This is precisely what the <10% hallucination target
measures. Three defences:

1. **Evidence is stored but never replayed.** Citations and tool output render
   in the UI; only natural-language text re-enters the prompt.
2. **Historical assistant turns are timestamped**, and a notice tells the model
   that values in them were true only at the time shown.
3. **Groundedness validation compares against the current evidence pack only.**
   A number appearing only in history sets `hallucination_flag`.

The third is what turns the risk into a measurement; the first two reduce how
often it arises. History exists to resolve *referents* — "it", "that spike",
"the same sensor" — not to supply facts.

#### Follow-ups are condensed before Step 3

*"And what about pressure?"* has no intent and nothing retrievable on its own.
Before intent classification, the last two turns plus the raw query are
rewritten into a standalone question, and everything downstream — classification,
tool planning, both retrieval tracks — runs on the rewritten form.

This is a documented technique (contextual query rewriting / condensation), so
it cites cleanly. **The same rewritten query must go to both tracks**, or the
comparison in §5 stops isolating retrieval architecture as the only variable.

#### Incognito

An `ephemeral` session lives in the same tables, so in-session memory behaves
identically, and is swept at startup and shutdown. Its content is kept out of
`conversation_logs` while latency and `grounded_flag` are still recorded — the
evaluation data survives without storing what was said.

---

## 8. Model provider & hardware fit

### 8.1 Tiers

| Tier | Models | Role |
|---|---|---|
| Production SLM | Qwen3 1.7B · Phi-3 Mini 3.8B · Gemma 3 1B (all Q4_K_M) | Deployed |
| Local LLM | Qwen3 8B · Llama 3.1 8B · Mistral 7B | Accuracy ceiling, higher latency |
| Cloud | GPT-4o Mini · Claude 3.5 Haiku · Gemini Flash | **Offline benchmark reference only — never deployed** |

Selected via `config/model_config.json` — **never hardcoded** in FastAPI.

### 8.2 Hardware & Model Console

Merges `research/05` (llmfit-inspired fit tool) and `architecture/11` (Model Selector
Console) into one deliverable. CLI-first; web UI only if time allows.

1. **Detect** RAM, CPU, GPU/VRAM, disk, Ollama version (`psutil`, `pynvml`)
2. **Estimate** memory per model × quantization:
   `≈ (params_B × bytes_per_param) + kv_cache + ~0.5–1GB runtime`
   (Q4_K_M ≈ 0.5–0.6 B/param · Q8_0 ≈ 1.0 · FP16 ≈ 2.0 — all candidates are
   dense, so no MoE handling is needed)
3. **Score** fit / speed / quality / context → `safe | marginal | will_not_fit`
4. **Manage** Ollama models (list/pull/delete) — local API, so permitted
5. **Benchmark** for real: time-to-first-token, tok/s, and end-to-end latency on
   a *RAG-context-sized* prompt (which matters far more than raw tok/s)
6. **Write** the chosen model to config for FastAPI to consume

> Measured numbers replace estimates in the final report. That directly
> satisfies Objective 3 with evidence rather than projection.

**AirLLM / LLM Checker are feasibility tools only** — referenced as prior art
and used to sanity-check our estimates, never production inference.

---

## 9. Observability & evaluation

### 9.1 Tracing

Every query gets a `query_id` (e.g. `q_20260107_0001`) threading through six log
tables in a **separate** `ai_logs.db`: `conversation_logs`, `tool_logs`,
`rag_logs`, `model_logs`, `error_logs`, `feedback_logs`. JSONL fallbacks for raw
debug. Logging must never block the response — use FastAPI `BackgroundTasks`.

This is how "prove it was grounded" gets answered concretely:

```
query_id q_20260107_0001 · tool get_live_reading · SQLite 470.2 ppm
· LLM said 470.2 ppm · grounded: true
```

**Never log:** passwords, API keys, personal identifiers, env secrets.

### 9.2 Targets

| Metric | Target |
|---|---|
| RAG Precision@5 | > 80% |
| End-to-end latency | < 3s (report mean, p50, p95) |
| Hallucination rate | < 10% |

### 9.3 Hybrid evaluation

- **Method A — local (Streamlit).** Log viewer with an evaluation mode; ratings
  land in local `feedback_logs`. Fully offline.
- **Method B — distributed (n8n + Google Sheets + LLM-as-a-judge).** Exported
  historical logs only, processed asynchronously for statistical scale.

> Method B never touches the live reactor, never runs during operator chat, and
> has no SCADA access. It processes exported logs after the fact. This is the
> one sanctioned place a cloud LLM may appear.

---

## 10. Presentation layer

### 10.1 What the UI must and must not do

**Must:** send queries to the API, show loading state, render responses and
citations, surface errors, prevent duplicate submits, allow history scrolling,
indicate groundedness.

**Must not:** generate answers, query SQLite or the vector store directly, call
Ollama directly, or send control commands. **The UI is purely a client of
`/api/chat`.**

### 10.2 The "glass box" experience

Trust comes from visible reasoning, not a black box:

- **Streaming chat** — token-by-token via SSE
- **Tool-call trace** — collapsible Thought → Action → Observation steps
- **Graph visualiser** — mini node-graph showing how GraphRAG connected a
  sensor to an SOP
- **Source badges** — `[Live DB]` `[Trend]` `[SOP]` `[Manual]` `[Graph]`
- **Hardware/model console** — CPU/RAM/VRAM stats, swap active SLM

---

## 11. Current implementation status

*As of 2026-10-01. `TODO.md` is the item-level record; this is the summary.*

### Built and working

| Area | Detail |
|---|---|
| **Chat** | `POST /api/chat` runs the whole §7.1 flow and streams tokens over SSE; both turns persist, and the answer carries citation chips and a *Sources* list from the stored evidence pack |
| **Orchestration** | All 11 steps: normalise, rewrite follow-ups, classify (7 intents), safety guard, deterministic planning, tool execution, labelled evidence pack, prompt, stream, validate (numbers, times, causes, control claims → fallback), log |
| **Sensor data** | Read-only store (`mode=ro`) with a demo seeder; `get_live_reading` and `get_trend` with enum-checked columns, timeouts and downsampling |
| **Knowledge ingestion** | Upload → extract → chunk → embed → Chroma as one recorded run (Blueprints → Corpus); per-document category and rig/reference origin. **No real documents ingested yet** |
| **Track 1** | Chroma top-k with `source_type` filtering and cross-encoder re-ranking; refuses an index built by a different embedding model |
| **Track 2** | Hand-authored 34-node graph (placeholder data until the real corpus), editable in Blueprints with an assisted proposal queue; the agent loop and the fixed walk, switchable; replay of every walk |
| **Tool layer** | 33 tools in six categories behind effect, track and argument gates; Simple/Advanced mode enforced at dispatch |
| **Observability** | Every turn writes conversation, tool, rag and model rows on one `query_id`, with grounded/hallucination flags and per-item origins |
| **Model console** | The Forge — detect, estimate, score, manage, benchmark, commit |
| **Frontend** | React dashboard: theming, settings, store browser, Blueprints (corpus, graph, coverage, authoring, replay) |
| **Tests** | 143 backend `unittest` cases; the frontend has none |

### Not built

- **Real knowledge.** The corpus is empty and the graph is placeholder data —
  this blocks meaningful answers from either track and the whole evaluation.
- **Track 1 extras:** hybrid BM25 search, query expansion, contextual
  compression, multi-hop re-retrieval.
- **Evaluation (§9):** golden query set, ground truth, scoring and latency
  harness, the three comparison runs.
- **Model choice (§8):** the SLM tier is not smoke-tested and the lab machine's
  specs are unconfirmed; qwen3:1.7b drives Track 2's agent poorly.
- **Ariadne's Thread** — the provenance viewer (`MODULES.md`).
- A validator check for prompt rule 9 (reference-only rig specifics).

> **Honest framing:** the pipeline is built end to end and runs on demo
> telemetry and a placeholder graph. What is missing is the lab's real
> documents, the evaluation that measures the two tracks, and the model choice
> the lab machine allows.

---

## 12. Deployment

**Target:** one command brings up frontend + backend together.

```bash
./daedalus.sh setup   # one-time: deps, .env, runtime dirs
./daedalus.sh start   # or: docker compose up
```

Configuration lives in `.env` (template `.env.example`), read by both compose
and the script, so the container stack and the dev servers share one source.

A multi-stage build compiles the React app, then serves the static bundle *and*
the API from a **single FastAPI container** — one image, one port, no CORS, no
separate web server.

```
┌─ daedalus container ─────────────────────────┐
│  FastAPI (uvicorn) :8000                     │
│   ├── /api/*     → orchestrator, tools, prefs│
│   └── /*         → built React SPA           │
└───┬───────────────┬───────────────┬──────────┘
    │ volumes       │ CHROMA_URL    │ OLLAMA_BASE_URL
┌───▼──────────┐ ┌──▼───────────┐ ┌─▼──────────┐
│ ./data       │ │ chromadb     │ │ Ollama     │
│ ./logs       │ │ (compose)    │ │ host or    │
│ backend/data │ │ vector store │ │ --profile  │
└──────────────┘ └──────────────┘ └────────────┘
  sensor + audit
  + prefs SQLite
```

`chromadb` runs as its own service so the index survives app rebuilds and the
offline ingestion pipeline can write to it independently. It has no
healthcheck — the image is minimal (dash only, no curl/wget/python), so
nothing inside it can probe the port; readiness is reported by the app at
`/api/system/databases` instead, and the dashboard boots fine without it.

**Ollama runs on the host by default** — GPU passthrough is far simpler that way,
and models stay in the host cache. `docker compose --profile with-ollama up`
runs it as a container instead.

Volumes keep state on the host: `./data` (sensor DB, Chroma, graph, documents),
`./logs` (ai_logs.db), `backend/data` (prefs.db).

**Ports bind to `127.0.0.1` by default.** Widen to the LAN only deliberately.

---

## 13. Scope boundaries

### In scope (FYP2)
Both retrieval tracks and their comparison · the four deterministic tools ·
FastAPI orchestration with safety guard and response validation · Ollama SLM
serving · React dashboard · observability + evaluation harness · hardware/model
console · containerised deployment

### Out of scope (state plainly if asked)
- Cloud LLMs in production (benchmark-only ceiling)
- **Any** write path to reactor, SCADA or actuators
- Cybersecurity/IIoT hardening (network security, prompt-injection mitigation, encryption)
- Automated chart generation — existing SCADA visualisation covers it
- Physical hardware modification
- User accounts / auth / multi-tenancy
- Model fine-tuning or a prompt playground

### Deferred to Phase 2
PyQt5 embedded tab · multi-device `device_profiles` + dynamic per-device tools ·
Kùzu graph backend · LAN/multi-lab deployment

### Anti-patterns — never build or draw these

| Never | Why |
|---|---|
| A direct LLM → SQL arrow | SQL injection + numeric hallucination |
| An AI → SCADA write arrow | Breaks the fundamental safety boundary |
| Cloud vector DBs (Pinecone, Atlas) | Breaks local-first |
| AirLLM as production runtime | Experimental and slow; feasibility tool only |
| Model console framed as a chat UI | Mispositions an admin utility |
| Grafana / Prometheus | Overkill; Streamlit suffices |
| A log-viewer → reactor arrow | The viewer only ever reads logs |

---

## 14. Examiner-safe phrasings

> **Local-only:** "All production inference and retrieval is local. Cloud LLMs are only used as external benchmark references and are not part of the deployed runtime system."

> **Read-only:** "Zone 3 is strictly read-only. The agent can query SQLite and the vector store, but it cannot issue actuator commands or modify SCADA state."

> **Anti-hallucination:** "The language model never generates numerical sensor values directly. All numerical evidence is retrieved through deterministic tools from the local SQLite database."

> **Grounding:** "SOP and troubleshooting responses are grounded in retrieved domain documents. If no relevant document is retrieved, the system states that the information is unavailable instead of guessing."

> **Logging vs read-only:** "The read-only boundary applies to the reactor control layers. The AI layer writes to its own local audit database so that every query, tool call, and model response can be audited for groundedness and safety without transmitting data externally."

> **Vector DB choice:** "Each candidate database is wrapped behind a common adapter interface and evaluated using the same corpus, chunking strategy, embedding model, and held-out query set. This allows the final selection to be justified empirically rather than qualitatively."

> **Offline model download:** "Model downloading is a one-time setup activity performed when internet is available. The production runtime remains fully offline. For strictly offline deployment, models are pre-downloaded and transferred using Ollama's local model cache or portable storage."

### Abstract paragraph

> The proposed system is a fully local, read-only conversational agentic AI layer
> for an existing CO₂ sorption reactor monitoring stack. Sensor telemetry is
> acquired by the existing SCADA layer into a local SQLite database. Domain
> knowledge from manuals and SOPs is chunked,
> embedded locally, and stored in local vector and graph knowledge bases. When a
> user asks a question, the FastAPI orchestration backend classifies intent,
> applies safety guards, and calls deterministic tools to retrieve evidence. That
> evidence is packaged into a prompt and sent to a local SLM served by Ollama.
> The language model only synthesises the final response; it does not generate
> numerical readings or control commands. All runtime components operate offline,
> and the AI layer remains strictly read-only with respect to the reactor and
> SCADA system, while maintaining comprehensive local audit logging for
> evaluation and traceability.

---

## 15. Glossary

| Term | Meaning |
|---|---|
| **ABV** | Automated Ball Valve — write-only from SCADA, hence untrustworthy state |
| **Daedalus** | This system's product name |
| **CO2SorptionDT** | The pre-existing PyQt5 SCADA app this layer attaches to |
| **UAUC** | Unsafe Act / Unsafe Condition — the safety category of the corpus (SDSs, hazard guidance, lab safety rules) |
| **Evidence pack** | Structured tool output handed to the LLM — the *only* thing it may draw facts from |
| **Grounded** | Every factual claim traces to retrieved evidence |
| **Track 1 / Track 2** | Traditional vector RAG / Agentic GraphRAG |
| **Zone 3** | The read-only AI layer — this project's contribution |
| **Glass box** | UI philosophy: show the reasoning, don't hide it |
