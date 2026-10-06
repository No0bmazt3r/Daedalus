# Daedalus — FYP Status & Feature Overview

*As of 2026-10-01. Figures come from the checkboxes in `TODO.md` and from reading
the local databases directly. Nothing here is a plan dressed up as progress: where
something is only designed, it says so.*

---

## 1. Summary

The pipeline is **built end to end** and answers questions from demo telemetry
and a placeholder knowledge graph. What it cannot do yet is answer from the
lab's real knowledge, and nothing has been evaluated:

- **no real documents have been ingested** — the corpus is empty,
- the knowledge graph is placeholder data, and the sensor database holds demo data,
- both retrieval tracks run, but there is nothing real for them to retrieve,
- evaluation has not started.

**What Daedalus is.** A fully local, read-only **standalone chat application**
for the CO2SorptionDT lab-scale CO₂ sorption reactor. It is not part of the
reactor or of the existing PyQt5 SCADA app: it reads the sensor data that app
logs (temperature, pressure, pH, level and NDIR CO₂, every 5 s) and the lab's
documents, and never writes to either. An operator asks things like *"Is the
reactor running fine right now?"* or *"What do I do if the NDIR reading
drifts?"* and gets an answer traceable to a database row, a document page or a
graph node.

**Scope.** Daedalus is the chatbot only. Sensor ingestion and anomaly detection
are outside this project; the assistant reads telemetry, it does not detect
anything.

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
| M1 Sensor data layer | 3 | 4 / 5 | 80% | Works on demo data |
| M2 Knowledge ingestion | 4 | 34 / 39 | 87%\* | Pipeline built, with categories and rig/reference origin; **0 documents ingested** |
| M3 Deterministic tool layer | 8 | 31 / 31 | 100% | Sensor tools, both tracks' retrieval, effect/track/argument gates |
| M4 Model provider | 6 | 5 / 7 | 71% | Serving and streaming work; the SLM tier is untested and the lab machine unconfirmed |
| M5 Orchestration | 7 | 21 / 23 | 91% | All 11 steps of the chat flow, with a validator that replaces ungrounded answers |
| M6 Retrieval tracks (vector RAG + GraphRAG) | 5 | 14 / 24 | 58% | Both tracks answer; Track 2's agent loop built; Track 1's hybrid search, expansion and multi-hop not built |
| M7 Observability | 10 | 5 / 10 | 50% | Every turn fully logged on one `query_id`; no log viewer yet |
| M8 Evaluation | — | 0 / 10 | **0%** | Not started — waits on the real corpus |
| M9 Hardware & model console | 11 | 15 / 18 | 83% | Working ("The Forge") |
| M10 Dashboard | 9B | 99 / 113 | 88%\* | Working; Ariadne's Thread not built |

\* **Inflated.** Many ticked boxes in M2 and M10 are small setup or UI
sub-tasks.

**Do not quote a single overall percentage.** The machinery the research needs
is largely built; the research *result* — the evaluation over real knowledge —
has not started, and it is what the project is assessed on.

Critical path now: **real corpus → ingest and rebuild the graph from it → choose
the model the lab machine allows → freeze both tracks → evaluate once.**

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

**How an answer is made.** The question is normalised, a follow-up is rewritten
to stand alone, its intent is classified (7 intents), and a control request is
refused before any tool or model runs. The planner then picks tools by rule —
sensor reads for data questions, the selected track's retrieval for knowledge
questions — and their results become a labelled evidence pack (`[S1]` a reading,
`[D1]` a passage, `[G1]` a graph node). The model writes the answer from that
pack only, and a validator replaces it with a fallback if it states a number, a
time or a cause the evidence does not. Citation chips show the evidence behind
each claim.

**Current limitation.** It answers from demo telemetry and a placeholder graph,
and the corpus is empty, so knowledge answers are not yet meaningful.

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
(timestamp, mode, temperature, pressure, pH, level, CO₂). Daedalus opens it in read-only mode, and this is tested: INSERT,
UPDATE, DELETE and DROP are all rejected. A generator fills it with **4,320 demo
rows** so development doesn't need the physical rig.

**Why it matters.** This is Rule 2 enforced at the database driver, not by asking
the model nicely. Even a fully compromised prompt cannot write to plant data.

**Current limitation.** Demo data only.

![Databases panel](screenshots/03-databases.png)

**[SCREENSHOT: `03-databases.png`]** — Settings → **System** → *Storage health*, showing all five
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

It has five tabs: Hardware, Chat models, Embedding models, Re-rankers and
Installed. **Installed** is for managing what is on the machine: local
models with their run history (p50/p95 latency), benchmark and delete; the
embedding models and which one builds the index; the re-rankers; and the cloud
baselines. **Chat models**, **Embedding models** and **Re-rankers** are for browsing: search, filter, pull and
star, with a Manage button on anything already installed that jumps to that
model's own list in Installed (chat, embedding or re-ranker). Pulls show a
progress bar, and deletes ask through the app's own dialog.
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

**Categories and origin.** Each document is uploaded as a manual, SOP,
troubleshooting/incident record, safety (UAUC — Unsafe Act / Unsafe Condition)
document, or background reference — and as **this rig's** own or a
**reference** from another installation (the default). Answers mark every
passage accordingly, and a rig-specific fact backed only by references must be
called general guidance from another installation. The origin can be corrected
at any time without re-ingesting.

**Current limitation.** Built but **empty** — 0 documents ingested, because the
corpus hasn't been collected yet.

![Ingest view](screenshots/10-ingest.png)

**[SCREENSHOT: `10-ingest.png`]** — Blueprints → **Ingest**, showing the pipeline
screen with the *Import as* and *Whose* (This rig / Reference) choices, and ideally
one uploaded document with its badge.

![Knowledge base settings](screenshots/11-knowledge-base.png)

**[SCREENSHOT: `11-knowledge-base.png`]** — Settings → **Retrieval Track** showing the
track switch, with **Vector RAG** (re-ranking) and **Graph RAG** (agent loop) visible in the
settings nav.

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

**What it is.** The layer every fact is fetched through. It has **33 tools** in
six groups (sensor, search, knowledge, session, system, other). Before any tool
runs, the registry checks:

- **Effects** — any tool that writes, uses the network or needs admin rights is
  refused on the chat path, however the prompt is worded.
- **Track** — only the selected retrieval track's tools can run; the other
  track's are refused, so each answer comes from one track only.
- **Arguments** — type, allowed values and ranges are checked; an unknown
  argument is an error, not silently ignored.
- **Citability** — old conversation text can't be cited as evidence.

**Simple** mode (the default) lets only the tools that answer questions run —
the two sensor tools and the selected track's retrieval. **Advanced** opens the
rest under per-tool switches and capability locks.

**Why it matters.** This is Rules 2 and 3 in code: the sensor tools
(`get_live_reading`, `get_trend`) read through a read-only connection with
enum-checked columns and a query timeout, and they are the only source of a
number in an answer.

![Agent tools](screenshots/13-agent-tools.png)

**[SCREENSHOT: `13-agent-tools.png`]** — Settings → **Agent Tools**, showing the
tool list with their categories and effect labels.

---

### 3.10 Knowledge graph and Track 2's agent loop

**What it is.** The knowledge graph used by GraphRAG (Track 2): sensors, their
alarm limits, the abnormal conditions those limits signal, the procedures that
resolve them, and their steps. It is built in Blueprints — a graph viewer,
manual authoring, and an LLM-assisted **proposal queue** where suggested nodes
and edges are reviewed by a person before they enter the graph. Track 2 uses
no embeddings, by design.

Track 2 retrieves in one of two modes, switched in Settings → Graph RAG:

- **Agent loop** (default) — the local model picks each hop through the graph
  and decides when it has enough, under a hard time budget (6 s by default).
- **Fixed walk** — the schema's fixed chain, sensor → limit → condition →
  procedure → steps. The baseline the agent is measured against.

**Why it matters.** GraphRAG is half of the headline comparison, and the two
modes isolate whether the *agent's choices* help, separately from whether a
graph helps at all.

**Current limitation.** The graph is 34 nodes of placeholder data until the real
corpus arrives. On the development machine qwen3:1.7b takes 1–7 s per hop and
often walks to the wrong part of the graph — a finding about the model, to
revisit once the lab machine's model is chosen.

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

**Current limitation.** Track 2 walks can be replayed now, with the agent's
verdict after each hop and why it stopped. Track 1 has nothing to replay until
the corpus is loaded.

![Retrieval view](screenshots/16-retrieval.png)

**[SCREENSHOT: `16-retrieval.png`]** — Blueprints → **Retrieval**. Empty state is
acceptable.

---

### 3.12 Observability and audit logs

**What it is.** A separate log database (`ai_logs.db`) with seven tables:
conversation, tool, RAG, model, error, feedback and memory. Every question gets a
`query_id`, so one question can be traced across all seven tables. Logging can
never crash a chat response. Retrieval rows record which track and mode
answered, the whole graph walk, and whether each retrieved item was this rig's
document or a reference.

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
- [ ] `03-databases.png` — Settings → System → Storage health
- [ ] `04-sensor-rows.png` — `sensor_readings` rows in the browser
- [ ] `05-model-config.png` — The Forge → Installed → Chat models (Local)
- [ ] `06-cloud-endpoints.png` — Settings → Model Endpoints (key masked)
- [ ] `07-forge-hardware.png` — The Forge → Hardware
- [ ] `08-forge-models.png` — The Forge → Chat models, Shortlist, fit labels visible
- [ ] `09-benchmark.png` — finished benchmark run
- [ ] `10-ingest.png` — Blueprints → Ingest
- [ ] `11-knowledge-base.png` — Settings → Retrieval Track
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
| Knowledge | The real corpus (manuals, SOPs, troubleshooting, safety, background — tagged this rig / reference); the graph rebuilt from it | M2 · M6 |
| Track 1 — vector RAG | Query expansion, hybrid dense + BM25, contextual compression, multi-hop re-retrieval, `VectorStoreAdapter` | M6 |
| Evaluation | 30–50 query golden set, hand labels, groundedness / hallucination scoring, precision@3/@5, recall, MRR, latency p50/p95, three comparison runs (Track 1 · Track 2 walk · Track 2 agent), human panel | M8 |
| Models | Pull and test the SLM tier (Qwen3 1.7B, Phi-3 Mini 3.8B, Gemma 3 1B); verify inference with networking disabled | M4 |
| Provenance UI | Ariadne's Thread — the per-query trace viewer; source badges | M10 |
| Validator | A check for prompt rule 9 (rig-specific facts backed only by references) | M5 |
| PyQt5 tab | Not started — optional / Phase 2 | — |

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
| Retrieval | Dual-track comparison | **Kept** — still the headline contribution, now three runs: Track 1, Track 2 fixed walk, Track 2 agent | Separates "a graph helps" from "the agent's choices help" |
| Scope | Chatbot alongside separate ingestion and anomaly-detection subsystems | **Chatbot only** — reads telemetry, detects nothing | Sensor ingestion and anomaly detection are outside this project |
| Corpus | Manuals and SOPs | Five categories, each document tagged **this rig** or **reference** | Public literature is useful for concepts but wrong for this rig's specifics, and answers must say which they rest on |
| Frontend | — | Daedalus is a **standalone chat app**, not a component of the reactor or its SCADA app | It reads the reactor's data over a read-only boundary |

---

## 7. Blockers, risks and decisions needed

### Blocked

- **Document corpus** — the lab's own manuals and SOPs, plus reference
  literature. Nothing meaningful can be retrieved without it, which blocks both
  tracks' real answers and the whole evaluation. Public documents are being
  collected; the lab's own documents are still needed for rig-specific answers
  and for ground truth.
- **Lab machine RAM / GPU** — gates the final model choice (M4), which also
  decides how well Track 2's agent can drive.

### Scope decisions still open

- Is the PyQt5 tab still a deliverable, or fully replaced by the web dashboard?
- Is the 6-candidate vector-database bake-off still in scope on top of the
  dual-track RAG comparison? Two benchmark studies may overrun the timeline.

### Schedule risk

The remaining work is mostly knowledge and measurement, not code: collect and
ingest the corpus, rebuild the graph from it, choose the model, then freeze both
tracks and run the evaluation **once**. Tuning after seeing results invalidates
the comparison, so the evaluation cannot start until everything before it is
done.

---

## 8. For the advisor meeting — to fill in

- **Current week and sprint:** _week ___, Sprint ___ — on schedule / behind by ___
- **Goal of the meeting:** sign-off to proceed / help with a blocker / checkpoint
- **Main ask (suggested):** the lab's own manuals and SOPs for the rig, and the
  lab machine's specs — those unblock the evaluation.
- **Decisions to get from the advisor:** PyQt5 tab in or out; vector-DB bake-off in
  or out.
