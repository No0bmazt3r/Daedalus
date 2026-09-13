# Daedalus — Roadmap

Spec: [`docs/PROJECT.md`](docs/PROJECT.md) · Built: [`docs/FEATURES.md`](docs/FEATURES.md) · Status legend: `[ ]` todo · `[~]` in progress · `[x]` done

> **Critical path:** M1 → M2 → M3 → M4 → M6. M5 and M7 can run alongside.
> Nothing downstream of M3 works until the tool layer is real.

---

## Decisions needed from you

Blocking or scope-shaping — these change what gets built.

- [ ] **Is the PyQt5 tab still a deliverable?** Or does the web dashboard fully replace it? *(decides whether Zone 4 needs two clients)*
- [ ] **Is the 6-candidate vector-DB bake-off still in scope**, on top of the dual-track RAG comparison? *(two benchmark studies may overrun the timeline)*
- [ ] **Does Anson's anomaly subsystem write a column or a table?** *(decides the primary `get_anomaly_summary` path)*
- [ ] **Confirm the lab machine's RAM/GPU** *(gates the entire model-tier decision — M4 can't finish without it)*
- [ ] **Get the real document corpus** — manuals, SOPs, anomaly records, UAUC *(blocks M2 entirely)*
- [ ] **Get a real sensor DB sample** from Jason's ingestion *(blocks M1)*

---

## M1 — Sensor data layer  ▸ Layer 3

Unblocks every data-backed answer.

- [x] `sensor_readings` + `anomaly_records` schema (`docs/PROJECT.md` §6.1)
- [x] Read-only connection helper — `file:...?mode=ro` + WAL, verified to *reject* INSERT/UPDATE/DELETE/DROP
- [x] Seed/fixture generator so development doesn't need the live rig (idempotent)
- [x] Indexes on `timestamp`, `anomaly_status` and `mode`
- [ ] Reconcile the schema against Jason's **real** ingested table
- [ ] Handle missing values, duplicate timestamps, invalid modes, timezone normalisation
- [ ] Tests: concurrent read during an active write · query latency at ~17k rows/day

## M2 — Knowledge ingestion  ▸ Layer 4

Offline pipeline. Never runs during a live query.

- [ ] Collect the corpus into `data/documents/{manuals,sops,anomaly_records,uauc_records}/`
- [ ] Extract text — PDF, DOCX, MD, TXT, CSV/JSON
- [ ] Clean: strip page numbers, repeated headers, corrupt characters; normalise whitespace/headings
- [ ] Chunk 300–500 tokens, ~50 overlap, **section-aware** — never split a safety procedure mid-step
- [ ] Tag metadata: `chunk_id`, `source_file`, `source_type`, `section_title`, `page_number`, `document_version`, `reactor_mode`, `updated_at`
- [ ] Local embeddings via `nomic-embed-text`
- [ ] Freeze `corpus_chunks.json` — **the same chunks and embeddings must feed both tracks**, or the comparison measures chunking instead of architecture
- [ ] Target ≥80 chunks (200+ is stronger)

## M3 — Deterministic tool layer  ▸ Layer 8

The anti-hallucination mechanism. **Highest-value milestone.**

- [ ] `get_live_reading(sensor, timestamp?)`
- [ ] `get_trend(sensor, start, end, aggregation, mode_filter?)` — cap series at 100 points
- [ ] `get_anomaly_summary(start, end, limit)` — table when present, column fallback
- [ ] `rag_retrieve(query, top_k, source_types, reactor_mode?)`
- [ ] Wrap all four as **PydanticAI** typed tools
- [ ] Whitelist sensor names and aggregations; parameterized SQL only
- [ ] Query timeouts + result-size caps; errors that leak nothing internal
- [ ] Tests: **no tool has a write signature** · injection attempts via tool args fail · unknown sensor names are rejected

## M4 — Model provider  ▸ Layer 6

- [ ] Ollama client wrapper with timeout and retry
- [ ] `config/model_config.json` — model never hardcoded in FastAPI
- [ ] Pull and smoke-test the SLM tier: Qwen3 1.7B · Phi-3 Mini 3.8B · Gemma 3 1B (Q4_K_M)
- [ ] Measure time-to-first-token and tok/s on a **RAG-context-sized** prompt, not a bare question
- [ ] Verify inference works with networking fully disabled

## M5 — Orchestration  ▸ Layer 7

The 11-step flow in `docs/PROJECT.md` §7.1.

- [ ] `POST /api/chat` request/response contract
- [ ] Query normaliser
- [ ] Intent classifier — 8 intents
- [ ] **Safety guard** — control intent refused before any tool call or LLM call
- [ ] Tool planner (intent → tool set)
- [ ] Tool executor
- [ ] Evidence pack builder
- [ ] Prompt builder — system instruction + safety rules + evidence + query + citation requirement
- [x] Conversation memory — session store, transcripts, token-budgeted context assembly (`services/chat_service.py`, `docs/PROJECT.md` §7.4)
- [ ] Wire `build_context()` into the prompt builder — summary + history before the evidence block
- [ ] Follow-up condensation — rewrite "and the pressure?" into a standalone query **before** intent classification, and send the *same* rewritten query to both retrieval tracks
- [ ] Background summariser — fold turns that fell out of the budget into `chat_sessions.summary` **after** responding, never on the request path
- [ ] Calibrate `CHARS_PER_TOKEN` against real `model_logs.prompt_token_count` values
- [ ] Response validator — reject numbers absent from evidence, control language, empty, timeout
- [ ] **Validate numbers against the current evidence pack only** — a figure that appears only in replayed history sets `hallucination_flag` (§7.4)
- [ ] SSE streaming for token-by-token output
- [ ] Tests: every unsafe phrasing is refused · a response containing an invented number is caught · a stale number replayed from history is caught

## M6 — Retrieval tracks  ▸ Layer 5

### Track 1 — Traditional vector RAG
- [ ] ChromaDB store + `VectorStoreAdapter` interface
- [ ] Top-k cosine retrieval with metadata filtering
- [ ] Query expansion (LLM rewrites with lab synonyms)
- [ ] Hybrid dense + BM25 search
- [ ] Cross-encoder re-ranking
- [ ] Contextual compression
- [ ] Multi-hop re-retrieval loop
- [ ] Expose `chunk_size`, `top_k`, `similarity_threshold` as config for the ablation table

### Track 2 — Agentic GraphRAG
- [ ] Finalise the node/edge schema against the **real** corpus (§5)
- [ ] Build the graph — manual authoring first; LLM-assisted extraction is a stretch goal with its own precision check
- [ ] NetworkX store + persistence
- [ ] `graph_lookup` · `graph_traverse` · `graph_query_natural`
- [ ] Agent loop with sufficiency assessment
- [ ] **Cap `max_hops` and add a timeout guard** so a failing traversal can't blow the latency budget
- [ ] Log the traversal path for the UI's reasoning view

### Routing
- [ ] Config/CLI flag to point the same UI at either track — required for a fair replay

### Store plumbing
- [x] ChromaDB running as a compose service with a persistent volume
- [x] Client wrapper supporting both server and embedded mode, degrading to a status when absent
- [ ] `VectorStoreAdapter` interface over it (needed for the DB bake-off)

## M7 — Observability  ▸ Layer 10

- [x] `ai_logs.db`, **separate** from the sensor DB
- [x] Seven tables: conversation · tool · rag · model · error · feedback · **memory**
- [x] `query_id` generation + `trace(query_id)` across all tables
- [x] `log()` never raises — a failed write must not break a chat response
- [ ] Wire logging into the orchestration flow (needs M5)
- [ ] Async logging via `BackgroundTasks` — must never block a response
- [ ] Never log secrets or personal identifiers
- [ ] Streamlit log viewer: history, filters, per-query trace, error dashboard, evaluation view

## M8 — Evaluation

- [ ] Golden query set — 30–50 queries, stratified across the 5 categories in §5
- [ ] Hand-label ground-truth answers and relevant-evidence sets
- [ ] Groundedness / hallucination scoring
- [ ] Retrieval precision@3 and @5, recall, MRR
- [ ] Latency harness — mean, p50, p95, broken down by stage
- [ ] **Freeze both tracks, then run once.** Tuning after seeing results invalidates the comparison
- [ ] Produce the head-to-head comparison table
- [ ] Qualitative failure analysis — *when* and *why* each track fails
- [ ] Method B: n8n → Google Sheets → LLM-as-a-judge over **exported** logs only
- [ ] Human evaluation panel (chem-eng students + faculty)

## M9 — Hardware & model console  ▸ Layer 11

CLI first — it's the safe MVP. Web UI only if time allows.

- [ ] Detect RAM/CPU/GPU/VRAM/disk/Ollama version
- [ ] Hand-curated model catalog with quantization variants
- [ ] Memory estimator (`docs/PROJECT.md` §8.2)
- [ ] Scorer → `safe` / `marginal` / `will_not_fit` + ranking
- [ ] Ollama management: list, pull, delete
- [ ] Benchmark runner — 5 runs, averaged
- [ ] Write the selection to `config/model_config.json`
- [ ] Cross-check estimates against LLM Checker for the methodology chapter
- [ ] *Optional:* Streamlit UI

## M10 — Dashboard completion  ▸ Layer 9B

- [ ] Wire the chat UI to `POST /api/chat` *(currently mocked)*
- [ ] SSE streaming rendering
- [ ] Source badges — `[Live DB]` `[Trend]` `[SOP]` `[Manual]` `[Graph]`
- [ ] Collapsible tool-call trace (Thought → Action → Observation)
- [ ] Graph visualiser for GraphRAG traversal paths
- [ ] Hardware/model panel in settings
- [ ] Wire the benchmark endpoints into the evaluation harness (M8) — they are configurable but nothing reads them yet
- [ ] "Added Models" panel — list local Ollama models alongside the cloud baselines
- [ ] Let the raw browser filter by `session_id` / `query_id`, so one conversation's rows can be isolated
- [x] Sidebar driven by `GET /api/sessions` — select, inline rename, delete, filter
- [x] Reopen a chat via `GET /api/sessions/{id}/messages`
- [x] User messages persisted through `POST /api/sessions/{id}/messages`
- [x] Incognito passes `ephemeral: true`; those sessions are never listed and are swept on restart
- [ ] Suppress `user_query`/`response_text` in `conversation_logs` for ephemeral sessions *(needs the orchestrator — nothing writes those rows yet)*
- [ ] Archive from the sidebar *(the API supports it; no UI affordance yet)*
- [ ] Error and loading states for a backend that's down or slow

---

## Done

- [x] React dashboard shell — Vite · TanStack Router · Tailwind v4 · shadcn/base-ui
- [x] Chat interface (mock) — composer, model selector, incognito, typewriter greeting
- [x] Theme engine — 16 themes, 7 base + 14 per-zone colours, derived syntax ramps, harmony generator, font/density/scale, frosted glass, import/export, custom themes
- [x] Background effects — 9 options, 7 canvas-animated, pointer-reactive
- [x] Settings modal — sectioned nav, incognito toggle, model defaults
- [x] FastAPI skeleton — health endpoint, CORS, lifespan init
- [x] SQLite preference store — server-side, nothing in browser storage
- [x] Flash-free first paint via server-rendered `theme.css`
- [x] Single-image Docker build + `./daedalus.sh` (setup · start · dev · stop · logs · rebuild · status)
- [x] Repo split into `frontend/` · `backend/` · `docs/` with runtime state at the root
- [x] `.env.example` as the single configuration surface — all five stores, ports and Ollama; compose and the script both read it
- [x] `docs/PROJECT.md` — reconciled the two spec sets into one canonical document
- [x] Consolidated `docs/` + `context/` into a single `docs/` folder with an index and an implementation reference
- [x] Repo cleanup — dropped a stray screenshot, a duplicate image folder, an empty temp file, and the vendored `odysseus/` reference sample (168MB) now that the theme and settings ports are done
- [x] Settings shell parity with Odysseus — panel registry, keyword search with keyboard nav, drag-resizable + collapsible rail with ARIA, server-persisted layout
- [x] Five separate stores wired and containerised — sensor (read-only), audit logs, chat transcripts, Chroma vector DB, prefs
- [x] `GET /api/system/databases` + the Settings → Databases panel surfacing all five, with schema version
- [x] Chat transcript store — `chat_sessions` + `chat_messages`, `seq`-ordered, cascade delete, auto-titling, archive, incognito sweep
- [x] Session API — `POST`/`GET`/`PATCH`/`DELETE /api/sessions`, transcript read, user-message append (assistant turns are orchestrator-only, so a client cannot forge one into the model's context)
- [x] Context-window assembly — `build_context()` with a token budget, rolling-summary cursor, and evidence deliberately excluded from replay (§7.4)
- [x] Versioned schema migrations — numbered SQL per store, one transaction each, applied at startup; refuses on checksum drift, gap numbering and missing files; rolls back bad SQL
- [x] `./daedalus.sh migrate` — `up` · `status` · `check` · `backup` · `repair` · `new`, with CI-friendly exit codes
- [x] Shared SQLite layer — WAL, busy timeout, `foreign_keys=ON`, `BEGIN IMMEDIATE`, retry on lock, `VACUUM INTO` backups, `quick_check`
- [x] Backend split into `api/` · `services/` · `models/` · `db/` so the orchestrator reaches conversation state without going through HTTP
- [x] `sync.sh` — post-pull recovery: dependencies, `.env` backfill, migrations, integrity check, orphan detection, with `--check` dry run
- [x] `reset.sh` — snapshot, wipe and rebuild the databases; sensor excluded by default and double-confirmed; refuses while the stack holds the files open
- [x] `scripts/common.sh` — one copy of the output helpers, `.env` backfill, compose shim and path handling for all three scripts
- [x] Raw store browser — `GET /api/logs/...` + Settings → Databases → **Browse rows**; allowlisted, read-only, secrets unreachable
- [x] Cloud model endpoints — Settings → **Add Models**: provider catalogue, base URL + key, connection test, masked key hints. Rule 1 enforced by a `CHECK (purpose = 'benchmark')` constraint
- [x] Settings shell responds to its **container** width — below 620px the rail goes horizontal and resize/collapse withdraw (Odysseus' `isDesktopSidebarMode`)
- [x] `docs/SCRIPTS.md` — every script, subcommand, flag and exit code, and the reasoning behind each safeguard
- [x] `ACKNOWLEDGMENTS.md` — credits Odysseus (PewDiePie) for the theme/settings/prefs design, and records **why this is not a fork**: Odysseus is AGPL-3.0, Daedalus is MIT, and no Odysseus code is present
- [x] **Host/container path mapping** — `.env` holds container paths, so `daedalus.sh dev` was pointing the dev server at `backend/data/` while Docker wrote to `data/` and `logs/`. Host-side commands now map them, so both see the same files
- [x] Unknown `/api/*` paths return 404 instead of falling through to the SPA catch-all

---

## Known issues

- [ ] Chat responses are placeholders — no `POST /api/chat` yet. User turns persist; assistant turns do not, and the UI says so
- [ ] A reopened chat therefore shows only your own messages until the orchestrator lands
- [ ] Three `setState`-in-effect lint warnings (`ChatInterface`, `ThemeModal`, `DatabasesPanel`) — pre-existing. `SessionsContext` has one too, but it is the legitimate kind: an effect synchronising with the backend on mount
- [ ] Anyone who ran `daedalus.sh dev` before the path fix has orphaned databases under `backend/data/` — `sync.sh` reports them; they are not deleted for you
- [ ] No automated tests on either side. The chat store, migration runner and session API were verified by direct calls, but nothing is in CI — the migration runner especially wants a test suite, since it is the piece that can quietly break every other store
- [ ] `daedalus.sh` assumes the Docker daemon is running — it reports the failure but can't start it
- [ ] `POST /api/system/seed-demo` is a development convenience with no auth — remove or gate it before any shared deployment
- [ ] Settings panels other than AI Defaults, Add Models, Databases and Shortcuts are still placeholders
- [ ] Benchmark API keys are stored in plain text in `prefs.db`. Acceptable for a single-user local deployment on a git-ignored file, and the API never returns them — but it is not a secret store, and the file should not be copied around

---

## Deferred — Phase 2

- [ ] PyQt5 embedded tab (Layer 9A)
- [ ] Multi-device `device_profiles` + dynamically generated per-device tools
- [ ] Kùzu graph backend comparison
- [ ] LAN / multi-lab deployment
- [ ] Vector-DB bake-off: sqlite-vec · libSQL · Turso · FAISS · LanceDB
