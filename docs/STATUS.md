# Daedalus — FYP Status & Feature Overview

*As of 2026-09-25. Figures come from the checkboxes in `TODO.md` and from reading
the local databases directly. Nothing here is a plan dressed up as progress: where
something is only designed, it says so.*

---

## 1. Summary

The platform around Daedalus is largely built. The core research pipeline is only
about **10–15% done**:

- no real documents have been ingested,
- the sensor database holds only demo data,
- neither retrieval track can answer a question yet,
- evaluation has not started.

**What Daedalus is.** A fully local, read-only chat assistant for the CO2SorptionDT
lab-scale CO₂ sorption reactor. It sits on top of the existing PyQt5 SCADA app
(which logs temperature, pressure, pH, level and NDIR CO₂ to SQLite every 5 s) and
never replaces it. An operator asks things like *"Is the reactor running fine right
now?"* or *"What do I do if the NDIR reading drifts?"* and gets an answer traceable
to a database row or SOP page.

**Three rules shape the design:**

1. **Fully local.** No cloud APIs in the production path. Cloud models appear only
   as labelled comparison baselines (`chat_cloud` / `benchmark_cloud`), excluded
   from production latency figures.
2. **Read-only toward the plant.** The AI cannot write to SCADA, actuators or
   sensors. Enforced by the SQLite driver (`mode=ro`) and the tool registry, not by
   prompting.
3. **The model never invents numbers.** Deterministic tools fetch every value; the
   LLM only phrases what was retrieved, or says it doesn't have the information.

**Success targets (from the proposal):** under 3 s end-to-end latency, over 80%
retrieval precision, under 10% hallucination rate.

---

## 2. Progress by milestone

Counted from `TODO.md` checkboxes (done / total tasks).

| Milestone | Layer | Done | % | Honest read |
|---|---|---|---|---|
| M1 Sensor data layer | 3 | 4 / 7 | 57% | Works on demo data; not reconciled with Jason's real table |
| M2 Knowledge ingestion | 4 | 32 / 37 | 86%\* | Pipeline built; **0 documents ingested** |
| M3 Deterministic tool layer | 8 | 23 / 32 | 72%\* | Registry built; **sensor tools not written** |
| M4 Model provider | 6 | 4 / 7 | 57% | Ollama serving works; only 1–2 local models tested |
| M5 Orchestration | 7 | 2 / 17 | **12%** | Only chat memory and streaming exist |
| M6 Retrieval tracks (vector RAG + GraphRAG) | 5 | 3 / 20 | **15%** | Store plumbing only; no retrieval |
| M7 Observability | 10 | 4 / 10 | 40% | Log DB exists; not wired into a full query flow |
| M8 Evaluation | — | 0 / 10 | **0%** | Not started |
| M9 Hardware & model console | 11 | 10 / 13 | 77% | Working ("The Forge") |
| M10 Dashboard | 9B | 97 / 111 | 87%\* | Working; provenance/source badges not built |

\* **Inflated.** Many ticked boxes in M2, M3 and M10 are small setup or UI
sub-tasks, while the big items in those milestones are still open.

**Do not quote a single overall percentage.** Supporting infrastructure (M9, M10,
most of M2's pipeline) is mostly done; the research core (M5 + M6 + M8), which the
project is assessed on, is roughly 10%.

Critical path per `TODO.md`: **M1 → M2 → M3 → M4 → M6**, then M8. M5 and M7 can run
alongside.

---

## 3. Features built

Each feature below has three parts: **what it is**, **why it matters** for the
project, and a **screenshot placeholder** saying exactly what to capture.

> **Screenshot convention.** Save images to `docs/screenshots/` using the file
> name given in each placeholder. The `![...]()` line will then show the image
> automatically. Delete the `[SCREENSHOT: ...]` note once the image is in. A full
> checklist is at the end of this section (§3.14).
>
> The demo data is synthetic — say so in any caption that shows sensor values.

---

### 3.1 Web dashboard and chat

**What it is.** The main user interface: a React web app served at
`http://localhost:8000`. An operator types a question and the answer streams in
word by word. Conversations are saved on the server, so they survive a page
reload and can be reopened from the sidebar.

**Why it matters.** This replaces the planned PyQt5 tab as the primary frontend.
Because it talks to the backend only over HTTP, it proves the AI layer is
decoupled from the SCADA app — it could be attached to CO2SorptionDT later
without changing the backend.

**Current limitation.** Answers come from the model alone. Retrieval and sensor
tools are not yet wired in, so it cannot yet answer from documents or live data.

![Chat interface](screenshots/01-chat.png)

**[SCREENSHOT: `01-chat.png`]** — Main window with the sidebar open showing a few
past sessions, and one finished question-and-answer in the chat. Use a
reactor-style question, e.g. *"What does a rising CO₂ reading usually mean?"*

![Streaming response](screenshots/02-chat-streaming.png)

**[SCREENSHOT: `02-chat-streaming.png`]** *(optional)* — The same chat caught
mid-answer, text still appearing. Shows streaming.

---

### 3.2 Read-only sensor data layer

**What it is.** A SQLite database with the reactor's schema: `sensor_readings`
(timestamp, mode, temperature, pressure, pH, level, CO₂, anomaly status) and
`anomaly_records`. Daedalus opens it in read-only mode, and this is tested: INSERT,
UPDATE, DELETE and DROP are all rejected. A generator fills it with **4,320 demo
rows** so development doesn't need the physical rig.

**Why it matters.** This is Rule 2 enforced at the database driver, not by asking
the model nicely. Even a fully compromised prompt cannot write to plant data.

**Current limitation.** Demo data only. Not yet matched to Jason's real table.

![Databases panel](screenshots/03-databases.png)

**[SCREENSHOT: `03-databases.png`]** — Settings → **Databases**, showing all five
databases and their health, with the sensor database visible.

![Sensor rows](screenshots/04-sensor-rows.png)

**[SCREENSHOT: `04-sensor-rows.png`]** — The raw database browser open on the
`sensor_readings` table, showing a page of rows and their columns.

---

### 3.3 Local model serving (Ollama)

**What it is.** The backend talks to Ollama running on the same machine. The model
is not hard-coded: `config/model_config.json` either pins a model or uses **auto**
mode, which picks the best-scoring installed model for whichever machine it runs
on. Every model call is logged with its timings.

**Why it matters.** This is Rule 1 — no cloud in the production path. Auto mode
means moving from the development laptop to the lab machine needs no code change.

**Current limitation.** Only `qwen3:1.7b` (and once `llama3.2`) has been run
locally. Phi-3 Mini and Gemma 3 1B are not yet tested.

![Model selection](screenshots/05-model-config.png)

**[SCREENSHOT: `05-model-config.png`]** — The Forge → **Installed** → Local
models, showing the models on this machine with their run history.

---

### 3.4 Cloud baseline, kept separate

**What it is.** A hosted model (`gpt-oss:120b-cloud`) can be used for a single chat
turn or a benchmark run, purely for comparison. Those runs are tagged
`chat_cloud` / `benchmark_cloud`, labelled in the transcript, and excluded from
every production latency figure. Cloud benchmarks always use a synthetic prompt,
so no real plant documents leave the machine.

**Why it matters.** It gives a "how good could it be" reference point without
breaking the local-only rule.

![Cloud endpoints](screenshots/06-cloud-endpoints.png)

**[SCREENSHOT: `06-cloud-endpoints.png`]** — Settings → **Model Endpoints**,
showing the cloud endpoint configured (make sure any API key is masked).

---

### 3.5 The Forge — hardware and model console

**What it is.** A console that answers "which model can this machine run well?"
in five steps:

1. **Detect** RAM, CPU, GPU/VRAM, disk and Ollama version.
2. **Estimate** memory needed per model and quantisation level.
3. **Score** each model as `safe`, `marginal` or `will_not_fit` — judged against
   both VRAM and system RAM, so a model that spills from GPU to RAM isn't wrongly
   ruled out.
4. **Rank** a curated catalogue of 37 models (plus live Hugging Face search).
5. **Pull**, benchmark and select the chosen model.

It has four tabs. **Installed** is for managing what is on the machine: local
models with their run history (p50/p95 latency), benchmark and delete; the
embedding model and which one builds the index; and the cloud baselines.
**Chat models** and **Embedding models** are for browsing: search, filter, pull and
star, with a Manage button on anything already installed that jumps to Installed.
Chat models is one list filtered by Shortlist / Everything / Hugging Face, SLM /
LLM and Runnable only, with each model shown once and its quantisation (Q4, Q8,
FP16) chosen on the card. You can star models to build your own shortlist; the six
candidates the report compares keep a "report candidate" badge either way.
Embedding models has a catalogue of 16 models, each figure read from the model
file itself, with English / Multilingual filters and a box to pull any other model
by name.

**Why it matters.** Model choice depends on the lab machine, whose specs are still
unconfirmed. The Forge makes that choice measurable and repeatable on any machine.
On the laptop the estimator predicted 28.9 tokens/s against 27.9 measured.

![Forge hardware](screenshots/07-forge-hardware.png)

**[SCREENSHOT: `07-forge-hardware.png`]** — The Forge → **Hardware**, showing the
detected CPU, RAM, GPU and VRAM.

![Forge models](screenshots/08-forge-models.png)

**[SCREENSHOT: `08-forge-models.png`]** — The Forge → **Chat models** on
**Shortlist**, showing the ranked cards with the safe / marginal / will-not-fit
labels and the "report candidate" badges visible.

---

### 3.6 Latency benchmark

**What it is.** A benchmark that measures how long an operator waits — mainly
**time to first token** — using a realistic ~2,000-token prompt shaped like a real
RAG query (question plus retrieved document chunks), not a one-line "hello". It
runs a warm-up first and records whether the prompt was a real retrieval or a
labelled synthetic one.

**Why it matters.** This directly measures Objective 3 (under 3 s). A bare-question
benchmark would flatter the model: prompt processing was about 6× longer on the
realistic prompt. The full method is in `docs/BENCHMARK.md`.

![Benchmark result](screenshots/09-benchmark.png)

**[SCREENSHOT: `09-benchmark.png`]** — A finished benchmark run in The Forge,
showing time to first token, tokens/s and the prompt size.

---

### 3.7 Knowledge ingestion pipeline

**What it is.** The offline pipeline that turns documents into searchable chunks:

1. Extract text from TXT, MD, CSV, JSON, YAML and PDF.
2. Clean it (line endings, PDF ligatures, stray spacing).
3. Split it into chunks by section, tagging each with its source file, type and
   section title.
4. Embed the chunks locally with the selected embedding model and store them in
   ChromaDB — one collection per embedding model, so indexes never mix.

The same chunks feed both retrieval tracks, so the comparison is fair.

**Why it matters.** Every cited answer depends on this. Tagging each chunk with its
source is what makes "cited to the exact SOP page" possible.

**Current limitation.** Built but **empty** — 0 documents ingested, because the
real corpus hasn't been received.

![Ingest view](screenshots/10-ingest.png)

**[SCREENSHOT: `10-ingest.png`]** — Blueprints → **Ingest**, showing the pipeline
screen (empty state is fine — it shows it's ready and waiting for documents).

![Knowledge base settings](screenshots/11-knowledge-base.png)

**[SCREENSHOT: `11-knowledge-base.png`]** — Settings → **Knowledge Base**, showing
chunking settings and the selected embedding model.

---

### 3.8 Document sourcing search (setup only)

**What it is.** A search screen with six providers (self-hosted SearXNG,
DuckDuckGo, Brave, Google PSE, Tavily, Serper) in a fallback chain, used only to
**find** public manuals and datasheets while building the corpus. It shows every
attempt the chain made and why a provider failed.

**Why it matters.** It helps build the corpus without breaking Rule 1: the chat path
cannot import it, and the database only allows it for setup. SearXNG is off by
default.

![Search settings](screenshots/12-search.png)

**[SCREENSHOT: `12-search.png`]** — Settings → **Search**, showing the provider list
and one test search result.

---

### 3.9 Safe tool registry

**What it is.** The layer the model uses to fetch facts. It has **13 tools** in
five groups (search, knowledge, session, system, other). Before any tool runs, the
registry checks:

- **Effects** — any tool that writes, uses the network or needs admin rights is
  refused on the chat path, however the prompt is worded.
- **Arguments** — type, allowed values and ranges are checked; an unknown
  argument is an error, not silently ignored.
- **Citability** — old conversation text can't be cited as evidence.

**Why it matters.** This is Rules 2 and 3 in code. It is also where the sensor
tools (`get_live_reading`, `get_trend`, `get_anomaly_summary`) will plug in — a slot
for them already exists.

**Current limitation.** The three sensor tools are not written yet.

![Agent tools](screenshots/13-agent-tools.png)

**[SCREENSHOT: `13-agent-tools.png`]** — Settings → **Agent Tools**, showing the
tool list with their categories and effect labels.

---

### 3.10 Knowledge graph authoring (Track 2 groundwork)

**What it is.** Tools for building the knowledge graph used by GraphRAG (Track 2):
a graph viewer, manual authoring, and an LLM-assisted **proposal queue** where
suggested nodes and edges are reviewed by a person before they enter the graph.
Track 2 does not use embeddings, by design.

**Why it matters.** GraphRAG is half of the headline comparison. Human review of
proposals keeps the graph accurate.

**Current limitation.** The graph is empty until the corpus arrives.

![Graph view](screenshots/14-graph.png)

**[SCREENSHOT: `14-graph.png`]** — Blueprints → **Graph** (switch to the GraphRAG
track), showing the graph canvas.

![Proposal queue](screenshots/15-proposals.png)

**[SCREENSHOT: `15-proposals.png`]** *(optional)* — Blueprints → **Build**, showing
the proposal queue screen.

---

### 3.11 Retrieval view and replay

**What it is.** Screens in Blueprints for inspecting retrieval: which chunks were
retrieved for a question, and replaying a past query. Both tracks get the same
set of views (inventory, trace, authoring), so they are inspected the same way.

**Why it matters.** Answers must be traceable to their source. This is where an
examiner can see *why* an answer said what it said.

**Current limitation.** Nothing to show until retrieval is built and the corpus
is loaded.

![Retrieval view](screenshots/16-retrieval.png)

**[SCREENSHOT: `16-retrieval.png`]** — Blueprints → **Retrieval**. Empty state is
acceptable.

---

### 3.12 Observability and audit logs

**What it is.** A separate log database (`ai_logs.db`) with seven tables:
conversation, tool, RAG, model, error, feedback and memory. Every question gets a
`query_id`, so one question can be traced across all seven tables. Logging can
never crash a chat response.

**Why it matters.** Evaluation (latency, groundedness, precision) is computed from
these logs. It also gives an audit trail of every tool call and model call.

![Logs](screenshots/17-logs.png)

**[SCREENSHOT: `17-logs.png`]** — The raw database browser open on
`model_logs`, showing rows with model name, time to first token and source.

---

### 3.13 Deployment, settings and usability

**What it is.**

- **One-command setup and run:** `./daedalus.sh setup` then `./daedalus.sh start`.
  Everything runs in Docker, with optional GPU, Ollama and SearXNG. `sync.sh` and
  `reset.sh` handle updates and clean resets safely (the sensor DB is never wiped
  without asking twice).
- **Usability:** command palette, keyboard shortcuts, theming, and a searchable
  settings window.

**Why it matters.** The system has to be installable on the lab machine by someone
other than the author.

![Command palette](screenshots/18-command-palette.png)

**[SCREENSHOT: `18-command-palette.png`]** — The command palette open over the
dashboard.

![Terminal start](screenshots/19-start.png)

**[SCREENSHOT: `19-start.png`]** *(optional)* — Terminal output of
`./daedalus.sh status` showing the running services and database health.

---

### 3.14 Screenshot checklist

Save all images to `docs/screenshots/`.

- [ ] `01-chat.png` — chat with past sessions and one answer
- [ ] `02-chat-streaming.png` *(optional)* — answer mid-stream
- [ ] `03-databases.png` — Settings → Databases
- [ ] `04-sensor-rows.png` — `sensor_readings` rows in the browser
- [ ] `05-model-config.png` — The Forge → Installed → Local models
- [ ] `06-cloud-endpoints.png` — Settings → Model Endpoints (key masked)
- [ ] `07-forge-hardware.png` — The Forge → Hardware
- [ ] `08-forge-models.png` — The Forge → Chat models, Shortlist, fit labels visible
- [ ] `09-benchmark.png` — finished benchmark run
- [ ] `10-ingest.png` — Blueprints → Ingest
- [ ] `11-knowledge-base.png` — Settings → Knowledge Base
- [ ] `12-search.png` — Settings → Search with a test result
- [ ] `13-agent-tools.png` — Settings → Agent Tools
- [ ] `14-graph.png` — Blueprints → Graph
- [ ] `15-proposals.png` *(optional)* — Blueprints → Build
- [ ] `16-retrieval.png` — Blueprints → Retrieval
- [ ] `17-logs.png` — `model_logs` in the browser
- [ ] `18-command-palette.png` — command palette open
- [ ] `19-start.png` *(optional)* — `./daedalus.sh status` in a terminal

---

## 4. Not yet built

| Area | What's missing | Milestone |
|---|---|---|
| Sensor tools | `get_live_reading`, `get_trend`, `get_anomaly_summary` — not written, not even stubs. Also sensor-name whitelist, query timeouts, result-size caps | M3 |
| Orchestration | Query normaliser, 8-intent classifier, **safety guard** (refuse control requests before any tool/LLM call), tool planner, evidence-pack builder, prompt builder, **response validator** (reject numbers not in evidence), follow-up rewriting | M5 |
| Track 1 — vector RAG | Top-k retrieval, query expansion, hybrid dense + BM25, cross-encoder re-ranking, compression, multi-hop, `VectorStoreAdapter` | M6 |
| Track 2 — GraphRAG | Final node/edge schema, the graph itself, `graph_lookup` / `graph_traverse`, agent loop with hop cap and timeout | M6 |
| Routing | Flag to point the same UI at either track for a fair comparison | M6 |
| Evaluation | 30–50 query golden set, hand labels, groundedness / hallucination scoring, precision@3/@5, recall, MRR, latency p50/p95, head-to-head table, human panel | M8 |
| Models | Pull and test Phi-3 Mini 3.8B and Gemma 3 1B; verify inference with networking disabled | M4 |
| Provenance UI | Source badges (`[Live DB]` `[SOP]` `[Graph]`…), tool-call trace, GraphRAG path visualiser | M10 |
| PyQt5 tab | Not started — now optional / Phase 2 | — |

---

## 5. Early measurements

From `model_logs` on the development laptop (**RTX 3050 Laptop, 4 GB VRAM**).
Every figure is a **single run** and must not appear in the report as-is
(`docs/BENCHMARK.md` §9.1).

| Model | Prompt | Time to first token | Prompt processing | Total |
|---|---|---|---|---|
| `qwen3:1.7b` (local) | 2,321 tokens (RAG-sized) | 1,123 ms | 890 ms | 5.1 s (64 tokens out) |
| `qwen3:1.7b` (local) | 2,238 tokens (RAG-sized) | 2,364 ms | 1,964 ms | 12.1 s (128 tokens out) |
| `qwen3:1.7b` (local) | 91 tokens (bare question) | 3,399 – 13,432 ms | ~150 ms | 5–14 s |
| `llama3.2` (local) | 2,052 tokens | 3,841 ms | — | 20.0 s |
| `gpt-oss:120b-cloud` (baseline) | 2,094 tokens | 1,090 – 1,738 ms | — | 1.3 – 1.9 s |

What this shows so far:

- On a realistic prompt, processing the prompt is most of the wait before the first
  token, which is why the benchmark uses a ~2k-token prompt rather than a bare
  question.
- The same model and prompt varied **4×** (3.4 s to 13.4 s), mainly from cold
  model loads. Results must be averaged over several runs.
- The under-3 s target is plausible for the first token on this laptop, but not yet
  for a full answer, and nothing has been measured end-to-end with real retrieval.

---

## 6. Changes from the original proposal

| Topic | Proposal said | Now | Why |
|---|---|---|---|
| Frontend | PyQt5 tab only; web UI out of scope | **React web dashboard is primary**; PyQt5 tab optional / Phase 2 | It exists and proves the backend is decoupled from SCADA |
| Device scope | — | **One device for FYP2**; schema has a defaulted `device_id` for later | Multi-device is scope creep against the timeline |
| Model console | CLI-first tool | Web console ("The Forge") built directly | The scoring logic is the substance; a UI over it was cheaper than a second surface |
| Tool typing | Plain Python functions | Typed tool contracts (PydanticAI) with a checked registry | Makes Rule 3 structurally enforced, not a convention |
| Observability | Not covered | Seven log tables with per-query tracing | Research docs had a gap |
| Evaluation | Local manual labelling | Hybrid: local labels + offline LLM-as-judge over **exported** logs only | Judge never touches the live runtime |
| Track 2 (GraphRAG) | — | Embedding-free | Keeps the two tracks clearly different for the comparison |
| Retrieval | Dual-track comparison | **Kept** — still the headline contribution | — |

---

## 7. Blockers, risks and decisions needed

### Blocked on other people

- **Document corpus** — manuals, SOPs, anomaly records, UAUC records. Nothing can
  be ingested without it, which blocks both retrieval tracks and evaluation.
  (UAUC and anomaly records involve Anson.)
- **Real sensor data sample** from Jason's ingestion — needed to finish M1 and write
  real sensor tools.
- **Anson's anomaly output format** — a column on each reading or a separate table?
  Decides the primary path for `get_anomaly_summary`.
- **Lab machine RAM / GPU** — gates the final model choice (M4).

### Scope decisions still open

- Is the PyQt5 tab still a deliverable, or fully replaced by the web dashboard?
- Is the 6-candidate vector-database bake-off still in scope on top of the
  dual-track RAG comparison? Two benchmark studies may overrun the timeline.

### Schedule risk

The remaining work is the research core: sensor tools (M3), orchestration (M5), both
retrieval tracks (M6) and evaluation (M8). All of it depends on the corpus and real
sensor data arriving. The evaluation must be run once, after both tracks are frozen,
so it cannot start early.

---

## 8. For the advisor meeting — to fill in

- **Current week and sprint:** _week ___, Sprint ___ — on schedule / behind by ___
- **Goal of the meeting:** sign-off to proceed / help with a blocker / checkpoint
- **Main ask (suggested):** help getting the document corpus and a real sensor data
  sample, since those unblock most of the remaining work.
- **Decisions to get from the advisor:** PyQt5 tab in or out; vector-DB bake-off in
  or out.
