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

- [x] Ollama client wrapper with timeout and retry — `services/ollama_client.py`.
      Resolves the daemon across `OLLAMA_BASE_URL`, `localhost` and `127.0.0.1`
      (the last because `localhost` resolves to `::1` first and Ollama binds
      IPv4), caches whichever answered, and refuses to fall back locally when
      the configured host is a real remote: answering from the wrong machine
      would attribute a benchmark to hardware that never ran it
- [x] `config/model_config.json` — model never hardcoded in FastAPI.
      `services/model_config.py`, read on every `POST /api/chat`. Two modes:
      `pinned` names a model, `auto` stores the *policy* "best-scoring installed
      model on whatever machine reads this" and resolves per request. Auto is
      the default, because a pinned name is a claim about one machine's hardware
      that goes quietly stale on any other
- [x] The serving path — `POST /api/chat` (`services/inference.py`). Resolves
      the model, replays conversation history, streams from Ollama and writes a
      `model_logs` row tagged `source='chat'`. `evidence` is threaded through
      unused so retrieval can mount without rearranging the prompt
- [x] Measure time-to-first-token and tok/s on a **RAG-context-sized** prompt,
      not a bare question — `services/benchmark.py`, ~2k tokens, from `rag_logs`
      when a real retrieval exists and a labelled fixture otherwise
- [ ] Pull and smoke-test the SLM tier: Qwen3 1.7B · Phi-3 Mini 3.8B · Gemma 3 1B (Q4_K_M)
- [ ] Streaming responses on the chat path — currently synchronous, which is
      tolerable at 300–400ms TTFT and will not be on a larger model
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
- [ ] Metrics + container logs on their own port — Prometheus scraping the app,
      Grafana over it, and the compose logs for each service in one place. The
      dashboard says *whether* a store is healthy; this is where you go to find
      out *why* it isn't, without dropping to `docker compose logs`
- [ ] Wire it to the Databases panel — the standing link described in M10, plus
      per-store deep links so an unhealthy row lands on *that* service's logs
      rather than on the Grafana home page

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

Planned CLI-first as the safe MVP. It went the other way: the web console was
built directly, because the detection and scoring services are the substance and
a UI over them was cheaper than a second CLI surface. See **The Forge** under
Layer 9 below for the per-step detail.

- [x] Detect RAM/CPU/GPU/VRAM/disk/Ollama version — on a background schedule,
      not per panel open (`services/hardware.py`)
- [x] Hand-curated model catalog with quantization variants — 37 entries in
      `backend/app/data/model_catalogue.json`, every Ollama tag verified against
      the registry, plus live Hugging Face GGUF search for anything not declared
- [x] Memory estimator (`docs/PROJECT.md` §8.2) — `services/model_fit.py`
- [x] Scorer → `safe` / `marginal` / `will_not_fit` + ranking, judged against
      **two** memory pools so a model too large for VRAM is offloaded rather
      than disqualified
- [x] Ollama management: list, pull (SSE, cancellable), delete
- [x] Benchmark runner on a RAG-sized prompt, with a warm-up pass
- [x] Write the selection to `config/model_config.json`
- [ ] Average the benchmark over several runs — currently one run per click.
      `GET /api/forge/usage` already aggregates every logged run into
      mean/p50/p95, so this is about the *per-click* figure, not the report's
- [ ] Cross-check estimates against LLM Checker for the methodology chapter.
      Worth doing now that there is something to check: on the development
      machine the estimator predicted 28.9 tok/s against 27.9 measured
- [ ] *Optional:* Streamlit UI — unlikely; the web console covers it

## M10 — Dashboard completion  ▸ Layer 9B

- [ ] Wire the chat UI to `POST /api/chat` *(currently mocked)*
- [ ] SSE streaming rendering
- [ ] Source badges — `[Live DB]` `[Trend]` `[SOP]` `[Manual]` `[Graph]`
- [ ] Collapsible tool-call trace (Thought → Action → Observation) — the inline
      half of Ariadne's Thread, below
- [ ] Graph visualiser for GraphRAG traversal paths — traversal replay, the
      centrepiece of Labyrinth Blueprints, below
- [ ] The three sidebar modules — **designed, none built.** Full spec in
      [`docs/MODULES.md`](docs/MODULES.md); each is a `PROJECT.md` §10.2
      "glass box" promise given a home:
  - [ ] **Ariadne's Thread** — provenance. Joins the seven audit tables on
        `query_id` into one causal trace, with a number-by-number
        groundedness verdict over the answer. Build first: the schema
        already exists, so the viewer can go in now against a trace seeder
  - [x] **The Forge** — hardware & model console (§8.2, Layer 11). **All six
        steps built,** as three tabs: Hardware · Models · Added Models.
        `HardwareView` is still shared with Settings → Hardware. The two model
        tabs split by *question*, not by kind: Models is discovery (what could
        run here, ranked), Added Models is inventory (what is here, managed):
    - [x] Detect — RAM, CPU, GPU/VRAM, disk, Ollama (`GET /api/forge/hardware`).
          Runs on a background schedule rather than per panel open — three
          tiers, dormant when nobody is looking (`services/hardware.py`)
    - [x] Estimate memory per model × quantization — `services/model_fit.py`.
          Prefers measured weight size and measured architecture from
          `/api/show` over the parameter-count arithmetic wherever a model is
          actually pulled
    - [x] Score fit → `safe` | `marginal` | `will_not_fit`, against **two**
          pools: a model too large for VRAM is offloaded, not disqualified.
          Four weighted dimensions, weights derived from §9.2's own targets
    - [x] Manage Ollama models — list / pull (SSE progress, cancellable) / delete
    - [x] Benchmark on a RAG-context-sized prompt (~2k tokens, from `rag_logs`
          when one exists, a labelled fixture otherwise); warm-up pass first;
          writes `model_logs` under a `bench_` query id
    - [x] Commit the choice to `config/model_config.json` — **`auto` or
          `pinned`.** Auto stores a policy, not a name, and re-resolves to the
          best-fitting *installed* model on whatever machine reads it.
          **No tab:** a Deployment panel existed and was removed, because it set
          a value the composer's own model picker already sets and two controls
          for one decision drift apart. The file is still read on every request,
          still answers when no browser is choosing (a scripted run, the M8
          harness, the first request after a restart), and is hand-editable to
          pin a model for a reproducible experiment
    - [x] Absorb the Added Models panel — it is now the inventory tab, with
          Local and Cloud panes. Local lists installed models badged **SLM** or
          **LLM** with a size filter; both tiers answer chat, and only the cloud
          tier never does (§8.1 marks only *it* "never deployed"). Cloud renders
          the same `ModelEndpointsPanel` Settings does, behind its own warning
    - [x] **Usage and stats per model** — `GET /api/forge/usage` aggregates
          `model_logs` into run counts split by `source`, token totals, and
          latency as **mean, p50 and p95**, which is what §9.2 asks for by name.
          A mean alone hides the tail: on test data mean TTFT ran at roughly
          twice p50 because of a handful of cold loads
    - [x] **Discovery beyond the six.** 37 catalogue entries (6 shortlisted +
          31 verified Ollama library), plus live Hugging Face GGUF search and a
          Custom tab that scores any tag — `hf.co/{repo}:{quant}` included
    - [x] **Universal hardware.** Two-pool verdicts (GPU / offload / CPU): a
          machine with no GPU has no VRAM pool, is judged against system RAM and
          reports `placement: cpu`, and Apple Silicon uses the Metal constant
          rather than the ARM CPU one — which is nearly a 2x difference
    - [x] Verify the Ollama tags — `services/ollama_registry.py` reads each
          tag's OCI manifest, which both confirms it exists and reports the real
          weight size, so estimates use published bytes rather than
          `params × bytes_per_param` before anything is downloaded. 46 of 48
          rows now estimate from real byte counts; it caught one broken tag the
          catalogue had shipped
    - [x] **Measure the engine, not the wall clock.** Migration `002` adds
          `prefill_ms`, `generation_ms`, `load_ms` and `source` to `model_logs`.
          The first benchmark derived tok/s as `completion ÷ (total − TTFT)`,
          which charges the model for any client-side delay and reported
          llama3.2 at 11 tok/s where the engine said 23.9 — and made the
          estimator look 0.38x optimistic when it was actually within 3%
    - [ ] **Verify the catalogue's quality figures.** Six MMLU scores in
          `backend/app/data/model_catalogue.json` ship `verified: false` with a
          source URL each; the UI marks them unverified. Check them against the
          model cards before any of this reaches the report. (Library and
          discovered models carry no MMLU at all, by design — they are scored
          from a neutral baseline with the quantization penalty applied)
  - [ ] **Labyrinth Blueprints** — the corpus and the knowledge graph, with
        traversal replay for a graph-track `query_id`. Most blocked (M2 +
        Track 2); storage is an open decision — see MODULES.md §3.4
- [ ] Add a traversal-path column to `rag_logs` **now** — one cheap migration
      today, unreplayable traces forever if it lands after rows exist
- [x] Mark the unbuilt modules in the sidebar — Ariadne's Thread and Labyrinth
      Blueprints are disabled with a dot and a tooltip; The Forge opens
- [x] **Wire the serving path (thin slice of M4).** `POST /api/chat` resolves the
      model through `config/model_config.json`, calls Ollama with the replayed
      conversation, and writes a `model_logs` row tagged `source='chat'` beside
      the Forge's `source='benchmark'` rows. The chat picker is filtered to
      local installed models and defaults to the committed choice, so Rule 1
      cannot be broken from the composer. Retrieval and tool-calling still to come
- [ ] Wire the benchmark endpoints into the evaluation harness (M8) — they are configurable but nothing reads them yet
- [x] "Added Models" panel — list local Ollama models alongside the cloud baselines
- [x] **Split the Databases feature in two, by how often you reach for each half.**
      Settings is the refined, occasional surface; the sidebar is the one-click,
      everyday one. Nothing lives in both:
  - [x] Settings → Databases is health-only — per store: Healthy or Not healthy,
        schema version, size, last error. No row browsing, no tables, no modal
  - [x] A permanent link out of that panel to the metrics/logs service (below),
        present whether or not anything is failing. Reads
        `DAEDALUS_OBSERVABILITY_URL` via `GET /api/system/observability`; says
        the stack is not configured rather than offering a dead link
  - [x] The store browser is in the sidebar under the chat history — expand a
        store, click a table, rows render in the main pane at
        `/stores/$store/$table`. A route, not a modal: deep-linkable, Back
        works, full pane width. `RawLogModal` is gone
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
- [x] Monocraft (the Minecraft typeface) as the default face, bundled and self-hosted — every font path in the UI resolves through one variable
- [x] Attention dimming — the sidebar and the chat surfaces go translucent while the pointer and focus are elsewhere
- [x] Data stores in the sidebar — the five stores next to the chats, tables and rows one click away in a floating window
- [x] Shared `FloatingWindow` shell — drag, resize, Peek, **minimize**, Escape.
      Settings, Data stores and the Forge use it; ThemeModal stays non-modal by design
  - [x] Minimize collapses a window to a chip and clicking the chip restores
        it. The window is hidden with `display: none` rather than unmounted, so
        the active tab, scroll position and filters survive — otherwise
        "restore" would quietly mean "reopen". Escape restores a minimized
        window instead of closing it
  - [x] Clicking anywhere outside a window **minimizes** it rather than closing. A window holds
        real work — a filtered model table, a half-written API key, an open
        store row — and a stray click outside should set that aside, not throw
        it away. Closing stays deliberate: the ✕, or Escape. The shell windows
        get this from their backdrop; `ThemeModal` has none by design, so it
        uses `useMinimizeOnOutsideClick`, a capture-phase `pointerdown` listener
        that ignores portalled menus, selects and tooltips — those sit outside
        the window in the DOM but belong to it, and a naive containment test
        would minimize the window the moment you opened a dropdown in it
  - [x] Reopening a minimized window from its trigger restores it. Minimize is
        internal state, so `open` stays true while collapsed and every trigger's
        `setOpen(true)` was a no-op — clicking Theme after minimizing Theme did
        nothing. A window registers a restore callback while minimized and
        `openWindow()` in `__root.tsx` calls it first. Every path into a window
        goes through those four callbacks, so it is handled in one place
  - [x] Chips dock **beside the incognito toggle**, not in a floating bar. A
        bar at bottom-centre sat directly under the composer, which is the one
        place guaranteed to compete for attention while you type. `ChatInterface`
        renders the slot; `FloatingWindow` portals into it by id, and falls back
        to a free-floating strip anywhere the slot is not mounted
  - [x] `ThemeModal` gets it too, via `useMinimizeToDock`. It stays off the
        shell — it is non-modal by design, so you can watch the app change
        while dragging a slider — but borrows the chip and the dock, so both
        kinds of window look identical once collapsed
- [x] One `Switch` component for every on/off control — a segmented ON | OFF
      rather than a pill and knob, so the state is readable from the word and
      not only from position and colour. Replaced three hand-rolled copies
- [x] Loading skeletons everywhere, in two styles. `data-skeleton` on `<html>`
      picks `pixel` (square, block grid, stepped shimmer, to sit with Monocraft)
      or `smooth`; the control is in Theme → Customize with a live sample.
      Two panels previously rendered their *empty* state while still fetching,
      which is the failure this exists to prevent
- [x] Hardware detection — CPU/RAM/GPU/VRAM/disk/Ollama, in Settings → Hardware and The Forge
- [x] **Every colour derives from the selected theme.** A theme here is an
      arbitrary accent over an arbitrary background, light or dark, so a
      hardcoded `text-amber-400` is legible on one and invisible on the next.
      `lib/themes.ts` now derives and floors, holding each colour's hue and
      saturation and moving only lightness until it clears WCAG AA:
  - [x] `deriveReadableText` / `deriveReadableMuted` — body text failed AA on
        2 of 16 themes (Cute 3.26:1, Retrowave 4.46:1) and muted text on 5
        (Retrowave 2.64:1, Daylight 3.19:1). Both are floored now
  - [x] `deriveReadableAccent` — `--primary` is tuned as a *fill*; as small text
        it failed on 6 themes (Paper 2.11:1). `--primary-readable` is the text
        variant, used by `.theme-accent`
  - [x] `derivePrimaryContrast` — eight accent-filled buttons hardcoded a black
        label, which fails on Organs (3.99:1) and on any dark custom accent
  - [x] `--status-ok/warn/bad/info` — green/amber/red pitched against the
        background's lightness, so a verdict reads on a cream theme and a black one
  - [x] `.theme-surface` / `.theme-track` — replaced 71 `bg-black/N` usages that
        always darkened, which is a different effect on a light theme than a dark one
  - [x] **All 16 shipped themes now pass AA on every text role** (body, muted,
        accent, on-accent, and all three status colours). Custom themes route
        through the same `applyColors`, so the derivation runs on them too
  - [x] Tab and panel animations — a one-shot spin-in on the selected icon, and
        a fade-and-rise on pane switches, across the Forge, Settings and the
        theme modal. Honours `prefers-reduced-motion`
- [x] Settings → Databases reduced to a health page, with a standing link out to the (not yet built) metrics stack
- [x] Background effects — 13 options, 11 canvas-animated, pointer-reactive
- [x] Settings modal — sectioned nav, incognito toggle
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
- [x] Expanded raw store browser — added `sensor` telemetry (`sensor_readings`, `anomaly_records`) and `vector` store chunks (`daedalus_knowledge`). Upgraded `RawLogModal` to be draggable with the exact same 'Peek' (transparency) UI as the Settings and Theme windows.
- [x] Cloud model endpoints — Settings → **Add Models**: provider catalogue, base URL + key, connection test, masked key hints. Rule 1 enforced by a `CHECK (purpose = 'benchmark')` constraint
- [x] Settings shell responds to its **container** width — below 620px the rail goes horizontal and resize/collapse withdraw (Odysseus' `isDesktopSidebarMode`)
- [x] `docs/SCRIPTS.md` — every script, subcommand, flag and exit code, and the reasoning behind each safeguard
- [x] `ACKNOWLEDGMENTS.md` — credits Odysseus (PewDiePie) for the theme/settings/prefs design, and records **why this is not a fork**: Odysseus is AGPL-3.0, Daedalus is MIT, and no Odysseus code is present
- [x] **Host/container path mapping** — `.env` holds container paths, so `daedalus.sh dev` was pointing the dev server at `backend/data/` while Docker wrote to `data/` and `logs/`. Host-side commands now map them, so both see the same files
- [x] Unknown `/api/*` paths return 404 instead of falling through to the SPA catch-all
- [x] Unified model discovery via `/api/system/models` querying both Ollama REST API (`OLLAMA_BASE_URL`) and cloud benchmark endpoints.
- [x] Dynamic model integration — Chat interface selector now adaptively loads models on-hand instead of hardcoded placeholders.

---

## Known issues

- [ ] Chat responses are synchronous — `POST /api/chat` answers in one shot with
      no streaming. Fine at 300–400ms to first token on a 3B model, and not fine
      on anything larger
- [ ] The chat path has no retrieval or tool-calling yet: it replays conversation
      history and answers. `evidence` is threaded through `inference.answer()`
      unused, so the prompt is already in its final shape for M5/M6
- [ ] Four `setState`-in-effect lint warnings (`SessionsContext`, `ModelsView` ×2,
      `AddedModelsView`) — all the legitimate kind: an effect synchronising with
      the backend on mount
- [ ] Anyone who ran `daedalus.sh dev` before the path fix has orphaned databases under `backend/data/` — `sync.sh` reports them; they are not deleted for you
- [ ] No automated tests on either side. The chat store, migration runner and session API were verified by direct calls, but nothing is in CI — the migration runner especially wants a test suite, since it is the piece that can quietly break every other store
- [ ] `daedalus.sh` assumes the Docker daemon is running — it reports the failure but can't start it
- [ ] `POST /api/system/seed-demo` is a development convenience with no auth — remove or gate it before any shared deployment
- [ ] Settings panels other than Add Models, Databases and Shortcuts are still placeholders
- [ ] Two Font selector options are not actually bundled — `mono` names Fira Code
      and `opendyslexic` names OpenDyslexic, but only Monocraft and Geist ship
      with the app, so both silently fall back (to the system monospace and to
      Comic Sans respectively). Pre-existing; the OpenDyslexic one matters most,
      since it is offered as an accessibility affordance and currently isn't one
- [ ] Hugging Face gated repositories cannot be pulled. Public GGUF publishers
      (bartowski, unsloth, mradermacher, lmstudio-community) need no token, but
      `meta-llama` and friends do, and Ollama's `hf.co/` pull does not reliably
      honour one (ollama#7240). The route for those is `huggingface-cli download`
      then `ollama create`. No token field is offered, because it would be a box
      that often does not work
- [ ] Benchmark API keys are stored in plain text in `prefs.db`. Acceptable for a single-user local deployment on a git-ignored file, and the API never returns them — but it is not a secret store, and the file should not be copied around

---

## Deferred — Phase 2

- [ ] PyQt5 embedded tab (Layer 9A)
- [ ] Multi-device `device_profiles` + dynamically generated per-device tools
- [ ] Kùzu graph backend comparison
- [ ] LAN / multi-lab deployment
- [ ] Vector-DB bake-off: sqlite-vec · libSQL · Turso · FAISS · LanceDB
