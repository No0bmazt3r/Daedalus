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
separate SOP documents and anomaly logs. That is slow, error-prone, and shuts
out non-specialists.

### The solution

A **conversational AI layer that sits on top of — never replaces — CO2SorptionDT**,
letting anyone ask plain-language questions:

- "Is the reactor running fine right now?"
- "Why did the CO₂ reading spike at 10:00?"
- "What's the average temperature over the past hour?"
- "What do I do if the NDIR reading drifts?"
- "Was there an anomaly this morning?"

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
| 7 | The same four core tools: `get_live_reading`, `get_trend`, `get_anomaly_summary`, `rag_retrieve` |
| 8 | Same candidate models and quantization strategy (Q4_K_M-first) |
| 9 | Same success targets: **<3s** end-to-end latency, **>80%** retrieval precision, **<10%** hallucination rate |
| 10 | Setup/admin utilities are not runtime components and must not sit in the query path |
| 11 | Corpus is manuals, SOPs, anomaly records and UAUC records; chunked 300–500 tokens with overlap; embedded locally |

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
| 9 | **Column naming** | `temp_c`, `pressure_barg`, `ph`, `co2_ppm`, `anomaly_status` | `temperature`, `pressure`, `ph`, `co2_ppm`, `mode`, `anomaly_flag` | **Unit-suffixed physical columns** (`temp_c`, `pressure_barg`) — self-documenting. The tool layer exposes *friendly* names (`temperature`) and maps them to columns via a whitelist |
| 10 | **Anomaly storage** | `anomaly_status` column on the readings row | Either the column *or* a separate `anomaly_records` table | **Support both.** `get_anomaly_summary` reads the richer table when present and falls back to the column |
| 11 | **Graph store** | NetworkX primary, Kùzu as a stretch comparison | "KuzuDB or NetworkX" | **NetworkX first** (zero setup, fast iteration); Kùzu only if time allows |
| 12 | **Model list drift** | Qwen3, Phi-3, Gemma 3, Llama 3.1, Mistral | `architecture-overview` says Qwen2.5/Llama 3.2; `06` says Qwen3/Phi-3/Gemma 3 | **Use the `06`/`docs` list** (Qwen3 1.7B, Phi-3 Mini 3.8B, Gemma 3 1B for SLM tier). The overview's list is stale |
| 13 | **Naming** | "CO2SorptionDT Conversational Agentic AI" | "Project Daedalus" | **Daedalus** is the system/product name; the FYP title stays the formal academic one |

### 2.3 Open questions still needing your decision

These are genuinely undecided — flagged rather than silently resolved:

- [ ] **Is the PyQt5 tab still a deliverable at all**, or fully replaced by the web dashboard? Affects whether Zone 4 needs two clients.
- [ ] **Is the vector-DB bake-off (6 candidates) still in scope for FYP2**, on top of the dual-track RAG comparison? Two benchmark studies may be more than the timeline allows.
- [ ] **Does Anson's anomaly subsystem write a column or a table?** Determines which `get_anomaly_summary` path is primary.
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

### Rule 2 — The AI layer is read-only toward the plant
It may read the sensor SQLite DB and its own knowledge stores. It may **never**
write to SCADA, actuators, ABVs, sensor hardware, or a teammate's subsystem.

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
  `write_valve()`, `update_anomaly()` **do not exist**.
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
│  CO2SorptionDT · polling · ingestion (Jason) · anomaly flags (Anson)│
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
| 2 | SCADA acquisition | 2 | Pre-existing (teammates) |
| 3 | SQLite sensor data | 3 | **Store built** — read-only accessor + dev seeder |
| 4 | Knowledge ingestion (offline) | Setup | **Not started** |
| 5 | Retrieval — vector + graph | 3 | **Store running** (Chroma); retrieval not started |
| 6 | Model provider (Ollama) | 3 | **Not started** |
| 7 | FastAPI orchestration | 3 | **Skeleton only** |
| 8 | Deterministic tool layer | 3 | **Not started** |
| 9A | PyQt5 chat tab | 4 | Deferred / optional |
| 9B | React web dashboard | 4 | **Partially built** — see §11 |
| 10 | Observability & evaluation | Support | **Store built** — 7 log tables + query_id tracing |
| 11 | Admin utilities | Setup | **Not started** |

---

## 5. Retrieval: the dual-track comparison

Both tracks share Zones 1/2/4 and all deterministic sensor tools. They diverge
**only** on Path B — troubleshooting/SOP/domain-knowledge queries.

### Track 1 — Traditional vector RAG (baseline / control)

ChromaDB, local embeddings, top-k cosine retrieval. Advanced techniques layered
on top (all from `architecture/05`):

| Technique | Purpose |
|---|---|
| Metadata-filtered retrieval | Narrow by `source_type`, `reactor_mode`, `document_version` |
| Query expansion | LLM rewrites the query with lab synonyms before searching |
| Hybrid search | Dense embeddings + BM25 sparse, for exact terminology |
| Cross-encoder re-ranking | Re-score top-N locally before synthesis |
| Contextual compression | Strip irrelevant sentences to save context window |
| Multi-hop | Loop back and re-retrieve if evidence is insufficient |

### Track 2 — Agentic GraphRAG (comparison arm)

A hand-authored knowledge graph plus a ReAct-style agent loop that traverses it
over multiple hops, self-assessing sufficiency between steps.

**Nodes:** `Sensor`, `OperatingMode`, `Threshold`, `SOPDocument`, `SOPStep`,
`AnomalyRecord`, `AnomalyType`
**Edges:** `MONITORED_IN`, `HAS_THRESHOLD`, `TRIGGERS`, `RESOLVED_BY`,
`CONTAINS`, `INSTANCE_OF`, `INVOLVES`

**Why it should win on multi-hop.** For *"pressure and temperature both spiked —
what do I do, and has this happened before?"*, flat retrieval embeds the whole
sentence and hopes one chunk covers it. The graph instead walks:
both `Sensor` nodes → their `Threshold`s → the `AnomalyType` triggered by both →
the `SOPDocument` that `RESOLVED_BY` it → and separately every `AnomalyRecord`
that is an `INSTANCE_OF` that type, answering the historical half structurally.

**Honest risks to report:** higher latency (works against the <3s target), silent
failure when a relationship was never authored, and meta-reasoning steps
("is this enough?") that sub-2B SLMs may simply be too small to do well. That
last one is itself a legitimate finding.

### Comparison protocol

Hold constant: same model, quantization, temperature; same corpus; same query
set; same machine, run sequentially; same hand-labelled ground truth.

Stratify the query set (~30–50 queries, 6–10 per category):

| Category | Hypothesis |
|---|---|
| Single-hop factual | Tie |
| Single-hop procedural | Tie |
| **Multi-hop causal** | **GraphRAG wins — the key differentiator** |
| Ambiguous/underspecified | Unknown — which degrades more gracefully? |
| Out-of-corpus (must refuse) | Tests groundedness discipline |

Metrics: groundedness/hallucination rate, retrieval precision & recall, mean and
p95 latency, multi-hop success rate, refusal correctness, hop count.

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
    co2_ppm        REAL,   -- NDIR
    anomaly_status TEXT CHECK(anomaly_status IN ('Normal','Anomaly'))
);
CREATE INDEX idx_readings_timestamp ON sensor_readings(timestamp);
CREATE INDEX idx_readings_anomaly   ON sensor_readings(anomaly_status);
```

Optional richer table, if Anson's subsystem provides it:

```sql
CREATE TABLE anomaly_records (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    start_time   TEXT,
    end_time     TEXT,
    anomaly_type TEXT,
    severity     TEXT,
    description  TEXT,
    resolution   TEXT
);
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

### 6.3 The four stores

Daedalus owns four physically separate databases. The separation is not
tidiness — it is the safety argument, and it is worth stating explicitly in
the report.

| Store | Engine | Path | AI access | Holds |
|---|---|---|---|---|
| **Sensor** | SQLite | `/data/sqlite/sensor_readings.db` | **read-only** (`mode=ro`) | IoT telemetry written by SCADA |
| **Audit** | SQLite | `/logs/ai_logs.db` | read/write | conversation · tool · rag · model · error · feedback · memory logs |
| **Vector** | ChromaDB | `chromadb` service (or `data/chroma`) | read/write | embedded SOP/manual/anomaly/UAUC chunks |
| **Prefs** | SQLite | `/app/data/prefs.db` | read/write | UI state, kept out of the browser |

Verified: the read-only connection rejects INSERT, UPDATE, DELETE and DROP at
the driver, while reads continue to work.

### 6.4 Store separation (state this explicitly in the report)

```
Jason's subsystem  → writes sensor_readings
Anson's subsystem  → writes anomaly flags/records
Daedalus           → READS both; writes ONLY to its own separate stores:
                     ChromaDB dir, graph file, ai_logs.db, prefs.db
```

A bug in our indexing code physically **cannot** corrupt the sensor data of
record, because they are different files.

---

## 7. Orchestration & tools

### 7.1 The 11-step flow (`POST /api/chat`)

1. Receive query
2. Normalise (trim, length-check, detect control keywords)
3. **Classify intent** — `live_status` · `historical_query` · `trend_query` ·
   `anomaly_query` · `sop_query` · `mixed_query` · `unsafe_control` · `out_of_scope`
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
| `get_live_reading` | `sensor`, optional `timestamp` | value, unit, timestamp, mode, anomaly flag |
| `get_trend` | `sensor`, `start_time`, `end_time`, `aggregation`, optional `mode_filter` | aggregated value, unit, sample count, optional series (≤100 points) |
| `get_anomaly_summary` | `start_time`, `end_time`, `limit` | anomaly count + records |
| `rag_retrieve` | `query`, `top_k`, `source_types`, optional `reactor_mode` | chunks with text, score, source file, section, page |

Track 2 adds `graph_lookup`, `graph_traverse`, `graph_query_natural`.

**Security rules:** whitelisted sensor names (`temperature`, `pressure`, `ph`,
`co2_ppm`, `mode`, `anomaly_flag`) and aggregations (`average`, `min`, `max`,
`count`, `latest`, `first`); parameterized SQL only; no write queries; query
timeout and result-size caps; errors that never leak internals.

### 7.3 Worked example — mixed diagnostic

> **"Why did the CO₂ reading spike at 10:00?"**

```
intent: mixed_query
tools:  get_trend(co2_ppm, ~10:00) + get_anomaly_summary(~10:00) + rag_retrieve("CO₂ spike troubleshooting")
evidence: CO₂ rose 420 → 980 ppm · anomaly flag present · SOP says check NDIR calibration and gas flow
answer: "At around 10:00 the CO₂ reading increased sharply from 420 ppm to 980 ppm.
         The database records an anomaly flag during this period. The SOP suggests
         checking NDIR calibration and gas flow."
         [SQLite trend] [SQLite anomaly] [SOP_NDIR_Calibration.pdf p.4]
```

It must **not** say "the valve failed" — that causal claim has no supporting
evidence. Causal language requires retrieved backing.

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
- **Graph visualiser** — mini node-graph showing how GraphRAG connected an
  anomaly to an SOP
- **Source badges** — `[Live DB]` `[Trend]` `[SOP]` `[Manual]` `[Graph]`
- **Hardware/model console** — CPU/RAM/VRAM stats, swap active SLM

---

## 11. Current implementation status

### Built and working

| Area | Detail |
|---|---|
| **React frontend shell** | Vite 8 · React 19 · TanStack Router · Tailwind v4 · shadcn/base-ui |
| **Chat UI (mock)** | Message list, auto-growing composer, model selector, incognito mode, typewriter greeting — **no backend wired yet** |
| **Theme system** | 16 themes; live customisation of 7 base + 14 per-zone colours; derived syntax ramps; complementary-harmony generator; font/density/text-scale; frosted glass; import/export; up to 8 saved custom themes |
| **Background effects** | 9 options (7 canvas-animated) with colour/intensity/size, and pointer-reactive behaviour |
| **Settings modal** | Sectioned nav, incognito toggle, model defaults |
| **Settings** | Registry-driven nav, keyword search with keyboard navigation, drag-resizable + collapsible rail with full ARIA, layout persisted server-side |
| **FastAPI backend** | App skeleton, health endpoint, preference store, CORS, `theme.css` endpoint for flash-free first paint, `GET /api/system/databases` |
| **Data stores** | All four wired: read-only sensor accessor + dev seeder, 7-table audit log store with `query_id` tracing, Chroma client (server + embedded), prefs |
| **Persistence** | All UI preferences live server-side in SQLite — deliberately **nothing in browser storage** |

### Not started

The *logic* on top of the stores: knowledge ingestion, both retrieval tracks,
the deterministic tool layer, the orchestration flow, Ollama integration, the
evaluation harness, and the admin console. The stores themselves now exist and
report their health, but nothing reads or writes them in anger yet.

> **Honest framing:** what exists today is a polished Zone 4 client plus a thin
> Zone 3 shell. The AI layer — the actual FYP contribution — is still ahead.

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
> knowledge from manuals, SOPs, anomaly records and UAUC logs is chunked,
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
| **UAUC** | User Anomaly and Usage Context records |
| **Evidence pack** | Structured tool output handed to the LLM — the *only* thing it may draw facts from |
| **Grounded** | Every factual claim traces to retrieved evidence |
| **Track 1 / Track 2** | Traditional vector RAG / Agentic GraphRAG |
| **Zone 3** | The read-only AI layer — this project's contribution |
| **Glass box** | UI philosophy: show the reasoning, don't hide it |
