# Code map — which code does what

A guide for explaining Daedalus: the shape of the system, then every feature
with the exact files behind it, from the screen down to the database. Paths are
relative to the repository root. `FEATURES.md` describes behaviour in depth;
this file says *where* each thing lives.

---

## 1. The system in one picture

```
 ┌──────────────────────────── Browser ─────────────────────────────┐
 │  React + TypeScript (frontend/src)                               │
 │  Chat · Ariadne's Thread · The Forge · Labyrinth Blueprints      │
 │  Settings · Data stores · Error pages                            │
 │        │  lib/*Client.ts  (one typed client per backend area)    │
 └────────┼─────────────────────────────────────────────────────────┘
          │ HTTP / JSON, plus two streams (chat tokens, live events)
 ┌────────▼──────────────── FastAPI (backend/app) ──────────────────┐
 │  api/        thin HTTP routes: validate input, call a service    │
 │  services/   the logic: chat pipeline, retrieval, Forge, …       │
 │  db/         one module per store; schema migrations             │
 └────────┬───────────────────────┬─────────────────────┬───────────┘
          │                       │                     │
  ┌───────▼────────┐    ┌─────────▼────────┐   ┌────────▼────────┐
  │ 5 SQLite files │    │ ChromaDB         │   │ Ollama          │
  │ sensor, audit, │    │ (vectors,        │   │ (local models,  │
  │ chat, corpus,  │    │  embedded)       │   │  on this host)  │
  │ prefs          │    │ + graph YAML     │   │                 │
  └────────────────┘    └──────────────────┘   └─────────────────┘
```

**Rules the whole design follows** (`docs/PROJECT.md` §3):

1. Fully local: no answer depends on the internet.
2. Read-only toward the reactor: the sensor database is opened read-only.
3. The model never invents a number: every figure must come from a tool.
4. Everything an answer depended on is logged, under one `query_id`.

---

## 2. The layers, and how a request travels

| Layer | Folder | Job | Example |
|---|---|---|---|
| Screen | `frontend/src/components/` | Render and react to the user | `thread/ThreadWindow.tsx` |
| Client | `frontend/src/lib/*Client.ts` | Typed calls to one backend area; no UI | `lib/threadClient.ts` |
| Shared fetch | `frontend/src/lib/http.ts` | Timeouts, error status, streaming | `request()` |
| Route | `backend/app/api/*.py` | HTTP in and out, input validation | `api/thread.py` |
| Service | `backend/app/services/` | The actual logic | `services/thread/` |
| Store | `backend/app/db/*_store.py` | SQL for one database | `db/audit_store.py` |
| Schema | `backend/app/db/migrations/<store>/*.sql` | Versioned tables | `audit/010_model_logs_prompt_hash.sql` |

A request goes down that table and back up. Each layer only calls the one
below it, and dependencies only point downward (a service never imports a
route). Everything the app starts with is in `backend/app/main.py` (FastAPI app,
routers, start-up migrations) and `frontend/src/routes/__root.tsx` (the shell:
sidebar, windows, shortcuts).

---

## 3. The databases

All of them are files on this machine. Paths are set in `backend/app/db/paths.py`
(overridable by environment; `daedalus.sh` points them at the repository root)
and every connection goes through `db/sqlite_util.py` (pragmas, transactions,
retry, read-only mode).

| Store | File | Holds | Module | Written by | Read by |
|---|---|---|---|---|---|
| **Sensor** | `data/sqlite/sensor_readings.db` | Reactor telemetry (temperature, pressure, pH, level, CO₂) | `db/sensor_store.py` | The reactor's own software — **never Daedalus** (opened read-only) | Sensor tools |
| **Audit** | `logs/ai_logs.db` | Seven log tables, all keyed on `query_id`: conversation, tool, rag, model, error, feedback (ratings and labels), memory | `db/audit_store.py` | The chat pipeline, every turn | Ariadne's Thread, evaluation, Data stores |
| **Chat** | `data/sqlite/chat.db` | Sessions and messages (the transcript the user owns), each answer's evidence pack | `db/chat_store.py` | `services/chat_service.py` | The chat, the Thread |
| **Corpus** | `data/sqlite/corpus.db` | Uploaded documents, their chunks, ingest runs (with chunk size/overlap), events | `db/corpus_store.py` | `services/ingestion.py` | Track 1 search, Blueprints, the Thread |
| **Preferences** | `backend/data/prefs.db` | Settings: theme, keybinds, assistant, Thread settings, … | `db/prefs_store.py` | Settings panels | Everything that reads a setting |
| **Vectors** | `data/chroma/` | Chunk embeddings, one collection per embedding model | `db/vector_store.py` | Ingestion | Track 1 search |
| **Knowledge graph** | `config/knowledge_graph.yaml` once authored; until then the seed in `backend/app/data/graph/knowledge_graph.yaml` | Track 2's nodes and edges (sensors, thresholds, SOPs, steps) | `services/knowledge_graph.py` | Blueprints → Track 2 → Build | Track 2 search |
| Small stores | `search`, `mcp`, `model_endpoint`, `tool_policy` `_store.py` | Web-search providers, MCP servers, cloud endpoints, tool on/off | `db/*_store.py` | Their Settings panels | Their services |

**Schema changes** are numbered SQL files per store in
`backend/app/db/migrations/<store>/`, applied in order by `db/migrations.py` at
start-up (and by `python -m app.db.migrate`). A store never changes shape
without a migration.

**Config files** in `config/`: `model_config.json` (the chosen chat model),
`rag_config.json` (which track answers, frozen or not), `embedding_config.json`,
`corpus_config.json` (chunking, once changed), `eval/queries.yaml` (the
evaluation question set), `searxng/` (the optional search container's template).
Catalogues that ship with the code are in `backend/app/data/`
(`model_catalogue.json`, `embedding_catalogue.json`, the graph seed).

---

## 4. Feature by feature

Each block lists the files from top (screen) to bottom (store), then its tests.

### 4.1 Chat — answering a question (the core)

What happens when you press Send, in order (`PROJECT.md` §7.1's eleven steps):

| Step | What | File |
|---|---|---|
| 1 | Normalise the text | `services/query_pipeline/normaliser.py` |
| 2 | **Safety guard**: refuse control or data-changing requests before anything runs | `services/query_pipeline/safety.py`, `vocabulary.py` |
| 3 | Rewrite a follow-up into a standalone question | `services/query_pipeline/condense.py` |
| 4 | Classify the intent (live reading, trend, document, …) | `services/query_pipeline/intent.py` |
| 5 | Resolve times ("this morning", "at 10:00") | `services/orchestration/timeparse.py` |
| 6 | Plan which tools to call | `services/orchestration/planner.py` |
| 7 | Call them through the gated registry | `services/orchestration/executor.py`, `services/agent_tools/registry.py` |
| 8 | Build the evidence pack (labelled lines S1, D1, G1) and the prompt | `services/orchestration/evidence.py`, `prompt.py` |
| 9 | Stream the model's answer from Ollama | `services/inference.py`, `services/ollama_client.py` |
| 10 | **Validate**: every number, time, citation and cause checked against the evidence; a failure is replaced by a fixed fallback | `services/orchestration/validator.py`, `numbers.py` |
| 11 | Log everything under one `query_id`; store the turn | `db/audit_store.py`, `services/chat_service.py` |

Around it: the conversation window and rolling summary (`services/chat_service.py`,
`summariser.py`, `token_calibration.py`), chat titles (`session_titles.py`),
which model answers (`model_config.py`, `background_models.py`).

- **Screen:** `components/ChatInterface.tsx` (transcript and composer),
  `components/AnswerMarkdown.tsx` (an answer as Markdown, with chips applied
  inside the text), `components/Citations.tsx` (citation chips, reading
  highlights, the evidence list), `contexts/SessionsContext.tsx` (chats,
  messages, sending, ratings)
- **Client:** `lib/chatClient.ts`, `lib/sessionsClient.ts`
- **Routes:** `api/chat.py` (send, stream, rate), `api/sessions.py` (chats)
- **Stores:** chat, audit, sensor (read-only)
- **Tests:** `backend/tests/chat/` (the whole path with a fake Ollama, safety,
  summary, titles), `backend/tests/tools/` (planning, evidence, validation)

### 4.2 The tool layer (what the model is allowed to use)

Tools are deterministic functions the planner calls; the model never touches a
database itself. Every call passes the registry's gates (allowed, enabled,
arguments valid, read-only) and is logged.

- **Registry and gates:** `services/agent_tools/registry.py`
- **Tools by kind:** `sensor.py` (readings, trends — read-only), `knowledge.py`
  (document and graph search), `search.py`, `session.py`, `system.py`,
  `other.py`; `extended/` holds the advanced-mode tools (MCP, web, workspace)
- **Settings:** `components/settings/AgentToolsPanel.tsx`, `AgentToolsSimple.tsx`;
  `api/tools.py`; `db/tool_policy_store.py`
- **Tests:** `backend/tests/tools/`

### 4.3 Retrieval — the two tracks being compared

| | Track 1 — vector RAG | Track 2 — graph RAG |
|---|---|---|
| Idea | Find the most similar document chunks | Walk a hand-authored knowledge graph |
| Search | `services/agent_tools/knowledge.py` → Chroma | `services/graph_tools.py`, `graph_agent.py` (the agent picks each hop) |
| Ranking | `services/reranker.py` (cross-encoder re-scores the top N) | — |
| Built from | `ingestion.py` → `extraction.py` → `chunking.py` → embeddings (`embedding_models.py`) | `knowledge_graph.py`, authored in Blueprints |
| Logged as | `rag_logs`: chunk ids, distances, re-rank scores, origins | `rag_logs.traversal_path`: every hop |

Which track answers is `services/rag_config.py` (`config/rag_config.json`); the
comparison can be **frozen** so nothing is tuned after seeing results.

- **Tests:** `backend/tests/retrieval/`

### 4.4 Ariadne's Thread — proving an answer was grounded

Reassembles one answer from the audit log: the ordered steps, what was
retrieved, every number marked green/red/amber against the evidence, and a
person's label (the evaluation's ground truth).

- **Screen:** `components/thread/`
  - `ThreadWindow.tsx` — the window (list, filters, compare)
  - `QueryList.tsx` — questions grouped by chat, foldable
  - `SummaryStrip.tsx` — counts, p50/p95 time, labelled
  - `MoreFilters.tsx` — outcome, track, label, model, dates
  - `TraceView.tsx` — one answer, made of `TraceSteps.tsx`, `RetrievalPanel.tsx`,
    `GroundednessPanel.tsx`, `LabelPanel.tsx`
  - `AnswerPanel.tsx`, `TraceStrip.tsx` — the panel and the line under each chat answer
  - `status.ts`, `StatusIcon.tsx` — names, icons and colours
- **Pure logic:** `lib/threadLogic.ts` (grouping, keyboard navigation, export)
- **Client:** `lib/threadClient.ts`
- **Routes:** `api/thread.py`
- **Service:** `services/thread/` — `listing.py` (status, buckets, figures),
  `trace.py` (steps), `groundedness.py` (number check), `retrieval.py` (chunks or
  walk); `services/thread_settings.py` (Settings → Ariadne's Thread)
- **Settings:** `components/settings/ThreadPanel.tsx`
- **Stores:** audit (read; labels appended), chat (evidence), corpus (chunk text)
- **Tests:** `backend/tests/thread/`, `frontend/tests/threadLogic.test.ts`

### 4.5 The Forge — models and hardware

Answers "which model can this machine run, and how fast — measured". Six steps:
detect → estimate → score → manage → benchmark → commit.

| Step | Service |
|---|---|
| Detect RAM, CPU, GPU, disk | `services/hardware.py` |
| Estimate memory per model | `services/model_fit.py` |
| Score the fit (safe / marginal / will not fit) | `services/model_fit.py`, `fit_verdict.py` |
| Manage: list, pull, delete | `services/ollama_client.py`, `ollama_registry.py`, `hf_discovery.py` |
| Benchmark: real time-to-first-token and tokens/s | `services/benchmark.py`, `model_usage.py` |
| Commit the choice | `services/model_config.py` |
| Embedding models, re-rankers, cloud baselines | `embedding_models.py`, `reranker.py`, `model_endpoints.py` |
| The model table that joins it all | `services/forge.py` |

- **Screen:** `components/forge/` — `ForgeWindow.tsx` (tabs), `HardwareView.tsx`,
  `ModelsView.tsx` (discover and rank; its card, detail panel, shortlist and
  formatting live in `forge/models/`), `InstalledModelsView.tsx` (manage),
  `EmbeddingModelsPane.tsx`, `RerankersPane.tsx`, `CloudModelsView.tsx`
- **Client:** `lib/forgeClient.ts`, `lib/embeddingsClient.ts`
- **Routes:** `api/forge.py`, `api/embeddings.py`, `api/providers.py`
- **Tests:** `backend/tests/models/`; the method is defended in `docs/MODEL_FIT.md`
  and `docs/BENCHMARK.md`

### 4.6 Labyrinth Blueprints — the knowledge behind both tracks

Shows the *active* track only. Track 1: the corpus and its pipeline. Track 2:
the graph and how it was authored.

| Track · tab | Shows | Screen | Backend |
|---|---|---|---|
| 1 · Build | Upload → extract → chunk → embed → run, step by step | `IngestView.tsx` (the stepper); one file per step in `blueprints/ingest/` (`RunStep.tsx` shows each run and its log) | `services/ingestion.py`, `extraction.py`, `chunking.py`, `corpus_config.py` |
| 1 · Corpus | Documents and their chunks | `CorpusView.tsx` (passages re-joined for display by `lib/passage.ts`) | `api/corpus.py`, `db/corpus_store.py` |
| 1 · Replay | What a vector query returned | `RetrievalView.tsx` | `api/corpus.py` → `services/retrieval_replay.py` |
| 1 · Logs | Every ingest run and each document's history | `IngestLogsView.tsx` | `api/corpus.py`, `db/corpus_store.py` |
| 2 · Build | Add nodes and edges; review the model's proposals | `AuthoringView.tsx`, `ProposalQueue.tsx` | `services/graph_authoring.py`, `graph_proposals.py` |
| 2 · Graph | The graph as a diagram | `GraphView.tsx`, `GraphCanvas.tsx` | `api/graph.py`, `services/knowledge_graph.py` |
| 2 · Coverage | What the graph covers, and what it misses | `CoverageView.tsx` | `services/knowledge_graph.py` |
| 2 · Replay | A graph walk, hop by hop | `TraversalView.tsx` | `api/graph.py` |

- **Window and tabs:** `components/blueprints/BlueprintsWindow.tsx`, `tabs.ts`
- **Client:** `lib/blueprintsClient.ts`
- **Tests:** `backend/tests/retrieval/` (search, origin, prefixes, replay, PDF
  extraction, per-document history), `frontend/tests/passage.test.ts`

### 4.7 Settings

One window (`components/SettingsModal.tsx`); every panel is declared once in
`lib/settingsRegistry.ts` (navigation and search both read it). Panels live in
`components/settings/`; each talks to its own client and route — for example
Assistant: `AssistantPanel.tsx` → `lib/assistantClient.ts` → `api/assistant.py`
→ `services/assistant_settings.py` → prefs store.

### 4.8 Data stores browser

Read-only rows of any allow-listed table, from the sidebar.
`components/stores/StoreWindow.tsx`, `StoreBrowser.tsx` → `lib/systemClient.ts`
→ `api/logs.py` → `services/log_browser.py` (allow-list, read-only connections,
secrets masked).

### 4.9 Error pages

`components/errors/`: one file per HTTP code in `codes/` (title, text, pixel
art, animation), found automatically by `catalogue.ts`. `ErrorPage.tsx` covers
the screen when the app cannot continue; `TabError.tsx` fills one tab or window
that failed to load. See `docs/ERROR_PAGES.md`.

A failed *action* is a toast instead (`components/ui/toast.tsx`), raised by
`lib/http.ts` for any non-GET request; an unexpected server error carries the
`error_id` that `backend/app/main.py`'s catch-all handler logged, so it can be
found in Settings → Process Log. Test: `backend/tests/test_error_reporting.py`.

### 4.10 Live updates

`services/live_events.py` publishes "something changed" (models, corpus, rag,
trace, …) over a server-sent-events stream (`api/events.py`); the browser
subscribes once (`lib/liveEvents.ts`) and views re-read through
`hooks/useLiveRefresh.ts`. No view polls for these.

### 4.11 Evaluation

`services/evaluation.py` runs a frozen question set (`config/eval/`) through the
real chat path per arm (Track 1, Track 2 walk, Track 2 agent) and scores
groundedness, retrieval precision/recall/MRR and latency; `app/cli_eval.py` is
its command line. Results land in the audit store like any turn, so Ariadne's
Thread can open each one. See `docs/EVALUATION.md`. Tests:
`backend/tests/evaluation/`.

### 4.12 Look and feel

Themes (`lib/themes.ts`, `contexts/ThemeContext.tsx`, `components/ThemeModal.tsx`),
the background effect (`lib/canvasEffects.ts`, `components/BackgroundEffects.tsx`),
floating windows (`components/ui/floating-window.tsx`, `hooks/useDraggable.ts`),
the tooltip every hint uses (`components/ui/title-tooltips.tsx`), shortcuts
(`lib/keybinds.ts`, `hooks/useGlobalShortcuts.ts`), the command palette
(`components/CommandPalette.tsx`).

### 4.13 Running it

`daedalus.sh` (setup, dev, start, status, migrate), `sync.sh` (after a pull),
`reset.sh` (rebuild databases), helpers in `scripts/common.sh`. See
`docs/SCRIPTS.md`.

---

## 5. Tests

| Where | Run | Covers |
|---|---|---|
| `backend/tests/` | `python -m unittest discover -s tests -t .` (from `backend/`) | 243 tests in `chat/`, `tools/`, `retrieval/`, `models/`, `evaluation/`, `thread/`, plus `test_error_reporting.py`; index in `backend/tests/README.md` |
| `frontend/tests/` | `pnpm test` (from `frontend/`) | 9 tests: the Thread's pure logic, and PDF passage re-joining |

Backend tests run against throwaway databases and a fake Ollama, so they never
touch real data and need no model.

---

## 6. How the code follows the design principles

Concrete places to point at when asked:

| Principle | Where it shows |
|---|---|
| **Single responsibility** | One store module per database; one service per job (`hardware.py` detects, `model_fit.py` estimates, `benchmark.py` measures); the Thread split into `listing`, `trace`, `groundedness`, `retrieval` |
| **Open/closed** | A new error page is one file in `components/errors/codes/` (nothing registers it); a new tool is one entry in the registry; a new Settings panel is one entry in `settingsRegistry.ts` |
| **Liskov / interfaces** | Every tool returns the same envelope (`ok`, `status`, `data`, `detail`), so the executor and evidence builder treat all tools alike; both retrieval tracks log the same `rag_logs` shape |
| **Interface segregation** | One small typed client per backend area (`threadClient.ts`, `forgeClient.ts`, …) instead of one API object |
| **Dependency inversion** | Routes depend on services, services on stores; tests swap Ollama for `FakeHttpx` and the databases for a temp directory without touching app code |
| **KISS** | Stdlib `unittest` and Node's own test runner (no test frameworks); SQLite files instead of a database server; embedded Chroma; no Docker except the optional SearXNG; the over-engineering audit's 19 cuts (2026-10-07, see §7) |
| **DRY** | One fetch wrapper (`lib/http.ts`); one number extractor used on both the evidence and the answer (`numbers.py`); one error page design used full-screen and per tab |
| **Fail safe** | The validator replaces an unsupported answer with a fixed fallback; logging never breaks a reply; a part that cannot load shows an error page instead of empty data |

Known places still worth tidying are listed under **Known issues** in `TODO.md`.

---

## 7. Kept on purpose

An over-engineering audit (2026-10-02, all 19 cuts done 2026-10-07: unused UI
components and hooks, two unused dependencies, dead functions, Chroma server
mode) left these deliberately in place. Don't re-flag them in a later audit:

- **The theme and background-effects subsystem** (`lib/themes.ts`,
  `lib/canvasEffects.ts`, `components/ThemeModal.tsx`,
  `contexts/ThemeContext.tsx`, `lib/pointerField.ts`, ~3,700 lines) — part of
  the product as designed, with the themed error pages, not scaffolding.
- **`app/cli_eval.py` has no importers** — it is the evaluation CLI entry point
  (`python -m app.cli_eval`).
- **`nvidia-ml-py` alongside the `nvidia-smi` fallback** — measured 13 ms vs
  613 ms under WSL (see `backend/requirements.txt`).
- **`httpx` and `pyyaml` listed explicitly** although chromadb brings them —
  they are imported directly, and a transitive dependency is not a contract.
- **`db/vector_store.py` importing `services/embedding_models`** — lazy and
  documented: it lets every caller open "the current collection" without
  knowing the naming rule. Inverting it means a resolver registered at start-up,
  and a store used before registration would silently open the default
  collection.
