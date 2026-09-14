# The Three Core Modules — Design Specification

**Status: design. One step of one module is built** — the Forge's hardware
detection (§2, step 1). Everything else here is still specification. The three
names have been sitting in `frontend/src/components/Sidebar.tsx` as dead
buttons with no handler since the shell was built; this is the document that
says what they are for.

They are not new scope. Each one is a thing `PROJECT.md` §10.2 already promises
under **"the glass box experience"**, given a home and a name:

| Nav item | §10.2 promise | Layer |
|---|---|---|
| **Ariadne's Thread** | Tool-call trace — collapsible Thought → Action → Observation | 10 — Observability |
| **The Forge** | Hardware/model console — CPU/RAM/VRAM stats, swap active SLM | 11 — Admin utilities |
| **Labyrinth Blueprints** | Graph visualiser — how GraphRAG connected an anomaly to an SOP | 4 + 5 — Ingestion & retrieval |

The mythology is not decoration. Daedalus built the Labyrinth and kept its
plans; Ariadne's thread is what let Theseus retrace his path out of it; the
forge is where Daedalus made things. Each name describes what its module
actually does, which is the only reason to keep them.

---

## 0. What these three have in common

All three are **read-only windows onto work the system has already done.**
None of them can send a query, none can reach the plant, and only one of them
writes anything at all.

Four rules they all follow:

1. **Floating windows, not routes.** Each opens in the shared
   `FloatingWindow` shell — draggable, resizable, with Peek. The same call as
   Data stores, and for the same reason: all three are things you consult
   *while* looking at something else. Ariadne's Thread in particular is read
   against the chat that produced it, and a full-screen takeover would hide the
   thing you are checking.
2. **They read the audit store, they do not re-derive.** Every number these
   modules show comes from a row that was already written by the orchestrator.
   A module that recomputed anything would be a second source of truth, and the
   whole point of Layer 10 is that there is one.
3. **Rule 5 applies to the Forge.** *Setup tools are not runtime tools.* The
   Forge writes model configuration and pulls models; that surface must be
   unreachable from the chat path, and its endpoints must not be callable by
   the orchestrator.
4. **Honest empty states.** All three depend on work that is not built (M5, M7,
   M2, M6). Each must say *"nothing has been recorded yet, because the
   orchestrator isn't wired"* rather than rendering a plausible-looking empty
   chart. A blank dashboard that looks broken is worse than one that explains
   itself.

### 0.1 Do these overlap with the sidebar's Data stores section?

Worth answering directly, because one of them genuinely does touch the same
rows, and "why do you have two things reading the same table" is a fair
question to be asked.

| | Data stores | The three modules |
|---|---|---|
| **Axis** | One **table** at a time | One **question** / one **machine** / one **corpus** |
| **Shape** | `SELECT * FROM tool_logs ORDER BY rowid` | `trace(query_id)` — seven tables joined on one key |
| **Interpretation** | None. Raw cells, truncated at 4000 chars | The point. Causal ordering, latency waterfall, groundedness verdict |
| **Answers** | "Is anything being written? What do the columns look like?" | "Was *this answer* grounded, and what produced it?" |

**The Forge:** no overlap. Hardware detection, Ollama management and benchmarks
are not in any store. Its benchmark runs write `model_logs`, which Data stores
can then show as raw rows — that is the normal relationship between a writer and
the raw viewer, not a duplication.

**Labyrinth Blueprints:** no overlap under the recommended storage decision
(§3.4). If the graph were instead put in SQLite, its `nodes`/`edges` tables
would become browsable in Data stores as raw rows — and that would still not
replace traversal replay, which is a rendering of a *path through* those rows.

**Ariadne's Thread: yes, the same seven tables.** This is the one real overlap,
and it is deliberate. `audit_store.trace()` already exists in the backend
*precisely because* the per-table view cannot answer the question it answers:
the seven tables are keyed on `query_id` specifically so one question can be
reassembled across them, and no amount of paging through `tool_logs` one table
at a time reconstructs that. Data stores is the debugging view — *is the
orchestrator writing anything at all?* Ariadne's Thread is the product view.

The test for whether that stays honest: **the Thread must never show anything
Data stores could show as well.** The moment it becomes a nicer table browser,
it has no reason to exist and should be deleted in favour of the raw view. Its
justification is the join, the ordering and the verdict — nothing else.

---

## 1. Ariadne's Thread — provenance

> *"Prove this answer was grounded."*

### 1.1 What it is

The thread you follow back out of the maze. Given any answer the system has
produced, Ariadne's Thread shows the complete chain that produced it — question
→ intent → tools → evidence → model → answer — and states, as a checkable
verdict, whether every number in the answer came from that evidence.

This is the single most valuable of the three, because **it is the demonstration
of the thesis.** The project's claim is "the model never invents numbers"
(Rule 3). This module is the artefact that shows it, one query at a time.

### 1.2 Why it is buildable first

The schema already exists and is already correct. `backend/app/db/audit_store.py`
defines seven tables all keyed on `query_id`, and `trace(query_id)` already
returns every row across all seven:

| Table | One row per | What the Thread reads from it |
|---|---|---|
| `conversation_logs` | user question | intent, selected tools, model, response, `grounded_flag`, total latency |
| `tool_logs` | tool invocation | tool name, input JSON, output summary, status, latency |
| `rag_logs` | retrieval | track (`vector` \| `graph`), chunk ids, scores, source files, **hop count** |
| `model_logs` | model call | prompt/completion tokens, time-to-first-token, inference ms |
| `error_logs` | failure | component, level, type, message, stack |
| `feedback_logs` | user rating | the evaluation signal (Method A, §9.3) |
| `memory_logs` | context assembly | what history was replayed into the prompt |

Nothing writes to these yet — that is M5. **The UI can be built now against a
seeder** that produces realistic traces, the same way `POST /api/system/seed-demo`
already seeds sensor telemetry. Build the viewer first and the orchestrator
lands into a surface that can already inspect it.

### 1.3 The two views

**A. Inline trace — attached to a chat message.** A collapsed strip under each
assistant reply: `3 tools · 1.8s · grounded`. Expanding it reveals the
Thought → Action → Observation steps for that turn without leaving the chat.
This is the everyday affordance.

**B. The Thread workspace — the nav item.** A two-pane surface for looking at
traces properly:

```
┌─ recent queries ──────┬─ the thread ────────────────────────────────┐
│ q_20260914_0042       │  ▸ QUERY      "Why did CO₂ spike at 10:00?" │
│   ✓ grounded  1.8s    │  ▸ INTENT     mixed_query        (2ms)      │
│ q_20260914_0041       │  ▸ TOOL       get_trend          (34ms) ✓   │
│   ⚠ ungrounded 2.4s   │  ▸ TOOL       get_anomaly_summary(12ms) ✓   │
│ q_20260914_0040       │  ▸ RETRIEVAL  rag_retrieve k=5   (180ms)    │
│   ✓ grounded  0.9s    │  ▸ MODEL      qwen3:1.7b  412 tok (1.4s)    │
│ …                     │  ▸ ANSWER     + groundedness check          │
└───────────────────────┴─────────────────────────────────────────────┘
```

Each step is a row with a latency bar, so the waterfall reads at a glance —
"the model was 78% of this query" is a conclusion you want visible without
arithmetic. Steps expand to their full payload: tool input JSON, retrieved
chunk text with scores, the assembled prompt.

### 1.4 The groundedness check — the part that matters

Everything above is a log viewer. This is what makes it Ariadne's Thread.

For a given trace, extract every numeric literal from
`conversation_logs.response_text`, and check each against the values present in
that query's `tool_logs.tool_output_summary` and `rag_logs` chunk text. Render
the answer with each number marked:

- **green** — this figure appears in the evidence, here is the row it came from
- **red** — this figure appears in no tool output. **A Rule 3 violation.**
- **grey** — not a measurement (a year, a step number, a page reference)

```
"At around 10:00 the CO₂ reading increased sharply from 420 ppm to 980 ppm.
                                                       ^^^green      ^^^green
 The database records an anomaly flag during this period. The SOP suggests
 checking NDIR calibration and gas flow."
                                                    [SOP_NDIR_Calibration.pdf p.4]
```

Two things to be honest about in the report:

- **This is a heuristic, not a proof.** Numeric-token matching catches the
  failure mode that matters (a fabricated sensor value) and will miss others (a
  correct number attached to the wrong sensor, a fabricated causal claim with no
  numbers in it). Say so. It is a *detector*, and `hallucination_flag` remains
  the human-labelled ground truth.
- **Rounding and units.** 470.23 rendered as "470.2" must match. Compare
  numerically with a tolerance, not as strings, and normalise units before
  comparing.

This check is also what should populate `conversation_logs.grounded_flag`
automatically, so the hallucination-rate metric in §9.2 has a machine-computed
first pass rather than needing every query hand-labelled.

### 1.5 API

| Method | Path | Returns |
|---|---|---|
| `GET` | `/api/trace` | Recent queries — `query_id`, timestamp, truncated query, intent, grounded flag, latency. Paged, filterable by session, intent, grounded/not |
| `GET` | `/api/trace/{query_id}` | The full trace. Thin wrapper over the existing `audit_store.trace()` |
| `GET` | `/api/trace/{query_id}/groundedness` | The number-by-number verdict for that answer |

All read-only, all served from `ai_logs.db`, none on the chat path.

### 1.6 Dependencies and risks

| | |
|---|---|
| **Blocked by** | M5 (orchestrator writing rows). Viewer buildable now against a seeder |
| **Unblocks** | §9.2 hallucination-rate metric; the "glass box" demo; Method A evaluation (§9.3) |
| **Risk** | Ephemeral/incognito sessions must never appear here. TODO already carries "suppress `user_query`/`response_text` for ephemeral sessions" — the Thread is the surface that makes getting this wrong visible and embarrassing |
| **Risk** | A trace can be large (retrieved chunk text especially). Page the steps; truncate cell content as `log_browser.py` already does at 4000 chars |

---

## 2. The Forge — hardware & model console

> *"Which model can this machine actually run, and how fast — measured, not
> estimated."*

### 2.1 What it is

Where the model is shaped to fit the machine. This is `PROJECT.md` §8.2 in full,
which is itself the merge of `research/05` (llmfit-inspired fit tool) and
`architecture/11` (Model Selector Console) into one deliverable.

§8.2 specifies six functions. The Forge is those six with a face:

| # | Function | Detail |
|---|---|---|
| 1 | **Detect** ✅ **built** | RAM, CPU, GPU/VRAM, disk, Ollama version. `psutil` + `pynvml`/`nvidia-smi`, every probe independently guarded — `services/hardware.py`, `GET /api/forge/hardware` |
| 2 | **Estimate** | `≈ (params_B × bytes_per_param) + kv_cache + ~0.5–1GB runtime`. Q4_K_M ≈ 0.5–0.6 B/param · Q8_0 ≈ 1.0 · FP16 ≈ 2.0 |
| 3 | **Score** | fit / speed / quality / context → `safe` \| `marginal` \| `will_not_fit` |
| 4 | **Manage** | Ollama list / pull / delete. A local API call, so Rule 1 permits it |
| 5 | **Benchmark** | Time-to-first-token, tok/s, end-to-end latency on a **RAG-context-sized** prompt |
| 6 | **Commit** | Write the choice to `config/model_config.json` for FastAPI to consume — never hardcoded |

### 2.2 The design decision that matters: estimates are placeholders

§8.2 says it plainly — *"measured numbers replace estimates in the final report.
That directly satisfies Objective 3 with evidence rather than projection."*

So the Forge must never let an estimate and a measurement look alike. Every
model row carries both, and they are visually distinct:

```
 Model              Size   Fit (estimated)      Measured
 ─────────────────────────────────────────────────────────────────────
 qwen3:1.7b-q4_K_M  1.1GB  ● safe    ~2.1GB     412ms TTFT · 41 tok/s
 phi3:mini-q4_K_M   2.3GB  ● safe    ~3.4GB     ⟳ not benchmarked
 qwen3:8b-q4_K_M    4.7GB  ◐ marginal ~6.2GB    ⟳ not benchmarked
 llama3.1:8b-fp16   16GB   ○ will not fit       —
```

"Not benchmarked" is a first-class state, not a blank. The whole value of this
module to the report is the gap between the estimate column and the measured
column, and how it closes as you work through it.

### 2.3 Benchmark on a RAG-sized prompt, not a toy one

§8.2 is specific about this and it is easy to get wrong. Raw tok/s on a
20-token prompt tells you nothing about this system's latency: real queries
arrive with an evidence pack — several retrieved chunks plus replayed
conversation history — so the prompt is typically 1–3k tokens. Prefill
dominates time-to-first-token, and TTFT dominates *perceived* latency.

The benchmark must therefore run against a **representative evidence pack**, not
a canned sentence. Build one from real `rag_logs` rows if any exist, from a
fixture if not, and record which was used alongside the result.

Every benchmark run writes to `model_logs` with a synthetic `query_id`, so the
latency chapter of the report draws from the same table as live traffic and the
two are comparable.

### 2.4 What already exists

**Step 1 is built.** `backend/app/services/hardware.py` detects CPU model and
core counts, total/available RAM, swap, GPU and VRAM, free disk where models
land, and the Ollama version. It is rendered by `HardwareView`, which is shared
between Settings → Hardware and the Forge window — one component, so the two
can never quote different numbers, which matters when one of them ends up in
the report.

Three decisions in that module worth keeping:

- **Never raises.** No GPU, no `nvidia-smi`, no Ollama and a restricted `/proc`
  is a normal machine. Every probe is guarded independently and reports what it
  could not determine. A hardware panel that 500s because there is no NVIDIA
  card is worse than useless.
- **Disk is measured where models land**, not at `/`. On a small root with a
  large home, the root figure answers the wrong question.
- **The Ollama probe falls back to localhost.** `OLLAMA_BASE_URL` is
  `host.docker.internal` so the container can reach the host, and that does not
  resolve when `./daedalus.sh dev` runs the backend on the host itself. Without
  the fallback the panel reports a false "not reachable" in the mode most
  development happens in. The response says which URL actually answered.

**Also already built, and absorbed by the Forge rather than duplicated:**

| Built | Where |
|---|---|
| `GET /api/system/models` — Ollama models + cloud baselines, aggregated | `backend/app/api/system.py` |
| Cloud endpoint store — provider catalogue, base URL + key, connection test | `services/model_endpoints.py` |
| "Added Models" settings panel | `components/settings/ModelEndpointsPanel.tsx` |

The Forge absorbs the "Added Models" panel rather than duplicating it. Cloud
endpoints belong here too — as the **offline benchmark reference tier** they
are, clearly separated from the deployable local tiers, so nobody can read the
console as offering a cloud model for production.

### 2.5 API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/forge/hardware` | RAM, CPU, GPU/VRAM, disk, Ollama version |
| `GET` | `/api/forge/models` | Catalogue with estimate, fit score and last measurement |
| `POST` | `/api/forge/models/pull` | Pull via Ollama. SSE progress — a 5GB pull needs a progress bar |
| `DELETE` | `/api/forge/models/{name}` | Remove a local model |
| `POST` | `/api/forge/benchmark` | Run a benchmark; writes `model_logs` |
| `PUT` | `/api/forge/active-model` | Commit the choice to `model_config.json` |

### 2.6 Dependencies and risks

| | |
|---|---|
| **Blocked by** | M4 (Ollama wired). Detection, estimation and scoring are buildable now — they need no model to run |
| **Unblocks** | Objective 3 with measured evidence; the model-tier table in §8.1 stops being a projection |
| **Risk — Rule 5** | This surface writes config and pulls models. It must be unreachable from `/api/chat`, and the orchestrator must never call a `/api/forge/*` endpoint. State this in the report; it is exactly the setup-vs-runtime distinction Rule 5 exists to draw |
| **Risk** | `pynvml` is absent on machines with no NVIDIA GPU. Detection must degrade to "no GPU detected" rather than failing the whole endpoint — the same optional-import discipline `vector_store.py` already uses for Chroma |
| **Risk** | A pull is long and cancellable. Do not block a worker on it |

---

## 3. Labyrinth Blueprints — the knowledge map

> *"What does this system actually know, and how is it connected?"*

### 3.1 What it is

Daedalus's plans for the maze. Two halves, both answering "what is in the
knowledge layer":

**A. The corpus (Layer 4).** Every ingested document — source file, type,
version, page count, chunk count, embedding status, ingestion date. Drill into
a document to see its chunks with their metadata (`source_type`,
`reactor_mode`, `document_version`) and the text as the retriever sees it.

**B. The graph (Layer 5, Track 2).** The hand-authored knowledge graph from
§5 — 7 node types and 7 edge types:

| Nodes | Edges |
|---|---|
| `Sensor` · `OperatingMode` · `Threshold` · `SOPDocument` · `SOPStep` · `AnomalyRecord` · `AnomalyType` | `MONITORED_IN` · `HAS_THRESHOLD` · `TRIGGERS` · `RESOLVED_BY` · `CONTAINS` · `INSTANCE_OF` · `INVOLVES` |

Browse it as a list, search it, and see any node with its neighbours.

### 3.2 The feature that earns the module: traversal replay

A static graph browser is mildly useful. **Replaying a traversal is the
deliverable.**

Take any `query_id` whose `rag_logs.track = 'graph'`. That row already records
`retrieved_chunk_ids` and `hop_count`. Replay the walk the agent actually took —
highlighting each node and edge in sequence, hop by hop, with the agent's
sufficiency check between steps:

```
hop 1   Sensor(pressure) ──HAS_THRESHOLD──▶ Threshold(P > 2.5 barg)
        Sensor(temp)     ──HAS_THRESHOLD──▶ Threshold(T > 80°C)
        ▸ sufficient? no — no procedure found yet

hop 2   both Thresholds ──TRIGGERS──▶ AnomalyType(thermal_runaway_risk)
        ▸ sufficient? no — need the procedure and the history

hop 3   AnomalyType ──RESOLVED_BY──▶ SOPDocument(Emergency_Cooldown.pdf)
        AnomalyType ◀──INSTANCE_OF── AnomalyRecord ×3  (Aug 14, Sep 02, Sep 11)
        ▸ sufficient? yes
```

This is the §10.2 "graph visualiser" requirement, and it is the **only** view in
the system that makes the dual-track comparison visible rather than statistical.
The comparison chapter will report that GraphRAG won or lost on multi-hop causal
queries by some margin; this is the figure that shows a reader *why* — flat
retrieval embeds that whole question and hopes one chunk covers it, and here is
the structural walk that did not have to hope.

### 3.3 It makes the graph's failure mode visible

§5 lists an honest risk of Track 2: *"silent failure when a relationship was
never authored."* A hand-authored graph fails by omission, and omission is
invisible from the answer side — you get a worse answer with no indication why.

Blueprints is where that stops being invisible. Two views specifically for it:

- **Orphans** — nodes with no edges, or an `AnomalyType` with no `RESOLVED_BY`.
  Each one is a question the graph cannot answer.
- **Coverage** — which `Sensor`s have `Threshold`s, which `AnomalyType`s have a
  resolving SOP. A coverage table is a to-do list for graph authoring.

That is worth a paragraph in the report on its own: the comparison is only fair
if Track 2's corpus is as complete as Track 1's, and this is how that gets
checked rather than assumed.

### 3.4 Open decision — where the graph lives

`research/03-agentic-graphrag-spec.md` discusses storage options and this is
**not yet decided**. It gates the module's API, so it needs deciding before
building:

| Option | For | Against |
|---|---|---|
| SQLite tables (`nodes`, `edges`) in a sixth store | Consistent with the five-store model; migrations already exist; trivially browsable | Multi-hop traversal in SQL is recursive CTEs — writable, but awkward |
| NetworkX in memory, authored from JSON/YAML on disk | Traversal is a library call; the authored file is diffable in git | Another representation to keep in sync; rebuilt at every boot |
| An embedded graph DB | Purpose-built traversal | A sixth engine to justify against §6.4's store-separation argument, and a dependency Rule 1 must vet |

My recommendation is **NetworkX over a git-tracked YAML source of truth.** The
graph is small (tens of nodes), hand-authored, and changes by editing rather
than by insert — so the file *is* the authoring surface, it reviews in a pull
request, and Blueprints renders it. It also keeps the store count at five,
which §6.4 spends real effort defending.

### 3.5 API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/graph/schema` | Node and edge types with counts — drives the legend |
| `GET` | `/api/graph/nodes` | Search and filter by type |
| `GET` | `/api/graph/nodes/{id}` | One node with its neighbours |
| `GET` | `/api/graph/traversal/{query_id}` | The walk taken for that query, hop by hop |
| `GET` | `/api/graph/coverage` | Orphans and unresolved types |
| `GET` | `/api/corpus/documents` | Ingested documents with chunk and embedding counts |
| `GET` | `/api/corpus/documents/{id}/chunks` | Chunks with metadata and text |

### 3.6 Rendering, under Rule 1

A force-directed graph needs a layout library. **It must be bundled, not loaded
from a CDN** — Rule 1, and the same reasoning that put Monocraft in
`src/assets/fonts/` rather than on `fonts.googleapis.com`. `d3-force` or
`cytoscape` from npm is fine; Vite bundles it into `/assets` and it works
air-gapped.

Provide a **table view alongside the canvas.** A node-link diagram of 60 nodes
is a hairball, and for "show me every `AnomalyType` with no resolving SOP" a
table is simply the better answer. The graph is for the traversal replay; the
table is for everything else.

### 3.7 Dependencies and risks

| | |
|---|---|
| **Blocked by** | M2 (ingestion) for the corpus half; M6 Track 2 for the graph half. **The most blocked of the three** |
| **Unblocks** | The comparison chapter's qualitative figure; graph-authoring coverage checks |
| **Risk** | Depends on a track that may be descoped. If Track 2 slips, the corpus half still stands alone and is still worth having |
| **Risk** | Traversal replay needs the agent to *record* its path. `rag_logs.hop_count` exists but the path itself does not have a column — **add one to the `rag_logs` schema now**, while it is a migration nobody has to coordinate, rather than after rows exist |

---

## 4. Sequencing

Build in value order, which is also dependency order:

| Order | Module | Buildable now? | Why this position |
|---|---|---|---|
| 1 | **Ariadne's Thread** | **Yes** — against a trace seeder | Schema exists and is correct. It is the demonstration of the project's central claim, and the orchestrator lands into a ready-made inspector |
| 2 | **The Forge** | **Partly** — detect/estimate/score need no model | Self-contained, no dependency on retrieval, and produces the measured numbers Objective 3 needs. Good work to do while M5 is in flight |
| 3 | **Labyrinth Blueprints** | **No** — needs M2, and Track 2 for the graph half | Most blocked, and most likely to change shape as Track 2 is built. Building it early means building it twice |

**One thing to do immediately, regardless of order:** add a traversal-path
column to `rag_logs`. It costs one migration today and is a data-loss problem
later — traces written before the column exists can never be replayed.

**And one small thing now:** the three buttons should stop lying. The settings
registry already has an `implemented` flag that renders a dot and says "not
built yet" rather than opening a dead page. Applying the same treatment to these
three costs very little and means nobody — examiner included — clicks a button
that does nothing.

---

## 5. Where this sits in the docs

This file is **design**, and therefore subordinate to `PROJECT.md` in the
precedence order in [`README.md`](README.md). Nothing here overrides §10.2; it
elaborates it. Where this document and `PROJECT.md` disagree, `PROJECT.md`
wins and this file is wrong.

Implementation detail, once any of this is built, belongs in
[`FEATURES.md`](FEATURES.md) — which describes what exists, not what is
intended.
