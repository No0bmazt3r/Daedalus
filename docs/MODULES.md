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

§8.2 specifies six functions. The Forge is those six with a face, in three tabs:
**Hardware** (step 1), **Models** (2–5, discovery and ranking) and **Added
Models** (inventory and management). **All six are built.**

| # | Function | Detail |
|---|---|---|
| 1 | **Detect** ✅ | RAM, CPU, GPU/VRAM, disk, Ollama version. `psutil` + `pynvml`/`nvidia-smi`, every probe independently guarded — `services/hardware.py`, `GET /api/forge/hardware`. Runs on a background schedule in three tiers rather than per panel open, and goes dormant when nobody is watching |
| 2 | **Estimate** ✅ | `≈ (params_B × bytes_per_param) + kv_cache + runtime`. Prefers a *measured* weight size wherever one exists: the real bytes on disk for a pulled model, or the size published in the model's Ollama manifest for one that is not. Only the KV cache and the ~0.8GB runtime stay arithmetic — `services/model_fit.py` |
| 3 | **Score** ✅ | fit / speed / quality / context → `safe` \| `marginal` \| `will_not_fit`, judged against **two** memory pools. A model too large for VRAM is *offloaded*, not disqualified: an early single-pool version marked Mistral 7B unrunnable on a machine that runs it fine, which is a recommendation engine refusing to recommend the answer |
| 4 | **Manage** ✅ | Ollama list / pull (SSE, cancellable) / delete. A local API call, so Rule 1 permits it |
| 5 | **Benchmark** ✅ | Time-to-first-token and end-to-end latency from the wall clock; prefill and generation from Ollama's own counters. The two are recorded separately and neither is derived from the other — see §2.3 |
| 6 | **Commit** ✅ | `config/model_config.json`, read on every `POST /api/chat`. `pinned` names a model; `auto` stores the policy "best-scoring installed model on whatever machine reads this". No UI writes it — see §2.7 |

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

Every benchmark run writes to `model_logs` with a synthetic `query_id` prefixed
`bench_`, so the latency chapter of the report draws from the same table as live
traffic and the two are comparable. `source` is what lets an analysis separate
them again, and it has three values, not two:

| `source` | meaning |
|---|---|
| `chat` | a live query on a local model. **The production path.** |
| `chat_cloud` | a live query the operator pointed at a cloud model — a marked override. |
| `benchmark` | a Forge run on this machine's hardware. |
| `benchmark_cloud` | a Forge run against an Ollama cloud tag. Measures *their* hardware. |

`host` (migration `004`) records which service served the run, so cloud rows can
be grouped and a comparison can require the same host.

`benchmark_cloud` is a separate value rather than a flag on `benchmark` so that
any query asking what this machine can do keeps filtering `source = 'benchmark'`
and stays correct unchanged. A cloud run also forces the fixture prompt — the
real pack is genuine plant documents and a cloud call leaves the building — and
its `tokens_per_sec` is **not quotable**: Ollama's cloud returns no engine
counters, so the wall-clock fallback divides by a tiny window and reported a
120B model at 836 tok/s. See [`BENCHMARK.md`](BENCHMARK.md) §7.

**Two clocks, and they must not be mixed.** The first version of this benchmark
derived the generation rate as `completion ÷ (total − TTFT)`, which looks
equivalent to asking the engine and is not: it silently charges the model for
any client-side delay. On a busy machine it reported llama3.2 at 11 tok/s where
Ollama's own counters said 23.9, and made the estimator look 0.38× optimistic
when it was in fact within 3%. Migration `002` therefore adds `prefill_ms`,
`generation_ms` and `load_ms` alongside the wall-clock columns:

| recorded | measured by | answers |
|---|---|---|
| `time_to_first_token_ms`, `total_inference_ms` | the caller's wall clock | what an operator waits through — what §9.2's target is about |
| `prefill_ms`, `generation_ms`, `load_ms` | Ollama's own counters | what the model costs, independent of what else the machine was doing |

A warm-up pass runs before the timed one. Without it the first benchmark of a
model measures disk: cold, llama3.2 reported 22.0s TTFT against 1.2s warm, and
nearly all of that gap was reading 1.9GB of weights off an SSD rather than the
model being slow. `warmed_up` travels with the result so nobody has to guess
which was measured. It is skipped for cloud tags, which have no local weights.

**Reasoning models need the clock started differently.** Ollama streams a chain
of thought in a separate `thinking` field and leaves `response` empty until it
finishes deliberating. Watching only `response` recorded **no TTFT at all** for
qwen3 and gpt-oss — both reasoning models, and both of this project's actual
candidates. The clock now starts on the first generated token of either kind.

The full methodology, including the threats to validity this measurement does
*not* survive, is in [`BENCHMARK.md`](BENCHMARK.md).

### 2.4 Detection, and the three decisions worth keeping

`backend/app/services/hardware.py` detects CPU model and
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
- **The Ollama probe falls back, but only across local aliases.**
  `OLLAMA_BASE_URL` is `host.docker.internal` so a container can reach the host,
  and that does not resolve when `./daedalus.sh dev` runs the backend on the
  host itself. `127.0.0.1` is tried too, because `localhost` resolves to `::1`
  first on a dual-stack machine and Ollama binds IPv4 only — a refused
  connection on a machine where the daemon is running perfectly well. The
  fallbacks are deliberately *not* applied when the configured host is a real
  remote: answering from a local daemon instead would attribute a benchmark to
  hardware that never ran it. Whichever URL answered is cached for the process
  and reported in the response.

**Also already built, and absorbed by the Forge rather than duplicated:**

| Built | Where |
|---|---|
| `GET /api/system/models` — Ollama models + cloud baselines, aggregated | `backend/app/api/system.py` |
| Cloud endpoint store — provider catalogue, base URL + key, connection test | `services/model_endpoints.py` |
| "Added Models" settings panel | `components/settings/ModelEndpointsPanel.tsx` |

The Forge absorbs the "Added Models" panel rather than duplicating it, as the
Cloud pane of the inventory tab. Cloud endpoints belong here — as the **offline
benchmark reference tier** they are, behind their own warning and apart from the
local tiers, so nobody can read the console as offering a cloud model for
production.

### 2.5 The catalogue is a seed, not a closed list

`research/05` scopes the shortlist to six candidates, and that shortlist is what
the report argues about. The console answers a broader question too — *what else
could this machine run?* — from four sources, all scored by the same code
against the same hardware so rows from different sources are comparable:

| source | what it is |
|---|---|
| **Shortlist** | the six from §8.1 |
| **Library** | 31 further Ollama models, every tag verified against the registry |
| **Installed** | whatever is on this disk, scored from the parameter count and quantization Ollama reports for it, declared or not |
| **Hugging Face** | a live GGUF search (`?filter=gguf&expand[]=gguf`), pullable because Ollama takes `hf.co/{repo}:{quant}` directly |

Plus **Custom**: type any tag and get a verdict. Ollama tags resolve through the
registry, `hf.co/...` tags through the Hugging Face API.

This matters for deployment, not just browsing: `model_config`'s `auto` mode
resolves against this table, so pulling a better model moves the system to it
with no edit anywhere.

### 2.6 Three provenances, never blurred

§2.2 asks that an estimate and a measurement never look alike. There turned out
to be three states, not two, and every figure carries which one it is:

| provenance | meaning |
|---|---|
| `declared` | `params × bytes_per_param`, from the catalogue. Nothing has been run |
| `registry` | the real weight size from the model's Ollama manifest — known *before* downloading |
| `measured` | real bytes on this disk plus the real architecture from `/api/show` |

The registry tier was not in the original design. It arrived with tag
verification: the OCI manifest endpoint answers per tag, which both confirms a
tag exists (closing an open caveat — the catalogue had shipped one broken tag)
and reports its size. 46 of 48 rows now estimate from real byte counts.

### 2.7 Step 6 has no panel

A Deployment tab existed and was removed. It set a value the chat composer's own
model picker already sets, and two controls for one decision drift apart.

§8.1 still holds: the model is selected via `config/model_config.json` and never
hardcoded. What went away was the UI, not the mechanism. The file is read on
every `POST /api/chat`, defaults to `auto`, and answers whenever no browser is
choosing — a scripted run, the M8 harness, the first request after a restart.
Pinning is a hand edit, which is the right weight for it: pinning is what makes
an experiment reproducible, and that belongs in a file under version control.

### 2.8 API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/forge/hardware` | RAM, CPU, GPU/VRAM, disk, Ollama version |
| `POST` | `/api/forge/hardware/refresh` | Force a full re-probe, ignoring the schedule |
| `GET` | `/api/forge/models` | The ranked table: catalogue, library and installed |
| `GET` | `/api/forge/huggingface` | Live GGUF search, scored against this machine |
| `GET` | `/api/forge/inspect` | Score one arbitrary tag, Ollama or `hf.co/...` |
| `GET` | `/api/forge/usage` | Per-model runs, tokens and latency (mean/p50/p95) from `model_logs` |
| `POST` | `/api/forge/models/pull` | Pull via Ollama. SSE progress — a 5GB pull needs a progress bar |
| `DELETE` | `/api/forge/models/{tag:path}` | Remove a local model (`:path`, because a tag may contain slashes) |
| `POST` | `/api/forge/benchmark` | Run a benchmark; writes `model_logs` |

`PUT /api/forge/active-model` is gone with the Deployment tab. The serving path
reads `model_config` directly, and `GET /api/chat/model` reports what it
resolved to.

### 2.9 Dependencies and risks

| | |
|---|---|
| **Was blocked by** | M4 (Ollama wired). Detection, estimation and scoring needed no model to run and went first; the serving path landed after, and `POST /api/chat` now reads what this console commits |
| **Unblocks** | Objective 3 with measured evidence; the model-tier table in §8.1 stops being a projection |
| **Open** | The six MMLU figures in `model_catalogue.json` ship `verified: false` with a source URL each, and the UI marks them. Library and discovered models carry none at all: they score from a neutral baseline with the quantization penalty applied, which orders them correctly without claiming a figure nobody measured |
| **Risk — Rule 5** | This surface writes config and pulls models. It must be unreachable from `/api/chat`, and the orchestrator must never call a `/api/forge/*` endpoint. State this in the report; it is exactly the setup-vs-runtime distinction Rule 5 exists to draw |
| **Risk** | `pynvml` is absent on machines with no NVIDIA GPU. Detection must degrade to "no GPU detected" rather than failing the whole endpoint — the same optional-import discipline `vector_store.py` already uses for Chroma |
| **Risk** | A pull is long and cancellable. Do not block a worker on it — it streams as SSE and abandoning the generator closes the upstream read |
| **Risk — measurement** | Deriving one timing from another is how the first benchmark understated a model by half. Wall clock and engine counters are recorded separately and neither is computed from the other (§2.3) |
| **Risk — gated models** | Ollama's `hf.co/` pull does not reliably honour a Hugging Face token, so gated repositories (`meta-llama` and friends) cannot be pulled from here. Public GGUF publishers need no token; the route for gated ones is `huggingface-cli download` then `ollama create` |

---

## 3. Labyrinth Blueprints — the knowledge map

> *"What does this system actually know, and how is it connected?"*

> **Status: both halves are built.** Track 1 has an ingestion pipeline (upload →
> extract → chunk → embed → Chroma, with a preview that writes nothing and a
> per-stage log) and Track 2 has an authoring one (add and delete nodes and
> edges, validated before the file is written, with refused edits kept). §3.9 has
> both. The window
> shows **one** retrieval track — the one answering queries, read from Settings →
> Knowledge Base — and only that track's tabs: Track 1 · Vector holds Corpus,
> Track 2 · Graph holds Graph, Coverage and Replay. The other track is a
> fallback, not a peer. §3.8 has the reasoning and the failure cases.

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

### 3.4 Decided — where the graph lives

**NetworkX over a git-tracked YAML source of truth**, as recommended below —
37 nodes and 48 edges across all 7 node and 7 edge types, loaded by
`services/knowledge_graph.py`, which validates against the declared schema and
**refuses a graph that does not validate** rather than serving a subtly broken
one. A typo'd edge type is not a crash; it is a silent retrieval failure, which
is the failure mode §3.3 is about.

**Two paths, one file.** `backend/app/data/graph/knowledge_graph.yaml` is the
packaged **seed**; `config/knowledge_graph.yaml` is the **authored** copy, and
the loader serves whichever exists. The split is not tidiness — `docker-compose`
mounts `app/` read-only, correctly, since the application source is not
something the application should rewrite. Authoring into the source tree worked
under a bare `uvicorn` and failed in the container, which is the worse of the two
ways round. `config/` is writable *and* git-tracked, so this section's argument
is untouched: the file is still the authoring surface and still reviews in a pull
request, beside `model_config.json` and `rag_config.json`.

The first edit copies the seed across, so a fresh checkout has the full graph
with nothing to set up, and `authoring/status` reports which file is live.

`python -m app.services.knowledge_graph` prints the same schema and coverage
report in the terminal, so the graph can be authored without the UI open.

The options as they were weighed:

| Option | For | Against |
|---|---|---|
| SQLite tables (`nodes`, `edges`) in a sixth store | Consistent with the five-store model; migrations already exist; trivially browsable | Multi-hop traversal in SQL is recursive CTEs — writable, but awkward |
| NetworkX in memory, authored from JSON/YAML on disk | Traversal is a library call; the authored file is diffable in git | Another representation to keep in sync; rebuilt at every boot |
| An embedded graph DB | Purpose-built traversal | A sixth engine to justify against §6.4's store-separation argument, and a dependency Rule 1 must vet |

The reasoning that decided it: the graph is small (tens of nodes),
hand-authored, and changes by editing rather than by insert — so the file *is*
the authoring surface, it reviews in a pull request, and Blueprints renders it.
It also keeps the store count at five, which §6.4 spends real effort defending.

**Track 2 is deliberately embedding-free.** `research/03` §7 specified
`graph_query_natural` as a vector search over node descriptions; it is authored
aliases plus a stdlib fuzzy fallback instead. If both tracks depend on an
embedding model, the comparison cannot separate "the graph structure helped"
from "the embeddings helped", and a reviewer is entitled to ask which one moved
the number. `rag_logs.entry_strategy` records which strategy found the entry
nodes per query, so the report can state this from the data rather than from
this paragraph.

The honest framing is *not* "the graph track needs no model" — it needs a more
capable one, since the model drives traversal (`research/03` §10). It is that
**Track 1 is pinned to an embedding model and Track 2 is pinned to none**:
swapping the embedding model invalidates Track 1's whole index and costs Track 2
nothing, because there is no index.

### 3.5 API

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/graph/schema` | Node and edge types with counts — drives the legend |
| `GET` | `/api/graph/nodes` | Search and filter by type |
| `GET` | `/api/graph/nodes/{id}` | One node with its neighbours |
| `GET` | `/api/graph/traversals` | Recent graph-track retrievals — the replay picker |
| `GET` | `/api/graph/traversal/{query_id}` | The walk taken for that query, hop by hop |
| `GET` | `/api/graph/coverage` | Orphans and unresolved types |
| `GET` | `/api/corpus/documents` | Ingested documents with chunk and embedding counts |
| `GET` | `/api/corpus/documents/{id}/chunks` | Chunks with metadata and text |

All read-only, and the audit store is opened `read_only=True` so the contract is
enforced rather than merely intended. There is deliberately **no "run a
traversal" endpoint**: replay renders a walk that was *recorded*, and performing
one on demand would make this module a second retrieval path with none of Layer
10's logging.

`/api/graph/nodes` returns the edges among the returned nodes alongside them, so
the diagram draws the same set the table lists and the filtering is not done
twice in two places.

The corpus endpoints are wired now against the honest empty state rather than
left unrouted: a 404 reads as a frontend bug, and the point of §0 rule 4 is that
the panel can name *which milestone* it is waiting on.

### 3.6 Rendering, under Rule 1

`d3-force` from npm, **bundled by Vite, never loaded from a CDN** — Rule 1, and
the same reasoning that put Monocraft in `src/assets/fonts/` rather than on
`fonts.googleapis.com`. Drawn as SVG rather than canvas: at tens of nodes the
render cost is irrelevant and SVG gives hover, focus and text selection for
free.

**Table alongside the canvas**, as specified — a toggle, not a preference. They
answer different questions: the diagram shows structure (two Thresholds
converging on one AnomalyType is a shape you see in one glance), the table shows
inventory ("every AnomalyType with no resolving SOP" is a list). Both filter the
same query, so narrowing to one node type narrows the diagram to that type's
subgraph, which is also the cure for the hairball.

Three behaviours worth recording, each fixing something that was wrong:

- **The viewport is fitted to the graph, not fixed to a frame.** A force layout
  spreads to whatever the forces imply and has no idea a frame exists; measured
  on the real graph shape, **16 of 37 nodes fell outside a hard-coded 720x460
  viewBox** and were silently clipped. The viewBox is now computed from the
  nodes' own bounding box, padded for labels and corrected to the drawing area's
  aspect ratio. Wheel zooms about the cursor, the background pans, and Fit
  returns to the whole graph; zoom is clamped to 0.2x-3x of the fitted width so
  a scroll gesture cannot end on an empty screen.
- **The simulation stops.** A force layout that never settles is a screensaver.
  The initial layout runs 300 ticks synchronously, paints once and stops;
  interaction reheats it and a `requestAnimationFrame` loop drives ticks until
  alpha decays. d3's own timer is never used — it would advance the simulation
  without telling React, so neighbours would move in the data and not on screen.
- **Released nodes return home.** Each node's settled position is captured and
  weak `forceX`/`forceY` pull it back, at strength 0.6 — measured against the
  alternatives: 0.3 leaves the layout 20px off, 1.0 makes it rigid enough that
  neighbours stop yielding during a drag. Twelve successive 360px drags left the
  maximum drift at 12.4px after every one, so it does not creep. Pinning a
  released node where it was dropped is the common d3 idiom and wrong here: this
  is a reference figure, not a workspace, so a dropped node is permanent damage
  to a layout somebody is reading.

**The diagram fills the window.** It was a fixed 460px box, so maximizing added
a screen of empty space under it rather than more graph. The canvas now measures
its own frame and takes the leftover height — `min-h-full` on the window body
plus a `flex-1` diagram row, which other tabs simply do not opt into. `vh` would
have been the wrong tool: every panel here lives in a window that is draggable,
resizable and maximizable, so the viewport's height says nothing about how much
room the content has.

A resize adjusts the viewBox's *aspect* rather than re-fitting. Refitting would
discard whatever the reader had zoomed and panned to, and a resize is not a
request to go back to the whole graph — it is a request for more room, so the
horizontal extent and centre are held and the new pixels are spent on more graph.

**Selecting a node answers beside the diagram, not below it.** The detail used
to render in the grid row under a 460px canvas, so clicking a node updated
something entirely off-screen and the click read as doing nothing. It docks to
the right instead — beside rather than floating over, because an overlay
occludes the structure you are reading, which is the whole reason the diagram
exists. The canvas keeps its own `viewBox`, so narrowing it scales the drawing
rather than re-running the layout; there is no jitter on every click. Below the
container breakpoint the two stack again and the panel scrolls itself into view:
a narrow window cannot afford 340px of side panel, but it can afford not to hide
the result.

### 3.7 Dependencies and risks

| | |
|---|---|
| ~~**Blocked by**~~ | ~~M2 for the corpus half; M6 Track 2 for the graph half~~ — **neither, now.** Both halves are built, including the two pipelines that fill them (§3.9). What is outstanding is the *corpus itself* — real manuals and SOPs — which is a document-collection task rather than a milestone this module waits on |
| **Unblocks** | The comparison chapter's qualitative figure; graph-authoring coverage checks |
| **Risk** | Depends on a track that may be descoped. If Track 2 slips, the corpus half still stands alone and is still worth having |
| **Risk — assisted authoring** | The proposer runs a local model over the corpus, and a small model proposes confidently wrong triples. Guarded three ways — ontology-constrained prompting, canonicalisation against existing nodes, and a dry run through the real validator — but the residual risk is a *plausible* proposal that passes all three and is wrong. That is what the verbatim evidence quote is for: the review is checking a sentence, not trusting a model |
| ~~**Risk**~~ | ~~Traversal replay needs the agent to record its path~~ — **done.** Migration `005` adds `traversal_path` and `entry_strategy`, landed before the orchestrator wrote its first row, which was the point: a path is not derivable after the fact. `graph_tools.TraversalPath` records every hop regardless of caller, so the viewer had real replay data before any agent existed |
| **Note** | A hop stores its `from`/`to` node *sets* **and** the pairs actually joined. The sets do not imply the pairings — a hop spanning two Sensors and two Thresholds has four possible pairs and two real ones — so a renderer given only the sets draws edges the graph does not contain. Fixed in the recorder, not guessed at in the renderer |

### 3.9 The two pipelines

Each track gets knowledge a different way, and each now has a surface for it.

**Track 1's panel is a stepper, not a page.** Import → Chunk → Embedding → Run.
The four stages are sequential and dependent — chunk settings mean nothing
without a document, an embedding model cannot be checked against an index that
does not exist, and a run is the consequence of the three decisions above it — so
showing all four at once showed three things you could not act on and gave no
clue which to touch first. Going *back* is always allowed, because adjusting
chunk settings against the preview is inherently repetitive; going *forward* is
gated, and the rail says why rather than just disabling itself.

Step 3 **reports** the embedding model and hands management off to the Forge. It
is a step rather than a footnote because it is the only choice in the flow that
is irreversible with respect to the work — the model is stamped onto the index it
builds, and changing it afterwards invalidates every vector — so the run should
not be reachable without passing it. But pulling, switching and hardware fit
belong to the Forge, which is the model console; a second one inside this panel
would drift until one of them was wrong about what is installed.

**The two tracks mirror each other, tab for tab.** Track 1's single *Corpus* tab
used to be inventory, chunk settings, embedding model and the run all at once —
which made its name wrong: the corpus is the artefact, and most of that screen
was the machinery producing it. Split three ways, each tab has one job and the
name means what it says:

| | Track 1 | Track 2 |
|---|---|---|
| **inventory** — what this arm knows | Corpus | Graph |
| **gaps** — what it cannot answer | — | Coverage |
| **trace** — what one query actually did | Replay | Replay |
| **authoring** — how knowledge gets in | Build | Build |

**Track 1 has no Coverage, and that is a finding rather than a gap.** A
hand-authored graph fails by *omission*, and omission over a fixed schema is
enumerable: an `AnomalyType` with no `RESOLVED_BY` edge is a question the graph
provably cannot answer, and §3.3's report lists exactly those. A vector corpus
has no such list — it returns the top-k nearest chunks for every query, including
ones it knows nothing about, so its failure is a *bad match* rather than a
missing edge and the passages nobody wrote cannot be enumerated. What Track 1 can
report is mechanical (failed extractions, chunks with no vector, documents never
ingested) and those are counts on the Corpus tab, because they are properties of
the corpus rather than a separate question about it. A fourth tab for symmetry
would assert an equivalence that does not hold — and that non-equivalence is one
of the more interesting things the comparison has to say.

Track 1 had no trace at all until now, and that asymmetry *was* a hole in the
project's own claim: a comparison of two retrieval strategies where only one of
them is auditable is not a comparison of two retrieval strategies, and *grounded*
is not a property that can be asserted about an arm nobody can inspect. Replay
shows the query, the passages it returned, the cosine distance each came back at,
and the document each belongs to — enough to check a citation by reading it.

Both replays read `rag_logs` and neither re-runs anything. Re-querying would show
what the index returns *today* rather than what produced that answer, which after
any re-ingest is a quietly different claim.

**One writer, both tracks.** The `rag_logs` row is written at the tool dispatch
boundary rather than inside `search_corpus` and `search_graph`. The two tools are
deliberately separate implementations — that is what makes "which track answered
this" recoverable — but recording them separately would have let the comparison
measure two instrumentation methods as much as two retrieval strategies. Dispatch
already owns `query_id`, the surface and the elapsed time, and a tool cannot
forget to call it. A call with no `query_id` writes nothing: a tool trialled in
Settings is not a query, and a row for one would land in the evaluation set as
though it were.

| | Track 1 · Build | Track 2 · Build |
|---|---|---|
| **Knowledge arrives by** | ingesting documents | somebody authoring nodes |
| **Source of truth** | ChromaDB + `corpus.db` manifest | `config/knowledge_graph.yaml` |
| **Stages** | store → extract → chunk → embed → stamp | validate → write → reload |
| **Log** | `ingest_events`, per stage, level-tagged | `graph_edits`, including refusals |
| **API** | `/api/corpus/*` | `/api/graph/authoring/*` |

**Track 2's Build has an assisted first step.** The model proposes, a person
disposes. `graph_proposals` reads the *ingested corpus*, extracts candidates
under the graph's own fixed schema, canonicalises them against existing ids,
labels and aliases, dry-runs them through the same validator the manual path
uses, and queues what survives. Nothing reaches the YAML without an accept, and
an accept goes through `graph_authoring` — so it is validated and logged to
`graph_edits` identically to a hand edit. The write is the same event; what
differs is who typed it, and that is what the proposal table records.

The literature converges on why this shape works: accuracy is best when a fixed
schema *constrains* extraction and regresses when the constraint is removed
(Feng et al., ontology-grounded KG construction under Wikidata schema). Daedalus
already had the ontology — `NODE_TYPES`, `EDGE_TYPES`, `EDGE_DOMAINS` — and
already enforced it, so the prompt asks which of seven types the text describes
rather than what entities are in it. The surveys' three named failure modes are
each guarded: duplicate entities under different surface forms (canonicalised
before queueing, and separately for edges, which are *not* caught by validation
because re-adding one is a silent no-op), invalid triples (dry-run, queued with
the refusal rather than dropped, so the error rate stays visible), and cost
scaling with corpus size (bounded per run).

The web is deliberately not a source. Rule 5 makes web search a surface for
*finding documents to ingest*; unreviewed external text placed into the graph
would break the provenance claim the queue exists to protect.

**Both are setup surfaces, never runtime tools** (Rule 5). Ingesting writes, and
authoring writes; a model that could add to its own knowledge base could add
something nobody reviewed. That is also the provenance claim that makes
`search_graph` `SYSTEM` integrity rather than `CORPUS` — every node in the graph
was authored by a person and reviews in a diff.

**Chunking is pure, which is what makes it adjustable.** `services/chunking` does
no I/O, so the panel can run the real chunker over the real document at candidate
settings and write nothing. Chunk size and overlap have a large effect on
retrieval and are impossible to reason about as numbers; the preview makes the
question cost a parse instead of an embedding run. Three strategies —
`recursive` (default), `paragraph`, `fixed` — with `fixed` kept deliberately as
the naive baseline, because a retrieval result that improves when you switch away
from it is evidence that structure-aware chunking mattered.

**Embeddings come from the selected model, never from Chroma.** Chroma will embed
text for you with its own bundled MiniLM. Doing so would put MiniLM vectors in a
collection stamped `nomic-embed-text` and make every similarity score meaningless
with nothing on screen to say so. Ingestion passes explicit vectors, and
`search_corpus` passes `query_embeddings` — the same failure on the query side,
where no stamp can catch it.

**Failure is partial and recorded as such.** Embedding runs in batches of 16 and
records the outcome per chunk, so a run that dies at chunk 400 of 900 keeps the
first 399 and `Resume` picks up exactly the rest. Rolling back would discard
minutes of correct work over one bad row; not recording it would produce a corpus
that claims to be complete.

**The authored graph lives in `config/`, not `app/data/`.** `docker-compose`
mounts `app/` read-only — correctly, since the application source is not
something the application should rewrite — so authoring into it worked in a bare
`uvicorn` and failed in the container. `config/` is writable *and* git-tracked, so
§3.4's "the file is the authoring surface and it reviews in a pull request" still
holds exactly. The packaged copy is a seed; the first edit copies it across.

**Validate before write, always.** The candidate graph is built in memory first
and the file is rewritten only if that build succeeded, so a rejected edit leaves
the YAML byte-identical and Track 2 never goes down because of a bad edit. A
typo'd edge type is not a crash — §3.4 — it is a silent retrieval failure, and
catching it at edit time rather than at the next load is the whole point.

---

### 3.8 One track on screen, and what happens when it cannot be read

The window reads `GET /api/rag/config` and renders the tabs of the live track
only:

| Live track | Tabs |
|---|---|
| Track 1 · Vector | Corpus |
| Track 2 · Graph | Graph · Coverage · Replay |

**Why one.** The first build put both tracks at the top as peer buttons, which
asked the reader a question they had no way to answer: two systems on screen,
equally prominent, only one of them responsible for any answer they had seen. A
picker is the wrong shape for a setting that lives in Settings → Knowledge Base
— it reads as *"pick one"* when the choice was already made, and made somewhere
that records it (`config/rag_config.json`, §5's freeze) rather than here. So the
window follows the setting. There is no badge naming the track either: with one
track on screen it separates that track from nothing, and the window's subtitle
already says which arm is live.

**The other track is not reachable at all.** Strictly: no detour, no "inspect the
other one", no off-track banner — there is no off-track state to be in, because
the window renders the live track's tabs and nothing else exists to navigate to.
The command palette filters its Blueprints rows the same way, and the window
refuses a tab belonging to the other arm even if something asks for one by name.

This is the UI half of the rule the tool registry enforces on the model (§7). A
comparison whose arms are separated for the orchestrator and merged for the
operator is separated in the half nobody reads and merged in the half everybody
does.

**The cost, stated.** You author the graph *before* switching to it, so with
Track 1 live there is no way to reach Build or Coverage. That is deliberate, and
the resolution is one setting rather than a second door: switch the track in
Settings → Knowledge Base and Track 2's tabs are what this window is. The switch
is written to a committed file and recorded per query, so "I was working on the
graph" stays a recoverable fact about the run rather than something the window
let you do invisibly.

**Four failures, four answers.** Rule 4 forbids a shared blank page, so each
step of "which track is live" fails distinctly:

| Failure | What the window does |
|---|---|
| Track not read yet | A skeleton tab row at its final height. Guessing a track and correcting it a moment later would swap the whole tab row under the cursor, so nothing is asserted until it is known |
| Config unreadable (backend down, bad JSON) | Names the error and offers Retry. A previously read track is kept and marked stale — a failed *re-read* is not evidence the track changed. If nothing was ever read it shows **neither** arm: guessing here would be the strict rule failing open in the one direction it must not, showing Track 2 *because* the setting that selects a track could not be read |
| Live track not ready | Still what the window shows — readiness is *reported, never enforced*, the same rule `KnowledgeBasePanel` follows. The notice says what it is waiting on and points at the track switch. It does **not** offer the other track's views: that was the detour, and the detour is what made two arms feel like tabs of one thing |
| Track known, view empty | Each view's own `Unavailable`, naming the milestone that owes the data |

Row 3 is the common case while a corpus is still being built: Track 1 is the
declared baseline, so selecting it before anything is ingested gives a Corpus tab
that says what it is waiting on and where to change the track.

---

## 4. Sequencing

Build in value order, which is also dependency order:

| Order | Module | Buildable now? | Why this position |
|---|---|---|---|
| 1 | **Ariadne's Thread** | **Yes** — against a trace seeder | Schema exists and is correct. It is the demonstration of the project's central claim, and the orchestrator lands into a ready-made inspector |
| 2 | **The Forge** | **Partly** — detect/estimate/score need no model | Self-contained, no dependency on retrieval, and produces the measured numbers Objective 3 needs. Good work to do while M5 is in flight |
| 3 | **Labyrinth Blueprints** | ~~**No**~~ — **built, both halves** | This ranking assumed the viewer would be built against a seeder. Building the graph layer *first* unblocked half of it, and the Coverage view turned out to be the tool you author the graph *with* — §3.3 calls a coverage table "a to-do list for graph authoring", which is exactly how it was used. The corpus half followed once M2's pipeline landed, and the module ended up owning both pipelines rather than only viewing their output — see §3.9 for why that is the right place for them |

~~**One thing to do immediately, regardless of order:** add a traversal-path
column to `rag_logs`.~~ **Done** — migration `005`. It cost one migration and
would have been a data-loss problem later: traces written before the column
existed could never have been replayed.

~~**And one small thing now:** the three buttons should stop lying.~~ **Done** —
and now two of the three open. Only Ariadne's Thread still carries the dot.

---

## 5. Where this sits in the docs

This file is **design**, and therefore subordinate to `PROJECT.md` in the
precedence order in [`README.md`](README.md). Nothing here overrides §10.2; it
elaborates it. Where this document and `PROJECT.md` disagree, `PROJECT.md`
wins and this file is wrong.

Implementation detail, once any of this is built, belongs in
[`FEATURES.md`](FEATURES.md) — which describes what exists, not what is
intended.
